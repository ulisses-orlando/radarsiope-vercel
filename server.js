import dotenv from "dotenv";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import handler from "./api/sendViaSES.js";
import admin from "firebase-admin";

// 🔹 Carrega variáveis de ambiente
dotenv.config({ path: ".env", debug: true });

console.log("AWS_REGION:", process.env.AWS_REGION);
console.log("AWS_ACCESS_KEY_ID:", process.env.AWS_ACCESS_KEY_ID ? "OK" : "MISSING");
console.log("AWS_SECRET_ACCESS_KEY:", process.env.AWS_SECRET_ACCESS_KEY ? "OK" : "MISSING");

const app = express();

// 🔹 habilita CORS para o Live Server
app.use(cors({
  origin: ["http://127.0.0.1:5500", "http://localhost:5500"]
}));

app.use(bodyParser.json());

// 🔹 inicializa Firebase Admin
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});
const db = admin.firestore();

// 🔹 rota para envio via SES
app.post("/api/sendViaSES", handler);

// 🔹 backend rodando na porta 4000
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});

// 🔹 rota do pixel de abertura
app.get("/pixel.png", async (req, res) => {
  const { envioId, destinatarioId, newsletterId } = req.query;

  const imgBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wIAAgMBAp9nXQAAAABJRU5ErkJggg==",
    "base64"
  );

  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

  try {
    await db.collection("newsletters")
      .doc(newsletterId)
      .collection("envios")
      .doc(envioId)
      .collection("aberturas")
      .add({
        destinatarioId,
        abertoEm: new Date(),
        userAgent: req.get("User-Agent") || null,
        ip: req.ip || null
      });
  } catch (e) {
    console.error("Erro ao registrar abertura:", e);
  }

  res.status(200).send(imgBuffer);
});

// 🔹 rota para rastrear cliques
app.get("/click", async (req, res) => {
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
        userAgent: req.get("User-Agent") || null,
        ip: req.ip || null
      });
  } catch (e) {
    console.error("Erro ao registrar clique:", e);
  }

  res.redirect(destino);
});
