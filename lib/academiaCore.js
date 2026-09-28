/* ==========================================================================
   academiaCore.js — Lógica central da Academia (SEM plano Blaze / sem trigger)

   Substitui o antigo triggersAcademia.js (Firebase Cloud Functions). Em vez
   de reagir sozinho a mudanças no Firestore, este módulo é uma biblioteca
   comum, chamada DIRETAMENTE por quem grava o documento:

   - pagamentoMP.js chama processarResultadoQuiz(...) logo depois de gravar
     um quiz_resultados com status:'finalizada' (dentro de _handleSalvarResultadoQuiz)
   - academia.js chama processarToggleEspecial(...) na ação `toggle-especial`,
     logo depois de atualizar o campo `ativo` em quizzes_especiais

   Nenhuma das duas funções tem URL própria nem roda sozinha — são funções
   normais de JS, importadas e chamadas em sequência, na mesma execução da
   Vercel Function que originou a escrita. Efeito idêntico ao trigger de
   antes, custo zero de infraestrutura.

   Import: `import { processarResultadoQuiz, processarToggleEspecial } from './academiaCore.js';`
   Este arquivo NÃO inicializa o firebase-admin sozinho — espera receber a
   instância `db` já pronta de quem o chama (evita duplicar credenciais/
   inicialização entre pagamentoMP.js e academia.js).
   ========================================================================== */

const ORDEM_NIVEIS = ['iniciante', 'dedicado', 'especialista', 'mestre'];

// ─── Ciclo de contrato: em qual "ano de contrato" (n) uma data cai ───────────
// Comparação de datas (não divisão por 365), pra não errar em bissextos.
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

function _tituloNivel(chave) {
  const nomes = { dedicado: 'Dedicado', especialista: 'Especialista', mestre: 'Mestre' };
  return nomes[chave] || chave;
}

// ─── Mensagem ao assinante — mesmo canal do Fale Conosco (Seção 21.9) ────────
async function _criarMensagemAdmin(db, uid, { titulo, descricao, evento, chaveDedup = null, permiteResposta = false }) {
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
    chave_dedup: chaveDedup,
    data_solicitacao: new Date().toISOString(),
  });
}

async function _jaNotificadoRecentemente(db, uid, evento, chave) {
  const umDiaAtras = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const snap = await db.collection('usuarios').doc(uid).collection('solicitacoes')
    .where('evento', '==', evento)
    .where('chave_dedup', '==', chave)
    .where('data_solicitacao', '>=', umDiaAtras)
    .limit(1)
    .get();
  return !snap.empty;
}

// ══════════════════════════════════════════════════════════════════════════
// processarResultadoQuiz — Camada 1 (núcleo): ano de contrato, contadores do
// ciclo e trava de nível. Chamada por pagamentoMP.js logo após gravar um
// quiz_resultados com status:'finalizada'. NÃO trata aqui: máquina de
// estados do ciclo de manutenção (cron diário, Seção 4.4/5.1) nem
// coringas/fidelidade.
//
// Parâmetros:
//   db            — instância Firestore já inicializada por quem chama
//   uid           — uid do assinante
//   resultadoRef  — DocumentReference do quiz_resultados recém-finalizado
//   resultadoData — os dados desse documento (newsletter_id/quiz_especial_id, tipo, etc.)
// ══════════════════════════════════════════════════════════════════════════
async function processarResultadoQuiz(db, uid, resultadoRef, resultadoData) {
  // 1. Só processa para membros da Academia
  const usuarioDoc = await db.collection('usuarios').doc(uid).get();
  if (usuarioDoc.data()?.academia?.status !== 'membro') return { processado: false, motivo: 'nao_e_membro' };

  // 2. Certificado precisa existir com data_inicio_contrato (gravado na adesão)
  const certificadoRef = db.collection('certificados').doc(uid);
  const certificadoDoc = await certificadoRef.get();
  if (!certificadoDoc.exists || !certificadoDoc.data()?.data_inicio_contrato) {
    console.warn(`[academiaCore] certificados/${uid} sem data_inicio_contrato (adesão pendente) — ignorando.`);
    return { processado: false, motivo: 'adesao_pendente' };
  }
  const certificado = certificadoDoc.data();
  const dataInicioContrato = new Date(certificado.data_inicio_contrato);

  // 3. Data de referência: da newsletter (normal) ou "agora" (especial)
  let dataReferencia = new Date();
  if (resultadoData.tipo === 'normal' && resultadoData.newsletter_id) {
    const newsletterDoc = await db.collection('newsletters').doc(resultadoData.newsletter_id).get();
    const dataPub = newsletterDoc.data()?.data_publicacao;
    dataReferencia = dataPub?.toDate ? dataPub.toDate() : (dataPub ? new Date(dataPub) : dataReferencia);
  }
  const anoCalendarioReferencia = dataReferencia.getFullYear();

  const ciclo = _calcularCicloContrato(dataInicioContrato, dataReferencia);
  if (!ciclo) {
    console.warn(`[academiaCore] Data de referência anterior ao início do contrato de ${uid} — ignorando.`);
    return { processado: false, motivo: 'data_anterior_ao_contrato' };
  }
  const anoContratoReferencia = ciclo.n;

  await resultadoRef.update({
    ano_contrato_referencia: anoContratoReferencia,
    ano_calendario_referencia: anoCalendarioReferencia,
  });

  // 4. Recontagem completa do ciclo — sempre do zero (idempotente, tolera
  // reprocessamento). Ignora tentativas 'em_andamento' (pontuação ainda nula).
  const doCicloSnap = await db.collection('usuarios').doc(uid)
    .collection('quiz_resultados')
    .where('ano_contrato_referencia', '==', anoContratoReferencia)
    .get();

  const normaisUnicos = new Map();
  const especiaisPorNivel = { especialista: new Map(), mestre: new Map() };

  doCicloSnap.docs.forEach(d => {
    const r = d.data();
    if (r.status === 'em_andamento') return; // ainda não é um resultado de verdade

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

  // 5. Verifica progressão sequencial — pode subir mais de 1 nível de uma vez
  const configSnap = await db.collection('config_academia').doc('selos').get();
  const configSelos = configSnap.data() || {};

  let nivelAtual = certificado.nivel_atual_global || 'iniciante';
  let subiuDeNivel = false;

  while (true) {
    const proximoNivel = ORDEM_NIVEIS[ORDEM_NIVEIS.indexOf(nivelAtual) + 1];
    if (!proximoNivel) break;

    const cfgProximo = configSelos.niveis?.[proximoNivel];
    if (!cfgProximo) break;

    const bateuNormais = normaisAprovados >= cfgProximo.quizzes_aprovados;

    let bateuEspeciais = true;
    let especiaisExigidosAgora = 0;
    if (proximoNivel === 'especialista' || proximoNivel === 'mestre') {
      // v1.7: requisito = contagem AO VIVO de ativos daquele nivel_alvo, não config
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
      });
      subiuDeNivel = true;
    }
    nivelAtual = proximoNivel;
  }

  // 6. Atualiza certificado raiz e histórico do ciclo corrente
  await certificadoRef.set({
    nivel_atual_global: nivelAtual,
    nome_nivel_global: configSelos.niveis?.[nivelAtual]?.nome || nivelAtual,
  }, { merge: true });

  await certificadoRef.collection('historico').doc(String(anoContratoReferencia)).set({
    n: anoContratoReferencia,
    nivel_atual: nivelAtual,
    quizzes_normais_aprovados_ciclo: normaisAprovados,
    quizzes_especiais_aprovados_especialista: especiaisAprovados.especialista,
    quizzes_especiais_aprovados_mestre: especiaisAprovados.mestre,
    atualizado_em: new Date().toISOString(),
  }, { merge: true });

  // 7. Notifica conquista de nível
  if (subiuDeNivel) {
    await _criarMensagemAdmin(db, uid, {
      titulo: '🎉 Novo nível conquistado!',
      descricao: `Parabéns! Você alcançou o nível ${configSelos.niveis?.[nivelAtual]?.nome || nivelAtual} na Academia Radar SIOPE.`,
      evento: 'nivel_conquistado',
    });
  }

  return { processado: true, nivelAtual, subiuDeNivel, normaisAprovados, especiaisAprovados };
}

