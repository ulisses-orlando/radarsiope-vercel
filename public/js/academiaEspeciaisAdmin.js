/* ==========================================================================
   academiaEspeciaisAdmin.js — Admin: CRUD de Quizzes Especiais da Academia
   (v3 — modelo "todos os ativos do nível são obrigatórios", substitui o
   pool aberto único e o parâmetro independente especiais_adicionais_necessarios)

   Coleção: quizzes_especiais/{id}
   {
     titulo, descricao,
     ativo: true,
     dificuldade: 8,                        // 1-10, só editorial
     nivel_alvo: "especialista" | "mestre",  // OBRIGATÓRIO agora (era nivel_alvo_sugerido, opcional)
     tentativas_max, pontuacao_minima,
     perguntas: [...],
     criado_em, criado_por, atualizado_em
   }

   MODELO v1.7: não existe mais "quantidade exigida" configurável.
   O requisito de especiais de um nível É, por definição, a contagem de
   documentos ativos com aquele nivel_alvo — 100% deles são obrigatórios,
   sem meta separada. Por isso:
   - Não há mais bloqueio de "não pode desativar, ficaria abaixo do exigido"
   - Ativar/desativar um especial MUDA o próprio requisito daquele nível
     para quem ainda não o conquistou — por isso todo toggle mostra um
     aviso com o efeito antes de confirmar (Seção 7 da spec)
   - A notificação de quem é afetado (Seção 21.9) é responsabilidade de
     um trigger de backend (onQuizEspecialToggle, a criar), disparado pela
     própria escrita em `ativo` — este arquivo só avisa o admin na hora,
     não escaneia assinantes (isso é trabalho de Cloud Function, não do
     painel admin no navegador).

   Exclusão continua sendo sempre SOFT DELETE (ativo:false) — nunca remove
   o documento, preservando quiz_resultados e academia_niveis já gravados.
   ========================================================================== */

let _listaEspeciaisCache = [];
let _especialEmEdicaoId = null;

// ─── Painel: listagem + contadores ao vivo por nível ─────────────────────────
async function abrirPainelQuizzesEspeciais() {
  const container = document.getElementById('painel-quizzes-especiais');
  if (!container) {
    console.error('[academiaEspeciaisAdmin] #painel-quizzes-especiais não encontrado no HTML do admin.');
    return;
  }
  container.innerHTML = '<div class="drawer-loading">⏳ Carregando Quizzes Especiais...</div>';

  try {
    const snap = await db.collection('quizzes_especiais').orderBy('criado_em', 'desc').get();
    _listaEspeciaisCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    container.innerHTML = `<div class="drawer-alerta vermelho">Erro ao carregar: ${e.message}</div>`;
    return;
  }

  _renderListaQuizzesEspeciais();
}

// Conta quantos especiais ATIVOS existem para um nivel_alvo — esse número
// É o requisito vigente daquele nível (não há mais config separada).
function _contarAtivosPorNivel(nivelAlvo, excluirId = null) {
  return _listaEspeciaisCache.filter(q =>
    q.nivel_alvo === nivelAlvo && q.ativo !== false && q.id !== excluirId
  ).length;
}

