/* ==========================================================================
   calendario.js — Radar SIOPE
   Dependências globais:
     window.supabase        → supabase-browser.js
     _solicitarUpgrade()    → verNewsletterComToken.js
   Ponto de entrada:
     window.renderizarCalendario(container, { acesso, edicao })
   ========================================================================== */

'use strict';

// ─── CSS ─────────────────────────────────────────────────────────────────────
(function _injetarCSSCalendario() {
  if (document.getElementById('rs-cal-style')) return;
  const s = document.createElement('style');
  s.id = 'rs-cal-style';
  s.textContent = `
    .rs-cal-root { color: var(--rs-text, #f1f5f9); padding-bottom: 80px; }

    .rs-cal-header {
      position: sticky; top: 0; z-index: 10;
      background: var(--rs-bg, #0f172a);
      padding: 16px 16px 0;
    }

    .rs-cal-view-btn {
      background: transparent; border: none; color: #475569;
      border-radius: 7px; padding: 6px 9px; cursor: pointer;
      font-size: 13px; font-weight: 600; font-family: inherit;
      transition: all .15s;
    }
    .rs-cal-view-btn.ativo { background: #334155; color: var(--rs-text, #f1f5f9); }

    .rs-cal-filtro-btn {
      border-radius: 99px; padding: 6px 12px; font-size: 12px; font-weight: 600;
      cursor: pointer; white-space: nowrap; border: 1px solid transparent;
      background: rgba(255,255,255,.04); color: #475569; font-family: inherit;
      transition: all .15s; flex-shrink: 0;
    }

    .rs-cal-card {
      background: var(--rs-card2, #162032);
      border-radius: 14px; padding: 14px 16px;
      cursor: pointer; margin-bottom: 10px;
      border-left: 3px solid transparent;
      transition: transform .15s;
    }
    .rs-cal-card:active { transform: translateX(3px); }

    .rs-cal-mes-label {
      font-size: 11px; font-weight: 700; color: #475569;
      text-transform: uppercase; letter-spacing: .1em;
      margin-bottom: 12px; padding-left: 4px;
    }

    .rs-cal-mes-bloco {
      background: var(--rs-card2, #162032);
      border-radius: 14px; padding: 14px 16px;
      cursor: pointer; margin-bottom: 0;
      border: 1px solid transparent;
      transition: border-radius .2s;
    }
    .rs-cal-mes-bloco.expandido { border-radius: 14px 14px 0 0; }

    .rs-cal-mes-exp {
      background: #0f172a;
      border-radius: 0 0 14px 14px; padding: 8px;
      border: 1px solid rgba(56,189,248,.1); border-top: none;
      margin-bottom: 8px;
    }

    .rs-cal-chip {
      font-size: 10px; padding: 2px 8px; border-radius: 99px;
      font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
      display: inline-block;
    }
    .rs-cal-urgencia {
      font-size: 11px; padding: 2px 8px; border-radius: 99px; font-weight: 600;
    }

    .rs-cal-horizonte-btn {
      flex: 1; padding: 8px 0; border-radius: 10px;
      border: 1px solid transparent; font-weight: 700; font-size: 13px;
      cursor: pointer; font-family: inherit; background: rgba(255,255,255,.04);
      color: #475569; transition: all .15s;
    }

    .rs-cal-sheet {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 9000;
      background: var(--rs-card, #1e293b);
      border-radius: 24px 24px 0 0;
      padding: 20px 16px 48px;
      max-height: 85vh; overflow-y: auto;
      animation: rsSlideUp .25s ease;
    }
    .rs-cal-backdrop {
      position: fixed; inset: 0; z-index: 8999;
      background: rgba(0,0,0,.6); backdrop-filter: blur(4px);
    }

    .rs-cal-valor-box {
      background: rgba(52,211,153,.08);
      border: 1px solid rgba(52,211,153,.2);
      border-radius: 14px; padding: 14px 16px;
      text-align: center; margin-bottom: 14px;
    }
    .rs-cal-info-box {
      background: #0f172a; border-radius: 12px; padding: 12px 14px;
    }
    .rs-cal-info-label {
      font-size: 10px; color: #475569; text-transform: uppercase;
      letter-spacing: .08em; margin-bottom: 4px;
    }

    .rs-cal-legenda {
      position: fixed; bottom: 0; left: 0; right: 0;
      background: linear-gradient(to top, #0f172a 80%, transparent);
      padding: 14px 16px 20px;
      display: flex; justify-content: center; gap: 12px;
      font-size: 11px; color: #334155; pointer-events: none;
    }
  `;
  document.head.appendChild(s);
})();

