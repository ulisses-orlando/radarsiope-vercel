let solicitacaoResposta = {
  usuarioId: "",
  solicitacaoId: "",
  novoStatus: ""
};

/* ====================
   FUNÇÕES AUXILIARES
   ==================== */

function parseDateInput(value) {
  if (!value) return null;
  return firebase.firestore.Timestamp.fromDate(new Date(value + "T00:00:00"));
}

function createTextField(label, value, field) {
  return `
    <div class="field">
      <label>${label}</label>
      <input type="text" data-field="${field}" value="${value || ""}">
    </div>
  `;
}

function createDateField(label, value, field) {
  let val = "";
  if (value) {
    const d = new Date(value.seconds ? value.seconds * 1000 : value);
    val = d.toISOString().split("T")[0];
  }
  return `
    <div class="field">
      <label>${label}</label>
      <input type="date" data-field="${field}" value="${val}">
    </div>
  `;
}

function createSelectField(label, options, value, field) {
  const opts = options
    .map(
      (opt) =>
        `<option value="${opt}" ${opt === value ? "selected" : ""}>${opt}</option>`
    )
    .join("");
  return `
    <div class="field">
      <label>${label}</label>
      <select data-field="${field}">${opts}</select>
    </div>
  `;
}

/* ====================
   FUNÇÕES MODULARES
   ==================== */
function generateTextField(name, value) {
  const wrap = document.createElement('div'); wrap.className = 'field';
  const label = document.createElement('label'); label.innerText = name; wrap.appendChild(label);
  const input = document.createElement('input'); input.type = 'text'; input.value = value || ''; input.dataset.fieldName = name;
  wrap.appendChild(input); return wrap;
}
function generateTextArea(name, value) {
  const wrap = document.createElement('div'); wrap.className = 'field';
  const label = document.createElement('label'); label.innerText = name; wrap.appendChild(label);
  const ta = document.createElement('textarea'); ta.value = value || ''; ta.dataset.fieldName = name; ta.rows = 8;
  wrap.appendChild(ta); return wrap;
}
function generateBooleanSelect(name, value) {
  const wrap = document.createElement('div'); wrap.className = 'field';
  const label = document.createElement('label'); label.innerText = name; wrap.appendChild(label);
  const select = document.createElement('select'); select.dataset.fieldName = name;
  [{ v: 'true', t: 'Sim' }, { v: 'false', t: 'Não' }].forEach(o => {
    const el = document.createElement('option'); el.value = o.v; el.text = o.t;
    if (String(value) === o.v || (value === true && o.v === 'true') || (value === false && o.v === 'false')) el.selected = true;
    select.appendChild(el);
  });
  wrap.appendChild(select); return wrap;
}
function generateDomainSelect(name, optionsArray, value) {
  const wrap = document.createElement('div'); wrap.className = 'field';
  const label = document.createElement('label'); label.innerText = name; wrap.appendChild(label);
  const select = document.createElement('select'); select.dataset.fieldName = name;
  optionsArray.forEach(optVal => {
    const el = document.createElement('option'); el.value = optVal; el.text = optVal;
    if (String(value) === String(optVal)) el.selected = true; select.appendChild(el);
  });
  wrap.appendChild(select); return wrap;
}

function generateDateInput(name, dateVal) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const label = document.createElement('label');
  label.innerText = name;
  wrap.appendChild(label);

  const input = document.createElement('input');
  input.type = 'date';
  input.id = name;                 // 🔹 agora tem id
  input.dataset.fieldName = name;

  if (dateVal instanceof Date) {
    input.value = dateVal.toISOString().slice(0, 10);
  } else if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
    input.value = dateVal.slice(0, 10);
  } else {
    input.value = '';
  }

  wrap.appendChild(input);
  return wrap;
}


function generatePasswordField(fieldName, value = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "field";

  const label = document.createElement("label");
  label.innerText = "Senha";
  wrapper.appendChild(label);

  const input = document.createElement("input");
  input.type = "password";
  input.value = value || "";
  input.dataset.fieldName = fieldName;
  wrapper.appendChild(input);

  return wrapper;
}

/* ====================
   CONFIRMAÇÃO GENÉRICA
   ==================== */
function abrirConfirmacao(msg, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-confirm-overlay show';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<h3>Confirmação</h3><p>${msg}</p>`;
  const btns = document.createElement('div'); btns.className = 'modal-buttons';
  const btnNao = document.createElement('button'); btnNao.textContent = 'Não';
  btnNao.onclick = () => document.body.removeChild(overlay);
  const btnSim = document.createElement('button'); btnSim.textContent = 'Sim';
  btnSim.onclick = () => { document.body.removeChild(overlay); onConfirm(); };
  btns.appendChild(btnNao); btns.appendChild(btnSim);
  modal.appendChild(btns); overlay.appendChild(modal);
  document.body.appendChild(overlay);
}


/* ====================
   CRUD NEWSLETTERS
   ==================== */
