// backend/sendBatchViaSES.js
import express from "express";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import admin from "firebase-admin";

const router = express.Router();

// Inicializa SES
const ses = new SESClient({
  region: process.env.AWS_REGION || "us-east-1"
});

// Inicializa Firestore Admin (use credenciais do ambiente / service account)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}
const db = admin.firestore();

router.post("/api/sendBatchViaSES", async (req, res) => {
  try {
    const { newsletterId, envioId, loteId, emails } = req.body;
    if (!emails || !Array.isArray(emails)) {
      return res.status(400).json({ ok: false, error: "Payload inválido: emails esperado" });
    }

    const results = [];
    const RATE_LIMIT = Number(process.env.SES_RATE_LIMIT || 14); // e-mails por segundo
    let batch = [];

    // Função que envia um e-mail e grava sesMessageId com fallback
    async function sendEmail(e) {
      try {
        const params = {
          Destination: { ToAddresses: [e.email] },
          Message: {
            Body: { Html: { Charset: "UTF-8", Data: e.mensagemHtml } },
            Subject: { Charset: "UTF-8", Data: e.assunto }
          },
          Source: process.env.SES_SOURCE_EMAIL
        };

        // envia e captura resposta do SES
        const resp = await ses.send(new SendEmailCommand(params));
        const sesMessageId = resp?.MessageId || null;

        // 1) grava no caminho do lote (envios_log) — usa set merge para não sobrescrever
        if (sesMessageId && newsletterId && envioId && loteId && e.envioId) {
          try {
            const loteEnvioDocPath = `newsletters/${newsletterId}/envios/${envioId}/lotes/${loteId}/envios_log/${e.envioId}`;
            await db.doc(loteEnvioDocPath).set({ sesMessageId }, { merge: true });
          } catch (err) {
            console.warn("Não conseguiu gravar sesMessageId no lote:", err.message);
          }
        }

        // 2) grava no documento original do envio (fallbacks) se tiver destinatarioId
        if (sesMessageId && e.destinatarioId) {
          const destId = e.destinatarioId;

          // tentativa 1: leads/{id}/envios/{envioDoc}
          try {
            const leadsPath = `leads/${destId}/envios/${e.envioId}`;
            await db.doc(leadsPath).set({ sesMessageId }, { merge: true });
          } catch (err) {
            console.warn(`Falha ao gravar em leads/${destId}/envios/${e.envioId}:`, err.message);

            // tentativa 2: usuarios/{id}/assinaturas/{assinaturaId}/envios/{envioDoc}
            if (e.assinaturaId) {
              try {
                const usuariosPath = `usuarios/${destId}/assinaturas/${e.assinaturaId}/envios/${e.envioId}`;
                await db.doc(usuariosPath).set({ sesMessageId }, { merge: true });
              } catch (err2) {
                console.warn(`Falha ao gravar em usuarios/${destId}/assinaturas/${e.assinaturaId}/envios/${e.envioId}:`, err2.message);
              }
            } else {
              // tentativa 3: collectionGroup('envios') por newsletter + destinatarioId
              try {
                const q = db.collectionGroup("envios")
                  .where("newsletter_id", "==", newsletterId)
                  .where("destinatarioId", "==", destId)
                  .limit(5);
                const snap = await q.get();
                if (!snap.empty) {
                  const ops = [];
                  snap.forEach(doc => ops.push(doc.ref.set({ sesMessageId }, { merge: true })));
                  await Promise.all(ops);
                } else {
                  console.warn("Fallback collectionGroup não encontrou envios para destinatarioId:", destId);
                }
              } catch (err3) {
                console.warn("Erro no fallback collectionGroup:", err3.message);
              }
            }
          }
        }

        // push resultado com messageId para rastreio
        results.push({ envioId: e.envioId, ok: true, messageId: sesMessageId });
      } catch (err) {
        console.error("Erro SES ao enviar para", e.email, err);
        results.push({ envioId: e.envioId, ok: false, error: err.message });
      }
    }

    // Envio em batches respeitando RATE_LIMIT
    for (const email of emails) {
      batch.push(email);

      if (batch.length >= RATE_LIMIT) {
        await Promise.all(batch.map(sendEmail));
        batch = [];
        // aguarda 1 segundo antes de continuar para respeitar taxa
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // envia o restante
    if (batch.length > 0) {
      await Promise.all(batch.map(sendEmail));
    }

    return res.json({ ok: true, results });
  } catch (err) {
    console.error("Erro geral em sendBatchViaSES:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
