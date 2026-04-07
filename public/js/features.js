/* ==========================================================================
   features.js — Radar SIOPE
   Gestão dinâmica de features dos planos de assinatura
   ========================================================================== */

'use strict';

// ─── Gerenciamento de Features ──────────────────────────────────────────────

let featuresCache = null;
let featuresCacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

/**
 * Carrega todas as features ativas do Firestore
 * @returns {Promise<Array>} Lista de features ordenadas por ordem
 */
async function carregarFeatures() {
  const now = Date.now();
  if (featuresCache && (now - featuresCacheTimestamp) < CACHE_DURATION) {
    return featuresCache;
  }

  try {
    const snap = await db.collection('features')
      .orderBy('ordem', 'asc')
      .orderBy('nome', 'asc')
      .get();

    featuresCache = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    featuresCacheTimestamp = now;
    return featuresCache;
  } catch (err) {
    console.error('[features] Erro ao carregar features:', err);
    return [];
  }
}

/**
 * Cria ou atualiza uma feature
 * @param {string} id - ID da feature (null para nova)
 * @param {Object} data - Dados da feature
 * @returns {Promise<string>} ID da feature criada/atualizada
 */
async function salvarFeature(id, data) {
  try {
    const docData = {
      nome: data.nome,
      descricao: data.descricao,
      tipo: data.tipo, // 'boolean', 'number', 'text'
      unidade: data.unidade || '', // para números (ex: 'h/mês', '/mês')
      icone: data.icone || '⚙️',
      ordem: Number(data.ordem) || 99,
      ativo: data.ativo !== false,
      criado_em: data.criado_em || new Date(),
      atualizado_em: new Date()
    };

    let docRef;
    if (id) {
      // Para edição ou criação com ID personalizado
      await db.collection('features').doc(id).set(docData, { merge: true });
      docRef = db.collection('features').doc(id);
    } else {
      // Para criação sem ID específico (fallback)
      docRef = await db.collection('features').add(docData);
    }

    // Limpar cache
    featuresCache = null;

    return docRef.id;
  } catch (err) {
    console.error('[features] Erro ao salvar feature:', err);
    throw err;
  }
}

/**
 * Exclui uma feature (soft delete)
 * @param {string} id - ID da feature
 */
async function excluirFeature(id) {
  try {
    await db.collection('features').doc(id).update({
      ativo: false,
      atualizado_em: new Date()
    });
    featuresCache = null;
  } catch (err) {
    console.error('[features] Erro ao excluir feature:', err);
    throw err;
  }
}

/**
 * Renderiza o campo de feature no modal de plano
 * @param {Object} feature - Dados da feature
 * @param {*} valor - Valor atual da feature no plano
 * @returns {string} HTML do campo
 */