async function carregarNewsletters() {
  const tbody = document.getElementById('lista-newsletters');
  tbody.innerHTML = '';
  const tipoFiltro = document.getElementById('filtro-tipo-news')?.value || '';
  const classFiltro = document.getElementById('filtro-classificacao')?.value || '';
  const busca = (document.getElementById('filtro-busca')?.value || '').toLowerCase();

  // Carrega mapa ID → nome dos tipos para resolver na coluna
  const tiposSnap = await db.collection('tipo_newsletters').get();
  const tiposMap = {};
  tiposSnap.forEach(doc => { tiposMap[doc.id] = doc.data().nome || doc.id; });

  const snap = await db.collection('newsletters').orderBy('data_publicacao', 'desc').get();

  snap.forEach(doc => {
    const d = doc.data();

    // Campo tipo contém o ID do tipo (novo padrão)
    const tipoId   = d.tipo || '';
    const tipoNome = tiposMap[tipoId] || tipoId || '-';

    // Filtro pelo ID do tipo
    const tipoMatch = !tipoFiltro || tipoId === tipoFiltro;

    if (
      !tipoMatch ||
      (classFiltro && d.classificacao !== classFiltro) ||
      (busca && !((d.titulo || '').toLowerCase().includes(busca) || (d.edicao || '').toLowerCase().includes(busca)))
    ) return;

    const dt = d.data_publicacao
      ? new Date(d.data_publicacao.seconds * 1000).toLocaleDateString('pt-BR')
      : '';

    const enviadaIcon = d.enviada
      ? `<span style="color:green; font-size:18px;">✔️</span>`
      : `<span style="color:red; font-size:18px;">❌</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${dt}</td>
      <td>${d.edicao || ''}</td>
      <td>${d.titulo || ''}</td>
      <td>${tipoNome}</td>
      <td>${d.classificacao || 'Básica'}</td>
      <td style="text-align:center;">${enviadaIcon}</td>
      <td>
        <span class="icon-btn" title="Editar" onclick="abrirModalNewsletter('${doc.id}', true)">✏️</span>
        <span class="icon-btn" title="Duplicar" onclick="duplicarNewsletter('${doc.id}')">📄</span>
        <span class="icon-btn" title="Ver Avaliações" onclick="verReacoesNewsletter('${doc.id}', '${(d.titulo||'').replace(/'/g,"\\'")}')">📊</span>
        <span class="icon-btn" title="Excluir" onclick="confirmarExclusaoNewsletter('${doc.id}', '${(d.titulo || '').replace(/'/g, "\\'")}')">🗑️</span>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function verReacoesNewsletter(docId, titulo) {
  const snap = await db.collection('newsletters').doc(docId).get();
  if (!snap.exists) return;

  const reactions = snap.data().reactions || {};

  const LABELS = [
    { key: 'decepcionou', emoji: '😞', label: 'Decepcionou', cor: '#ef4444' },
    { key: 'regular',     emoji: '😐', label: 'Regular',     cor: '#f59e0b' },
    { key: 'bom',         emoji: '🙂', label: 'Bom',         cor: '#3b82f6' },
    { key: 'muito_bom',   emoji: '😀', label: 'Muito bom',   cor: '#22c55e' },
    { key: 'excelente',   emoji: '🤩', label: 'Excelente',   cor: '#8b5cf6' },
  ];

  const total = LABELS.reduce((s, { key }) => s + (reactions[key] || 0), 0);

  const linhas = LABELS.map(({ key, emoji, label, cor }) => {
    const count = reactions[key] || 0;
    const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <span style="font-size:24px;width:32px;text-align:center">${emoji}</span>
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
            <span style="font-weight:700;color:#334155">${label}</span>
            <span style="color:#64748b">${count} voto${count !== 1 ? 's' : ''} <span style="color:#94a3b8">· ${pct}%</span></span>
          </div>
          <div style="background:#f1f5f9;border-radius:20px;height:10px;overflow:hidden">
            <div style="width:${pct}%;background:${cor};height:100%;border-radius:20px"></div>
          </div>
        </div>
      </div>`;
  }).join('');

  // Remove modal anterior se existir
  document.getElementById('modal-reactions')?.remove();

  const modal = document.createElement('div');
  modal.id = 'modal-reactions';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:28px 24px;
      max-width:460px;width:94%;box-shadow:0 8px 40px rgba(0,0,0,.2);position:relative">
      <button onclick="document.getElementById('modal-reactions').remove()"
        style="position:absolute;top:12px;right:14px;background:none;border:none;
        font-size:20px;cursor:pointer;color:#94a3b8;line-height:1">✕</button>
      <h3 style="margin:0 0 4px;font-size:16px;color:#0A3D62">📊 Avaliações</h3>
      <p style="color:#64748b;font-size:13px;margin:0 0 20px">${titulo}</p>
      <p style="font-size:13px;color:#64748b;margin:0 0 16px">
        Total de avaliações: <strong style="color:#334155">${total}</strong>
      </p>
      ${total === 0
        ? '<p style="color:#94a3b8;text-align:center;padding:20px 0">Nenhuma avaliação registrada ainda.</p>'
        : linhas}
    </div>`;

  // Fecha ao clicar fora
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}


async function duplicarNewsletter(docId) {
  const snap = await db.collection('newsletters').doc(docId).get();
  if (!snap.exists) return;

  const data = snap.data();
  data.edicao = data.edicao + ' (cópia)';
  data.data_publicacao = firebase.firestore.Timestamp.fromDate(new Date());

  await db.collection('newsletters').add(data);
  carregarNewsletters();
}

async function preencherFiltroTipoNewsletter(selectElement) {
  if (!selectElement || !(selectElement instanceof HTMLElement)) return;

  // Limpa opções anteriores (exceto a primeira)
  selectElement.innerHTML = '<option value="">Todos os tipos</option>';

  try {
    const snap = await db.collection("tipo_newsletters").get();
    if (snap.empty) {
      console.warn("Nenhum tipo de newsletter encontrado.");
      return;
    }

    snap.forEach(doc => {
      const nome = doc.data().nome;
      if (nome) {
        const opt = document.createElement("option");
        opt.value = nome;
        opt.textContent = nome;
        selectElement.appendChild(opt);
      }
    });
  } catch (error) {
    console.error("Erro ao carregar tipos de newsletter:", error);
  }
}


function confirmarExclusaoNewsletter(id, titulo) {
  abrirConfirmacao(`Deseja excluir a newsletter "${titulo}"?`, async () => {
    await db.collection('newsletters').doc(id).delete();
    carregarNewsletters();
  });
}

/* ====================
   CRUD USUÁRIOS + SUBCOLEÇÕES
   ==================== 
async function carregarUsuarios() {
  const tbody = document.getElementById('lista-usuarios');
  tbody.innerHTML = '';

  const snap = await db.collection('usuarios').get();

  snap.docs.forEach((doc, index) => {
    const d = doc.data();
    const tr = document.createElement('tr');

    // ✅ Alterna cor de fundo com base no índice
    tr.style.backgroundColor = index % 2 === 0 ? '#ffffff' : '#5facdf5d';

    tr.innerHTML = `
      <td>${d.nome || ''}</td>
      <td>${d.email || ''}</td>
      <td>${d.cod_uf || '-'}</td> 
      <td>${d.nome_municipio || '-'}</td> 
      <td>${d.tipo_perfil || ''}</td>
      <td>${d.ativo ? 'Sim' : 'Não'}</td>
      <td>
        <span class="icon-btn" title="Editar Usuário" onclick="abrirModalEditarUsuario('${doc.id}')">✏️</span>
        <span class="icon-btn" title="Excluir Usuário" onclick="confirmarExclusaoUsuario('${doc.id}','${(d.nome || '').replace(/'/g, "\\'")}')">🗑️</span>
        <span class="icon-btn" title="Logs de Acesso" onclick="abrirSubcolecao('${doc.id}','logs_acesso')">📜</span>
        <span class="icon-btn" title="Assinaturas" onclick="abrirSubcolecao('${doc.id}','assinaturas')">📑</span>
        <span class="icon-btn" title="Solicitações" onclick="abrirSubcolecao('${doc.id}','solicitacoes')">📬</span>
        <span class="icon-btn" title="Pagamentos" onclick="abrirSubcolecao('${doc.id}','pagamentos')">💳</span>
        <span class="icon-btn" title="Preferências Newsletter" onclick="abrirSubcolecao('${doc.id}','preferencias_newsletter')">📰</span>
        <span class="icon-btn" title="Visão Geral" onclick="mostrarVisaoGeral('${doc.id}')">👁️</span>
      </td>`;

    tbody.appendChild(tr);
  });
}
*/
function confirmarExclusaoUsuario(id, nome) {
  abrirConfirmacao(`Deseja excluir o usuário "${nome}"?`, async () => {
    await db.collection('usuarios').doc(id).delete();
    carregarUsuariosComFiltro();
  });
}

/* ====================
   SUBCOLEÇÕES (USUÁRIOS)
   ==================== */

async function abrirSubcolecao(usuarioId, subcolecao) {
  document.getElementById("modal-edit-save").style.display = "none";
  const modal = document.getElementById("modal-edit-overlay");
  const body = document.getElementById("modal-edit-body");
  const title = document.getElementById("modal-edit-title");

  // validação básica do DOM
  if (!modal || !body || !title) {
    console.error("abrirSubcolecao: elementos do modal não encontrados no DOM.");
    return;
  }

  let html = "";

  // 🔹 Buscar nome do usuário no Firestore
  const usuarioDoc = await db.collection("usuarios").doc(usuarioId).get();
  const usuarioData = usuarioDoc.data();
  const usuarioNome = usuarioData?.nome || "Usuário";

  // 🔹 Agora o título mostra subcoleção + nome do usuário
  title.innerText = `Gerenciar ${subcolecao} de ${usuarioNome}`;

  body.innerHTML = `<button onclick="abrirModalSubItem('${usuarioId}','${subcolecao}')">➕ Novo</button>
    <table>
      <thead><tr id="thead-sub"></tr></thead>
      <tbody id="tbody-sub"></tbody>
    </table>`;

  if (subcolecao === "pagamentos") {
    let html = "";
    html += `<button onclick="abrirGeradorParcelas('${usuarioId}')">📆 Gerar Parcelas</button>`;
    html += `
        <table>
          <thead><tr id="thead-sub"></tr></thead>
          <tbody id="tbody-sub"></tbody>
        </table>
      `;
    body.innerHTML += html;
  }

  const tbody = body.querySelector("#tbody-sub");
  const thead = body.querySelector("#thead-sub");
  if (!tbody || !thead) {
    console.error("abrirSubcolecao: containers da sub-tabela não encontrados.");
    return;
  }

  // campos por subcoleção
  let campos = [];
  switch (subcolecao) {
    case "logs_acesso":
      campos = ["data_acesso", "dispositivo", "ip_origem"];
      break;
    case "assinaturas":
      // mantém 'plano' no cabeçalho (você já comentou que prefere mostrar 'Plano' visualmente)
      campos = ["data_inicio", "data_fim", "plano", "status", "tipo_newsletter"];
      break;
    case "solicitacoes":
      campos = ["data_solicitacao", "descricao", "status", "tipo"];
      break;
    case "pagamentos":
      campos = ["data_pagamento", "metodo_pagamento", "status", "valor"];
      break;
    case "preferencias_newsletter":
      campos = ["tipo"];
      break;
    default:
      campos = [];
  }

  // montar cabeçalho
  thead.innerHTML = campos.map((c) => `<th>${c}</th>`).join("") + "<th>Ações</th>";

  // se for assinaturas, precisamos de um mapa id->nome dos planos
  let planosMap = {};
  if (subcolecao === "assinaturas") {
    // tenta reaproveitar cache global (se existir)
    if (window.planMap && Object.keys(window.planMap).length) {
      planosMap = window.planMap;
    } else {
      // carrega diretamente do Firestore
      try {
        const planosSnap = await db.collection("planos").get();
        planosSnap.forEach(pdoc => {
          const pd = pdoc.data() || {};
          planosMap[pdoc.id] = pd.nome || pdoc.id;
        });
      } catch (e) {
        console.warn("abrirSubcolecao: falha ao carregar planos:", e);
      }
    }
  }

  // carregar documentos da subcoleção
  const snap = await db
    .collection("usuarios")
    .doc(usuarioId)
    .collection(subcolecao)
    .get();

  // limpar tbody (por segurança)
  tbody.innerHTML = "";

  let index = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const tr = document.createElement("tr");

    // 🔄 Alterna cor de fundo para efeito zebrado
    tr.style.backgroundColor = index % 2 === 0 ? "#ffffff" : '#5facdf5d';


    for (const c of campos) {
      const td = document.createElement("td");

      if (c.startsWith("data") && d[c]) {
        td.innerText = formatDateBR(d[c]);
      }
      else if (subcolecao === "assinaturas" && c === "plano") {
        if (d.plano_id) {
          const planoDoc = await db.collection("planos").doc(d.plano_id).get();
          td.innerText = planoDoc.exists ? planoDoc.data().nome : "(plano removido)";
        } else {
          td.innerText = "";
        }
      }
      else if (subcolecao === "preferencias_newsletter" && c === "tipo") {
        td.innerText = doc.id || "(não informado)";
      }
      else if (subcolecao === "assinaturas" && c === "tipo_newsletter") {
        td.innerText = d.tipo_newsletter || "-";
      }
      else if (subcolecao === "pagamentos" && c === "valor") {
        td.innerText = formatarBRL(d.valor);
      }
      else {
        td.innerText = d[c] || "";
      }


      tr.appendChild(td);
    }

    document.getElementById("modal-edit-save").style.display = "none";

    const tdA = document.createElement("td");
    const edit = document.createElement("span");
    edit.className = "icon-btn";
    edit.innerText = "✏️";
    edit.onclick = () => abrirModalSubItem(usuarioId, subcolecao, doc.id, true);
    tdA.appendChild(edit);

    const del = document.createElement("span");
    del.className = "icon-btn";
    del.innerText = "🗑️";
    del.onclick = async () => {
      abrirConfirmacao("Deseja excluir este registro?", async () => {
        await db
          .collection("usuarios")
          .doc(usuarioId)
          .collection(subcolecao)
          .doc(doc.id)
          .delete();
        abrirSubcolecao(usuarioId, subcolecao);
      });
    };
    tdA.appendChild(del);

    tr.appendChild(tdA);
    tbody.appendChild(tr);
    index++;

    if (subcolecao === "assinaturas") {
      const abrirEnvios = document.createElement("span");
      abrirEnvios.className = "icon-btn";
      abrirEnvios.innerText = "📨";
      abrirEnvios.title = "Ver envios desta assinatura";
      abrirEnvios.onclick = () => abrirSubEnvios(usuarioId, doc.id);
      tdA.appendChild(abrirEnvios);

      const enviarManual = document.createElement("span");
      enviarManual.className = "icon-btn";
      enviarManual.innerText = "📧";
      enviarManual.title = "Enviar newsletter manualmente";
      enviarManual.onclick = () => abrirModalEnvioNewsletterManual(usuarioId, doc.id);
      tdA.appendChild(enviarManual);
    }

    if (subcolecao === "solicitacoes") {
      const statusAtual = d.status?.toLowerCase() || "pendente";

      if (statusAtual === "pendente" || statusAtual === "aberta") {
        const atender = document.createElement("span");
        atender.className = "icon-btn";
        atender.innerText = "✅";
        atender.title = "Marcar como atendida";
        atender.onclick = () => abrirModalResposta(usuarioId, doc.id, "atendida");
        tdA.appendChild(atender);

        const cancelar = document.createElement("span");
        cancelar.className = "icon-btn";
        cancelar.innerText = "❌";
        cancelar.title = "Cancelar solicitação";
        cancelar.onclick = () => abrirModalResposta(usuarioId, doc.id, "cancelada");
        tdA.appendChild(cancelar);

        const enviar = document.createElement("span");
        enviar.className = "icon-btn";
        enviar.innerText = "📧";
        enviar.title = "Enviar resposta manual";
        enviar.onclick = () => abrirModalEnvioManual(usuarioId, doc.id, d);
        tdA.appendChild(enviar);
      }
    }

    if (subcolecao === "solicitacoes") {
      const avaliacao = d.avaliacao;
      if (avaliacao) {
        const avaliacaoSpan = document.createElement("span");
        avaliacaoSpan.innerHTML = `🗳️ Avaliação: <strong>${avaliacao === "positivo" ? "👍" : "👎"}</strong>`;
        tdA.appendChild(avaliacaoSpan);
      }
    }


  }
  openModal("modal-edit-overlay");
}


async function abrirSubEnvios(usuarioId, assinaturaId) {
  const modal = document.getElementById("modal-edit-overlay");
  const body = document.getElementById("modal-edit-body");
  const title = document.getElementById("modal-edit-title");

  title.innerText = `Envios da assinatura ${assinaturaId}`;
  body.innerHTML = `<button onclick="abrirModalSubItem('${usuarioId}','assinaturas/${assinaturaId}/envios')">➕ Novo envio</button>
    <table>
      <thead><tr><th>id_edicao</th><th>data_envio</th><th>status</th><th>motivo</th><th>Ações</th></tr></thead>
      <tbody id="tbody-sub"></tbody>
    </table>`;

  const tbody = body.querySelector("#tbody-sub");
  tbody.innerHTML = "";

  const snap = await db
    .collection("usuarios")
    .doc(usuarioId)
    .collection("assinaturas")
    .doc(assinaturaId)
    .collection("envios")
    .get();

  let index = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const tr = document.createElement("tr");
    tr.style.backgroundColor = index % 2 === 0 ? "#ffffff" : '#5facdf5d';

    const campos = ["id_edicao", "data_envio", "status", "motivo"];
    for (const c of campos) {
      const td = document.createElement("td");
      td.innerText = c.startsWith("data") && d[c] ? formatDateBR(d[c]) : (d[c] || "");
      tr.appendChild(td);
    }

    const tdA = document.createElement("td");
    const edit = document.createElement("span");
    edit.className = "icon-btn";
    edit.innerText = "✏️";
    edit.onclick = () => abrirModalSubItem(usuarioId, `assinaturas/${assinaturaId}/envios`, doc.id, true);
    tdA.appendChild(edit);

    const del = document.createElement("span");
    del.className = "icon-btn";
    del.innerText = "🗑️";
    del.onclick = async () => {
      abrirConfirmacao("Deseja excluir este envio?", async () => {
        await db
          .collection("usuarios")
          .doc(usuarioId)
          .collection("assinaturas")
          .doc(assinaturaId)
          .collection("envios")
          .doc(doc.id)
          .delete();
        abrirSubEnvios(usuarioId, assinaturaId);
      });
    };
    tdA.appendChild(del);

    tr.appendChild(tdA);
    tbody.appendChild(tr);
    index++;
  }

  openModal("modal-edit-overlay");
}

function abrirGeradorParcelas(usuarioId) {
  const modal = document.getElementById("modal-edit-overlay");
  const body = document.getElementById("modal-edit-body");

  body.innerHTML = `
    <h3>📆 Gerar Parcelas</h3>
    <form id="form-gerar-parcelas">
      <label>Valor total:</label>
      <input type="number" id="valor-total" required style="width:100%;margin-bottom:10px">

      <label>Número de parcelas:</label>
      <input type="number" id="num-parcelas" required style="width:100%;margin-bottom:10px">

      <label>Data vencimento:</label>
      <input type="date" id="data-inicial" required style="width:100%;margin-bottom:10px">

      <label>Método de pagamento:</label>
      <select id="metodo-pagamento" required style="width:100%;margin-bottom:10px">
        <option value="">Selecione...</option>
        <option value="boleto">Boleto</option>
        <option value="pix">Pix</option>
        <option value="cartao">Cartão</option>
      </select>

      <button type="submit">✅ Gerar</button>
    </form>
    <p id="status-geracao" style="margin-top:10px;font-weight:bold"></p>
  `;

  const form = document.getElementById("form-gerar-parcelas");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const valorTotal = parseFloat(document.getElementById("valor-total").value);
    const numParcelas = parseInt(document.getElementById("num-parcelas").value, 10);
    const dataInicialInput = document.getElementById("data-inicial").value;
    const metodo = document.getElementById("metodo-pagamento").value;

    if (!valorTotal || !numParcelas || !dataInicialInput || !metodo) return;

    const valorParcelaBase = parseFloat((valorTotal / numParcelas).toFixed(2));
    const statusEl = document.getElementById("status-geracao");
    statusEl.innerText = "🔄 Gerando parcelas...";

    // 🔹 Normaliza a data inicial para meia-noite local
    const [ano, mes, dia] = dataInicialInput.split("-").map(Number);
    const dataInicial = new Date(ano, mes - 1, dia, 0, 0, 0, 0);

    const diaDesejado = dataInicial.getDate();

    // Helper: adiciona 1 mês preservando o dia desejado
    function addUmMesPreservandoDia(baseDate, desiredDay) {
      const d = new Date(baseDate.getTime());
      d.setMonth(d.getMonth() + 1, 1); // vai para o mês seguinte, dia 1
      const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(desiredDay, ultimoDia));
      return d;
    }

    try {
      let dataParcela = new Date(dataInicial);
      let acumulado = 0;

      for (let i = 0; i < numParcelas; i++) {
        // Corrige centavos residuais na última parcela
        let valorParcela = valorParcelaBase;
        acumulado += valorParcelaBase;
        if (i === numParcelas - 1) {
          valorParcela = parseFloat((valorTotal - (acumulado - valorParcelaBase)).toFixed(2));
        }

        await db.collection("usuarios")
          .doc(usuarioId)
          .collection("pagamentos")
          .add({
            data_vencimento: firebase.firestore.Timestamp.fromDate(dataParcela),
            metodo_pagamento: metodo,
            status: "pendente",
            valor: valorParcela
          });

        // Próxima parcela
        dataParcela = addUmMesPreservandoDia(dataParcela, diaDesejado);
      }

      statusEl.innerText = "✅ Parcelas geradas com sucesso.";
    } catch (e) {
      console.error("Erro ao gerar parcelas:", e);
      statusEl.innerText = "❌ Erro ao gerar parcelas.";
    }
  });
}

async function abrirModalEnvioManual(usuarioId, solicitacaoId, dadosSolicitacao) {
  const modal = document.getElementById("modal-edit-overlay");
  const body = document.getElementById("modal-edit-body");
  const title = document.getElementById("modal-edit-title");
  document.getElementById("modal-edit-save").style.display = "none";

  title.innerText = "📧 Enviar resposta manual";
  body.innerHTML = "";

  // 🔹 Carregar respostas automáticas com momento_envio === "padrao"
  const respostasSnap = await db.collection("respostas_automaticas")
    .where("momento_envio", "==", "padrao")
    .where("ativo", "==", true)
    .get();

  if (respostasSnap.empty) {
    body.innerHTML = "<p>⚠️ Nenhuma resposta padrão cadastrada.</p>";
    return;
  }

  const respostas = respostasSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  const usuarioSnap = usuarioId
    ? await db.collection("usuarios").doc(usuarioId).get()
    : null;

  let dadosUsuario = {};
  let interessesUsuario = null;

  // Só trata como "usuário" se o doc existir em `usuarios`
  if (usuarioSnap && usuarioSnap.exists) {
    dadosUsuario = usuarioSnap.data();

    const prefsSnap = await db.collection("usuarios")
      .doc(usuarioId)
      .collection("preferencias_newsletter")
      .get();

    const interesses = prefsSnap.docs.map(doc => doc.id);
    if (interesses.length) {
      interessesUsuario = interesses;
    }
  }

  // Monta dadosCompletos sem apagar nada do lead
  let dadosCompletos = {
    ...dadosSolicitacao,
    ...dadosUsuario
  };

  // Só sobrescreve `interesses` se de fato achou preferências do usuário
  if (interessesUsuario && interessesUsuario.length) {
    dadosCompletos.interesses = interessesUsuario;
  }

  const selectHTML = respostas.map(r =>
    `<option value="${r.id}">${r.titulo}</option>`
  ).join("");

  body.innerHTML = gerarHtmlPlaceholdersExpandivel();
  body.innerHTML += `
    <div class="field">
      <label>Enviar para o e-mail:</label>
      <input type="email" id="email-destino" value="${dadosCompletos.email || ''}">
    </div>
    <div class="field">
      <label>Selecione a resposta</label>
      <select id="resposta-select">${selectHTML}</select>
    </div>
    <div class="field">
      <label>Mensagem HTML</label>
      <textarea id="resposta-html" rows="10"></textarea>
    </div>
    <div class="field">
      <label>Assunto:</label>
      <input type="assunto" id="assunto-email">
    </div>
    <button id="btn-preview-email">👁️ Visualizar e-mail</button>
    <button id="btn-enviar-email">📤 Enviar e-mail</button>
    <div id="preview-container" style="border:1px solid #ccc; padding:10px; margin-top:10px; background:#f9f9f9;"></div>
  `;

  const select = document.getElementById("resposta-select");
  const textarea = document.getElementById("resposta-html");


  select.onchange = () => {
    const resposta = respostas.find(r => r.id === select.value);
    if (resposta) {
      textarea.value = resposta.mensagem_html;
    }
  };

  // Preenche com a primeira resposta por padrão
  if (respostas.length) {
    select.value = respostas[0].id;
    textarea.value = respostas[0].mensagem_html;
  }

  document.getElementById("btn-enviar-email").onclick = async () => {
    // 1) substitui placeholders
    const htmlBase = aplicarPlaceholders(textarea.value, dadosCompletos);

    if (!validarPlaceholders(textarea.value)) {
      // interrompe o processo se houver placeholders inválidos
      return;
    }

    // 2) aplica rastreamento
    const mensagemHtml = aplicarRastreamento(
      htmlBase,
      select.value,   // envioId (resposta escolhida)
      usuarioId,      // destinatário
      select.value    // newsletterId ou respostaId
    );

    const nome = dadosCompletos.nome || "Usuário";
    const email = document.getElementById("email-destino").value; // dadosCompletos.email;
    const assunto = document.getElementById("assunto-email").value || "Resposta à sua solicitação";

    if (!email) {
      mostrarMensagem("Mensagem sem e-mail de destino.");
      return;
    }

    if (!assunto) {
      mostrarMensagem("Mensagem sem assunto.");
      return;
    }

    try {
      await fetch("/api/enviarEmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, email, assunto, mensagemHtml })
      });

      // Atualiza status da solicitação (somente se estiver no contexto de usuário + solicitação)
      if (usuarioId) {
        const solicitacoesRef = db.collection("usuarios")
          .doc(usuarioId)
          .collection("solicitacoes");

        if (solicitacaoId) {
          // Atualiza solicitação existente
          await solicitacoesRef.doc(solicitacaoId).set({
            status: "enviada",
            data_envio: new Date(),
            resposta_utilizada: select.value,
            resposta_html_enviada: mensagemHtml
          }, { merge: true });
        } else {
          // Cria nova solicitação
          await solicitacoesRef.add({
            status: "atendida",
            data_envio: new Date(),
            data_solicitacao: new Date(),
            resposta_utilizada: select.value,
            resposta_html_enviada: mensagemHtml,
            assunto: assunto,
            mensagem: mensagemHtml,
            tipo: " "
          });
        }
      }

      mostrarMensagem("E-mail enviado com sucesso!");

      if (solicitacaoId) {
        abrirSubcolecao(usuarioId, "solicitacoes");
      }

      // Preenche campo de resultado no modal de leads, se estiver visível
      const resultadoCampo = document.getElementById("resultado-contato-lead");
      if (resultadoCampo) {
        const agora = new Date();
        const dataFormatada = agora.toLocaleDateString("pt-BR");
        const horaFormatada = agora.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' });
        resultadoCampo.value = mensagemHtml;
      }

    } catch (e) {
      console.error("Erro ao enviar e-mail:", e);
      mostrarMensagem("Erro ao enviar e-mail.");
    }
  };

  document.getElementById("btn-preview-email").onclick = () => {
    const rawHTML = textarea.value;

    if (!validarPlaceholders(rawHTML)) {
      // interrompe o processo se houver placeholders inválidos
      return;
    }

    // 1) substitui placeholders
    const htmlBase = aplicarPlaceholders(rawHTML, dadosCompletos);

    // 2) aplica rastreamento
    const htmlFinal = aplicarRastreamento(
      htmlBase,
      select.value,   // envioId pode ser o id da resposta selecionada
      usuarioId,      // destinatário
      select.value    // newsletterId ou respostaId (para manter rastreio)
    );

    const preview = document.getElementById("preview-container");
    preview.innerHTML = htmlFinal;
  };

  openModal("modal-edit-overlay");
}


async function abrirModalEnvioNewsletterManual(usuarioId, assinaturaId) {
  const modal = document.getElementById("modal-edit-overlay");
  const body = document.getElementById("modal-edit-body");
  const title = document.getElementById("modal-edit-title");

  title.innerText = "📧 Enviar newsletter manual";
  body.innerHTML = "";

  // 🔹 Buscar dados do usuário
  const usuarioSnap = await db.collection("usuarios").doc(usuarioId).get();
  const dadosUsuario = usuarioSnap.exists ? usuarioSnap.data() : {};

  // 🔹 Buscar assinatura
  const assinaturaSnap = await db.collection("usuarios").doc(usuarioId)
    .collection("assinaturas").doc(assinaturaId).get();

  if (!assinaturaSnap.exists) {
    body.innerHTML = "<p>⚠️ Assinatura não encontrada.</p>";
    return;
  }

  const assinatura = assinaturaSnap.data();
  const tipoNewsletter = assinatura.tipo_newsletter;

  if (!tipoNewsletter) {
    body.innerHTML = "<p>⚠️ Assinatura não possui tipo de newsletter definido.</p>";
    return;
  }

  // 🔹 Buscar edições compatíveis
  const edicoesSnap = await db.collection("newsletters")
    .where("tipo", "==", tipoNewsletter)
    .orderBy("data_publicacao", "desc")
    .get();

  if (edicoesSnap.empty) {
    body.innerHTML = "<p>⚠️ Nenhuma edição disponível para este tipo de newsletter.</p>";
    return;
  }

  const edicoes = edicoesSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  const selectHTML = edicoes.map(ed => {
    const data = ed.data_publicacao?.toDate().toLocaleDateString("pt-BR") || "";
    const edicao = ed.edicao || "";
    const titulo = ed.titulo || "";
    return `<option value="${ed.id}">${data} - ${edicao} - ${titulo}</option>`;
  }).join("");

  body.innerHTML = gerarHtmlPlaceholdersExpandivel();
  body.innerHTML += `
    <div class="field">
      <label>Edição da Newsletter</label>
      <select id="edicao-select">${selectHTML}</select>
    </div>
    <div class="field">
      <label>Mensagem HTML</label>
      <textarea id="resposta-html" rows="10"></textarea>
    </div>
    <button id="btn-preview-email">👁️ Visualizar e-mail</button>
    <button id="btn-enviar-email">📤 Enviar e-mail</button>
  `;

  const select = document.getElementById("edicao-select");
  const textarea = document.getElementById("resposta-html");

  const preencherHTML = () => {
    const edicaoSelecionada = edicoes.find(e => e.id === select.value);
    if (edicaoSelecionada) {
      textarea.value = edicaoSelecionada.html_conteudo || "<p>(sem conteúdo)</p>";
    }
  };

  select.onchange = preencherHTML;
  preencherHTML(); // inicial

  document.getElementById("btn-preview-email").onclick = () => {
    const edicaoSelecionada = edicoes.find(e => e.id === select.value);

    const htmlBase = aplicarPlaceholders(textarea.value, {
      ...dadosUsuario,
      ...edicaoSelecionada
    });

    // 🔹 aplica rastreamento
    const htmlFinal = aplicarRastreamento(
      htmlBase,
      edicaoSelecionada.id,   // envioId pode ser o id da edição
      usuarioId,              // destinatário
      edicaoSelecionada.id    // newsletterId
    );

    const previewModal = document.createElement("div");
    previewModal.className = "preview-modal";

    previewModal.style.position = "fixed";
    previewModal.style.top = "50%";
    previewModal.style.left = "50%";
    previewModal.style.transform = "translate(-50%, -50%)";
    previewModal.style.background = "#fff";
    previewModal.style.border = "1px solid #ccc";
    previewModal.style.padding = "20px";
    previewModal.style.zIndex = "99999";
    previewModal.style.maxHeight = "80vh";
    previewModal.style.overflowY = "auto";
    previewModal.style.boxShadow = "0 0 20px rgba(0,0,0,0.3)";
    previewModal.style.borderRadius = "8px";

    // ✅ agora sim: HTML puro no innerHTML
    previewModal.innerHTML = `
      <div style="text-align:right">
        <button onclick="this.closest('.preview-modal').remove()">❌ Fechar</button>  
      </div>
      ${htmlFinal}
    `;

    document.body.appendChild(previewModal);

  };

  document.getElementById("btn-enviar-email").onclick = async () => {
    const edicaoSelecionada = edicoes.find(e => e.id === select.value);
    const mensagemHtml = aplicarPlaceholders(textarea.value, {
      ...dadosUsuario,
      ...edicaoSelecionada
    });

    const nome = dadosUsuario.nome || "Usuário";
    const email = dadosUsuario.email;

    if (!email) {
      mostrarMensagem("Usuário não possui e-mail.");
      return;
    }

    try {
      await fetch("/api/enviarEmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, email, mensagemHtml })
      });

      // ✅ Gravação no histórico de envios
      await db.collection("usuarios")
        .doc(usuarioId)
        .collection("assinaturas")
        .doc(assinaturaId)
        .collection("envios")
        .add({
          id_edicao: edicaoSelecionada.id,
          data_envio: new Date(),
          status: "enviado",
          origem: "manual"
        });

      mostrarMensagem("Newsletter enviada e registrada com sucesso!");
    } catch (e) {
      console.error("Erro ao enviar newsletter:", e);
      mostrarMensagem("Erro ao enviar newsletter.");
    }
  };

  openModal("modal-edit-overlay");
}


async function abrirModalSubItem(usuarioId, subcolecao, docId = null, isEdit = false) {
  document.getElementById("modal-edit-save").style.display = "none";
  const modal = document.getElementById("modal-edit-overlay");
  const body = document.getElementById("modal-edit-body");
  const title = document.getElementById("modal-edit-title");

  let assinaturaId = null;
  let tipoNewsletterDaAssinatura = null;

  if (subcolecao.startsWith("assinaturas/")) {
    const partes = subcolecao.split("/");
    assinaturaId = partes[1];

    // Buscar tipo_newsletter da assinatura
    const assinaturaSnap = await db
      .collection("usuarios")
      .doc(usuarioId)
      .collection("assinaturas")
      .doc(assinaturaId)
      .get();

    tipoNewsletterDaAssinatura = assinaturaSnap.exists ? assinaturaSnap.data().tipo_newsletter : null;
  }

  title.innerText = isEdit ? `Editar ${subcolecao}` : `Novo ${subcolecao}`;
  body.innerHTML = "";

  let data = {};
  if (isEdit && docId) {
    const snap = await db
      .collection("usuarios")
      .doc(usuarioId)
      .collection(subcolecao)
      .doc(docId)
      .get();
    if (snap.exists) data = snap.data();
  }

  let form = "";
  const subcolecaoBase = subcolecao.split("/").pop(); // pega o último segmento
  switch (subcolecaoBase) {
    case "logs_acesso":
      form += createDateField("Data Acesso", data.data_acesso, "data_acesso");
      form += createTextField("Dispositivo", data.dispositivo, "dispositivo");
      form += createTextField("IP Origem", data.ip_origem, "ip_origem");
      break;

    case "assinaturas":
      form += createDateField("Data Início", data.data_inicio, "data_inicio");
      form += createDateField("Data Fim", data.data_fim, "data_fim");
      const planosSnap = await db.collection("planos").get();
      const planosArr = planosSnap.docs.map(d => ({ id: d.id, nome: d.data().nome }));
      const optsPlanoHTML = planosArr.map(p => `<option value="${p.id}" ${p.id === data.plano_id ? 'selected' : ''}>${p.nome}</option>`).join('');
      form += `
        <div class="field">
          <label>Plano</label>
          <select data-field="plano_id">${optsPlanoHTML}</select>
        </div>
      `;
      form += `
        <div class="field">
          <label for="tipo-newsletter-edicao">Tipo de Newsletter</label>
          <select id="tipo-newsletter-edicao" data-field="tipo_newsletter">
            <option value="">Selecione</option>
          </select>
        </div>
      `;
      form += createSelectField("Status", ["ativo", "inativo", "suspenso"], data.status, "status");
      break;

    case "solicitacoes":
      form += createDateField("Data Solicitação", data.data_solicitacao, "data_solicitacao");
      form += createTextField("Descrição", data.descricao, "descricao");
      form += createSelectField("Status", ["pendente", "aberta", "atendida"], data.status, "status");
      form += createSelectField("Tipo", ["newsletters", "treinamento", "consultoria", "outros"], data.tipo, "tipo");
      break;

    case "pagamentos":
      form += createDateField("Data Pagamento", data.data_pagamento, "data_pagamento");
      form += createSelectField("Método Pagamento", ["debito", "credito", "pix", "dinheiro", "outros"], data.metodo_pagamento, "metodo_pagamento");
      form += createSelectField("Status", ["pendente", "pago", "cancelado"], data.status, "status");
      form += createTextField("Comprovante URL", data.comprovante_url, "comprovante_url");
      form += createTextField("Valor", data.valor ? formatarBRL(data.valor) : "", "valor");
      break;

    case "preferencias_newsletter":
      form += createSelectField("Tipo", ["cacs", "fundeb", "salario-educacao", "siope"], data.tipo, "tipo");
      break;

    case "envios":
      if (tipoNewsletterDaAssinatura) {
        // 🔹 Buscar edições compatíveis
        const edicoesSnap = await db.collection("newsletters")
          .where("tipo", "==", tipoNewsletterDaAssinatura)
          .orderBy("data_publicacao", "desc")
          .get();

        // 🔹 Buscar envios já feitos
        const enviosSnap = await db
          .collection("usuarios")
          .doc(usuarioId)
          .collection("assinaturas")
          .doc(assinaturaId)
          .collection("envios")
          .get();

        const edicoesEnviadas = new Set(enviosSnap.docs.map(doc => doc.data().id_edicao));

        const optsHTML = edicoesSnap.docs.map(doc => {
          const ed = doc.data();
          const id = doc.id;
          const titulo = ed.titulo || "(sem título)";
          const edicao = ed.edicao ? ` - ${ed.edicao}` : "";
          const data = ed.data_publicacao?.toDate().toLocaleDateString("pt-BR") || "";
          const enviado = edicoesEnviadas.has(id) ? " (já enviado)" : "";
          return `<option value="${id}" ${id === data.id_edicao ? "selected" : ""}>${data}${edicao} - ${titulo}${enviado}</option>`;
        }).join("");

        form += `
          <div class="field">
            <label for="id-edicao">Edição</label>
            <select data-field="id_edicao" id="id-edicao">
              <option value="">Selecione uma edição</option>
              ${optsHTML}
            </select>
          </div>
        `;
      } else {
        form += `<p style="color: red">⚠️ Tipo de newsletter da assinatura não encontrado.</p>`;
      }

      form += createDateField("Data de Envio", data.data_envio, "data_envio");
      form += createSelectField("Status", ["enviado", "falhou", "ignorado"], data.status, "status");
      form += createTextField("Motivo", data.motivo || "", "motivo");
      break;

  }

  // ✅ Inclui botão salvar no final do formulário
  form += `<button id="modal-edit-save" style="margin-top:15px">💾 Salvar</button>`;
  document.getElementById("modal-edit-save").style.display = "none";

  body.innerHTML = form;

  if (subcolecao === "assinaturas") {
    await preencherComboTipoNewsletter();
    document.getElementById("tipo-newsletter-edicao").value = data.tipo_newsletter || "";
  }

  const btnSalvar = document.getElementById("modal-edit-save");
  btnSalvar.onclick = async () => {
    const payload = {};
    body.querySelectorAll("[data-field]").forEach((el) => {
      const field = el.dataset.field;

      if (field === "valor") {
        const valorLimpo = el.value.replace(/[^\d,]/g, "").replace(",", ".");
        const valorFinal = parseFloat(valorLimpo);
        if (!isNaN(valorFinal)) {
          payload[field] = valorFinal;
        }
      } else if (el.type === "date") {
        payload[field] = parseDateInput(el.value);
      } else {
        payload[field] = el.value;
      }
    });

    const path = subcolecao.split("/");
    let ref = db.collection("usuarios").doc(usuarioId);
    for (const segment of path) {
      ref = ref.collection(segment);
    }

    if (isEdit && docId) {
      await ref.doc(docId).set(payload, { merge: true });
    } else {
      if (subcolecao === "preferencias_newsletter" && payload.tipo) {
        const tipo = payload.tipo;
        delete payload.tipo;
        await ref.doc(tipo).set({ ativo: true });
      } else {
        await ref.add(payload);
      }
    }

    abrirSubcolecao(usuarioId, subcolecao);
  };
}



/* ====================
   NOVA SEÇÃO: TIPO_NEWSLETTERS (CRUD)
   coleção: tipo_NewsLetters  (campos: nome)
   ==================== */

async function carregarTipoNewsLetters() {
  const tbody = document.getElementById('lista-tipo-newsletters');
  if (!tbody) return;
  tbody.innerHTML = '';
  const snap = await db.collection('tipo_newsletters').orderBy('nome').get();
  snap.forEach(doc => {
    const d = doc.data() || {};
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${d.nome || ''}</td>
      <td>${d.is_newsletter ? '✅' : '❌'}</td>
      <td>
        <span class="icon-btn" title="Editar" onclick="abrirModalTipoNewsletter('${doc.id}', true)">✏️</span>
        <span class="icon-btn" title="Excluir" onclick="confirmarExclusaoTipoNewsletter('${doc.id}','${(d.nome || '').replace(/'/g, "\\'")}')">🗑️</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}



function filtrarTipoNewsletters() {
  const filtro = document.getElementById('busca-tipo-newsletters').value.toLowerCase();
  document.querySelectorAll('#lista-tipo-newsletters tr').forEach(tr => {
    tr.style.display = Array.from(tr.children).some(td => td.innerText.toLowerCase().includes(filtro)) ? '' : 'none';
  });
}


function confirmarExclusaoTipoNewsletter(id, nome) {
  abrirConfirmacao(`Deseja excluir o tipo de newsletter "${nome}"?`, async () => {
    await db.collection('tipo_newsletters').doc(id).delete();
    carregarTipoNewsLetters();
  });
}

async function abrirModalTipoNewsletter(docId = null, isEdit = false) {
  const title = document.getElementById('modal-edit-title');
  const body = document.getElementById('modal-edit-body');
  document.getElementById("modal-edit-save").style.display = "inline-block";
  title.innerText = isEdit ? 'Editar Tipo de Newsletter' : 'Novo Tipo de Newsletter';
  body.innerHTML = '';

  let data = {};
  if (isEdit && docId) {
    const snap = await db.collection('tipo_newsletters').doc(docId).get();
    data = snap.exists ? snap.data() : {};
  }

  // campo nome
  body.appendChild(generateTextField('nome', data.nome || ''));

  // campo is_newsletter
  body.appendChild(generateCheckboxField('is_newsletter', 'É uma newsletter?', data.is_newsletter || false));

  // save handler
  document.getElementById('modal-edit-save').onclick = async () => {
    const payload = {};
    body.querySelectorAll('[data-field-name]').forEach(el => {
      payload[el.dataset.fieldName] = el.type === 'checkbox' ? el.checked : el.value;
    });

    if (isEdit && docId) {
      await db.collection('tipo_newsletters').doc(docId).set(payload, { merge: true });
    } else {
      await db.collection('tipo_newsletters').add(payload);
    }

    closeModal('modal-edit-overlay');
    carregarTipoNewsLetters();
  };

  openModal('modal-edit-overlay');
}

function generateCheckboxField(fieldName, label, checked = false) {
  const wrapper = document.createElement("div");
  wrapper.className = "form-group";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = fieldName;
  checkbox.dataset.fieldName = fieldName;
  checkbox.checked = checked;

  const checkboxLabel = document.createElement("label");
  checkboxLabel.htmlFor = fieldName;
  checkboxLabel.innerText = label;
  checkboxLabel.style.marginLeft = "8px";

  wrapper.appendChild(checkbox);
  wrapper.appendChild(checkboxLabel);

  return wrapper;
}


async function mostrarVisaoGeral(userId) {
  const container = document.getElementById("visaoGeralContainer");
  container.innerHTML = `<p>Carregando dados...</p>`;

  // Buscar dados do usuário
  let nomeUsuario = userId;
  let email = "";
  let perfil = "";
  let ativo = "";
  let dataCadastro = "";

  try {
    const doc = await db.collection("usuarios").doc(userId).get();
    if (doc.exists) {
      const dados = doc.data();
      nomeUsuario = dados.nome || userId;
      email = dados.email || "";
      perfil = dados.tipo_perfil || "";
      ativo = dados.ativo ? "Ativo" : "Inativo";

      if (dados.data_cadastro?.toDate) {
        const d = dados.data_cadastro.toDate();
        dataCadastro = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      }
    }
  } catch (err) {
    console.warn("Erro ao buscar dados do usuário:", err);
  }

  // Cabeçalho
  let html = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
      <div style="text-align:left;">
        <h3 style="margin:0;">🔍 Visão geral de ${nomeUsuario}</h3>
        <div style="margin-top:4px; font-size:14px; color:#555;">e-mail: ${email}</div>
        <div style="margin-top:4px; font-size:14px; color:#555;">Perfil: ${perfil}</div>
        <div style="margin-top:4px; font-size:14px; color:#555;">Situação: ${ativo}</div>
        <div style="margin-top:4px; font-size:14px; color:#555;">Cadastro: ${dataCadastro}</div>
      </div>
      <button onclick="fecharVisaoGeral()" style="padding:6px 12px; background:#c00; color:#fff; border:none; border-radius:4px; height:36px;">Fechar</button>
    </div>
  `;

  // Subcoleções
  const subcolecoes = ["assinaturas", "logs_acesso", "pagamentos", "preferencias_newsletter", "solicitacoes"];

  const icones = {
    assinaturas: "📑",
    logs_acesso: "📜",
    pagamentos: "💳",
    preferencias_newsletter: "📰",
    solicitacoes: "📬"
  };

  for (const sub of subcolecoes) {
    try {
      const snap = await db.collection(`usuarios/${userId}/${sub}`).get();
      const dadosSubcolecao = [];

      html += `
      <div style="margin-top:20px; padding:15px; border:1px solid #ccc; border-radius:8px; background:#f9f9f9;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h4 style="margin:0;">${icones[sub]} <span style="text-transform:capitalize;">${sub.replace("_", " ")}</span></h4>
          <div>
            <button onclick="toggleSubcolecao('${sub}')" style="margin-right:8px;" title="Mostrar ou ocultar dados de ${sub.replace('_', ' ')}">🔽</button>
            <button onclick="exportarSubcolecao('${sub}', '${userId}')" title="Exportar dados de ${sub.replace('_', ' ')} em JSON">📤</button>
          </div>
        </div>
        <div id="conteudo-${sub}">
    `;

      if (snap.empty) {
        html += `<p style="color:gray;">Nenhum dado encontrado.</p></div></div>`;
        continue;
      }

      for (const doc of snap.docs) {
        const dados = doc.data();
        dadosSubcolecao.push({ id: doc.id, ...dados });

        html += `<div style="margin-bottom:10px;"><strong>📄 ${doc.id}</strong><ul style="margin:5px 0 10px 15px;">`;
        for (const campo in dados) {
          let valor = dados[campo];

          if (campo.toLowerCase().includes("data") && valor?.toDate) {
            const d = valor.toDate();
            valor = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
          } else if (typeof valor === "number" && campo.toLowerCase().includes("valor")) {
            valor = valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
          } else {
            valor = JSON.stringify(valor);
          }

          html += `<li><strong>${campo}:</strong> ${valor}</li>`;
        }
        html += `</ul>`;

        // 🔁 Se for assinaturas, buscar subcoleção envios
        if (sub === "assinaturas") {
          const enviosSnap = await firebase.firestore()
            .collection(`usuarios/${userId}/assinaturas/${doc.id}/envios`)
            .get();

          if (enviosSnap.empty) {
            html += `<p style="color:gray; margin-left:15px;">Nenhum envio registrado para esta assinatura.</p>`;
          } else {
            html += `<p style="margin-left:15px;"><strong>📬 Envios:</strong></p><ul style="margin-left:30px;">`;

            for (const envioDoc of enviosSnap.docs) {
              const envio = envioDoc.data();

              html += `<li style="margin-bottom:8px;"><ul style="margin-left:15px;">`;

              for (const campo in envio) {
                if (campo === "resposta_html_enviada") continue;

                let valor = envio[campo];

                // 🔍 Substituir id_edicao por dados da newsletter
                if (campo === "id_edicao" && typeof valor === "string") {
                  try {
                    const newsletterSnap = await db.collection("newsletters").doc(valor).get();
                    if (newsletterSnap.exists) {
                      const newsletter = newsletterSnap.data();
                      valor = `${newsletter.tipo || ""} – ${newsletter.titulo || ""} (Edição ${newsletter.edicao || ""})`;
                    } else {
                      valor = "(edição não encontrada)";
                    }
                  } catch (err) {
                    valor = "(erro ao buscar edição)";
                  }
                } else if (campo.toLowerCase().includes("data") && valor?.toDate) {
                  const d = valor.toDate();
                  valor = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
                } else {
                  valor = JSON.stringify(valor);
                }

                html += `<li><strong>${campo}:</strong> ${valor}</li>`;
              }

              html += `</ul></li>`;
            }

            html += `</ul>`;
          }

        }

        html += `</div>`; // fecha bloco da assinatura
      }


      html += `</div></div>`; // fecha conteúdo e bloco da subcoleção
    } catch (err) {
      html += `<p style="color:red;">Erro ao carregar ${sub}: ${err.message}</p>`;
    }
  }
  // Exibir tudo
  container.innerHTML = html;
}