// ─── Estado ───────────────────────────────────────────────────────────────────
const _cal = {
  eventos: [],
  repasses: [],   // { evento_id, vl_vaaf, vl_vaat, vl_vaar, vl_sal_educ, status }
  view: 'agenda',
  filtro: 'todos',
  horizonte: 6,
  mesExp: null,
  acesso: {},
  codMunicipio: null, // preenchido no carregamento
};

// ─── Constantes ───────────────────────────────────────────────────────────────
const _CAL_SIS = {
  fundeb: { label: 'FUNDEB', cor: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
  siope: { label: 'SIOPE', cor: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  salario_educacao: { label: 'Salário-Ed.', cor: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  siscacs: { label: 'SISCACS', cor: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
};
const _CAL_TIPOS = {
  repasse: 'Repasse', prazo: 'Prazo',
  reuniao: 'Reunião', mandato: 'Mandato', outro: 'Outro',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _calDiasAte(isoStr) {
  const [y, m, d] = isoStr.split('-').map(Number);
  const alvo = new Date(y, m - 1, d);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return Math.ceil((alvo - hoje) / 86400000);
}
function _calFmtData(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function _calFmtMes(iso) {
  const [y, m] = iso.split('-');
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
function _calFmtMesCurto(d) {
  return d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();
}
function _calFmtValor(c) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', maximumFractionDigits: 0
  }).format(c / 100);
}
function _calValorTotal(ev) {
  const rep = _cal.repasses.find(r => r.evento_id === ev.id);
  if (!rep) return 0;
  return (rep.vl_vaaf || 0) + (rep.vl_vaat || 0) + (rep.vl_vaar || 0) + (rep.vl_sal_educ || 0);
}
function _calMeses(n) {
  const hoje = new Date();
  return Array.from({ length: n }, (_, i) => new Date(hoje.getFullYear(), hoje.getMonth() + i, 1));
}
function _calMesmoMes(isoStr, mesDate) {
  const [y, m] = isoStr.split('-').map(Number);
  return y === mesDate.getFullYear() && m === mesDate.getMonth() + 1;
}

function _calUrgenciaHTML(dias) {
  if (dias < 0) return `<span class="rs-cal-urgencia" style="background:rgba(239,68,68,.15);color:#f87171">Vencido</span>`;
  if (dias === 0) return `<span class="rs-cal-urgencia" style="background:rgba(239,68,68,.15);color:#f87171">Hoje</span>`;
  if (dias <= 3) return `<span class="rs-cal-urgencia" style="background:rgba(239,68,68,.12);color:#f87171">Em ${dias}d</span>`;
  if (dias <= 7) return `<span class="rs-cal-urgencia" style="background:rgba(251,146,60,.15);color:#fb923c">Em ${dias}d</span>`;
  if (dias <= 15) return `<span class="rs-cal-urgencia" style="background:rgba(250,204,21,.12);color:#fbbf24">Em ${dias}d</span>`;
  return `<span class="rs-cal-urgencia" style="background:rgba(148,163,184,.1);color:#94a3b8">Em ${dias}d</span>`;
}
function _calStatusHTML(status) {
  const m = {
    previsto: { c: '#94a3b8', l: 'Previsto' },
    confirmado: { c: '#38bdf8', l: 'Confirmado' },
    realizado: { c: '#34d399', l: 'Realizado' },
  };
  const s = m[status] || m.previsto;
  return `<span class="rs-cal-chip" style="background:${s.c}18;color:${s.c};font-weight:600;text-transform:uppercase">${s.l}</span>`;
}

// ─── Ponto de entrada público ─────────────────────────────────────────────────
async function renderizarCalendario(container, { acesso = {}, edicao = {} } = {}) {
  _cal.acesso = acesso;
  _cal.view = 'agenda';
  _cal.filtro = 'todos';
  _cal.horizonte = 6;
  _cal.mesExp = null;
  _cal.repasses = [];
  // Município: prioridade ao seletor ativo, fallback ao usuário logado
  _cal.codMunicipio = window._municipioAtivo?.cod_municipio
    || window._radarUser?.municipio_cod
    || null;

    console.log('[Calendário] renderizarCalendario chamado. acesso.features:', acesso.features, 'codMunicipio inicial:', _cal.codMunicipio);

  // Verificação de acesso — mesmo padrão de outras features
  const temAcesso = edicao?.features?.calendario || acesso?.features?.calendario;
  if (!temAcesso) {
    _solicitarUpgrade('calendario', acesso?.isAssinante);
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:#475569">
        <div style="font-size:40px;margin-bottom:12px">📅</div>
        <div style="font-size:15px;font-weight:600;color:#64748b;margin-bottom:8px">Calendário de Datas Importantes</div>
        <div style="font-size:13px;color:#475569">Disponível nos planos Essence e superiores</div>
      </div>`;
    // Expõe atualização para o seletor de município
    window._calAtualizarMunicipio = async (codMunicipio) => {
      _cal.codMunicipio = codMunicipio;
      _cal.mesExp = null;
      await _calCarregar();
    };
    return;
  }

  container.innerHTML = _calShellHTML();

  // Expõe para o seletor de município — mesmo para quem tem acesso
  window._calAtualizarMunicipio = async (codMunicipio) => {
    _cal.codMunicipio = codMunicipio;
    _cal.mesExp = null;
    await _calCarregar();
  };

  await _calCarregar();
}

// ─── Carregamento ─────────────────────────────────────────────────────────────
async function _calCarregar() {
  const cont = document.getElementById('rs-cal-conteudo');
  if (cont) cont.innerHTML = '<p style="color:#64748b;text-align:center;padding:40px">Carregando...</p>';

  const hoje = new Date().toISOString().split('T')[0];
  const fim = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 12);
    return d.toISOString().split('T')[0];
  })();

  // Busca paralela: eventos + repasses do município
  const queries = [
    window.supabase
      .from('calendario_eventos')
      .select('*')
      .gte('data', hoje)
      .lte('data', fim)
      .order('data', { ascending: true }),
  ];

  if (_cal.codMunicipio) {
    queries.push(
      window.supabase
        .from('calendario_repasses')
        .select('*')
        .eq('cod_municipio', _cal.codMunicipio)
    );
  }
  console.log('[Calendário] Carregando eventos e repasses para município:', _cal.codMunicipio);

  const [evRes, repRes] = await Promise.all(queries);

  if (evRes.error) {
    if (cont) cont.innerHTML =
      `<p style="color:#f87171;padding:20px;text-align:center">Erro: ${evRes.error.message}</p>`;
    return;
  }

  _cal.eventos = evRes.data || [];
  _cal.repasses = repRes?.data || [];
  _calRenderizar();
}

// ─── Shell HTML ───────────────────────────────────────────────────────────────
function _calShellHTML() {
  return `
  <div class="rs-cal-root">
    <div class="rs-cal-header">

      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
        <div>
          <div style="font-size:10px;color:#475569;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px">Central</div>
          <div style="font-size:21px;font-weight:700;letter-spacing:-.02em;color:var(--rs-text,#f1f5f9)">Calendário</div>
        </div>
        <div style="background:#1e293b;border-radius:10px;padding:3px;display:flex;gap:2px">
          ${[['agenda', '≡'], ['sistema', '⊞'], ['geral', '◎'], ['repasses', '₿']].map(([v, ic]) => `
          <button class="rs-cal-view-btn${_cal.view === v ? ' ativo' : ''}"
            id="rs-cal-vbtn-${v}" onclick="_calSetView('${v}')">${ic}</button>`).join('')}
        </div>
      </div>

      <div id="rs-cal-prox"></div>
      <div id="rs-cal-filtros" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:10px;scrollbar-width:none;-webkit-overflow-scrolling:touch"></div>
      <div id="rs-cal-hint" style="font-size:11px;color:#475569;margin-bottom:10px;display:none"></div>
    </div>

    <div id="rs-cal-conteudo" style="padding:8px 16px"></div>

    <div id="rs-cal-legenda" class="rs-cal-legenda" style="display:none">
      ${[['#f87171', '≤3d'], ['#fb923c', '≤7d'], ['#fbbf24', '≤15d'], ['#64748b', '+15d']].map(([c, l]) => `
      <span style="display:flex;align-items:center;gap:4px">
        <span style="width:7px;height:7px;background:${c};border-radius:50%;display:inline-block"></span>${l}
      </span>`).join('')}
    </div>
  </div>`;
}

// ─── Renderização principal ───────────────────────────────────────────────────
function _calRenderizar() {
  const ordenados = [..._cal.eventos].sort((a, b) => a.data < b.data ? -1 : 1);
  const filtrados = _cal.filtro === 'todos'
    ? ordenados
    : ordenados.filter(e => e.sistema === _cal.filtro);
  const prox = filtrados[0];

  // Próximo evento
  const proxEl = document.getElementById('rs-cal-prox');
  if (proxEl) {
    const mostrar = _cal.view !== 'geral' && _cal.view !== 'repasses' && prox;
    proxEl.innerHTML = mostrar ? _calProxHTML(prox) : '';
  }

  // Filtros
  const filtrosEl = document.getElementById('rs-cal-filtros');
  if (filtrosEl) {
    filtrosEl.innerHTML = (_cal.view === 'geral' || _cal.view === 'repasses')
      ? '' : _calFiltrosHTML();
  }

  // Hint
  const hint = document.getElementById('rs-cal-hint');
  if (hint) {
    const hints = {
      geral: 'Visão geral · toque em um mês para expandir',
      repasses: 'Fluxo de repasses · toque em um mês para ver detalhes',
    };
    hint.style.display = hints[_cal.view] ? 'block' : 'none';
    hint.textContent = hints[_cal.view] || '';
  }

  // Legenda
  const leg = document.getElementById('rs-cal-legenda');
  if (leg) leg.style.display = _cal.view === 'agenda' ? 'flex' : 'none';

  // Conteúdo
  const cont = document.getElementById('rs-cal-conteudo');
  if (!cont) return;
  switch (_cal.view) {
    case 'agenda': cont.innerHTML = _calViewAgenda(filtrados); break;
    case 'sistema': cont.innerHTML = _calViewSistema(filtrados); break;
    case 'geral': cont.innerHTML = _calViewGeral(ordenados); break;
    case 'repasses': cont.innerHTML = _calViewRepasses(ordenados); break;
  }
}

// ─── Próximo evento ───────────────────────────────────────────────────────────
function _calProxHTML(ev) {
  const s = _CAL_SIS[ev.sistema] || {};
  const dias = _calDiasAte(ev.data);
  return `
  <div onclick="_calAbrirSheet('${ev.id}')"
    style="background:linear-gradient(135deg,${s.cor}18,${s.cor}08);border:1px solid ${s.cor}30;
           border-radius:14px;padding:12px 14px;margin-bottom:12px;cursor:pointer">
    <div style="font-size:10px;color:${s.cor};font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Próximo evento</div>
    <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-bottom:4px">${ev.titulo}</div>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:11px;color:#64748b">${_calFmtData(ev.data)}</span>
      ${_calUrgenciaHTML(dias)}
    </div>
  </div>`;
}

// ─── Filtros ──────────────────────────────────────────────────────────────────
function _calFiltrosHTML() {
  const opts = [
    ['todos', 'Todos', '#94a3b8', 'rgba(148,163,184,0.15)'],
    ...Object.entries(_CAL_SIS).map(([k, v]) => [k, v.label, v.cor, v.bg]),
  ];
  return opts.map(([k, l, cor, bg]) => {
    const ativo = _cal.filtro === k;
    return `<button class="rs-cal-filtro-btn"
      onclick="_calSetFiltro('${k}')"
      style="${ativo ? `background:${bg};color:${cor};border-color:${cor}40` : ''}">${l}</button>`;
  }).join('');
}

// ─── Card de evento ───────────────────────────────────────────────────────────
function _calCardHTML(ev) {
  const s = _CAL_SIS[ev.sistema] || {};
  const dias = _calDiasAte(ev.data);
  const isRep = ev.tipo === 'repasse';
  const total = _calValorTotal(ev);
  return `
  <div class="rs-cal-card" onclick="_calAbrirSheet('${ev.id}')" style="border-left-color:${s.cor}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <span class="rs-cal-chip" style="background:${s.bg};color:${s.cor}">${s.label || ev.sistema}</span>
        <span class="rs-cal-chip" style="background:rgba(255,255,255,.05);color:#64748b;font-weight:500;text-transform:none;letter-spacing:0">
          ${_CAL_TIPOS[ev.tipo] || ev.tipo}
        </span>
      </div>
      ${isRep ? _calStatusHTML(ev.status) : _calUrgenciaHTML(dias)}
    </div>
    <div style="font-weight:600;color:var(--rs-text,#f1f5f9);font-size:14px;margin-bottom:6px;line-height:1.3">${ev.titulo}</div>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:12px;color:#64748b">📅 ${_calFmtData(ev.data)}</span>
      ${isRep && total ? `<span style="font-size:13px;font-weight:700;color:#34d399">${_calFmtValor(total)}</span>` : ''}
    </div>
  </div>`;
}

// ─── View: Agenda ─────────────────────────────────────────────────────────────
function _calViewAgenda(eventos) {
  if (!eventos.length)
    return '<p style="color:#475569;text-align:center;padding:40px">Nenhum evento encontrado.</p>';

  const grupos = {};
  eventos.forEach(ev => {
    const k = _calFmtMes(ev.data);
    if (!grupos[k]) grupos[k] = [];
    grupos[k].push(ev);
  });

  return Object.entries(grupos).map(([mes, evs]) => `
    <div style="margin-bottom:24px">
      <div class="rs-cal-mes-label">${mes}</div>
      ${evs.map(_calCardHTML).join('')}
    </div>`).join('');
}

// ─── View: Por sistema ────────────────────────────────────────────────────────
function _calViewSistema(eventos) {
  if (!eventos.length)
    return '<p style="color:#475569;text-align:center;padding:40px">Nenhum evento encontrado.</p>';

  return Object.entries(_CAL_SIS).map(([sis, s]) => {
    const evs = eventos.filter(e => e.sistema === sis);
    if (!evs.length) return '';
    return `
    <div style="margin-bottom:28px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <div style="width:3px;height:18px;background:${s.cor};border-radius:2px"></div>
        <span style="font-size:13px;font-weight:700;color:${s.cor};text-transform:uppercase;letter-spacing:.06em">${s.label}</span>
        <span style="font-size:11px;color:#475569;background:rgba(255,255,255,.05);border-radius:99px;padding:1px 7px">${evs.length}</span>
      </div>
      ${evs.map(_calCardHTML).join('')}
    </div>`;
  }).join('');
}

// ─── View: Visão Geral ────────────────────────────────────────────────────────
function _calViewGeral(eventos) {
  const meses = _calMeses(_cal.horizonte);

  const resumos = Object.entries(_CAL_SIS).map(([sis, s]) => {
    const evs = eventos.filter(e => e.sistema === sis);
    const rep = evs.filter(e => e.tipo === 'repasse').length;
    const praz = evs.filter(e => e.tipo !== 'repasse').length;
    return `
    <div style="background:var(--rs-card2,#162032);border-radius:14px;padding:12px 14px;border-top:2px solid ${s.cor}">
      <div style="font-size:10px;color:${s.cor};font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">${s.label}</div>
      <div style="font-size:22px;font-weight:700;color:var(--rs-text,#f1f5f9);margin-bottom:4px">${evs.length}</div>
      <div style="display:flex;gap:6px">
        ${rep > 0 ? `<span style="font-size:10px;color:#64748b">💰 ${rep} rep.</span>` : ''}
        ${praz > 0 ? `<span style="font-size:10px;color:#64748b">📋 ${praz} praz.</span>` : ''}
      </div>
    </div>`;
  }).join('');

  const linhas = meses.map((md, idx) => {
    const evsMes = eventos.filter(e => _calMesmoMes(e.data, md)).sort((a, b) => a.data < b.data ? -1 : 1);
    const isExp = _cal.mesExp === idx;
    const isAt = _calMesmoMes(new Date().toISOString().split('T')[0], md);
    const porSis = Object.entries(_CAL_SIS)
      .map(([k, v]) => ({ k, v, evs: evsMes.filter(e => e.sistema === k) }))
      .filter(x => x.evs.length);

    return `
    <div style="margin-bottom:8px">
      <div class="rs-cal-mes-bloco${isExp ? ' expandido' : ''}"
        onclick="_calToggleMes(${idx})"
        style="background:${isAt ? 'rgba(56,189,248,.07)' : 'var(--rs-card2,#162032)'};
               border-color:${isAt ? 'rgba(56,189,248,.25)' : 'transparent'}">

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${evsMes.length ? '10px' : '0'}">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:13px;font-weight:700;color:${isAt ? '#38bdf8' : 'var(--rs-text,#f1f5f9)'}">
              ${_calFmtMesCurto(md)}
            </span>
            ${isAt ? '<span style="font-size:9px;color:#38bdf8;background:rgba(56,189,248,.15);border-radius:99px;padding:1px 6px;font-weight:700">MÊS ATUAL</span>' : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:12px;color:#475569">${evsMes.length} evento${evsMes.length !== 1 ? 's' : ''}</span>
            <span style="color:#334155;font-size:12px">${isExp ? '▲' : '▼'}</span>
          </div>
        </div>

        ${evsMes.length ? `
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">
          ${porSis.map(({ v, evs }) => `
          <div style="background:${v.bg};border-radius:6px;padding:3px 8px;display:flex;align-items:center;gap:4px">
            <div style="width:6px;height:6px;border-radius:50%;background:${v.cor}"></div>
            <span style="font-size:10px;color:${v.cor};font-weight:600">${evs.length}</span>
          </div>`).join('')}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${evsMes.map(ev => {
      const s = _CAL_SIS[ev.sistema] || {};
      return `<div style="background:${s.cor}20;border:1px solid ${s.cor}40;border-radius:8px;padding:3px 8px;display:flex;align-items:center;gap:4px">
              <span style="font-size:10px">${ev.tipo === 'repasse' ? '💰' : '📋'}</span>
              <span style="font-size:10px;color:${s.cor};font-weight:600">dia ${ev.data.split('-')[2]}</span>
            </div>`;
    }).join('')}
        </div>` : '<div style="font-size:12px;color:#334155">Sem eventos registrados</div>'}
      </div>
      ${isExp && evsMes.length ? `<div class="rs-cal-mes-exp">${evsMes.map(_calCardHTML).join('')}</div>` : ''}
    </div>`;
  }).join('');

  return `
  ${_calHorizonteHTML('#38bdf8')}
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px">${resumos}</div>
  <div class="rs-cal-mes-label" style="margin-bottom:12px">Linha do tempo</div>
  ${linhas}`;
}

// ─── View: Repasses ───────────────────────────────────────────────────────────
function _calViewRepasses(eventos) {
  const repasses = eventos.filter(e => e.tipo === 'repasse');
  const meses = _calMeses(_cal.horizonte);
  const totaisMens = meses.map(md => repasses.filter(e => _calMesmoMes(e.data, md)).reduce((a, e) => a + _calValorTotal(e), 0));
  const totalGeral = totaisMens.reduce((a, v) => a + v, 0);
  const maxMes = Math.max(...totaisMens, 1);

  const porSisTotal = Object.entries(_CAL_SIS).map(([sis, s]) => {
    const evs = repasses.filter(e => e.sistema === sis);
    const total = evs.reduce((a, e) => a + _calValorTotal(e), 0);
    return { s, total, qtd: evs.length };
  }).filter(x => x.total > 0);

  const barraGeral = porSisTotal.map(({ s, total }) =>
    `<div style="flex:${total};background:${s.cor};opacity:.85"></div>`).join('');

  const resumos = porSisTotal.map(({ s, total, qtd }) => `
    <div style="background:var(--rs-card2,#162032);border-radius:14px;padding:12px 14px;border-top:2px solid ${s.cor}">
      <div style="font-size:10px;color:${s.cor};font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">${s.label}</div>
      <div style="font-size:16px;font-weight:700;color:var(--rs-text,#f1f5f9);margin-bottom:2px">${_calFmtValor(total)}</div>
      <div style="font-size:11px;color:#475569">${qtd} repasse${qtd !== 1 ? 's' : ''}</div>
    </div>`).join('');

  const linhas = meses.map((md, idx) => {
    const evsMes = repasses.filter(e => _calMesmoMes(e.data, md)).sort((a, b) => a.data < b.data ? -1 : 1);
    const total = totaisMens[idx];
    const pct = total / maxMes;
    const isAt = _calMesmoMes(new Date().toISOString().split('T')[0], md);
    const isExp = _cal.mesExp === idx;

    const barraRep = evsMes.map(ev => {
      const s = _CAL_SIS[ev.sistema] || {};
      return `<div style="flex:${_calValorTotal(ev)};background:${s.cor};opacity:.85"></div>`;
    }).join('');

    return `
    <div style="margin-bottom:8px">
      <div class="rs-cal-mes-bloco${isExp ? ' expandido' : ''}"
        onclick="_calToggleMes(${idx})"
        style="background:${isAt ? 'rgba(52,211,153,.06)' : 'var(--rs-card2,#162032)'};
               border-color:${isAt ? 'rgba(52,211,153,.2)' : 'transparent'}">

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:13px;font-weight:700;color:${isAt ? '#34d399' : 'var(--rs-text,#f1f5f9)'}">
              ${_calFmtMesCurto(md)}
            </span>
            ${isAt ? '<span style="font-size:9px;color:#34d399;background:rgba(52,211,153,.15);border-radius:99px;padding:1px 6px;font-weight:700">MÊS ATUAL</span>' : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:15px;font-weight:700;color:#34d399">${total ? _calFmtValor(total) : '—'}</span>
            <span style="color:#334155;font-size:12px">${isExp ? '▲' : '▼'}</span>
          </div>
        </div>

        ${total ? `
        <div style="background:rgba(255,255,255,.05);border-radius:99px;height:6px;overflow:hidden;margin-bottom:8px">
          <div style="display:flex;height:100%;width:${Math.round(pct * 100)}%;border-radius:99px;overflow:hidden">${barraRep}</div>
        </div>` : ''}

        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${evsMes.map(ev => {
      const s = _CAL_SIS[ev.sistema] || {};
      return `<div style="background:${s.cor}18;border:1px solid ${s.cor}30;border-radius:8px;padding:3px 9px;display:flex;align-items:center;gap:5px">
              <div style="width:5px;height:5px;border-radius:50%;background:${s.cor}"></div>
              <span style="font-size:10px;color:${s.cor};font-weight:600">${s.label.split('-')[0].trim()} dia ${ev.data.split('-')[2]}</span>
            </div>`;
    }).join('')}
          ${!evsMes.length ? '<span style="font-size:12px;color:#334155">Sem repasses neste mês</span>' : ''}
        </div>
      </div>
      ${isExp && evsMes.length ? `<div class="rs-cal-mes-exp">${evsMes.map(_calCardHTML).join('')}</div>` : ''}
    </div>`;
  }).join('');

  return `
  ${_calHorizonteHTML('#34d399')}

  <div style="background:linear-gradient(135deg,rgba(52,211,153,.12),rgba(56,189,248,.08));
              border:1px solid rgba(52,211,153,.25);border-radius:18px;padding:20px;margin-bottom:16px">
    <div style="font-size:11px;color:#34d399;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">
      Total previsto — ${_cal.horizonte} meses
    </div>
    <div style="font-size:32px;font-weight:700;color:var(--rs-text,#f1f5f9);letter-spacing:-.03em;margin-bottom:14px">
      ${_calFmtValor(totalGeral)}
    </div>
    <div style="display:flex;border-radius:8px;overflow:hidden;height:8px;margin-bottom:12px">${barraGeral}</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      ${porSisTotal.map(({ s, total }) => `
      <div style="display:flex;align-items:center;gap:5px">
        <div style="width:8px;height:8px;border-radius:50%;background:${s.cor}"></div>
        <span style="font-size:11px;color:#94a3b8">${s.label}</span>
        <span style="font-size:11px;color:#64748b">${_calFmtValor(total)}</span>
      </div>`).join('')}
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px">${resumos}</div>
  <div class="rs-cal-mes-label" style="margin-bottom:12px">Mês a mês</div>
  ${linhas}`;
}

// ─── Selector de horizonte ────────────────────────────────────────────────────
function _calHorizonteHTML(cor) {
  const rgb = cor === '#34d399' ? '52,211,153' : '56,189,248';
  return `
  <div style="display:flex;gap:6px;margin-bottom:20px">
    ${[3, 6, 12].map(h => `
    <button class="rs-cal-horizonte-btn" onclick="_calSetHorizonte(${h})"
      style="${_cal.horizonte === h ? `background:rgba(${rgb},.15);border-color:${cor}40;color:${cor}` : ''}">
      ${h} meses
    </button>`).join('')}
  </div>`;
}

// ─── Bottom sheet ─────────────────────────────────────────────────────────────
window._calAbrirSheet = function (id) {
  const ev = _cal.eventos.find(e => e.id === id);
  if (!ev) return;

  document.getElementById('rs-cal-backdrop')?.remove();
  document.getElementById('rs-cal-sheet')?.remove();

  const s = _CAL_SIS[ev.sistema] || {};
  const dias = _calDiasAte(ev.data);
  const rep = _cal.repasses.find(r => r.evento_id === ev.id);
  const total = rep ? (rep.vl_vaaf || 0) + (rep.vl_vaat || 0) + (rep.vl_vaar || 0) + (rep.vl_sal_educ || 0) : 0;

  const valRows = rep ? [
    rep.vl_vaaf && ['VAAF', rep.vl_vaaf],
    rep.vl_vaat && ['VAAT', rep.vl_vaat],
    rep.vl_vaar && ['VAAR', rep.vl_vaar],
    rep.vl_sal_educ && ['Salário-Ed.', rep.vl_sal_educ],
  ].filter(Boolean) : [];

  // status do repasse vem do _cal.repasses, não do evento
  const statusRepasse = rep?.status || ev.status;

  const backdrop = document.createElement('div');
  backdrop.id = 'rs-cal-backdrop';
  backdrop.className = 'rs-cal-backdrop';
  backdrop.onclick = window._calFecharSheet;
  document.body.appendChild(backdrop);

  const sheet = document.createElement('div');
  sheet.id = 'rs-cal-sheet';
  sheet.className = 'rs-cal-sheet';
  sheet.style.borderTop = `1px solid ${s.cor}30`;
  sheet.innerHTML = `
    <div style="width:36px;height:4px;background:#334155;border-radius:99px;margin:0 auto 20px"></div>

    <div style="display:flex;gap:6px;margin-bottom:14px">
      <span class="rs-cal-chip" style="background:${s.bg};color:${s.cor}">${s.label || ev.sistema}</span>
      <span class="rs-cal-chip" style="background:rgba(255,255,255,.05);color:#94a3b8;font-weight:500;text-transform:none;letter-spacing:0">
        ${_CAL_TIPOS[ev.tipo] || ev.tipo}
      </span>
    </div>

    <div style="font-size:18px;font-weight:700;color:var(--rs-text,#f1f5f9);margin-bottom:8px;line-height:1.3">${ev.titulo}</div>
    ${ev.descricao ? `<div style="font-size:13px;color:#94a3b8;line-height:1.6;margin-bottom:16px">${ev.descricao}</div>` : '<div style="margin-bottom:16px"></div>'}

    ${total ? `
    <div class="rs-cal-valor-box">
      <div style="font-size:10px;color:#34d399;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Valor previsto</div>
      <div style="font-size:28px;font-weight:700;color:#34d399;letter-spacing:-.02em;margin-bottom:${valRows.length > 1 ? '12px' : '0'}">${_calFmtValor(total)}</div>
      ${valRows.length > 1 ? `
      <div style="text-align:left;border-top:1px solid rgba(52,211,153,.15);padding-top:10px">
        ${valRows.map(([label, val]) => `
        <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)">
          <span style="font-size:12px;color:#64748b">${label}</span>
          <span style="font-size:12px;font-weight:600;color:#34d399">${_calFmtValor(val)}</span>
        </div>`).join('')}
      </div>` : ''}
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div class="rs-cal-info-box">
        <div class="rs-cal-info-label">Data</div>
        <div style="font-size:14px;color:#e2e8f0;font-weight:600">${_calFmtData(ev.data)}</div>
      </div>
      <div class="rs-cal-info-box">
        <div class="rs-cal-info-label">${ev.tipo === 'repasse' ? 'Status' : 'Prazo'}</div>
        <div style="font-size:14px;font-weight:600">
          ${ev.tipo === 'repasse'
      ? `<span style="color:${{ realizado: '#34d399', confirmado: '#38bdf8', previsto: '#94a3b8' }[statusRepasse] || '#94a3b8'}">
                ${{ previsto: 'Previsto', confirmado: 'Confirmado', realizado: 'Realizado' }[statusRepasse] || statusRepasse}
               </span>`
      : `<span style="color:${dias < 0 ? '#f87171' : dias <= 7 ? '#fb923c' : '#94a3b8'}">
                ${dias < 0 ? 'Vencido' : dias === 0 ? 'Hoje' : `Em ${dias}d`}
               </span>`
    }
        </div>
      </div>
    </div>

    ${ev.avisos_antecipados?.length ? `
    <div class="rs-cal-info-box">
      <div class="rs-cal-info-label" style="margin-bottom:8px">Avisos configurados</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${ev.avisos_antecipados.map(a => `
        <span class="rs-cal-chip" style="background:rgba(167,139,250,.12);color:#a78bfa;font-weight:600">${a}d antes</span>`).join('')}
      </div>
    </div>` : ''}`;

  document.body.appendChild(sheet);
};

window._calFecharSheet = function () {
  document.getElementById('rs-cal-backdrop')?.remove();
  document.getElementById('rs-cal-sheet')?.remove();
};

// ─── Controles globais ────────────────────────────────────────────────────────
window._calSetView = function (v) {
  _cal.view = v;
  _cal.mesExp = null;
  document.querySelectorAll('.rs-cal-view-btn').forEach(b => b.classList.remove('ativo'));
  document.getElementById(`rs-cal-vbtn-${v}`)?.classList.add('ativo');
  _calRenderizar();
};
window._calSetFiltro = f => { _cal.filtro = f; _calRenderizar(); };
window._calSetHorizonte = h => { _cal.horizonte = h; _cal.mesExp = null; _calRenderizar(); };
window._calToggleMes = i => { _cal.mesExp = _cal.mesExp === i ? null : i; _calRenderizar(); };

// ─── Expo ─────────────────────────────────────────────────────────────────────
window.renderizarCalendario = renderizarCalendario;
