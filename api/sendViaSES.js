import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const sesClient = new SESClient({
  region: process.env.AWS_REGION || "sa-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método não permitido" });
  }

  const { email, nome, mensagemHtml, assunto } = req.body;

  if (!email || !mensagemHtml) {
    return res.status(400).json({ ok: false, error: "Campos obrigatórios: email e mensagemHtml" });
  }

  const params = {
    Source: "contato@radarsiope.com.br",
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Charset: "UTF-8", Data: assunto || "Radar SIOPE - Newsletter" },
      Body: { Html: { Charset: "UTF-8", Data: mensagemHtml } }
    }
  };

  try {
    const command = new SendEmailCommand(params);
    const result = await sesClient.send(command);

    console.log("✅ SES envio bem-sucedido:", result);

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("❌ Erro SES:", err);

    return res.status(500).json({
      ok: false,
      error: err.message,
      code: err.name,
      details: err
    });
  }
}
