// ─── admin-votacoes.js ────────────────────────────────────────────────────────
// Painel administrativo de ciclos de votação de sugestões de temas
//
// Modelo Firestore: /ciclos_votacao/{cicloId}
//   titulo            string
//   descricao         string (opcional)
//   inicio_indicacao  Timestamp
//   fim_indicacao     Timestamp
//   inicio_votacao    Timestamp
//   fim_votacao       Timestamp
//   status            "rascunho" | "indicacao" | "votacao" | "encerrado" | "inativo"
//   criado_em         Timestamp
//   atualizado_em     Timestamp
// ─────────────────────────────────────────────────────────────────────────────

// ── Ponto de entrada chamado pela shell do admin ──────────────────────────────
async function carregarPainelVotacoesTemas() {
  const container = document.getElementById('votacoes-temas-content');
  if (!container) return;
  _injetarEstilosVotacoes();
  await _renderListaCiclos(container);
}

// ─── ESTILOS ──────────────────────────────────────────────────────────────────
function _injetarEstilosVotacoes() {
  if (document.getElementById('av-styles')) return;
  const s = document.createElement('style');
  s.id = 'av-styles';
  s.textContent = `
    .av-toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;}
    .av-titulo-painel{font-size:17px;font-weight:700;color:#1e293b;margin:0;}
    .av-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s;}
    .av-btn:hover{opacity:.85;}.av-btn:disabled{opacity:.45;cursor:not-allowed;}
    .av-btn-primary{background:#0e7490;color:#fff;}.av-btn-success{background:#16a34a;color:#fff;}
    .av-btn-warning{background:#d97706;color:#fff;}.av-btn-danger{background:#dc2626;color:#fff;}
    .av-btn-ghost{background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;}
    .av-btn-sm{padding:5px 10px;font-size:12px;}
    .av-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:12px;}
    .av-card-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;}
    .av-card-titulo{font-size:15px;font-weight:700;color:#1e293b;margin:0 0 4px;}
    .av-card-datas{font-size:12px;color:#64748b;line-height:1.8;}
    .av-card-acoes{display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;}
    .av-badge{display:inline-block;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;}
    .av-badge-rascunho{background:#f1f5f9;color:#64748b;}.av-badge-indicacao{background:#dbeafe;color:#1d4ed8;}
    .av-badge-votacao{background:#fef3c7;color:#b45309;}.av-badge-encerrado{background:#dcfce7;color:#15803d;}
    .av-badge-inativo{background:#fee2e2;color:#b91c1c;}
    .av-vazio{text-align:center;padding:48px 20px;color:#94a3b8;font-size:14px;}
    .av-vazio-icon{font-size:36px;display:block;margin-bottom:10px;}
    .av-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:900;display:flex;align-items:center;justify-content:center;padding:16px;}
    .av-modal{background:#fff;border-radius:12px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25);}
    .av-modal-header{display:flex;justify-content:space-between;align-items:center;padding:18px 20px 14px;border-bottom:1px solid #e2e8f0;}
    .av-modal-titulo{font-size:16px;font-weight:700;color:#1e293b;margin:0;}
    .av-modal-fechar{background:none;border:none;font-size:22px;color:#94a3b8;cursor:pointer;line-height:1;padding:0;}
    .av-modal-fechar:hover{color:#1e293b;}
    .av-modal-body{padding:20px;display:flex;flex-direction:column;gap:16px;}
    .av-modal-footer{padding:14px 20px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px;}
    .av-form-group{display:flex;flex-direction:column;gap:5px;}
    .av-form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
    .av-label{font-size:12px;font-weight:600;color:#475569;}
    .av-label span{color:#dc2626;margin-left:2px;}
    .av-input,.av-textarea{width:100%;border:1px solid #e2e8f0;border-radius:7px;padding:8px 10px;font-size:13px;color:#1e293b;background:#fff;box-sizing:border-box;transition:border-color .15s;font-family:inherit;}
    .av-input:focus,.av-textarea:focus{outline:none;border-color:#0e7490;}
    .av-textarea{resize:vertical;min-height:70px;}
    .av-form-hint{font-size:11px;color:#94a3b8;margin-top:2px;}
    .av-fase-bloco{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;}
    .av-fase-label{font-size:12px;font-weight:700;color:#0e7490;margin-bottom:10px;}
    .av-section-titulo{font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #f1f5f9;padding-bottom:6px;margin-bottom:12px;}
    .av-resultado-bloco{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:16px;}
    .av-resultado-header{padding:12px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;}
    .av-resultado-titulo{font-size:14px;font-weight:700;color:#1e293b;}
    .av-resultado-meta{font-size:12px;color:#64748b;}
    .av-rank-item{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #f1f5f9;}
    .av-rank-item:last-child{border-bottom:none;}
    .av-rank-pos{font-size:18px;min-width:30px;text-align:center;}
    .av-rank-texto{flex:1;font-size:13px;color:#1e293b;line-height:1.4;}
    .av-rank-votos{font-size:13px;font-weight:700;color:#0e7490;white-space:nowrap;}
    .av-barra-wrap{height:5px;background:#e2e8f0;border-radius:3px;margin-top:4px;overflow:hidden;}
    .av-barra-fill{height:100%;background:#0e7490;border-radius:3px;transition:width .4s ease;}
    .av-historico-table{width:100%;border-collapse:collapse;font-size:13px;}
    .av-historico-table th{background:#f8fafc;padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;border-bottom:2px solid #e2e8f0;}
    .av-historico-table td{padding:11px 12px;border-bottom:1px solid #f1f5f9;color:#1e293b;vertical-align:middle;}
    .av-historico-table tr:last-child td{border-bottom:none;}
    .av-historico-table tr:hover td{background:#f8fafc;}
    .av-confirm-msg{font-size:14px;color:#1e293b;line-height:1.6;}
    .av-confirm-destaque{font-weight:700;color:#dc2626;}
    .av-spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:av-spin .6s linear infinite;vertical-align:middle;margin-right:4px;}
    @keyframes av-spin{to{transform:rotate(360deg);}}
    .av-alert{padding:10px 14px;border-radius:8px;font-size:13px;line-height:1.5;margin-bottom:4px;}
    .av-alert-info{background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;}
    .av-alert-warning{background:#fffbeb;border:1px solid #fde68a;color:#92400e;}
  `;
  document.head.appendChild(s);
}

