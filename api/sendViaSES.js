import AWS from "aws-sdk";

// Configuração do AWS SDK
AWS.config.update({
  region: process.env.AWS_REGION || "sa-east-1",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const ses = new AWS.SES();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método não permitido" });
  }

  const { email, nome, mensagemHtml, assunto } = req.body;

  if (!email || !mensagemHtml) {
    return res.status(400).json({ ok: false, error: "Campos obrigatórios: email e mensagemHtml" });
  }

  const params = {
    Source: "contato@radarsiope.com.br", // ⚠️ precisa ser verificado no SES
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Charset: "UTF-8", Data: assunto || "Radar SIOPE - Newsletter" },
      Body: { Html: { Charset: "UTF-8", Data: mensagemHtml } }
    }
  };

  try {
    const result = await ses.sendEmail(params).promise();
    console.log("✅ SES envio bem-sucedido:", result);
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("❌ Erro SES:", err);
    return res.status(500).json({
      ok: false,
      error: err.message,
      code: err.code,
      statusCode: err.statusCode,
      time: err.time,
      requestId: err.requestId,
      details: err
    });
  }
}
