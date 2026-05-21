// pages/api/pixel.js
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, '\n')
    })
  });
}
const db = admin.firestore();

import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  const { envioId, destinatarioId, newsletterId } = req.query;

  if (!envioId || !destinatarioId || !newsletterId) {
    return res.status(400).send("Parâmetros inválidos");
  }

  const ua = req.headers["user-agent"] || "";

  try {
    const envioRef = db.collection("newsletters")
      .doc(newsletterId)
      .collection("envios")
      .doc(envioId);

    const envioSnap = await envioRef.get();
    if (!envioSnap.exists) {
      // Lead: registrar abertura no Supabase
      try {
        const { data: envioLead } = await supabase
          .from('leads_envios')
          .select('id, aberto_em, total_aberturas')
          .eq('id', parseInt(envioId, 10))
          .eq('lead_id', destinatarioId)
          .single();

        if (envioLead) {
          await supabase
            .from('leads_envios')
            .update({
              aberto_em: envioLead.aberto_em || new Date().toISOString(),
              total_aberturas: (envioLead.total_aberturas || 0) + 1,
              ultimo_acesso_email: new Date().toISOString(),
            })
            .eq('id', envioLead.id);
        }
      } catch (e) {
        console.error('[pixel] Erro Supabase:', e.message);
      }

      res.setHeader("Content-Type", "image/gif");
      return res.send(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
    }

    const aberturaRef = envioRef.collection("aberturas").doc(destinatarioId);
    const snap = await aberturaRef.get();

    if (!snap.exists) {
      // Primeira abertura → vezes = 1
      await aberturaRef.set({
        destinatarioId,
        abertoEm: new Date(),
        vezes: 1,
        userAgent: ua,
        ip: req.socket.remoteAddress || null,
        tipoEvento: "abertura"
      });
    } else {
      // Atualização → incrementa +1
      const dados = snap.data();
      const vezesAtual = dados.vezes || 1;

      await aberturaRef.update({
        vezes: vezesAtual + 1,
        ultimoAcesso: new Date(),
        userAgent: ua,
        ip: req.socket.remoteAddress || null
      });
    }

    // 🔹 Incrementar contador agregado no documento de envio
    await envioRef.set({
      totalAberturas: admin.firestore.FieldValue.increment(1),
      ultimaAberturaEm: new Date()
    }, { merge: true });

  } catch (e) {
    console.error("Erro ao registrar abertura:", e);
  }

  // 🔹 Retorna pixel transparente (GIF 1x1)
  res.setHeader("Content-Type", "image/gif");
  res.send(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
}
