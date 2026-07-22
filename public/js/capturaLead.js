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
// trial repetido (dentro do limite / acima do limite). Requer o elemento
// #mensagemModal dentro do #modalAgradecimento (ver capturaLead.html).
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
// 2c. Unicidade de lead por e-mail (via RPC — a tabela `leads` não tem
// SELECT/UPDATE liberado para o cliente anônimo, só INSERT; ver funções
// lead_buscar_por_email / contar_acessos_trial / lead_atualizar* no Supabase)
// ============================
async function buscarLeadPorEmail(email) {
    const { data, error } = await window.supabase
        .rpc("lead_buscar_por_email", { p_email: email });

    if (error) throw new Error(`Erro ao buscar lead por e-mail: ${error.message}`);
    return data; // id (bigint) ou null se não existir
}

// Conta quantos acessos trial já foram emitidos para esse lead (registros já
// existentes em leads_envios, origem='trial' — não inclui a tentativa atual).
async function contarAcessosTrial(leadId) {
    const { data, error } = await window.supabase
        .rpc("contar_acessos_trial", { p_lead_id: leadId });

    if (error) throw new Error(`Erro ao contar acessos trial: ${error.message}`);
    return data || 0;
}

// Atualiza só os dados de contato do lead (não mexe em status/mensagem_respondida).
async function atualizarDadosLead(email, dadosLead) {
    const { error } = await window.supabase.rpc("lead_atualizar_dados", {
        p_email: email,
        p_nome: dadosLead.nome,
        p_telefone: dadosLead.telefone,
        p_perfil: dadosLead.perfil,
        p_mensagem: dadosLead.mensagem,
        p_interesses: dadosLead.interesses,
        p_preferencia_contato: dadosLead.preferencia_contato,
        p_origem: dadosLead.origem,
        p_cod_uf: dadosLead.cod_uf,
        p_cod_municipio: dadosLead.cod_municipio,
        p_nome_municipio: dadosLead.nome_municipio,
    });
    if (error) throw new Error(`Erro ao atualizar dados do lead: ${error.message}`);
}

// Atualiza só status/campos de resposta do lead.
async function atualizarStatusLead(email, { status, mensagemRespondida, mensagemRespondidaEm, mensagemResposta }) {
    const { error } = await window.supabase.rpc("lead_atualizar_status", {
        p_email: email,
        p_status: status,
        p_mensagem_respondida: mensagemRespondida,
        p_mensagem_respondida_em: mensagemRespondidaEm,
        p_mensagem_resposta: mensagemResposta,
    });
    if (error) throw new Error(`Erro ao atualizar status do lead: ${error.message}`);
}

