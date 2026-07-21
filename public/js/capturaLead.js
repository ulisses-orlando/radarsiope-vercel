// Inicializa o Firebase
const db = window.db;

function getParametro(nome) {
    const url = new URL(window.location.href);
    return url.searchParams.get(nome);
}

// Normaliza o código IBGE do município para 6 dígitos (padrão Supabase).
// O componente de UF/Município normalmente retorna o código IBGE completo (7 dígitos,
// padrão Firestore); aqui removemos o dígito verificador, igual ao cod6() já usado
// em outras partes do projeto.
function _cod6(codigo) {
    if (!codigo) return codigo;
    const str = String(codigo).trim();
    return str.length === 7 ? str.slice(0, 6) : str;
}

const origem = getParametro("origem") || "origem_nao_informada";

// Limite de solicitações de acesso trial por lead (contagem em leads_envios,
// origem='trial', medida ANTES do envio atual — ou seja, não inclui a tentativa
// em curso). Igual ou acima disso, bloqueia novos links.
const LIMITE_ACESSO_TRIAL = 3;

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
// mensagem (opcional): texto extra exibido no modal, usado nos cenários de
// trial repetido (dentro do limite / acima do limite). Se o elemento
// #mensagemModal não existir no HTML, o texto simplesmente não aparece —
// precisa adicionar esse elemento no markup do modal para funcionar.
function mostrarModalAgradecimento(nome, mensagem) {
    document.getElementById("nomeModal").textContent = nome;

    const elMensagem = document.getElementById("mensagemModal");
    if (elMensagem) {
        elMensagem.textContent = mensagem || "";
        elMensagem.style.display = mensagem ? "block" : "none";
    }

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
const NEWSLETTER_VITRINE_ID = 'ahFzl1kSoGyjb7L6mGJx';

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
            origem: 'trial',
        })
        .select('id')
        .single();

    if (error) throw new Error(`Erro ao inserir em leads_envios: ${error.message || JSON.stringify(error)}`);

    const partes = [`nid=${newsletterId}`, `env=${data.id}`, `uid=${leadId}`, `token=${token}`];
    const b64 = btoa(partes.join('&'));
    return `https://app.radarsiope.com.br/verNewsletterComToken.html?d=${encodeURIComponent(b64)}`;
}

// ============================
// 2c. Unicidade de lead por e-mail
// ============================
// Regra geral: nunca criamos mais de um registro em `leads` para o mesmo
// e-mail (constraint UNIQUE em leads.email no banco). Usado em qualquer
// origem, não só trial.
async function buscarLeadPorEmail(email) {
    const { data, error } = await window.supabase
        .from("leads")
        .select("id")
        .eq("email", email)
        .maybeSingle();

    if (error) throw new Error(`Erro ao buscar lead por e-mail: ${error.message}`);
    return data; // null se não existir
}

