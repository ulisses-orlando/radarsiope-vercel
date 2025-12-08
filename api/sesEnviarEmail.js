// api/sesEnviarEmail.js
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

// 🔑 Configure suas credenciais AWS via variáveis de ambiente:
// AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
// SES_SOURCE_EMAIL (remetente verificado no SES)
// SES_REPLYTO_EMAIL (opcional, e-mail para respostas)

const sesClient = new SESClient({ region: process.env.AWS_REGION });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido. Use POST." });
  }

  const { nome, email, mensagemHtml } = req.body;

  if (!email || !mensagemHtml) {
    return res.status(400).json({ error: "Campos obrigatórios: email e mensagemHtml." });
  }

  try {
    // 🔑 Monta o comando de envio
    const command = new SendEmailCommand({
      Destination: {
        ToAddresses: [email],
      },
      Message: {
        Body: {
          Html: {
            Charset: "UTF-8",
            Data: mensagemHtml,
          },
        },
        Subject: {
          Charset: "UTF-8",
          Data: `Newsletter - ${nome || "Assinante"}`,
        },
      },
      Source: process.env.SES_SOURCE_EMAIL, // remetente verificado no SES
      ReplyToAddresses: [
        process.env.SES_REPLYTO_EMAIL || process.env.SES_SOURCE_EMAIL,
      ],
    });

    // 🔑 Executa envio
    const response = await sesClient.send(command);

    return res.status(200).json({
      success: true,
      messageId: response.MessageId,
      to: email,
    });
  } catch (err) {
    console.error("❌ Erro SES:", err.stack || err);
    return res.status(500).json({
      success: false,
      error: err.message || "Falha no envio via SES",
    });
  }
}
