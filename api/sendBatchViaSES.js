// api/sendBatchViaSES.js
//
// Responsabilidades:
//   • Valida autenticação (x-admin-token)                          fix B1
//   • Aceita CORS de múltiplas origens                            fix B2
//   • Carrega a newsletter do Firestore e monta o HTML por        fix C2
//     destinatário (placeholders + rastreamento) — o frontend
//     envia apenas metadados, não HTML
//   • Envia via SES em chunks paralelos de CHUNK_SIZE
//   • Atualiza status por destinatário (Supabase / Firestore)
//   • Atualiza lote + lotes_gerais + log
//   • NÃO altera data_publicacao da newsletter                     fix B4
//   • Marca enviada:true somente quando TODOS os lotes completam  fix B5
// ─────────────────────────────────────────────────────────────────────────────

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import admin from "firebase-admin";
import { createClient } from "@supabase/supabase-js";

// ─── Runtime ─────────────────────────────────────────────────────────────────
export const config = { runtime: "nodejs" };

// ─── SES ─────────────────────────────────────────────────────────────────────
const sesClient = new SESClient({
  region: process.env.AWS_REGION || "sa-east-1",
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// ─── Firebase Admin ───────────────────────────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, "\n"),
    }),
  });
}
const db = admin.firestore();

// ─── Supabase (service role) ──────────────────────────────────────────────────
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_KEY
);

// ─── Configurações ────────────────────────────────────────────────────────────
const SES_SOURCE  = '"Radar SIOPE - Newsletter" <contato@radarsiope.com.br>';
const CHUNK_SIZE  = 10;   // envios paralelos por rodada
const SES_TIMEOUT = 8000; // ms — fix B6: evita travar o handler

