// ============================
// 1. Monta checkboxes de tipos
// ============================
async function carregarTiposNewsletter() {
    const container = document.getElementById("campo-newsletters");

    const snap = await db.collection("tipo_newsletters").get();
    const tipos = snap.docs.map(doc => doc.data().nome).filter(Boolean);

    if (!tipos.length) {
        container.innerHTML = "<p style='color:#999'>Nenhum tipo de newsletter configurado.</p>";
        return;
    }

    container.innerHTML = `
        <label>Selecione o(s) seu(s) interesse(s)</label>
        <div id="grupo-newsletters" class="caixa-interesses duas-colunas">
            ${tipos.map(tipo => `
            <label class="item-interesse">
                <input type="checkbox" value="${tipo}">
                <span class="icone"></span>
                <span class="texto">${tipo}</span>
            </label>
            `).join("")}
        </div>
        `;
}

// ============================
// 2. Modal de agradecimento
// ============================
function mostrarModalAgradecimento(nome) {
    document.getElementById("nomeModal").textContent = nome;
    document.getElementById("modalAgradecimento").style.display = "flex";
}

function fecharModalAgradecimento() {
    document.getElementById("modalAgradecimento").style.display = "none";
    setTimeout(() => {
        window.location.href = "https://www.radarsiope.com.br/pagina-inicial";
    }, 200);
}

// ============================
// 3. Envio do formulário
// ============================
async function processarEnvioInteresse(e) {
    e.preventDefault();

    const status = document.getElementById("status-envio");
    const botao = e.target.querySelector("button[type='submit']");

    const nome = document.getElementById("nome").value.trim();
    const email = document.getElementById("email").value.trim();
    const confirmar = document.getElementById("confirmar_email").value.trim();
    const telefone = document.getElementById("telefone").value.trim();
    const perfil = document.getElementById("perfil").value;
    const mensagem = document.getElementById("mensagem").value.trim();
    const preferencia = document.getElementById("preferencia-contato").value;

    const checks = document.querySelectorAll('#grupo-newsletters input[type="checkbox"]:checked');
    const interesses = Array.from(checks).map(cb => cb.value);

    status.innerText = "";
    status.style.color = "black";

    // ============================
    // Validações
    // ============================
    if (nome.length < 3) {
        status.innerText = "⚠️ Nome deve ter pelo menos 3 caracteres.";
        return;
    }

    if (!validarEmail(email)) {
        status.innerText = "⚠️ E-mail inválido.";
        return;
    }

    if (email !== confirmar) {
        status.innerText = "⚠️ Os e-mails não coincidem.";
        return;
    }

    const telefoneNumerico = telefone.replace(/\D/g, "");
    if (telefoneNumerico.length < 10 || !validarTelefoneFormato(telefone)) {
        status.innerText = "⚠️ Telefone inválido.";
        return;
    }

    if (!perfil) {
        status.innerText = "⚠️ Selecione o perfil.";
        return;
    }

    if (!interesses.length) {
        status.innerText = "⚠️ Selecione pelo menos um interesse.";
        return;
    }

    if (!preferencia) {
        status.innerText = "⚠️ Selecione uma preferência de contato.";
        return;
    }

    // ============================
    // Gravação no Firestore
    // ============================
    status.innerText = "Enviando...";
    botao.disabled = true;

    try {
        await db.collection("leads").add({
            nome,
            nome_lowercase: nome.toLowerCase(),
            email,
            telefone,
            perfil,
            mensagem: mensagem || null,
            interesses,
            preferencia_contato: preferencia,
            origem: "newsletter_publica_premium",
            status: "Novo",
            data_criacao: firebase.firestore.Timestamp.now()
        });

        status.innerText = "Enviado com sucesso!";
        status.style.color = "green";

        mostrarModalAgradecimento(nome);

        e.target.reset();

    } catch (err) {
        console.error(err);
        status.innerText = "Erro ao enviar. Tente novamente.";
        status.style.color = "red";
    } finally {
        botao.disabled = false;
    }
}

// ============================
// 4. Inicialização
// ============================
async function initCapturaLead() {
    aplicarMascaraTelefone(document.getElementById("telefone"));
    await carregarTiposNewsletter();

    document.getElementById("form-interesse")
        .addEventListener("submit", processarEnvioInteresse);
}

initCapturaLead();
