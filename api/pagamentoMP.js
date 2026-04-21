// pages/api/pagamentoMP.js
// Runtime Node para garantir compatibilidade com firebase-admin e crypto
// desabilitar bodyParser para permitir validação HMAC
export const config = { runtime: 'nodejs', api: { bodyParser: false } };

import crypto from 'crypto';
import admin from 'firebase-admin';
import { enviarWhatsApp } from './js/_whatsapp.js';


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

// ─── Utilitários ──────────────────────────────────────────────────────────────

function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json').end(JSON.stringify(payload));
}

function logCompleto() {
  return process.env.MP_LOG_COMPLETO === 'true';
}

// fetch com timeout — usado tanto para MP quanto para e-mail (fix #7)
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

// ─── Seleção de token MP ──────────────────────────────────────────────────────
/*
  - MP_FORCE_SANDBOX === 'true' => usar MP_ACCESS_TOKEN_TEST
  - caso contrário, preferir MP_ACCESS_TOKEN_PROD
  - fallback para MP_ACCESS_TOKEN_TEST se PROD não estiver presente
*/
function getMpAccessToken() {
  const forceSandbox = process.env.MP_FORCE_SANDBOX === 'true';
  const testToken = process.env.MP_ACCESS_TOKEN_TEST || null;
  const prodToken = process.env.MP_ACCESS_TOKEN_PROD || null;

  if (forceSandbox) {
    if (!testToken) throw new Error('MP_FORCE_SANDBOX=true mas MP_ACCESS_TOKEN_TEST não está configurado.');
    return testToken;
  }
  if (prodToken) return prodToken;
  if (testToken) return testToken;
  throw new Error('Nenhum token MP configurado. Configure MP_ACCESS_TOKEN_PROD ou MP_ACCESS_TOKEN_TEST.');
}

function getMpTokenType() {
  if (process.env.MP_FORCE_SANDBOX === 'true') return 'TEST';
  if (process.env.MP_ACCESS_TOKEN_PROD) return 'PROD';
  if (process.env.MP_ACCESS_TOKEN_TEST) return 'TEST';
  return 'UNKNOWN';
}

// ─── Chamada à API do Mercado Pago ────────────────────────────────────────────

