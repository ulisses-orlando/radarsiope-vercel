/* ==========================================================================
   academia.js — Radar SIOPE · Backend (Vercel Function)
   Rota: /api/academia

   API dedicada da Academia (Seção 21.8 da spec — separada de pagamentoMP.js,
   que já está sobrecarregado). IMPORTANTE (v1.7.2): o plano free da
   hospedagem tem limite de nº de funções serverless — por isso TODO
   endpoint novo da Academia entra como uma nova `acao` AQUI DENTRO, nunca
   como um arquivo/function novo.

   Ações implementadas nesta rodada:
   - GET  ?acao=especiais-painel&uid=...                       → listagem para o painel do assinante
   - GET  ?acao=especial-detalhe&uid=...&quiz_especial_id=...  → doc completo (com perguntas), sob demanda

   NOTA v1.7.2: a ação `setup-inicial` (carga inicial de config/selos e
   config/fidelidade) foi REMOVIDA daqui — o erro "ID de projeto não
   detectado" (falha de credenciais do firebase-admin no Vercel) levou a
   mover essa lógica para o navegador, dentro de configAcademiaAdmin.js
   (que já fala direto com o Firestore pelo SDK do cliente, sem precisar
   de function nem de token). Ver esse arquivo para a carga inicial.

   Ações futuras (adesão — Seção 21.3, 21.4, etc.) entram aqui conforme
   formos tratando cada peça — não implementadas ainda.
   ========================================================================== */

import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}
const db = admin.firestore();

function json(res, status, body) {
  return res.status(status).json(body);
}

const NOMES_NIVEL = { dedicado: 'Dedicado', especialista: 'Especialista', mestre: 'Mestre' };

// ─── GET: painel de Quizzes Especiais do assinante ───────────────────────────
// Decide qual nivel_alvo mostrar (Seção 21.7 — pool aberto por etapa) e traz,
// para cada especial ativo daquele nível, o status do assinante nele.
async function _handleEspeciaisPainel(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, message: 'Método não permitido.' });
  const { uid } = req.query || {};
  if (!uid) return json(res, 400, { ok: false, message: 'uid é obrigatório.' });

  try {
    const usuarioDoc = await db.collection('usuarios').doc(uid).get();
    const academiaStatus = usuarioDoc.data()?.academia?.status;
    if (academiaStatus !== 'membro') {
      return json(res, 200, { ok: true, bloqueado: true, motivo: 'nao_e_membro' });
    }

    const certificadoDoc = await db.collection('certificados').doc(uid).get();
    const nivelAtualGlobal = certificadoDoc.data()?.nivel_atual_global || 'iniciante';

    // Mapeia nível atual → próximo nivel_alvo a perseguir (Seção 3.2/21.7)
    let nivelAlvoAtual = null;
    if (nivelAtualGlobal === 'dedicado') nivelAlvoAtual = 'especialista';
    else if (nivelAtualGlobal === 'especialista') nivelAlvoAtual = 'mestre';
    // 'iniciante' → ainda não desbloqueou (fica null); 'mestre' → não há próximo (fica null)

    if (!nivelAlvoAtual) {
      const motivo = nivelAtualGlobal === 'mestre' ? 'ja_e_mestre' : 'ainda_nao_desbloqueou';
      return json(res, 200, { ok: true, bloqueado: true, motivo, nivel_atual_global: nivelAtualGlobal });
    }

    // Especiais ativos desse nivel_alvo — o requisito É esta contagem (v1.7, sem config separada)
    const ativosSnap = await db.collection('quizzes_especiais')
      .where('nivel_alvo', '==', nivelAlvoAtual)
      .where('ativo', '==', true)
      .get();

    if (ativosSnap.empty) {
      // Estado normal quando o admin ainda não publicou nada pra esse nível — não é erro
      return json(res, 200, {
        ok: true, bloqueado: false, nivel_alvo_atual: nivelAlvoAtual,
        nivel_alvo_nome: NOMES_NIVEL[nivelAlvoAtual], total_ativos: 0, total_aprovados: 0, especiais: []
      });
    }

    // Resultados do assinante para especiais desse nivel_alvo — melhor pontuação por quiz
    // (mesmo padrão de "melhor tentativa" já usado em _computarResumoQuiz/pagamentoMP.js)
    const resultadosSnap = await db.collection('usuarios').doc(uid)
      .collection('quiz_resultados')
      .where('tipo', '==', 'especial')
      .where('nivel_alvo', '==', nivelAlvoAtual)
      .get();

    const melhorPorQuiz = new Map(); // quiz_especial_id -> { melhor_pontuacao, aprovado, tentativas_usadas }
    resultadosSnap.docs.forEach(d => {
      const r = d.data();
      const atual = melhorPorQuiz.get(r.quiz_especial_id) || { melhor_pontuacao: 0, aprovado: false, tentativas_usadas: 0 };
      atual.tentativas_usadas += 1;
      if (r.pontuacao > atual.melhor_pontuacao) atual.melhor_pontuacao = r.pontuacao;
      if (r.aprovado) atual.aprovado = true;
      melhorPorQuiz.set(r.quiz_especial_id, atual);
    });

    const especiais = ativosSnap.docs.map(d => {
      const dados = d.data();
      const status = melhorPorQuiz.get(d.id) || { melhor_pontuacao: null, aprovado: false, tentativas_usadas: 0 };
      return {
        id: d.id,
        titulo: dados.titulo,
        descricao: dados.descricao || '',
        dificuldade: dados.dificuldade ?? null,
        tentativas_max: dados.tentativas_max ?? 3,
        aprovado: status.aprovado,
        melhor_pontuacao: status.melhor_pontuacao,
        tentativas_usadas: status.tentativas_usadas,
      };
    });

    const totalAprovados = especiais.filter(e => e.aprovado).length;

    return json(res, 200, {
      ok: true,
      bloqueado: false,
      nivel_alvo_atual: nivelAlvoAtual,
      nivel_alvo_nome: NOMES_NIVEL[nivelAlvoAtual],
      total_ativos: especiais.length,
      total_aprovados: totalAprovados,
      todos_concluidos: totalAprovados === especiais.length, // dispara a mensagem da Seção 7.5 no front
      especiais,
    });
  } catch (err) {
    console.error('[academia][especiais-painel] Erro:', err.message);
    return json(res, 500, { ok: false, message: 'Erro interno ao carregar painel de especiais.' });
  }
}

