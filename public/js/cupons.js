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
      const expiraFmt = d.expira_em ? d.expira_em.toDate().toLocaleDateString('pt-BR') : '—';
      const maxUsos = d.max_usos || 0;
      const usosFmt = maxUsos > 0 ? `${d.usos_atuais || 0} / ${maxUsos}` : `${d.usos_atuais || 0} / ∞`;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(d.codigo || '')}</td>
        <td>${escapeHtml(d.tipo || '')}</td>
        <td style="text-align:right">${d.valor !== undefined ? d.valor : ''}</td>
        <td style="text-align:center">${escapeHtml(d.status || '--')}</td>
        <td style="text-align:center">${expiraFmt}</td>
        <td style="text-align:center">${usosFmt}</td>
        <td style="text-align:center">
          <span class="icon-btn" title="Editar" onclick="abrirModalCupom('${doc.id}', true)">✏️</span>
          <span class="icon-btn" title="Excluir" onclick="confirmarExclusaoCupom('${doc.id}','${(d.codigo || '').replace(/'/g, "\\'")}')">🗑️</span>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Erro ao carregar cupons:', err);
    mostrarMensagem('Erro ao carregar cupons.');
  }
}

function confirmarExclusaoCupom(id, codigo) {
  if (typeof abrirConfirmacao === 'function') {
    abrirConfirmacao(`Deseja excluir o cupom "${codigo}"?`, async () => {
      try {
        await db.collection('cupons').doc(id).delete();
        await carregarCupons();
        mostrarMensagem('Cupom excluído.');
      } catch (err) {
        console.error('Erro ao excluir cupom:', err);
        mostrarMensagem('Erro ao excluir cupom.');
      }
    });
  } else {
    if (!confirm(`Deseja excluir o cupom "${codigo}"?`)) return;
    try {
      await db.collection('cupons').doc(id).delete();
      await carregarCupons();
      mostrarMensagem('Cupom excluído.');
    } catch (err) { mostrarMensagem('Erro ao excluir cupom.'); }
  }
}