async function mpFetch(pathOrUrl, method = 'GET', body = null) {
  const token = getMpAccessToken();
  let url = String(pathOrUrl);
  if (!url.startsWith('http')) url = `https://api.mercadopago.com${pathOrUrl}`;

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

// ─── external_reference ───────────────────────────────────────────────────────

function montarExternalReference(userId, assinaturaId, pedidoId) {
  return `${String(userId)}|${String(assinaturaId)}|${String(pedidoId)}`;
}

function parseExternalReference(externalRef) {
  if (!externalRef) return null;
  const parts = String(externalRef).split('|');
  if (parts.length !== 3) return null;
  return { userId: parts[0], assinaturaId: parts[1], pedidoId: parts[2] };
}

// ─── Registro de pagamento (doc único) ───────────────────────────────────────

async function registrarPagamentoPendente(userId, assinaturaId, amountCentavos, numParcelas = 1, metodoPagamento = null, pedidoId) {
  if (!userId || !assinaturaId || !pedidoId) throw new Error('userId, assinaturaId e pedidoId são obrigatórios');
  const parcelas = Math.max(1, parseInt(numParcelas, 10) || 1);
  const total = Math.max(0, parseInt(amountCentavos, 10) || 0);
  const valorParcela = Math.floor(total / parcelas);

  await db.collection('usuarios').doc(userId)
    .collection('assinaturas').doc(assinaturaId)
    .collection('pagamentos').doc(pedidoId)
    .set({
      valor_total_centavos: total,
      valor_parcela_centavos: valorParcela,
      num_parcelas: parcelas,
      metodo_pagamento: metodoPagamento || null,
      data_pagamento: null,
      status: 'pendente',
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
    });
}

// ─── Resolver recurso MP (payment | merchant_order | search) ──────────────────

async function resolverRecursoMP(id, topic) {
  if (topic === 'payment') {
    try {
      const p = await mpFetch(`/v1/payments/${encodeURIComponent(id)}`, 'GET');
      return { tipo: 'payment', data: p };
    } catch (err) {
      if (!(err && err.status === 404)) throw err;
    }
  }

  if (topic === 'merchant_order') {
    try {
      const mo = await mpFetch(`/merchant_orders/${encodeURIComponent(id)}`, 'GET');
      if (mo && !mo.external_reference && mo.order && mo.order.external_reference) {
        mo.external_reference = mo.order.external_reference;
      }
      return { tipo: 'merchant_order', data: mo };
    } catch (err) {
      if (!(err && err.status === 404)) throw err;
    }
  }

  try {
    const p = await mpFetch(`/v1/payments/${encodeURIComponent(id)}`, 'GET');
    return { tipo: 'payment', data: p };
  } catch (err) {
    if (!(err && err.status === 404)) throw err;
  }

  try {
    const mo = await mpFetch(`/merchant_orders/${encodeURIComponent(id)}`, 'GET');
    if (mo && !mo.external_reference && mo.order && mo.order.external_reference) {
      mo.external_reference = mo.order.external_reference;
    }
    return { tipo: 'merchant_order', data: mo };
  } catch (err) {
    if (!(err && err.status === 404)) throw err;
  }

  const idStr = String(id || '');
  if (idStr.includes(';') || idStr.toLowerCase().includes('utc')) return null;

  try {
    const searchOrder = await mpFetch(`/v1/payments/search?order.id=${encodeURIComponent(id)}`, 'GET');
    if (searchOrder && Array.isArray(searchOrder.results) && searchOrder.results.length) {
      return { tipo: 'payment_search', data: searchOrder.results[0] };
    }
  } catch (err) {
    if (!(err && err.status === 404)) console.warn('Erro search order.id:', err.message || err);
  }

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

// ─── Validação de assinatura do webhook (HMAC-SHA256) ─────────────────────────
/*
  fix #2: rawBody é string — parsear para JSON antes de acessar propriedades.
  Suporta header "t=...,v1=..." ou hash direto (hex/base64).
  Só executa quando MP_VALIDATE_WEBHOOK === 'true'.
*/
function validateMpWebhookSignature(rawBody, req) {
  if (process.env.MP_VALIDATE_WEBHOOK !== 'true') {
    return { ok: true, reason: 'validation disabled by MP_VALIDATE_WEBHOOK' };
  }

  const forceSandbox = process.env.MP_FORCE_SANDBOX === 'true';
  const secret = forceSandbox
    ? process.env.MP_WEBHOOK_SECRET_TEST
    : process.env.MP_WEBHOOK_SECRET;

  if (!secret) {
    console.error('❌ Segredo webhook não configurado para ambiente:', forceSandbox ? 'SANDBOX' : 'PROD');
    return { ok: false, reason: 'webhook secret not configured' };
  }

  const sigHeaderRaw = String(
    req.headers['x-signature'] ||
    req.headers['x-meli-signature'] ||
    req.headers['x-hub-signature-256'] ||
    req.headers['x-hub-signature'] ||
    req.headers['x-signature-256'] ||
    ''
  );

  let ts = null;
  let sigV1 = null;
  if (sigHeaderRaw.includes('=')) {
    sigHeaderRaw.split(',').forEach(p => {
      const [k, v] = p.trim().split('=');
      if (!k || !v) return;
      if (k === 'ts') ts = v;
      if (k === 'v1') sigV1 = v;
    });
  } else {
    if (sigHeaderRaw) sigV1 = sigHeaderRaw.trim();
  }

  if (!sigV1) {
    console.error('❌ Nenhuma assinatura presente no header');
    return { ok: false, reason: 'no signature header present', ts };
  }

  // fix #2: parsear rawBody (string) para acessar propriedades
  let parsedBody = null;
  try { parsedBody = rawBody ? JSON.parse(rawBody) : null; } catch (e) { /* ignora */ }

  let dataId = '';
  if (req.query && req.query['data.id']) {
    dataId = String(req.query['data.id']);
  } else if (parsedBody && parsedBody.data && parsedBody.data.id) {
    dataId = String(parsedBody.data.id);
  } else if (parsedBody && parsedBody.id) {
    dataId = String(parsedBody.id);
  }

  const requestId = req.headers['x-request-id'] || '';
  const baseString = `id:${dataId};request-id:${requestId};ts:${ts || ''};`;

  let expected;
  try {
    const h = crypto.createHmac('sha256', secret);
    h.update(baseString, 'utf8');
    expected = h.digest();
  } catch (e) {
    console.error('❌ Falha ao calcular HMAC:', e);
    return { ok: false, reason: 'hmac computation failed' };
  }

  const candidates = [];
  try { candidates.push(Buffer.from(sigV1, 'hex')); } catch (e) { }
  try { candidates.push(Buffer.from(sigV1, 'base64')); } catch (e) { }

  for (const cand of candidates) {
    if (!cand || cand.length !== expected.length) continue;
    try {
      if (crypto.timingSafeEqual(expected, cand)) {
        if (ts) {
          const tsNum = parseInt(ts, 10);
          const now = Math.floor(Date.now() / 1000);
          if (Math.abs(now - tsNum) > 300) {
            console.error('⚠️ Timestamp fora da tolerância');
            return { ok: false, reason: 'timestamp out of tolerance', ts };
          }
        }
        return { ok: true, ts, id: dataId };
      }
    } catch (e) {
      console.error('❌ Erro ao comparar assinaturas:', e);
    }
  }

  console.error('❌ Assinatura inválida.');
  return { ok: false, reason: 'signature mismatch', ts, id: dataId };
}

// ─── Disparo de mensagem automática ──────────────────────────────────────────
// fix #7: fetchWithTimeout com 8s para não travar o handler do webhook
// fix #11: código morto (loop comentado) removido
// fix #13: esta é a versão autoritativa backend de aplicarPlaceholders

async function dispararMensagemAutomatica(momento, dados) {
  try {
    const snapshot = await db.collection('respostas_automaticas')
      .where('momento_envio', '==', momento)
      .where('ativo', '==', true)
      .where('enviar_automaticamente', '==', true)
      .get();

    if (snapshot.empty) return;

    const doc = snapshot.docs[0];
    if (!doc) return;
    const msg = doc.data();

    const mensagemHtml = aplicarPlaceholders(msg.mensagem_html, dados);

    await fetchWithTimeout(
      `${process.env.NEXT_PUBLIC_BASE_URL}/api/enviarEmail`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: dados.nome,
          email: dados.email,
          assunto: msg.titulo,
          mensagemHtml
        })
      },
      8000   // 8s — não bloqueia o handler além desse tempo
    );
  } catch (error) {
    console.error('❌ Erro no disparo automático:', error);
  }
}