// ─── LISTA DE CICLOS ──────────────────────────────────────────────────────────
async function _renderListaCiclos(container) {
  container.innerHTML = '<div class="av-vazio"><span class="av-vazio-icon">⏳</span>Carregando ciclos…</div>';
  try {
    const snap = await window.db.collection('ciclos_votacao').orderBy('criado_em', 'desc').limit(50).get();

    let html = `
      <div class="av-toolbar">
        <h3 class="av-titulo-painel">🗳️ Ciclos de Votação</h3>
        <button class="av-btn av-btn-primary" onclick="avAbrirModalCiclo()">＋ Novo ciclo</button>
      </div>
    `;

    if (snap.empty) {
      html += `<div class="av-vazio"><span class="av-vazio-icon">📭</span>Nenhum ciclo cadastrado ainda.<br>Clique em <strong>Novo ciclo</strong> para começar.</div>`;
    } else {
      const ciclos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const ordem = { indicacao:0, votacao:1, rascunho:2, encerrado:3, inativo:4 };
      ciclos.sort((a, b) => (ordem[_statusEfetivo(a)] ?? 9) - (ordem[_statusEfetivo(b)] ?? 9));
      html += ciclos.map(c => _htmlCardCiclo(c)).join('');
      html += await _htmlHistoricoConsolidado();
    }

    container.innerHTML = html;
  } catch (err) {
    console.error('[admin-votacoes] listar:', err);
    container.innerHTML = `<div class="av-vazio"><span class="av-vazio-icon">⚠️</span>Erro ao carregar. Tente novamente.</div>`;
  }
}

