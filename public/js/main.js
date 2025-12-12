/* ======================
   CONFIG FIREBASE
   ====================== */
const firebaseConfig = {
  apiKey: "AIzaSyDcS4nneXnN8Cdb-S_cQukwaguLXJYbQ1U",
  authDomain: "radarsiope.firebaseapp.com",
  projectId: "radarsiope"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();


let filtroAvaliacao = "todos";
let filtroTipoSolicitacao = "todos";
let filtroPeriodoAvaliacoes = "todos";
let filtroPerfilAvaliacoes = "todos";

const momentosEnvio = [
  { valor: "primeiro_contato", descricao: "📩 Primeiro contato via formulário de captura" },
  { valor: "pos_envio_newsletter_1", descricao: "📰 Após envio da 1ª edição da newsletter" },
  { valor: "pos_envio_newsletter_2", descricao: "📰 Após envio da 2ª edição da newsletter" },
  { valor: "sem_interacao_7_dias", descricao: "⏳ Sem interação por 7 dias" },
  { valor: "interesse_capacitacao", descricao: "🎓 Interesse marcado: Capacitação" },
  { valor: "interesse_consultoria", descricao: "🧭 Interesse marcado: Consultoria" },
  { valor: "interesse_siope", descricao: "📊 Interesse marcado: SIOPE" },
  { valor: "resposta_personalizada_manual", descricao: "✍️ Resposta manual personalizada" },
  { valor: "padrao", descricao: "📌 Resposta padrão para envio manual" }
];


function filtrarPerfilAvaliacoes(perfil) {
  filtroPerfilAvaliacoes = perfil;
  carregarRelatorioAvaliacoes();
}

function filtrarPeriodoAvaliacoes(dias) {
  filtroPeriodoAvaliacoes = dias;
  carregarRelatorioAvaliacoes();
}

function filtrarAvaliacoes(tipo) {
  filtroAvaliacao = tipo;
  carregarRelatorioAvaliacoes();
}

function filtrarTipoSolicitacao(tipo) {
  filtroTipoSolicitacao = tipo;
  carregarRelatorioAvaliacoes();
}

function formatarData(dataStr) {
  if (!dataStr) return "-";
  const d = new Date(dataStr);
  if (isNaN(d)) return dataStr;
  return d.toLocaleString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/* ======================
   CRUD USUÁRIOS
   ====================== */

async function abrirModalCriarUsuario(dadosIniciais = {}, leadId = null) {
  const body = document.getElementById('modal-edit-body');
  body.innerHTML = '';
  document.getElementById('modal-edit-title').innerText = 'Novo Usuário';

  body.appendChild(generateTextField('nome', dadosIniciais.nome || ''));
  body.appendChild(generateTextField('email', dadosIniciais.email || ''));
  body.appendChild(generateDomainSelect('tipo_perfil', ['secretario', 'tecnico', 'cidadao', 'contador', 'CACS'], dadosIniciais.tipo_perfil || 'contador'));

  // ✅ Insere os campos UF e Município e guarda a função de validação
  const validarLocalizacao = await inserirCamposUfMunicipio(body, dadosIniciais.cod_uf, dadosIniciais.cod_municipio);

  body.appendChild(generateBooleanSelect('ativo', true));

  openModal('modal-edit-overlay');

  document.getElementById('modal-edit-save').onclick = async () => {
    const fields = body.querySelectorAll('[data-field-name]');
    let data = {};
    fields.forEach(f => {
      let val = f.value;
      if (f.tagName === 'SELECT' && (val === 'true' || val === 'false')) val = (val === 'true');
      data[f.dataset.fieldName] = val;
    });

    // Captura UF e Município
    const cod_uf = document.getElementById("uf").value;
    const municipioSelect = document.getElementById("municipio");
    const cod_municipio = municipioSelect.value;
    const nome_municipio = municipioSelect.options[municipioSelect.selectedIndex]?.textContent || null;

    // ✅ Valida e coleta UF e Município
    const localizacao = validarLocalizacao();
    if (!localizacao) return;

    data.cod_uf = cod_uf;
    data.cod_municipio = cod_municipio;
    data.nome_municipio = nome_municipio;

    document.getElementById("uf").style.border = "1px solid #ccc";
    document.getElementById("municipio").style.border = "1px solid #ccc";

    // Verifica duplicidade de e-mail
    const email = data.email?.trim().toLowerCase();
    if (!email) {
      alert("E-mail é obrigatório.");
      return;
    }

    const snap = await db.collection("usuarios").where("email", "==", email).limit(1).get();
    if (!snap.empty) {
      alert("Já existe um usuário cadastrado com este e-mail.");
      return;
    }

    data.data_cadastro = new Date();
    data.nome_lowercase = dadosIniciais.nome ? dadosIniciais.nome.toLowerCase() : "";

    const novoUsuarioRef = await db.collection('usuarios').add(data);
    const usuarioId = novoUsuarioRef.id;

    if (leadId) {
      await db.collection("leads").doc(leadId).update({
        usuario_vinculado: {
          id: usuarioId,
          nome: data.nome,
          email: data.email,
          data_vinculo: new Date()
        },
        status: "Convertido"
      });

      const usuarioLogado = JSON.parse(localStorage.getItem("usuarioLogado"));
      const feitoPor = usuarioLogado?.nome || usuarioLogado?.email || "Desconhecido";

      await db.collection("leads").doc(leadId).collection("interacoes").add({
        tipo: "vinculacao",
        feito_por: feitoPor,
        data: new Date(),
        usuario_vinculado: {
          id: usuarioId,
          nome: data.nome
        }
      });

      document.getElementById("modal-vincular-lead").style.display = "none";
      carregarLeads();
      alert("✅ Usuário criado e lead vinculado com sucesso!");
    } else {
      carregarUsuariosComFiltro();
      alert("✅ Usuário criado com sucesso!");
    }

    closeModal('modal-edit-overlay');
  };
}

async function abrirModalEditarUsuario(id) {
  document.getElementById("modal-edit-save").style.display = "inline-block";

  const doc = await db.collection('usuarios').doc(id).get();
  const d = doc.data();
  const body = document.getElementById('modal-edit-body');
  body.innerHTML = '';
  document.getElementById('modal-edit-title').innerText = 'Editar Usuário';

  body.appendChild(generateTextField('nome', d.nome));
  body.appendChild(generateTextField('email', d.email));
  body.appendChild(generatePasswordField('senha', d.senha)); // 🔐 novo campo
  body.appendChild(generateDomainSelect('tipo_perfil', ['secretario', 'tecnico', 'contador', 'pesquisador', 'cacs', 'cidadao'], d.tipo_perfil));
  const validarLocalizacao = await inserirCamposUfMunicipio(body, d.cod_uf, d.cod_municipio);
  body.appendChild(generateBooleanSelect('ativo', d.ativo));

  openModal('modal-edit-overlay');
  document.getElementById("modal-edit-save").style.display = "inline-block";

  document.getElementById('modal-edit-save').onclick = async () => {
    const fields = body.querySelectorAll('[data-field-name]');
    let data = {};
    fields.forEach(f => {
      let val = f.value;
      if (f.tagName === 'SELECT' && (val === 'true' || val === 'false')) val = (val === 'true');
      data[f.dataset.fieldName] = val;
    });
    // 🔍 Verifica se o e-mail já está em uso por outro usuário
    const email = data.email?.trim().toLowerCase();
    if (!email) {
      alert("E-mail é obrigatório.");
      return;
    }

    const snap = await db.collection("usuarios").where("email", "==", email).limit(1).get();
    if (!snap.empty) {
      const usuarioEncontrado = snap.docs[0];
      if (usuarioEncontrado.id !== id) {
        alert("Já existe outro usuário cadastrado com este e-mail.");
        return;
      }
    }

    const localizacao = validarLocalizacao();
    if (!localizacao) return;

    data.cod_uf = localizacao.cod_uf;
    data.cod_municipio = localizacao.cod_municipio;
    data.nome_municipio = localizacao.nome_municipio;
    data.nome_lowercase = data.nome ? data.nome.toLowerCase() : "";

    await db.collection('usuarios').doc(id).update(data);
    closeModal('modal-edit-overlay');
    carregarUsuariosComFiltro();
  };
}

function confirmarExclusaoUsuario(id, nome) {
  abrirConfirmacao(`Deseja excluir o usuário "${nome}"?`, async () => {
    await db.collection('usuarios').doc(id).delete();
    carregarUsuariosComFiltro();
  });
}

/* ======================
   MODAL PLANOS
   ====================== */
async function abrirModalPlano(id, editar = false) {
  const body = document.getElementById('modal-edit-body'); body.innerHTML = '';
  document.getElementById('modal-edit-title').innerText = editar ? 'Editar Plano' : 'Novo Plano';
  document.getElementById("modal-edit-save").style.display = "inline-block";

  let dados = {};
  if (editar) {
    const doc = await db.collection('planos').doc(id).get();
    dados = doc.data();
  }

  body.appendChild(generateTextField('nome', dados.nome));
  body.appendChild(generateTextArea('descricao', dados.descricao));
  body.appendChild(generateTextField('qtde_parcelas', dados.qtde_parcelas));
  body.appendChild(generateDomainSelect('tipo', ['consultoria', 'assinatura', 'capacitação'], dados.tipo));
  body.appendChild(generateTextField('valor', dados.valor));
  body.appendChild(generateDomainSelect('status', ['ativo', 'inativo'], dados.status));

  openModal('modal-edit-overlay');
  document.getElementById('modal-edit-save').onclick = async () => {
    const fields = body.querySelectorAll('[data-field-name]');
    let data = {}; fields.forEach(f => data[f.dataset.fieldName] = f.value);
    if (editar) await db.collection('planos').doc(id).update(data);
    else await db.collection('planos').add(data);
    closeModal('modal-edit-overlay'); carregarPlanos();
  };
}

/* ======================
   MODAL NEWSLETTERS
   ====================== */
async function abrirModalNewsletter(docId = null, isEdit = false) {
  const title = document.getElementById('modal-edit-title');
  title.innerText = isEdit ? 'Editar Newsletter' : 'Nova Newsletter';
  document.getElementById("modal-edit-save").style.display = "inline-block";

  const body = document.getElementById('modal-edit-body');
  body.innerHTML = '';

  // -----------------------------
  // ✅ Carrega dados da edição
  // -----------------------------
  let data = {};
  if (isEdit && docId) {
    const snap = await db.collection('newsletters').doc(docId).get();
    data = snap.exists ? snap.data() : {};
  }

  // ✅ Se estiver editando e houver blocos, carrega depois que o DOM montar
  if (isEdit && data.blocos) {
    setTimeout(() => carregarBlocosDaEdicao(data), 50);
  }

  // -----------------------------
  // ✅ Campos principais
  // -----------------------------
  body.appendChild(generateDateInput('data_publicacao', data.data_publicacao ? data.data_publicacao.toDate() : null));
  body.appendChild(generateTextField('edicao', data.edicao));
  body.appendChild(generateTextField('titulo', data.titulo));

  const tiposSnap = await db.collection("tipo_newsletters").get();
  const tiposArr = tiposSnap.docs.map(doc => doc.data().nome).filter(Boolean);
  body.appendChild(generateDomainSelect("tipo", tiposArr, data.tipo));
  body.appendChild(generateDomainSelect('classificacao', ['Básica', 'Premium'], data.classificacao || 'Básica'));

  // -----------------------------
  // ✅ HTML principal
  // -----------------------------
  const htmlWrap = document.createElement('div');
  htmlWrap.className = 'field';

  const explicacao = document.createElement('div');
  explicacao.innerHTML = `
    <div class="info-box" style="background:#eef; padding:10px; border-left:4px solid #88f; margin-bottom:10px;">
      <strong>📌 Placeholders disponíveis:</strong>
      <ul style="margin-top:5px; font-size:14px;">
        <li><code>{{nome}}</code> → Nome do usuário</li>
        <li><code>{{email}}</code> → E-mail do usuário</li>
        <li><code>{{edicao}}</code> → Número da edição</li>
        <li><code>{{tipo}}</code> → Tipo Newsletter</li>
        <li><code>{{titulo}}</code> → Título da edição</li>
        <li><code>{{data_publicacao}}</code> → Data da edição (formato DD/MM/AAAA)</li>
        <li><code>{{blocos}}</code> → Local de inserção dos blocos</li>
      </ul>
      <p>Esses campos serão substituídos automaticamente no momento do envio.</p>
    </div>`;
  htmlWrap.appendChild(explicacao);

  // -----------------------------
  // ✅ Filtros de template
  // -----------------------------
  const filtroWrap = document.createElement('div');
  filtroWrap.style.marginTop = '10px';
  filtroWrap.style.display = 'flex';
  filtroWrap.style.gap = '10px';

  const filtroTipo = document.createElement('select');
  filtroTipo.id = 'filtro-tipo-template';
  filtroTipo.style.flex = '1';
  filtroTipo.innerHTML = `<option value="">Filtrar por tipo</option>`;
  tiposArr.forEach(tipo => {
    filtroTipo.innerHTML += `<option value="${tipo}">${tipo}</option>`;
  });
  filtroWrap.appendChild(filtroTipo);

  const filtroClassificacao = document.createElement('select');
  filtroClassificacao.id = 'filtro-classificacao-template';
  filtroClassificacao.style.flex = '1';
  filtroClassificacao.innerHTML = `
    <option value="">Filtrar por classificação</option>
    <option value="Básica">Básica</option>
    <option value="Premium">Premium</option>
  `;
  filtroWrap.appendChild(filtroClassificacao);
  htmlWrap.appendChild(filtroWrap);

  // -----------------------------
  // ✅ Seletor de template
  // -----------------------------
  const seletorTemplate = document.createElement('select');
  seletorTemplate.id = 'seletor-template-newsletter';
  seletorTemplate.style.width = '100%';
  seletorTemplate.style.marginTop = '10px';
  htmlWrap.appendChild(seletorTemplate);

  const todosTemplates = [];
  const templatesSnap = await db.collection('templates_newsletter').orderBy('nome').get();
  templatesSnap.forEach(doc => {
    const d = doc.data();
    todosTemplates.push({ id: doc.id, ...d });
  });

  function atualizarListaTemplates() {
    const tipoSelecionado = filtroTipo.value;
    const classifSelecionada = filtroClassificacao.value;

    seletorTemplate.innerHTML = `<option value="">Selecione um template para carregar HTML</option>`;
    todosTemplates.forEach(t => {
      const matchTipo = !tipoSelecionado || t.tipo === tipoSelecionado;
      const matchClassif = !classifSelecionada || t.classificacao === classifSelecionada;
      if (matchTipo && matchClassif) {
        seletorTemplate.innerHTML += `<option value="${t.id}">${t.nome}</option>`;
      }
    });
  }

  filtroTipo.onchange = atualizarListaTemplates;
  filtroClassificacao.onchange = atualizarListaTemplates;
  atualizarListaTemplates();

  // -----------------------------
  // ✅ Botão: carregar template
  // -----------------------------
  const btnCarregarTemplate = document.createElement('button');
  btnCarregarTemplate.innerText = '📥 Carregar HTML do Template';
  btnCarregarTemplate.style.marginTop = '10px';
  btnCarregarTemplate.onclick = async () => {
    const templateId = document.getElementById('seletor-template-newsletter')?.value;
    if (!templateId) return alert("Selecione um template.");

    const snap = await db.collection('templates_newsletter').doc(templateId).get();
    if (!snap.exists) return alert("Template não encontrado.");

    const template = snap.data();
    const campoHTML = document.getElementById('campo-html-newsletter');
    campoHTML.value = template.html_base || '';

    // ✅ Carrega blocos do template
    if (template.blocos) {
      carregarBlocosDoTemplateNaEdicao(templateId);
    }
  };
  htmlWrap.appendChild(btnCarregarTemplate);

  // -----------------------------
  // ✅ Campo HTML principal
  // -----------------------------
  const lbl = document.createElement('label');
  lbl.innerText = 'Conteudo do HTML';
  lbl.style.marginTop = "15px";
  htmlWrap.appendChild(lbl);
  const ta = document.createElement('textarea');
  ta.rows = 8;
  ta.style.width = '100%';
  ta.dataset.fieldName = 'html_conteudo';
  ta.id = 'campo-html-newsletter';
  ta.value = data.html_conteudo || '';
  htmlWrap.appendChild(ta);

  // -----------------------------
  // ✅ Botões auxiliares (preview avançado, copiar, pixel, click, descadastramento)
  // -----------------------------

  // Dados de exemplo para placeholders
  function montarDadosPreviewNewsletter() {
    return {
      nome: "Fulano de Teste",
      email: "fulano@exemplo.com",
      edicao: document.querySelector('[data-field-name="edicao"]')?.value || "",
      tipo: document.querySelector('[data-field-name="tipo"]')?.value || "",
      titulo: document.querySelector('[data-field-name="titulo"]')?.value || "",
      data_publicacao: document.querySelector('[data-field-name="data_publicacao"]')?.value
        ? new Date(document.querySelector('[data-field-name="data_publicacao"]').value + "T00:00:00")
        : null
    };
  }

  // ✅ Função principal de montagem do HTML da edição
  function montarHtmlNewsletterPreview(modo = "completo", segmento = null, comBordas = false) {
    const dados = montarDadosPreviewNewsletter();

    // HTML base vindo do campo da edição
    let htmlBase = document.getElementById('campo-html-newsletter').value || "";
    const blocos = coletarBlocosEdicao() || [];

    let htmlBlocos = "";

    if (blocos.length > 0 && modo !== "puro") {
      blocos.forEach((b, i) => {
        // Filtragem por segmento (lead / assinante)
        if (segmento && b.acesso !== "todos" && b.acesso !== segmento) {
          return; // pula bloco que não pertence a esse segmento
        }

        if (comBordas) {
          const cor =
            b.acesso === "assinantes" ? "#2e7d32" :
              b.acesso === "leads" ? "#ff9800" :
                "#1976d2";

          htmlBlocos += `
            <div style="border:2px dashed ${cor}; padding:10px; margin:15px 0; border-radius:6px;">
              <div style="font-size:12px; color:${cor}; margin-bottom:5px;">
                <strong>Bloco ${i + 1}</strong> — acesso: ${b.acesso}
              </div>
              ${b.html || ""}
            </div>
          `;
        } else {
          htmlBlocos += b.html || "";
        }
      });
    } else if (blocos.length > 0 && modo === "puro") {
      // modo "puro" com blocos: só concatena blocos filtrados por segmento
      blocos.forEach(b => {
        if (segmento && b.acesso !== "todos" && b.acesso !== segmento) {
          return;
        }
        htmlBlocos += b.html || "";
      });
    }

    let htmlFinal = "";

    if (blocos.length === 0) {
      // ✅ Sem blocos: usa só o HTML da edição
      htmlFinal = htmlBase;
    } else {
      // ✅ Com blocos: insere no {{blocos}} se existir, senão no final
      if (htmlBase.includes("{{blocos}}")) {
        htmlFinal = htmlBase.replace("{{blocos}}", htmlBlocos);
      } else {
        htmlFinal = htmlBase + "\n" + htmlBlocos;
      }
    }

    // Aplica placeholders APENAS se não for "puro"
    if (modo !== "puro") {
      htmlFinal = aplicarPlaceholders(htmlFinal, dados);
    }

    return htmlFinal;
  }

  // ✅ Preview completo (com todos os blocos, numerados e com bordas)
  const btnPreview = document.createElement('button');
  btnPreview.innerText = '👁️ Visualizar HTML (com blocos)';
  btnPreview.style.marginTop = '10px';
  btnPreview.type = "button";
  btnPreview.onclick = () => {
    const iframe = document.getElementById('iframe-html-preview');
    iframe.srcdoc = montarHtmlNewsletterPreview("completo", null, true);
    openModal('modal-html-preview');
  };
  htmlWrap.appendChild(btnPreview);

  // ✅ Preview como Lead
  const btnPreviewLead = document.createElement('button');
  btnPreviewLead.innerText = '👤 Visualizar como Lead';
  btnPreviewLead.style.marginLeft = '10px';
  btnPreviewLead.style.marginTop = '10px';
  btnPreviewLead.type = "button";
  btnPreviewLead.onclick = () => {
    const iframe = document.getElementById('iframe-html-preview');
    iframe.srcdoc = montarHtmlNewsletterPreview("segmentado", "leads", false);
    openModal('modal-html-preview');
  };
  htmlWrap.appendChild(btnPreviewLead);

  // ✅ Preview como Assinante
  const btnPreviewAssinante = document.createElement('button');
  btnPreviewAssinante.innerText = '⭐ Visualizar como Assinante';
  btnPreviewAssinante.style.marginLeft = '10px';
  btnPreviewAssinante.style.marginTop = '10px';
  btnPreviewAssinante.type = "button";
  btnPreviewAssinante.onclick = () => {
    const iframe = document.getElementById('iframe-html-preview');
    iframe.srcdoc = montarHtmlNewsletterPreview("segmentado", "assinantes", false);
    openModal('modal-html-preview');
  };
  htmlWrap.appendChild(btnPreviewAssinante);

  // ✅ Preview HTML puro (sem placeholders, sem bordas, só resultado final com blocos)
  const btnPreviewPuro = document.createElement('button');
  btnPreviewPuro.innerText = '🧪 Visualizar HTML puro';
  btnPreviewPuro.style.marginLeft = '10px';
  btnPreviewPuro.style.marginTop = '10px';
  btnPreviewPuro.type = "button";
  btnPreviewPuro.onclick = () => {
    const iframe = document.getElementById('iframe-html-preview');
    iframe.srcdoc = montarHtmlNewsletterPreview("puro", null, false);
    openModal('modal-html-preview');
  };
  htmlWrap.appendChild(btnPreviewPuro);

  // ✅ Copiar HTML
  const btnCopiar = document.createElement('button');
  btnCopiar.innerText = '📋 Copiar HTML';
  btnCopiar.style.marginLeft = '10px';
  btnCopiar.style.marginTop = '10px';
  btnCopiar.onclick = () => {
    navigator.clipboard.writeText(ta.value)
      .then(() => alert("HTML copiado!"))
      .catch(() => alert("Erro ao copiar."));
  };
  htmlWrap.appendChild(btnCopiar);

  // ✅ Pixel
  const btnPixel = document.createElement('button');
  btnPixel.innerText = '➕ Pixel';
  btnPixel.style.marginLeft = '10px';
  btnPixel.onclick = () => {
    const texto = `
    <img src="https://api.radarsiope.com.br/api/pixel?newsletter={{newsletterId}}&email={{email}}" 
         width="1" height="1" style="display:none" alt="pixel" />
    `;
    if (!ta.value.includes("api/pixel")) ta.value += "\n" + texto;
  };
  htmlWrap.appendChild(btnPixel);

  // ✅ Click
  const btnClick = document.createElement('button');
  btnClick.innerText = '➕ Click';
  btnClick.style.marginLeft = '10px';
  btnClick.onclick = () => {
    let destino = prompt("Informe o link:", "https://www.radarsiope.com.br/");
    if (!destino) destino = "https://www.radarsiope.com.br/";
    if (!destino.startsWith("http")) destino = "https://" + destino;

    const texto = `
    <a href="https://api.radarsiope.com.br/api/click?envioId={{envioId}}&destinatarioId={{destinatarioId}}&newsletterId={{newsletterId}}&url=${encodeURIComponent(destino)}">
      Clique aqui para acessar o conteúdo
    </a>
    `;
    if (!ta.value.includes("api/click")) ta.value += "\n" + texto;
  };
  htmlWrap.appendChild(btnClick);

  // ✅ Descadastramento
  const btnDescadastramento = document.createElement('button');
  btnDescadastramento.innerText = '➕ Descadastramento';
  btnDescadastramento.style.marginLeft = '10px';
  btnDescadastramento.onclick = () => {
    const texto = `
    <p style="font-size:12px; color:#888; margin-top:30px">
      Não deseja mais receber nossas newsletters?
      <a href="https://api.radarsiope.com.br/descadastramento.html?email={{email}}&newsletter={{newsletterId}}&titulo={{titulo}}">
        Clique aqui para se descadastrar
      </a>.
    </p>
    `;
    if (!ta.value.includes("Clique aqui para se descadastrar")) ta.value += "\n" + texto;
  };
  htmlWrap.appendChild(btnDescadastramento);

  body.appendChild(htmlWrap);

  // -----------------------------
  // ✅ SEÇÃO NOVA: BLOCOS DA EDIÇÃO
  // -----------------------------
  const tituloBlocos = document.createElement('h4');
  tituloBlocos.innerText = "Blocos da Newsletter (opcional)";
  tituloBlocos.style.marginTop = "20px";
  body.appendChild(tituloBlocos);

  const descBlocos = document.createElement('p');
  descBlocos.style.fontSize = "13px";
  descBlocos.style.color = "#555";
  descBlocos.innerHTML = `
    Se você usar blocos, o HTML acima será ignorado no envio.<br>
    Cada bloco pode ser exibido para: <strong>Todos</strong>, <strong>Leads</strong> ou <strong>Assinantes</strong>.
  `;
  body.appendChild(descBlocos);

  const btnAddBloco = document.createElement('button');
  btnAddBloco.type = "button";
  btnAddBloco.innerText = "➕ Adicionar bloco";
  btnAddBloco.style.marginBottom = "10px";
  btnAddBloco.onclick = () => adicionarBlocoEdicao();
  body.appendChild(btnAddBloco);

  const containerBlocos = document.createElement('div');
  containerBlocos.id = "container-blocos-edicao";
  containerBlocos.style.border = "1px solid #ddd";
  containerBlocos.style.padding = "10px";
  containerBlocos.style.borderRadius = "4px";
  containerBlocos.style.maxHeight = "350px";
  containerBlocos.style.overflowY = "auto";
  body.appendChild(containerBlocos);

  // -----------------------------
  // ✅ Botão salvar
  // -----------------------------
  document.getElementById('modal-edit-save').onclick = async () => {
    const payload = {};

    body.querySelectorAll('[data-field-name]').forEach(el => {
      if (el.type === 'date') {
        payload[el.dataset.fieldName] = el.value
          ? firebase.firestore.Timestamp.fromDate(new Date(el.value + 'T00:00:00'))
          : null;
      } else {
        payload[el.dataset.fieldName] = el.value;
      }
    });

    // ✅ Coleta blocos da edição
    payload.blocos = coletarBlocosEdicao();

    // ✅ Validação universal
    const htmlNewsletter = payload['html_conteudo'] || "";
    const blocos = payload.blocos || [];

    if (!validarNewsletter(htmlNewsletter, blocos)) {
      return;
    }

    // ✅ Salva normalmente
    const ref = db.collection('newsletters');
    if (isEdit && docId) {
      await ref.doc(docId).set(payload, { merge: true });
    } else {
      await ref.add(payload);
    }

    closeModal('modal-edit-overlay');
    carregarNewsletters();
  };

  openModal('modal-edit-overlay');
}

function validarNewsletter(html, blocos) {
  const erros = validarHtmlEmail(html, blocos);

  if (erros.length > 0) {
    alert("⚠️ Problemas encontrados no HTML:\n\n" + erros.map(e => "• " + e).join("\n"));
    return false;
  }

  return true;
}


function validarHtmlEmail(html, blocos = []) {
  const erros = [];

  const htmlLower = html.toLowerCase().trim();

  // -----------------------------
  // 1. HTML vazio
  // -----------------------------
  if (!htmlLower) {
    erros.push("O HTML está vazio.");
    return erros;
  }

  // -----------------------------
  // 2. Verifica se há blocos mas não há {{blocos}}
  // -----------------------------
  if (blocos.length > 0 && !html.includes("{{blocos}}")) {
    erros.push("Existem blocos cadastrados, mas o HTML não contém o marcador {{blocos}}.");
  }

  // -----------------------------
  // 3. Verifica tabela principal
  // -----------------------------
  const idxTableOpen = htmlLower.indexOf("<table");
  const idxTableClose = htmlLower.lastIndexOf("</table>");

  if (idxTableOpen === -1 || idxTableClose === -1) {
    erros.push("O HTML precisa conter uma tabela principal (<table>...</table>).");
  }

  // -----------------------------
  // 4. Conteúdo fora da tabela principal
  // -----------------------------
  if (idxTableClose !== -1) {
    const afterTable = htmlLower.substring(idxTableClose + 8).trim();
    if (afterTable.length > 0) {
      erros.push("Há conteúdo fora da tabela principal. Todo o HTML deve estar dentro de <table>...</table>.");
    }
  }

  // -----------------------------
  // 5. Pixel dentro da tabela
  // -----------------------------
  if (html.includes("api.radarsiope.com.br/api/pixel") && idxTableClose !== -1) {
    const pixelPos = html.indexOf("api.radarsiope.com.br/api/pixel");
    if (pixelPos > idxTableClose) {
      erros.push("O pixel de rastreamento está fora da tabela principal.");
    }
  }

  // -----------------------------
  // 6. Link de click dentro da tabela
  // -----------------------------
  if (html.includes("api.radarsiope.com.br/api/click") && idxTableClose !== -1) {
    const clickPos = html.indexOf("api.radarsiope.com.br/api/click");
    if (clickPos > idxTableClose) {
      erros.push("O link de rastreamento de clique está fora da tabela principal.");
    }
  }

  // -----------------------------
  // 7. Descadastramento dentro da tabela
  // -----------------------------
  if (html.includes("descadastramento") && idxTableClose !== -1) {
    const descPos = html.indexOf("descadastramento");
    if (descPos > idxTableClose) {
      erros.push("O link de descadastramento está fora da tabela principal.");
    }
  }

  // -----------------------------
  // 8. Verifica tags <tr> mal fechadas
  // -----------------------------
  const qtdTrAbertas = (htmlLower.match(/<tr/g) || []).length;
  const qtdTrFechadas = (htmlLower.match(/<\/tr>/g) || []).length;
  if (qtdTrAbertas !== qtdTrFechadas) {
    erros.push(`Quantidade de <tr> abertas (${qtdTrAbertas}) e fechadas (${qtdTrFechadas}) não confere.`);
  }

  // -----------------------------
  // 9. Verifica tags <td> mal fechadas
  // -----------------------------
  const qtdTdAbertas = (htmlLower.match(/<td/g) || []).length;
  const qtdTdFechadas = (htmlLower.match(/<\/td>/g) || []).length;
  if (qtdTdAbertas !== qtdTdFechadas) {
    erros.push(`Quantidade de <td> abertas (${qtdTdAbertas}) e fechadas (${qtdTdFechadas}) não confere.`);
  }

  return erros;
}

function adicionarBlocoEdicao(bloco = {}) {
  const container = document.getElementById("container-blocos-edicao");
  if (!container) return;

  const wrapper = document.createElement("div");
  wrapper.className = "bloco-edicao";
  wrapper.style.border = "1px solid #ccc";
  wrapper.style.padding = "8px";
  wrapper.style.marginBottom = "8px";
  wrapper.style.borderRadius = "4px";
  wrapper.style.background = "#fafafa";

  // Título
  const inputTitulo = document.createElement("input");
  inputTitulo.type = "text";
  inputTitulo.placeholder = "Título do bloco (opcional)";
  inputTitulo.style.width = "100%";
  inputTitulo.style.marginBottom = "5px";
  inputTitulo.value = bloco.titulo || "";
  inputTitulo.dataset.blocoField = "titulo";
  wrapper.appendChild(inputTitulo);

  // Select de acesso
  const selectAcesso = document.createElement("select");
  selectAcesso.style.width = "100%";
  selectAcesso.style.marginBottom = "5px";
  selectAcesso.dataset.blocoField = "acesso";
  selectAcesso.innerHTML = `
    <option value="todos">Todos</option>
    <option value="leads">Somente leads</option>
    <option value="assinantes">Somente assinantes</option>
  `;
  selectAcesso.value = bloco.acesso || "todos";
  wrapper.appendChild(selectAcesso);

  // HTML do bloco
  const taBloco = document.createElement("textarea");
  taBloco.rows = 5;
  taBloco.style.width = "100%";
  taBloco.placeholder = "HTML do bloco...";
  taBloco.value = bloco.html || "";
  taBloco.dataset.blocoField = "html";
  wrapper.appendChild(taBloco);

  // Botão remover
  const btnRemover = document.createElement("button");
  btnRemover.type = "button";
  btnRemover.innerText = "Remover bloco";
  btnRemover.style.marginTop = "5px";
  btnRemover.style.background = "#bbb";
  btnRemover.onclick = () => container.removeChild(wrapper);
  wrapper.appendChild(btnRemover);

  container.appendChild(wrapper);
}

function coletarBlocosEdicao() {
  const container = document.getElementById("container-blocos-edicao");
  if (!container) return [];

  const blocos = [];
  const wrappers = container.querySelectorAll(".bloco-edicao");

  wrappers.forEach(w => {
    const bloco = {};
    w.querySelectorAll("[data-bloco-field]").forEach(el => {
      bloco[el.dataset.blocoField] = el.value;
    });

    const vazio =
      (!bloco.titulo || bloco.titulo.trim() === "") &&
      (!bloco.html || bloco.html.trim() === "");

    if (!vazio) {
      bloco.acesso = bloco.acesso || "todos";
      blocos.push(bloco);
    }
  });

  return blocos;
}

async function carregarBlocosDoTemplateNaEdicao(templateId) {
  const snap = await db.collection('templates_newsletter').doc(templateId).get();
  if (!snap.exists) return;

  const template = snap.data();
  const container = document.getElementById("container-blocos-edicao");
  container.innerHTML = "";

  if (Array.isArray(template.blocos)) {
    template.blocos.forEach(b => adicionarBlocoEdicao(b));
  }
}

function carregarBlocosDaEdicao(data) {
  const container = document.getElementById("container-blocos-edicao");
  container.innerHTML = "";

  if (Array.isArray(data.blocos)) {
    data.blocos.forEach(b => adicionarBlocoEdicao(b));
  }
}

// Funções auxiliares de validação e modal
function mostrarErros(erros) {
  const modal = document.getElementById("alert-modal");
  const lista = document.getElementById("alert-list");

  // Limpa lista
  lista.innerHTML = "";

  // Adiciona cada erro
  erros.forEach(err => {
    const li = document.createElement("li");
    li.textContent = err;
    lista.appendChild(li);
  });

  // Mostra modal
  modal.style.display = "flex";
}

function fecharModal() {
  document.getElementById("alert-modal").style.display = "none";
}

async function gerarRelatorioPreferencias() {
  const select = document.getElementById("filtro-cad-tipo-newsletter");
  const filtroSelecionado = select.value;

  // 🔄 Recria o combo se necessário
  if (select && select.options.length <= 1) {
    select.innerHTML = '<option value="">Todos</option>';

    const tiposSnap = await db.collection("tipo_newsletters").get();
    const nomesUnicos = new Set();

    tiposSnap.forEach(doc => {
      const data = doc.data();
      const nome = (data.nome || "").trim();
      if (nome && !nomesUnicos.has(nome.toLowerCase())) {
        nomesUnicos.add(nome.toLowerCase());

        const opt = document.createElement("option");
        opt.value = nome.toLowerCase();
        opt.innerText = nome;
        select.appendChild(opt);
      }
    });
  }

  // ✅ Lista de tipos únicos
  const tipos = Array.from(new Set(
    Array.from(select.options)
      .map(opt => opt.value)
      .filter(v => v && v !== "")
  ));

  const mapa = {};
  tipos.forEach(tipo => mapa[tipo] = []);

  const usuariosSnap = await db.collection("usuarios").get();
  const totalUsuarios = usuariosSnap.size;

  // 🔄 Cria barra de progresso
  let progressBar = document.getElementById("progress-relatorio");
  if (!progressBar) {
    progressBar = document.createElement("progress");
    progressBar.id = "progress-relatorio";
    progressBar.max = totalUsuarios;
    progressBar.value = 0;
    progressBar.style.width = "100%";
    progressBar.style.margin = "10px 0";
    select.parentNode.insertBefore(progressBar, select.nextSibling);
  }

  let processados = 0;

  for (const usuarioDoc of usuariosSnap.docs) {
    const usuarioId = usuarioDoc.id;
    const usuarioNome = usuarioDoc.data().nome || usuarioId;

    // 🔄 Executa consultas em paralelo
    const [prefsSnap, assinaturaSnap] = await Promise.all([
      db.collection("usuarios").doc(usuarioId).collection("preferencias_newsletter").get(),
      db.collection("usuarios").doc(usuarioId).collection("assinaturas").get()
    ]);

    const assinaturas = assinaturaSnap.docs.map(doc => doc.data());

    for (const doc of prefsSnap.docs) {
      const tipo = doc.id.toLowerCase();
      if (mapa[tipo]) {
        const assinaturaDoTipo = assinaturas.find(a => a.tipo_newsletter?.toLowerCase() === tipo);

        let planoNome = "(sem plano)";
        let status = "-";
        let dataInicio = "-";

        if (assinaturaDoTipo) {
          status = assinaturaDoTipo.status || "-";
          dataInicio = assinaturaDoTipo.data_inicio
            ? formatDateBR(assinaturaDoTipo.data_inicio)
            : "-";

          if (assinaturaDoTipo.plano_id) {
            const planoDoc = await db.collection("planos").doc(assinaturaDoTipo.plano_id).get();
            if (planoDoc.exists) planoNome = planoDoc.data().nome;
          }
        }

        mapa[tipo].push({
          nome: usuarioNome,
          plano: planoNome,
          status,
          dataInicio,
        });
      }
    }

    // 🔄 Atualiza progresso
    processados++;
    progressBar.value = processados;
  }

  // ✅ Renderiza o relatório
  const tbody = document.getElementById("tabela-relatorio-por-tipo");
  tbody.innerHTML = "";

  for (const tipo of tipos) {
    if (filtroSelecionado && tipo !== filtroSelecionado) continue;

    const tr = document.createElement("tr");

    const tdTipo = document.createElement("td");
    tdTipo.innerText = tipo;
    tr.appendChild(tdTipo);

    const tdUsuarios = document.createElement("td");

    const resumo = document.createElement("div");
    resumo.innerHTML = `<strong>${mapa[tipo].length}</strong> usuário(s)`;

    const lista = document.createElement("div");
    lista.style.marginTop = "6px";
    lista.style.padding = "6px";
    lista.style.background = "#f9f9f9";
    lista.style.border = "1px solid #ddd";
    lista.style.borderRadius = "6px";
    lista.style.display = "none";

    mapa[tipo].forEach((u) => {
      const item = document.createElement("div");
      item.innerHTML = `
        <div><strong>${u.nome}</strong></div>
        <div style="font-size:0.9em;color:#555">
          Plano: ${u.plano} | Status: ${u.status} | Início: ${u.dataInicio}
        </div>
        <hr style="margin:6px 0">
      `;
      lista.appendChild(item);
    });

    const toggleBtn = document.createElement("button");
    toggleBtn.innerText = "👁️ Ver usuários";
    toggleBtn.style.marginTop = "6px";
    toggleBtn.onclick = () => {
      lista.style.display = lista.style.display === "none" ? "block" : "none";
      toggleBtn.innerText = lista.style.display === "none" ? "👁️ Ver usuários" : "🔽 Ocultar";
    };

    tdUsuarios.appendChild(resumo);
    if (mapa[tipo].length > 0) {
      tdUsuarios.appendChild(toggleBtn);
      tdUsuarios.appendChild(lista);
    }

    tr.appendChild(tdUsuarios);
    tbody.appendChild(tr);
  }

  // 🔄 Remove barra ao final
  progressBar.remove();
}

async function gerarRelatorioPorUsuario() {
  const tbody = document.getElementById("tabela-relatorio-usuarios");
  tbody.innerHTML = "";

  try {
    const usuariosSnap = await db.collection("usuarios").get();

    usuariosSnap.forEach((doc) => {
      const usuarioId = doc.id;
      const data = doc.data();
      const nome = data.nome || usuarioId;
      const email = data.email || "-";

      const tr = document.createElement("tr");

      const tdNome = document.createElement("td");
      tdNome.innerText = nome;
      tr.appendChild(tdNome);

      const tdEmail = document.createElement("td");
      tdEmail.innerText = email;
      tr.appendChild(tdEmail);

      const tdAcoes = document.createElement("td");
      const btn = document.createElement("button");
      btn.innerText = "👁️ Ver detalhes";
      btn.onclick = () => mostrarRelatorioUsuario(usuarioId, nome);
      tdAcoes.appendChild(btn);
      tr.appendChild(tdAcoes);

      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error("Erro ao carregar usuários:", e);
    tbody.innerHTML = "<tr><td colspan='3'>Erro ao carregar usuários.</td></tr>";
  }
}

async function mostrarRelatorioUsuario(usuarioId, nomeExibido) {
  const container = document.getElementById("detalhes-relatorio-usuario");
  container.style.display = "block"; // 🔑 torna visível somente após clique
  container.innerHTML = "<p>🔄 Carregando...</p>";

  const prefsSnap = await db
    .collection("usuarios")
    .doc(usuarioId)
    .collection("preferencias_newsletter")
    .get();

  const assinaturaSnap = await db
    .collection("usuarios")
    .doc(usuarioId)
    .collection("assinaturas")
    .get();

  const assinaturas = assinaturaSnap.docs.map(doc => ({
    ...doc.data(),
    id: doc.id
  }));

  const tipos = prefsSnap.docs.map(doc => doc.id);

  let html = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h4 style="margin:0">${nomeExibido}</h4>
      <button onclick="fecharDetalhesUsuario()" style="background:#eee; border:1px solid #ccc; border-radius:4px; padding:4px 8px; cursor:pointer;">✖ Fechar</button>
    </div>
    <p><strong>Preferências:</strong> ${tipos.length > 0 ? tipos.join(", ") : "(nenhuma)"}</p>
  `;

  for (const tipo of tipos) {
    html += `<div style="margin-top:12px"><strong>${tipo}</strong>`;

    const relacionadas = assinaturas.filter(a => a.tipo_newsletter?.toLowerCase() === tipo.toLowerCase());

    if (relacionadas.length === 0) {
      html += `<p style="color:#888;font-style:italic">Nenhuma assinatura encontrada para esta preferência.</p>`;
    } else {
      for (const a of relacionadas) {
        let planoNome = "(sem plano)";
        if (a.plano_id) {
          const planoDoc = await db.collection("planos").doc(a.plano_id).get();
          if (planoDoc.exists) planoNome = planoDoc.data().nome;
        }

        const status = a.status || "-";
        const dataInicio = a.data_inicio ? formatDateBR(a.data_inicio) : "-";

        html += `
          <div style="margin-left:12px;padding:6px;border-left:3px solid #ccc;margin-bottom:8px">
            <p><strong>Status:</strong> ${status} <strong> Plano:</strong> ${planoNome} <strong> Início:</strong> ${dataInicio}</p>
          </div>
        `;
      }
    }

    html += `</div>`;
  }

  container.innerHTML = html;
}

// 🔹 Função para fechar painel
function fecharDetalhesUsuario() {
  const container = document.getElementById("detalhes-relatorio-usuario");
  container.style.display = "none";
  container.innerHTML = ""; // limpa conteúdo
}





function filtrarRelatorioUsuarios() {
  const termo = document.getElementById("busca-relatorio-usuario").value.toLowerCase();
  const linhas = document.querySelectorAll("#tabela-relatorio-usuarios tr");

  linhas.forEach((tr) => {
    const nome = tr.children[0].innerText.toLowerCase();
    const email = tr.children[1].innerText.toLowerCase();
    const match = nome.includes(termo) || email.includes(termo);
    tr.style.display = match ? "" : "none";
  });
}

async function montarComboTiposNewsletter() {
  const select = document.getElementById("filtro-cad-tipo-newsletter");

  // ✅ Evita recriar se já tem mais de 1 opção
  if (select.options.length > 1) return;

  select.innerHTML = '<option value="">Todos</option>';

  const tiposSnap = await db.collection("tipo_newsletters").get();
  const nomesUnicos = new Set();

  tiposSnap.forEach(doc => {
    const data = doc.data();
    const nome = (data.nome || "").trim();
    if (nome && !nomesUnicos.has(nome.toLowerCase())) {
      nomesUnicos.add(nome.toLowerCase());

      const opt = document.createElement("option");
      opt.value = nome.toLowerCase();
      opt.innerText = nome;
      select.appendChild(opt);
    }
  });
}

function formatarPreferencia(valor) {
  switch (valor) {
    case "E-mail": return "📧 E-mail";
    case "WhatsApp": return "🟢 WhatsApp";
    case "Ligação": return "📞 Ligação";
    default: return valor || "";
  }
}

let ultimoDoc = null;
let ultimaQueryKey = null;

async function carregarLeads(paginaNova = false) {
  const tabela = document.getElementById("tabela-leads");
  const resumo = document.getElementById("resumo-leads");

  const perfil = document.getElementById("filtro-perfil-lead")?.value?.trim() || "";
  const preferencia = document.getElementById("filtro-preferencia")?.value?.trim() || "";
  const status = document.getElementById("filtro-status-lead-consulta")?.value?.trim() || "";
  const termoBuscaRaw = document.getElementById("busca-leads")?.value || "";
  const termoBusca = termoBuscaRaw.trim().toLowerCase();

  // Monta chave única da consulta com todos os filtros
  const queryKey = JSON.stringify({
    perfil,
    preferencia,
    status,
    termoBusca
  });

  // Reset de paginação se for nova busca OU se os filtros/termo mudaram
  if (paginaNova || queryKey !== ultimaQueryKey) {
    ultimoDoc = null;
    ultimaQueryKey = queryKey;
  }

  tabela.innerHTML = "<tr><td colspan='10'>Carregando...</td></tr>";

  try {
    let query = db.collection("leads");

    // Busca por prefixo em nome_lowercase
    if (termoBusca) {
      query = query
        .orderBy("nome_lowercase")
        .startAt(termoBusca)
        .endAt(termoBusca + "\uf8ff");
    } else if (!perfil && !status && !preferencia) {
      // Sem filtros → ordena por timestamp
      query = query.orderBy("timestamp", "desc");
    }

    // 🔹 Se houver filtros simples, não força orderBy
    if (perfil) query = query.where("perfil", "==", perfil);
    if (preferencia) query = query.where("preferencia_contato", "==", preferencia);
    if (status) query = query.where("status", "==", status);

    // status
    query = query.limit(limitePorPagina);
    if (ultimoDoc) {
      query = query.startAfter(ultimoDoc);
    }

    const snap = await query.get();

    if (snap.empty) {
      tabela.innerHTML = "<tr><td colspan='10'>Nenhum lead encontrado.</td></tr>";
      resumo.innerHTML = `<span style="cursor:pointer;text-decoration:underline" onclick="carregarLeads(false)">🔄 Ver mais</span>`;
      return;
    }

    // Atualiza o último doc para a próxima página
    ultimoDoc = snap.docs[snap.docs.length - 1];

    const contadores = {
      "Novo": 0,
      "Em contato": 0,
      "Negociando": 0,
      "Convertido": 0,
      "Descartado": 0
    };

    let linhas = "";

    for (const doc of snap.docs) {
      const d = doc.data();
      const leadId = doc.id;
      const data = d.data_criacao?.toDate?.() ? d.data_criacao.toDate().toLocaleString("pt-BR") : "";
      const interesses = Array.isArray(d.interesses) ? d.interesses.join(", ") : "";
      const statusAtual = d.status || "Novo";
      const destaque = statusAtual === "Convertido" ? "lead-convertido" : "";
      contadores[statusAtual] = (contadores[statusAtual] || 0) + 1;

      const iconeHistorico = d.tem_interacoes
        ? `<span class="icon-btn" title="Ver histórico" onclick="abrirModalHistorico('${leadId}')">📜</span>`
        : "";

      const podeVincular = statusAtual !== "Convertido" && statusAtual !== "Descartado";
      const iconeVincular = podeVincular
        ? `<span class="icon-btn" title="Vincular lead" onclick="abrirModalVincularLead('${leadId}')">👤</span>`
        : "";

      linhas += ` 
        <tr class="${destaque}">
          <td>${d.nome || ""}</td>
          <td>${d.email || ""}</td>
          <td>${d.telefone || ""}</td>
          <td>${d.perfil || "-"}</td>
          <td>${interesses}</td>
          <td>${data}</td>
          <td>${formatarPreferencia(d.preferencia_contato)}</td>
          <td>
            ${d.mensagem
          ? `<span title="${d.mensagem}" style="cursor:help" aria-label="Mensagem completa">📝 ${d.mensagem.slice(0, 30)}${d.mensagem.length > 30 ? "..." : ""}</span>`
          : "—"}
          </td>
          <td>
            <select onchange="atualizarStatusLead('${leadId}', this.value)">
              ${["Novo", "Em contato", "Negociando", "Convertido", "Descartado"].map(op => `
                <option value="${op}" ${op === statusAtual ? "selected" : ""}>${op}</option>
              `).join("")}
            </select>
            <span class="icon-btn" title="Registrar contato" onclick="abrirModalContatoLead('${leadId}')">📞</span>
            ${iconeHistorico}
            ${iconeVincular}
          </td>
        </tr>
      `;
    }

    tabela.innerHTML = linhas;

    resumo.innerHTML = `
      <span style="cursor:pointer;color:green">🟢 Convertidos: ${contadores["Convertido"]}</span> |
      <span style="cursor:pointer;color:orange">🟡 Negociando: ${contadores["Negociando"]}</span> |
      <span style="cursor:pointer;color:blue">🔵 Em contato: ${contadores["Em contato"]}</span> |
      <span style="cursor:pointer;color:gray">⚪️ Novos: ${contadores["Novo"]}</span> |
      <span style="cursor:pointer;color:red">🔴 Descartados: ${contadores["Descartado"]}</span> |
      <span style="cursor:pointer;text-decoration:underline" onclick="carregarLeads(false)">🔄 Ver mais</span>
    `;
  } catch (err) {
    tabela.innerHTML = `<tr><td colspan='10'>Erro ao carregar leads.</td></tr>`;
    console.error("Erro ao carregar leads:", err);
  }
}

let leadAtual = null;
let dadosLeadAtual = null;

function abrirModalContatoLead(leadId) {
  leadAtual = leadId;

  db.collection("leads").doc(leadId).get().then(doc => {
    if (!doc.exists) return alert("Lead não encontrado.");
    dadosLeadAtual = doc.data();

    const tipo = dadosLeadAtual.preferencia_contato?.toLowerCase() || "E-mail";
    document.getElementById("tipo-contato-lead").value = formatarPreferencia(tipo);
    document.getElementById("resultado-contato-lead").value = "";
    document.getElementById("acao-email-lead").style.display = (tipo === "e-mail") ? "block" : "none";
    document.getElementById("email-contato-lead").value = dadosLeadAtual.email || "";
    document.getElementById("campo-email-lead").style.display = (tipo === "e-mail") ? "block" : "none";
    document.getElementById("btn-enviar-email-lead").style.display = (tipo === "e-mail") ? "inline-block" : "none";

    document.getElementById("modal-contato-lead").style.display = "flex";
  });
}

function fecharModalContatoLead() {
  document.getElementById("modal-contato-lead").style.display = "none";
}

function abrirModalHistorico(leadId) {
  const container = document.getElementById("conteudo-historico-lead");
  container.innerHTML = "<p>🔄 Carregando histórico...</p>";

  db.collection("leads").doc(leadId).collection("interacoes")
    .orderBy("data", "desc")
    .get()
    .then(snapshot => {
      if (snapshot.empty) {
        container.innerHTML = "<p>⚠️ Nenhuma interação registrada.</p>";
        return;
      }

      const itens = snapshot.docs.map(doc => {
        const d = doc.data();
        const dataFormatada = d.data?.toDate().toLocaleDateString("pt-BR") || "Data desconhecida";
        const horaFormatada = d.data?.toDate().toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' }) || "";

        let resultadoHtml = "";
        let destaqueEmail = false;

        if (d.tipo === "vinculacao") {
          resultadoHtml = `
            <p>🔗 Lead vinculado a <strong>${d.usuario_vinculado?.nome || "usuário desconhecido"}</strong></p>
            <p><small>Feito por: ${d.feito_por || "Desconhecido"}</small></p>
          `;
        } else {
          const resultadoTexto = d.resultado || "Sem detalhes";
          destaqueEmail = resultadoTexto.toLowerCase().includes("e-mail enviado");

          resultadoHtml = `
            <em>Resultado:</em><br>
            <div style="
              background:${destaqueEmail ? '#e6f7ff' : '#f9f9f9'};
              padding:8px;
              border-radius:4px;
              border-left:4px solid ${destaqueEmail ? '#007acc' : '#ccc'};
            ">
              ${resultadoTexto}
            </div>
          `;
        }

        return `
          <div style="border-bottom:1px solid #ccc; padding:10px 0;">
            <strong>${dataFormatada} às ${horaFormatada}</strong><br>
            <em>Tipo:</em> ${d.tipo}<br>
            <em>Responsável:</em> ${d.usuario_responsavel || d.feito_por || "Desconhecido"}<br>
            ${resultadoHtml}
          </div>
        `;
      }).join("");

      container.innerHTML = itens;
      document.getElementById("modal-historico-lead").style.display = "flex";
    });
}


function fecharModalHistorico() {
  document.getElementById("modal-historico-lead").style.display = "none";
}

function salvarInteracaoLead() {
  const tipo = dadosLeadAtual.preferencia_contato?.toLowerCase() || "e-mail";
  const resultado = document.getElementById("resultado-contato-lead").value;

  if (!resultado.trim()) return alert("Preencha o resultado do contato.");

  db.collection("leads").doc(leadAtual).collection("interacoes").add({
    tipo,
    resultado,
    data: new Date(),
    usuario_responsavel: "adminId"
  }).then(() => {
    // Atualiza status do lead
    db.collection("leads").doc(leadAtual).update({
      status: "Em contato"
    });

    alert("Interação registrada com sucesso.");
    fecharModalContatoLead();
    carregarLeads();
  }).catch(err => {
    console.error("Erro ao salvar interação:", err);
    alert("Erro ao salvar interação.");
  });
}


document.getElementById("btn-enviar-email-lead").onclick = () => {
  abrirModalEnvioManualLead(leadAtual, dadosLeadAtual); // abre o modal de envio
};


function abrirModalEnvioManualLead(leadId, dadosLead) {
  abrirModalEnvioManual(leadId, null, dadosLead); // reaproveita função existente
}

async function processarImportacaoLeads() {
  document.getElementById("modal-importacao-leads").style.display = "block";

  const origemInput = document.getElementById("origem-importacao");
  const arquivoInput = document.getElementById("arquivo-leads");

  if (!origemInput || !arquivoInput) return alert("Campos obrigatórios não encontrados.");
  const origem = origemInput.value.trim();
  const arquivo = arquivoInput.files[0];

  if (!origem) return alert("Informe a origem dos leads.");
  if (!arquivo) return alert("Selecione uma planilha.");

  Papa.parse(arquivo, {
    header: true,
    delimiter: ";",
    skipEmptyLines: true,
    complete: async function (results) {
      const linhas = results.data;
      const perfisValidos = ["secretario", "tecnico", "contador", "pesquisador", "cacs", "cidadao"];
      let importados = 0;
      let erros = [];

      const progresso = document.getElementById("progresso-importacao");
      if (progresso) progresso.textContent = `⏳ Processando: 0 / ${linhas.length}`;

      for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];
        const {
          nome, email, telefone, perfil,
          preferencia_contato, interesses, mensagem,
          Sigla_UF, codigo_UF, Nome_Municipio, codigo_municipio
        } = linha;

        if (!nome || !email || !telefone || !perfil || !preferencia_contato || !interesses || !mensagem ||
          !Sigla_UF || !codigo_UF || !Nome_Municipio || !codigo_municipio) {
          erros.push(`Linha incompleta: ${JSON.stringify(linha)}`);
          continue;
        }

        if (!email.includes("@")) {
          erros.push(`Email inválido: ${email}`);
          continue;
        }

        if (!perfisValidos.includes(perfil.toLowerCase())) {
          erros.push(`Perfil inválido: ${perfil}`);
          continue;
        }

        try {
          const existe = await db.collection("leads").where("email", "==", email).get();
          if (!existe.empty) {
            erros.push(`Lead já cadastrado: ${email}`);
            continue;
          }

          const interessesArray = interesses.split(",").map(i => i.trim());

          await db.collection("leads").add({
            nome,
            email,
            telefone,
            perfil: perfil.toLowerCase(),
            preferencia_contato,
            interesses: interessesArray,
            mensagem,
            origem,
            Sigla_UF,
            codigo_UF,
            Nome_Municipio,
            codigo_municipio,
            status: "Novo",
            data_criacao: new Date()
          });

          importados++;
        } catch (err) {
          erros.push(`Erro ao importar ${email}: ${err.message}`);
        }

        if (progresso) progresso.textContent = `⏳ Processando: ${i + 1} / ${linhas.length}`;
      }

      if (progresso) {
        progresso.textContent = `✅ Importados: ${importados} | ❌ Erros: ${erros.length}`;
      }

      alert(`✅ ${importados} leads importados com sucesso.\n❌ ${erros.length} com erro.`);

      if (erros.length) {
        const conteudoCSV = "erro\n" + erros.map(e => `"${e.replace(/"/g, '""')}"`).join("\n");
        const blob = new Blob([conteudoCSV], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "erros_importacao.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      fecharModalImportacaoLeads();
      carregarLeads(); // atualiza a lista
    }
  });
}