// ─── Ativação de sessão pós-pagamento ──────────────────────────────────────
async function _handleAtivarSessao(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, message: 'Método não permitido.' });
 
  const { uid, session_token } = req.body || {};
  if (!uid || !session_token) {
    return json(res, 400, { ok: false, message: 'uid e session_token obrigatórios.' });
  }
 
  const ua      = req.headers['user-agent'] || '';
  const uaHash  = crypto.createHash('md5').update(ua.slice(0, 80)).digest('hex').slice(0, 8);
 
  try {
    const usuarioRef  = db.collection('usuarios').doc(uid);
    const usuarioSnap = await usuarioRef.get();
 
    if (!usuarioSnap.exists) {
      return json(res, 404, { ok: false, message: 'Usuário não encontrado.' });
    }
 
    const usuarioData = usuarioSnap.data();
    const pst         = usuarioData.pending_session_token;
 
    // Validações do token de ativação
    if (!pst || pst.usado) {
      return json(res, 400, { ok: false, message: 'Token inválido ou já utilizado.' });
    }
    if (pst.exp < Date.now()) {
      return json(res, 400, { ok: false, message: 'Link expirado. Entre em contato para solicitar um novo acesso.' });
    }
    if (pst.token !== session_token) {
      return json(res, 400, { ok: false, message: 'Token inválido.' });
    }
 
    const { assinaturaId } = pst;
 
    // Busca dados atuais da assinatura
    const assinaturaSnap = await db.collection('usuarios').doc(uid)
      .collection('assinaturas').doc(assinaturaId).get();
    if (!assinaturaSnap.exists) {
      return json(res, 404, { ok: false, message: 'Assinatura não encontrada.' });
    }
    const assinaturaData = assinaturaSnap.data();
 
    // Controle de sessões ativas: máximo 3 por assinante
    // Se já existem 3, desativa a que ficou mais tempo sem acesso
    const sessoesSnap = await usuarioRef.collection('sessoes')
      .where('ativo', '==', true).get();
 
    if (sessoesSnap.size >= 3) {
      const ordenadas = sessoesSnap.docs.sort((a, b) => {
        const ta = a.data().ultimo_acesso?.toMillis?.() || 0;
        const tb = b.data().ultimo_acesso?.toMillis?.() || 0;
        return ta - tb; // mais antiga primeiro
      });
      await ordenadas[0].ref.update({
        ativo: false,
        desativado_motivo: 'limite_dispositivos',
        desativado_em: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
 
    // Cria nova sessão
    const sessionId = crypto.randomUUID();
    await usuarioRef.collection('sessoes').doc(sessionId).set({
      criado_em:    admin.firestore.FieldValue.serverTimestamp(),
      ultimo_acesso: admin.firestore.FieldValue.serverTimestamp(),
      ua_hash:      uaHash,
      ativo:        true,
      assinaturaId,
      acessos_ua_distintos: 0,
      compartilhamento_suspeito: false,
    });
 
    // Invalida o token de ativação (uso único)
    await usuarioRef.update({ 'pending_session_token.usado': true });
 
    return json(res, 200, {
      ok:             true,
      session_id:     sessionId,
      uid,
      assinaturaId,
      segmento:       'assinante',
      plano_slug:     assinaturaData.plano_slug   || null,
      features:       assinaturaData.features_snapshot || assinaturaData.features || {},
      nome:           usuarioData.nome            || '',
      email:          usuarioData.email           || '',
      cod_uf:         usuarioData.cod_uf          || '',
      cod_municipio:  usuarioData.cod_municipio   || '',
      nome_municipio: usuarioData.nome_municipio  || '',
      perfil:         usuarioData.perfil          || '',
    });
 
  } catch (err) {
    console.error('[ativar-sessao] Erro:', err.message);
    return json(res, 500, { ok: false, message: 'Erro interno ao ativar sessão.' });
  }
}
 
// ─── Validação periódica de sessão (chamado a cada 24h pelo app) ───────────
async function _handleValidarSessao(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, message: 'Método não permitido.' });
 
  const { uid, session_id } = req.body || {};
  if (!uid || !session_id) {
    return json(res, 400, { ok: false, message: 'uid e session_id obrigatórios.' });
  }
 
  const ua     = req.headers['user-agent'] || '';
  const uaHash = crypto.createHash('md5').update(ua.slice(0, 80)).digest('hex').slice(0, 8);
 
  try {
    const sessaoRef  = db.collection('usuarios').doc(uid).collection('sessoes').doc(session_id);
    const sessaoSnap = await sessaoRef.get();
 
    if (!sessaoSnap.exists || !sessaoSnap.data().ativo) {
      return json(res, 200, { valido: false, motivo: 'sessao_invalida' });
    }
 
    const sessaoData = sessaoSnap.data();
    const agora      = Date.now();
    const updates    = { ultimo_acesso: admin.firestore.FieldValue.serverTimestamp() };
 
    // Detecção de compartilhamento: UA diferente em menos de 1h
    if (sessaoData.ua_hash && sessaoData.ua_hash !== uaHash) {
      const ultimoAcessoMs = sessaoData.ultimo_acesso?.toMillis?.() || 0;
      if (agora - ultimoAcessoMs < 60 * 60 * 1000) {
        const distintos = (sessaoData.acessos_ua_distintos || 0) + 1;
        updates.acessos_ua_distintos       = distintos;
        updates.ua_hash                    = uaHash;
        // Flag para revisão manual — não bloqueia automaticamente
        if (distintos >= 3) updates.compartilhamento_suspeito = true;
      } else {
        updates.ua_hash = uaHash; // troca de dispositivo legítima após 1h
      }
    }
 
    await sessaoRef.update(updates);
 
    // Verifica status atual da assinatura (pode ter sido cancelada)
    const assinaturaId = sessaoData.assinaturaId;
    let plano_slug     = null;
    let features       = {};
    let statusAss      = null;
 
    if (assinaturaId) {
      try {
        const assnSnap = await db.collection('usuarios').doc(uid)
          .collection('assinaturas').doc(assinaturaId).get();
        if (assnSnap.exists) {
          const d    = assnSnap.data();
          plano_slug = d.plano_slug || null;
          features   = d.features_snapshot || d.features || {};
          statusAss  = d.status || null;
        }
      } catch (e) { /* não fatal */ }
    }
 
    // Assinatura inativa → invalida sessão
    const statusAtivos = ['ativa', 'aprovada', 'pago'];
    if (statusAss && !statusAtivos.includes(statusAss)) {
      await sessaoRef.update({ ativo: false, desativado_motivo: 'assinatura_inativa' });
      return json(res, 200, { valido: false, motivo: 'assinatura_inativa' });
    }
 
    return json(res, 200, { valido: true, plano_slug, features, assinaturaId });
 
  } catch (err) {
    console.error('[validar-sessao] Erro:', err.message);
    // Em erro de rede/servidor, retorna 500 para o cliente NÃO invalidar a sessão local
    return json(res, 500, { ok: false, message: 'Erro interno ao validar sessão.' });
  }
}
// ─── Helpers de formatação e placeholders ─────────────────────────────────────

