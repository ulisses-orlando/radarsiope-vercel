// pages/api/newsletterTitulo.js
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
}
const db = admin.firestore();

export default async function handler(req, res) {
  const { id } = req.query;

  try {
    const doc = await db.collection("newsletters").doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Newsletter não encontrada" });
    }

    const data = doc.data();
    console.log("Newsletter data:", data); // 🔹 log no Vercel
    return res.status(200).json(data); // 🔹 retorna tudo para inspecionar
  } catch (err) {
    console.error("Erro:", err);
    return res.status(500).json({ error: "Erro interno", detalhe: err.message });
  }
}