function toggleSubcolecao(sub) {
  const el = document.getElementById(`conteudo-${sub}`);
  if (el) {
    el.style.display = el.style.display === "none" ? "block" : "none";
  }
}

function exportarSubcolecao(sub, userId) {
  db.collection(`usuarios/${userId}/${sub}`).get().then(snap => {
    const dados = [];
    snap.forEach(doc => {
      dados.push({ id: doc.id, ...doc.data() });
    });

    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sub}-${userId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }).catch(err => {
    mostrarMensagem("Erro ao exportar: " + err.message);
  });
}

async function preencherComboTipoNewsletter() {
  const select = document.getElementById("tipo-newsletter-edicao");
  if (!select) return;

  select.innerHTML = '<option value="">Selecione</option>';

  const tiposSnap = await db.collection("tipo_newsletters").get();
  tiposSnap.forEach(doc => {
    const nome = doc.data().nome?.trim();
    if (nome) {
      const opt = document.createElement("option");
      opt.value = nome;
      opt.innerText = nome;
      select.appendChild(opt);
    }
  });
}


function fecharVisaoGeral() {
  document.getElementById("visaoGeralContainer").innerHTML = "";
}

function abrirModalResposta(usuarioId, solicitacaoId, novoStatus) {
  solicitacaoResposta.usuarioId = usuarioId;
  solicitacaoResposta.solicitacaoId = solicitacaoId;
  solicitacaoResposta.novoStatus = novoStatus;

  const campo = document.getElementById("campo-resposta");
  const titulo = document.getElementById("modal-resposta-titulo");
  const modal = document.getElementById("modal-resposta-overlay");

  if (!campo || !titulo || !modal) {
    mostrarMensagem("Erro: elementos do modal de resposta não encontrados.");
    return;
  }

  campo.value = "";
  titulo.innerText = novoStatus === "atendida"
    ? "💬 Responder Solicitação (Atendida)"
    : "💬 Responder Solicitação (Cancelada)";

  // Garantir que o modal seja reexibido corretamente
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}