function abrirModalImportacaoLeads() {
  document.getElementById("modal-importacao-leads").style.display = "block";
}

function fecharModalImportacaoLeads() {
  document.getElementById("modal-importacao-leads").style.display = "none";
}

function exportarLeadsCSV() {
  try {
    const linhas = [
      ["Nome", "E-mail", "Telefone", "Perfil", "Interesses", "Data", "Preferência", "Mensagem", "Status"]
    ];

    const linhasVisiveis = document.querySelectorAll("#tabela-leads tr");

    linhasVisiveis.forEach(tr => {
      if (tr.style.display === "none") return;

      const tds = tr.querySelectorAll("td");
      if (tds.length < 9) return;

      const nome = tds[0].innerText.trim();
      const email = tds[1].innerText.trim();
      const telefone = tds[2].innerText.trim();
      const perfil = tds[3].innerText.trim();
      const interesses = tds[4].innerText.trim();
      const data = tds[5].innerText.trim();
      const preferencia = tds[6].innerText.trim();
      const mensagem = tds[7].innerText.replace(/\r?\n|\r/g, " ").trim();
      const status = tds[8].querySelector("select")?.value || "";

      linhas.push([
        nome,
        email,
        telefone,
        perfil,
        interesses,
        data,
        preferencia,
        mensagem,
        status
      ]);
    });

    const csv = linhas.map(l => l.map(v => `"${v}"`).join(";")).join("\n");
    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "leads-filtrados.csv";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("Erro ao exportar leads.");
    console.error("Erro ao exportar CSV:", err);
  }
}



