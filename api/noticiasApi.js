import admin from "firebase-admin";

if (!admin.apps.length) {

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, '\n')
      })
    });
  } catch (err) {
    console.error("❌ Erro ao inicializar Firebase Admin:", err);
  }
}

const db = admin.firestore();

export default async function handler(req, res) {

  try {

    const snap = await db.collection("temas_noticias")
      .where("ativo", "==", true)
      .orderBy("prioridade")
      .get();

    const lista = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json(lista);
  } catch (err) {
    console.error("❌ Erro na API noticiasApi:", err);
    res.status(500).json({ erro: "Erro ao carregar notícias" });
  }
}