function _htmlCardCiclo(c) {
  const status = _statusEfetivo(c);
  const labels = { rascunho:'Rascunho', indicacao:'Indicação aberta', votacao:'Votação aberta', encerrado:'Encerrado', inativo:'Inativo' };
  const fmtDt  = ts => ts ? _fmtTimestamp(ts) : '—';

  const podeEncerrar  = status === 'indicacao' || status === 'votacao';
  const podeInativar  = status !== 'inativo' && status !== 'encerrado';
  const podeReativar  = status === 'inativo';
  const podeDeletar   = status === 'rascunho' || status === 'inativo';
  const podeResultado = status === 'votacao'  || status === 'encerrado';

  return `
    <div class="av-card" id="av-card-${c.id}">
      <div class="av-card-header">
        <div>
          <p class="av-card-titulo">${_esc(c.titulo)}</p>
          <span class="av-badge av-badge-${status}">${labels[status] || status}</span>
          ${c.descricao ? `<p style="font-size:12px;color:#64748b;margin:6px 0 0;">${_esc(c.descricao)}</p>` : ''}
        </div>
        <div class="av-card-acoes">
          <button class="av-btn av-btn-ghost av-btn-sm" onclick="avAbrirModalCiclo('${c.id}')">✏️ Editar</button>
          ${podeResultado ? `<button class="av-btn av-btn-primary av-btn-sm" onclick="avAbrirResultado('${c.id}')">📊 Resultado</button>` : ''}
          ${podeEncerrar  ? `<button class="av-btn av-btn-warning av-btn-sm" onclick="avConfirmarEncerrar('${c.id}')">⏹ Encerrar</button>` : ''}
          ${podeInativar  ? `<button class="av-btn av-btn-ghost av-btn-sm" onclick="avConfirmarInativar('${c.id}')">🚫 Inativar</button>` : ''}
          ${podeReativar  ? `<button class="av-btn av-btn-success av-btn-sm" onclick="avReativarCiclo('${c.id}')">♻️ Reativar</button>` : ''}
          ${podeDeletar   ? `<button class="av-btn av-btn-danger av-btn-sm" onclick="avConfirmarDeletar('${c.id}')">🗑 Excluir</button>` : ''}
        </div>
      </div>
      <div class="av-card-datas">
        📥 <strong>Indicação:</strong> ${fmtDt(c.inicio_indicacao)} → ${fmtDt(c.fim_indicacao)}
        &nbsp;&nbsp;|&nbsp;&nbsp;
        🗳️ <strong>Votação:</strong> ${fmtDt(c.inicio_votacao)} → ${fmtDt(c.fim_votacao)}
      </div>
    </div>
  `;
}

// ─── STATUS EFETIVO ───────────────────────────────────────────────────────────
function _statusEfetivo(ciclo) {
  if (ciclo.status === 'inativo')   return 'inativo';
  if (ciclo.status === 'encerrado') return 'encerrado';

  const agora   = Date.now();
  const ini_ind = _tsMs(ciclo.inicio_indicacao);
  const fim_ind = _tsMs(ciclo.fim_indicacao);
  const ini_vot = _tsMs(ciclo.inicio_votacao);
  const fim_vot = _tsMs(ciclo.fim_votacao);

  if (!ini_ind || agora < ini_ind)                        return 'rascunho';
  if (agora >= ini_ind && fim_ind && agora <= fim_ind)    return 'indicacao';
  if (ini_vot && agora >= ini_vot && fim_vot && agora <= fim_vot) return 'votacao';
  if (fim_vot && agora > fim_vot)                         return 'encerrado';
  return 'rascunho';
}

