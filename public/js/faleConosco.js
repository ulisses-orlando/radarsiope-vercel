// faleConosco.js
// Botão "Fale Conosco" no app verNewsletterComToken
// Permite que assinantes e leads enviem mensagens e sugestões de tema
// ─────────────────────────────────────────────────────────────────────────────
 
(function () {
  'use strict';
 
  const MAX_CHARS = 500;
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
        width: min(420px, 96vw);
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
    _renderDrawer();
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
          💡 Sugerir tema
          ${quotaEsgotada ? ' 🔒' : ''}
        </button>`;
      } else {
        // Upsell — não tem feature
        html += `<button class="rs-fc-tipo-btn bloqueado" title="Disponível em planos superiores">
          💡 Sugerir tema 🔒
        </button>`;
      }
    }
    html += `</div>`;
 
    // Quota info (sugestão de tema)
    if (tipoAtivo === 'sugestao_tema' && temFeatureTema) {
      const restante = quotaTema - usoTemaMes;
      html += `<div class="rs-fc-quota${quotaEsgotada ? ' esgotada' : ''}">
        ${quotaEsgotada
          ? `Você atingiu o limite de ${quotaTema} sugestão(ões) este mês para o seu plano`
          : `${restante} sugestão(ões) restante(s) este mês`}
      </div>`;
    }
 
    // Upsell para assinante sem feature
    if (tipoAtivo === 'sugestao_tema' && isAssinante && !temFeatureTema) {
      html += `<div class="rs-fc-upsell">
        💡 A opção de sugerir temas para edições futuras está disponível nos planos
        <strong>Premium</strong> e <strong>Supreme</strong>.
        <br><a href="/assinatura.html">Ver planos →</a>
      </div>`;
    }
 
    // Form de envio (se pode enviar)
    const podeEnviar = tipoAtivo === 'mensagem' || (temFeatureTema && !quotaEsgotada);
    if (podeEnviar) {
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
 
    // Histórico
    if (historico.length > 0) {
      html += `<div class="rs-fc-sep">Histórico</div>`;
      historico.forEach(msg => {
        const respondida = !!msg.resposta;
        const data = msg.criado_em
          ? new Date(msg.criado_em?.seconds ? msg.criado_em.seconds * 1000 : msg.criado_em)
              .toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
          : '—';
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
    } else if (!podeEnviar) {
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
        await window.db.collection('usuarios').doc(user.uid)
          .collection('solicitacoes').add({
            tipo,
            descricao: texto,
            status: 'aberta',
            data_solicitacao: new Date().toISOString(),
          });
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