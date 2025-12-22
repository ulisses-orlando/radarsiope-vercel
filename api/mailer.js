// =======================
// Funções de envio de e-mail (backend)
// =======================

const nodemailer = require("nodemailer");

// Configuração do transporte SMTP usando Zoho
const transporter = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465,
  secure: true, // true para 465, false para outras portas
  auth: {
    user: "contato@radarsiope.com.br", // seu e-mail Zoho
    pass: "SUA_SENHA_DE_APP"           // senha de aplicativo gerada no Zoho
  }
});

/**
 * Valida formato de e-mail
 * @param {string} email
 * @returns {boolean}
 */
function validarEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Valida formato de telefone (ex: (61) 99999-9999)
 * @param {string} telefone
 * @returns {boolean}
 */
function validarTelefoneFormato(telefone) {
  const telefoneRegex = /^\(\d{2}\)\s?\d{4,5}-\d{4}$/;
  return telefoneRegex.test(telefone);
}

/**
 * Envia e-mail para lead
 * @param {Object} data
 * @param {string} data.nome - Nome do destinatário
 * @param {string} data.email - E-mail do destinatário
 * @param {string} data.mensagemHtml - Conteúdo HTML do e-mail
 */
async function enviarEmailLead(data) {
  const { nome, email, mensagemHtml } = data;

  if (!validarEmail(email)) {
    throw new Error("E-mail inválido: " + email);
  }

  const mailOptions = {
    from: "Radar SIOPE <contato@radarsiope.com.br>",
    to: email,
    subject: "Obrigado pelo seu interesse!",
    html: mensagemHtml
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ E-mail enviado:", info.messageId);
    return info;
  } catch (error) {
    console.error("❌ Erro ao enviar e-mail:", error);
    throw error;
  }
}

// Exporta funções para uso em outros módulos
module.exports = {
  enviarEmailLead,
  validarEmail,
  validarTelefoneFormato
};