// ─── MODAL CADASTRO / EDIÇÃO ──────────────────────────────────────────────────
window.avAbrirModalCiclo = async function (cicloId = null) {
  let ciclo = null;
  if (cicloId) {
    const snap = await window.db.collection('ciclos_votacao').doc(cicloId).get();
    if (snap.exists) ciclo = { id: snap.id, ...snap.data() };
  }

  const tituloModal = ciclo ? 'Editar ciclo' : 'Novo ciclo de votação';
  const btnLabel    = ciclo ? 'Salvar alterações' : 'Criar ciclo';
  const v = ciclo ? {
    titulo:           ciclo.titulo || '',
    descricao:        ciclo.descricao || '',
    inicio_indicacao: _tsToInputDt(ciclo.inicio_indicacao),
    fim_indicacao:    _tsToInputDt(ciclo.fim_indicacao),
    inicio_votacao:   _tsToInputDt(ciclo.inicio_votacao),
    fim_votacao:      _tsToInputDt(ciclo.fim_votacao),
  } : { titulo:'', descricao:'', inicio_indicacao:'', fim_indicacao:'', inicio_votacao:'', fim_votacao:'' };

  const modal = _criarModal(tituloModal, `
    <div class="av-alert av-alert-info">
      Defina o período de <strong>indicação</strong> (assinantes enviam sugestões)
      e o período de <strong>votação</strong> (assinantes votam nas sugestões recebidas).
    </div>
    <div class="av-form-group">
      <label class="av-label" for="av-f-titulo">Título do ciclo <span>*</span></label>
      <input id="av-f-titulo" class="av-input" type="text" maxlength="100"
        placeholder="Ex: Pauta Julho 2025" value="${_esc(v.titulo)}">
    </div>
    <div class="av-form-group">
      <label class="av-label" for="av-f-desc">Descrição (opcional)</label>
      <textarea id="av-f-desc" class="av-textarea" maxlength="300"
        placeholder="Contexto ou instruções para os assinantes…">${_esc(v.descricao)}</textarea>
    </div>
    <div class="av-fase-bloco">
      <div class="av-fase-label">📥 Fase de Indicação — assinantes enviam sugestões de tema</div>
      <div class="av-form-row">
        <div class="av-form-group">
          <label class="av-label" for="av-f-ini-ind">Abertura <span>*</span></label>
          <input id="av-f-ini-ind" class="av-input" type="datetime-local" value="${v.inicio_indicacao}">
        </div>
        <div class="av-form-group">
          <label class="av-label" for="av-f-fim-ind">Encerramento <span>*</span></label>
          <input id="av-f-fim-ind" class="av-input" type="datetime-local" value="${v.fim_indicacao}">
        </div>
      </div>
    </div>
    <div class="av-fase-bloco">
      <div class="av-fase-label">🗳️ Fase de Votação — assinantes votam nas sugestões</div>
      <div class="av-form-row">
        <div class="av-form-group">
          <label class="av-label" for="av-f-ini-vot">Abertura <span>*</span></label>
          <input id="av-f-ini-vot" class="av-input" type="datetime-local" value="${v.inicio_votacao}">
        </div>
        <div class="av-form-group">
          <label class="av-label" for="av-f-fim-vot">Encerramento <span>*</span></label>
          <input id="av-f-fim-vot" class="av-input" type="datetime-local" value="${v.fim_votacao}">
        </div>
      </div>
      <p class="av-form-hint">A votação pode iniciar antes ou depois do fim da indicação.</p>
    </div>
  `, [
    { label:'Cancelar',  classe:'av-btn-ghost',   acao: () => _fecharModal(modal) },
    { label:btnLabel,    classe:'av-btn-primary',  id:'av-btn-salvar', acao: () => _salvarCiclo(cicloId, modal) },
  ]);
  document.body.appendChild(modal);
};

