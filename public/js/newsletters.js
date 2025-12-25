// Quando a página carregar
window.addEventListener("DOMContentLoaded", () => {
  carregarNewslettersPublicas();
});

// Busca newsletters enviadas e separa em básicas e premium
async function carregarNewslettersPublicas() {
  const listaBasicas = document.getElementById("lista-basicas");
  const listaPremium = document.getElementById("lista-premium");

  listaBasicas.innerHTML = "";
  listaPremium.innerHTML = "";

  try {
    const snap = await db.collection("newsletters")
      .where("enviada", "==", true)
      .orderBy("data_publicacao", "desc")
      .get();

    const basicas = [];
    const premium = [];

    snap.forEach(doc => {
      const d = doc.data();
      const item = { id: doc.id, ...d };

      if (d.classificacao === "Básica") {
        basicas.push(item);
      } else {
        premium.push(item);
      }
    });

    montarCarrossel("Newsletters Básicas", basicas, listaBasicas, "basica");
    montarCarrossel("Newsletters Premium", premium, listaPremium, "premium");

  } catch (err) {
    console.error("Erro ao carregar newsletters:", err);
    listaBasicas.innerHTML = "<p>Erro ao carregar newsletters.</p>";
  }
}

// Monta uma seção com carrossel (título + setas + cards)
function montarCarrossel(titulo, lista, container, tipoSecao) {
  if (!lista.length) {
    container.innerHTML = `<p>Nenhuma newsletter disponível.</p>`;
    return;
  }

  const secao = document.createElement("section");
  secao.className = "secao-news";

  const h2 = document.createElement("h2");
  h2.textContent = titulo;
  secao.appendChild(h2);

  const wrapper = document.createElement("div");
  wrapper.className = "carrossel-wrapper";

  const btnEsq = document.createElement("button");
  btnEsq.textContent = "◀";
  btnEsq.className = "carrossel-seta";

  const btnDir = document.createElement("button");
  btnDir.textContent = "▶";
  btnDir.className = "carrossel-seta";

  const containerCarrossel = document.createElement("div");
  containerCarrossel.className = "carrossel-container";

  const faixa = document.createElement("div");
  faixa.className = "carrossel";

  lista.forEach(item => {
    const card = criarCardNewsletter(item);
    faixa.appendChild(card);
  });

  containerCarrossel.appendChild(faixa);

  // Lógica de rolagem das setas
  btnEsq.addEventListener("click", () => {
    faixa.scrollBy({ left: -260, behavior: "smooth" });
  });

  btnDir.addEventListener("click", () => {
    faixa.scrollBy({ left: 260, behavior: "smooth" });
  });

  wrapper.appendChild(btnEsq);
  wrapper.appendChild(containerCarrossel);
  wrapper.appendChild(btnDir);

  secao.appendChild(wrapper);
  container.appendChild(secao);
}

// Cria o card de cada newsletter dentro do carrossel
// Cria o card de cada newsletter dentro do carrossel
function criarCardNewsletter(dados) {
  const {
    id,
    titulo,
    classificacao,
    data_publicacao,
    imagem_url,
    resumo
  } = dados;

  const card = document.createElement("div");
  card.className = "card-news";

  const dataFormatada = formatarData(data_publicacao);

  // Imagem de capa (fallback simples)
  const imgSrc = imagem_url || "https://via.placeholder.com/400x225?text=Newsletter";

  // Texto do botão (ajustado ao tipo)
  const textoBotao = classificacao === "Premium" ? "Conhecer edição" : "Ler agora";

  // HTML do card
  card.innerHTML = `
    <div class="card-thumb">
      <img src="${imgSrc}" alt="Capa da newsletter" loading="lazy">
    </div>
    <div class="card-content">
      <h3 class="card-title">${titulo || "Sem título"}</h3>
      ${dataFormatada ? `<p class="card-date"><strong>Publicado:</strong> ${dataFormatada}</p>` : ""}
      ${resumo ? `<p class="card-summary">${resumo}</p>` : ""}
      <div class="card-actions">
        <button type="button" class="card-button">${textoBotao}</button>
      </div>
    </div>
  `;

  // Clique do botão
  const botao = card.querySelector(".card-button");
  botao.addEventListener("click", () => {
    abrirNewsletterSite(id, classificacao);
  });

  return card;
}


// Formata data_publicacao (Timestamp ou string)
function formatarData(valor) {
  if (!valor) return "";

  if (typeof valor === "string") return valor;

  if (valor.seconds) {
    const dt = new Date(valor.seconds * 1000);
    return dt.toLocaleDateString("pt-BR");
  }

  return "";
}

// Abre newsletter conforme classificação
function abrirNewsletterSite(id, classificacao) {
  if (classificacao === "Básica") {
    // Básica → abre direto
    window.location.href = `visualizar.html?id=${id}`;
    return;
  }

  // Premium 
  window.location.href = `capturaLead.html?origem=newsletter_publica_premium`;
}