async function atualizarStatusLead(leadId, novoStatus) {
  if (!leadId || !novoStatus) return;

  const leadRef = db.collection("leads").doc(leadId);

  if (novoStatus === "Descartado") {
    const motivo = prompt("Informe o motivo do descarte:");

    if (!motivo || motivo.trim().length < 3) {
      alert("Motivo obrigatório para descartar o lead.");
      // Recarrega a tabela para restaurar o status anterior
      carregarLeads();
      return;
    }

    await leadRef.update({ status: "Descartado" });

    await leadRef.collection("descadastramentos").add({
      motivo: motivo.trim(),
      newsletter_id: null,
      data: firebase.firestore.Timestamp.now()
    });

    alert("Lead descartado com motivo registrado.");
  } else {
    await leadRef.update({ status: novoStatus });
  }

  carregarLeads();
}


async function abrirModalVincularLead(leadId) {
  const modal = document.getElementById("modal-vincular-lead");
  const conteudo = document.getElementById("conteudo-vincular-lead");
  conteudo.innerHTML = "<p>🔄 Verificando dados...</p>";
  modal.style.display = "flex";

  try {
    const leadDoc = await db.collection("leads").doc(leadId).get();

    if (!leadDoc.exists) {
      conteudo.innerHTML = "<p>❌ Lead não encontrado.</p>";
      return;
    }

    const lead = leadDoc.data();
    if (!lead || !lead.email) {
      conteudo.innerHTML = "<p>⚠️ Este lead não possui e-mail cadastrado.</p>";
      return;
    }

    const email = lead.email.trim().toLowerCase();
    const usuariosSnap = await db.collection("usuarios").where("email", "==", email).limit(1).get();

    if (!usuariosSnap.empty) {
      const usuario = usuariosSnap.docs[0].data();
      const usuarioId = usuariosSnap.docs[0].id;

      conteudo.innerHTML = `
        <p>🔗 Lead: <strong>${lead.nome}</strong> — ${email}</p>
        <hr>
        <p>👤 Usuário encontrado:</p>
        <ul>
          <li><strong>Nome:</strong> ${usuario.nome}</li>
          <li><strong>Perfil:</strong> ${usuario.tipo_perfil}</li>
          <li><strong>Status:</strong> ${usuario.ativo ? "✅ Ativo" : "❌ Inativo"}</li>
        </ul>
        ${usuario.ativo
          ? `<button onclick="vincularLeadUsuario('${leadId}', '${usuarioId}')">🔗 Vincular este usuário</button>`
          : `<button onclick="reativarEVincularUsuario('${leadId}', '${usuarioId}')">🔄 Reativar e vincular</button>`
        }
      `;
    } else {
      const dadosIniciais = JSON.stringify({
        nome: lead.nome,
        email: lead.email,
        tipo_perfil: lead.perfil || "contador",
        cod_uf: lead.cod_uf || "",
        cod_municipio: lead.cod_municipio || ""
      });


      conteudo.innerHTML = `
        <p>🔗 Lead: <strong>${lead.nome}</strong> — ${email}</p>
        <hr>
        <p>⚠️ Nenhum usuário encontrado com este e-mail.</p>
        <button onclick='abrirModalCriarUsuario(${dadosIniciais}, "${leadId}")'>🆕 Criar novo usuário com dados do lead</button>
      `;
    }
  } catch (err) {
    console.error("Erro ao verificar vinculação:", err);
    conteudo.innerHTML = "<p>❌ Erro ao carregar dados do lead.</p>";
  }
}

