/* ==========================================================================
alertasPush.js — Radar SIOPE · Admin
Painel de envio manual de alertas push via OneSignal.
Chamado por abrirTab('alertas-push') no admin.html.
========================================================================== */

// ─── Configuração dos templates (espelha api/push.js) ─────────────────────────
const PUSH_TEMPLATES = {
  nova_edicao: {
    label: '📡 Nova edição (assinantes)',
    titulo: '📡 Nova edição Radar SIOPE!',
    corpo: 'A edição #{edicao} já está disponível. {titulo}',
    url: '/verNewsletterComToken.html',
    parametros: ['edicao', 'titulo'],
    publico: 'assinantes',
    bloqueaPublico: true,
    filtros: [{ field: 'segmento', relation: '=', value: 'assinante' }],
  },
  nova_edicao_acesso_pro: {
    label: '🔓 Acesso especial (leads)',
    titulo: '🔓 Acesso especial liberado!',
    corpo: 'Edição #{edicao} com acesso completo por {horas}h. Exclusivo para você!',
    url: '/verNewsletterComToken.html',
    parametros: ['edicao', 'horas'],
    publico: 'leads',
    bloqueaPublico: true,
    filtros: [{ field: 'segmento', relation: '=', value: 'lead' }],
  },
  siope_prazo_proximo: {
    label: '⏰ Prazo SIOPE se aproximando',
    titulo: '⏰ Prazo SIOPE se aproximando!',
    corpo: '{municipio}/{uf}: prazo em {dias} dias ({data_prazo}). Não perca!',
    url: '/verNewsletterComToken.html',
    parametros: ['municipio', 'uf', 'municipio_cod', 'dias', 'data_prazo'],
    publico: 'assinantes',
    bloqueaPublico: false,
    filtros: [
      { field: 'alerta_municipio', relation: '=', value: '1' },
      { field: 'municipio_cod', relation: '=', value: '{municipio_cod}' },
    ],
  },
  siope_homologado: {
    label: '✅ SIOPE homologado',
    titulo: '✅ SIOPE homologado!',
    corpo: '{municipio}/{uf}: dados do {bimestre}º bimestre de {ano} foram homologados.',
    url: '/verNewsletterComToken.html',
    parametros: ['municipio', 'uf', 'municipio_cod', 'bimestre', 'ano'],
    publico: 'assinantes',
    bloqueaPublico: false,
    filtros: [
      { field: 'alerta_municipio', relation: '=', value: '1' },
      { field: 'municipio_cod', relation: '=', value: '{municipio_cod}' },
    ],
  },
  siope_percentual_baixo: {
    label: '⚠️ Percentual MDE baixo',
    titulo: '⚠️ Alerta: percentual MDE baixo!',
    corpo: '{municipio}/{uf}: {percentual}% em MDE ({bimestre}º bim/{ano}). Mínimo: {minimo}%.',
    url: '/verNewsletterComToken.html',
    parametros: ['municipio', 'uf', 'municipio_cod', 'bimestre', 'ano', 'percentual', 'minimo'],
    publico: 'assinantes',
    bloqueaPublico: false,
    filtros: [
      { field: 'alerta_municipio', relation: '=', value: '1' },
      { field: 'municipio_cod', relation: '=', value: '{municipio_cod}' },
    ],
  },
  siope_nao_enviado: {
    label: '🚨 SIOPE não enviado',
    titulo: '🚨 SIOPE não enviado!',
    corpo: '{municipio}/{uf}: {bimestre}º bimestre não enviado. Prazo: {data_prazo}.',
    url: '/verNewsletterComToken.html',
    parametros: ['municipio', 'uf', 'municipio_cod', 'bimestre', 'data_prazo'],
    publico: 'assinantes',
    bloqueaPublico: false,
    filtros: [
      { field: 'alerta_municipio', relation: '=', value: '1' },
      { field: 'municipio_cod', relation: '=', value: '{municipio_cod}' },
    ],
  },
  fundeb_repasse_creditado: {
    label: '💰 Repasse FUNDEB creditado',
    titulo: '💰 Repasse FUNDEB creditado!',
    corpo: '{municipio}/{uf}: R$ {valor} referentes a {mes}/{ano}.',
    url: '/verNewsletterComToken.html',
    parametros: ['municipio', 'uf', 'municipio_cod', 'valor', 'mes', 'ano'],
    publico: 'assinantes',
    bloqueaPublico: false,
    filtros: [
      { field: 'alerta_municipio', relation: '=', value: '1' },
      { field: 'municipio_cod', relation: '=', value: '{municipio_cod}' },
    ],
  },
  portaria_publicada: {
    label: '📋 Nova portaria (todos assinantes)',
    titulo: '📋 Nova portaria publicada!',
    corpo: '{titulo_portaria}. Análise completa disponível no Radar SIOPE.',
    url: '/verNewsletterComToken.html',
    parametros: ['titulo_portaria'],
    publico: 'assinantes',
    bloqueaPublico: true,
    filtros: [{ field: 'segmento', relation: '=', value: 'assinante' }],
  },
};

const LABELS_PARAM = {
  edicao: 'Número da edição',
  titulo: 'Título da edição',
  horas: 'Horas de acesso',
  municipio: 'Nome do município',
  uf: 'UF (sigla)',
  municipio_cod: 'Código IBGE',
  dias: 'Dias para o prazo',
  data_prazo: 'Data do prazo (ex: 31/03/2025)',
  bimestre: 'Bimestre (1-6)',
  ano: 'Ano',
  percentual: 'Percentual aplicado (%)',
  minimo: 'Percentual mínimo (%)',
  valor: 'Valor (ex: 1.250.000,00)',
  mes: 'Mês (ex: março)',
  titulo_portaria: 'Título da portaria',
};

const TIPOS_MUNICIPIO = [
  'siope_prazo_proximo',
  'siope_homologado',
  'siope_percentual_baixo',
  'siope_nao_enviado',
  'fundeb_repasse_creditado',
];

