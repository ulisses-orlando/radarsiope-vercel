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

// ══════════════════════════════════════════════════════════════════════════
// SCRIPT DE CARGA INICIAL — 100% no navegador (v1.7.2)
// Antes chamava uma API de backend (/api/academiaSetup), mas isso exigia
// firebase-admin com credenciais próprias — problemático no Vercel (erro de
// "ID de projeto não detectado"). Como este arquivo já fala direto com o
// Firestore pelo SDK do cliente para tudo mais, o bootstrap faz o mesmo:
// roda com as MESMAS credenciais/sessão que o admin já usa para editar
// qualquer parâmetro individual. Não depende de token nem de function.
// ══════════════════════════════════════════════════════════════════════════

// Fonte única de verdade dos parâmetros padrão da Academia — valor + descrição.
// Estrutura espelha exatamente config/selos e config/fidelidade.
const _PARAMETROS_SELOS_PADRAO = {
  selos: {
    academia_habilitada: { valor: false, descricao: 'Feature flag geral da Academia. Enquanto false, nenhuma funcionalidade da Academia fica visível no app (rollout gradual/beta fechado antes do lançamento público).' }
  },
  niveis: {
    iniciante: {
      nome:               { valor: 'Participante Ativo', descricao: 'Nome de exibição do 1º nível (🥉) no app, dashboard e certificado.' },
      quizzes_aprovados:  { valor: 12, descricao: 'Quantidade de quizzes NORMAIS aprovados (≥ percentual_minimo) necessária para conquistar este nível.' },
      percentual_minimo:  { valor: 70, descricao: 'Nota mínima (%) em um quiz para ele contar como aprovado, específico deste nível.' },
      cor:                { valor: '#CD7F32', descricao: 'Cor (hex) usada no selo, badge e certificado para este nível.' },
      icone:              { valor: '🥉', descricao: 'Emoji/ícone usado para representar este nível na UI.' },
      ordem:              { valor: 1, descricao: 'Posição deste nível na hierarquia (1 = mais baixo).' }
    },
    dedicado: {
      nome:                  { valor: 'Estudante Dedicado', descricao: 'Nome de exibição do 2º nível (🥈).' },
      quizzes_aprovados:     { valor: 24, descricao: 'Total acumulado de quizzes normais aprovados necessário para este nível.' },
      percentual_minimo:     { valor: 70, descricao: 'Nota mínima (%) em um quiz para ele contar como aprovado, específico deste nível.' },
      cor:                   { valor: '#C0C0C0', descricao: 'Cor (hex) usada no selo, badge e certificado para este nível.' },
      icone:                 { valor: '🥈', descricao: 'Emoji/ícone usado para representar este nível na UI.' },
      ordem:                 { valor: 2, descricao: 'Posição deste nível na hierarquia.' },
      desbloqueia_especiais: { valor: true, descricao: 'Ao atingir este nível, o painel de Quizzes Especiais fica visível pela primeira vez (mostrando os de nivel_alvo="especialista").' }
    },
    especialista: {
      nome:               { valor: 'Especialista SIOPE', descricao: 'Nome de exibição do 3º nível (🥇).' },
      quizzes_aprovados:  { valor: 36, descricao: 'Total acumulado de quizzes NORMAIS aprovados necessário para este nível (trilha independente da de especiais).' },
      percentual_minimo:  { valor: 70, descricao: 'Nota mínima (%) em um quiz para ele contar como aprovado, específico deste nível.' },
      cor:                { valor: '#FFD700', descricao: 'Cor (hex) usada no selo, badge e certificado para este nível.' },
      icone:              { valor: '🥇', descricao: 'Emoji/ícone usado para representar este nível na UI.' },
      ordem:              { valor: 3, descricao: 'Posição deste nível na hierarquia. Requisito de especiais = 100% dos quizzes_especiais ativos com nivel_alvo="especialista" (contagem ao vivo — v1.7).' }
    },
    mestre: {
      nome:               { valor: 'Mestre do FUNDEB', descricao: 'Nome de exibição do 4º e último nível (💎).' },
      quizzes_aprovados:  { valor: 48, descricao: 'Total acumulado de quizzes NORMAIS aprovados necessário para este nível — corresponde a ~48 edições de um ano de contrato.' },
      percentual_minimo:  { valor: 70, descricao: 'Nota mínima (%) em um quiz para ele contar como aprovado, específico deste nível.' },
      cor:                { valor: '#B9F2FF', descricao: 'Cor (hex) usada no selo, badge e certificado para este nível.' },
      icone:              { valor: '💎', descricao: 'Emoji/ícone usado para representar este nível na UI.' },
      ordem:              { valor: 4, descricao: 'Posição deste nível na hierarquia (o mais alto). Requisito de especiais = 100% dos quizzes_especiais ativos com nivel_alvo="mestre" (contagem ao vivo — v1.7).' }
    }
  },
  manutencao: {
    ciclo_dias:                            { valor: 60, descricao: 'Duração (em dias) do ciclo de manutenção do selo.' },
    quizzes_minimos_por_ciclo:             { valor: 4, descricao: 'Quantidade mínima de quizzes respondidos dentro de um ciclo para ele ser considerado regularizado.' },
    percentual_minimo:                     { valor: 70, descricao: 'Aproveitamento médio mínimo (%) no ciclo de manutenção para considerá-lo regularizado.' },
    permite_uso_com_zero_quizzes_no_ciclo: { valor: true, descricao: 'Se true, o Coringa de Manutenção pode ser usado mesmo com 0 quizzes respondidos no ciclo.' },
    quiz_especial_conta_como:              { valor: 2, descricao: 'Peso de 1 Quiz Especial aprovado na contagem de FREQUÊNCIA do ciclo de manutenção.' },
    alertas: {
      dias_para_alerta_risco:          { valor: 15, descricao: 'Dias antes do fim do ciclo em que o estado vira em_alerta.' },
      dias_para_notificacao_final:     { valor: 30, descricao: 'Dias após o fim do ciclo sem regularizar para o estado virar em_risco.' },
      dias_para_congelamento:          { valor: 60, descricao: 'Dias sem regularizar para o estado virar congelado.' },
      dias_para_rebaixamento:          { valor: 90, descricao: 'Dias sem regularizar (inatividade orgânica) para o estado virar rebaixado.' },
      dias_para_expirado:              { valor: 180, descricao: 'Dias sem regularizar (inatividade orgânica) para o selo virar expirado — perde tudo.' },
      dias_para_expirado_cancelamento: { valor: 90, descricao: 'Prazo em dias, a partir do CANCELAMENTO da assinatura, para o selo virar expirado. O rebaixamento por cancelamento já é imediato (Seção 4.6) — este prazo é até a perda total.' }
    }
  },
  notificacoes: {
    raio_alerta_mudanca_config: { valor: 1, descricao: 'Distância (em quizzes) do valor ANTIGO de um requisito de nível para o assinante ser avisado quando ele muda — seja por config alterada ou por ativar/desativar um Quiz Especial.' }
  },
  renovacao: {
    ativo:                     { valor: true, descricao: 'Liga/desliga a renovação automática por aniversário de contrato.' },
    modelo:                    { valor: 'aniversario_contrato', descricao: 'Modelo de renovação: por aniversário de contrato de cada assinante, não data fixa de calendário.' },
    quizzes_minimos_renovacao: { valor: 3, descricao: 'Quizzes que quem manteve o selo ativo o ciclo inteiro precisa responder para renovar o nível ("Renovação Simplificada").' },
    bonus_fidelidade: {
      ativo:                   { valor: true, descricao: 'Liga/desliga o bônus de fidelidade na renovação.' },
      coringa_extra:           { valor: 1, descricao: 'Coringas de Manutenção extra concedidos a quem se qualificou ao bônus.' },
      nivel_minimo_para_bonus: { valor: 'iniciante', descricao: 'Nível mínimo elegível ao bônus de fidelidade.' }
    }
  },
  coringa: {
    manutencao: {
      ativo:                     { valor: true, descricao: 'Liga/desliga o Coringa de Manutenção.' },
      quantidade_padrao:         { valor: 1, descricao: 'Coringas de Manutenção por ano de contrato, sem bônus.' },
      quantidade_com_bonus:      { valor: 2, descricao: 'Coringas de Manutenção no ciclo com bônus de fidelidade.' },
      regra_uso:                 { valor: 'ciclo_em_alerta_ou_risco_e_(aproveitamento_atual_maior_igual_70_ou_zero_quizzes_no_ciclo)', descricao: 'Condição de elegibilidade textual (Seção 6.2). Não se aplica durante cancelamento (Seção 4.6).' },
      max_usos_por_ciclo:        { valor: 1, descricao: 'Máximo de usos dentro de um ciclo de 60 dias.' },
      max_usos_por_ano_contrato: { valor: 1, descricao: 'Máximo de usos dentro de um ano de contrato inteiro.' }
    },
    progressao: {
      ativo:                            { valor: true, descricao: 'Liga/desliga o Coringa de Prorrogação.' },
      quantidade_padrao:                { valor: 3, descricao: 'Coringas de Prorrogação por ano de contrato.' },
      prazo_prorrogacao_dias:           { valor: 30, descricao: 'Dias para responder a newsletter prorrogada e ainda contar para o ciclo original.' },
      janela_maxima_dias_pos_ciclo:     { valor: 90, descricao: 'Prazo máximo pós-fim-de-ciclo para ativar uma prorrogação.' },
      bloqueia_prorrogacao_se_temporal: { valor: true, descricao: 'Se true, newsletters com conteudo_temporal=true nunca podem ser prorrogadas.' },
      max_prorrogacoes_acumuladas:      { valor: 6, descricao: 'Teto de prorrogações em aberto simultaneamente.' }
    }
  },
  quizzes_especiais: {
    ativo:                { valor: true, descricao: 'Liga/desliga os Quizzes Especiais como um todo.' },
    nivel_desbloqueio:    { valor: 'dedicado', descricao: 'Nível a partir do qual o painel de especiais fica visível.' },
    dificuldade_minima:   { valor: 8, descricao: 'Dificuldade mínima (1-10) para um quiz ser cadastrado como Especial — orientação editorial, não trava automática.' },
    valor_na_frequencia:  { valor: 2, descricao: 'Peso de um especial na frequência do ciclo de manutenção (espelha manutencao.quiz_especial_conta_como).' },
    valor_na_performance: { valor: 1, descricao: 'Peso de um especial na média geral de aproveitamento.' }
  },
  ranking: {
    ativo:                              { valor: true, descricao: 'Liga/desliga a página de Ranking.' },
    visibilidade_padrao:                { valor: 'anonimo', descricao: 'Modo padrão de exibição de nomes até opt-in do assinante.' },
    niveis_exibidos:                    { valor: ['especialista', 'mestre'], descricao: 'Níveis exibidos no ranking público.' },
    atualizacao_frequencia:             { valor: 'diaria', descricao: 'Frequência de recálculo do ranking.' },
    criterios_desempate:                { valor: ['quizzes_aprovados_ano_desc', 'percentual_aproveitamento_desc', 'data_conquista_nivel_atual_asc', 'municipio_alfabetico_asc'], descricao: 'Ordem de critérios de desempate. Ranking sempre em ano calendário puro.' },
    limiar_municipio_pequeno:           { valor: 5, descricao: 'Abaixo deste nº de especialistas/mestres no município, nomes ficam ocultos e percentil vira faixa larga.' },
    faixas_percentil_municipio_pequeno: { valor: [25, 50, 75, 100], descricao: 'Faixas de arredondamento do percentil municipal para municípios pequenos.' }
  },
  adesao: {
    cooldown_convite_dias:       { valor: 5, descricao: 'Dias entre exibições do convite de adesão após "mais tarde".' },
    termos_versao_atual:         { valor: 'v1', descricao: 'Versão vigente dos termos de aceite da Academia.' },
    dias_delay_exibicao_convite: { valor: 2, descricao: 'Segundos de atraso após radarUserReady antes de mostrar o convite (nome mantém "dias" por padrão de nomenclatura, valor é em segundos).' }
  },
  certificado: {
    formato:                   { valor: 'A4', descricao: 'Formato de página do PDF do certificado.' },
    incluir_historico:         { valor: true, descricao: 'Inclui a Página 2 (histórico) no certificado.' },
    incluir_ranking_percentil: { valor: true, descricao: 'Inclui a Página 3 (percentil), sempre anonimizada.' },
    qr_code_ativo:             { valor: true, descricao: 'Inclui QR Code de validação.' },
    url_validacao:             { valor: 'https://radarsiope.com.br/validar', descricao: 'URL base da página pública de validação.' },
    storage:                   { valor: 'vercel_blob', descricao: 'Onde o PDF é armazenado.' },
    cache_horas:                { valor: 24, descricao: 'Horas de cache do PDF já gerado.' }
  },
  backfill: {
    data_corte: { valor: '2026-01-01', descricao: 'Data mais antiga considerada em qualquer backfill (lançamento ou adesão individual).' },
    ativo:      { valor: true, descricao: 'Liga/desliga rotinas de backfill.' }
  },
  versao: { valor: '1.7.0', descricao: 'Versão da especificação da Academia à qual esta configuração corresponde.' }
};

