import express from "express";
import bodyParser from "body-parser";
import handler from "./sendViaSES.js";

const app = express();
app.use(bodyParser.json());

// Rota para enviar via SES
app.post("/api/sendViaSES", handler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
