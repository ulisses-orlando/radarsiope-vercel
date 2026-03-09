/* ======================
   CONFIG FIREBASE
   ====================== */
const db = window.db;


let filtroAvaliacao = "todos";
let filtroTipoSolicitacao = "todos";
let filtroPeriodoAvaliacoes = "todos";
let filtroPerfilAvaliacoes = "todos";

const momentosEnvio = [
  // ——— Entrada e fluxo inicial ———
  { valor: "primeiro_contato", descricao: "📩 Primeiro contato via formulário de captura" },
  { valor: "pos_cadastro_assinante", descricao: "🎉 Após cadastro e ativação da assinatura" },
  { valor: "pos_envio_newsletter_1", descricao: "📰 Após envio da 1ª edição da newsletter" },
  { valor: "pos_envio_newsletter_2", descricao: "📰 Após envio da 2ª edição da newsletter" },
  { valor: "pos_envio_primeira_newsletter_regular", descricao: "📰 Primeira newsletter recebida junto com os demais assinantes" },

  // ——— Reengajamento ———
  { valor: "sem_interacao_7_dias", descricao: "⏳ Sem interação por 7 dias" },
  { valor: "sem_interacao_14_dias", descricao: "⏳ Sem interação por 14 dias" },

  // ——— Ciclo financeiro/contratual ———
  { valor: "renovacao_assinatura", descricao: "🔄 Renovação da assinatura confirmada" },
  { valor: "parcela_em_atraso", descricao: "💳 Parcela em atraso detectada" },
  { valor: "assinatura_cancelada", descricao: "❌ Assinatura cancelada" },

  // ——— Inclusões novas ———
  { valor: "aniversario_assinatura", descricao: "🎂 Aniversário da assinatura (1 ano ou mais)" },
  { valor: "upgrade_plano", descricao: "🚀 Upgrade de plano realizado" },
  { valor: "suporte_resolvido", descricao: "✅ Solicitação de suporte resolvida" },

  // ——— Interesses ———
  { valor: "interesse_capacitacao", descricao: "🎓 Interesse marcado: Capacitação" },
  { valor: "interesse_consultoria", descricao: "🧭 Interesse marcado: Consultoria" },
  { valor: "interesse_siope", descricao: "📊 Interesse marcado: SIOPE" },
  { valor: "interesse_fundeb", descricao: "📊 Interesse marcado: FUNDEB" },
  { valor: "interesse_cacs", descricao: "📊 Interesse marcado: CACS" },
  { valor: "interesse_salario-educacao", descricao: "📊 Interesse marcado: SALÁRIO-EDUCAÇÃO" },

  // ——— Uso manual/padrão ———
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
      mostrarMensagem("E-mail é obrigatório.");
      return;
    }

    const snap = await db.collection("usuarios").where("email", "==", email).limit(1).get();
    if (!snap.empty) {
      mostrarMensagem("Já existe um usuário cadastrado com este e-mail.");
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
      mostrarMensagem("✅ Usuário criado e lead vinculado com sucesso!");
    } else {
      carregarUsuariosComFiltro();
      mostrarMensagem("✅ Usuário criado com sucesso!");
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
      mostrarMensagem("E-mail é obrigatório.");
      return;
    }

    const snap = await db.collection("usuarios").where("email", "==", email).limit(1).get();
    if (!snap.empty) {
      const usuarioEncontrado = snap.docs[0];
      if (usuarioEncontrado.id !== id) {
        mostrarMensagem("Já existe outro usuário cadastrado com este e-mail.");
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
   MODAL NEWSLETTERS
   ====================== */
async function abrirModalNewsletter(docId = null, isEdit = false) {
  const title = document.getElementById('modal-newsletter-title');
  title.innerText = isEdit ? 'Editar Newsletter' : 'Nova Newsletter';
  document.getElementById("modal-newsletter-save").style.display = "inline-block";

  const body = document.getElementById('modal-newsletter-body');
  body.innerHTML = '';

  // -----------------------------
  // Carrega dados da edição
  // -----------------------------
  let data = {};
  if (isEdit && docId) {
    const snap = await db.collection('newsletters').doc(docId).get();
    data = snap.exists ? snap.data() : {};
  }

  // -----------------------------
  // GRID PRINCIPAL (3 colunas)
  // -----------------------------
  const grid = document.createElement('div');
  grid.className = "newsletter-grid";
  body.appendChild(grid);

  const col1 = document.createElement('div'); // Campos iniciais
  const col2 = document.createElement('div'); // Editor HTML + templates + preview
  const col3 = document.createElement('div'); // Blocos
  /*   col1.style.marginTop = '350px';
    col2.style.marginTop = '350px';
    col3.style.marginTop = '350px'; */
  grid.appendChild(col1);
  grid.appendChild(col2);
  grid.appendChild(col3);

  // -----------------------------
  // COLUNA 1 — CAMPOS INICIAIS
  // -----------------------------
  //col1.appendChild(generateDateInput('data_publicacao', data.data_publicacao ? data.data_publicacao.toDate() : null));
  const dateWrap = document.createElement('div');
  dateWrap.style.marginTop = '10px';
  const dateLabel = document.createElement('label');
  dateLabel.innerText = 'Data de Publicação';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.style.width = '100%';
  dateInput.dataset.fieldName = 'data_publicacao';
  dateInput.value = data.data_publicacao ? data.data_publicacao.toDate().toISOString().split('T')[0] : '';
  dateWrap.appendChild(dateLabel);
  dateWrap.appendChild(dateInput);
  col1.appendChild(dateWrap);
  col1.appendChild(generateTextField('edicao', data.edicao));
  col1.appendChild(generateTextField('titulo', data.titulo));

  // Label do Resumo
  const resumoLabel = document.createElement('label');
  resumoLabel.innerText = 'Resumo';
  resumoLabel.style.display = 'block';
  resumoLabel.style.fontWeight = '600';
  resumoLabel.style.marginBottom = '0.25em';
  col1.appendChild(resumoLabel);

  // Campo Resumo (textarea curto)
  const resumoField = document.createElement('textarea');
  resumoField.rows = 3;
  resumoField.style.width = "100%";
  resumoField.style.marginTop = "10px";
  resumoField.dataset.fieldName = "resumo";
  resumoField.placeholder = "Resumo curto (máx. 200 caracteres)";
  resumoField.value = data.resumo || "";
  col1.appendChild(resumoField);

  // Campo de URL da imagem destacada
  const imagemField = generateTextField(
    'URL da imagem',
    data.imagem_url || '',
    'URL da imagem destacada (para carrossel)'
  );
  col1.appendChild(imagemField);

  // Pré-visualização da imagem
  const previewImg = document.createElement('img');
  previewImg.id = "preview-imagem-newsletter";
  previewImg.src = data.imagem_url || '';
  previewImg.style.maxWidth = "100%";
  previewImg.style.marginTop = "10px";
  previewImg.style.border = "1px solid #ccc";
  previewImg.style.borderRadius = "4px";
  previewImg.style.display = data.imagem_url ? "block" : "none";
  col1.appendChild(previewImg);

  // Atualiza preview quando o campo muda
  imagemField.oninput = () => {
    const url = imagemField.value.trim();
    if (url) {
      previewImg.src = url;
      previewImg.style.display = "block";
    } else {
      previewImg.style.display = "none";
    }
  };

  // Separador visual
  const sepWebApp = document.createElement('div');
  sepWebApp.style.cssText = `
    margin: 20px 0 12px;
    padding: 10px 12px;
    background: #EBF5FB;
    border-left: 4px solid #0A3D62;
    border-radius: 0 6px 6px 0;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .5px;
    color: #0A3D62;
  `;
  sepWebApp.textContent = '📡 Campos do Web App (verNewsletterComToken)';
  col1.appendChild(sepWebApp);

  // ── Número da edição (campo "numero" — usado na URL /edicao/001) ──────────
  const numeroWrap = document.createElement('div');
  numeroWrap.className = 'field';
  numeroWrap.innerHTML = `
    <label style="font-weight:600">Número da edição
      <span style="font-weight:400;color:#888;font-size:11px"> — usado na URL /edicao/001</span>
    </label>
    <input type="text" data-field-name="numero"
      value="${data.numero || ''}"
      placeholder="Ex: 001"
      style="font-family:monospace;letter-spacing:1px">
  `;
  col1.appendChild(numeroWrap);

  // ── Resumo bullets (modo rápido) ───────────────────────────────────────────
  const bulletsWrap = document.createElement('div');
  bulletsWrap.className = 'field';
  bulletsWrap.style.marginTop = '14px';

  const bulletsLabel = document.createElement('label');
  bulletsLabel.style.fontWeight = '600';
  bulletsLabel.innerHTML = `Pontos-chave (Modo Rápido)
    <span style="font-weight:400;color:#888;font-size:11px"> — um por linha</span>`;
  bulletsWrap.appendChild(bulletsLabel);

  const bulletsHelp = document.createElement('p');
  bulletsHelp.style.cssText = 'font-size:11px;color:#888;margin:3px 0 5px';
  bulletsHelp.textContent = 'Leads veem apenas os 2 primeiros. Assinantes veem todos.';
  bulletsWrap.appendChild(bulletsHelp);

  const bulletsTA = document.createElement('textarea');
  bulletsTA.rows = 6;
  bulletsTA.style.width = '100%';
  bulletsTA.style.fontFamily = 'system-ui, sans-serif';
  bulletsTA.style.fontSize = '13px';
  bulletsTA.id = 'campo-resumo-bullets';
  bulletsTA.placeholder = 'Ponto 1: ...\nPonto 2: ...\nPonto 3: ...';
  // Converte array → texto (uma linha por bullet)
  bulletsTA.value = Array.isArray(data.resumo_bullets) ? data.resumo_bullets.join('\n') : (data.resumo_bullets || '');
  bulletsWrap.appendChild(bulletsTA);

  // Contador de bullets
  const bulletsCount = document.createElement('div');
  bulletsCount.style.cssText = 'font-size:11px;color:#888;margin-top:3px;text-align:right';
  const atualizarContadorBullets = () => {
    const linhas = bulletsTA.value.split('\n').filter(l => l.trim());
    bulletsCount.textContent = `${linhas.length} ponto(s)`;
  };
  bulletsTA.addEventListener('input', atualizarContadorBullets);
  atualizarContadorBullets();
  bulletsWrap.appendChild(bulletsCount);
  col1.appendChild(bulletsWrap);

  // ── URLs de mídia ──────────────────────────────────────────────────────────
  const midiaLabel = document.createElement('div');
  midiaLabel.style.cssText = 'font-weight:600;margin:16px 0 8px;font-size:13px';
  midiaLabel.textContent = '🎧 URLs de Mídia';
  col1.appendChild(midiaLabel);

  // Áudio
  const audioWrap = document.createElement('div');
  audioWrap.className = 'field';
  audioWrap.innerHTML = `
    <label>URL do Podcast (áudio)
      <span style="font-weight:400;color:#888;font-size:11px"> — Essence+</span>
    </label>
    <div style="display:flex;gap:6px;align-items:center">
      <input type="url" data-field-name="audio_url"
        value="${data.audio_url || ''}"
        placeholder="https://app.radarsiope.com.br/media/podcasts/edicao-XXX.mp3"
        style="flex:1">
      <button type="button" title="Gerar URL padrão"
        style="padding:6px 10px;border-radius:6px;border:1px solid #ccc;background:#f5f5f5;cursor:pointer;font-size:12px;white-space:nowrap"
        onclick="(function(){
          const num = document.querySelector('[data-field-name=numero]')?.value || 'XXX';
          const n = String(num).padStart(3,'0');
          const el = this.closest('.field').querySelector('input');
          el.value = 'https://app.radarsiope.com.br/media/podcasts/edicao-' + n + '.mp3';
          el.dispatchEvent(new Event('input'));
        }).call(this)">📎 Gerar</button>
    </div>
  `;
  col1.appendChild(audioWrap);

  // Vídeo
  const videoWrap = document.createElement('div');
  videoWrap.className = 'field';
  videoWrap.innerHTML = `
    <label>URL do Vídeo
      <span style="font-weight:400;color:#888;font-size:11px"> — Profissional+</span>
    </label>
    <input type="url" data-field-name="video_url"
      value="${data.video_url || ''}"
      placeholder="https://youtube.com/watch?v=... ou https://youtu.be/...">
  `;
  col1.appendChild(videoWrap);

  // Infográfico
  const infoWrap = document.createElement('div');
  infoWrap.className = 'field';
  infoWrap.innerHTML = `
    <label>URL do Infográfico
      <span style="font-weight:400;color:#888;font-size:11px"> — Profissional+</span>
    </label>
    <div style="display:flex;gap:6px;align-items:center">
      <input type="url" data-field-name="infografico_url"
        value="${data.infografico_url || ''}"
        placeholder="https://app.radarsiope.com.br/media/infograficos/edicao-XXX.png"
        style="flex:1">
      <button type="button" title="Gerar URL padrão"
        style="padding:6px 10px;border-radius:6px;border:1px solid #ccc;background:#f5f5f5;cursor:pointer;font-size:12px;white-space:nowrap"
        onclick="(function(){
          const num = document.querySelector('[data-field-name=numero]')?.value || 'XXX';
          const n = String(num).padStart(3,'0');
          const el = this.closest('.field').querySelector('input');
          el.value = 'https://app.radarsiope.com.br/media/infograficos/edicao-' + n + '.png';
          el.dispatchEvent(new Event('input'));
        }).call(this)">📎 Gerar</button>
    </div>
  `;
  col1.appendChild(infoWrap);

  // ── FAQ ───────────────────────────────────────────────────────────────────
  const faqSection = document.createElement('div');
  faqSection.style.marginTop = '18px';

  const faqLabel = document.createElement('div');
  faqLabel.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:6px';
  faqLabel.innerHTML = `❓ FAQ
    <span style="font-weight:400;color:#888;font-size:11px"> — Leads veem apenas a 1ª pergunta</span>`;
  faqSection.appendChild(faqLabel);

  const faqContainer = document.createElement('div');
  faqContainer.id = 'faq-editor-container';
  faqContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  faqSection.appendChild(faqContainer);

  const btnAddFaq = document.createElement('button');
  btnAddFaq.type = 'button';
  btnAddFaq.innerText = '➕ Adicionar pergunta';
  btnAddFaq.style.cssText = 'margin-top:8px;padding:6px 12px;background:#0A3D62;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px';
  faqSection.appendChild(btnAddFaq);

  col1.appendChild(faqSection);

  // Renderiza itens do FAQ
  const faqInicial = Array.isArray(data.faq) ? data.faq : [];

  function renderFaqItem(pergunta = '', resposta = '') {
    const item = document.createElement('div');
    item.className = 'faq-editor-item';
    item.style.cssText = `
      border:1px solid #dde1e9;border-radius:8px;padding:10px;
      background:#f9fafb;position:relative
    `;
    item.innerHTML = `
      <button type="button" title="Remover"
        style="position:absolute;top:6px;right:8px;background:none;border:none;
               color:#dc2626;cursor:pointer;font-size:16px;line-height:1"
        onclick="this.closest('.faq-editor-item').remove()">×</button>
      <div style="margin-bottom:6px">
        <label style="font-size:11px;font-weight:600;color:#666;display:block;margin-bottom:3px">PERGUNTA</label>
        <input type="text" class="faq-pergunta"
          style="width:100%;padding:7px 10px;border:1.5px solid #dde1e9;border-radius:6px;font-size:13px"
          value="${pergunta.replace(/"/g, '&quot;')}"
          placeholder="Qual é a pergunta?">
      </div>
      <div>
        <label style="font-size:11px;font-weight:600;color:#666;display:block;margin-bottom:3px">RESPOSTA</label>
        <textarea class="faq-resposta" rows="2"
          style="width:100%;padding:7px 10px;border:1.5px solid #dde1e9;border-radius:6px;font-size:13px;resize:vertical"
          placeholder="Resposta...">${resposta}</textarea>
      </div>
    `;
    faqContainer.appendChild(item);
  }

  faqInicial.forEach(item => renderFaqItem(item.pergunta, item.resposta));
  btnAddFaq.onclick = () => renderFaqItem();

  // ── Acesso pro temporário para leads ──────────────────────────────────────
  const proTempSection = document.createElement('div');
  proTempSection.style.cssText = `
    margin-top:18px;padding:12px;border:1.5px solid #fbbf24;
    border-radius:8px;background:#fffbeb
  `;
  proTempSection.innerHTML = `
    <div style="font-weight:600;font-size:13px;color:#92400e;margin-bottom:8px">
      ⏳ Acesso Pro Temporário para Leads
    </div>
    <div style="font-size:12px;color:#78350f;margin-bottom:10px;line-height:1.5">
      Quando ativo, leads verão esta edição sem blur e sem truncamento
      pelo período definido — estratégia de conversão.
    </div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
        <input type="checkbox" id="chk-acesso-pro-temp"
          data-field-name="acesso_pro_temporario"
          ${data.acesso_pro_temporario ? 'checked' : ''}
          style="width:16px;height:16px">
        Ativar acesso pro temporário
      </label>
    </div>
    <div style="display:flex;align-items:center;gap:8px;font-size:13px">
      <label style="white-space:nowrap">Duração (horas):</label>
      <input type="number" data-field-name="acesso_pro_horas"
        min="1" max="168" value="${data.acesso_pro_horas || 24}"
        style="width:70px;padding:5px 8px;border:1.5px solid #fbbf24;border-radius:6px;font-size:13px">
    </div>
    <div style="margin-top:8px">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
        <input type="checkbox" data-field-name="acesso_audio_leads"
          ${data.acesso_audio_leads ? 'checked' : ''}
          style="width:16px;height:16px">
        Liberar áudio para leads nesta edição
      </label>
    </div>
  `;
  col1.appendChild(proTempSection);

  const tiposSnap = await db.collection("tipo_newsletters").get();
  const tiposDocs = tiposSnap.docs.map(doc => ({ id: doc.id, nome: doc.data().nome })).filter(t => t.nome);
  const tiposArr = tiposDocs.map(t => t.nome); // só nomes — usado no filtro de templates abaixo

  // Select tipo: value = ID, label = nome, fieldName = 'tipo'
  const tipoWrap = document.createElement('div');
  tipoWrap.className = 'field';
  const tipoLabel = document.createElement('label');
  tipoLabel.innerText = 'Tipo';
  const tipoSelect = document.createElement('select');
  tipoSelect.dataset.fieldName = 'tipo';
  tipoSelect.style.width = '100%';
  tipoSelect.innerHTML = '<option value="">Selecione...</option>';
  tiposDocs.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.nome;
    if (t.id === data.tipo) opt.selected = true; // data.tipo = ID gravado
    tipoSelect.appendChild(opt);
  });
  tipoWrap.appendChild(tipoLabel);
  tipoWrap.appendChild(tipoSelect);
  col1.appendChild(tipoWrap);

  // Classificação: passa 'classificacao' como fieldName para salvar no campo correto
  const selectClassificacao = generateDomainSelect('classificacao', ['Básica', 'Premium'], data.classificacao || 'Básica');
  col1.appendChild(selectClassificacao);

  // Campo "Enviada" (somente leitura)
  const enviadaDiv = document.createElement("div");
  enviadaDiv.className = "field";
  enviadaDiv.style.marginTop = "10px";
  enviadaDiv.innerHTML = `
      <label><strong>Status de Envio:</strong></label>
      <div id="status-envio-news" style="margin-top:4px; color:#555;">Carregando...</div>
    `;
  col1.appendChild(enviadaDiv);

  // -----------------------------
  // COLUNA 2 — EDITOR HTML + TEMPLATES + PREVIEW
  // -----------------------------
  const htmlWrap = document.createElement('div');
  htmlWrap.className = 'field';
  col2.appendChild(htmlWrap);

  // Explicação dos placeholders
  const explicacao = document.createElement('div');
  explicacao.innerHTML = gerarHtmlPlaceholdersExpandivel();
  htmlWrap.appendChild(explicacao);

  // Filtros de template
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

  // Seletor de template
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

  // Botão carregar template
  const btnCarregarTemplate = document.createElement('button');
  btnCarregarTemplate.innerText = '📥 Carregar HTML do Template';
  btnCarregarTemplate.style.marginTop = '10px';
  btnCarregarTemplate.onclick = async () => {
    const templateId = seletorTemplate.value;
    if (!templateId) return mostrarMensagem("Selecione um template.");

    const snap = await db.collection('templates_newsletter').doc(templateId).get();
    if (!snap.exists) return mostrarMensagem("Template não encontrado.");

    const template = snap.data();
    ta.value = template.html_base || '';

    if (template.blocos) {
      carregarBlocosDoTemplateNaEdicao(templateId);
    }
  };
  htmlWrap.appendChild(btnCarregarTemplate);

  // Campo HTML principal
  const lbl = document.createElement('label');
  lbl.innerText = 'Conteúdo do HTML';
  lbl.style.marginTop = "15px";
  htmlWrap.appendChild(lbl);

  const ta = document.createElement('textarea');
  ta.rows = 20;
  ta.style.width = '100%';
  ta.style.minHeight = "400px";
  ta.style.fontFamily = "monospace";
  ta.style.fontSize = "14px";
  ta.dataset.fieldName = 'html_conteudo';
  ta.id = 'campo-html-newsletter';
  ta.value = data.html_conteudo || '';
  htmlWrap.appendChild(ta);

  // Campo HTML completo
  const lblCompleto = document.createElement('label');
  lblCompleto.innerText = 'Conteúdo HTML Completo';
  lblCompleto.style.marginTop = "15px";
  htmlWrap.appendChild(lblCompleto);

  const taCompleto = document.createElement('textarea');
  taCompleto.rows = 20;
  taCompleto.style.width = '100%';
  taCompleto.style.minHeight = "400px";
  taCompleto.style.fontFamily = "monospace";
  taCompleto.style.fontSize = "14px";
  taCompleto.dataset.fieldName = 'conteudo_html_completo';
  taCompleto.id = 'campo-html-completo-newsletter';
  taCompleto.value = data.conteudo_html_completo || '';
  htmlWrap.appendChild(taCompleto);

  // -----------------------------
  // BOTÕES: COPIAR, PIXEL, CLICK, DESCADASTRAMENTO
  // -----------------------------
  const botoesExtrasWrap = document.createElement('div');
  botoesExtrasWrap.style.marginTop = "10px";
  botoesExtrasWrap.style.display = "flex";
  botoesExtrasWrap.style.flexWrap = "wrap";
  botoesExtrasWrap.style.gap = "10px";

  // COPIAR HTML
  const btnCopiar = document.createElement('button');
  btnCopiar.innerText = '📋 Copiar HTML';
  btnCopiar.onclick = () => {
    const html = ta.value;
    if (!html) {
      mostrarMensagem("O campo HTML está vazio.");
      return;
    }

    navigator.clipboard.writeText(html)
      .then(() => mostrarMensagem("HTML copiado para a área de transferência!"))
      .catch(err => {
        console.error("Erro ao copiar:", err);
        mostrarMensagem("Não foi possível copiar o HTML.");
      });
  };
  botoesExtrasWrap.appendChild(btnCopiar);
  /*
  // PIXEL
  const btnPixel = document.createElement('button');
  btnPixel.innerText = '➕ Pixel';
  btnPixel.onclick = () => {
    const texto = `
  <!-- Código de Pixel -->
  <img src="https://api.radarsiope.com.br/api/pixel?newsletter={{newsletterId}}&email={{email}}" 
      width="1" height="1" style="display:none" alt="pixel" />
  `;
    if (!ta.value.includes("api/pixel")) {
      ta.value += "\n" + texto;
    } else {
      mostrarMensagem("O código de Pixel já está incluído.");
    }
  };
  botoesExtrasWrap.appendChild(btnPixel);

 // CLICK
  const btnClick = document.createElement('button');
  btnClick.innerText = '➕ Click';
  btnClick.onclick = () => {
    let destino = prompt("Informe o link de destino:", "https://www.radarsiope.com.br/");

    if (!destino) destino = "https://www.radarsiope.com.br/";

    if (!destino.startsWith("http://") && !destino.startsWith("https://")) {
      destino = "https://" + destino;
    }

    const texto = `
  <a href="https://api.radarsiope.com.br/api/click?envioId={{envioId}}&destinatarioId={{destinatarioId}}&newsletterId={{newsletterId}}&url=${encodeURIComponent(destino)}">
    Clique aqui para acessar o conteúdo
  </a>
  `;

    if (!ta.value.includes("api/click")) {
      ta.value += "\n" + texto;
    } else {
      mostrarMensagem("O link de Click já está incluído.");
    }
  };
  botoesExtrasWrap.appendChild(btnClick);
 */
  // DESCADASTRAMENTO
  const btnDescadastramento = document.createElement('button');
  btnDescadastramento.innerText = '➕ Descadastramento';
  btnDescadastramento.onclick = () => {
    const texto = `
  <p style="font-size:12px; color:#888; margin-top:30px">
    Não deseja mais receber nossas newsletters?
    <a href="https://api.radarsiope.com.br/descadastramento.html?email={{email}}&newsletter={{newsletterId}}&titulo={{titulo}}">
      Clique aqui para se descadastrar
    </a>.
  </p>
  `;

    if (!ta.value.includes("Clique aqui para se descadastrar")) {
      ta.value += "\n" + texto;
    } else {
      mostrarMensagem("O link de descadastramento já está incluído.");
    }
  };
  botoesExtrasWrap.appendChild(btnDescadastramento);

  htmlWrap.appendChild(botoesExtrasWrap);

  // Token
  const btnToken = document.createElement('button');
  btnToken.innerText = '➕ Token/click';
  btnToken.onclick = () => {
    const texto = `
    <p style="font-size:12px; color:#888; margin-top:30px">
      👉 <a href="https://www.radarsiope.com.br/verNewsletterComToken.html?d=ENCODED">
        Acessar edição completa
      </a>
    </p>
    `;
    /*         const texto = `
        <p style="font-size:12px; color:#888; margin-top:30px">
          👉 <a href="https://www.radarsiope.com.br/verNewsletterComToken.html?nid={{newsletterId}}&env={{envioId}}&uid={{destinatarioId}}&assinaturaId={{assinaturaId}}&token={{token}}">
            Acessar edição completa
          </a>
        </p>
        `; */

    if (!ta.value.includes("https://www.radarsiope.com.br/verNewsletterComToken.html")) {
      ta.value += "\n" + texto;
    } else {
      mostrarMensagem("O link de click/token já está incluído.");
    }
  };
  botoesExtrasWrap.appendChild(btnToken);
  htmlWrap.appendChild(botoesExtrasWrap);


  // Botões de preview
  const previewWrap = document.createElement('div');
  previewWrap.style.marginTop = "10px";
  previewWrap.style.display = "flex";
  previewWrap.style.flexWrap = "wrap";
  previewWrap.style.gap = "10px";

  function addPreviewButton(label, modo, segmento, bordas) {
    const btn = document.createElement('button');
    btn.innerText = label;
    btn.onclick = () => {
      const iframe = document.getElementById('iframe-html-preview');
      iframe.srcdoc = montarHtmlNewsletterPreview(modo, segmento, bordas);
      openModal('modal-html-preview');
    };
    previewWrap.appendChild(btn);
  }

  addPreviewButton('👁️ Visualizar HTML (com blocos)', "completo", null, true);
  addPreviewButton('👤 Visualizar como Lead', "segmentado", "leads", false);
  addPreviewButton('⭐ Visualizar como Assinante', "segmentado", "assinantes", false);
  addPreviewButton('🧪 Visualizar HTML puro', "puro", null, false);
  addPreviewButton('📖 Visualizar HTML Completo', "completo_html", null, true);

  htmlWrap.appendChild(previewWrap);

  // -----------------------------
  // COLUNA 3 — BLOCOS
  // -----------------------------
  const tituloBlocos = document.createElement('h3');
  tituloBlocos.innerText = "Blocos da Newsletter";
  tituloBlocos.style.marginTop = "10px";
  col3.appendChild(tituloBlocos);

  const descBlocos = document.createElement('p');
  descBlocos.style.fontSize = "13px";
  descBlocos.style.color = "#555";
  descBlocos.style.marginTop = "10px";
  descBlocos.innerHTML = `
    Se você usar blocos, o HTML acima será ignorado no envio.<br>
    Cada bloco pode ser exibido para: <strong>Todos</strong>, <strong>Leads</strong> ou <strong>Assinantes</strong>.
  `;
  col3.appendChild(descBlocos);

  const btnAddBloco = document.createElement('button');
  btnAddBloco.type = "button";
  btnAddBloco.innerText = "➕ Adicionar bloco";
  btnAddBloco.style.marginTop = "20px";
  btnAddBloco.style.marginBottom = "10px";
  btnAddBloco.onclick = () => adicionarBlocoEdicao();
  col3.appendChild(btnAddBloco);

  const containerBlocos = document.createElement('div');
  containerBlocos.id = "container-blocos-edicao";
  containerBlocos.style.border = "1px solid #ddd";
  containerBlocos.style.padding = "10px";
  containerBlocos.style.borderRadius = "4px";
  containerBlocos.style.maxHeight = "650px";
  containerBlocos.style.overflowY = "auto";
  containerBlocos.style.background = "#fdfdfd";
  col3.appendChild(containerBlocos);

  // -----------------------------
  // BOTÃO SALVAR
  // -----------------------------
  document.getElementById('modal-newsletter-save').onclick = async () => {
    const payload = {};

    body.querySelectorAll('[data-field-name]').forEach(el => {
      const field = el.dataset.fieldName;

      // Checkboxes
      if (el.type === 'checkbox') {
        payload[field] = el.checked;
      }
      // Datas
      else if (el.type === 'date') {
        payload[field] = el.value
          ? firebase.firestore.Timestamp.fromDate(new Date(el.value + 'T00:00:00'))
          : null;
      }
      // Número de horas (acesso_pro_horas)
      else if (el.type === 'number') {
        const n = parseInt(el.value, 10);
        payload[field] = isNaN(n) ? null : n;
      }
      // Demais campos de texto
      else {
        payload[field] = el.value;
      }
    });

    // ── Bullets: textarea → array (filtra linhas vazias) ─────────────────
    const bulletsEl = document.getElementById('campo-resumo-bullets');
    if (bulletsEl) {
      payload.resumo_bullets = bulletsEl.value
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);
      delete payload['campo-resumo-bullets']; // garante que não sobra chave suja
    }

    // ── FAQ: lê os pares pergunta/resposta do editor ──────────────────────
    const faqItems = document.querySelectorAll('#faq-editor-container .faq-editor-item');
    payload.faq = Array.from(faqItems).map(item => ({
      pergunta: item.querySelector('.faq-pergunta')?.value?.trim() || '',
      resposta: item.querySelector('.faq-resposta')?.value?.trim() || '',
    })).filter(i => i.pergunta); // descarta itens sem pergunta

    // ── Blocos ────────────────────────────────────────────────────────────
    payload.blocos = coletarBlocosEdicao();

    // ── Validações existentes ─────────────────────────────────────────────
    const htmlNewsletter = payload['html_conteudo'] || "";
    const htmlCompleto = payload['conteudo_html_completo'] || "";
    const blocos = payload.blocos || [];

    if (!validarNewsletter(htmlNewsletter, blocos, 'email')) return;
    if (!validarPlaceholders(htmlNewsletter)) return;
    if (!validarNewsletter(htmlCompleto, blocos, 'app')) return;
    if (!validarPlaceholders(htmlCompleto)) return;

    // ── Data de publicação ────────────────────────────────────────────────
    const inputData = document.getElementById("data_publicacao");
    payload.data_publicacao = dateStringToLocalTimestamp(inputData?.value);

    // ── Salvar ────────────────────────────────────────────────────────────
    const ref = db.collection('newsletters');
    if (isEdit && docId) {
      await ref.doc(docId).set(payload, { merge: true });
    } else {
      await ref.add(payload);
    }

    closeModal('modal-newsletter-overlay');
    carregarNewsletters();
  };

  // -----------------------------
  // ABRE O MODAL
  // -----------------------------
  openModal('modal-newsletter-overlay');

  // -----------------------------
  // CARREGA STATUS DE ENVIO
  // -----------------------------
  if (isEdit && docId) {
    const statusDiv = document.getElementById("status-envio-news");

    if (statusDiv) {
      if (!data || data.enviada !== true) {
        statusDiv.innerHTML = `<span style="color:red;">❌ Ainda não enviada</span>`;
      } else {
        statusDiv.innerHTML = `<span style="color:green;">✔️ Enviada</span>`;
      }
    }
  }

  // -----------------------------
  // CARREGA OS BLOCOS
  // -----------------------------
  if (isEdit && data.blocos) {
    setTimeout(() => carregarBlocosDaEdicao(data), 50);
  }
}