// Atualiza dados de contato + status/resposta do lead em uma única chamada.
async function atualizarLeadCompleto(email, dadosLead, { status, mensagemOverride, mensagemRespondida, mensagemRespondidaEm, mensagemResposta }) {
    const { error } = await window.supabase.rpc("lead_atualizar", {
        p_email: email,
        p_nome: dadosLead.nome,
        p_telefone: dadosLead.telefone,
        p_perfil: dadosLead.perfil,
        p_mensagem: mensagemOverride !== undefined ? mensagemOverride : dadosLead.mensagem,
        p_interesses: dadosLead.interesses,
        p_preferencia_contato: dadosLead.preferencia_contato,
        p_origem: dadosLead.origem,
        p_cod_uf: dadosLead.cod_uf,
        p_cod_municipio: dadosLead.cod_municipio,
        p_nome_municipio: dadosLead.nome_municipio,
        p_status: status,
        p_mensagem_respondida: mensagemRespondida,
        p_mensagem_respondida_em: mensagemRespondidaEm,
        p_mensagem_resposta: mensagemResposta,
    });
    if (error) throw new Error(`Erro ao atualizar lead: ${error.message}`);
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

        // Busca lead existente por e-mail (RPC — ver nota acima).
        const leadIdExistente = await buscarLeadPorEmail(email);

        let novoLeadRef;
        let tipoMensagem = "primeiro_contato";
        let linkAcesso = null;
        let mensagemModal = null;
        let enviarMensagemAutomatica = true;
        // Valor final gravado no campo `mensagem` do lead — usado pra decidir se
        // conta no contador leads_mensagens. Conta independente de o texto ter
        // sido escrito pelo lead ou gerado pelo sistema (ex. no limite de trial).
        let mensagemParaContagem = mensagem || null;

        if (origem === "trial") {
            // ── Fluxo trial ────────────────────────────────────────────────
            if (!leadIdExistente) {
                // Lead novo: fluxo atual, sem mudança (INSERT continua liberado
                // para o cliente anônimo via policy existente).
                const { data, error } = await window.supabase
                    .from("leads")
                    .insert([{ ...dadosLead, status: "Novo", data_criacao: new Date().toISOString() }])
                    .select();
                if (error) throw error;
                novoLeadRef = { id: data[0].id };

                try {
                    linkAcesso = await gerarLinkAcessoTrial(novoLeadRef.id);
                    tipoMensagem = "acesso_trial";
                    await atualizarStatusLead(email, {
                        status: "Trial enviado",
                        mensagemRespondida: true,
                        mensagemRespondidaEm: new Date().toISOString(),
                        mensagemResposta: "Acesso de demonstração (72h) enviado automaticamente por e-mail.",
                    });
                } catch (err) {
                    console.error('[capturaLead] Falha ao gerar acesso trial, mantendo primeiro_contato:', err);
                }
            } else {
                // Lead existente: contar tentativas anteriores antes de decidir.
                novoLeadRef = { id: leadIdExistente };
                const contagemAnterior = await contarAcessosTrial(novoLeadRef.id);

                if (contagemAnterior < LIMITE_ACESSO_TRIAL) {
                    // Dentro do limite: sempre atualiza os dados de contato...
                    await atualizarDadosLead(email, dadosLead);

                    // ...e só marca "Trial enviado" se o link for gerado com sucesso.
                    try {
                        linkAcesso = await gerarLinkAcessoTrial(novoLeadRef.id);
                        // Lead recorrente: template de e-mail diferente do trial de
                        // primeira vez, com saudação de "que bom te ver de novo".
                        tipoMensagem = "acesso_trial_recorrente";
                        await atualizarStatusLead(email, {
                            status: "Trial enviado",
                            mensagemRespondida: true,
                            mensagemRespondidaEm: new Date().toISOString(),
                            mensagemResposta: "Acesso de demonstração (72h) enviado automaticamente por e-mail.",
                        });

                        mensagemModal = `Prontinho! Enviamos o link de acesso de demonstração para o seu e-mail. Esta foi a solicitação nº ${contagemAnterior + 1} de ${LIMITE_ACESSO_TRIAL} disponíveis.`;
                    } catch (err) {
                        console.error('[capturaLead] Falha ao gerar acesso trial, mantendo primeiro_contato:', err);
                    }
                } else {
                    // Acima do limite: não gera link, não envia e-mail. Uma única
                    // chamada cobre dados de contato + status + mensagem de contagem.
                    const tentativaAtual = contagemAnterior + 1;
                    const mensagemContagem = `${tentativaAtual}ª solicitação de acesso trial`;

                    await atualizarLeadCompleto(email, dadosLead, {
                        status: "Trial esgotado",
                        mensagemOverride: mensagemContagem,
                        mensagemRespondida: false,
                        mensagemRespondidaEm: null,
                        mensagemResposta: null,
                    });

                    tipoMensagem = "limite_acesso_trial";
                    enviarMensagemAutomatica = false; // sem e-mail nesse cenário
                    mensagemModal = "Você já utilizou todas as suas solicitações de acesso de demonstração. Nossa equipe vai entrar em contato em breve para apresentar o plano ideal para você.";
                    mensagemParaContagem = mensagemContagem;
                }
            }
        } else {
            // ── Fluxo contato_pelo_site (ou outra origem) ─────────────────
            if (!leadIdExistente) {
                const { data, error } = await window.supabase
                    .from("leads")
                    .insert([{ ...dadosLead, status: "Novo", data_criacao: new Date().toISOString() }])
                    .select();
                if (error) throw error;
                novoLeadRef = { id: data[0].id };
            } else {
                novoLeadRef = { id: leadIdExistente };
                await atualizarLeadCompleto(email, dadosLead, {
                    status: "Novo",
                    mensagemRespondida: false,
                    mensagemRespondidaEm: null,
                    mensagemResposta: null,
                });
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
            // Trial resolvido automaticamente (novo ou recorrente, dentro do
            // limite) não conta como pendência de "Novo". Todo o resto
            // (primeiro contato, contato pelo site reaberto, limite de trial
            // atingido) é pendência real que precisa de atenção do Admin.
            if (!["acesso_trial", "acesso_trial_recorrente"].includes(tipoMensagem)) {
              incrementos.leads_novos = firebase.firestore.FieldValue.increment(1);
            }
            // Conta como "mensagem" sempre que o campo mensagem do lead foi
            // preenchido, independente de o texto ter vindo do lead ou ter
            // sido gerado pelo sistema (ex. contagem de tentativas de trial).
            if (mensagemParaContagem) {
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