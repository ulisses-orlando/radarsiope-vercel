// backend/sendBatchViaSES.js
import express from "express";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import admin from "firebase-admin";

const router = express.Router();

// CORS middleware (permite chamadas do front em Vercel)
router.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "https://radarsiope-vercel.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

// Inicializa SES
const ses = new SESClient({
  region: process.env.AWS_REGION || "us-east-1"
});

// Inicializa Firestore Admin
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
    console.info("Admin SDK inicializado");
  } catch (err) {
    console.error("Erro inicializando Admin SDK:", err);
    throw err;
  }
}
const db = admin.firestore();

/**
 * Atualiza retorno do SES no servidor.
 * Atualiza:
 * - newsletters/{newsletterId}/envios/{envioId}/lotes/{loteId}/envios/{envioRegistroId}
 * - newsletters/{newsletterId}/envios/{envioId}/lotes/{loteId}
 * - newsletters/{newsletterId}/envios/{envioId}/lotes/{loteId}/envios_log
 * - lotes_gerais (onde loteId/envioId correspondem)
 * - newsletters/{newsletterId} (marcar enviada)
 * - leads/{destId}/envios/{envioRegistroId}
 * - usuarios/{destId}/assinaturas/{assinaturaId}/envios/{envioRegistroId}
 */
async function atualizarRetornoSES_servidor(newsletterId, envioId, loteId, resultadosLog, operador = "Sistema") {
  try {
    const loteRef = db.collection("newsletters")
      .doc(newsletterId).collection("envios")
      .doc(envioId).collection("lotes").doc(loteId);

    const agora = admin.firestore.Timestamp.now();
    let enviados = 0;
    const loteBatch = db.batch();

    for (const r of resultadosLog) {
      const { envioId: envioRegistroId, ok, error, messageId, destinatarioId, assinaturaId } = r;
      const status = ok ? "enviado" : "erro";
      const envioDocRef = loteRef.collection("envios").doc(envioRegistroId);

      // Atualiza documento do envio dentro do lote
      loteBatch.set(envioDocRef, {
        status,
        erro: error || null,
        data_envio: agora,
        sesMessageId: messageId || null
      }, { merge: true });

      // Atualiza também em leads/{id}/envios/{envioRegistroId}
      if (destinatarioId) {
        try {
          const leadRef = db.collection("leads").doc(destinatarioId).collection("envios").doc(envioRegistroId);
          loteBatch.set(leadRef, {
            status,
            erro: error || null,
            data_envio: agora,
            sesMessageId: messageId || null
          }, { merge: true });
        } catch (err) {
          console.warn("Falha ao preparar update em leads:", err.message);
        }

        // Atualiza em usuarios/{id}/assinaturas/{assinaturaId}/envios/{envioRegistroId}
        if (assinaturaId) {
          try {
            const usuarioAssinRef = db.collection("usuarios")
              .doc(destinatarioId)
              .collection("assinaturas")
              .doc(assinaturaId)
              .collection("envios")
              .doc(envioRegistroId);
            loteBatch.set(usuarioAssinRef, {
              status,
              erro: error || null,
              data_envio: agora,
              sesMessageId: messageId || null
            }, { merge: true });
          } catch (err) {
            console.warn("Falha ao preparar update em usuarios/assinaturas:", err.message);
          }
        }
      }

      if (ok) enviados++;
    }

    // Atualiza o documento do lote
    loteBatch.set(loteRef, {
      enviados,
      status: enviados === resultadosLog.length ? "completo" : "parcial",
      data_envio: agora
    }, { merge: true });

    // Commit das atualizações em lote
    await loteBatch.commit();

    // Grava um registro em envios_log (fora do batch para timestamp único)
    await loteRef.collection("envios_log").add({
      data_envio: agora,
      quantidade: resultadosLog.length,
      enviados,
      origem: "manual",
      operador,
      status: enviados === resultadosLog.length ? "completo" : "parcial"
    });

    // Atualiza lotes_gerais (se existir)
    try {
      const loteGeralSnap = await db.collection("lotes_gerais")
        .where("loteId", "==", loteId)
        .where("envioId", "==", envioId)
        .limit(1)
        .get();

      if (!loteGeralSnap.empty) {
        const loteGeralRef = loteGeralSnap.docs[0].ref;
        await loteGeralRef.update({
          enviados,
          status: enviados === resultadosLog.length ? "completo" : "parcial",
          data_envio: agora
        });
      }
    } catch (err) {
      console.warn("Falha ao atualizar lotes_gerais:", err.message);
    }

    // Marca newsletter como enviada/publicada
    try {
      await db.collection("newsletters").doc(newsletterId).update({
        enviada: true,
        data_publicacao: agora
      });
    } catch (err) {
      console.warn("Falha ao atualizar newsletter:", err.message);
    }

    return { ok: true, enviados, total: resultadosLog.length };
  } catch (err) {
    console.error("Erro atualizarRetornoSES_servidor:", err);
    return { ok: false, error: err.message };
  }
}

