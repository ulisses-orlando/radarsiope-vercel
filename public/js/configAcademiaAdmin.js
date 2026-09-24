/* ==========================================================================
   configAcademiaAdmin.js — Painel Admin: CRUD de config/selos E config/fidelidade
   (v3 — vira uma <section> fixa no padrão abrirTab(), não mais um drawer/overlay)

   Segue o mesmo padrão de main.js/drawer-usuario.js:
   - Funções globais (não módulo ES), penduradas em window.*
   - Usa o `db` (Firestore compat) já inicializado em outro script do admin
   - Renderiza dentro de uma <section id="academia-config"> já existente no
     HTML do admin — chamado por abrirTab('academia-config'), igual a
     qualquer outra aba (Planos, Newsletters etc.)
   - Classes CSS reaproveitadas: drawer-secao, drawer-secao-titulo, btn-drawer-sm

   PRÉ-REQUISITO — adicionar ao HTML do admin (uma vez só):

   <section id="academia-config" class="card">
     <h3 style="margin:0">⚙️ Configuração da Academia</h3>
     <div id="academia-config-sub" style="font-size:12px;color:#888;margin-bottom:10px"></div>
     <div id="academia-config-body"></div>
   </section>

   E em abrirTab(tabId), adicionar:
     else if (tabId === 'academia-config') abrirPainelConfigAcademia();

   Regra de negócio embutida aqui (Seção 10.2.1 da spec): NENHUM parâmetro
   pode ser salvo (novo ou alterado), em NENHUM dos dois documentos, sem a
   descrição correspondente preenchida no _metadados respectivo. Validado
   no cliente antes do write.

   Caminhos internos deste arquivo são sempre no formato:
     "<documento>::<caminho.dentro.do.documento>"
   Ex.: "selos::manutencao.alertas.dias_para_expirado_cancelamento"
        "fidelidade::regras.recuperacao_perde_um_ano"
   O "<documento>" vira o nome real do doc em Firestore (config/<documento>
   e config/<documento>_metadados).
   ========================================================================== */

// ─── Documentos cobertos por este painel ─────────────────────────────────────
const DOCUMENTOS_CONFIG_ACADEMIA = [
  { doc: 'selos',       titulo: '📘 config/selos (Selos, Níveis, Coringas, Ranking...)' },
  { doc: 'fidelidade',  titulo: '🏅 config/fidelidade (Clube de Excelência)' },
];

// ─── Estado do painel ─────────────────────────────────────────────────────────
let _cfgValores = {};    // { selos: {...}, fidelidade: {...} }
let _cfgMetadados = {};  // { selos: {...}, fidelidade: {...} }

// ─── Abrir (chamado por abrirTab('academia-config'), sem overlay/drawer) ─────
async function abrirPainelConfigAcademia() {
  const body = document.getElementById('academia-config-body');
  if (!body) {
    console.error('[configAcademiaAdmin] #academia-config-body não encontrado — ver comentário no topo do arquivo.');
    return;
  }
  body.innerHTML = '<div class="drawer-loading">⏳ Carregando configuração...</div>';

  try {
    const leituras = await Promise.all(
      DOCUMENTOS_CONFIG_ACADEMIA.flatMap(({ doc }) => [
        db.collection('config').doc(doc).get(),
        db.collection('config').doc(`${doc}_metadados`).get(),
      ])
    );
    DOCUMENTOS_CONFIG_ACADEMIA.forEach(({ doc }, i) => {
      const valoresSnap   = leituras[i * 2];
      const metadadosSnap = leituras[i * 2 + 1];
      _cfgValores[doc]   = valoresSnap.exists ? valoresSnap.data() : {};
      _cfgMetadados[doc] = metadadosSnap.exists ? metadadosSnap.data() : {};
    });
  } catch (e) {
    body.innerHTML = `<div class="drawer-alerta vermelho">Erro ao carregar config: ${e.message}</div>`;
    return;
  }

  const sub = document.getElementById('academia-config-sub');
  if (sub) sub.textContent = `versão ${_cfgValores.selos?.versao || '?'}`;

  _renderPainelConfigAcademia();
}

