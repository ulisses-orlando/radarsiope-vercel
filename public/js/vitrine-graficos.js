/* ==========================================================================
   vitrine-graficos.js — Radar SIOPE
   Renderiza a vitrine dinâmica de indicadores configurada por edição.

   Depende de:
     window.supabase          → supabase-browser.js
     window.SupabaseMunicipio → supabase-municipio.js

   Adiciona ao SupabaseMunicipio:
     renderVitrine(container, vitrine, cod_municipio, blur)

   Integração em verNewsletterComToken.js:
     1. Adicionar parâmetro newsletter em renderMunicipio:
           async function renderMunicipio(destinatario, acesso, newsletter)
     2. No final de renderMunicipio, antes do catch:
           await _renderVitrineNewsletter(newsletter, cod, acesso.blurMunicipio);
     3. Nas duas chamadas existentes passar newsletter:
           renderMunicipio(destinatario, acesso, newsletter);

   Ver comentários "INTEGRAÇÃO" ao longo do arquivo.
   ========================================================================== */

'use strict';

// =============================================================================
// HELPERS INTERNOS
// =============================================================================

function _sbVG() {
  if (!window.supabase) throw new Error('[VG] window.supabase não disponível.');
  return window.supabase;
}

function _fmtValorVG(valor, unidade) {
  if (valor == null) return '—';
  if (unidade === 'percentual') return `${Number(valor).toFixed(1)}%`;
  if (unidade === 'valor_brl')  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
  return String(valor);
}

