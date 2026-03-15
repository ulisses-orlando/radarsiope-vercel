// menuApp.js
// Menu hamburger do app Radar SIOPE
// Integra: Edições, Alertas, Fale Conosco, Minha Área
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Inicialização ─────────────────────────────────────────────────────────
  function init() {
    _injetarCSS();
    _renderMenu();
    _bindEventos();
    _atualizarTotalBadge();
  }

  // ── CSS ───────────────────────────────────────────────────────────────────
  function _injetarCSS() {
    const style = document.createElement('style');
    style.textContent = `
      /* ── Hamburger button ───────────────────────────────────────────────── */
      #rs-menu-btn {
        background: rgba(255,255,255,.12);
        border: 1px solid rgba(255,255,255,.2);
        border-radius: 8px;
        padding: 7px 12px;
        cursor: pointer;
        color: #fff;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        font-weight: 700;
        font-family: 'Syne', system-ui, sans-serif;
        transition: background .15s;
        position: relative;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      #rs-menu-btn:hover,
      #rs-menu-btn.open { background: rgba(255,255,255,.22); }

      /* Linhas do hamburger */
      .rs-ham {
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 16px;
        flex-shrink: 0;
      }
      .rs-ham span {
        display: block;
        height: 2px;
        background: #fff;
        border-radius: 2px;
        transition: transform .22s ease, opacity .22s ease, width .22s ease;
        width: 100%;
      }
      #rs-menu-btn.open .rs-ham span:nth-child(1) {
        transform: rotate(45deg) translate(4px, 4px);
      }
      #rs-menu-btn.open .rs-ham span:nth-child(2) {
        opacity: 0; width: 0%;
      }
      #rs-menu-btn.open .rs-ham span:nth-child(3) {
        transform: rotate(-45deg) translate(4px, -4px);
      }

      /* Badge total no hamburger */
      #rs-menu-total-badge {
        position: absolute;
        top: -7px; right: -7px;
        min-width: 19px; height: 19px;
        padding: 0 5px;
        background: #ef4444;
        color: #fff;
        border-radius: 99px;
        font-size: 10px; font-weight: 900;
        line-height: 19px; text-align: center;
        box-shadow: 0 0 0 2px var(--azul, #0A3D62);
        transition: opacity .2s;
        pointer-events: none;
      }

      /* ── Dropdown ───────────────────────────────────────────────────────── */
      #rs-menu-dropdown {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        display: flex;
        flex-direction: column;
        gap: 5px;
        z-index: 500;
        min-width: 195px;
        pointer-events: none;
        opacity: 0;
        transform: translateY(-6px) scale(.97);
        transition: opacity .18s ease, transform .18s ease;
      }
      #rs-menu-dropdown.open {
        pointer-events: all;
        opacity: 1;
        transform: translateY(0) scale(1);
      }

      /* Item do menu */
      .rs-menu-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 11px 14px;
        border: none;
        border-radius: 9px;
        cursor: pointer;
        color: #fff;
        font-size: 13px;
        font-weight: 700;
        font-family: 'Syne', system-ui, sans-serif;
        box-shadow: 0 2px 10px rgba(0,0,0,.3);
        width: 100%;
        text-align: left;
        transition: filter .15s, transform .1s;
        opacity: 0;
        transform: translateY(-4px);
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      #rs-menu-dropdown.open .rs-menu-item {
        opacity: 1;
        transform: translateY(0);
      }
      #rs-menu-dropdown.open .rs-menu-item:nth-child(1) { transition: opacity .16s ease .02s, transform .16s ease .02s, filter .15s; }
      #rs-menu-dropdown.open .rs-menu-item:nth-child(2) { transition: opacity .16s ease .06s, transform .16s ease .06s, filter .15s; }
      #rs-menu-dropdown.open .rs-menu-item:nth-child(3) { transition: opacity .16s ease .10s, transform .16s ease .10s, filter .15s; }
      #rs-menu-dropdown.open .rs-menu-item:nth-child(4) { transition: opacity .16s ease .14s, transform .16s ease .14s, filter .15s; }
      .rs-menu-item:hover { filter: brightness(1.15); }
      .rs-menu-item:active { transform: scale(.97); }

      .rs-menu-item-icon  { font-size: 15px; flex-shrink: 0; }
      .rs-menu-item-label { flex: 1; }
      .rs-menu-item-tag   {
        font-size: 8px; font-weight: 700;
        letter-spacing: .5px; opacity: .65;
        text-transform: uppercase;
      }

      /* Badge individual */
      .rs-menu-item-badge {
        min-width: 17px; height: 17px;
        padding: 0 5px;
        background: #ef4444;
        color: #fff;
        border-radius: 99px;
        font-size: 9px; font-weight: 900;
        line-height: 17px; text-align: center;
        flex-shrink: 0;
      }
      .rs-menu-item-badge.verde { background: #22c55e; }

      /* ── Overlay ────────────────────────────────────────────────────────── */
      #rs-menu-overlay {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 400;
      }
      #rs-menu-overlay.open { display: block; }

      /* Temas */
      [data-theme="exito"]      #rs-menu-btn { border-color: rgba(34,197,94,.3); }
      [data-theme="aurora"]     #rs-menu-btn { border-color: rgba(167,139,250,.3); }
    `;
    document.head.appendChild(style);
  }

  // ── Render do menu ────────────────────────────────────────────────────────
  function _renderMenu() {
    const wrap = document.getElementById('rs-menu-wrap');
    if (!wrap) return;

    const user = window._radarUser;
    const isAssinante = user?.segmento === 'assinante';

    wrap.style.position = 'relative';
    wrap.innerHTML = `
      <button id="rs-menu-btn" type="button" aria-label="Menu" aria-expanded="false">
        <div class="rs-ham">
          <span></span><span></span><span></span>
        </div>
        Menu
        <div id="rs-menu-total-badge" style="display:none">0</div>
      </button>

      <div id="rs-menu-dropdown" role="menu">
        <button class="rs-menu-item" id="rs-menu-edicoes"
          style="background:#0A3D62" role="menuitem">
          <span class="rs-menu-item-icon">📚</span>
          <span class="rs-menu-item-label">Edições</span>
        </button>
        <button class="rs-menu-item" id="rs-menu-alertas"
          style="background:#1e4d78" role="menuitem">
          <span class="rs-menu-item-icon">🔔</span>
          <span class="rs-menu-item-label">Alertas</span>
          <span class="rs-menu-item-badge" id="rs-menu-badge-alertas" style="display:none">0</span>
        </button>
        <button class="rs-menu-item" id="rs-menu-fale"
          style="background:#0e6a82" role="menuitem">
          <span class="rs-menu-item-icon">💬</span>
          <span class="rs-menu-item-label">Fale Conosco</span>
          <span class="rs-menu-item-badge verde" id="rs-menu-badge-fc" style="display:none">0</span>
        </button>
        ${isAssinante ? `
        <button class="rs-menu-item" id="rs-menu-area"
          style="background:#5b21b6" role="menuitem">
          <span class="rs-menu-item-icon">👤</span>
          <span class="rs-menu-item-label">Minha Área</span>
          <span class="rs-menu-item-tag">assinante</span>
        </button>` : ''}
      </div>

      <div id="rs-menu-overlay"></div>
    `;
  }

  // ── Bind de eventos ───────────────────────────────────────────────────────
  function _bindEventos() {
    const wrap = document.getElementById('rs-menu-wrap');
    if (!wrap) return;

    document.getElementById('rs-menu-btn')
      ?.addEventListener('click', _toggleMenu);

    document.getElementById('rs-menu-overlay')
      ?.addEventListener('click', _fecharMenu);

    // Edições — usa o drawer existente
    document.getElementById('rs-menu-edicoes')
      ?.addEventListener('click', () => {
        _fecharMenu();
        // Aciona o drawer de edições via evento customizado
        window.dispatchEvent(new CustomEvent('rs:abrirEdicoes'));
      });

    // Alertas
    document.getElementById('rs-menu-alertas')
      ?.addEventListener('click', () => {
        _fecharMenu();
        window._rsAlertasAbrir?.();
      });

    // Fale Conosco
    document.getElementById('rs-menu-fale')
      ?.addEventListener('click', () => {
        _fecharMenu();
        window._rsFcAbrir?.();
      });

    // Minha Área — abre modal com iframe
    document.getElementById('rs-menu-area')
      ?.addEventListener('click', () => {
        _fecharMenu();
        _abrirModalLogin();
      });

    // Escuta mensagens do iframe
    window.addEventListener('message', e => {
      if (e.data?.tipo === 'rs:loginSucesso') {
        const destino = e.data.destino || 'painel.html';
        if (destino === 'admin.html') {
          // Admin → abre o painel admin numa nova aba
          window.open('/admin.html', '_blank');
          _fecharModalLogin();
        } else {
          // Assinante/usuário → fecha modal e fica no app
          _fecharModalLogin();
          // Atualiza saudação
          const nome = (e.data.usuario?.nome || '').split(' ')[0];
          const hd = document.getElementById('hd-saudacao');
          if (hd && nome) hd.textContent = `Olá, ${nome}!`;
        }
      }
      if (e.data?.tipo === 'rs:fecharModal') {
        _fecharModalLogin();
      }
    });

    // ESC fecha
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') _fecharMenu();
    });

    // Atualiza badges periodicamente
    setInterval(_atualizarBadges, 30000);
    setTimeout(_atualizarBadges, 1000);
  }

  // ── Toggle / Abrir / Fechar ───────────────────────────────────────────────
  let _aberto = false;

  function _toggleMenu() {
    _aberto ? _fecharMenu() : _abrirMenu();
  }

  function _abrirMenu() {
    _aberto = true;
    document.getElementById('rs-menu-btn')?.classList.add('open');
    document.getElementById('rs-menu-btn')?.setAttribute('aria-expanded', 'true');
    document.getElementById('rs-menu-dropdown')?.classList.add('open');
    document.getElementById('rs-menu-overlay')?.classList.add('open');
    // Oculta badge total ao abrir
    const tb = document.getElementById('rs-menu-total-badge');
    if (tb) tb.style.opacity = '0';
  }

  function _fecharMenu() {
    _aberto = false;
    document.getElementById('rs-menu-btn')?.classList.remove('open');
    document.getElementById('rs-menu-btn')?.setAttribute('aria-expanded', 'false');
    document.getElementById('rs-menu-dropdown')?.classList.remove('open');
    document.getElementById('rs-menu-overlay')?.classList.remove('open');
    // Restaura badge total
    const tb = document.getElementById('rs-menu-total-badge');
    if (tb) tb.style.opacity = '1';
  }

  // ── Badges ────────────────────────────────────────────────────────────────
  function _atualizarBadges() {
    // Alertas — lê do badge da central
    window._rsAlertasBadgeAtualizar?.();
    // Fale Conosco — lê do badge do fc
    window._rsFcBadgeAtualizar?.();
    // Após breve delay, lê os valores e atualiza o total
    setTimeout(_atualizarTotalBadge, 500);
  }

  function _atualizarTotalBadge() {
    // Lê badges individuais
    const bAlertas = _getBadgeCount('rs-alertas-badge');
    const bFc      = _getBadgeCount('rs-fc-badge');
    const total    = bAlertas + bFc;

    // Atualiza badges individuais no menu
    _setBadge('rs-menu-badge-alertas', bAlertas);
    _setBadge('rs-menu-badge-fc',      bFc, true);

    // Atualiza total no hamburger
    const tb = document.getElementById('rs-menu-total-badge');
    if (tb) {
      tb.textContent   = total > 9 ? '9+' : String(total);
      tb.style.display = total > 0 ? 'block' : 'none';
    }
  }

  function _getBadgeCount(id) {
    const el = document.getElementById(id);
    if (!el || el.style.display === 'none') return 0;
    return parseInt(el.textContent) || 0;
  }

  function _setBadge(id, count) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent   = count > 9 ? '9+' : String(count);
    el.style.display = count > 0 ? 'inline-block' : 'none';
  }

  // ── Modal de login ───────────────────────────────────────────────────────
  function _abrirModalLogin() {
    // Cria modal se não existe
    if (!document.getElementById('rs-login-modal')) {
      const modal = document.createElement('div');
      modal.id = 'rs-login-modal';
      modal.style.cssText = `
        position: fixed; inset: 0; z-index: 9000;
        background: rgba(0,0,0,.7);
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(3px);
        animation: rsFadeIn .2s ease;
      `;
      modal.innerHTML = `
        <style>
          @keyframes rsFadeIn { from { opacity:0 } to { opacity:1 } }
          @keyframes rsSlideUp { from { opacity:0; transform:translateY(20px) } to { opacity:1; transform:translateY(0) } }
          #rs-login-iframe-wrap {
            background: #fff; border-radius: 16px;
            width: min(420px, 94vw); height: min(520px, 90vh);
            position: relative; overflow: hidden;
            box-shadow: 0 8px 40px rgba(0,0,0,.4);
            animation: rsSlideUp .25s ease;
          }
          #rs-login-iframe {
            width: 100%; height: 100%;
            border: none;
          }
          #rs-login-fechar {
            position: absolute; top: 10px; right: 12px;
            background: rgba(0,0,0,.15); border: none;
            border-radius: 50%; width: 28px; height: 28px;
            color: #fff; font-size: 16px; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            z-index: 1; transition: background .15s;
          }
          #rs-login-fechar:hover { background: rgba(0,0,0,.3); }
        </style>
        <div id="rs-login-iframe-wrap">
          <button id="rs-login-fechar" onclick="window._rsFecharLogin()">×</button>
          <iframe id="rs-login-iframe" src="/login.html" title="Minha Área"></iframe>
        </div>
      `;
      // Fecha ao clicar fora
      modal.addEventListener('click', e => {
        if (e.target === modal) _fecharModalLogin();
      });
      document.body.appendChild(modal);
    } else {
      document.getElementById('rs-login-modal').style.display = 'flex';
    }
  }

  function _fecharModalLogin() {
    const modal = document.getElementById('rs-login-modal');
    if (modal) {
      modal.style.opacity = '0';
      modal.style.transition = 'opacity .2s';
      setTimeout(() => modal.remove(), 200);
    }
  }

  window._rsFecharLogin = _fecharModalLogin;

  // Expõe para uso externo
  window._rsMenuFechar          = _fecharMenu;
  window._rsMenuAtualizarBadges = _atualizarTotalBadge;

  // ── Boot ──────────────────────────────────────────────────────────────────
  function _boot() {
    if (window._radarUser && window.db) {
      init();
    } else {
      window.addEventListener('radarUserReady', () => {
        setTimeout(init, 600);
      }, { once: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

})();
