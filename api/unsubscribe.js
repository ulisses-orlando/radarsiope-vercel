// pages/api/unsubscribe.js
// Processa descadastramento de newsletter.
// Leads → Supabase (tabela leads)
// Newsletter (contador) → Firestore
import admin from "firebase-admin";
import { createClient } from "@supabase/supabase-js";

// ─── Firebase Admin (apenas para atualizar contador na newsletter) ────────────
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

// ─── Supabase (service role — necessário para UPDATE) ─────────────────────────
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Método não permitido");
  }

  const { email, newsletterId, motivo } = req.body;

  if (!email || !newsletterId) {
    return res.status(400).send("Dados incompletos.");
  }

  try {
    // ── 1. Busca o lead pelo e-mail no Supabase ────────────────────────────────
    const { data: leads, error: errBusca } = await supabase
      .from("leads")
      .select("id")
      .ilike("email", email.trim())
      .limit(1);

    if (errBusca) {
      console.error("Erro ao buscar lead no Supabase:", errBusca.message);
      return res.status(500).send("❌ Erro interno no servidor.");
    }

    if (!leads || leads.length === 0) {
      return res.status(404).send("Lead não encontrado.");
    }

    const leadId = leads[0].id;

    // ── 2. Atualiza o lead no Supabase ────────────────────────────────────────
    const { error: errUpdate } = await supabase
      .from("leads")
      .update({
        receber_newsletter: false,
        status:             "Descartado",
        descadastrado_em:   new Date().toISOString(),
        motivo_descadastro: motivo || null,
      })
      .eq("id", leadId);

    if (errUpdate) {
      console.error("Erro ao atualizar lead no Supabase:", errUpdate.message);
      return res.status(500).send("❌ Erro interno no servidor.");
    }

    // ── 3. Atualiza contador de descadastramentos na newsletter (Firestore) ────
    try {
      await db.collection("newsletters").doc(newsletterId).set({
        totalDescadastramentos: admin.firestore.FieldValue.increment(1),
        ultimaSaidaEm:          new Date(),
      }, { merge: true });
    } catch (errNl) {
      // Não fatal — o descadastramento já foi gravado
      console.warn("Falha ao atualizar contador na newsletter:", errNl.message);
    }

    return res.status(200).send("✅ Você foi descadastrado com sucesso.");

  } catch (err) {
    console.error("Erro no descadastramento:", err);
    return res.status(500).send("❌ Erro interno no servidor.");
  }
}