async function carregarRelatorioAvaliacoes() {
  const tbody = document.getElementById("tabela-avaliacoes");
  tbody.innerHTML = "";

  const snapshot = await db.collection("usuarios").get();

  snapshot.forEach(async doc => {
    const usuario = doc.data();
    const perfil = usuario.tipo_perfil?.toLowerCase() || "indefinido";

    if (filtroPerfilAvaliacoes !== "todos" && perfil !== filtroPerfilAvaliacoes) return;

    const solicitacoes = await db.collection("usuarios")
      .doc(doc.id)
      .collection("solicitacoes")
      .where("avaliacao", "in", filtroAvaliacao === "todos" ? ["positivo", "negativo"] : [filtroAvaliacao])
      .orderBy("data_solicitacao", "desc")
      .get();

    solicitacoes.forEach(solicitacao => {
      const s = solicitacao.data();
      const tipoSolicitacao = s.tipo?.toLowerCase() || "outros";
      const dataSolicitacao = new Date(s.data_solicitacao);

      if (filtroTipoSolicitacao !== "todos" && tipoSolicitacao !== filtroTipoSolicitacao) return;

      if (filtroPeriodoAvaliacoes !== "todos") {
        const diasLimite = parseInt(filtroPeriodoAvaliacoes);
        const hoje = new Date();
        const limite = new Date(hoje.getTime() - diasLimite * 24 * 60 * 60 * 1000);
        if (dataSolicitacao < limite) return;
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${usuario.nome || doc.id}</td>
        <td>${usuario.tipo_perfil || "-"}</td>
        <td>${s.tipo}</td>
        <td>${s.status}</td>
        <td>${s.avaliacao === "positivo" ? "👍 Positiva" : "👎 Negativa"}</td>
        <td>${formatarData(s.data_solicitacao)}</td>
      `;
      tbody.appendChild(tr);
    });
  });
}

async function vincularLeadUsuario(leadId, usuarioId) {
  try {
    const usuarioDoc = await db.collection("usuarios").doc(usuarioId).get();
    const usuario = usuarioDoc.data();

    if (!usuario || !usuario.ativo) {
      alert("Usuário inválido ou inativo.");
      return;
    }

    const usuarioLogado = JSON.parse(localStorage.getItem("usuarioLogado"));
    const feitoPor = usuarioLogado?.nome || usuarioLogado?.email || "Desconhecido";

    await db.collection("leads").doc(leadId).update({
      usuario_vinculado: {
        id: usuarioId,
        nome: usuario.nome,
        email: usuario.email,
        data_vinculo: new Date()
      },
      status: "Convertido"
    });

    await db.collection("leads").doc(leadId).collection("interacoes").add({
      tipo: "vinculacao",
      feito_por: feitoPor,
      data: new Date(),
      usuario_vinculado: {
        id: usuarioId,
        nome: usuario.nome
      }
    });

    alert("✅ Lead vinculado com sucesso!");
    document.getElementById("modal-vincular-lead").style.display = "none";
    carregarLeads();
  } catch (err) {
    console.error("Erro ao vincular lead:", err);
    alert("❌ Erro ao vincular lead.");
  }
}


async function reativarEVincularUsuario(leadId, usuarioId) {
  try {
    // 🔄 Ativa o usuário
    await db.collection("usuarios").doc(usuarioId).update({
      ativo: true
    });

    // 🔍 Busca dados do usuário
    const usuarioDoc = await db.collection("usuarios").doc(usuarioId).get();
    const usuario = usuarioDoc.data();

    if (!usuario || !usuario.ativo) {
      alert("Usuário inválido ou inativo.");
      return;
    }

    // ✅ Recupera quem está logado
    const usuarioLogado = JSON.parse(localStorage.getItem("usuarioLogado"));
    const feitoPor = usuarioLogado?.nome || usuarioLogado?.email || "Desconhecido";

    // ✅ Atualiza o lead com vínculo e status
    await db.collection("leads").doc(leadId).update({
      usuario_vinculado: {
        id: usuarioId,
        nome: usuario.nome,
        email: usuario.email,
        data_vinculo: new Date()
      },
      status: "Convertido"
    });

    // ✅ Registra a interação na subcoleção
    await db.collection("leads").doc(leadId).collection("interacoes").add({
      tipo: "vinculacao",
      feito_por: feitoPor,
      data: new Date(),
      usuario_vinculado: {
        id: usuarioId,
        nome: usuario.nome
      }
    });

    alert("✅ Usuário reativado e lead vinculado com sucesso!");
    document.getElementById("modal-vincular-lead").style.display = "none";
    carregarLeads();
  } catch (err) {
    console.error("Erro ao reativar e vincular:", err);
    alert("❌ Erro ao reativar e vincular usuário.");
  }
}

async function carregarInteracoesAuditoria() {
  const container = document.getElementById("tabela-interacoes");
  container.innerHTML = "<p>🔄 Carregando interações...</p>";

  const tipoFiltro = document.getElementById("filtro-tipo")?.value?.trim().toLowerCase();
  const feitoPorFiltro = document.getElementById("filtro-feito-por")?.value?.trim().toLowerCase();
  const leadFiltro = document.getElementById("filtro-lead")?.value?.trim().toLowerCase();

  try {
    let query = db.collectionGroup("interacoes").orderBy("data", "desc").limit(200);

    if (tipoFiltro) query = query.where("tipo_lower", "==", tipoFiltro);
    if (feitoPorFiltro) query = query.where("feito_por_lower", "==", feitoPorFiltro);
    // ⚠️ Para leadFiltro, como não temos o nome do lead dentro da interação,
    // seria interessante salvar `leadNome` também dentro do documento de interação.

    const snap = await query.get();
    let interacoes = snap.docs.map(doc => {
      const interacao = doc.data();
      return {
        tipo: interacao.tipo,
        feito_por: interacao.feito_por,
        data: interacao.data?.toDate(),
        leadId: doc.ref.parent.parent.id, // pega o ID do lead pai
        usuario_vinculado: interacao.usuario_vinculado || null
      };
    });

    // Filtro por nome do lead (se armazenado dentro da interação)
    if (leadFiltro) {
      interacoes = interacoes.filter(i => i.leadNome?.toLowerCase().includes(leadFiltro));
    }

    let html = `
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Tipo</th>
            <th>Feito por</th>
            <th>Lead</th>
            <th>Usuário vinculado</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const item of interacoes) {
      html += `
        <tr>
          <td>${item.data?.toLocaleString() || "-"}</td>
          <td>${item.tipo || "-"}</td>
          <td>${item.feito_por || "-"}</td>
          <td>${item.leadId}</td>
          <td>${item.usuario_vinculado?.nome || "-"}</td>
        </tr>
      `;
    }

    html += "</tbody></table>";
    container.innerHTML = html;
  } catch (err) {
    console.error("Erro ao carregar interações:", err);
    container.innerHTML = "<p>❌ Erro ao carregar interações.</p>";
  }
}




/* ======================
   FILTROS DE BUSCA
   ====================== */
function filtrarUsuarios() {
  const filtro = document.getElementById('busca-usuarios').value.toLowerCase();
  document.querySelectorAll('#lista-usuarios tr').forEach(tr => {
    tr.style.display = tr.innerText.toLowerCase().includes(filtro) ? '' : 'none';
  });
}

function filtrarPlanos() {
  const filtro = document.getElementById('busca-planos').value.toLowerCase();
  document.querySelectorAll('#lista-planos tr').forEach(tr => {
    tr.style.display = tr.innerText.toLowerCase().includes(filtro) ? '' : 'none';
  });
}

async function carregarTemas_noticias() {
  const snap = await db.collection("temas_noticias").orderBy("prioridade").get();
  const temas = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const tabela = document.getElementById("tabela-temas");
  tabela.innerHTML = `

    <tbody>
      ${temas.map(t => `
        <tr>
          <td>${t.nome}</td>
          <td>${t.palavras_chave.join(", ")}</td>
          <td>${t.prioridade}</td>
          <td>
            <div style="display:flex;align-items:center;gap:6px;">
              <div style="width:16px;height:16px;border-radius:4px;background:${t.cor};border:1px solid #ccc  ;"></div>
              <span>${t.cor}</span>
            </div>
          </td>
          <td>${t.ativo ? "✅" : "❌"}</td>
          <td>
            <button onclick="editarTema('${t.id}')">✏️</button>
            <button onclick="confirmarexcluirTema('${t.id}','${t.nome}')">🗑️</button>
          </td>
        </tr>
      `).join("")}
    </tbody>
  `;
}

async function editarTema(id) {
  const modal = document.getElementById("modal-tema");
  const body = document.getElementById("modal-tema-body");

  if (id) {
    const doc = await db.collection("temas_noticias").doc(id).get();
    if (!doc.exists) {
      alert("Tema não encontrado.");
      return;
    }

    const dados = doc.data();

    body.innerHTML = `
      <label for="nome">Nome do tema:</label>
      <input id="nome" type="text" value="${dados.nome}" required style="width:100%;margin-bottom:10px">

      <label for="palavras_chave">Palavras-chave (separadas por vírgula):</label>
      <input id="palavras_chave" type="text" value="${dados.palavras_chave.join(", ")}" required style="width:100%;margin-bottom:10px">

      <label for="prioridade">Prioridade:</label>
      <input id="prioridade" type="number" value="${dados.prioridade}" style="width:100%;margin-bottom:10px">
  
      <label for="cor">Cor do tema:</label>
      <input type="color" id="cor" value="${dados.cor || "#cccccc"}">

      <label for="ativo" style="display:block;margin-top:10px;">Ativo:</label>
      <select id="ativo" style="width:100%;margin-bottom:10px">
        <option value="true" ${dados.ativo ? "selected" : ""}>Sim</option>
        <option value="false" ${!dados.ativo ? "selected" : ""}>Não</option>
      </select>

      <button onclick="salvarTema('${id}')">💾 Salvar</button>
    `;
  } else {
    // Novo tema
    body.innerHTML = `
      <label for="nome">Nome do tema:</label>
      <input id="nome" type="text" required style="width:100%;margin-bottom:10px">

      <label for="palavras_chave">Palavras-chave (separadas por vírgula):</label>
      <input id="palavras_chave" type="text" required style="width:100%;margin-bottom:10px">

      <label for="prioridade">Prioridade:</label>
      <input id="prioridade" type="number" value="1" style="width:100%;margin-bottom:10px">

      <label for="ativo" style="display:block;margin-top:10px;">Ativo:</label>
      <select id="ativo" style="width:100%;margin-bottom:10px">
        <option value="true">Sim</option>
        <option value="false">Não</option>
      </select>

      <button onclick="salvarTema()">💾 Salvar</button>
    `;
  }

  modal.style.display = "flex";
}


async function salvarTema(id) {
  const nome = document.getElementById("nome").value;
  const palavras_chave = document.getElementById("palavras_chave").value;
  const prioridade = document.getElementById("prioridade").value;
  const ativo = document.getElementById("ativo").value;
  const cor = document.getElementById("cor").value;


  const idFinal = id || Date.now().toString();

  await db.collection("temas_noticias").doc(idFinal).set({
    nome,
    palavras_chave: palavras_chave.split(",").map(p => p.trim()).filter(Boolean),
    prioridade: parseInt(prioridade),
    ativo: ativo === "true",
    cor
  });

  fecharModalTema();
  carregarTemas_noticias();
}


/* ====================
   CRUD PLANOS
   ==================== */
async function carregarPlanos() {
  const tbody = document.getElementById('lista-planos'); tbody.innerHTML = '';
  const snap = await db.collection('planos').get();
  snap.forEach(doc => {
    const d = doc.data();
    const valorFmt = d.valor ? Number(d.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
    const statusFmt = d.status || '--';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${d.nome || ''}</td>
      <td>${d.descricao || ''}</td>
      <td>${d.qtde_parcelas || ''}</td>
      <td>${d.tipo || ''}</td>
      <td>${valorFmt}</td>
      <td>${statusFmt}</td>
      <td>
        <span class="icon-btn" title="Editar" onclick="abrirModalPlano('${doc.id}',true)">✏️</span>
        <span class="icon-btn" title="Excluir" onclick="confirmarExclusaoPlano('${doc.id}','${(d.nome || '').replace(/'/g, "\\'")}')">🗑️</span>
      </td>`;
    tbody.appendChild(tr);
  });
}
function confirmarExclusaoPlano(id, nome) {
  abrirConfirmacao(`Deseja excluir o plano "${nome}"?`, async () => {
    await db.collection('planos').doc(id).delete();
    carregarPlanos();
  });
}

function confirmarexcluirTema(id, nome) {
  abrirConfirmacao(`Deseja excluir o tema "${nome}"?`, async () => {
    await db.collection('temas_noticias').doc(id).delete();
    carregarTemas_noticias();
  });
}

function fecharModalTema() {
  document.getElementById("modal-tema").style.display = "none";
}


async function carregarrespostas_automaticas() {
  const container = document.getElementById("respostas_automaticas");
  container.innerHTML = `<h2>✉️ Respostas Automáticas</h2><div id="lista-respostas"></div><div id="form-resposta-container" style="margin-top:30px"></div>`;

  // Botão para novo cadastro
  const novoBtn = document.createElement("button");
  novoBtn.innerText = "➕ Nova Resposta";
  novoBtn.style.marginTop = "20px";
  novoBtn.onclick = () => editarResposta(null);
  container.appendChild(novoBtn);

  const snap = await db.collection("respostas_automaticas").get();
  const respostas = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const duplicadas = respostas.filter((r, i, arr) =>
    arr.findIndex(x =>
      x.tipo === r.tipo &&
      x.momento_envio === r.momento_envio &&
      x.titulo === r.titulo
    ) !== i
  );

  // Tabela de listagem
  const tabela = document.createElement("table");
  tabela.style.width = "100%";
  tabela.innerHTML = `
    <thead>
      <tr>
        <th>Tipo</th>
        <th>Título</th>
        <th>Ativo</th>
        <th>Automático</th>
        <th>Momento</th>
        <th>Ação</th>
      </tr>
    </thead>
    <tbody>
      ${respostas.map(r => `
        <tr>
          <td>${r.tipo || "—"}</td>
          <td>${r.titulo}</td>
          <td>${r.ativo ? "✅" : "❌"}</td>
          <td>${r.enviar_automaticamente ? "✅" : "❌"}</td>
          <td>${momentosEnvio.find(m => m.valor === r.momento_envio)?.descricao || "—"}</td>
          <td>
            <button onclick="editarResposta('${r.id}')">✏️</button>
            <button onclick="confirmarexcluirResposta('${r.id}','${r.titulo}')">🗑️</button>
          </td>
        </tr>
      `).join("")}
    </tbody>
  `;
  document.getElementById("lista-respostas").appendChild(tabela);
}

async function editarResposta(id) {
  const modal = document.getElementById("modalrespostaauto");
  const body = document.getElementById("modalrespostaauto-body");

  modal.style.display = "flex";
  body.innerHTML = "<h3>" + (id ? "Editar Resposta" : "Nova Resposta") + "</h3>";

  let dados = { id: "", titulo: "", mensagem_html: "", ativo: true, enviar_automaticamente: true };
  if (id) {
    const doc = await db.collection("respostas_automaticas").doc(id).get();
    if (doc.exists) dados = { id: doc.id, ...doc.data() };
  }

  body.innerHTML += `
    <form id="form-resposta-automatica">
      <label for="tipo">Tipo de Resposta:</label>
      <select id="tipo" required style="width:100%;margin-bottom:10px">
        <option value="">Selecione...</option>
      </select>

      <label for="titulo">Título:</label>
      <input type="text" id="titulo" required style="width:100%;margin-bottom:10px" value="${dados.titulo || ""}">
      <br>
      <label for="momento_envio">Momento de envio:</label>
      
      <select id="momento_envio" required style="width:100%;margin-bottom:10px">
        <option value="">Selecione o momento...</option>
      </select>

      <label for="mensagem_html">Mensagem (HTML):</label>
      <textarea id="mensagem_html" rows="8" required style="width:100%;margin-bottom:10px">${dados.mensagem_html || ""}</textarea>

      <label for="ativo">Ativo:</label>
      <select id="ativo" style="width:100%;margin-bottom:10px">
        <option value="true" ${dados.ativo ? "selected" : ""}>Sim</option>
        <option value="false" ${!dados.ativo ? "selected" : ""}>Não</option>
      </select>

      <label for="enviar_automaticamente">Enviar automaticamente?</label>
      <select id="enviar_automaticamente" style="width:100%;margin-bottom:10px">
        <option value="true" ${dados.enviar_automaticamente ? "selected" : ""}>Sim</option>
        <option value="false" ${!dados.enviar_automaticamente ? "selected" : ""}>Não</option>
      </select>

      <button type="submit">💾 Salvar</button>
      <button type="button" onclick="visualizarHTML()">👁️ Visualizar HTML</button>
      <p id="status-resposta" style="margin-top:10px;font-weight:bold"></p>
    </form>
    <div id="preview-html" style="margin-top:20px;border:1px solid #ccc;padding:10px;display:none"></div>
  `;

  // Preencher tipos de newsletter
  const select = document.getElementById("tipo");
  const snap = await db.collection("tipo_newsletters").get();
  const tipos = snap.docs.map(doc => doc.data().nome).filter(Boolean);
  tipos.forEach(tipo => {
    const opt = document.createElement("option");
    opt.value = tipo;
    opt.textContent = tipo;
    if (dados.tipo === tipo) opt.selected = true;
    select.appendChild(opt);
  });

  const selectMomento = document.getElementById("momento_envio");
  momentosEnvio.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.valor;
    opt.textContent = m.descricao;
    if (dados.momento_envio === m.valor) opt.selected = true;
    selectMomento.appendChild(opt);
  });


  document.getElementById("form-resposta-automatica").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tipo = document.getElementById("tipo").value.trim();
    const titulo = document.getElementById("titulo").value.trim();
    const mensagem_html = document.getElementById("mensagem_html").value.trim();
    const ativo = document.getElementById("ativo").value === "true";
    const enviar_automaticamente = document.getElementById("enviar_automaticamente").value === "true";
    const momento_envio = document.getElementById("momento_envio").value;

    const existe = await db.collection("respostas_automaticas")
      .where("tipo", "==", tipo)
      .where("momento_envio", "==", momento_envio)
      .where("titulo", "==", titulo)
      .get();

    if (!id && !existe.empty) {
      document.getElementById("status-resposta").innerText = "⚠️ Já existe uma resposta com esse tipo, momento e título.";
      return;
    }

    try {
      if (dados.id) {
        // Atualização
        await db.collection("respostas_automaticas").doc(dados.id).update({
          tipo,
          titulo,
          mensagem_html,
          ativo,
          enviar_automaticamente,
          momento_envio
        });
      } else {
        // Novo cadastro
        await db.collection("respostas_automaticas").add({
          tipo,
          titulo,
          mensagem_html,
          ativo,
          enviar_automaticamente,
          momento_envio
        });
      }

      document.getElementById("status-resposta").innerText = "✅ Resposta salva com sucesso!";
      fecharModalRespostaAuto();
      carregarrespostas_automaticas();
    } catch (error) {
      console.error("Erro ao salvar resposta:", error);
      document.getElementById("status-resposta").innerText = "❌ Erro ao salvar resposta.";
    }
  });
}

function visualizarHTML() {
  const html = document.getElementById("mensagem_html").value;
  const modal = document.getElementById("modal-preview-html");
  const content = document.getElementById("preview-html-content");
  content.innerHTML = html;
  modal.style.display = "flex";
}

function fecharModalPreview() {
  document.getElementById("modal-preview-html").style.display = "none";
}

function fecharModalRespostaAuto() {
  const modal = document.getElementById("modalrespostaauto");
  if (modal) modal.style.display = "none";
}

function confirmarexcluirResposta(id, nome) {
  abrirConfirmacao(`Deseja excluir a resposta automática "${nome}"?`, async () => {
    await db.collection('respostas_automaticas').doc(id).delete();
    carregarrespostas_automaticas();
  });
}

document.getElementById('usuarios').addEventListener('click', () => {
  // Limpa apenas a seção de usuários
  const usuariosSection = document.getElementById('usuarios');
  if (usuariosSection) {
    //usuariosSection.querySelector('#lista-usuarios').innerHTML = '';
    usuariosSection.querySelector('#status-consulta').textContent = '';
    usuariosSection.querySelector('#btn-listar').disabled = false;
    usuariosSection.querySelector('#btn-anterior').disabled = true;
    usuariosSection.querySelector('#btn-proxima').disabled = true;
    usuariosSection.querySelector('#btn-primeira').disabled = true;
  }
});


let paginaAtual = 1;
let historicoDocs = []; // guarda o último doc de cada página
let totalUsuarios = 0;
let totalPaginas = 0;
const limitePorPagina = 10;

async function carregarUsuariosComFiltro() {
  const tbody = document.getElementById('lista-usuarios');
  const status = document.getElementById('status-consulta');

  tbody.innerHTML = '';
  status.textContent = `Consultando página ${paginaAtual}...`;

  const statusFiltro = document.getElementById('filtro-status').value;
  const filtrarVencidos = document.getElementById('filtro-vencidos').checked;
  const filtrarSemValor = document.getElementById('filtro-semvalor').checked;
  const filtrarSolicitacoes = document.getElementById('filtro-solicitacoes').checked;

  let query = db.collection('usuarios').orderBy('nome');

  if (termoBuscaUsuario) {
    query = db.collection('usuarios')
      .orderBy('nome_lowercase')
      .startAt(termoBuscaUsuario.toLowerCase())
      .endAt(termoBuscaUsuario.toLowerCase() + '\uf8ff');
  } else {
    query = query.limit(limitePorPagina);
    if (historicoDocs[paginaAtual - 1]) {
      query = query.startAfter(historicoDocs[paginaAtual - 1]);
    }
  }

  const snap = await query.get();
  const docs = snap.docs;

  if (docs.length === 0) {
    status.textContent = "🚫 Nenhum registro encontrado.";
    return;
  }

  if (!termoBuscaUsuario) {
    historicoDocs[paginaAtual] = docs[docs.length - 1];
    paginaAtual++;
  }

  const hoje = new Date();

  // 🔁 Processar usuários em paralelo
  const usuariosProcessados = await Promise.all(docs.map(async (doc, index) => {
    const d = doc.data();

    if (statusFiltro === "ativo" && !d.ativo) return null;
    if (statusFiltro === "inativo" && d.ativo) return null;

    const ref = db.collection("usuarios").doc(doc.id);

    const [solicitacoesSnap, pagamentosSnap] = await Promise.all([
      ref.collection("solicitacoes").where("status", "in", ["pendente", "aberta"]).get(),
      ref.collection("pagamentos").get()
    ]);

    const temSolicitacoesPendentes = !solicitacoesSnap.empty;

    let temParcelasVencidas = false;
    let temParcelasAGerar = pagamentosSnap.empty;

    pagamentosSnap.forEach(p => {
      const pd = p.data();
      if (pd.status !== "pago" && pd.data_pagamento?.toDate() < hoje) {
        temParcelasVencidas = true;
      }
      if (!pd.valor) {
        temParcelasAGerar = true;
      }
    });

    if (filtrarVencidos && !temParcelasVencidas) return null;
    if (filtrarSemValor && !temParcelasAGerar) return null;
    if (filtrarSolicitacoes && !temSolicitacoesPendentes) return null;

    return {
      doc,
      index,
      d,
      temParcelasVencidas,
      temParcelasAGerar,
      temSolicitacoesPendentes
    };
  }));

  // 🔁 Renderizar usuários válidos
  usuariosProcessados.forEach((usuario, i) => {
    if (!usuario) return;

    const { doc, index, d, temParcelasVencidas, temParcelasAGerar, temSolicitacoesPendentes } = usuario;

    const tr = document.createElement('tr');
    tr.style.backgroundColor = index % 2 === 0 ? '#ffffff' : '#5facdf5d';

    let corFaixa = null;
    if (temParcelasVencidas) corFaixa = "red";
    else if (temSolicitacoesPendentes) corFaixa = "orange";
    else if (temParcelasAGerar) corFaixa = "blue";

    if (corFaixa) {
      tr.style.boxShadow = `inset 6px 0 0 0 ${corFaixa}`;
    }

    tr.innerHTML = `
      <td>${d.nome || ''}</td>
      <td>${d.email || ''}</td>
      <td>${d.cod_uf || '-'}</td> 
      <td>${d.nome_municipio || '-'}</td> 
      <td>${d.tipo_perfil || ''}</td>
      <td>${d.ativo ? 'Sim' : 'Não'}</td>
      <td>
        ${temParcelasVencidas ? '<span style="color:red" title="Parcelas vencidas">🔴</span>' : ''}
        ${temSolicitacoesPendentes ? '<span style="color:orange" title="Solicitações pendentes">🟠</span>' : ''}
        ${temParcelasAGerar ? '<span style="color:blue" title="Parcelas a gerar">🔵</span>' : ''}
      </td>
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

  status.textContent = termoBuscaUsuario
    ? `🔎 ${docs.length} resultado(s) para "${termoBuscaUsuario}"`
    : `Página ${paginaAtual - 1} de ${totalPaginas}`;

  document.getElementById('btn-proxima').disabled = false;
  document.getElementById('btn-anterior').disabled = false;
  document.getElementById('btn-primeira').disabled = false;
  document.getElementById('btn-listar').disabled = false;
}


let termoBuscaUsuario = "";

async function iniciarConsultaUsuarios() {
  paginaAtual = 1;
  historicoDocs = [];
  document.getElementById('lista-usuarios').innerHTML = '';
  document.getElementById('status-consulta').textContent = "⏳ Contando registros...";
  document.getElementById('btn-proxima').disabled = true;
  document.getElementById('btn-anterior').disabled = true;
  document.getElementById('btn-primeira').disabled = true;
  document.getElementById('btn-listar').disabled = true;

  termoBuscaUsuario = document.getElementById("busca-usuarios").value.trim();

  await contarUsuariosComFiltro();
  carregarUsuariosComFiltro();
}


async function contarUsuariosComFiltro() {
  const statusFiltro = document.getElementById('filtro-status').value;
  const filtrarVencidos = document.getElementById('filtro-vencidos').checked;
  const filtrarSemValor = document.getElementById('filtro-semvalor').checked;
  const filtrarSolicitacoes = document.getElementById('filtro-solicitacoes').checked;
  const termoBusca = document.getElementById('busca-usuarios').value.trim().toLowerCase();

  const barra = document.getElementById('barra-progresso');
  barra.style.display = 'block';
  barra.value = 0;

  let query = firebase.firestore().collection('usuarios');

  if (termoBusca) {
    query = query
      .orderBy('nome_lowercase')
      .startAt(termoBusca)
      .endAt(termoBusca + '\uf8ff');
  }

  if (statusFiltro === "ativo") query = query.where("ativo", "==", true);
  if (statusFiltro === "inativo") query = query.where("ativo", "==", false);

  const snap = await query.get();
  const docs = snap.docs;
  const totalDocs = docs.length;
  let contador = 0;

  for (let i = 0; i < totalDocs; i++) {
    const doc = docs[i];
    const d = doc.data();
    const ref = doc.ref;

    let temSolicitacoesPendentes = false;
    let temParcelasVencidas = false;
    let temParcelasAGerar = false;

    // 🔍 Só consulta subcoleções se necessário
    const promises = [];

    if (filtrarSolicitacoes) {
      promises.push(
        ref.collection("solicitacoes")
          .where("status", "in", ["pendente", "aberta"])
          .limit(1)
          .get()
          .then(snap => {
            temSolicitacoesPendentes = !snap.empty;
          })
      );
    }

    if (filtrarVencidos || filtrarSemValor) {
      promises.push(
        ref.collection("pagamentos")
          .get()
          .then(snap => {
            const hoje = new Date();
            if (snap.empty) {
              temParcelasAGerar = true;
            } else {
              snap.forEach(p => {
                const pd = p.data();
                if (pd.status !== "pago" && pd.data_pagamento?.toDate() < hoje) {
                  temParcelasVencidas = true;
                }
                if (!pd.valor) {
                  temParcelasAGerar = true;
                }
              });
            }
          })
      );
    }

    await Promise.all(promises);

    // Aplicar filtros complexos
    if (filtrarVencidos && !temParcelasVencidas) continue;
    if (filtrarSemValor && !temParcelasAGerar) continue;
    if (filtrarSolicitacoes && !temSolicitacoesPendentes) continue;

    contador++;
    barra.value = Math.round((i / totalDocs) * 100);
  }

  barra.style.display = 'none';
  totalUsuarios = contador;
  totalPaginas = Math.ceil(contador / limitePorPagina);
}

function abrirPainelGestao() {
  // Oculta outras seções, se necessário
  document.querySelectorAll('section').forEach(sec => sec.style.display = 'none');

  // Exibe o painel
  document.getElementById('painel-gestao').style.display = 'block';
  atualizarGraficosPorPeriodo();
}

async function carregarResumoUsuarios(periodoDias = 30) {
  const dataMinima = getDataMinima(periodoDias);
  const usuariosRef = firebase.firestore().collection('usuarios');

  let ativos = 0;
  let inativos = 0;

  const snap = await usuariosRef.get();
  snap.forEach(doc => {
    const d = doc.data();
    const dataCadastro = d.data_cadastro?.toDate?.() || new Date(d.data_cadastro);
    if (!dataCadastro || dataCadastro < dataMinima) return;

    if (d.ativo) {
      ativos++;
    } else {
      inativos++;
    }
  });

  if (window.graficoUsuarios) {
    graficoUsuarios.data.datasets[0].data = [ativos, inativos];
    graficoUsuarios.update();
  }
}


async function carregarResumoLeads(periodoDias = 30) {
  const dataMinima = getDataMinima(periodoDias);
  const leadsSnap = await db.collection("leads")
    .where("data_criacao", ">=", dataMinima)
    .get();

  const contagem = {
    "Novo": 0,
    "Em contato": 0,
    "Negociando": 0,
    "Convertido": 0,
    "Descartado": 0
  };

  leadsSnap.forEach(doc => {
    const status = doc.data().status;
    if (contagem.hasOwnProperty(status)) {
      contagem[status]++;
    }
  });

  if (window.graficoLeads) {
    graficoLeads.data.datasets[0].data = [
      contagem["Novo"],
      contagem["Em contato"],
      contagem["Negociando"],
      contagem["Convertido"],
      contagem["Descartado"]
    ];
    graficoLeads.update();
  }

}

async function carregarResumoPagamentos(periodoDias = 30) {
  const dataMinima = getDataMinima(periodoDias);
  const usuariosSnap = await db.collection("usuarios").get();

  const contagem = {
    pago: 0,
    pendente: 0,
    cancelado: 0
  };

  await Promise.all(usuariosSnap.docs.map(async usuarioDoc => {
    const pagamentosSnap = await usuarioDoc.ref
      .collection("pagamentos")
      .where("data_pagamento", ">=", dataMinima)
      .get();

    pagamentosSnap.forEach(doc => {
      const status = doc.data().status?.toLowerCase();
      if (contagem.hasOwnProperty(status)) {
        contagem[status]++;
      }
    });
  }));

  if (window.graficoPagamentos) {
    graficoPagamentos.data.labels = Object.keys(contagem);
    graficoPagamentos.data.datasets[0].data = Object.values(contagem);
    graficoPagamentos.data.datasets[0].backgroundColor = ['#4caf50', '#ff9800', '#9e9e9e'];
    graficoPagamentos.update();
  }
}

async function carregarResumoAssinaturas(periodoDias = 30) {
  const dataMinima = getDataMinima(periodoDias);
  const usuariosSnap = await db.collection("usuarios").get();

  const contagemPorTipo = {};

  await Promise.all(usuariosSnap.docs.map(async usuarioDoc => {
    const assinaturasSnap = await usuarioDoc.ref
      .collection("assinaturas")
      .where("data_inicio", ">=", dataMinima)
      .get();

    assinaturasSnap.forEach(doc => {
      const tipo = doc.data().tipo_newsletter?.trim();
      if (tipo) {
        const tipoFormatado = tipo.charAt(0).toUpperCase() + tipo.slice(1).toLowerCase();
        contagemPorTipo[tipoFormatado] = (contagemPorTipo[tipoFormatado] || 0) + 1;
      }
    });
  }));

  const labels = Object.keys(contagemPorTipo);
  const valores = Object.values(contagemPorTipo);
  const cores = ['#3f51b5', '#009688', '#ff9800', '#e91e63', '#4caf50', '#795548', '#9c27b0'];

  if (window.graficoAssinaturas) {
    graficoAssinaturas.data.labels = labels;
    graficoAssinaturas.data.datasets[0].data = valores;
    graficoAssinaturas.data.datasets[0].backgroundColor = labels.map((_, i) => cores[i % cores.length]);
    graficoAssinaturas.update();
  }
}


async function carregarComparativoPreferenciasAssinaturas(periodoDias = 30) {
  const dataMinima = getDataMinima(periodoDias);
  const tiposSnap = await db.collection("tipo_newsletters").get();
  const tipos = tiposSnap.docs.map(doc => (doc.data().nome || "").trim().toLowerCase());

  const mapaPreferencias = Object.fromEntries(tipos.map(t => [t, 0]));
  const mapaAssinaturas = Object.fromEntries(tipos.map(t => [t, 0]));

  const usuariosSnap = await db.collection("usuarios").get();

  await Promise.all(usuariosSnap.docs.map(async usuarioDoc => {
    const usuarioId = usuarioDoc.id;

    const prefsSnap = await db.collection("usuarios")
      .doc(usuarioId)
      .collection("preferencias_newsletter")
      .get();

    prefsSnap.forEach(doc => {
      const tipo = doc.id.toLowerCase();
      if (mapaPreferencias.hasOwnProperty(tipo)) {
        mapaPreferencias[tipo]++;
      }
    });

    const assinaturasSnap = await db.collection("usuarios")
      .doc(usuarioId)
      .collection("assinaturas")
      .where("data_inicio", ">=", dataMinima)
      .get();

    assinaturasSnap.forEach(doc => {
      const tipo = doc.data().tipo_newsletter?.toLowerCase();
      if (tipo && mapaAssinaturas.hasOwnProperty(tipo)) {
        mapaAssinaturas[tipo]++;
      }
    });
  }));

  const labels = tipos.map(t => t.charAt(0).toUpperCase() + t.slice(1));
  const preferencias = tipos.map(t => mapaPreferencias[t]);
  const assinaturas = tipos.map(t => mapaAssinaturas[t]);

  if (window.graficoComparativo) {
    graficoComparativo.data.labels = labels;
    graficoComparativo.data.datasets[0].data = preferencias;
    graficoComparativo.data.datasets[1].data = assinaturas;
    graficoComparativo.update();
  }

  // Alertas e sugestões
  const alertas = [];
  tipos.forEach(tipo => {
    const pref = mapaPreferencias[tipo];
    const ass = mapaAssinaturas[tipo];
    const taxa = pref > 0 ? (ass / pref) : 0;
    if (pref >= 10 && taxa < 0.3) {
      alertas.push({ tipo, pref, ass, taxa });
    }
  });

  const container = document.getElementById("alertas-baixa-conversao");
  container.innerHTML = alertas.length
    ? `<h4>⚠️ Tipos com baixa conversão</h4><ul>${alertas.map(a =>
      `<li><strong>${a.tipo}</strong>: ${a.pref} preferências, ${a.ass} assinaturas (${Math.round(a.taxa * 100)}%)</li>`).join("")}</ul>`
    : "<p>✅ Nenhum tipo com baixa conversão no período selecionado.</p>";

  const sugestoes = alertas.map(a => {
    if (a.pref >= 40) return `Criar campanha de adesão para o tipo “${a.tipo}”.`;
    if (a.pref >= 20) return `Oferecer plano básico ou teste gratuito para o tipo “${a.tipo}”.`;
    return `Revisar estratégia de divulgação para o tipo “${a.tipo}”.`;
  });

  const sugestoesContainer = document.getElementById("sugestoes-acoes");
  sugestoesContainer.innerHTML = sugestoes.length
    ? `<h4>📌 Sugestões de ação</h4><ul>${sugestoes.map(s => `<li>${s}</li>`).join("")}</ul>`
    : "<p>✅ Nenhuma sugestão necessária no período selecionado.</p>";
}

function atualizarGraficosPorPeriodo() {
  const dias = parseInt(document.getElementById("filtro-periodo").value);
  carregarResumoUsuarios(dias);
  carregarResumoLeads(dias);
  carregarResumoPagamentos(dias);
  carregarResumoAssinaturas(dias);
  carregarComparativoPreferenciasAssinaturas(dias);
}

// Referência ao Firestore
const backlogRef = db.collection("backlog");

// Adicionar novo item
async function adicionarItemBacklog() {
  const titulo = prompt("Título do item:");
  const descricao = prompt("Descrição:");
  if (!titulo) return;

  await backlogRef.add({
    titulo,
    descricao,
    status: "afazer",
    dataCriacao: firebase.firestore.Timestamp.now()
  });

  carregarBacklog();
}

// Mover item para outro status
async function moverItem(id, novoStatus) {
  await backlogRef.doc(id).update({ status: novoStatus });
  carregarBacklog();
}

// Excluir item
async function excluirItem(id) {
  await backlogRef.doc(id).delete();
  carregarBacklog();
}

async function editarItem(id, tituloAtual, descricaoAtual) {
  const novoTitulo = prompt("Novo título:", tituloAtual);
  if (!novoTitulo) return;

  const novaDescricao = prompt("Nova descrição:", descricaoAtual);

  await backlogRef.doc(id).update({
    titulo: novoTitulo,
    descricao: novaDescricao
  });

  carregarBacklog();
}

// 🔑 Inicializa ao abrir a aba Kanban
function abrirAbaBacklog() {
  mostrarSecaoPrincipal("secao-backlog");
  carregarBacklog();
  //  cargakanban();
}

async function carregarBacklog() {
  const snapshot = await backlogRef.orderBy("dataCriacao").get();
  backlog = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  renderizarKanban();
}

function renderizarKanban() {
  document.getElementById("kanban-afazer").innerHTML = "";
  document.getElementById("kanban-andamento").innerHTML = "";
  document.getElementById("kanban-concluido").innerHTML = "";

  backlog.forEach(item => {
    const destino = document.getElementById(`kanban-${item.status}`);
    if (!destino) return;

    const card = document.createElement("div");
    card.style = "background:#fff; margin:5px 0; padding:10px; border:1px solid #999;";
    card.innerHTML = `
      <strong>${item.titulo}</strong><br>
      <small>${item.descricao || ""}</small><br>
      <small>Status: ${item.status}</small>
      <div style="margin-top:5px;">
        ${item.status !== "afazer" ? `<button onclick="moverItem('${item.id}', 'afazer')">⬅️ A Fazer</button>` : ""}
        ${item.status !== "andamento" ? `<button onclick="moverItem('${item.id}', 'andamento')">⚙️ Em andamento</button>` : ""}
        ${item.status !== "concluido" ? `<button onclick="moverItem('${item.id}', 'concluido')">✅ Concluir</button>` : ""}
        <button onclick="editarItem('${item.id}', '${item.titulo}', '${item.descricao || ""}')">✏️ Editar</button>
        <button onclick="excluirItem('${item.id}')">🗑️ Excluir</button>
      </div>
    `;
    destino.appendChild(card);
  });
}

async function cargakanban() {
  // Inserções iniciais no Firestore para o backlog
  await backlogRef.add({
    titulo: "Tela de Orientações",
    descricao: "Criar aba/tela com explicações técnicas (Providers, Variáveis, Regras, Rate limiting, Checklist).",
    status: "concluido",
    dataCriacao: firebase.firestore.Timestamp.now()
  });

  await backlogRef.add({
    titulo: "Kanban Backlog",
    descricao: "Criar seção Kanban com três colunas e persistência no Firestore.",
    status: "andamento",
    dataCriacao: firebase.firestore.Timestamp.now()
  });

  await backlogRef.add({
    titulo: "Migração para SES",
    descricao: "Alterar provider de envio de e‑mail para Amazon SES em produção e configurar variáveis de ambiente.",
    status: "afazer",
    dataCriacao: firebase.firestore.Timestamp.now()
  });

  await backlogRef.add({
    titulo: "Otimização da Prévia",
    descricao: "Melhorar tela de prévia para mostrar apenas destinatários válidos e habilitar botão corretamente.",
    status: "afazer",
    dataCriacao: firebase.firestore.Timestamp.now()
  });

  await backlogRef.add({
    titulo: "Melhorias de UI",
    descricao: "Avaliar uso de accordion na tela de Orientações e contador de itens por coluna no Kanban.",
    status: "afazer",
    dataCriacao: firebase.firestore.Timestamp.now()
  });

}

async function carregarTemplatesNewsletter() {
  const tbody = document.getElementById('lista-templates-newsletter');
  if (!tbody) return;
  tbody.innerHTML = '';

  const snap = await db.collection('templates_newsletter').orderBy('nome').get();
  snap.forEach(doc => {
    const d = doc.data() || {};
    const tr = document.createElement('tr');

    const criadoEm = d.criado_em?.toDate ? d.criado_em.toDate().toLocaleDateString() : '-';

    tr.innerHTML = `
      <td>${d.nome || ''}</td>
      <td>${d.descricao || '-'}</td>
      <td>${d.tipo || '-'}</td>
      <td>${d.classificacao || '-'}</td>
      <td>${d.ativo ? '✅' : '❌'}</td>
      <td>${criadoEm}</td>
      <td>
        <span class="icon-btn" title="Editar" onclick="abrirModalTemplateNewsletter('${doc.id}', true)">✏️</span>
        <span class="icon-btn" title="Excluir" onclick="confirmarExclusaoTemplateNewsletter('${doc.id}','${(d.nome || '').replace(/'/g, "\\'")}')">🗑️</span>
        <span class="icon-btn" title="Duplicar" onclick="duplicarTemplateNewsletter('${doc.id}')">📄</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function duplicarTemplateNewsletter(templateId) {
  const snap = await db.collection('templates_newsletter').doc(templateId).get();
  if (!snap.exists) {
    alert("Template original não encontrado.");
    return;
  }

  const original = snap.data();
  const copia = {
    ...original,
    nome: `${original.nome || 'Template'} (cópia)`,
    criado_em: new Date()
  };

  abrirModalTemplateNewsletter(null, false, copia);
}

function filtrarTemplatesNewsletter() {
  const filtro = document.getElementById('busca-templates-newsletter').value.toLowerCase();
  document.querySelectorAll('#lista-templates-newsletter tr').forEach(tr => {
    tr.style.display = Array.from(tr.children).some(td => td.innerText.toLowerCase().includes(filtro)) ? '' : 'none';
  });
}

function confirmarExclusaoTemplateNewsletter(id, nome) {
  abrirConfirmacao(`Deseja excluir o template "${nome}"?`, async () => {
    await db.collection('templates_newsletter').doc(id).delete();
    carregarTemplatesNewsletter();
  });
}

function filtrarTemplatesNewsletter() {
  const filtro = document.getElementById('busca-templates-newsletter').value.toLowerCase();
  document.querySelectorAll('#lista-templates-newsletter tr').forEach(tr => {
    tr.style.display = Array.from(tr.children).some(td => td.innerText.toLowerCase().includes(filtro)) ? '' : 'none';
  });
}

async function abrirModalTemplateNewsletter(docId = null, isEdit = false, dadosPrePreenchidos = {}) {

  let data = dadosPrePreenchidos || {};
  if (isEdit && docId) {
    const snap = await db.collection('templates_newsletter').doc(docId).get();
    data = snap.exists ? snap.data() : {};
  }

  const title = document.getElementById('modal-edit-title');
  const body = document.getElementById('modal-edit-body');
  document.getElementById("modal-edit-save").style.display = "inline-block";
  title.innerText = isEdit ? 'Editar Template de Newsletter' : 'Novo Template de Newsletter';
  body.innerHTML = '';

  // Campos principais
  body.appendChild(generateTextField('nome', data.nome || ''));
  body.appendChild(generateTextAreaField('descricao', data.descricao || '', 'Descrição do template'));

  const tiposSnap = await db.collection('tipo_newsletters').orderBy('nome').get();
  const tipos = tiposSnap.docs.map(doc => doc.data().nome);
  body.appendChild(generateSelectField('tipo', tipos, data.tipo || '', 'Tipo de newsletter'));

  body.appendChild(generateSelectField('classificacao', ['Básica', 'Premium'], data.classificacao || '', 'Classificação'));
  body.appendChild(generateCheckboxField('ativo', 'Template ativo?', data.ativo ?? true));

  // Seletor de lead para visualização
  const seletorLead = document.createElement('select');
  seletorLead.id = 'seletor-lead-preview';
  seletorLead.style.width = '100%';
  seletorLead.style.marginTop = '10px';
  seletorLead.innerHTML = `<option value="">Selecione um usuário para visualizar</option>`;
  const leadsSnap = await db.collection('leads').orderBy('nome').limit(50).get();
  leadsSnap.forEach(doc => {
    const d = doc.data();
    seletorLead.innerHTML += `<option value="${doc.id}">${d.nome} (${d.email})</option>`;
  });
  body.appendChild(seletorLead);

  // Explicação dos placeholders
  const explicacao = document.createElement('div');
  explicacao.innerHTML = `
    <div class="info-box" style="background:#eef; padding:10px; border-left:4px solid #88f; margin-top:10px;">
      <strong>📌 Placeholders disponíveis:</strong>
      <ul style="margin-top:5px; font-size:14px;">
        <li><code>{{nome}}</code> → Nome do usuário</li>
        <li><code>{{email}}</code> → E-mail do usuário</li>
        <li><code>{{edicao}}</code> → Número da edição</li>
        <li><code>{{tipo}}</code> → Tipo Newsletter</li>
        <li><code>{{titulo}}</code> → Título da edição</li>
        <li><code>{{data_publicacao}}</code> → Data da edição (formato DD/MM/AAAA)</li>
        <li><code>{{blocos}}</code> → Local de inserção dos blocos</li>
      </ul>
      <p>Esses campos serão substituídos automaticamente no momento do envio.</p>
    </div>`;
  body.appendChild(explicacao);

  const lbl = document.createElement('label');
  lbl.innerText = 'Conteudo do HTML';
  lbl.style.marginTop = "15px";
  body.appendChild(lbl);

  // Campo HTML base (compatibilidade com o que já existe)
  const ta = document.createElement('textarea');
  ta.rows = 10;
  ta.style.width = '100%';
  ta.dataset.fieldName = 'html_base';
  ta.id = 'campo-html-template';
  ta.value = data.html_base || '';
  body.appendChild(ta);

  // 🔹 Seção NOVA: blocos de conteúdo
  const tituloBlocos = document.createElement('h4');
  tituloBlocos.innerText = "Blocos de conteúdo (opcional)";
  tituloBlocos.style.marginTop = "15px";
  body.appendChild(tituloBlocos);

  const descBlocos = document.createElement('p');
  descBlocos.style.fontSize = "13px";
  descBlocos.style.color = "#555";
  descBlocos.innerHTML = `
    Você pode dividir o conteúdo em blocos e definir quem pode ver cada um:
    <strong>Todos</strong>, <strong>Leads</strong> ou <strong>Assinantes</strong>.<br>
    Se nenhum bloco for cadastrado, será usado o HTML base acima.
  `;
  body.appendChild(descBlocos);

  const btnAddBloco = document.createElement('button');
  btnAddBloco.type = "button";
  btnAddBloco.innerText = "➕ Adicionar bloco";
  btnAddBloco.style.marginBottom = "10px";
  btnAddBloco.onclick = () => adicionarBlocoNewsletter();
  body.appendChild(btnAddBloco);

  const containerBlocos = document.createElement('div');
  containerBlocos.id = "container-blocos-newsletter";
  containerBlocos.style.border = "1px solid #ddd";
  containerBlocos.style.padding = "10px";
  containerBlocos.style.borderRadius = "4px";
  containerBlocos.style.maxHeight = "300px";
  containerBlocos.style.overflowY = "auto";
  body.appendChild(containerBlocos);

  // Se já existirem blocos no template, renderiza
  if (Array.isArray(data.blocos) && data.blocos.length > 0) {
    data.blocos.forEach((b, idx) => {
      adicionarBlocoNewsletter(b, idx);
    });
  }

  // ✅ BOTÃO DE PREVIEW COMPLETO
  const btnPreview = document.createElement('button');
  btnPreview.innerText = '👁️ Visualizar HTML (com blocos)';
  btnPreview.style.marginTop = '10px';
  btnPreview.type = "button";

  btnPreview.onclick = async () => {
    const leadId = document.getElementById('seletor-lead-preview')?.value;
    if (!leadId) return alert("Selecione um usuário para visualizar.");

    const leadSnap = await db.collection('leads').doc(leadId).get();
    if (!leadSnap.exists) return alert("Usuário não encontrado.");

    const dados = leadSnap.data();
    dados.edicao = "001";
    dados.tipo = document.querySelector('[data-field-name="tipo"]')?.value || "Institucional";
    dados.titulo = "Pré-visualização do Template";
    dados.data_publicacao = new Date();

    // ✅ Coleta blocos do template
    const blocos = coletarBlocosNewsletter();

    let htmlFinal = "";

    let htmlBase = document.getElementById('campo-html-template').value || "";
    let htmlBlocos = "";

    // ✅ Monta blocos com bordas e numeração
    blocos.forEach((b, i) => {
      const cor =
        b.acesso === "assinantes" ? "#2e7d32" :
          b.acesso === "leads" ? "#ff9800" :
            "#1976d2";

      htmlBlocos += `
    <div style="border:2px dashed ${cor}; padding:10px; margin:15px 0; border-radius:6px;">
      <div style="font-size:12px; color:${cor}; margin-bottom:5px;">
        <strong>Bloco ${i + 1}</strong> — acesso: ${b.acesso}
      </div>
      ${b.html || ""}
    </div>
  `;
    });

    // ✅ Se o template tiver {{blocos}}, substitui
    if (htmlBase.includes("{{blocos}}")) {
      htmlFinal = htmlBase.replace("{{blocos}}", htmlBlocos);
    } else {
      // ✅ Caso contrário, adiciona no final
      htmlFinal = htmlBase + "\n" + htmlBlocos;
    }

    // ✅ Aplica placeholders
    htmlFinal = aplicarPlaceholders(htmlFinal, dados);

    // ✅ Exibe no modal
    const iframe = document.getElementById('iframe-html-preview');
    iframe.srcdoc = htmlFinal;

    openModal('modal-html-preview');
  };

  body.appendChild(btnPreview);

  // ✅ Preview como Lead
  const btnPreviewLead = document.createElement('button');
  btnPreviewLead.innerText = '👤 Visualizar como Lead';
  btnPreviewLead.style.marginLeft = '10px';
  btnPreviewLead.onclick = () => previewSegmentado("leads");
  body.appendChild(btnPreviewLead);

  // ✅ Preview como Assinante
  const btnPreviewAssinante = document.createElement('button');
  btnPreviewAssinante.innerText = '⭐ Visualizar como Assinante';
  btnPreviewAssinante.style.marginLeft = '10px';
  btnPreviewAssinante.onclick = () => previewSegmentado("assinantes");
  body.appendChild(btnPreviewAssinante);

  // ✅ Preview HTML puro
  const btnPreviewPuro = document.createElement('button');
  btnPreviewPuro.innerText = '🧪 Visualizar HTML puro';
  btnPreviewPuro.style.marginLeft = '10px';
  btnPreviewPuro.onclick = () => previewSegmentado("puro");
  body.appendChild(btnPreviewPuro);

  // Botão de salvar
  document.getElementById('modal-edit-save').onclick = async () => {
    const payload = {};
    body.querySelectorAll('[data-field-name]').forEach(el => {
      payload[el.dataset.fieldName] = el.type === 'checkbox' ? el.checked : el.value;
    });

    // 🔹 Coleta blocos (nova parte)
    payload.blocos = coletarBlocosNewsletter();

    if (!isEdit || !data.criado_em) {
      payload.criado_em = new Date();
    }

    const erros = validarHtmlEmail(htmlFinal, []);
    if (erros.length > 0) {
      alert("Erros:\n" + erros.join("\n"));
      return;
    }

    const htmlTemplate = payload['html_base'] || "";
    const blocos = coletarBlocosEdicao(); // templates também têm blocos

    if (!validarNewsletter(htmlTemplate, blocos)) {
      return;
    }

    if (isEdit && docId) {
      await db.collection('templates_newsletter').doc(docId).set(payload, { merge: true });
    } else {
      await db.collection('templates_newsletter').add(payload);
    }

    closeModal('modal-edit-overlay');
    carregarTemplatesNewsletter();
  };

  openModal('modal-edit-overlay');
}

function previewSegmentado(tipo) {
  const blocos = coletarBlocosNewsletter();
  let htmlBase = document.getElementById('campo-html-template').value || "";
  let htmlBlocos = "";

  blocos.forEach(b => {
    if (tipo === "puro" || b.acesso === "todos" || b.acesso === tipo) {
      htmlBlocos += b.html || "";
    }
  });

  let htmlFinal = "";

  if (htmlBase.includes("{{blocos}}")) {
    htmlFinal = htmlBase.replace("{{blocos}}", htmlBlocos);
  } else {
    htmlFinal = htmlBase + "\n" + htmlBlocos;
  }

  const iframe = document.getElementById('iframe-html-preview');
  iframe.srcdoc = htmlFinal;

  openModal('modal-html-preview');
}


function adicionarBlocoNewsletter(bloco = {}, index = null) {
  const container = document.getElementById("container-blocos-newsletter");
  if (!container) return;

  const wrapper = document.createElement("div");
  wrapper.className = "bloco-newsletter";
  wrapper.style.border = "1px solid #ccc";
  wrapper.style.padding = "8px";
  wrapper.style.marginBottom = "8px";
  wrapper.style.borderRadius = "4px";
  wrapper.style.background = "#fafafa";

  const idx = index ?? Date.now(); // identificador simples

  // Título do bloco
  const inputTitulo = document.createElement("input");
  inputTitulo.type = "text";
  inputTitulo.placeholder = "Título do bloco (opcional)";
  inputTitulo.style.width = "100%";
  inputTitulo.style.marginBottom = "5px";
  inputTitulo.value = bloco.titulo || "";
  inputTitulo.dataset.blocoField = "titulo";
  wrapper.appendChild(inputTitulo);

  // Select de acesso
  const selectAcesso = document.createElement("select");
  selectAcesso.style.width = "100%";
  selectAcesso.style.marginBottom = "5px";
  selectAcesso.dataset.blocoField = "acesso";

  const opcoes = [
    { value: "todos", label: "Todos" },
    { value: "leads", label: "Somente leads" },
    { value: "assinantes", label: "Somente assinantes" }
  ];

  selectAcesso.innerHTML = opcoes
    .map(opt => `<option value="${opt.value}">${opt.label}</option>`)
    .join("");

  selectAcesso.value = bloco.acesso || "todos";
  wrapper.appendChild(selectAcesso);

  // Área HTML do bloco
  const taBloco = document.createElement("textarea");
  taBloco.rows = 5;
  taBloco.style.width = "100%";
  taBloco.placeholder = "HTML do bloco...";
  taBloco.value = bloco.html || "";
  taBloco.dataset.blocoField = "html";
  wrapper.appendChild(taBloco);

  // Botão remover
  const btnRemover = document.createElement("button");
  btnRemover.type = "button";
  btnRemover.innerText = "Remover bloco";
  btnRemover.style.marginTop = "5px";
  btnRemover.style.background = "#bbb";
  btnRemover.onclick = () => {
    container.removeChild(wrapper);
  };
  wrapper.appendChild(btnRemover);

  container.appendChild(wrapper);
}

function coletarBlocosNewsletter() {
  const container = document.getElementById("container-blocos-newsletter");
  if (!container) return [];

  const blocos = [];
  const wrappers = container.querySelectorAll(".bloco-newsletter");

  wrappers.forEach(w => {
    const bloco = {};
    w.querySelectorAll("[data-bloco-field]").forEach(el => {
      const field = el.dataset.blocoField;
      bloco[field] = el.value;
    });

    // Ignora blocos totalmente vazios
    const isVazio =
      (!bloco.titulo || bloco.titulo.trim() === "") &&
      (!bloco.html || bloco.html.trim() === "");

    if (!isVazio) {
      bloco.acesso = bloco.acesso || "todos";
      blocos.push(bloco);
    }
  });

  return blocos;
}

function generateTextField(fieldName, value = '', label = '') {
  const wrapper = document.createElement('div');
  wrapper.style.marginTop = '10px';

  const lbl = document.createElement('label');
  lbl.innerText = label || fieldName;
  wrapper.appendChild(lbl);

  const input = document.createElement('input');
  input.type = 'text';
  input.style.width = '100%';
  input.dataset.fieldName = fieldName;
  input.value = value;
  wrapper.appendChild(input);

  return wrapper;
}

function generateTextAreaField(fieldName, value = '', label = '') {
  const wrapper = document.createElement('div');
  wrapper.style.marginTop = '10px';

  const lbl = document.createElement('label');
  lbl.innerText = label || fieldName;
  wrapper.appendChild(lbl);

  const ta = document.createElement('textarea');
  ta.rows = 6;
  ta.style.width = '100%';
  ta.dataset.fieldName = fieldName;
  ta.value = value;
  wrapper.appendChild(ta);

  return wrapper;
}

function generateSelectField(fieldName, options = [], selectedValue = '', label = '') {
  const wrapper = document.createElement('div');
  wrapper.style.marginTop = '10px';

  const lbl = document.createElement('label');
  lbl.innerText = label || fieldName;
  wrapper.appendChild(lbl);

  const select = document.createElement('select');
  select.style.width = '100%';
  select.dataset.fieldName = fieldName;

  options.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt;
    option.innerText = opt;
    if (opt === selectedValue) option.selected = true;
    select.appendChild(option);
  });

  wrapper.appendChild(select);
  return wrapper;
}

function generateCheckboxField(fieldName, label = '', checked = false) {
  const wrapper = document.createElement('div');
  wrapper.style.marginTop = '10px';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.dataset.fieldName = fieldName;
  input.checked = checked;

  const lbl = document.createElement('label');
  lbl.innerText = label || fieldName;
  lbl.style.marginLeft = '5px';

  wrapper.appendChild(input);
  wrapper.appendChild(lbl);

  return wrapper;
}


/* ======================
   EXPORTAR GLOBAL
   ====================== */
window.carregarUsuariosComFiltro = carregarUsuariosComFiltro;
window.abrirModalCriarUsuario = abrirModalCriarUsuario;
window.abrirModalEditarUsuario = abrirModalEditarUsuario;
window.confirmarExclusaoUsuario = confirmarExclusaoUsuario;
window.abrirModalPlano = abrirModalPlano;
window.abrirModalNewsletter = abrirModalNewsletter;
window.filtrarUsuarios = filtrarUsuarios;
window.filtrarPlanos = filtrarPlanos;