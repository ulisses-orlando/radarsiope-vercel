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
          <li><code>{{UF}}</code> → UF do usuário</li>
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
    .replace(/{{interesseId}}/gi, interesseId)
    .replace(/{{token}}/gi, token);
}