async function _salvarCiclo(cicloId, modal) {
  const btn = document.getElementById('av-btn-salvar');
  const erros = [];

  const titulo         = document.getElementById('av-f-titulo')?.value.trim();
  const descricao      = document.getElementById('av-f-desc')?.value.trim();
  const inicio_ind_str = document.getElementById('av-f-ini-ind')?.value;
  const fim_ind_str    = document.getElementById('av-f-fim-ind')?.value;
  const inicio_vot_str = document.getElementById('av-f-ini-vot')?.value;
  const fim_vot_str    = document.getElementById('av-f-fim-vot')?.value;

  if (!titulo)         erros.push('Título é obrigatório.');
  if (!inicio_ind_str) erros.push('Abertura da indicação é obrigatória.');
  if (!fim_ind_str)    erros.push('Encerramento da indicação é obrigatório.');
  if (!inicio_vot_str) erros.push('Abertura da votação é obrigatória.');
  if (!fim_vot_str)    erros.push('Encerramento da votação é obrigatório.');

  if (erros.length === 0) {
    const ini_ind = new Date(inicio_ind_str);
    const fim_ind = new Date(fim_ind_str);
    const ini_vot = new Date(inicio_vot_str);
    const fim_vot = new Date(fim_vot_str);

    if (fim_ind <= ini_ind) erros.push('Encerramento da indicação deve ser após a abertura.');
    if (fim_vot <= ini_vot) erros.push('Encerramento da votação deve ser após a abertura.');
    if (ini_vot < ini_ind)  erros.push('A votação não pode começar antes do início da indicação.');
  }

  modal.querySelector('.av-erro-geral')?.remove();
  if (erros.length > 0) {
    const div = document.createElement('div');
    div.className = 'av-alert av-alert-warning av-erro-geral';
    div.innerHTML = erros.map(e => `⚠️ ${e}`).join('<br>');
    modal.querySelector('.av-modal-body').prepend(div);
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="av-spinner"></span> Salvando…';

  try {
    const payload = {
      titulo,
      descricao:        descricao || '',
      inicio_indicacao: new Date(inicio_ind_str),
      fim_indicacao:    new Date(fim_ind_str),
      inicio_votacao:   new Date(inicio_vot_str),
      fim_votacao:      new Date(fim_vot_str),
      atualizado_em:    new Date(),
    };

    if (cicloId) {
      await window.db.collection('ciclos_votacao').doc(cicloId).update(payload);
    } else {
      payload.status    = 'rascunho';
      payload.criado_em = new Date();
      await window.db.collection('ciclos_votacao').add(payload);
    }

    _fecharModal(modal);
    await _renderListaCiclos(document.getElementById('votacoes-temas-content'));
  } catch (err) {
    console.error('[admin-votacoes] salvar:', err);
    btn.disabled = false;
    btn.textContent = 'Tentar novamente';
    const div = document.createElement('div');
    div.className = 'av-alert av-alert-warning av-erro-geral';
    div.textContent = '⚠️ Erro ao salvar. Verifique o console e tente novamente.';
    modal.querySelector('.av-modal-body').prepend(div);
  }
}

// ─── ENCERRAR ─────────────────────────────────────────────────────────────────
window.avConfirmarEncerrar = function (cicloId) {
  const modal = _criarModalConfirm(
    'Encerrar ciclo',
    `<p class="av-confirm-msg">Deseja encerrar este ciclo agora?<br>
     O status será marcado como <strong class="av-confirm-destaque">Encerrado</strong>
     e o ranking final será congelado. Esta ação não pode ser desfeita.</p>`,
    '⏹ Encerrar ciclo', 'av-btn-warning',
    async () => {
      const btn = modal.querySelector('.av-btn-confirm');
      btn.disabled = true;
      btn.innerHTML = '<span class="av-spinner"></span> Encerrando…';
      try {
        const sugestoesSnap = await window.db.collection('sugestoes_publicas')
          .where('ciclo_id', '==', cicloId).get();

        const rankingFinal = sugestoesSnap.docs
          .map(d => ({ id: d.id, solicitacao_ref: d.data().solicitacao_ref, votos: d.data().votos || 0 }))
          .sort((a, b) => b.votos - a.votos)
          .map((item, i) => ({ posicao: i + 1, ...item }));

        const batch = window.db.batch();
        batch.update(window.db.collection('ciclos_votacao').doc(cicloId), {
          status: 'encerrado', ranking_final: rankingFinal,
          encerrado_em: new Date(), atualizado_em: new Date(),
        });
        sugestoesSnap.docs.forEach(doc =>
          batch.update(doc.ref, { status: 'encerrada', encerrado_em: new Date() })
        );
        await batch.commit();
        _fecharModal(modal);
        await _renderListaCiclos(document.getElementById('votacoes-temas-content'));
      } catch (err) {
        console.error('[admin-votacoes] encerrar:', err);
        btn.disabled = false; btn.textContent = 'Tentar novamente';
      }
    }
  );
  document.body.appendChild(modal);
};

// ─── INATIVAR ─────────────────────────────────────────────────────────────────
window.avConfirmarInativar = function (cicloId) {
  const modal = _criarModalConfirm(
    'Inativar ciclo',
    `<p class="av-confirm-msg">O ciclo ficará <strong class="av-confirm-destaque">invisível para os assinantes</strong>
     mas poderá ser reativado a qualquer momento.</p>`,
    '🚫 Inativar', 'av-btn-warning',
    async () => {
      const btn = modal.querySelector('.av-btn-confirm');
      btn.disabled = true;
      btn.innerHTML = '<span class="av-spinner"></span> Inativando…';
      try {
        await window.db.collection('ciclos_votacao').doc(cicloId)
          .update({ status: 'inativo', atualizado_em: new Date() });
        _fecharModal(modal);
        await _renderListaCiclos(document.getElementById('votacoes-temas-content'));
      } catch (err) {
        console.error('[admin-votacoes] inativar:', err);
        btn.disabled = false; btn.textContent = 'Tentar novamente';
      }
    }
  );
  document.body.appendChild(modal);
};

// ─── REATIVAR ─────────────────────────────────────────────────────────────────
window.avReativarCiclo = async function (cicloId) {
  try {
    await window.db.collection('ciclos_votacao').doc(cicloId)
      .update({ status: 'rascunho', atualizado_em: new Date() });
    await _renderListaCiclos(document.getElementById('votacoes-temas-content'));
  } catch (err) {
    console.error('[admin-votacoes] reativar:', err);
    alert('Erro ao reativar ciclo.');
  }
};

// ─── EXCLUIR ──────────────────────────────────────────────────────────────────
window.avConfirmarDeletar = function (cicloId) {
  const modal = _criarModalConfirm(
    'Excluir ciclo',
    `<p class="av-confirm-msg">Esta ação é <strong class="av-confirm-destaque">irreversível</strong>.
     O ciclo será removido permanentemente.<br>
     As sugestões vinculadas <em>não</em> serão excluídas.</p>`,
    '🗑 Excluir definitivamente', 'av-btn-danger',
    async () => {
      const btn = modal.querySelector('.av-btn-confirm');
      btn.disabled = true;
      btn.innerHTML = '<span class="av-spinner"></span> Excluindo…';
      try {
        await window.db.collection('ciclos_votacao').doc(cicloId).delete();
        _fecharModal(modal);
        await _renderListaCiclos(document.getElementById('votacoes-temas-content'));
      } catch (err) {
        console.error('[admin-votacoes] deletar:', err);
        btn.disabled = false; btn.textContent = 'Tentar novamente';
      }
    }
  );
  document.body.appendChild(modal);
};

// ─── RESULTADO ────────────────────────────────────────────────────────────────
window.avAbrirResultado = async function (cicloId) {
  const modal = _criarModal('📊 Resultado da Votação',
    '<div style="text-align:center;padding:40px;color:#94a3b8;">Carregando resultado…</div>',
    [{ label:'Fechar', classe:'av-btn-ghost', acao: () => _fecharModal(modal) }]
  );
  document.body.appendChild(modal);

  try {
    const [cicloSnap, sugestoesSnap] = await Promise.all([
      window.db.collection('ciclos_votacao').doc(cicloId).get(),
      window.db.collection('sugestoes_publicas').where('ciclo_id', '==', cicloId).get(),
    ]);

    if (!cicloSnap.exists) {
      modal.querySelector('.av-modal-body').innerHTML = '<p style="color:#dc2626;">Ciclo não encontrado.</p>';
      return;
    }

    const ciclo     = cicloSnap.data();
    const sugestoes = sugestoesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const status    = _statusEfetivo(ciclo);
    const labels    = { rascunho:'Rascunho', indicacao:'Indicação aberta', votacao:'Votação aberta', encerrado:'Encerrado', inativo:'Inativo' };

    let ranking = ciclo.ranking_final
      ? ciclo.ranking_final.map(item => {
          const orig = sugestoes.find(s => s.id === item.id || s.solicitacao_ref === item.solicitacao_ref);
          return orig ? { ...orig, posicao: item.posicao, votos: item.votos } : null;
        }).filter(Boolean)
      : [...sugestoes].sort((a, b) => (b.votos || 0) - (a.votos || 0))
          .map((s, i) => ({ ...s, posicao: i + 1 }));

    ranking = await Promise.all(ranking.map(async s => ({
      ...s, texto: await _buscarTextoSolicitacao(s.solicitacao_ref),
    })));

    const totalVotos  = ranking.reduce((a, s) => a + (s.votos || 0), 0);
    const maxVotos    = ranking[0]?.votos || 1;
    const medalhas    = ['🥇', '🥈', '🥉'];

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
        <div>
          <strong style="font-size:15px;">${_esc(ciclo.titulo)}</strong><br>
          <span class="av-badge av-badge-${status}" style="margin-top:5px;">${labels[status] || status}</span>
        </div>
        <div style="font-size:12px;color:#64748b;line-height:2;text-align:right;">
          <div>📥 Indicação: ${_fmtTimestamp(ciclo.inicio_indicacao)} → ${_fmtTimestamp(ciclo.fim_indicacao)}</div>
          <div>🗳️ Votação: ${_fmtTimestamp(ciclo.inicio_votacao)} → ${_fmtTimestamp(ciclo.fim_votacao)}</div>
        </div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
        ${_statBox('Sugestões',   ranking.length, '#0e7490')}
        ${_statBox('Votos totais', totalVotos,    '#7c3aed')}
        ${_statBox('Votos líder',  maxVotos,      '#d97706')}
      </div>
    `;

    if (ranking.length === 0) {
      html += '<div class="av-vazio"><span class="av-vazio-icon">📭</span>Nenhuma sugestão neste ciclo ainda.</div>';
    } else {
      html += `<div class="av-resultado-bloco">
        <div class="av-resultado-header">
          <span class="av-resultado-titulo">Ranking</span>
          <span class="av-resultado-meta">${ciclo.encerrado_em ? 'Resultado final · ' + _fmtTimestamp(ciclo.encerrado_em) : '⏱ Ao vivo'}</span>
        </div>`;
      ranking.slice(0, 10).forEach((s, i) => {
        const votos = s.votos || 0;
        const pct   = Math.round((votos / maxVotos) * 100);
        html += `
          <div class="av-rank-item">
            <div class="av-rank-pos">${medalhas[i] || '#' + (i + 1)}</div>
            <div style="flex:1;">
              <div class="av-rank-texto">${_esc(s.texto || s.texto_preview || '(texto não encontrado)')}</div>
              <div class="av-barra-wrap"><div class="av-barra-fill" style="width:${pct}%;"></div></div>
            </div>
            <div class="av-rank-votos">👍 ${votos}</div>
          </div>`;
      });
      html += '</div>';
    }

    modal.querySelector('.av-modal-body').innerHTML = html;
  } catch (err) {
    console.error('[admin-votacoes] resultado:', err);
    modal.querySelector('.av-modal-body').innerHTML = '<p style="color:#dc2626;">Erro ao carregar resultado.</p>';
  }
};

function _statBox(label, valor, cor) {
  return `<div style="flex:1;min-width:90px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center;">
    <div style="font-size:22px;font-weight:800;color:${cor};">${valor}</div>
    <div style="font-size:11px;color:#64748b;margin-top:2px;">${label}</div>
  </div>`;
}

// ─── HISTÓRICO CONSOLIDADO ────────────────────────────────────────────────────
async function _htmlHistoricoConsolidado() {
  try {
    const snap = await window.db.collection('ciclos_votacao')
      .where('status', '==', 'encerrado')
      .orderBy('fim_votacao', 'desc').get();
    if (snap.empty) return '';

    let html = `
      <div style="margin-top:32px;">
        <div class="av-section-titulo">📈 Histórico de Ciclos Encerrados</div>
        <div style="overflow-x:auto;">
          <table class="av-historico-table">
            <thead><tr>
              <th>Ciclo</th><th>Período de votação</th>
              <th style="text-align:center;">Sugestões</th>
              <th style="text-align:center;">Votos</th>
              <th>Vencedor</th><th></th>
            </tr></thead><tbody>`;

    for (const doc of snap.docs) {
      const c       = { id: doc.id, ...doc.data() };
      const ranking = c.ranking_final || [];
      const totalV  = ranking.reduce((a, r) => a + (r.votos || 0), 0);
      const venc    = ranking[0];
      let textoV    = '—';
      if (venc?.solicitacao_ref) {
        textoV = await _buscarTextoSolicitacao(venc.solicitacao_ref);
        if (textoV.length > 55) textoV = textoV.substring(0, 55) + '…';
      }
      html += `
        <tr>
          <td><strong>${_esc(c.titulo)}</strong></td>
          <td style="white-space:nowrap;color:#64748b;">${_fmtTimestampCurto(c.inicio_votacao)} → ${_fmtTimestampCurto(c.fim_votacao)}</td>
          <td style="text-align:center;"><strong>${ranking.length}</strong></td>
          <td style="text-align:center;"><strong>${totalV}</strong></td>
          <td style="max-width:220px;font-size:12px;">${_esc(textoV)}</td>
          <td><button class="av-btn av-btn-ghost av-btn-sm" onclick="avAbrirResultado('${c.id}')">📊 Ver</button></td>
        </tr>`;
    }
    html += '</tbody></table></div></div>';
    return html;
  } catch (err) {
    console.warn('[admin-votacoes] histórico:', err);
    return '';
  }
}

// ─── FÁBRICAS DE MODAL ────────────────────────────────────────────────────────
function _criarModal(titulo, bodyHtml, botoes = []) {
  const bg = document.createElement('div');
  bg.className = 'av-modal-bg';
  bg.innerHTML = `
    <div class="av-modal">
      <div class="av-modal-header">
        <h3 class="av-modal-titulo">${titulo}</h3>
        <button class="av-modal-fechar" data-fechar>×</button>
      </div>
      <div class="av-modal-body">${bodyHtml}</div>
      <div class="av-modal-footer">
        ${botoes.map(b => `<button class="av-btn ${b.classe}" ${b.id ? `id="${b.id}"` : ''} data-av-btn="${_esc(b.label)}">${b.label}</button>`).join('')}
      </div>
    </div>`;
  bg.querySelector('[data-fechar]').addEventListener('click', () => _fecharModal(bg));
  bg.addEventListener('click', e => { if (e.target === bg) _fecharModal(bg); });
  botoes.forEach(b => {
    const el = bg.querySelector(`[data-av-btn="${_esc(b.label)}"]`);
    if (el) el.addEventListener('click', b.acao);
  });
  return bg;
}

function _criarModalConfirm(titulo, bodyHtml, labelConfirmar, classeConfirmar, onConfirmar) {
  return _criarModal(titulo, bodyHtml, [
    { label:'Cancelar',     classe:'av-btn-ghost',                      acao: (e) => _fecharModal(e.target.closest('.av-modal-bg')) },
    { label:labelConfirmar, classe:`${classeConfirmar} av-btn-confirm`,  acao: onConfirmar },
  ]);
}

function _fecharModal(el) { el?.remove(); }

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────
function _tsMs(ts) {
  if (!ts) return null;
  if (ts.seconds) return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  return new Date(ts).getTime();
}
function _fmtTimestamp(ts) {
  const ms = _tsMs(ts);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function _fmtTimestampCurto(ts) {
  const ms = _tsMs(ts);
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' });
}
function _tsToInputDt(ts) {
  const ms = _tsMs(ts);
  if (!ms) return '';
  const d   = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function _esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
async function _buscarTextoSolicitacao(solicitacaoPath) {
  try {
    if (!solicitacaoPath || typeof solicitacaoPath !== 'string') return '';
    const parts = solicitacaoPath.split('/');
    if (parts.length < 4) return '';
    const doc = await window.db.collection('usuarios').doc(parts[1])
      .collection('solicitacoes').doc(parts[3]).get();
    return doc.exists ? (doc.data().descricao || doc.data().texto || '') : '';
  } catch (e) {
    console.warn('[admin-votacoes] buscarTexto:', e.message);
    return '';
  }
}
