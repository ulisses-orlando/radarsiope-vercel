/* ==========================================================================
   triggersAcademia.js — Cloud Functions (Firebase Functions v1 style)
   Primeira peça real de trigger da Academia: onQuizEspecialToggle.

   Depende de um ajuste de schema em usuarios/{uid}/quiz_resultados: quando
   tipo==='especial', o documento agora também grava `nivel_alvo` (copiado
   do quizzes_especiais/{id} no momento da resposta) — sem isso, contar
   "quantos aprovados desse nível" exigiria 1 leitura extra por resultado.
   Ajustar isso em _handleSalvarResultadoQuiz (pagamentoMP.js) e no futuro
   trigger onQuizResultCreate (Seção 12.2 da spec) quando ele for escrito.
   ========================================================================== */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

// ─── Helper genérico: cria uma mensagem_admin do sistema ─────────────────────
// Escopo desta rodada: só usado pelo onQuizEspecialToggle. Fica pronto pra
// ser reaproveitado pelos outros gatilhos da Seção 21.9 quando tratarmos
// cada um deles, um de cada vez.
async function _criarMensagemAdmin(uid, { titulo, descricao, evento, chaveDedup = null, permiteResposta = false }) {
  await db.collection('usuarios').doc(uid).collection('solicitacoes').add({
    tipo: 'mensagem_admin',
    titulo,
    descricao,
    status: 'atendida',
    permite_resposta: permiteResposta,
    lida: false,
    enviado_por: 'Academia Radar SIOPE',
    origem_academia: true,
    evento,
    chave_dedup: chaveDedup, // usado por _jaNotificadoRecentemente para não duplicar avisos
    data_solicitacao: new Date().toISOString(),
  });
}

// ─── Helper: dedup — evita reenviar o mesmo aviso em toggles repetidos ───────
async function _jaNotificadoRecentemente(uid, evento, chave) {
  const umDiaAtras = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const snap = await db.collection('usuarios').doc(uid).collection('solicitacoes')
    .where('evento', '==', evento)
    .where('chave_dedup', '==', chave)
    .where('data_solicitacao', '>=', umDiaAtras)
    .limit(1)
    .get();
  return !snap.empty;
}

function _tituloNivel(chave) {
  const nomes = { dedicado: 'Dedicado', especialista: 'Especialista', mestre: 'Mestre' };
  return nomes[chave] || chave;
}

// ─── Busca assinantes afetados pela mudança de requisito ─────────────────────
// Critério: já são membros da Academia, ainda não têm `nivelAlvo` travado em
// academia_niveis (a mudança só importa pra quem ainda está buscando esse
// nível), e já tinham aprovado >= (totalAntes - raio) especiais daquele
// nivel_alvo — ou seja, "quem já tinha batido o valor antigo ou estava perto".
//
// ATENÇÃO (escala): isto faz 2 leituras extras por membro da Academia
// (academia_niveis + contagem de quiz_resultados). Para poucas centenas/
// poucos milhares de membros é aceitável rodar dentro do próprio trigger;
// se a base crescer muito, o caminho é manter um contador denormalizado
// (ex.: usuarios/{uid}.academia.especiais_aprovados_especialista) atualizado
// incrementalmente a cada resposta, em vez de recontar aqui toda vez.
async function _buscarAssinantesProximosDoRequisito(nivelAlvo, totalAntes, raio) {
  const membrosSnap = await db.collection('usuarios')
    .where('academia.status', '==', 'membro')
    .get();

  const candidatos = [];

  for (const doc of membrosSnap.docs) {
    const uid = doc.id;

    const nivelJaConquistado = await db.collection('usuarios').doc(uid)
      .collection('academia_niveis').doc(nivelAlvo).get();
    if (nivelJaConquistado.exists) continue; // já travou — mudança não afeta mais

    const aprovadosSnap = await db.collection('usuarios').doc(uid)
      .collection('quiz_resultados')
      .where('tipo', '==', 'especial')
      .where('nivel_alvo', '==', nivelAlvo)
      .where('aprovado', '==', true)
      .get();

    if (aprovadosSnap.size >= Math.max(0, totalAntes - raio)) {
      candidatos.push(uid);
    }
  }

  return candidatos;
}

// ─── Trigger principal ────────────────────────────────────────────────────────
exports.onQuizEspecialToggle = functions.firestore
  .document('quizzes_especiais/{quizEspecialId}')
  .onUpdate(async (change, context) => {
    const antes = change.before.data();
    const depois = change.after.data();

    // Só age quando `ativo` de fato muda — edição de título/perguntas não dispara nada
    if (antes.ativo === depois.ativo) return null;

    const nivelAlvo = depois.nivel_alvo;
    if (!nivelAlvo) {
      console.warn(`[onQuizEspecialToggle] Quiz ${context.params.quizEspecialId} sem nivel_alvo — ignorado.`);
      return null;
    }

    // Contagem de ativos DEPOIS da escrita (já reflete a mudança no Firestore)
    const ativosDepoisSnap = await db.collection('quizzes_especiais')
      .where('nivel_alvo', '==', nivelAlvo)
      .where('ativo', '==', true)
      .get();
    const totalDepois = ativosDepoisSnap.size;
    const totalAntes = depois.ativo ? totalDepois - 1 : totalDepois + 1;

    if (totalAntes === totalDepois) return null; // defensivo, não deveria ocorrer

    const configSnap = await db.collection('config_academia').doc('selos').get();
    const raio = configSnap.data()?.notificacoes?.raio_alerta_mudanca_config ?? 1;

    const afetados = await _buscarAssinantesProximosDoRequisito(nivelAlvo, totalAntes, raio);
    if (afetados.length === 0) return null;

    const cresceu = totalDepois > totalAntes;
    const descricao = cresceu
      ? `O nível ${_tituloNivel(nivelAlvo)} agora exige ${totalDepois} Quizzes Especiais (antes eram ${totalAntes}). Continue respondendo para completar!`
      : `O nível ${_tituloNivel(nivelAlvo)} agora exige apenas ${totalDepois} Quizzes Especiais (antes eram ${totalAntes}). Você pode estar mais perto do que imaginava!`;

    const chaveDedup = `${nivelAlvo}_${totalAntes}_${totalDepois}`;

    await Promise.all(afetados.map(async uid => {
      const jaNotificado = await _jaNotificadoRecentemente(uid, 'config_alterada', chaveDedup);
      if (jaNotificado) return;

      await _criarMensagemAdmin(uid, {
        titulo: '🔧 Requisito de nível atualizado',
        descricao,
        evento: 'config_alterada',
        chaveDedup,
      });
    }));

    console.log(`[onQuizEspecialToggle] ${afetados.length} assinante(s) notificado(s) — ${nivelAlvo}: ${totalAntes} → ${totalDepois}`);
    return null;
  });