function _renderListaQuizzesEspeciais() {
  const container = document.getElementById('painel-quizzes-especiais');

  const totalEspecialista = _contarAtivosPorNivel('especialista');
  const totalMestre = _contarAtivosPorNivel('mestre');

  const linhas = _listaEspeciaisCache.map(q => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #eee;border-radius:8px;margin-bottom:6px;
                ${q.ativo === false ? 'opacity:0.5' : ''}">
      <div style="flex:1">
        <div style="font-weight:600;font-size:13px">${_escapeHtml(q.titulo || '(sem título)')}</div>
        <div style="font-size:11px;color:#888">
          ${q.perguntas?.length || 0} pergunta(s) · dificuldade ${q.dificuldade ?? '?'}/10 ·
          nível-alvo: <strong>${_tituloNivel(q.nivel_alvo)}</strong>
          ${q.ativo === false ? ' · <span style="color:#dc2626">INATIVO</span>' : ''}
        </div>
      </div>
      <button class="btn-drawer-sm" onclick="abrirFormQuizEspecial('${q.id}')">✏️ Editar</button>
      ${q.ativo === false
        ? `<button class="btn-drawer-sm btn-verde" onclick="_confirmarToggleQuizEspecial('${q.id}', true)">♻️ Reativar</button>`
        : `<button class="btn-drawer-sm" style="background:#dc2626;color:#fff;border:none" onclick="_confirmarToggleQuizEspecial('${q.id}', false)">🗑️ Desativar</button>`}
    </div>
  `).join('');

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h3 style="margin:0;font-size:15px">🧩 Quizzes Especiais</h3>
      <button class="btn-drawer-sm btn-verde" onclick="abrirFormQuizEspecial()">➕ Novo Quiz Especial</button>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:180px;padding:8px 12px;border-radius:8px;background:#f5f3ff;border:1px solid #ddd6fe">
        <div style="font-size:11px;color:#6d28d9;font-weight:600">REQUISITO ATUAL — ESPECIALISTA</div>
        <div style="font-size:20px;font-weight:700">${totalEspecialista}</div>
        <div style="font-size:10px;color:#888">100% dos ativos deste nível são obrigatórios</div>
      </div>
      <div style="flex:1;min-width:180px;padding:8px 12px;border-radius:8px;background:#eff6ff;border:1px solid #bfdbfe">
        <div style="font-size:11px;color:#1d4ed8;font-weight:600">REQUISITO ATUAL — MESTRE</div>
        <div style="font-size:20px;font-weight:700">${totalMestre}</div>
        <div style="font-size:10px;color:#888">100% dos ativos deste nível são obrigatórios</div>
      </div>
    </div>

    <div id="lista-quizzes-especiais">${linhas || '<p style="color:#888;font-size:13px">Nenhum Quiz Especial cadastrado ainda.</p>'}</div>
    <div id="form-quiz-especial-wrap" style="margin-top:16px"></div>
  `;
}

function _tituloNivel(chave) {
  const nomes = { dedicado: 'Dedicado', especialista: 'Especialista', mestre: 'Mestre' };
  return nomes[chave] || chave || '(sem nível-alvo)';
}

// ─── Toggle ativo/inativo — SEM bloqueio, COM aviso do efeito ────────────────
async function _confirmarToggleQuizEspecial(id, novoAtivo) {
  const q = _listaEspeciaisCache.find(x => x.id === id);
  if (!q) return;

  const nivel = q.nivel_alvo;
  const totalAtual = _contarAtivosPorNivel(nivel);
  const totalDepois = novoAtivo ? totalAtual + 1 : totalAtual - 1;

  const acao = novoAtivo ? 'ativar' : 'desativar';
  const efeito = novoAtivo
    ? `Isso AUMENTA o requisito de "${_tituloNivel(nivel)}" de ${totalAtual} para ${totalDepois}.\n` +
      `Assinantes que já tinham completado todos os ${totalAtual} especiais anteriores desse nível ` +
      `passarão a precisar deste também (serão notificados automaticamente).`
    : `Isso REDUZ o requisito de "${_tituloNivel(nivel)}" de ${totalAtual} para ${totalDepois}.\n` +
      `Quem ainda está buscando esse nível precisará de menos especiais a partir de agora.`;

  const confirmMsg = novoAtivo
    ? `Reativar "${q.titulo}"?\n\n${efeito}`
    : `Desativar "${q.titulo}"? (o documento não é apagado, só some do requisito)\n\n${efeito}`;

  if (!confirm(confirmMsg)) return;

  await db.collection('quizzes_especiais').doc(id).update({
    ativo: novoAtivo,
    atualizado_em: new Date().toISOString(),
  });
  // A notificação de quem foi afetado (Seção 21.9) é disparada por um trigger
  // de backend ouvindo mudanças em `ativo` nesta coleção — não é feita aqui.

  await abrirPainelQuizzesEspeciais();
}

// ─── Formulário de criação/edição ─────────────────────────────────────────────
function abrirFormQuizEspecial(id = null) {
  _especialEmEdicaoId = id;
  const dados = id ? (_listaEspeciaisCache.find(q => q.id === id) || {}) : {};
  const wrap = document.getElementById('form-quiz-especial-wrap');
  if (!wrap) return;

  wrap.innerHTML = `
    <div style="margin-top:18px;padding:14px;border:1.5px solid #a78bfa;border-radius:8px;background:#faf5ff">
      <div style="font-weight:600;font-size:13px;color:#5b21b6;margin-bottom:8px;display:flex;align-items:center;gap:6px">
        🧩 ${id ? 'Editar' : 'Novo'} Quiz Especial
        <span style="font-size:11px;color:#888;font-weight:400">— Desafio de Maestria (Academia)</span>
      </div>
      <div style="font-size:11px;color:#7c3aed;margin-bottom:10px;padding:6px 8px;background:#f5f3ff;border-radius:6px">
        ⚠️ Todo Quiz Especial <strong>ativo</strong> é obrigatório para quem está buscando o nível-alvo escolhido —
        não existe "quantidade exigida" separada, é sempre 100% dos ativos daquele nível.
      </div>

      <div style="margin-bottom:8px">
        <label style="font-size:11px;font-weight:600;color:#666;display:block;margin-bottom:3px">TÍTULO</label>
        <input type="text" id="qe-titulo" value="${_escapeHtml(dados.titulo || '')}"
               style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:13px"
               placeholder="Ex: Desafio: Cálculo de VAAT no FUNDEB">
      </div>

      <div style="margin-bottom:8px">
        <label style="font-size:11px;font-weight:600;color:#666;display:block;margin-bottom:3px">DESCRIÇÃO (exibida antes de iniciar)</label>
        <textarea id="qe-descricao" rows="2" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:12px;resize:vertical"
                  placeholder="Contexto/tema do desafio">${_escapeHtml(dados.descricao || '')}</textarea>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <label style="font-size:12px;display:flex;align-items:center;gap:4px">
          <input type="number" id="qe-dificuldade" min="1" max="10" value="${dados.dificuldade ?? 8}"
                 style="width:50px;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:12px">
          Dificuldade (1-10)
        </label>
        <label style="font-size:12px;display:flex;align-items:center;gap:4px">
          <input type="number" id="qe-tentativas-max" min="1" max="10" value="${dados.tentativas_max || 3}"
                 style="width:50px;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:12px">
          Tentativas máx.
        </label>
        <label style="font-size:12px;display:flex;align-items:center;gap:4px">
          <input type="number" id="qe-pontuacao-minima" min="0" max="100" value="${dados.pontuacao_minima || 70}"
                 style="width:50px;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:12px">
          % Aprovação
        </label>
        <label style="font-size:12px;display:flex;align-items:center;gap:4px">
          Nível-alvo <span style="color:#dc2626">*obrigatório*</span>:
          <select id="qe-nivel-alvo" required style="padding:4px;border:1px solid #ddd;border-radius:4px;font-size:12px">
            <option value="" disabled ${!dados.nivel_alvo ? 'selected' : ''}>Selecione...</option>
            <option value="especialista" ${dados.nivel_alvo === 'especialista' ? 'selected' : ''}>Especialista (Dedicado → Especialista)</option>
            <option value="mestre" ${dados.nivel_alvo === 'mestre' ? 'selected' : ''}>Mestre (Especialista → Mestre)</option>
          </select>
        </label>
      </div>

      <div id="qe-perguntas-container" style="display:flex;flex-direction:column;gap:8px"></div>

      <div style="display:flex;gap:8px;margin-top:10px">
        <button type="button" id="qe-add-pergunta"
                style="flex:1;padding:6px 12px;background:#8b5cf6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px">
          ➕ Adicionar Pergunta
        </button>
        <button type="button" id="qe-import-json"
                style="flex:1;padding:6px 12px;background:#059669;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px">
          📥 Importar JSON
        </button>
      </div>

      <div style="display:flex;gap:8px;margin-top:14px">
        <button type="button" id="qe-salvar" class="btn-drawer-sm btn-verde" style="flex:1">💾 Salvar Quiz Especial</button>
        <button type="button" onclick="document.getElementById('form-quiz-especial-wrap').innerHTML=''">Cancelar</button>
      </div>
    </div>
  `;

  (dados.perguntas || []).forEach(p => _renderQuizEspecialPergunta(p));

  document.getElementById('qe-add-pergunta').addEventListener('click', () => _renderQuizEspecialPergunta({}));
  document.getElementById('qe-import-json').addEventListener('click', _importarJsonQuizEspecial);
  document.getElementById('qe-salvar').addEventListener('click', _salvarQuizEspecial);
}

function _renderQuizEspecialPergunta(pergunta = {}) {
  const container = document.getElementById('qe-perguntas-container');
  if (!container) return;

  const texto = pergunta.pergunta || pergunta.enunciado || pergunta.question || '';

  const item = document.createElement('div');
  item.style.cssText = 'border:1px solid #ddd;border-radius:6px;padding:10px;background:#fff;position:relative';
  item.innerHTML = `
      <button type="button" title="Remover" style="position:absolute;top:6px;right:8px;background:none;border:none;color:#dc2626;cursor:pointer;font-size:16px"
              onclick="this.closest('div[style]').remove()">×</button>
      <div style="margin-bottom:6px">
          <label style="font-size:11px;font-weight:600;color:#666;display:block;margin-bottom:3px">PERGUNTA</label>
          <input type="text" class="qe-pergunta-texto" value="${_escapeHtml(texto)}"
                style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:13px"
                placeholder="Digite a pergunta...">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
          ${['A', 'B', 'C', 'D'].map((letra, idx) => `
              <div>
                  <label style="font-size:10px;color:#888">${letra}</label>
                  <input type="text" class="qe-alternativa" data-idx="${idx}" value="${_escapeHtml(pergunta.alternativas?.[idx] || '')}"
                        style="width:100%;padding:5px;border:1px solid #ddd;border-radius:4px;font-size:12px"
                        placeholder="Alternativa ${letra}">
              </div>
          `).join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center">
          ${[0, 1, 2, 3].map(idx => `
              <label style="font-size:11px;display:flex;align-items:center;gap:4px">
                  <input type="radio" name="qe-correta-${Date.now()}-${Math.random()}" class="qe-correta" value="${idx}"
                        ${(pergunta.correta ?? -1) === idx ? 'checked' : ''}>
                  ${['A', 'B', 'C', 'D'][idx]}
              </label>
          `).join('')}
      </div>
      <div style="margin-top:6px">
          <label style="font-size:11px;font-weight:600;color:#666;display:block;margin-bottom:3px">EXPLICAÇÃO (feedback)</label>
          <textarea class="qe-explicacao" rows="2" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:12px;resize:vertical"
                   placeholder="Por que a alternativa correta está certa?">${_escapeHtml(pergunta.explicacao || '')}</textarea>
      </div>
  `;
  container.appendChild(item);
}

function _importarJsonQuizEspecial() {
  const jsonStr = prompt('Cole aqui o JSON do Quiz Especial gerado pelo NotebookLM.');
  if (!jsonStr) return;
  try {
    const dados = JSON.parse(jsonStr);

    if (dados.titulo !== undefined) document.getElementById('qe-titulo').value = dados.titulo;
    if (dados.descricao !== undefined) document.getElementById('qe-descricao').value = dados.descricao;
    if (dados.dificuldade !== undefined) document.getElementById('qe-dificuldade').value = dados.dificuldade;
    if (dados.tentativas_max !== undefined) document.getElementById('qe-tentativas-max').value = dados.tentativas_max;
    if (dados.pontuacao_minima !== undefined) document.getElementById('qe-pontuacao-minima').value = dados.pontuacao_minima;
    if (dados.nivel_alvo !== undefined) document.getElementById('qe-nivel-alvo').value = dados.nivel_alvo;

    const container = document.getElementById('qe-perguntas-container');
    if (container) container.innerHTML = '';

    if (Array.isArray(dados.perguntas)) {
      dados.perguntas.forEach(p => _renderQuizEspecialPergunta(p));
      alert('✅ Quiz Especial importado com sucesso!');
    }
  } catch (e) {
    alert('❌ Erro ao processar JSON: ' + e.message);
  }
}

function _coletarPerguntasQuizEspecial() {
  const container = document.getElementById('qe-perguntas-container');
  if (!container) return [];

  const perguntas = [];
  container.querySelectorAll(':scope > div').forEach(item => {
    const perguntaTexto = item.querySelector('.qe-pergunta-texto')?.value?.trim() || '';
    const alternativas = Array.from(item.querySelectorAll('.qe-alternativa')).map(i => i.value.trim());
    const correta = parseInt(item.querySelector('.qe-correta:checked')?.value) || 0;
    const explicacao = item.querySelector('.qe-explicacao')?.value?.trim() || '';

    if (perguntaTexto) {
      perguntas.push({
        id: crypto.randomUUID?.() || `q_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        pergunta: perguntaTexto,
        alternativas,
        correta,
        explicacao
      });
    }
  });
  return perguntas;
}

// ─── Salvar (criar ou atualizar) — nivel_alvo agora obrigatório ──────────────
async function _salvarQuizEspecial() {
  const titulo = document.getElementById('qe-titulo').value.trim();
  const nivelAlvo = document.getElementById('qe-nivel-alvo').value;

  if (!titulo) { alert('⚠️ Preencha o título do Quiz Especial.'); return; }
  if (!nivelAlvo) { alert('⚠️ Selecione o nível-alvo (Especialista ou Mestre) — é obrigatório neste modelo.'); return; }

  const perguntas = _coletarPerguntasQuizEspecial();
  if (perguntas.length === 0) { alert('⚠️ Adicione ao menos 1 pergunta.'); return; }

  // Se está CRIANDO um novo (ou reativando via edição) e ficaria ativo,
  // avisa do efeito no requisito antes de gravar — mesmo aviso do toggle.
  const vaiFicarAtivo = _especialEmEdicaoId
    ? (_listaEspeciaisCache.find(q => q.id === _especialEmEdicaoId)?.ativo !== false)
    : true; // novo especial nasce ativo por padrão
  if (!_especialEmEdicaoId && vaiFicarAtivo) {
    const totalAtual = _contarAtivosPorNivel(nivelAlvo);
    const confirmMsg = `Criar este Quiz Especial ativo AUMENTA o requisito de "${_tituloNivel(nivelAlvo)}" ` +
      `de ${totalAtual} para ${totalAtual + 1}.\nAssinantes que já tinham completado os ${totalAtual} anteriores ` +
      `precisarão deste também (serão notificados). Continuar?`;
    if (!confirm(confirmMsg)) return;
  }

  const payload = {
    titulo,
    descricao: document.getElementById('qe-descricao').value.trim(),
    dificuldade: parseInt(document.getElementById('qe-dificuldade').value) || 8,
    tentativas_max: parseInt(document.getElementById('qe-tentativas-max').value) || 3,
    pontuacao_minima: parseInt(document.getElementById('qe-pontuacao-minima').value) || 70,
    nivel_alvo: nivelAlvo,
    perguntas,
    atualizado_em: new Date().toISOString(),
  };

  const btn = document.getElementById('qe-salvar');
  btn.disabled = true; btn.textContent = '⏳ Salvando...';

  try {
    if (_especialEmEdicaoId) {
      await db.collection('quizzes_especiais').doc(_especialEmEdicaoId).update(payload);
    } else {
      payload.ativo = true;
      payload.criado_em = new Date().toISOString();
      payload.criado_por = window._adminUid || 'admin';
      await db.collection('quizzes_especiais').add(payload);
    }
    document.getElementById('form-quiz-especial-wrap').innerHTML = '';
    await abrirPainelQuizzesEspeciais();
  } catch (e) {
    alert('Erro ao salvar: ' + e.message);
    btn.disabled = false; btn.textContent = '💾 Salvar Quiz Especial';
  }
}

function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

window.abrirPainelQuizzesEspeciais = abrirPainelQuizzesEspeciais;
window.abrirFormQuizEspecial = abrirFormQuizEspecial;
window._confirmarToggleQuizEspecial = _confirmarToggleQuizEspecial;
