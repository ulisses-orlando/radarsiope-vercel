// =======================
// Funções utilitárias (frontend)
// =======================

function validarEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validarTelefoneFormato(telefone) {
  const telefoneRegex = /^\(\d{2}\)\s?\d{4,5}-\d{4}$/;
  return telefoneRegex.test(telefone);
}

function aplicarMascaraTelefone(input) {
  input.addEventListener("input", () => {
    let v = input.value.replace(/\D/g, "");
    if (v.length > 11) v = v.slice(0, 11);
    if (v.length > 10) {
      input.value = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
    } else if (v.length > 6) {
      input.value = `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
    } else if (v.length > 2) {
      input.value = `(${v.slice(0, 2)}) ${v.slice(2)}`;
    } else {
      input.value = v;
    }
  });
}

function formatDateBR(date) {
  if (!date) return "";
  const d = new Date(date.seconds ? date.seconds * 1000 : date);
  return d.toLocaleDateString("pt-BR");
}

function formatarBRL(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function irParaPrimeiraPagina() {
  paginaAtual = 1;
  historicoDocs = [];
  document.getElementById('lista-usuarios').innerHTML = '';
  carregarUsuariosComFiltro();
}

function irParaPaginaAnterior() {
  if (paginaAtual <= 2) {
    irParaPrimeiraPagina();
    return;
  }
  paginaAtual -= 2;
  document.getElementById('lista-usuarios').innerHTML = '';
  carregarUsuariosComFiltro();
}

function getDataMinima(dias) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return new Date(hoje.getTime() - dias * 24 * 60 * 60 * 1000);
}

function gerarHtmlPlaceholdersExpandivel() {
  return `
    <div class="placeholder-box">
      <div class="placeholder-header" onclick="this.parentElement.classList.toggle('open')">
        <strong>📌 Placeholders disponíveis</strong>
        <span class="toggle-icon">▼</span>
      </div>
      <div class="placeholder-content">
        <ul>
          <li><code>{{nome}}</code> → Nome do usuário</li>
          <li><code>{{email}}</code> → E-mail do usuário</li>
          <li><code>{{edicao}}</code> → Número da edição</li>
          <li><code>{{tipo}}</code> → Tipo da newsletter</li>
          <li><code>{{titulo}}</code> → Título da edição</li>
          <li><code>{{data_publicacao}}</code> → Data da edição (DD/MM/AAAA)</li>
          <li><code>{{blocos}}</code> → Local onde os blocos serão inseridos</li>
          <li><code>{{uf}}</code> → UF do usuário</li>
          <li><code>{{municipio}}</code> → Município do usuário</li>
          <li><code>{{cargo}}</code> → Cargo do usuário</li>
          <li><code>{{interesse}}</code> → Interesse do usuário</li>
          <li><code>{{token}}</code> → Token para envio da newsletter</li>
        </ul>
        <p>Esses campos serão substituídos automaticamente no momento do envio.</p>
      </div>
    </div>
  `;
}

function extrairPlaceholdersDisponiveis() {
  const html = gerarHtmlPlaceholdersExpandivel();
  // Captura todos os {{...}} dentro do HTML
  const encontrados = [...html.matchAll(/{{(.*?)}}/g)].map(m => m[1].toLowerCase());
  return encontrados;
}

function validarPlaceholders(template) {
  // Extrai a lista oficial direto da função que lista os placeholders
  const html = gerarHtmlPlaceholdersExpandivel();
  const placeholdersSuportados = [...html.matchAll(/{{(.*?)}}/g)]
    .map(m => m[1].toLowerCase());

  // Placeholders que devem ser ignorados na validação (fora do escopo da newsletter)
  const excecoes = [
    "newsletterid", "envioid", "destinatarioid", "interesseid"
  ];

  // Captura todos os placeholders usados no template
  const usados = [...template.matchAll(/{{(.*?)}}/g)]
    .map(m => m[1].toLowerCase());

  // Filtra os que não estão na lista suportada e não são exceções
  const desconhecidos = usados.filter(ph =>
    !placeholdersSuportados.includes(ph) && !excecoes.includes(ph)
  );

  if (desconhecidos.length > 0) {
    mostrarMensagem("⚠️ Placeholders sem correspondência: " + desconhecidos.join(", "));
    return false; // indica que há erro
  }

  return true; // indica que está tudo certo
}

function normalizarDataFirestoreCompat(valor) {
  if (!valor) return null;
  return firebase.firestore.Timestamp.fromDate(new Date(valor));
}

function dateStringToLocalTimestamp(dateStr) {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split("-").map(Number);
  // Cria Date no horário local
  const date = new Date(year, month - 1, day, 0, 0, 0);
  return firebase.firestore.Timestamp.fromDate(date);
}

function mostrarMensagem(mensagem) {
  const existente = document.getElementById("modal-radar-siope");
  if (existente) existente.remove();

  const fundo = document.createElement("div");
  fundo.id = "modal-radar-siope";
  fundo.style.position = "fixed";
  fundo.style.top = "0";
  fundo.style.left = "0";
  fundo.style.width = "100vw";
  fundo.style.height = "100vh";
  fundo.style.background = "rgba(0,0,0,0.55)";
  fundo.style.display = "flex";
  fundo.style.alignItems = "center";
  fundo.style.justifyContent = "center";
  fundo.style.zIndex = "99999";

  const caixa = document.createElement("div");
  caixa.style.background = "#fff";
  caixa.style.padding = "25px";
  caixa.style.borderRadius = "10px";
  caixa.style.width = "90%";
  caixa.style.maxWidth = "420px";
  caixa.style.boxShadow = "0 4px 20px rgba(0,0,0,0.25)";
  caixa.style.textAlign = "center";

  const titulo = document.createElement("h2");
  titulo.innerText = "Radar SIOPE";
  titulo.style.marginTop = "0";
  titulo.style.color = "#007acc";

  const texto = document.createElement("p");
  texto.innerText = mensagem;
  texto.style.fontSize = "16px";
  texto.style.margin = "15px 0";

  const botao = document.createElement("button");
  botao.innerText = "OK";
  botao.style.padding = "10px 25px";
  botao.style.background = "#007acc";
  botao.style.color = "#fff";
  botao.style.border = "none";
  botao.style.borderRadius = "6px";
  botao.style.cursor = "pointer";
  botao.onclick = () => fundo.remove();

  caixa.appendChild(titulo);
  caixa.appendChild(texto);
  caixa.appendChild(botao);
  fundo.appendChild(caixa);
  document.body.appendChild(fundo);
}

function gerarTokenAcesso(tamanho = 20) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < tamanho; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function aplicarPlaceholders(template, dados) {
  const nome = dados.nome || "(nome não informado)";
  const email = dados.email || "(email não informado)";
  const edicao = dados.edicao || "(sem edição)";
  let tipo = "(sem tipo)";
  if (Array.isArray(dados.interesses) && dados.interesses.length > 0) {
    tipo = dados.interesses.join(", ");
  } else if (dados.tipo) {
    tipo = dados.tipo;
  }
  const titulo = dados.titulo || "(sem título)";
  const newsletterId = dados.newsletterId || "(sem newsletterId)";
  const envioId = dados.envioId || "(sem envioId)";
  const destinatarioId = dados.destinatarioId || "(sem destinatarioId)";
  const cod_uf = dados.cod_uf || "(sem UFId)";
  const nome_municipio = dados.nome_municipio || "(sem municipioId)";
  const cargo = dados.tipo_perfil || dados.perfil || "(sem cargoId)";
  const interesse = dados.interesse || "(sem interesse)";
  const interesseId = dados.interesseId || "(sem interesseId)";
  const token = dados.token_acesso || "(sem token)";

  let dataFormatada = "";
  if (dados.data_publicacao) {
    const dataObj = dados.data_publicacao.toDate?.() || dados.data_publicacao;
    dataFormatada = formatDateBR(dataObj);
  }

  return template
    .replace(/{{nome}}/gi, nome)
    .replace(/{{email}}/gi, email)
    .replace(/{{edicao}}/gi, edicao)
    .replace(/{{tipo}}/gi, tipo)
    .replace(/{{titulo}}/gi, titulo)
    .replace(/{{data_publicacao}}/gi, dataFormatada)
    .replace(/{{newsletterId}}/gi, newsletterId)
    .replace(/{{envioId}}/gi, envioId)
    .replace(/{{destinatarioId}}/gi, destinatarioId)
    .replace(/{{uf}}/gi, cod_uf)
    .replace(/{{municipio}}/gi, nome_municipio)
    .replace(/{{cargo}}/gi, cargo)
    .replace(/{{interesse}}/gi, interesse)  
    .replace(/{{interesseId}}/gi, interesseId)
    .replace(/{{token}}/gi, token);
}

async function inserirCamposUfMunicipio(container, ufPadrao = "", municipioPadrao = "") {
  // 🔎 Mapeamento de DDD para UF
  const dddParaUf = {
    "11": "SP", "12": "SP", "13": "SP", "14": "SP", "15": "SP", "16": "SP", "17": "SP", "18": "SP", "19": "SP",
    "21": "RJ", "22": "RJ", "24": "RJ",
    "27": "ES", "28": "ES",
    "31": "MG", "32": "MG", "33": "MG", "34": "MG", "35": "MG", "37": "MG", "38": "MG",
    "41": "PR", "42": "PR", "43": "PR", "44": "PR", "45": "PR", "46": "PR",
    "47": "SC", "48": "SC", "49": "SC",
    "51": "RS", "53": "RS", "54": "RS", "55": "RS",
    "61": "DF",
    "62": "GO", "64": "GO",
    "63": "TO",
    "65": "MT", "66": "MT",
    "67": "MS",
    "68": "AC",
    "69": "RO",
    "71": "BA", "73": "BA", "74": "BA", "75": "BA", "77": "BA",
    "79": "SE",
    "81": "PE", "87": "PE",
    "82": "AL",
    "83": "PB",
    "84": "RN",
    "85": "CE", "88": "CE",
    "86": "PI", "89": "PI",
    "91": "PA", "93": "PA", "94": "PA",
    "92": "AM", "97": "AM",
    "95": "RR",
    "96": "AP",
    "98": "MA", "99": "MA"
  };

  // 🧱 Criação dos elementos
  const ufLabel = document.createElement("label");
  ufLabel.textContent = "Estado (UF):";
  const ufSelect = document.createElement("select");
  ufSelect.id = "uf";
  ufSelect.required = true;
  ufSelect.style.cssText = "width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc";
  ufSelect.innerHTML = '<option value="">Selecione o estado...</option>';

  const municipioLabel = document.createElement("label");
  municipioLabel.textContent = "Município:";
  const municipioSelect = document.createElement("select");
  municipioSelect.id = "municipio";
  municipioSelect.required = true;
  municipioSelect.style.cssText = "width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc";
  municipioSelect.innerHTML = '<option value="">Selecione o município...</option>';

  container.appendChild(ufLabel);
  container.appendChild(ufSelect);
  container.appendChild(municipioLabel);
  container.appendChild(municipioSelect);

  // 📥 Preenche UF
  const ufSnap = await db.collection("UF").get();
  ufSnap.forEach(doc => {
    const { nome_uf } = doc.data();
    const option = document.createElement("option");
    option.value = doc.id;
    option.textContent = `${nome_uf} (${doc.id})`;
    ufSelect.appendChild(option);
  });

  if (ufPadrao) ufSelect.value = ufPadrao;

  // 📥 Preenche municípios ao mudar UF
  ufSelect.addEventListener("change", async () => {
    municipioSelect.innerHTML = '<option value="">Selecione o município...</option>';
    const ufId = ufSelect.value;
    if (!ufId) return;

    const municipiosSnap = await db.collection("UF").doc(ufId).collection("Municipio").get();
    municipiosSnap.forEach(doc => {
      const { nome_municipio, cod_municipio } = doc.data();
      const option = document.createElement("option");
      option.value = cod_municipio;
      option.textContent = nome_municipio;
      municipioSelect.appendChild(option);
    });

    if (municipioPadrao) municipioSelect.value = municipioPadrao;
  });

  if (ufPadrao) {
    ufSelect.dispatchEvent(new Event("change"));
  }

  // 📞 Sugestão automática de UF com base no DDD
  const telefoneInput = document.getElementById("telefone");
  if (telefoneInput) {
    telefoneInput.addEventListener("input", () => {
      const match = telefoneInput.value.match(/\(?(\d{2})\)?/);
      const ddd = match?.[1];
      const ufSugerida = dddParaUf[ddd];

      if (ufSugerida) {
        ufSelect.value = ufSugerida;
        ufSelect.dispatchEvent(new Event("change"));
      }
    });
  }

  // ✅ Retorna função de validação e coleta
  return function validarUfMunicipio() {
    ufSelect.style.border = "1px solid #ccc";
    municipioSelect.style.border = "1px solid #ccc";

    const cod_uf = ufSelect.value;
    const cod_municipio = municipioSelect.value;
    const nome_municipio = municipioSelect.options[municipioSelect.selectedIndex]?.textContent || null;

    if (!cod_uf) {
      mostrarMensagem("⚠️ Selecione o estado (UF).");
      ufSelect.style.border = "2px solid red";
      return null;
    }

    if (!cod_municipio) {
      mostrarMensagem("⚠️ Selecione o município.");
      municipioSelect.style.border = "2px solid red";
      return null;
    }

    return { cod_uf, cod_municipio, nome_municipio };
  };
}
// parseia entrada numérica (aceita "1.234,56" ou "1234.56")
function parseNumberInput(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  // remove espaços, símbolos de moeda, mantém apenas dígitos e separador decimal
  const cleaned = s.replace(/\s+/g, '').replace(/R\$\s?/, '').replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// valida valor e qtde de parcelas
function validateValorEParcelas({ valorRaw, parcelasRaw, minValor = 0, maxValor = 1000000, minParcelas = 1, maxParcelas = 120 }) {
  const errors = {};
  const valor = parseNumberInput(valorRaw);
  const parcelas = parseNumberInput(parcelasRaw);

  // VALIDA valor
  if (valor === null) {
    errors.valor = 'Valor inválido. Use apenas números.';
  } else if (valor < minValor) {
    errors.valor = `Valor deve ser maior ou igual a ${minValor}.`;
  } else if (valor > maxValor) {
    errors.valor = `Valor muito alto. Máx ${maxValor}.`;
  } else {
    // limitar a 2 casas decimais
    const cents = Math.round(valor * 100);
    if (Math.abs(cents / 100 - valor) > 0) {
      errors.valor = 'Valor deve ter no máximo 2 casas decimais.';
    }
  }

  // VALIDA parcelas (se preenchido)
  if (parcelasRaw !== '' && parcelasRaw !== null && parcelasRaw !== undefined) {
    if (parcelas === null) {
      errors.qtde_parcelas = 'Parcelas inválidas. Use um número inteiro.';
    } else if (!Number.isInteger(parcelas)) {
      errors.qtde_parcelas = 'Parcelas devem ser número inteiro.';
    } else if (parcelas < minParcelas || parcelas > maxParcelas) {
      errors.qtde_parcelas = `Parcelas devem estar entre ${minParcelas} e ${maxParcelas}.`;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors, parsed: { valor, qtde_parcelas: parcelas } };
}

// mostra erros inline próximos aos campos (procura spans com id error-<campo>)
function showFieldErrors(errors) {
  Object.keys(errors).forEach(field => {
    const span = document.getElementById(`error-${field}`);
    if (span) {
      span.textContent = errors[field];
      span.style.display = 'block';
    } else {
      console.warn('Erro de validação (sem span):', field, errors[field]);
    }
  });
}

// limpa mensagens de erro
function clearFieldErrors(fieldNames = []) {
  if (!fieldNames.length) {
    document.querySelectorAll('[id^="error-"]').forEach(s => { s.textContent = ''; s.style.display = 'none'; });
    return;
  }
  fieldNames.forEach(name => {
    const span = document.getElementById(`error-${name}`);
    if (span) { span.textContent = ''; span.style.display = 'none'; }
  });
}