function formatDateBR(date) {
  if (!date) return '';
  const d = new Date(date.seconds ? date.seconds * 1000 : date);
  return d.toLocaleDateString('pt-BR');
}

// fix #13: versão autoritativa backend — manter sincronizado com functions.js
function aplicarPlaceholders(template, dados) {
  if (!template) return '';
  const nome = dados.nome || '(nome não informado)';
  const email = dados.email || '(email não informado)';
  const edicao = dados.edicao || '(sem edição)';
  let tipo = '(sem tipo)';
  if (Array.isArray(dados.interesses) && dados.interesses.length > 0) {
    tipo = dados.interesses.join(', ');
  } else if (dados.tipo) {
    tipo = dados.tipo;
  }
  const titulo = dados.titulo || '(sem título)';
  const newsletterId = dados.newsletterId || '(sem newsletterId)';
  const envioId = dados.envioId || '(sem envioId)';
  const destinatarioId = dados.destinatarioId || '(sem destinatarioId)';
  const cod_uf = dados.cod_uf || '(sem UFId)';
  const nome_municipio = dados.nome_municipio || '(sem municipioId)';
  const cargo = dados.tipo_perfil || dados.perfil || '(sem cargoId)';
  const interesse = dados.interesse || '(sem interesse)';
  const interesseId = dados.interesseId || '(sem interesseId)';
  const token = dados.token_acesso || '(sem token)';
  const link_ativacao = dados.link_ativacao || '(sem link de ativação)';
  const plano = dados.plano || '(sem plano)';
  const data_assinatura = dados.data_assinatura
    ? (dados.data_assinatura instanceof Date
      ? dados.data_assinatura.toLocaleDateString('pt-BR')
      : String(dados.data_assinatura))
    : '(sem data de assinatura)';

  let dataFormatada = '';
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
    .replace(/{{link_ativacao}}/gi, dados.link_ativacao || '')
    .replace(/{{data_assinatura}}/gi, data_assinatura);
}

function _textoBoasVindas(nome, plano, linkAtivacao) {
  const primeiroNome = (nome || '').split(' ')[0] || 'olá';
  return [
    `✅ *Radar SIOPE* — Assinatura confirmada!`,
    ``,
    `Olá, ${primeiroNome}! Sua assinatura do plano *${plano}* foi ativada com sucesso.`,
    ``,
    `Acesse agora sua primeira edição pelo link abaixo:`,
    `👉 ${linkAtivacao}`,
    ``,
    `⚠️ _Este link é de uso único e válido por 72h. Após o primeiro acesso, o app fica salvo no seu dispositivo._`,
    ``,
    `Qualquer dúvida, responda esta mensagem.`,
    `*Equipe Radar SIOPE*`,
  ].join('\n');
}

