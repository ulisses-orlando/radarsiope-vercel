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
  const { envioId, destinatarioId, newsletterId } = req.query;

  const imgBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wIAAgMBAp9nXQAAAABJRU5ErkJggg==",
    "base64"
  );

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

  try {
    await db.collection("newsletters")
      .doc(newsletterId)
      .collection("envios")
      .doc(envioId)
      .collection("aberturas")
      .add({
        destinatarioId,
        abertoEm: new Date(),
        userAgent: req.headers["user-agent"] || null,
        ip: req.socket.remoteAddress || null
      });
  } catch (e) {
    console.error("Erro ao registrar abertura:", e);
  }

  res.status(200).send(imgBuffer);
}
