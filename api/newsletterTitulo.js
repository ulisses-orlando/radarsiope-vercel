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

  if (!id) {
    return res.status(400).json({ error: "ID da newsletter não informado" });
  }

  try {
    const doc = await db.collection("newsletters").doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Newsletter não encontrada" });
    }

    const data = doc.data();

    // 🔹 Converte para JSON seguro (stringify + parse)
    const safeData = JSON.parse(JSON.stringify(data));

    // 🔹 Log nos deployments do Vercel
    console.log("Newsletter data:", safeData);

    // 🔹 Retorna todos os campos para inspeção
    return res.status(200).json(safeData);
  } catch (err) {
    console.error("Erro ao buscar newsletter:", err);
    return res.status(500).json({ error: "Erro interno", detalhe: err.message });
  }
}
