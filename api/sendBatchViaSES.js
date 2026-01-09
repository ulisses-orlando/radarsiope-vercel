// backend/sendBatchViaSES.js
import express from "express";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import admin from "firebase-admin";

const router = express.Router();

// Inicializa SES
const ses = new SESClient({
  region: process.env.AWS_REGION || "us-east-1"
});

// Inicializa Firestore Admin (use credenciais do ambiente / service account)
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
    console.info({ event: 'admin.init', message: 'Admin SDK inicializado' });
  } catch (err) {
    console.error({ event: 'admin.init.error', name: err.name, message: err.message, stack: err.stack });
    throw err;
  }
}
const db = admin.firestore();

router.post("/api/sendBatchViaSES", async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  console.info({ requestId, event: 'sendBatch.start', ts: new Date().toISOString() });

  try {
    const { newsletterId, envioId, loteId, emails } = req.body;
    if (!emails || !Array.isArray(emails)) {
      console.warn({ requestId, event: 'sendBatch.invalidPayload', detail: 'emails missing or not array' });
      return res.status(400).json({ ok: false, error: "Payload inválido: emails esperado" });
    }

    const results = [];
    const RATE_LIMIT = Number(process.env.SES_RATE_LIMIT || 14); // e-mails por segundo
    let batch = [];

    // Função que envia um e-mail e grava sesMessageId com fallback
    async function sendEmail(e) {
      const logBase = { requestId, event: 'sendEmail', email: e.email, envioId: e.envioId, destinatarioId: e.destinatarioId || null };
      console.debug({ ...logBase, message: 'sendEmail.start' });

      try {
        const params = {
          Destination: { ToAddresses: [e.email] },
          Message: {
            Body: { Html: { Charset: "UTF-8", Data: e.mensagemHtml } },
            Subject: { Charset: "UTF-8", Data: e.assunto }
          },
          Source: process.env.SES_SOURCE_EMAIL
        };

        console.debug({ ...logBase, event: 'ses.send.call', source: process.env.SES_SOURCE_EMAIL });

        // envia e captura resposta do SES
        const resp = await ses.send(new SendEmailCommand(params));
        const sesMessageId = resp?.MessageId || null;
        console.info({ ...logBase, event: 'ses.send.success', messageId: sesMessageId });

        // 1) grava no caminho do lote (envios_log) — usa set merge para não sobrescrever
        if (sesMessageId && newsletterId && envioId && loteId && e.envioId) {
          const loteEnvioDocPath = `newsletters/${newsletterId}/envios/${envioId}/lotes/${loteId}/envios_log/${e.envioId}`;
          try {
            console.debug({ ...logBase, event: 'firestore.set', path: loteEnvioDocPath });
            await db.doc(loteEnvioDocPath).set({ sesMessageId }, { merge: true });
            console.info({ ...logBase, event: 'firestore.set.success', path: loteEnvioDocPath });
          } catch (err) {
            console.warn({ ...logBase, event: 'firestore.set.error', path: loteEnvioDocPath, name: err.name, code: err.code, message: err.message });
          }
        }

        // 2) grava no documento original do envio (fallbacks) se tiver destinatarioId
        if (sesMessageId && e.destinatarioId) {
          const destId = e.destinatarioId;

          // tentativa 1: leads/{id}/envios/{envioDoc}
          const leadsPath = `leads/${destId}/envios/${e.envioId}`;
          try {
            console.debug({ ...logBase, event: 'firestore.set', path: leadsPath });
            await db.doc(leadsPath).set({ sesMessageId }, { merge: true });
            console.info({ ...logBase, event: 'firestore.set.success', path: leadsPath });
          } catch (err) {
            console.warn({ ...logBase, event: 'firestore.set.error', path: leadsPath, name: err.name, code: err.code, message: err.message });

            // tentativa 2: usuarios/{id}/assinaturas/{assinaturaId}/envios/{envioDoc}
            if (e.assinaturaId) {
              const usuariosPath = `usuarios/${destId}/assinaturas/${e.assinaturaId}/envios/${e.envioId}`;
              try {
                console.debug({ ...logBase, event: 'firestore.set', path: usuariosPath });
                await db.doc(usuariosPath).set({ sesMessageId }, { merge: true });
                console.info({ ...logBase, event: 'firestore.set.success', path: usuariosPath });
              } catch (err2) {
                console.warn({ ...logBase, event: 'firestore.set.error', path: usuariosPath, name: err2.name, code: err2.code, message: err2.message });
              }
            } else {
              // tentativa 3: collectionGroup('envios') por newsletter + destinatarioId
              try {
                console.debug({ ...logBase, event: 'firestore.collectionGroup.query', newsletterId, destId });
                const q = db.collectionGroup("envios")
                  .where("newsletter_id", "==", newsletterId)
                  .where("destinatarioId", "==", destId)
                  .limit(5);
                const snap = await q.get();
                console.debug({ ...logBase, event: 'firestore.collectionGroup.result', size: snap.size });
                if (!snap.empty) {
                  const ops = [];
                  snap.forEach(doc => {
                    ops.push(doc.ref.set({ sesMessageId }, { merge: true }));
                    console.debug({ ...logBase, event: 'firestore.collectionGroup.update', docPath: doc.ref.path });
                  });
                  await Promise.all(ops);
                  console.info({ ...logBase, event: 'firestore.collectionGroup.update.success', updated: ops.length });
                } else {
                  console.warn({ ...logBase, event: 'firestore.collectionGroup.empty', message: 'Nenhum doc encontrado para fallback' });
                }
              } catch (err3) {
                console.warn({ ...logBase, event: 'firestore.collectionGroup.error', name: err3.name, code: err3.code, message: err3.message, stack: err3.stack });
              }
            }
          }
        }

        // push resultado com messageId para rastreio
        results.push({ envioId: e.envioId, ok: true, messageId: sesMessageId });
      } catch (err) {
        console.error({ requestId, event: 'sendEmail.error', email: e.email, name: err.name, code: err.code, message: err.message, stack: err.stack });
        results.push({ envioId: e.envioId, ok: false, error: err.message, code: err.code || null });
      }
    }

    // Envio em batches respeitando RATE_LIMIT
    for (const email of emails) {
      batch.push(email);

      if (batch.length >= RATE_LIMIT) {
        console.info({ requestId, event: 'batch.send', batchSize: batch.length });
        await Promise.all(batch.map(sendEmail));
        batch = [];
        // aguarda 1 segundo antes de continuar para respeitar taxa
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // envia o restante
    if (batch.length > 0) {
      console.info({ requestId, event: 'batch.send.final', batchSize: batch.length });
      await Promise.all(batch.map(sendEmail));
    }

    console.info({ requestId, event: 'sendBatch.end', resultsCount: results.length });
    return res.json({ ok: true, results });
  } catch (err) {
    console.error({ requestId, event: 'sendBatch.error', name: err.name, code: err.code, message: err.message, stack: err.stack });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
