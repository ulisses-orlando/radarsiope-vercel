// Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyDcS4nneXnN8Cdb-S_cQukwaguLXJYbQ1U",
  authDomain: "radarsiope.firebaseapp.com",
  projectId: "radarsiope"
};
console.log("🔎 inicializando bd");
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
console.log("🔎 inicializado o bd");
async function VerNewsletterComToken() {
  console.log("🔎 Iniciando VerNewsletterComToken...");

  const params = new URLSearchParams(window.location.search);
  const nid = params.get("nid");
  const env = params.get("env");
  const uid = params.get("uid");
  const token = params.get("token");
  const assinaturaId = params.get("assinaturaId");

  console.log("➡️ Params:", { nid, env, uid, token, assinaturaId });

  const container = document.getElementById("conteudo-newsletter");
  container.innerHTML = "<p>Validando acesso...</p>";

  try {
    let envioSnap;

    if (assinaturaId) {
      console.log("📂 Buscando envio em usuarios...");
      envioSnap = await db.collection("usuarios")
        .doc(uid)
        .collection("assinaturas")
        .doc(assinaturaId)
        .collection("envios")
        .doc(env)
        .get();
    } else {
      console.log("📂 Buscando envio em leads...");
      envioSnap = await db.collection("leads")
        .doc(uid)
        .collection("envios")
        .doc(env)
        .get();
    }

    console.log("📄 envioSnap.exists:", envioSnap.exists);

    if (!envioSnap.exists) {
      container.innerHTML = "<p>Envio não encontrado para este destinatário.</p>";
      return;
    }

    const envio = envioSnap.data();
    console.log("📄 Dados do envio:", envio);

    // Valida token
    if (envio.token_acesso !== token) {
      console.warn("⚠️ Token inválido:", envio.token_acesso, token);
      container.innerHTML = "<p>Acesso inválido: token incorreto.</p>";
      return;
    }

    if (envio.expira_em && envio.expira_em.toDate() < new Date()) {
      console.warn("⚠️ Link expirado:", envio.expira_em.toDate());
      container.innerHTML = "<p>Este link expirou. Solicite novo acesso.</p>";
      return;
    }

    console.log("✅ Token válido e link ativo.");

    // Atualiza log
    await envioSnap.ref.update({
      ultimo_acesso: new Date(),
      acessos_totais: firebase.firestore.FieldValue.increment(1)
    });
    console.log("📝 Log de acesso atualizado.");

    // Busca conteúdo da newsletter
    console.log("📂 Buscando newsletter:", nid);
    const newsletterSnap = await db.collection("newsletters").doc(nid).get();
    console.log("📄 newsletterSnap.exists:", newsletterSnap.exists);

    if (!newsletterSnap.exists) {
      container.innerHTML = "<p>Newsletter não encontrada.</p>";
      return;
    }

    const newsletter = newsletterSnap.data();
    console.log("📄 Dados da newsletter:", newsletter);

    // Renderiza HTML direto (sem aplicarPlaceholders)
    if (newsletter.html_conteudo) {
      console.log("✅ Renderizando newsletter...");
      container.innerHTML = newsletter.html_conteudo;
    } else {
      console.warn("⚠️ Campo html_conteudo não encontrado.");
      container.innerHTML = "<p>Newsletter sem conteúdo HTML.</p>";
    }

  } catch (err) {
    console.error("❌ Erro ao validar acesso:", err);
    container.innerHTML = "<p>Erro ao validar acesso.</p>";
  }
}
/*
    const newsletter = newsletterSnap.data();

    // ⚠️ Aqui estava o problema: usar html_conteudo
   /* const htmlFinal = aplicarPlaceholders(newsletter.html_conteudo, {
      ...newsletter,
      newsletterId: nid,
      envioId: env,
      destinatarioId: uid,
      assinaturaId: assinaturaId || "",
      token_acesso: token
    });

    container.innerHTML = htmlFinal;

    container.innerHTML = newsletter.html_conteudo;

  } catch (err) {
    console.error("Erro ao validar acesso:", err);
    container.innerHTML = "<p>Erro ao validar acesso.</p>";
  }
}
*/
// Chama a função ao carregar a página 
VerNewsletterComToken();