// fix B2: origens permitidas para CORS
const ALLOWED_ORIGINS = [
  "https://radarsiope-vercel.vercel.app",
  "https://app.radarsiope.com.br",
  "https://admin.radarsiope.com.br",
  ...(process.env.ALLOWED_ORIGIN ? [process.env.ALLOWED_ORIGIN] : []),
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _esc(s) {
  return String(s || "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

// Substitui {{placeholders}} no template HTML
function aplicarPlaceholders(template, dados) {
  if (!template) return "";
  const fmt = (v) => (v == null ? "" : String(v));
  const dataFormatada = dados.data_publicacao
    ? (() => {
        const d = dados.data_publicacao.toDate
          ? dados.data_publicacao.toDate()
          : new Date(dados.data_publicacao);
        return d.toLocaleDateString("pt-BR");
      })()
    : "";

  return template
    .replace(/{{nome}}/gi,            _esc(fmt(dados.nome)))
    .replace(/{{email}}/gi,           _esc(fmt(dados.email)))
    .replace(/{{edicao}}/gi,          _esc(fmt(dados.edicao)))
    .replace(/{{titulo}}/gi,          _esc(fmt(dados.titulo)))
    .replace(/{{data_publicacao}}/gi, dataFormatada)
    .replace(/{{uf}}/gi,              _esc(fmt(dados.cod_uf)))
    .replace(/{{municipio}}/gi,       _esc(fmt(dados.nome_municipio)))
    .replace(/{{cargo}}/gi,           _esc(fmt(dados.perfil)))
    .replace(/{{plano}}/gi,           _esc(fmt(dados.plano)))
    .replace(/{{token}}/gi,           fmt(dados.token_acesso));
}

// Monta o HTML final da newsletter para um destinatário
// (equivalente backend de montarHtmlNewsletterParaEnvio + aplicarRastreamento)
function montarHtml(newsletter, dadosDestinatario, segmento, registroEnvioId, newsletterId, assinaturaId, token) {
  // ── Blocos filtrados por segmento e destino ───────────────────────────────
  const htmlBase  = newsletter.html_conteudo || newsletter.conteudo_html_completo || "";
  const blocos    = newsletter.blocos || [];
  let htmlBlocos  = "";

  blocos.forEach((b) => {
    if (segmento && b.acesso !== "todos" && b.acesso !== segmento) return;
    if (b.destino === "app") return; // blocos exclusivos do app não vão no e-mail
    htmlBlocos += b.html || "";
  });

  let htmlFinal;
  if (blocos.length === 0) {
    htmlFinal = htmlBase.replace(/\{\{blocos\}\}/g, "");
  } else if (htmlBase.includes("{{blocos}}")) {
    htmlFinal = htmlBase.replace(/\{\{blocos\}\}/g, htmlBlocos || "");
  } else {
    htmlFinal = htmlBase + "\n" + htmlBlocos;
  }

  // ── Placeholders do destinatário ──────────────────────────────────────────
  htmlFinal = aplicarPlaceholders(htmlFinal, {
    ...dadosDestinatario,
    edicao:          newsletter.edicao          || newsletter.numero || "",
    titulo:          newsletter.titulo          || "",
    data_publicacao: newsletter.data_publicacao || null,
    token_acesso:    token,
  });

  // ── Pixel de abertura ─────────────────────────────────────────────────────
  const pixelUrl = `https://api.radarsiope.com.br/api/pixel` +
    `?envioId=${encodeURIComponent(registroEnvioId)}` +
    `&destinatarioId=${encodeURIComponent(dadosDestinatario.id || "")}` +
    `&newsletterId=${encodeURIComponent(newsletterId)}`;
  htmlFinal += `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />`;

  // ── Link de visualização no app (ofuscado em Base64) ─────────────────────
  const parts = [
    `nid=${newsletterId}`,
    `env=${registroEnvioId}`,
    `uid=${dadosDestinatario.id || ""}`,
  ];
  if (assinaturaId) parts.push(`assinaturaId=${assinaturaId}`);
  if (token)        parts.push(`token=${token}`);
  const b64    = Buffer.from(parts.join("&")).toString("base64");
  const linkApp = `https://app.radarsiope.com.br/verNewsletterComToken.html?d=${encodeURIComponent(b64)}`;

  htmlFinal = htmlFinal.replace(
    /href="([^"]*verNewsletterComToken\.html[^"]*)"/i,
    () => `href="${linkApp}"`
  );

  // ── Rastreamento de cliques nos demais links ──────────────────────────────
  htmlFinal = htmlFinal.replace(/href="([^"]+)"/g, (m, href) => {
    const u = String(href).trim();
    if (
      /^(mailto:|tel:|javascript:|#)/i.test(u) ||
      /descadastramento\.html/i.test(u) ||
      /vernewslettercomtoken\.html/i.test(u) ||
      /\/api\/click/i.test(u) ||
      /\/api\/pixel/i.test(u)
    ) return m;

    let destino = u;
    try { destino = decodeURIComponent(u); } catch (e) { /* mantém */ }

    const track = `https://api.radarsiope.com.br/api/click` +
      `?envioId=${encodeURIComponent(registroEnvioId)}` +
      `&destinatarioId=${encodeURIComponent(dadosDestinatario.id || "")}` +
      `&newsletterId=${encodeURIComponent(newsletterId)}` +
      `&url=${encodeURIComponent(destino)}`;
    return `href="${track}"`;
  });

  return htmlFinal;
}

// ─── Envio de um e-mail via SES com timeout ───────────────────────────────────
// fix B6: AbortController garante que a promessa não trava indefinidamente
async function enviarUmEmail(item) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), SES_TIMEOUT);

  try {
    const command = new SendEmailCommand({
      Source:      SES_SOURCE,
      Destination: { ToAddresses: [item.email] },
      Message: {
        Subject: { Charset: "UTF-8", Data: item.assunto || "Radar SIOPE - Newsletter" },
        Body:    { Html: { Charset: "UTF-8", Data: item.mensagemHtml } },
      },
    });
    const resp = await sesClient.send(command, { abortSignal: controller.signal });
    return resp.MessageId;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Atualizar status do destinatário após envio ──────────────────────────────
async function atualizarStatusDestinatario(item, ok, erroMsg, agora) {
  const { envioId: registroId, destinatarioId, tipo, assinaturaId } = item;
  const status = ok ? "enviado" : "erro";

  if (tipo === "leads") {
    const { error } = await supabase
      .from("leads_envios")
      .update({ status, updated_at: agora.toDate().toISOString() })
      .eq("id", parseInt(registroId, 10));

    if (error) console.warn(`⚠️ Supabase update falhou para lead ${destinatarioId}:`, error.message);
  } else {
    try {
      await db
        .collection("usuarios").doc(destinatarioId)
        .collection("assinaturas").doc(assinaturaId)
        .collection("envios").doc(registroId)
        .set({ status, erro: erroMsg || null }, { merge: true });
    } catch (err) {
      console.warn(`⚠️ Firestore update falhou para usuario ${destinatarioId}:`, err.message);
    }
  }
}

// ─── Verificar se todos os lotes do envio estão completos ou parciais ─────────
// fix B5: só marca enviada:true quando não há mais lotes pendentes
async function verificarEMarcarNewsletterEnviada(newsletterId, envioId) {
  try {
    const lotesSnap = await db
      .collection("newsletters").doc(newsletterId)
      .collection("envios").doc(envioId)
      .collection("lotes")
      .get();

    const lotes     = lotesSnap.docs.map((d) => d.data());
    const pendentes = lotes.filter((l) => l.status === "pendente");

    if (pendentes.length > 0) {
      // Ainda há lotes não enviados — não marca como enviada ainda
      return;
    }

    // Todos os lotes foram processados
    await db.collection("newsletters").doc(newsletterId).update({
      enviada: true,
      // fix B4: data_publicacao NÃO é alterada aqui
    });
  } catch (err) {
    console.warn("⚠️ Falha ao verificar/marcar newsletter como enviada:", err.message);
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // fix B2: CORS dinâmico para múltiplas origens
  const origem = req.headers.origin || "";
  const origemPermitida = ALLOWED_ORIGINS.includes(origem) ? origem : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin",  origemPermitida);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ ok: false, error: "Método não permitido" });

  // fix B1: autenticação obrigatória
  const adminToken = req.headers["x-admin-token"];
  if (!adminToken || adminToken !== process.env.ADMIN_API_TOKEN) {
    return res.status(401).json({ ok: false, error: "Não autorizado." });
  }

  const { newsletterId, envioId, loteId, emails, operador = "Sistema" } = req.body || {};

  if (!newsletterId || !envioId || !loteId || !Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({
      ok: false,
      error: "Payload inválido: newsletterId, envioId, loteId e emails[] são obrigatórios.",
    });
  }

  // fix C2: carrega a newsletter uma vez — backend monta o HTML
  const newsletterSnap = await db.collection("newsletters").doc(newsletterId).get();
  if (!newsletterSnap.exists) {
    return res.status(404).json({ ok: false, error: "Newsletter não encontrada." });
  }
  const newsletter = newsletterSnap.data();

  const agora      = admin.firestore.Timestamp.now();
  const resultados = [];

  // ─── Envia em chunks paralelos ────────────────────────────────────────────
  for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
    const chunk = emails.slice(i, i + CHUNK_SIZE);

    const settled = await Promise.allSettled(
      chunk.map(async (item) => {
        const {
          envioId:        registroEnvioId,
          destinatarioId, tipo, assinaturaId,
          email, nome, token,
        } = item;

        // fix C2: monta o HTML aqui no backend com dados do destinatário
        const segmento     = tipo === "leads" ? "leads" : "assinantes";
        const dadosDest    = { id: destinatarioId, nome, email };
        const mensagemHtml = montarHtml(
          newsletter,
          dadosDest,
          segmento,
          registroEnvioId,
          newsletterId,
          assinaturaId || null,
          token
        );

        const itemComHtml = { ...item, mensagemHtml };

        try {
          const messageId = await enviarUmEmail(itemComHtml);
          await atualizarStatusDestinatario(itemComHtml, true, null, agora);
          return { envioId: registroEnvioId, destinatarioId, tipo, ok: true, messageId };
        } catch (err) {
          const erroMsg = err.name === "AbortError"
            ? `Timeout SES (>${SES_TIMEOUT}ms) para ${email}`
            : (err.message || String(err));
          console.error(`❌ SES falhou para ${email}:`, erroMsg);
          await atualizarStatusDestinatario(itemComHtml, false, erroMsg, agora).catch(() => {});
          return { envioId: registroEnvioId, destinatarioId, tipo, ok: false, error: erroMsg };
        }
      })
    );

    settled.forEach((s) => {
      resultados.push(
        s.status === "fulfilled"
          ? s.value
          : { ok: false, error: s.reason?.message || "Erro interno não capturado" }
      );
    });
  }

  // ─── Totais ───────────────────────────────────────────────────────────────
  const totalEnviados = resultados.filter((r) => r.ok).length;
  const statusLote    =
    totalEnviados === emails.length ? "completo" :
    totalEnviados > 0              ? "parcial"  : "erro";

  // ─── Atualiza lote + log no Firestore ─────────────────────────────────────
  const loteRef = db
    .collection("newsletters").doc(newsletterId)
    .collection("envios").doc(envioId)
    .collection("lotes").doc(loteId);

  const batch = db.batch();

  batch.set(loteRef, {
    enviados:   totalEnviados,
    status:     statusLote,
    data_envio: agora,
  }, { merge: true });

  // fix B7: log não inclui mensagemHtml — só metadados
  batch.set(loteRef.collection("envios_log").doc(), {
    data_envio: agora,
    quantidade: emails.length,
    enviados:   totalEnviados,
    erros:      emails.length - totalEnviados,
    origem:     "bulk",
    operador,
    status:     statusLote,
  });

  await batch.commit();

  // ─── Atualiza lotes_gerais ─────────────────────────────────────────────────
  try {
    const loteGeralSnap = await db
      .collection("lotes_gerais")
      .where("loteId",  "==", loteId)
      .where("envioId", "==", envioId)
      .limit(1)
      .get();

    if (!loteGeralSnap.empty) {
      await loteGeralSnap.docs[0].ref.update({
        enviados:   totalEnviados,
        status:     statusLote,
        data_envio: agora,
      });
    }
  } catch (err) {
    console.warn("⚠️ Falha ao atualizar lotes_gerais:", err.message);
  }

  // ─── Marca newsletter como enviada somente quando todos os lotes terminam ─
  // fix B4: data_publicacao NÃO é alterada
  // fix B5: verifica se ainda há lotes pendentes antes de marcar
  await verificarEMarcarNewsletterEnviada(newsletterId, envioId);

  // fix B7: resultados retornados sem mensagemHtml (evita response body enorme)
  const resultadosLimpos = resultados.map(({ mensagemHtml: _, ...r }) => r);

  return res.status(200).json({
    ok:        true,
    enviados:  totalEnviados,
    total:     emails.length,
    status:    statusLote,
    resultados: resultadosLimpos,
  });
}
