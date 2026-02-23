/* ==========================================================================
   supabase-municipio.js — Radar SIOPE
   Módulo frontend de acesso público aos dados SIOPE/FUNDEB por município.
   Usa window.supabase (exposto pelo exposeSupabase.js via supabaseClient.js)
   com a anon key — dados públicos, sem risco de exposição.
   ========================================================================== */

'use strict';

const _SUPABASE_READY_KEY = '__supabaseMunicipioReady';

// ─── Verifica disponibilidade ────────────────────────────────────────────────
function _supabase() {
  if (!window.supabase) throw new Error('[supabase-municipio] window.supabase não disponível.');
  return window.supabase;
}

// ─── Último registro SIOPE do município ──────────────────────────────────────
// Retorna o bimestre mais recente disponível (pode ser retificado — sempre busca fresco)
async function getUltimoSIOPE(cod_municipio) {
  if (!cod_municipio) return null;
  try {
    const { data, error } = await _supabase()
      .from('siope_municipios')
      .select(`
        municipio_cod, uf, ano, bimestre,
        receita_impostos, despesa_mde,
        percentual_aplicado, percentual_minimo,
        situacao, data_envio, prazo_envio,
        enviado_no_prazo, homologado
      `)
      .eq('municipio_cod', String(cod_municipio))
      .order('ano',      { ascending: false })
      .order('bimestre', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = nenhum resultado
      console.warn('[supabase-municipio] SIOPE query error:', error.message);
      return null;
    }
    return data || null;
  } catch (err) {
    console.warn('[supabase-municipio] getUltimoSIOPE falhou:', err.message);
    return null;
  }
}

// ─── Histórico SIOPE (últimos N bimestres) ───────────────────────────────────
async function getHistoricoSIOPE(cod_municipio, limite = 6) {
  if (!cod_municipio) return [];
  try {
    const { data, error } = await _supabase()
      .from('siope_municipios')
      .select('ano, bimestre, percentual_aplicado, percentual_minimo, situacao')
      .eq('municipio_cod', String(cod_municipio))
      .order('ano',      { ascending: false })
      .order('bimestre', { ascending: false })
      .limit(limite);

    if (error) { console.warn('[supabase-municipio] Histórico SIOPE error:', error.message); return []; }
    return data || [];
  } catch (err) {
    console.warn('[supabase-municipio] getHistoricoSIOPE falhou:', err.message);
    return [];
  }
}

// ─── Último repasse FUNDEB do município ──────────────────────────────────────
async function getUltimoFUNDEB(cod_municipio) {
  if (!cod_municipio) return null;
  try {
    const { data, error } = await _supabase()
      .from('fundeb_municipios')
      .select('municipio_cod, ano, mes, valor_creditado, valor_previsto, data_credito, vaat_municipio, vaat_media_uf')
      .eq('municipio_cod', String(cod_municipio))
      .order('ano', { ascending: false })
      .order('mes', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.warn('[supabase-municipio] FUNDEB query error:', error.message);
      return null;
    }
    return data || null;
  } catch (err) {
    console.warn('[supabase-municipio] getUltimoFUNDEB falhou:', err.message);
    return null;
  }
}

// ─── Renderizar seção município ───────────────────────────────────────────────
// container : elemento DOM onde renderizar
// blur      : true = dados borrados (lead sem acesso)
// dadosSiope: objeto retornado por getUltimoSIOPE()
// dadosFundeb: objeto retornado por getUltimoFUNDEB()
// nomeMunicipio, uf: strings do destinatário

