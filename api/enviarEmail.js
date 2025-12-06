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

  // 🔹 Configuração do transporte usando variáveis de ambiente
  const transporter = nodemailer.createTransport({
    host: "smtp.zoho.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.ZOHO_USER,   // definido no Vercel
      pass: process.env.ZOHO_PASS    // definido no Vercel
    }
  });

  const mailOptions = {
    from: `Radar SIOPE <${process.env.ZOHO_USER}>`,
    to: email,
    subject: "Obrigado pelo seu interesse!",
    html: mensagemHtml
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("✅ E-mail enviado para:", email);
    res.status(200).send("E-mail enviado com sucesso!");
  } catch (error) {
    console.error("❌ Erro ao enviar:", error);
    res.status(500).send("Erro ao enviar e-mail.");
  }
}
