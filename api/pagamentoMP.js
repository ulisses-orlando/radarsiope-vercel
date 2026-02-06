// pages/api/pagamentoMP.js
// Runtime Node para garantir compatibilidade com firebase-admin e crypto
// desabilitar bodyParser para permitir validação HMAC no futuro
export const config = { runtime: 'nodejs', api: { bodyParser: false } };

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

function logCompleto() {
  return process.env.MP_LOG_COMPLETO === 'true';
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

/*
  Centralizar seleção do access token do Mercado Pago
  - MP_FORCE_SANDBOX === 'true' => usar MP_ACCESS_TOKEN_TEST (ou fallback MP_ACCESS_TOKEN legado)
  - caso contrário, preferir MP_ACCESS_TOKEN_PROD
  - fallback para MP_ACCESS_TOKEN (legado) se nenhuma das novas variáveis estiver presente
  Observação: evitar usar token legado em produção; monitore logs.
*/
function getMpAccessToken() {
  const forceSandbox = process.env.MP_FORCE_SANDBOX === 'true';
  const testToken = process.env.MP_ACCESS_TOKEN_TEST || null;
  const prodToken = process.env.MP_ACCESS_TOKEN_PROD || null;

  if (forceSandbox) {
    if (!testToken) {
      throw new Error('MP_FORCE_SANDBOX=true mas MP_ACCESS_TOKEN_TEST não está configurado.');
    }
    return testToken;
  }

  if (prodToken) return prodToken;
  if (testToken) return testToken;

  throw new Error('Nenhum token MP configurado. Configure MP_ACCESS_TOKEN_PROD ou MP_ACCESS_TOKEN_TEST.');
}


// Chamada à API do Mercado Pago (lança erro com status/body em não-2xx)
async function mpFetch(pathOrUrl, method = 'GET', body = null) {
  const token = getMpAccessToken();
  if (!token) throw new Error('MP access token não definido');

  // permitir passar URL completa ou apenas path
  let url = String(pathOrUrl);
  if (!url.startsWith('http')) {
    // usar sempre api.mercadopago.com (merchant_orders também está aqui)
    const base = 'https://api.mercadopago.com';
    url = `${base}${pathOrUrl}`;
  }

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  let resp;
  try {
    resp = await fetchWithTimeout(url, opts, 10000);
  } catch (err) {
    const e = new Error(`Erro de rede ao chamar MP ${method} ${url}: ${err.message}`);
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

async function resolverRecursoMP(id, topic) {
  // 1) se veio topic=payment, buscar direto em /v1/payments/{id}
  if (topic === 'payment') {
    try {
      const p = await mpFetch(`/v1/payments/${encodeURIComponent(id)}`, 'GET');
      return { tipo: 'payment', data: p };
    } catch (err) {
      if (!(err && err.status === 404)) throw err;
    }
  }

  // 2) se veio topic=merchant_order, buscar direto em /merchant_orders/{id}
  if (topic === 'merchant_order') {
    try {
      const mo = await mpFetch(`/merchant_orders/${encodeURIComponent(id)}`, 'GET');
      // extrair external_reference também de mo.order.external_reference quando aplicável
      if (mo && !mo.external_reference && mo.order && mo.order.external_reference) {
        mo.external_reference = mo.order.external_reference;
      }
      return { tipo: 'merchant_order', data: mo };
    } catch (err) {
      if (!(err && err.status === 404)) throw err;
    }
  }

  // 3) fallback: tentar payment direto
  try {
    const p = await mpFetch(`/v1/payments/${encodeURIComponent(id)}`, 'GET');
    return { tipo: 'payment', data: p };
  } catch (err) {
    if (!(err && err.status === 404)) throw err;
  }

  // 4) fallback: tentar merchant_order
  try {
    const mo = await mpFetch(`/merchant_orders/${encodeURIComponent(id)}`, 'GET');
    if (mo && !mo.external_reference && mo.order && mo.order.external_reference) {
      mo.external_reference = mo.order.external_reference;
    }
    return { tipo: 'merchant_order', data: mo };
  } catch (err) {
    if (!(err && err.status === 404)) throw err;
  }

  // 5) se id parece notification id (contém ';' ou 'UTC'), não tentar endpoints diretos
  const idStr = String(id || '');
  if (idStr.includes(';') || idStr.toLowerCase().includes('utc')) {
    return null;
  }

  // 6) tentar search por order.id
  try {
    const searchOrder = await mpFetch(`/v1/payments/search?order.id=${encodeURIComponent(id)}`, 'GET');
    if (searchOrder && Array.isArray(searchOrder.results) && searchOrder.results.length) {
      return { tipo: 'payment_search', data: searchOrder.results[0] };
    }
  } catch (err) {
    if (!(err && err.status === 404)) console.warn('Erro search order.id:', err.message || err);
  }

  // 7) tentar search por external_reference
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

function getMpTokenType() {
  // não chama getMpAccessToken() para evitar lançar erro aqui
  if (process.env.MP_FORCE_SANDBOX === 'true') return 'TEST';
  if (process.env.MP_ACCESS_TOKEN_PROD) return 'PROD';
  if (process.env.MP_ACCESS_TOKEN_TEST) return 'TEST';
  return 'UNKNOWN';
}

/**
 * validateMpWebhookSignature(rawBody, req)
 * - Lê headers comuns de assinatura do Mercado Pago
 * - Suporta header no formato "t=..., v1=..." ou apenas o hash (hex/base64)
 * - Por padrão usa HMAC-SHA256 sobre rawBody; se precisar de string canônica, ajuste baseString
 * - Só executa quando MP_VALIDATE_WEBHOOK === 'true'
 *
 * Retorno: { ok: true } ou { ok: false, reason: 'mensagem', ts?: '...' }
 */

function validateMpWebhookSignature(rawBody, req) {
  console.log("🔎 Iniciando validação de webhook MP...");

  if (process.env.MP_VALIDATE_WEBHOOK !== 'true') {
    return { ok: true, reason: 'validation disabled by MP_VALIDATE_WEBHOOK' };
  }

  // escolher segredo conforme ambiente
  const forceSandbox = process.env.MP_FORCE_SANDBOX === 'true';
  const secret = forceSandbox
    ? process.env.MP_WEBHOOK_SECRET_TEST
    : process.env.MP_WEBHOOK_SECRET;

  if (!secret) {
    console.error("❌ Segredo não configurado para ambiente:", forceSandbox ? 'SANDBOX' : 'PROD');
    return { ok: false, reason: 'webhook secret not configured' };
  }
  console.log("🔑 Segredo carregado da env:", forceSandbox ? 'SANDBOX' : 'PROD', secret ? "[OK]" : "[Faltando]");

  const sigHeaderRaw = String(
    req.headers['x-signature'] ||
    req.headers['x-meli-signature'] ||
    req.headers['x-hub-signature-256'] ||
    req.headers['x-hub-signature'] ||
    req.headers['x-signature-256'] ||
    ''
  );
  console.log("📩 Header de assinatura bruto:", sigHeaderRaw);

  let ts = null;
  let sigV1 = null;
  if (sigHeaderRaw.includes('=')) {
    sigHeaderRaw.split(',').forEach(p => {
      const [k, v] = p.trim().split('=');
      if (!k || !v) return;
      if (k === 'ts') ts = v;   // <-- corrigido
      if (k === 'v1') sigV1 = v;
    });
  } else {
    if (sigHeaderRaw) sigV1 = sigHeaderRaw.trim();
  }
  console.log("🕒 Timestamp extraído:", ts);
  console.log("🔐 Assinatura v1 extraída:", sigV1);

  if (!sigV1) {
    console.error("❌ Nenhuma assinatura presente no header");
    return { ok: false, reason: 'no signature header present', ts };
  }

  // pegar id corretamente
  let dataId = '';
  if (req.query && req.query['data.id']) {
    dataId = String(req.query['data.id']);
  } else if (rawBody && rawBody.data && rawBody.data.id) {
    dataId = String(rawBody.data.id);
  } else if (rawBody && rawBody.id) {
    dataId = String(rawBody.id);
  }

  const requestId = req.headers['x-request-id'] || '';
  const baseString = `id:${dataId};request-id:${requestId};ts:${ts || ''};`;
  console.log("🧩 BaseString montada para HMAC:", baseString);

  let expected;
  try {
    const h = crypto.createHmac('sha256', secret);
    h.update(baseString, 'utf8');
    expected = h.digest();
    console.log("✅ HMAC calculado com sucesso");
  } catch (e) {
    console.error("❌ Falha ao calcular HMAC:", e);
    return { ok: false, reason: 'hmac computation failed' };
  }

  const candidates = [];
  try { candidates.push(Buffer.from(sigV1, 'hex')); } catch (e) { }
  try { candidates.push(Buffer.from(sigV1, 'base64')); } catch (e) { }
  console.log("📊 Candidatos de assinatura gerados:", candidates.length);

  for (const cand of candidates) {
    if (!cand || cand.length !== expected.length) continue;
    try {
      if (crypto.timingSafeEqual(expected, cand)) {
        console.log("🎉 Assinatura válida encontrada!");
        if (ts) {
          const tsNum = parseInt(ts, 10);
          const now = Math.floor(Date.now() / 1000);
          console.log("⏱️ Comparando timestamp:", { tsNum, now });
          if (Math.abs(now - tsNum) > 300) {
            console.error("⚠️ Timestamp fora da tolerância");
            return { ok: false, reason: 'timestamp out of tolerance', ts };
          }
        }
        return { ok: true, ts, id: dataId };
      }
    } catch (e) {
      console.error("❌ Erro ao comparar assinaturas:", e);
    }
  }

  console.error("❌ Nenhuma comparação bateu. Assinatura inválida.");
  return { ok: false, reason: 'signature mismatch', ts, id: dataId };
}


async function dispararMensagemAutomatica(momento, dados) {
  try {
    // 1. Buscar template ativo e automático
    const snapshot = await db.collection("respostas_automaticas")
      .where("momento_envio", "==", momento)
      .where("ativo", "==", true)
      .where("enviar_automaticamente", "==", true)
      .get();

    if (snapshot.empty) {
      return;
    }

    // 2. Para cada template encontrado
    for (const doc of snapshot.docs) {
      const msg = doc.data();

      // 3. Substituir placeholders usando sua função
      const mensagemHtml = aplicarPlaceholders(msg.mensagem_html, dados);

      // 4. Chamar API enviarEmail.js
      await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/enviarEmail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: dados.nome,
          email: dados.email,
          assunto: msg.titulo,
          mensagemHtml
        })
      });
    }
  } catch (error) {
    console.error("❌ Erro no disparo automático:", error);
  }
}

