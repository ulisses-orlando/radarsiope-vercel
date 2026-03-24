/* ==========================================================================
   vitrine-graficos.js — Radar SIOPE  (v2)
   Renderiza a vitrine dinâmica de indicadores configurada por edição.

   Depende de:
     window.supabase          → supabase-browser.js
     window.SupabaseMunicipio → supabase-municipio.js

   Injeta em SupabaseMunicipio:
     renderVitrine(container, vitrine, cod_municipio, blur)
   ========================================================================== */

'use strict';

// =============================================================================
// HELPERS
// =============================================================================

function _sbVG() {
  if (!window.supabase) throw new Error('[VG] window.supabase não disponível.');
  return window.supabase;
}

function _fmtVG(valor, unidade) {
  if (valor == null) return '—';
  if (unidade === 'percentual')
    return `${Number(valor).toFixed(1)}%`;
  if (unidade === 'valor_brl')
    return Number(valor).toLocaleString('pt-BR', {
      style: 'currency', currency: 'BRL',
      notation: 'compact', maximumFractionDigits: 1
    });
  return String(valor);
}

function _escVG(s) {
  return String(s || '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

function _truncVG(s, n = 22) {
  return s && s.length > n ? s.slice(0, n - 1) + '…' : (s || '');
}

// =============================================================================
// QUERY — série histórica de múltiplos indicadores (bimestre 6 = anual)
// =============================================================================

async function _getSeriesVitrine(cod_municipio, codIndicadores) {
  if (!cod_municipio || !codIndicadores?.length) return {};
  try {
    const { data, error } = await _sbVG()
      .from('municipio_indicadores')
      .select('cod_indicador, ano, valor')
      .eq('cod_municipio', String(cod_municipio))
      .in('cod_indicador', codIndicadores)
      .eq('bimestre', 6)
      .order('ano', { ascending: true });

    if (error) { console.warn('[VG] query:', error.message); return {}; }

    const mapa = {};
    for (const row of (data || [])) {
      if (!mapa[row.cod_indicador]) mapa[row.cod_indicador] = [];
      mapa[row.cod_indicador].push({ ano: row.ano, valor: row.valor });
    }
    return mapa;
  } catch (e) { console.warn('[VG] query ex:', e.message); return {}; }
}

// =============================================================================
// DIMENSÕES BASE DOS GRÁFICOS SVG
// =============================================================================

const _W      = 560;   // largura viewBox
const _H_CH   = 200;   // altura área do gráfico
const _PX     = 52;    // padding lateral (eixo Y + rótulos)
const _PT     = 20;    // padding topo
const _PB     = 30;    // padding base (eixo X + anos)
const _LEG_H  = 24;    // altura por linha de legenda

// =============================================================================
// SVG — GRÁFICO DE LINHA (multi-série)
// Legenda: uma linha por série, empilhada verticalmente, alinhada à esquerda
// =============================================================================

function _svgLinha(series, unidade) {
  if (!series.length) return _svgSemDados();

  const legH   = series.length * _LEG_H + 6;
  const chartH = _H_CH - _PT - _PB;
  const totalH = _H_CH + legH;
  const chartW = _W - _PX * 2;

  const anosSet = new Set();
  series.forEach(s => s.pontos.forEach(p => anosSet.add(p.ano)));
  const anos = [...anosSet].sort();
  if (anos.length < 2) return _svgSemDados('Dados insuficientes para série histórica');

  const allVals = series.flatMap(s => s.pontos.map(p => p.valor).filter(v => v != null));
  const minV    = Math.min(...allVals) * 0.88;
  const maxV    = Math.max(...allVals) * 1.10 || 1;
  const range   = maxV - minV || 1;
  const stepX   = chartW / (Math.max(anos.length - 1, 1));
  const scaleY  = v => chartH - ((v - minV) / range) * chartH;

  // Grade horizontal
  const gridLines = Array.from({ length: 3 }, (_, i) => {
    const v = minV + (range / 2) * i;
    const y = (_PT + scaleY(v)).toFixed(1);
    return `
      <line x1="${_PX}" y1="${y}" x2="${_W - _PX}" y2="${y}"
            stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3"/>
      <text x="${_PX - 5}" y="${(parseFloat(y) + 4).toFixed(1)}" text-anchor="end"
            font-size="10" fill="#94a3b8">${_fmtVG(v, unidade)}</text>`;
  }).join('');

  // Séries (linhas + pontos + rótulos)
  const seriesSVG = series.map(s => {
    const pts = anos.map(ano => {
      const p = s.pontos.find(p => p.ano === ano);
      return p?.valor ?? null;
    });

    const polyPts = pts
      .map((v, i) => v != null
        ? `${(_PX + i * stepX).toFixed(1)},${(_PT + scaleY(v)).toFixed(1)}`
        : null)
      .filter(Boolean).join(' ');

    const dots = pts.map((v, i) => {
      if (v == null) return '';
      const cx = (_PX + i * stepX).toFixed(1);
      const cy = (_PT + scaleY(v)).toFixed(1);
      return `
        <circle cx="${cx}" cy="${cy}" r="4" fill="${s.cor}" stroke="#fff" stroke-width="2"/>
        <text x="${cx}" y="${(parseFloat(cy) - 8).toFixed(1)}" text-anchor="middle"
              font-size="10" font-weight="700" fill="${s.cor}">
          ${_fmtVG(v, unidade)}
        </text>`;
    }).join('');

    return `
      <polyline points="${_escVG(polyPts)}" fill="none" stroke="${s.cor}"
                stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}`;
  }).join('');

  // Labels anos (eixo X)
  const labelsAnos = anos.map((ano, i) => {
    const x = (_PX + i * stepX).toFixed(1);
    const y = (_PT + chartH + _PB - 6).toFixed(1);
    return `<text x="${x}" y="${y}" text-anchor="middle"
                  font-size="11" font-weight="600" fill="#475569">${ano}</text>`;
  }).join('');

  // Legenda empilhada verticalmente
  const legY0 = _PT + chartH + _PB + 6;
  const legendSVG = series.map((s, i) => {
    const y = legY0 + i * _LEG_H;
    return `
      <line x1="${_PX}" y1="${y}" x2="${_PX + 20}" y2="${y}"
            stroke="${s.cor}" stroke-width="2.5"/>
      <circle cx="${_PX + 10}" cy="${y}" r="3.5" fill="${s.cor}"/>
      <text x="${_PX + 28}" y="${y + 4}" font-size="11" fill="#475569">
        ${_escVG(_truncVG(s.nome, 60))}
      </text>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${_W} ${totalH}" style="width:100%;height:auto">
      <line x1="${_PX}" y1="${_PT}" x2="${_PX}" y2="${_PT + chartH}"
            stroke="#cbd5e1" stroke-width="1.5"/>
      <line x1="${_PX}" y1="${_PT + chartH}" x2="${_W - _PX}" y2="${_PT + chartH}"
            stroke="#cbd5e1" stroke-width="1.5"/>
      ${gridLines}
      ${seriesSVG}
      ${labelsAnos}
      ${legendSVG}
    </svg>`;
}

// =============================================================================
// SVG — GRÁFICO DE BARRA (multi-série)
// =============================================================================

function _svgBarra(series, unidade) {
  if (!series.length) return _svgSemDados();

  const legH   = series.length * _LEG_H + 6;
  const chartH = _H_CH - _PT - _PB;
  const totalH = _H_CH + legH;
  const chartW = _W - _PX * 2;

  const anosSet = new Set();
  series.forEach(s => s.pontos.forEach(p => anosSet.add(p.ano)));
  const anos = [...anosSet].sort();
  if (!anos.length) return _svgSemDados();

  const allVals = series.flatMap(s => s.pontos.map(p => p.valor).filter(v => v != null && v >= 0));
  const maxV  = Math.max(...allVals, 1) * 1.12;
  const scaleY = v => Math.max((v / maxV) * chartH, 2);

  const grupoW = chartW / anos.length;
  const nS     = series.length;
  // Largura mínima de 10px por barra para não sumir
  const barW   = Math.max(Math.min(38, (grupoW * 0.78) / nS), 10);

  // Grade
  const gridLines = Array.from({ length: 3 }, (_, i) => {
    const v = (maxV / 2) * i;
    const y = (_PT + chartH - scaleY(v)).toFixed(1);
    return `
      <line x1="${_PX}" y1="${y}" x2="${_W - _PX}" y2="${y}"
            stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3"/>
      <text x="${_PX - 5}" y="${(parseFloat(y) + 4).toFixed(1)}" text-anchor="end"
            font-size="10" fill="#94a3b8">${_fmtVG(v, unidade)}</text>`;
  }).join('');

  // Barras
  const barrasSVG = anos.map((ano, ai) => {
    const mid    = _PX + ai * grupoW + grupoW / 2;
    const blocoW = nS * barW;
    return series.map((s, si) => {
      const p = s.pontos.find(p => p.ano === ano);
      const v = p?.valor ?? null;
      if (v == null || v < 0) return '';
      const bH = scaleY(v);
      const x  = (mid - blocoW / 2 + si * barW).toFixed(1);
      const y  = (_PT + chartH - bH).toFixed(1);
      const bw = (barW - 2).toFixed(1);
      return `
        <rect x="${x}" y="${y}" width="${bw}" height="${bH.toFixed(1)}"
              fill="${s.cor}" rx="2" opacity="0.88"/>
        <text x="${(parseFloat(x) + parseFloat(bw) / 2).toFixed(1)}"
              y="${(parseFloat(y) - 4).toFixed(1)}"
              text-anchor="middle" font-size="9" font-weight="700" fill="${s.cor}">
          ${_fmtVG(v, unidade)}
        </text>`;
    }).join('');
  }).join('');

  // Labels anos
  const labelsAnos = anos.map((ano, i) => {
    const x = (_PX + i * grupoW + grupoW / 2).toFixed(1);
    const y = (_PT + chartH + _PB - 6).toFixed(1);
    return `<text x="${x}" y="${y}" text-anchor="middle"
                  font-size="11" font-weight="600" fill="#475569">${ano}</text>`;
  }).join('');

  // Legenda empilhada
  const legY0 = _PT + chartH + _PB + 6;
  const legendSVG = series.map((s, i) => {
    const y = legY0 + i * _LEG_H;
    return `
      <rect x="${_PX}" y="${y - 9}" width="14" height="10" fill="${s.cor}" rx="2"/>
      <text x="${_PX + 20}" y="${y}" font-size="11" fill="#475569">
        ${_escVG(_truncVG(s.nome, 60))}
      </text>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${_W} ${totalH}" style="width:100%;height:auto">
      <line x1="${_PX}" y1="${_PT}" x2="${_PX}" y2="${_PT + chartH}"
            stroke="#cbd5e1" stroke-width="1.5"/>
      <line x1="${_PX}" y1="${_PT + chartH}" x2="${_W - _PX}" y2="${_PT + chartH}"
            stroke="#cbd5e1" stroke-width="1.5"/>
      ${gridLines}
      ${barrasSVG}
      ${labelsAnos}
      ${legendSVG}
    </svg>`;
}

// =============================================================================
// SVG — PIZZA / DONUT (valor mais recente)
// =============================================================================

function _svgPizza(nome, valor, unidade, cor) {
  if (valor == null) return _svgSemDados('Sem dado disponível');
  const R = 65, CX = 100, CY = 100, stroke = 20;
  const pct  = unidade === 'percentual'
    ? Math.min(Math.max(Number(valor), 0), 100) / 100
    : 0.75;
  const circ = 2 * Math.PI * R;
  const dash = pct * circ;
  const gap  = circ - dash;

  return `
    <svg viewBox="0 0 200 200" style="width:150px;height:150px;flex-shrink:0">
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="none"
              stroke="#e2e8f0" stroke-width="${stroke}"/>
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="none"
              stroke="${cor}" stroke-width="${stroke}"
              stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
              stroke-linecap="round"
              transform="rotate(-90 ${CX} ${CY})"/>
      <text x="${CX}" y="${CY - 5}" text-anchor="middle"
            font-size="20" font-weight="800" fill="${cor}">
        ${_escVG(_fmtVG(valor, unidade))}
      </text>
      <text x="${CX}" y="${CY + 16}" text-anchor="middle"
            font-size="10" fill="#64748b" font-weight="500">
        ${_escVG(_truncVG(nome, 22))}
      </text>
    </svg>`;
}

// =============================================================================
// Placeholder
// =============================================================================

function _svgSemDados(msg = 'Sem dados disponíveis') {
  return `<div style="text-align:center;padding:24px;color:#94a3b8;font-size:13px">
    📊 ${_escVG(msg)}
  </div>`;
}

// =============================================================================
// RENDER DE UM CARD
// =============================================================================

function _renderCard(config) {
  const { items, series, destaque } = config;
  const tipo    = items[0].tipo_grafico;
  const unidade = items[0].unidade;

  const seriesData = items.map(item => ({
    nome  : item.label || item.nome,
    cor   : item.cor || '#667eea',
    pontos: series[item.cod_indicador] || [],
  })).filter(s => s.pontos.length > 0);

  let svgHtml = '';
  if (!seriesData.length) {
    svgHtml = _svgSemDados();
  } else if (tipo === 'linha') {
    svgHtml = _svgLinha(seriesData, unidade);
  } else if (tipo === 'barra') {
    svgHtml = _svgBarra(seriesData, unidade);
  } else if (tipo === 'pizza') {
    const pizzas = seriesData.map(s => {
      const ultimo = s.pontos[s.pontos.length - 1];
      return _svgPizza(s.nome, ultimo?.valor ?? null, unidade, s.cor);
    }).join('');
    svgHtml = `<div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center">${pizzas}</div>`;
  } else {
    svgHtml = _svgSemDados(`Tipo "${tipo}" não reconhecido`);
  }

  // Título: usa campo `titulo` da vitrine se preenchido — senão sem título
  const tituloCard = items[0].titulo || '';
  const tagUnidade = unidade === 'percentual' ? '📊 Percentual' : '💰 Valor';
  const tagColor   = unidade === 'percentual' ? '#667eea' : '#16a34a';

  return `
    <div style="
      background:var(--bg-page,#fff);
      border:1px solid ${destaque ? '#667eea' : '#e2e8f0'};
      border-radius:12px;
      padding:16px;
      ${destaque ? 'border-left:3px solid #667eea;' : ''}
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;
                  margin-bottom:${tituloCard ? '12px' : '6px'};gap:8px">
        <div style="font-size:13px;font-weight:700;color:var(--texto,#1e293b);line-height:1.3">
          ${destaque && tituloCard ? '⭐ ' : ''}${_escVG(tituloCard)}
        </div>
        <span style="font-size:10px;color:${tagColor};background:${tagColor}18;
                     padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0">
          ${tagUnidade}
        </span>
      </div>
      ${svgHtml}
    </div>`;
}

// =============================================================================
// RENDER PRINCIPAL
// =============================================================================

async function renderVitrine(container, vitrine, cod_municipio, blur) {
  if (!container) return;
  if (!vitrine?.length) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <div style="height:160px;background:#f8fafc;border-radius:12px;
                border:1px solid #e2e8f0;display:flex;align-items:center;
                justify-content:center;color:#94a3b8;font-size:13px">
      ⏳ Carregando indicadores…
    </div>`;

  try {
    const codigos = [...new Set(vitrine.map(i => i.cod_indicador))];
    const series  = (cod_municipio && !blur)
      ? await _getSeriesVitrine(String(cod_municipio), codigos)
      : {};

    // Agrupa por campo "grupo"
    const grupos = {};
    const solos  = [];
    vitrine.forEach(item => {
      const g = item.grupo;
      if (!g || g === 'nenhum') { solos.push([item]); }
      else {
        if (!grupos[g]) grupos[g] = [];
        grupos[g].push(item);
      }
    });

    // Destaque primeiro
    const blocos    = [...solos, ...Object.values(grupos)];
    const ordenados = [
      ...blocos.filter(b => b.some(i => i.destaque)),
      ...blocos.filter(b => !b.some(i => i.destaque)),
    ];

    const blurOverlay = blur ? `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;
        align-items:center;justify-content:center;gap:10px;
        background:rgba(255,255,255,.78);border-radius:12px;
        backdrop-filter:blur(3px);padding:20px;text-align:center;z-index:2">
        <span style="font-size:13px;font-weight:700;color:#0A3D62">
          🔒 Assine para ver os indicadores do seu município
        </span>
        <a href="/assinatura.html"
           style="padding:9px 20px;background:#0A3D62;color:#fff;
                  border-radius:8px;font-size:13px;font-weight:700;
                  text-decoration:none;display:inline-block">
          Ver planos →
        </a>
      </div>` : '';

    // Todos os cards em coluna única — garante largura máxima e boa leitura
    const cardsHtml = ordenados.map(bloco =>
      _renderCard({ items: bloco, series, destaque: bloco.some(i => i.destaque) })
    ).join('');

    container.innerHTML = `
      <div style="position:relative">
        ${blurOverlay}
        <div style="
          display:flex;flex-direction:column;gap:16px;
          ${blur ? 'filter:blur(4px);user-select:none;pointer-events:none' : ''}
        ">
          ${cardsHtml}
        </div>
      </div>`;

  } catch (err) {
    console.warn('[VG] renderVitrine falhou:', err);
    container.innerHTML = '';
  }
}

// =============================================================================
// INJEÇÃO NA API PÚBLICA
// =============================================================================

(function _registrar() {
  function _inject() {
    if (!window.SupabaseMunicipio) return false;
    window.SupabaseMunicipio.renderVitrine = renderVitrine;
    return true;
  }
  if (_inject()) return;
  let n = 0;
  const t = setInterval(() => { if (_inject() || ++n > 60) clearInterval(t); }, 100);
})();
