// pages/api/unsubscribe.js
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, '\n')
    })
  });
}
const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Método não permitido");
  }

  const { email, newsletterId, motivo } = req.body;

  if (!email || !newsletterId) {
    return res.status(400).send("Dados incompletos.");
  }

  try {
    // 🔹 Busca lead pelo email
    const snap = await db.collection("leads").where("email", "==", email).limit(1).get();
    if (snap.empty) {
      return res.status(404).send("Lead não encontrado.");
    }

    const leadRef = snap.docs[0].ref;

    // 🔹 Atualiza status do lead
    await leadRef.update({
      receber_newsletter: false,
      status: "Descartado"
    });

    // 🔹 Log de descadastramento
    await leadRef.collection("descadastramentos").add({
      newsletter_id: newsletterId,
      motivo: motivo || null,
      data: admin.firestore.Timestamp.now()
    });

    // 🔹 Também registra no documento da newsletter/envio (agregado)
    const newsletterRef = db.collection("newsletters").doc(newsletterId);
    await newsletterRef.set({
      totalDescadastramentos: admin.firestore.FieldValue.increment(1),
      ultimaSaidaEm: new Date()
    }, { merge: true });

    return res.status(200).send("✅ Você foi descadastrado com sucesso.");
  } catch (err) {
    console.error("Erro no descadastramento:", err);
    return res.status(500).send("❌ Erro interno no servidor.");
  }
}