// ─── Render principal: um bloco por documento, uma drawer-secao por chave de topo ──
function _renderPainelConfigAcademia() {
  const body = document.getElementById('academia-config-body');

  body.innerHTML = DOCUMENTOS_CONFIG_ACADEMIA.map(({ doc, titulo }) => {
    const valores = _cfgValores[doc] || {};
    const metadados = _cfgMetadados[doc] || {};
    const secoesIgnoradas = ['versao', 'atualizado_em', 'atualizado_por', 'historico_alteracoes'];
    const chavesTopo = Object.keys(valores).filter(k => !secoesIgnoradas.includes(k));

    return `
      <div class="cfg-bloco-documento" style="margin-bottom:16px">
        <h3 style="font-size:14px;margin:12px 0 6px">${titulo}</h3>
        ${chavesTopo.map(chaveTopo => `
          <div class="drawer-secao">
            <div class="drawer-secao-titulo">${_tituloAmigavel(chaveTopo)}</div>
            <div id="cfg-secao-${doc}__${chaveTopo}">
              ${_renderNo(valores[chaveTopo], metadados?.[chaveTopo] || {}, `${doc}::${chaveTopo}`)}
            </div>
            <button class="btn-drawer-sm" onclick="_abrirFormNovoParametro('${doc}::${chaveTopo}')">➕ Novo parâmetro em "${chaveTopo}"</button>
          </div>
        `).join('')}
      </div>
    `;
  }).join('<hr style="border-color:rgba(255,255,255,0.08);margin:16px 0">');
}

// ─── Render recursivo de um nó (objeto aninhado ou valor-folha) ──────────────
// `caminho` sempre no formato "<documento>::a.b.c"
function _renderNo(valor, metadadosNo, caminho) {
  const ehObjetoPlano = valor !== null && typeof valor === 'object' && !Array.isArray(valor);

  if (ehObjetoPlano) {
    return Object.keys(valor).map(chave => {
      const subCaminho = `${caminho}.${chave}`;
      const subMetadados = (metadadosNo && typeof metadadosNo === 'object') ? metadadosNo[chave] : undefined;
      const ehFolhaAninhada = valor[chave] === null || typeof valor[chave] !== 'object' || Array.isArray(valor[chave]);

      if (ehFolhaAninhada) {
        return _renderLinhaParametro(subCaminho, chave, valor[chave], typeof subMetadados === 'string' ? subMetadados : '');
      }
      return `
        <div style="margin:8px 0 8px 12px;padding-left:8px;border-left:2px solid rgba(255,255,255,0.08)">
          <div style="font-size:12px;color:var(--rs-muted,#94a3b8);margin-bottom:4px">${_tituloAmigavel(chave)}</div>
          ${_renderNo(valor[chave], subMetadados || {}, subCaminho)}
        </div>
      `;
    }).join('');
  }

  return _renderLinhaParametro(caminho, caminho.split('::').pop(), valor, typeof metadadosNo === 'string' ? metadadosNo : '');
}

// ─── Uma linha editável: label + input de valor + textarea de descrição + salvar ──
function _renderLinhaParametro(caminho, label, valorAtual, descricaoAtual) {
  const idSeguro = caminho.replace(/[.:]/g, '__');
  const tipo = _inferirTipo(valorAtual);
  const inputValorHtml = _renderInputPorTipo(tipo, `val-${idSeguro}`, valorAtual);
  const [nomeDoc, caminhoInterno] = caminho.split('::');

  return `
    <div class="cfg-linha-parametro" style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
      <div style="font-size:12px;color:var(--rs-text,#f1f5f9);font-weight:500">${label}</div>
      <div style="font-size:11px;color:var(--rs-muted,#94a3b8);margin-bottom:6px">config/${nomeDoc} → ${caminhoInterno}</div>
      <div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap">
        ${inputValorHtml}
        <textarea id="desc-${idSeguro}" placeholder="Descrição obrigatória: o que este parâmetro faz, onde afeta..."
          style="flex:1;min-width:200px;min-height:40px;font-size:12px;padding:6px;border-radius:6px;
                 background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);color:inherit"
        >${_escapeHtml(descricaoAtual)}</textarea>
        <button class="btn-drawer-sm" onclick="_salvarParametroConfigAcademia('${caminho}','${tipo}','val-${idSeguro}','desc-${idSeguro}',this)">
          💾 Salvar
        </button>
      </div>
    </div>
  `;
}

function _inferirTipo(valor) {
  if (typeof valor === 'boolean') return 'boolean';
  if (typeof valor === 'number') return 'number';
  if (Array.isArray(valor)) return 'array';
  return 'string';
}

