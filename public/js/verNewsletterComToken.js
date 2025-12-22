// Quando a página carregar
window.addEventListener("DOMContentLoaded", () => {
  VerNewsletterComToken();
});

async function VerNewsletterComToken() {
  const params = new URLSearchParams(window.location.search);
  const nid = params.get("nid");
  const env = params.get("env");
  const uid = params.get("uid");
  const token = params.get("token");

  const container = document.getElementById("conteudo-newsletter");
  container.innerHTML = "<p>Validando acesso...</p>";

  try {
    // Busca envio no Firestore
    const envioSnap = await db.collection("newsletters")
      .doc(nid)
      .collection("envios")
      .doc(env)
      .get();

    if (!envioSnap.exists) {
      container.innerHTML = "<p>Envio não encontrado.</p>";
      return;
    }

    const envio = envioSnap.data();

    // Valida destinatário e token
    if (envio.destinatarioId !== uid) {
      container.innerHTML = "<p>Acesso inválido: destinatário não confere.</p>";
      return;
    }

    if (envio.token_acesso !== token) {
      container.innerHTML = "<p>Acesso inválido: token incorreto.</p>";
      return;
    }

    if (envio.expira_em && envio.expira_em.toDate() < new Date()) {
      container.innerHTML = "<p>Este link expirou. Solicite novo acesso.</p>";
      return;
    }

    // Atualiza log de acesso
    await envioSnap.ref.update({
      ultimo_acesso: new Date(),
      acessos_totais: firebase.firestore.FieldValue.increment(1)
    });

    // Busca conteúdo da newsletter
    const newsletterSnap = await db.collection("newsletters").doc(nid).get();
    if (!newsletterSnap.exists) {
      container.innerHTML = "<p>Newsletter não encontrada.</p>";
      return;
    }

    const newsletter = newsletterSnap.data();

    // Renderiza HTML completo (com placeholders aplicados)
    const htmlFinal = aplicarPlaceholders(newsletter.html, {
      ...newsletter,
      newsletterId: nid,
      envioId: env,
      destinatarioId: uid,
      token_acesso: token
    });

    container.innerHTML = htmlFinal;

  } catch (err) {
    console.error("Erro ao validar acesso:", err);
    container.innerHTML = "<p>Erro ao validar acesso.</p>";
  }
}
