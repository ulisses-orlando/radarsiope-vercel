import nodemailer from "nodemailer";

export default async function handler(req, res) {
  // ✅ CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { nome, email, assunto, mensagemHtml } = req.body;

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.zoho.com",
      port: 465,
      secure: true,
      auth: {
        user: "contato@radarsiope.com.br",
        pass: process.env.ZOHO_PASS
      }
    });

    await transporter.sendMail({
      from: "Radar SIOPE <contato@radarsiope.com.br>",
      to: email,
      subject: assunto,
      html: mensagemHtml
    });

    return res.status(200).send("E-mail enviado com sucesso!");
  } catch (error) {
    console.error("❌ Erro ao enviar:", error);
    return res.status(500).send("Erro ao enviar e-mail.");
  }
}
