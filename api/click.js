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

    if (!url) {
        return res.status(400).send("URL destino ausente");
    }

    const destino = decodeURIComponent(url);

    try {
        await db.collection("newsletters")
            .doc(newsletterId)
            .collection("envios")
            .doc(envioId)
            .collection("cliques")
            .add({
                destinatarioId,
                url: destino,
                clicadoEm: new Date(),
                userAgent: req.headers["user-agent"] || null,
                ip: req.socket.remoteAddress || null
            });
    } catch (e) {
        console.error("Erro ao registrar clique:", e);
    }

    res.redirect(destino);
}
