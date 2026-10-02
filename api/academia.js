/* ==========================================================================
   academia.js — Radar SIOPE · Backend (Vercel Function)
   Rota: /api/academia

   API dedicada da Academia (Seção 21.8 da spec — separada de pagamentoMP.js,
   que já está sobrecarregado). IMPORTANTE (v1.7.2): o plano free da
   hospedagem tem limite de nº de funções serverless — por isso TODO
   endpoint novo da Academia entra como uma nova `acao` AQUI DENTRO, nunca
   como um arquivo/function novo.

   Ações implementadas:
   - GET  ?acao=especiais-painel&uid=...                       → listagem para o painel do assinante
   - GET  ?acao=especial-detalhe&uid=...&quiz_especial_id=...  → doc completo (com perguntas), sob demanda
   - POST ?acao=aceitar-termos                                 → adesão do assinante + backfill pessoal
   - POST ?acao=toggle-especial  (header x-admin-token)        → dispara processarToggleEspecial após
                                                                   o admin ativar/desativar um Quiz Especial

   NOTA v1.7.2: a ação `setup-inicial` foi REMOVIDA — a carga inicial de
   config_academia/selos e config_academia/fidelidade agora roda 100% no
   navegador, dentro de configAcademiaAdmin.js (sem function, sem token).

   NOTA v1.7.3: sem plano Blaze do Firebase, não há Cloud Functions com
   trigger — a lógica que seria automática (onQuizResultCreate,
   onQuizEspecialToggle) virou a biblioteca academiaCore.js, chamada
   diretamente por quem grava o documento (aqui e em pagamentoMP.js).
   ========================================================================== */

import admin from 'firebase-admin';
// academiaCore.js fica em /lib (FORA de /api) — todo arquivo dentro de /api vira uma
// serverless function e contaria no limite do plano free.
import { processarToggleEspecial } from '../lib/academiaCore.js';

// Mesmo padrão de credenciais do pagamentoMP.js (cert explícito — applicationDefault()
// não funciona no Vercel e foi a causa do erro "ID de projeto não detectado").
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, '\n'), // mesmo regex do pagamentoMP.js
    }),
  });
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

// ══════════════════════════════════════════════════════════════════════════
// AÇÃO: aceitar-termos (POST) — Seção 21.3/21.4. Marca o assinante como
// membro da Academia e roda o backfill pessoal completo.
//
// LIMITAÇÃO CONHECIDA: a recontagem/trava de nível abaixo duplica a lógica
// do trigger onQuizResultCreate (triggersAcademia.js/Firebase Functions) —
// os dois ambientes (Vercel x Firebase Functions) não compartilham código
// diretamente. Manter os dois sincronizados se a regra de progressão mudar.
// ══════════════════════════════════════════════════════════════════════════
const ORDEM_NIVEIS = ['iniciante', 'dedicado', 'especialista', 'mestre'];

function _calcularCicloContrato(dataInicioContrato, dataReferencia) {
  if (dataReferencia < dataInicioContrato) return null;
  let n = 1;
  let inicioCiclo = new Date(dataInicioContrato);
  while (true) {
    const fimCiclo = new Date(inicioCiclo);
    fimCiclo.setFullYear(fimCiclo.getFullYear() + 1);
    if (dataReferencia < fimCiclo) return { n, dataInicioCiclo: new Date(inicioCiclo) };
    inicioCiclo = fimCiclo;
    n++;
  }
}

