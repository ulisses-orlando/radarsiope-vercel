const nodemailer = require("nodemailer");

// Configuração do transporte SMTP usando Zoho
const transporter = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465,
  secure: true,
  auth: {
    user: "contato@radarsiope.com.br", // seu e-mail Zoho
    pass: "5CVcb7zCsdpy"               // senha de aplicativo gerada no Zoho
  }
});

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

/**
 * Função para enviar e-mail de resposta automática
 * @param {Object} data - Dados do lead
 * @param {string} data.nome - Nome do destinatário
 * @param {string} data.email - E-mail do destinatário
 * @param {string} data.mensagemHtml - Conteúdo HTML do e-mail
 */
exports.enviarEmailLead = async (data) => {
  const { nome, email, mensagemHtml } = data;

  const mailOptions = {
    from: "Radar SIOPE <contato@radarsiope.com.br>",
    to: email,
    subject: "Obrigado pelo seu interesse!",
    html: mensagemHtml
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("❌ Erro ao enviar e-mail:", error);
  }
};

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
      alert("⚠️ Selecione o estado (UF).");
      ufSelect.style.border = "2px solid red";
      return null;
    }

    if (!cod_municipio) {
      alert("⚠️ Selecione o município.");
      municipioSelect.style.border = "2px solid red";
      return null;
    }

    return { cod_uf, cod_municipio, nome_municipio };
  };
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
  paginaAtual -= 2; // volta uma página
  document.getElementById('lista-usuarios').innerHTML = '';
  carregarUsuariosComFiltro();
}

function getDataMinima(dias) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return new Date(hoje.getTime() - dias * 24 * 60 * 60 * 1000);
}
