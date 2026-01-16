// api/pagamentoMP.js (ESM) - versão completa e atualizada
// - Usa REST do Mercado Pago via fetch (sem dependência mercadopago)
// - Inicializa Firebase via env vars (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)
// - Captura raw body, loga headers/body, valida assinatura HMAC se MP_WEBHOOK_SECRET estiver configurado
// - Gera parcelas no backend e trata webhooks com tolerância a 404 (simulações)

//import crypto from 'crypto';
const crypto = require('crypto');

import admin from 'firebase-admin';

// DEBUG: log inicial (não expõe segredos)
try {
  console.log('INICIANDO pagamentoMP - envs:', {
    MP_ACCESS_TOKEN: !!process.env.MP_ACCESS_TOKEN,
    MP_PUBLIC_KEY: !!process.env.MP_PUBLIC_KEY,
    FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
    MP_WEBHOOK_URL: !!process.env.MP_WEBHOOK_URL,
    MP_WEBHOOK_SECRET: !!process.env.MP_WEBHOOK_SECRET
  });
} catch (e) {
  console.error('ERRO AO LOGAR ENV VARS', e);
}

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

// utilitários
function montarExternalReference(userId, assinaturaId, pedidoId) {
  return `${userId}|${assinaturaId}|${pedidoId}`;
}
function parseExternalReference(externalRef) {
  if (!externalRef) return null;
  const parts = String(externalRef).split('|');
  if (parts.length !== 3) return null;
  return { userId: parts[0], assinaturaId: parts[1], pedidoId: parts[2] };
}
function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json').end(JSON.stringify(payload));
}

