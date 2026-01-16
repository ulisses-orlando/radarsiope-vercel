// api/pagamentoMP.js (ESM) - versão completa e atualizada
// - Usa REST do Mercado Pago via fetch (sem dependência mercadopago)
// - Inicializa Firebase via env vars (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)
// - Captura raw body, loga headers/body, valida assinatura HMAC se MP_WEBHOOK_SECRET estiver configurado
// - Gera parcelas no backend e trata webhooks com tolerância a 404 (simulações)

import crypto from 'crypto';
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

// Inicializar Firebase Admin usando variáveis separadas (padrão do pixel.js)
if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID || null;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || null;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || null;

  if (!projectId || !clientEmail || !privateKey) {
    console.error('Variáveis FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY não definidas');
  } else {
    privateKey = privateKey.replace(/\\n/g, '\n');
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey
        })
      });
      console.log('Firebase inicializado via env vars (projectId, clientEmail, privateKey)');
    } catch (err) {
      console.error('Erro ao inicializar Firebase com env vars:', err);
    }
  }
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
export default async function handler(req, res) {
  try {
    // --- ler raw body (texto) para logs e verificação HMAC ---
    const rawBody = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', err => reject(err));
    });

    // log headers e raw body para depuração de webhook
    console.log('WEBHOOK HEADERS:', req.headers);
    console.log('WEBHOOK RAW BODY:', rawBody);

    // tentar popular req.body se for JSON (mantém compatibilidade)
    try {
      if (rawBody && rawBody.length > 0 && req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
        req.body = JSON.parse(rawBody);
      }
    } catch (e) {
      console.warn('Falha ao parsear rawBody como JSON:', e);
    }

    // verificar assinatura HMAC se MP_WEBHOOK_SECRET estiver configurado
    const secret = process.env.MP_WEBHOOK_SECRET || null;
    if (secret) {
      const signatureHeader = req.headers['x-hub-signature'] || req.headers['x-signature'] || req.headers['x-mercadopago-signature'] || req.headers['x-hook-signature'] || req.headers['signature'];
      console.log('HEADER DE ASSINATURA RECEBIDO:', signatureHeader || '(nenhum)');
      if (!signatureHeader) {
        console.warn('Nenhum header de assinatura encontrado; rejeitando por segurança.');
        return res.status(401).end('assinatura ausente');
      }
      const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const ok = signatureHeader === computed || signatureHeader === `sha256=${computed}` || signatureHeader.endsWith(computed);
      console.log('ASSINATURA COMPUTADA:', computed, 'VALIDA:', ok);
      if (!ok) return res.status(401).end('assinatura inválida');
    } else {
      console.log('MP_WEBHOOK_SECRET não configurado; pulando verificação HMAC.');
    }

    const acao = (req.query && req.query.acao) ? String(req.query.acao) : null;

    // ---------------------------
    // AÇÃO: criar-pedido (Checkout Pro)
    // POST /api/pagamentoMP?acao=criar-pedido
    // Body esperado: { userId, assinaturaId, amountCentavos, descricao, parcelas, metodoPagamento, dataPrimeiroVencimento }
    // ---------------------------
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
        metodoPagamento,
        status: 'pendente',
        criadoEm: admin.firestore.FieldValue.serverTimestamp()
      };
      await novoPedidoRef.set(pedidoData);

      const external_reference = montarExternalReference(userId, assinaturaId, novoPedidoRef.id);

      // montar payload para Preference (Checkout Pro)
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
        console.error('Erro ao criar preference no Mercado Pago:', err);
        await novoPedidoRef.set({ status: 'erro_mp', atualizadoEm: admin.firestore.FieldValue.serverTimestamp(), mpError: String(err) }, { merge: true });
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

      try {
        await gerarParcelasAssinaturaBackend(userId, assinaturaId, amountCentavos, parcelas, metodoPagamento, dataPrimeiroVencimento);
      } catch (err) {
        console.warn('Falha ao gerar parcelas no backend:', err);
      }

      return json(res, 200, { ok: true, redirectUrl: initPoint, pedidoId: novoPedidoRef.id });
    }

    // ---------------------------
    // AÇÃO: webhook (Mercado Pago POST sem acao)
    // POST /api/pagamentoMP  (MP envia ?topic=payment&id=123 ou body.data.id)
    // ---------------------------
    if (req.method === 'POST' && !acao) {
      // topic e id podem vir via query ou body
      const topic = req.query.topic || (req.body && (req.body.topic || req.body.type)) || null;
      const id = req.query.id || (req.body && (req.body.id || (req.body.data && req.body.data.id))) || null;

      if (!topic || !id) {
        console.log('Webhook recebido sem topic/id; respondendo 200.');
        return json(res, 200, { ok: true, message: 'notificação recebida (sem topic/id)' });
      }

      // buscar dados no Mercado Pago com tolerância a 404 (simulações)
      let mpData = null;
      try {
        if (topic === 'payment' || topic === 'payment.updated' || topic === 'payment.created') {
          mpData = await mpFetch(`/v1/payments/${id}`, 'GET');
        } else if (topic === 'merchant_order' || topic === 'merchant_order.updated') {
          mpData = await mpFetch(`/merchant_orders/${id}`, 'GET');
        } else {
          // fallback: tentar payment
          try {
            mpData = await mpFetch(`/v1/payments/${id}`, 'GET');
          } catch (err) {
            // se 404, tentar merchant_orders
            if (err && err.status === 404) {
              try {
                mpData = await mpFetch(`/merchant_orders/${id}`, 'GET');
              } catch (err2) {
                console.warn('MP fetch fallback também falhou:', err2);
                mpData = null;
              }
            } else {
              throw err;
            }
          }
        }
      } catch (err) {
        // se 404 (Payment not found) é comum em simulações; log e continuar
        console.warn('Falha ao buscar recurso no Mercado Pago:', err);
        if (err && err.status === 404) {
          // registrar notificação mínima e responder 200 para evitar reenvios excessivos
          console.log('MP retornou 404 para id:', id, 'topic:', topic);
          return json(res, 200, { ok: true, message: 'mp resource not found (simulação ou id inválido)' });
        }
        return json(res, 200, { ok: true, message: 'notificação recebida (erro ao buscar MP)' });
      }

      if (!mpData) return json(res, 200, { ok: true, message: 'mpData vazio' });

      // extrair external_reference (formato: userId|assinaturaId|pedidoId)
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

      // salvar notificação
      await notifRef.set({
        topic,
        id,
        mpData,
        recebidoEm: admin.firestore.FieldValue.serverTimestamp()
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
    console.error('Erro pagamentoMP:', err);
    return json(res, 500, { ok: false, message: 'Erro interno', detail: String(err) });
  }
}