function _renderInputPorTipo(tipo, id, valorAtual) {
  if (tipo === 'boolean') {
    return `<label style="display:flex;align-items:center;gap:6px;font-size:12px">
      <input type="checkbox" id="${id}" ${valorAtual ? 'checked' : ''}/> ativo
    </label>`;
  }
  if (tipo === 'number') {
    return `<input type="number" id="${id}" value="${valorAtual}" step="any" style="width:100px;padding:6px;border-radius:6px;
              background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);color:inherit"/>`;
  }
  if (tipo === 'array') {
    return `<input type="text" id="${id}" value='${_escapeHtml(JSON.stringify(valorAtual))}'
              placeholder="[valor1, valor2]" style="width:180px;padding:6px;border-radius:6px;
              background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);color:inherit"/>`;
  }
  return `<input type="text" id="${id}" value="${_escapeHtml(String(valorAtual))}" style="width:160px;padding:6px;
            border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);color:inherit"/>`;
}

// ─── Salvar um parâmetro (existente) — bloqueia sem descrição ────────────────
// `caminho` no formato "<documento>::a.b.c"
async function _salvarParametroConfigAcademia(caminho, tipo, inputId, descId, btnEl) {
  const [nomeDoc, caminhoInterno] = caminho.split('::');
  const inputEl = document.getElementById(inputId);
  const descEl  = document.getElementById(descId);
  const descricao = (descEl.value || '').trim();

  if (!descricao) {
    alert('⚠️ Não é possível salvar sem preencher a descrição do parâmetro (Seção 10.2.1 da spec).');
    descEl.focus();
    return;
  }

  let novoValor;
  try {
    novoValor = _lerValorPorTipo(tipo, inputEl);
  } catch (e) {
    alert(`⚠️ Valor inválido: ${e.message}`);
    return;
  }

  btnEl.disabled = true;
  btnEl.textContent = '⏳ Salvando...';
  try {
    await Promise.all([
      db.collection('config').doc(nomeDoc).update({ [caminhoInterno]: novoValor }),
      db.collection('config').doc(`${nomeDoc}_metadados`).update({ [caminhoInterno]: descricao }),
    ]);
    btnEl.textContent = '✅ Salvo';
    setTimeout(() => { btnEl.disabled = false; btnEl.textContent = '💾 Salvar'; }, 1500);
  } catch (e) {
    alert(`Erro ao salvar: ${e.message}`);
    btnEl.disabled = false;
    btnEl.textContent = '💾 Salvar';
  }
}

function _lerValorPorTipo(tipo, inputEl) {
  if (tipo === 'boolean') return !!inputEl.checked;
  if (tipo === 'number') {
    const n = Number(inputEl.value);
    if (Number.isNaN(n)) throw new Error('não é um número válido');
    return n;
  }
  if (tipo === 'array') {
    const parsed = JSON.parse(inputEl.value);
    if (!Array.isArray(parsed)) throw new Error('precisa ser um array JSON válido, ex: [1,2,3]');
    return parsed;
  }
  return inputEl.value;
}