// helper para chamar API do Mercado Pago via fetch
async function mpFetch(path, method = 'GET', body = null) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MP_ACCESS_TOKEN não definido');
  const base = 'https://api.mercadopago.com';
  const url = `${base}${path}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
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

/**
 * Gera parcelas na subcoleção:
 * usuarios/{userId}/assinaturas/{assinaturaId}/pagamentos
 *
 * - amountCentavos: inteiro (centavos)
 * - numParcelas: inteiro >= 1
 * - metodoPagamento: string (ex.: 'cartao', 'boleto', 'pix') - opcional
 * - dataPrimeiroVencimento: string ISO ou Date; se ausente, usa hoje
 */
async function gerarParcelasAssinaturaBackend(userId, assinaturaId, amountCentavos, numParcelas = 1, metodoPagamento = null, dataPrimeiroVencimento = null) {
  if (!userId || !assinaturaId) throw new Error('userId e assinaturaId são obrigatórios para gerar parcelas');
  const parcelas = Math.max(1, parseInt(numParcelas, 10) || 1);
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

    const docRef = pagamentosRef.doc();
    const data = {
      numero_parcela: numero,
      valor_centavos: valorCentavos,
      metodo_pagamento: metodoPagamento || null,
      data_vencimento: admin.firestore.Timestamp.fromDate(venc),
      data_pagamento: null,
      status: 'pendente',
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
    };
    batch.set(docRef, data);
  }

  await batch.commit();
  return true;
}

// handler exportado
// Dependências externas esperadas no escopo:
// - crypto (Node.js): const crypto = require('crypto');
// - admin, db (Firebase Admin SDK) já inicializados
// - mpFetch(path, method, payload) -> faz chamadas ao Mercado Pago e retorna JSON
// - montarExternalReference(userId, assinaturaId, pedidoId)
// - gerarParcelasAssinaturaBackend(userId, assinaturaId, amountCentavos, parcelas, metodoPagamento, dataPrimeiroVencimento)
// - parseExternalReference(externalRef) -> { userId, assinaturaId, pedidoId }
// Se algum helper não existir no seu projeto, adapte as chamadas abaixo.


function tryParseJson(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

function canonicalJson(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

function sendJson(res, status, body) {
  if (!res.headersSent) return res.status(status).json(body);
  return null;
}

async function validateSignature(rawBody, headers) {
  const signatureHeader = headers['x-signature'] || headers['x-hub-signature'] || headers['x-mercadopago-signature'] || headers['x-hook-signature'] || headers['signature'] || '';
  if (!signatureHeader) return false;

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
  } catch (e) { /* ignore */ }

  if (!v1) {
    const m = String(signatureHeader).match(/([a-f0-9]{64})/i);
    if (m) v1 = m[1];
  }
  if (!v1) return false;

  const secretRaw = process.env.MP_WEBHOOK_SECRET || '';
  if (!secretRaw) return false;

  const raw = rawBody || '';
  const parsedBody = tryParseJson(raw);

  const payloadCandidates = new Set();
  payloadCandidates.add(`${ts}.${raw}`);
  const tsNum = Number(ts);
  if (!Number.isNaN(tsNum)) payloadCandidates.add(`${Math.floor(tsNum / 1000)}.${raw}`);
  payloadCandidates.add(raw);
  payloadCandidates.add(raw.trim());
  payloadCandidates.add(`${ts}\n${raw}`);
  payloadCandidates.add(raw.replace(/^\uFEFF/, ''));
  if (parsedBody) {
    payloadCandidates.add(JSON.stringify(parsedBody));
    payloadCandidates.add(JSON.stringify(parsedBody).trim());
    payloadCandidates.add(canonicalJson(parsedBody));
  }

  const secretVariants = [
    { name: 'hex', buf: (() => { try { return Buffer.from(secretRaw, 'hex'); } catch (e) { return null; } })() },
    { name: 'utf8', buf: (() => { try { return Buffer.from(secretRaw, 'utf8'); } catch (e) { return null; } })() },
    { name: 'base64', buf: (() => { try { return Buffer.from(secretRaw, 'base64'); } catch (e) { return null; } })() }
  ];

  for (const payload of payloadCandidates) {
    for (const sv of secretVariants) {
      if (!sv.buf) continue;
      let computed;
      try {
        computed = crypto.createHmac('sha256', sv.buf).update(payload).digest('hex');
      } catch (e) {
        continue;
      }
      try {
        if (v1.length === computed.length && crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(computed, 'hex'))) {
          return true;
        }
      } catch (e) {
        // ignore and continue
      }
    }
  }

  return false;
}

export default async function handler(req, res) {
  try {
    // --- ler raw body (texto) para verificação HMAC ---
    const rawBody = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', err => reject(err));
    });

    // validar assinatura HMAC (se falhar, responder 401)
    const signatureValid = await validateSignature(rawBody, req.headers);
    if (!signatureValid) {
      return sendJson(res, 401, { ok: false, message: 'assinatura inválida' });
    }

    // responder 200 imediatamente e processar em background para evitar timeouts
    sendJson(res, 200, { ok: true, message: 'accepted' });

    // processamento em background (não bloquear resposta)
    (async () => {
      // parse seguro do body
      const parsedBody = tryParseJson(rawBody);

      const acao = (req.query && req.query.acao) ? String(req.query.acao) : null;

      // AÇÃO: criar-pedido (Checkout Pro) - este fluxo normalmente é chamado pelo frontend, não por MP
      if (req.method === 'POST' && acao === 'criar-pedido') {
        const body = parsedBody || req.body || {};
        const { userId, assinaturaId } = body;
        const amountCentavos = parseInt(body.amountCentavos, 10);
        const descricao = body.descricao || `Assinatura`;
        const parcelas = body.parcelas ? Math.max(1, parseInt(body.parcelas, 10)) : 1;
        const metodoPagamento = body.metodoPagamento || null;
        const dataPrimeiroVencimento = body.dataPrimeiroVencimento || null;

        if (!userId || !assinaturaId || !amountCentavos || isNaN(amountCentavos) || amountCentavos <= 0) {
          return; // já respondemos 200; nada a fazer em background
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
          metodoPagamento,
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

        try {
          const mpResp = await mpFetch('/checkout/preferences', 'POST', preferencePayload);
          const initPoint = mpResp.init_point || mpResp.sandbox_init_point || null;
          await novoPedidoRef.set({
            mpPreferenceId: mpResp.id,
            mpInitPoint: initPoint,
            mpSandboxInitPoint: mpResp.sandbox_init_point || null,
            external_reference,
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          try {
            await gerarParcelasAssinaturaBackend(userId, assinaturaId, amountCentavos, parcelas, metodoPagamento, dataPrimeiroVencimento);
          } catch (err) {
            // falha ao gerar parcelas; continuar
          }
        } catch (err) {
          await novoPedidoRef.set({ status: 'erro_mp', atualizadoEm: admin.firestore.FieldValue.serverTimestamp(), mpError: String(err) }, { merge: true });
        }

        return;
      }

      // AÇÃO: webhook (Mercado Pago POST sem acao)
      if (req.method === 'POST' && !acao) {
        // topic e id podem vir via query ou body
        const topic = req.query.topic || (parsedBody && (parsedBody.topic || parsedBody.type)) || null;
        const id = req.query.id || (parsedBody && (parsedBody.id || (parsedBody.data && parsedBody.data.id))) || null;

        if (!topic || !id) {
          return;
        }

        // buscar dados no Mercado Pago com tolerância a 404 (simulações)
        let mpData = null;
        try {
          if (topic === 'payment' || topic === 'payment.updated' || topic === 'payment.created') {
            mpData = await mpFetch(`/v1/payments/${id}`, 'GET');
          } else if (topic === 'merchant_order' || topic === 'merchant_order.updated') {
            mpData = await mpFetch(`/merchant_orders/${id}`, 'GET');
          } else {
            try {
              mpData = await mpFetch(`/v1/payments/${id}`, 'GET');
            } catch (err) {
              if (err && err.status === 404) {
                try {
                  mpData = await mpFetch(`/merchant_orders/${id}`, 'GET');
                } catch (err2) {
                  mpData = null;
                }
              } else {
                throw err;
              }
            }
          }
        } catch (err) {
          if (err && err.status === 404) {
            return;
          }
          return;
        }

        if (!mpData) return;

        // extrair external_reference (formato: userId|assinaturaId|pedidoId)
        const externalRef = mpData.external_reference || (mpData.order && mpData.order.external_reference) || null;
        if (!externalRef) return;

        const parsed = parseExternalReference(externalRef);
        if (!parsed) return;

        const { userId, assinaturaId, pedidoId } = parsed;

        // idempotência: notificacoes_mp/{topic}_{id} usando transação
        const notifId = `${topic}_${id}`;
        const notifRef = db.collection('usuarios').doc(userId)
          .collection('assinaturas').doc(assinaturaId)
          .collection('notificacoes_mp').doc(notifId);

        try {
          await db.runTransaction(async tx => {
            const snap = await tx.get(notifRef);
            if (snap.exists) {
              // já processado
              return;
            }
            tx.set(notifRef, {
              topic,
              id,
              mpData,
              recebidoEm: admin.firestore.FieldValue.serverTimestamp()
            });
          });
        } catch (e) {
          // se já processado, sair silenciosamente
          return;
        }

        // atualizar pedido
        const pedidoRef = db.collection('usuarios').doc(userId)
          .collection('assinaturas').doc(assinaturaId)
          .collection('pedidos_mp').doc(pedidoId);

        const pedidoSnap = await pedidoRef.get();
        if (pedidoSnap.exists) {
          const mpStatusRaw = (mpData.status || mpData.payment_status || '') ;
          const mpStatus = String(mpStatusRaw).toLowerCase();
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

          const installmentsRaw = mpData.installments;
          let installments = Number(installmentsRaw);
          if (!Number.isFinite(installments) || installments <= 0) installments = 1;
          installments = Math.max(1, Math.floor(installments));

          const pendentesSnap = await pagamentosRef.where('status', '==', 'pendente').orderBy('numero_parcela', 'asc').get();

          if (!pendentesSnap.empty) {
            const docsToMark = pendentesSnap.docs.slice(0, installments);
            const batch = db.batch();
            for (const doc of docsToMark) {
              const pRef = pagamentosRef.doc(doc.id);
              batch.set(pRef, {
                status: 'pago',
                data_pagamento: admin.firestore.FieldValue.serverTimestamp(),
                mpPaymentId: id,
                atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
              }, { merge: true });
            }
            try {
              await batch.commit();
            } catch (e) {
              // fallback: atualizar individualmente
              for (const doc of docsToMark) {
                await pagamentosRef.doc(doc.id).set({
                  status: 'pago',
                  data_pagamento: admin.firestore.FieldValue.serverTimestamp(),
                  mpPaymentId: id,
                  atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
              }
            }
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
          // pedido não encontrado: registrar para investigação (pode ser simulação)
          const missingRef = db.collection('monitoring').doc('mp_missing_pedidos');
          await missingRef.collection('events').add({
            externalRef,
            topic,
            id,
            receivedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }

        return;
      }

      // outros métodos/rotas: nada a fazer
      return;
    })();

    // já respondemos 200 acima
    return;
  } catch (err) {
    // se algo falhar antes da resposta, retornar 500
    try { return sendJson(res, 500, { ok: false, message: 'Erro interno', detail: String(err) }); } catch (e) { return; }
  }
}
