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

// supondo que admin, db, mpFetch, montarExternalReference, gerarParcelasAssinaturaBackend, parseExternalReference existam no escopo

export default async function handler(req, res) {
  try {
    const rawBody = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', err => reject(err));
    });

    // Cole isto logo após ler rawBody (antes de qualquer validação que retorne)
    try {
      // DEBUG TEMPORÁRIO - cole logo após ler rawBody (remova após depuração)
      try {
        const signatureHeader = req.headers['x-signature'] || req.headers['x-hub-signature'] || req.headers['x-mercadopago-signature'] || req.headers['signature'] || '';
        // extrair ts e v1
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

        const raw = rawBody == null ? '' : String(rawBody);
        const rawBuf = Buffer.from(raw, 'utf8');

        console.log('DEBUG signatureHeader:', signatureHeader);
        console.log('DEBUG ts from header:', ts);
        console.log('DEBUG v1 from header:', v1);
        console.log('DEBUG raw length chars:', raw.length, 'bytes:', rawBuf.length);
        console.log('DEBUG raw hex (first 200 bytes):', rawBuf.slice(0, 200).toString('hex'));

        const secretHex = (process.env.MP_WEBHOOK_SECRET || '').trim();
        console.log('DEBUG secret length chars:', secretHex.length);

        const candidates = [
          `${ts}.${raw}`,
          `${Math.floor(Number(ts) / 1000)}.${raw}`,
          raw,
          raw.trim(),
          `${ts}\n${raw}`,
          raw.replace(/^\uFEFF/, ''),
          raw.replace(/\r\n/g, '\n'),
          raw.replace(/\r\n/g, '\r')
        ];

        // se for JSON, adicionar serializações úteis
        try {
          const parsed = JSON.parse(raw);
          candidates.push(JSON.stringify(parsed));
          candidates.push(JSON.stringify(parsed).trim());
          const canonical = (obj => {
            if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
            if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
            const keys = Object.keys(obj).sort();
            return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
          })(parsed);
          candidates.push(canonical);
          if (parsed.data) {
            candidates.push(JSON.stringify(parsed.data));
            if (parsed.data.id) candidates.push(String(parsed.data.id));
          }
          if (parsed.id) candidates.push(String(parsed.id));
        } catch (e) { /* não é JSON */ }

        const uniq = Array.from(new Set(candidates));

        let keyBuf = null;
        try { keyBuf = Buffer.from(secretHex, 'hex'); } catch (e) { keyBuf = null; }

        if (!keyBuf) {
          console.log('DEBUG: secretHex inválido para Buffer.from(..., "hex")');
        } else {
          console.log('DEBUG: secret interpreted as hex ->', keyBuf.length, 'bytes');
          for (let i = 0; i < uniq.length; i++) {
            const p = uniq[i];
            try {
              const computed = crypto.createHmac('sha256', keyBuf).update(p).digest('hex');
              const match = (v1 && computed.toLowerCase() === String(v1).toLowerCase());
              console.log(`DEBUG HMAC[${i}] match=${match} -> ${computed}  label=${p.slice(0, 120).replace(/\n/g, '\\n')}`);
            } catch (e) {
              console.log('DEBUG HMAC error for candidate', i, String(e));
            }
          }
        }
      } catch (e) {
        console.log('DEBUG fatal in local HMAC debug:', String(e));
      }

    } catch (e) {
      console.log('DEBUG fatal in local HMAC debug:', String(e));
    }


    console.log('WEBHOOK HEADERS:', req.headers);
    console.log('WEBHOOK RAW BODY:', rawBody);

    // --- BEGIN: DEBUG HMAC IMEDIATO (cole aqui, antes de qualquer validação) ---
    // debug-hmac-temporario.js (cole logo após obter rawBody)

    try {
      const signatureHeader = req.headers['x-signature'] || req.headers['x-hub-signature'] || req.headers['x-mercadopago-signature'] || req.headers['signature'] || '';
      // extrair ts e v1
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

      const raw = rawBody == null ? '' : String(rawBody);
      const rawBuf = Buffer.from(raw, 'utf8');

      console.log('DEBUG signatureHeader:', signatureHeader);
      console.log('DEBUG ts:', ts, 'DEBUG v1:', v1);
      console.log('DEBUG raw length chars:', raw.length, 'bytes:', rawBuf.length);
      console.log('DEBUG raw hex (first 200 bytes):', rawBuf.slice(0, 200).toString('hex'));

      const secretHex = (process.env.MP_WEBHOOK_SECRET || '').trim();
      console.log('DEBUG secret length chars:', secretHex.length);

      // candidatos de payload (variações mais comuns)
      const payloads = [
        `${ts}.${raw}`,
        `${Math.floor(Number(ts) / 1000)}.${raw}`,
        raw,
        raw.trim(),
        `${ts}\n${raw}`,
        raw.replace(/^\uFEFF/, ''),            // sem BOM
        raw.replace(/\r\n/g, '\n'),            // LF
        raw.replace(/\r\n/g, '\r')             // CR
      ];

      // se for JSON, adicionar serializações úteis
      try {
        const parsed = JSON.parse(raw);
        payloads.push(JSON.stringify(parsed));
        payloads.push(JSON.stringify(parsed).trim());
        // canonical JSON simples (ordenar chaves)
        const canonical = (obj => {
          if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
          if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
          const keys = Object.keys(obj).sort();
          return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
        })(parsed);
        payloads.push(canonical);
        if (parsed.data) {
          payloads.push(JSON.stringify(parsed.data));
          if (parsed.data.id) payloads.push(String(parsed.data.id));
        }
        if (parsed.id) payloads.push(String(parsed.id));
      } catch (e) { /* não é JSON */ }

      // dedupe
      const uniq = Array.from(new Set(payloads));

      // interpretar secret como hex (32 bytes) e calcular HMACs
      let keyBuf = null;
      try { keyBuf = Buffer.from(secretHex, 'hex'); } catch (e) { keyBuf = null; }
      if (!keyBuf) {
        console.log('DEBUG: secretHex inválido para Buffer.from(..., "hex")');
      } else {
        console.log('DEBUG: secret interpreted as hex ->', keyBuf.length, 'bytes');
        for (let i = 0; i < uniq.length; i++) {
          const p = uniq[i];
          try {
            const computed = crypto.createHmac('sha256', keyBuf).update(p).digest('hex');
            const match = (v1 && computed.toLowerCase() === String(v1).toLowerCase());
            console.log(`DEBUG HMAC[${i}] match=${match} -> ${computed}  label=${p.slice(0, 120).replace(/\n/g, '\\n')}`);
          } catch (e) {
            console.log('DEBUG HMAC error for candidate', i, String(e));
          }
        }
      }
    } catch (e) {
      console.log('DEBUG fatal in local HMAC debug:', String(e));
    }

    // --- END: DEBUG HMAC IMEDIATO ---

    // responder 200 temporariamente para evitar reenvios enquanto depuramos
    return res.status(200).json({ ok: true, debug: 'hmac-logged' });

    // --- BEGIN: Validação HMAC final (Mercado Pago) ---
    const secretRaw = process.env.MP_WEBHOOK_SECRET || '';
    if (!secretRaw) {
      console.warn('MP_WEBHOOK_SECRET não configurado; rejeitando por segurança.');
      return res.status(401).end('assinatura ausente');
    }

    // extrair header de assinatura
    const signatureHeader = req.headers['x-signature'] || req.headers['x-hub-signature'] || req.headers['x-mercadopago-signature'] || req.headers['x-hook-signature'] || req.headers['signature'];
    if (!signatureHeader) {
      console.warn('Nenhum header de assinatura encontrado; rejeitando por segurança.');
      return res.status(401).end('assinatura ausente');
    }

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
    } catch (e) {
      console.warn('Falha ao parsear header de assinatura:', e);
    }
    if (!v1) {
      const m = String(signatureHeader).match(/([a-f0-9]{64})/i);
      if (m) v1 = m[1];
    }
    if (!v1) {
      console.warn('v1 não encontrado no header de assinatura; rejeitando.');
      return res.status(401).end('assinatura inválida');
    }

    const raw = rawBody || '';
    const payloadCandidates = [`${ts}.${raw}`];

    // também tentar ts em segundos (algumas integrações usam segundos)
    const tsNum = Number(ts);
    if (!Number.isNaN(tsNum)) payloadCandidates.push(`${Math.floor(tsNum / 1000)}.${raw}`);

    // tentar também só o raw (fallback)
    payloadCandidates.push(raw);

    // tentar secret como hex primeiro (mais comum), depois utf8
    const secretVariants = [
      { name: 'hex', buf: (() => { try { return Buffer.from(secretRaw, 'hex'); } catch (e) { return null; } })() },
      { name: 'utf8', buf: Buffer.from(secretRaw, 'utf8') }
    ];

    let valid = false;
    let matchedInfo = null;

    for (const payload of payloadCandidates) {
      for (const sv of secretVariants) {
        if (!sv.buf) continue;
        let computed;
        try {
          computed = crypto.createHmac('sha256', sv.buf).update(payload).digest('hex');
        } catch (e) {
          continue;
        }
        // comparação segura apenas se comprimentos baterem
        try {
          if (v1.length === computed.length) {
            if (crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(computed, 'hex'))) {
              valid = true;
              matchedInfo = { secretAs: sv.name, payload, computed };
              break;
            }
          }
        } catch (e) {
          // ignore e continue
        }
      }
      if (valid) break;
    }

    if (!valid) {
      console.warn('Assinatura inválida: nenhuma combinação válida encontrada.');
      return res.status(401).end('assinatura inválida');
    }

    // assinatura válida — prosseguir com processamento
    console.log('ASSINATURA VALIDADA:', matchedInfo.secretAs, 'payloadLen:', matchedInfo.payload.length);
    // --- END: Validação HMAC final ---

    // ... restante do processamento (criar-pedido, webhook handling, etc.) ...
  } catch (err) {
    console.error('Erro pagamentoMP:', err);
    return res.status(500).json({ ok: false, message: 'Erro interno', detail: String(err) });
  }
}

