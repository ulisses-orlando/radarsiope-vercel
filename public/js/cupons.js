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
      const planoFmt = d.plano_id
        ? `${escapeHtml(d.plano_id)}${d.ciclo_cupom ? ` <span style="font-size:11px;color:#64748b;">(${{ '1': 'Mensal', '3': 'Trim.', '6': 'Sem.', '12': 'Anual' }[d.ciclo_cupom] || d.ciclo_cupom})</span>` : ''}`
        : '<span style="color:#94a3b8">—</span>';
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

  let dados = { codigo: '', tipo: 'percentual', valor: '', status: 'ativo', expira_em: null, max_usos: 0, plano_id: '', ciclo_cupom: '', municipios_plano_master: [], assinante_master_uid: '' };
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

  // ── CAMPO: Plano vinculado + Ciclo ───────────────────────────────────────────
  // plano_id e ciclo_cupom gravados separadamente; ciclo_cupom é o ciclo em meses (1,3,6,12)
  const _CICLOS = [
    { value: '1',  label: 'Mensal (1 mês)' },
    { value: '3',  label: 'Trimestral (3 meses)' },
    { value: '6',  label: 'Semestral (6 meses)' },
    { value: '12', label: 'Anual (12 meses)' },
  ];

  const wrapPlano = document.createElement('div'); wrapPlano.style.marginTop = '8px';
  wrapPlano.innerHTML = `
    <label style="display:block;font-size:13px;color:#333;margin-bottom:4px;">
      Plano vinculado <span style="color:#64748b;font-size:11px;">(obrigatório para cupons de gratuidade)</span>
    </label>
    <div style="display:flex;gap:8px;">
      <select id="field-plano_id" data-field-name="plano_id"
        style="flex:2;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:14px;">
        <option value="">— Nenhum (cupom universal) —</option>
      </select>
      <select id="field-ciclo_cupom" data-field-name="ciclo_cupom"
        style="flex:1;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:14px;">
        <option value="">— Qualquer ciclo —</option>
        ${_CICLOS.map(c => `<option value="${c.value}"${String(dados.ciclo_cupom || '') === c.value ? ' selected' : ''}>${c.label}</option>`).join('')}
      </select>
    </div>
    <span id="error-plano_id" style="display:none;color:#b00020;font-size:12px;margin-top:4px;"></span>`;
  body.appendChild(wrapPlano);
  // Popula planos de forma assíncrona
  try {
    const planosSnap = await db.collection('planos').get();
    const selPlano = document.getElementById('field-plano_id');
    planosSnap.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.data().nome || p.id;
      if (dados.plano_id === p.id) opt.selected = true;
      selPlano.appendChild(opt);
    });
  } catch (e) { console.warn('Não foi possível carregar planos:', e); }

  // ── CAMPO: Assinante master — busca por nome ──────────────────────────────────
  // O admin digita parte do nome, o campo busca em usuarios e preenche uid + painel de dados.
  const wrapMaster = document.createElement('div'); wrapMaster.style.marginTop = '12px';
  wrapMaster.innerHTML = `
    <label style="display:block;font-size:13px;color:#333;margin-bottom:4px;">
      Assinante master <span style="color:#64748b;font-size:11px;">(busque pelo nome ou e-mail)</span>
    </label>
    <div style="display:flex;gap:6px;align-items:center;">
      <input type="text" id="input-master-busca" placeholder="Digite nome ou e-mail..."
        style="flex:1;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px;box-sizing:border-box;">
      <button type="button" id="btn-buscar-master"
        style="padding:6px 12px;background:#0A3D62;color:#fff;border:none;border-radius:4px;font-size:13px;cursor:pointer;white-space:nowrap;">
        🔍 Buscar
      </button>
    </div>
    <!-- Campo oculto com data-field-name para ser coletado no save -->
    <input type="hidden" id="field-assinante_master_uid" data-field-name="assinante_master_uid" value="${escapeHtml(dados.assinante_master_uid || '')}">
    <!-- Resultados da busca -->
    <div id="master-resultados" style="display:none;margin-top:6px;border:1px solid #e2e8f0;border-radius:6px;max-height:180px;overflow-y:auto;background:#fff;"></div>
    <!-- Painel do master selecionado -->
    <div id="master-painel" style="display:none;margin-top:8px;padding:10px 12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;font-size:12px;color:#0c4a6e;"></div>`;
  body.appendChild(wrapMaster);

  // Função interna: renderiza painel do master selecionado e preenche municípios
  async function _selecionarMaster(uid, nomeExibicao) {
    document.getElementById('field-assinante_master_uid').value = uid;
    document.getElementById('master-resultados').style.display = 'none';
    document.getElementById('input-master-busca').value = nomeExibicao;

    const painel = document.getElementById('master-painel');
    painel.style.display = 'block';
    painel.innerHTML = '<span style="color:#64748b;">Carregando dados do master...</span>';

    try {
      // Busca assinatura ativa do master
      const assSnap = await db.collection('usuarios').doc(uid).collection('assinaturas')
        .where('status', 'in', ['ativa', 'aprovada']).limit(1).get();

      if (assSnap.empty) {
        painel.innerHTML = `<strong>${escapeHtml(nomeExibicao)}</strong> — <span style="color:#dc2626;">Nenhuma assinatura ativa encontrada.</span>`;
        return;
      }

      const ass = assSnap.docs[0].data();
      const inicioFmt = ass.data_inicio ? ass.data_inicio.toDate().toLocaleDateString('pt-BR') : '—';
      const vencFmt   = ass.data_proxima_renovacao ? ass.data_proxima_renovacao.toDate().toLocaleDateString('pt-BR') : '—';
      const munsMaster = Array.isArray(ass.municipios_plano) ? ass.municipios_plano : [];
      // [0] é o município do próprio master — os extras que os usuários do cupom herdam
      // são todos os municípios da assinatura do master (índices 0..n), pois cada usuário
      // do cupom terá seu próprio [0]. Passamos o array completo como referência.
      const extrasHerdar = munsMaster; // será filtrado no assinatura.js para excluir [0] do novo usuário

      painel.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:8px 16px;">
          <span>👤 <strong>${escapeHtml(nomeExibicao)}</strong></span>
          <span>📋 Plano: <strong>${escapeHtml(ass.plano_nome || ass.plano_slug || ass.planId || '—')}</strong></span>
          <span>📅 Início: <strong>${inicioFmt}</strong></span>
          <span>⏳ Vencimento: <strong>${vencFmt}</strong></span>
          <span>🏙️ Municípios: <strong>${munsMaster.length}</strong>
            ${munsMaster.length > 0 ? `<span style="color:#64748b;">(${munsMaster.map(m => m.nome || m.cod_municipio).join(', ')})</span>` : ''}
          </span>
        </div>
        <div style="margin-top:6px;padding:4px 8px;background:#e0f2fe;border-radius:4px;font-size:11px;color:#0369a1;">
          ✅ Municípios herdados preenchidos automaticamente abaixo
        </div>`;

      // Preenche automaticamente o textarea de municípios herdados
      const areaMunsEl = document.getElementById('field-municipios_plano_master_raw');
      if (areaMunsEl && extrasHerdar.length > 0) {
        areaMunsEl.value = JSON.stringify(extrasHerdar.map(m => ({
          cod_municipio: String(m.cod_municipio || '').slice(0, 6),
          nome: m.nome || '',
          uf: m.uf || '',
        })), null, 2);
        // Destaca visualmente que foi preenchido automaticamente
        areaMunsEl.style.borderColor = '#0ea5e9';
        areaMunsEl.style.background = '#f0f9ff';
        setTimeout(() => { areaMunsEl.style.borderColor = '#ccc'; areaMunsEl.style.background = ''; }, 3000);
      }
    } catch (err) {
      console.error('[cupom-master] Erro ao carregar assinatura:', err);
      painel.innerHTML = `<span style="color:#dc2626;">Erro ao carregar dados do master.</span>`;
    }
  }

  // Se já há UID salvo, carrega painel automaticamente ao abrir o modal
  if (dados.assinante_master_uid) {
    try {
      const uDoc = await db.collection('usuarios').doc(dados.assinante_master_uid).get();
      if (uDoc.exists) {
        const uData = uDoc.data();
        const nomeExib = uData.nome || uData.email || dados.assinante_master_uid;
        document.getElementById('input-master-busca').value = nomeExib;
        _selecionarMaster(dados.assinante_master_uid, nomeExib);
      }
    } catch (e) { console.warn('[cupom-master] Erro ao recarregar master salvo:', e); }
  }

  // Lógica de busca: por nome ou e-mail
  document.getElementById('btn-buscar-master').addEventListener('click', async () => {
    const termo = document.getElementById('input-master-busca').value.trim().toLowerCase();
    const resultDiv = document.getElementById('master-resultados');
    if (!termo || termo.length < 2) { mostrarMensagem && mostrarMensagem('Digite pelo menos 2 caracteres para buscar.'); return; }

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:#64748b;">Buscando...</div>';

    try {
      // Busca por nome (range query) e por e-mail (equality)
      const [snapNome, snapEmail] = await Promise.all([
        db.collection('usuarios')
          .orderBy('nome').startAt(termo).endAt(termo + '\uf8ff').limit(8).get(),
        db.collection('usuarios')
          .where('email', '==', termo).limit(3).get(),
      ]);

      // Deduplica resultados
      const vistos = new Set();
      const resultados = [];
      [...snapNome.docs, ...snapEmail.docs].forEach(d => {
        if (!vistos.has(d.id)) { vistos.add(d.id); resultados.push(d); }
      });

      if (resultados.length === 0) {
        resultDiv.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:#64748b;">Nenhum usuário encontrado.</div>';
        return;
      }

      resultDiv.innerHTML = '';
      resultados.forEach(d => {
        const u = d.data();
        const nomeExib = u.nome || u.email || d.id;
        const linha = document.createElement('div');
        linha.style.cssText = 'padding:8px 12px;font-size:13px;cursor:pointer;border-bottom:1px solid #f1f5f9;';
        linha.innerHTML = `<strong>${escapeHtml(nomeExib)}</strong> <span style="color:#64748b;font-size:11px;">${escapeHtml(u.email || '')}</span>`;
        linha.addEventListener('mouseenter', () => linha.style.background = '#f0f9ff');
        linha.addEventListener('mouseleave', () => linha.style.background = '');
        linha.addEventListener('click', () => _selecionarMaster(d.id, nomeExib));
        resultDiv.appendChild(linha);
      });
    } catch (err) {
      console.error('[cupom-master] Erro na busca:', err);
      resultDiv.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:#dc2626;">Erro na busca. Verifique o console.</div>';
    }
  });

  // ── CAMPO: Municípios herdados — preenchido automaticamente pelo master ou editável ──
  const wrapMuns = document.createElement('div'); wrapMuns.style.marginTop = '12px';
  const labelMuns = document.createElement('label'); labelMuns.textContent = 'Municípios extras herdados pelos usuários do cupom'; labelMuns.style.cssText = 'display:block;font-size:13px;color:#333;margin-bottom:4px;';
  const hintMuns = document.createElement('span'); hintMuns.style.cssText = 'display:block;font-size:11px;color:#64748b;margin-bottom:4px;';
  hintMuns.textContent = 'Preenchido automaticamente ao selecionar o assinante master acima. O índice [0] é sempre o município do novo usuário ao assinar — não coloque aqui.';
  const areaMuns = document.createElement('textarea'); areaMuns.id = 'field-municipios_plano_master_raw'; areaMuns.rows = 4;
  areaMuns.style.cssText = 'width:100%;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;font-family:monospace;box-sizing:border-box;resize:vertical;';
  const munsVal = Array.isArray(dados.municipios_plano_master) && dados.municipios_plano_master.length > 0
    ? JSON.stringify(dados.municipios_plano_master, null, 2) : '[]';
  areaMuns.value = munsVal;
  const errMuns = document.createElement('span'); errMuns.id = 'error-municipios_plano_master'; errMuns.style.cssText = 'display:none;color:#b00020;font-size:12px;margin-top:4px;';
  wrapMuns.appendChild(labelMuns); wrapMuns.appendChild(hintMuns); wrapMuns.appendChild(areaMuns); wrapMuns.appendChild(errMuns);
  body.appendChild(wrapMuns);

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

      // 4. plano_id, ciclo_cupom e assinante_master_uid já foram coletados pelo loop (têm data-field-name)
      data.plano_id = data.plano_id || '';
      data.ciclo_cupom = data.ciclo_cupom || '';        // '' = qualquer ciclo; '1','3','6','12' = específico
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