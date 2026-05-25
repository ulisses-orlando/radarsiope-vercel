// calendarioAdmin.js — Radar SIOPE
// Painel admin do Calendário de Datas Importantes
// API: /api/sendViaSES?acao=calendario_*
// Uso: renderCalendarioAdmin(container)

'use strict';

const _CAL_ADM_API = '/api/sendViaSES';

const _CAL_ADM_SIS = {
  fundeb: 'FUNDEB', siope: 'SIOPE',
  salario_educacao: 'Salário-Educação', siscacs: 'SISCACS',
};
const _CAL_ADM_TIP = {
  repasse: 'Repasse', prazo: 'Prazo',
  reuniao: 'Reunião', mandato: 'Mandato', outro: 'Outro',
};
const _CAL_ADM_STA = {
  previsto: 'Previsto', confirmado: 'Confirmado', realizado: 'Realizado',
};
const _CAL_ADM_AVISOS = [3, 7, 15, 30];
const _CAL_ADM_CORES = {
  fundeb: '#38bdf8', siope: '#34d399', salario_educacao: '#fb923c', siscacs: '#a78bfa',
};

// ─── Estado ──────────────────────────────────────────────────────────────────
let _cadEventos    = [];
let _cadEditando   = null;
let _cadFiltros    = { sistema: '', tipo: '', status: '', incluirInativos: false };
// Estado do sub-painel de repasses
let _cadRepEventoId   = null;
let _cadRepEventoTipo = null; // 'fundeb' | 'salario_educacao'
let _cadRepLista      = [];
let _cadRepEditando   = null;

