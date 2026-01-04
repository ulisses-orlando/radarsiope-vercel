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

/*   // Decodificação dupla para lidar com SES
  let destino = decodeURIComponent(url);
  try {
    destino = decodeURIComponent(destino);
  } catch {}

  // Normalização: garantir http/https
  if (!destino.startsWith("http://") && !destino.startsWith("https://")) {
    destino = "https://" + destino;
  }

  console.log("Redirecionando para:", destino);
 */
  const ua = req.headers["user-agent"] || "";

  try {
    const envioRef = db.collection("newsletters")
      .doc(newsletterId)
      .collection("envios")
      .doc(envioId);

    // Documento fixo por destinatário
    const cliqueRef = envioRef.collection("cliques").doc(destinatarioId);
    const snap = await cliqueRef.get();

    if (!snap.exists) {
      // Primeiro clique → vezes = 1
      await cliqueRef.set({
        destinatarioId,
        // url: destino,
        clicadoEm: new Date(),
        vezes: 1,
        userAgent: ua,
        ip: req.socket.remoteAddress || null,
        tipoEvento: "clique"
      });
    } else {
      // Atualização → incrementa +1
      const dados = snap.data();
      const vezesAtual = dados.vezes || 1;

      await cliqueRef.update({
        vezes: vezesAtual + 1,
        ultimoCliqueEm: new Date(),
        // url: destino,
        userAgent: ua,
        ip: req.socket.remoteAddress || null
      });
    }

    // Incrementar contador agregado no documento de envio
    await envioRef.set({
      totalCliques: admin.firestore.FieldValue.increment(1),
      ultimoCliqueEm: new Date()
    }, { merge: true });

  } catch (e) { 
    console.error("Erro ao registrar clique:", e); 
    // Retornamos erro sem redirecionar 
    return res.status(500).json({ ok: false, message: "Erro ao registrar clique" }); 
  }
  return res.redirect(destino);
}

