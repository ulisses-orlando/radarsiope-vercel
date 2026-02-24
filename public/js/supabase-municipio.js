/* ==========================================================================
   supabase-municipio.js — Radar SIOPE  (v2 — novo schema)
   Tabelas: indicadores + siope_municipios + municipio_indicadores
            + view vw_municipio_resumo
   Expõe: window.SupabaseMunicipio
   ========================================================================== */

'use strict';

function _sb() {
  if (!window.supabase) throw new Error('[SM] window.supabase não disponível.');
  return window.supabase;
}

// Códigos dos indicadores principais (conforme seed do SQL)
const IND = {
  PERCENTUAL_MDE:    1,
  PERCENTUAL_MINIMO: 2,
  RECEITA_IMPOSTOS:  3,
  DESPESA_MDE:       4,
  FUNDEB_RECEBIDO:   5,
  VAAT_MUNICIPAL:    6,
  VAAT_MEDIA_UF:     7,
};

const SITUACAO_CONFIG = {
  regular:      { label: 'Regular',        icon: '✅', cor: '#16a34a' },
  insuficiente: { label: 'Abaixo do mín.', icon: '⚠️', cor: '#dc2626' },
  nao_enviado:  { label: 'Não enviado',    icon: '📭', cor: '#d97706' },
  retificado:   { label: 'Retificado',     icon: '🔄', cor: '#0891b2' },
  homologado:   { label: 'Homologado',     icon: '🏛️', cor: '#16a34a' },
  em_analise:   { label: 'Em análise',     icon: '🔍', cor: '#7c3aed' },
};

function _sitConfig(s) {
  return SITUACAO_CONFIG[s] || { label: s || '—', icon: '❓', cor: '#94a3b8' };
}
function _fmtBRL(v) {
  return v != null ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null;
}
function _fmtPct(v) {
  return v != null ? `${Number(v).toFixed(2)}%` : null;
}
function _esc(s) {
  return String(s || '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

// ── Query principal: usa a view desnormalizada ────────────────────────────────
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
    if (error) { console.warn('[SM] erro:', error.message); return null; }
    return data;
  } catch (e) { console.warn('[SM] getResumoMunicipio:', e.message); return null; }
}

// ── Todos os indicadores de um período ───────────────────────────────────────
async function getIndicadoresPeriodo(cod_municipio, ano, bimestre) {
  if (!cod_municipio) return [];
  try {
    const { data, error } = await _sb()
      .from('municipio_indicadores')
      .select('cod_indicador, valor, indicadores(nome, unidade, categoria, ordem_exibicao)')
      .eq('cod_municipio', String(cod_municipio))
      .eq('ano', ano).eq('bimestre', bimestre);
    if (error) { console.warn('[SM] getIndicadoresPeriodo:', error.message); return []; }
    return (data || []).map(r => ({
      cod_indicador:  r.cod_indicador,
      valor:          r.valor,
      nome:           r.indicadores?.nome            || '—',
      unidade:        r.indicadores?.unidade         || '',
      categoria:      r.indicadores?.categoria       || '',
      ordem_exibicao: r.indicadores?.ordem_exibicao || 99,
    }));
  } catch (e) { console.warn('[SM] getIndicadoresPeriodo:', e.message); return []; }
}