// ─── Gerador de mensagem WA com links dos grupos ─────────────────────────────
function _gerarMensagemBoasVindasWA(nome, plano, linkAtivacao, temAlertasPrioritarios) {
  const primeiroNome = (nome || '').split(' ')[0] || 'Olá';
  const partes = [
    `✅ *Radar SIOPE* — Assinatura confirmada!`,
    ``,
    `Olá, ${primeiroNome}! Sua assinatura do plano *${plano}* foi ativada com sucesso.`,
    ``,
    `Acesse agora sua primeira edição pelo link abaixo:`,
    `👉 ${linkAtivacao}`,
    ``,
    `⚠️ _Este link é de uso único e válido por 72h. Após o primeiro acesso, o app fica salvo no seu dispositivo._`
  ];

  // Grupo Avisos (sempre incluído, se configurado)
  const linkAvisos = process.env.WA_GRUPO_AVISOS_LINK;
  if (linkAvisos) {
    partes.push(``, `📢 Participe do nosso grupo de *Avisos* para receber novidades e atualizações:`);
    partes.push(`👉 ${linkAvisos}`);
  }

  // Grupo Alertas (apenas se tiver a feature)
  if (temAlertasPrioritarios) {
    const linkAlertas = process.env.WA_GRUPO_ALERTAS_LINK;
    if (linkAlertas) {
      partes.push(``, `🔔 Como você possui a feature *Alertas Prioritários*, entre também no grupo exclusivo:`);
      partes.push(`👉 ${linkAlertas}`);
    }
  }

  partes.push(``, `Qualquer dúvida, responda esta mensagem.`, `*Equipe Radar SIOPE*`);
  return partes.join('\n');
}

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  try {
    if (process.env.MP_DEBUG === 'true') {
      console.info('DEBUG MP token type:', getMpTokenType());
    }

    // Ler raw body como string (necessário para HMAC e para webhooks)
    const rawBody = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', err => reject(err));
    });

    // Validar assinatura apenas para webhooks (não para criar-pedido / status-pedido)
    const acao = (req.query && req.query.acao) ? String(req.query.acao) : null;
    const acoesPublicas = ['criar-pedido', 'status-pedido', 'ativar-sessao', 'validar-sessao'];

    if (!acao || !acoesPublicas.includes(acao)) {
      const sigCheck = validateMpWebhookSignature(rawBody, req);
      if (!sigCheck.ok) {
        console.warn('Webhook assinatura inválida:', sigCheck.reason, 'ts:', sigCheck.ts || null);
        return json(res, 200, { ok: true, message: 'signature invalid (ignored)' });
      }
    }

    // Parsear body JSON para rotas que recebem JSON
    try {
      if (rawBody && rawBody.length > 0 &&
        req.headers['content-type']?.includes('application/json')) {
        req.body = JSON.parse(rawBody);
      }
    } catch (e) { /* ok — manter rawBody para auditoria */ }

    // ── GET ?acao=status-pedido ── fix #10 ────────────────────────────────────
    if (req.method === 'GET' && acao === 'status-pedido') {
      const { userId, assinaturaId, pedidoId } = req.query;
      if (!userId || !assinaturaId || !pedidoId) {
        return json(res, 400, { ok: false, message: 'userId, assinaturaId e pedidoId são obrigatórios.' });
      }
      const pedidoSnap = await db.collection('usuarios').doc(userId)
        .collection('assinaturas').doc(assinaturaId)
        .collection('pedidos_mp').doc(pedidoId).get();

      if (!pedidoSnap.exists) {
        return json(res, 404, { ok: false, message: 'Pedido não encontrado.' });
      }
      const pd = pedidoSnap.data();
      return json(res, 200, {
        ok: true,
        pedidoId,
        status: pd.status,
        mpStatus: pd.mpStatus || null,
        mpPaymentMethod: pd.mpPaymentMethod || null,
        mpInstallments: pd.mpInstallments || null,
        atualizadoEm: pd.atualizadoEm || null
      });
    }

    // ── POST ?acao=ativar-sessao ──────────────────────────────────────────
    if (req.method === 'POST' && acao === 'ativar-sessao') {
      return _handleAtivarSessao(req, res);
    }
 
    // ── POST ?acao=validar-sessao ─────────────────────────────────────────
    if (req.method === 'POST' && acao === 'validar-sessao') {
      return _handleValidarSessao(req, res);
    }

    // ── POST ?acao=criar-pedido ───────────────────────────────────────────────
    if (req.method === 'POST' && acao === 'criar-pedido') {
      const body = req.body || {};
      const { userId, assinaturaId } = body;
      const amountCentavos = parseInt(body.amountCentavos, 10);
      const descricao = body.descricao || 'Assinatura';
      const installmentsMax = body.installmentsMax ? Math.max(1, parseInt(body.installmentsMax, 10)) : 1;
      const dataPrimeiroVencimento = body.dataPrimeiroVencimento || null;
      const nome = body.nome || '';
      const email = body.email || '';
      const cpf = body.cpf || '';

      // fix #14: validar parâmetros incluindo valor mínimo de R$ 0,50
      if (!userId || !assinaturaId) {
        return json(res, 400, { ok: false, message: 'userId e assinaturaId são obrigatórios.' });
      }
      if (!amountCentavos || isNaN(amountCentavos) || amountCentavos < 50) {
        return json(res, 400, { ok: false, message: 'amountCentavos deve ser um número ≥ 50 (mínimo R$ 0,50).' });
      }

      // fix #9: validar back_urls antes de chamar o MP
      const backUrlSuccess = process.env.MP_BACK_URL_SUCCESS;
      const backUrlFailure = process.env.MP_BACK_URL_FAILURE;
      const backUrlPending = process.env.MP_BACK_URL_PENDING || '';
      const notifUrl = process.env.MP_WEBHOOK_URL;

      if (!backUrlSuccess || !backUrlFailure || !notifUrl) {
        console.error('Variáveis MP_BACK_URL_SUCCESS, MP_BACK_URL_FAILURE ou MP_WEBHOOK_URL não configuradas.');
        return json(res, 500, { ok: false, message: 'Configuração de URLs do Mercado Pago incompleta no servidor.' });
      }

      // fix #5: verificar no backend se já existe assinatura ativa (proteção server-side)
      try {
        const assSnap = await db.collection('usuarios').doc(userId)
          .collection('assinaturas')
          .where('status', 'in', ['ativa', 'aprovada'])
          .limit(1).get();
        if (!assSnap.empty) {
          return json(res, 409, { ok: false, message: 'Usuário já possui assinatura ativa.' });
        }
      } catch (err) {
        console.warn('[criar-pedido] Verificação de assinatura ativa falhou (não bloqueante):', err.message);
      }

      const pedidosRef = db.collection('usuarios').doc(userId)
        .collection('assinaturas').doc(assinaturaId)
        .collection('pedidos_mp');

      const novoPedidoRef = pedidosRef.doc();
      await novoPedidoRef.set({
        userId,
        assinaturaId,
        amountCentavos,
        descricao,
        installmentsMax,
        status: 'pendente',
        criadoEm: admin.firestore.FieldValue.serverTimestamp()
      });

      const external_reference = montarExternalReference(userId, assinaturaId, novoPedidoRef.id);
      const cpfNormalizado = (cpf || '').replace(/\D/g, '');

      // fix #12: extrair primeiro nome e sobrenome do nome completo
      const nomePartes = nome.trim().split(' ');
      const primeiroNome = nomePartes[0] || nome;
      const sobrenome = nomePartes.length > 1 ? nomePartes.slice(1).join(' ') : '';

      const preferencePayload = {
        items: [{
          id: novoPedidoRef.id,
          title: descricao,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: amountCentavos / 100
        }],
        payer: {
          name: primeiroNome,
          surname: sobrenome,       // fix #12: sobrenome extraído do nome completo
          email,
          identification: { type: 'CPF', number: cpfNormalizado }
        },
        external_reference,
        binary_mode: true,
        auto_return: 'approved',
        back_urls: {
          success: backUrlSuccess,
          failure: backUrlFailure,
          pending: backUrlPending
        },
        notification_url: notifUrl,
        // fix #1: installments e excluded_payment_types dentro de payment_methods
        payment_methods: {
          installments: installmentsMax,
          excluded_payment_types: [{ id: 'ticket' }]
        }
      };

      let mpResp;
      try {
        mpResp = await mpFetch('/checkout/preferences', 'POST', preferencePayload);
      } catch (err) {
        console.error('Erro ao criar preference no Mercado Pago:', err.message || err);
        await novoPedidoRef.set({
          status: 'erro_mp',
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          mpError: err.body || String(err)
        }, { merge: true });
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

      // Gerar registro de pagamento — doc único com valor total e número de parcelas
      try {
        await registrarPagamentoPendente(
          userId, assinaturaId, amountCentavos,
          installmentsMax, null, novoPedidoRef.id
        );
      } catch (err) {
        console.warn('Falha ao registrar pagamento pendente:', err.message || err);
      }

      return json(res, 200, { ok: true, redirectUrl: initPoint, pedidoId: novoPedidoRef.id });
    }

    // ── POST webhook (MP notificação) ─────────────────────────────────────────
    if (req.method === 'POST' && !acao) {
      const topic = req.query.topic || req.query.type ||
        (req.body && (req.body.topic || req.body.type)) || null;
      const id = req.query.id || req.query.notification_id ||
        (req.body && (req.body.id || (req.body.data && req.body.data.id))) || null;

      if (!topic || !id) {
        return json(res, 200, { ok: true, message: 'notificação recebida (sem topic/id)' });
      }

      const notifId = `${topic}_${id}`;

      // fix #6: idempotência antecipada via transação na coleção global,
      // antes de qualquer chamada à API do MP
      const globalNotifRef = db.collection('notificacoes_mp_global').doc(notifId);
      let outroProcessoJaIniciou = false;
      try {
        outroProcessoJaIniciou = await db.runTransaction(async (tx) => {
          const snap = await tx.get(globalNotifRef);
          if (snap.exists) return true; // outro processo já registrou esta notificação
          tx.set(globalNotifRef, {
            topic,
            id,
            recebidoEm: admin.firestore.FieldValue.serverTimestamp(),
            processado: false
          });
          return false;
        });
      } catch (e) {
        // falha na transação não deve bloquear o processamento — apenas logar
        console.warn('[webhook] Falha na idempotência global antecipada:', e.message);
      }
      if (outroProcessoJaIniciou) {
        return json(res, 200, { ok: true, message: 'já processado' });
      }

      // Resolver recurso no MP
      let resolved = null;
      try {
        resolved = await resolverRecursoMP(id, topic);
      } catch (err) {
        console.warn('Falha ao buscar recurso no Mercado Pago:', err.message || err);
        return json(res, 200, { ok: true, message: 'notificação recebida (erro ao buscar MP)' });
      }

      if (!resolved) {
        await globalNotifRef.set({ resolved: false }, { merge: true });
        return json(res, 200, { ok: true, message: 'mp resource not found (simulação ou id inválido)' });
      }

      let effectiveId = String(id);
      let mpData = resolved.data;

      // Se merchant_order com payment interno: buscar o payment real
      if (resolved.tipo === 'merchant_order') {
        const mo = mpData;
        if (!mo.external_reference && mo.order && mo.order.external_reference) {
          mo.external_reference = mo.order.external_reference;
        }
        const payId = mo.payments && mo.payments[0] && mo.payments[0].id;
        if (payId) {
          try {
            const payment = await mpFetch(`/v1/payments/${encodeURIComponent(payId)}`, 'GET');
            mpData = payment;
            resolved.tipo = 'payment';
            effectiveId = String(payment.id);
          } catch (err) {
            console.warn('Falha ao buscar payment dentro do merchant_order:', err && err.message ? err.message : err);
          }
        }
      }

      const externalRef = mpData.external_reference ||
        (mpData.order && mpData.order.external_reference) || null;

      if (!externalRef) {
        await globalNotifRef.set({ resolved: false, motivo: 'sem external_reference' }, { merge: true });
        return json(res, 200, { ok: true, message: 'sem external_reference' });
      }

      const parsed = parseExternalReference(externalRef);
      if (!parsed) {
        await globalNotifRef.set({ resolved: false, motivo: 'external_reference inválido' }, { merge: true });
        return json(res, 200, { ok: true, message: 'external_reference inválido' });
      }

      const { userId, assinaturaId, pedidoId } = parsed;

      // fix #8: salvar notificação SEMPRE em notificacoes_mp (com mais ou menos dados)
      // remove a bifurcação que descartava histórico em produção (logCompleto=false)
      const notifRef = db.collection('usuarios').doc(userId)
        .collection('assinaturas').doc(assinaturaId)
        .collection('notificacoes_mp').doc(notifId);

      const notifSnap = await notifRef.get();
      if (notifSnap.exists) {
        return json(res, 200, { ok: true, message: 'já processado' });
      }

      await notifRef.set(logCompleto()
        ? { topic, id, mpData, recebidoEm: admin.firestore.FieldValue.serverTimestamp(), resolvedTipo: resolved.tipo }
        : { topic, id, mpStatus: mpData.status || mpData.payment_status || null, recebidoEm: admin.firestore.FieldValue.serverTimestamp() }
      );

      // Atualizar pedido
      const pedidoRef = db.collection('usuarios').doc(userId)
        .collection('assinaturas').doc(assinaturaId)
        .collection('pedidos_mp').doc(pedidoId);

      const pedidoSnap = await pedidoRef.get();
      if (!pedidoSnap.exists) {
        console.warn('Pedido não encontrado para external_reference:', externalRef);
        await globalNotifRef.set({ processado: true, motivo: 'pedido não encontrado' }, { merge: true });
        return json(res, 200, { ok: true, message: 'processado' });
      }

      const mpStatus = mpData.status || mpData.payment_status || null;
      let novoStatusPedido = 'pendente';

      if (['payment', 'payment_search', 'payment_search_ext'].includes(resolved.tipo)) {
        if (mpStatus === 'approved' || mpStatus === 'paid') novoStatusPedido = 'pago';
        else if (mpStatus === 'pending') novoStatusPedido = 'pendente';
        else if (['cancelled', 'rejected', 'refunded'].includes(mpStatus)) novoStatusPedido = 'falha';
      }
      if (resolved.tipo === 'merchant_order') novoStatusPedido = 'pendente';

      const updateObj = {
        status: novoStatusPedido,
        mpStatus,
        mpPaymentMethod: mpData.payment_method_id || null,
        mpInstallments: (mpData.installments && Number(mpData.installments)) ? Number(mpData.installments) : 1,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
      };
      if (resolved.tipo === 'payment') updateObj.mpPaymentId = effectiveId;
      else if (resolved.tipo === 'merchant_order') updateObj.mpMerchantOrderId = id;

      await pedidoRef.set(updateObj, { merge: true });

      // Atualizar registro de pagamento — update direto no doc do pedido
      const pagamentosRef = db.collection('usuarios').doc(userId)
        .collection('assinaturas').doc(assinaturaId)
        .collection('pagamentos');

      const installments = (mpData.installments && Number(mpData.installments)) ? Number(mpData.installments) : 1;

      await pagamentosRef.doc(pedidoId).set({
        status: novoStatusPedido,
        num_parcelas: installments,
        data_pagamento: novoStatusPedido === 'pago' ? admin.firestore.FieldValue.serverTimestamp() : null,
        mpPaymentId: effectiveId,
        mpPaymentMethod: mpData.payment_method_id || null,
        tipoNotificacao: resolved.tipo,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // fix #3: usar assinRef como única referência ao doc da assinatura
      // fix #4: 'falha' → 'pagamento_recusado' (não confundir com cancelamento intencional)
      const assinRef = db.collection('usuarios').doc(userId)
        .collection('assinaturas').doc(assinaturaId);

      if (novoStatusPedido === 'pago') {
        await assinRef.set({
          status: 'ativa',
          paymentProvider: 'mercadopago',
          orderId: pedidoId,
          ativadoEm: admin.firestore.FieldValue.serverTimestamp(),
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Ativar o campo "ativo" no documento principal do usuário
        await db.collection('usuarios').doc(userId).update({ ativo: true });

        // Gera token de ativação de sessão (uso único, válido 72h)
        // Será incluído no link de boas-vindas enviado ao assinante
        const _sessionToken = crypto.randomBytes(32).toString('hex');
        await db.collection('usuarios').doc(userId).set({
          pending_session_token: {
            token:        _sessionToken,
            exp:          Date.now() + 72 * 60 * 60 * 1000, // 72h em ms
            assinaturaId,
            usado:        false,
            criado_em:    admin.firestore.FieldValue.serverTimestamp(),
          }
        }, { merge: true });

        // Buscar dados para e-mail de confirmação
        const assinaturaDoc = await assinRef.get();
        const assinaturaData = assinaturaDoc.exists ? assinaturaDoc.data() : {};
        const usuarioDoc = await db.collection('usuarios').doc(userId).get();
        const usuarioData = usuarioDoc.exists ? usuarioDoc.data() : {};

        let nomePlano = '(plano não informado)';
        if (assinaturaData.planId) {
          try {
            const planoDoc = await db.collection('planos').doc(assinaturaData.planId).get();
            if (planoDoc.exists) nomePlano = planoDoc.data().nome || nomePlano;
          } catch (e) { /* não fatal */ }
        }

        // fix #3: controle de idempotência de envio usando apenas assinRef
        const logKey = `enviosAutomaticos.${String(pedidoId)}`;
        let devoEnviar = false;
        try {
          devoEnviar = await db.runTransaction(async (tx) => {
            const snap = await tx.get(assinRef);
            const data = snap.exists ? snap.data() : {};
            if (data?.enviosAutomaticos?.[String(pedidoId)]) return false;
            const payload = {};
            payload[logKey] = {
              momento: 'pos_cadastro_assinante',
              email: usuarioData?.email || mpData.payer?.email || '(email não informado)',
              status: 'iniciado',
              criadoEm: admin.firestore.FieldValue.serverTimestamp()
            };
            tx.set(assinRef, payload, { merge: true });
            return true;
          });
        } catch (err) {
          console.error('Erro na transação de marcação de envio:', err && err.message ? err.message : err);
          devoEnviar = false;
        }

        if (devoEnviar) {
          const linkAtivacao = `${process.env.NEXT_PUBLIC_BASE_URL}/verNewsletterComToken.html?ativar=${_sessionToken}&uid=${userId}`;
          const nomeAssinante = usuarioData?.nome || mpData.payer?.first_name || assinaturaData?.nome || '';
          const emailAssinante = usuarioData?.email || mpData.payer?.email || '(email não informado)';
          const whatsappAssinante = usuarioData?.whatsapp || null;
 
          // ── E-mail (comportamento existente, mantido) ──────────────────────
          const emailPromise = dispararMensagemAutomatica('pos_cadastro_assinante', {
            userId,
            assinaturaId,
            nome:            nomeAssinante,
            email:           emailAssinante,
            plano:           nomePlano,
            data_assinatura: new Date(),
            link_ativacao:   linkAtivacao,
          }).catch(err => {
            console.error('[pagamentoMP] Erro no e-mail de boas-vindas:', err?.message || err);
          });
 
          // ── WhatsApp (com links dos grupos) ─────────────────────────────────
          const temAlertasPrioritarios = assinaturaData.features_snapshot?.alertas_prioritarios === true;
          const mensagemWA = _gerarMensagemBoasVindasWA(nomeAssinante, nomePlano, linkAtivacao, temAlertasPrioritarios);

          const whatsappPromise = whatsappAssinante
            ? enviarWhatsApp(whatsappAssinante, mensagemWA, { tentativas: 2, timeoutMs: 8000 })
                .catch(err => { console.warn('[pagamentoMP] Erro no WhatsApp de boas-vindas:', err?.message || err); })
            : Promise.resolve();
    
          // Dispara os dois em paralelo — falha de um não bloqueia o outro
          await Promise.allSettled([emailPromise, whatsappPromise]);
 
          const successPayload = {};
          successPayload[logKey] = {
            momento:    'pos_cadastro_assinante',
            email:      emailAssinante,
            whatsapp:   whatsappAssinante ? 'enviado' : 'sem_numero',
            status:     'enviado',
            enviadoEm:  admin.firestore.FieldValue.serverTimestamp(),
          };
          await assinRef.set(successPayload, { merge: true });
 
        } else {
          if (logCompleto()) console.info('Envio já registrado para pedidoId:', pedidoId);
        }

      } else if (novoStatusPedido === 'falha') {
        // fix #4: pagamento recusado ≠ cancelamento intencional
        // usar 'pagamento_recusado' para que o usuário possa tentar novamente
        await assinRef.set({
          status: 'pagamento_recusado',
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

      } else if (novoStatusPedido === 'pendente') {
        await assinRef.set({
          status: 'pendente_pagamento',
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      // Marcar notificação global como processada (fix #6)
      await globalNotifRef.set({ processado: true }, { merge: true });

      return json(res, 200, { ok: true, message: 'processado' });
    }

    // Rota inválida
    return json(res, 400, { ok: false, message: 'Rota inválida. Use ?acao=criar-pedido, ?acao=status-pedido ou envie webhook do MP.' });

  } catch (err) {
    console.error('Erro pagamentoMP:', err && err.message ? err.message : err);
    return json(res, 500, { ok: false, message: 'Erro interno', detail: String(err && err.message ? err.message : err) });
  }
}
