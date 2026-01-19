// pages/api/pagamentoMP.js
// Runtime Node para garantir compatibilidade com firebase-admin e crypto
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';
import admin from 'firebase-admin';

// Inicializa Firebase (atenção ao formato da PRIVATE_KEY no Vercel: use \\n)
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

// Utilitários
function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json').end(JSON.stringify(payload));
}

// fetch com timeout
async function fetchWithTimeout(url, opts = {}, ms = 10000) {
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

// Chamada à API do Mercado Pago (lança erro com status/body em não-2xx)
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
    const e = new Error(`Erro de rede ao chamar MP ${method} ${path}: ${err.message}`);
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

// Monta external_reference determinístico
function montarExternalReference(userId, assinaturaId, pedidoId) {
  return `${String(userId)}|${String(assinaturaId)}|${String(pedidoId)}`;
}
function parseExternalReference(externalRef) {
  if (!externalRef) return null;
  const parts = String(externalRef).split('|');
  if (parts.length !== 3) return null;
  return { userId: parts[0], assinaturaId: parts[1], pedidoId: parts[2] };
}

// Gera parcelas no backend (idempotente quando pedidoId fornecido)
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

// ---------- Resolver recurso MP (payment | merchant_order | search) ----------
async function resolverRecursoMP(id) {
  // 1) tentar payment direto
  try {
    const p = await mpFetch(`/v1/payments/${encodeURIComponent(id)}`, 'GET');
    return { tipo: 'payment', data: p };
  } catch (err) {
    if (!(err && err.status === 404)) throw err;
  }

  // 2) tentar merchant_order
  try {
    const mo = await mpFetch(`/merchant_orders/${encodeURIComponent(id)}`, 'GET');
    return { tipo: 'merchant_order', data: mo };
  } catch (err) {
    if (!(err && err.status === 404)) throw err;
  }

  // 3) se id parece notification id (contém ';' ou 'UTC'), não tentar endpoints diretos
  const idStr = String(id || '');
  if (idStr.includes(';') || idStr.toLowerCase().includes('utc')) {
    return null;
  }

  // 4) tentar search por order.id
  try {
    const searchOrder = await mpFetch(`/v1/payments/search?order.id=${encodeURIComponent(id)}`, 'GET');
    if (searchOrder && Array.isArray(searchOrder.results) && searchOrder.results.length) {
      return { tipo: 'payment_search', data: searchOrder.results[0] };
    }
  } catch (err) {
    if (!(err && err.status === 404)) console.warn('Erro search order.id:', err.message || err);
  }

  // 5) tentar search por external_reference
  try {
    const searchExt = await mpFetch(`/v1/payments/search?external_reference=${encodeURIComponent(id)}`, 'GET');
    if (searchExt && Array.isArray(searchExt.results) && searchExt.results.length) {
      return { tipo: 'payment_search_ext', data: searchExt.results[0] };
    }
  } catch (err) {
    if (!(err && err.status === 404)) console.warn('Erro search external_reference:', err.message || err);
  }

  return null;
}

// ---------- Handler principal (sem validação HMAC) ----------
export default async function handler(req, res) {
  try {
    // ler raw body (string) para compatibilidade com webhooks
    const rawBody = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', err => reject(err));
    });

    // tentar popular req.body se for JSON
    try {
      if (rawBody && rawBody.length > 0 && req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
        req.body = JSON.parse(rawBody);
      }
    } catch (e) {
      // ok em sandbox; manter rawBody para auditoria
    }

    console.log('Webhook recebido:', req.body);

    // log inicial mínimo (não expõe segredos)
    console.log('INICIANDO pagamentoMP - envs:', {
      MP_ACCESS_TOKEN: !!process.env.MP_ACCESS_TOKEN,
      MP_PUBLIC_KEY: !!process.env.MP_PUBLIC_KEY,
      MP_WEBHOOK_URL: !!process.env.MP_WEBHOOK_URL
    });

    // rota e ação
    const acao = (req.query && req.query.acao) ? String(req.query.acao) : null;

    // ---------- criar-pedido (Checkout Pro) ----------
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
        console.log('Preference criada:', JSON.stringify(mpResp, null, 2));
      } catch (err) {
        console.log('Preference criada com erro:', JSON.stringify(mpResp, null, 2));
        console.error('Erro ao criar preference no Mercado Pago:', err.message || err);
        await novoPedidoRef.set({ status: 'erro_mp', atualizadoEm: admin.firestore.FieldValue.serverTimestamp(), mpError: err.body || String(err) }, { merge: true });
        return json(res, 500, { ok: false, message: 'Erro ao criar preferência no Mercado Pago', detail: err.body || String(err) });
      }

      // sempre usar sandbox_init_point em ambiente de testes
      const initPoint = mpResp.sandbox_init_point || mpResp.init_point || null;
      console.log('Redirect URL usado:', initPoint);

      await novoPedidoRef.set({
        mpPreferenceId: mpResp.id,
        mpInitPoint: initPoint,
        mpSandboxInitPoint: mpResp.sandbox_init_point || null,
        external_reference,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // gerar parcelas no backend (idempotente usando pedidoId)
      try {
        await gerarParcelasAssinaturaBackend(userId, assinaturaId, amountCentavos, parcelas, metodoPagamento, dataPrimeiroVencimento, novoPedidoRef.id);
      } catch (err) {
        console.warn('Falha ao gerar parcelas no backend:', err.message || err);
      }

      return json(res, 200, { ok: true, redirectUrl: initPoint, pedidoId: novoPedidoRef.id });
    }

    // ---------- webhook (MP POST sem acao) ----------
    if (req.method === 'POST' && !acao) {
      const topic = req.query.topic || (req.body && (req.body.topic || req.body.type)) || null;
      const id = req.query.id || (req.body && (req.body.id || (req.body.data && req.body.data.id))) || null;

      if (!topic || !id) {
        console.log('Webhook recebido sem topic/id; respondendo 200.');
        return json(res, 200, { ok: true, message: 'notificação recebida (sem topic/id)' });
      }

      // idempotência: notificacoes_mp/{topic}_{id}
      // precisamos do parsed external_reference mais adiante; criar ref de notificação agora
      // parsed userId/assinaturaId/pedidoId só após resolver mpData
      const notifId = `${topic}_${id}`;

      // tentar resolver recurso MP (payment | merchant_order | search)
      let resolved = null;
      try {
        resolved = await resolverRecursoMP(id);
      } catch (err) {
        console.warn('Falha ao buscar recurso no Mercado Pago:', err.message || err);
        // se erro de rede ou permissão, responder 200 para evitar retries agressivos do MP
        return json(res, 200, { ok: true, message: 'notificação recebida (erro ao buscar MP)' });
      }

      if (!resolved) {
        console.log('Não foi possível resolver id no MP; id pode ser notification id ou ambiente errado:', id);
        // registrar notificação mínima para auditoria
        // salvar em coleção global de notificações (sem userId/assinaturaId)
        const globalNotifRef = db.collection('notificacoes_mp_global').doc(notifId);
        await globalNotifRef.set({
          topic,
          id,
          rawBody: rawBody ? rawBody.slice(0, 2000) : null,
          recebidoEm: admin.firestore.FieldValue.serverTimestamp(),
          resolved: false
        }, { merge: true });
        return json(res, 200, { ok: true, message: 'mp resource not found (simulação ou id inválido)' });
      }

      const mpData = resolved.data;

      // extrair external_reference (userId|assinaturaId|pedidoId)
      const externalRef = mpData.external_reference || (mpData.order && mpData.order.external_reference) || null;
      if (!externalRef) {
        // salvar globalmente para auditoria
        const globalNotifRef = db.collection('notificacoes_mp_global').doc(notifId);
        await globalNotifRef.set({
          topic,
          id,
          mpData,
          recebidoEm: admin.firestore.FieldValue.serverTimestamp(),
          resolved: true,
          external_reference: null
        }, { merge: true });
        return json(res, 200, { ok: true, message: 'sem external_reference' });
      }

      const parsed = parseExternalReference(externalRef);
      if (!parsed) {
        const globalNotifRef = db.collection('notificacoes_mp_global').doc(notifId);
        await globalNotifRef.set({
          topic,
          id,
          mpData,
          external_reference: externalRef,
          recebidoEm: admin.firestore.FieldValue.serverTimestamp(),
          resolved: true,
          parsed: false
        }, { merge: true });
        return json(res, 200, { ok: true, message: 'external_reference inválido' });
      }

      const { userId, assinaturaId, pedidoId } = parsed;

      const notifRef = db.collection('usuarios').doc(userId)
        .collection('assinaturas').doc(assinaturaId)
        .collection('notificacoes_mp').doc(notifId);

      const notifSnap = await notifRef.get();
      if (notifSnap.exists) {
        console.log('Notificação já processada:', notifId);
        return json(res, 200, { ok: true, message: 'já processado' });
      }

      // salvar notificação com mpData para auditoria
      await notifRef.set({
        topic,
        id,
        mpData,
        recebidoEm: admin.firestore.FieldValue.serverTimestamp(),
        resolvedTipo: resolved.tipo,
        signature_verified: false // sem validação HMAC por enquanto
      });

      // atualizar pedido
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

        // atualizar pagamentos pré-criados: marcar parcelas pagas conforme installments
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
          // se não houver parcelas pendentes, criar um registro de pagamento único
          const pagamentoRef = pagamentosRef.doc(String(id));
          await pagamentoRef.set({
            paymentId: id,
            pedidoId,
            status: novoStatusPedido,
            mpData,
            recebidoEm: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }

        // atualizar status da assinatura
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

    // rota inválida
    return json(res, 400, { ok: false, message: 'Rota inválida. Use ?acao=criar-pedido ou envie webhook do MP.' });
  } catch (err) {
    console.error('Erro pagamentoMP:', err && err.message ? err.message : err);
    return json(res, 500, { ok: false, message: 'Erro interno', detail: String(err && err.message ? err.message : err) });
  }
}
