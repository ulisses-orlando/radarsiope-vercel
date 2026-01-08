/* cupons.js - CRUD compatível com admin.html
   Requisitos: window.db (Firestore) já inicializado; modal HTML com ids:
   modal-edit-overlay, modal-edit-body, modal-edit-title, modal-edit-save.
*/

async function carregarCupons() {
  const tbody = document.getElementById('lista-cupom');
  if (!tbody) return console.warn('tbody #lista-cupom não encontrado');
  tbody.innerHTML = '';

  try {
    const snap = await db.collection('cupons').get();
    snap.forEach(doc => {
      const d = doc.data() || {};
      const expiraFmt = d.expira_em ? d.expira_em.toDate().toLocaleDateString('pt-BR') : '';
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${escapeHtml(d.codigo || '')}</td>
        <td>${escapeHtml(d.tipo || '')}</td>
        <td style="text-align:right">${d.valor !== undefined ? d.valor : ''}</td>
        <td style="text-align:center">${escapeHtml(d.status || '--')}</td>
        <td style="text-align:center">${expiraFmt}</td>
        <td style="text-align:center">
          <span class="icon-btn" title="Editar" onclick="abrirModalCupom('${doc.id}', true)">✏️</span>
          <span class="icon-btn" title="Excluir" onclick="confirmarExclusaoCupom('${doc.id}','${(d.codigo || '').replace(/'/g, "\\'")}')">🗑️</span>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    mostrarMensagem('Erro ao carregar cupons.');
  }
}

function confirmarExclusaoCupom(id, codigo) {
  abrirConfirmacao(`Deseja excluir o cupom "${codigo}"?`, async () => {
    try {
      await db.collection('cupons').doc(id).delete();
      await carregarCupons();
      mostrarMensagem('Cupom excluído.');
    } catch (err) {
      console.error('Erro ao excluir cupom:', err);
      mostrarMensagem('Erro ao excluir cupom. Veja console.');
    }
  });
}

/* ======================
   MODAL CUPONS (Novo / Editar)
   ====================== */
async function abrirModalCupom(id, editar = false) {
  const body = document.getElementById('modal-edit-body');
  if (!body) return console.warn('modal-edit-body não encontrado');
  body.innerHTML = '';
  document.getElementById('modal-edit-title').innerText = editar ? 'Editar Cupom' : 'Novo Cupom';
  document.getElementById('modal-edit-save').style.display = 'inline-block';

  // dados iniciais
  let dados = {
    codigo: '',
    tipo: 'percentual',
    valor: '',
    status: 'ativo',
    expira_em: null
  };

  if (editar) {
    try {
      const doc = await db.collection('cupons').doc(id).get();
      if (doc.exists) dados = Object.assign(dados, doc.data());
    } catch (err) {
      console.error('Erro ao carregar cupom para edição:', err);
      mostrarMensagem && mostrarMensagem('Erro ao carregar cupom. Veja console.');
      return;
    }
  }

  // campos básicos
  body.appendChild(generateTextField('codigo', dados.codigo || ''));
  const errCodigo = document.createElement('span');
  errCodigo.id = 'error-codigo';
  errCodigo.className = 'field-error';
  errCodigo.style.display = 'none';
  errCodigo.style.color = '#b00020';
  errCodigo.style.fontSize = '12px';
  errCodigo.style.marginTop = '4px';
  body.appendChild(errCodigo);

  body.appendChild(generateDomainSelect('tipo', ['percentual', 'fixo'], dados.tipo || 'percentual'));
  body.appendChild(generateTextField('valor', dados.valor !== undefined && dados.valor !== null ? String(dados.valor) : ''));
  body.appendChild(generateDomainSelect('status', ['ativo', 'inativo'], dados.status || 'ativo'));

  // campo data
  const wrapData = document.createElement('div');
  wrapData.style.marginTop = '8px';

  // label
  const labelData = document.createElement('label');
  labelData.htmlFor = 'field-expira_em';
  labelData.textContent = 'Expira em';
  labelData.style.display = 'block';
  labelData.style.fontSize = '13px';
  labelData.style.color = '#333';
  labelData.style.marginBottom = '4px';

  // input date
  const inputData = document.createElement('input');
  inputData.type = 'date';
  inputData.dataset.fieldName = 'expira_em';
  inputData.id = 'field-expira_em';
  inputData.style.padding = '6px 8px';
  inputData.style.border = '1px solid #ccc';
  inputData.style.borderRadius = '4px';
  inputData.style.fontSize = '14px';

  if (dados && dados.expira_em) {
    const d = dados.expira_em.toDate(); // Date em timezone local
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    inputData.value = `${yyyy}-${mm}-${dd}`;
  }

  // montar
  wrapData.appendChild(labelData);
  wrapData.appendChild(inputData);
  body.appendChild(wrapData);

  // abrir modal
  openModal && openModal('modal-edit-overlay');

  // salvar handler
  document.getElementById('modal-edit-save').onclick = async () => {
    try {
      clearFieldErrors && clearFieldErrors();

      const fields = body.querySelectorAll('[data-field-name]');
      let data = {};
      fields.forEach(f => data[f.dataset.fieldName] = f.value);

      // validações simples
      let errors = {};
      if (!data.codigo || String(data.codigo).trim() === '') {
        errors.codigo = 'Código é obrigatório.';
      }
      if (!data.valor || isNaN(Number(data.valor))) {
        errors.valor = 'Valor inválido.';
      }

      if (Object.keys(errors).length) {
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

      // normalizações
      data.valor = Number(data.valor); 
      
      if (data.expira_em) { 
          // espera-se que data.expira_em seja "YYYY-MM-DD" vindo do input[type=date] 
          const parts = String(data.expira_em).split('-').map(n => Number(n)); 
          if (parts.length === 3 && parts.every(n => !isNaN(n))) { 
              const [y, m, d] = parts; 
              const localMidnight = new Date(y, m - 1, d); // cria meia-noite no fuso local 
              data.expira_em = firebase.firestore.Timestamp.fromDate(localMidnight); 
          } else { 
            // fallback: se não for o formato esperado, remove o campo ou trate como null 
            data.expira_em = null; 
          } 
        } else { 
          data.expira_em = null; 
        }

      data.status = data.status || 'ativo';
      data.tipo = data.tipo || 'percentual';

      if (editar) {
        await db.collection('cupons').doc(id).update(data);
        mostrarMensagem && mostrarMensagem('Cupom atualizado.');
      } else {
        await db.collection('cupons').add(data);
        mostrarMensagem && mostrarMensagem('Cupom criado.');
      }

      closeModal && closeModal('modal-edit-overlay');
      await carregarCupons();
    } catch (err) {
      console.error('Erro ao salvar cupom:', err);
      mostrarMensagem && mostrarMensagem('Erro ao salvar cupom. Veja console.');
    }
  };
}

/* escape simples */
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, function (m) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
  });
}

function filtrarCupons() {
  const filtro = document.getElementById('busca-cupom').value.toLowerCase();
  document.querySelectorAll('#lista-cupom tr').forEach(tr => {
    tr.style.display = tr.innerText.toLowerCase().includes(filtro) ? '' : 'none';
  });
}

window._cuponsAdmin = { carregarCupons, abrirModalCupom, confirmarExclusaoCupom };
