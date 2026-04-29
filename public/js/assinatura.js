/* ==========================================================================
assinatura.js — Radar SIOPE
Fluxo completo de assinatura: planos, ciclos dinâmicos (tabs horizontais), WhatsApp,
cupom, preview, upsert usuário, registro assinatura, pagamento MP.
Dependências globais:
window.db (Firestore inicializado)
inserirCamposUfMunicipio, aplicarMascaraTelefone (functions.js)
validarEmail, validarTelefoneFormato, mostrarMensagem (functions.js)
validateValorEParcelas (functions.js)
firebase.firestore.FieldValue (Firebase SDK)
========================================================================== */
'use strict';

// ─── Parâmetros de URL ────────────────────────────────────────────────────────
function getParam(nome) {
  return new URL(window.location.href).searchParams.get(nome);
}
const _origem      = getParam('origem') || 'direto';
const _planIdUrl   = getParam('planId') || null;
const _leadIdUrl   = getParam('leadId') || getParam('idLead') || null;

// ─── Estado global da sessão ──────────────────────────────────────────────────
let _planoAtual    = null;       // objeto completo do plano selecionado + cicloSelecionado
let _tiposMap      = {};         // id -> nome dos tipos de newsletter
let _cupomAplicado = null;       // objeto cupom validado
let _planosCache   = {};         // cache local de planos

// ─── Estado de seleção extra de municípios ────────────────────────────────────
let _municipiosDisponiveis        = [];
let _municipiosExtrasSelecionados = [];
let _ufAtual                      = null;