function renderSecaoMunicipio({ container, blur, dadosSiope, dadosFundeb, nomeMunicipio, uf }) {
  if (!container) return;

  // ── Sem tabelas ainda (B = tabelas não existem) ───────────────────────────
  if (!dadosSiope && !dadosFundeb) {
    container.innerHTML = _htmlSemDados(nomeMunicipio, uf, blur);
    return;
  }

  // ── Com dados ─────────────────────────────────────────────────────────────
  const siope  = dadosSiope  || {};
  const fundeb = dadosFundeb || {};

  const pct     = Number(siope.percentual_aplicado || 0).toFixed(1);
  const min     = Number(siope.percentual_minimo   || 25).toFixed(1);
  const sit     = siope.situacao || 'nao_enviado';
  const bim     = siope.bimestre ? `${siope.bimestre}º bimestre/${siope.ano}` : '—';
  const barW    = Math.min(100, (Number(pct) / 30) * 100).toFixed(1); // 30% = escala máx visual
  const barCor  = sit === 'regular' ? '#16a34a' : sit === 'insuficiente' ? '#dc2626' : '#d97706';
  const sitIcon = sit === 'regular' ? '✅' : sit === 'insuficiente' ? '⚠️' : '📭';
  const sitLabel = { regular: 'Regular', insuficiente: 'Abaixo do mínimo', nao_enviado: 'Não enviado' }[sit] || sit;

  const fundebVal = fundeb.valor_creditado
    ? Number(fundeb.valor_creditado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : null;
  const fundebMes = fundeb.mes && fundeb.ano
    ? `${String(fundeb.mes).padStart(2,'0')}/${fundeb.ano}`
    : null;

  const blurStyle  = blur ? 'filter:blur(5px);user-select:none;pointer-events:none' : '';
  const blurClass  = blur ? 'rs-blur' : '';

  container.innerHTML = `
    <div class="rs-municipio-card ${blurClass}" style="position:relative">

      <div class="rs-mun-header">
        <div>
          <span class="rs-mun-nome">${_esc(nomeMunicipio || '—')}/${_esc(uf || '—')}</span>
          <span class="rs-mun-ref">${_esc(bim)}</span>
        </div>
        <span class="rs-mun-status" style="background:${barCor}20;color:${barCor}">${sitIcon} ${sitLabel}</span>
      </div>

      <!-- Barra MDE -->
      <div class="rs-mde-wrap" style="${blurStyle}">
        <div class="rs-mde-label">
          <span>MDE aplicado</span>
          <strong style="color:${barCor}">${pct}%</strong>
        </div>
        <div class="rs-mde-track">
          <div class="rs-mde-fill" style="width:${barW}%;background:${barCor}"></div>
          <div class="rs-mde-min" style="left:${((Number(min)/30)*100).toFixed(1)}%" title="Mínimo: ${min}%"></div>
        </div>
        <div class="rs-mde-meta">
          <span>0%</span>
          <span style="color:#888;font-size:11px">Mínimo constitucional: ${min}%</span>
          <span>30%+</span>
        </div>
      </div>

      <!-- FUNDEB -->
      ${fundebVal ? `
      <div class="rs-fundeb-row" style="${blurStyle}">
        <span class="rs-fundeb-label">💰 FUNDEB creditado em ${_esc(fundebMes)}</span>
        <span class="rs-fundeb-valor">${fundebVal}</span>
      </div>` : ''}

      <!-- Overlay CTA para lead -->
      ${blur ? _htmlBlurOverlay() : ''}
    </div>
  `;
}

// ─── Skeleton de carregamento ─────────────────────────────────────────────────
function renderSkeletonMunicipio(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="rs-municipio-card">
      <div class="rs-skeleton rs-sk-title"></div>
      <div class="rs-skeleton rs-sk-bar"></div>
      <div class="rs-skeleton rs-sk-line"></div>
    </div>
  `;
}

// ─── HTML sem dados (tabelas ainda não populadas) ────────────────────────────
function _htmlSemDados(nome, uf, blur) {
  if (blur) {
    // Lead vê teaser borrado
    return `
      <div class="rs-municipio-card" style="position:relative">
        <div style="filter:blur(6px);user-select:none;padding:12px 0">
          <div class="rs-mun-header">
            <span class="rs-mun-nome">████████████/██</span>
            <span class="rs-mun-status" style="background:#16a34a20;color:#16a34a">✅ Regular</span>
          </div>
          <div class="rs-mde-track" style="margin-top:12px">
            <div class="rs-mde-fill" style="width:68%;background:#16a34a"></div>
          </div>
          <div style="margin-top:8px;font-size:13px;color:#888">██% aplicados · ██/████</div>
        </div>
        ${_htmlBlurOverlay()}
      </div>
    `;
  }
  // Assinante vê aviso amigável
  return `
    <div class="rs-municipio-card rs-mun-em-breve">
      <div style="text-align:center;padding:8px 0">
        <div style="font-size:24px;margin-bottom:8px">📡</div>
        <strong style="color:#0A3D62;font-size:14px">Dados de ${_esc(nome||'seu município')}/${_esc(uf||'')} em breve</strong>
        <p style="font-size:12px;color:#888;margin:6px 0 0;line-height:1.5">
          Estamos carregando o histórico SIOPE 2021–2025.<br>
          Esta seção acende automaticamente quando os dados estiverem disponíveis.
        </p>
      </div>
    </div>
  `;
}

function _htmlBlurOverlay() {
  return `
    <div style="
      position:absolute;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:10px;
      background:rgba(255,255,255,0.55);border-radius:12px;
      backdrop-filter:blur(2px);padding:16px;text-align:center
    ">
      <span style="font-size:13px;font-weight:700;color:#0A3D62;line-height:1.4">
        🔒 Assine para ver os dados fiscais do seu município
      </span>
      <a href="/assinatura.html" style="
        display:inline-block;padding:9px 20px;background:#0A3D62;color:#fff;
        border-radius:8px;font-size:13px;font-weight:700;text-decoration:none
      ">Ver planos →</a>
    </div>
  `;
}

function _esc(s) {
  return String(s||'').replace(/[&<>"']/g, m =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]
  );
}

// ─── Exporta globalmente ──────────────────────────────────────────────────────
window.SupabaseMunicipio = {
  getUltimoSIOPE,
  getHistoricoSIOPE,
  getUltimoFUNDEB,
  renderSecaoMunicipio,
  renderSkeletonMunicipio,
};