function renderCampoFeature(feature, valor) {
  const id = `feat-${feature.id}`;
  const label = `${feature.icone} ${feature.nome}`;

  if (feature.tipo === 'boolean') {
    return `
      <div style="display:flex;align-items:center;justify-content:space-between">
        <label for="${id}" style="font-size:13px;cursor:pointer">${escapeHtml(label)}</label>
        <input type="checkbox" id="${id}" ${valor ? 'checked' : ''}
          style="width:16px;height:16px;cursor:pointer">
      </div>
    `;
  }

  if (feature.tipo === 'number') {
    const unidade = feature.unidade ? ` ${feature.unidade}` : '';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span style="font-size:13px">${escapeHtml(label)}</span>
        <div style="display:flex;align-items:center;gap:4px">
          <input type="number" id="${id}" value="${Number(valor)||0}" min="0" max="999"
            style="width:70px;padding:4px 6px;border:1px solid #ccc;border-radius:4px;font-size:13px">
          <span style="font-size:12px;color:#666">${unidade}</span>
        </div>
      </div>
    `;
  }

  if (feature.tipo === 'text') {
    return `
      <div>
        <label for="${id}" style="font-size:13px;display:block;margin-bottom:4px">${escapeHtml(label)}</label>
        <input type="text" id="${id}" value="${escapeHtml(valor||'')}"
          style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:13px">
      </div>
    `;
  }

  return '';
}

/**
 * Coleta os valores das features do formulário
 * @param {Array} features - Lista de features
 * @returns {Object} Objeto com os valores das features
 */
function coletarValoresFeatures(features) {
  const valores = {};

  features.forEach(feature => {
    const el = document.getElementById(`feat-${feature.id}`);
    if (!el) return;

    if (feature.tipo === 'boolean') {
      valores[feature.id] = el.checked;
    } else if (feature.tipo === 'number') {
      valores[feature.id] = Number(el.value) || 0;
    } else if (feature.tipo === 'text') {
      valores[feature.id] = el.value.trim();
    }
  });

  return valores;
}

/**
 * Formata features para exibição em badges
 * @param {Object} features - Objeto com valores das features
 * @param {Array} featuresList - Lista completa de features
 * @returns {string} String formatada com badges
 */
function formatarFeaturesBadges(features, featuresList) {
  if (!features || !featuresList) return '—';

  const ativos = [];

  featuresList.forEach(feature => {
    const valor = features[feature.id];
    if (!valor) return;

    if (feature.tipo === 'boolean' && valor === true) {
      ativos.push(feature.icone);
    } else if (feature.tipo === 'number' && valor > 0) {
      ativos.push(`${feature.icone}${valor}${feature.unidade || ''}`);
    } else if (feature.tipo === 'text' && valor.trim()) {
      ativos.push(feature.icone);
    }
  });

  return ativos.length ? ativos.join(' ') : '📝 Básico';
}

// ─── Interface de Administração ────────────────────────────────────────────

/**
 * Abre modal para gerenciar features
 */
async function abrirModalFeatures() {
  const body = document.getElementById('modal-edit-body');
  if (!body) return console.warn('[features] modal-edit-body não encontrado');

  document.getElementById('modal-edit-title').innerText = 'Gerenciar Features';
  document.getElementById('modal-edit-save').style.display = 'none';

  body.innerHTML = '<p style="color:#999;text-align:center;padding:20px">Carregando features...</p>';
  openModal && openModal('modal-edit-overlay');

  try {
    const features = await carregarFeatures();

    body.innerHTML = `
      <div style="margin-bottom:16px">
        <button onclick="abrirModalFeature()" style="padding:8px 16px;background:#0A3D62;color:#fff;border:none;border-radius:6px;cursor:pointer">
          ➕ Nova Feature
        </button>
      </div>

      <div id="features-list" style="max-height:400px;overflow-y:auto">
        ${features.length === 0 ?
          '<p style="color:#666;text-align:center;padding:20px">Nenhuma feature cadastrada</p>' :
          features.map(f => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:8px">
              <div>
                <div style="font-weight:600">${f.icone} ${f.nome}</div>
                <div style="font-size:12px;color:#666">${f.descricao || 'Sem descrição'}</div>
                <div style="font-size:11px;color:#888">Tipo: ${f.tipo} ${f.unidade ? `(${f.unidade})` : ''}</div>
              </div>
              <div style="display:flex;gap:6px">
                <button onclick="abrirModalFeature('${f.id}')" style="padding:4px 8px;background:#0891B2;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">✏️ Editar</button>
                <button onclick="confirmarExclusaoFeature('${f.id}', '${f.nome}')" style="padding:4px 8px;background:#dc2626;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">🗑️ Excluir</button>
              </div>
            </div>
          `).join('')
        }
      </div>
    `;

  } catch (err) {
    console.error('[features] Erro ao carregar modal:', err);
    body.innerHTML = '<p style="color:#b00020;text-align:center;padding:20px">Erro ao carregar features</p>';
  }
}

/**
 * Abre modal para criar/editar feature
 * @param {string} id - ID da feature para editar (null para nova)
 */
async function abrirModalFeature(id = null) {
  const body = document.getElementById('modal-edit-body');
  if (!body) return;

  document.getElementById('modal-edit-title').innerText = id ? 'Editar Feature' : 'Nova Feature';
  document.getElementById('modal-edit-save').style.display = 'inline-block';

  // Buscar dados se editando
  let d = {
    nome: '',
    descricao: '',
    tipo: 'boolean',
    unidade: '',
    icone: '⚙️',
    ordem: 99,
    ativo: true
  };

  if (id) {
    try {
      const doc = await db.collection('features').doc(id).get();
      if (doc.exists) {
        d = { ...d, ...doc.data() };
      }
    } catch (err) {
      console.error('[features] Erro ao carregar feature:', err);
      mostrarMensagem('Erro ao carregar feature');
      return;
    }
  }

  body.innerHTML = `
    <div style="display:grid;gap:12px">
      <div>
        <label style="font-size:12px;color:#555;display:block;margin-bottom:4px">ID da Feature</label>
        <input id="feat-id" type="text" value="${escapeHtml(id || '')}" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px" placeholder="Ex: biblioteca_acesso" ${id ? 'readonly' : ''}>
        <div style="font-size:11px;color:#666;margin-top:2px">${id ? 'ID não pode ser alterado após criação' : 'Use apenas letras minúsculas, números e underscore (_)'}</div>
      </div>

      <div>
        <label style="font-size:12px;color:#555;display:block;margin-bottom:4px">Nome da Feature</label>
        <input id="feat-nome" type="text" value="${escapeHtml(d.nome)}" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px" placeholder="Ex: Newsletter em áudio">
      </div>

      <div>
        <label style="font-size:12px;color:#555;display:block;margin-bottom:4px">Descrição</label>
        <textarea id="feat-descricao" rows="2" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px">${escapeHtml(d.descricao)}</textarea>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label style="font-size:12px;color:#555;display:block;margin-bottom:4px">Tipo</label>
          <select id="feat-tipo" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px">
            <option value="boolean" ${d.tipo === 'boolean' ? 'selected' : ''}>Booleano (Sim/Não)</option>
            <option value="number" ${d.tipo === 'number' ? 'selected' : ''}>Número</option>
            <option value="text" ${d.tipo === 'text' ? 'selected' : ''}>Texto</option>
          </select>
        </div>

        <div>
          <label style="font-size:12px;color:#555;display:block;margin-bottom:4px">Unidade (para números)</label>
          <input id="feat-unidade" type="text" value="${escapeHtml(d.unidade)}" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px" placeholder="Ex: h/mês, /mês">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div>
          <label style="font-size:12px;color:#555;display:block;margin-bottom:4px">Ícone</label>
          <input id="feat-icone" type="text" value="${escapeHtml(d.icone)}" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px" placeholder="⚙️">
        </div>

        <div>
          <label style="font-size:12px;color:#555;display:block;margin-bottom:4px">Ordem</label>
          <input id="feat-ordem" type="number" value="${d.ordem}" min="1" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px">
        </div>

        <div style="display:flex;align-items:end">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="feat-ativo" ${d.ativo ? 'checked' : ''}>
            <span style="font-size:13px">Ativo</span>
          </label>
        </div>
      </div>
    </div>
  `;

  // Configurar evento de salvar
  const saveBtn = document.getElementById('modal-edit-save');
  if (saveBtn) {
    saveBtn.onclick = () => _salvarFeatureModal(id);
  }

  openModal && openModal('modal-edit-overlay');
}

function confirmarExclusaoFeature(id, nome) {
  abrirConfirmacao &&
  abrirConfirmacao(
    `Excluir feature "${nome}"?\n\nEsta ação marcará a feature como inativa. Planos existentes não serão afetados.`,
    () => excluirFeature(id).then(() => {
      mostrarMensagem('Feature excluída com sucesso');
      abrirModalFeatures(); // Recarregar lista
    }).catch(err => {
      console.error(err);
      mostrarMensagem('Erro ao excluir feature');
    })
  );
}

/**
 * Salva feature do modal
 */
async function _salvarFeatureModal(id) {
  const customId = document.getElementById('feat-id').value.trim();
  const data = {
    nome: document.getElementById('feat-nome').value.trim(),
    descricao: document.getElementById('feat-descricao').value.trim(),
    tipo: document.getElementById('feat-tipo').value,
    unidade: document.getElementById('feat-unidade').value.trim(),
    icone: document.getElementById('feat-icone').value.trim(),
    ordem: document.getElementById('feat-ordem').value,
    ativo: document.getElementById('feat-ativo').checked
  };

  // Validações
  if (!customId && !id) {
    mostrarMensagem('ID da feature é obrigatório');
    return;
  }

  if (!id && !/^[a-z0-9_]+$/.test(customId)) {
    mostrarMensagem('ID deve conter apenas letras minúsculas, números e underscore (_)');
    return;
  }

  if (!data.nome) {
    mostrarMensagem('Nome da feature é obrigatório');
    return;
  }

  try {
    // Para nova feature, usar ID personalizado; para edição, manter o ID existente
    const featureId = id || customId;
    await salvarFeature(featureId, data);
    mostrarMensagem(id ? 'Feature atualizada!' : 'Feature criada!');
    closeModal && closeModal('modal-edit-overlay');
    abrirModalFeatures(); // Recarregar lista
  } catch (err) {
    console.error(err);
    mostrarMensagem('Erro ao salvar feature');
  }
}

// ─── Funções de Compatibilidade ────────────────────────────────────────────

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]
  );
}

// Expor funções globalmente
window.FeaturesManager = {
  carregarFeatures,
  salvarFeature,
  excluirFeature,
  renderCampoFeature,
  coletarValoresFeatures,
  formatarFeaturesBadges,
  abrirModalFeatures,
  abrirModalFeature
};