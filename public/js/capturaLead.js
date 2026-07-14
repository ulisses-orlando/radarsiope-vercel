// Inicializa o Firebase
const db = window.db;

function getParametro(nome) {
    const url = new URL(window.location.href);
    return url.searchParams.get(nome);
}

const origem = getParametro("origem") || "origem_nao_informada";

// ============================
// 1. Monta checkboxes de tipos
// ============================
async function carregarTiposNewsletter() {
    const container = document.getElementById("campo-newsletters");

    const snap = await db.collection("tipo_newsletters").get();
    const tipos = snap.docs.map(doc => doc.data().nome).filter(nome => nome && nome !== "Momento envio");

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

// Função para fechar o modal
function fecharModalAgradecimento() {
  document.getElementById("modalAgradecimento").style.display = "none";
  setTimeout(() => {
    window.location.href = "index.html";
  }, 200);
}

// 🔹 Adiciona o listener ao botão
document.addEventListener("DOMContentLoaded", () => {
  const btnFechar = document.getElementById("btnFecharModal");
  if (btnFechar) {
    btnFechar.addEventListener("click", fecharModalAgradecimento);
  }
});

// ============================
// 2b. Acesso trial (leads vindos do CTA "Conheça o App")
// ============================
// Reaproveita o mesmo formato de registro que enviarLoteEmMassa (EnvioLeads.js)
// grava em leads_envios — sem depender daquela função. O acesso "pro" de 72h em
// si é resolvido pelo detectarAcesso() em verNewsletterComToken.js a partir dos
// campos acesso_pro_temporario/acesso_pro_horas já configurados na edição.

// Token autocontido: usa gerarTokenAcesso() se ela já estiver carregada na página
// (ex: reaproveitada de outro script), senão gera localmente. Evita depender de
// um script que talvez só exista em admin.html.
function _gerarTokenTrial() {
    if (typeof gerarTokenAcesso === 'function') return gerarTokenAcesso();
    if (window.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

// ID fixo da edição 001 — usada como vitrine do trial. Mantido em sincronia
// com a policy de INSERT em leads_envios no Supabase ("newsletter_id = ...").
const NEWSLETTER_VITRINE_ID = '2PxBgOfhOuM6ERAVjdam';

async function gerarLinkAcessoTrial(leadId) {
    const newsletterId = NEWSLETTER_VITRINE_ID;

    const token = _gerarTokenTrial();
    const expiraEm = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // validade do link: 3 dias

    const { data, error } = await window.supabase
        .from('leads_envios')
        .insert({
            lead_id: leadId,
            newsletter_id: newsletterId,
            data_envio: new Date().toISOString(),
            status: 'enviado',
            token_acesso: token,
            expira_em: expiraEm.toISOString(),
        })
        .select('id')
        .single();

    if (error) throw new Error(`Erro ao inserir em leads_envios: ${error.message || JSON.stringify(error)}`);

    const partes = [`nid=${newsletterId}`, `env=${data.id}`, `uid=${leadId}`, `token=${token}`];
    const b64 = btoa(partes.join('&'));
    return `https://app.radarsiope.com.br/verNewsletterComToken.html?d=${encodeURIComponent(b64)}`;
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
    // Validação UF e Município
    // ============================
    const dadosUf = validarUfMunicipio();
    if (!dadosUf) return;

    // ============================
    // Gravação no Firestore
    // ============================
    status.innerText = "Enviando...";
    botao.disabled = true;

    try {
        // 1. Define o status inicial com base na origem (evita necessidade de UPDATE posterior)
        const statusInicial = (origem === "trial") ? "Trial enviado" : "Novo";

        const { data, error } = await window.supabase
            .from("leads")
            .insert([{
                nome,
                nome_lowercase: nome.toLowerCase(),
                email,
                telefone,
                perfil,
                mensagem: mensagem || null,
                interesses,
                preferencia_contato: preferencia,
                origem: origem,
                status: statusInicial, // <-- "Trial enviado" já é salvo aqui no INSERT
                cod_uf: dadosUf.cod_uf,
                cod_municipio: dadosUf.cod_municipio,
                nome_municipio: dadosUf.nome_municipio,
                data_criacao: new Date().toISOString()
            }])
            .select();

        if (error) throw error;

        const novoLeadId = data[0].id;
        console.log('[capturaLead] Lead criado com sucesso, ID:', novoLeadId);

        // ── Acesso trial (leads vindos do CTA "Conheça o App") ───────────────
        let tipoMensagem = "primeiro_contato";
        let linkAcesso = null;

        if (origem === "trial") {
            try {
                console.log('[capturaLead] Gerando acesso trial para lead', novoLeadId);
                linkAcesso = await gerarLinkAcessoTrial(novoLeadId);
                console.log('[capturaLead] Link de acesso trial gerado:', linkAcesso);
                tipoMensagem = "acesso_trial";
            } catch (e) {
                console.error('[capturaLead] Falha ao gerar acesso trial, mantendo primeiro_contato:', e);
            }
        }

        console.log('[capturaLead] tipoMensagem:', tipoMensagem, 'linkAcesso:', linkAcesso);

        // Disparo automático de boas-vindas (ou acesso trial)
        try {
            await dispararMensagemAutomatica(tipoMensagem, {
                id: novoLeadId,
                nome: nome,
                email: email,
                interesse: interesses,
                preferencia_contato: preferencia,
                uf: dadosUf.cod_uf,
                municipio: dadosUf.nome_municipio,
                perfil: perfil,
                link_acesso: linkAcesso
            }, "lead");
            console.log('[capturaLead] Mensagem automática disparada para lead', novoLeadId);
        } catch (emailError) {
            // ✅ ADICIONADO: Agora, se o e-mail falhar, o erro real aparecerá no console
            console.error('[capturaLead] Erro ao disparar mensagem automática:', emailError);
        }

        // Incrementa contadores no admin_contadores
        try {
            const _db = window.db;
            if (_db) {
                const incrementos = {};
                // Trial já foi resolvido automaticamente: não conta como pendência de "Novo"
                if (tipoMensagem !== "acesso_trial") {
                    incrementos.leads_novos = firebase.firestore.FieldValue.increment(1);
                }
                if (mensagem) incrementos.leads_mensagens = firebase.firestore.FieldValue.increment(1);
                
                if (Object.keys(incrementos).length) {
                    await _db.collection('admin_contadores').doc('pendencias')
                        .set(incrementos, { merge: true });
                }
            }
        } catch(e) { 
            console.warn('[capturaLead] erro no contador:', e.message); 
        }

        status.innerText = "Enviado com sucesso!";
        status.style.color = "green";
        mostrarModalAgradecimento(nome);
        e.target.reset();

    } catch (err) {
        console.error("Erro principal no processamento:", err);
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

    // 🔹 Inserir UF e Município
    window.validarUfMunicipio = await inserirCamposUfMunicipio(
        document.getElementById("campo-uf-municipio")
    );

    document.getElementById("form-interesse")
        .addEventListener("submit", processarEnvioInteresse);
}

initCapturaLead();