// ══════════════════════════════════════════════════════════════════════════
// processarToggleEspecial — chamada por academia.js (ação `toggle-especial`)
// logo após atualizar `ativo` de um doc em quizzes_especiais. Notifica quem
// já estava perto do requisito antigo daquele nivel_alvo (Seção 21.9).
// ══════════════════════════════════════════════════════════════════════════
async function processarToggleEspecial(db, { nivelAlvo, novoAtivo }) {
  if (!nivelAlvo) return { processado: false, motivo: 'sem_nivel_alvo' };

  const ativosDepoisSnap = await db.collection('quizzes_especiais')
    .where('nivel_alvo', '==', nivelAlvo).where('ativo', '==', true).get();
  const totalDepois = ativosDepoisSnap.size;
  const totalAntes = novoAtivo ? totalDepois - 1 : totalDepois + 1;
  if (totalAntes === totalDepois) return { processado: false, motivo: 'sem_mudanca' };

  const configSnap = await db.collection('config_academia').doc('selos').get();
  const raio = configSnap.data()?.notificacoes?.raio_alerta_mudanca_config ?? 1;

  // Busca membros que ainda não travaram esse nível e já estavam perto do valor antigo
  const membrosSnap = await db.collection('usuarios').where('academia.status', '==', 'membro').get();
  const afetados = [];
  for (const doc of membrosSnap.docs) {
    const uid = doc.id;
    const nivelJaConquistado = await db.collection('usuarios').doc(uid)
      .collection('academia_niveis').doc(nivelAlvo).get();
    if (nivelJaConquistado.exists) continue;

    const aprovadosSnap = await db.collection('usuarios').doc(uid)
      .collection('quiz_resultados')
      .where('tipo', '==', 'especial').where('nivel_alvo', '==', nivelAlvo).where('aprovado', '==', true)
      .get();

    if (aprovadosSnap.size >= Math.max(0, totalAntes - raio)) afetados.push(uid);
  }
  if (afetados.length === 0) return { processado: true, afetados: 0 };

  const cresceu = totalDepois > totalAntes;
  const descricao = cresceu
    ? `O nível ${_tituloNivel(nivelAlvo)} agora exige ${totalDepois} Quizzes Especiais (antes eram ${totalAntes}). Continue respondendo para completar!`
    : `O nível ${_tituloNivel(nivelAlvo)} agora exige apenas ${totalDepois} Quizzes Especiais (antes eram ${totalAntes}). Você pode estar mais perto do que imaginava!`;
  const chaveDedup = `${nivelAlvo}_${totalAntes}_${totalDepois}`;

  await Promise.all(afetados.map(async uid => {
    if (await _jaNotificadoRecentemente(db, uid, 'config_alterada', chaveDedup)) return;
    await _criarMensagemAdmin(db, uid, {
      titulo: '🔧 Requisito de nível atualizado', descricao, evento: 'config_alterada', chaveDedup,
    });
  }));

  return { processado: true, afetados: afetados.length, totalAntes, totalDepois };
}

export { processarResultadoQuiz, processarToggleEspecial };
