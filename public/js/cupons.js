/* cupons.js - CRUD compatível com admin.html
   Requisitos: window.db (Firestore) já inicializado; modal HTML com ids:
   modal-edit-overlay, modal-edit-body, modal-edit-title, modal-edit-save.

   Campos adicionados (suporte a cupons multi-usuário):
   - plano_id            : ID do plano ao qual o cupom é restrito
   - municipios_plano_master : array [{cod_municipio, nome, uf}] herdado pelos usuários do cupom
   - assinante_master_uid: UID do assinante master que originou o cupom (opcional, para rastreio)
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
      const planoFmt = d.plano_id ? escapeHtml(d.plano_id) : '<span style="color:#94a3b8">—</span>';
      const masterMuns = Array.isArray(d.municipios_plano_master) ? d.municipios_plano_master : [];
      const masterFmt = masterMuns.length > 0
        ? `<span title="${escapeHtml(masterMuns.map(m => m.nome || m.cod_municipio).join(', '))}" style="cursor:help">${masterMuns.length} mun.</span>`
        : '<span style="color:#94a3b8">—</span>';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(d.codigo || '')}</td>
        <td>${escapeHtml(d.tipo || '')}</td>
        <td style="text-align:right">${d.valor !== undefined ? d.valor : ''}</td>
        <td style="text-align:center">${escapeHtml(d.status || '--')}</td>
        <td style="text-align:center">${expiraFmt}</td>
        <td style="text-align:center">${usosFmt}</td>
        <td style="text-align:center">${planoFmt}</td>
        <td style="text-align:center">${masterFmt}</td>
        <td style="text-align:center">
          <span class="icon-btn" title="Editar" onclick="abrirModalCupom('${doc.id}', true)">✏️</span>
          <span class="icon-btn" title="Ver assinantes" onclick="_verAssinantesCupom('${escapeHtml(d.codigo || '')}')">👥</span>
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

  let dados = { codigo: '', tipo: 'percentual', valor: '', status: 'ativo', expira_em: null, max_usos: 0, plano_id: '', municipios_plano_master: [], assinante_master_uid: '' };
  if (editar) {
    try {
      const doc = await db.collection('cupons').doc(id).get();
      if (doc.exists) dados = Object.assign(dados, doc.data());
    } catch (err) {
      console.error('Erro ao carregar cupom para edição:', err);
      mostrarMensagem && mostrarMensagem('Erro ao carregar cupom.');
      return;
    }
  }

  body.appendChild(generateTextField('codigo', dados.codigo || ''));
  const errCodigo = document.createElement('span'); errCodigo.id = 'error-codigo'; errCodigo.className = 'field-error'; errCodigo.style.display = 'none'; errCodigo.style.color = '#b00020'; errCodigo.style.fontSize = '12px'; errCodigo.style.marginTop = '4px'; body.appendChild(errCodigo);
  body.appendChild(generateDomainSelect('tipo', ['percentual', 'fixo'], dados.tipo || 'percentual'));
  body.appendChild(generateTextField('valor', dados.valor !== undefined && dados.valor !== null ? String(dados.valor) : ''));
  body.appendChild(generateDomainSelect('status', ['ativo', 'inativo'], dados.status || 'ativo'));

  // CAMPO: Plano vinculado
  const wrapPlano = document.createElement('div'); wrapPlano.style.marginTop = '8px';
  const labelPlano = document.createElement('label'); labelPlano.textContent = 'Plano vinculado (obrigatório para cupons de gratuidade)'; labelPlano.style.cssText = 'display:block;font-size:13px;color:#333;margin-bottom:4px;';
  const selectPlano = document.createElement('select'); selectPlano.id = 'field-plano_id'; selectPlano.dataset.fieldName = 'plano_id'; selectPlano.style.cssText = 'width:100%;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:14px;';
  const optNenhum = document.createElement('option'); optNenhum.value = ''; optNenhum.textContent = '— Nenhum (cupom universal) —'; selectPlano.appendChild(optNenhum);
  try {
    const planosSnap = await db.collection('planos').get();
    planosSnap.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.data().nome || p.id;
      if (dados.plano_id === p.id) opt.selected = true;
      selectPlano.appendChild(opt);
    });
  } catch (e) { console.warn('Não foi possível carregar planos:', e); }
  wrapPlano.appendChild(labelPlano); wrapPlano.appendChild(selectPlano); body.appendChild(wrapPlano);

  // CAMPO: UID do assinante master
  const wrapMaster = document.createElement('div'); wrapMaster.style.marginTop = '8px';
  const labelMaster = document.createElement('label'); labelMaster.textContent = 'UID do assinante master (opcional)'; labelMaster.style.cssText = 'display:block;font-size:13px;color:#333;margin-bottom:4px;';
  const inputMaster = document.createElement('input'); inputMaster.type = 'text'; inputMaster.id = 'field-assinante_master_uid'; inputMaster.dataset.fieldName = 'assinante_master_uid'; inputMaster.value = dados.assinante_master_uid || ''; inputMaster.placeholder = 'UID do usuário master no Firestore'; inputMaster.style.cssText = 'width:100%;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;';
  wrapMaster.appendChild(labelMaster); wrapMaster.appendChild(inputMaster); body.appendChild(wrapMaster);

  // CAMPO: Municípios herdados (municipios_plano_master) — JSON editável
  const wrapMuns = document.createElement('div'); wrapMuns.style.marginTop = '8px';
  const labelMuns = document.createElement('label'); labelMuns.textContent = 'Municípios extras herdados pelos usuários do cupom (JSON)'; labelMuns.style.cssText = 'display:block;font-size:13px;color:#333;margin-bottom:4px;';
  const hintMuns = document.createElement('span'); hintMuns.style.cssText = 'display:block;font-size:11px;color:#64748b;margin-bottom:4px;'; hintMuns.textContent = 'Formato: [{"cod_municipio":"355030","nome":"São Paulo","uf":"SP"}] — índice [0] é preenchido pelo próprio usuário ao assinar';
  const areaMuns = document.createElement('textarea'); areaMuns.id = 'field-municipios_plano_master_raw'; areaMuns.rows = 4; areaMuns.style.cssText = 'width:100%;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;font-family:monospace;box-sizing:border-box;resize:vertical;';
  const munsVal = Array.isArray(dados.municipios_plano_master) && dados.municipios_plano_master.length > 0 ? JSON.stringify(dados.municipios_plano_master, null, 2) : '[]';
  areaMuns.value = munsVal;
  const errMuns = document.createElement('span'); errMuns.id = 'error-municipios_plano_master'; errMuns.style.cssText = 'display:none;color:#b00020;font-size:12px;margin-top:4px;';
  wrapMuns.appendChild(labelMuns); wrapMuns.appendChild(hintMuns); wrapMuns.appendChild(areaMuns); wrapMuns.appendChild(errMuns); body.appendChild(wrapMuns);

  // CAMPO: Limite de usos
  const wrapLimite = document.createElement('div'); wrapLimite.style.marginTop = '8px';
  wrapLimite.innerHTML = `
    <label style="display:block;font-size:13px;color:#333;margin-bottom:4px;">Limite de usos (0 ou vazio = ilimitado)</label>
    <div style="display:flex;gap:8px;align-items:center;">
      <input type="number" id="field-max_usos" value="${dados.max_usos || ''}" style="flex:1;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:14px;">
      <label style="font-size:12px;cursor:pointer;"><input type="checkbox" id="chk-ilimitado" ${!dados.max_usos ? 'checked' : ''}> Ilimitado</label>
    </div>`;
  body.appendChild(wrapLimite);
  document.getElementById('chk-ilimitado').addEventListener('change', (e) => {
    const inp = document.getElementById('field-max_usos');
    inp.disabled = e.target.checked;
    if (e.target.checked) inp.value = '';
  });
  if (!dados.max_usos) document.getElementById('field-max_usos').disabled = true;

  // CAMPO: Data de expiração
  const wrapData = document.createElement('div'); wrapData.style.marginTop = '8px';
  const labelData = document.createElement('label'); labelData.htmlFor = 'field-expira_em'; labelData.textContent = 'Expira em'; labelData.style.display = 'block'; labelData.style.fontSize = '13px'; labelData.style.color = '#333'; labelData.style.marginBottom = '4px';
  const inputData = document.createElement('input'); inputData.type = 'date'; inputData.dataset.fieldName = 'expira_em'; inputData.id = 'field-expira_em'; inputData.style.padding = '6px 8px'; inputData.style.border = '1px solid #ccc'; inputData.style.borderRadius = '4px'; inputData.style.fontSize = '14px';
  if (dados && dados.expira_em) {
    const d = dados.expira_em.toDate();
    inputData.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  wrapData.appendChild(labelData); wrapData.appendChild(inputData); body.appendChild(wrapData);

  openModal && openModal('modal-edit-overlay');

  // Botão "Ver assinantes" — visível apenas no modo editar
  const btnVerAss = document.getElementById('btn-ver-assinantes-cupom');
  if (btnVerAss) {
    btnVerAss.style.display = editar ? 'inline-block' : 'none';
    btnVerAss.onclick = () => _verAssinantesCupom(dados.codigo || '');
  }

  document.getElementById('modal-edit-save').onclick = async () => {
    try {
      clearFieldErrors && clearFieldErrors();
          
      // 1. Coleta APENAS campos com data-field-name (evita criar a chave "field-max_usos")
      const fields = body.querySelectorAll('[data-field-name]');
      let data = {};
      fields.forEach(f => data[f.dataset.fieldName] = f.value);

      // 2. Lê max_usos diretamente do DOM (sem duplicar variáveis)
      const isIlimitado = document.getElementById('chk-ilimitado')?.checked;
      const valMaxUsos  = document.getElementById('field-max_usos')?.value.trim() || '0';
      data.max_usos = isIlimitado ? 0 : (Number(valMaxUsos) || 0);

      // 3. Processa municipios_plano_master (JSON textarea — NÃO tem data-field-name)
      let municipiosMaster = [];
      const rawMuns = document.getElementById('field-municipios_plano_master_raw')?.value.trim() || '[]';
      try {
        const parsed = JSON.parse(rawMuns);
        if (!Array.isArray(parsed)) throw new Error('Deve ser um array JSON.');
        municipiosMaster = parsed;
        const errEl = document.getElementById('error-municipios_plano_master');
        if (errEl) errEl.style.display = 'none';
      } catch (jsonErr) {
        const errEl = document.getElementById('error-municipios_plano_master');
        if (errEl) { errEl.textContent = 'JSON inválido: ' + jsonErr.message; errEl.style.display = 'block'; }
        return;
      }
      data.municipios_plano_master = municipiosMaster;

      // 4. plano_id e assinante_master_uid já foram coletados pelo loop acima (têm data-field-name)
      data.plano_id = data.plano_id || '';
      data.assinante_master_uid = data.assinante_master_uid || '';

      let errors = {};
      if (!data.codigo || String(data.codigo).trim() === '') errors.codigo = 'Código é obrigatório.';
      if (!data.valor || isNaN(Number(data.valor))) errors.valor = 'Valor inválido.';
      // Valida: se tipo=percentual e valor=100, plano_id é obrigatório (cupom de gratuidade)
      if (Number(data.valor) === 100 && data.tipo === 'percentual' && !data.plano_id) {
        errors.plano_id = 'Cupons de 100% devem ter um plano vinculado.';
      }
      if (Object.keys(errors).length) {
        if (showFieldErrors) showFieldErrors(errors);
        else { Object.keys(errors).forEach(f => { const sp = document.getElementById(`error-${f}`); if (sp) { sp.textContent = errors[f]; sp.style.display = 'block'; } }); }
        return;
      }

      data.valor = Number(data.valor);
      const ilimitado = document.getElementById('chk-ilimitado')?.checked;
      data.max_usos = ilimitado ? 0 : (Number(data.max_usos) || 0);

      if (data.expira_em) {
        const parts = String(data.expira_em).split('-').map(n => Number(n));
        if (parts.length === 3 && parts.every(n => !isNaN(n))) {
          const [y, m, d] = parts;
          const localMidnight = new Date(y, m - 1, d);
          data.expira_em = firebase.firestore.Timestamp.fromDate(localMidnight);
        } else { data.expira_em = null; }
      } else { data.expira_em = null; }

      data.status = data.status || 'ativo';
      data.tipo = data.tipo || 'percentual';

      // Inicializa usos_atuais em 0 se for criação
      if (!editar) data.usos_atuais = 0;

      if (editar) { await db.collection('cupons').doc(id).update(data); mostrarMensagem && mostrarMensagem('Cupom atualizado.'); }
      else { await db.collection('cupons').add(data); mostrarMensagem && mostrarMensagem('Cupom criado.'); }
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

/* ======================
   VER ASSINANTES DO CUPOM
   Usa collectionGroup query em 'assinaturas' filtrando por cupom_utilizado.
   Requer índice no Firestore:
   { collectionGroup: "assinaturas", fields: [{ fieldPath: "cupom_utilizado", order: "ASCENDING" }] }
   ====================== */