// Conta quantos acessos trial já foram emitidos para esse lead (registros já
// existentes em leads_envios, origem='trial' — não inclui a tentativa atual).
async function contarAcessosTrial(leadId) {
    const { count, error } = await window.supabase
        .from("leads_envios")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", leadId)
        .eq("origem", "trial");

    if (error) throw new Error(`Erro ao contar acessos trial: ${error.message}`);
    return count || 0;
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
    // Gravação no Supabase
    // ============================
    status.innerText = "Enviando...";
    botao.disabled = true;

    try {
        // Campos compartilhados entre INSERT (lead novo) e UPDATE (lead existente).
        // status/data_criacao ficam de fora daqui porque só fazem sentido no INSERT
        // (não queremos sobrescrever status/data de criação de um lead reaproveitado).
        const dadosLead = {
            nome,
            nome_lowercase: nome.toLowerCase(),
            email,
            telefone,
            perfil,
            mensagem: mensagem || null,
            interesses,
            preferencia_contato: preferencia,
            origem: origem,
            cod_uf: dadosUf.cod_uf,
            cod_municipio: _cod6(dadosUf.cod_municipio),
            nome_municipio: dadosUf.nome_municipio,
        };

        const leadExistente = await buscarLeadPorEmail(email);

        let novoLeadRef;
        let tipoMensagem = "primeiro_contato";
        let linkAcesso = null;
        let mensagemModal = null;
        let enviarMensagemAutomatica = true;

        if (origem === "trial") {
            // ── Fluxo trial ────────────────────────────────────────────────
            if (!leadExistente) {
                // Lead novo: fluxo atual, sem mudança.
                const { data, error } = await window.supabase
                    .from("leads")
                    .insert([{ ...dadosLead, status: "Novo", data_criacao: new Date().toISOString() }])
                    .select();
                if (error) throw error;
                novoLeadRef = { id: data[0].id };

                try {
                    linkAcesso = await gerarLinkAcessoTrial(novoLeadRef.id);
                    tipoMensagem = "acesso_trial";
                    await window.supabase.from("leads").update({
                            status: "Trial enviado",
                            mensagem_respondida: true,
                            mensagem_respondida_em: new Date().toISOString(),
                            mensagem_resposta: "Acesso de demonstração (72h) enviado automaticamente por e-mail.",
                        }).eq("id", novoLeadRef.id);
                } catch (err) {
                    console.error('[capturaLead] Falha ao gerar acesso trial, mantendo primeiro_contato:', err);
                }
            } else {
                // Lead existente: contar tentativas anteriores antes de decidir.
                novoLeadRef = { id: leadExistente.id };
                const contagemAnterior = await contarAcessosTrial(novoLeadRef.id);

                if (contagemAnterior < LIMITE_ACESSO_TRIAL) {
                    // Dentro do limite: gera mais um link.
                    const { error: erroUpdate } = await window.supabase
                        .from("leads")
                        .update(dadosLead)
                        .eq("id", novoLeadRef.id);
                    if (erroUpdate) throw erroUpdate;

                    try {
                        linkAcesso = await gerarLinkAcessoTrial(novoLeadRef.id);
                        tipoMensagem = "acesso_trial";
                        await window.supabase.from("leads").update({
                                status: "Trial enviado",
                                mensagem_respondida: true,
                                mensagem_respondida_em: new Date().toISOString(),
                                mensagem_resposta: "Acesso de demonstração (72h) enviado automaticamente por e-mail.",
                            }).eq("id", novoLeadRef.id);

                        mensagemModal = `Prontinho! Enviamos um novo link de acesso de demonstração para o seu e-mail. Esta foi a solicitação nº ${contagemAnterior + 1} de ${LIMITE_ACESSO_TRIAL} disponíveis.`;
                    } catch (err) {
                        console.error('[capturaLead] Falha ao gerar acesso trial, mantendo primeiro_contato:', err);
                    }
                } else {
                    // Acima do limite: não gera link, não envia e-mail.
                    const tentativaAtual = contagemAnterior + 1;
                    const { error: erroUpdate } = await window.supabase
                        .from("leads")
                        .update({
                            ...dadosLead,
                            mensagem: `${tentativaAtual}ª solicitação de acesso trial`,
                            status: "Limite trial atingido",
                            mensagem_respondida: false,
                            mensagem_respondida_em: null,
                            mensagem_resposta: null,
                        })
                        .eq("id", novoLeadRef.id);
                    if (erroUpdate) throw erroUpdate;

                    tipoMensagem = "limite_acesso_trial";
                    enviarMensagemAutomatica = false; // sem e-mail nesse cenário
                    mensagemModal = "Você já utilizou todas as suas solicitações de acesso de demonstração. Nossa equipe vai entrar em contato em breve para apresentar o plano ideal para você.";
                }
            }
        } else {
            // ── Fluxo contato_pelo_site (ou outra origem) ─────────────────
            if (!leadExistente) {
                const { data, error } = await window.supabase
                    .from("leads")
                    .insert([{ ...dadosLead, status: "Novo", data_criacao: new Date().toISOString() }])
                    .select();
                if (error) throw error;
                novoLeadRef = { id: data[0].id };
            } else {
                novoLeadRef = { id: leadExistente.id };
                const { error: erroUpdate } = await window.supabase
                    .from("leads")
                    .update({
                        ...dadosLead,
                        status: "Novo",
                        mensagem_respondida: false,
                        mensagem_respondida_em: null,
                        mensagem_resposta: null,
                    })
                    .eq("id", novoLeadRef.id);
                if (erroUpdate) throw erroUpdate;
            }
        }

        // Disparo automático de boas-vindas / acesso trial (pulado quando
        // origem=trial e limite foi atingido — nesse caso não enviamos e-mail).
        if (enviarMensagemAutomatica) {
            await dispararMensagemAutomatica(tipoMensagem, {
                id: novoLeadRef.id,
                nome: nome,
                email: email,
                interesse: interesses,
                preferencia_contato: preferencia,
                uf: dadosUf.cod_uf,
                municipio: dadosUf.nome_municipio,
                perfil: perfil,
                link_ativacao: linkAcesso
            }, "lead");
        }

        // Incrementa contadores no admin_contadores
        try {
          const _db = window.db;
          if (_db) {
            const incrementos = {};
            // Trial dentro do limite já foi resolvido automaticamente: não conta
            // como pendência de "Novo". Todo o resto (primeiro contato, contato
            // pelo site reaberto, limite de trial atingido) é pendência real.
            if (tipoMensagem !== "acesso_trial") {
              incrementos.leads_novos = firebase.firestore.FieldValue.increment(1);
            }
            // Só conta como "mensagem" se o texto veio de fato do lead (não o
            // texto de contagem que geramos no cenário de limite atingido).
            if (mensagem && tipoMensagem !== "limite_acesso_trial") {
              incrementos.leads_mensagens = firebase.firestore.FieldValue.increment(1);
            }
            if (Object.keys(incrementos).length) {
              await _db.collection('admin_contadores').doc('pendencias')
                .set(incrementos, { merge: true });
            }
          }
        } catch(e) { console.warn('[capturaLead] contador:', e.message); }

        status.innerText = "Enviado com sucesso!";
        status.style.color = "green";

        mostrarModalAgradecimento(nome, mensagemModal);

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

    // 🔹 Inserir UF e Município
    window.validarUfMunicipio = await inserirCamposUfMunicipio(
        document.getElementById("campo-uf-municipio")
    );

    document.getElementById("form-interesse")
        .addEventListener("submit", processarEnvioInteresse);
}

initCapturaLead();