// ── Histórico % MDE (últimos N bimestres) ────────────────────────────────────
async function getHistoricoMDE(cod_municipio, limite = 6) {
  if (!cod_municipio) return [];
  try {
    const { data, error } = await _sb()
      .from('municipio_indicadores')
      .select('ano, bimestre, valor, siope_municipios!inner(situacao)')
      .eq('cod_municipio', String(cod_municipio))
      .eq('cod_indicador', IND.PERCENTUAL_MDE)
      .order('ano',      { ascending: false })
      .order('bimestre', { ascending: false })
      .limit(limite);
    if (error) { console.warn('[SM] getHistoricoMDE:', error.message); return []; }
    return (data || []).map(r => ({
      ano: r.ano, bimestre: r.bimestre, pct: r.valor,
      situacao: r.siope_municipios?.situacao || 'nao_enviado',
    }));
  } catch (e) { console.warn('[SM] getHistoricoMDE:', e.message); return []; }
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function renderSkeleton(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="rs-municipio-card">
      <div class="rs-skeleton rs-sk-title"></div>
      <div class="rs-skeleton rs-sk-bar" style="margin:10px 0"></div>
      <div class="rs-skeleton rs-sk-line"></div>
    </div>`;
}

// ── Renderizar seção município ────────────────────────────────────────────────
function renderSecaoMunicipio({ container, blur, resumo, nomeMunicipio, uf }) {
  if (!container) return;
  if (!resumo) { container.innerHTML = _htmlSemDados(nomeMunicipio, uf, blur); return; }

  const sit     = _sitConfig(resumo.situacao);
  const pct     = resumo.percentual_aplicado;
  const min     = resumo.percentual_minimo ?? 25;
  const bimRef  = resumo.bimestre ? `${resumo.bimestre}º bimestre/${resumo.ano}` : '—';
  const ESCALA  = 30;
  const barW    = pct != null ? Math.min(100, (pct / ESCALA) * 100).toFixed(1) : 0;
  const minW    = Math.min(100, (min / ESCALA) * 100).toFixed(1);
  const blurSt  = blur ? 'filter:blur(5px);user-select:none;pointer-events:none' : '';

  container.innerHTML = `
    <div class="rs-municipio-card" style="position:relative">
      <div class="rs-mun-header">
        <div>
          <span class="rs-mun-nome">${_esc(nomeMunicipio || '—')}/${_esc(uf || '—')}</span>
          <span class="rs-mun-ref">${_esc(bimRef)}</span>
        </div>
        <span class="rs-mun-status" style="background:${sit.cor}20;color:${sit.cor}">
          ${sit.icon} ${_esc(sit.label)}
        </span>
      </div>
      <div style="${blurSt}">
        <div class="rs-mde-label">
          <span>MDE aplicado</span>
          <strong style="color:${sit.cor}">${_fmtPct(pct) || '—'}</strong>
        </div>
        <div class="rs-mde-track">
          <div class="rs-mde-fill" style="width:${barW}%;background:${sit.cor}"></div>
          <div class="rs-mde-min" style="left:${minW}%" title="Mínimo: ${_fmtPct(min)}"></div>
        </div>
        <div class="rs-mde-meta">
          <span>0%</span>
          <span style="font-size:10px;color:#94a3b8">Mínimo: ${_fmtPct(min)}</span>
          <span>${ESCALA}%+</span>
        </div>
        ${resumo.receita_impostos || resumo.despesa_mde ? `
        <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${resumo.receita_impostos ? `
          <div style="background:#f8fafc;border-radius:6px;padding:8px">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.4px">Receita impostos</div>
            <div style="font-size:13px;font-weight:700;margin-top:2px">${_fmtBRL(resumo.receita_impostos)}</div>
          </div>` : ''}
          ${resumo.despesa_mde ? `
          <div style="background:#f8fafc;border-radius:6px;padding:8px">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.4px">Despesa MDE</div>
            <div style="font-size:13px;font-weight:700;margin-top:2px">${_fmtBRL(resumo.despesa_mde)}</div>
          </div>` : ''}
        </div>` : ''}
        ${resumo.fundeb_recebido ? `
        <div class="rs-fundeb-row">
          <span>💰 FUNDEB recebido</span>
          <span class="rs-fundeb-valor">${_fmtBRL(resumo.fundeb_recebido)}</span>
        </div>` : ''}
        ${resumo.homologado ? `<div style="margin-top:8px;font-size:11px;color:#16a34a;font-weight:600">🏛️ Homologado pela SASE/MEC</div>` : ''}
      </div>
      ${blur ? _htmlBlurOverlay() : ''}
    </div>`;
}

// ── Tabela detalhada de indicadores ──────────────────────────────────────────
function renderTabelaIndicadores(container, indicadores) {
  if (!container || !indicadores?.length) return;
  const porCat = {};
  indicadores.forEach(i => { (porCat[i.categoria || 'outros'] ||= []).push(i); });
  const CATS = {
    mde:     '📚 MDE', fundeb: '💰 FUNDEB', receita: '📈 Receitas',
    despesa: '📉 Despesas', prazo: '📅 Prazos', outros: '📊 Outros',
  };
  let html = '';
  Object.entries(CATS).forEach(([cat, label]) => {
    const itens = porCat[cat];
    if (!itens?.length) return;
    html += `<div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;
                  letter-spacing:.5px;color:#0A3D62;margin-bottom:8px">${label}</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${itens.sort((a,b) => a.ordem_exibicao - b.ordem_exibicao).map(i => {
          const v = i.unidade === 'percentual' ? _fmtPct(i.valor)
                  : i.unidade === 'valor_brl'  ? _fmtBRL(i.valor)
                  : i.valor ?? '—';
          return `<tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:6px 0;color:#444">${_esc(i.nome)}</td>
            <td style="padding:6px 0;text-align:right;font-weight:600">${_esc(String(v))}</td>
          </tr>`;
        }).join('')}
      </table></div>`;
  });
  container.innerHTML = html || '<p style="color:#94a3b8;font-size:13px">Sem dados.</p>';
}

function _htmlSemDados(nome, uf, blur) {
  if (blur) return `
    <div class="rs-municipio-card" style="position:relative">
      <div style="filter:blur(6px);user-select:none;padding:8px 0">
        <div class="rs-mun-header">
          <span class="rs-mun-nome">████████/██</span>
          <span class="rs-mun-status" style="background:#16a34a20;color:#16a34a">✅ Regular</span>
        </div>
        <div class="rs-mde-track" style="margin-top:12px">
          <div class="rs-mde-fill" style="width:72%;background:#16a34a"></div>
        </div>
      </div>
      ${_htmlBlurOverlay()}
    </div>`;
  return `
    <div class="rs-municipio-card" style="text-align:center;padding:20px">
      <div style="font-size:28px;margin-bottom:10px">📡</div>
      <strong style="color:#0A3D62;font-size:14px">Dados de ${_esc(nome || 'seu município')}/${_esc(uf || '')} em breve</strong>
      <p style="font-size:12px;color:#94a3b8;margin:8px 0 0;line-height:1.6">
        Histórico SIOPE sendo carregado.<br>Esta seção acende automaticamente.
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

window.SupabaseMunicipio = {
  getResumoMunicipio, getIndicadoresPeriodo, getHistoricoMDE,
  renderSecaoMunicipio, renderTabelaIndicadores, renderSkeleton,
  IND, SITUACAO_CONFIG,
};
