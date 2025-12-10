export default async function handler(req, res) {
  const { envioId, destinatarioId, newsletterId } = req.query;

  if (!envioId || !destinatarioId || !newsletterId) {
    return res.status(400).send("Parâmetros inválidos");
  }

  const ua = req.headers["user-agent"] || "";

  // 🔹 Ignora chamadas vindas de servidor/backend
  if (ua.toLowerCase().includes("node") || ua.toLowerCase().includes("axios") || ua.toLowerCase().includes("fetch")) {
    console.log("Ignorando abertura disparada por backend:", ua);
    res.setHeader("Content-Type", "image/gif");
    return res.send(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
  }

  try {
    const aberturasRef = db.collection("newsletters")
      .doc(newsletterId)
      .collection("envios")
      .doc(envioId)
      .collection("aberturas");

    const existente = await aberturasRef
      .where("destinatarioId", "==", destinatarioId)
      .limit(1)
      .get();

    if (existente.empty) {
      await aberturasRef.add({
        destinatarioId,
        abertoEm: new Date(),
        vezes: 1,
        userAgent: ua,
        ip: req.socket.remoteAddress || null
      });
    } else {
      const docRef = existente.docs[0].ref;
      const dados = existente.docs[0].data();
      const vezesAtual = dados.vezes || 1;

      await docRef.update({
        vezes: vezesAtual + 1,
        ultimoAcesso: new Date(),
        userAgent: ua,
        ip: req.socket.remoteAddress || null
      });
    }
  } catch (e) {
    console.error("Erro ao registrar abertura:", e);
  }

  res.setHeader("Content-Type", "image/gif");
  res.send(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
}
