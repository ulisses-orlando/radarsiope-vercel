// faleConosco.js
// Botão "Fale Conosco" no app verNewsletterComToken
// Permite que assinantes e leads enviem mensagens e sugestões de tema
// ─────────────────────────────────────────────────────────────────────────────
 
(function () {
  'use strict';
 
  const MAX_CHARS = 250;
  const STORAGE_KEY_BADGE = 'rs_fc_respondidas_vistas';
 
  // ── Inicialização ─────────────────────────────────────────────────────────
  function init() {
    _injetarHTML();
    _injetarCSS();
    _bindEventos();
    _atualizarBadge();
  }
 
  // ── HTML ──────────────────────────────────────────────────────────────────
  function _injetarHTML() {
    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'rs-fc-overlay';
    overlay.setAttribute('role', 'presentation');
    document.body.appendChild(overlay);
 
    // Drawer
    const drawer = document.createElement('aside');
    drawer.id = 'rs-fc-panel';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', 'Fale Conosco');
    drawer.innerHTML = `
      <div id="rs-fc-header">
        <span id="rs-fc-titulo">💬 Fale Conosco</span>
        <button id="rs-fc-fechar" type="button" aria-label="Fechar">×</button>
      </div>
      <div id="rs-fc-body">
        <div class="rs-fc-loading">Carregando…</div>
      </div>
    `;
    document.body.appendChild(drawer);
  }
 
  // ── CSS ───────────────────────────────────────────────────────────────────
  function _injetarCSS() {
    const style = document.createElement('style');
    style.textContent = `
      /* Badge de respostas recebidas */
      #rs-fc-badge {
        min-width: 18px; height: 18px;
        padding: 0 5px;
        background: #22c55e;
        color: #fff;
        border-radius: 99px;
        font-size: 10px; font-weight: 800;
        line-height: 18px; text-align: center;
        margin-left: 2px;
      }
 
      /* ── Overlay ────────────────────────────────────────────────────────── */
      #rs-fc-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,.5);
        z-index: 600; opacity: 0; pointer-events: none;
        transition: opacity .25s;
        backdrop-filter: blur(2px);
      }
      #rs-fc-overlay.rs-fc-show { opacity: 1; pointer-events: all; }
 
      /* ── Painel ─────────────────────────────────────────────────────────── */
      #rs-fc-panel {
        position: fixed; top: 0; right: 0; bottom: 0;
        width: min(500px, 96vw);
        background: var(--rs-card, #1e293b);
        z-index: 700;
        display: flex; flex-direction: column;
        transform: translateX(110%);
        transition: transform .28s cubic-bezier(.4,0,.2,1);
        box-shadow: -4px 0 32px rgba(0,0,0,.3);
        overflow: hidden;
      }
      #rs-fc-panel.rs-fc-show { transform: translateX(0); }
 
      /* Header */
      #rs-fc-header {
        display: flex; align-items: center;
        justify-content: space-between;
        padding: 16px 18px;
        border-bottom: 1px solid var(--rs-borda, rgba(148,163,184,.12));
        background: var(--rs-card2, #162032);
        flex-shrink: 0;
      }
      #rs-fc-titulo {
        font-size: 15px; font-weight: 700;
        color: var(--rs-text, #f8fafc);
        font-family: 'Syne', system-ui, sans-serif;
      }
      #rs-fc-fechar {
        background: none; border: none;
        color: var(--rs-muted, #94a3b8);
        font-size: 22px; cursor: pointer; line-height: 1; padding: 0 4px;
      }
      #rs-fc-fechar:hover { color: var(--rs-text, #f8fafc); }
 
      /* Body */
      #rs-fc-body {
        flex: 1; overflow-y: auto; padding: 14px;
        display: flex; flex-direction: column; gap: 12px;
      }
 
      /* Loading / vazio */
      .rs-fc-loading, .rs-fc-vazio {
        text-align: center; padding: 40px 20px;
        color: var(--rs-muted, #94a3b8);
        font-size: 13px; line-height: 1.6;
      }
      .rs-fc-vazio span { font-size: 36px; display: block; margin-bottom: 12px; }
 
      /* Aviso / placeholder */
      .rs-fc-aviso {
        background: rgba(14,116,144,.12);
        border: 1px solid rgba(14,116,144,.25);
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 12px;
        color: var(--rs-muted, #94a3b8);
        line-height: 1.5;
      }
 
      /* Abas de tipo */
      .rs-fc-tipos {
        display: flex; gap: 8px; flex-wrap: wrap;
      }
      .rs-fc-tipo-btn {
        flex: 1; min-width: 120px;
        padding: 10px 8px;
        background: var(--rs-card2, #162032);
        border: 2px solid var(--rs-borda, rgba(148,163,184,.12));
        border-radius: 10px;
        color: var(--rs-text, #f8fafc);
        font-size: 12px; font-weight: 600;
        font-family: 'Syne', system-ui, sans-serif;
        cursor: pointer; text-align: center;
        transition: border-color .15s, background .15s;
      }
      .rs-fc-tipo-btn:hover { border-color: #0e7490; }
      .rs-fc-tipo-btn.ativo {
        border-color: #0e7490;
        background: rgba(14,116,144,.15);
      }
      .rs-fc-tipo-btn.bloqueado {
        opacity: .6; cursor: default;
        border-style: dashed;
      }
 
      /* Upsell */
      .rs-fc-upsell {
        background: rgba(124,58,237,.1);
        border: 1px solid rgba(124,58,237,.25);
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 12px;
        color: var(--rs-muted, #94a3b8);
        line-height: 1.5;
      }
      .rs-fc-upsell a { color: #a78bfa; font-weight: 700; text-decoration: none; }
 
      /* Quota info */
      .rs-fc-quota {
        font-size: 11px; color: var(--rs-muted, #94a3b8);
        text-align: right; margin-top: -6px;
      }
      .rs-fc-quota.esgotada { color: #ef4444; font-weight: 700; }
 
      /* Form */
      .rs-fc-label {
        font-size: 12px; font-weight: 600;
        color: var(--rs-muted, #94a3b8);
        margin-bottom: 4px; display: block;
      }
      .rs-fc-textarea {
        width: 100%;
        background: var(--rs-card2, #162032);
        border: 1px solid var(--rs-borda, rgba(148,163,184,.12));
        border-radius: 8px;
        color: var(--rs-text, #f8fafc);
        font-size: 13px; line-height: 1.5;
        padding: 10px 12px; resize: vertical;
        min-height: 110px;
        font-family: inherit;
        transition: border-color .15s;
      }
      .rs-fc-textarea:focus { outline: none; border-color: #0e7490; }
      .rs-fc-chars {
        font-size: 11px; color: var(--rs-muted, #94a3b8);
        text-align: right; margin-top: 2px;
      }
      .rs-fc-chars.limite { color: #ef4444; font-weight: 700; }
      .rs-fc-enviar {
        width: 100%;
        padding: 11px;
        background: #0e7490; color: #fff;
        border: none; border-radius: 8px;
        font-size: 13px; font-weight: 700;
        font-family: 'Syne', system-ui, sans-serif;
        cursor: pointer; transition: background .15s;
      }
      .rs-fc-enviar:hover { background: #0c6680; }
      .rs-fc-enviar:disabled { opacity: .5; cursor: not-allowed; }
 
      /* Histórico */
      .rs-fc-sep {
        font-size: 11px; font-weight: 700;
        color: var(--rs-muted, #94a3b8);
        text-transform: uppercase; letter-spacing: .5px;
        border-bottom: 1px solid var(--rs-borda, rgba(148,163,184,.12));
        padding-bottom: 6px; margin-top: 4px;
      }
      .rs-fc-msg-card {
        background: var(--rs-card2, #162032);
        border: 1px solid var(--rs-borda, rgba(148,163,184,.12));
        border-radius: 10px; padding: 12px;
        display: flex; flex-direction: column; gap: 6px;
      }
      .rs-fc-msg-card.respondida { border-color: #22c55e; }
      .rs-fc-msg-topo {
        display: flex; justify-content: space-between; align-items: center; gap: 8px;
      }
      .rs-fc-msg-tipo {
        font-size: 11px; font-weight: 700;
        color: var(--rs-muted, #94a3b8);
        text-transform: uppercase; letter-spacing: .5px;
      }
      .rs-fc-msg-data { font-size: 11px; color: var(--rs-muted, #94a3b8); }
      .rs-fc-msg-texto { font-size: 13px; color: var(--rs-text, #f8fafc); line-height: 1.5; }
      .rs-fc-msg-resposta {
        background: rgba(34,197,94,.1);
        border-left: 3px solid #22c55e;
        border-radius: 4px;
        padding: 8px 10px;
        font-size: 12px; color: var(--rs-text, #f8fafc); line-height: 1.5;
      }
      .rs-fc-msg-resposta-label {
        font-size: 10px; font-weight: 700;
        color: #22c55e; text-transform: uppercase;
        letter-spacing: .5px; margin-bottom: 4px;
      }
      .rs-fc-badge-status {
        font-size: 10px; font-weight: 700; padding: 2px 7px;
        border-radius: 99px; text-transform: uppercase;
      }
      .rs-fc-badge-status.aberta { background: rgba(251,191,36,.15); color: #d97706; }
      .rs-fc-badge-status.respondida { background: rgba(34,197,94,.15); color: #16a34a; }

      /* ── Sugestões Públicas ─────────────────────────────────────────────── */
      .rs-sugestao-card {
        background: var(--rs-card2, #162032);
        border: 1px solid var(--rs-borda, rgba(148,163,184,.12));
        border-radius: 10px; padding: 14px;
        display: flex; flex-direction: column; gap: 8px;
        margin-bottom: 12px;
      }
      .rs-sugestao-header {
        display: flex; justify-content: space-between; align-items: center;
        font-size: 12px; color: var(--rs-muted, #94a3b8);
      }
      .rs-sugestao-posicao {
        font-weight: 700; color: #0e7490;
      }
      .rs-sugestao-votos {
        font-weight: 600;
      }
      .rs-sugestao-texto {
        font-size: 13px; color: var(--rs-text, #f8fafc);
        line-height: 1.5; margin: 4px 0;
      }
      .rs-voto-btn {
        align-self: flex-start;
        padding: 6px 12px;
        background: var(--rs-card2, #162032);
        border: 2px solid var(--rs-borda, rgba(148,163,184,.12));
        border-radius: 20px;
        color: var(--rs-text, #f8fafc);
        font-size: 12px; font-weight: 600;
        cursor: pointer; transition: all .15s;
      }
      .rs-voto-btn:hover {
        border-color: #0e7490;
        background: rgba(14,116,144,.1);
      }
      .rs-voto-btn.votado {
        border-color: #22c55e;
        background: rgba(34,197,94,.15);
        color: #22c55e;
      }
      .rs-sugestao-card.encerrada {
        opacity: 0.8;
        border-color: #64748b;
      }
      .rs-sugestao-card.encerrada .rs-sugestao-posicao {
        color: #64748b;
      }
    `;
    document.head.appendChild(style);
  }
 
  // ── Eventos ───────────────────────────────────────────────────────────────
  function _bindEventos() {
    document.getElementById('rs-fc-fechar')
      .addEventListener('click', _fecharDrawer);
    document.getElementById('rs-fc-overlay')
      .addEventListener('click', _fecharDrawer);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') _fecharDrawer();
    });
  }
 
  // ── Abrir / Fechar ────────────────────────────────────────────────────────
  function _abrirDrawer() {
    document.getElementById('rs-fc-overlay').classList.add('rs-fc-show');
    document.getElementById('rs-fc-panel').classList.add('rs-fc-show');
    document.body.style.overflow = 'hidden';
    
    // Definir tipo padrão baseado no segmento do usuário
    const user = window._radarUser;
    const tipoPadrao = (user && user.segmento === 'assinante') ? 'ranking_mensal' : 'mensagem';
    _renderDrawer(tipoPadrao);
  }
 
  function _fecharDrawer() {
    document.getElementById('rs-fc-overlay').classList.remove('rs-fc-show');
    document.getElementById('rs-fc-panel').classList.remove('rs-fc-show');
    document.body.style.overflow = '';
    _atualizarBadge();
  }
 
  // ── Render principal ──────────────────────────────────────────────────────
  async function _renderDrawer(tipoAtivo = 'mensagem') {
    const body = document.getElementById('rs-fc-body');
    body.innerHTML = '<div class="rs-fc-loading">Carregando…</div>';
 
    const user = window._radarUser;
    if (!user) {
      body.innerHTML = '<div class="rs-fc-vazio"><span>🔒</span>Faça login para enviar mensagens.</div>';
      return;
    }
 
    const isAssinante = user.segmento === 'assinante';
 
    // Busca quota e uso de sugestão de tema (assinante)
    let quotaTema = 0;
    let usoTemaMes = 0;
 
    if (isAssinante && user.assinaturaId) {
      try {
        const assinSnap = await window.db
          .collection('usuarios').doc(user.uid)
          .collection('assinaturas').doc(user.assinaturaId).get();
        if (assinSnap.exists) {
          const feat = assinSnap.data().features_snapshot || {};
          quotaTema = feat.sugestao_tema_quota || 0;
        }
        if (quotaTema > 0) {
          // Conta sugestões enviadas este mês.
          // Filtra por tipo apenas no Firestore (evita índice composto),
          // e aplica o filtro de data em JavaScript.
          const inicioMes = new Date();
          inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
          const snap = await window.db
            .collection('usuarios').doc(user.uid)
            .collection('solicitacoes')
            .where('tipo', '==', 'sugestao_tema')
            .get();
          usoTemaMes = snap.docs.filter(d => {
            const ds = d.data().data_solicitacao;
            return ds && new Date(ds) >= inicioMes;
          }).length;
        }
      } catch(e) { console.warn('[faleConosco] quota:', e.message); }
    }
 
    // Histórico de mensagens
    const historico = await _buscarHistorico(user);
 
    // Marca respostas como vistas
    _marcarRespostasVistas(historico);
 
    let html = '';
 
    // Aviso/placeholder
    html += `
      <div class="rs-fc-aviso">
        Este canal é para dúvidas sobre a sua assinatura e feedbacks.
        Para suporte técnico, consulte os planos disponíveis.
      </div>`;
 
    // Abas de tipo
    const quotaEsgotada = quotaTema > 0 && usoTemaMes >= quotaTema;
    const temFeatureTema = isAssinante && quotaTema > 0;
 
    html += `<div class="rs-fc-tipos">`;
    html += `<button class="rs-fc-tipo-btn${tipoAtivo === 'mensagem' ? ' ativo' : ''}"
      onclick="window._fcSelecionarTipo('mensagem')">
      💬 Mensagem
    </button>`;
 
    if (isAssinante) {
      if (temFeatureTema) {
        html += `<button class="rs-fc-tipo-btn${tipoAtivo === 'sugestao_tema' ? ' ativo' : ''}
          ${quotaEsgotada ? ' bloqueado' : ''}"
          onclick="${quotaEsgotada ? '' : "window._fcSelecionarTipo('sugestao_tema')"}">
          ${quotaEsgotada
            ? '⛔ Cota de sugestões esgotada para este mês'
            : '💡 Sugerir tema'}
        </button>`;
      } else {
        // Upsell — não tem feature
        html += `<button class="rs-fc-tipo-btn bloqueado" title="Disponível em planos superiores">
          💡 Sugerir tema 🔒
        </button>`;
      }

      // Nova aba: Ranking Mensal (sempre disponível para assinantes)
      html += `<button class="rs-fc-tipo-btn${tipoAtivo === 'ranking_mensal' ? ' ativo' : ''}"
        onclick="window._fcSelecionarTipo('ranking_mensal')">
        🏆 Ranking Mensal
      </button>`;
      if (tipoAtivo !== 'ranking_mensal') {
        const placeholder = tipoAtivo === 'sugestao_tema'
          ? 'Descreva o tema que gostaria que fosse abordado em uma próxima edição…'
          : 'Digite sua mensagem ou dúvida…';
        html += `
          <div>
            <label class="rs-fc-label" for="rs-fc-txt">
              ${tipoAtivo === 'sugestao_tema' ? '💡 Sugestão de tema' : '💬 Nova mensagem'}
            </label>
            <textarea id="rs-fc-txt" class="rs-fc-textarea"
              placeholder="${placeholder}" maxlength="${MAX_CHARS}"></textarea>
            <div class="rs-fc-chars" id="rs-fc-chars">0/${MAX_CHARS}</div>
          </div>
          <button class="rs-fc-enviar" id="rs-fc-enviar" disabled
            onclick="window._fcEnviar('${tipoAtivo}')">
            Enviar
          </button>`;
      }
    }

    // Renderizar ranking mensal se for o tipo ativo
    if (tipoAtivo === 'ranking_mensal') {
      html += await _renderRankingMensal(user, temFeatureTema);
    }

    // Filtrar histórico baseado no tipo ativo
    let historicoFiltrado = historico;
    if (tipoAtivo === 'mensagem') {
      historicoFiltrado = historico.filter(m => m.tipo !== 'sugestao_tema');
    } else if (tipoAtivo === 'sugestao_tema') {
      historicoFiltrado = historico.filter(m => m.tipo === 'sugestao_tema');
    } else if (tipoAtivo === 'ranking_mensal') {
      historicoFiltrado = [];
    }

    // Histórico
    if (historicoFiltrado.length > 0) {
      html += `<div class="rs-fc-sep">Histórico</div>`;
      historicoFiltrado.forEach(msg => {
        const tipoLabel = msg.tipo === 'sugestao_tema' ? '💡 Sugestão de tema' : '💬 Mensagem';
        const respostaHtml = respondida ? `
          <div class="rs-fc-msg-resposta">
            <div class="rs-fc-msg-resposta-label">✅ Resposta da equipe</div>
            ${msg.resposta}
          </div>` : '';
 
        html += `
          <div class="rs-fc-msg-card${respondida ? ' respondida' : ''}">
            <div class="rs-fc-msg-topo">
              <span class="rs-fc-msg-tipo">${tipoLabel}</span>
              <div style="display:flex;gap:6px;align-items:center">
                <span class="rs-fc-badge-status ${respondida ? 'respondida' : 'aberta'}">
                  ${respondida ? 'Respondida' : 'Aguardando'}
                </span>
                <span class="rs-fc-msg-data">${data}</span>
              </div>
            </div>
            <div class="rs-fc-msg-texto">${msg.texto || msg.descricao || ''}</div>
            ${respostaHtml}
          </div>`;
      });
    } else if (tipoAtivo !== 'ranking_mensal') {
      html += `<div class="rs-fc-vazio"><span>💬</span>Nenhuma mensagem ainda.</div>`;
    }
 
    body.innerHTML = html;
 
    // Bind contador de caracteres
    const textarea = document.getElementById('rs-fc-txt');
    const chars    = document.getElementById('rs-fc-chars');
    const btnEnv   = document.getElementById('rs-fc-enviar');
    if (textarea) {
      textarea.addEventListener('input', () => {
        const n = textarea.value.length;
        chars.textContent = `${n}/${MAX_CHARS}`;
        chars.classList.toggle('limite', n >= MAX_CHARS);
        if (btnEnv) btnEnv.disabled = n === 0;
      });
    }
  }
 
  // ── Selecionar tipo ───────────────────────────────────────────────────────
  window._fcSelecionarTipo = function(tipo) {
    _renderDrawer(tipo);
  };
 
  // ── Enviar mensagem ───────────────────────────────────────────────────────
  window._fcEnviar = async function(tipo) {
    const textarea = document.getElementById('rs-fc-txt');
    const btnEnv   = document.getElementById('rs-fc-enviar');
    const texto    = textarea?.value?.trim();
    if (!texto) return;
 
    const user = window._radarUser;
    if (!user) return;
 
    if (btnEnv) { btnEnv.disabled = true; btnEnv.textContent = 'Enviando…'; }
 
    try {
      if (user.segmento === 'assinante') {
        // Assinante → Firebase solicitacoes
        const solicitacaoRef = await window.db.collection('usuarios').doc(user.uid)
          .collection('solicitacoes').add({
            tipo,
            descricao: texto,
            status: 'aberta',
            data_solicitacao: new Date().toISOString(),
          });

        // Se for sugestão de tema, criar entrada pública para votos
        if (tipo === 'sugestao_tema') {
          // Verificar e encerrar mês anterior se necessário
          const periodoAtual = new Date().toISOString().slice(0, 7); // YYYY-MM
          await _verificarEEncerrarMesAnterior(periodoAtual);

          await window.db.collection('sugestoes_publicas')
            .doc(`sugestao_${solicitacaoRef.id}`)
            .set({
              solicitacao_ref: solicitacaoRef.path,
              texto_preview: texto.substring(0, 100) + (texto.length > 100 ? '...' : ''),
              autor_uid: user.uid,
              votos: 0,
              votantes: [],
              status: 'ativa',
              periodo: periodoAtual,
              criado_em: new Date(),
              atualizado_em: new Date()
            });
        }

        // Incrementa contador
        await window.db.collection('admin_contadores').doc('pendencias')
          .set({ solicitacoes: firebase.firestore.FieldValue.increment(1) }, { merge: true });
 
      } else {
        // Lead → Supabase leads_mensagens
        const leadId = parseInt(user.uid, 10);
        if (!leadId) throw new Error('ID do lead inválido.');
        const { error } = await window.supabase
          .from('leads_mensagens')
          .insert({ lead_id: leadId, texto, tipo });
        if (error) throw new Error(error.message);
        // Incrementa contador
        await window.db.collection('admin_contadores').doc('pendencias')
          .set({ leads_mensagens: firebase.firestore.FieldValue.increment(1) }, { merge: true });
      }
 
      // Feedback visual + re-renderiza para recalcular quota atualizada
      if (btnEnv) { btnEnv.textContent = '✅ Enviado!'; btnEnv.disabled = true; }
      setTimeout(() => _renderDrawer(tipo), 700);
 
    } catch(e) {
      console.error('[faleConosco] enviar:', e);
      if (btnEnv) { btnEnv.disabled = false; btnEnv.textContent = 'Enviar'; }
      alert('Erro ao enviar. Tente novamente.');
    }
  };
 
  // ── Buscar histórico ──────────────────────────────────────────────────────
  async function _buscarHistorico(user) {
    try {
      if (user.segmento === 'assinante') {
        const snap = await window.db
          .collection('usuarios').doc(user.uid)
          .collection('solicitacoes')
          .where('tipo', 'in', ['mensagem', 'sugestao_tema'])
          .orderBy('data_solicitacao', 'desc')
          .limit(20).get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } else {
        const { data, error } = await window.supabase
          .from('leads_mensagens')
          .select('*')
          .eq('lead_id', parseInt(user.uid, 10))
          .order('criado_em', { ascending: false })
          .limit(20);
        if (error) throw new Error(error.message);
        return data || [];
      }
    } catch(e) {
      console.warn('[faleConosco] histórico:', e.message);
      return [];
    }
  }
 
  // ── Badge — conta respostas não vistas ────────────────────────────────────
  async function _atualizarBadge() {
    const badge = document.getElementById('rs-fc-badge');
    if (!badge) return;
 
    const user = window._radarUser;
    if (!user) { badge.style.display = 'none'; return; }
 
    try {
      const historico = await _buscarHistorico(user);
      const vistas    = _getVistas();
      const novas     = historico.filter(m =>
        m.resposta && !vistas.has(String(m.id || m.data_solicitacao))
      );
 
      badge.textContent   = novas.length > 9 ? '9+' : String(novas.length);
      badge.style.display = novas.length > 0 ? 'inline-block' : 'none';
    } catch(e) { badge.style.display = 'none'; }
  }
 
  function _getVistas() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_BADGE);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  }
 
  function _marcarRespostasVistas(historico) {
    try {
      const vistas = _getVistas();
      historico.forEach(m => {
        if (m.resposta) vistas.add(String(m.id || m.data_solicitacao));
      });
      localStorage.setItem(STORAGE_KEY_BADGE, JSON.stringify([...vistas]));
    } catch { /* ignora */ }
  }
 
  // ── Renderizar ranking mensal ─────────────────────────────────────────────
  async function _renderRankingMensal(user, temFeatureTema) {
    try {
      const periodoAtual = new Date().toISOString().slice(0, 7); // YYYY-MM
      const dataAtual = new Date();
      const ano = dataAtual.getFullYear();
      const mes = dataAtual.getMonth(); // 0-based
      const periodoAnterior = mes === 0 ? `${ano - 1}-12` : `${ano}-${String(mes).padStart(2, '0')}`;

      let html = '';

      // Mês Atual (Ativo)
      html += `<div class="rs-fc-sep">🏆 Mês Atual (${_formatarPeriodo(periodoAtual)})</div>`;
      const htmlAtual = await _renderRankingPeriodo(user, temFeatureTema, periodoAtual, 'ativa', true);
      html += htmlAtual;

      // Mês Anterior (Encerrado)
      html += `<div class="rs-fc-sep">🏅 Mês Anterior (${_formatarPeriodo(periodoAnterior)})</div>`;
      const htmlAnterior = await _renderRankingPeriodo(user, temFeatureTema, periodoAnterior, 'encerrada', false);
      html += htmlAnterior;

      return html;
    } catch (err) {
      console.error('[faleConosco] erro ao renderizar ranking mensal:', err);
      return `<div class="rs-fc-vazio"><span>⚠️</span>Erro ao carregar ranking.</div>`;
    }
  }

  // ── Renderizar ranking de um período específico ───────────────────────────
  async function _renderRankingPeriodo(user, temFeatureTema, periodo, status, permitirVoto) {
    try {
      let snap;
      if (status === 'ativa') {
        snap = await window.db.collection('sugestoes_publicas')
          .where('status', '==', status)
          .where('periodo', '==', periodo)
          .orderBy('votos', 'desc')
          .orderBy('criado_em', 'desc')
          .limit(5)
          .get();
      } else {
        // Para encerradas, buscar todas e usar ranking_final se disponível
        snap = await window.db.collection('sugestoes_publicas')
          .where('status', '==', status)
          .where('periodo', '==', periodo)
          .orderBy('votos', 'desc')
          .orderBy('criado_em', 'desc')
          .get();
      }

      if (snap.empty) {
        return `<div class="rs-fc-vazio"><span>${status === 'ativa' ? '🗳️' : '🏅'}</span>Nenhuma sugestão ${status === 'ativa' ? 'ativa' : 'encerrada'} neste período.</div>`;
      }

      const metadados = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Para encerradas, usar ranking_final se disponível
      let rankingOrdenado = metadados;
      if (status === 'encerrada' && metadados[0].ranking_final) {
        // Usar ranking_final salvo
        rankingOrdenado = metadados[0].ranking_final.map(item => {
          const original = metadados.find(m => m.solicitacao_ref === item.solicitacao_ref);
          return original ? { ...original, posicao_fixa: item.posicao, votos_fixos: item.votos } : null;
        }).filter(Boolean);
      }

      // Buscar textos completos
      const sugestoesCompletas = await Promise.all(
        rankingOrdenado.slice(0, 5).map(async meta => {
          const textoCompleto = await _buscarTextoSolicitacao(meta.solicitacao_ref);
          return { ...meta, texto: textoCompleto };
        })
      );

      const podeVotar = permitirVoto && user.segmento === 'assinante' && temFeatureTema;

      let html = '';
      sugestoesCompletas.forEach((sugestao, index) => {
        const jaVotou = permitirVoto ? localStorage.getItem(`rs_voto_sugestao_${sugestao.id}`) : null;
        const posicao = status === 'encerrada' && sugestao.posicao_fixa ? sugestao.posicao_fixa : index + 1;
        const votos = status === 'encerrada' && sugestao.votos_fixos !== undefined ? sugestao.votos_fixos : sugestao.votos;

        html += `
          <div class="rs-sugestao-card ${status === 'encerrada' ? 'encerrada' : ''}">
            <div class="rs-sugestao-header">
              <span class="rs-sugestao-posicao">#${posicao}</span>
              <span class="rs-sugestao-votos">👍 ${votos} voto${votos !== 1 ? 's' : ''}</span>
            </div>
            <div class="rs-sugestao-texto">${_esc(sugestao.texto)}</div>
            ${podeVotar ? `
              <button class="rs-voto-btn ${jaVotou ? 'votado' : ''}"
                onclick="votarSugestao('${_esc(sugestao.id)}', '${_esc(user.uid)}')">
                ${jaVotou ? '✅ Votado' : '👍 Votar'}
              </button>
            ` : ''}
          </div>`;
      });

      // Botão para enviar sugestão própria (apenas para mês atual)
      if (permitirVoto && temFeatureTema) {
        html += `
          <div style="text-align: center; margin-top: 16px;">
            <button class="rs-fc-enviar" onclick="window._fcSelecionarTipo('sugestao_tema')"
              style="background: #0e7490; border: none; padding: 10px 16px; border-radius: 8px; color: white; cursor: pointer;">
              💡 Enviar minha sugestão
            </button>
          </div>`;
      }

      return html;
    } catch (err) {
      console.error('[faleConosco] erro ao renderizar ranking período:', err);
      return `<div class="rs-fc-vazio"><span>⚠️</span>Erro ao carregar ranking deste período.</div>`;
    }
  }

  // ── Formatar período para exibição ─────────────────────────────────────────
  function _formatarPeriodo(periodo) {
    const [ano, mes] = periodo.split('-');
    const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                   'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return `${meses[parseInt(mes) - 1]} ${ano}`;
  }

  // ── Buscar texto completo da solicitação ────────────────────────────────────
  async function _buscarTextoSolicitacao(solicitacaoPath) {
    try {
      // solicitacaoPath = "usuarios/{uid}/solicitacoes/{id}"
      const pathParts = solicitacaoPath.split('/');
      const uid = pathParts[1];
      const solicitacaoId = pathParts[3];

      const doc = await window.db.collection('usuarios').doc(uid)
        .collection('solicitacoes').doc(solicitacaoId).get();

      return doc.exists ? (doc.data().descricao || doc.data().texto || '') : '';
    } catch (err) {
      console.warn('[faleConosco] erro ao buscar texto da solicitação:', err);
      return '';
    }
  }

  // ── Verificar e encerrar mês anterior ──────────────────────────────────────
  async function _verificarEEncerrarMesAnterior(periodoAtual) {
    try {
      // Calcular período anterior
      const dataAtual = new Date();
      const ano = dataAtual.getFullYear();
      const mes = dataAtual.getMonth(); // 0-based
      const periodoAnterior = mes === 0 ? `${ano - 1}-12` : `${ano}-${String(mes).padStart(2, '0')}`;

      // Buscar sugestões ativas do período anterior
      const snap = await window.db.collection('sugestoes_publicas')
        .where('status', '==', 'ativa')
        .where('periodo', '==', periodoAnterior)
        .orderBy('votos', 'desc')
        .orderBy('criado_em', 'desc')
        .get();

      if (!snap.empty) {
        // Encerrar sugestões e salvar ranking final
        const batch = window.db.batch();
        const rankingFinal = [];

        snap.docs.forEach((doc, index) => {
          const data = doc.data();
          rankingFinal.push({
            posicao: index + 1,
            votos: data.votos,
            texto_preview: data.texto_preview,
            solicitacao_ref: data.solicitacao_ref
          });

          // Atualizar documento para encerrado
          batch.update(doc.ref, {
            status: 'encerrada',
            ranking_final: rankingFinal,
            encerrado_em: new Date()
          });
        });

        await batch.commit();
        console.log(`[faleConosco] Mês ${periodoAnterior} encerrado com ${snap.docs.length} sugestões.`);
      }
    } catch (err) {
      console.warn('[faleConosco] erro ao encerrar mês anterior:', err);
    }
  }

  // ── Votar em sugestão ───────────────────────────────────────────────────────
  window.votarSugestao = async function(sugestaoId, userId) {
    try {
      const lsKey = `rs_voto_sugestao_${sugestaoId}`;
      const jaVotou = localStorage.getItem(lsKey);

      if (jaVotou) {
        // Desvotar
        await window.db.collection('sugestoes_publicas').doc(sugestaoId).update({
          votos: firebase.firestore.FieldValue.increment(-1),
          votantes: firebase.firestore.FieldValue.arrayRemove(userId),
          atualizado_em: new Date()
        });
        localStorage.removeItem(lsKey);
      } else {
        // Votar
        await window.db.collection('sugestoes_publicas').doc(sugestaoId).update({
          votos: firebase.firestore.FieldValue.increment(1),
          votantes: firebase.firestore.FieldValue.arrayUnion(userId),
          atualizado_em: new Date()
        });
        localStorage.setItem(lsKey, 'true');
      }

      // Re-renderizar para atualizar contadores
      const user = window._radarUser;
      if (user) {
        const temFeatureTema = user.segmento === 'assinante';
        const html = await _renderRankingMensal(user, temFeatureTema);
        const body = document.getElementById('rs-fc-body');
        if (body) {
          // Substituir apenas a seção de ranking
          const existingSep = body.querySelector('.rs-fc-sep');
          if (existingSep) {
            const nextElements = [];
            let sibling = existingSep.nextElementSibling;
            while (sibling && !sibling.classList.contains('rs-fc-sep')) {
              nextElements.push(sibling);
              sibling = sibling.nextElementSibling;
            }
            nextElements.forEach(el => el.remove());
            existingSep.insertAdjacentHTML('afterend', html.replace(/<div class="rs-fc-sep">.*?<\/div>/g, ''));
          }
        }
      }
    } catch (err) {
      console.error('[faleConosco] erro ao votar:', err);
      alert('Erro ao registrar voto. Tente novamente.');
    }
  };

  // ── Boot ──────────────────────────────────────────────────────────────────
  function _boot() {
    if (window._radarUser && window.db) {
      init();
    } else {
      window.addEventListener('radarUserReady', () => {
        setTimeout(init, 500);
      }, { once: true });
    }
  }
 
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }
 
  // Expõe para o menuApp.js
  window._rsFcAbrir          = _abrirDrawer;
  window._rsFcBadgeAtualizar = _atualizarBadge;
 
})();