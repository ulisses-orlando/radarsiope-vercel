/**
 * vitrine.js — Módulo de Configuração da Vitrine de Indicadores
 * Radar SIOPE — Painel Admin
 *
 * INTEGRAÇÃO em abrirModalNewsletter(docId, isEdit):
 *
 *   1. No corpo do modal, adicione ao final:
 *        <div id="vitrine-container"></div>
 *
 *   2. Após montar o modal, chame:
 *        await window.inicializarVitrine(docId, document.getElementById('vitrine-container'));
 *
 *   3. No handler do botão "Salvar" da edição, adicione:
 *        await window.salvarVitrine(docId);
 *
 *   4. No <head> do admin, declare as constantes do Supabase (se ainda não existirem):
 *        const SUPABASE_URL = 'https://xxxx.supabase.co';
 *        const SUPABASE_ANON_KEY = 'eyJhbGci...';
 */

/* ─────────────────────────────────────────
   CONSTANTES
───────────────────────────────────────── */
const VITRINE_CORES = [
  '#667eea', '#764ba2', '#f093fb', '#4facfe',
  '#43e97b', '#fa709a', '#fee140', '#a18cd1',
  '#00f2fe', '#fbc2eb', '#84fab0', '#fd7043'
];

const VITRINE_TIPOS_GRAFICO = [
  { value: 'linha', label: '📈 Linha' },
  { value: 'barra', label: '📊 Barra' },
  { value: 'pizza', label: '🥧 Pizza' }
];

const VITRINE_GRUPOS = [
  { value: 'nenhum',  label: 'Sem grupo' },
  { value: 'grupo_1', label: 'Grupo 1' },
  { value: 'grupo_2', label: 'Grupo 2' },
  { value: 'grupo_3', label: 'Grupo 3' }
];

/* ─────────────────────────────────────────
   ESTADO INTERNO
───────────────────────────────────────── */
let _newsletterId   = '';
let _vitrineItems   = [];   // array de objetos do indicador configurado
let _indicadores    = [];   // cache dos indicadores do Supabase
let _containerEl    = null;

