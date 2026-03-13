// centralMensagens.js
// Central de Alertas — drawer no app verNewsletterComToken
// Busca alertas_disparados no Firestore filtrados pelo usuário logado
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  const STORAGE_KEY = 'rs_alertas_lidos';
  const LIMITE      = 30;

  // Rótulos amigáveis por tipo de alerta
  const TIPO_LABEL = {
    nova_edicao:               '📡 Nova Edição',
    nova_edicao_acesso_pro:    '⭐ Edição Pro',
    siope_prazo_proximo:       '⏰ Prazo SIOPE',
    siope_homologado:          '✅ SIOPE Homologado',
    siope_percentual_baixo:    '⚠️ Percentual SIOPE',
    siope_nao_enviado:         '🚨 SIOPE Não Enviado',
    fundeb_repasse_creditado:  '💰 Repasse FUNDEB',
    portaria_publicada:        '📋 Portaria',
  };

  // ── Inicialização ─────────────────────────────────────────────────────────
  function init() {
    _injetarHTML();
    _injetarCSS();
    _bindEventos();
    _atualizarBadge();
  }

  // ── HTML: botão + overlay + drawer ───────────────────────────────────────
  function _injetarHTML() {
    // Botão fixo
    const btn = document.createElement('button');
    btn.id            = 'rs-alertas-btn';
    btn.type          = 'button';
    btn.setAttribute('aria-label', 'Central de Alertas');
    btn.innerHTML     = '🔔 Alertas<span id="rs-alertas-badge" style="display:none">0</span>';
    document.body.appendChild(btn);

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'rs-alertas-overlay';
    overlay.setAttribute('role', 'presentation');
    document.body.appendChild(overlay);

    // Drawer
    const drawer = document.createElement('aside');
    drawer.id               = 'rs-alertas-panel';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', 'Central de Alertas');
    drawer.innerHTML = `
      <div id="rs-alertas-header">
        <span id="rs-alertas-titulo">🔔 Central de Alertas</span>
        <button id="rs-alertas-fechar" type="button" aria-label="Fechar">×</button>
      </div>
      <div id="rs-alertas-body">
        <div class="rs-alertas-loading">Carregando alertas…</div>
      </div>
    `;
    document.body.appendChild(drawer);
  }

  // ── CSS ───────────────────────────────────────────────────────────────────
  function _injetarCSS() {
    const style = document.createElement('style');
    style.textContent = `
      /* ── Botão Alertas ─────────────────────────────────────────────────── */
      /* Fica abaixo do botão Edições (que está em top:14px / right:14px)   */
      #rs-alertas-btn {
        position: fixed;
        top: 54px;      /* abaixo do botão Edições (~40px altura + 14px top) */
        right: 14px;
        z-index: 200;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        background: var(--azul-mid, #1A5276);
        color: #fff;
        border: none;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 700;
        font-family: 'Syne', system-ui, sans-serif;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(0,0,0,.25);
        transition: background .15s, transform .15s;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        letter-spacing: .3px;
      }
      #rs-alertas-btn:hover { background: var(--azul, #0A3D62); transform: translateY(-1px); }
      [data-theme="exito"]  #rs-alertas-btn { background: #16a34a; color: #fff; }
      [data-theme="aurora"] #rs-alertas-btn { background: #7c3aed; color: #fff; }

      /* Badge de não lidos */
      #rs-alertas-badge {
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        background: #ef4444;
        color: #fff;
        border-radius: 99px;
        font-size: 10px;
        font-weight: 800;
        line-height: 18px;
        text-align: center;
        margin-left: 2px;
      }

      /* ── Overlay ───────────────────────────────────────────────────────── */
      #rs-alertas-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.5);
        z-index: 600;
        opacity: 0;
        pointer-events: none;
        transition: opacity .25s;
        backdrop-filter: blur(2px);
      }
      #rs-alertas-overlay.rs-alertas-show { opacity: 1; pointer-events: all; }

      /* ── Painel ────────────────────────────────────────────────────────── */
      #rs-alertas-panel {
        position: fixed;
        top: 0; right: 0; bottom: 0;
        width: min(380px, 95vw);
        background: var(--rs-card, #1e293b);
        z-index: 700;
        display: flex;
        flex-direction: column;
        transform: translateX(110%);
        transition: transform .28s cubic-bezier(.4,0,.2,1);
        box-shadow: -4px 0 32px rgba(0,0,0,.3);
        overflow: hidden;
      }
      #rs-alertas-panel.rs-alertas-show { transform: translateX(0); }

      /* Header do drawer */
      #rs-alertas-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 18px;
        border-bottom: 1px solid var(--rs-borda, rgba(148,163,184,.12));
        background: var(--rs-card2, #162032);
        flex-shrink: 0;
      }
      #rs-alertas-titulo {
        font-size: 15px;
        font-weight: 700;
        color: var(--rs-text, #f8fafc);
        font-family: 'Syne', system-ui, sans-serif;
      }
      #rs-alertas-fechar {
        background: none;
        border: none;
        color: var(--rs-muted, #94a3b8);
        font-size: 22px;
        cursor: pointer;
        line-height: 1;
        padding: 0 4px;
      }
      #rs-alertas-fechar:hover { color: var(--rs-text, #f8fafc); }

      /* Body */
      #rs-alertas-body {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      /* Loading / empty */
      .rs-alertas-loading, .rs-alertas-vazio {
        text-align: center;
        padding: 40px 20px;
        color: var(--rs-muted, #94a3b8);
        font-size: 13px;
        line-height: 1.6;
      }
      .rs-alertas-vazio span { font-size: 36px; display: block; margin-bottom: 12px; }

      /* Card de alerta */
      .rs-alerta-card {
        background: var(--rs-card2, #162032);
        border: 1px solid var(--rs-borda, rgba(148,163,184,.12));
        border-radius: 10px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        cursor: default;
        transition: border-color .15s;
      }
      .rs-alerta-card.rs-nao-lido {
        border-color: var(--azul-mid, #1A5276);
        background: rgba(26,82,118,.18);
      }
      .rs-alerta-card-topo {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .rs-alerta-tipo {
        font-size: 11px;
        font-weight: 700;
        color: var(--rs-muted, #94a3b8);
        text-transform: uppercase;
        letter-spacing: .5px;
      }
      .rs-alerta-data {
        font-size: 11px;
        color: var(--rs-muted, #94a3b8);
        white-space: nowrap;
      }
      .rs-alerta-titulo {
        font-size: 14px;
        font-weight: 700;
        color: var(--rs-text, #f8fafc);
        line-height: 1.4;
      }
      .rs-alerta-corpo {
        font-size: 13px;
        color: var(--rs-muted, #94a3b8);
        line-height: 1.5;
      }
      .rs-alerta-novo-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ef4444;
        flex-shrink: 0;
      }

      /* Botão marcar todos lidos */
      #rs-alertas-marcar-lidos {
        background: none;
        border: 1px solid var(--rs-borda, rgba(148,163,184,.12));
        color: var(--rs-muted, #94a3b8);
        border-radius: 8px;
        padding: 8px 14px;
        font-size: 12px;
        cursor: pointer;
        margin: 4px 0 8px;
        transition: color .15s, border-color .15s;
        align-self: flex-end;
      }
      #rs-alertas-marcar-lidos:hover { color: var(--rs-text, #f8fafc); border-color: var(--rs-text, #f8fafc); }

      /* Mobile: tamanho menor mas mesma posição (abaixo do Edições) */
      @media (max-width: 480px) {
        #rs-alertas-btn { font-size: 11px; padding: 7px 10px; top: 52px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Eventos ───────────────────────────────────────────────────────────────
  function _bindEventos() {
    document.getElementById('rs-alertas-btn')
      .addEventListener('click', _abrirDrawer);
    document.getElementById('rs-alertas-fechar')
      .addEventListener('click', _fecharDrawer);
    document.getElementById('rs-alertas-overlay')
      .addEventListener('click', _fecharDrawer);

    // Fecha com ESC
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') _fecharDrawer();
    });
  }

  // ── Abrir / Fechar ────────────────────────────────────────────────────────
  function _abrirDrawer() {
    document.getElementById('rs-alertas-overlay').classList.add('rs-alertas-show');
    document.getElementById('rs-alertas-panel').classList.add('rs-alertas-show');
    document.body.style.overflow = 'hidden';
    _carregarAlertas();
  }

  function _fecharDrawer() {
    document.getElementById('rs-alertas-overlay').classList.remove('rs-alertas-show');
    document.getElementById('rs-alertas-panel').classList.remove('rs-alertas-show');
    document.body.style.overflow = '';
  }

  // ── Carregar alertas do Firestore ─────────────────────────────────────────
  async function _carregarAlertas() {
    const body = document.getElementById('rs-alertas-body');
    body.innerHTML = '<div class="rs-alertas-loading">Carregando alertas…</div>';

    try {
      const db   = window.db;
      const user = window._radarUser;

      if (!db) throw new Error('Firestore não disponível.');

      // Busca os últimos alertas (todos) ordenados por data
      const snap = await db.collection('alertas_disparados')
        .orderBy('disparado_em', 'desc')
        .limit(LIMITE)
        .get();

      if (snap.empty) {
        body.innerHTML = `
          <div class="rs-alertas-vazio">
            <span>🔕</span>
            Nenhum alerta disponível ainda.
          </div>`;
        return;
      }

      // Filtra alertas relevantes para este usuário
      const alertas = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(a => _alertaRelevanteParaUsuario(a, user));

      if (alertas.length === 0) {
        body.innerHTML = `
          <div class="rs-alertas-vazio">
            <span>📭</span>
            Nenhum alerta para o seu perfil ainda.
          </div>`;
        return;
      }

      // IDs já lidos
      const lidos = _getLidos();
      const naoLidos = alertas.filter(a => !lidos.has(a.id));

      // Renderiza
      const cards = alertas.map(a => _renderCard(a, lidos.has(a.id))).join('');
      const btnLidos = naoLidos.length > 0
        ? `<button id="rs-alertas-marcar-lidos" type="button">✓ Marcar todos como lidos</button>`
        : '';

      body.innerHTML = btnLidos + cards;

      // Bind botão marcar lidos
      const btnEl = document.getElementById('rs-alertas-marcar-lidos');
      if (btnEl) {
        btnEl.addEventListener('click', () => _marcarTodosLidos(alertas));
      }

      // Marca como lidos ao abrir
      _marcarTodosLidos(alertas);

    } catch (err) {
      console.error('[CentralMensagens]', err);
      body.innerHTML = `
        <div class="rs-alertas-vazio">
          <span>⚠️</span>
          Erro ao carregar alertas.<br>
          <small style="font-size:11px">${err.message}</small>
        </div>`;
    }
  }

  // ── Filtro de relevância ──────────────────────────────────────────────────
  function _alertaRelevanteParaUsuario(alerta, user) {
    if (!user) return true; // sem usuário, mostra tudo

    const publico = alerta.publico || 'todos';
    const seg     = user.segmento || 'lead'; // 'assinante' ou 'lead'

    // Filtro por público
    if (publico !== 'todos') {
      if (publico === 'assinantes' && seg !== 'assinante') return false;
      if (publico === 'leads'      && seg !== 'lead')      return false;
    }

    // Filtro por município (alertas municipais só aparecem se for do mesmo município)
    const tipo = alerta.tipo || '';
    const tiposMunicipais = [
      'siope_prazo_proximo', 'siope_homologado',
      'siope_percentual_baixo', 'siope_nao_enviado',
      'fundeb_repasse_creditado',
    ];

    if (tiposMunicipais.includes(tipo)) {
      const munCod = user.municipio_cod || '';
      // Se o alerta tem lista de municípios, verifica se inclui o do usuário
      if (alerta.municipios && Array.isArray(alerta.municipios)) {
        if (!alerta.municipios.includes(munCod)) return false;
      }
      // Se tem filtro por tag municipio_cod
      if (alerta.filtros && Array.isArray(alerta.filtros)) {
        const filtroMun = alerta.filtros.find(f => f.key === 'municipio_cod');
        if (filtroMun && filtroMun.value !== munCod) return false;
      }
    }

    return true;
  }

  // ── Render de card ────────────────────────────────────────────────────────
  function _renderCard(alerta, jaLido) {
    const tipo  = TIPO_LABEL[alerta.tipo] || alerta.tipo || 'Alerta';
    const data  = alerta.disparado_em?.toDate?.()
      ? alerta.disparado_em.toDate().toLocaleDateString('pt-BR', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        })
      : '—';
    const titulo = alerta.titulo || '—';
    const corpo  = alerta.corpo  || '';
    const dot    = !jaLido ? '<div class="rs-alerta-novo-dot"></div>' : '';
    const cls    = !jaLido ? 'rs-alerta-card rs-nao-lido' : 'rs-alerta-card';

    return `
      <div class="${cls}" data-id="${alerta.id}">
        <div class="rs-alerta-card-topo">
          <span class="rs-alerta-tipo">${tipo}</span>
          <span class="rs-alerta-data">${data}</span>
          ${dot}
        </div>
        <div class="rs-alerta-titulo">${titulo}</div>
        ${corpo ? `<div class="rs-alerta-corpo">${corpo}</div>` : ''}
      </div>`;
  }

  // ── Controle de lidos (localStorage) ─────────────────────────────────────
  function _getLidos() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  }

  function _salvarLidos(set) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
    } catch { /* ignora */ }
  }

  function _marcarTodosLidos(alertas) {
    const lidos = _getLidos();
    alertas.forEach(a => lidos.add(a.id));
    _salvarLidos(lidos);
    _atualizarBadge();
    // Remove visual de não lido dos cards
    document.querySelectorAll('.rs-alerta-card.rs-nao-lido').forEach(el => {
      el.classList.remove('rs-nao-lido');
      el.querySelector('.rs-alerta-novo-dot')?.remove();
    });
    document.getElementById('rs-alertas-marcar-lidos')?.remove();
  }

  // ── Badge ─────────────────────────────────────────────────────────────────
  async function _atualizarBadge() {
    const badge = document.getElementById('rs-alertas-badge');
    if (!badge) return;

    try {
      const db   = window.db;
      const user = window._radarUser;
      if (!db) return;

      const snap = await db.collection('alertas_disparados')
        .orderBy('disparado_em', 'desc')
        .limit(LIMITE)
        .get();

      const lidos = _getLidos();
      const naoLidos = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(a => _alertaRelevanteParaUsuario(a, user) && !lidos.has(a.id));

      if (naoLidos.length > 0) {
        badge.textContent = naoLidos.length > 9 ? '9+' : String(naoLidos.length);
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    } catch { badge.style.display = 'none'; }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  // Aguarda o Firestore e o usuário estarem prontos
  function _boot() {
    if (window._radarUser && window.db) {
      init();
    } else {
      window.addEventListener('radarUserReady', () => {
        // Pequeno delay para garantir que window.db também está pronto
        setTimeout(init, 500);
      }, { once: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

})();
