// api/pagamentoMP.js (ESM - use com package.json "type": "module")
import mercadopago from 'mercadopago';
import admin from 'firebase-admin';

// DEBUG: log inicial (não expõe segredos)
try {
  console.log('INICIANDO pagamentoMP - envs:', {
    MP_ACCESS_TOKEN: !!process.env.MP_ACCESS_TOKEN,
    MP_PUBLIC_KEY: !!process.env.MP_PUBLIC_KEY,
    FIREBASE_SERVICE_ACCOUNT_JSON: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  });
} catch (e) {
  console.error('ERRO AO LOGAR ENV VARS', e);
}

// Inicializar Firebase Admin
if (!admin.apps.length) {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON não definido');
  } else {
    try {
      const sa = JSON.parse(saJson);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
    } catch (err) {
      console.error('Erro ao parsear FIREBASE_SERVICE_ACCOUNT_JSON', err);
    }
  }
}
const db = admin.firestore();

// Configurar Mercado Pago
if (process.env.MP_ACCESS_TOKEN) {
  mercadopago.configurations.setAccessToken(process.env.MP_ACCESS_TOKEN);
} else {
  console.warn('MP_ACCESS_TOKEN não definido');
}

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

/**
 * Gera parcelas na subcoleção pagamentos
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
    const acao = (req.query && req.query.acao) ? String(req.query.acao) : null;

    // criar-pedido
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

      const preference = {
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
        mpResp = await mercadopago.preferences.create(preference);
      } catch (err) {
        console.error('Erro ao criar preference no Mercado Pago:', err);
        await novoPedidoRef.set({ status: 'erro_mp', atualizadoEm: admin.firestore.FieldValue.serverTimestamp(), mpError: String(err) }, { merge: true });
        return json(res, 500, { ok: false, message: 'Erro ao criar preferência no Mercado Pago' });
      }

      const initPoint = mpResp.body.init_point || mpResp.body.sandbox_init_point || null;

      await novoPedidoRef.set({
        mpPreferenceId: mpResp.body.id,
        mpInitPoint: initPoint,
        mpSandboxInitPoint: mpResp.body.sandbox_init_point || null,
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

    // webhook
    if (req.method === 'POST' && !acao) {
      const topic = req.query.topic || (req.body && (req.body.topic || req.body.type)) || null;
      const id = req.query.id || (req.body && (req.body.id || (req.body.data && req.body.data.id))) || null;

      if (!topic || !id) {
        return json(res, 200, { ok: true, message: 'notificação recebida (sem topic/id)' });
      }

      let mpData = null;
      try {
        if (topic === 'payment') {
          const r = await mercadopago.payment.get(id);
          mpData = r.body;
        } else if (topic === 'merchant_order') {
          const r = await mercadopago.merchant_orders.get(id);
          mpData = r.body;
        } else {
          const r = await mercadopago.payment.get(id).catch(() => null);
          mpData = r ? r.body : null;
        }
      } catch (err) {
        console.warn('Falha ao buscar recurso no Mercado Pago:', err);
        return json(res, 200, { ok: true, message: 'notificação recebida (erro ao buscar MP)' });
      }

      if (!mpData) return json(res, 200, { ok: true, message: 'mpData vazio' });

      const externalRef = mpData.external_reference || (mpData.order && mpData.order.external_reference) || null;
      if (!externalRef) return json(res, 200, { ok: true, message: 'sem external_reference' });

      const parsed = parseExternalReference(externalRef);
      if (!parsed) return json(res, 200, { ok: true, message: 'external_reference inválido' });

      const { userId, assinaturaId, pedidoId } = parsed;

      const notifId = `${topic}_${id}`;
      const notifRef = db.collection('usuarios').doc(userId)
        .collection('assinaturas').doc(assinaturaId)
        .collection('notificacoes_mp').doc(notifId);

      const notifSnap = await notifRef.get();
      if (notifSnap.exists) {
        return json(res, 200, { ok: true, message: 'já processado' });
      }

      await notifRef.set({
        topic,
        id,
        mpData,
        recebidoEm: admin.firestore.FieldValue.serverTimestamp()
      });

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
          const pagamentoRef = pagamentosRef.doc(String(id));
          await pagamentoRef.set({
            paymentId: id,
            pedidoId,
            status: novoStatusPedido,
            mpData,
            recebidoEm: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }

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

    return json(res, 400, { ok: false, message: 'Rota inválida. Use ?acao=criar-pedido ou envie webhook do MP.' });
  } catch (err) {
    console.error('Erro pagamentoMP:', err);
    return json(res, 500, { ok: false, message: 'Erro interno' });
  }
}