// ─── UI de municípios adicionais (dropdown com busca) ─────────────────────────
async function configurarUIMunicipiosExtra() {
  // Garante container
  if (!document.getElementById('container-municipios-extra')) {
    const wrap = document.createElement('div');
    wrap.id = 'container-municipios-extra';
    wrap.style.marginTop = '16px';
    const refNode = document.getElementById('campo-uf-municipio')?.parentNode || document.body;
    refNode.appendChild(wrap);
  }

  // HTML do dropdown
  document.getElementById('container-municipios-extra').innerHTML = `
    <label style="font-weight:600;margin-bottom:6px;display:block;font-size:14px;">
      📍 Municípios adicionais do plano que aparecerão nos painéis de indicadores
    </label>
    <div id="municipios-aviso" style="font-size:12px;color:#64748b;margin-bottom:8px;">
      Selecione seu estado acima para liberar a escolha.
    </div>
    <div id="municipios-dropdown-wrap" style="position:relative;width:100%;">
      <button type="button" id="municipios-trigger" style="
        width:100%;text-align:left;padding:9px 32px 9px 12px;
        border:1px solid #cbd5e1;border-radius:8px;background:#ffffff;
        font-size:13px;color:#1e293b;cursor:pointer;position:relative;
        font-family:inherit;">
        Nenhum município adicional selecionado
        <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);
                     font-size:10px;color:#64748b;pointer-events:none;">▼</span>
      </button>
      <div id="municipios-panel" style="
        display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:9999;
        background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;
        box-shadow:0 4px 16px rgba(0,0,0,0.12);max-height:240px;
        overflow:hidden;display:none;flex-direction:column;">
        <div style="padding:8px;border-bottom:1px solid #e2e8f0;flex-shrink:0;">
          <input type="text" id="municipios-busca" placeholder="Buscar município…" style="
            width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;
            font-size:13px;color:#1e293b;background:#f8fafc;
            box-sizing:border-box;outline:none;font-family:inherit;">
        </div>
        <div id="municipios-lista" style="overflow-y:auto;max-height:180px;"></div>
      </div>
    </div>
    <div id="municipios-limit-info" style="font-size:11px;color:#64748b;margin-top:6px;"></div>
  `;

  const triggerEl = document.getElementById('municipios-trigger');
  const panelEl   = document.getElementById('municipios-panel');
  const listaEl   = document.getElementById('municipios-lista');
  const buscaEl   = document.getElementById('municipios-busca');
  const infoEl    = document.getElementById('municipios-limit-info');
  const avisoEl   = document.getElementById('municipios-aviso');

  // ── Abre/fecha painel ────────────────────────────────────────────────────────
  triggerEl.addEventListener('click', () => {
    const aberto = panelEl.style.display === 'flex';
    panelEl.style.display = aberto ? 'none' : 'flex';
    if (!aberto) setTimeout(() => buscaEl.focus(), 50);
  });

  // Fecha ao clicar fora
  document.addEventListener('click', (e) => {
    if (!document.getElementById('municipios-dropdown-wrap')?.contains(e.target)) {
      panelEl.style.display = 'none';
    }
  });

  // ── Atualiza label do trigger ────────────────────────────────────────────────
  function _atualizarTrigger() {
    const maxExtras = Math.max(0, (_planoAtual?.features?.max_municipios || 1) - 1);
    const n = _municipiosExtrasSelecionados.length;
    // Atualiza só o texto (primeiro filho text node)
    triggerEl.childNodes[0].textContent = n === 0
      ? 'Nenhum município adicional selecionado'
      : `${n} município(s) adicional(is) selecionado(s)`;
    infoEl.textContent = `Selecionados: ${n} / ${maxExtras}`;
  }

  // ── Carrega municípios do Firestore por UF ───────────────────────────────────
  async function carregarMunicipiosPorUF(ufId) {
    if (!ufId) {
      avisoEl.style.display = 'block';
      panelEl.style.display = 'none';
      listaEl.innerHTML = '';
      infoEl.textContent = '';
      _municipiosDisponiveis = [];
      return;
    }
    avisoEl.style.display = 'none';
    listaEl.innerHTML = '<div style="padding:10px 12px;font-size:12px;color:#64748b;">Carregando…</div>';
    try {
      const snap = await db.collection('UF').doc(ufId.trim().toUpperCase()).collection('Municipio').get();
      _municipiosDisponiveis = snap.docs.map(d => {
        const data = d.data();
        const nome = data.nome_municipio || data.nome || data.municipio || data.nomeMunicipio || '';
        return {
          cod_municipio: String(data.cod_municipio || data.codigo || d.id),
          nome: String(nome).trim() || `Município ${d.id}`,
          uf: data.uf || ufId,
        };
      });
      renderGrid();
    } catch (e) {
      console.error('[municipios-extra] Erro ao carregar:', e);
      listaEl.innerHTML = '<div style="padding:10px 12px;font-size:12px;color:#c00;">Erro ao carregar.</div>';
      _municipiosDisponiveis = [];
    }
  }

  // ── Renderiza lista do painel ────────────────────────────────────────────────
  const renderGrid = (termo = '') => {
    const maxExtras = Math.max(0, (_planoAtual?.features?.max_municipios || 1) - 1);

    if (maxExtras <= 0) {
      listaEl.innerHTML = '<div style="padding:10px 12px;font-size:12px;color:#64748b;">Este plano não permite municípios adicionais.</div>';
      _municipiosExtrasSelecionados = [];
      return;
    }

    const principal = document.getElementById('municipio')?.value || null;
    const filtro    = termo.toLowerCase();
    const lista     = _municipiosDisponiveis.filter(m =>
      m.cod_municipio !== principal &&
      (!filtro || m.nome.toLowerCase().includes(filtro) || m.cod_municipio.includes(filtro))
    );

    if (_municipiosDisponiveis.length === 0) {
      listaEl.innerHTML = '';
      return;
    }
    if (lista.length === 0) {
      listaEl.innerHTML = '<div style="padding:10px 12px;font-size:12px;color:#64748b;">Nenhum resultado.</div>';
      return;
    }

    listaEl.innerHTML = lista.map(m => {
      const selecionado = _municipiosExtrasSelecionados.includes(m.cod_municipio);
      const limitingindo = !selecionado && _municipiosExtrasSelecionados.length >= maxExtras;
      return `
        <div data-cod="${m.cod_municipio}" style="
          display:flex;align-items:center;gap:10px;
          padding:8px 12px;cursor:${limitingindo ? 'not-allowed' : 'pointer'};
          background:${selecionado ? '#eff6ff' : '#ffffff'};
          opacity:${limitingindo ? '0.45' : '1'};
          border-bottom:1px solid #f1f5f9;
          user-select:none;">
          <input type="checkbox"
            ${selecionado ? 'checked' : ''}
            ${limitingindo ? 'disabled' : ''}
            style="width:15px;height:15px;flex-shrink:0;accent-color:#0A3D62;cursor:pointer;"
            onclick="event.stopPropagation()">
          <span style="font-size:13px;color:#1e293b;font-family:inherit;line-height:1.4;">
            ${m.nome}
            <span style="font-size:11px;color:#64748b;">— ${m.uf}</span>
          </span>
        </div>`;
    }).join('');

    // Delegação de eventos — um único listener na lista
    listaEl._handler && listaEl.removeEventListener('click', listaEl._handler);
    listaEl._handler = (e) => {
      const row = e.target.closest('[data-cod]');
      if (!row) return;
      const cod = row.dataset.cod;
      const cb  = row.querySelector('input[type="checkbox"]');
      if (cb?.disabled) {
        mostrarMensagem(`Limite de ${maxExtras} município(s) adicional(is) atingido.`);
        return;
      }
      const idx = _municipiosExtrasSelecionados.indexOf(cod);
      if (idx >= 0) {
        _municipiosExtrasSelecionados.splice(idx, 1);
      } else {
        if (_municipiosExtrasSelecionados.length >= maxExtras) {
          mostrarMensagem(`Limite de ${maxExtras} município(s) adicional(is) atingido.`);
          return;
        }
        _municipiosExtrasSelecionados.push(cod);
      }
      _atualizarTrigger();
      renderGrid(buscaEl.value);
    };
    listaEl.addEventListener('click', listaEl._handler);
  };

  // Busca em tempo real
  buscaEl.addEventListener('input', (e) => renderGrid(e.target.value));

  // ── Re-renderiza quando município principal muda ──────────────────────────────
  const bindMunListener = () => {
    const munSelect = document.getElementById('municipio');
    if (munSelect) {
      munSelect.addEventListener('change', () => {
        _municipiosExtrasSelecionados = [];
        _atualizarTrigger();
        renderGrid(buscaEl.value);
      });
      return true;
    }
    return false;
  };
  if (!bindMunListener()) {
    const waitMun = new MutationObserver(() => { if (bindMunListener()) waitMun.disconnect(); });
    waitMun.observe(document.body, { childList: true, subtree: true });
  }

  // ── Dispara carga ao trocar UF ────────────────────────────────────────────────
  const triggerLoad = async () => {
    const novaUF = document.getElementById('uf')?.value || null;
    if (novaUF && novaUF !== _ufAtual) {
      _ufAtual = novaUF;
      _municipiosExtrasSelecionados = [];
      _atualizarTrigger();
      await carregarMunicipiosPorUF(_ufAtual);
    }
  };

  const ufSelect = document.getElementById('uf');
  if (ufSelect) {
    ufSelect.addEventListener('change', triggerLoad);
  } else {
    const waitUF = new MutationObserver(() => {
      const s = document.getElementById('uf');
      if (s) { s.addEventListener('change', triggerLoad); waitUF.disconnect(); }
    });
    waitUF.observe(document.body, { childList: true, subtree: true });
  }

  // Expõe para atualizar limites ao trocar de plano
  window._atualizarGridMunicipios = () => {
    _atualizarTrigger();
    renderGrid(buscaEl?.value || '');
  };

  setTimeout(triggerLoad, 150);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtBRL(v) {
  const n = Number(v);
  if (isNaN(n) || v === null || v === undefined) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function safeNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function getDescontoPct(plano, cicloMeses) {
  if (!plano) return 0;
  const c = String(cicloMeses);
  if (plano.descontos_por_ciclo && plano.descontos_por_ciclo[c] !== undefined) {
    return Number(plano.descontos_por_ciclo[c]) || 0;
  }
  if (c === '6')  return Number(plano.desconto_pct_6m)  || 0;
  if (c === '12') return Number(plano.desconto_pct_12m) || 0;
  return 0;
}

function getPrecoPlano(plano, cicloMeses) {
  if (!plano) return 0;
  const base = Number(plano.valor_mensal) || Number(plano.valor) || 0;
  const pct  = getDescontoPct(plano, cicloMeses);
  return Math.round(base * (1 - pct / 100) * 100) / 100;
}

function getTotalCiclo(plano, cicloMeses) {
  return Math.round(getPrecoPlano(plano, cicloMeses) * Number(cicloMeses) * 100) / 100;
}

// ─── Carregar plano por ID ────────────────────────────────────────────────────
async function carregarPlano(planId) {
  if (!planId) return null;
  if (_planosCache[planId]) return { ..._planosCache[planId] };
  try {
    const doc = await db.collection('planos').doc(planId).get();
    const data = doc.exists ? { id: doc.id, ...doc.data() } : null;
    if (data) _planosCache[planId] = data;
    return data;
  } catch (err) {
    console.error('[assinatura] Erro ao carregar plano:', err);
    return null;
  }
}

// ─── Renderizar lista de planos com ABAS DE CICLO HORIZONTAIS ─────────────────
async function carregarListaPlanos() {
  const wrap = document.getElementById('planos-cards');
  if (!wrap) return;
  wrap.innerHTML = '<div style="color:#555;font-size:13px;padding:12px">Carregando planos...</div>';

  wrap.style.display = 'block';
  wrap.style.gridTemplateColumns = 'none';
  wrap.style.flexDirection = 'none';

  try {
    if (!window.FeaturesManager || !window.FeaturesManager.carregarFeatures) {
      wrap.innerHTML = '<div style="color:#c00;font-size:13px">Erro: FeaturesManager não carregado.</div>';
      return;
    }
    if (!window.db) {
      wrap.innerHTML = '<div style="color:#c00;font-size:13px">Erro: Firebase não inicializado.</div>';
      return;
    }

    let allFeatures = [];
    try { allFeatures = await window.FeaturesManager.carregarFeatures() || []; }
    catch (err) { console.error('[assinatura] Erro ao carregar features:', err); }
    allFeatures = allFeatures.filter(f => f.ativo !== false);

    if (allFeatures.length === 0) {
      allFeatures = [
        { id: 'newsletter_texto',      nome: 'Newsletter em texto' },
        { id: 'newsletter_audio',      nome: 'Newsletter em áudio (podcast)' },
        { id: 'newsletter_video',      nome: 'Newsletter em vídeo' },
        { id: 'newsletter_infografico',nome: 'Infográfico por edição' },
        { id: 'alertas_prioritarios',  nome: 'Alertas prioritários' },
        { id: 'grupo_whatsapp_vip',    nome: 'Grupo VIP WhatsApp' },
        { id: 'biblioteca_acesso',     nome: 'Biblioteca vitalícia' },
        { id: 'sugestao_tema_quota',   nome: 'Sugestão de tema' },
        { id: 'consultoria_horas_mes', nome: 'Consultoria direta' },
      ];
    }

    const snap = await db.collection('planos')
      .where('tipo', '==', 'assinatura')
      .where('status', '==', 'ativo')
      .orderBy('ordem', 'asc')
      .get()
      .catch(() => db.collection('planos').where('tipo', '==', 'assinatura').where('status', '==', 'ativo').get());

    if (snap.empty) {
      wrap.innerHTML = '<div style="color:#999;font-size:13px">Nenhum plano disponível no momento.</div>';
      return;
    }

    wrap.innerHTML = '';
    const planos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    planos.forEach(p => { _planosCache[p.id] = p; });

    // Ciclos únicos disponíveis
    const ciclosSet = new Set();
    planos.forEach(p => {
      if (Array.isArray(p.ciclos_disponiveis)) p.ciclos_disponiveis.forEach(c => ciclosSet.add(String(c)));
    });
    const ciclosOrdenados = Array.from(ciclosSet).sort((a, b) => Number(a) - Number(b));
    if (ciclosOrdenados.length === 0) {
      wrap.innerHTML = '<div style="color:#999">Nenhum ciclo configurado nos planos.</div>';
      return;
    }

    // Container de abas
    const tabsWrap = document.createElement('div');
    tabsWrap.id = 'ciclo-tabs';
    tabsWrap.style.cssText = 'display:flex;gap:12px;margin-bottom:24px;width:100%;align-items:stretch;';
    wrap.appendChild(tabsWrap);

    // Grid de planos
    const gridContainer = document.createElement('div');
    gridContainer.id = 'grid-planos-dinamico';
    gridContainer.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:16px;min-height:200px;width:100%;';
    if (!document.getElementById('css-assinatura-dinamico')) {
      const style = document.createElement('style');
      style.id = 'css-assinatura-dinamico';
      style.textContent = `@media(max-width:768px){#grid-planos-dinamico{grid-template-columns:1fr !important;}}`;
      document.head.appendChild(style);
    }
    wrap.appendChild(gridContainer);

    function renderPlanosPorCiclo(cicloAtivo) {
      gridContainer.innerHTML = '';
      const planosFiltrados = planos.filter(p =>
        Array.isArray(p.ciclos_disponiveis) && p.ciclos_disponiveis.map(String).includes(cicloAtivo)
      );
      if (planosFiltrados.length === 0) {
        gridContainer.innerHTML = '<div style="color:#999;text-align:center;grid-column:1/-1;padding:30px;font-size:14px">Nenhum plano disponível para este ciclo.</div>';
        return;
      }
      planosFiltrados.forEach(p => gridContainer.appendChild(_criarCardPlano(p, cicloAtivo, allFeatures)));
    }

    ciclosOrdenados.forEach((ciclo, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${ciclo} Meses`;
      btn.dataset.ciclo = ciclo;
      const isDefault = idx === 0;
      btn.style.cssText = `flex:1;min-width:0;display:flex;align-items:center;justify-content:center;
        padding:14px 12px;border:1px solid ${isDefault ? '#0A3D62' : '#cbd5e1'};border-radius:10px;
        font-size:14px;font-weight:600;cursor:pointer;
        background:${isDefault ? '#0A3D62' : '#ffffff'};
        color:${isDefault ? '#ffffff' : '#475569'};
        transition:all 0.2s;box-shadow:0 1px 2px rgba(0,0,0,0.05);
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      btn.addEventListener('click', () => {
        tabsWrap.querySelectorAll('button').forEach(b => {
          b.style.background = '#fff'; b.style.color = '#475569'; b.style.borderColor = '#cbd5e1';
        });
        btn.style.background = '#0A3D62'; btn.style.color = '#fff'; btn.style.borderColor = '#0A3D62';
        renderPlanosPorCiclo(ciclo);
      });
      tabsWrap.appendChild(btn);
    });

    renderPlanosPorCiclo(ciclosOrdenados[0]);

    // Pré-seleção via URL
    if (_planIdUrl) {
      const planoUrl = await carregarPlano(_planIdUrl);
      if (planoUrl) {
        const cicloDisp = Array.isArray(planoUrl.ciclos_disponiveis) ? planoUrl.ciclos_disponiveis.map(String) : ['3'];
        const cicloParaAbrir = cicloDisp[0];
        const tabBtn = tabsWrap.querySelector(`button[data-ciclo="${cicloParaAbrir}"]`);
        if (tabBtn) tabBtn.click();
        setTimeout(() => {
          const match = gridContainer.querySelector(`.plano-card[data-id="${_planIdUrl}"]`);
          if (match) match.click();
          else _onPlanoSelecionado(_planIdUrl, cicloParaAbrir);
        }, 100);
      }
    }

  } catch (err) {
    console.error('[assinatura] Erro ao carregar planos:', err);
    wrap.innerHTML = '<div style="color:#c00;font-size:13px">Erro ao carregar planos. Recarregue a página.</div>';
  }
}

// ─── Helper: Cria card de plano ───────────────────────────────────────────────
function _criarCardPlano(plano, ciclo, allFeatures) {
  const cor      = plano.cor_destaque || '#0A3D62';
  const features = plano.features || {};

  const featuresHtml = allFeatures.map(f => {
    const val   = features[f.id];
    const ativo = !!val;
    let label   = f.nome || f.id;
    if (f.tipo === 'number') {
      const numVal = Number(val);
      if (!isNaN(numVal) && numVal > 0) label += ` (${numVal}/mês)`;
    }
    return `<li class="${ativo ? '' : 'inativo'}">${label}</li>`;
  }).join('');

  const val   = getPrecoPlano(plano, ciclo);
  const total = getTotalCiclo(plano, ciclo);

  const card = document.createElement('label');
  card.className   = `plano-card${plano.destaque ? ' destaque' : ''}${plano.em_breve ? ' em-breve' : ''}`;
  card.dataset.id   = plano.id;
  card.dataset.ciclo = ciclo;
  card.style.setProperty('--plano-cor', cor);
  card._planoData   = plano;
  card._cicloAtual  = Number(ciclo);

  card.innerHTML = `
    ${plano.em_breve ? '<div class="plano-badge-em-breve">🚀 Em breve</div>' : ''}
    ${!plano.em_breve && plano.destaque && plano.badge ? `<div class="plano-badge-destaque">${plano.badge}</div>` : ''}
    <input type="radio" name="plano-selecionado" value="${plano.id}-${ciclo}" ${plano.em_breve ? 'disabled' : ''}>
    <div class="plano-content${plano.em_breve ? ' plano-content--bloqueado' : ''}">
      <div class="plano-nome">${plano.nome || plano.id}</div>
      <div class="plano-preco-wrap">
        <span class="plano-preco-valor" style="color:${cor}">${fmtBRL(val)}</span>
        <div class="plano-preco-total" style="font-size:11px;color:#666;margin-top:1px">
          ${Number(ciclo) > 1 ? `Total: ${fmtBRL(total)}` : ''}
        </div>
        <span class="plano-preco-ciclo">/mês</span>
      </div>
      ${plano.descricao ? `<div class="plano-descricao">${plano.descricao}</div>` : ''}
      <ul class="plano-features">${featuresHtml}</ul>
      ${plano.em_breve ? `<div class="plano-em-breve-aviso">Em breve — <a href="capturaLead.html">cadastre-se</a></div>` : ''}
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (plano.em_breve) return;
    e.stopPropagation();
    _onPlanoSelecionado(plano.id, ciclo);
  });

  return card;
}

// ─── Ao selecionar um plano ───────────────────────────────────────────────────
async function _onPlanoSelecionado(planId, cicloInicial = null) {
  const plano = await carregarPlano(planId);
  if (!plano || plano.em_breve) return;

  const ciclosDisp = Array.isArray(plano.ciclos_disponiveis) && plano.ciclos_disponiveis.length
    ? plano.ciclos_disponiveis : ['3'];

  _planoAtual = plano;
  _planoAtual.cicloSelecionado = Number(cicloInicial || ciclosDisp[0]);

  const maxMun       = Number(_planoAtual?.features?.max_municipios) || 1;
  const containerMun = document.getElementById('container-municipios-extra');

  if (maxMun > 1) {
    if (!containerMun) await configurarUIMunicipiosExtra();
    else containerMun.style.display = 'block';
    const info = document.getElementById('municipios-limit-info');
    if (info) info.textContent = `Selecione até ${maxMun - 1} município(s) adicional(is).`;
    window._atualizarGridMunicipios?.();
  } else {
    if (containerMun) containerMun.style.display = 'none';
    _municipiosExtrasSelecionados = [];
  }

  document.getElementById('planId').value = planId;

  document.querySelectorAll('.plano-card').forEach(c => {
    const isSelected = c.dataset.id === planId && String(c.dataset.ciclo) === String(_planoAtual.cicloSelecionado);
    c.classList.toggle('selecionado', isSelected);
    const radio = c.querySelector('input[type="radio"]');
    if (radio) radio.checked = isSelected;
  });

  _atualizarCampoParcelas(plano);
  _mostrarWhatsappOptin();
  await carregarTiposNewsletter(Array.isArray(plano.tipos_inclusos) ? plano.tipos_inclusos : []);
  await atualizarPreview();

  // Mantém extras bloqueados se cupom de gratuidade estiver ativo
  if (_cupomAplicado?.valor === 100) {
    _municipiosExtrasSelecionados = [];
    const munC = document.getElementById('container-municipios-extra');
    if (munC) { munC.style.display = 'none'; munC.style.pointerEvents = 'none'; munC.style.opacity = '0.5'; }
  }
}

// ─── Parcelas ────────────────────────────────────────────────────────────────
function _atualizarCampoParcelas(plano) {
  const el = document.getElementById('parcelas');
  if (!el) return;
  const max = plano.qtde_parcelas || 1;
  el.innerHTML = '';
  for (let i = 1; i <= max; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${i}x`;
    el.appendChild(opt);
  }
  el.value = '1';
}

// ─── WhatsApp opt-in ──────────────────────────────────────────────────────────
function _mostrarWhatsappOptin() {
  const wpInput   = document.getElementById('whatsapp');
  const optinWrap = document.getElementById('whatsapp-optin-wrap');
  if (!wpInput || !optinWrap) return;
  const mostrar = () => {
    const planoTemFeatureAlvo = !!(_planoAtual?.features?.alertas_prioritarios || _planoAtual?.features?.grupo_whatsapp_vip);
    const numOk = wpInput.value.replace(/\D/g, '').length >= 10;
    optinWrap.style.display = (planoTemFeatureAlvo && numOk) ? 'flex' : 'none';
  };
  wpInput.removeEventListener('input', mostrar);
  wpInput.addEventListener('input', mostrar);
  mostrar();
}

// ─── Tipos de newsletter ──────────────────────────────────────────────────────
async function carregarTiposNewsletter(preselected = []) {
  const container = document.getElementById('campo-newsletters');
  if (!container) return;
  try {
    const snap = await db.collection('tipo_newsletters').where('is_newsletter', '==', true).get();
    const tipos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _tiposMap = {};
    tipos.forEach(t => { _tiposMap[t.id] = t.nome || t.id; });

    if (!tipos.length) {
      container.innerHTML = '<p style="color:#999;font-size:13px">Nenhum tipo de newsletter configurado.</p>';
      return;
    }

    const planFixado = !!(_planoAtual && Array.isArray(_planoAtual.tipos_inclusos) && _planoAtual.tipos_inclusos.length);

    container.innerHTML = `
      ${planFixado
        ? '<p style="font-size:12px;color:#666;margin:0 0 8px">Tipos incluídos no seu plano:</p>'
        : '<p style="font-size:12px;color:#666;margin:0 0 8px">Selecione seu(s) interesse(s):</p>'}
      <div id="grupo-newsletters" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${tipos.map(t => {
          const incl = planFixado
            ? _planoAtual.tipos_inclusos.map(String).includes(String(t.id))
            : preselected.includes(t.id);
          const disabled = planFixado ? 'disabled' : '';
          return `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:${planFixado ? 'default' : 'pointer'}">
            <input type="checkbox" value="${t.id}" id="tipo-${t.id}" ${incl ? 'checked' : ''} ${disabled} style="width:15px;height:15px">
            <span>${t.nome || t.id}</span>
          </label>`;
        }).join('')}
      </div>
      ${!planFixado
        ? `<button type="button" id="btn-sel-todos" style="margin-top:8px;padding:5px 12px;font-size:12px;background:#f0f4f8;border:1px solid #d1d9e0;border-radius:6px;cursor:pointer">Selecionar todos</button>`
        : '<p style="font-size:12px;color:#0A3D62;margin:8px 0 0">✓ Tipos definidos pelo seu plano</p>'}
    `;

    if (!planFixado) {
      document.getElementById('btn-sel-todos')?.addEventListener('click', () => {
        container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
        atualizarPreview();
      });
      container.addEventListener('change', () => {
        if (_planoAtual && !_planoAtual.allow_multi_select) {
          const cbs = [...container.querySelectorAll('input[type="checkbox"]:checked')];
          if (cbs.length > 1) {
            const ultimo = cbs[cbs.length - 1];
            cbs.forEach(c => { if (c !== ultimo) c.checked = false; });
          }
        }
        atualizarPreview();
      });
    } else {
      await atualizarPreview();
    }
  } catch (err) {
    console.error('[assinatura] Erro ao carregar tipos:', err);
    container.innerHTML = '<div style="color:#c00;font-size:13px">Erro ao carregar tipos.</div>';
  }
}

// ─── Validar cupom ────────────────────────────────────────────────────────────
async function validarCupom(codigo) {
  if (!codigo) return null;
  try {
    const snap = await db.collection('cupons').where('codigo', '==', codigo).limit(1).get();
    if (snap.empty) { mostrarMensagem('Cupom não encontrado.'); return null; }
    const cupom = snap.docs[0].data();
    if (cupom.status !== 'ativo') { mostrarMensagem('Cupom inativo.'); return null; }
    if (cupom.expira_em && cupom.expira_em.toDate() < new Date()) { mostrarMensagem('Cupom expirado.'); return null; }
    return { ...cupom, _id: snap.docs[0].id };
  } catch (err) {
    console.error('[assinatura] Erro ao validar cupom:', err);
    return null;
  }
}

// ─── Calcular preview ─────────────────────────────────────────────────────────
async function calcularPreview(plano, tiposSelecionados = [], cupomObj = null) {
  const cicloMeses     = plano.cicloSelecionado || 3;
  const baseMensal     = Number(plano.valor_mensal) || Number(plano.valor) || 0;
  const pct            = getDescontoPct(plano, cicloMeses);
  const basePrice      = getPrecoPlano(plano, cicloMeses);
  const descontoMensal = Math.round((baseMensal - basePrice) * 100) / 100;
  const tiposIncl      = Array.isArray(plano.tipos_inclusos) ? plano.tipos_inclusos.map(String) : [];
  const allowMulti     = !!plano.allow_multi_select;
  const bundles        = Array.isArray(plano.bundles) ? plano.bundles : [];

  const items = tiposSelecionados.map(id => ({
    id,
    nome:     _tiposMap[id] || id,
    included: tiposIncl.includes(String(id)),
    price:    tiposIncl.includes(String(id)) ? 0 : (Number(plano.price_per_tipo) || basePrice),
  }));

  let totalMensal = allowMulti
    ? items.reduce((s, i) => s + i.price, 0)
    : items.find(i => !i.included)?.price ?? (items.length ? basePrice : 0);

  bundles.forEach(b => {
    if (Array.isArray(b.types) && b.types.every(t => tiposSelecionados.includes(t))) {
      if (b.discount_percent) totalMensal -= totalMensal * (Number(b.discount_percent) / 100);
      else if (b.discount_fixed) totalMensal -= Number(b.discount_fixed);
    }
  });

  const totalMensalBruto = Math.max(0, totalMensal);
  let descontoCupom = 0;
  if (cupomObj) {
    if (cupomObj.tipo === 'percentual') descontoCupom = totalMensalBruto * ((Number(cupomObj.valor) || 0) / 100);
    else if (cupomObj.tipo === 'fixo')  descontoCupom = Number(cupomObj.valor) || 0;
  }
  const totalMensalFinal = Math.max(0, totalMensalBruto - descontoCupom);
  const totalCiclo       = Math.round(totalMensalFinal * cicloMeses * 100) / 100;
  const temFidelizacao   = cicloMeses >= 6 && pct > 0;
  const agora = new Date();
  const dataFimFidelizacao = new Date(agora);
  dataFimFidelizacao.setMonth(dataFimFidelizacao.getMonth() + cicloMeses);

  return {
    items, basePrice, baseMensal, totalBruto: totalMensalBruto, desconto: descontoCupom,
    total: totalCiclo, valor_mensal_contratado: totalMensalFinal,
    amountCentavos: Math.round(totalCiclo * 100), ciclo: cicloMeses, ciclo_meses: cicloMeses,
    desconto_pct: pct, desconto_mensal: descontoMensal, tem_fidelizacao: temFidelizacao,
    data_fim_fidelizacao: dataFimFidelizacao, cupom: cupomObj,
  };
}

// ─── Atualizar preview no DOM ─────────────────────────────────────────────────
async function atualizarPreview() {
  const wrap    = document.getElementById('preview-breakdown');
  const itemsEl = document.getElementById('preview-items');
  const totalEl = document.getElementById('preview-total');
  if (!wrap) return;
  if (!_planoAtual) { wrap.style.display = 'none'; return; }

  const checks = [...document.querySelectorAll('#grupo-newsletters input[type="checkbox"]:checked')];
  const tipos  = checks.map(cb => cb.value);
  if (!tipos.length) { wrap.style.display = 'none'; return; }

  const pv = await calcularPreview(_planoAtual, tipos, _cupomAplicado);
  wrap.style.display = 'block';

  if (itemsEl) {
    itemsEl.innerHTML = pv.items.map(it =>
      `<div class="preview-row"><span>${it.nome}</span><span>${it.included
        ? '<span style="color:#16a34a">Incluído</span>'
        : fmtBRL(it.price)}</span></div>`
    ).join('');
  }

  if (totalEl) {
    let html = '';
    if (pv.desconto > 0 && pv.cupom) {
      html += `<div class="preview-row desconto"><span>🎟 Cupom ${pv.cupom.codigo}</span><span>- ${fmtBRL(pv.desconto)}</span></div>`;
    }

    const parcelasEl = document.getElementById('parcelas');
    const parcelas   = parcelasEl ? Number(parcelasEl.value) || 1 : 1;
    const semJuros   = _planoAtual.permitir_sem_juros && parcelas <= (_planoAtual.parcelas_sem_juros || 1);

    if (pv.desconto_pct > 0 && pv.desconto_mensal > 0) {
      html += `<div class="preview-row desconto"><span>🏷 Desconto ${pv.ciclo_meses} meses (${pv.desconto_pct}% off)</span><span>− ${fmtBRL(pv.desconto_mensal)}/mês</span></div>`;
    }

    let textoTotal = '';
    if (pv.ciclo_meses > 1) {
      textoTotal = `${fmtBRL(pv.valor_mensal_contratado)}/mês × ${pv.ciclo_meses} = ${fmtBRL(pv.total)}`;
    } else if (parcelas > 1) {
      textoTotal = `${parcelas}× de ${fmtBRL(pv.total / parcelas)}${semJuros ? ' sem juros' : ''}`;
    } else {
      textoTotal = fmtBRL(pv.total);
    }
    html += `<div class="preview-row total"><span>Total do período</span><span>${textoTotal}</span></div>`;

    if (pv.tem_fidelizacao) {
      const dtFim = pv.data_fim_fidelizacao.toLocaleDateString('pt-BR');
      html += `<div class="preview-row" style="margin-top:8px;padding:8px 10px;background:#fffbeb;border-radius:6px;font-size:12px;color:#92400e;border:1px solid #fde68a">
        <span>⚖️ Fidelização até ${dtFim}</span>
        <span>Cancelamento antecipado: devolução de ${fmtBRL(pv.desconto_mensal)} × meses usados</span>
      </div>`;
    }
    totalEl.innerHTML = html;
  }
  return pv;
}

// ─── Upsert usuário no Firestore ──────────────────────────────────────────────
async function upsertUsuario(dados) {
  const { nome, cpf, email, telefone, whatsapp, whatsappOptin, perfil, mensagem, preferencia,
          cod_uf, cod_municipio, nome_municipio, plano_slug, ciclo, features } = dados;
  const cpfNorm  = (cpf || '').replace(/\D/g, '');
  const waNumber = whatsapp ? String(whatsapp).replace(/\D/g, '') : '';

  const base = {
    nome, cpfNormalizado: cpfNorm, telefone: telefone || null,
    whatsapp: whatsapp || null, whatsapp_number: waNumber,
    whatsapp_optin: whatsapp ? (whatsappOptin ?? true) : false,
    whatsapp_optin_em: whatsapp ? firebase.firestore.FieldValue.serverTimestamp() : null,
    tipo_perfil: perfil || null, ativo: false, mensagem: mensagem || null,
    preferencia_contato: preferencia || null,
    cod_uf: cod_uf || null, cod_municipio: cod_municipio || null, nome_municipio: nome_municipio || null,
    origem: _origem, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const q = await db.collection('usuarios').where('email', '==', email.toLowerCase()).limit(1).get();
    if (!q.empty) {
      await db.collection('usuarios').doc(q.docs[0].id).update(base);
      return q.docs[0].id;
    } else {
      const ref = await db.collection('usuarios').add({
        ...base, email: email.toLowerCase(), plano_status: 'pendente_pagamento',
        plano_slug: plano_slug || null, plano_ciclo: ciclo || '3', features: features || null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      return ref.id;
    }
  } catch (err) { console.error('[assinatura] Erro em upsertUsuario:', err); throw err; }
}

// ─── Registrar assinatura (subcoleção) ───────────────────────────────────────
async function registrarAssinatura(userId, payload, preview) {
  if (!userId || !payload || !preview) throw new Error('Parâmetros obrigatórios ausentes.');
  const agora     = new Date();
  const cicloMeses = preview.ciclo_meses || 3;
  const renovacao = new Date(agora);
  renovacao.setMonth(renovacao.getMonth() + cicloMeses);

  const principalCod = payload.cod_municipio || null;
  const extrasObjs   = Array.isArray(payload.municipiosExtras) ? payload.municipiosExtras : [];
  const municipiosPlano = principalCod
    ? [
        { cod_municipio: principalCod, nome: payload.nome_municipio || principalCod, uf: payload.cod_uf || '' },
        ...extrasObjs.filter(e => e.cod_municipio !== principalCod),
      ]
    : [];

  const data = {
    planId: payload.planId || null, plano_slug: payload.plano_slug || null, plano_nome: payload.plano_nome || null,
    ciclo: String(cicloMeses), ciclo_meses: cicloMeses,
    tipos_selecionados: Array.isArray(payload.tipos_selecionados) ? payload.tipos_selecionados : [],
    valor_original: preview.totalBruto ?? 0, valor_desconto: preview.desconto ?? 0, valor_final: preview.total ?? 0,
    amountCentavos: preview.amountCentavos ?? 0, valor_base_mensal: preview.baseMensal ?? 0,
    valor_mensal_contratado: preview.valor_mensal_contratado ?? 0, desconto_mensal: preview.desconto_mensal ?? 0,
    desconto_pct: preview.desconto_pct ?? 0, tem_fidelizacao: preview.tem_fidelizacao ?? false,
    data_fim_fidelizacao: preview.tem_fidelizacao
      ? firebase.firestore.Timestamp.fromDate(preview.data_fim_fidelizacao) : null,
    cupom: payload.cupom || null, features_snapshot: payload.features || null,
    municipios_plano: municipiosPlano,
    data_inicio: firebase.firestore.Timestamp.fromDate(agora),
    data_proxima_renovacao: firebase.firestore.Timestamp.fromDate(renovacao),
    status: 'pendente_pagamento', paymentProvider: 'mercadopago', orderId: payload.orderId || null,
    pedidoId: null, origem: _origem,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  try {
    return (await db.collection('usuarios').doc(userId).collection('assinaturas').add(data)).id;
  } catch (err) { console.error('[assinatura] Erro em registrarAssinatura:', err); throw err; }
}

// ─── Criar pedido no backend (Mercado Pago) ───────────────────────────────────
async function criarPedidoBackend(payload) {
  const ctrl    = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);
  try {
    const resp = await fetch('/api/pagamentoMP?acao=criar-pedido', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`Backend ${resp.status}: ${await resp.text().catch(() => '')}`);
    return await resp.json();
  } catch (err) { clearTimeout(timeout); throw err; }
}

// ─── Prefill a partir do lead ─────────────────────────────────────────────────
async function prefillFromLead() {
  if (!_leadIdUrl) return null;
  try {
    const doc = await db.collection('leads').doc(_leadIdUrl).get();
    if (!doc.exists) return null;
    const lead = doc.data();
    const set  = (id, val) => { if (val && document.getElementById(id)) document.getElementById(id).value = val; };
    set('nome', lead.nome); set('email', lead.email); set('telefone', lead.telefone);
    set('whatsapp', lead.whatsapp || lead.telefone); set('perfil', lead.perfil);
    set('preferencia-contato', lead.preferencia_contato);
    if (Array.isArray(lead.interesses)) {
      lead.interesses.forEach(v => {
        const cb = document.getElementById(`tipo-${v}`) || document.querySelector(`#grupo-newsletters input[value="${v}"]`);
        if (cb) cb.checked = true;
      });
    }
    _mostrarWhatsappOptin();
    const st = document.getElementById('status-envio');
    if (st) { st.textContent = '✅ Dados preenchidos a partir do seu cadastro.'; st.style.color = '#16a34a'; }
    return lead;
  } catch (err) { console.error('[assinatura] Erro ao buscar lead:', err); return null; }
}

// ─── Validações do formulário ─────────────────────────────────────────────────
function clearErrors() {
  document.querySelectorAll('#form-assinatura .field-error').forEach(el => {
    el.textContent = ''; el.style.display = 'none';
  });
}
function setError(id, msg) {
  const el = document.getElementById(`error-${id}`);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function validarCPF(cpf) {
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(cpf[i]) * (10 - i);
  let r = (s * 10) % 11; if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(cpf[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(cpf[i]) * (11 - i);
  r = (s * 10) % 11; if (r === 10 || r === 11) r = 0;
  return r === parseInt(cpf[10]);
}

// ─── Submissão do formulário ──────────────────────────────────────────────────
async function processarEnvioAssinatura(e) {
  e.preventDefault();
  clearErrors();
  const btn       = document.getElementById('btn-assinar');
  const status    = document.getElementById('status-envio');
  const setStatus = (msg, cor = '#555') => { if (status) { status.textContent = msg; status.style.color = cor; } };

  const nome       = document.getElementById('nome')?.value.trim()              || '';
  const cpf        = document.getElementById('cpf')?.value.trim()               || '';
  const email      = document.getElementById('email')?.value.trim()             || '';
  const telefone   = document.getElementById('telefone')?.value.trim()          || '';
  const whatsapp   = document.getElementById('whatsapp')?.value.trim()          || '';
  const wpOptin    = !!document.getElementById('whatsapp-optin')?.checked;
  const perfil     = document.getElementById('perfil')?.value                   || '';
  const mensagem   = document.getElementById('mensagem')?.value.trim()          || '';
  const preferencia= document.getElementById('preferencia-contato')?.value      || '';
  const cupomCod   = document.getElementById('cupom')?.value.trim()             || '';
  const aceita     = !!document.getElementById('aceita-termos')?.checked;
  const ciclo      = _planoAtual?.cicloSelecionado || 3;
  const tiposSelecionados = [...document.querySelectorAll('#grupo-newsletters input[type="checkbox"]:checked')].map(cb => cb.value);

  let temErro = false;
  const erro = (campo, msg) => { setError(campo, msg); temErro = true; };
  if (nome.length < 3) erro('nome', 'Nome deve ter pelo menos 3 caracteres.');
  if (!validarCPF(cpf)) erro('cpf', 'CPF inválido.');
  if (!validarEmail(email)) erro('email', 'E-mail inválido.');

  const temFeatureWhatsApp = !!(_planoAtual?.features?.alertas_prioritarios || _planoAtual?.features?.grupo_whatsapp_vip);
  if (temFeatureWhatsApp) {
    if (!whatsapp || !validarTelefoneFormato(whatsapp)) erro('whatsapp', 'WhatsApp é obrigatório para receber alertas ou acessar o grupo VIP.');
    if (!wpOptin) erro('whatsapp-optin', 'Autorização de envio pelo WhatsApp é obrigatória para este plano.');
  } else if (whatsapp && !validarTelefoneFormato(whatsapp)) {
    erro('whatsapp', 'Formato de WhatsApp inválido.');
  }
  if (!perfil)              { mostrarMensagem('Selecione seu perfil.');                            temErro = true; }
  if (!aceita)              { setError('aceita_termos', 'Você precisa aceitar os termos.');        temErro = true; }
  if (!tiposSelecionados.length) { mostrarMensagem('Selecione pelo menos um tipo de newsletter.'); temErro = true; }
  if (!_planoAtual)         { mostrarMensagem('Selecione um plano.');                              temErro = true; }
  if (temErro) return;

  // Verifica assinatura ativa existente
  try {
    const exSnap = await db.collection('usuarios').where('email', '==', email.toLowerCase()).limit(1).get();
    if (!exSnap.empty) {
      const uid     = exSnap.docs[0].id;
      const assSnap = await db.collection('usuarios').doc(uid).collection('assinaturas')
        .where('status', 'in', ['ativa', 'aprovada']).get();
      if (!assSnap.empty) {
        mostrarMensagem('Você já possui uma assinatura ativa. Acesse a Área do Assinante.');
        return;
      }
    }
  } catch (err) { console.warn('[assinatura] Verificação de ativo falhou:', err); }

  let dadosUf = null;
  try {
    dadosUf = typeof validarUfMunicipio === 'function' ? validarUfMunicipio() : null;
    if (!dadosUf) return;
  } catch (err) { console.warn('[assinatura] UF/Mun:', err); }

  btn.disabled = true;
  setStatus('Calculando valores...', '#555');
  let preview;
  try {
    preview = await calcularPreview(_planoAtual, tiposSelecionados, _cupomAplicado);
  } catch (err) {
    setStatus('Erro ao calcular valores. Tente novamente.', '#c00');
    btn.disabled = false;
    return;
  }

  const isGratuidade = (_cupomAplicado?.valor === 100) || preview.amountCentavos === 0;
  if (isGratuidade) {
    _municipiosExtrasSelecionados = [];
    const munC = document.getElementById('container-municipios-extra');
    if (munC) { munC.style.display = 'none'; munC.style.pointerEvents = 'none'; }
  }

  setStatus('Registrando dados...', '#555');
  try {
    const userId = await upsertUsuario({
      nome, cpf, email, telefone, whatsapp, whatsappOptin: wpOptin, perfil, mensagem, preferencia,
      cod_uf: dadosUf?.cod_uf, cod_municipio: dadosUf?.cod_municipio, nome_municipio: dadosUf?.nome_municipio,
      plano_slug: _planoAtual.plano_slug, ciclo, features: _planoAtual.features || null,
    });

    const assinaturaId = await registrarAssinatura(userId, {
      planId:             _planoAtual.id,
      plano_slug:         _planoAtual.plano_slug  || null,
      plano_nome:         _planoAtual.nome        || null,
      tipos_selecionados: tiposSelecionados,
      cupom:              cupomCod                || null,
      features:           _planoAtual.features    || null,
      cod_uf:             dadosUf?.cod_uf         || '',
      cod_municipio:      dadosUf?.cod_municipio  || null,
      nome_municipio:     dadosUf?.nome_municipio || '',
      // Extras: array de objetos {cod_municipio, nome, uf}
      municipiosExtras: _municipiosExtrasSelecionados.map(cod => {
        const det = _municipiosDisponiveis.find(m => m.cod_municipio === cod);
        return { cod_municipio: cod, nome: det?.nome || cod, uf: det?.uf || dadosUf?.cod_uf || '' };
      }),
    }, preview);

    setStatus(isGratuidade ? 'Ativando gratuidade...' : 'Iniciando pagamento...', '#555');

    const backendPayload = {
      userId, assinaturaId,
      amountCentavos: isGratuidade ? 0 : preview.amountCentavos,
      cpf, nome, email,
      descricao: `${_planoAtual.nome || 'Assinatura Radar SIOPE'} — ${preview.ciclo_meses} meses`,
      installmentsMax: _planoAtual.parcelas_sem_juros || preview.ciclo_meses,
      dataPrimeiroVencimento: new Date().toISOString().split('T')[0],
      ciclo_meses: preview.ciclo_meses,
      plano_slug: _planoAtual.plano_slug || null,
      metodosPagamento: Array.isArray(_planoAtual.metodos_pagamento) && _planoAtual.metodos_pagamento.length
        ? _planoAtual.metodos_pagamento : ['credit_card'],
      tipoAssinatura: isGratuidade ? 'gratuidade' : 'padrao',
      cupomCodigo: _cupomAplicado?.codigo || null,
    };

    const backendResp = await criarPedidoBackend(backendPayload);

    if (backendResp?.pedidoId) {
      db.collection('usuarios').doc(userId).collection('assinaturas').doc(assinaturaId)
        .update({ pedidoId: backendResp.pedidoId, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
        .catch(() => {});
    }

    if (backendResp?.ativadoDireto) {
      setStatus('✅ Assinatura ativada com sucesso! Verifique seu e-mail.', '#16a34a');
      setTimeout(() => { window.location.href = backendResp.redirectSucesso || '/area-assinante.html'; }, 2000);
    } else if (backendResp?.redirectUrl) {
      window.location.href = backendResp.redirectUrl;
    } else {
      document.getElementById('modalConfirmacao').style.display = 'flex';
    }
  } catch (err) {
    console.error('[assinatura] Erro no processamento:', err);
    setStatus(err.message || 'Erro ao processar. Tente novamente.', '#c00');
  } finally {
    btn.disabled = false;
  }
}

// ─── Inicialização ────────────────────────────────────────────────────────────
async function initAssinatura() {
  const telEl = document.getElementById('telefone');
  const wpEl  = document.getElementById('whatsapp');
  if (telEl && typeof aplicarMascaraTelefone === 'function') aplicarMascaraTelefone(telEl);
  if (wpEl  && typeof aplicarMascaraTelefone === 'function') aplicarMascaraTelefone(wpEl);

  document.getElementById('cpf')?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 11);
    v = v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    this.value = v;
  });

  let leadPreload = null;
  if (_leadIdUrl) {
    try {
      const d = await db.collection('leads').doc(_leadIdUrl).get();
      if (d.exists) leadPreload = d.data();
    } catch (e) {}
  }

  window.validarUfMunicipio = await inserirCamposUfMunicipio(
    document.getElementById('campo-uf-municipio'),
    leadPreload?.cod_uf     || '',
    leadPreload?.cod_municipio || ''
  );

  if (_planIdUrl) {
    const plano = await carregarPlano(_planIdUrl);
    if (plano && plano.tipo === 'assinatura') await _onPlanoSelecionado(_planIdUrl);
    else await carregarListaPlanos();
  } else {
    await carregarListaPlanos();
    await carregarTiposNewsletter([]);
  }
  await prefillFromLead();

  document.getElementById('aplicar-cupom')?.addEventListener('click', async () => {
    const codigo = document.getElementById('cupom')?.value.trim();
    const fb     = document.getElementById('cupom-feedback');
    if (!_planoAtual) { mostrarMensagem('Selecione um plano antes de aplicar o cupom.'); return; }
    if (!codigo)      { mostrarMensagem('Digite um código de cupom.'); return; }

    const cupom = await validarCupom(codigo);
    if (cupom) {
      _cupomAplicado = cupom;
      if (fb) { fb.textContent = `✅ Cupom "${codigo}" aplicado!`; fb.style.color = '#16a34a'; }

      const isGratuidade  = cupom.valor === 100;
      const munContainer  = document.getElementById('container-municipios-extra');
      if (isGratuidade) {
        _municipiosExtrasSelecionados = [];
        if (munContainer) {
          munContainer.style.display      = 'none';
          munContainer.style.pointerEvents = 'none';
          munContainer.style.opacity       = '0.5';
        }
        mostrarMensagem('Cupom de gratuidade aplicado. Seleção de municípios adicionais desativada.');
      } else {
        if (munContainer) {
          munContainer.style.display      = 'block';
          munContainer.style.pointerEvents = 'auto';
          munContainer.style.opacity       = '1';
        }
      }
      await atualizarPreview();
    } else {
      _cupomAplicado = null;
      if (fb) fb.textContent = '';
      const munContainer = document.getElementById('container-municipios-extra');
      if (munContainer && _planoAtual?.features?.max_municipios > 1) {
        munContainer.style.display      = 'block';
        munContainer.style.pointerEvents = 'auto';
        munContainer.style.opacity       = '1';
      }
    }
  });

  document.getElementById('parcelas')?.addEventListener('change', atualizarPreview);
  document.getElementById('form-assinatura')?.addEventListener('submit', processarEnvioAssinatura);
}

// ── Auto-init ──────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAssinatura);
} else {
  initAssinatura();
}