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

// ═══════════════════════════════════════════════════════════════════════
// ROTEADOR: Cache de índices + Busca local + Gemini fallback
// ═══════════════════════════════════════════════════════════════════════
const cacheIndices = { data: null, ts: 0 };
const CACHE_INDICES_TTL = 5 * 60 * 1000;

async function _buscarIndicesEdicoes() {
  if (cacheIndices.data && (Date.now() - cacheIndices.ts) < CACHE_INDICES_TTL) {
    return cacheIndices.data;
  }
  const sbUrl = process.env.VITE_SUPABASE_URL;
  const sbKey = process.env.VITE_SUPABASE_SERVICE_KEY;
  if (!sbUrl || !sbKey) {
    console.warn('[chat] VITE_SUPABASE_URL/SERVICE_KEY ausentes');
    return [];
  }
  try {
    const url = sbUrl + '/rest/v1/chat_edicoes_indices'
      + '?enviada=eq.true&order=data_publicacao.desc&limit=100';
    const res = await fetch(url, {
      headers: {
        apikey: sbKey,
        Authorization: 'Bearer ' + sbKey
      }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    cacheIndices.data = data || [];
    cacheIndices.ts = Date.now();
    return cacheIndices.data;
  } catch (e) {
    console.warn('[chat] Falha ao buscar índices:', e.message);
    return cacheIndices.data || [];
  }
}

function _rsBuscaLocal(pergunta, indices, nidAtual) {
  const norm = function(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const stopwords = ['para','como','qual','esse','essa','isso','pelo','pela',
    'sobre','mais','pode','seria','entre','fale','fundo','natureza',
    'edicao','edição','radar','siope'];
  const palavras = norm(pergunta).split(' ')
    .filter(function(p) { return p.length >= 4 && stopwords.indexOf(p) === -1; });
  if (palavras.length === 0) return null;
  let melhorMatch = null;
  let melhorScore = 0;
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (idx.newsletter_id === nidAtual) continue;
    const textoBusca = [
      idx.titulo || '',
      idx.keywords || '',
      (idx.temas || []).join(' '),
      (idx.municipios_citados || []).join(' '),
      idx.resumo_curto || ''
    ].join(' ').toLowerCase();
    let score = 0;
    for (let j = 0; j < palavras.length; j++) {
      if (textoBusca.indexOf(palavras[j]) !== -1) score++;
    }
    const threshold = Math.max(2, Math.ceil(palavras.length * 0.5));
    if (score >= threshold && score > melhorScore) {
      melhorScore = score;
      melhorMatch = idx;
    }
  }
  return melhorScore >= 2 ? melhorMatch : null;
}

async function _rsRoteadorGemini(pergunta, indices, nidAtual) {
  const listaEdicoes = indices
    .filter(function(idx) { return idx.newsletter_id !== nidAtual; })
    .map(function(idx) {
      return '- Edição ' + idx.numero + ': ' + idx.titulo
        + '. Temas: ' + ((idx.temas || []).join(', ') || 'N/A');
    })
    .join('\n');
  if (!listaEdicoes) return { categoria: 'ATUAL', confianca: 0.5 };
  const edicaoAtual = indices.find(function(i) { return i.newsletter_id === nidAtual; });
  const numAtual = edicaoAtual ? edicaoAtual.numero : '?';
  const promptRoteador = [
    'Você é um roteador. Classifique a pergunta do usuário em UMA das categorias:',
    '',
    'EDIÇÕES DISPONÍVEIS:',
    listaEdicoes,
    '',
    'EDIÇÃO ATUAL (onde o usuário está): ' + numAtual,
    '',
    'PERGUNTA: "' + pergunta + '"',
    '',
    'Responda APENAS em JSON válido:',
    '{"categoria": "ATUAL|EDICAO_X|FORA", "edicao_numero": "XXX ou null", "confianca": 0.0-1.0}',
    '',
    'Regras:',
    '- ATUAL = a pergunta claramente se refere à edição atual',
    '- EDICAO_X = a pergunta se refere a uma edição específica (use o número exato da lista)',
    '- FORA = pergunta genérica, fora do escopo das edições'
  ].join('\n');
  try {
    const resposta = await chamarGemini(promptRoteador, [], pergunta, 1);
    const jsonMatch = resposta.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { categoria: 'ATUAL', confianca: 0.5 };
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.warn('[chat] Roteador Gemini falhou:', e.message);
    return { categoria: 'ATUAL', confianca: 0.5 };
  }
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
          maxOutputTokens: 600,
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
          // Backoff curto: nunca esperar mais que o timeout do cliente (25s)
          const retryAfter = res.headers.get('retry-after')
            ? Math.min(6, parseInt(res.headers.get('retry-after')))
            : Math.min(3, Math.pow(2, i));
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

// ── Limpa HTML para texto plano ───────────────────────────────────────────
function htmlParaTexto(html = '') {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&/g, ' &')
    .replace(/</g, ' <')
    .replace(/>/g, ' >')
    .replace(/'/g, "' ")
    .replace(/"/g, ' "')
    .replace(/\s{2,}/g, ' ')
    .trim();
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
    acesso_pro_temp,
    historico = [],
  } = req.body || {};

  // ── Validações ────────────────────────────────────────────────────────────
  if (!pergunta || typeof pergunta !== 'string' || !pergunta.trim()) {
    return res.status(400).json({ erro: 'Pergunta ausente.' });
  }
  if (!nid) {
    return res.status(400).json({ erro: 'ID da edição ausente.' });
  }
  if (segmento !== 'assinante' && !acesso_pro_temp) {
    return res.status(403).json({ erro: 'Recurso disponível apenas para assinantes.' });
  }
  if (pergunta.length > 500) {
    return res.status(400).json({ erro: 'Pergunta muito longa.' });
  }

  try {
    // ── 0. Inicializa Firestore ───────────────────────────────────────────
    const firestore = getFirestore();

    // ── 0.5. Busca usuário e define limite de perguntas ───────────────────
    let limiteChat = 0;
    const isAssinante = segmento === 'assinante';

    if (isAssinante) {
      const userSnap = await firestore.collection('usuarios').doc(uid).get();
      if (!userSnap.exists) {
        return res.status(403).json({ erro: 'Usuário não encontrado.' });
      }
      const userData = userSnap.data();
      limiteChat = Number(userData.features?.pergunta_edicao || 0);
    } else if (acesso_pro_temp) {
      limiteChat = 2; // lead com acesso temporário
    }

    if (limiteChat <= 0) {
      return res.status(403).json({ erro: 'Você não tem acesso ao chat nesta edição.' });
    }

    // ── 0.6. Transaction: valida e incrementa contador ────────────────────
    const contadorRef = firestore
      .collection('usuarios').doc(uid)
      .collection('chat_contadores').doc(nid);

    let contadorAtual = 0;

    try {
      await firestore.runTransaction(async (t) => {
        const doc = await t.get(contadorRef);
        if (doc.exists) {
          contadorAtual = doc.data().contador || 0;
        }
        if (contadorAtual >= limiteChat) {
          throw new Error('LIMITE_EXCEDIDO');
        }
        t.set(contadorRef, {
          contador: contadorAtual + 1,
          limite_aplicado: limiteChat,
          atualizado_em: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      });
    } catch (txErr) {
      if (txErr.message === 'LIMITE_EXCEDIDO') {
        return res.status(429).json({
          erro: 'Limite de perguntas atingido para esta edição.',
          limite_excedido: true,
          limite: limiteChat,
        });
      }
      throw txErr;
    }

    const perguntasRestantes = limiteChat - (contadorAtual + 1);

        // ── 1. Contexto enviado pelo app (com fallback no servidor) ───────────
    const contexto = req.body.contexto_edicao || {};
    let texto_edicao = String(contexto.texto_edicao || '');
    let faq          = Array.isArray(contexto.faq) ? contexto.faq : [];
    let bullets      = Array.isArray(contexto.bullets) ? contexto.bullets : [];
    let metadados    = contexto.metadados || {};

    // Fallback: app não mandou contexto útil → monta a partir do Firestore
    const contextoVazio = texto_edicao.length < 30 && !faq.length && !bullets.length;
    if (contextoVazio) {
      console.warn('[chat] Contexto vazio no body — usando fallback do Firestore. nid:', nid);
      const snap = await firestore.collection('newsletters').doc(nid).get();
      if (!snap.exists) {
        return res.status(404).json({ erro: 'Edição não encontrada.' });
      }
      const nl = snap.data();
      metadados = { numero: nl.numero || nl.edicao || '', titulo: nl.titulo || '' };
      bullets   = nl.resumo_bullets || [];
      faq       = nl.faq || [];
      texto_edicao = nl.conteudo_semantico?.texto_completo
        || (nl.blocos || [])
            .filter(b => b.destino !== 'email')
            .map(b => `${b.titulo ? '[' + b.titulo + ']\n' : ''}${htmlParaTexto(b.html || '')}`)
            .join('\n\n')
            .slice(0, 30000)
        || htmlParaTexto(nl.conteudo_html_completo || '').slice(0, 30000);
    }

    // Só rejeita se REALMENTE não houver nada para responder
    if (texto_edicao.length < 30 && !faq.length && !bullets.length) {
      return res.status(422).json({
        erro: 'Esta edição ainda não tem conteúdo disponível para perguntas. Tente outra edição.',
      });
    }

    const numEdicao    = metadados.numero || '';
    const tituloEdicao = metadados.titulo || '';
    const faqTexto     = faq.map(f => `P: ${f.pergunta}\nR: ${f.resposta}`).join('\n\n');
    const bulletsList  = bullets.join('\n- ');
    const conteudoTexto = texto_edicao;

    // ═══════════════════════════════════════════════════════════════════════
    // ROTEADOR DE INTENÇÕES (Camada 1)
    // ═══════════════════════════════════════════════════════════════════════
    const indices = await _buscarIndicesEdicoes();
    const edicaoAtualIdx = indices.find(i => i.newsletter_id === nid);

    // 1. Busca local (CUSTO ZERO)
    const matchLocal = _rsBuscaLocal(pergunta, indices, nid);

    let roteamento = null;

    if (matchLocal) {
      roteamento = {
        categoria: 'EDICAO_X',
        edicao_numero: matchLocal.numero,
        confianca: 0.9,
        tema_detectado: matchLocal.temas?.[0] || '',
        _edicao: matchLocal,
      };
      console.log(`[chat] ✅ Roteador local: Edição ${matchLocal.numero} (confiança: 0.9)`);
    } else {
      const roteadorRes = await _rsRoteadorGemini(pergunta, indices, nid);
      roteamento = {
        ...roteadorRes,
        _edicao: indices.find(i => String(i.numero) === String(roteadorRes.edicao_numero)),
      };
      console.log(`[chat] 🔀 Roteador Gemini: ${roteamento.categoria} (confiança: ${roteamento.confianca})`);
    }

    // 2. Se for de outra edição, prepara resposta de redirecionamento
    if (roteamento.categoria === 'EDICAO_X' && roteamento._edicao) {
      const edSugerida = roteamento._edicao;
      
      return res.status(200).json({
        resposta: `Essa pergunta é respondida na **Edição ${edSugerida.numero}: ${edSugerida.titulo}**.\n\nClique abaixo para acessar o conteúdo completo.`,
        origem: 'roteador_redirecionamento',
        cache: false,
        perguntas_restantes: perguntasRestantes,
        edicao_sugerida: {
          id: edSugerida.newsletter_id,
          numero: edSugerida.numero,
          titulo: edSugerida.titulo,
          formato: edSugerida.formato || 'regular',
          data_publicacao: edSugerida.data_publicacao,
        },
      });
    }

    // 3. Se FORA do escopo, resposta genérica (não gasta token com contexto)
    if (roteamento.categoria === 'FORA' && roteamento.confianca > 0.7) {
      const temasAtuais = edicaoAtualIdx?.temas?.slice(0, 3).join(', ') || 'os temas desta edição';
      return res.status(200).json({
        resposta: `Sou um especialista em financiamento da educação pública municipal, mas respondo apenas sobre os conteúdos das edições do Radar SIOPE.\n\nQue tal perguntar sobre **${temasAtuais}**?`,
        origem: 'roteador_fora_escopo',
        cache: false,
        perguntas_restantes: perguntasRestantes,
      });
    }

    // 4. ATUAL ou ambíguo → segue para a Camada 2 (Gemini com contexto completo)

    // ── 2. Dados do município via Supabase ────────────────────────────────
    let dadosMunicipio = '';
    if (municipio_cod) {
      try {
        const sbUrl = process.env.VITE_SUPABASE_URL;
        const sbKey = process.env.VITE_SUPABASE_SERVICE_KEY;
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
3. Se a pergunta não puder ser respondida com o contexto fornecido, responda exatamente: "Não tenho essa informação neste conteúdo."
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
      return res.status(200).json({ resposta: respostaEmCache, cache: true, perguntas_restantes: perguntasRestantes });
    }

    // ── 4. Chama Gemini via fetch ─────────────────────────────────────────
    const resposta = await chamarGemini(
      systemPrompt,
      Array.isArray(historico) ? historico.slice(-6) : [],
      pergunta.trim()
    );

    // ── 4.1. Salva no cache após resposta bem-sucedida ───────────────────
    salvarNoCache(cacheKey, resposta);

    return res.status(200).json({ resposta, cache: false, perguntas_restantes: perguntasRestantes });

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