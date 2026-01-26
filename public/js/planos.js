/* planos.js - CRUD compatível com seu admin.html
   Requisitos: window.db (Firestore) já inicializado; modal HTML com ids:
   modal-edit-overlay, modal-edit-body, modal-edit-title, modal-edit-save.
*/

function safeNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

async function carregarPlanos() {
  const tbody = document.getElementById('lista-planos');
  if (!tbody) return console.warn('tbody #lista-planos não encontrado');
  tbody.innerHTML = '';

  try {
    const snap = await db.collection('planos').get();
    snap.forEach(doc => {
      const d = doc.data() || {};
      const valorFmt = (d.valor !== undefined && d.valor !== null)
        ? Number(d.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : '';
      const statusFmt = d.status || '--';
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${escapeHtml(d.nome || '')}</td>
        <td>${escapeHtml(d.descricao || '')}</td>
        <td style="text-align:center">${d.qtde_parcelas || ''}</td>
        <td style="text-align:center">${escapeHtml(d.tipo || '')}</td>
        <td style="text-align:right">${valorFmt}</td>
        <td style="text-align:center">${escapeHtml(statusFmt)}</td>
        <td style="text-align:center">
          <span class="icon-btn" title="Editar" onclick="abrirModalPlano('${doc.id}', true)">✏️</span>
          <span class="icon-btn" title="Excluir" onclick="confirmarExclusaoPlano('${doc.id}','${(d.nome || '').replace(/'/g, "\\'")}')">🗑️</span>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    mostrarMensagem('Erro ao carregar planos:');
  }
}

function confirmarExclusaoPlano(id, nome) {
  abrirConfirmacao(`Deseja excluir o plano "${nome}"?`, async () => {
    try {
      await db.collection('planos').doc(id).delete();
      await carregarPlanos();
      mostrarMensagem('Plano excluído.');
    } catch (err) {
      console.error('Erro ao excluir plano:', err);
      mostrarMensagem('Erro ao excluir plano. Veja console.');
    }
  });
}

/* ======================
   MODAL PLANOS (Novo / Editar)
   ====================== */

async function fetchTiposNewsletter() {
  try {
    const snap = await db.collection('tipo_newsletters').where('is_newsletter', '==', true).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('Erro ao buscar tipos:', err);
    return [];
  }
}

function createMultiSelectTipos(id = 'pl-tipos-multiselect', tipos = [], selectedIds = []) {
  const wrap = document.createElement('div');
  wrap.style.marginTop = '8px';
  wrap.innerHTML = `<label style="font-size:13px;color:#444">Tipos (selecione um ou mais)</label>`;
  const select = document.createElement('select');
  select.id = id;
  select.multiple = true;
  select.style.width = '100%';
  select.style.padding = '8px';
  select.style.border = '1px solid #ccc';
  select.style.borderRadius = '4px';
  select.size = Math.min(8, Math.max(4, tipos.length));
  tipos.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.nome || t.id;
    if (selectedIds && selectedIds.includes(t.id)) opt.selected = true;
    select.appendChild(opt);
  });
  wrap.appendChild(select);
  return wrap;
}

function readMultiSelectValues(selectId = 'pl-tipos-multiselect') {
  const sel = document.getElementById(selectId);
  if (!sel) return [];
  return Array.from(sel.options).filter(o => o.selected).map(o => o.value);
}


