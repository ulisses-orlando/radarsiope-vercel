// ─── flipbook.js ──────────────────────────────────────────────────────────────
// Leitor paginado com slide horizontal para mobile (≤768px).
// No desktop mantém o scroll normal.
// Não altera nenhum arquivo existente — observa o DOM e se injeta após o conteúdo
// carregar (detecta #rs-app se tornando visível).
// ──────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Configuração ─────────────────────────────────────────────────────────────
  const MOBILE_MAX = 768;   // px — acima disso = desktop (scroll normal)
  const BLOCOS_POR_PAGINA = 3;     // filhos do #conteudo-newsletter por página (fallback)
  const SWIPE_MIN = 45;    // px mínimos para considerar swipe
  const ANIM_MS = 320;   // duração da transição em ms

  // ── Estado ───────────────────────────────────────────────────────────────────
  let paginas = [];
  let paginaAtual = 0;
  let animando = false;
  let modoAtivo = false;

  // ── Detecta mobile ───────────────────────────────────────────────────────────
  function isMobile() {
    return window.innerWidth <= MOBILE_MAX ||
      /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  // ── Aguarda #rs-app ficar visível (mostrarApp seta display:block) ─────────────
  function aguardarApp(cb) {
    const app = document.getElementById('rs-app');
    if (!app) return;

    if (app.style.display === 'block') { setTimeout(cb, 400); return; }

    const obs = new MutationObserver(() => {
      if (app.style.display === 'block') {
        obs.disconnect();
        setTimeout(cb, 400);
      }
    });
    obs.observe(app, { attributes: true, attributeFilter: ['style'] });
  }

  // ── Coleta e monta as páginas ─────────────────────────────────────────────────
  // CORREÇÃO: pagina APENAS o conteúdo de #modo-completo (os rs-blocos).
  // As demais sections (#modo-rapido, municipio, reactions etc.) ficam no scroll normal.
  function montarPaginas() {
    const secaoCompleto = document.getElementById('modo-completo');
    if (!secaoCompleto) return [];

    const conteudo = document.getElementById('conteudo-newsletter');
    if (!conteudo || conteudo.children.length === 0) return [];

    const resultado = [];
    const filhos = Array.from(conteudo.children);

    // Agrupamento: por data-tipo (injetado pelo JS) ou por contagem
    const temTipo = filhos.some(f => f.dataset && f.dataset.tipo);
    let grupos = [];

    if (temTipo) {
      // Cada tipo diferente → nova página; mesmo tipo consecutivo → mesma página
      let grupoAtual = [];
      let tipoAtual = null;
      filhos.forEach(filho => {
        const t = filho.dataset?.tipo || 'sem-tipo';
        if (t !== tipoAtual && grupoAtual.length > 0) {
          grupos.push(grupoAtual);
          grupoAtual = [];
        }
        tipoAtual = t;
        grupoAtual.push(filho);
      });
      if (grupoAtual.length > 0) grupos.push(grupoAtual);
    } else {
      // Fallback: agrupa por quantidade
      for (let i = 0; i < filhos.length; i += BLOCOS_POR_PAGINA) {
        grupos.push(filhos.slice(i, i + BLOCOS_POR_PAGINA));
      }
    }

    grupos.forEach((grupo, idx) => {
      const pagina = document.createElement('div');
      pagina.className = 'fb-pagina';
      const tipoLabel = grupo[0]?.dataset?.tipo || 'conteudo';
      pagina.setAttribute('data-pagina-tipo', tipoLabel);

      // Clona o header da section apenas na primeira página
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

    // Esconde a section original (substituída pelo flipbook wrapper)
    secaoCompleto.style.display = 'none';

    return resultado;
  }

  // ── Injeta CSS ────────────────────────────────────────────────────────────────
  function injetarCSS() {
    if (document.getElementById('fb-styles')) return;
    const style = document.createElement('style');
    style.id = 'fb-styles';
    style.textContent = `
      /* ── Wrapper do flipbook ── */
      #fb-wrapper {
        position: relative;
        overflow: hidden;
        width: 100%;
        touch-action: pan-y;
      }

      /* ── Trilho deslizante ── */
      #fb-trilho {
        display: flex;
        transition: transform ${ANIM_MS}ms cubic-bezier(.4, 0, .2, 1);
        will-change: transform;
      }

      /* ── Cada página ── */
      .fb-pagina {
        min-width: 100%;
        box-sizing: border-box;
        padding-bottom: 80px;
      }

      /* ── Barra de navegação fixa na base ── */
      #fb-nav {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
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
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 1.5px solid #e2e8f0;
        background: #fff;
        font-size: 18px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: .15s;
        -webkit-tap-highlight-color: transparent;
      }
      #fb-btn-prev:active, #fb-btn-next:active {
        background: #f1f5f9;
        transform: scale(.93);
      }
      #fb-btn-prev:disabled, #fb-btn-next:disabled {
        opacity: .3;
        cursor: default;
      }

      /* ── Barra de progresso ── */
      #fb-progress-wrap {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }
      #fb-label {
        font-size: 11px;
        color: #64748b;
        font-weight: 600;
        letter-spacing: .3px;
      }
      #fb-progress-track {
        width: 100%;
        height: 4px;
        background: #e2e8f0;
        border-radius: 4px;
        overflow: hidden;
      }
      #fb-progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #0A3D62, #1a6fa8);
        border-radius: 4px;
        transition: width ${ANIM_MS}ms cubic-bezier(.4,0,.2,1);
      }

      /* ── Botão de modo scroll ── */
      #fb-btn-scroll {
        flex-shrink: 0;
        padding: 5px 10px;
        border: 1.5px solid #e2e8f0;
        border-radius: 20px;
        background: #fff;
        font-size: 10px;
        font-weight: 700;
        color: #64748b;
        cursor: pointer;
        white-space: nowrap;
        -webkit-tap-highlight-color: transparent;
      }
      #fb-btn-scroll:active { background: #f1f5f9; }

      /* ── Indicadores de ponto ── */
      #fb-dots {
        display: flex;
        gap: 4px;
      }
      .fb-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #cbd5e1;
        transition: background .2s, transform .2s;
      }
      .fb-dot.ativo {
        background: #0A3D62;
        transform: scale(1.3);
      }

      /* ── Indicador de swipe (aparece na 1ª visita) ── */
      #fb-swipe-hint {
        position: fixed;
        bottom: 70px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(10,61,98,.85);
        color: #fff;
        padding: 8px 18px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        z-index: 1000;
        pointer-events: none;
        animation: fb-hint-anim 2.5s ease forwards;
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
    const mc = document.getElementById('conteudo-newsletter');
    console.log('[FLIPBOOK] filhos do conteudo-newsletter:', mc?.children.length);

    paginas = montarPaginas();
    console.log('[FLIPBOOK] paginas geradas:', paginas.length);
    
    if (paginas.length < 2) return; // não vale paginar com 1 página

    injetarCSS();

    // Wrapper + trilho
    const wrapper = document.createElement('div');
    wrapper.id = 'fb-wrapper';

    const trilho = document.createElement('div');
    trilho.id = 'fb-trilho';

    paginas.forEach(p => trilho.appendChild(p));
    wrapper.appendChild(trilho);

    // CTA e watermark vão para a última página
    const cta = document.getElementById('rs-cta-wrap');
    const watermark = document.getElementById('rs-watermark');
    const ultima = paginas[paginas.length - 1];
    if (cta) ultima.appendChild(cta);
    if (watermark) ultima.appendChild(watermark);

    // Insere no lugar de #modo-completo (que agora está oculto)
    const secaoCompleto = document.getElementById('modo-completo');
    if (secaoCompleto && secaoCompleto.parentNode) {
      secaoCompleto.parentNode.insertBefore(wrapper, secaoCompleto);
    } else {
      const app = document.getElementById('rs-app');
      app?.appendChild(wrapper);
    }

    // Barra de navegação
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

    // Event listeners
    document.getElementById('fb-btn-prev').addEventListener('click', () => irPara(paginaAtual - 1));
    document.getElementById('fb-btn-next').addEventListener('click', () => irPara(paginaAtual + 1));
    document.getElementById('fb-btn-scroll').addEventListener('click', desativarFlipbook);

    // Swipe touch
    let touchStartX = 0, touchStartY = 0;
    wrapper.addEventListener('touchstart', e => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    wrapper.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_MIN) {
        irPara(dx < 0 ? paginaAtual + 1 : paginaAtual - 1);
      }
    }, { passive: true });

    // Teclado (desktop)
    document.addEventListener('keydown', e => {
      if (!modoAtivo) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') irPara(paginaAtual + 1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') irPara(paginaAtual - 1);
    });

    modoAtivo = true;
    atualizarNav();

    // Hint de swipe na 1ª visita
    if (!sessionStorage.getItem('fb_hint_visto')) {
      sessionStorage.setItem('fb_hint_visto', '1');
      const hint = document.createElement('div');
      hint.id = 'fb-swipe-hint';
      hint.textContent = '← Deslize para navegar →';
      document.body.appendChild(hint);
      setTimeout(() => hint.remove(), 3000);
    }
  }

  // ── Navegar para uma página ───────────────────────────────────────────────────
  function irPara(idx) {
    if (animando) return;
    if (idx < 0 || idx >= paginas.length) return;

    animando = true;
    paginaAtual = idx;

    const trilho = document.getElementById('fb-trilho');
    if (trilho) trilho.style.transform = `translateX(-${idx * 100}%)`;

    atualizarNav();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => { animando = false; }, ANIM_MS + 50);
  }

  // ── Atualizar barra de navegação ──────────────────────────────────────────────
  function atualizarNav() {
    const total = paginas.length;
    const label = document.getElementById('fb-label');
    const bar = document.getElementById('fb-progress-bar');
    const btnPrev = document.getElementById('fb-btn-prev');
    const btnNext = document.getElementById('fb-btn-next');
    const dots = document.querySelectorAll('.fb-dot');

    if (label) label.textContent = `Página ${paginaAtual + 1} de ${total}`;
    if (bar) bar.style.width = `${((paginaAtual + 1) / total) * 100}%`;
    if (btnPrev) btnPrev.disabled = paginaAtual === 0;
    if (btnNext) btnNext.disabled = paginaAtual === total - 1;

    dots.forEach((d, i) => d.classList.toggle('ativo', i === paginaAtual));

    if (btnNext) btnNext.textContent = paginaAtual === total - 1 ? '✓' : '›';
  }

  // ── Desativar flipbook (volta ao modo scroll) ─────────────────────────────────
  function desativarFlipbook() {
    if (!modoAtivo) return;
    modoAtivo = false;

    const wrapper = document.getElementById('fb-wrapper');
    const nav = document.getElementById('fb-nav');
    const mc = document.getElementById('conteudo-newsletter');
    const secaoCompleto = document.getElementById('modo-completo');

    // Devolve os blocos ao #conteudo-newsletter
    if (mc) {
      paginas.forEach(p => {
        const wrap = p.querySelector('.fb-conteudo-wrap');
        if (wrap) Array.from(wrap.children).forEach(f => mc.appendChild(f));
      });
    }

    // Restaura CTA e watermark ao lugar original (após #rs-app)
    const app = document.getElementById('rs-app');
    const cta = document.getElementById('rs-cta-wrap');
    const watermark = document.getElementById('rs-watermark');
    if (app && cta) app.appendChild(cta);
    if (app && watermark) app.appendChild(watermark);

    if (wrapper) wrapper.remove();
    if (nav) nav.remove();

    // Restaura a section original
    if (secaoCompleto) secaoCompleto.style.display = '';

    document.getElementById('fb-styles')?.remove();
    paginas = [];
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    if (!isMobile()) return; // desktop: scroll normal

    aguardarApp(() => {
      const mc = document.getElementById('conteudo-newsletter');
      if (mc && mc.children.length === 0) {
        // Polling leve até ter conteúdo (máx 3s)
        let tentativas = 0;
        const t = setInterval(() => {
          if (mc.children.length > 0 || ++tentativas > 30) {
            clearInterval(t);
            construirFlipbook();
          }
        }, 100);
      } else {
        construirFlipbook();
      }
    });
  }

  // Inicia quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expõe para debug/testes
  window._flipbook = { irPara, desativarFlipbook };

})();
