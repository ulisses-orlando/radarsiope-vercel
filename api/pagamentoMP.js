// api/pagamentoMP.js
// Backend único para criar pedido (Checkout Pro) e receber webhook do Mercado Pago
// Agora com geração de parcelas no backend (subcoleção: usuarios/{userId}/assinaturas/{assinaturaId}/pagamentos)

const mercadopago = require('mercadopago');
const admin = require('firebase-admin');

// Inicializar Firebase Admin com JSON da service account em variável de ambiente
if (!admin.apps.length) {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON não definido');
    // não interrompe deploy, mas operações com Firestore falharão em runtime
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

// Configurar Mercado Pago com token secreto (variável de ambiente)
if (process.env.MP_ACCESS_TOKEN) {
  mercadopago.configurations.setAccessToken(process.env.MP_ACCESS_TOKEN);
} else {
  console.warn('MP_ACCESS_TOKEN não definido');
}

// --- Utilitários ---

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
 * Gera parcelas na subcoleção:
 * usuarios/{userId}/assinaturas/{assinaturaId}/pagamentos
 *
 * - amountCentavos: inteiro (centavos)
 * - numParcelas: inteiro >= 1
 * - metodoPagamento: string (ex.: 'cartao', 'boleto', 'pix') - opcional
 * - dataPrimeiroVencimento: string ISO ou Date; se ausente, usa hoje
 *
 * A função distribui centavos de forma que a soma das parcelas = amountCentavos.
 */
async function gerarParcelasAssinaturaBackend(userId, assinaturaId, amountCentavos, numParcelas = 1, metodoPagamento = null, dataPrimeiroVencimento = null) {
  if (!userId || !assinaturaId) throw new Error('userId e assinaturaId são obrigatórios para gerar parcelas');
  const parcelas = Math.max(1, parseInt(numParcelas, 10) || 1);
  const total = Math.max(0, parseInt(amountCentavos, 10) || 0);

  // divisão inteira e resto para distribuir
  const base = Math.floor(total / parcelas);
  let resto = total - base * parcelas; // 0..(parcelas-1)

  // data do primeiro vencimento
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

  // criar documentos sequenciais
  const batch = db.batch();
  for (let i = 0; i < parcelas; i++) {
    const numero = i + 1;
    // distribuir o resto nos primeiros itens
    const valorCentavos = base + (resto > 0 ? 1 : 0);
    if (resto > 0) resto--;

    // calcular vencimento: adiciona i meses ao primeiro
    const venc = new Date(primeiro);
    venc.setMonth(venc.getMonth() + i);

    const docRef = pagamentosRef.doc(); // id automático
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

// --- Handler principal (Vercel serverless) ---
module.exports = async (req, res) => {
  try {
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

      // 1) criar documento de pedido na subcoleção da assinatura
      const pedidosRef = db.collection('usuarios').doc(userId)
        .collection('assinaturas').doc(assinaturaId)
        .collection('pedidos_mp');

      const novoPedidoRef = pedidosRef.doc(); // id gerado
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

      // montar external_reference para reconciliação
      const external_reference = montarExternalReference(userId, assinaturaId, novoPedidoRef.id);

      // 2) criar preference no Mercado Pago (Checkout Pro)
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
        notification_url: process.env.MP_WEBHOOK_URL || '' // URL pública do webhook
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

      // 3) atualizar pedido com dados do MP
      await novoPedidoRef.set({
        mpPreferenceId: mpResp.body.id,
        mpInitPoint: initPoint,
        mpSandboxInitPoint: mpResp.body.sandbox_init_point || null,
        external_reference,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // 4) gerar parcelas no backend (subcoleção pagamentos)
      try {
        await gerarParcelasAssinaturaBackend(userId, assinaturaId, amountCentavos, parcelas, metodoPagamento, dataPrimeiroVencimento);
      } catch (err) {
        console.warn('Falha ao gerar parcelas no backend:', err);
        // não abortar o fluxo de criação do pedido; apenas logar
      }

      // 5) retornar redirectUrl ao front
      return json(res, 200, { ok: true, redirectUrl: initPoint, pedidoId: novoPedidoRef.id });
    }

    // ---------------------------
    // AÇÃO: webhook (Mercado Pago POST sem acao)
    // POST /api/pagamentoMP  (MP envia ?topic=payment&id=123 ou body.data.id)
    // ---------------------------
    if (req.method === 'POST' && !acao) {
      const topic = req.query.topic || (req.body && (req.body.topic || req.body.type)) || null;
      const id = req.query.id || (req.body && (req.body.id || (req.body.data && req.body.data.id))) || null;

      if (!topic || !id) {
        return json(res, 200, { ok: true, message: 'notificação recebida (sem topic/id)' });
      }

      // buscar dados no Mercado Pago
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

        // quantas parcelas o MP indica que foram pagas neste pagamento
        const installments = (mpData.installments && Number(mpData.installments)) ? Number(mpData.installments) : 1;

        // buscar parcelas pendentes vinculadas a este pedidoId (ou sem pedidoId, dependendo do seu modelo)
        // Observação: quando geramos parcelas, não vinculamos explicitamente pedidoId em cada parcela.
        // Para robustez, vamos buscar parcelas pendentes ordenadas por numero_parcela.
        const pendentesSnap = await pagamentosRef.where('status', '==', 'pendente').orderBy('numero_parcela', 'asc').get();

        if (!pendentesSnap.empty) {
          // marcar as primeiras N parcelas como pagas (N = installments)
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

        // atualizar status da assinatura: se pagamento aprovado, marcar ativo
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
    return json(res, 400, { ok: false, message: 'Rota inválida. Use ?acao=criar-pedido para criar pedido ou envie webhook do MP.' });
  } catch (err) {
    console.error('Erro pagamentoMP:', err);
    return json(res, 500, { ok: false, message: 'Erro interno' });
  }
};
