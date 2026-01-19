// pages/api/pagamentoMP.js
// Node runtime (garante crypto, Buffer, firebase-admin)
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';
import admin from 'firebase-admin';

// ---------- Init Firebase (use env vars) ----------
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel often requires \\n -> \n replacement
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, '\n')
    })
  });
}
const db = admin.firestore();

// ---------- Utilities ----------
function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json').end(JSON.stringify(payload));
}
function montarExternalReference(userId, assinaturaId, pedidoId) {
  // deterministic external_reference used to map back to Firestore
  return `${String(userId)}|${String(assinaturaId)}|${String(pedidoId)}`;
}
function parseExternalReference(externalRef) {
  if (!externalRef) return null;
  const parts = String(externalRef).split('|');
  if (parts.length !== 3) return null;
  return { userId: parts[0], assinaturaId: parts[1], pedidoId: parts[2] };
}

// fetch with timeout wrapper (Node 18+ fetch supports AbortSignal)
async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return resp;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// mpFetch: calls Mercado Pago API, throws with status/body on non-2xx
async function mpFetch(path, method = 'GET', body = null) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MP_ACCESS_TOKEN não definido');
  const base = 'https://api.mercadopago.com';
  const url = `${base}${path}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  let resp;
  try {
    resp = await fetchWithTimeout(url, opts, 10000);
  } catch (err) {
    const e = new Error(`Network error calling MP ${method} ${path}: ${err.message}`);
    e.cause = err;
    throw e;
  }

  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }

  if (!resp.ok) {
    const err = new Error(`MP API ${resp.status} ${resp.statusText}`);
    err.status = resp.status;
    err.body = data;
    throw err;
  }
  return data;
}

// gerarParcelasAssinaturaBackend: cria parcelas no Firestore (com checks)
async function gerarParcelasAssinaturaBackend(userId, assinaturaId, amountCentavos, numParcelas = 1, metodoPagamento = null, dataPrimeiroVencimento = null, pedidoId = null) {
  if (!userId || !assinaturaId) throw new Error('userId e assinaturaId são obrigatórios');
  const parcelas = Math.max(1, parseInt(numParcelas, 10) || 1);
  if (parcelas > 500) throw new Error('parcelas > 500: divida em múltiplos batches');

  const total = Math.max(0, parseInt(amountCentavos, 10) || 0);
  const base = Math.floor(total / parcelas);
  let resto = total - base * parcelas;

  let primeiro;
  if (dataPrimeiroVencimento) {
    primeiro = (typeof dataPrimeiroVencimento === 'string') ? new Date(dataPrimeiroVencimento) : new Date(dataPrimeiroVencimento);
    if (isNaN(primeiro.getTime())) primeiro = new Date();
  } else {
    primeiro = new Date();
  }

  const pagamentosRef = db.collection('usuarios').doc(userId)
    .collection('assinaturas').doc(assinaturaId)
    .collection('pagamentos');

  const batch = db.batch();
  for (let i = 0; i < parcelas; i++) {
    const numero = i + 1;
    const valorCentavos = base + (resto > 0 ? 1 : 0);
    if (resto > 0) resto--;

    const venc = new Date(primeiro);
    venc.setMonth(venc.getMonth() + i);

    // idempotency: if pedidoId provided, use deterministic doc id
    const docId = pedidoId ? `${pedidoId}-${numero}` : pagamentosRef.doc().id;
    const docRef = pagamentosRef.doc(docId);
    const data = {
      numero_parcela: numero,
      valor_centavos: valorCentavos,
      metodo_pagamento: metodoPagamento || null,
      data_vencimento: admin.firestore.Timestamp.fromDate(venc),
      data_pagamento: null,
      status: 'pendente',
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
    };
    batch.set(docRef, data, { merge: true });
  }

  await batch.commit();
  return true;
}

// ---------- Handler ----------
export default async function handler(req, res) {
  try {
    // read raw body as string for HMAC and parsing
    const rawBody = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', err => reject(err));
    });

    // try to populate req.body if JSON
    try {
      if (rawBody && rawBody.length > 0 && req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
        req.body = JSON.parse(rawBody);
      }
    } catch (e) {
      // keep rawBody for HMAC diagnostics
      console.warn('Falha ao parsear rawBody como JSON (ok em sandbox):', e.message);
    }

    // minimal debug (do not log secrets)
    console.log('INICIANDO pagamentoMP - envs:', {
      MP_ACCESS_TOKEN: !!process.env.MP_ACCESS_TOKEN,
      MP_PUBLIC_KEY: !!process.env.MP_PUBLIC_KEY,
      MP_WEBHOOK_URL: !!process.env.MP_WEBHOOK_URL,
      MP_WEBHOOK_SECRET: !!process.env.MP_WEBHOOK_SECRET
    });

    // ---------- HMAC validation (robust) ----------
    const secretRaw = String(process.env.MP_WEBHOOK_SECRET || '');
    let signatureVerified = false;
    if (secretRaw) {
      // extract signature header (support multiple header names)
      const signatureHeader = req.headers['x-signature'] || req.headers['x-hub-signature'] || req.headers['x-mercadopago-signature'] || req.headers['x-hook-signature'] || req.headers['signature'] || '';
      let ts = '';
      let v1 = null;
      try {
        const parts = String(signatureHeader).split(',');
        for (const p of parts) {
          const [k, v] = p.split('=');
          if (!k || !v) continue;
          const key = k.trim();
          const val = v.trim();
          if (key === 'ts') ts = val;
          if (key === 'v1') v1 = val;
        }
      } catch (e) { /* ignore parse errors */ }
      if (!v1) {
        const m = String(signatureHeader).match(/([a-f0-9]{64})/i);
        if (m) v1 = m[1];
      }

      if (v1) {
        // normalize raw body newlines to LF
        const normalizedRaw = (rawBody || '').replace(/\r\n/g, '\n');
        const payloadStrings = [];
        payloadStrings.push(`${ts}.${normalizedRaw}`);
        const tsNum = Number(ts);
        if (!Number.isNaN(tsNum)) payloadStrings.push(`${Math.floor(tsNum / 1000)}.${normalizedRaw}`);
        payloadStrings.push(normalizedRaw);

        // secret candidates
        const trimmed = secretRaw.trim();
        const secretCandidates = [];
        try { secretCandidates.push({ name: 'hex', buf: Buffer.from(trimmed, 'hex') }); } catch (e) {}
        try { secretCandidates.push({ name: 'base64', buf: Buffer.from(trimmed, 'base64') }); } catch (e) {}
        secretCandidates.push({ name: 'utf8', buf: Buffer.from(secretRaw, 'utf8') });
        if (trimmed !== secretRaw) secretCandidates.push({ name: 'trimmed utf8', buf: Buffer.from(trimmed, 'utf8') });

        // target buffer from header (v1 hex)
        let targetBuf = null;
        try { targetBuf = Buffer.from(String(v1).trim(), 'hex'); } catch (e) { targetBuf = null; }

        if (targetBuf && targetBuf.length === 32) {
          for (const pstr of payloadStrings) {
            const payloadBuf = Buffer.from(pstr, 'utf8');
            for (const sc of secretCandidates) {
              if (!sc.buf) continue;
              let computed;
              try {
                computed = crypto.createHmac('sha256', sc.buf).update(payloadBuf).digest();
              } catch (e) {
                continue;
              }
              if (computed.length === targetBuf.length && crypto.timingSafeEqual(computed, targetBuf)) {
                signatureVerified = true;
                console.log('HMAC match -> secretAs:', sc.name, 'payloadLen:', payloadBuf.length);
                break;
              }
            }
            if (signatureVerified) break;
          }
        } else {
          console.warn('v1 header inválido ou não presente; v1:', v1 ? String(v1).slice(0,8) + '...' : 'n/a');
        }
      } else {
        console.warn('Nenhum v1 encontrado no header de assinatura.');
      }
    } else {
      console.warn('MP_WEBHOOK_SECRET não configurado; usando fallback (sandbox only).');
    }

    // mark verification on request for downstream logic
    req.__mp_signature_verified = signatureVerified;

    // ---------------------------
    // ROUTING: ?acao=criar-pedido  OR webhook (no acao)
    // ---------------------------
    const acao = (req.query && req.query.acao) ? String(req.query.acao) : null;

    // ---------- AÇÃO: criar-pedido (Checkout Pro) ----------
    if (req.method === 'POST' && acao === 'criar-pedido') {
      const body = req.body || {};
      const { userId, assinaturaId } = body;
      const amountCentavos = parseInt(body.amountCentavos, 10);
      const descricao = body.descricao || `Assinatura`;
      const parcelas = body.parcelas ? Math.max(1, parseInt(body.parcelas, 10)) : 1;
      const metodoPagamento = body.metodoPagamento || null;
      const dataPrimeiroVencimento = body.dataPrimeiroVencimento || null;

      if (!userId || !assinaturaId || !amountCentavos || isNaN(amountCentavos) || amountCentavos <= 0) {
        return json(res, 400, { ok: false, message: 'Parâmetros inválidos: userId, assinaturaId e amountCentavos (>0) são obrigatórios.' });
      }

      const pedidosRef = db.collection('usuarios').doc(userId)
        .collection('assinaturas').doc(assinaturaId)
        .collection('pedidos_mp');

      const novoPedidoRef = pedidosRef.doc();
      const pedidoData = {
        userId,
        assinaturaId,
        amountCentavos,
        descricao,
        parcelas,
        metodo_pagamento: metodoPagamento || null,
        status: 'pendente',
        criadoEm: admin.firestore.FieldValue.serverTimestamp()
      };
      await novoPedidoRef.set(pedidoData);

      const external_reference = montarExternalReference(userId, assinaturaId, novoPedidoRef.id);

      // Preference payload (Checkout Pro)
      const preferencePayload = {
        items: [
          {
            id: novoPedidoRef.id,
            title: descricao,
            quantity: 1,
            currency_id: 'BRL',
            unit_price: (amountCentavos / 100)
          }
        ],
        external_reference,
        back_urls: {
          success: process.env.MP_BACK_URL_SUCCESS || '',
          failure: process.env.MP_BACK_URL_FAILURE || '',
          pending: process.env.MP_BACK_URL_PENDING || ''
        },
        notification_url: process.env.MP_WEBHOOK_URL || ''
      };

      let mpResp;
      try {
        mpResp = await mpFetch('/checkout/preferences', 'POST', preferencePayload);
      } catch (err) {
        console.error('Erro ao criar preference no Mercado Pago:', err.message || err);
        await novoPedidoRef.set({ status: 'erro_mp', atualizadoEm: admin.firestore.FieldValue.serverTimestamp(), mpError: err.body || String(err) }, { merge: true });
        return json(res, 500, { ok: false, message: 'Erro ao criar preferência no Mercado Pago', detail: err.body || String(err) });
      }

      const initPoint = mpResp.init_point || mpResp.sandbox_init_point || null;

      await novoPedidoRef.set({
        mpPreferenceId: mpResp.id,
        mpInitPoint: initPoint,
        mpSandboxInitPoint: mpResp.sandbox_init_point || null,
        external_reference,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // generate backend parcelas (idempotent using pedidoId)
      try {
        await gerarParcelasAssinaturaBackend(userId, assinaturaId, amountCentavos, parcelas, metodoPagamento, dataPrimeiroVencimento, novoPedidoRef.id);
      } catch (err) {
        console.warn('Falha ao gerar parcelas no backend:', err.message || err);
      }

      return json(res, 200, { ok: true, redirectUrl: initPoint, pedidoId: novoPedidoRef.id });
    }

    // ---------- AÇÃO: webhook (MP POST sem acao) ----------
    if (req.method === 'POST' && !acao) {
      // topic and id may come via query or body
      const topic = req.query.topic || (req.body && (req.body.topic || req.body.type)) || null;
      const id = req.query.id || (req.body && (req.body.id || (req.body.data && req.body.data.id))) || null;

      if (!topic || !id) {
        console.log('Webhook recebido sem topic/id; respondendo 200.');
        return json(res, 200, { ok: true, message: 'notificação recebida (sem topic/id)' });
      }

      // If signature not verified, we accept in sandbox and will validate via MP API (fallback)
      if (!req.__mp_signature_verified) {
        console.warn('Assinatura não verificada; usando fallback de validação via API do MP (sandbox).');
      }

      // fetch resource from MP with fallback to merchant_orders
      let mpData = null;
      try {
        if (topic === 'payment' || topic === 'payment.updated' || topic === 'payment.created') {
          mpData = await mpFetch(`/v1/payments/${id}`, 'GET');
        } else if (topic === 'merchant_order' || topic === 'merchant_order.updated') {
          mpData = await mpFetch(`/merchant_orders/${id}`, 'GET');
        } else {
          // fallback: try payment then merchant_orders
          try {
            mpData = await mpFetch(`/v1/payments/${id}`, 'GET');
          } catch (err) {
            if (err && err.status === 404) {
              try {
                mpData = await mpFetch(`/merchant_orders/${id}`, 'GET');
              } catch (err2) {
                console.warn('MP fetch fallback também falhou:', err2.message || err2);
                mpData = null;
              }
            } else {
              throw err;
            }
          }
        }
      } catch (err) {
        console.warn('Falha ao buscar recurso no Mercado Pago:', err.message || err);
        if (err && err.status === 404) {
          console.log('MP retornou 404 para id:', id, 'topic:', topic);
          return json(res, 200, { ok: true, message: 'mp resource not found (simulação ou id inválido)' });
        }
        return json(res, 200, { ok: true, message: 'notificação recebida (erro ao buscar MP)' });
      }

      if (!mpData) return json(res, 200, { ok: true, message: 'mpData vazio' });

      // extract external_reference (userId|assinaturaId|pedidoId)
      const externalRef = mpData.external_reference || (mpData.order && mpData.order.external_reference) || null;
      if (!externalRef) return json(res, 200, { ok: true, message: 'sem external_reference' });

      const parsed = parseExternalReference(externalRef);
      if (!parsed) return json(res, 200, { ok: true, message: 'external_reference inválido' });

      const { userId, assinaturaId, pedidoId } = parsed;

      // idempotência: notificacoes_mp/{topic}_{id}
      const notifId = `${topic}_${id}`;
      const notifRef = db.collection('usuarios').doc(userId)
        .collection('assinaturas').doc(assinaturaId)
        .collection('notificacoes_mp').doc(notifId);

      const notifSnap = await notifRef.get();
      if (notifSnap.exists) {
        console.log('Notificação já processada:', notifId);
        return json(res, 200, { ok: true, message: 'já processado' });
      }

      // save notification (store mpData for audit)
      await notifRef.set({
        topic,
        id,
        mpData,
        signature_verified: !!req.__mp_signature_verified,
        recebidoEm: admin.firestore.FieldValue.serverTimestamp()
      });

      // update pedido document
      const pedidoRef = db.collection('usuarios').doc(userId)
        .collection('assinaturas').doc(assinaturaId)
        .collection('pedidos_mp').doc(pedidoId);

      const pedidoSnap = await pedidoRef.get();
      if (pedidoSnap.exists) {
        const mpStatus = mpData.status || mpData.payment_status || null;
        let novoStatusPedido = 'pendente';
        if (mpStatus === 'approved' || mpStatus === 'paid') novoStatusPedido = 'pago';
        else if (mpStatus === 'pending') novoStatusPedido = 'pendente';
        else if (['cancelled', 'rejected', 'refunded'].includes(mpStatus)) novoStatusPedido = 'falha';

        await pedidoRef.set({
          status: novoStatusPedido,
          mpStatus,
          mpPaymentId: id,
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // mark pre-created parcelas as paid according to installments
        const pagamentosRef = db.collection('usuarios').doc(userId)
          .collection('assinaturas').doc(assinaturaId)
          .collection('pagamentos');

        const installments = (mpData.installments && Number(mpData.installments)) ? Number(mpData.installments) : 1;

        const pendentesSnap = await pagamentosRef.where('status', '==', 'pendente').orderBy('numero_parcela', 'asc').get();

        if (!pendentesSnap.empty) {
          let toMark = installments;
          const batch = db.batch();
          for (const doc of pendentesSnap.docs) {
            if (toMark <= 0) break;
            const pRef = pagamentosRef.doc(doc.id);
            batch.set(pRef, {
              status: 'pago',
              data_pagamento: admin.firestore.FieldValue.serverTimestamp(),
              mpPaymentId: id,
              atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            toMark--;
          }
          await batch.commit();
        } else {
          // if no pending parcelas, create a single payment record
          const pagamentoRef = pagamentosRef.doc(String(id));
          await pagamentoRef.set({
            paymentId: id,
            pedidoId,
            status: novoStatusPedido,
            mpData,
            recebidoEm: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }

        // update assinatura status
        const assinRef = db.collection('usuarios').doc(userId)
          .collection('assinaturas').doc(assinaturaId);

        if (novoStatusPedido === 'pago') {
          await assinRef.set({
            status: 'ativo',
            ativadoEm: admin.firestore.FieldValue.serverTimestamp(),
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } else if (novoStatusPedido === 'falha') {
          await assinRef.set({
            status: 'pagamento_falhou',
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } else if (novoStatusPedido === 'pendente') {
          await assinRef.set({
            status: 'pendente_pagamento',
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
      } else {
        console.warn('Pedido não encontrado para external_reference:', externalRef);
      }

      return json(res, 200, { ok: true, message: 'processado' });
    }

    // invalid route
    return json(res, 400, { ok: false, message: 'Rota inválida. Use ?acao=criar-pedido ou envie webhook do MP.' });
  } catch (err) {
    console.error('Erro pagamentoMP:', err && err.message ? err.message : err);
    return json(res, 500, { ok: false, message: 'Erro interno', detail: String(err && err.message ? err.message : err) });
  }
}