function _escVG(s) {
  return String(s || '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

// =============================================================================
// QUERY — Série histórica de múltiplos indicadores em uma chamada
// =============================================================================

/**
 * Retorna:
 * {
 *   "1.1": [ { ano: 2020, valor: 26.3 }, { ano: 2021, valor: 27.1 }, ... ],
 *   "4.8": [ { ano: 2020, valor: 3820.00 }, ... ]
 * }
 */
async function _getSeriesVitrine(cod_municipio, codIndicadores) {
  if (!cod_municipio || !codIndicadores?.length) return {};

  try {
    const { data, error } = await _sbVG()
      .from('municipio_indicadores')
      .select('cod_indicador, ano, valor')
      .eq('cod_municipio', String(cod_municipio))
      .in('cod_indicador', codIndicadores)
      .eq('bimestre', 6)                          // apenas 6º bimestre (dado anual fechado)
      .order('ano', { ascending: true });

    if (error) { console.warn('[VG] getSeriesVitrine:', error.message); return {}; }

    // Agrupa por cod_indicador
    const mapa = {};
    for (const row of (data || [])) {
      if (!mapa[row.cod_indicador]) mapa[row.cod_indicador] = [];
      mapa[row.cod_indicador].push({ ano: row.ano, valor: row.valor });
    }
    return mapa;

  } catch (e) { console.warn('[VG] getSeriesVitrine:', e.message); return {}; }
}

// =============================================================================
// SVG — GRÁFICO DE LINHA (multi-série)
// =============================================================================

function _svgLinha(series, unidade) {
  /*
   * series = [
   *   { nome, cor, pontos: [{ ano, valor }] }
   * ]
   */
  const W = 560, H = 220, PAD = 44, BOT = 40, LEG = series.length * 20 + 8;
  const chartW = W - PAD * 2;
  const chartH = H - PAD - BOT - LEG;

  // Coleta todos os anos e valores
  const anosSet = new Set();
  series.forEach(s => s.pontos.forEach(p => anosSet.add(p.ano)));
  const anos = [...anosSet].sort();
  if (anos.length < 2) return _svgSemDados('Dados insuficientes para série histórica');

  const allVals = series.flatMap(s => s.pontos.map(p => p.valor).filter(v => v != null));
  const minV = Math.min(...allVals) * 0.85;
  const maxV = Math.max(...allVals) * 1.1 || 1;
  const range = maxV - minV || 1;

  const stepX = chartW / (anos.length - 1);
  const scaleY = v => chartH - ((v - minV) / range) * chartH;

  // Grade horizontal (4 linhas)
  const gridLines = Array.from({ length: 4 }, (_, i) => {
    const v = minV + (range / 3) * i;
    const y = PAD + scaleY(v);
    return `
      <line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}"
            stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3"/>
      <text x="${PAD - 4}" y="${y + 4}" text-anchor="end" font-size="10" fill="#94a3b8">
        ${_fmtValorVG(v, unidade)}
      </text>`;
  }).join('');

  // Séries
  const seriesSVG = series.map(s => {
    const pts = anos.map(ano => {
      const p = s.pontos.find(p => p.ano === ano);
      return p?.valor ?? null;
    });
    const polyPts = pts
      .map((v, i) => v != null ? `${PAD + i * stepX},${PAD + scaleY(v)}` : null)
      .filter(Boolean).join(' ');

    const dots = pts.map((v, i) => {
      if (v == null) return '';
      const x = PAD + i * stepX;
      const y = PAD + scaleY(v);
      return `
        <circle cx="${x}" cy="${y}" r="4" fill="${s.cor}" stroke="#fff" stroke-width="2"/>
        <text x="${x}" y="${y - 8}" text-anchor="middle" font-size="10" font-weight="700" fill="${s.cor}">
          ${_fmtValorVG(v, unidade)}
        </text>`;
    }).join('');

    return `
      <polyline points="${_escVG(polyPts)}" fill="none" stroke="${s.cor}"
                stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}`;
  }).join('');

  // Labels dos anos
  const labelsAnos = anos.map((ano, i) => {
    const x = PAD + i * stepX;
    const y = PAD + chartH + 16;
    return `<text x="${x}" y="${y}" text-anchor="middle" font-size="11" font-weight="600" fill="#475569">${ano}</text>`;
  }).join('');

  // Legenda
  const legendY = PAD + chartH + 30;
  const legendSVG = series.map((s, i) => {
    const x = PAD + i * 180;
    return `
      <line x1="${x}" y1="${legendY + i * 20}" x2="${x + 18}" y2="${legendY + i * 20}"
            stroke="${s.cor}" stroke-width="2.5"/>
      <circle cx="${x + 9}" cy="${legendY + i * 20}" r="3" fill="${s.cor}"/>
      <text x="${x + 24}" y="${legendY + i * 20 + 4}" font-size="11" fill="#475569">
        ${_escVG(s.nome)}
      </text>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${W} ${H + LEG}" style="width:100%;height:auto;max-width:${W}px">
      <!-- Eixos -->
      <line x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${PAD + chartH}"
            stroke="#cbd5e1" stroke-width="1.5"/>
      <line x1="${PAD}" y1="${PAD + chartH}" x2="${W - PAD}" y2="${PAD + chartH}"
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
  const W = 560, H = 220, PAD = 48, BOT = 40, LEG = series.length * 20 + 8;
  const chartW = W - PAD * 2;
  const chartH = H - PAD - BOT - LEG;

  const anosSet = new Set();
  series.forEach(s => s.pontos.forEach(p => anosSet.add(p.ano)));
  const anos = [...anosSet].sort();
  if (!anos.length) return _svgSemDados('Sem dados disponíveis');

  const allVals = series.flatMap(s => s.pontos.map(p => p.valor).filter(v => v != null && v >= 0));
  const maxV = Math.max(...allVals, 1) * 1.12;

  const grupoW = chartW / anos.length;
  const barW   = Math.min(32, (grupoW * 0.8) / series.length);
  const scaleY = v => (v / maxV) * chartH;

  // Grade
  const gridLines = Array.from({ length: 4 }, (_, i) => {
    const v = (maxV / 3) * i;
    const y = PAD + chartH - scaleY(v);
    return `
      <line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}"
            stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3"/>
      <text x="${PAD - 4}" y="${y + 4}" text-anchor="end" font-size="10" fill="#94a3b8">
        ${_fmtValorVG(v, unidade)}
      </text>`;
  }).join('');

  // Barras
  const barrasSVG = anos.map((ano, ai) => {
    const grupoX = PAD + ai * grupoW + grupoW / 2;
    const offsetBase = -(series.length * barW) / 2;
    return series.map((s, si) => {
      const p = s.pontos.find(p => p.ano === ano);
      const v = p?.valor ?? null;
      if (v == null || v < 0) return '';
      const bH = Math.max(scaleY(v), 2);
      const x  = grupoX + offsetBase + si * barW;
      const y  = PAD + chartH - bH;
      return `
        <rect x="${x}" y="${y}" width="${barW - 2}" height="${bH}"
              fill="${s.cor}" rx="2" opacity="0.9"/>
        <text x="${x + (barW - 2) / 2}" y="${y - 4}" text-anchor="middle"
              font-size="9" font-weight="700" fill="${s.cor}">
          ${_fmtValorVG(v, unidade)}
        </text>`;
    }).join('');
  }).join('');

  // Labels anos
  const labelsAnos = anos.map((ano, i) => {
    const x = PAD + i * grupoW + grupoW / 2;
    return `<text x="${x}" y="${PAD + chartH + 16}" text-anchor="middle"
                  font-size="11" font-weight="600" fill="#475569">${ano}</text>`;
  }).join('');

  // Legenda
  const legendY = PAD + chartH + 30;
  const legendSVG = series.map((s, i) => {
    const x = PAD + i * 180;
    return `
      <rect x="${x}" y="${legendY + i * 20 - 9}" width="14" height="10"
            fill="${s.cor}" rx="2"/>
      <text x="${x + 20}" y="${legendY + i * 20}" font-size="11" fill="#475569">
        ${_escVG(s.nome)}
      </text>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${W} ${H + LEG}" style="width:100%;height:auto;max-width:${W}px">
      <line x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${PAD + chartH}"
            stroke="#cbd5e1" stroke-width="1.5"/>
      <line x1="${PAD}" y1="${PAD + chartH}" x2="${W - PAD}" y2="${PAD + chartH}"
            stroke="#cbd5e1" stroke-width="1.5"/>
      ${gridLines}
      ${barrasSVG}
      ${labelsAnos}
      ${legendSVG}
    </svg>`;
}

// =============================================================================
// SVG — GRÁFICO DE PIZZA (donut — valor único, mais recente)
// =============================================================================

function _svgPizza(nome, valor, unidade, cor) {
  if (valor == null) return _svgSemDados('Sem dado disponível');

  const R = 70, CX = 100, CY = 100, stroke = 22;

  // Para percentuais: arc proporcional. Para valores: gauge simples 0-100% do máximo estimado.
  let pct = 0;
  let labelCenter = _fmtValorVG(valor, unidade);

  if (unidade === 'percentual') {
    pct = Math.min(Math.max(Number(valor), 0), 100) / 100;
  } else {
    // Para BRL: exibe donut sempre cheio (contexto) + valor no centro
    pct = 0.75; // representação visual simbólica
  }

  const circ  = 2 * Math.PI * R;
  const dash  = pct * circ;
  const gap   = circ - dash;
  const rot   = -90; // começa no topo

  return `
    <svg viewBox="0 0 200 200" style="width:160px;height:160px;flex-shrink:0">
      <!-- Trilha -->
      <circle cx="${CX}" cy="${CY}" r="${R}"
              fill="none" stroke="#e2e8f0" stroke-width="${stroke}"/>
      <!-- Arco preenchido -->
      <circle cx="${CX}" cy="${CY}" r="${R}"
              fill="none" stroke="${cor}" stroke-width="${stroke}"
              stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
              stroke-linecap="round"
              transform="rotate(${rot} ${CX} ${CY})"/>
      <!-- Valor central -->
      <text x="${CX}" y="${CY - 6}" text-anchor="middle"
            font-size="18" font-weight="800" fill="${cor}">
        ${_escVG(labelCenter)}
      </text>
      <!-- Nome -->
      <text x="${CX}" y="${CY + 14}" text-anchor="middle"
            font-size="10" fill="#64748b" font-weight="500">
        ${_escVG(nome.length > 20 ? nome.slice(0, 18) + '…' : nome)}
      </text>
    </svg>`;
}

// =============================================================================
// SVG — Placeholder sem dados
// =============================================================================

function _svgSemDados(msg = 'Sem dados disponíveis') {
  return `
    <div style="text-align:center;padding:24px;color:#94a3b8;font-size:13px">
      📊 ${_escVG(msg)}
    </div>`;
}

// =============================================================================
// RENDER DE UM CARD DE GRÁFICO
// =============================================================================

/**
 * Monta um card completo para um grupo (ou indicador solo).
 * config = { items: [...vitrine], series: { cod: [ {ano, valor} ] }, destaque: bool }
 */
function _renderCardGrafico(config) {
  const { items, series, destaque } = config;
  const tipo   = items[0].tipo_grafico;
  const unidade = items[0].unidade;

  // Monta array de séries para os renderers
  const seriesData = items.map(item => ({
    nome  : item.label || item.nome,
    cor   : item.cor   || '#667eea',
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
    // Pizza: mostra o valor mais recente de cada indicador
    const pizzas = seriesData.map(s => {
      const ultimo = s.pontos[s.pontos.length - 1];
      return _svgPizza(s.nome, ultimo?.valor ?? null, unidade, s.cor);
    }).join('');
    svgHtml = `<div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center">${pizzas}</div>`;
  } else {
    svgHtml = _svgSemDados(`Tipo "${tipo}" não reconhecido`);
  }

  // Título do card: agrupa nomes dos indicadores
  const tituloCard = items.map(i => i.label || i.nome).join(' + ');

  // Tag de unidade
  const tagUnidade = unidade === 'percentual' ? '📊 Percentual' : '💰 Valor';
  const tagColor   = unidade === 'percentual' ? '#667eea' : '#16a34a';

  return `
    <div style="
      background: var(--bg-page, #fff);
      border: 1px solid ${destaque ? '#667eea' : '#e2e8f0'};
      border-radius: 12px;
      padding: 16px;
      ${destaque ? 'border-left: 3px solid #667eea;' : ''}
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px">
        <div style="font-size:13px;font-weight:700;color:var(--texto,#1e293b);line-height:1.3">
          ${destaque ? '⭐ ' : ''}${_escVG(tituloCard)}
        </div>
        <span style="
          font-size:10px;color:${tagColor};background:${tagColor}18;
          padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0
        ">${tagUnidade}</span>
      </div>
      ${svgHtml}
    </div>`;
}

// =============================================================================
// RENDER PRINCIPAL DA VITRINE
// =============================================================================

/**
 * renderVitrine(container, vitrine, cod_municipio, blur)
 *
 * container    → elemento DOM onde renderizar
 * vitrine      → array de config (newsletter.vitrine do Firestore)
 * cod_municipio→ código IBGE do assinante
 * blur         → true para leads sem acesso (oculta dados)
 */
async function renderVitrine(container, vitrine, cod_municipio, blur) {
  if (!container) return;
  if (!vitrine?.length) { container.innerHTML = ''; return; }

  // Skeleton enquanto carrega
  container.innerHTML = `
    <div style="margin-top:20px">
      <div style="height:12px;background:#f1f5f9;border-radius:6px;width:40%;margin-bottom:16px"></div>
      <div style="height:180px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0"></div>
    </div>`;

  try {
    // 1. Coleta todos os cod_indicador únicos
    const codigos = [...new Set(vitrine.map(i => i.cod_indicador))];

    // 2. Busca série histórica de todos em uma chamada
    const series = cod_municipio && !blur
      ? await _getSeriesVitrine(String(cod_municipio), codigos)
      : {};

    // 3. Agrupa itens por grupo
    //    Solo: grupo null/nenhum → cada item = card independente
    //    Grupos: items com mesmo grupo → card compartilhado
    const grupos = {};
    const solos  = [];

    vitrine.forEach(item => {
      const g = item.grupo;
      if (!g || g === 'nenhum') {
        solos.push([item]);
      } else {
        if (!grupos[g]) grupos[g] = [];
        grupos[g].push(item);
      }
    });

    const blocos = [
      ...solos,
      ...Object.values(grupos),
    ];

    // 4. Separa destaque do resto
    const temDestaque = blocos.some(b => b.some(i => i.destaque));
    const blocosOrdenados = temDestaque
      ? [
          ...blocos.filter(b => b.some(i => i.destaque)),
          ...blocos.filter(b => !b.some(i => i.destaque)),
        ]
      : blocos;

    // 5. Monta HTML
    const blurOverlay = blur ? `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;
        align-items:center;justify-content:center;gap:10px;
        background:rgba(255,255,255,.75);border-radius:12px;
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

    // Grid: destaque em largura total, demais em 2 colunas
    const cardsHtml = blocosOrdenados.map((bloco, idx) => {
      const isDestaque = bloco.some(i => i.destaque);
      const card = _renderCardGrafico({ items: bloco, series, destaque: isDestaque });
      return isDestaque
        ? `<div style="grid-column:1/-1">${card}</div>`
        : card;
    }).join('');

    container.innerHTML = `
      <div style="margin-top:24px;padding-top:18px;border-top:2px solid #667eea22">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;
                    letter-spacing:.6px;color:#667eea;margin-bottom:14px">
          📈 Indicadores desta edição
        </div>
        <div style="position:relative">
          ${blurOverlay}
          <div style="
            display:grid;
            grid-template-columns:repeat(auto-fit,minmax(260px,1fr));
            gap:14px;
            ${blur ? 'filter:blur(4px);user-select:none;pointer-events:none' : ''}
          ">
            ${cardsHtml}
          </div>
        </div>
      </div>`;

  } catch (err) {
    console.warn('[VG] renderVitrine falhou (não fatal):', err);
    container.innerHTML = '';
  }
}

// =============================================================================
// INTEGRAÇÃO COM verNewsletterComToken.js
// =============================================================================

/**
 * _renderVitrineNewsletter
 *
 * Função auxiliar chamada dentro de renderMunicipio().
 * Busca a vitrine do Firestore via newsletter (já carregada) e renderiza.
 *
 * COMO USAR em verNewsletterComToken.js:
 *
 *   1. Altere a assinatura de renderMunicipio na linha 288:
 *        DE: async function renderMunicipio(destinatario, acesso)
 *        PARA: async function renderMunicipio(destinatario, acesso, newsletter)
 *
 *   2. Adicione ao final do bloco try de renderMunicipio, após a linha 327 (btnHistorico):
 *        const vitrineContainer = document.getElementById('municipio-vitrine');
 *        if (vitrineContainer && newsletter?.vitrine?.length) {
 *          await window.SupabaseMunicipio.renderVitrine(
 *            vitrineContainer, newsletter.vitrine, cod, acesso.blurMunicipio
 *          );
 *        }
 *
 *   3. Na linha 960 (fluxo principal):
 *        DE: renderMunicipio(destinatario, acesso);
 *        PARA: renderMunicipio(destinatario, acesso, newsletter);
 *
 *   4. Na linha 1775 (fluxo do drawer):
 *        DE: renderMunicipio(destinatario, acesso);
 *        PARA: renderMunicipio(destinatario, acesso, newsletter);
 *
 *   5. No HTML do app (verNewsletterComToken.html), dentro da seção do município,
 *      após o bloco existente (municipio-resumo / municipio-historico), adicione:
 *        <div id="municipio-vitrine"></div>
 */

// =============================================================================
// REGISTRO NA API PÚBLICA — estende SupabaseMunicipio
// =============================================================================

// Aguarda SupabaseMunicipio estar disponível e injeta renderVitrine
(function _registrar() {
  function _inject() {
    if (!window.SupabaseMunicipio) return false;
    window.SupabaseMunicipio.renderVitrine = renderVitrine;
    return true;
  }

  if (_inject()) return;

  // Retry se o script carregar antes de supabase-municipio.js
  let n = 0;
  const t = setInterval(() => {
    if (_inject() || ++n > 50) clearInterval(t);
  }, 100);
})();