async function abrirModalCupom(id, editar = false) {
  const body = document.getElementById('modal-edit-body');
  if (!body) return console.warn('modal-edit-body não encontrado');
  body.innerHTML = '';
  document.getElementById('modal-edit-title').innerText = editar ? 'Editar Cupom' : 'Novo Cupom';
  document.getElementById('modal-edit-save').style.display = 'inline-block';

  let dados = { codigo: '', tipo: 'percentual', valor: '', status: 'ativo', expira_em: null, max_usos: 0 };
  if (editar) {
    try {
      const doc = await db.collection('cupons').doc(id).get();
      if (doc.exists) dados = Object.assign(dados, doc.data());
    } catch (err) {
      console.error('Erro ao carregar cupom:', err);
      mostrarMensagem?.('Erro ao carregar cupom.');
      return;
    }
  }

  body.appendChild(generateTextField('codigo', dados.codigo || ''));
  const errCodigo = document.createElement('span');
  errCodigo.id = 'error-codigo'; errCodigo.className = 'field-error';
  errCodigo.style.cssText = 'display:none;color:#b00020;font-size:12px;margin-top:4px;';
  body.appendChild(errCodigo);

  body.appendChild(generateDomainSelect('tipo', ['percentual', 'fixo'], dados.tipo || 'percentual'));
  body.appendChild(generateTextField('valor', dados.valor != null ? String(dados.valor) : ''));
  body.appendChild(generateDomainSelect('status', ['ativo', 'inativo'], dados.status || 'ativo'));

  // CAMPO: Limite de usos
  const wrapLimite = document.createElement('div'); wrapLimite.style.marginTop = '8px';
  wrapLimite.innerHTML = `
    <label style="display:block;font-size:13px;color:#333;margin-bottom:4px;">Limite de usos (0 ou vazio = ilimitado)</label>
    <div style="display:flex;gap:8px;align-items:center;">
      <input type="number" id="field-max_usos" value="${dados.max_usos || ''}" style="flex:1;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:14px;">
      <label style="font-size:12px;cursor:pointer;">
        <input type="checkbox" id="chk-ilimitado" ${!dados.max_usos ? 'checked' : ''}> Ilimitado
      </label>
    </div>`;
  body.appendChild(wrapLimite);

  const chkIlimitado = document.getElementById('chk-ilimitado');
  const inputMaxUsos = document.getElementById('field-max_usos');

  chkIlimitado.addEventListener('change', (e) => {
    inputMaxUsos.disabled = e.target.checked;
    if (e.target.checked) inputMaxUsos.value = '';
  });
  if (!dados.max_usos) inputMaxUsos.disabled = true;

  // CAMPO: Data de expiração
  const wrapData = document.createElement('div'); wrapData.style.marginTop = '8px';
  const labelData = document.createElement('label');
  labelData.htmlFor = 'field-expira_em'; labelData.textContent = 'Expira em';
  labelData.style.cssText = 'display:block;font-size:13px;color:#333;margin-bottom:4px;';
  const inputData = document.createElement('input');
  inputData.type = 'date'; inputData.dataset.fieldName = 'expira_em'; inputData.id = 'field-expira_em';
  inputData.style.cssText = 'padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:14px;width:100%;';
  if (dados?.expira_em) {
    const d = dados.expira_em.toDate();
    inputData.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  wrapData.appendChild(labelData); wrapData.appendChild(inputData); body.appendChild(wrapData);

  if (typeof openModal === 'function') openModal('modal-edit-overlay');

  // HANDLER DE SALVAMENTO
  document.getElementById('modal-edit-save').onclick = async () => {
    try {
      if (typeof clearFieldErrors === 'function') clearFieldErrors();

      const fields = body.querySelectorAll('[data-field-name]');
      let data = {};
      fields.forEach(f => data[f.dataset.fieldName] = f.value);

      // 🔍 CORREÇÃO CRÍTICA: Ler max_usos diretamente do DOM
/*       const ilimitado = document.getElementById('chk-ilimitado')?.checked;
      const rawMaxUsos = document.getElementById('field-max_usos')?.value || '';
      data.max_usos = ilimitado ? 0 : (Number(rawMaxUsos) || 0); */

      // Validações
      let errors = {};
      if (!data.codigo?.trim()) errors.codigo = 'Código é obrigatório.';
      if (!data.valor || isNaN(Number(data.valor))) errors.valor = 'Valor inválido.';

      if (Object.keys(errors).length) {
        if (typeof showFieldErrors === 'function') showFieldErrors(errors);
        else {
          Object.keys(errors).forEach(f => {
            const sp = document.getElementById(`error-${f}`);
            if (sp) { sp.textContent = errors[f]; sp.style.display = 'block'; }
          });
        }
        return;
      }

      data.valor = Number(data.valor);
      data.status = data.status || 'ativo';
      data.tipo = data.tipo || 'percentual';

      // Normaliza data
      if (data.expira_em) {
        const parts = String(data.expira_em).split('-').map(n => Number(n));
        if (parts.length === 3 && parts.every(n => !isNaN(n))) {
          const [y, m, d] = parts;
          const localMidnight = new Date(y, m - 1, d);
          data.expira_em = firebase.firestore.Timestamp.fromDate(localMidnight);
        } else {
          data.expira_em = null;
        }
      } else {
        data.expira_em = null;
      }

      if (!editar) data.usos_atuais = 0;

      if (editar) {
        await db.collection('cupons').doc(id).update(data);
        mostrarMensagem?.('Cupom atualizado.');
      } else {
        await db.collection('cupons').add(data);
        mostrarMensagem?.('Cupom criado.');
      }
      closeModal?.('modal-edit-overlay');
      await carregarCupons();
    } catch (err) {
      console.error('Erro ao salvar cupom:', err);
      mostrarMensagem?.('Erro ao salvar cupom.');
    }
  };
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

function filtrarCupons() {
  const filtro = document.getElementById('busca-cupom')?.value.toLowerCase() || '';
  document.querySelectorAll('#lista-cupom tr').forEach(tr => {
    tr.style.display = tr.innerText.toLowerCase().includes(filtro) ? '' : 'none';
  });
}

// 🔒 Exportação global (só executa se não houver SyntaxError)
window.carregarCupons = carregarCupons;
window.abrirModalCupom = abrirModalCupom;
window.confirmarExclusaoCupom = confirmarExclusaoCupom;
window.filtrarCupons = filtrarCupons;
window._cuponsAdmin = { carregarCupons, abrirModalCupom, confirmarExclusaoCupom };