// Roda a MESMA verificação de progressão do onQuizResultCreate, mas para um
// conjunto de resultados já filtrado por ciclo (usado ciclo a ciclo, em
// ordem crescente, no backfill).
async function _progredirNivelSeElegivel(uid, anoContratoReferencia, resultadosDoCiclo, nivelAtual, configSelos) {
  const normaisUnicos = new Map();
  const especiaisPorNivel = { especialista: new Map(), mestre: new Map() };

  resultadosDoCiclo.forEach(r => {
    if (r.tipo === 'especial' && especiaisPorNivel[r.nivel_alvo]) {
      const mapa = especiaisPorNivel[r.nivel_alvo];
      const atual = mapa.get(r.quiz_especial_id);
      if (!atual || r.pontuacao > atual.pontuacao) mapa.set(r.quiz_especial_id, r);
    } else if (r.tipo === 'normal') {
      const atual = normaisUnicos.get(r.newsletter_id);
      if (!atual || r.pontuacao > atual.pontuacao) normaisUnicos.set(r.newsletter_id, r);
    }
  });

  const normaisAprovados = [...normaisUnicos.values()].filter(r => r.aprovado).length;
  const especiaisAprovados = {
    especialista: [...especiaisPorNivel.especialista.values()].filter(r => r.aprovado).length,
    mestre: [...especiaisPorNivel.mestre.values()].filter(r => r.aprovado).length,
  };

  let nivel = nivelAtual;
  while (true) {
    const proximoNivel = ORDEM_NIVEIS[ORDEM_NIVEIS.indexOf(nivel) + 1];
    if (!proximoNivel) break;
    const cfgProximo = configSelos.niveis?.[proximoNivel];
    if (!cfgProximo) break;

    const bateuNormais = normaisAprovados >= cfgProximo.quizzes_aprovados;
    let bateuEspeciais = true, especiaisExigidosAgora = 0;
    if (proximoNivel === 'especialista' || proximoNivel === 'mestre') {
      const ativosSnap = await db.collection('quizzes_especiais')
        .where('nivel_alvo', '==', proximoNivel).where('ativo', '==', true).get();
      especiaisExigidosAgora = ativosSnap.size;
      bateuEspeciais = especiaisAprovados[proximoNivel] >= especiaisExigidosAgora;
    }
    if (!bateuNormais || !bateuEspeciais) break;

    const nivelRef = db.collection('usuarios').doc(uid).collection('academia_niveis').doc(proximoNivel);
    const nivelDoc = await nivelRef.get();
    if (!nivelDoc.exists) {
      await nivelRef.set({
        nivel: proximoNivel,
        data_conquista: new Date().toISOString(),
        ciclo_contrato_no_momento: anoContratoReferencia,
        quizzes_normais_exigidos_no_momento: cfgProximo.quizzes_aprovados,
        especiais_exigidos_no_momento: especiaisExigidosAgora,
        origem: 'backfill_adesao',
      });
    }
    nivel = proximoNivel;
  }

  return { nivel, normaisAprovados, especiaisAprovados };
}

