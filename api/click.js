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
  const { envioId, destinatarioId, newsletterId } = req.query;

  // 🔹 Validação de parâmetros obrigatórios
  if (!envioId || !destinatarioId || !newsletterId) {
    return res.status(400).send("Parâmetros inválidos");
  }

  try {
    const aberturasRef = db.collection("newsletters")
      .doc(newsletterId)
      .collection("envios")
      .doc(envioId)
      .collection("aberturas");

    // 🔹 Verifica se já existe abertura para esse destinatário
    const existente = await aberturasRef
      .where("destinatarioId", "==", destinatarioId)
      .limit(1)
      .get();

    if (existente.empty) {
      // Primeiro registro de abertura
      await aberturasRef.add({
        destinatarioId,
        abertoEm: new Date(),
        vezes: 1,
        userAgent: req.headers["user-agent"] || null,
        ip: req.socket.remoteAddress || null
      });
      console.log("✅ Abertura registrada para", destinatarioId);
    } else {
      // Já existe: incrementa contador
      const docRef = existente.docs[0].ref;
      const dados = existente.docs[0].data();
      const vezesAtual = dados.vezes || 1;

      await docRef.update({
        vezes: vezesAtual + 1,
        ultimoAcesso: new Date(),
        userAgent: req.headers["user-agent"] || null,
        ip: req.socket.remoteAddress || null
      });
      console.log("ℹ️ Abertura incrementada para", destinatarioId);
    }
  } catch (e) {
    console.error("Erro ao registrar abertura:", e);
  }

  // 🔹 Retorna pixel transparente (GIF 1x1)
  res.setHeader("Content-Type", "image/gif");
  res.send(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
}