function montarHtmlNewsletterPreview(modo, segmento = null, bordas = false) {
  const campoHTML = document.getElementById('campo-html-newsletter');
  const campoHTMLCompleto = document.getElementById('campo-html-completo-newsletter');

  const htmlBase = campoHTML ? campoHTML.value : "";
  const htmlCompleto = campoHTMLCompleto ? campoHTMLCompleto.value : "";

  const blocos = coletarBlocosEdicao();

  // -----------------------------
  // MONTA HTML DOS BLOCOS (sempre)
  // -----------------------------
  let htmlBlocos = "";

  blocos.forEach(b => {
    const acesso = b.acesso || "todos";
    let conteudo = b.html || "";

    if (bordas) {
      conteudo = `
        <div style="border:2px dashed #999; padding:10px; margin:10px 0;">
          ${conteudo}
        </div>
      `;
    }

    // Modo puro → inclui TODOS os blocos
    if (modo === "puro") {
      htmlBlocos += conteudo + "\n";
      return;
    }

    // Modo completo → inclui TODOS os blocos
    if (modo === "completo") {
      htmlBlocos += conteudo + "\n";
      return;
    }

    // Modo segmentado
    const deveExibir =
      acesso === "todos" ||
      (acesso === "leads" && segmento === "leads") ||
      (acesso === "assinantes" && segmento === "assinantes");

    if (deveExibir) {
      htmlBlocos += conteudo + "\n";
    }
  });

  // -----------------------------
  // NOVO MODO: COMPLETO_HTML
  // -----------------------------
  if (modo === "completo_html") {
    // Se o HTML completo tiver {{blocos}}, substitui
    if (htmlCompleto.includes("{{blocos}}")) {
      return htmlCompleto.replace("{{blocos}}", htmlBlocos);
    }
    // Senão, concatena os blocos no final
    return htmlCompleto + "\n" + htmlBlocos;
  }

  // -----------------------------
  // SE O HTML BASE TEM {{blocos}}
  // -----------------------------
  if (htmlBase.includes("{{blocos}}")) {
    return htmlBase.replace("{{blocos}}", htmlBlocos);
  }

  // -----------------------------
  // SENÃO, CONCATENA NO FINAL
  // -----------------------------
  return htmlBase + "\n" + htmlBlocos;
}

