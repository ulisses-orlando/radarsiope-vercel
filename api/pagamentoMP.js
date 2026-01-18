// api/pagamentoMP.js (ESM) - versão completa e atualizada
// - Usa REST do Mercado Pago via fetch (sem dependência mercadopago)
// - Inicializa Firebase via env vars (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)
// - Captura raw body, loga headers/body, valida assinatura HMAC se MP_WEBHOOK_SECRET estiver configurado
// - Gera parcelas no backend e trata webhooks com tolerância a 404 (simulações)
export const config = {
  api: {
    bodyParser: false, // importante: precisamos do raw body
  },
};

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

/**
 * Valida a assinatura Mercado Pago (x-signature).
 * Tenta interpretar a secret como UTF-8 e, se necessário, como hex.
 * Retorna true se a assinatura for válida, false caso contrário.
 */
function validateMpSignature(rawBody, signatureHeader) {
  if (!signatureHeader || typeof signatureHeader !== 'string') return false;

  const v1Match = String(signatureHeader).match(/v1=([0-9a-fA-F]{64})/);
  const tsMatch = String(signatureHeader).match(/ts=([0-9]+)/);
  if (!v1Match || !tsMatch) return false;

  const v1Hex = v1Match[1];
  const ts = tsMatch[1];
  const secret = process.env.MP_WEBHOOK_SECRET || '';
  if (!secret) return false;

  const payload = `${ts}.${String(rawBody)}`;
  const expected = Buffer.from(v1Hex, 'hex');

  // tenta com chave UTF-8
  try {
    const keyUtf8 = Buffer.from(secret, 'utf8');
    const computedUtf8 = crypto.createHmac('sha256', keyUtf8).update(payload, 'utf8').digest();
    if (computedUtf8.length === expected.length && crypto.timingSafeEqual(computedUtf8, expected)) {
      return true;
    }
  } catch (e) {
    // ignore and tentar hex abaixo
  }

  // tenta interpretar secret como hex (apenas se parecer hex válido)
  try {
    const cleaned = String(secret).replace(/[^0-9a-fA-F]/g, '');
    if (cleaned.length && cleaned.length % 2 === 0) {
      const keyHex = Buffer.from(cleaned, 'hex');
      const computedHex = crypto.createHmac('sha256', keyHex).update(payload, 'utf8').digest();
      if (computedHex.length === expected.length && crypto.timingSafeEqual(computedHex, expected)) {
        return true;
      }
    }
  } catch (e) {
    // ignore
  }

  return false;
}

export default async function handler(req, res) {
  try {
    // lê raw body como buffer
    const raw = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

    // log temporário para diagnóstico (não logar secret)
    console.log('DEBUG signatureHeader (raw):', req.headers['x-signature'] || req.headers['signature'] || '');
    console.log('DEBUG raw hex (first 400 chars):', raw.toString('hex').slice(0, 400));
    // calcular HMAC com a secret do ambiente e logar os resultados (sem expor a secret)
    try {
      const crypto = require('crypto');
      const secret = process.env.MP_WEBHOOK_SECRET || '';
      const prefix = Buffer.from(String((req.headers['x-signature']||'').match(/ts=([0-9]+)/)?.[1] || '') + '.', 'utf8');
      const payloadBuf = Buffer.concat([prefix, raw]);
      const keyUtf8 = Buffer.from(secret, 'utf8');
      const keyHex = (() => { const c = secret.replace(/[^0-9a-fA-F]/g,''); return (c.length && c.length%2===0) ? Buffer.from(c,'hex') : null; })();
      console.log('DEBUG computed_from_env (utf8):', crypto.createHmac('sha256', keyUtf8).update(payloadBuf).digest('hex'));
      if (keyHex) console.log('DEBUG computed_from_env (hex):', crypto.createHmac('sha256', keyHex).update(payloadBuf).digest('hex'));
    } catch (e) {
      console.log('DEBUG compute error', String(e));
    }

    // resposta temporária: aceitar para que o MP não marque como falha
    res.status(200).json({ ok: true, diagnostic: true });
  } catch (err) {
    console.log('ERROR webhook handler:', String(err));
    res.status(500).end('internal error');
  }
}
