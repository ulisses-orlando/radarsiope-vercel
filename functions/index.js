const functions = require("firebase-functions");
const nodemailer = require("nodemailer");

// Configuração do Zoho SMTP
const transporter = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465,
  secure: true,
  auth: {
    user: "contato@radarsiope.com.br", // seu e-mail Zoho
    pass: "BJLPjYxtpD8A" // senha de aplicativo gerada no Zoho
  }
});

// Função HTTPS para envio de e-mail
exports.enviarEmailLead = functions.https.onRequest(async (req, res) => {
  const { nome, email, mensagemHtml } = req.body;

  const mailOptions = {
    from: "Radar SIOPE <contato@radarsiope.com.br>",
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
});