function validarNewsletter(html, blocos, tipo = 'email') {
  const erros = validarHtmlEmail(html, blocos, tipo);

  if (erros.length > 0) {
    mostrarMensagem("⚠️ Problemas encontrados no HTML:\n\n" + erros.map(e => "• " + e).join("\n"));
    return false;
  }

  return true;
}

function validarHtmlEmail(html, blocos = [], tipo = 'email') {
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
  //    (vale para e-mail e app)
  // -----------------------------
  if (blocos.length > 0 && !html.includes("{{blocos}}")) {
    erros.push("Existem blocos cadastrados, mas o HTML não contém o marcador {{blocos}}.");
  }

  // -----------------------------
  // Regras exclusivas do e-mail (html_conteudo)
  // O conteudo_html_completo (app) usa divs normais —
  // não precisa de <table>, link de token nem descadastro
  // -----------------------------
  if (tipo === 'email') {

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
    // 5. Pixel dentro da tabela e existência
    // -----------------------------
    /*
    if (!html.includes("api.radarsiope.com.br/api/pixel")) {
      erros.push("O HTML não contém o pixel de rastreamento.");
    } else if (idxTableClose !== -1) {
      const pixelPos = html.indexOf("api.radarsiope.com.br/api/pixel");
      if (pixelPos > idxTableClose) {
        erros.push("O pixel de rastreamento está fora da tabela principal.");
      }
    }
    */

    // -----------------------------
    // 6. Link de clique/token dentro da tabela
    // -----------------------------
    if (!html.includes("verNewsletterComToken.html")) {
      erros.push("O HTML não contém o link de rastreamento de clique/token.");
    } else if (htmlLower.lastIndexOf("</table>") !== -1) {
      const idxTableCloseFinal = htmlLower.lastIndexOf("</table>");
      const clickPos = html.indexOf("verNewsletterComToken.html");
      if (clickPos > idxTableCloseFinal) {
        erros.push("O link de rastreamento de clique/token está fora da tabela principal.");
      }
    }

    // -----------------------------
    // 7. Descadastramento dentro da tabela
    // -----------------------------
    if (!html.includes("descadastramento")) {
      erros.push("O HTML não contém o link de descadastramento.");
    } else if (htmlLower.lastIndexOf("</table>") !== -1) {
      const idxTableCloseFinal = htmlLower.lastIndexOf("</table>");
      const descPos = html.indexOf("descadastramento");
      if (descPos > idxTableCloseFinal) {
        erros.push("O link de descadastramento está fora da tabela principal.");
      }
    }

    // -----------------------------
    // 8. Placeholder de token
    // -----------------------------
    /*
    if (!html.includes("{{token}}")) {
      erros.push("O HTML não contém o placeholder {{token}}.");
    }
    */

    // -----------------------------
    // 9. Verifica tags <tr> mal fechadas
    // -----------------------------
    const qtdTrAbertas = (htmlLower.match(/<tr/g) || []).length;
    const qtdTrFechadas = (htmlLower.match(/<\/tr>/g) || []).length;
    if (qtdTrAbertas !== qtdTrFechadas) {
      erros.push(`Quantidade de <tr> abertas (${qtdTrAbertas}) e fechadas (${qtdTrFechadas}) não confere.`);
    }

    // -----------------------------
    // 10. Verifica tags <td> mal fechadas
    // -----------------------------
    const qtdTdAbertas = (htmlLower.match(/<td/g) || []).length;
    const qtdTdFechadas = (htmlLower.match(/<\/td>/g) || []).length;
    if (qtdTdAbertas !== qtdTdFechadas) {
      erros.push(`Quantidade de <td> abertas (${qtdTdAbertas}) e fechadas (${qtdTdFechadas}) não confere.`);
    }

  } // fim if (tipo === 'email')

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

  // Linha com 3 selects lado a lado: Tipo | Acesso | Destino
  const rowSelects = document.createElement("div");
  rowSelects.style.cssText = "display:flex;gap:6px;margin-bottom:5px";

  // Select tipo
  const selectTipo = document.createElement("select");
  selectTipo.style.cssText = "flex:1;font-size:12px;padding:3px";
  selectTipo.dataset.blocoField = "tipo";
  selectTipo.title = "Tipo do bloco";
  selectTipo.innerHTML = `
    <option value="">— Tipo —</option>
    <option value="chamada">📢 Chamada</option>
    <option value="destaque">⭐ Destaque</option>
    <option value="analise">📊 Análise</option>
    <option value="dados">📋 Dados</option>
    <option value="cta">🎯 CTA</option>
  `;
  selectTipo.value = bloco.tipo || "";
  rowSelects.appendChild(selectTipo);

  // Select acesso
  const selectAcesso = document.createElement("select");
  selectAcesso.style.cssText = "flex:1;font-size:12px;padding:3px";
  selectAcesso.dataset.blocoField = "acesso";
  selectAcesso.title = "Quem pode ver";
  selectAcesso.innerHTML = `
    <option value="todos">👥 Todos</option>
    <option value="leads">🔓 Leads</option>
    <option value="assinantes">🔒 Assinantes</option>
  `;
  selectAcesso.value = bloco.acesso || "todos";
  rowSelects.appendChild(selectAcesso);

  // Select destino
  const selectDestino = document.createElement("select");
  selectDestino.style.cssText = "flex:1;font-size:12px;padding:3px";
  selectDestino.dataset.blocoField = "destino";
  selectDestino.title = "Onde aparece";
  selectDestino.innerHTML = `
    <option value="email+app">📧+📱 E-mail e App</option>
    <option value="app">📱 Só App</option>
    <option value="email">📧 Só E-mail</option>
  `;
  selectDestino.value = bloco.destino || "email+app";
  rowSelects.appendChild(selectDestino);

  wrapper.appendChild(rowSelects);

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

let _leadsOffset = 0;
const _LEADS_LIMIT = 20;

async function carregarLeads(resetar = false) {
  const tabela = document.getElementById("tabela-leads");
  const resumo = document.getElementById("resumo-leads");
  if (!tabela) return;

  if (resetar) _leadsOffset = 0;

  const perfil = document.getElementById("filtro-perfil-lead")?.value || "";
  const preferencia = document.getElementById("filtro-preferencia")?.value || "";
  const status = document.getElementById("filtro-status-lead-consulta")?.value || "";
  const termoBusca = document.getElementById("busca-leads")?.value?.trim().toLowerCase() || "";

  tabela.innerHTML = "<tr><td colspan='11'>Carregando...</td></tr>";

  try {
    let query = window.supabase.from("leads").select("*", { count: "exact" });

    // Filtros
    if (termoBusca) {
      query = query.or(
        `nome_lowercase.ilike.${termoBusca}%,email.ilike.%${termoBusca}%`
      );
    }
    if (perfil) query = query.eq("perfil", perfil);
    if (preferencia) query = query.eq("preferencia_contato", preferencia);
    if (status) query = query.eq("status", status);

    // Ordenação: mensagens não respondidas primeiro, depois mais recentes
    query = query
      .order("mensagem_respondida", { ascending: true, nullsFirst: true })
      .order("data_criacao", { ascending: false })
      .range(_leadsOffset, _leadsOffset + _LEADS_LIMIT - 1);

    const { data: leads, error, count } = await query;
    if (error) throw error;

    if (!leads || leads.length === 0) {
      tabela.innerHTML = "<tr><td colspan='11'>Nenhum lead encontrado.</td></tr>";
      resumo.innerHTML = "";
      return;
    }

    const contadores = { "Novo": 0, "Em contato": 0, "Negociando": 0, "Convertido": 0, "Descartado": 0 };
    let linhas = "";

    for (const d of leads) {
      const statusAtual = d.status || "Novo";
      const destaque = statusAtual === "Convertido" ? "lead-convertido" : "";
      const dataFmt = d.data_criacao ? new Date(d.data_criacao).toLocaleString("pt-BR") : "";
      const interesses = Array.isArray(d.interesses) ? d.interesses.join(", ") : (d.interesses || "");
      contadores[statusAtual] = (contadores[statusAtual] || 0) + 1;

      // Mensagem — destaque se não respondida
      const temMensagem = !!d.mensagem;
      const respondida = !!d.mensagem_respondida;
      const celMensagem = temMensagem
        ? respondida
          ? `<span style="color:#22c55e;font-size:12px" title="${d.mensagem}">✅ ${d.mensagem.slice(0, 25)}…</span>`
          : `<span style="color:#e53e3e;font-weight:700;cursor:pointer;font-size:12px"
               title="${d.mensagem}" onclick="abrirModalResponderMensagem('${d.id}','${(d.mensagem || '').replace(/'/g, "\\'")}')">
               🔴 ${d.mensagem.slice(0, 25)}${d.mensagem.length > 25 ? '…' : ''}
             </span>`
        : "—";

      linhas += `
        <tr class="${destaque}${!respondida && temMensagem ? ' tr-pendente' : ''}">
          <td>${d.nome || ""}</td>
          <td>${d.email || ""}</td>
          <td>${d.telefone || ""}</td>
          <td>${d.perfil || "-"}</td>
          <td style="font-size:11px">${interesses}</td>
          <td style="font-size:11px">${dataFmt}</td>
          <td>${formatarPreferencia(d.preferencia_contato)}</td>
          <td>${celMensagem}</td>
          <td style="font-size:11px">${d.nome_municipio || ""}${d.cod_uf ? ` / ${d.cod_uf}` : ""}</td>
          <td>
            <select onchange="atualizarStatusLeadSupabase('${d.id}', this.value)">
              ${["Novo", "Em contato", "Negociando", "Convertido", "Descartado"].map(op =>
        `<option value="${op}" ${op === statusAtual ? "selected" : ""}>${op}</option>`
      ).join("")}
            </select>
          </td>
          <td style="white-space:nowrap">
            ${temMensagem && !respondida
          ? `<span class="icon-btn" title="Responder mensagem"
                  onclick="abrirModalResponderMensagem('${d.id}','${(d.mensagem || '').replace(/'/g, "\\'")}')">💬</span>`
          : ""}
            <span class="icon-btn" title="Registrar contato"
              onclick="abrirModalContatoLead('${d.id}')">📞</span>
            <span class="icon-btn" title="Ver histórico de interações"
              onclick="abrirModalHistorico('${d.id}')">📜</span>
            <span class="icon-btn" title="Prorrogar acesso"
              onclick="abrirModalProrrogarAcesso('${d.id}', '${(d.nome || '').replace(/'/g, "\\'")}')">⏰</span>
          </td>
        </tr>`;
    }

    tabela.innerHTML = linhas;

    const total = count || 0;
    const mostrando = Math.min(_leadsOffset + _LEADS_LIMIT, total);
    resumo.innerHTML = `
      <span>Mostrando ${mostrando} de ${total} leads</span> &nbsp;|&nbsp;
      <span style="color:green">🟢 ${contadores["Convertido"]} convertidos</span> |
      <span style="color:orange">🟡 ${contadores["Negociando"]} negociando</span> |
      <span style="color:blue">🔵 ${contadores["Em contato"]} em contato</span> |
      <span style="color:gray">⚪ ${contadores["Novo"]} novos</span>
      ${mostrando < total
        ? `&nbsp;|&nbsp;<span style="cursor:pointer;text-decoration:underline;color:#007acc"
             onclick="_leadsOffset+=${_LEADS_LIMIT};carregarLeads()">▶ Próxima página</span>`
        : ""}
      ${_leadsOffset > 0
        ? `&nbsp;|&nbsp;<span style="cursor:pointer;text-decoration:underline;color:#007acc"
             onclick="_leadsOffset=Math.max(0,_leadsOffset-${_LEADS_LIMIT});carregarLeads()">◀ Anterior</span>`
        : ""}
    `;

  } catch (err) {
    tabela.innerHTML = `<tr><td colspan='11'>Erro ao carregar leads: ${err.message}</td></tr>`;
    console.error("[leads]", err);
  }
}

// ─── Atualizar status do lead no Supabase ─────────────────────────────────────
async function atualizarStatusLeadSupabase(leadId, novoStatus) {
  const { error } = await window.supabase
    .from("leads").update({ status: novoStatus }).eq("id", leadId);
  if (error) mostrarMensagem("Erro ao atualizar status: " + error.message);
}

// ─── Badge: verificar pendências ─────────────────────────────────────────────
async function verificarPendenciasLeads() {
  try {
    // Mensagens não respondidas
    const { count: msgAbertas } = await window.supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .or("mensagem_respondida.is.null,mensagem_respondida.eq.false")
      .not("mensagem", "is", null);

    // Feedbacks sem resposta (todos os feedbacks de newsletters)
    const snap = await db.collection("newsletters")
      .where("enviada", "==", true).get();
    let fbAbertas = 0;
    snap.forEach(doc => {
      const feedbacks = doc.data().feedbacks || [];
      fbAbertas += feedbacks.filter(f => !f.respondido).length;
    });

    const total = (msgAbertas || 0) + fbAbertas;
    const badge = document.getElementById("badge-leads");
    const badgeFb = document.getElementById("badge-feedbacks");

    if (badge) {
      badge.textContent = total;
      badge.style.display = total > 0 ? "inline" : "none";
    }
    if (badgeFb) {
      badgeFb.textContent = fbAbertas;
      badgeFb.style.display = fbAbertas > 0 ? "inline" : "none";
    }
  } catch (e) { console.warn("[pendências]", e); }
}

// ─── Responder mensagem do lead ───────────────────────────────────────────────
function abrirModalResponderMensagem(leadId, mensagem) {
  document.getElementById("modal-responder-lead-id").value = leadId;
  document.getElementById("modal-mensagem-original").textContent = mensagem;
  document.getElementById("modal-resposta-texto").value = "";
  document.getElementById("modal-responder-mensagem").style.display = "flex";
}

async function enviarRespostaMensagemLead() {
  const leadId = document.getElementById("modal-responder-lead-id").value;
  const resposta = document.getElementById("modal-resposta-texto").value.trim();
  if (!resposta) return mostrarMensagem("Digite uma resposta.");

  // Buscar dados do lead para enviar e-mail
  const { data: lead, error } = await window.supabase
    .from("leads").select("nome,email").eq("id", leadId).single();
  if (error || !lead) return mostrarMensagem("Lead não encontrado.");

  try {
    // Enviar e-mail via API SES
    await fetch("https://api.radarsiope.com.br/api/sendViaSES", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: lead.nome,
        email: lead.email,
        assunto: "Resposta à sua mensagem — Radar SIOPE",
        mensagemHtml: `<p>Olá ${lead.nome},</p><p>${resposta}</p>
          <p>Atenciosamente,<br><strong>Equipe Radar SIOPE</strong></p>`
      })
    });

    // Marcar como respondida no Supabase
    await window.supabase.from("leads").update({
      mensagem_respondida: true,
      mensagem_resposta: resposta,
      mensagem_respondida_em: new Date().toISOString()
    }).eq("id", leadId);

    document.getElementById("modal-responder-mensagem").style.display = "none";
    mostrarMensagem("✅ Resposta enviada com sucesso!");
    carregarLeads(true);
    verificarPendenciasLeads();

  } catch (e) {
    mostrarMensagem("Erro ao enviar resposta: " + e.message);
  }
}

// ─── Feedbacks das newsletters ────────────────────────────────────────────────
async function carregarFeedbacksNewsletters() {
  const container = document.getElementById("lista-feedbacks-newsletters");
  if (!container) return;
  container.innerHTML = "<p style='color:#999;font-size:13px'>Carregando feedbacks...</p>";

  try {
    const snap = await db.collection("newsletters")
      .where("enviada", "==", true)
      .orderBy("data_publicacao", "desc")
      .limit(20).get();

    let html = "";
    let totalAbertos = 0;

    snap.forEach(doc => {
      const nl = doc.data();
      const feedbacks = nl.feedbacks || [];
      if (!feedbacks.length) return;

      const abertos = feedbacks.filter(f => !f.respondido).length;
      totalAbertos += abertos;

      html += `
        <div style="border:1px solid #e2e8f0;border-radius:8px;margin-bottom:12px;overflow:hidden">
          <div style="background:#f8fafc;padding:10px 14px;display:flex;
            justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0">
            <strong style="font-size:13px">📰 Edição ${nl.numero || "—"} — ${nl.titulo || ""}</strong>
            ${abertos > 0
          ? `<span style="background:#fef2f2;color:#e53e3e;border-radius:10px;
                  padding:2px 8px;font-size:11px;font-weight:700">${abertos} pendente${abertos > 1 ? "s" : ""}</span>`
          : `<span style="background:#f0fdf4;color:#22c55e;border-radius:10px;
                  padding:2px 8px;font-size:11px">✅ Todos tratados</span>`}
          </div>
          <div style="padding:10px 14px">
            ${feedbacks.map((f, idx) => `
              <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;
                border-bottom:1px dashed #e2e8f0;${idx === feedbacks.length - 1 ? 'border:none' : ''}">
                <div style="flex:1">
                  <div style="font-size:12px;color:#555;line-height:1.5">${f.texto}</div>
                  <div style="font-size:10px;color:#aaa;margin-top:3px">
                    ${f.segmento || "—"} · ${f.plano || "—"} ·
                    ${f.ts ? new Date(f.ts).toLocaleString("pt-BR") : ""}
                  </div>
                  ${f.respondido
              ? `<div style="font-size:11px;color:#22c55e;margin-top:3px">
                        ✅ Tratado: ${f.nota_interna || ""}</div>`
              : ""}
                </div>
                ${!f.respondido
              ? `<button onclick="abrirModalResponderFeedback('${doc.id}', ${idx}, \`${(f.texto || '').replace(/`/g, "'")}\`, '${f.segmento || ''}', '${f.plano || ''}')"
                      style="padding:5px 10px;background:#f59e0b;color:#fff;border:none;
                      border-radius:6px;font-size:11px;cursor:pointer;white-space:nowrap">
                      💬 Tratar
                    </button>`
              : ""}
              </div>`).join("")}
          </div>
        </div>`;
    });

    container.innerHTML = html || "<p style='color:#999;font-size:13px'>Nenhum feedback registrado ainda.</p>";

    // Atualizar badge
    const badgeFb = document.getElementById("badge-feedbacks");
    if (badgeFb) {
      badgeFb.textContent = totalAbertos;
      badgeFb.style.display = totalAbertos > 0 ? "inline" : "none";
    }

  } catch (e) {
    container.innerHTML = `<p style='color:#e53e3e;font-size:13px'>Erro: ${e.message}</p>`;
    console.error("[feedbacks]", e);
  }
}

function abrirModalResponderFeedback(newsletterId, idx, texto, segmento, plano) {
  document.getElementById("modal-feedback-newsletter-id").value = newsletterId;
  document.getElementById("modal-feedback-index").value = idx;
  document.getElementById("modal-feedback-original").textContent = texto;
  document.getElementById("modal-feedback-meta").textContent = `${segmento} · ${plano}`;
  document.getElementById("modal-feedback-resposta").value = "";
  document.getElementById("modal-responder-feedback").style.display = "flex";
}

async function salvarRespostaFeedback() {
  const nid = document.getElementById("modal-feedback-newsletter-id").value;
  const idx = parseInt(document.getElementById("modal-feedback-index").value);
  const nota = document.getElementById("modal-feedback-resposta").value.trim();
  if (!nota) return mostrarMensagem("Digite uma observação.");

  try {
    const snap = await db.collection("newsletters").doc(nid).get();
    const feedbacks = snap.data()?.feedbacks || [];
    feedbacks[idx] = {
      ...feedbacks[idx], respondido: true, nota_interna: nota,
      respondido_em: new Date().toISOString()
    };
    await db.collection("newsletters").doc(nid).update({ feedbacks });

    document.getElementById("modal-responder-feedback").style.display = "none";
    mostrarMensagem("✅ Feedback marcado como tratado!");
    carregarFeedbacksNewsletters();
    verificarPendenciasLeads();
  } catch (e) {
    mostrarMensagem("Erro: " + e.message);
  }
}

let leadAtual = null;
let dadosLeadAtual = null;

async function abrirModalContatoLead(leadId) {
  leadAtual = leadId;

  const { data: lead, error } = await window.supabase
    .from("leads").select("*").eq("id", leadId).single();

  if (error || !lead) return mostrarMensagem("Lead não encontrado.");
  dadosLeadAtual = lead;

  const tipo = lead.preferencia_contato?.toLowerCase() || "e-mail";
  document.getElementById("tipo-contato-lead").value = formatarPreferencia(tipo);
  document.getElementById("resultado-contato-lead").value = "";
  document.getElementById("acao-email-lead").style.display = (tipo === "e-mail") ? "block" : "none";
  document.getElementById("email-contato-lead").value = lead.email || "";
  document.getElementById("campo-email-lead").style.display = (tipo === "e-mail") ? "block" : "none";
  document.getElementById("btn-enviar-email-lead").style.display = (tipo === "e-mail") ? "inline-block" : "none";

  document.getElementById("modal-contato-lead").style.display = "flex";
}

function fecharModalContatoLead() {
  document.getElementById("modal-contato-lead").style.display = "none";
}

async function abrirModalHistorico(leadId) {
  const container = document.getElementById("conteudo-historico-lead");
  if (!container) return;
  container.innerHTML = "<p>🔄 Carregando histórico...</p>";
  document.getElementById("modal-historico-lead").style.display = "flex";

  const { data: interacoes, error } = await window.supabase
    .from("leads_interacoes")
    .select("*")
    .eq("lead_id", Number(leadId))
    .order("data", { ascending: false });

  if (error) {
    container.innerHTML = `<p style="color:red">Erro: ${error.message}</p>`;
    return;
  }

  if (!interacoes || interacoes.length === 0) {
    container.innerHTML = "<p style='color:#999'>Nenhuma interação registrada.</p>";
    return;
  }

  container.innerHTML = interacoes.map(d => {
    const dataFmt = d.data
      ? new Date(d.data).toLocaleString("pt-BR")
      : "Data desconhecida";
    const destaque = (d.resultado || "").toLowerCase().includes("e-mail");
    return `
      <div style="border-bottom:1px solid #eee;padding:10px 0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong style="font-size:13px">${dataFmt}</strong>
          <span style="font-size:11px;color:#888">${d.responsavel || "—"}</span>
        </div>
        <div style="font-size:12px;color:#666;margin:2px 0">
          Tipo: <strong>${d.tipo || "—"}</strong>
        </div>
        <div style="
          background:${destaque ? '#e6f7ff' : '#f9f9f9'};
          border-left:3px solid ${destaque ? '#007acc' : '#ccc'};
          border-radius:4px;
          padding:8px;
          font-size:13px;
          margin-top:6px;
          line-height:1.5">
          ${d.resultado || "Sem detalhes"}
        </div>
      </div>`;
  }).join("");
}

function fecharModalHistorico() {
  document.getElementById("modal-historico-lead").style.display = "none";
}

async function salvarInteracaoLead() {
  const tipo = dadosLeadAtual.preferencia_contato?.toLowerCase() || "e-mail";
  const resultado = document.getElementById("resultado-contato-lead").value.trim();
  if (!resultado) return mostrarMensagem("Preencha o resultado do contato.");

  const adminLogado = JSON.parse(localStorage.getItem("usuarioLogado") || "{}");
  const responsavel = adminLogado.nome || adminLogado.email || "admin";

  try {
    // 1. Salvar interação
    const { error: errInter } = await window.supabase
      .from("leads_interacoes")
      .insert([{
        lead_id: Number(leadAtual),
        tipo,
        resultado,
        responsavel,
        data: new Date().toISOString()
      }]);
    if (errInter) throw errInter;

    // 2. Atualizar status do lead
    const { error: errStatus } = await window.supabase
      .from("leads")
      .update({ status: "Em contato" })
      .eq("id", leadAtual);
    if (errStatus) throw errStatus;

    mostrarMensagem("✅ Interação registrada com sucesso.");
    fecharModalContatoLead();
    carregarLeads(true);

  } catch (err) {
    console.error("[interação]", err);
    mostrarMensagem("Erro ao salvar interação: " + err.message);
  }
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

  if (!origemInput || !arquivoInput) return mostrarMensagem("Campos obrigatórios não encontrados.");
  const origem = origemInput.value.trim();
  const arquivo = arquivoInput.files[0];

  if (!origem) return mostrarMensagem("Informe a origem dos leads.");
  if (!arquivo) return mostrarMensagem("Selecione uma planilha.");

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

      mostrarMensagem(`✅ ${importados} leads importados com sucesso.\n❌ ${erros.length} com erro.`);

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
    mostrarMensagem("Erro ao exportar leads.");
    console.error("Erro ao exportar CSV:", err);
  }
}



async function atualizarStatusLead(leadId, novoStatus) {
  if (!leadId || !novoStatus) return;

  const leadRef = db.collection("leads").doc(leadId);

  if (novoStatus === "Descartado") {
    const motivo = prompt("Informe o motivo do descarte:");

    if (!motivo || motivo.trim().length < 3) {
      mostrarMensagem("Motivo obrigatório para descartar o lead.");
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

    mostrarMensagem("Lead descartado com motivo registrado.");
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
      mostrarMensagem("Usuário inválido ou inativo.");
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

    mostrarMensagem("✅ Lead vinculado com sucesso!");
    document.getElementById("modal-vincular-lead").style.display = "none";
    carregarLeads();
  } catch (err) {
    console.error("Erro ao vincular lead:", err);
    mostrarMensagem("❌ Erro ao vincular lead.");
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
      mostrarMensagem("Usuário inválido ou inativo.");
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

    mostrarMensagem("✅ Usuário reativado e lead vinculado com sucesso!");
    document.getElementById("modal-vincular-lead").style.display = "none";
    carregarLeads();
  } catch (err) {
    console.error("Erro ao reativar e vincular:", err);
    mostrarMensagem("❌ Erro ao reativar e vincular usuário.");
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
      mostrarMensagem("Tema não encontrado.");
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
  container.innerHTML = ""; // limpa

  // Cabeçalho
  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";

  const titulo = document.createElement("h2");
  titulo.innerText = "✉️ Respostas Automáticas";

  const novoBtn = document.createElement("button");
  novoBtn.innerText = "➕ Nova Resposta";
  novoBtn.onclick = () => editarResposta(null);

  header.appendChild(titulo);
  header.appendChild(novoBtn);
  container.appendChild(header);

  // Lista e form
  const lista = document.createElement("div");
  lista.id = "lista-respostas";
  container.appendChild(lista);

  const formContainer = document.createElement("div");
  formContainer.id = "form-resposta-container";
  formContainer.style.marginTop = "30px";
  container.appendChild(formContainer);

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
  console.log('123');
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
      <td style="white-space:nowrap">
        <button onclick="abrirDrawerUsuario('${doc.id}')"
          style="padding:5px 12px;background:#0284c7;color:#fff;border:none;
          border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;margin-right:4px">
          👁️ Abrir
        </button>
        <span class="icon-btn" title="Excluir Usuário" onclick="confirmarExclusaoUsuario('${doc.id}','${(d.nome || '').replace(/'/g, "\\'")}')">🗑️</span>
        <span class="icon-btn" title="Logs de Acesso" onclick="abrirSubcolecao('${doc.id}','logs_acesso')">📜</span>
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

  let query = db.collection('usuarios');

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
  const usuariosRef = db.collection('usuarios');

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
    mostrarMensagem("Template original não encontrado.");
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
  // body.appendChild(generateTextField('nome', data.nome || ''));
  const nomeField = generateTextField('nome', data.nome || '');
  nomeField.style.marginTop = isEdit ? '160px' : '10px';
  body.appendChild(nomeField);
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
  explicacao.innerHTML = gerarHtmlPlaceholdersExpandivel();
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

  const btnGerarHtml = document.createElement('button');
  btnGerarHtml.type = 'button';
  btnGerarHtml.innerText = '🛠️ Gerar HTML';
  btnGerarHtml.style.marginLeft = '8px';
  btnGerarHtml.onclick = () => {
    try {
      const campo = document.getElementById('campo-html-template');
      if (!campo) return mostrarMensagem('Campo de HTML não encontrado.');
      const convertido = converterTextoParaHtml(campo.value);
      campo.value = convertido;
      mostrarMensagem('HTML gerado e sanitizado.');
    } catch (e) {
      console.error('Erro ao gerar HTML:', e);
      mostrarMensagem('Erro ao gerar HTML. Veja console.');
    }
  };
  body.appendChild(btnGerarHtml);


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

  // inicializa drag & drop (garante que o listener seja registrado apenas uma vez)
  if (typeof initBlocosDragAndDrop === 'function') {
    initBlocosDragAndDrop();
  }


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
    if (!leadId) return mostrarMensagem("Selecione um usuário para visualizar.");

    const leadSnap = await db.collection('leads').doc(leadId).get();
    if (!leadSnap.exists) return mostrarMensagem("Usuário não encontrado.");

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

    if (!validarPlaceholders(htmlFinal)) {
      // interrompe o processo se houver placeholders inválidos
      return;
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
    try {
      // coleta campos do modal (ignora explicitamente 'versoes' se existir)
      const payload = {};
      const body = document.getElementById('modal-edit-body');

      body.querySelectorAll('[data-field-name]').forEach(el => {
        const name = el.dataset.fieldName;
        if (name === 'versoes') return; // NÃO incluir versoes no payload
        payload[name] = el.type === 'checkbox' ? el.checked : el.value;
      });

      // coleta blocos já normalizados
      const blocosBrutos = coletarBlocosNewsletter() || [];

      // sanitiza html_base
      payload.html_base = sanitizeHtml(payload.html_base || "");

      // valida placeholders no html_base
      if (!validarPlaceholders(payload.html_base)) return;

      const placeholdersPermitidos = null;
      if (!validarPlaceholdersNoTemplate(payload.html_base, placeholdersPermitidos)) return;

      // normaliza e sanitiza blocos
      payload.blocos = blocosBrutos.map((b, i) => {
        const id = b.id || generateUUID();
        const ordem = Number.isFinite(b.ordem) ? b.ordem : i;
        const titulo = (b.titulo || "").toString().trim();
        const acesso = ['todos', 'leads', 'assinantes'].includes(b.acesso) ? b.acesso : 'todos';
        const htmlSanitizado = sanitizeHtml(b.html || "");

        if (!validarPlaceholders(htmlSanitizado)) {
          throw new Error(`Placeholders inválidos no bloco "${titulo || id}"`);
        }
        if (!validarPlaceholdersNoTemplate(htmlSanitizado, placeholdersPermitidos)) {
          throw new Error(`Placeholders não permitidos no bloco "${titulo || id}"`);
        }

        return { id, ordem, titulo, acesso, html: htmlSanitizado };
      });

      // metadados
      const agora = firebase && firebase.firestore && firebase.firestore.Timestamp
        ? firebase.firestore.Timestamp.now()
        : new Date();

      if (!payload.criado_em) payload.criado_em = agora;
      payload.atualizado_em = agora;

      const usuarioLogado = JSON.parse(localStorage.getItem("usuarioLogado") || "null");
      if (usuarioLogado?.email) payload.atualizado_por = usuarioLogado.email;

      const ref = db.collection('templates_newsletter');
      if (isEdit && docId) {
        await ref.doc(docId).set(payload, { merge: true });
      } else {
        await ref.add(payload);
      }

      mostrarMensagem('✅ Template salvo com sucesso.');
      closeModal('modal-edit-overlay');
      carregarTemplatesNewsletter();
    } catch (err) {
      console.error('Erro ao salvar template:', err);
      mostrarMensagem('❌ Erro ao salvar template. Veja console para detalhes.');
    }
  };
  openModal('modal-edit-overlay');
}

function validarTemplate(html, blocos) {
  let erros = validarHtmlEmail(html, blocos);

  // Templates NÃO podem ter pixel
  erros = erros.filter(e => !e.includes("pixel"));

  // Templates NÃO podem ter click
  erros = erros.filter(e => !e.includes("clique"));

  // Templates NÃO podem ter descadastramento
  erros = erros.filter(e => !e.includes("descadastramento"));

  if (erros.length > 0) {
    mostrarMensagem("⚠️ Problemas encontrados no template:\n\n" + erros.map(e => "• " + e).join("\n"));
    return false;
  }

  return true;
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

  if (!validarPlaceholders(htmlFinal)) {
    // interrompe o processo se houver placeholders inválidos
    return;
  }
  const iframe = document.getElementById('iframe-html-preview');
  iframe.srcdoc = htmlFinal;

  openModal('modal-html-preview');
}

/*
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
*/
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
// ─── Prorrogar acesso lead ────────────────────────────────────────────────────
async function abrirModalProrrogarAcesso(leadId, nomeLead) {
  let modal = document.getElementById("modal-prorrogar-acesso");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-prorrogar-acesso";
    modal.style.cssText = `display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);
      z-index:9999;justify-content:center;align-items:center`;
    modal.innerHTML = `
      <div style="background:#fff;padding:24px;border-radius:10px;max-width:580px;
        width:90%;position:relative;box-shadow:0 4px 30px rgba(0,0,0,.2);max-height:80vh;
        overflow-y:auto">
        <button onclick="document.getElementById('modal-prorrogar-acesso').style.display='none'"
          style="position:absolute;top:10px;right:10px;background:none;border:none;
          font-size:18px;cursor:pointer">❌</button>
        <h3>⏰ Prorrogar acesso — <span id="prorrogar-lead-nome"></span></h3>
        <div style="display:flex;gap:10px;align-items:center;margin:14px 0 10px">
          <label style="font-size:13px;font-weight:600">Adicionar dias:</label>
          <select id="prorrogar-dias" style="padding:6px 10px;border-radius:6px;
            border:1px solid #ccc;font-size:13px">
            <option value="7">7 dias</option>
            <option value="15">15 dias</option>
            <option value="30" selected>30 dias</option>
            <option value="60">60 dias</option>
            <option value="0">Personalizado</option>
          </select>
          <input type="number" id="prorrogar-dias-custom" min="1" max="365"
            placeholder="Nº dias" style="display:none;width:80px;padding:6px;
            border-radius:6px;border:1px solid #ccc;font-size:13px">
          <label style="font-size:12px;display:flex;align-items:center;gap:4px">
            <input type="checkbox" id="prorrogar-zerar-acessos" checked>
            Zerar contagem de acessos
          </label>
        </div>
        <div id="lista-envios-lead" style="margin-top:8px"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">
          <button onclick="document.getElementById('modal-prorrogar-acesso').style.display='none'"
            style="padding:8px 16px;border-radius:6px;border:1px solid #ccc;cursor:pointer">
            Cancelar
          </button>
          <button onclick="confirmarProrrogacao()"
            style="padding:8px 16px;background:#0891b2;color:#fff;border:none;
            border-radius:6px;cursor:pointer;font-weight:700">
            ⏰ Confirmar prorrogação
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    // Listener para campo personalizado
    document.getElementById("prorrogar-dias").addEventListener("change", function () {
      document.getElementById("prorrogar-dias-custom").style.display =
        this.value === "0" ? "inline-block" : "none";
    });
  }

  document.getElementById("prorrogar-lead-nome").textContent = nomeLead || "";
  document.getElementById("lista-envios-lead").innerHTML =
    "<p style='color:#999;font-size:13px'>Carregando envios...</p>";
  modal.style.display = "flex";

  // Buscar envios do lead
  const { data: envios, error } = await window.supabase
    .from("leads_envios")
    .select("id, newsletter_id, data_envio, expira_em, acessos_totais")
    .eq("lead_id", Number(leadId))
    .order("data_envio", { ascending: false });

  if (error || !envios?.length) {
    document.getElementById("lista-envios-lead").innerHTML =
      "<p style='color:#999;font-size:13px'>Nenhum envio encontrado para este lead.</p>";
    return;
  }

  // Buscar títulos das newsletters
  const nids = [...new Set(envios.map(e => e.newsletter_id))];
  const titulosMap = {};
  await Promise.all(nids.map(async nid => {
    try {
      const snap = await db.collection("newsletters").doc(nid).get();
      titulosMap[nid] = snap.exists
        ? `Edição ${snap.data().numero || "—"} — ${snap.data().titulo || ""}`
        : nid;
    } catch { titulosMap[nid] = nid; }
  }));

  document.getElementById("lista-envios-lead").innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:8px;text-align:left;border-bottom:1px solid #e2e8f0">
            <input type="checkbox" id="chk-todos-envios"
              onchange="document.querySelectorAll('.chk-envio').forEach(c=>c.checked=this.checked)">
          </th>
          <th style="padding:8px;text-align:left;border-bottom:1px solid #e2e8f0">Newsletter</th>
          <th style="padding:8px;text-align:left;border-bottom:1px solid #e2e8f0">Enviado em</th>
          <th style="padding:8px;text-align:left;border-bottom:1px solid #e2e8f0">Expira em</th>
          <th style="padding:8px;text-align:center;border-bottom:1px solid #e2e8f0">Acessos</th>
          <th style="padding:8px;text-align:left;border-bottom:1px solid #e2e8f0">Situação</th>
        </tr>
      </thead>
      <tbody>
        ${envios.map(e => {
    const expira = e.expira_em ? new Date(e.expira_em) : null;
    const expirado = expira && expira < new Date();
    const expiraFmt = expira ? expira.toLocaleString("pt-BR") : "—";
    const envioFmt = e.data_envio ? new Date(e.data_envio).toLocaleDateString("pt-BR") : "—";
    const situacao = !expira ? "—"
      : expirado ? `<span style="color:#e53e3e;font-weight:700">⛔ Expirado</span>`
        : `<span style="color:#22c55e;font-weight:700">✅ Ativo</span>`;
    return `
            <tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:8px">
                <input type="checkbox" class="chk-envio" value="${e.id}" checked>
              </td>
              <td style="padding:8px">${titulosMap[e.newsletter_id] || e.newsletter_id}</td>
              <td style="padding:8px">${envioFmt}</td>
              <td style="padding:8px">${expiraFmt}</td>
              <td style="padding:8px;text-align:center">${e.acessos_totais ?? 0}</td>
              <td style="padding:8px">${situacao}</td>
            </tr>`;
  }).join("")}
      </tbody>
    </table>`;
}

async function confirmarProrrogacao() {
  const selecionados = [...document.querySelectorAll(".chk-envio:checked")]
    .map(c => Number(c.value));

  if (!selecionados.length)
    return mostrarMensagem("Selecione pelo menos um envio para prorrogar.");

  const diasSelect = document.getElementById("prorrogar-dias").value;
  const dias = diasSelect === "0"
    ? parseInt(document.getElementById("prorrogar-dias-custom").value || "0")
    : parseInt(diasSelect);

  if (!dias || dias < 1)
    return mostrarMensagem("Informe um número de dias válido.");

  const zerarAcessos = document.getElementById("prorrogar-zerar-acessos").checked;
  const novaExpiracao = new Date();
  novaExpiracao.setDate(novaExpiracao.getDate() + dias);

  const update = { expira_em: novaExpiracao.toISOString() };
  if (zerarAcessos) update.acessos_totais = 0;

  try {
    const { error } = await window.supabase
      .from("leads_envios")
      .update(update)
      .in("id", selecionados);

    if (error) throw error;

    mostrarMensagem(
      `✅ ${selecionados.length} envio(s) prorrogado(s) por ${dias} dias.\n` +
      `Nova expiração: ${novaExpiracao.toLocaleString("pt-BR")}`
    );
    document.getElementById("modal-prorrogar-acesso").style.display = "none";

  } catch (e) {
    mostrarMensagem("Erro ao prorrogar: " + e.message);
  }
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