const _PARAMETROS_FIDELIDADE_PADRAO = {
  ativo:                  { valor: true, descricao: 'Liga/desliga o Clube de Excelência.' },
  nivel_exigido:          { valor: 'mestre', descricao: 'Nível mínimo mantido durante um ano de contrato para contar um ano de fidelidade.' },
  aproveitamento_minimo:  { valor: 70, descricao: 'Aproveitamento médio mínimo (%) exigido no ano de contrato.' },
  tabela_descontos: {
    '1': { valor: 5,  descricao: '% de desconto após 1 ano de contrato consecutivo como Mestre.' },
    '2': { valor: 10, descricao: '% de desconto após 2 anos consecutivos.' },
    '3': { valor: 15, descricao: '% de desconto após 3 anos consecutivos.' },
    '4': { valor: 20, descricao: '% de desconto após 4 anos consecutivos.' },
    '5': { valor: 25, descricao: '% de desconto após 5+ anos — TETO, não aumenta mais.' }
  },
  valor_minimo_assinatura: { valor: 19.90, descricao: 'Piso (R$) da mensalidade mesmo com desconto de fidelidade + outras promoções.' },
  regras: {
    suspensao_por_inadimplencia_dias:      { valor: 30, descricao: 'Dias de inadimplência tolerados antes de suspender benefícios de fidelidade.' },
    recuperacao_perde_um_ano:              { valor: true, descricao: 'Ausência ≤ 1 ano de contrato sem Mestre: contador decresce 1 em vez de zerar.' },
    reset_apos_mais_de_um_ano_ausente:     { valor: true, descricao: 'Ausência > 1 ano de contrato sem Mestre: contador reseta para 1 (reset total, sem piso).' },
    desconto_nao_acumulavel_com_promocoes: { valor: false, descricao: 'Se true, desconto de fidelidade não soma com outras promoções.' },
    contador_minimo:                       { valor: 1, descricao: 'Valor mínimo do contador de anos consecutivos.' }
  }
};

