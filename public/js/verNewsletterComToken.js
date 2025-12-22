// Configuração do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDcS4nneXnN8Cdb-S_cQukwaguLXJYbQ1U",
    authDomain: "radarsiope.firebaseapp.com",
    projectId: "radarsiope"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

async function VerNewsletterComToken() {

    const params = new URLSearchParams(window.location.search);
    const nid = params.get("nid");
    const env = params.get("env");
    const uid = params.get("uid");
    const token = params.get("token");
    const assinaturaId = params.get("assinaturaId");

    const container = document.getElementById("conteudo-newsletter");
    container.innerHTML = "<p>Validando acesso...</p>";

    try {
        let envioSnap;

        if (assinaturaId) {
            envioSnap = await db.collection("usuarios")
                .doc(uid)
                .collection("assinaturas")
                .doc(assinaturaId)
                .collection("envios")
                .doc(env)
                .get();
        } else {
            envioSnap = await db.collection("leads")
                .doc(uid)
                .collection("envios")
                .doc(env)
                .get();
        }

        if (!envioSnap.exists) {
            container.innerHTML = "<p>Envio não encontrado para este destinatário.</p>";
            return;
        }

        const envio = envioSnap.data();

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

        await envioSnap.ref.update({
            ultimo_acesso: new Date(),
            acessos_totais: firebase.firestore.FieldValue.increment(1)
        });

        const newsletterSnap = await db.collection("newsletters").doc(nid).get();

        if (!newsletterSnap.exists) {
            container.innerHTML = "<p>Newsletter não encontrada.</p>";
            return;
        }

        const newsletter = newsletterSnap.data();

        if (newsletter.html_conteudo) {
            const newsletter = newsletterSnap.data();

            const htmlFinal = aplicarPlaceholders(newsletter.html_conteudo, {
                ...newsletter,
                newsletterId: nid,
                envioId: env,
                destinatarioId: uid,
                assinaturaId: assinaturaId || "",
                token_acesso: token
            });

            container.innerHTML = htmlFinal;
        } else {
            console.warn("⚠️ Campo html_conteudo não encontrado.");
            container.innerHTML = "<p>Newsletter sem conteúdo HTML.</p>";
        }

    } catch (err) {
        console.error("❌ Erro ao validar acesso:", err);
        container.innerHTML = "<p>Erro ao validar acesso.</p>";
    }
}

// ⚠️ Sem isso a função nunca roda
VerNewsletterComToken();
