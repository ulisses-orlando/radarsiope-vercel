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

// ── Firebase Admin (lazy init com tratamento de erro) ────────────────────────
let db;

function getFirestore() {
  if (db) return db;

  // Inicializa Firebase (atenção ao formato da PRIVATE_KEY no Vercel: use \\n)
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      })
    });
  }

  db = admin.firestore();
  return db;
}

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash-lite:generateContent';

async function chamarGemini(systemPrompt, historico, pergunta) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('[chat] GEMINI_API_KEY ausente.');

  const contents = [
    ...historico.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: String(m.text) }],
    })),
    { role: 'user', parts: [{ text: pergunta }] },
  ];

  const body = {
    contents: [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Entendido. Responderei somente com base nas informações fornecidas.' }] },
      ...contents,
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 512,
      topP: 0.8,
    },
  };

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 429) {
      throw Object.assign(new Error(`Gemini API erro 429`), { code: 'QUOTA_EXCEEDED' });
    }
    throw new Error(`Gemini API erro ${res.status}: ${err}`);
  }

  const data = await res.json();
  const texto = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!texto) throw new Error('Resposta vazia do modelo.');
  return texto;
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
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Trunca contexto para não exceder limite de tokens ────────────────────────
function truncar(texto, maxChars = 40000) {
  if (texto.length <= maxChars) return texto;
  return texto.slice(0, maxChars) + '\n\n[conteúdo truncado]';
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
    // ── 0. Inicializa Firestore (valida env vars) ─────────────────────────
    const firestore = getFirestore();

    // ── 1. Busca edição no Firestore ──────────────────────────────────────
    const snap = await firestore.collection('newsletters').doc(nid).get();
    if (!snap.exists) {
      return res.status(404).json({ erro: 'Edição não encontrada.' });
    }

    const newsletter = snap.data();
    const numEdicao = newsletter.numero || newsletter.edicao || '';
    const tituloEdicao = newsletter.titulo || '';
    const conteudoTexto = truncar(htmlParaTexto(newsletter.conteudo_html_completo || ''));
    const bulletsList = (newsletter.resumo_bullets || []).join('\n- ');
    const faqTexto = (newsletter.faq || [])
      .map(f => `P: ${f.pergunta}\nR: ${f.resposta}`)
      .join('\n\n');

    // ── 2. Dados do município via Supabase (fetch puro) ───────────────────
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

    // ── 4. Chama Gemini via fetch ─────────────────────────────────────────
    const resposta = await chamarGemini(
      systemPrompt,
      Array.isArray(historico) ? historico.slice(-6) : [],
      pergunta.trim()
    );

    return res.status(200).json({ resposta });

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