function _ehFolhaParametroPadrao(no) {
  return no !== null && typeof no === 'object' && 'valor' in no && 'descricao' in no;
}

function _extrairValoresPadrao(definicao, existente = {}) {
  const resultado = {};
  for (const chave of Object.keys(definicao)) {
    const no = definicao[chave];
    if (_ehFolhaParametroPadrao(no)) {
      const jaExiste = existente && Object.prototype.hasOwnProperty.call(existente, chave);
      resultado[chave] = jaExiste ? existente[chave] : no.valor;
    } else {
      resultado[chave] = _extrairValoresPadrao(no, (existente && existente[chave]) || {});
    }
  }
  return resultado;
}

function _extrairDescricoesPadrao(definicao, existente = {}) {
  const resultado = {};
  for (const chave of Object.keys(definicao)) {
    const no = definicao[chave];
    if (_ehFolhaParametroPadrao(no)) {
      const descAtual = existente ? existente[chave] : undefined;
      resultado[chave] = (typeof descAtual === 'string' && descAtual.trim() !== '') ? descAtual : no.descricao;
    } else {
      resultado[chave] = _extrairDescricoesPadrao(no, (existente && existente[chave]) || {});
    }
  }
  return resultado;
}

function _contarFolhasPadrao(definicao) {
  let n = 0;
  for (const chave of Object.keys(definicao)) {
    const no = definicao[chave];
    n += _ehFolhaParametroPadrao(no) ? 1 : _contarFolhasPadrao(no);
  }
  return n;
}

