window.addEventListener("DOMContentLoaded", () => {
  carregarTemasENoticias();
});

const API_TEMAS = "https://api.radarsiope.com.br/api/noticiasApi";

// ===============================
// 1. Carrega temas do Firestore
// ===============================
async function carregarTemasENoticias() {
  const container = document.getElementById("carrossel-noticias");
  container.innerHTML = "<p>Carregando notícias...</p>";

  try {
    const response = await fetch(API_TEMAS);
    const temas = await response.json();

    if (!Array.isArray(temas) || temas.length === 0) {
      container.innerHTML = "<p>Nenhum tema encontrado.</p>";
      return;
    }

    container.innerHTML = "";

    for (const tema of temas) {
      await montarCarrosselPorTema(tema, container);
    }

  } catch (err) {
    console.error("Erro ao carregar temas:", err);
    container.innerHTML = "<p>Erro ao carregar notícias.</p>";
  }
}

// ===============================
// 2. Monta carrossel por tema
// ===============================
async function montarCarrosselPorTema(tema, container) {
  const rssUrl = gerarRSSUrl(tema.palavras_chave);
  const noticias = await buscarNoticias(rssUrl);

  if (!noticias || noticias.length === 0) return;

  const cor = tema.cor || "#007acc";

  // Seção do tema
  const secao = document.createElement("section");
  secao.className = "secao-news";
  secao.style.borderColor = cor;

  // Título do tema
  const titulo = document.createElement("h2");
  titulo.textContent = tema.nome;
  titulo.style.borderLeft = `8px solid ${cor}`;
  titulo.style.paddingLeft = "12px";
  titulo.style.color = cor;
  titulo.style.marginBottom = "16px";
  secao.appendChild(titulo);

  // Wrapper com setas
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

  // ===============================
  // 3. Criar cards das notícias
  // ===============================
  noticias.forEach(n => {
    const card = document.createElement("div");
    card.className = "card-news";
    card.style.borderColor = cor;

    card.innerHTML = `
      <div style="height:6px;background:${cor};border-radius:4px;margin-bottom:8px;"></div>
      <h3>${n.titulo}</h3>
      ${n.imagem ? `<img src="${n.imagem}" style="width:100%;border-radius:6px;margin:8px 0;">` : ""}
      ${tema.prioridade <= 2 ? `<p style="color:#e67e22;font-weight:bold;">🔥 Prioridade Alta</p>` : ""}
      <button onclick="window.open('${n.link}', '_blank')">Ler notícia</button>
    `;

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
  container.appendChild(secao);
}

// ===============================
// 4. Gera URL do Google News RSS
// ===============================
function gerarRSSUrl(palavras_chave) {
  const query = palavras_chave.map(p => `"${p}"`).join(" OR ");
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

// ===============================
// 5. Busca notícias via RSS2JSON
// ===============================
async function buscarNoticias(rssUrl) {
  try {
    const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
    const res = await fetch(apiUrl);
    const json = await res.json();

    if (!json.items) return [];

    return json.items.map(item => ({
      titulo: item.title,
      link: item.link,
      imagem: item.thumbnail || null
    }));

  } catch (err) {
    console.error("Erro ao buscar RSS:", err);
    return [];
  }
}