// --- integração no abrirModalPlano (substituir/inserir no local apropriado) ---
async function abrirModalPlano(id, editar = false) {
  const body = document.getElementById('modal-edit-body');
  if (!body) return console.warn('modal-edit-body não encontrado');
  body.innerHTML = '';
  document.getElementById('modal-edit-title').innerText = editar ? 'Editar Plano' : 'Novo Plano';
  document.getElementById('modal-edit-save').style.display = 'inline-block';

  let dados = {
    nome: '',
    descricao: '',
    qtde_parcelas: '',
    tipo: '',
    valor: '',
    status: 'ativo',
    tipos_inclusos: [],
    allow_multi_select: false,
    bundles: [],
    permitir_sem_juros: false,
    parcelas_sem_juros: ''
  };

  if (editar) {
    try {
      const doc = await db.collection('planos').doc(id).get();
      if (doc.exists) dados = Object.assign(dados, doc.data());
    } catch (err) {
      console.error('Erro ao carregar plano para edição:', err);
      mostrarMensagem && mostrarMensagem('Erro ao carregar plano. Veja console.');
      return;
    }
  }

  // campos básicos
  body.appendChild(generateTextField('nome', dados.nome || ''));
  const errNome = document.createElement('span');
  errNome.id = 'error-nome';
  errNome.className = 'field-error';
  errNome.style.display = 'none';
  errNome.style.color = '#b00020';
  errNome.style.fontSize = '12px';
  errNome.style.marginTop = '4px';
  body.appendChild(errNome);

  body.appendChild(generateTextArea('descricao', dados.descricao || ''));

  body.appendChild(generateTextField('qtde_parcelas', dados.qtde_parcelas || ''));
  const errParcelas = document.createElement('span');
  errParcelas.id = 'error-qtde_parcelas';
  errParcelas.className = 'field-error';
  errParcelas.style.display = 'none';
  errParcelas.style.color = '#b00020';
  errParcelas.style.fontSize = '12px';
  errParcelas.style.marginTop = '4px';
  body.appendChild(errParcelas);

  body.appendChild(generateTextField('valor', dados.valor !== undefined && dados.valor !== null ? String(dados.valor) : ''));
  const errValor = document.createElement('span');
  errValor.id = 'error-valor';
  errValor.className = 'field-error';
  errValor.style.display = 'none';
  errValor.style.color = '#b00020';
  errValor.style.fontSize = '12px';
  errValor.style.marginTop = '4px';
  body.appendChild(errValor);

  body.appendChild(generateDomainSelect('status', ['ativo', 'inativo'], dados.status || 'ativo'));
  body.appendChild(generateDomainSelect('tipo', ['assinatura', 'capacitação', 'consultoria'], dados.tipo || 'assinatura'));

  // checkbox permitir seleção múltipla
  const chkWrap = document.createElement('div');
  chkWrap.style.marginTop = '8px';
  chkWrap.innerHTML = `<label style="display:flex;align-items:center;gap:8px">
    <input type="checkbox" id="pl-allow-multi" ${dados.allow_multi_select ? 'checked' : ''} /> <span>Permitir seleção múltipla de tipos</span>
  </label>`;
  body.appendChild(chkWrap);

  // multiselect de tipos
  const tipos = await fetchTiposNewsletter();
  const multiselect = createMultiSelectTipos('pl-tipos-multiselect', tipos, Array.isArray(dados.tipos_inclusos) ? dados.tipos_inclusos : []);
  body.appendChild(multiselect);

  // bundles
  const bundlesWrap = document.createElement('div');
  bundlesWrap.style.marginTop = '8px';
  bundlesWrap.innerHTML = `<label style="font-size:13px;color:#444">Bundles (JSON) — opcional</label>
    <textarea id="pl-bundles" rows="3" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px">${Array.isArray(dados.bundles) ? JSON.stringify(dados.bundles) : ''}</textarea>
    <div style="font-size:12px;color:#666;margin-top:6px">Formato: [{"types":["id1","id2"],"discount_percent":10}]</div>`;
  body.appendChild(bundlesWrap);

  // novos campos de parcelamento sem juros
  const chkSemJuros = document.createElement('div');
  chkSemJuros.style.marginTop = '8px';
  chkSemJuros.innerHTML = `<label style="display:flex;align-items:center;gap:8px">
    <input type="checkbox" id="pl-permitir-sem-juros" ${dados.permitir_sem_juros ? 'checked' : ''} /> <span>Permitir parcelamento sem juros</span>
  </label>`;
  body.appendChild(chkSemJuros);

  body.appendChild(generateTextField('parcelas_sem_juros', dados.parcelas_sem_juros || ''));
  const errParcelasSemJuros = document.createElement('span');
  errParcelasSemJuros.id = 'error-parcelas_sem_juros';
  errParcelasSemJuros.className = 'field-error';
  errParcelasSemJuros.style.display = 'none';
  errParcelasSemJuros.style.color = '#b00020';
  errParcelasSemJuros.style.fontSize = '12px';
  errParcelasSemJuros.style.marginTop = '4px';
  body.appendChild(errParcelasSemJuros);

  document.getElementById('modal-edit-save').onclick = async () => {
    try {
      clearFieldErrors && clearFieldErrors();

      // coleta campos
      const fields = body.querySelectorAll('[data-field-name]');
      let data = {};
      fields.forEach(f => data[f.dataset.fieldName] = f.value);

      // multiselect de tipos
      data.tipos_inclusos = typeof readMultiSelectValues === 'function'
        ? readMultiSelectValues('pl-tipos-multiselect')
        : [];

      // checkboxes
      data.allow_multi_select = !!document.getElementById('pl-allow-multi').checked;
      data.permitir_sem_juros = !!document.getElementById('pl-permitir-sem-juros').checked;

      // bundles
      const bundlesRaw = document.getElementById('pl-bundles').value.trim();
      if (bundlesRaw) {
        try { data.bundles = JSON.parse(bundlesRaw); }
        catch (e) { alert('Formato inválido em Bundles. Corrija o JSON.'); return; }
      } else data.bundles = [];

      // validação valor e parcelas
      const valorRaw = data.valor;
      const parcelasRaw = data.qtde_parcelas;
      const { valid, errors, parsed } = validateValorEParcelas({ valorRaw, parcelasRaw });

      if (!data.nome || String(data.nome).trim() === '') {
        errors.nome = 'Nome é obrigatório.';
      }

      // validação parcelas sem juros
      if (data.permitir_sem_juros) {
        const psj = safeNumber(data.parcelas_sem_juros);
        if (!psj || psj <= 0) {
          errors.parcelas_sem_juros = 'Informe o número máximo de parcelas sem juros.';
        } else {
          data.parcelas_sem_juros = psj;
        }
      } else {
        data.parcelas_sem_juros = null;
      }

      if (!valid || Object.keys(errors).length) {
        if (showFieldErrors) showFieldErrors(errors);
        else {
          Object.keys(errors).forEach(f => {
            const sp = document.getElementById(`error-${f}`);
            if (sp) { sp.textContent = errors[f]; sp.style.display = 'block'; }
          });
        }
        const firstField = Object.keys(errors)[0];
        const el = document.getElementById(`field-${firstField}`);
        if (el) el.focus();
        return;
      }

      // parse números normalizados
      data.valor = parsed.valor;
      data.qtde_parcelas = parsed.qtde_parcelas;

      // normalizações
      data.status = data.status || 'ativo';
      data.tipo = data.tipo || 'assinatura';

      // salvar no Firestore
      if (editar) {
        await db.collection('planos').doc(id).update(data);
        mostrarMensagem && mostrarMensagem('Plano atualizado.');
      } else {
        await db.collection('planos').add(data);
        mostrarMensagem && mostrarMensagem('Plano criado.');
      }

      closeModal && closeModal('modal-edit-overlay');
      await carregarPlanos();
    } catch (err) {
      console.error('Erro ao salvar plano com multiselect e validação:', err);
      mostrarMensagem && mostrarMensagem('Erro ao salvar plano. Veja console.');
    }
  };
  // abrir modal
  openModal && openModal('modal-edit-overlay');
}
// salvar handler com validação de valor e parcelas


