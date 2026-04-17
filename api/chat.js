// =============================================================================
// /api/chat.js  — Vercel Serverless Function
//
// Dependências npm necessárias (apenas uma):
//   "firebase-admin": "^12.x"
//
// Variáveis de ambiente na Vercel:
//   GEMINI_API_KEY         → chave do Google AI Studio
//   FIREBASE_PROJECT_ID    → ID do projeto Firebase
//   FIREBASE_CLIENT_EMAIL  → e-mail da service account
//   FIREBASE_PRIVATE_KEY   → chave privada da service account
//   SUPABASE_URL           → URL do projeto Supabase
//   SUPABASE_SERVICE_KEY   → service_role key do Supabase
// =============================================================================

import admin from 'firebase-admin';
import crypto from 'crypto';

// ── Cache em memória para respostas (válido por 5 minutos) ─────────────────
const cacheRespostas = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

function gerarCacheKey(pergunta, nid, municipio_cod) {
  const raw = `${pergunta.trim().toLowerCase()}|${nid}|${municipio_cod || ''}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

function buscarNoCache(key) {
  const item = cacheRespostas.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL_MS) {
    cacheRespostas.delete(key); // expirou
    return null;
  }
  return item.resposta;
}

function salvarNoCache(key, resposta) {
  cacheRespostas.set(key, {
    resposta,
    timestamp: Date.now()
  });
  // Limpeza preventiva se cache crescer muito
  if (cacheRespostas.size > 200) {
    const now = Date.now();
    for (const [k, v] of cacheRespostas) {
      if (now - v.timestamp > CACHE_TTL_MS) {
        cacheRespostas.delete(k);
      }
    }
  }
}

// ── Firebase Admin (lazy init com tratamento de erro) ────────────────────────
let db;

function getFirestore() {
  if (db) return db;

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\\\n/g, '\n').replace(/\\n/g, '\n')
      })
    });
  }

  db = admin.firestore();
  return db;
}

// ── Gemini API via fetch puro ───────────────────────────────────────────────
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

async function chamarGemini(systemPrompt, historico, pergunta, tentativas = 3) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('[chat] GEMINI_API_KEY ausente.');

  let lastError;

  for (let i = 0; i < tentativas; i++) {
    try {
      const contents = [
        ...historico.map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: String(m.text) }],
        })),
        { role: 'user', parts: [{ text: pergunta }] },
      ];

      const body = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 300,
          topP: 0.8,
        },
      };

      const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();

        // Retry com backoff exponencial para erro 429
        if (res.status === 429) {
          const retryAfter = res.headers.get('retry-after')
            ? parseInt(res.headers.get('retry-after'))
            : Math.min(30, Math.pow(2, i));
          console.log(`[chat] Quota excedida, retry em ${retryAfter}s (tentativa ${i + 1}/${tentativas})`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue;
        }

        throw new Error(`Gemini API erro ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const texto = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!texto) throw new Error('Resposta vazia do modelo.');
      return texto;

    } catch (err) {
      lastError = err;
      if (err.message.includes('429') && i < tentativas - 1) {
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('Falha após múltiplas tentativas na Gemini API');
}

// ── Limpa HTML para texto plano ───────────────────────────────────────────────
function htmlParaTexto(html = '') {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Extrai trechos mais relevantes para a pergunta (RAG simples) ─────────────
function extrairTrechosRelevantes(texto, pergunta, maxChars = 6000) {
  if (!texto || texto.length <= maxChars) return texto;

  // Tokeniza a pergunta em palavras significativas (≥4 chars)
  const stopwords = new Set([
    'para','como','qual','que','este','essa','este','isso','pelo','pela',
    'com','seu','sua','quando','onde','quem','mais','pode','deve','seria',
    'sobre','entre','ainda','também','após','antes','uma','com','do','da'
  ]);

  const palavras = pergunta
    .toLowerCase()
    .replace(/[^a-záéíóúâêîôûãõç\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stopwords.has(w));

  if (palavras.length === 0) return texto.slice(0, maxChars);

  // Divide em parágrafos/sentenças - regex CORRIGIDO
  const paragrafos = texto
    .split(/(?<=[.!?])\s+|\n{2,}/)  // ✅ \n{2,} em vez de {2,}
    .map(p => p.trim())
    .filter(p => p.length > 40);

  if (paragrafos.length === 0) return texto.slice(0, maxChars);

  // Pontua cada parágrafo por sobreposição de palavras-chave
  const pontuados = paragrafos.map(p => {
    const pLower = p.toLowerCase();
    const score = palavras.reduce((acc, w) => acc + (pLower.includes(w) ? 1 : 0), 0);
    return { p, score };
  });

  // Ordena por relevância, mantém ordem original entre empates
  const ordenados = [...pontuados]
    .map((item, idx) => ({ ...item, idx }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  // Monta o contexto priorizando os mais relevantes até o limite
  let resultado = '';
  for (const { p } of ordenados) {
    if (resultado.length + p.length + 2 > maxChars) break;
    resultado += p + '\n\n';
  }

  return resultado.trim() || texto.slice(0, maxChars);
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const {
    pergunta,
    nid,
    municipio_cod,
    uid,
    segmento,
    historico = [],
  } = req.body || {};

  // ── Validações ────────────────────────────────────────────────────────────
  if (!pergunta || typeof pergunta !== 'string' || !pergunta.trim()) {
    return res.status(400).json({ erro: 'Pergunta ausente.' });
  }
  if (!nid) {
    return res.status(400).json({ erro: 'ID da edição ausente.' });
  }
  if (segmento !== 'assinante') {
    return res.status(403).json({ erro: 'Recurso disponível apenas para assinantes.' });
  }
  if (pergunta.length > 500) {
    return res.status(400).json({ erro: 'Pergunta muito longa.' });
  }

  try {
    // ── 0. Inicializa Firestore ───────────────────────────────────────────
    const firestore = getFirestore();

    // ── 1. Busca edição no Firestore ──────────────────────────────────────
    const snap = await firestore.collection('newsletters').doc(nid).get();
    if (!snap.exists) {
      return res.status(404).json({ erro: 'Edição não encontrada.' });
    }

    const newsletter = snap.data();
    const numEdicao = newsletter.numero || newsletter.edicao || '';
    const tituloEdicao = newsletter.titulo || '';
    const conteudoTexto = extrairTrechosRelevantes(htmlParaTexto(newsletter.conteudo_html_completo || ''), pergunta);
    const bulletsList = (newsletter.resumo_bullets || []).join('\n- ');
    const faqTexto = (newsletter.faq || [])
      .map(f => `P: ${f.pergunta}\nR: ${f.resposta}`)
      .join('\n\n');

    // ── 2. Dados do município via Supabase ────────────────────────────────
    let dadosMunicipio = '';
    if (municipio_cod) {
      try {
        const sbUrl = process.env.SUPABASE_URL;
        const sbKey = process.env.SUPABASE_SERVICE_KEY;
        if (sbUrl && sbKey) {
          const mRes = await fetch(
            `${sbUrl}/rest/v1/vw_municipio_resumo` +
            `?cod_municipio=eq.${encodeURIComponent(municipio_cod)}&limit=1`,
            { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
          );
          if (mRes.ok) {
            const rows = await mRes.json();
            const m = rows?.[0];
            if (m) {
              dadosMunicipio = [
                `Município: ${m.nome_municipio || ''} / ${m.uf || ''}`,
                `Código IBGE: ${municipio_cod}`,
                m.perc_mde != null ? `MDE aplicado: ${m.perc_mde}%` : '',
                m.perc_fundeb != null ? `FUNDEB (70%): ${m.perc_fundeb}%` : '',
                m.situacao_siope ? `Situação SIOPE: ${m.situacao_siope}` : '',
              ].filter(Boolean).join('\n');
            }
          }
        }
      } catch (e) {
        console.warn('[chat] Falha ao buscar município:', e.message);
      }
    }

    // ── 3. Monta system prompt ────────────────────────────────────────────
    const systemPrompt = `
Você é o assistente do Radar SIOPE, newsletter especializada em financiamento da educação pública municipal brasileira.

REGRAS ABSOLUTAS:
1. Responda SOMENTE com base nas informações fornecidas abaixo.
2. Nunca invente dados, percentuais, datas, nomes de leis ou valores.
3. Se a pergunta não puder ser respondida com o contexto fornecido, responda exatamente: "Não tenho essa informação nesta edição."
4. Seja objetivo e claro. Use linguagem acessível para gestores municipais.
5. Nunca mencione que você é um modelo de IA ou que está usando um contexto.
6. Máximo de 3 parágrafos por resposta.

=== EDIÇÃO ${numEdicao}: ${tituloEdicao} ===

--- PONTOS PRINCIPAIS ---
${bulletsList ? `- ${bulletsList}` : 'Não disponível.'}

--- CONTEÚDO DA EDIÇÃO ---
${conteudoTexto || 'Não disponível.'}

--- PERGUNTAS E RESPOSTAS ---
${faqTexto || 'Não disponível.'}

${dadosMunicipio ? `--- DADOS DO MUNICÍPIO DO ASSINANTE ---\n${dadosMunicipio}` : ''}
`.trim();

    // ── 3.1. Verifica cache ANTES de chamar a API ─────────────────────────
    const cacheKey = gerarCacheKey(pergunta, nid, municipio_cod);
    const respostaEmCache = buscarNoCache(cacheKey);

    if (respostaEmCache) {
      console.log(`[chat] ✅ Resposta servida do cache (key: ${cacheKey.slice(0, 8)}...)`);
      return res.status(200).json({ resposta: respostaEmCache, cache: true });
    }

    // ── 4. Chama Gemini via fetch ─────────────────────────────────────────
    const resposta = await chamarGemini(
      systemPrompt,
      Array.isArray(historico) ? historico.slice(-6) : [],
      pergunta.trim()
    );

    // ── 4.1. Salva no cache após resposta bem-sucedida ───────────────────
    salvarNoCache(cacheKey, resposta);

    return res.status(200).json({ resposta, cache: false });

  } catch (err) {
    console.error('[chat] Erro:', err.message);
    console.error('[chat] Stack:', err.stack);

    if (err.code === 'QUOTA_EXCEEDED') {
      return res.status(503).json({
        erro: 'O assistente está temporariamente indisponível. Tente novamente em alguns minutos.',
      });
    }

    return res.status(500).json({
      erro: 'Erro interno ao processar sua pergunta. Tente novamente em instantes.',
    });
  }
}