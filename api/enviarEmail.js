const nodemailer = require("nodemailer");

export default async function handler(req, res) {
  // ✅ Cabeçalhos CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Responder pré-requisição OPTIONS
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { nome, email, mensagemHtml } = req.body;

  const transporter = nodemailer.createTransport({
    host: "smtp.zoho.com",
    port: 465,
    secure: true,
    auth: {
      user: "contato@radarsiope.com.br",
      pass: "BJLPjYxtpD8A"
    }
  });

  const mailOptions = {
    from: "Radar SIOPE <contato@radarsiope.com.br>",
    to: email,
    subject: "Obrigado pelo seu interesse!",
    html: mensagemHtml
  };

  try {
    await transporter.sendMail(mailOptions);
    res.status(200).send("E-mail enviado com sucesso!");
  } catch (error) {
    console.error("❌ Erro ao enviar:", error);
    res.status(500).send("Erro ao enviar e-mail.");
  }
}