// ─── Criar um novo parâmetro dentro de uma seção existente ───────────────────
// `caminhoPai` no formato "<documento>::a.b"
function _abrirFormNovoParametro(caminhoPai) {
  const idContainer = caminhoPai.replace('::', '__');
  const container = document.getElementById(`cfg-secao-${idContainer}`);
  if (!container || container.querySelector('.cfg-form-novo')) return;

  const formHtml = `
    <div class="cfg-form-novo" style="margin-top:10px;padding:10px;border:1px dashed rgba(255,255,255,0.2);border-radius:8px">
      <div style="font-size:12px;margin-bottom:6px">Novo parâmetro em <strong>${caminhoPai.split('::').join(' → ')}</strong></div>
      <input type="text" id="novo-chave-${idContainer}" placeholder="nome_do_parametro" style="width:100%;margin-bottom:6px;padding:6px;
        border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);color:inherit"/>
      <select id="novo-tipo-${idContainer}" style="width:100%;margin-bottom:6px;padding:6px;border-radius:6px;
        background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);color:inherit">
        <option value="number">Número</option>
        <option value="string">Texto</option>
        <option value="boolean">Sim/Não</option>
        <option value="array">Lista (JSON)</option>
      </select>
      <input type="text" id="novo-valor-${idContainer}" placeholder="valor inicial" style="width:100%;margin-bottom:6px;padding:6px;
        border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);color:inherit"/>
      <textarea id="novo-desc-${idContainer}" placeholder="Descrição obrigatória" style="width:100%;min-height:40px;margin-bottom:6px;
        padding:6px;border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);color:inherit"></textarea>
      <div style="display:flex;gap:8px">
        <button class="btn-drawer-sm btn-verde" onclick="_criarParametroConfigAcademia('${caminhoPai}')">✅ Criar</button>
        <button class="btn-drawer-sm" onclick="this.closest('.cfg-form-novo').remove()">Cancelar</button>
      </div>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', formHtml);
}

async function _criarParametroConfigAcademia(caminhoPai) {
  const [nomeDoc, caminhoInternoPai] = caminhoPai.split('::');
  const idContainer = caminhoPai.replace('::', '__');

  const chave = (document.getElementById(`novo-chave-${idContainer}`).value || '').trim();
  const tipo  = document.getElementById(`novo-tipo-${idContainer}`).value;
  const valorBruto = document.getElementById(`novo-valor-${idContainer}`).value;
  const descricao  = (document.getElementById(`novo-desc-${idContainer}`).value || '').trim();

  if (!chave || !/^[a-zA-Z0-9_]+$/.test(chave)) {
    alert('⚠️ Nome do parâmetro inválido (use apenas letras, números e underscore).');
    return;
  }
  if (!descricao) {
    alert('⚠️ Não é possível criar um parâmetro sem descrição (Seção 10.2.1 da spec).');
    return;
  }

  let valor;
  try {
    if (tipo === 'boolean') valor = valorBruto === 'true' || valorBruto === '1';
    else if (tipo === 'number') { valor = Number(valorBruto); if (Number.isNaN(valor)) throw new Error('número inválido'); }
    else if (tipo === 'array') { valor = JSON.parse(valorBruto); if (!Array.isArray(valor)) throw new Error('precisa ser um array JSON'); }
    else valor = valorBruto;
  } catch (e) {
    alert(`⚠️ Valor inválido: ${e.message}`);
    return;
  }

  const caminhoInternoCompleto = `${caminhoInternoPai}.${chave}`;
  try {
    await Promise.all([
      db.collection('config').doc(nomeDoc).update({ [caminhoInternoCompleto]: valor }),
      db.collection('config').doc(`${nomeDoc}_metadados`).update({ [caminhoInternoCompleto]: descricao }),
    ]);
    await abrirPainelConfigAcademia(); // recarrega o painel inteiro (mais simples/seguro que remontar só o pedaço)
  } catch (e) {
    alert(`Erro ao criar parâmetro: ${e.message}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _tituloAmigavel(chave) {
  return chave.charAt(0).toUpperCase() + chave.slice(1).replace(/_/g, ' ');
}

function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Script de Carga Inicial (botão do menu, chama a API — Seção 21.10/10) ───
// firebase-admin só roda no servidor, então este botão apenas dispara o
// endpoint /api/academiaSetup (academiaSetup.js), que faz o bootstrap real.
async function executarScriptCargaInicialAcademia(btnEl) {
  if (!confirm('Isso grava os valores e descrições padrão da Academia em config/selos e ' +
               'config/fidelidade (e seus _metadados). Valores já existentes NÃO são sobrescritos, ' +
               'só o que estiver faltando é preenchido. Continuar?')) return;

  const textoOriginal = btnEl.textContent;
  btnEl.disabled = true;
  btnEl.textContent = '⏳ Executando...';

  try {
    const resp = await fetch('/api/academia?acao=setup-inicial', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': window._adminToken || '', // mesmo token usado nas outras chamadas admin do projeto
      },
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);

    alert(`✅ Carga inicial concluída!\n` +
          `config/selos: ${data.parametros_selos} parâmetros verificados/gravados\n` +
          `config/fidelidade: ${data.parametros_fidelidade} parâmetros verificados/gravados`);

    // Se o painel de configuração já estiver aberto, recarrega pra refletir
    if (document.getElementById('academia-config-body')) await abrirPainelConfigAcademia();
  } catch (e) {
    alert('❌ Erro ao executar carga inicial: ' + e.message);
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = textoOriginal;
  }
}

// ─── Exportação global (mesmo padrão de drawer-usuario.js) ───────────────────
window.executarScriptCargaInicialAcademia = executarScriptCargaInicialAcademia;
window.abrirPainelConfigAcademia = abrirPainelConfigAcademia;
window._salvarParametroConfigAcademia = _salvarParametroConfigAcademia;
window._abrirFormNovoParametro = _abrirFormNovoParametro;
window._criarParametroConfigAcademia = _criarParametroConfigAcademia;
