/* ==========================================================================
   alertasPush.js — Radar SIOPE · Admin
   Painel de envio manual de alertas push via OneSignal.
   Chamado por abrirTab('alertas-push') no admin.html.
   ========================================================================== */

// ─── Configuração dos templates (espelha api/push.js) ─────────────────────────
// ─── Tags disponíveis por device (plano gratuito OneSignal = 3 tags) ────────
// segmento      → 'assinante' | 'lead'
// municipio_cod → código IBGE do município monitorado
// alerta_municipio → '1' = opt-in para alertas municipais
// ─────────────────────────────────────────────────────────────────────────────
const PUSH_TEMPLATES = {
  nova_edicao: {
    label:      '📡 Nova edição (assinantes)',
    titulo:     '📡 Nova edição Radar SIOPE!',
    corpo:      'A edição #{edicao} já está disponível. {titulo}',
    url:        '/verNewsletterComToken.html',
    parametros: ['edicao', 'titulo'],
    publico:    'assinantes',
    bloqueaPublico: true,
    filtros:    [{ field: 'segmento', relation: '=', value: 'assinante' }],
  },
  nova_edicao_acesso_pro: {
    label:      '🔓 Acesso especial (leads)',
    titulo:     '🔓 Acesso especial liberado!',
    corpo:      'Edição #{edicao} com acesso completo por {horas}h. Exclusivo para você!',
    url:        '/verNewsletterComToken.html',
    parametros: ['edicao', 'horas'],
    publico:    'leads',
    bloqueaPublico: true,
    filtros:    [{ field: 'segmento', relation: '=', value: 'lead' }],
  },
  siope_prazo_proximo: {
    label:      '⏰ Prazo SIOPE se aproximando',
    titulo:     '⏰ Prazo SIOPE se aproximando!',
    corpo:      '{municipio}/{uf}: prazo em {dias} dias ({data_prazo}). Não perca!',
    url:        '/verNewsletterComToken.html',
    parametros: ['municipio', 'uf', 'municipio_cod', 'dias', 'data_prazo'],
    publico:    'assinantes',
    bloqueaPublico: false,
    filtros:    [
      { field: 'uf',              relation: '=', value: '{uf}'            },
      { field: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },
  siope_homologado: {
    label:      '✅ SIOPE homologado',
    titulo:     '✅ SIOPE homologado!',
    corpo:      '{municipio}/{uf}: dados do {bimestre}º bimestre de {ano} foram homologados.',
    url:        '/verNewsletterComToken.html',
    parametros: ['municipio', 'uf', 'municipio_cod', 'bimestre', 'ano'],
    publico:    'assinantes',
    bloqueaPublico: false,
    filtros:    [
      { field: 'uf',              relation: '=', value: '{uf}'            },
      { field: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },
  siope_percentual_baixo: {
    label:      '⚠️ Percentual MDE baixo',
    titulo:     '⚠️ Alerta: percentual MDE baixo!',
    corpo:      '{municipio}/{uf}: {percentual}% em MDE ({bimestre}º bim/{ano}). Mínimo: {minimo}%.',
    url:        '/verNewsletterComToken.html',
    parametros: ['municipio', 'uf', 'municipio_cod', 'bimestre', 'ano', 'percentual', 'minimo'],
    publico:    'assinantes',
    bloqueaPublico: false,
    filtros:    [
      { field: 'uf',              relation: '=', value: '{uf}'            },
      { field: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },
  siope_nao_enviado: {
    label:      '🚨 SIOPE não enviado',
    titulo:     '🚨 SIOPE não enviado!',
    corpo:      '{municipio}/{uf}: {bimestre}º bimestre não enviado. Prazo: {data_prazo}.',
    url:        '/verNewsletterComToken.html',
    parametros: ['municipio', 'uf', 'municipio_cod', 'bimestre', 'data_prazo'],
    publico:    'assinantes',
    bloqueaPublico: false,
    filtros:    [
      { field: 'uf',              relation: '=', value: '{uf}'            },
      { field: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },
  fundeb_repasse_creditado: {
    label:      '💰 Repasse FUNDEB creditado',
    titulo:     '💰 Repasse FUNDEB creditado!',
    corpo:      '{municipio}/{uf}: R$ {valor} referentes a {mes}/{ano}.',
    url:        '/verNewsletterComToken.html',
    parametros: ['municipio', 'uf', 'municipio_cod', 'valor', 'mes', 'ano'],
    publico:    'assinantes',
    bloqueaPublico: false,
    filtros:    [
      { field: 'uf',              relation: '=', value: '{uf}'            },
      { field: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },
  portaria_publicada: {
    label:      '📋 Nova portaria (todos assinantes)',
    titulo:     '📋 Nova portaria publicada!',
    corpo:      '{titulo_portaria}. Análise completa disponível no Radar SIOPE.',
    url:        '/verNewsletterComToken.html',
    parametros: ['titulo_portaria'],
    publico:    'assinantes',
    bloqueaPublico: true,
    filtros:    [{ field: 'segmento', relation: '=', value: 'assinante' }],
  },
};

const LABELS_PARAM = {
  edicao:        'Número da edição',
  titulo:        'Título da edição',
  horas:         'Horas de acesso',
  municipio:     'Nome do município',
  uf:            'UF (sigla)',
  municipio_cod: 'Código IBGE',
  dias:          'Dias para o prazo',
  data_prazo:    'Data do prazo (ex: 31/03/2025)',
  bimestre:      'Bimestre (1-6)',
  ano:           'Ano',
  percentual:    'Percentual aplicado (%)',
  minimo:        'Percentual mínimo (%)',
  valor:         'Valor (ex: 1.250.000,00)',
  mes:           'Mês (ex: março)',
  titulo_portaria: 'Título da portaria',
};

// Tipos que exigem seleção de município
const TIPOS_MUNICIPIO = [
  'siope_prazo_proximo',
  'siope_homologado',
  'siope_percentual_baixo',
  'siope_nao_enviado',
  'fundeb_repasse_creditado',
];

// ─── Estado local ─────────────────────────────────────────────────────────────
let _pushAdminToken  = '';
let _municipiosCache = {};   // { 'assinantes': [...], 'leads': [...] }

// ─── Entry point ─────────────────────────────────────────────────────────────
window.iniciarPainelAlertasPush = function () {
  const sec = document.getElementById('alertas-push');
  if (!sec) return;
  sec.innerHTML = _renderHTML();
  _bindEventos();
  _carregarHistorico();
};

// ─── HTML do painel ───────────────────────────────────────────────────────────
function _renderHTML() {
  return `
  <style>
    #alertas-push h2 { color:#0A3D62; margin-bottom:18px; }
    .push-card { background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:20px; margin-bottom:20px; }
    .push-card h3 { font-size:14px; font-weight:700; color:#0A3D62; margin:0 0 14px; text-transform:uppercase; letter-spacing:.4px; }
    .push-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .push-field { display:flex; flex-direction:column; gap:4px; }
    .push-field label { font-size:12px; font-weight:600; color:#475569; }
    .push-field input, .push-field select, .push-field textarea {
      padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px;
      font-size:13px; font-family:inherit;
    }
    .push-field textarea { resize:vertical; min-height:60px; }
    .push-params { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:12px; }
    .push-preview {
      background:#0A3D62; color:#fff; border-radius:10px;
      padding:16px 20px; margin-top:4px;
    }
    .push-preview .prev-titulo { font-size:15px; font-weight:700; margin-bottom:6px; }
    .push-preview .prev-corpo  { font-size:13px; color:#cbd5e1; line-height:1.5; }
    .push-preview .prev-url    { font-size:11px; color:#94a3b8; margin-top:8px; }
    .push-filtros-info {
      background:#f0f7ff; border:1px solid #bae6fd; border-radius:8px;
      padding:12px 14px; font-size:12px; color:#0369a1; margin-top:10px;
    }
    .push-filtros-info strong { display:block; margin-bottom:4px; font-size:13px; }
    .push-tag { display:inline-block; background:#e0f2fe; color:#0369a1;
      border-radius:4px; padding:2px 8px; font-size:11px; font-weight:600; margin:2px; }
    .push-tag.upsell { background:#fef3c7; color:#92400e; }
    .push-btn-enviar {
      width:100%; padding:13px; background:#0A3D62; color:#fff;
      border:none; border-radius:8px; font-size:15px; font-weight:700;
      cursor:pointer; margin-top:8px; transition:.15s;
    }
    .push-btn-enviar:hover { background:#0d4f7c; }
    .push-btn-enviar:disabled { opacity:.5; cursor:default; }
    .push-resultado {
      padding:12px 16px; border-radius:8px; font-size:13px;
      font-weight:600; margin-top:10px; display:none;
    }
    .push-resultado.ok    { background:#dcfce7; color:#166534; border:1px solid #bbf7d0; }
    .push-resultado.erro  { background:#fee2e2; color:#991b1b; border:1px solid #fecaca; }
    .push-hist-table { width:100%; border-collapse:collapse; font-size:13px; }
    .push-hist-table th { background:#f1f5f9; padding:8px 10px; text-align:left; font-size:11px; color:#64748b; text-transform:uppercase; }
    .push-hist-table td { padding:9px 10px; border-bottom:1px solid #f1f5f9; vertical-align:top; }
    .push-hist-table tr:hover td { background:#f8fafc; }
    .push-hist-detalhe { font-size:11px; color:#94a3b8; margin-top:2px; }
    .push-badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; }
    .push-badge.enviado { background:#dcfce7; color:#166534; }
    .push-url-toggle { font-size:11px; color:#0A3D62; cursor:pointer; text-decoration:underline; margin-top:6px; display:inline-block; }
    #push-url-campo { display:none; margin-top:8px; }
    .push-token-field { display:flex; gap:8px; align-items:flex-end; }
    .push-token-field input { flex:1; }
    .push-token-field button { padding:8px 14px; background:#475569; color:#fff; border:none; border-radius:6px; font-size:12px; cursor:pointer; white-space:nowrap; }
    .push-sep { border:none; border-top:1px solid #e2e8f0; margin:20px 0; }

    /* Seletor de municípios */
    .mun-wrap { margin-top:12px; }
    .mun-wrap h4 { font-size:12px; font-weight:700; color:#0A3D62; text-transform:uppercase; letter-spacing:.4px; margin:0 0 8px; }
    .mun-toolbar { display:flex; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap; }
    .mun-toolbar input { flex:1; min-width:160px; padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; }
    .mun-toolbar button { padding:6px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; background:#fff; cursor:pointer; white-space:nowrap; color:#475569; }
    .mun-toolbar button:hover { background:#f1f5f9; }
    .mun-lista { max-height:220px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px; padding:4px 0; background:#fff; }
    .mun-item { display:flex; align-items:center; gap:8px; padding:7px 12px; cursor:pointer; }
    .mun-item:hover { background:#f8fafc; }
    .mun-item input[type=checkbox] { width:15px; height:15px; cursor:pointer; accent-color:#0A3D62; flex-shrink:0; }
    .mun-item label { font-size:13px; color:#334155; cursor:pointer; flex:1; }
    .mun-contador { font-size:12px; color:#64748b; margin-top:6px; }
    .mun-loading { padding:16px; text-align:center; color:#94a3b8; font-size:13px; }
    .mun-vazio   { padding:16px; text-align:center; color:#f59e0b;  font-size:13px; }
  </style>

  <h2>🔔 Enviar Alertas Push</h2>

  <!-- Status de autenticação (preenchido automaticamente) -->
  <div id="push-auth-status" style="padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0">
    ⏳ Verificando autenticação...
  </div>

  <!-- Composição -->
  <div class="push-card">
    <h3>✏️ Compor Alerta</h3>
    <div class="push-grid">
      <div class="push-field">
        <label>Tipo de alerta</label>
        <select id="push-tipo" onchange="_pushOnTipoChange()">
          <option value="">— Selecione —</option>
          ${Object.entries(PUSH_TEMPLATES).map(([k, v]) =>
            `<option value="${k}">${v.label}</option>`
          ).join('')}
        </select>
      </div>
      <div class="push-field">
        <label>Público</label>
        <select id="push-publico" onchange="_pushAtualizarPreview()">
          <option value="todos">👥 Todos (leads + assinantes)</option>
          <option value="leads">👤 Leads</option>
          <option value="assinantes">🏅 Assinantes</option>
        </select>
      </div>
    </div>

    <!-- Feature de alerta (só para assinantes) -->
    <div id="push-feature-wrap" style="margin-top:12px; display:none">
      <div class="push-field">
        <label>Feature de alerta (assinantes)</label>
        <select id="push-feature" onchange="_pushAtualizarPreview()">
          <option value="todos">Indiferente — todos os assinantes</option>
          <option value="com">✅ Com feature de alerta (alertas operacionais)</option>
          <option value="sem">🎯 Sem feature de alerta (upsell estratégico)</option>
        </select>
      </div>
    </div>

    <!-- Parâmetros dinâmicos -->
    <div id="push-params-wrap"></div>

    <!-- Seleção de municípios (só para tipos de município) -->
    <div id="push-municipios-wrap" style="display:none"></div>

    <hr class="push-sep">

    <!-- Preview -->
    <h3>👁️ Preview</h3>
    <div class="push-preview">
      <div class="prev-titulo" id="push-prev-titulo">Selecione um tipo de alerta</div>
      <div class="prev-corpo"  id="push-prev-corpo">—</div>
      <div class="prev-url"    id="push-prev-url"></div>
    </div>

    <!-- URL personalizada -->
    <span class="push-url-toggle" onclick="_pushToggleUrl()">⚙️ Personalizar URL de destino</span>
    <div id="push-url-campo">
      <div class="push-field">
        <label>URL de destino</label>
        <input type="text" id="push-url-custom" placeholder="/verNewsletterComToken.html?nid=..." oninput="_pushAtualizarPreview()">
      </div>
    </div>

    <!-- Filtros que serão aplicados -->
    <div class="push-filtros-info" id="push-filtros-info" style="display:none">
      <strong>🎯 Filtros OneSignal que serão aplicados:</strong>
      <div id="push-filtros-tags"></div>
    </div>

    <hr class="push-sep">

    <button class="push-btn-enviar" id="push-btn-enviar" onclick="_pushConfirmar()" disabled>
      🔔 Enviar alerta
    </button>
    <div class="push-resultado" id="push-resultado"></div>
  </div>

  <!-- Histórico -->
  <div class="push-card">
    <h3>📋 Histórico de alertas disparados</h3>
    <div id="push-historico-wrap">
      <p style="color:#94a3b8;font-size:13px">Carregando...</p>
    </div>
  </div>

  <!-- Modal de confirmação -->
  <div id="push-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:none;align-items:center;justify-content:center">
    <div style="background:#fff;border-radius:12px;padding:28px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <h3 style="margin:0 0 10px;color:#0A3D62">⚠️ Confirmar envio</h3>
      <p id="push-modal-texto" style="font-size:14px;color:#475569;line-height:1.5;margin:0 0 20px"></p>
      <div style="display:flex;gap:10px">
        <button onclick="_pushCancelarModal()"
          style="flex:1;padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer;font-weight:600">
          Cancelar
        </button>
        <button onclick="_pushEnviar()"
          style="flex:1;padding:10px;background:#dc2626;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700">
          Confirmar envio
        </button>
      </div>
    </div>
  </div>
  `;
}

// ─── Eventos e lógica ─────────────────────────────────────────────────────────

async function _bindEventos() {
  const statusEl = document.getElementById('push-auth-status');

  // 1. Tenta reusar token já obtido nesta sessão
  const cached = sessionStorage.getItem('_pushAdminToken');
  if (cached) {
    _pushAdminToken = cached;
    if (statusEl) {
      statusEl.style.background = '#f0fdf4';
      statusEl.style.color      = '#166534';
      statusEl.style.border     = '1px solid #bbf7d0';
      statusEl.textContent      = '✅ Admin autenticado.';
    }
    return;
  }

  // 2. Busca automaticamente usando o email do admin logado
  const usuarioLogado = JSON.parse(localStorage.getItem('usuarioLogado') || '{}');
  const email = usuarioLogado?.email;

  if (!email) {
    if (statusEl) {
      statusEl.style.background = '#fef2f2';
      statusEl.style.color      = '#991b1b';
      statusEl.style.border     = '1px solid #fecaca';
      statusEl.textContent      = '❌ Sessão expirada. Faça login novamente.';
    }
    return;
  }

  try {
    const resp = await fetch('/api/push', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ acao: 'admin-token', email }),
    });

    // Lê como texto primeiro — evita crash se a API retornar HTML de erro
    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // API retornou HTML (crash no servidor) — exibe trecho para debug
      const preview = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      throw new Error(`Resposta inválida da API: ${preview}`);
    }

    if (data.ok && data.token) {
      _pushAdminToken = data.token;
      sessionStorage.setItem('_pushAdminToken', data.token);
      if (statusEl) {
        statusEl.style.background = '#f0fdf4';
        statusEl.style.color      = '#166534';
        statusEl.style.border     = '1px solid #bbf7d0';
        statusEl.textContent      = `✅ Admin autenticado como ${email}.`;
      }
    } else {
      throw new Error(data.error || 'Não autorizado');
    }
  } catch (err) {
    if (statusEl) {
      statusEl.style.background = '#fef2f2';
      statusEl.style.color      = '#991b1b';
      statusEl.style.border     = '1px solid #fecaca';
      statusEl.textContent      = `❌ Falha na autenticação: ${err.message}`;
    }
    console.error('[alertasPush] auth:', err);
  }
}

window._pushOnTipoChange = async function () {
  const tipo = document.getElementById('push-tipo')?.value;
  const tpl  = PUSH_TEMPLATES[tipo];

  // Público
  const selectPublico = document.getElementById('push-publico');
  if (tpl) {
    selectPublico.value    = tpl.publico;
    selectPublico.disabled = tpl.bloqueaPublico;
  } else {
    selectPublico.disabled = false;
  }

  // Feature wrap (só faz sentido para assinantes)
  _pushAtualizarFeatureWrap();

  // Parâmetros dinâmicos
  const wrap = document.getElementById('push-params-wrap');
  if (!tpl || !tpl.parametros.length) { wrap.innerHTML = ''; _pushAtualizarPreview(); return; }

  // Parâmetros dinâmicos — para tipos de município, oculta municipio_cod
  // (ele é resolvido pela seleção de municípios, não digitado manualmente)
  const ehTipoMunicipio = TIPOS_MUNICIPIO.includes(tipo);
  const paramsMostrar = tpl.parametros.filter(p => !ehTipoMunicipio || p !== 'municipio_cod');

  if (paramsMostrar.length > 0) {
    wrap.innerHTML = `
      <hr class="push-sep">
      <h3 style="font-size:14px;font-weight:700;color:#0A3D62;margin:0 0 10px;text-transform:uppercase;letter-spacing:.4px">
        📝 Parâmetros
      </h3>
      <div class="push-params">
        ${paramsMostrar.map(p => `
          <div class="push-field">
            <label>${LABELS_PARAM[p] || p}</label>
            <input type="text" id="push-param-${p}" placeholder="${p}" oninput="_pushAtualizarPreview()">
          </div>
        `).join('')}
      </div>
    `;
  } else {
    wrap.innerHTML = '';
  }

  // Seleção de municípios
  if (ehTipoMunicipio) {
    const publico = document.getElementById('push-publico')?.value || 'assinantes';
    await _pushCarregarMunicipios(publico);
  } else {
    const mWrap = document.getElementById('push-municipios-wrap');
    if (mWrap) { mWrap.style.display = 'none'; mWrap.innerHTML = ''; }
  }

  _pushAtualizarPreview();
};

window._pushAtualizarFeatureWrap = async function () {
  const tipo    = document.getElementById('push-tipo')?.value;
  const publico = document.getElementById('push-publico')?.value;
  const wrap    = document.getElementById('push-feature-wrap');

  // Feature só faz sentido para assinantes
  if (wrap) wrap.style.display = publico === 'assinantes' ? 'block' : 'none';

  // Recarrega municípios se for tipo de município e público mudou
  if (tipo && TIPOS_MUNICIPIO.includes(tipo)) {
    await _pushCarregarMunicipios(publico);
  }

  _pushAtualizarPreview();
};

// chamado pelo select de público também
document.addEventListener('change', e => {
  if (e.target?.id === 'push-publico') _pushAtualizarFeatureWrap();
});

// ─── Carrega municípios via API ───────────────────────────────────────────────
async function _pushCarregarMunicipios(publico) {
  const mWrap = document.getElementById('push-municipios-wrap');
  if (!mWrap) return;

  mWrap.style.display = 'block';
  mWrap.innerHTML = `
    <hr class="push-sep">
    <div class="mun-wrap">
      <h4>📍 Municípios destinatários</h4>
      <div class="mun-loading">⏳ Carregando municípios com push ativo...</div>
    </div>`;

  // Usa cache se já buscou para este público
  const pubKey = publico || 'assinantes';
  if (_municipiosCache[pubKey]) {
    _renderMunicipios(_municipiosCache[pubKey], pubKey);
    return;
  }

  if (!_pushAdminToken) {
    mWrap.innerHTML += '';
    document.querySelector('#push-municipios-wrap .mun-loading').textContent =
      '⚠️ Autentique-se primeiro para carregar os municípios.';
    return;
  }

  try {
    const resp = await fetch('/api/push', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'x-admin-token': _pushAdminToken,
      },
      body: JSON.stringify({ acao: 'buscar-municipios', publico: pubKey }),
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Resposta inválida da API'); }

    if (!data.ok) throw new Error(data.error || 'Erro ao buscar municípios');

    _municipiosCache[pubKey] = data.municipios || [];
    _renderMunicipios(_municipiosCache[pubKey], pubKey);

  } catch (err) {
    const mWrap2 = document.getElementById('push-municipios-wrap');
    if (mWrap2) mWrap2.innerHTML = `
      <hr class="push-sep">
      <div class="mun-wrap">
        <h4>📍 Municípios destinatários</h4>
        <div class="mun-vazio">❌ Erro ao carregar: ${err.message}</div>
      </div>`;
  }
}

function _renderMunicipios(lista, pubKey) {
  const mWrap = document.getElementById('push-municipios-wrap');
  if (!mWrap) return;

  if (!lista.length) {
    mWrap.innerHTML = `
      <hr class="push-sep">
      <div class="mun-wrap">
        <h4>📍 Municípios destinatários</h4>
        <div class="mun-vazio">⚠️ Nenhum município encontrado com push ativo para este público.</div>
      </div>`;
    return;
  }

  const labelPublico = pubKey === 'leads' ? 'leads' : 'assinantes';

  mWrap.innerHTML = `
    <hr class="push-sep">
    <div class="mun-wrap">
      <h4>📍 Municípios — ${lista.length} ${labelPublico} com push ativo</h4>
      <div class="mun-toolbar">
        <input type="text" id="mun-busca" placeholder="🔍 Filtrar município..." oninput="_pushFiltrarMunicipios()">
        <button onclick="_pushSelecionarTodosMunicipios(true)">✅ Selecionar todos</button>
        <button onclick="_pushSelecionarTodosMunicipios(false)">☐ Limpar</button>
      </div>
      <div class="mun-lista" id="mun-lista">
        ${lista.map(m => `
          <div class="mun-item" data-nome="${m.nome.toLowerCase()}">
            <input type="checkbox" id="mun-${m.cod}" value="${m.cod}" data-nome="${m.nome}"
              onchange="_pushAtualizarPreview()">
            <label for="mun-${m.cod}">${m.nome} <span style="color:#94a3b8;font-size:11px">(${m.cod})</span></label>
          </div>
        `).join('')}
      </div>
      <div class="mun-contador" id="mun-contador">0 município(s) selecionado(s)</div>
    </div>`;

  _pushAtualizarPreview();
}

window._pushFiltrarMunicipios = function () {
  const termo = document.getElementById('mun-busca')?.value?.toLowerCase() || '';
  document.querySelectorAll('#mun-lista .mun-item').forEach(item => {
    item.style.display = item.dataset.nome.includes(termo) ? '' : 'none';
  });
};

window._pushSelecionarTodosMunicipios = function (selecionar) {
  document.querySelectorAll('#mun-lista input[type=checkbox]').forEach(cb => {
    // Só altera visíveis (respeita filtro de busca)
    const item = cb.closest('.mun-item');
    if (!item || item.style.display === 'none') return;
    cb.checked = selecionar;
  });
  _pushAtualizarPreview();
};

function _pushGetMunicipiosSelecionados() {
  const checkboxes = document.querySelectorAll('#mun-lista input[type=checkbox]:checked');
  return Array.from(checkboxes).map(cb => ({ cod: cb.value, nome: cb.dataset.nome }));
}

window._pushAtualizarPreview = function () {
  const tipo   = document.getElementById('push-tipo')?.value;
  const tpl    = PUSH_TEMPLATES[tipo];
  const params = _pushColetarParams();

  const titulo = tpl ? _sub(tpl.titulo, params) : 'Selecione um tipo de alerta';
  const corpo  = tpl ? _sub(tpl.corpo,  params) : '—';
  const urlCustom = document.getElementById('push-url-custom')?.value?.trim();
  const url    = urlCustom || (tpl ? _sub(tpl.url, params) : '');

  document.getElementById('push-prev-titulo').textContent = titulo;
  document.getElementById('push-prev-corpo').textContent  = corpo;
  document.getElementById('push-prev-url').textContent    = url ? '🔗 ' + url : '';

  // Atualiza contador de municípios
  const munsSel = _pushGetMunicipiosSelecionados();
  const contEl  = document.getElementById('mun-contador');
  if (contEl) {
    contEl.textContent = munsSel.length === 0
      ? '⚠️ Selecione ao menos 1 município para enviar.'
      : `✅ ${munsSel.length} município(s) selecionado(s).`;
    contEl.style.color = munsSel.length === 0 ? '#f59e0b' : '#166534';
  }

  // Filtros
  const filtrosInfo = document.getElementById('push-filtros-info');
  const filtrosTags = document.getElementById('push-filtros-tags');
  const filtros     = tpl ? _montarFiltros(tpl, params) : [];

  if (filtros.length) {
    filtrosInfo.style.display = 'block';
    filtrosTags.innerHTML     = filtros.map(f => {
      const key = f.key || f.field;
      return `<span class="push-tag">${key} ${f.relation} "${f.value}"</span>`;
    }).join(' ');
  } else {
    filtrosInfo.style.display = 'none';
  }

  // Habilita botão se tipo selecionado + token presente
  const btn = document.getElementById('push-btn-enviar');
  if (btn) btn.disabled = !tipo || !_pushAdminToken;
};

window._pushToggleUrl = function () {
  const el = document.getElementById('push-url-campo');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

window._pushConfirmar = function () {
  const tipo    = document.getElementById('push-tipo')?.value;
  const tpl     = PUSH_TEMPLATES[tipo];
  if (!tpl) return;

  const params  = _pushColetarParams();
  const filtros = _montarFiltros(tpl, params);
  const titulo  = _sub(tpl.titulo, params);

  const desc = filtros.map(f => `${f.key || f.field} = "${f.value}"`).join(', ');
  document.getElementById('push-modal-texto').innerHTML =
    `Você está prestes a enviar:<br><br>
     <strong>${titulo}</strong><br><br>
     Filtros: <em>${desc || 'nenhum (broadcast)'}</em><br><br>
     Esta ação não pode ser desfeita.`;

  const modal = document.getElementById('push-modal');
  modal.style.display = 'flex';
};

window._pushCancelarModal = function () {
  document.getElementById('push-modal').style.display = 'none';
};

window._pushEnviar = async function () {
  document.getElementById('push-modal').style.display = 'none';

  const tipo      = document.getElementById('push-tipo')?.value;
  const tpl       = PUSH_TEMPLATES[tipo];
  const params    = _pushColetarParams();
  const urlCustom = document.getElementById('push-url-custom')?.value?.trim();
  const resultado = document.getElementById('push-resultado');
  const btn       = document.getElementById('push-btn-enviar');

  btn.disabled       = true;
  btn.textContent    = '⏳ Enviando...';
  resultado.style.display = 'none';

  // Bloqueia envio se tipo de município sem município selecionado
  if (TIPOS_MUNICIPIO.includes(tipo)) {
    const muns = _pushGetMunicipiosSelecionados();
    if (muns.length === 0) {
      resultado.style.display = 'block';
      resultado.className     = 'push-resultado erro';
      resultado.textContent   = '❌ Selecione ao menos 1 município antes de enviar.';
      btn.disabled    = false;
      btn.textContent = '🔔 Enviar alerta';
      return;
    }
  }

  const body = {
    acao:       'alerta',
    tipo,
    parametros: { ...params },
  };

  // URL customizada
  if (urlCustom) body.parametros._url_override = urlCustom;

  // Filtros extras de público/feature (enviados como parametros especiais
  // que a api/push.js pode usar para compor filtros adicionais)
  const publico  = document.getElementById('push-publico')?.value;
  const feature  = document.getElementById('push-feature')?.value;
  if (publico !== 'todos') body.parametros._publico = publico;
  if (feature && feature !== 'todos') body.parametros._feature = feature;

  try {
    const resp = await fetch('/api/push', {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'x-admin-token':  _pushAdminToken,
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json();

    resultado.style.display = 'block';
    if (data.ok) {
      resultado.className = 'push-resultado ok';
      resultado.innerHTML = `✅ Alerta enviado com sucesso!<br>
        <span style="font-weight:400">Destinatários estimados: <strong>${data.destinatarios ?? '—'}</strong> &nbsp;·&nbsp;
        ID OneSignal: <code>${data.onesignal_id ?? '—'}</code></span>`;
      _carregarHistorico(); // atualiza histórico
    } else {
      resultado.className = 'push-resultado erro';
      resultado.textContent = `❌ Erro: ${data.error || 'Falha desconhecida.'}`;
    }
  } catch (err) {
    resultado.style.display = 'block';
    resultado.className     = 'push-resultado erro';
    resultado.textContent   = `❌ Erro de rede: ${err.message}`;
  } finally {
    btn.disabled    = false;
    btn.textContent = '🔔 Enviar alerta';
  }
};

// ─── Histórico ────────────────────────────────────────────────────────────────
async function _carregarHistorico() {
  const wrap = document.getElementById('push-historico-wrap');
  if (!wrap) return;

  try {
    const snap = await window.db
      .collection('alertas_disparados')
      .orderBy('disparado_em', 'desc')
      .limit(20)
      .get();

    if (snap.empty) {
      wrap.innerHTML = '<p style="color:#94a3b8;font-size:13px">Nenhum alerta disparado ainda.</p>';
      return;
    }

    const rows = snap.docs.map(doc => {
      const d   = doc.data();
      const em  = d.disparado_em?.toDate?.()?.toLocaleString('pt-BR') ?? '—';
      const tip = PUSH_TEMPLATES[d.tipo]?.label ?? d.tipo;
      return `
        <tr>
          <td>${em}</td>
          <td>${tip}</td>
          <td>${d.titulo || '—'}</td>
          <td style="text-align:center"><strong>${d.destinatarios_est ?? '—'}</strong></td>
          <td><span class="push-badge enviado">${d.status || 'enviado'}</span></td>
          <td>
            <span class="push-hist-detalhe">${d.onesignal_id ?? ''}</span>
          </td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
      <table class="push-hist-table">
        <thead>
          <tr>
            <th>Data/hora</th>
            <th>Tipo</th>
            <th>Título</th>
            <th>Dest.</th>
            <th>Status</th>
            <th>OneSignal ID</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (err) {
    wrap.innerHTML = `<p style="color:#ef4444;font-size:13px">Erro ao carregar histórico: ${err.message}</p>`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _pushColetarParams() {
  const tipo = document.getElementById('push-tipo')?.value;
  const tpl  = PUSH_TEMPLATES[tipo];
  if (!tpl) return {};
  const p = {};
  tpl.parametros.forEach(k => {
    const el = document.getElementById(`push-param-${k}`);
    if (el) p[k] = el.value.trim();
  });
  // Municípios selecionados (para tipos de município)
  if (TIPOS_MUNICIPIO.includes(tipo)) {
    const muns = _pushGetMunicipiosSelecionados();
    if (muns.length > 0) p._municipios = muns;
  }
  return p;
}

function _montarFiltros(tpl, params) {
  const publico  = document.getElementById('push-publico')?.value ?? 'todos';
  const feature  = document.getElementById('push-feature')?.value ?? 'todos';
  const muns     = params._municipios || null;

  // Filtros base do template — sem municipio_cod (tratado abaixo via _municipios)
  // Normaliza para formato { field:'tag', key:'...', relation, value } exigido pela API OneSignal
  const filtrosBase = (tpl.filtros || [])
    .filter(f => (f.key || f.field) !== 'municipio_cod')
    .map(f => ({ field: 'tag', key: f.key || f.field, relation: f.relation, value: _sub(f.value, params) }));

  // Filtro de público (só adiciona se o template não tiver segmento)
  const temSegmento = filtrosBase.some(f => f.key === 'segmento');
  if (!temSegmento && publico !== 'todos') {
    const val = publico === 'assinantes' ? 'assinante' : 'lead';
    filtrosBase.push({ field: 'tag', key: 'segmento', relation: '=', value: val });
  }

  // (feature filter removido — alerta_municipio substituído por uf)

  // Múltiplos municípios → grupos com OR
  if (!muns || muns.length === 0) return filtrosBase;
  if (muns.length === 1) {
    return [...filtrosBase, { field: 'tag', key: 'municipio_cod', relation: '=', value: String(muns[0].cod) }];
  }
  // Expande: (base AND cod=A) OR (base AND cod=B) ...
  const filtros = [];
  muns.forEach((mun, i) => {
    if (i > 0) filtros.push({ operator: 'OR' });
    filtrosBase.forEach(f => filtros.push({ ...f }));
    filtros.push({ field: 'tag', key: 'municipio_cod', relation: '=', value: String(mun.cod) });
  });
  return filtros;
}

function _sub(str, params) {
  if (!str) return '';
  return str.replace(/\{(\w+)\}/g, (_, k) =>
    params[k] !== undefined && params[k] !== '' ? params[k] : `{${k}}`
  );
}
