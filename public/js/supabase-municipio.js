/* ==========================================================================
   supabase-municipio.js — Radar SIOPE  (v3)
   Alinhado com o schema v2:
     • cod_indicador VARCHAR (ex: '1.1', '4.15')
     • vw_municipio_resumo com colunas renomeadas:
         pct_mde_aplicado, pct_fundeb_remuneracao, vlr_exigido_mde,
         vlr_aplicado_mde, invest_aluno_basica, saldo_fundeb, ideb_iniciais ...
   Expõe: window.SupabaseMunicipio
   ========================================================================== */

'use strict';

function _sb() {
  if (!window.supabase) throw new Error('[SM] window.supabase não disponível.');
  return window.supabase;
}

// ── Códigos dos indicadores principais (VARCHAR) ──────────────────────────────
const IND = {
  MDE_APLICADO:         '1.1',
  FUNDEB_REMUNERACAO:   '1.2',
  FUNDEB_OUTRAS_MDE:    '1.3',
  FUNDEB_NAO_APLICADO:  '1.4',
  VAAT_CAPITAL:         '1.5',
  FUNDEB_ETI:           '1.9',
  INVEST_INFANTIL:      '4.1',
  INVEST_FUNDAMENTAL:   '4.2',
  INVEST_BASICA:        '4.8',
  SALDO_FUNDEB:         '7.2',
  FUNDEB_NAO_UTILIZADO: '7.3',
  VLR_EXIGIDO_MDE:      '8.1',
  VLR_APLICADO_MDE:     '8.2',
  IDEB_INICIAIS:        '5.1',
  IDEB_FINAIS:          '5.2',
};

// ── Categorias para agrupamento na tabela detalhada ───────────────────────────
const CATEGORIAS = {
  siope_mde:    { label: 'MDE — Aplicação Mínima',        icon: '📚' },
  siope_fundeb: { label: 'FUNDEB',                        icon: '💰' },
  siope_inep:   { label: 'IDEB e Taxas Escolares',        icon: '🎓' },
  siope:        { label: 'Outros Indicadores SIOPE',      icon: '📊' },
};

// ── Situação → label e cor ────────────────────────────────────────────────────
const SITUACAO_CONFIG = {
  regular:      { label: 'Regular',        icon: '✅', cor: '#16a34a' },
  insuficiente: { label: 'Abaixo do mín.', icon: '⚠️', cor: '#dc2626' },
  nao_enviado:  { label: 'Não enviado',    icon: '📭', cor: '#d97706' },
  retificado:   { label: 'Retificado',     icon: '🔄', cor: '#0891b2' },
  homologado:   { label: 'Homologado',     icon: '🏛️', cor: '#16a34a' },
  em_analise:   { label: 'Em análise',     icon: '🔍', cor: '#7c3aed' },
};