async function _verAssinantesCupom(codigoCupom) {
  if (!codigoCupom) return mostrarMensagem && mostrarMensagem('Código do cupom não informado.');

  // Reutiliza modal-edit-overlay como painel de visualização (somente leitura)
  const body = document.getElementById('modal-edit-body');
  const title = document.getElementById('modal-edit-title');
  const btnSave = document.getElementById('modal-edit-save');
  if (!body) return;

  title.innerText = `Assinantes do cupom: ${codigoCupom}`;
  if (btnSave) btnSave.style.display = 'none';
  body.innerHTML = '<p style="color:#64748b;font-size:13px;">Buscando assinantes...</p>';
  openModal && openModal('modal-edit-overlay');

  try {
    const snap = await db.collectionGroup('assinaturas')
      .where('cupom_utilizado', '==', codigoCupom)
      .get();

    if (snap.empty) {
      body.innerHTML = '<p style="color:#64748b;font-size:13px;">Nenhum assinante encontrado para este cupom.</p>';
      return;
    }

    const tabela = document.createElement('div'); tabela.style.overflowX = 'auto';
    tabela.innerHTML = `
      <p style="font-size:12px;color:#64748b;margin-bottom:8px;">${snap.size} assinante(s) encontrado(s)</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">Nome</th>
            <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">E-mail</th>
            <th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">Município principal</th>
            <th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e2e8f0;">Plano</th>
            <th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e2e8f0;">Status</th>
            <th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e2e8f0;">Criado em</th>
          </tr>
        </thead>
        <tbody id="tbody-assinantes-cupom"></tbody>
      </table>`;
    body.innerHTML = '';
    body.appendChild(tabela);

    const tbody = document.getElementById('tbody-assinantes-cupom');
    snap.forEach(doc => {
      const d = doc.data() || {};
      const munPrincipal = Array.isArray(d.municipios_plano) && d.municipios_plano[0]
        ? escapeHtml(d.municipios_plano[0].nome || d.municipios_plano[0].cod_municipio || '—')
        : '—';
      const criadoEm = d.criado_em ? d.criado_em.toDate().toLocaleDateString('pt-BR') : '—';
      const statusColor = d.status === 'ativo' ? '#16a34a' : '#dc2626';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">${escapeHtml(d.nome || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">${escapeHtml(d.email || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;">${munPrincipal}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:center;">${escapeHtml(d.plano_id || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:center;color:${statusColor};font-weight:600;">${escapeHtml(d.status || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:center;">${criadoEm}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Erro ao buscar assinantes do cupom:', err);
    body.innerHTML = `<p style="color:#dc2626;font-size:13px;">Erro ao buscar assinantes. Verifique se o índice collectionGroup em <strong>assinaturas.cupom_utilizado</strong> foi criado no Firestore.</p>`;
  }
}

window._cuponsAdmin = { carregarCupons, abrirModalCupom, confirmarExclusaoCupom, _verAssinantesCupom };