function formatDateBR(date) {
  if (!date) return "";
  const d = new Date(date.seconds ? date.seconds * 1000 : date);
  return d.toLocaleDateString("pt-BR");
}

function aplicarPlaceholders(template, dados) {
  const nome = dados.nome || "(nome não informado)";
  const email = dados.email || "(email não informado)";
  const edicao = dados.edicao || "(sem edição)";
  let tipo = "(sem tipo)";
  if (Array.isArray(dados.interesses) && dados.interesses.length > 0) {
    tipo = dados.interesses.join(", ");
  } else if (dados.tipo) {
    tipo = dados.tipo;
  }
  const titulo = dados.titulo || "(sem título)";
  const newsletterId = dados.newsletterId || "(sem newsletterId)";
  const envioId = dados.envioId || "(sem envioId)";
  const destinatarioId = dados.destinatarioId || "(sem destinatarioId)";
  const cod_uf = dados.cod_uf || "(sem UFId)";
  const nome_municipio = dados.nome_municipio || "(sem municipioId)";
  const cargo = dados.tipo_perfil || dados.perfil || "(sem cargoId)";
  const interesse = dados.interesse || "(sem interesse)";
  const interesseId = dados.interesseId || "(sem interesseId)";
  const token = dados.token_acesso || "(sem token)";
  const plano = dados.plano || "(sem plano)";
  const data_assinatura = dados.data_assinatura || "(sem data de assinatura)";

  let dataFormatada = "";
  if (dados.data_publicacao) {
    const dataObj = dados.data_publicacao.toDate?.() || dados.data_publicacao;
    dataFormatada = formatDateBR(dataObj);
  }

  return template
    .replace(/{{nome}}/gi, nome)
    .replace(/{{email}}/gi, email)
    .replace(/{{edicao}}/gi, edicao)
    .replace(/{{tipo}}/gi, tipo)
    .replace(/{{titulo}}/gi, titulo)
    .replace(/{{data_publicacao}}/gi, dataFormatada)
    .replace(/{{newsletterId}}/gi, newsletterId)
    .replace(/{{envioId}}/gi, envioId)
    .replace(/{{destinatarioId}}/gi, destinatarioId)
    .replace(/{{uf}}/gi, cod_uf)
    .replace(/{{municipio}}/gi, nome_municipio)
    .replace(/{{cargo}}/gi, cargo)
    .replace(/{{interesse}}/gi, interesse)
    .replace(/{{interesseId}}/gi, interesseId)
    .replace(/{{token}}/gi, token)
    .replace(/{{plano}}/gi, plano)
    .replace(/{{data_assinatura}}/gi, data_assinatura);
}