// ─── API helpers ──────────────────────────────────────────────────────────────
async function _cadGet(acao, params = {}) {
  const qs = new URLSearchParams({ acao, ...params });
  const res = await fetch(`${_CAL_ADM_API}?${qs}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Erro na API');
  return json;
}
async function _cadPost(acao, body) {
  const res = await fetch(`${_CAL_ADM_API}?acao=${acao}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Erro na API');
  return json;
}

// ─── Ponto de entrada ─────────────────────────────────────────────────────────
export async function renderCalendarioAdmin(container) {
  container.innerHTML = _cadShellHTML();
  _cadBindFiltros();
  await _cadCarregar();
}

// ─── Shell ────────────────────────────────────────────────────────────────────
function _cadShellHTML() {
  return `
  <div id="cad-root" style="font-family:'DM Sans',sans-serif;color:#f1f5f9;padding:0 0 80px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div>
        <div style="font-size:11px;color:#475569;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px">Central · Admin</div>
        <div style="font-size:22px;font-weight:700;letter-spacing:-.02em">Calendário</div>
      </div>
      <button id="cad-btn-novo" style="${_cadBtnStyle('#38bdf8')}">+ Novo evento</button>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px">
      <select id="cad-f-sistema" style="${_cadSelectStyle()}">
        <option value="">Todos os sistemas</option>
        ${Object.entries(_CAL_ADM_SIS).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}
      </select>
      <select id="cad-f-tipo" style="${_cadSelectStyle()}">
        <option value="">Todos os tipos</option>
        ${Object.entries(_CAL_ADM_TIP).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}
      </select>
      <select id="cad-f-status" style="${_cadSelectStyle()}">
        <option value="">Todos os status</option>
        ${Object.entries(_CAL_ADM_STA).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}
      </select>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#94a3b8;cursor:pointer">
        <input type="checkbox" id="cad-f-inativos" style="accent-color:#38bdf8"> Ver inativos
      </label>
    </div>

    <div id="cad-loading" style="display:none;text-align:center;padding:40px;color:#475569;font-size:13px">Carregando...</div>
    <div id="cad-lista"></div>

    <!-- Painel lateral (evento + repasses) -->
    <div id="cad-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:200;backdrop-filter:blur(4px)"></div>
    <div id="cad-painel" style="display:none;position:fixed;top:0;right:0;width:min(500px,100vw);height:100vh;background:#1e293b;z-index:201;overflow-y:auto;box-shadow:-4px 0 24px rgba(0,0,0,.4);padding:28px 24px 60px">
      <div id="cad-painel-conteudo"></div>
    </div>

    <div id="cad-toast" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e293b;border:1px solid #334155;color:#f1f5f9;padding:10px 20px;border-radius:12px;font-size:13px;font-weight:600;z-index:300;white-space:nowrap"></div>
  </div>`;
}

// ─── Carregar lista de eventos ─────────────────────────────────────────────────
async function _cadCarregar() {
  _cadSetLoading(true);
  try {
    const params = {};
    if (_cadFiltros.sistema)        params.sistema = _cadFiltros.sistema;
    if (_cadFiltros.tipo)           params.tipo    = _cadFiltros.tipo;
    if (_cadFiltros.status)         params.status  = _cadFiltros.status;
    if (_cadFiltros.incluirInativos) params.incluirInativos = 'true';
    const { dados } = await _cadGet('calendario_listar', params);
    _cadEventos = dados;
    _cadRenderLista();
  } catch (e) {
    _cadToast(e.message, 'erro');
  } finally {
    _cadSetLoading(false);
  }
}

function _cadRenderLista() {
  const el = document.getElementById('cad-lista');
  if (!_cadEventos.length) {
    el.innerHTML = `<div style="text-align:center;padding:60px;color:#334155;font-size:14px">Nenhum evento encontrado</div>`;
    return;
  }
  el.innerHTML = _cadEventos.map(ev => {
    const cor    = _CAL_ADM_CORES[ev.sistema] || '#94a3b8';
    const inativo = !ev.ativo;
    const isRep  = ev.tipo === 'repasse';
    return `
    <div style="background:${inativo?'#141d2b':'#1e293b'};border-radius:12px;padding:14px 16px;margin-bottom:8px;border-left:3px solid ${inativo?'#334155':cor};opacity:${inativo?.6:1}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
            <span style="background:${cor}20;color:${cor};font-size:10px;padding:2px 8px;border-radius:99px;font-weight:700;text-transform:uppercase">${_CAL_ADM_SIS[ev.sistema]||ev.sistema}</span>
            <span style="background:rgba(255,255,255,.05);color:#64748b;font-size:10px;padding:2px 7px;border-radius:99px">${_CAL_ADM_TIP[ev.tipo]||ev.tipo}</span>
            <span style="background:rgba(255,255,255,.04);color:${ev.status==='realizado'?'#34d399':ev.status==='confirmado'?'#38bdf8':'#64748b'};font-size:10px;padding:2px 7px;border-radius:99px;text-transform:uppercase;font-weight:600">${_CAL_ADM_STA[ev.status]||ev.status}</span>
            ${inativo?'<span style="background:rgba(239,68,68,.1);color:#f87171;font-size:10px;padding:2px 7px;border-radius:99px;font-weight:600">INATIVO</span>':''}
            ${ev.visivel_free?'<span style="font-size:10px;color:#fbbf24">● Free</span>':''}
          </div>
          <div style="font-weight:600;font-size:14px;color:#e2e8f0;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ev.titulo}</div>
          <span style="font-size:12px;color:#64748b">📅 ${_cadFmtData(ev.data)}</span>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button onclick="window._cadEditarEvento('${ev.id}')" style="${_cadBtnMini('#38bdf8')}">Editar</button>
          ${isRep ? `<button onclick="window._cadAbrirRepasses('${ev.id}','${ev.sistema}')" style="${_cadBtnMini('#34d399')}">💰 Valores</button>` : ''}
          ${ev.ativo
            ? `<button onclick="window._cadDesativar('${ev.id}')" style="${_cadBtnMini('#f87171')}">Desativar</button>`
            : `<button onclick="window._cadExcluir('${ev.id}')" style="${_cadBtnMini('#f87171')}">Excluir</button>`
          }
        </div>
      </div>
    </div>`;
  }).join('');
}

// ─── Formulário de evento ──────────────────────────────────────────────────────
function _cadAbrirForm(ev = null) {
  _cadEditando = ev;
  document.getElementById('cad-overlay').style.display = 'block';
  document.getElementById('cad-painel').style.display   = 'block';
  document.getElementById('cad-painel-conteudo').innerHTML = _cadHtmlForm(ev);
  // bind condicional
  const chg = () => {
    const tipo = document.getElementById('cf-tipo')?.value;
    // nenhum campo condicional restante — extensível futuramente
  };
  document.getElementById('cf-sistema')?.addEventListener('change', chg);
  document.getElementById('cf-tipo')?.addEventListener('change', chg);
  document.getElementById('cf-salvar')?.addEventListener('click', _cadSubmitForm);
}

function _cadHtmlForm(ev) {
  const v    = ev || {};
  const avs  = v.avisos_antecipados || [];
  const sel  = (val, opt) => val === opt ? 'selected' : '';
  return `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
    <div style="font-size:17px;font-weight:700;color:#f1f5f9">${ev ? 'Editar evento' : 'Novo evento'}</div>
    <button onclick="window._cadFecharPainel()" style="background:none;border:none;color:#475569;font-size:20px;cursor:pointer">✕</button>
  </div>
  <div style="display:flex;flex-direction:column;gap:14px">

    <div>
      <label style="${_cadLabelStyle()}">Sistema</label>
      <select id="cf-sistema" style="${_cadInputStyle()}">
        ${Object.entries(_CAL_ADM_SIS).map(([val,lbl])=>`<option value="${val}" ${sel(v.sistema,val)}>${lbl}</option>`).join('')}
      </select>
    </div>

    <div>
      <label style="${_cadLabelStyle()}">Tipo</label>
      <select id="cf-tipo" style="${_cadInputStyle()}">
        ${Object.entries(_CAL_ADM_TIP).map(([val,lbl])=>`<option value="${val}" ${sel(v.tipo,val)}>${lbl}</option>`).join('')}
      </select>
    </div>

    <div>
      <label style="${_cadLabelStyle()}">Título</label>
      <input id="cf-titulo" type="text" value="${v.titulo||''}" style="${_cadInputStyle()}" placeholder="Ex: Repasse FUNDEB – Jun/2026">
    </div>

    <div>
      <label style="${_cadLabelStyle()}">Descrição <span style="color:#475569;font-weight:400">(opcional)</span></label>
      <textarea id="cf-descricao" rows="3" style="${_cadInputStyle()};resize:vertical">${v.descricao||''}</textarea>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="${_cadLabelStyle()}">Data</label>
        <input id="cf-data" type="date" value="${v.data||''}" style="${_cadInputStyle()}">
      </div>
      <div>
        <label style="${_cadLabelStyle()}">Status</label>
        <select id="cf-status" style="${_cadInputStyle()}">
          ${Object.entries(_CAL_ADM_STA).map(([val,lbl])=>`<option value="${val}" ${sel(v.status||'previsto',val)}>${lbl}</option>`).join('')}
        </select>
      </div>
    </div>

    <div>
      <label style="${_cadLabelStyle()}">Avisos antecipados (dias antes)</label>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
        ${_CAL_ADM_AVISOS.map(d=>`
        <label style="display:flex;align-items:center;gap:5px;font-size:13px;color:#94a3b8;cursor:pointer">
          <input type="checkbox" class="cf-aviso" value="${d}" ${avs.includes(d)?'checked':''} style="accent-color:#a78bfa"> ${d}d
        </label>`).join('')}
      </div>
    </div>

    <div style="display:flex;gap:20px">
      <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:#94a3b8;cursor:pointer">
        <input type="checkbox" id="cf-free" ${v.visivel_free?'checked':''} style="accent-color:#fbbf24"> Visível no plano free
      </label>
      ${ev ? `
      <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:#94a3b8;cursor:pointer">
        <input type="checkbox" id="cf-ativo" ${v.ativo?'checked':''} style="accent-color:#34d399"> Ativo
      </label>` : ''}
    </div>

    <button id="cf-salvar" style="${_cadBtnStyle('#38bdf8')};width:100%;justify-content:center;margin-top:6px">
      ${ev ? 'Salvar alterações' : 'Criar evento'}
    </button>
  </div>`;
}

async function _cadSubmitForm() {
  const titulo = document.getElementById('cf-titulo')?.value.trim();
  const data   = document.getElementById('cf-data')?.value;
  if (!titulo) return _cadToast('Título obrigatório', 'erro');
  if (!data)   return _cadToast('Data obrigatória', 'erro');

  const dados = {
    sistema:            document.getElementById('cf-sistema').value,
    tipo:               document.getElementById('cf-tipo').value,
    titulo,
    descricao:          document.getElementById('cf-descricao').value.trim() || null,
    data,
    status:             document.getElementById('cf-status').value,
    avisos_antecipados: [...document.querySelectorAll('.cf-aviso:checked')].map(el => +el.value),
    visivel_free:       document.getElementById('cf-free').checked,
    ativo:              _cadEditando ? document.getElementById('cf-ativo').checked : true,
  };
  if (_cadEditando) dados.id = _cadEditando.id;

  const btn  = document.getElementById('cf-salvar');
  const acao = dados.id ? 'calendario_atualizar' : 'calendario_criar';
  btn.disabled = true; btn.textContent = 'Salvando...';

  try {
    await _cadPost(acao, dados);
    _cadToast(dados.id ? 'Evento atualizado' : 'Evento criado');
    _cadFecharPainel();
    await _cadCarregar();
  } catch (e) {
    _cadToast(e.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = _cadEditando ? 'Salvar alterações' : 'Criar evento';
  }
}

// ─── Sub-painel: repasses por município ───────────────────────────────────────
function _cadAbrirRepasses(eventoId, sistema) {
  _cadRepEventoId   = eventoId;
  _cadRepEventoTipo = sistema; // 'fundeb' ou 'salario_educacao'
  _cadRepEditando   = null;
  const ev = _cadEventos.find(e => e.id === eventoId);

  document.getElementById('cad-overlay').style.display = 'block';
  document.getElementById('cad-painel').style.display   = 'block';
  document.getElementById('cad-painel-conteudo').innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
    <div style="font-size:17px;font-weight:700;color:#f1f5f9">💰 Valores por município</div>
    <button onclick="window._cadFecharPainel()" style="background:none;border:none;color:#475569;font-size:20px;cursor:pointer">✕</button>
  </div>
  <p style="font-size:12px;color:#64748b;margin:0 0 16px">${ev?.titulo || ''}</p>
  <button onclick="window._cadRepAbrirForm(null)"
    style="${_cadBtnStyle('#34d399')};margin-bottom:16px">+ Adicionar município</button>
  <div id="cad-rep-lista">Carregando...</div>`;

  _cadRepCarregar();
}

async function _cadRepCarregar() {
  const el = document.getElementById('cad-rep-lista');
  if (!el) return;
  try {
    const { dados } = await _cadGet('calendario_repasse_listar', { evento_id: _cadRepEventoId });
    _cadRepLista = dados;
    _cadRepRenderLista();
  } catch (e) {
    el.innerHTML = `<p style="color:#f87171;font-size:13px">Erro: ${e.message}</p>`;
  }
}

function _cadRepRenderLista() {
  const el = document.getElementById('cad-rep-lista');
  if (!el) return;
  const fv = v => v ? _cadFmtValor(v) : '—';
  const isFundeb = _cadRepEventoTipo === 'fundeb';

  if (!_cadRepLista.length) {
    el.innerHTML = `<p style="color:#475569;font-size:13px">Nenhum município cadastrado.</p>`;
    return;
  }

  el.innerHTML = _cadRepLista.map(r => `
  <div style="background:#162032;border-radius:12px;padding:12px 14px;margin-bottom:8px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="font-size:13px;font-weight:700;color:#e2e8f0">${r.cod_municipio}</span>
      <div style="display:flex;gap:6px">
        <button onclick="window._cadRepAbrirForm('${r.id}')" style="${_cadBtnMini('#38bdf8')}">Editar</button>
        <button onclick="window._cadRepExcluir('${r.id}')" style="${_cadBtnMini('#f87171')}">Excluir</button>
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:12px">
      ${isFundeb ? `
      <span style="color:#64748b">VAAF: <strong style="color:#38bdf8">${fv(r.vl_vaaf)}</strong></span>
      <span style="color:#64748b">VAAT: <strong style="color:#38bdf8">${fv(r.vl_vaat)}</strong></span>
      <span style="color:#64748b">VAAR: <strong style="color:#38bdf8">${fv(r.vl_vaar)}</strong></span>
      ` : `
      <span style="color:#64748b">Quota: <strong style="color:#fb923c">${fv(r.vl_sal_educ)}</strong></span>
      `}
      <span style="color:#64748b">Status: <strong style="color:${r.status==='realizado'?'#34d399':r.status==='confirmado'?'#38bdf8':'#94a3b8'}">${_CAL_ADM_STA[r.status]||r.status}</strong></span>
    </div>
  </div>`).join('');
}

function _cadRepAbrirForm(id) {
  _cadRepEditando = id ? (_cadRepLista.find(r => r.id === id) || null) : null;
  const v        = _cadRepEditando || {};
  const isFundeb = _cadRepEventoTipo === 'fundeb';
  const fmtV     = c => c ? (c / 100).toFixed(2) : '';
  const sel      = (a, b) => a === b ? 'selected' : '';

  document.getElementById('cad-rep-lista').innerHTML = `
  <div style="background:#0f172a;border-radius:12px;padding:16px">
    <h4 style="margin:0 0 14px;color:#f1f5f9;font-size:14px">${_cadRepEditando ? 'Editar repasse' : 'Novo repasse'}</h4>

    <div style="margin-bottom:12px">
      <label style="${_cadLabelStyle()}">Código do município</label>
      <input type="text" id="crep-cod" value="${v.cod_municipio||''}" ${_cadRepEditando?'readonly':''} style="${_cadInputStyle()}" placeholder="Ex: 2927408">
    </div>

    ${isFundeb ? `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        <label style="${_cadLabelStyle()}">VAAF (R$)</label>
        <input type="number" id="crep-vaaf" step="0.01" min="0" value="${fmtV(v.vl_vaaf)}" style="${_cadInputStyle()}" placeholder="0,00">
      </div>
      <div>
        <label style="${_cadLabelStyle()}">VAAT (R$)</label>
        <input type="number" id="crep-vaat" step="0.01" min="0" value="${fmtV(v.vl_vaat)}" style="${_cadInputStyle()}" placeholder="0,00">
      </div>
      <div>
        <label style="${_cadLabelStyle()}">VAAR (R$)</label>
        <input type="number" id="crep-vaar" step="0.01" min="0" value="${fmtV(v.vl_vaar)}" style="${_cadInputStyle()}" placeholder="0,00">
      </div>
    </div>` : `
    <div style="margin-bottom:12px">
      <label style="${_cadLabelStyle()}">Quota Salário-Educação (R$)</label>
      <input type="number" id="crep-saleduc" step="0.01" min="0" value="${fmtV(v.vl_sal_educ)}" style="${_cadInputStyle()}" placeholder="0,00">
    </div>`}

    <div style="margin-bottom:16px">
      <label style="${_cadLabelStyle()}">Status</label>
      <select id="crep-status" style="${_cadInputStyle()}">
        ${Object.entries(_CAL_ADM_STA).map(([val,lbl])=>`<option value="${val}" ${sel(v.status||'previsto',val)}>${lbl}</option>`).join('')}
      </select>
    </div>

    <div style="display:flex;justify-content:space-between">
      <button onclick="window._cadRepCarregar()" style="${_cadBtnMini('#64748b')}">← Voltar</button>
      <button onclick="window._cadRepSalvar()" style="${_cadBtnStyle('#34d399')}">
        ${_cadRepEditando ? '💾 Salvar' : '➕ Criar'}
      </button>
    </div>
  </div>`;
}

function _cadRepCentavos(id) {
  const v = parseFloat(document.getElementById(id)?.value) || 0;
  return v > 0 ? Math.round(v * 100) : null;
}

async function _cadRepSalvar() {
  const cod = document.getElementById('crep-cod')?.value.trim();
  if (!cod) return _cadToast('Informe o código do município', 'erro');

  const isFundeb = _cadRepEventoTipo === 'fundeb';
  const dados = {
    evento_id:     _cadRepEventoId,
    cod_municipio: cod,
    vl_vaaf:       isFundeb ? _cadRepCentavos('crep-vaaf') : null,
    vl_vaat:       isFundeb ? _cadRepCentavos('crep-vaat') : null,
    vl_vaar:       isFundeb ? _cadRepCentavos('crep-vaar') : null,
    vl_sal_educ:   !isFundeb ? _cadRepCentavos('crep-saleduc') : null,
    status:        document.getElementById('crep-status')?.value || 'previsto',
  };
  if (_cadRepEditando) dados.id = _cadRepEditando.id;

  const acao = dados.id ? 'calendario_repasse_atualizar' : 'calendario_repasse_criar';
  try {
    await _cadPost(acao, dados);
    _cadToast(dados.id ? 'Repasse atualizado' : 'Repasse criado');
    await _cadRepCarregar();
  } catch (e) { _cadToast(e.message, 'erro'); }
}

// ─── Ações globais ────────────────────────────────────────────────────────────
window._cadEditarEvento = id => {
  const ev = _cadEventos.find(e => e.id === id);
  if (ev) _cadAbrirForm(ev);
};
window._cadAbrirRepasses = _cadAbrirRepasses;
window._cadRepAbrirForm  = _cadRepAbrirForm;
window._cadRepCarregar   = _cadRepCarregar;

window._cadDesativar = async id => {
  if (!confirm('Desativar este evento?')) return;
  try {
    await _cadPost('calendario_desativar', { id });
    _cadToast('Evento desativado');
    await _cadCarregar();
  } catch (e) { _cadToast(e.message, 'erro'); }
};
window._cadExcluir = async id => {
  if (!confirm('Excluir permanentemente?')) return;
  try {
    await _cadPost('calendario_excluir', { id });
    _cadToast('Evento excluído');
    await _cadCarregar();
  } catch (e) { _cadToast(e.message, 'erro'); }
};
window._cadRepExcluir = async id => {
  if (!confirm('Excluir este repasse?')) return;
  try {
    await _cadPost('calendario_repasse_excluir', { id });
    _cadToast('Repasse excluído');
    await _cadRepCarregar();
  } catch (e) { _cadToast(e.message, 'erro'); }
};
window._cadRepSalvar   = _cadRepSalvar;
window._cadFecharPainel = () => {
  document.getElementById('cad-overlay').style.display = 'none';
  document.getElementById('cad-painel').style.display   = 'none';
  _cadEditando = _cadRepEditando = null;
};

// ─── Filtros ──────────────────────────────────────────────────────────────────
function _cadBindFiltros() {
  document.getElementById('cad-btn-novo')?.addEventListener('click', () => _cadAbrirForm());
  ['cad-f-sistema','cad-f-tipo','cad-f-status'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', async e => {
      _cadFiltros[id.replace('cad-f-','')] = e.target.value;
      await _cadCarregar();
    });
  });
  document.getElementById('cad-f-inativos')?.addEventListener('change', async e => {
    _cadFiltros.incluirInativos = e.target.checked;
    await _cadCarregar();
  });
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function _cadSetLoading(on) {
  document.getElementById('cad-loading').style.display = on ? 'block' : 'none';
  if (on) document.getElementById('cad-lista').innerHTML = '';
}
function _cadToast(msg, tipo = 'ok') {
  const t = document.getElementById('cad-toast');
  if (!t) return;
  t.textContent     = msg;
  t.style.display   = 'block';
  t.style.borderColor = tipo === 'erro' ? '#f87171' : '#34d399';
  t.style.color       = tipo === 'erro' ? '#f87171' : '#34d399';
  setTimeout(() => { if (t) t.style.display = 'none'; }, 3000);
}
function _cadFmtData(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function _cadFmtValor(c) {
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}).format(c/100);
}
function _cadBtnStyle(cor) {
  return `background:${cor}18;color:${cor};border:1px solid ${cor}40;border-radius:10px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;transition:all .15s`;
}
function _cadBtnMini(cor) {
  return `background:${cor}12;color:${cor};border:1px solid ${cor}30;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap`;
}
function _cadInputStyle() {
  return `width:100%;background:#0f172a;border:1px solid #334155;border-radius:10px;padding:9px 12px;color:#f1f5f9;font-size:13px;font-family:inherit;outline:none;box-sizing:border-box`;
}
function _cadSelectStyle() {
  return `background:#1e293b;border:1px solid #334155;border-radius:10px;padding:7px 12px;color:#94a3b8;font-size:12px;font-family:inherit;cursor:pointer`;
}
function _cadLabelStyle() {
  return `display:block;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px`;
}