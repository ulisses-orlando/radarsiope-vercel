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
  const { envioId, destinatarioId, newsletterId, url } = req.query;

  if (!envioId || !destinatarioId || !newsletterId || !url) {
    return res.status(400).send("Parâmetros inválidos");
  }

  // 🔹 Decodificação dupla para lidar com reescrita do SES
  let destino = decodeURIComponent(url);
  try {
    destino = decodeURIComponent(destino);
  } catch {}

  // 🔹 Normalização: garantir http/https
  if (!destino.startsWith("http://") && !destino.startsWith("https://")) {
    destino = "https://" + destino;
  }

  console.log("Redirecionando para:", destino);

  const ua = req.headers["user-agent"] || "";

  try {
    const envioRef = db.collection("newsletters")
      .doc(newsletterId)
      .collection("envios")
      .doc(envioId);

    // 🔹 Registrar clique em subcoleção "cliques" (log detalhado)
    await envioRef.collection("cliques").add({
      destinatarioId,
      url: destino,
      clicadoEm: new Date(),
      userAgent: ua,
      ip: req.socket.remoteAddress || null,
      tipoEvento: "clique"
    });

    // 🔹 Incrementar contador agregado no documento de envio
    await envioRef.set({
      totalCliques: admin.firestore.FieldValue.increment(1),
      ultimoCliqueEm: new Date()
    }, { merge: true });

  } catch (e) {
    console.error("Erro ao registrar clique:", e);
    // Mesmo se falhar o log, tenta redirecionar para não quebrar UX
  }

  return res.redirect(destino);
}
