/* ==========================================================================
   mapaMental.js — Módulo de Mapa Mental Interativo (CORRIGIDO & VALIDADO)
   Integração : verNewsletterComToken.js → renderMidia()
   Dados      : newsletter.mapa_mental (Firestore)
   Entrada    : window.MapaMentalManager.init(newsletter, acesso)
   ========================================================================== */
(function () {
  'use strict';

  // ── Constantes de Layout ────────────────────────────────────────────────
  const NW   = { root: 140, l1: 175, l2: 210 };
  const NH   = 44;
  const HGAP = 68;
  const VGAP = 12;
  const PAD  = 48;
  const BR   = 10;
  const MIN_SCALE = 0.2;
  const MAX_SCALE = 2.5;

  const PALETA = ['#60A5FA', '#34D399', '#A78BFA', '#FBBF24', '#22D3EE', '#F87171', '#818CF8', '#4ADE80'];

  // ── Estado interno ──────────────────────────────────────────────────────
  let _dados    = null;
  let _expanded = new Set();
  let _tf       = { x: 0, y: 0, scale: 1 };
  let _svgEl    = null;
  let _svgG     = null;
  let _layout   = null;
  let _wasDragging = false;

  // ══════════════════════════════════════════════════════════════════════
  // PÚBLICO
  // ══════════════════════════════════════════════════════════════════════
  function init(newsletter, acesso) {
    const mm = newsletter?.mapa_mental;
    if (!mm?.ativo || !mm?.raiz) return;
    
    _dados = mm;
    _injetarCSS();
    _renderizarCard();
    console.log('[mapaMental.js] ✅ Módulo carregado e card injetado.');
  }

  // ══════════════════════════════════════════════════════════════════════
  // CARD NA SEÇÃO DE MÍDIAS
  // ══════════════════════════════════════════════════════════════════════
  function _renderizarCard() {
    const wrap = document.getElementById('midia-conteudo')
              || document.getElementById('rs-midia-wrap')
              || document.getElementById('rs-app');
    if (!wrap) return;

    document.getElementById('rs-mm-card')?.remove();

    const card = document.createElement('div');
    card.id        = 'rs-mm-card';
    card.className = 'rs-mm-card';
    card.innerHTML = `
      <div class="rs-mm-card-icone">🗺️</div>
      <div class="rs-mm-card-info">
        <span class="rs-mm-card-label">Mapa Mental</span>
        <span class="rs-mm-card-titulo">${_esc(_dados.titulo || 'Mapa da edição')}</span>
      </div>
      <button class="rs-mm-card-btn" type="button">Explorar →</button>
    `;

    wrap.appendChild(card);
    card.querySelector('.rs-mm-card-btn').addEventListener('click', _abrirModal);
  }

  // ══════════════════════════════════════════════════════════════════════
  // MODAL FULLSCREEN
  // ══════════════════════════════════════════════════════════════════════
  function _abrirModal() {
    document.getElementById('rs-mm-overlay')?.remove();
    _expanded.clear();
    _tf = { x: 0, y: 0, scale: 1 };

    const overlay = document.createElement('div');
    overlay.id        = 'rs-mm-overlay';
    overlay.className = 'rs-mm-overlay';
    overlay.innerHTML = `
      <div class="rs-mm-modal">
        <header class="rs-mm-header">
          <div class="rs-mm-header-esq">
            <span class="rs-mm-badge">Mapa Mental</span>
            <span class="rs-mm-titulo-header">${_esc(_dados.titulo || '')}</span>
          </div>
          <div class="rs-mm-header-dir">
            <button id="rs-mm-btn-expandir" title="Expandir todos" type="button">⊞</button>
            <button id="rs-mm-btn-reset"    title="Centralizar"   type="button">⌖</button>
            <button id="rs-mm-btn-fechar"   title="Fechar"        type="button">✕</button>
          </div>
        </header>
        <div class="rs-mm-canvas-wrap" id="rs-mm-canvas-wrap">
          <svg id="rs-mm-svg" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="rs-mm-dots" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.05)"/>
              </pattern>
              <filter id="rs-mm-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="rgba(0,0,0,0.45)"/>
              </filter>
            </defs>
            <rect id="rs-mm-bg" width="100%" height="100%" fill="url(#rs-mm-dots)"/>
            <g id="rs-mm-g"></g>
          </svg>
        </div>
        <div class="rs-mm-hint">
          <span>Toque nos tópicos para expandir</span>
          <span class="rs-mm-sep">·</span>
          <span>Arraste para navegar</span>
          <span class="rs-mm-sep">·</span>
          <span>Pinça para zoom</span>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    _svgEl = document.getElementById('rs-mm-svg');
    _svgG  = document.getElementById('rs-mm-g');

    requestAnimationFrame(() => {
      _renderizarGrafo();
      _centralizarVista(false);
      _setupInteracao();
    });

    document.getElementById('rs-mm-btn-fechar').addEventListener('click', _fecharModal);
    document.getElementById('rs-mm-btn-reset').addEventListener('click', () => _centralizarVista(true));
    document.getElementById('rs-mm-btn-expandir').addEventListener('click', _toggleExpandirTodos);
  }

  function _fecharModal() {
    document.getElementById('rs-mm-overlay')?.remove();
    document.body.style.overflow = '';
    _svgEl = _svgG = _layout = null;
  }

  function _toggleExpandirTodos() {
    const filhos = _dados.raiz?.filhos || [];
    const todosExp = filhos.every(n => _expanded.has(n.id));
    if (todosExp) _expanded.clear();
    else filhos.forEach(n => _expanded.add(n.id));

    _renderizarGrafo();
    requestAnimationFrame(() => _centralizarVista(true));
  }

  // ══════════════════════════════════════════════════════════════════════
  // LAYOUT ENGINE
  // ══════════════════════════════════════════════════════════════════════
  function _calcularLayout() {
    const raiz   = _dados.raiz;
    const filhos = raiz.filhos || [];
    const pos    = {};

    function altSubarvore(node) {
      if (!_expanded.has(node.id) || !node.filhos?.length) return NH;
      return node.filhos.length * NH + (node.filhos.length - 1) * VGAP;
    }

    const alturas     = filhos.map(altSubarvore);
    const alturaTotal = alturas.reduce((soma, h, i) => soma + h + (i > 0 ? VGAP : 0), 0);

    pos['root'] = {
      x: PAD, y: alturaTotal / 2 - NH / 2, w: NW.root, h: NH,
      tipo: 'root', texto: raiz.texto, cor: null, nodeId: 'root',
    };

    let topoY = 0;
    filhos.forEach((node, idx) => {
      const sh  = alturas[idx];
      const cor = PALETA[idx % PALETA.length];

      pos[node.id] = {
        x: PAD + NW.root + HGAP, y: topoY + sh / 2 - NH / 2, w: NW.l1, h: NH,
        tipo: 'l1', texto: node.texto, cor, nodeId: node.id, temFilhos: !!(node.filhos?.length),
      };

      if (_expanded.has(node.id) && node.filhos?.length) {
        node.filhos.forEach((child, cidx) => {
          pos[child.id] = {
            x: PAD + NW.root + HGAP + NW.l1 + HGAP, y: topoY + cidx * (NH + VGAP), w: NW.l2, h: NH,
            tipo: 'l2', texto: child.texto, cor, nodeId: child.id,
          };
        });
      }
      topoY += sh + VGAP;
    });

    const xs = Object.values(pos).map(p => p.x + p.w);
    const ys = Object.values(pos).map(p => p.y + p.h);
    return { pos, alturaTotal, canvasW: Math.max(...xs) + PAD, canvasH: Math.max(...ys) + PAD };
  }

  // ══════════════════════════════════════════════════════════════════════
  // SVG RENDERER
  // ══════════════════════════════════════════════════════════════════════
  function _renderizarGrafo() {
    if (!_svgG || !_svgEl) return;
    _layout = _calcularLayout();
    const { pos } = _layout;
    const raiz    = _dados.raiz;
    const filhos  = raiz.filhos || [];

    _svgG.innerHTML = '';

    // Conexões raiz → nível 1
    const rootP = pos['root'];
    filhos.forEach(node => {
      const p = pos[node.id];
      _drawCurve(rootP.x + rootP.w, rootP.y + rootP.h / 2, p.x, p.y + p.h / 2, p.cor, 2, 0.5);
    });

    // Conexões nível 1 → nível 2
    filhos.forEach(node => {
      if (!_expanded.has(node.id) || !node.filhos?.length) return;
      const parent = pos[node.id];
      node.filhos.forEach(child => {
        const c = pos[child.id];
        if (!c) return;
        _drawCurve(parent.x + parent.w, parent.y + parent.h / 2, c.x, c.y + c.h / 2, parent.cor, 1.5, 0.4);
      });
    });

    // Nós
    Object.values(pos).forEach(_drawNode);
  }

  function _drawCurve(x1, y1, x2, y2, cor, strokeW, opacity) {
    const mx = (x1 + x2) / 2;
    const path = svgEl('path');
    path.setAttribute('d', `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', cor || '#334155');
    path.setAttribute('stroke-width', strokeW);
    path.setAttribute('stroke-opacity', opacity);
    path.setAttribute('class', 'rs-mm-curve');
    _svgG.appendChild(path);
  }

  function _drawNode(p) {
    const g = svgEl('g');
    g.setAttribute('class', `rs-mm-no rs-mm-no--${p.tipo}`);
    g.setAttribute('data-id', p.nodeId);
    if (p.tipo === 'l1') g.style.cursor = 'pointer';

    const rect = svgEl('rect');
    rect.setAttribute('x', p.x);
    rect.setAttribute('y', p.y);
    rect.setAttribute('width', p.w);
    rect.setAttribute('height', p.h);
    rect.setAttribute('rx', BR);

    if (p.tipo === 'root') {
      rect.setAttribute('fill', '#0A3D62');
      rect.setAttribute('stroke', '#1d5a8c');
      rect.setAttribute('stroke-width', '1.5');
      rect.setAttribute('filter', 'url(#rs-mm-shadow)');
    } else if (p.tipo === 'l1') {
      const isExp = _expanded.has(p.nodeId);
      rect.setAttribute('fill', isExp ? `${p.cor}22` : 'rgba(255,255,255,0.05)');
      rect.setAttribute('stroke', p.cor);
      rect.setAttribute('stroke-width', '1.5');

      const faixa = svgEl('rect');
      faixa.setAttribute('x', p.x);
      faixa.setAttribute('y', p.y + BR / 2);
      faixa.setAttribute('width', 3);
      faixa.setAttribute('height', p.h - BR);
      faixa.setAttribute('fill', p.cor);
      g.appendChild(faixa);

      const ic = svgEl('text');
      ic.setAttribute('x', p.x + p.w - 16);
      ic.setAttribute('y', p.y + p.h / 2 + 5);
      ic.setAttribute('font-size', '14');
      ic.setAttribute('font-weight', '700');
      ic.setAttribute('fill', p.cor);
      ic.setAttribute('opacity', '0.85');
      ic.setAttribute('font-family', 'system-ui, sans-serif');
      ic.textContent = isExp ? '−' : '+';
      g.appendChild(ic);
    } else {
      rect.setAttribute('fill', `${p.cor}12`);
      rect.setAttribute('stroke', `${p.cor}44`);
      rect.setAttribute('stroke-width', '1');
    }
    g.appendChild(rect);

    // Texto
    const paddingX  = p.tipo === 'l1' ? 14 : 12;
    const maxTextW  = p.w - paddingX - (p.tipo === 'l1' ? 28 : paddingX);
    const fontSize  = p.tipo === 'root' ? 13 : p.tipo === 'l1' ? 12 : 11;
    const fillColor = p.tipo === 'root' ? '#ffffff' : p.tipo === 'l1' ? '#f1f5f9' : '#cbd5e1';
    const fontWeight = p.tipo === 'root' ? '700' : '500';
    const linhas     = _wrapText(p.texto, maxTextW, fontSize);
    const cx         = p.x + paddingX;

    if (linhas.length === 1) {
      const t = svgEl('text');
      t.setAttribute('x', cx);
      t.setAttribute('y', p.y + p.h / 2 + 4);
      t.setAttribute('font-size', fontSize);
      t.setAttribute('font-weight', fontWeight);
      t.setAttribute('fill', fillColor);
      t.setAttribute('font-family', 'system-ui,-apple-system,sans-serif');
      t.textContent = linhas[0];
      g.appendChild(t);
    } else {
      linhas.slice(0, 2).forEach((linha, i) => {
        const t = svgEl('text');
        t.setAttribute('x', cx);
        t.setAttribute('y', p.y + p.h / 2 + (i === 0 ? -4 : 11));
        t.setAttribute('font-size', fontSize);
        t.setAttribute('font-weight', fontWeight);
        t.setAttribute('fill', fillColor);
        t.setAttribute('font-family', 'system-ui,-apple-system,sans-serif');
        t.textContent = linha;
        g.appendChild(t);
      });
    }

    _svgG.appendChild(g);

    if (p.tipo === 'l1') {
      g.addEventListener('click', e => {
        e.stopPropagation();
        if (!_wasDragging) _toggleExpansao(p.nodeId);
      });
    }
  }

  function _wrapText(texto, maxW, fontSize) {
    const maxChars = Math.floor(maxW / (fontSize * 0.56));
    if (!texto || texto.length <= maxChars) return [texto];
    const metade = Math.ceil(texto.length / 2);
    let quebra   = texto.lastIndexOf(' ', metade + 4);
    if (quebra < 2) quebra = texto.indexOf(' ');
    if (quebra < 2) quebra = maxChars;
    return [texto.slice(0, quebra).trim(), texto.slice(quebra).trim()];
  }

  // ══════════════════════════════════════════════════════════════════════
  // INTERAÇÃO
  // ══════════════════════════════════════════════════════════════════════
  function _toggleExpansao(nodeId) {
    if (_expanded.has(nodeId)) _expanded.delete(nodeId);
    else _expanded.add(nodeId);
    _renderizarGrafo();
    _applyTransform();
  }

  function _centralizarVista(animado = false) {
    const wrap = document.getElementById('rs-mm-canvas-wrap');
    if (!wrap || !_layout) return;
    const wW = wrap.clientWidth;
    const wH = wrap.clientHeight;
    const sx = (wW - 32) / _layout.canvasW;
    const sy = (wH - 32) / _layout.canvasH;
    const scale = Math.min(sx, sy, 1);

    _tf = {
      x: (wW - _layout.canvasW * scale) / 2,
      y: (wH - _layout.canvasH * scale) / 2,
      scale,
    };
    _applyTransform(animado);
  }

  function _applyTransform(animado = false) {
    if (!_svgG) return;
    if (animado) {
      _svgG.style.transition = 'transform 0.35s cubic-bezier(0.16,1,0.3,1)';
      setTimeout(() => { if (_svgG) _svgG.style.transition = ''; }, 380);
    } else {
      _svgG.style.transition = 'none';
    }
    _svgG.style.transformOrigin = '0 0';
    _svgG.style.transform = `translate(${_tf.x}px,${_tf.y}px) scale(${_tf.scale})`;
  }

  function _setupInteracao() {
    if (!_svgEl) return;
    let isDragging = false, lastX = 0, lastY = 0, dragDist = 0;
    let pinchDist0 = null, pinchScale0 = 1;

    _svgEl.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      isDragging = true; dragDist = 0; _wasDragging = false;
      lastX = e.clientX; lastY = e.clientY;
      _svgEl.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      dragDist += Math.abs(dx) + Math.abs(dy);
      if (dragDist > 4) _wasDragging = true;
      _tf.x += dx; _tf.y += dy;
      lastX = e.clientX; lastY = e.clientY;
      _applyTransform();
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
      if (_svgEl) _svgEl.style.cursor = 'grab';
      setTimeout(() => { _wasDragging = false; }, 50);
    });

    _svgEl.addEventListener('wheel', e => {
      e.preventDefault();
      const fator = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, _tf.scale * fator));
      const rect = _svgEl.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      _tf.x = mx - (mx - _tf.x) * (newScale / _tf.scale);
      _tf.y = my - (my - _tf.y) * (newScale / _tf.scale);
      _tf.scale = newScale;
      _applyTransform();
    }, { passive: false });

    // Touch
    _svgEl.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        dragDist = 0; _wasDragging = false;
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
        pinchDist0 = null;
      } else if (e.touches.length === 2) {
        pinchDist0 = _pinchDist(e.touches);
        pinchScale0 = _tf.scale;
      }
    }, { passive: true });

    _svgEl.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 1 && pinchDist0 === null) {
        const dx = e.touches[0].clientX - lastX;
        const dy = e.touches[0].clientY - lastY;
        dragDist += Math.abs(dx) + Math.abs(dy);
        if (dragDist > 6) _wasDragging = true;
        _tf.x += dx; _tf.y += dy;
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
        _applyTransform();
      } else if (e.touches.length === 2 && pinchDist0 !== null) {
        const dist = _pinchDist(e.touches);
        _tf.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchScale0 * (dist / pinchDist0)));
        _applyTransform();
      }
    }, { passive: false });

    _svgEl.addEventListener('touchend', e => {
      if (e.touches.length < 2) pinchDist0 = null;
      setTimeout(() => { _wasDragging = false; }, 50);
    });
  }

  function _pinchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ══════════════════════════════════════════════════════════════════════
  // HELPERS & CSS
  // ══════════════════════════════════════════════════════════════════════
  function svgEl(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  function _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _injetarCSS() {
    if (document.getElementById('rs-mm-style')) return;
    const s = document.createElement('style');
    s.id = 'rs-mm-style';
    s.textContent = `
      .rs-mm-card { display:flex; align-items:center; gap:14px; background:var(--rs-card2,#162032); border:1px solid rgba(10,61,98,0.55); border-radius:12px; padding:16px 18px; margin:12px 0; animation:rsFadeIn 0.35s ease; }
      .rs-mm-card-icone { font-size:30px; flex-shrink:0; line-height:1; }
      .rs-mm-card-info { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
      .rs-mm-card-label { font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:#60A5FA; }
      .rs-mm-card-titulo { font-size:14px; color:var(--rs-text,#f1f5f9); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .rs-mm-card-btn { background:var(--azul,#0A3D62); color:#fff; border:none; padding:9px 16px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; flex-shrink:0; transition:background .2s, transform .15s; }
      .rs-mm-card-btn:hover { background:#0d4f7c; transform:translateY(-1px); }
      .rs-mm-overlay { position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.88); display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px); }
      .rs-mm-modal { background:#0f1729; width:100vw; height:100vh; display:flex; flex-direction:column; animation:rsFadeIn 0.2s ease; }
      .rs-mm-header { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; flex-shrink:0; border-bottom:1px solid rgba(255,255,255,0.07); background:#111d30; }
      .rs-mm-header-esq { display:flex; align-items:center; gap:10px; min-width:0; }
      .rs-mm-header-dir { display:flex; align-items:center; gap:6px; flex-shrink:0; }
      .rs-mm-badge { background:rgba(10,61,98,0.6); color:#60A5FA; font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; padding:3px 8px; border-radius:20px; flex-shrink:0; }
      .rs-mm-titulo-header { font-size:13px; font-weight:500; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #rs-mm-btn-reset, #rs-mm-btn-fechar, #rs-mm-btn-expandir { background:rgba(255,255,255,0.06); border:none; color:#94a3b8; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:15px; transition:background .2s, color .2s; }
      #rs-mm-btn-expandir { font-size:18px; }
      #rs-mm-btn-reset { font-size:20px; }
      #rs-mm-btn-reset:hover, #rs-mm-btn-fechar:hover, #rs-mm-btn-expandir:hover { background:rgba(255,255,255,0.12); color:#f1f5f9; }
      .rs-mm-canvas-wrap { flex:1; overflow:hidden; position:relative; }
      #rs-mm-svg { width:100%; height:100%; display:block; cursor:grab; user-select:none; -webkit-user-select:none; touch-action:none; }
      #rs-mm-svg:active { cursor:grabbing; }
      #rs-mm-g { will-change:transform; }
      .rs-mm-curve { transition:opacity .25s; }
      .rs-mm-hint { padding:7px 16px; flex-shrink:0; display:flex; justify-content:center; align-items:center; gap:8px; font-size:11px; color:#334155; border-top:1px solid rgba(255,255,255,0.05); background:#111d30; }
      .rs-mm-sep { opacity:.4; }
      @media (max-width:480px) { .rs-mm-card { flex-wrap:wrap; } .rs-mm-card-btn { width:100%; text-align:center; } .rs-mm-hint span:not(.rs-mm-sep):not(:first-child), .rs-mm-sep:not(:first-of-type) { display:none; } }
    `;
    document.head.appendChild(s);
  }

  // ══════════════════════════════════════════════════════════════════════
  // EXPORTAÇÃO GLOBAL
  // ══════════════════════════════════════════════════════════════════════
  window.MapaMentalManager = {
    init,
    _getLayout:   () => _layout,
    _getExpanded: () => _expanded,
    _getDados:    () => _dados,
  };
})();