// ─── GET: detalhe completo de 1 Quiz Especial (com perguntas), sob demanda ───
// Só é chamado quando o assinante clica "Responder" — a listagem do painel
// (acima) nunca inclui `perguntas`, pra não mandar gabarito pro cliente antes
// da hora (mesmo cuidado que faria sentido ter, mas hoje não existe, para o
// quiz normal embutido em newsletter.quiz — aqui optei por não repetir isso).
async function _handleEspecialDetalhe(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, message: 'Método não permitido.' });
  const { uid, quiz_especial_id } = req.query || {};
  if (!uid || !quiz_especial_id) return json(res, 400, { ok: false, message: 'uid e quiz_especial_id são obrigatórios.' });

  try {
    const usuarioDoc = await db.collection('usuarios').doc(uid).get();
    if (usuarioDoc.data()?.academia?.status !== 'membro') {
      return json(res, 403, { ok: false, message: 'Apenas membros da Academia podem acessar Quizzes Especiais.' });
    }

    const doc = await db.collection('quizzes_especiais').doc(quiz_especial_id).get();
    if (!doc.exists) return json(res, 404, { ok: false, message: 'Quiz Especial não encontrado.' });
    const dados = doc.data();
    if (dados.ativo === false) return json(res, 403, { ok: false, message: 'Este Quiz Especial não está mais ativo.' });

    // Formato compatível com QuizManager.initEspecial() em quizApp.js
    return json(res, 200, {
      ok: true,
      id: doc.id,
      ativo: dados.ativo,
      titulo: dados.titulo,
      descricao: dados.descricao || '',
      tentativas_max: dados.tentativas_max ?? 3,
      pontuacao_minima: dados.pontuacao_minima ?? 70,
      perguntas: dados.perguntas || [],
    });
  } catch (err) {
    console.error('[academia][especial-detalhe] Erro:', err.message);
    return json(res, 500, { ok: false, message: 'Erro interno ao carregar Quiz Especial.' });
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://app.radarsiope.com.br');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const acao = req.query?.acao;

  if (acao === 'especiais-painel') return _handleEspeciaisPainel(req, res);
  if (acao === 'especial-detalhe') return _handleEspecialDetalhe(req, res);

  return json(res, 400, { ok: false, message: `Ação desconhecida ou não implementada: ${acao}` });
}