/* utilitários auxiliares */
function generateTextField(name, value = '') {
  const wrap = document.createElement('div');
  wrap.style.marginTop = '8px';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value !== undefined && value !== null ? value : '';
  input.dataset.fieldName = name;
  input.id = `field-${name}`;
  input.style.padding = '8px';
  input.style.border = '1px solid #ccc';
  input.style.borderRadius = '4px';
  input.placeholder = name;
  wrap.appendChild(input);
  return wrap;
}

function generateTextArea(name, value = '') {
  const wrap = document.createElement('div');
  wrap.style.marginTop = '8px';
  const ta = document.createElement('textarea');
  ta.rows = 3;
  ta.value = value !== undefined && value !== null ? value : '';
  ta.dataset.fieldName = name;
  ta.id = `field-${name}`;
  ta.style.padding = '8px';
  ta.style.border = '1px solid #ccc';
  ta.style.borderRadius = '4px';
  wrap.appendChild(ta);
  return wrap;
}

function generateDomainSelect(name, options = [], selected = '') {
  const wrap = document.createElement('div');
  wrap.style.marginTop = '8px';
  const sel = document.createElement('select');
  sel.dataset.fieldName = name;
  sel.id = `field-${name}`;
  sel.style.padding = '8px';
  sel.style.border = '1px solid #ccc';
  sel.style.borderRadius = '4px';
  const emptyOpt = document.createElement('option');
  emptyOpt.value = ''; emptyOpt.text = '-- selecione --';
  sel.appendChild(emptyOpt);
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt; o.text = opt;
    if (String(opt) === String(selected)) o.selected = true;
    sel.appendChild(o);
  });
  wrap.appendChild(sel);
  return wrap;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, function (m) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
  });
}

function filtrarPlanos() {
  const filtro = document.getElementById('busca-planos').value.toLowerCase();
  document.querySelectorAll('#lista-planos tr').forEach(tr => {
    tr.style.display = tr.innerText.toLowerCase().includes(filtro) ? '' : 'none';
  });
}

window._planosAdmin = { carregarPlanos, abrirModalPlano, confirmarExclusaoPlano };