async function _handleAceitarTermos(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, message: 'Método não permitido.' });
  const { uid, termos_versao } = req.body || {};
  if (!uid) return json(res, 400, { ok: false, message: 'uid é obrigatório.' });

  try {
    const usuarioRef = db.collection('usuarios').doc(uid);
    const usuarioDoc = await usuarioRef.get();
    if (!usuarioDoc.exists) return json(res, 404, { ok: false, message: 'Usuário não encontrado.' });

    if (usuarioDoc.data()?.academia?.status === 'membro') {
      return json(res, 200, { ok: true, ja_era_membro: true, message: 'Este assinante já é membro da Academia.' });
    }

    // Assinatura ativa → data_inicio_contrato (Seção 21.4). Campo real:
    // `status === 'ativa'` em usuarios/{uid}/assinaturas.
    const assinaturasSnap = await usuarioRef.collection('assinaturas')
      .where('status', '==', 'ativa').orderBy('data_inicio', 'desc').limit(1).get();
    if (assinaturasSnap.empty) {
      return json(res, 400, { ok: false, message: 'Nenhuma assinatura ativa encontrada para este usuário.' });
    }
    const dataInicioAssinatura = assinaturasSnap.docs[0].data().data_inicio.toDate();

    const configSnap = await db.collection('config_academia').doc('selos').get();
    const configSelos = configSnap.data() || {};
    const dataCorte = new Date(configSelos.backfill?.data_corte || '2026-01-01');
    const dataInicioContrato = dataInicioAssinatura > dataCorte ? dataInicioAssinatura : dataCorte;

    // 1. Marca como membro
    await usuarioRef.set({
      academia: { status: 'membro', data_adesao: new Date().toISOString(), termos_versao: termos_versao || configSelos.adesao?.termos_versao_atual || 'v1' }
    }, { merge: true });

    // 2. Inicializa certificados/{uid}
    const certificadoRef = db.collection('certificados').doc(uid);
    await certificadoRef.set({
      uid: uid,
      data_inicio_contrato: dataInicioContrato.toISOString(),
      nivel_atual_global: 'iniciante',
      status_atual: 'ativo',
    }, { merge: true });

    // 3. Backfill: agrupa TODOS os quiz_resultados existentes por ciclo de contrato
    const resultadosSnap = await usuarioRef.collection('quiz_resultados').get();
    const porCiclo = new Map(); // n -> [resultados]

    for (const doc of resultadosSnap.docs) {
      const r = doc.data();
      let dataReferencia = new Date();
      if (r.tipo === 'normal' && r.newsletter_id) {
        const nl = await db.collection('newsletters').doc(r.newsletter_id).get();
        dataReferencia = nl.data()?.data_publicacao?.toDate() || dataReferencia;
      } else if (r.criado_em?.toDate) {
        dataReferencia = r.criado_em.toDate();
      }

      const ciclo = _calcularCicloContrato(dataInicioContrato, dataReferencia);
      if (!ciclo) continue; // resultado anterior ao início do contrato — ignora

      const anoCalendarioReferencia = dataReferencia.getFullYear();
      await doc.ref.update({ ano_contrato_referencia: ciclo.n, ano_calendario_referencia: anoCalendarioReferencia });

      if (!porCiclo.has(ciclo.n)) porCiclo.set(ciclo.n, []);
      porCiclo.get(ciclo.n).push(r);
    }

    // 4. Processa ciclo a ciclo, em ordem crescente (nível é cumulativo entre ciclos)
    const ciclosOrdenados = [...porCiclo.keys()].sort((a, b) => a - b);
    let nivelAtual = 'iniciante';
    let ultimoResumo = null;

    for (const n of ciclosOrdenados) {
      const resultado = await _progredirNivelSeElegivel(uid, n, porCiclo.get(n), nivelAtual, configSelos);
      nivelAtual = resultado.nivel;
      ultimoResumo = resultado;

      await certificadoRef.collection('historico').doc(String(n)).set({
        uid: uid,
        n,
        nivel_atual: nivelAtual,
        quizzes_normais_aprovados_ciclo: resultado.normaisAprovados,
        quizzes_especiais_aprovados_especialista: resultado.especiaisAprovados.especialista,
        quizzes_especiais_aprovados_mestre: resultado.especiaisAprovados.mestre,
        origem: 'backfill_adesao',
        atualizado_em: new Date().toISOString(),
      }, { merge: true });
    }

    await certificadoRef.set({
      nivel_atual_global: nivelAtual,
      nome_nivel_global: configSelos.niveis?.[nivelAtual]?.nome || nivelAtual,
      ciclo_contrato_atual: ciclosOrdenados.length ? ciclosOrdenados[ciclosOrdenados.length - 1] : 1,
    }, { merge: true });

    return json(res, 200, {
      ok: true,
      message: 'Adesão confirmada e backfill concluído.',
      nivel_alcancado: nivelAtual,
      ciclos_processados: ciclosOrdenados.length,
      resumo_ultimo_ciclo: ultimoResumo,
    });
  } catch (err) {
    console.error('[academia][aceitar-termos] Erro:', err.message);
    return json(res, 500, { ok: false, message: 'Erro interno ao processar adesão.', detalhe: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// AÇÃO: toggle-especial (POST, admin) — dispara processarToggleEspecial()
// depois que o admin já atualizou `ativo` diretamente no Firestore (o CRUD
// em academiaEspeciaisAdmin.js continua gravando direto, como sempre fez;
// esta ação só cuida do EFEITO colateral — notificar quem foi afetado).
// ══════════════════════════════════════════════════════════════════════════
async function _handleToggleEspecial(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, message: 'Método não permitido.' });
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_API_TOKEN) {
    return json(res, 401, { ok: false, message: 'Não autorizado.' });
  }

  const { quiz_especial_id, nivel_alvo, novo_ativo } = req.body || {};
  if (!quiz_especial_id || !nivel_alvo || typeof novo_ativo !== 'boolean') {
    return json(res, 400, { ok: false, message: 'quiz_especial_id, nivel_alvo e novo_ativo (boolean) são obrigatórios.' });
  }

  try {
    const resultado = await processarToggleEspecial(db, { nivelAlvo: nivel_alvo, novoAtivo: novo_ativo });
    return json(res, 200, { ok: true, ...resultado });
  } catch (err) {
    console.error('[academia][toggle-especial] Erro:', err.message);
    return json(res, 500, { ok: false, message: 'Erro ao processar mudança de requisito.', detalhe: err.message });
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
  if (acao === 'aceitar-termos') return _handleAceitarTermos(req, res);
  if (acao === 'toggle-especial') return _handleToggleEspecial(req, res);

  return json(res, 400, { ok: false, message: `Ação desconhecida ou não implementada: ${acao}` });
}