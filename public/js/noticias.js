window.addEventListener("DOMContentLoaded", () => {
  carregarNoticias();
});

// URL da sua API de notícias (ajuste se necessário)
const API_URL = "https://api.radarsiope.com.br/api/noticias";

async function carregarNoticias() {
  const container = document.getElementById("carrossel-noticias");
  container.innerHTML = "<p>Carregando notícias...</p>";

  try {
    const response = await fetch(API_URL);
    const noticias = await response.json();

    if (!noticias || noticias.length === 0) {
      container.innerHTML = "<p>Nenhuma notícia encontrada.</p>";
      return;
    }

    montarCarrosselNoticias(noticias, container);

  } catch (err) {
    console.error("Erro ao carregar notícias:", err);
    container.innerHTML = "<p>Erro ao carregar notícias.</p>";
  }
}

function montarCarrosselNoticias(lista, container) {
  const secao = document.createElement("section");
  secao.className = "secao-news";

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

  lista.forEach(n => {
    const card = criarCardNoticia(n);
    faixa.appendChild(card);
  });

  containerCarrossel.appendChild(faixa);

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
  container.innerHTML = "";
  container.appendChild(secao);
}

function criarCardNoticia(n) {
  const card = document.createElement("div");
  card.className = "card-news";

  const titulo = n.titulo || "Sem título";
  const link = n.link || "#";
  const data = formatarData(n.data);

  card.innerHTML = `
    <h3>${titulo}</h3>
    ${data ? `<p><strong>Data:</strong> ${data}</p>` : ""}
    <button onclick="window.open('${link}', '_blank')">Ler notícia</button>
  `;

  return card;
}

function formatarData(valor) {
  if (!valor) return "";

  const dt = new Date(valor);
  if (isNaN(dt.getTime())) return "";

  return dt.toLocaleDateString("pt-BR");
}
