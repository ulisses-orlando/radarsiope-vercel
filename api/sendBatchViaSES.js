// api/sendBatchViaSES.js
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import admin from "firebase-admin";
import { createClient } from "@supabase/supabase-js";

// ─── Runtime: obrigatório para firebase-admin no Vercel ──────────────────────
export const config = { runtime: "nodejs" };

// ─── SES ─────────────────────────────────────────────────────────────────────
const sesClient = new SESClient({
  region: process.env.AWS_REGION || "sa-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// ─── Firebase Admin ───────────────────────────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, "\n"),
    }),
  });
}
const db = admin.firestore();

// ─── Supabase (service role — necessário para update via backend) ─────────────
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_KEY
);

// ─── Configurações ────────────────────────────────────────────────────────────
const SES_SOURCE = '"Radar SIOPE - Newsletter" <contato@radarsiope.com.br>';
const CHUNK_SIZE = 10; // envios paralelos por rodada

// ─── Envia um único e-mail via SES ────────────────────────────────────────────
async function enviarUmEmail(item) {
  const command = new SendEmailCommand({
    Source: SES_SOURCE,
    Destination: { ToAddresses: [item.email] },
    Message: {
      Subject: { Charset: "UTF-8", Data: item.assunto || "Radar SIOPE - Newsletter" },
      Body:    { Html: { Charset: "UTF-8", Data: item.mensagemHtml } },
    },
  });
  const resp = await sesClient.send(command);
  return resp.MessageId;
}

// ─── Atualiza o status do registro após resultado do SES ─────────────────────
// Para leads   → tabela leads_envios no Supabase (campo id é bigint)
// Para usuarios → subcoleção envios no Firestore
async function atualizarStatusDestinatario(item, ok, erroMsg, agora) {
  const { envioId: registroId, destinatarioId, tipo, assinaturaId } = item;
  const status = ok ? "enviado" : "erro";

  if (tipo === "leads") {
    const { error } = await supabase
      .from("leads_envios")
      .update({
        status,
        updated_at: agora.toDate().toISOString(),
      })
      .eq("id", parseInt(registroId, 10));

    if (error) {
      console.warn(`⚠️ Supabase update falhou para lead ${destinatarioId}:`, error.message);
    }
  } else {
    // assinantes → Firestore
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

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "https://radarsiope-vercel.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método não permitido" });
  }

  const { newsletterId, envioId, loteId, emails, operador = "Sistema" } = req.body || {};

  if (!newsletterId || !envioId || !loteId || !Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({
      ok: false,
      error: "Payload inválido: newsletterId, envioId, loteId e emails[] são obrigatórios",
    });
  }

  const agora = admin.firestore.Timestamp.now();
  const resultados = [];

  // ─── Envia em chunks paralelos ─────────────────────────────────────────────
  for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
    const chunk = emails.slice(i, i + CHUNK_SIZE);

    const settled = await Promise.allSettled(
      chunk.map(async (item) => {
        try {
          const messageId = await enviarUmEmail(item);
          await atualizarStatusDestinatario(item, true, null, agora);
          return {
            envioId: item.envioId,
            destinatarioId: item.destinatarioId,
            tipo: item.tipo,
            ok: true,
            messageId,
          };
        } catch (err) {
          const erroMsg = err.message || String(err);
          console.error(`❌ SES falhou para ${item.email}:`, erroMsg);
          // tenta atualizar status de erro — sem lançar se falhar
          await atualizarStatusDestinatario(item, false, erroMsg, agora).catch(() => {});
          return {
            envioId: item.envioId,
            destinatarioId: item.destinatarioId,
            tipo: item.tipo,
            ok: false,
            error: erroMsg,
          };
        }
      })
    );

    // Promise.allSettled nunca rejeita — o estado "rejected" seria erro interno não capturado
    settled.forEach((s) => {
      resultados.push(
        s.status === "fulfilled"
          ? s.value
          : { ok: false, error: s.reason?.message || "Erro desconhecido" }
      );
    });
  }

  // ─── Totais ────────────────────────────────────────────────────────────────
  const totalEnviados = resultados.filter((r) => r.ok).length;
  const statusLote =
    totalEnviados === emails.length ? "completo" :
    totalEnviados > 0              ? "parcial"   : "erro";

  // ─── Atualiza lote no Firestore ────────────────────────────────────────────
  const loteRef = db
    .collection("newsletters").doc(newsletterId)
    .collection("envios").doc(envioId)
    .collection("lotes").doc(loteId);

  const batch = db.batch();

  batch.set(loteRef, {
    enviados: totalEnviados,
    status: statusLote,
    data_envio: agora,
  }, { merge: true });

  // envios_log dentro do lote
  batch.set(loteRef.collection("envios_log").doc(), {
    data_envio: agora,
    quantidade: emails.length,
    enviados: totalEnviados,
    origem: "bulk",
    operador,
    status: statusLote,
  });

  await batch.commit();

  // ─── Atualiza lotes_gerais ─────────────────────────────────────────────────
  try {
    const loteGeralSnap = await db
      .collection("lotes_gerais")
      .where("loteId", "==", loteId)
      .where("envioId", "==", envioId)
      .limit(1)
      .get();

    if (!loteGeralSnap.empty) {
      await loteGeralSnap.docs[0].ref.update({
        enviados: totalEnviados,
        status: statusLote,
        data_envio: agora,
      });
    }
  } catch (err) {
    console.warn("⚠️ Falha ao atualizar lotes_gerais:", err.message);
  }

  // ─── Marca newsletter como enviada ────────────────────────────────────────
  try {
    await db.collection("newsletters").doc(newsletterId).update({
      enviada: true,
      data_publicacao: agora,
    });
  } catch (err) {
    console.warn("⚠️ Falha ao atualizar newsletter:", err.message);
  }

  return res.status(200).json({
    ok: true,
    enviados: totalEnviados,
    total: emails.length,
    status: statusLote,
    resultados,
  });
}