/* ─────────────────────────────────────────
   SUPABASE — Busca indicadores
───────────────────────────────────────── */
async function _buscarIndicadores() {
  if (_indicadores.length > 0) return _indicadores;

  try {
    const url  = window.SUPABASE_URL;
    const key  = window.SUPABASE_ANON_KEY;

    if (!url || !key) {
      console.warn('vitrine.js: SUPABASE_URL ou SUPABASE_ANON_KEY não definidos.');
      return [];
    }

    const res = await fetch(
      `${url}/rest/v1/indicadores?ativo=eq.true&order=ordem_exibicao.asc`,
      {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _indicadores = await res.json();
    return _indicadores;

  } catch (e) {
    console.error('vitrine.js: Erro ao buscar indicadores:', e);
    return [];
  }
}

/* ─────────────────────────────────────────
   FIRESTORE — Carregar / Salvar vitrine
───────────────────────────────────────── */
async function _carregarVitrine(newsletterId) {
  try {
    const snap = await db.collection('newsletters').doc(newsletterId).get();
    if (snap.exists && Array.isArray(snap.data().vitrine)) {
      _vitrineItems = snap.data().vitrine;
    } else {
      _vitrineItems = [];
    }
  } catch (e) {
    console.error('vitrine.js: Erro ao carregar vitrine:', e);
    _vitrineItems = [];
  }
}

async function salvarVitrine(newsletterId) {
  const id = newsletterId || _newsletterId;
  if (!id) return;

  // normaliza grupo 'nenhum' → null antes de gravar
  const payload = _vitrineItems.map(item => ({
    ...item,
    grupo: (!item.grupo || item.grupo === 'nenhum') ? null : item.grupo
  }));

  await db.collection('newsletters').doc(id).set(
    { vitrine: payload },
    { merge: true }
  );
}

/* ─────────────────────────────────────────
   VALIDAÇÃO DE AGRUPAMENTO
───────────────────────────────────────── */
function _validarGrupo(candidato) {
  const grupo = candidato.grupo;
  if (!grupo || grupo === 'nenhum') return null;

  const colegas = _vitrineItems.filter(
    i => i.cod_indicador !== candidato.cod_indicador &&
         i.grupo === grupo
  );
  if (colegas.length === 0) return null;

  const ref = colegas[0];

  if (ref.tipo_grafico !== candidato.tipo_grafico) {
    return `"${ref.nome}" já usa gráfico do tipo <strong>${ref.tipo_grafico}</strong> neste grupo. Altere o tipo de gráfico para agrupar.`;
  }

  if (ref.unidade !== candidato.unidade) {
    const labelRef  = ref.unidade === 'valor_brl' ? 'valor monetário' : 'percentual';
    const labelCand = candidato.unidade === 'valor_brl' ? 'valor monetário' : 'percentual';
    return `"${ref.nome}" é ${labelRef} e "${candidato.nome}" é ${labelCand}. Indicadores de unidades diferentes não podem ser agrupados.`;
  }

  return null;
}

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
function _proximaCor() {
  const usadas = new Set(_vitrineItems.map(i => i.cor));
  return VITRINE_CORES.find(c => !usadas.has(c)) || VITRINE_CORES[0];
}

function _labelUnidade(unidade) {
  return unidade === 'percentual' ? '📊 Percentual' : '💰 Valor';
}

function _mostrarAviso(msg) {
  const el = document.getElementById('vitrine-aviso');
  if (!el) return;
  if (msg) {
    el.innerHTML = `⚠️ ${msg}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
  } else {
    el.style.display = 'none';
  }
}

/* ─────────────────────────────────────────
   RENDER — Estrutura principal
───────────────────────────────────────── */
function _renderSecao() {
  if (!_containerEl) return;

  _containerEl.innerHTML = `
    <div id="vitrine-wrap" style="
      margin-top: 28px;
      border-top: 2px solid #667eea;
      padding-top: 18px;
    ">
      <!-- Cabeçalho -->
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
        <div>
          <h4 style="margin:0; font-size:15px; color:#0A3D62; font-weight:700;">
            📊 Vitrine de Indicadores
          </h4>
          <p style="margin:2px 0 0; font-size:12px; color:#64748b;">
            Indicadores que serão exibidos como gráficos no app para esta edição.
          </p>
        </div>
        <button id="vitrine-btn-add" onclick="window._vitrineTogglePainel()" style="
          background: linear-gradient(135deg, #667eea, #764ba2);
          color: #fff; border: none; border-radius: 6px;
          padding: 7px 16px; cursor: pointer; font-size: 13px; font-weight: 600;
          white-space: nowrap;
        ">+ Indicador</button>
      </div>

      <!-- Aviso de validação -->
      <div id="vitrine-aviso" style="
        display: none;
        background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px;
        padding: 8px 12px; margin-bottom: 12px;
        font-size: 13px; color: #856404; line-height: 1.5;
      "></div>

      <!-- Lista de indicadores configurados -->
      <div id="vitrine-lista"></div>

      <!-- Painel de seleção de novo indicador -->
      <div id="vitrine-painel-add" style="
        display: none;
        background: #f8f9ff; border: 1px solid #c7d2fe;
        border-radius: 8px; padding: 14px; margin-top: 10px;
      ">
        <p style="margin:0 0 8px; font-size:13px; font-weight:600; color:#334155;">
          Selecionar indicador:
        </p>
        <input
          id="vitrine-busca"
          type="text"
          placeholder="Buscar por nome ou categoria..."
          oninput="window._vitrineFiltraBusca(this.value)"
          style="
            width: 100%; padding: 7px 10px; border: 1px solid #cbd5e1;
            border-radius: 6px; font-size: 13px; margin-bottom: 8px;
            box-sizing: border-box;
          "
        >
        <div id="vitrine-lista-disp" style="
          max-height: 210px; overflow-y: auto;
          border: 1px solid #e2e8f0; border-radius: 6px; background: #fff;
        "></div>
      </div>
    </div>
  `;

  _renderLista();
}

/* ─────────────────────────────────────────
   RENDER — Lista de itens configurados
───────────────────────────────────────── */
function _renderLista() {
  const lista = document.getElementById('vitrine-lista');
  if (!lista) return;

  if (_vitrineItems.length === 0) {
    lista.innerHTML = `
      <p style="
        text-align:center; color:#94a3b8; font-size:13px;
        padding:16px 0; background:#f8fafc; border-radius:8px;
        border:1px dashed #e2e8f0; margin:0;
      ">Nenhum indicador adicionado. Clique em "+ Indicador" para começar.</p>
    `;
    return;
  }

  lista.innerHTML = _vitrineItems.map((item, idx) => {
    const isDestaque = !!item.destaque;
    const grupos = VITRINE_GRUPOS.map(g =>
      `<option value="${g.value}" ${(item.grupo || 'nenhum') === g.value ? 'selected' : ''}>${g.label}</option>`
    ).join('');
    const tipos = VITRINE_TIPOS_GRAFICO.map(t =>
      `<option value="${t.value}" ${item.tipo_grafico === t.value ? 'selected' : ''}>${t.label}</option>`
    ).join('');

    return `
      <div style="
        background: ${isDestaque ? '#f0f4ff' : '#fafafa'};
        border: 1px solid ${isDestaque ? '#667eea' : '#e2e8f0'};
        border-radius: 8px; padding: 12px 14px; margin-bottom: 8px;
      ">
        <!-- Linha do nome -->
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
          <span style="
            width:14px; height:14px; border-radius:50%;
            background:${item.cor}; flex-shrink:0; display:inline-block;
          "></span>
          <span style="font-size:13px; font-weight:700; color:#1e293b; flex:1;">
            ${isDestaque ? '⭐ ' : ''}${item.nome}
          </span>
          <span style="
            font-size:11px; color:#64748b; background:#f1f5f9;
            padding:2px 8px; border-radius:10px; flex-shrink:0;
          ">${_labelUnidade(item.unidade)}</span>
          <button onclick="window._vitrineRemover(${idx})" title="Remover" style="
            background:none; border:none; cursor:pointer; color:#94a3b8;
            font-size:16px; padding:0; line-height:1; flex-shrink:0;
          ">🗑️</button>
        </div>

        <!-- Controles -->
        <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end;">

          <div style="display:flex; flex-direction:column; gap:3px;">
            <label style="font-size:11px; color:#64748b; font-weight:600;">Tipo de gráfico</label>
            <select
              onchange="window._vitrineAlterarCampo(${idx}, 'tipo_grafico', this.value)"
              style="font-size:12px; border:1px solid #cbd5e1; border-radius:5px; padding:4px 8px;"
            >${tipos}</select>
          </div>

          <div style="display:flex; flex-direction:column; gap:3px;">
            <label style="font-size:11px; color:#64748b; font-weight:600;">Grupo</label>
            <select
              onchange="window._vitrineAlterarCampo(${idx}, 'grupo', this.value)"
              style="font-size:12px; border:1px solid #cbd5e1; border-radius:5px; padding:4px 8px;"
            >${grupos}</select>
          </div>

          <div style="display:flex; flex-direction:column; gap:3px;">
            <label style="font-size:11px; color:#64748b; font-weight:600;">Cor</label>
            <input
              type="color"
              value="${item.cor}"
              onchange="window._vitrineAlterarCampo(${idx}, 'cor', this.value)"
              style="width:44px; height:30px; border:1px solid #cbd5e1; border-radius:5px; cursor:pointer; padding:2px;"
            >
          </div>

          <div style="display:flex; flex-direction:column; gap:3px;">
            <label style="font-size:11px; color:#64748b; font-weight:600;">Destaque ⭐</label>
            <div style="display:flex; align-items:center; height:30px;">
              <input
                type="checkbox"
                ${isDestaque ? 'checked' : ''}
                onchange="window._vitrineAlterarCampo(${idx}, 'destaque', this.checked)"
                style="width:17px; height:17px; cursor:pointer;"
                title="Exibir em tamanho maior no topo do app"
              >
            </div>
          </div>

        </div>
      </div>
    `;
  }).join('');
}

/* ─────────────────────────────────────────
   RENDER — Lista de indicadores disponíveis (Supabase)
───────────────────────────────────────── */
function _renderDisponíveis(filtro = '') {
  const container = document.getElementById('vitrine-lista-disp');
  if (!container) return;

  const jaAdicionados = new Set(_vitrineItems.map(i => i.cod_indicador));

  const lista = _indicadores.filter(ind => {
    if (jaAdicionados.has(ind.cod_indicador)) return false;
    if (!filtro) return true;
    const f = filtro.toLowerCase();
    return (ind.nome || '').toLowerCase().includes(f) ||
           (ind.categoria || '').toLowerCase().includes(f);
  });

  if (lista.length === 0) {
    container.innerHTML = `<p style="padding:12px; color:#94a3b8; font-size:13px; text-align:center;">
      Nenhum indicador encontrado.
    </p>`;
    return;
  }

  container.innerHTML = lista.map(ind => `
    <div
      onclick="window._vitrineAdicionar('${ind.cod_indicador}')"
      style="
        padding: 9px 12px; cursor: pointer;
        border-bottom: 1px solid #f1f5f9; font-size: 13px;
        display: flex; justify-content: space-between; align-items: center;
        transition: background 0.15s;
      "
      onmouseover="this.style.background='#f0f4ff'"
      onmouseout="this.style.background=''"
    >
      <span style="color:#1e293b; font-weight:500;">${ind.nome}</span>
      <span style="
        font-size: 11px; color: #64748b;
        background: #f1f5f9; padding: 2px 8px; border-radius: 10px;
        white-space: nowrap; margin-left: 8px; flex-shrink:0;
      ">
        ${ind.unidade === 'percentual' ? '📊 %' : '💰 BRL'}
        ${ind.categoria ? ' · ' + ind.categoria : ''}
      </span>
    </div>
  `).join('');
}

/* ─────────────────────────────────────────
   AÇÕES — expostas globalmente
───────────────────────────────────────── */

window._vitrineTogglePainel = async function() {
  const painel = document.getElementById('vitrine-painel-add');
  if (!painel) return;

  if (painel.style.display === 'none') {
    painel.style.display = 'block';
    if (_indicadores.length === 0) {
      document.getElementById('vitrine-lista-disp').innerHTML =
        `<p style="padding:12px;font-size:13px;color:#667eea;text-align:center;">⏳ Carregando indicadores...</p>`;
      await _buscarIndicadores();
    }
    _renderDisponíveis();
    document.getElementById('vitrine-busca')?.focus();
  } else {
    painel.style.display = 'none';
  }
};

window._vitrineFiltraBusca = function(termo) {
  _renderDisponíveis(termo);
};

window._vitrineAdicionar = function(codIndicador) {
  const ind = _indicadores.find(i => i.cod_indicador === codIndicador);
  if (!ind) return;

  const novoItem = {
    cod_indicador : ind.cod_indicador,
    nome          : ind.nome,
    unidade       : ind.unidade || 'valor_brl',
    tipo_grafico  : 'barra',                         // padrão seguro para ambas as unidades
    grupo         : 'nenhum',
    cor           : _proximaCor(),
    destaque      : _vitrineItems.length === 0        // primeiro item vira destaque
  };

  _vitrineItems.push(novoItem);

  // fecha painel e limpa busca
  const painel = document.getElementById('vitrine-painel-add');
  if (painel) painel.style.display = 'none';
  const busca = document.getElementById('vitrine-busca');
  if (busca) busca.value = '';

  _renderLista();
};

window._vitrineRemover = function(idx) {
  const eraDestaque = _vitrineItems[idx]?.destaque === true;
  _vitrineItems.splice(idx, 1);

  // Se removeu o destaque, o primeiro item restante assume
  if (eraDestaque && _vitrineItems.length > 0) {
    _vitrineItems[0].destaque = true;
  }

  _renderLista();
};

window._vitrineAlterarCampo = function(idx, campo, valor) {
  const item = _vitrineItems[idx];
  if (!item) return;

  // Checkbox destaque: só um por vez
  if (campo === 'destaque' && valor === true) {
    _vitrineItems.forEach(i => { i.destaque = false; });
  }

  // Validação de agrupamento antes de aplicar
  if (campo === 'grupo' || campo === 'tipo_grafico') {
    const candidato = { ...item, [campo]: valor };
    const erro = _validarGrupo(candidato);
    if (erro) {
      _mostrarAviso(erro);
      return; // reverte — não aplica a mudança
    }
  }

  _vitrineItems[idx][campo] = valor;

  // Re-renderiza só quando muda destaque (precisamos atualizar o ⭐ visualmente)
  if (campo === 'destaque') _renderLista();
};

/* ─────────────────────────────────────────
   API PÚBLICA
───────────────────────────────────────── */

/**
 * inicializarVitrine(newsletterId, containerEl)
 *
 * Chame dentro de abrirModalNewsletter(), após montar o modal:
 *
 *   const container = document.getElementById('vitrine-container');
 *   await window.inicializarVitrine(docId, container);
 */
window.inicializarVitrine = async function(newsletterId, containerEl) {
  _newsletterId = newsletterId;
  _containerEl  = containerEl;
  _indicadores  = [];       // limpa cache a cada abertura do modal

  await _carregarVitrine(newsletterId);
  _renderSecao();
};

/**
 * salvarVitrine(newsletterId)
 *
 * Chame no handler do botão "Salvar" da edição:
 *
 *   await window.salvarVitrine(docId);
 */
window.salvarVitrine = salvarVitrine;
