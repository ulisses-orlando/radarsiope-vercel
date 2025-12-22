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
        // 1. Buscar envio
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

        // 2. Validar token e expiração
        if (envio.token_acesso !== token) {
            console.warn("⚠️ Token inválido:", envio.token_acesso, token);
            container.innerHTML = "<p>Acesso inválido: token incorreto.</p>";
            return;
        }

        console.log(envio.expira_em)
        
        if (envio.expira_em) {
            let expiraDate;

            // Se for Timestamp do Firestore
            if (typeof envio.expira_em.toDate === "function") {
                expiraDate = envio.expira_em.toDate();
            } else {
                // Se for string ou Date
                expiraDate = new Date(envio.expira_em);
            }

            if (expiraDate < new Date()) {
                console.warn("⚠️ Link expirado:", expiraDate);
                container.innerHTML = "<p>Este link expirou. Solicite novo acesso.</p>";
                return;
            }
        }

        await envioSnap.ref.update({
            ultimo_acesso: new Date(),
            acessos_totais: firebase.firestore.FieldValue.increment(1)
        });

        // 3. Buscar newsletter
        const newsletterSnap = await db.collection("newsletters").doc(nid).get();
        if (!newsletterSnap.exists) {
            container.innerHTML = "<p>Newsletter não encontrada.</p>";
            return;
        }
        const newsletter = newsletterSnap.data();

        // 4. Buscar destinatário (usuário ou lead)
        let destinatarioSnap;
        if (assinaturaId) {
            destinatarioSnap = await db.collection("usuarios").doc(uid).get();
        } else {
            destinatarioSnap = await db.collection("leads").doc(uid).get();
        }
        if (!destinatarioSnap.exists) {
            container.innerHTML = "<p>Destinatário não encontrado.</p>";
            return;
        }
        const destinatario = destinatarioSnap.data();

        // 5. Montar objeto de dados para placeholders
        const dados = {
            // apenas os dados do destinatário que queremos substituir
            nome: destinatario.nome,
            email: destinatario.email
        };

        // 6. Aplicar placeholders
        if (newsletter.conteudo_html_completo) {
            const htmlFinal = aplicarPlaceholders(newsletter.conteudo_html_completo, dados);
            container.innerHTML = htmlFinal;
        } else {
            console.warn("⚠️ Campo conteudo_html_completo não encontrado.");
            container.innerHTML = "<p>Newsletter sem conteúdo completo.</p>";
        }


    } catch (err) {
        console.error("❌ Erro ao validar acesso:", err);
        container.innerHTML = "<p>Erro ao validar acesso.</p>";
    }
}

// ⚠️ Sem isso a função nunca roda
VerNewsletterComToken();
