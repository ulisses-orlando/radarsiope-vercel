// =============================================================================
// PASSO 2 — /api/chat.js  (Vercel Serverless Function)
//
// Variáveis de ambiente necessárias na Vercel:
//   GEMINI_API_KEY        → chave da API do Google AI Studio
//   FIREBASE_PROJECT_ID   → ID do projeto Firebase (para buscar a edição)
//   FIREBASE_CLIENT_EMAIL → service account (credencial server-side)
//   FIREBASE_PRIVATE_KEY  → chave privada da service account
//
// Dependências (package.json):
//   "firebase-admin": "^12.x"
//   "@google/generative-ai": "^0.x"
// =============================================================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import admin from 'firebase-admin';

// ── Firebase Admin (inicializa uma única vez) ─────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, '\n')
    }),
  });
}

const db  = admin.firestore();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ── Limpa HTML para texto plano (contexto para a IA) ─────────────────────────
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

// ── Trunca contexto para não exceder ~60k tokens ──────────────────────────────
function truncar(texto, maxChars = 40000) {
  if (texto.length <= maxChars) return texto;
  return texto.slice(0, maxChars) + '\n\n[conteúdo truncado]';
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Só aceita POST
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const { pergunta, nid, municipio_cod, uid, segmento, historico = [] } = req.body || {};

  // ── Validações básicas ────────────────────────────────────────────────────
  if (!pergunta || typeof pergunta !== 'string' || pergunta.trim().length === 0) {
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
    // ── 1. Busca conteúdo da edição no Firestore ──────────────────────────
    const snap = await db.collection('newsletters').doc(nid).get();
    if (!snap.exists) {
      return res.status(404).json({ erro: 'Edição não encontrada.' });
    }

    const newsletter = snap.data();
    const conteudoTexto = truncar(htmlParaTexto(newsletter.conteudo_html_completo || ''));
    const tituloEdicao  = newsletter.titulo || '';
    const numEdicao     = newsletter.numero  || newsletter.edicao || '';
    const bulletsList   = (newsletter.resumo_bullets || []).join('\n- ');
    const faqTexto      = (newsletter.faq || [])
      .map(f => `P: ${f.pergunta}\nR: ${f.resposta}`)
      .join('\n\n');

    // ── 2. Dados do município (Supabase via fetch direto) ──────────────────
    // Opcional — se não houver código de município, pula sem erro
    let dadosMunicipio = '';
    if (municipio_cod) {
      try {
        const sbUrl  = process.env.SUPABASE_URL;
        const sbKey  = process.env.SUPABASE_SERVICE_KEY;
        if (sbUrl && sbKey) {
          const resp = await fetch(
            `${sbUrl}/rest/v1/vw_municipio_resumo?cod_municipio=eq.${encodeURIComponent(municipio_cod)}&limit=1`,
            { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
          );
          if (resp.ok) {
            const rows = await resp.json();
            if (rows?.[0]) {
              const m = rows[0];
              dadosMunicipio = `
Município do assinante: ${m.nome_municipio || ''} / ${m.uf || ''}
Código IBGE: ${municipio_cod}
${m.perc_mde       != null ? `MDE aplicado: ${m.perc_mde}%` : ''}
${m.perc_fundeb    != null ? `FUNDEB (70%): ${m.perc_fundeb}%` : ''}
${m.situacao_siope ? `Situação SIOPE: ${m.situacao_siope}` : ''}
              `.trim();
            }
          }
        }
      } catch (e) {
        // Não bloqueia — município é contexto adicional, não obrigatório
        console.warn('[chat] Falha ao buscar município:', e.message);
      }
    }

    // ── 3. Monta o system prompt ──────────────────────────────────────────
    const systemPrompt = `
Você é o assistente do Radar SIOPE, uma newsletter especializada em financiamento da educação pública municipal brasileira.

REGRAS ABSOLUTAS:
1. Responda SOMENTE com base nas informações fornecidas abaixo.
2. Nunca invente dados, percentuais, datas, nomes de leis ou valores.
3. Se a pergunta não puder ser respondida com o contexto fornecido, diga exatamente: "Não tenho essa informação nesta edição."
4. Seja objetivo e claro. Use linguagem acessível para gestores municipais.
5. Nunca mencione que você é um modelo de IA ou que está usando um contexto.
6. Máximo de 3 parágrafos por resposta.

=== EDIÇÃO ${numEdicao}: ${tituloEdicao} ===

--- RESUMO DOS PONTOS PRINCIPAIS ---
${bulletsList ? `- ${bulletsList}` : 'Não disponível.'}

--- CONTEÚDO COMPLETO DA EDIÇÃO ---
${conteudoTexto || 'Não disponível.'}

--- PERGUNTAS E RESPOSTAS DA EDIÇÃO ---
${faqTexto || 'Não disponível.'}

${dadosMunicipio ? `--- DADOS DO MUNICÍPIO DO ASSINANTE ---\n${dadosMunicipio}` : ''}
    `.trim();

    // ── 4. Monta histórico de conversa (máx. 6 mensagens) ─────────────────
    const conversaAnterior = (Array.isArray(historico) ? historico.slice(-6) : [])
      .filter(m => m.role && m.text)
      .map(m => ({
        role:  m.role === 'user' ? 'user' : 'model',
        parts: [{ text: String(m.text) }],
      }));

    // ── 5. Chama Gemini 2.0 Flash ─────────────────────────────────────────
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: systemPrompt,
      generationConfig: {
        temperature:     0.2,   // respostas determinísticas
        maxOutputTokens: 512,
        topP:            0.8,
      },
    });

    const chat    = model.startChat({ history: conversaAnterior });
    const result  = await chat.sendMessage(pergunta.trim());
    const resposta = result.response.text().trim();

    if (!resposta) {
      return res.status(500).json({ erro: 'Resposta vazia do modelo.' });
    }

    // ── 6. Retorna ─────────────────────────────────────────────────────────
    return res.status(200).json({ resposta });

  } catch (err) {
    console.error('[chat] Erro:', err);
    return res.status(500).json({
      erro: 'Erro interno ao processar sua pergunta. Tente novamente em instantes.',
    });
  }
}