function fecharModalResposta() {
  const modal = document.getElementById("modal-resposta-overlay");
  if (modal) {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  }
}


function confirmarRespostaSolicitacao() {
  const resposta = document.getElementById("campo-resposta").value.trim();
  if (!resposta) {
    mostrarMensagem("Por favor, escreva uma resposta.");
    return;
  }

  db.collection("usuarios")
    .doc(solicitacaoResposta.usuarioId)
    .collection("solicitacoes")
    .doc(solicitacaoResposta.solicitacaoId)
    .update({
      status: solicitacaoResposta.novoStatus,
      resposta: resposta
    })
    .then(() => {
      fecharModalResposta();
      abrirSubcolecao(solicitacaoResposta.usuarioId, "solicitacoes");
    })
    .catch(error => {
      console.error("Erro ao salvar resposta:", error);
      mostrarMensagem("Erro ao atualizar a solicitação.");
    });
}



/* ====================
   EXPORTA PARA GLOBAL
   ==================== */
window.carregarPlanos = carregarPlanos;
window.carregarNewsletters = carregarNewsletters;
window.carregarUsuariosComFiltro = carregarUsuariosComFiltro;

window.confirmarExclusaoPlano = confirmarExclusaoPlano;
window.confirmarExclusaoNewsletter = confirmarExclusaoNewsletter;
window.confirmarExclusaoUsuario = confirmarExclusaoUsuario;
window.abrirConfirmacao = abrirConfirmacao;
window.abrirSubcolecao = abrirSubcolecao;
//window.abrirModalSubItem = abrirModalSubItem;

window.carregarTipoNewsLetters = carregarTipoNewsLetters;
window.confirmarExclusaoTipoNewsletter = confirmarExclusaoTipoNewsletter;
window.abrirModalTipoNewsletter = abrirModalTipoNewsletter;
window.filtrarTipoNewsletters = filtrarTipoNewsletters;
