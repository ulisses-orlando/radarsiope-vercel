// Inicializa o Firebase
const firebaseConfig = {
  apiKey: "AIzaSyDcS4nneXnN8Cdb-S_cQukwaguLXJYbQ1U",
  authDomain: "radarsiope.firebaseapp.com",
  projectId: "radarsiope"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

async function VerNewsletterUsuario() {
  const params = new URLSearchParams(window.location.search);
  const nid = params.get("nid");
  const container = document.getElementById("conteudo-newsletter");

  if (!nid) {
    container.innerHTML = "<p>Newsletter não encontrada.</p>";
    return;
  }

  // Recupera usuário logado
  const usuario = JSON.parse(localStorage.getItem("usuarioLogado"));
  if (!usuario) {
    container.innerHTML = "<p>Usuário não autenticado.</p>";
    return;
  }

  try {
    // 1. Buscar newsletter
    const newsletterSnap = await db.collection("newsletters").doc(nid).get();
    if (!newsletterSnap.exists) {
      container.innerHTML = "<p>Newsletter não encontrada.</p>";
      return;
    }
    const newsletter = newsletterSnap.data();

    // 2. Atualizar contador de acessos na assinatura
    const assinaturaSnap = await db.collection("usuarios")
      .doc(usuario.id)
      .collection("assinaturas")
      .where("tipo_newsletter", "==", newsletter.tipo)
      .where("status", "==", "ativa")
      .limit(1)
      .get();

    if (!assinaturaSnap.empty) {
      const assinaturaDoc = assinaturaSnap.docs[0];
      await assinaturaDoc.ref.collection("acessos").add({
        newsletterId: nid,
        data: new Date()
      });
    }

    // 3. Montar placeholders
    const dados = {
      nome: usuario.nome,
      email: usuario.email,
      edicao: newsletter.edicao,
      titulo: newsletter.titulo
    };

    const htmlFinal = aplicarPlaceholders(newsletter.conteudo_html_completo, dados);

    // 4. Marca d’água e bloqueio
    const watermark = `
      <div style="font-size:12px;color:#888;text-align:center;margin:10px 0;">
        Edição exclusiva para: ${dados.nome} · ${dados.email} · ${new Date().toLocaleString("pt-BR")}
      </div>
    `;
    const bloqueioCss = `
      <style>
        .content, .footer { user-select: none; }
      </style>
    `;

    container.innerHTML = `${bloqueioCss}${watermark}${htmlFinal}${watermark}`;
  } catch (err) {
    console.error("❌ Erro ao carregar newsletter:", err);
    container.innerHTML = "<p>Erro ao carregar newsletter.</p>";
  }
}

VerNewsletterUsuario();