function _sit(s) {
  return SITUACAO_CONFIG[s] || { label: s || '—', icon: '❓', cor: '#94a3b8' };
}
function _fmtBRL(v) {
  return v != null
    ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : null;
}
function _fmtPct(v) {
  return v != null ? `${Number(v).toFixed(2)}%` : null;
}
function _esc(s) {
  return String(s || '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

// =============================================================================
// QUERIES
// =============================================================================

// Resumo do último bimestre disponível (usa vw_municipio_resumo)
async function getResumoMunicipio(cod_municipio) {
  if (!cod_municipio) return null;
  try {
    const { data, error } = await _sb()
      .from('vw_municipio_resumo')
      .select('*')
      .eq('cod_municipio', String(cod_municipio))
      .order('ano',      { ascending: false })
      .order('bimestre', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) { console.warn('[SM] getResumoMunicipio:', error.message); return null; }
    return data;
  } catch (e) { console.warn('[SM] getResumoMunicipio:', e.message); return null; }
}

// Buscar histórico completo de um município (todos os anos disponíveis)
async function getHistoricoCompleto(cod_municipio) {
  if (!cod_municipio) return [];
  try {
    const { data, error } = await _sb()
      .from('vw_municipio_resumo')
      .select('*')
      .eq('cod_municipio', String(cod_municipio))
      .eq('bimestre', 6) // Apenas 6º bimestre (anual)
      .order('ano', { ascending: false }); // Mais recente primeiro
    
    if (error) { 
      console.warn('[SM] getHistoricoCompleto:', error.message); 
      return []; 
    }
    
    return data || [];
  } catch (e) { 
    console.warn('[SM] getHistoricoCompleto:', e.message); 
    return []; 
  }
}

// Calcular variação percentual entre anos
function calcularVariacao(valorAtual, valorAnterior) {
  if (!valorAtual || !valorAnterior) return null;
  const variacao = ((valorAtual - valorAnterior) / valorAnterior) * 100;
  return variacao;
}

// Todos os indicadores de um período específico (com nome e metadados)
async function getIndicadoresPeriodo(cod_municipio, ano, bimestre) {
  if (!cod_municipio) return [];
  try {
    const { data, error } = await _sb()
      .from('municipio_indicadores')
      .select('cod_indicador, valor, indicadores(nome, unidade, categoria, ordem_exibicao)')
      .eq('cod_municipio', String(cod_municipio))
      .eq('ano', ano)
      .eq('bimestre', bimestre)
      .order('cod_indicador', { ascending: true });
    if (error) { console.warn('[SM] getIndicadoresPeriodo:', error.message); return []; }
    return (data || []).map(r => ({
      cod_indicador:  r.cod_indicador,
      valor:          r.valor,
      nome:           r.indicadores?.nome            || '—',
      unidade:        r.indicadores?.unidade         || '',
      categoria:      r.indicadores?.categoria       || 'siope',
      ordem_exibicao: r.indicadores?.ordem_exibicao || 99,
    }));
  } catch (e) { console.warn('[SM] getIndicadoresPeriodo:', e.message); return []; }
}

// Histórico do indicador 1.1 (% MDE) nos últimos N bimestres
async function getHistoricoMDE(cod_municipio, limite = 6) {
  if (!cod_municipio) return [];
  try {
    const { data, error } = await _sb()
      .from('municipio_indicadores')
      .select('ano, bimestre, valor, siope_municipios!inner(situacao)')
      .eq('cod_municipio',  String(cod_municipio))
      .eq('cod_indicador',  IND.MDE_APLICADO)
      .order('ano',      { ascending: false })
      .order('bimestre', { ascending: false })
      .limit(limite);
    if (error) { console.warn('[SM] getHistoricoMDE:', error.message); return []; }
    return (data || []).map(r => ({
      ano:      r.ano,
      bimestre: r.bimestre,
      pct:      r.valor,
      situacao: r.siope_municipios?.situacao || 'nao_enviado',
    }));
  } catch (e) { console.warn('[SM] getHistoricoMDE:', e.message); return []; }
}

// Busca qualquer indicador específico de um município no último bimestre
async function getIndicador(cod_municipio, cod_indicador) {
  if (!cod_municipio || !cod_indicador) return null;
  try {
    const { data, error } = await _sb()
      .from('municipio_indicadores')
      .select('valor, ano, bimestre')
      .eq('cod_municipio', String(cod_municipio))
      .eq('cod_indicador', String(cod_indicador))
      .order('ano',      { ascending: false })
      .order('bimestre', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data;
  } catch (e) { return null; }
}

// =============================================================================
// RENDERIZAÇÃO
// =============================================================================

function renderSkeleton(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="rs-municipio-card">
      <div class="rs-skeleton rs-sk-title"></div>
      <div class="rs-skeleton rs-sk-bar" style="margin:10px 0"></div>
      <div class="rs-skeleton rs-sk-line"></div>
    </div>`;
}

// Seção principal do município (card no topo do web app)
function renderSecaoMunicipio({ container, blur, resumo, nomeMunicipio, uf }) {
  if (!container) return;
  if (!resumo) { container.innerHTML = _htmlSemDados(nomeMunicipio, uf, blur); return; }

  const sit    = _sit(resumo.situacao);
  const pct    = resumo.pct_mde_aplicado;       // coluna da vw_municipio_resumo v2
  const minPct = 25;                             // mínimo constitucional municípios
  const bimRef = resumo.bimestre
    ? `${resumo.bimestre}º bimestre/${resumo.ano}` : '—';

  // Barra visual — escala 0→30%
  const ESCALA = 30;
  const barW   = pct != null ? Math.min(100, (pct / ESCALA) * 100).toFixed(1) : 0;
  const minW   = Math.min(100, (minPct / ESCALA) * 100).toFixed(1);
  const blurSt = blur ? 'filter:blur(5px);user-select:none;pointer-events:none' : '';

  // Valores financeiros
  const vlrExigido  = resumo.vlr_exigido_mde;
  const vlrAplicado = resumo.vlr_aplicado_mde;
  const saldoFundeb = resumo.saldo_fundeb;
  const investAluno = resumo.invest_aluno_basica;

  container.innerHTML = `
    <div class="rs-municipio-card" style="position:relative">

      <!-- Cabeçalho -->
      <div class="rs-mun-header">
        <div>
          <span class="rs-mun-nome">${_esc(nomeMunicipio || '—')}/${_esc(uf || '—')}</span>
          <span class="rs-mun-ref">${_esc(bimRef)}</span>
        </div>
        <span class="rs-mun-status" style="background:${sit.cor}20;color:${sit.cor}">
          ${sit.icon} ${_esc(sit.label)}
        </span>
      </div>

      <!-- Barra MDE -->
      <div style="${blurSt}">
        <div class="rs-mde-label">
          <span>Indicador 1.1 — MDE aplicado</span>
          <strong style="color:${sit.cor}">${_fmtPct(pct) || '—'}</strong>
        </div>
        <div class="rs-mde-track">
          <div class="rs-mde-fill" style="width:${barW}%;background:${sit.cor};transition:width .7s ease"></div>
          <div class="rs-mde-min" style="left:${minW}%" title="Mínimo: ${minPct}%"></div>
        </div>
        <div class="rs-mde-meta">
          <span>0%</span>
          <span style="font-size:10px;color:#94a3b8">Mínimo constitucional: ${minPct}%</span>
          <span>${ESCALA}%+</span>
        </div>

        <!-- Grade financeira -->
        ${(vlrExigido || vlrAplicado || investAluno || saldoFundeb) ? `
        <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${vlrExigido ? _card('Valor exigido MDE', _fmtBRL(vlrExigido)) : ''}
          ${vlrAplicado ? _card('Valor aplicado MDE', _fmtBRL(vlrAplicado), sit.cor) : ''}
          ${investAluno ? _card('Invest./aluno educação básica', _fmtBRL(investAluno)) : ''}
          ${saldoFundeb ? _card('Saldo FUNDEB', _fmtBRL(saldoFundeb)) : ''}
        </div>` : ''}

        <!-- Indicadores FUNDEB -->
        ${resumo.pct_fundeb_remuneracao != null ? `
        <div style="margin-top:10px;padding:8px 10px;background:#f0fdf4;border-radius:8px;
                    font-size:12px;display:flex;justify-content:space-between;align-items:center">
          <span style="color:#166534">💰 FUNDEB remuneração profissionais (1.2)</span>
          <strong style="color:#166534">${_fmtPct(resumo.pct_fundeb_remuneracao)}</strong>
        </div>` : ''}

        ${resumo.ideb_iniciais != null || resumo.ideb_finais != null ? `
        <div style="margin-top:8px;display:flex;gap:8px">
          ${resumo.ideb_iniciais != null ? _card('IDEB Séries Iniciais', Number(resumo.ideb_iniciais).toFixed(1)) : ''}
          ${resumo.ideb_finais   != null ? _card('IDEB Séries Finais',   Number(resumo.ideb_finais).toFixed(1))   : ''}
        </div>` : ''}

        ${resumo.homologado ? `
        <div style="margin-top:8px;font-size:11px;color:#16a34a;font-weight:600">
          🏛️ Dados homologados pela SASE/MEC
        </div>` : ''}
        ${resumo.enviado_no_prazo === false ? `
        <div style="margin-top:4px;font-size:11px;color:#d97706">
          ⏰ Enviado com atraso
          ${resumo.data_envio ? `(${new Date(resumo.data_envio).toLocaleDateString('pt-BR')})` : ''}
        </div>` : ''}
      </div>

      <!-- Overlay CTA para leads -->
      ${blur ? _htmlBlurOverlay() : ''}
    </div>`;
}

// Card financeiro auxiliar
function _card(label, valor, corValor = '#1a1a2e') {
  return `
    <div style="background:#f8fafc;border-radius:6px;padding:8px">
      <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.4px;line-height:1.3">
        ${_esc(label)}
      </div>
      <div style="font-size:13px;font-weight:700;color:${corValor};margin-top:3px">
        ${_esc(String(valor || '—'))}
      </div>
    </div>`;
}

// Tabela detalhada por categoria (para tela de detalhes)
function renderTabelaIndicadores(container, indicadores) {
  if (!container || !indicadores?.length) return;

  const porCat = {};
  indicadores.forEach(i => {
    const cat = i.categoria || 'siope';
    if (!porCat[cat]) porCat[cat] = [];
    porCat[cat].push(i);
  });

  let html = '';
  Object.entries(CATEGORIAS).forEach(([cat, cfg]) => {
    const itens = porCat[cat];
    if (!itens?.length) return;

    html += `
      <div style="margin-bottom:18px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                    color:#0A3D62;margin-bottom:8px;padding-bottom:4px;border-bottom:2px solid #EBF5FB">
          ${cfg.icon} ${cfg.label}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          ${itens
            .sort((a, b) => a.ordem_exibicao - b.ordem_exibicao)
            .map(i => {
              const v = i.unidade === 'percentual' ? _fmtPct(i.valor)
                      : i.unidade === 'valor_brl'  ? _fmtBRL(i.valor)
                      : i.valor != null ? String(i.valor) : '—';
              return `
                <tr style="border-bottom:1px solid #f1f5f9">
                  <td style="padding:6px 4px;color:#444;line-height:1.4">
                    <span style="color:#94a3b8;font-size:10px;font-weight:700;
                                 margin-right:6px">${_esc(i.cod_indicador)}</span>
                    ${_esc(i.nome)}
                  </td>
                  <td style="padding:6px 4px;text-align:right;font-weight:700;
                             color:#1a1a2e;white-space:nowrap">
                    ${_esc(v || '—')}
                  </td>
                </tr>`;
            }).join('')}
        </table>
      </div>`;
  });

  container.innerHTML = html ||
    '<p style="color:#94a3b8;font-size:13px">Sem dados disponíveis para este período.</p>';
}

// =============================================================================
// HTML auxiliares
// =============================================================================

function _htmlSemDados(nome, uf, blur) {
  if (blur) return `
    <div class="rs-municipio-card" style="position:relative">
      <div style="filter:blur(6px);user-select:none;padding:8px 0">
        <div class="rs-mun-header">
          <span class="rs-mun-nome">████████████/██</span>
          <span class="rs-mun-status" style="background:#16a34a20;color:#16a34a">✅ Regular</span>
        </div>
        <div class="rs-mde-track" style="margin-top:12px">
          <div class="rs-mde-fill" style="width:72%;background:#16a34a"></div>
        </div>
        <div style="margin-top:8px;font-size:12px;color:#aaa">██,██% · Indicador 1.1</div>
      </div>
      ${_htmlBlurOverlay()}
    </div>`;

  return `
    <div class="rs-municipio-card" style="text-align:center;padding:20px">
      <div style="font-size:28px;margin-bottom:10px">📡</div>
      <strong style="color:#0A3D62;font-size:14px">
        Dados de ${_esc(nome || 'seu município')}/${_esc(uf || '')} em breve
      </strong>
      <p style="font-size:12px;color:#94a3b8;margin:8px 0 0;line-height:1.6">
        Histórico SIOPE sendo carregado.<br>
        Esta seção acende automaticamente quando os dados estiverem disponíveis.
      </p>
    </div>`;
}

function _htmlBlurOverlay() {
  return `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:10px;
      background:rgba(255,255,255,0.6);border-radius:12px;
      backdrop-filter:blur(2px);padding:20px;text-align:center">
      <span style="font-size:13px;font-weight:700;color:#0A3D62;line-height:1.5">
        🔒 Assine para ver os dados fiscais do seu município
      </span>
      <a href="/assinatura.html"
        style="display:inline-block;padding:9px 20px;background:#0A3D62;color:#fff;
               border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">
        Ver planos →
      </a>
    </div>`;
}

// Renderizar painel de histórico completo
function renderHistoricoCompleto(container, historico, nomeMunicipio, uf) {
  if (!container || !historico || historico.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:20px;color:var(--subtexto)">
        📊 Histórico não disponível para ${_esc(nomeMunicipio)}/${_esc(uf)}
      </div>`;
    return;
  }
  
  // Ordenar do mais antigo ao mais recente (para o gráfico)
  const dadosOrdenados = [...historico].reverse();
  
  // Preparar dados para o gráfico
  const anos = dadosOrdenados.map(d => d.ano);
  const valoresMDE = dadosOrdenados.map(d => d.pct_mde_aplicado || 0);
  const valoresFundeb = dadosOrdenados.map(d => d.pct_fundeb_remuneracao || 0);
  
  // Encontrar max/min para escala
  const maxMDE = Math.max(...valoresMDE, 30);
  
  container.innerHTML = `
    <!-- Cabeçalho -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding:0 4px">
      <div>
        <div style="font-size:16px;font-weight:700;color:var(--azul)">
          ${_esc(nomeMunicipio)}/${_esc(uf)}
        </div>
        <div style="font-size:12px;color:var(--subtexto)">
          Série histórica ${anos[0]} - ${anos[anos.length - 1]}
        </div>
      </div>
      <button onclick="voltarResumo()" 
              style="padding:8px 16px;background:var(--bg-page);border:1px solid var(--borda);
                     border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;
                     color:var(--azul)">
        ← Resumo
      </button>
    </div>
    
    <!-- Gráfico MDE (SVG simples) -->
    <div style="background:var(--bg-page);padding:16px;border-radius:12px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:var(--texto);margin-bottom:12px">
        📊 Evolução do Indicador 1.1 — MDE Aplicado
      </div>
      ${_renderGraficoLinhaMDE(anos, valoresMDE, maxMDE)}
    </div>
    
    <!-- Tabela comparativa -->
    <div style="background:var(--bg-page);padding:16px;border-radius:12px">
      <div style="font-size:13px;font-weight:700;color:var(--texto);margin-bottom:12px">
        📋 Comparativo Anual — Principais Indicadores
      </div>
      ${_renderTabelaComparativa(historico)}
    </div>
  `;
}

// Renderizar gráfico de linha SVG (MDE)
function _renderGraficoLinhaMDE(anos, valores, maxValor) {
  const width = 600;
  const height = 200;
  const padding = 40;
  const chartWidth = width - (padding * 2);
  const chartHeight = height - (padding * 2);
  
  // Escala X (anos)
  const stepX = chartWidth / (anos.length - 1);
  
  // Escala Y (valores)
  const scaleY = chartHeight / maxValor;
  
  // Calcular pontos da linha
  const pontos = valores.map((v, i) => {
    const x = padding + (i * stepX);
    const y = height - padding - (v * scaleY);
    return `${x},${y}`;
  }).join(' ');
  
  // Linha do mínimo (25%)
  const yMin = height - padding - (25 * scaleY);
  
  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;max-width:600px">
      <!-- Grid horizontal -->
      <line x1="${padding}" y1="${yMin}" x2="${width - padding}" y2="${yMin}" 
            stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,4" opacity="0.5"/>
      
      <!-- Eixos -->
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" 
            stroke="var(--borda)" stroke-width="2"/>
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" 
            stroke="var(--borda)" stroke-width="2"/>
      
      <!-- Linha de dados -->
      <polyline points="${pontos}" fill="none" stroke="var(--azul)" stroke-width="3" 
                stroke-linejoin="round" stroke-linecap="round"/>
      
      <!-- Pontos -->
      ${valores.map((v, i) => {
        const x = padding + (i * stepX);
        const y = height - padding - (v * scaleY);
        const cor = v >= 25 ? '#16a34a' : '#dc2626';
        return `
          <circle cx="${x}" cy="${y}" r="5" fill="${cor}" stroke="#fff" stroke-width="2"/>
          <text x="${x}" y="${y - 12}" text-anchor="middle" 
                font-size="12" font-weight="700" fill="${cor}">
            ${v.toFixed(1)}%
          </text>
        `;
      }).join('')}
      
      <!-- Labels anos -->
      ${anos.map((ano, i) => {
        const x = padding + (i * stepX);
        return `
          <text x="${x}" y="${height - padding + 20}" text-anchor="middle" 
                font-size="13" font-weight="600" fill="var(--texto)">
            ${ano}
          </text>
        `;
      }).join('')}
      
      <!-- Label mínimo -->
      <text x="${padding - 8}" y="${yMin + 4}" text-anchor="end" 
            font-size="11" fill="#94a3b8">Mín: 25%</text>
    </svg>
  `;
}

// Renderizar tabela comparativa
function _renderTabelaComparativa(historico) {
  // Já vem ordenado do mais recente
  const linhas = historico.map((h, idx) => {
    const sit = _sit(h.situacao);
    
    // Calcular variação (se não for o último/primeiro ano)
    let variacaoMDE = null;
    if (idx < historico.length - 1) {
      const anterior = historico[idx + 1];
      if (h.pct_mde_aplicado && anterior.pct_mde_aplicado) {
        variacaoMDE = calcularVariacao(h.pct_mde_aplicado, anterior.pct_mde_aplicado);
      }
    }
    
    return `
      <tr style="border-bottom:1px solid var(--borda)">
        <!-- Ano -->
        <td style="padding:10px 8px;font-weight:700;color:var(--azul)">
          ${h.ano}
        </td>
        
        <!-- MDE Aplicado -->
        <td style="padding:10px 8px;text-align:right">
          <div style="font-weight:700;color:${h.pct_mde_aplicado >= 25 ? '#16a34a' : '#dc2626'}">
            ${_fmtPct(h.pct_mde_aplicado) || '—'}
          </div>
          ${variacaoMDE !== null ? `
            <div style="font-size:10px;color:${variacaoMDE >= 0 ? '#16a34a' : '#dc2626'}">
              ${variacaoMDE >= 0 ? '↗' : '↘'} ${Math.abs(variacaoMDE).toFixed(1)}%
            </div>
          ` : ''}
        </td>
        
        <!-- FUNDEB Remuneração -->
        <td style="padding:10px 8px;text-align:right;font-weight:600">
          ${_fmtPct(h.pct_fundeb_remuneracao) || '—'}
        </td>
        
        <!-- Invest/Aluno -->
        <td style="padding:10px 8px;text-align:right;font-weight:600">
          ${_fmtBRL(h.invest_aluno_basica) || '—'}
        </td>
        
        <!-- Situação -->
        <td style="padding:10px 8px;text-align:center">
          <span style="font-size:11px;padding:4px 8px;border-radius:12px;
                       background:${sit.cor}20;color:${sit.cor};font-weight:700;
                       white-space:nowrap">
            ${sit.icon} ${sit.label}
          </span>
        </td>
      </tr>
    `;
  }).join('');
  
  return `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:500px">
        <thead>
          <tr style="border-bottom:2px solid var(--azul);background:var(--azul-light)">
            <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;
                       letter-spacing:0.5px;color:var(--azul)">Ano</th>
            <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;
                       letter-spacing:0.5px;color:var(--azul)">MDE (1.1)</th>
            <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;
                       letter-spacing:0.5px;color:var(--azul)">FUNDEB (1.2)</th>
            <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;
                       letter-spacing:0.5px;color:var(--azul)">Invest/Aluno</th>
            <th style="padding:8px;text-align:center;font-size:11px;text-transform:uppercase;
                       letter-spacing:0.5px;color:var(--azul)">Situação</th>
          </tr>
        </thead>
        <tbody>
          ${linhas}
        </tbody>
      </table>
    </div>
  `;
}
// =============================================================================
// API PÚBLICA
// =============================================================================

window.SupabaseMunicipio = {
  // Queries
  getResumoMunicipio,
  getIndicadoresPeriodo,
  getHistoricoMDE,
  getHistoricoCompleto, 
  getIndicador,
  // Render
  renderSecaoMunicipio,
  renderTabelaIndicadores,
  renderHistoricoCompleto, 
  renderSkeleton,
  // Constantes
  IND,
  CATEGORIAS,
  SITUACAO_CONFIG,
};