// ─── Estado local ─────────────────────────────────────────────────────────────
let _pushAdminToken = '';
let _municipiosCache = {};

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
      .push-preview { background:#0A3D62; color:#fff; border-radius:10px; padding:16px 20px; margin-top:4px; }
      .push-preview .prev-titulo { font-size:15px; font-weight:700; margin-bottom:6px; }
      .push-preview .prev-corpo { font-size:13px; color:#cbd5e1; line-height:1.5; }
      .push-preview .prev-url { font-size:11px; color:#94a3b8; margin-top:8px; }
      .push-filtros-info { background:#f0f7ff; border:1px solid #bae6fd; border-radius:8px; padding:12px 14px; font-size:12px; color:#0369a1; margin-top:10px; }
      .push-filtros-info strong { display:block; margin-bottom:4px; font-size:13px; }
      .push-tag { display:inline-block; background:#e0f2fe; color:#0369a1; border-radius:4px; padding:2px 8px; font-size:11px; font-weight:600; margin:2px; }
      .push-tag.upsell { background:#fef3c7; color:#92400e; }
      .push-btn-enviar { width:100%; padding:13px; background:#0A3D62; color:#fff; border:none; border-radius:8px; font-size:15px; font-weight:700; cursor:pointer; margin-top:8px; transition:.15s; }
      .push-btn-enviar:hover { background:#0d4f7c; }
      .push-btn-enviar:disabled { opacity:.5; cursor:default; }
      .push-resultado { padding:12px 16px; border-radius:8px; font-size:13px; font-weight:600; margin-top:10px; display:none; }
      .push-resultado.ok { background:#dcfce7; color:#166534; border:1px solid #bbf7d0; }
      .push-resultado.erro { background:#fee2e2; color:#991b1b; border:1px solid #fecaca; }
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
      .mun-vazio { padding:16px; text-align:center; color:#f59e0b; font-size:13px; }
      .canal-tabs { display:flex; gap:8px; margin-bottom:16px; }
      .canal-tab { flex:1; padding:10px 14px; border:2px solid #e2e8f0; border-radius:8px; background:#fff; font-size:13px; font-weight:600; cursor:pointer; color:#64748b; transition:all .15s; text-align:center; }
      .canal-tab.ativo { border-color:#0A3D62; background:#0A3D62; color:#fff; }
      .canal-tab:hover:not(.ativo) { border-color:#0A3D62; color:#0A3D62; background:#f0f7ff; }
      .wa-msg-area { margin-bottom:14px; }
      .wa-msg-area label { font-size:12px; font-weight:600; color:#475569; display:block; margin-bottom:4px; }
      .wa-msg-area textarea { width:100%; box-sizing:border-box; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; min-height:80px; resize:vertical; font-family:inherit; color:#1e293b; }
      .wa-msg-area textarea:focus { outline:none; border-color:#16a34a; box-shadow:0 0 0 3px rgba(22,163,74,.1); }
      .wa-section-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
      .wa-section-header span { font-size:12px; font-weight:700; color:#0A3D62; text-transform:uppercase; letter-spacing:.4px; }
      .wa-section-header button { padding:4px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:11px; background:#fff; cursor:pointer; color:#64748b; }
      .wa-section-header button:hover { background:#f1f5f9; }
      .wa-toolbar { display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap; align-items:center; }
      .wa-toolbar input[type=text] { flex:1; min-width:150px; padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; box-sizing:border-box; }
      .wa-toolbar button { padding:6px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; background:#fff; cursor:pointer; color:#475569; white-space:nowrap; }
      .wa-toolbar button:hover { background:#f1f5f9; }
      .wa-lista { max-height:260px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px; background:#fff; }
      .wa-item { display:flex; align-items:center; gap:10px; padding:9px 14px; border-bottom:1px solid #f8fafc; cursor:pointer; }
      .wa-item:last-child { border-bottom:none; }
      .wa-item:hover { background:#f8fafc; }
      .wa-item input[type=checkbox] { width:15px; height:15px; cursor:pointer; accent-color:#16a34a; flex-shrink:0; }
      .wa-item .wa-nome { font-size:13px; font-weight:600; color:#1e293b; flex:1; }
      .wa-item .wa-sub { font-size:11px; color:#94a3b8; margin-top:1px; }
      .wa-item .wa-fone { font-size:11px; color:#64748b; font-family:monospace; white-space:nowrap; }
      .wa-vazio, .wa-loading { padding:24px; text-align:center; font-size:13px; color:#94a3b8; }
      .wa-contador { font-size:12px; color:#64748b; margin-top:8px; }
      .wa-btn-iniciar { width:100%; padding:13px; background:#16a34a; color:#fff; border:none; border-radius:8px; font-size:15px; font-weight:700; cursor:pointer; margin-top:12px; transition:.15s; }
      .wa-btn-iniciar:hover:not(:disabled) { background:#15803d; }
      .wa-btn-iniciar:disabled { opacity:.5; cursor:not-allowed; }
      #wa-seq-overlay { position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:9999; display:none; align-items:center; justify-content:center; }
      .wa-seq-box { background:#fff; border-radius:14px; padding:28px 24px; max-width:460px; width:90%; box-shadow:0 20px 60px rgba(0,0,0,.3); }
      .wa-seq-titulo { font-size:17px; font-weight:700; color:#0A3D62; margin:0 0 4px; }
      .wa-seq-desc { font-size:13px; color:#64748b; margin:0 0 20px; }
      .wa-seq-bar-wrap { height:6px; background:#e2e8f0; border-radius:10px; overflow:hidden; margin-bottom:5px; }
      .wa-seq-bar-fill { height:100%; background:#16a34a; border-radius:10px; transition:width .3s ease; }
      .wa-seq-bar-txt { font-size:12px; color:#64748b; text-align:right; margin-bottom:18px; }
      .wa-seq-assinante { background:#f8fafc; border-radius:10px; padding:14px 16px; margin-bottom:18px; border-left:4px solid #16a34a; }
      .wa-seq-nome { font-size:15px; font-weight:700; color:#1e293b; }
      .wa-seq-info { font-size:12px; color:#64748b; margin-top:4px; }
      .wa-seq-enviado { font-size:12px; color:#16a34a; margin-top:6px; font-weight:600; display:none; }
      .wa-seq-btns { display:flex; gap:10px; margin-bottom:10px; }
      .wa-seq-abrir { flex:2; padding:12px; background:#16a34a; color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:700; cursor:pointer; }
      .wa-seq-abrir:hover { background:#15803d; }
      .wa-seq-proximo { flex:1; padding:12px; background:#0A3D62; color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; }
      .wa-seq-proximo:hover { background:#0d4f7c; }
      .wa-seq-cancelar { width:100%; padding:9px; background:transparent; border:1px solid #e2e8f0; border-radius:8px; font-size:13px; color:#94a3b8; cursor:pointer; }
      .wa-seq-cancelar:hover { background:#f8fafc; color:#475569; }
      .wa-modo-tabs { display:flex; gap:8px; margin-bottom:16px; }
      .wa-modo-tab { flex:1; padding:9px 14px; border:2px solid #e2e8f0; border-radius:8px; background:#fff; font-size:13px; font-weight:600; cursor:pointer; color:#64748b; transition:all .15s; text-align:center; }
      .wa-modo-tab.ativo { border-color:#16a34a; background:#16a34a; color:#fff; }
      .wa-modo-tab:hover:not(.ativo) { border-color:#16a34a; color:#16a34a; }
      .wa-grupo-btn { width:100%; padding:14px 16px; border:none; border-radius:10px; font-size:14px; font-weight:700; cursor:pointer; margin-bottom:10px; display:flex; align-items:center; gap:10px; transition:opacity .15s; }
      .wa-grupo-btn:hover { opacity:.88; }
      .wa-grupo-btn.edicoes { background:#075e54; color:#fff; }
      .wa-grupo-btn.alertas { background:#128c7e; color:#fff; }
      .wa-grupo-btn .wa-grupo-desc { font-size:11px; font-weight:400; opacity:.85; margin-top:2px; }
      .push-badge.push { background:#dbeafe; color:#1e40af; }
      .push-badge.whatsapp { background:#dcfce7; color:#166534; }
    </style>

    <h2>🔔 Enviar Alertas</h2>
    <div id="push-auth-status" class="push-card">⏳ Verificando autenticação...</div>

    <div class="canal-tabs">
      <button class="canal-tab ativo" id="tab-canal-push" onclick="_waToggleCanal('push')">🔔 Push Notification</button>
      <button class="canal-tab" id="tab-canal-whatsapp" onclick="_waToggleCanal('whatsapp')">🟢 WhatsApp</button>
    </div>

    <div class="push-card" id="push-compose-card">
      <h3>✏️ Compor Alerta</h3>
      <div class="push-field">
        <label>Tipo de alerta</label>
        <select id="push-tipo" onchange="_pushOnTipoChange()">
          <option value="">— Selecione —</option>
          ${Object.entries(PUSH_TEMPLATES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="push-field" style="margin-top:12px">
        <label>Público</label>
        <select id="push-publico" onchange="_pushAtualizarFeatureWrap()">
          <option value="todos">👥 Todos (leads + assinantes)</option>
          <option value="leads">👤 Leads</option>
          <option value="assinantes">🏅 Assinantes</option>
        </select>
      </div>

      <div id="push-feature-wrap" style="margin-top:12px;display:none">
        <div class="push-field">
          <label>Feature de alerta (assinantes)</label>
          <select id="push-feature" onchange="_pushAtualizarPreview()">
            <option value="todos">Indiferente — todos os assinantes</option>
            <option value="com">✅ Com feature de alerta (alertas operacionais)</option>
            <option value="sem">🎯 Sem feature de alerta (upsell estratégico)</option>
          </select>
        </div>
      </div>

      <div id="push-params-wrap"></div>
      <div id="push-municipios-wrap" style="display:none"></div>

      <hr class="push-sep">
      <h3>👁️ Preview</h3>
      <div class="push-preview">
        <div class="prev-titulo" id="push-prev-titulo">Selecione um tipo de alerta</div>
        <div class="prev-corpo" id="push-prev-corpo">—</div>
        <div class="prev-url" id="push-prev-url"></div>
      </div>

      <span class="push-url-toggle" onclick="_pushToggleUrl()">⚙️ Personalizar URL de destino</span>
      <div id="push-url-campo">
        <div class="push-field">
          <label>URL de destino</label>
          <input type="text" id="push-url-custom" placeholder="/verNewsletterComToken.html?nid=..." oninput="_pushAtualizarPreview()">
        </div>
      </div>

      <div class="push-filtros-info" id="push-filtros-info" style="display:none">
        <strong>🎯 Filtros OneSignal que serão aplicados:</strong>
        <div id="push-filtros-tags"></div>
      </div>

      <hr class="push-sep">
      <button class="push-btn-enviar" id="push-btn-enviar" onclick="_pushConfirmar()" disabled>🔔 Enviar alerta</button>
      <div class="push-resultado" id="push-resultado"></div>
    </div>

    <div class="push-card" id="wa-card" style="display:none">
      <h3>🟢 Envio via WhatsApp</h3>
      <p style="font-size:12px;color:#64748b;margin:0 0 14px;line-height:1.6">Envio automático via Evolution API — pelo número oficial do Radar SIOPE, sem intervenção manual.</p>

      <div class="wa-modo-tabs">
        <button class="wa-modo-tab ativo" id="wa-tab-assinantes" onclick="_waSetModo('assinantes')">📋 Lista de assinantes</button>
        <button class="wa-modo-tab" id="wa-tab-comunidade" onclick="_waSetModo('comunidade')">👥 Comunidade</button>
      </div>

      <div class="wa-msg-area">
        <label>✏️ Mensagem</label>
        <textarea id="wa-mensagem" placeholder="Digite o texto a ser enviado via WhatsApp..." oninput="_waAtualizarBotao()"></textarea>
      </div>

      <div id="wa-modo-assinantes">
        <div class="wa-section-header">
          <span>📱 Assinantes autorizados</span>
          <button onclick="_waCarregarAssinantes()">⟳ Recarregar lista</button>
        </div>
        <div class="wa-toolbar">
          <input type="text" id="wa-busca" placeholder="🔍 Filtrar por nome ou município..." oninput="_waFiltrarLista()">
          <button onclick="_waToggleAll(true)">✅ Todos</button>
          <button onclick="_waToggleAll(false)">☐ Limpar</button>
        </div>
        <div class="wa-lista" id="wa-lista">
          <div class="wa-loading">⏳ Aguardando carregamento...</div>
        </div>
        <div class="wa-contador" id="wa-contador">—</div>
        <button class="wa-btn-iniciar" id="wa-btn-iniciar" onclick="_waIniciarEnvio()" disabled>🟢 Enviar para selecionados</button>
      </div>

      <div id="wa-modo-comunidade" style="display:none">
        <p style="font-size:12px;color:#64748b;margin:0 0 14px;line-height:1.6">
          Envia a mensagem acima diretamente para o grupo selecionado.
          Certifique-se de que o número do Radar SIOPE é administrador do grupo.
        </p>
        <button class="wa-grupo-btn edicoes" id="wa-btn-grupo-edicoes" onclick="_waEnviarComunidade('edicoes')">
          <span style="font-size:22px">📢</span>
          <div>
            <div>Grupo Nova Edição</div>
            <div class="wa-grupo-desc">Todos os assinantes — nova edição disponível</div>
          </div>
        </button>
        <button class="wa-grupo-btn alertas" id="wa-btn-grupo-alertas" onclick="_waEnviarComunidade('alertas')">
          <span style="font-size:22px">🔔</span>
          <div>
            <div>Grupo Alertas</div>
            <div class="wa-grupo-desc">Assinantes com feature de alertas prioritários</div>
          </div>
        </button>
      </div>

      <div id="wa-progresso" style="display:none;margin-top:12px">
        <div style="height:6px;background:#e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:6px">
          <div id="wa-prog-fill" style="height:100%;background:#16a34a;border-radius:10px;width:0%;transition:width .4s ease"></div>
        </div>
        <div id="wa-prog-txt" style="font-size:12px;color:#64748b;text-align:right"></div>
      </div>
      <div class="push-resultado" id="wa-resultado"></div>
    </div>

    <h3>📋 Histórico de alertas disparados</h3>
    <div class="push-card" id="push-historico-wrap">Carregando...</div>

    <div id="push-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:9999">
      <div class="push-card" style="max-width:420px;width:90%;background:#fff">
        <h3 style="margin-bottom:16px">⚠️ Confirmar envio</h3>
        <p id="push-modal-texto" style="font-size:14px;color:#334155;margin-bottom:20px"></p>
        <div style="display:flex;gap:10px">
          <button onclick="_pushCancelarModal()" style="flex:1;padding:10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer">Cancelar</button>
          <button onclick="_pushEnviar()" style="flex:1;padding:10px;border:none;border-radius:8px;background:#0A3D62;color:#fff;cursor:pointer;font-weight:600">Confirmar envio</button>
        </div>
      </div>
    </div>
  `;
}

// ─── Eventos e lógica ─────────────────────────────────────────────────────────
async function _bindEventos() {
  const statusEl = document.getElementById('push-auth-status');
  const cached = sessionStorage.getItem('_pushAdminToken');
  if (cached) {
    _pushAdminToken = cached;
    window._adminToken = cached;
    if (statusEl) {
      statusEl.style.background = '#f0fdf4';
      statusEl.style.color = '#166534';
      statusEl.style.border = '1px solid #bbf7d0';
      statusEl.textContent = '✅ Admin autenticado.';
    }
    return;
  }
  const usuarioLogado = JSON.parse(localStorage.getItem('usuarioLogado') || '{}');
  const email = usuarioLogado?.email;
  if (!email) {
    if (statusEl) {
      statusEl.style.background = '#fef2f2';
      statusEl.style.color = '#991b1b';
      statusEl.style.border = '1px solid #fecaca';
      statusEl.textContent = '❌ Sessão expirada. Faça login novamente.';
    }
    return;
  }
  try {
    const resp = await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'admin-token', email }),
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Resposta inválida da API'); }
    if (data.ok && data.token) {
      _pushAdminToken = data.token;
      sessionStorage.setItem('_pushAdminToken', data.token);
      window._adminToken = data.token;
      if (statusEl) {
        statusEl.style.background = '#f0fdf4';
        statusEl.style.color = '#166534';
        statusEl.style.border = '1px solid #bbf7d0';
        statusEl.textContent = `✅ Admin autenticado como ${email}.`;
      }
    } else throw new Error(data.error || 'Não autorizado');
  } catch (err) {
    if (statusEl) {
      statusEl.style.background = '#fef2f2';
      statusEl.style.color = '#991b1b';
      statusEl.style.border = '1px solid #fecaca';
      statusEl.textContent = `❌ Falha na autenticação: ${err.message}`;
    }
  }
}

window._pushOnTipoChange = async function () {
  const tipo = document.getElementById('push-tipo')?.value;
  const tpl = PUSH_TEMPLATES[tipo];
  const selectPublico = document.getElementById('push-publico');
  if (tpl) { selectPublico.value = tpl.publico; selectPublico.disabled = tpl.bloqueaPublico; }
  else selectPublico.disabled = false;
  _pushAtualizarFeatureWrap();
  const wrap = document.getElementById('push-params-wrap');
  if (!tpl || !tpl.parametros.length) { wrap.innerHTML = ''; _pushAtualizarPreview(); return; }
  const ehTipoMunicipio = TIPOS_MUNICIPIO.includes(tipo);
  const paramsMostrar = tpl.parametros.filter(p => !ehTipoMunicipio || p !== 'municipio_cod');
  if (paramsMostrar.length > 0) {
    wrap.innerHTML = `<hr class="push-sep"><h3 style="font-size:14px;font-weight:700;color:#0A3D62;margin:0 0 10px;text-transform:uppercase;letter-spacing:.4px">📝 Parâmetros</h3><div class="push-params">${paramsMostrar.map(p => `<div class="push-field"><label>${LABELS_PARAM[p] || p}</label><input type="text" id="push-param-${p}" oninput="_pushAtualizarPreview()"></div>`).join('')}</div>`;
  } else wrap.innerHTML = '';
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
  const tipo = document.getElementById('push-tipo')?.value;
  const publico = document.getElementById('push-publico')?.value;
  const wrap = document.getElementById('push-feature-wrap');
  if (wrap) wrap.style.display = publico === 'assinantes' ? 'block' : 'none';
  if (tipo && TIPOS_MUNICIPIO.includes(tipo)) await _pushCarregarMunicipios(publico);
  _pushAtualizarPreview();
};

document.addEventListener('change', e => {
  if (e.target?.id === 'push-publico') _pushAtualizarFeatureWrap();
});

async function _pushCarregarMunicipios(publico) {
  const mWrap = document.getElementById('push-municipios-wrap');
  if (!mWrap) return;
  mWrap.style.display = 'block';
  mWrap.innerHTML = `<hr class="push-sep"><div class="mun-wrap"><h4>📍 Municípios destinatários</h4><div class="mun-loading">⏳ Carregando municípios com push ativo...</div></div>`;
  const pubKey = publico || 'assinantes';
  if (_municipiosCache[pubKey]) { _renderMunicipios(_municipiosCache[pubKey], pubKey); return; }
  if (!_pushAdminToken) { document.querySelector('#push-municipios-wrap .mun-loading').textContent = '⚠️ Autentique-se primeiro.'; return; }
  try {
    const resp = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': _pushAdminToken }, body: JSON.stringify({ acao: 'buscar-municipios', publico: pubKey }) });
    const text = await resp.text(); let data; try { data = JSON.parse(text); } catch { throw new Error('Resposta inválida'); }
    if (!data.ok) throw new Error(data.error);
    _municipiosCache[pubKey] = data.municipios || [];
    _renderMunicipios(_municipiosCache[pubKey], pubKey);
  } catch (err) {
    const mWrap2 = document.getElementById('push-municipios-wrap');
    if (mWrap2) mWrap2.innerHTML = `<hr class="push-sep"><div class="mun-wrap"><h4>📍 Municípios destinatários</h4><div class="mun-vazio">❌ Erro ao carregar: ${err.message}</div></div>`;
  }
}

function _renderMunicipios(lista, pubKey) {
  const mWrap = document.getElementById('push-municipios-wrap');
  if (!mWrap) return;
  if (!lista.length) { mWrap.innerHTML = `<hr class="push-sep"><div class="mun-wrap"><h4>📍 Municípios destinatários</h4><div class="mun-vazio">⚠️ Nenhum município encontrado.</div></div>`; return; }
  const labelPublico = pubKey === 'leads' ? 'leads' : 'assinantes';
  mWrap.innerHTML = `<hr class="push-sep"><div class="mun-wrap"><h4>📍 Municípios — ${lista.length} ${labelPublico} com push ativo</h4><div class="mun-toolbar"><input type="text" id="mun-busca" placeholder="🔍 Filtrar município..." oninput="_pushFiltrarMunicipios()"><button onclick="_pushSelecionarTodosMunicipios(true)">✅ Selecionar todos</button><button onclick="_pushSelecionarTodosMunicipios(false)">☐ Limpar</button></div><div class="mun-lista" id="mun-lista">${lista.map(m => `<div class="mun-item" data-nome="${m.nome.toLowerCase()}"><input type="checkbox" value="${m.cod}" data-nome="${m.nome}" onchange="_pushAtualizarPreview()"><label>${m.nome} (${m.cod})</label></div>`).join('')}</div><div class="mun-contador" id="mun-contador">0 município(s) selecionado(s)</div></div>`;
  _pushAtualizarPreview();
}

window._pushFiltrarMunicipios = function () {
  const termo = document.getElementById('mun-busca')?.value?.toLowerCase() || '';
  document.querySelectorAll('#mun-lista .mun-item').forEach(item => {
    item.style.display = item.dataset.nome.includes(termo) ? 'flex' : 'none';
  });
};

window._pushSelecionarTodosMunicipios = function (selecionar) {
  document.querySelectorAll('#mun-lista input[type=checkbox]').forEach(cb => {
    const item = cb.closest('.mun-item');
    if (!item || item.style.display === 'none') return;
    cb.checked = selecionar;
  });
  _pushAtualizarPreview();
};

function _pushGetMunicipiosSelecionados() {
  return Array.from(document.querySelectorAll('#mun-lista input[type=checkbox]:checked')).map(cb => ({ cod: cb.value, nome: cb.dataset.nome }));
}

window._pushAtualizarPreview = function () {
  const tipo = document.getElementById('push-tipo')?.value;
  const tpl = PUSH_TEMPLATES[tipo];
  const params = _pushColetarParams();
  const titulo = tpl ? _sub(tpl.titulo, params) : 'Selecione um tipo de alerta';
  const corpo = tpl ? _sub(tpl.corpo, params) : '—';
  const urlCustom = document.getElementById('push-url-custom')?.value?.trim();
  const url = urlCustom || (tpl ? _sub(tpl.url, params) : '');
  document.getElementById('push-prev-titulo').textContent = titulo;
  document.getElementById('push-prev-corpo').textContent = corpo;
  document.getElementById('push-prev-url').textContent = url ? '🔗 ' + url : '';
  const munsSel = _pushGetMunicipiosSelecionados();
  const contEl = document.getElementById('mun-contador');
  if (contEl) {
    contEl.textContent = munsSel.length === 0 ? '⚠️ Selecione ao menos 1 município para enviar.' : `✅ ${munsSel.length} município(s) selecionado(s).`;
    contEl.style.color = munsSel.length === 0 ? '#f59e0b' : '#166534';
  }
  const filtrosInfo = document.getElementById('push-filtros-info');
  const filtrosTags = document.getElementById('push-filtros-tags');
  const filtros = tpl ? _montarFiltros(tpl, params) : [];
  if (filtros.length) {
    filtrosInfo.style.display = 'block';
    filtrosTags.innerHTML = filtros.map(f => `<span class="push-tag">${f.key || f.field} ${f.relation} "${f.value}"</span>`).join(' ');
  } else filtrosInfo.style.display = 'none';
  const btn = document.getElementById('push-btn-enviar');
  if (btn) btn.disabled = !tipo || !_pushAdminToken;
};

window._pushToggleUrl = function () {
  const el = document.getElementById('push-url-campo');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

window._pushConfirmar = function () {
  const tipo = document.getElementById('push-tipo')?.value;
  const tpl = PUSH_TEMPLATES[tipo];
  if (!tpl) return;
  const params = _pushColetarParams();
  const filtros = _montarFiltros(tpl, params);
  const titulo = _sub(tpl.titulo, params);
  const desc = filtros.map(f => `${f.key || f.field}="${f.value}"`).join(', ');
  document.getElementById('push-modal-texto').innerHTML = `Você está prestes a enviar:<br><br><strong>${titulo}</strong><br><br>Filtros: <em>${desc || 'nenhum (broadcast)'}</em><br><br>Esta ação não pode ser desfeita.`;
  document.getElementById('push-modal').style.display = 'flex';
};

window._pushCancelarModal = function () {
  document.getElementById('push-modal').style.display = 'none';
};

window._pushEnviar = async function () {
  document.getElementById('push-modal').style.display = 'none';
  const tipo = document.getElementById('push-tipo')?.value;
  const tpl = PUSH_TEMPLATES[tipo];
  const params = _pushColetarParams();
  const urlCustom = document.getElementById('push-url-custom')?.value?.trim();
  const resultado = document.getElementById('push-resultado');
  const btn = document.getElementById('push-btn-enviar');
  btn.disabled = true; btn.textContent = '⏳ Enviando...'; resultado.style.display = 'none';
  if (TIPOS_MUNICIPIO.includes(tipo)) {
    if (_pushGetMunicipiosSelecionados().length === 0) {
      resultado.style.display = 'block'; resultado.className = 'push-resultado erro';
      resultado.textContent = '❌ Selecione ao menos 1 município antes de enviar.';
      btn.disabled = false; btn.textContent = '🔔 Enviar alerta'; return;
    }
  }
  const body = { acao: 'alerta', tipo, parametros: { ...params } };
  if (urlCustom) body.parametros._url_override = urlCustom;
  const publico = document.getElementById('push-publico')?.value;
  const feature = document.getElementById('push-feature')?.value;
  if (publico !== 'todos') body.parametros._publico = publico;
  if (feature && feature !== 'todos') body.parametros._feature = feature;
  try {
    const resp = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': _pushAdminToken }, body: JSON.stringify(body) });
    const data = await resp.json();
    resultado.style.display = 'block';
    if (data.ok) {
      resultado.className = 'push-resultado ok';
      resultado.innerHTML = `✅ Alerta enviado com sucesso!<br><span style="font-weight:400">Destinatários estimados: <strong>${data.destinatarios ?? '—'}</strong> &nbsp;·&nbsp; ID OneSignal: <code>${data.onesignal_id ?? '—'}</code></span>`;
      _carregarHistorico();
    } else { resultado.className = 'push-resultado erro'; resultado.textContent = `❌ Erro: ${data.error || 'Falha desconhecida.'}`; }
  } catch (err) {
    resultado.style.display = 'block'; resultado.className = 'push-resultado erro'; resultado.textContent = `❌ Erro de rede: ${err.message}`;
  } finally { btn.disabled = false; btn.textContent = '🔔 Enviar alerta'; }
};

async function _carregarHistorico() {
  const wrap = document.getElementById('push-historico-wrap');
  if (!wrap) return;
  try {
    const snap = await window.db.collection('alertas_disparados').orderBy('disparado_em', 'desc').limit(20).get();
    if (snap.empty) { wrap.innerHTML = '<p style="color:#94a3b8;font-size:13px">Nenhum alerta disparado ainda.</p>'; return; }
    const rows = snap.docs.map(doc => {
      const d = doc.data();
      const em = d.disparado_em?.toDate?.()?.toLocaleString('pt-BR') ?? '—';
      const tip = PUSH_TEMPLATES[d.tipo]?.label ?? d.tipo;
      const canal = d.canal === 'whatsapp' ? 'whatsapp' : 'push';
      const cLabel = canal === 'whatsapp' ? '🟢 WhatsApp' : '🔔 Push';
      return `<tr><td>${em}</td><td><span class="push-badge ${canal}">${cLabel}</span></td><td>${tip}</td><td>${d.titulo || '—'}</td><td style="text-align:center"><strong>${d.destinatarios_est ?? '—'}</strong></td><td><span class="push-badge enviado">${d.status || 'enviado'}</span></td></tr>`;
    }).join('');
    wrap.innerHTML = `<table class="push-hist-table"><thead><tr><th>Data/hora</th><th>Canal</th><th>Tipo</th><th>Título</th><th>Dest.</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
  } catch (err) {
    wrap.innerHTML = `<p style="color:#ef4444;font-size:13px">Erro ao carregar histórico: ${err.message}</p>`;
  }
}

function _pushColetarParams() {
  const tipo = document.getElementById('push-tipo')?.value;
  const tpl = PUSH_TEMPLATES[tipo];
  if (!tpl) return {};
  const p = {};
  tpl.parametros.forEach(k => { const el = document.getElementById(`push-param-${k}`); if (el) p[k] = el.value.trim(); });
  if (TIPOS_MUNICIPIO.includes(tipo)) { const muns = _pushGetMunicipiosSelecionados(); if (muns.length > 0) p._municipios = muns; }
  return p;
}

function _montarFiltros(tpl, params) {
  const publico = document.getElementById('push-publico')?.value ?? 'todos';
  const feature = document.getElementById('push-feature')?.value ?? 'todos';
  const muns = params._municipios || null;
  const filtrosBase = (tpl.filtros || []).filter(f => (f.key || f.field) !== 'municipio_cod').map(f => ({ field: 'tag', key: f.key || f.field, relation: f.relation, value: _sub(f.value, params) }));
  const temSegmento = filtrosBase.some(f => f.key === 'segmento');
  if (!temSegmento && publico !== 'todos') filtrosBase.push({ field: 'tag', key: 'segmento', relation: '=', value: publico === 'assinantes' ? 'assinante' : 'lead' });
  if (publico === 'assinantes' && feature !== 'todos') {
    const val = feature === 'com' ? '1' : '0';
    const idx = filtrosBase.findIndex(f => f.key === 'alerta_municipio');
    if (idx !== -1) filtrosBase.splice(idx, 1);
    filtrosBase.push({ field: 'tag', key: 'alerta_municipio', relation: '=', value: val });
  }
  if (!muns || muns.length === 0) return filtrosBase;
  if (muns.length === 1) return [...filtrosBase, { field: 'tag', key: 'municipio_cod', relation: '=', value: String(muns[0].cod) }];
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
  return str.replace(/{(\w+)}/g, (match, k) => params[k] !== undefined && params[k] !== '' ? params[k] : match);
}

// ══════════════════════════════════════════════════════════════════════════════
// WHATSAPP — envio automático via Evolution API
// ══════════════════════════════════════════════════════════════════════════════
let _waState = { assinantes: [], mensagem: '' };

window._waSetModo = function (modo) {
  const isAssinantes = modo === 'assinantes';
  document.getElementById('wa-tab-assinantes')?.classList.toggle('ativo', isAssinantes);
  document.getElementById('wa-tab-comunidade')?.classList.toggle('ativo', !isAssinantes);
  document.getElementById('wa-modo-assinantes').style.display = isAssinantes ? 'block' : 'none';
  document.getElementById('wa-modo-comunidade').style.display = isAssinantes ? 'none' : 'block';
  const res = document.getElementById('wa-resultado');
  if (res) res.style.display = 'none';
  if (isAssinantes && _waState.assinantes.length === 0) _waCarregarAssinantes();
};

window._waEnviarComunidade = async function (grupo) {
  const mensagem = (document.getElementById('wa-mensagem')?.value || '').trim();
  if (!mensagem) { alert('Digite a mensagem antes de enviar para a comunidade.'); return; }
  const nomes = { edicoes: 'Grupo Nova Edição', alertas: 'Grupo Alertas' };
  if (!confirm(`Enviar para o ${nomes[grupo] || grupo}?\n\n${mensagem.slice(0, 120)}${mensagem.length > 120 ? '…' : ''}`)) return;
  const res = document.getElementById('wa-resultado');
  const prog = document.getElementById('wa-progresso');
  const fill = document.getElementById('wa-prog-fill');
  document.querySelectorAll('.wa-grupo-btn').forEach(b => b.disabled = true);
  if (res) res.style.display = 'none';
  if (prog) prog.style.display = 'block';
  if (fill) fill.style.width = '40%';
  try {
    const resp = await fetch('/api/alertas', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': _pushAdminToken }, body: JSON.stringify({ acao: 'enviar-whatsapp', comunidade: grupo, mensagem }) });
    if (fill) fill.style.width = '100%'; await new Promise(r => setTimeout(r, 300));
    const data = await resp.json().catch(() => ({}));
    if (res) {
      res.style.display = 'block';
      if (resp.ok && data.ok) { res.className = 'push-resultado ok'; res.textContent = `✅ Mensagem enviada para o ${nomes[grupo]}!`; _carregarHistorico(); }
      else { res.className = 'push-resultado erro'; res.textContent = `❌ Erro: ${data.error || `HTTP ${resp.status}`}`; }
    }
  } catch (err) {
    if (res) { res.style.display = 'block'; res.className = 'push-resultado erro'; res.textContent = `❌ Erro de conexão: ${err.message}`; }
  } finally {
    document.querySelectorAll('.wa-grupo-btn').forEach(b => b.disabled = false);
    setTimeout(() => { if (prog) prog.style.display = 'none'; if (fill) fill.style.width = '0%'; }, 2000);
  }
};

window._waToggleCanal = function (canal) {
  const isPush = canal === 'push';
  document.getElementById('tab-canal-push')?.classList.toggle('ativo', isPush);
  document.getElementById('tab-canal-whatsapp')?.classList.toggle('ativo', !isPush);
  const pushCard = document.getElementById('push-compose-card');
  const waCard = document.getElementById('wa-card');
  if (pushCard) pushCard.style.display = isPush ? 'block' : 'none';
  if (waCard) waCard.style.display = isPush ? 'none' : 'block';
  if (!isPush) {
    if (_waState.assinantes.length === 0) _waCarregarAssinantes();
    _waSincronizarMensagem();
  }
};

function _waSincronizarMensagem() {
  const el = document.getElementById('wa-mensagem');
  if (!el || el.value.trim()) return;
  const tipo = document.getElementById('push-tipo')?.value;
  const tpl = PUSH_TEMPLATES[tipo];
  if (!tpl) return;
  el.value = _sub(tpl.corpo, _pushColetarParams());
  _waAtualizarBotao();
}

window._waCarregarAssinantes = async function () {
  const lista = document.getElementById('wa-lista');
  const cont = document.getElementById('wa-contador');
  if (!lista) return;
  lista.innerHTML = '<div class="wa-loading">⏳ Carregando assinantes autorizados...</div>';
  if (cont) cont.textContent = '—';
  try {
    const [snap1, snap2] = await Promise.all([
      window.db.collection('usuarios').where('whatsappOptin', '==', true).get(),
      window.db.collection('usuarios').where('whatsapp_optin', '==', true).get()
    ]);
    const vistos = new Set();
    const todos = [...snap1.docs, ...snap2.docs]
      .filter(d => { if (vistos.has(d.id)) return false; vistos.add(d.id); return true; })
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => { const num = u.whatsapp || u.whatsapp_number; return num && String(num).replace(/\D/g, '').length >= 10; })
      .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
    _waState.assinantes = todos;
    _waRenderLista(todos);
  } catch (err) {
    lista.innerHTML = `<div class="wa-vazio">❌ Erro ao carregar: ${err.message}</div>`;
  }
};

function _waRenderLista(lista) {
  const el = document.getElementById('wa-lista');
  if (!el) return;
  if (!lista.length) { el.innerHTML = '<div class="wa-vazio">⚠️ Nenhum assinante com WhatsApp autorizado encontrado.</div>'; _waAtualizarBotao(); return; }
  el.innerHTML = lista.map(u => {
    const mun = [u.nome_municipio, u.cod_uf].filter(Boolean).join(' — ');
    const numRaw = String(u.whatsapp || u.whatsapp_number || '').replace(/\D/g, '');
    const num = numRaw.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') || numRaw;
    return `<div class="wa-item" data-busca="${(u.nome || '').toLowerCase()} ${(u.nome_municipio || '').toLowerCase()}" onclick="this.querySelector('input').click()"><input type="checkbox" value="${u.id}" data-nome="${(u.nome || '').replace(/"/g, '&quot;')}" data-numero="${numRaw}" data-mun="${mun.replace(/"/g, '&quot;')}" onchange="_waAtualizarBotao()" onclick="event.stopPropagation()"><div style="flex:1;min-width:0"><div class="wa-nome">${u.nome || '(sem nome)'}</div><div class="wa-sub">${mun || '—'}</div></div><div class="wa-fone">${num}</div></div>`;
  }).join('');
  _waAtualizarBotao();
}

window._waFiltrarLista = function () {
  const termo = (document.getElementById('wa-busca')?.value || '').toLowerCase().trim();
  document.querySelectorAll('#wa-lista .wa-item').forEach(item => {
    item.style.display = !termo || item.dataset.busca.includes(termo) ? 'flex' : 'none';
  });
};

window._waToggleAll = function (sel) {
  document.querySelectorAll('#wa-lista .wa-item').forEach(item => {
    if (item.style.display === 'none') return;
    const cb = item.querySelector('input[type=checkbox]');
    if (cb) cb.checked = sel;
  });
  _waAtualizarBotao();
};

window._waAtualizarBotao = function () {
  const selecionados = document.querySelectorAll('#wa-lista input[type=checkbox]:checked').length;
  const mensagem = (document.getElementById('wa-mensagem')?.value || '').trim();
  const btn = document.getElementById('wa-btn-iniciar');
  const cont = document.getElementById('wa-contador');
  if (cont) {
    if (selecionados === 0) { cont.textContent = '⚠️ Selecione ao menos 1 assinante.'; cont.style.color = '#f59e0b'; }
    else { cont.textContent = `✅ ${selecionados} assinante(s) selecionado(s).`; cont.style.color = '#166534'; }
  }
  if (btn) btn.disabled = !selecionados || !mensagem;
};

window._waIniciarEnvio = async function () {
  const mensagem = (document.getElementById('wa-mensagem')?.value || '').trim();
  if (!mensagem) return;
  const cbs = document.querySelectorAll('#wa-lista input[type=checkbox]:checked');
  if (!cbs.length) return;
  const uids = Array.from(cbs).map(cb => cb.value);
  const btn = document.getElementById('wa-btn-iniciar');
  const res = document.getElementById('wa-resultado');
  const prog = document.getElementById('wa-progresso');
  const fill = document.getElementById('wa-prog-fill');
  const txt = document.getElementById('wa-prog-txt');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando...'; }
  if (res) res.style.display = 'none';
  if (prog) prog.style.display = 'block';
  if (fill) fill.style.width = '10%';
  if (txt) txt.textContent = `0 de ${uids.length} enviados...`;
  let _progInterval = setInterval(() => { const atual = parseFloat(fill?.style.width || '10'); if (atual < 85 && fill) fill.style.width = (atual + 5) + '%'; }, 800);
  try {
    const resp = await fetch('/api/alertas', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': _pushAdminToken }, body: JSON.stringify({ acao: 'enviar-whatsapp', uids, mensagem }) });
    clearInterval(_progInterval);
    const data = await resp.json().catch(() => ({}));
    if (fill) fill.style.width = '100%'; await new Promise(r => setTimeout(r, 400));
    if (resp.ok && data.ok) {
      const { enviados = 0, erros = 0, total = uids.length } = data;
      if (res) {
        res.style.display = 'block';
        res.className = erros > 0 ? 'push-resultado' : 'push-resultado ok';
        res.style.background = erros > 0 ? '#fef9c3' : '#dcfce7';
        res.style.color = erros > 0 ? '#92400e' : '#166534';
        res.style.border = erros > 0 ? '1px solid #fde68a' : '1px solid #bbf7d0';
        res.innerHTML = erros > 0 ? `⚠️ Envio parcial: <strong>${enviados} de ${total}</strong> enviados. ${erros} com erro.` : `✅ <strong>${enviados} mensagen${enviados !== 1 ? 's' : ''}</strong> enviada${enviados !== 1 ? 's' : ''} com sucesso!`;
      }
      if (txt) txt.textContent = `${enviados} de ${total} enviados.`;
      _carregarHistorico();
    } else throw new Error(data.error || `HTTP ${resp.status}`);
  } catch (err) {
    clearInterval(_progInterval);
    if (fill) fill.style.width = '0%';
    if (res) { res.style.display = 'block'; res.className = 'push-resultado erro'; res.textContent = `❌ Erro no envio: ${err.message}`; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🟢 Enviar via WhatsApp'; }
    setTimeout(() => { if (prog) prog.style.display = 'none'; }, 2000);
  }
};