// ---------- Handler principal (sem validação HMAC) ----------
export default async function handler(req, res) {
  try {
    // debug seguro: não logar prefixo do token; logar apenas o tipo (TEST/PROD)
    // ativar logs detalhados apenas com MP_DEBUG='true'
    if (process.env.MP_DEBUG === 'true') {
      console.info('DEBUG MP token type:', getMpTokenType());
    } else {
      console.info('DEBUG MP token type: [redacted]');
    }

    // ler raw body (string) para compatibilidade com webhooks
    const rawBody = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', err => reject(err));
    });

    // validar assinatura (se habilitado) 
    // só validar assinatura se NÃO for criar-pedido
    const temAcaoCriarPedido = (req.query && req.query.acao) ? String(req.query.acao) : null;

    if (!temAcaoCriarPedido) {
      const sigCheck = validateMpWebhookSignature(rawBody, req);
      if (!sigCheck.ok) {
        console.warn('Webhook assinatura inválida ou validação desativada:', sigCheck.reason, 'ts:', sigCheck.ts || null);
        return json(res, 200, { ok: true, message: 'signature invalid (ignored)' });
      }
    }

    // tentar popular req.body se for JSON
    try {
      if (rawBody && rawBody.length > 0 && req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
        req.body = JSON.parse(rawBody);
      }
    } catch (e) {
      // ok em sandbox; manter rawBody para auditoria
    }

    /*     console.log('Webhook recebido:', req.body);
    
        // log inicial mínimo (não expõe segredos)
        console.log('INICIANDO pagamentoMP - envs:', {
          MP_ACCESS_TOKEN_PROD: !!process.env.MP_ACCESS_TOKEN_PROD,
          MP_ACCESS_TOKEN_TEST: !!process.env.MP_ACCESS_TOKEN_TEST,
          MP_ACCESS_TOKEN: !!process.env.MP_ACCESS_TOKEN,
          MP_PUBLIC_KEY: !!process.env.MP_PUBLIC_KEY,
          MP_WEBHOOK_URL: !!process.env.MP_WEBHOOK_URL,
          MP_FORCE_SANDBOX: !!process.env.MP_FORCE_SANDBOX,
          MP_VALIDATE_WEBHOOK: !!process.env.MP_VALIDATE_WEBHOOK
        }); */

    // rota e ação
    const acao = (req.query && req.query.acao) ? String(req.query.acao) : null;

    // ---------- criar-pedido (Checkout Pro) ----------
    if (req.method === 'POST' && acao === 'criar-pedido') {
      const body = req.body || {};
      const { userId, assinaturaId } = body;
      const amountCentavos = parseInt(body.amountCentavos, 10);
      const descricao = body.descricao || `Assinatura`;
      const installmentsMax = body.installmentsMax ? Math.max(1, parseInt(body.installmentsMax, 10)) : 1;
      const dataPrimeiroVencimento = body.dataPrimeiroVencimento || null;
      const nome = body.nome || "";
      const email = body.email || "";
      const cpf = body.cpf || "";

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
        installmentsMax,
        status: 'pendente',
        criadoEm: admin.firestore.FieldValue.serverTimestamp()
      };
      await novoPedidoRef.set(pedidoData);

      const external_reference = montarExternalReference(userId, assinaturaId, novoPedidoRef.id);
      const cpfNormalizado = (cpf || "").replace(/\D/g, "");

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
        payer: {
          name: nome,
          surname: "",
          email: email,
          identification: {
            type: "CPF",
            number: cpfNormalizado
          }
        },
        external_reference,

        binary_mode: true,
        auto_return: "approved",

        back_urls: {
          success: process.env.MP_BACK_URL_SUCCESS || '',
          failure: process.env.MP_BACK_URL_FAILURE || '',
          pending: process.env.MP_BACK_URL_PENDING || ''
        },
        notification_url: process.env.MP_WEBHOOK_URL || '',

        installments: installmentsMax,   // limite de parcelas definido pelo plano

        // 🚫 Bloquear boleto 
        excluded_payment_types: [
          { id: "ticket" }
        ]
      };

      let mpResp;
      try {
        mpResp = await mpFetch('/checkout/preferences', 'POST', preferencePayload);
        //console.log('Preference criada:', JSON.stringify(mpResp, null, 2));
      } catch (err) {
        console.error('Erro ao criar preference no Mercado Pago:', err.message || err);
        await novoPedidoRef.set({ status: 'erro_mp', atualizadoEm: admin.firestore.FieldValue.serverTimestamp(), mpError: err.body || String(err) }, { merge: true });
        return json(res, 500, { ok: false, message: 'Erro ao criar preferência no Mercado Pago', detail: err.body || String(err) });
      }

      /*       const preferSandbox = process.env.MP_FORCE_SANDBOX === 'true';
            const initPoint = preferSandbox
              ? (mpResp.sandbox_init_point || mpResp.init_point || null)
              : (mpResp.init_point || mpResp.sandbox_init_point || null); */

      // Sempre usar init_point, mesmo em sandbox/teste 
      const initPoint = mpResp.init_point || mpResp.sandbox_init_point || null;

      //console.log('Redirect URL usado:', initPoint);

      await novoPedidoRef.set({
        mpPreferenceId: mpResp.id,
        mpInitPoint: initPoint,
        mpSandboxInitPoint: mpResp.sandbox_init_point || null,
        external_reference,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // gerar parcelas no backend usando installmentsMax
      if (logCompleto()) {
        try {
          await gerarParcelasAssinaturaBackend(
            userId, assinaturaId, amountCentavos,
            installmentsMax, null, dataPrimeiroVencimento, novoPedidoRef.id
          );
        } catch (err) {
          console.warn('Falha ao gerar parcelas no backend:', err.message || err);
        }
      } else {
        const pagamentoRef = db.collection('usuarios').doc(userId)
          .collection('assinaturas').doc(assinaturaId)
          .collection('pagamentos').doc(novoPedidoRef.id);
        await pagamentoRef.set({
          valor_centavos: amountCentavos,
          numero_parcelas: installmentsMax,
          status: 'pendente',
          criadoEm: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      return json(res, 200, { ok: true, redirectUrl: initPoint, pedidoId: novoPedidoRef.id });
    }

    // ---------- webhook (MP POST sem acao) ----------
    if (req.method === 'POST' && !acao) {
      const topic = req.query.topic || req.query.type || (req.body && (req.body.topic || req.body.type)) || null;
      const id = req.query.id || (req.query && req.query.notification_id) || (req.body && (req.body.id || (req.body.data && req.body.data.id))) || null;

      if (!topic || !id) {
        //console.log('Webhook recebido sem topic/id; respondendo 200.');
        return json(res, 200, { ok: true, message: 'notificação recebida (sem topic/id)' });
      }

      // idempotência: notificacoes_mp/{topic}_{id}
      const notifId = `${topic}_${id}`;

      // tentar resolver recurso MP (payment | merchant_order | search)
      let resolved = null;
      try {
        resolved = await resolverRecursoMP(id, topic);
      } catch (err) {
        console.warn('Falha ao buscar recurso no Mercado Pago:', err.message || err);
        // se erro de rede ou permissão, responder 200 para evitar retries agressivos do MP
        return json(res, 200, { ok: true, message: 'notificação recebida (erro ao buscar MP)' });
      }

      if (!resolved) {
        //console.log('Não foi possível resolver id no MP; id pode ser notification id ou ambiente errado:', id);
        // registrar notificação mínima para auditoria
        if (logCompleto()) {
          const globalNotifRef = db.collection('notificacoes_mp_global').doc(notifId);
          await globalNotifRef.set({
            topic,
            id,
            rawBody: rawBody ? rawBody.slice(0, 2000) : null,
            recebidoEm: admin.firestore.FieldValue.serverTimestamp(),
            resolved: false
          }, { merge: true });
        }
        return json(res, 200, { ok: true, message: 'mp resource not found (simulação ou id inválido)' });
      }

      // effectiveId começa com o id da notificação; pode ser substituído pelo payment.id real
      let effectiveId = String(id);
      let mpData = resolved.data;

      // logs para diferenciar merchant_order vs payment 
      //console.log("Webhook MP status recebido:", mpData.status || mpData.payment_status || "sem status");
      //console.log(`Webhook MP recebido - topic: ${topic}, status: ${mpData.status || mpData.payment_status || "sem status"}`);

      // Se veio merchant_order, não gravar mpPaymentId com o id do MO.
      // Se houver um payment dentro do merchant_order, buscar o payment real e usar seu status/id.
      if (resolved.tipo === 'merchant_order') {
        const mo = mpData;
        // extrair external_reference também de mo.order.external_reference quando aplicável
        if (!mo.external_reference && mo.order && mo.order.external_reference) {
          mo.external_reference = mo.order.external_reference;
        }
        const payId = mo.payments && mo.payments[0] && mo.payments[0].id;
        if (payId) {
          try {
            const payment = await mpFetch(`/v1/payments/${encodeURIComponent(payId)}`, 'GET');
            // substituir mpData pelo payment real para lógica abaixo (status, installments, etc)
            mpData = payment;
            // ajustar resolved.tipo para 'payment' para tratamento unificado
            resolved.tipo = 'payment';
            effectiveId = String(payment.id);
          } catch (err) {
            // se não conseguir buscar payment, manter mo como mpData e gravar moId separadamente mais abaixo
            console.warn('Falha ao buscar payment dentro do merchant_order:', err && err.message ? err.message : err);
          }
        }
      }

      // extrair external_reference (userId|assinaturaId|pedidoId)
      const externalRef = mpData.external_reference || (mpData.order && mpData.order.external_reference) || null;
      if (!externalRef) {
        // salvar globalmente para auditoria
        if (logCompleto()) {
          const globalNotifRef = db.collection('notificacoes_mp_global').doc(notifId);
          await globalNotifRef.set({
            topic,
            id,
            rawBody: rawBody ? rawBody.slice(0, 2000) : null,
            recebidoEm: admin.firestore.FieldValue.serverTimestamp(),
            resolved: false
          }, { merge: true });
        }
        return json(res, 200, { ok: true, message: 'sem external_reference' });
      }

      const parsed = parseExternalReference(externalRef);
      if (!parsed) {
        if (logCompleto()) {
          const globalNotifRef = db.collection('notificacoes_mp_global').doc(notifId);
          await globalNotifRef.set({
            topic,
            id,
            rawBody: rawBody ? rawBody.slice(0, 2000) : null,
            recebidoEm: admin.firestore.FieldValue.serverTimestamp(),
            resolved: false
          }, { merge: true });
        }
        return json(res, 200, { ok: true, message: 'external_reference inválido' });
      }

      const { userId, assinaturaId, pedidoId } = parsed;

      const notifRef = db.collection('usuarios').doc(userId)
        .collection('assinaturas').doc(assinaturaId)
        .collection('notificacoes_mp').doc(notifId);

      const notifSnap = await notifRef.get();
      if (notifSnap.exists) {
        //console.log('Notificação já processada:', notifId);
        return json(res, 200, { ok: true, message: 'já processado' });
      }

      // salvar notificação com mpData para auditoria
      if (logCompleto()) {
        await notifRef.set({
          topic,
          id,
          mpData,
          recebidoEm: admin.firestore.FieldValue.serverTimestamp(),
          resolvedTipo: resolved.tipo,
          signature_verified: false
        });
      } else {
        const notifRefSimple = db.collection('usuarios').doc(userId)
          .collection('assinaturas').doc(assinaturaId)
          .collection('ultima_notificacao').doc('last');
        await notifRefSimple.set({
          topic,
          id,
          mpStatus: mpData.status || mpData.payment_status || null,
          recebidoEm: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      // atualizar pedido
      const pedidoRef = db.collection('usuarios').doc(userId)
        .collection('assinaturas').doc(assinaturaId)
        .collection('pedidos_mp').doc(pedidoId);

      const pedidoSnap = await pedidoRef.get();
      if (pedidoSnap.exists) {
        const mpStatus = mpData.status || mpData.payment_status || null;
        let novoStatusPedido = 'pendente';

        // se veio de payment, confiar no status do pagamento
        if (resolved.tipo === 'payment' || resolved.tipo === 'payment_search' || resolved.tipo === 'payment_search_ext') {
          if (mpStatus === 'approved' || mpStatus === 'paid') novoStatusPedido = 'pago';
          else if (mpStatus === 'pending') novoStatusPedido = 'pendente';
          else if (['cancelled', 'rejected', 'refunded'].includes(mpStatus)) novoStatusPedido = 'falha';
        }

        // se veio de merchant_order, marcar como pendente/aberto (caso não tenha sido convertido para payment acima)
        if (resolved.tipo === 'merchant_order') {
          novoStatusPedido = 'pendente';
        }

        const updateObj = {
          status: novoStatusPedido,
          mpStatus,
          mpPaymentMethod: mpData.payment_method_id || null,   // método escolhido (ex.: visa, pix, boleto)
          mpInstallments: (mpData.installments && Number(mpData.installments)) ? Number(mpData.installments) : 1, // número de parcelas
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
        };

        // se veio payment, gravar mpPaymentId usando effectiveId
        if (resolved.tipo === 'payment') {
          updateObj.mpPaymentId = effectiveId;
        } else if (resolved.tipo === 'merchant_order') {
          // gravar merchant_order id separadamente (usar id original da notificação)
          updateObj.mpMerchantOrderId = id;
        }
        await pedidoRef.set(updateObj, { merge: true });

        //console.log(`Pedido ${pedidoId} atualizado para: ${novoStatusPedido} (tipoNotificacao=${resolved.tipo})`);

        // atualizar pagamentos pré-criados: marcar parcelas pagas conforme installments
        const pagamentosRef = db.collection('usuarios').doc(userId)
          .collection('assinaturas').doc(assinaturaId)
          .collection('pagamentos');

        const installments = (mpData.installments && Number(mpData.installments)) ? Number(mpData.installments) : 1;

        if (logCompleto()) {
          const pendentesSnap = await pagamentosRef.where('status', '==', 'pendente')
            .orderBy('numero_parcela', 'asc').get();

          if (!pendentesSnap.empty) {
            let toMark = installments;
            const batch = db.batch();
            for (const doc of pendentesSnap.docs) {
              if (toMark <= 0) break;
              const pRef = pagamentosRef.doc(doc.id);
              batch.set(pRef, {
                status: 'pago',
                data_pagamento: admin.firestore.FieldValue.serverTimestamp(),
                mpPaymentId: effectiveId,
                mpPaymentMethod: mpData.payment_method_id || null,
                mpInstallments: installments,
                tipoNotificacao: resolved.tipo,
                atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
              }, { merge: true });
              toMark--;
            }
            await batch.commit();
          }
        } else {
          // Atualizar o documento criado no fluxo de pedido (pedidoId).
          // Se por algum motivo pedidoId não estiver disponível, usar fallback para effectiveId.
          const targetDocId = pedidoId ? String(pedidoId) : String(effectiveId);
          const pagamentoRef = pagamentosRef.doc(targetDocId);

          await pagamentoRef.set({
            // manter referência ao payment do MP para reconciliação
            paymentId: effectiveId,
            pedidoId: pedidoId || null,
            status: novoStatusPedido,
            mpPaymentMethod: mpData.payment_method_id || null,
            mpInstallments: installments,
            data_pagamento: admin.firestore.FieldValue.serverTimestamp(),
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }

        // atualizar status da assinatura de acordo com o status do pedido
        const assinRef = db.collection('usuarios').doc(userId)
          .collection('assinaturas').doc(assinaturaId);

        if (novoStatusPedido === 'pago') {
          await assinRef.set({
            status: 'ativa',   // assinatura passa a ativa
            paymentProvider: 'mercadopago',
            orderId: pedidoId,
            ativadoEm: admin.firestore.FieldValue.serverTimestamp(),
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          // --- Início do bloco substituto ---
          // Buscar dados da assinatura
          const assinaturaDoc = await db.collection("usuarios").doc(userId)
            .collection("assinaturas").doc(assinaturaId).get();
          const assinaturaData = assinaturaDoc.exists ? assinaturaDoc.data() : {};

          // Buscar dados do usuário (coleção raiz)
          const usuarioDoc = await db.collection("usuarios").doc(userId).get();
          const usuarioData = usuarioDoc.exists ? usuarioDoc.data() : {};

          // Buscar nome do plano na coleção planos
          let nomePlano = "(plano não informado)";
          if (assinaturaData.planId) {
            const planoDoc = await db.collection("planos").doc(assinaturaData.planId).get();
            if (planoDoc.exists) {
              nomePlano = planoDoc.data().nome || nomePlano;
            }
          }

          // Controle de envio direto no documento assinatura usando enviosAutomaticos.<pedidoId>
          // Chave determinística para travar por pedido
          const assinDocRef = db.collection('usuarios').doc(userId)
            .collection('assinaturas').doc(assinaturaId);
          const logKey = `enviosAutomaticos.${String(pedidoId)}`;

          let devoEnviar = false;
          try {
            await db.runTransaction(async (tx) => {
              const snap = await tx.get(assinDocRef);
              const data = snap.exists ? snap.data() : {};

              // Se já existe entrada para esse pedidoId, outro processo já iniciou/enviou
              if (data && data.enviosAutomaticos && data.enviosAutomaticos[String(pedidoId)]) {
                return;
              }

              // Criar entrada inicial (status iniciado)
              const payload = {};
              payload[logKey] = {
                momento: 'pos_cadastro_assinante',
                titulo: 'Confirmação de assinatura',
                email: usuarioData?.email || mpData.payer?.email || "(email não informado)",
                status: 'iniciado',
                criadoEm: admin.firestore.FieldValue.serverTimestamp()
              };

              tx.set(assinDocRef, payload, { merge: true });
              // Se a transação fizer commit, somos responsáveis por enviar
              devoEnviar = true;
            });
          } catch (err) {
            console.error('Erro na transação de marcação de envio:', err && err.message ? err.message : err);
            devoEnviar = false;
          }

          if (devoEnviar) {
            try {
              // Enviar e-mail (mantendo sua lógica de template)
              await dispararMensagemAutomatica("pos_cadastro_assinante", {
                userId,
                assinaturaId,
                nome: usuarioData?.nome || mpData.payer?.first_name || assinaturaData?.nome || "",
                email: usuarioData?.email || mpData.payer?.email || "(email não informado)",
                plano: nomePlano,
                data_assinatura: new Date()
              });

              // Marcar sucesso no doc da assinatura
              const successPayload = {};
              successPayload[logKey] = {
                momento: 'pos_cadastro_assinante',
                titulo: 'Confirmação de assinatura',
                email: usuarioData?.email || mpData.payer?.email || "(email não informado)",
                status: 'enviado',
                criadoEm: admin.firestore.FieldValue.serverTimestamp(),
                enviadoEm: admin.firestore.FieldValue.serverTimestamp()
              };
              await assinDocRef.set(successPayload, { merge: true });

            } catch (err) {
              console.error('Erro ao enviar e marcar envio no doc da assinatura:', err && err.message ? err.message : err);
              // Marcar erro no doc para auditoria
              const errPayload = {};
              errPayload[logKey] = {
                momento: 'pos_cadastro_assinante',
                titulo: 'Confirmação de assinatura',
                email: usuarioData?.email || mpData.payer?.email || "(email não informado)",
                status: 'erro',
                criadoEm: admin.firestore.FieldValue.serverTimestamp(),
                erro: String(err && err.message ? err.message : err),
                atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
              };
              try { await assinRef.set(errPayload, { merge: true }); } catch (e2) { console.warn('Falha ao gravar erro no doc da assinatura:', e2 && e2.message ? e2.message : e2); }
            }
          } else {
            if (logCompleto()) console.info('Envio já registrado em assinatura para pedidoId:', pedidoId);
          }
        } else if (novoStatusPedido === 'falha') {
          await assinRef.set({
            status: 'cancelada',   // assinatura cancelada
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } else if (novoStatusPedido === 'pendente') {
          await assinRef.set({
            status: 'pendente_pagamento',   // aguardando pagamento
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