async function _bootstrapDocumentoPadrao(nomeDoc, definicao) {
  const ref = db.collection('config').doc(nomeDoc);
  const snap = await ref.get();
  const existente = snap.exists ? snap.data() : {};

  const novosValores = _extrairValoresPadrao(definicao, existente);
  await ref.set({
    ...novosValores,
    atualizado_em: new Date().toISOString(),
    atualizado_por: window._adminUid || 'admin_setup_browser',
  }, { merge: true });

  const refMeta = db.collection('config').doc(`${nomeDoc}_metadados`);
  const snapMeta = await refMeta.get();
  const existenteMeta = snapMeta.exists ? snapMeta.data() : {};
  const novasDescricoes = _extrairDescricoesPadrao(definicao, existenteMeta);
  await refMeta.set(novasDescricoes, { merge: true });

  return _contarFolhasPadrao(definicao);
}

// ─── Botão do menu — roda 100% no navegador, sem API/token ───────────────────
async function executarScriptCargaInicialAcademia(btnEl) {
  if (!confirm('Isso grava os valores e descrições padrão da Academia em config/selos e ' +
               'config/fidelidade (e seus _metadados). Valores já existentes NÃO são sobrescritos, ' +
               'só o que estiver faltando é preenchido. Continuar?')) return;

  const textoOriginal = btnEl.textContent;
  btnEl.disabled = true;
  btnEl.textContent = '⏳ Executando...';

  try {
    const totalSelos = await _bootstrapDocumentoPadrao('selos', _PARAMETROS_SELOS_PADRAO);
    const totalFidelidade = await _bootstrapDocumentoPadrao('fidelidade', _PARAMETROS_FIDELIDADE_PADRAO);

    alert(`✅ Carga inicial concluída!\n` +
          `config/selos: ${totalSelos} parâmetros verificados/gravados\n` +
          `config/fidelidade: ${totalFidelidade} parâmetros verificados/gravados`);

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