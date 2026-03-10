// ─── flipbook.js ──────────────────────────────────────────────────────────────
// Leitor paginado com slide horizontal para mobile (≤768px).
// Ativado/desativado externamente via window._flipbook pelo trocarModo().
// ──────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Configuração ─────────────────────────────────────────────────────────────
  const MOBILE_MAX        = 768;  // px — acima disso = desktop (scroll normal)
  const BLOCOS_POR_PAGINA = 3;    // fallback quando não há data-tipo
  const SWIPE_MIN         = 45;   // px mínimos para considerar swipe
  const ANIM_MS           = 320;  // duração da transição em ms

  // ── Estado ───────────────────────────────────────────────────────────────────
  let paginas     = [];
  let paginaAtual = 0;
  let animando    = false;
  let modoAtivo   = false;

  // ── Detecta mobile ───────────────────────────────────────────────────────────
  function isMobile() {
    return window.innerWidth <= MOBILE_MAX ||
      /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  // ── Monta páginas a partir do #conteudo-newsletter ────────────────────────────
  function montarPaginas() {
    const secaoCompleto = document.getElementById('modo-completo');
    if (!secaoCompleto) return [];

    const conteudo = document.getElementById('conteudo-newsletter');
    if (!conteudo || conteudo.children.length === 0) return [];

    const resultado = [];
    const filhos    = Array.from(conteudo.children);

    const temTipo = filhos.some(f => f.dataset && f.dataset.tipo);
    let grupos    = [];

    if (temTipo) {
      let grupoAtual = [], tipoAtual = null;
      filhos.forEach(filho => {
        const t = filho.dataset?.tipo || 'sem-tipo';
        if (t !== tipoAtual && grupoAtual.length > 0) { grupos.push(grupoAtual); grupoAtual = []; }
        tipoAtual = t;
        grupoAtual.push(filho);
      });
      if (grupoAtual.length > 0) grupos.push(grupoAtual);
    } else {
      for (let i = 0; i < filhos.length; i += BLOCOS_POR_PAGINA)
        grupos.push(filhos.slice(i, i + BLOCOS_POR_PAGINA));
    }

    grupos.forEach((grupo, idx) => {
      const pagina = document.createElement('div');
      pagina.className = 'fb-pagina';
      pagina.setAttribute('data-pagina-tipo', grupo[0]?.dataset?.tipo || 'conteudo');

      if (idx === 0) {
        const header = secaoCompleto.querySelector('.rs-section-header');
        if (header) pagina.appendChild(header.cloneNode(true));
      }

      const wrap = document.createElement('div');
      wrap.className = 'rs-section-body rs-protegido fb-conteudo-wrap';
      grupo.forEach(filho => wrap.appendChild(filho));
      pagina.appendChild(wrap);
      resultado.push(pagina);
    });

    secaoCompleto.style.display = 'none';
    return resultado;
  }

  // ── Injeta CSS ────────────────────────────────────────────────────────────────
  function injetarCSS() {
    if (document.getElementById('fb-styles')) return;
    const style = document.createElement('style');
    style.id = 'fb-styles';
    style.textContent = `
      /* FIX 1: display:block garante visibilidade mesmo com CSS herdado */
      #fb-wrapper {
        display: block !important;
        position: relative;
        overflow: hidden;
        width: 100%;
        /* FIX 3: touch-action none — controle de scroll feito via JS */
        touch-action: none;
      }

      #fb-trilho {
        display: flex;
        transition: transform ${ANIM_MS}ms cubic-bezier(.4,0,.2,1);
        will-change: transform;
      }

      .fb-pagina {
        min-width: 100%;
        box-sizing: border-box;
        padding-bottom: 80px;
      }

      #fb-nav {
        position: fixed;
        bottom: 0; left: 0; right: 0;
        z-index: 999;
        background: rgba(255,255,255,0.96);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border-top: 1px solid #e2e8f0;
        padding: 10px 16px 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 -2px 12px rgba(0,0,0,.06);
      }

      #fb-btn-prev, #fb-btn-next {
        flex-shrink: 0;
        width: 40px; height: 40px;
        border-radius: 50%;
        border: 1.5px solid #e2e8f0;
        background: #fff;
        font-size: 18px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: .15s;
        -webkit-tap-highlight-color: transparent;
      }
      #fb-btn-prev:active, #fb-btn-next:active { background:#f1f5f9; transform:scale(.93); }
      #fb-btn-prev:disabled, #fb-btn-next:disabled { opacity:.3; cursor:default; }

      #fb-progress-wrap { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; }
      #fb-label { font-size:11px; color:#64748b; font-weight:600; letter-spacing:.3px; }
      #fb-progress-track { width:100%; height:4px; background:#e2e8f0; border-radius:4px; overflow:hidden; }
      #fb-progress-bar {
        height:100%;
        background: linear-gradient(90deg,#0A3D62,#1a6fa8);
        border-radius:4px;
        transition: width ${ANIM_MS}ms cubic-bezier(.4,0,.2,1);
      }

      #fb-btn-scroll {
        flex-shrink: 0;
        padding: 5px 10px;
        border: 1.5px solid #e2e8f0;
        border-radius: 20px;
        background: #fff;
        font-size: 10px; font-weight:700; color:#64748b;
        cursor:pointer; white-space:nowrap;
        -webkit-tap-highlight-color: transparent;
      }
      #fb-btn-scroll:active { background:#f1f5f9; }

      #fb-dots { display:flex; gap:4px; }
      .fb-dot { width:6px; height:6px; border-radius:50%; background:#cbd5e1; transition:background .2s,transform .2s; }
      .fb-dot.ativo { background:#0A3D62; transform:scale(1.3); }

      #fb-swipe-hint {
        position:fixed; bottom:70px; left:50%; transform:translateX(-50%);
        background:rgba(10,61,98,.85); color:#fff;
        padding:8px 18px; border-radius:20px;
        font-size:12px; font-weight:600;
        z-index:1000; pointer-events:none;
        animation:fb-hint-anim 2.5s ease forwards;
      }
      @keyframes fb-hint-anim {
        0%   { opacity:0; transform:translateX(-50%) translateY(8px); }
        20%  { opacity:1; transform:translateX(-50%) translateY(0); }
        75%  { opacity:1; }
        100% { opacity:0; transform:translateX(-50%) translateY(-4px); }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Constrói o DOM do flipbook ────────────────────────────────────────────────
  function construirFlipbook() {
    if (modoAtivo) return;
    if (!isMobile()) return;

    paginas = montarPaginas();
    if (paginas.length < 2) return;

    injetarCSS();

    const wrapper = document.createElement('div');
    wrapper.id = 'fb-wrapper';

    const trilho = document.createElement('div');
    trilho.id = 'fb-trilho';

    paginas.forEach(p => trilho.appendChild(p));
    wrapper.appendChild(trilho);

    // FIX 2: NÃO move #rs-cta-wrap nem #rs-watermark para dentro do flipbook.
    // Eles ficam no fluxo normal do app, fora do wrapper.

    const secaoCompleto = document.getElementById('modo-completo');
    if (secaoCompleto?.parentNode) {
      secaoCompleto.parentNode.insertBefore(wrapper, secaoCompleto);
    } else {
      document.getElementById('rs-app')?.appendChild(wrapper);
    }

    const nav = document.createElement('div');
    nav.id = 'fb-nav';
    nav.innerHTML = `
      <button id="fb-btn-prev" aria-label="Página anterior">‹</button>
      <div id="fb-progress-wrap">
        <span id="fb-label">Página 1 de ${paginas.length}</span>
        <div id="fb-progress-track">
          <div id="fb-progress-bar" style="width:${100 / paginas.length}%"></div>
        </div>
        <div id="fb-dots">
          ${paginas.map((_, i) => `<span class="fb-dot${i === 0 ? ' ativo' : ''}"></span>`).join('')}
        </div>
      </div>
      <button id="fb-btn-scroll" title="Alternar modo">↕ Scroll</button>
      <button id="fb-btn-next" aria-label="Próxima página">›</button>
    `;
    document.body.appendChild(nav);

    document.getElementById('fb-btn-prev').addEventListener('click', () => irPara(paginaAtual - 1));
    document.getElementById('fb-btn-next').addEventListener('click', () => irPara(paginaAtual + 1));
    document.getElementById('fb-btn-scroll').addEventListener('click', desativarFlipbook);

    // FIX 3: bloqueia scroll vertical apenas quando o gesto é horizontal
    let touchStartX = 0, touchStartY = 0, bloqueandoScroll = false;

    wrapper.addEventListener('touchstart', e => {
      touchStartX     = e.touches[0].clientX;
      touchStartY     = e.touches[0].clientY;
      bloqueandoScroll = false;
    }, { passive: true });

    wrapper.addEventListener('touchmove', e => {
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      if (!bloqueandoScroll && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
        bloqueandoScroll = true;
      }
      if (bloqueandoScroll) {
        e.preventDefault(); // impede a página de rolar durante swipe horizontal
      }
    }, { passive: false }); // passive:false obrigatório para preventDefault funcionar

    wrapper.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_MIN) {
        irPara(dx < 0 ? paginaAtual + 1 : paginaAtual - 1);
      }
      bloqueandoScroll = false;
    }, { passive: true });

    document.addEventListener('keydown', e => {
      if (!modoAtivo) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') irPara(paginaAtual + 1);
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   irPara(paginaAtual - 1);
    });

    modoAtivo   = true;
    paginaAtual = 0;
    atualizarNav();

    // Hint de swipe na 1ª visita — aparece quando o wrapper entra na viewport
    if (!sessionStorage.getItem('fb_hint_visto')) {
      const obs = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) {
          obs.disconnect();
          sessionStorage.setItem('fb_hint_visto', '1');
          const hint = document.createElement('div');
          hint.id          = 'fb-swipe-hint';
          hint.textContent = '← Deslize para navegar →';
          document.body.appendChild(hint);
          setTimeout(() => hint.remove(), 3000);
        }
      }, { threshold: 0.5 });
      obs.observe(wrapper);
    }
  }

  // ── Navegar para uma página ───────────────────────────────────────────────────
  function irPara(idx) {
    if (animando) return;
    if (idx < 0 || idx >= paginas.length) return;

    animando    = true;
    paginaAtual = idx;

    const trilho = document.getElementById('fb-trilho');
    if (trilho) trilho.style.transform = `translateX(-${idx * 100}%)`;

    atualizarNav();
    setTimeout(() => { animando = false; }, ANIM_MS + 50);
  }

  // ── Atualizar barra de navegação ──────────────────────────────────────────────
  function atualizarNav() {
    const total   = paginas.length;
    const label   = document.getElementById('fb-label');
    const bar     = document.getElementById('fb-progress-bar');
    const btnPrev = document.getElementById('fb-btn-prev');
    const btnNext = document.getElementById('fb-btn-next');
    const dots    = document.querySelectorAll('.fb-dot');

    if (label)   label.textContent = `Página ${paginaAtual + 1} de ${total}`;
    if (bar)     bar.style.width   = `${((paginaAtual + 1) / total) * 100}%`;
    if (btnPrev) btnPrev.disabled  = paginaAtual === 0;
    if (btnNext) btnNext.disabled  = paginaAtual === total - 1;
    dots.forEach((d, i) => d.classList.toggle('ativo', i === paginaAtual));
    if (btnNext) btnNext.textContent = paginaAtual === total - 1 ? '✓' : '›';
  }

  // ── Desativar flipbook (volta ao modo scroll) ─────────────────────────────────
  function desativarFlipbook() {
    if (!modoAtivo) return;
    modoAtivo = false;

    const wrapper       = document.getElementById('fb-wrapper');
    const nav           = document.getElementById('fb-nav');
    const mc            = document.getElementById('conteudo-newsletter');
    const secaoCompleto = document.getElementById('modo-completo');

    if (mc) {
      paginas.forEach(p => {
        const wrap = p.querySelector('.fb-conteudo-wrap');
        if (wrap) Array.from(wrap.children).forEach(f => mc.appendChild(f));
      });
    }

    if (wrapper) wrapper.remove();
    if (nav)     nav.remove();

    if (secaoCompleto) secaoCompleto.style.display = '';

    document.getElementById('fb-styles')?.remove();
    paginas     = [];
    paginaAtual = 0;
  }

  // ── API pública — acionada pelo trocarModo() ──────────────────────────────────
  window._flipbook = { construirFlipbook, desativarFlipbook, irPara };

})();
