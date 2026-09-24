/* ==========================================================================
   academia.js — Radar SIOPE · Backend (Vercel Function)
   Rota: /api/academia

   API dedicada da Academia (Seção 21.8 da spec — separada de pagamentoMP.js,
   que já está sobrecarregado). IMPORTANTE (v1.7.1): o plano free da
   hospedagem tem limite de nº de funções serverless — por isso TODO
   endpoint novo da Academia entra como uma nova `acao` AQUI DENTRO, nunca
   como um arquivo/function novo. O antigo academiaSetup.js foi descartado
   e sua lógica virou a ação `setup-inicial` abaixo.

   Ações implementadas nesta rodada:
   - GET  ?acao=especiais-painel&uid=...                       → listagem para o painel do assinante
   - GET  ?acao=especial-detalhe&uid=...&quiz_especial_id=...  → doc completo (com perguntas), sob demanda
   - POST ?acao=setup-inicial  (header x-admin-token)          → bootstrap de config/selos e config/fidelidade

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

// ══════════════════════════════════════════════════════════════════════════
// AÇÃO: setup-inicial (POST, admin) — ex-academiaSetup.js, agora embutido aqui
// Bootstrap não-destrutivo de config/selos, config/selos_metadados e
// config/fidelidade + config/fidelidade_metadados. Nunca sobrescreve valor
// ou descrição já existente — só preenche o que estiver faltando.
// ══════════════════════════════════════════════════════════════════════════
const PARAMETROS_SELOS = {
  selos: {
    academia_habilitada: { valor: false, descricao: 'Feature flag geral da Academia. Enquanto false, nenhuma funcionalidade da Academia fica visível no app (rollout gradual/beta fechado antes do lançamento público).' }
  },
  niveis: {
    iniciante: {
      nome:               { valor: 'Participante Ativo', descricao: 'Nome de exibição do 1º nível (🥉) no app, dashboard e certificado.' },
      quizzes_aprovados:  { valor: 12, descricao: 'Quantidade de quizzes NORMAIS aprovados (≥ percentual_minimo) necessária para conquistar este nível.' },
      percentual_minimo:  { valor: 70, descricao: 'Nota mínima (%) em um quiz para ele contar como aprovado, específico deste nível.' },
      cor:                { valor: '#CD7F32', descricao: 'Cor (hex) usada no selo, badge e certificado para este nível.' },
      icone:              { valor: '🥉', descricao: 'Emoji/ícone usado para representar este nível na UI.' },
      ordem:              { valor: 1, descricao: 'Posição deste nível na hierarquia (1 = mais baixo).' }
    },
    dedicado: {
      nome:                  { valor: 'Estudante Dedicado', descricao: 'Nome de exibição do 2º nível (🥈).' },
      quizzes_aprovados:     { valor: 24, descricao: 'Total acumulado de quizzes normais aprovados necessário para este nível.' },
      percentual_minimo:     { valor: 70, descricao: 'Nota mínima (%) em um quiz para ele contar como aprovado, específico deste nível.' },
      cor:                   { valor: '#C0C0C0', descricao: 'Cor (hex) usada no selo, badge e certificado para este nível.' },
      icone:                 { valor: '🥈', descricao: 'Emoji/ícone usado para representar este nível na UI.' },
      ordem:                 { valor: 2, descricao: 'Posição deste nível na hierarquia.' },
      desbloqueia_especiais: { valor: true, descricao: 'Ao atingir este nível, o painel de Quizzes Especiais fica visível pela primeira vez (mostrando os de nivel_alvo="especialista").' }
    },
    especialista: {
      nome:               { valor: 'Especialista SIOPE', descricao: 'Nome de exibição do 3º nível (🥇).' },
      quizzes_aprovados:  { valor: 36, descricao: 'Total acumulado de quizzes NORMAIS aprovados necessário para este nível (trilha independente da de especiais).' },
      percentual_minimo:  { valor: 70, descricao: 'Nota mínima (%) em um quiz para ele contar como aprovado, específico deste nível.' },
      cor:                { valor: '#FFD700', descricao: 'Cor (hex) usada no selo, badge e certificado para este nível.' },
      icone:              { valor: '🥇', descricao: 'Emoji/ícone usado para representar este nível na UI.' },
      ordem:              { valor: 3, descricao: 'Posição deste nível na hierarquia. Requisito de especiais = 100% dos quizzes_especiais ativos com nivel_alvo="especialista" (contagem ao vivo — v1.7).' }
    },
    mestre: {
      nome:               { valor: 'Mestre do FUNDEB', descricao: 'Nome de exibição do 4º e último nível (💎).' },
      quizzes_aprovados:  { valor: 48, descricao: 'Total acumulado de quizzes NORMAIS aprovados necessário para este nível — corresponde a ~48 edições de um ano de contrato.' },
      percentual_minimo:  { valor: 70, descricao: 'Nota mínima (%) em um quiz para ele contar como aprovado, específico deste nível.' },
      cor:                { valor: '#B9F2FF', descricao: 'Cor (hex) usada no selo, badge e certificado para este nível.' },
      icone:              { valor: '💎', descricao: 'Emoji/ícone usado para representar este nível na UI.' },
      ordem:              { valor: 4, descricao: 'Posição deste nível na hierarquia (o mais alto). Requisito de especiais = 100% dos quizzes_especiais ativos com nivel_alvo="mestre" (contagem ao vivo — v1.7).' }
    }
  },
  manutencao: {
    ciclo_dias:                            { valor: 60, descricao: 'Duração (em dias) do ciclo de manutenção do selo.' },
    quizzes_minimos_por_ciclo:             { valor: 4, descricao: 'Quantidade mínima de quizzes respondidos dentro de um ciclo para ele ser considerado regularizado.' },
    percentual_minimo:                     { valor: 70, descricao: 'Aproveitamento médio mínimo (%) no ciclo de manutenção para considerá-lo regularizado.' },
    permite_uso_com_zero_quizzes_no_ciclo: { valor: true, descricao: 'Se true, o Coringa de Manutenção pode ser usado mesmo com 0 quizzes respondidos no ciclo.' },
    quiz_especial_conta_como:              { valor: 2, descricao: 'Peso de 1 Quiz Especial aprovado na contagem de FREQUÊNCIA do ciclo de manutenção.' },
    alertas: {
      dias_para_alerta_risco:          { valor: 15, descricao: 'Dias antes do fim do ciclo em que o estado vira em_alerta.' },
      dias_para_notificacao_final:     { valor: 30, descricao: 'Dias após o fim do ciclo sem regularizar para o estado virar em_risco.' },
      dias_para_congelamento:          { valor: 60, descricao: 'Dias sem regularizar para o estado virar congelado.' },
      dias_para_rebaixamento:          { valor: 90, descricao: 'Dias sem regularizar (inatividade orgânica) para o estado virar rebaixado.' },
      dias_para_expirado:              { valor: 180, descricao: 'Dias sem regularizar (inatividade orgânica) para o selo virar expirado — perde tudo.' },
      dias_para_expirado_cancelamento: { valor: 90, descricao: 'Prazo em dias, a partir do CANCELAMENTO da assinatura, para o selo virar expirado. O rebaixamento por cancelamento já é imediato (Seção 4.6) — este prazo é até a perda total.' }
    }
  },
  notificacoes: {
    raio_alerta_mudanca_config: { valor: 1, descricao: 'Distância (em quizzes) do valor ANTIGO de um requisito de nível para o assinante ser avisado quando ele muda — seja por config alterada ou por ativar/desativar um Quiz Especial.' }
  },
  renovacao: {
    ativo:                     { valor: true, descricao: 'Liga/desliga a renovação automática por aniversário de contrato.' },
    modelo:                    { valor: 'aniversario_contrato', descricao: 'Modelo de renovação: por aniversário de contrato de cada assinante, não data fixa de calendário.' },
    quizzes_minimos_renovacao: { valor: 3, descricao: 'Quizzes que quem manteve o selo ativo o ciclo inteiro precisa responder para renovar o nível ("Renovação Simplificada").' },
    bonus_fidelidade: {
      ativo:                   { valor: true, descricao: 'Liga/desliga o bônus de fidelidade na renovação.' },
      coringa_extra:           { valor: 1, descricao: 'Coringas de Manutenção extra concedidos a quem se qualificou ao bônus.' },
      nivel_minimo_para_bonus: { valor: 'iniciante', descricao: 'Nível mínimo elegível ao bônus de fidelidade.' }
    }
  },
  coringa: {
    manutencao: {
      ativo:                     { valor: true, descricao: 'Liga/desliga o Coringa de Manutenção.' },
      quantidade_padrao:         { valor: 1, descricao: 'Coringas de Manutenção por ano de contrato, sem bônus.' },
      quantidade_com_bonus:      { valor: 2, descricao: 'Coringas de Manutenção no ciclo com bônus de fidelidade.' },
      regra_uso:                 { valor: 'ciclo_em_alerta_ou_risco_e_(aproveitamento_atual_maior_igual_70_ou_zero_quizzes_no_ciclo)', descricao: 'Condição de elegibilidade textual (Seção 6.2). Não se aplica durante cancelamento (Seção 4.6).' },
      max_usos_por_ciclo:        { valor: 1, descricao: 'Máximo de usos dentro de um ciclo de 60 dias.' },
      max_usos_por_ano_contrato: { valor: 1, descricao: 'Máximo de usos dentro de um ano de contrato inteiro.' }
    },
    progressao: {
      ativo:                            { valor: true, descricao: 'Liga/desliga o Coringa de Prorrogação.' },
      quantidade_padrao:                { valor: 3, descricao: 'Coringas de Prorrogação por ano de contrato.' },
      prazo_prorrogacao_dias:           { valor: 30, descricao: 'Dias para responder a newsletter prorrogada e ainda contar para o ciclo original.' },
      janela_maxima_dias_pos_ciclo:     { valor: 90, descricao: 'Prazo máximo pós-fim-de-ciclo para ativar uma prorrogação.' },
      bloqueia_prorrogacao_se_temporal: { valor: true, descricao: 'Se true, newsletters com conteudo_temporal=true nunca podem ser prorrogadas.' },
      max_prorrogacoes_acumuladas:      { valor: 6, descricao: 'Teto de prorrogações em aberto simultaneamente.' }
    }
  },
  quizzes_especiais: {
    ativo:              { valor: true, descricao: 'Liga/desliga os Quizzes Especiais como um todo.' },
    nivel_desbloqueio:  { valor: 'dedicado', descricao: 'Nível a partir do qual o painel de especiais fica visível.' },
    dificuldade_minima: { valor: 8, descricao: 'Dificuldade mínima (1-10) para um quiz ser cadastrado como Especial — orientação editorial, não trava automática.' },
    valor_na_frequencia:  { valor: 2, descricao: 'Peso de um especial na frequência do ciclo de manutenção (espelha manutencao.quiz_especial_conta_como).' },
    valor_na_performance: { valor: 1, descricao: 'Peso de um especial na média geral de aproveitamento.' }
  },
  ranking: {
    ativo:                              { valor: true, descricao: 'Liga/desliga a página de Ranking.' },
    visibilidade_padrao:                { valor: 'anonimo', descricao: 'Modo padrão de exibição de nomes até opt-in do assinante.' },
    niveis_exibidos:                    { valor: ['especialista', 'mestre'], descricao: 'Níveis exibidos no ranking público.' },
    atualizacao_frequencia:             { valor: 'diaria', descricao: 'Frequência de recálculo do ranking.' },
    criterios_desempate:                { valor: ['quizzes_aprovados_ano_desc', 'percentual_aproveitamento_desc', 'data_conquista_nivel_atual_asc', 'municipio_alfabetico_asc'], descricao: 'Ordem de critérios de desempate. Ranking sempre em ano calendário puro.' },
    limiar_municipio_pequeno:           { valor: 5, descricao: 'Abaixo deste nº de especialistas/mestres no município, nomes ficam ocultos e percentil vira faixa larga.' },
    faixas_percentil_municipio_pequeno: { valor: [25, 50, 75, 100], descricao: 'Faixas de arredondamento do percentil municipal para municípios pequenos.' }
  },
  adesao: {
    cooldown_convite_dias:       { valor: 5, descricao: 'Dias entre exibições do convite de adesão após "mais tarde".' },
    termos_versao_atual:         { valor: 'v1', descricao: 'Versão vigente dos termos de aceite da Academia.' },
    dias_delay_exibicao_convite: { valor: 2, descricao: 'Segundos de atraso após radarUserReady antes de mostrar o convite (nome mantém "dias" por padrão de nomenclatura, valor é em segundos).' }
  },
  certificado: {
    formato:                   { valor: 'A4', descricao: 'Formato de página do PDF do certificado.' },
    incluir_historico:         { valor: true, descricao: 'Inclui a Página 2 (histórico) no certificado.' },
    incluir_ranking_percentil: { valor: true, descricao: 'Inclui a Página 3 (percentil), sempre anonimizada.' },
    qr_code_ativo:             { valor: true, descricao: 'Inclui QR Code de validação.' },
    url_validacao:             { valor: 'https://radarsiope.com.br/validar', descricao: 'URL base da página pública de validação.' },
    storage:                   { valor: 'vercel_blob', descricao: 'Onde o PDF é armazenado.' },
    cache_horas:                { valor: 24, descricao: 'Horas de cache do PDF já gerado.' }
  },
  backfill: {
    data_corte: { valor: '2026-01-01', descricao: 'Data mais antiga considerada em qualquer backfill (lançamento ou adesão individual).' },
    ativo:      { valor: true, descricao: 'Liga/desliga rotinas de backfill.' }
  },
  versao: { valor: '1.7.0', descricao: 'Versão da especificação da Academia à qual esta configuração corresponde.' }
};

const PARAMETROS_FIDELIDADE = {
  ativo:                  { valor: true, descricao: 'Liga/desliga o Clube de Excelência.' },
  nivel_exigido:          { valor: 'mestre', descricao: 'Nível mínimo mantido durante um ano de contrato para contar um ano de fidelidade.' },
  aproveitamento_minimo:  { valor: 70, descricao: 'Aproveitamento médio mínimo (%) exigido no ano de contrato.' },
  tabela_descontos: {
    '1': { valor: 5,  descricao: '% de desconto após 1 ano de contrato consecutivo como Mestre.' },
    '2': { valor: 10, descricao: '% de desconto após 2 anos consecutivos.' },
    '3': { valor: 15, descricao: '% de desconto após 3 anos consecutivos.' },
    '4': { valor: 20, descricao: '% de desconto após 4 anos consecutivos.' },
    '5': { valor: 25, descricao: '% de desconto após 5+ anos — TETO, não aumenta mais.' }
  },
  valor_minimo_assinatura: { valor: 19.90, descricao: 'Piso (R$) da mensalidade mesmo com desconto de fidelidade + outras promoções.' },
  regras: {
    suspensao_por_inadimplencia_dias:      { valor: 30, descricao: 'Dias de inadimplência tolerados antes de suspender benefícios de fidelidade.' },
    recuperacao_perde_um_ano:              { valor: true, descricao: 'Ausência ≤ 1 ano de contrato sem Mestre: contador decresce 1 em vez de zerar.' },
    reset_apos_mais_de_um_ano_ausente:     { valor: true, descricao: 'Ausência > 1 ano de contrato sem Mestre: contador reseta para 1 (reset total, sem piso).' },
    desconto_nao_acumulavel_com_promocoes: { valor: false, descricao: 'Se true, desconto de fidelidade não soma com outras promoções.' },
    contador_minimo:                       { valor: 1, descricao: 'Valor mínimo do contador de anos consecutivos.' }
  }
};

function _ehFolhaParametro(no) {
  return no !== null && typeof no === 'object' && 'valor' in no && 'descricao' in no;
}

function _extrairValores(definicao, existente = {}) {
  const resultado = {};
  for (const chave of Object.keys(definicao)) {
    const no = definicao[chave];
    if (_ehFolhaParametro(no)) {
      const jaExiste = existente && Object.prototype.hasOwnProperty.call(existente, chave);
      resultado[chave] = jaExiste ? existente[chave] : no.valor;
    } else {
      resultado[chave] = _extrairValores(no, (existente && existente[chave]) || {});
    }
  }
  return resultado;
}

function _extrairDescricoes(definicao, existente = {}) {
  const resultado = {};
  for (const chave of Object.keys(definicao)) {
    const no = definicao[chave];
    if (_ehFolhaParametro(no)) {
      const descAtual = existente ? existente[chave] : undefined;
      resultado[chave] = (typeof descAtual === 'string' && descAtual.trim() !== '') ? descAtual : no.descricao;
    } else {
      resultado[chave] = _extrairDescricoes(no, (existente && existente[chave]) || {});
    }
  }
  return resultado;
}

function _contarFolhas(definicao) {
  let n = 0;
  for (const chave of Object.keys(definicao)) {
    const no = definicao[chave];
    n += _ehFolhaParametro(no) ? 1 : _contarFolhas(no);
  }
  return n;
}

async function _bootstrapDocumento(nomeDoc, definicao) {
  const ref = db.collection('config').doc(nomeDoc);
  const snap = await ref.get();
  const existente = snap.exists ? snap.data() : {};

  const novosValores = _extrairValores(definicao, existente);
  await ref.set({
    ...novosValores,
    atualizado_em: admin.firestore.FieldValue.serverTimestamp(),
    atualizado_por: 'admin_setup_endpoint',
  }, { merge: true });

  const refMeta = db.collection('config').doc(`${nomeDoc}_metadados`);
  const snapMeta = await refMeta.get();
  const existenteMeta = snapMeta.exists ? snapMeta.data() : {};
  const novasDescricoes = _extrairDescricoes(definicao, existenteMeta);
  await refMeta.set(novasDescricoes, { merge: true });

  return _contarFolhas(definicao);
}

async function _handleSetupInicial(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, message: 'Método não permitido.' });
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_API_TOKEN) {
    return json(res, 401, { ok: false, message: 'Não autorizado.' });
  }

  try {
    const totalSelos = await _bootstrapDocumento('selos', PARAMETROS_SELOS);
    const totalFidelidade = await _bootstrapDocumento('fidelidade', PARAMETROS_FIDELIDADE);
    return json(res, 200, {
      ok: true,
      mensagem: 'Carga inicial concluída. Valores/descrições já existentes foram preservados.',
      parametros_selos: totalSelos,
      parametros_fidelidade: totalFidelidade,
    });
  } catch (err) {
    console.error('[academia][setup-inicial] Erro:', err.message);
    return json(res, 500, { ok: false, message: 'Erro ao executar a carga inicial.' });
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
  if (acao === 'setup-inicial') return _handleSetupInicial(req, res);

  return json(res, 400, { ok: false, message: `Ação desconhecida ou não implementada: ${acao}` });
}