/**
 * Função que envia um e-mail via SES e retorna resultado.
 * Retorna objeto { ok, messageId?, error? }
 */
async function enviarEmailSES(item, emailRemetente, replyTo) {
  try {
    const params = {
      Source: emailRemetente,
      Destination: { ToAddresses: [item.email] },
      Message: {
        Body: { Html: { Charset: "UTF-8", Data: item.mensagemHtml } },
        Subject: { Charset: "UTF-8", Data: item.assunto }
      },
      ReplyToAddresses: [replyTo]
    };

    const resp = await ses.send(new SendEmailCommand(params));
    const sesMessageId = resp?.MessageId || null;
    return { ok: true, messageId: sesMessageId };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Rota principal de envio em lote via SES.
 * Suporta:
 * - POST /api/sendBatchViaSES  (envio direto com payload emails: [])
 * - POST /api/sendBatchViaSES  com { action: "processarLote", newsletterId, envioId, loteId } para processar um lote existente
 *
 * Observação: para action "processarLote" o backend lê os envios do lote e processa apenas envios que ainda não têm sesMessageId e não estão com status "enviado".
 * Proteção: se ADMIN_TOKEN estiver definido, exige header x-admin-token com o mesmo valor para ações administrativas (processarLote).
 */
router.post("/api/sendBatchViaSES", async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  console.info({ requestId, evento: 'envioLote.inicio', ts: new Date().toISOString() });

  try {
    // validação de variáveis de ambiente essenciais
    const emailRemetente = process.env.SES_SOURCE_EMAIL;
    const replyTo = process.env.SES_REPLY_TO || process.env.SES_SOURCE_EMAIL;
    const taxa = Number(process.env.SES_RATE_LIMIT || 14); // e-mails por segundo
    const adminToken = process.env.ADMIN_TOKEN || null;

    if (!emailRemetente) {
      console.error({ requestId, evento: 'missing.env', var: 'SES_SOURCE_EMAIL' });
      return res.status(500).json({ ok: false, error: 'Configuração do servidor incorreta: SES_SOURCE_EMAIL não definida' });
    }

    const body = req.body || {};

    // Se action === "processarLote", processa lote existente
    if (body.action === "processarLote") {
      // valida token se configurado
      if (adminToken && req.headers['x-admin-token'] !== adminToken) {
        return res.status(403).json({ ok: false, error: 'Token admin inválido' });
      }

      const { newsletterId, envioId, loteId } = body;
      if (!newsletterId || !envioId || !loteId) {
        return res.status(400).json({ ok: false, error: 'Parâmetros inválidos para processar lote' });
      }

      // Lê envios do lote e monta payload apenas com envios que não têm sesMessageId e não estão enviados
      const loteRef = db.collection("newsletters").doc(newsletterId)
        .collection("envios").doc(envioId)
        .collection("lotes").doc(loteId);

      const enviosSnap = await loteRef.collection("envios").get();
      if (enviosSnap.empty) {
        return res.json({ ok: true, results: [], message: 'Nenhum envio encontrado no lote' });
      }

      const emailsParaEnviar = [];
      enviosSnap.forEach(doc => {
        const d = doc.data();
        const status = d.status || null;
        const sesMessageId = d.sesMessageId || null;
        if (!sesMessageId && status !== "enviado") {
          // espera que o documento do envio contenha nome, email e mensagemHtml e assunto
          emailsParaEnviar.push({
            nome: d.nome || d.destinatarioNome || null,
            email: d.email,
            mensagemHtml: d.mensagemHtml || d.html || '',
            assunto: d.assunto || d.titulo || 'Newsletter',
            envioId: doc.id,
            destinatarioId: d.destinatarioId || null,
            assinaturaId: d.assinaturaId || null
          });
        }
      });

      if (!emailsParaEnviar.length) {
        return res.json({ ok: true, results: [], message: 'Nenhum envio pendente para processar neste lote' });
      }

      // Envia em batches respeitando taxa
      const resultados = [];
      let batch = [];
      for (const item of emailsParaEnviar) {
        batch.push(item);
        if (batch.length >= taxa) {
          await Promise.all(batch.map(async it => {
            const r = await enviarEmailSES(it, emailRemetente, replyTo);
            resultados.push({ envioId: it.envioId, ok: r.ok, messageId: r.messageId || null, error: r.error || null, destinatarioId: it.destinatarioId || null, assinaturaId: it.assinaturaId || null });
            // grava sesMessageId imediato em envios_log do lote (se houver messageId)
            if (r.ok && r.messageId) {
              try {
                const caminhoLoteEnvio = `newsletters/${newsletterId}/envios/${envioId}/lotes/${loteId}/envios_log/${it.envioId}`;
                await db.doc(caminhoLoteEnvio).set({ sesMessageId: r.messageId }, { merge: true });
              } catch (err) {
                console.warn("Falha ao gravar sesMessageId no envios_log do lote:", err.message);
              }
            }
          }));
          batch = [];
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      if (batch.length > 0) {
        await Promise.all(batch.map(async it => {
          const r = await enviarEmailSES(it, emailRemetente, replyTo);
          resultados.push({ envioId: it.envioId, ok: r.ok, messageId: r.messageId || null, error: r.error || null, destinatarioId: it.destinatarioId || null, assinaturaId: it.assinaturaId || null });
          if (r.ok && r.messageId) {
            try {
              const caminhoLoteEnvio = `newsletters/${newsletterId}/envios/${envioId}/lotes/${loteId}/envios_log/${it.envioId}`;
              await db.doc(caminhoLoteEnvio).set({ sesMessageId: r.messageId }, { merge: true });
            } catch (err) {
              console.warn("Falha ao gravar sesMessageId no envios_log do lote:", err.message);
            }
          }
        }));
      }

      // Atualiza retorno imediato no Firestore
      try {
        const operador = req.headers['x-admin-operator'] || body.operador || "Sistema";
        await atualizarRetornoSES_servidor(newsletterId, envioId, loteId, resultados, operador);
      } catch (err) {
        console.warn("Falha ao atualizar retorno após processar lote:", err.message);
      }

      return res.json({ ok: true, results: resultados });
    }

    // Caso padrão: envio direto com payload emails: []
    const { newsletterId, envioId, loteId, emails } = body;
    if (!emails || !Array.isArray(emails)) {
      return res.status(400).json({ ok: false, error: "Payload inválido: emails esperado" });
    }

    const resultados = [];
    let loteEnvio = [];

    // Função interna para enviar e gravar sesMessageId em fallback
    async function enviarERegistrar(item) {
      const r = await enviarEmailSES(item, emailRemetente, replyTo);
      if (r.ok) {
        // grava sesMessageId no envios_log do lote se possível
        if (r.messageId && newsletterId && envioId && loteId && item.envioId) {
          try {
            const caminhoLoteEnvio = `newsletters/${newsletterId}/envios/${envioId}/lotes/${loteId}/envios_log/${item.envioId}`;
            await db.doc(caminhoLoteEnvio).set({ sesMessageId: r.messageId }, { merge: true });
          } catch (err) {
            console.warn("Falha ao gravar sesMessageId no envios_log do lote:", err.message);
          }
        }

        // grava no documento original do envio (fallbacks) se tiver destinatarioId
        if (r.messageId && item.destinatarioId) {
          const destId = item.destinatarioId;
          try {
            const leadsPath = `leads/${destId}/envios/${item.envioId}`;
            await db.doc(leadsPath).set({ sesMessageId: r.messageId }, { merge: true });
          } catch (err) {
            console.warn(`Falha ao gravar em leads/${destId}/envios/${item.envioId}:`, err.message);
            if (item.assinaturaId) {
              try {
                const usuariosPath = `usuarios/${destId}/assinaturas/${item.assinaturaId}/envios/${item.envioId}`;
                await db.doc(usuariosPath).set({ sesMessageId: r.messageId }, { merge: true });
              } catch (err2) {
                console.warn(`Falha ao gravar em usuarios/...:`, err2.message);
              }
            } else {
              try {
                const q = db.collectionGroup("envios")
                  .where("newsletter_id", "==", newsletterId)
                  .where("destinatarioId", "==", destId)
                  .limit(5);
                const snap = await q.get();
                if (!snap.empty) {
                  const ops = [];
                  snap.forEach(doc => ops.push(doc.ref.set({ sesMessageId: r.messageId }, { merge: true })));
                  await Promise.all(ops);
                }
              } catch (err3) {
                console.warn("Erro no fallback collectionGroup:", err3.message);
              }
            }
          }
        }
      }
      return { envioId: item.envioId, ok: r.ok, messageId: r.messageId || null, error: r.error || null, destinatarioId: item.destinatarioId || null, assinaturaId: item.assinaturaId || null };
    }

    // Envio em batches respeitando taxa
    for (const e of emails) {
      loteEnvio.push(e);
      if (loteEnvio.length >= taxa) {
        await Promise.all(loteEnvio.map(enviarERegistrar));
        loteEnvio = [];
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    if (loteEnvio.length > 0) {
      await Promise.all(loteEnvio.map(enviarERegistrar));
    }

    // Após envio, atualiza retorno imediato no Firestore (se newsletterId/envioId/loteId foram fornecidos)
    try {
      const operador = req.user?.email || body.operador || "Sistema";
      if (newsletterId && envioId && loteId) {
        await atualizarRetornoSES_servidor(newsletterId, envioId, loteId, resultados, operador);
      }
    } catch (err) {
      console.warn("Falha ao atualizar retorno após envio em massa:", err.message);
    }

    return res.json({ ok: true, results: resultados });
  } catch (err) {
    console.error({ requestId, evento: 'envioLote.erro', nome: err.name, mensagem: err.message, stack: err.stack });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Função servidor para verificar e atualizar status de lotes pendentes (simples).
 * Varre lotes com status pendente/parcial e atualiza envios que já têm sesMessageId ou erro.
 */
async function atualizarStatusLotesPendentes_servidor(hours = 24, limit = 50, operador = "Sistema") {
  try {
    const corte = new Date(Date.now() - Number(hours) * 3600 * 1000);
    const now = admin.firestore.Timestamp.now();

    // Busca lotes com status pendente ou parcial
    const snapLotes = await db.collectionGroup("lotes")
      .where("status", "in", ["pendente", "parcial"])
      .limit(Number(limit))
      .get();

    const resultadosLotes = [];

    for (const loteDoc of snapLotes.docs) {
      const loteRef = loteDoc.ref;
      const loteData = loteDoc.data();
      const enviosSnap = await loteRef.collection("envios").get();
      if (enviosSnap.empty) {
        resultadosLotes.push({ lotePath: loteRef.path, atualizadoEnvios: 0, motivo: "sem envios" });
        continue;
      }

      let enviadosCount = 0;
      let atualizadosCount = 0;
      const batch = db.batch();

      for (const envioDoc of enviosSnap.docs) {
        const envioRef = envioDoc.ref;
        const d = envioDoc.data();
        const statusAtual = d.status || null;
        const sesMessageId = d.sesMessageId || null;
        const erro = d.erro || null;

        const updates = {};
        let precisaAtualizar = false;

        if (sesMessageId && statusAtual !== "enviado") {
          updates.status = "enviado";
          updates.data_envio = now;
          updates.sesMessageId = sesMessageId;
          precisaAtualizar = true;
          enviadosCount++;
        } else if (erro && statusAtual !== "erro") {
          updates.status = "erro";
          updates.erro = erro;
          updates.data_envio = now;
          precisaAtualizar = true;
        } else if (statusAtual === "enviado") {
          enviadosCount++;
        }

        if (precisaAtualizar) {
          batch.set(envioRef, updates, { merge: true });
          atualizadosCount++;
        }
      }

      const totalEnvios = enviosSnap.size;
      const statusLote = enviadosCount === totalEnvios ? "completo" : (enviadosCount > 0 ? "parcial" : loteData.status || "pendente");

      batch.set(loteRef, {
        enviados: enviadosCount,
        status: statusLote,
        data_envio: now
      }, { merge: true });

      await batch.commit();

      // Grava um registro em envios_log
      await loteRef.collection("envios_log").add({
        data_envio: now,
        quantidade: totalEnvios,
        enviados: enviadosCount,
        origem: "verificacao_manual",
        operador,
        status: statusLote
      });

      // Atualiza lotes_gerais e newsletter se possível
      try {
        const partes = loteRef.path.split('/');
        let newsletterId = null, envioId = null, loteId = null;
        if (partes.length >= 6 && partes[0] === "newsletters") {
          newsletterId = partes[1];
          envioId = partes[3];
          loteId = partes[5];
        }

        if (loteId && envioId) {
          const loteGeralSnap = await db.collection("lotes_gerais")
            .where("loteId", "==", loteId)
            .where("envioId", "==", envioId)
            .limit(1)
            .get();

          if (!loteGeralSnap.empty) {
            const loteGeralRef = loteGeralSnap.docs[0].ref;
            await loteGeralRef.update({
              enviados: enviadosCount,
              status: statusLote,
              data_envio: now
            });
          }

          if (newsletterId) {
            await db.collection("newsletters").doc(newsletterId).update({
              enviada: true,
              data_publicacao: now
            });
          }
        }
      } catch (err) {
        console.warn("Falha ao atualizar lotes_gerais/newsletter para lote:", loteRef.path, err.message);
      }

      resultadosLotes.push({
        lotePath: loteRef.path,
        totalEnvios,
        enviados: enviadosCount,
        atualizados: atualizadosCount,
        statusLote
      });
    }

    return { ok: true, verificados: resultadosLotes.length, detalhes: resultadosLotes };
  } catch (err) {
    console.error("Erro atualizarStatusLotesPendentes_servidor:", err);
    return { ok: false, error: err.message };
  }
}

// Rota de verificação sob demanda (reaproveita o mesmo arquivo)
// GET /api/verificarLotesPendentes?hours=24&limit=50
router.get("/api/verificarLotesPendentes", async (req, res) => {
  try {
    // valida token admin se configurado
    const adminToken = process.env.ADMIN_TOKEN || null;
    if (adminToken && req.headers['x-admin-token'] !== adminToken) {
      return res.status(403).json({ ok: false, error: 'Token admin inválido' });
    }

    const horas = Number(req.query.hours || 24);
    const limite = Number(req.query.limit || 50);
    const operador = req.headers['x-admin-operator'] || req.query.operador || "Sistema";

    const resultado = await atualizarStatusLotesPendentes_servidor(horas, limite, operador);
    if (!resultado.ok) {
      return res.status(500).json(resultado);
    }
    return res.json({ ok: true, verificados: resultado.verificados, detalhes: resultado.detalhes });
  } catch (err) {
    console.error("Erro rota verificarLotesPendentes:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
