
let leadsFiltraveis = [];

async function listarLeadsComPreferencias() {
    const corpo = document.querySelector("#tabela-leads-envio tbody");
    corpo.innerHTML = "<tr><td colspan='6'>Carregando leads...</td></tr>";

    const snap = await db.collection("leads").get();
    let linhas = "";
    leadsFiltraveis = []; // 🔄 limpa antes de preencher

    for (const doc of snap.docs) {
        const lead = doc.data();
        const leadId = doc.id;

        // Filtra por status desejado
        if (!["Novo", "Em contato"].includes(lead.status)) continue;

        const interesses = Array.isArray(lead.interesses) ? lead.interesses.join(", ") : "-";

        // 🔄 adiciona ao array de leads filtráveis
        leadsFiltraveis.push({
            id: leadId,
            nome: lead.nome || "",
            email: lead.email || "",
            perfil: lead.perfil || "",
            interesses: Array.isArray(lead.interesses) ? lead.interesses : [],
            status: lead.status || ""
        });

        linhas += `
      <tr data-lead-id="${leadId}">
        <td><input type="checkbox" class="chk-lead-envio" checked /></td>
        <td>${lead.nome || ""}</td>
        <td>${lead.email || ""}</td>
        <td>${lead.perfil || ""}</td>
        <td>${interesses}</td>
        <td>${lead.status || ""}</td>
      </tr>
    `;
    }
    corpo.innerHTML = linhas || "<tr><td colspan='6'>Nenhum lead disponível.</td></tr>";
}


function renderizarTabelaLeads(lista) {
    const corpo = document.querySelector("#tabela-leads-envio tbody");
    corpo.innerHTML = "";

    if (!lista || lista.length === 0) {
        corpo.innerHTML = "<tr><td colspan='6'>Nenhum lead encontrado com os filtros aplicados.</td></tr>";
        return;
    }

    for (const lead of lista) {
        const interesses = Array.isArray(lead.interesses)
            ? lead.interesses.join(", ")
            : (lead.interesses || "-");

        const linha = document.createElement("tr");
        linha.dataset.leadId = lead.id;

        linha.innerHTML = `
      <td><input type="checkbox" class="chk-lead-envio" checked /></td>
      <td>${lead.nome || ""}</td>
      <td>${lead.email || ""}</td>
      <td>${lead.perfil || ""}</td>
      <td>${interesses}</td>
      <td>${lead.status || ""}</td>
    `;

        corpo.appendChild(linha);
    }
}

function filtrarLeadsEnvio() {
    const nomeFiltro = document.getElementById("filtro-nome").value.trim().toLowerCase();
    const emailFiltro = document.getElementById("filtro-email").value.trim().toLowerCase();
    const perfilFiltro = document.getElementById("filtro-perfil").value.trim().toLowerCase();
    const preferenciasFiltro = document.getElementById("filtro-tipo-news-envio").value.trim().toLowerCase();
    const statusFiltro = document.getElementById("filtro-status-lead").value.trim().toLowerCase();

    const filtrados = leadsFiltraveis.filter(lead => {
        const nome = (lead.nome || "").trim().toLowerCase();
        const email = (lead.email || "").trim().toLowerCase();
        const perfil = (lead.perfil || "").trim().toLowerCase();
        const status = (lead.status || "").trim().toLowerCase();

        const interesses = Array.isArray(lead.interesses)
            ? lead.interesses.map(i => i.trim().toLowerCase())
            : (lead.interesses || "").split(",").map(i => i.trim().toLowerCase());

        const nomeOk = !nomeFiltro || nome.includes(nomeFiltro);
        const emailOk = !emailFiltro || email.includes(emailFiltro);
        const perfilOk = !perfilFiltro || perfil === perfilFiltro;
        const preferenciasOk = !preferenciasFiltro || interesses.includes(preferenciasFiltro);
        const statusOk = !statusFiltro || status === statusFiltro;

        return nomeOk && emailOk && perfilOk && preferenciasOk && statusOk;
    });

    renderizarTabelaLeads(filtrados);
}


function abrirEnvioNewsletterLeads() {
    // Oculta todas as seções
    document.querySelectorAll("section").forEach(sec => sec.style.display = "none");

    // Exibe a seção principal de envio de newsletters
    document.getElementById("secao-envio-newsletters").style.display = "block";

    // Exibe a aba inicial
    mostrarAba("secao-newsletters-envio");
    document.querySelectorAll("#dados-newsletter-selecionada").forEach(div => {
        div.innerHTML = 'A newsletter selecionada aparecerá aqui ...';
    });
    // Carrega os dados
    //listarLeadsComPreferencias();
    listarNewslettersDisponiveis();
}

function mostrarDadosNewsletterSelecionada() {
    const html = newsletterSelecionada ? `
    <strong>📰 Newsletter Selecionada: </strong>
    <b>Título: </b> ${newsletterSelecionada.titulo || "-"}
    <b>Tipo: </b> ${newsletterSelecionada.tipo || "-"}
    <b>Edição: </b> ${newsletterSelecionada.edicao || "-"}
    <b>Data: </b> ${formatDateBR(newsletterSelecionada.data_publicacao?.toDate?.()) || "-"}
  ` : "";

    document.querySelectorAll("#dados-newsletter-selecionada").forEach(div => {
        div.innerHTML = html;
    });
}

async function visualizarNewsletterHtml(newsletterId) {
    const snap = await db.collection("newsletters").doc(newsletterId).get();
    if (!snap.exists) return mostrarMensagem("Newsletter não encontrada.");

    const dados = snap.data();

    // ✅ Determina o segmento com base no seletor
    let segmento = null;
    if (tipoDestinatarioSelecionado === "leads") segmento = "leads";
    if (tipoDestinatarioSelecionado === "usuarios") segmento = "assinantes";

    // ✅ HTML base da edição
    let htmlBase = dados.html_conteudo || "";

    // ✅ Blocos da edição
    const blocos = dados.blocos || [];

    let htmlBlocos = "";

    // ✅ Monta blocos filtrados pelo segmento
    blocos.forEach(b => {
        if (segmento && b.acesso !== "todos" && b.acesso !== segmento) return;
        htmlBlocos += b.html || "";
    });

    let htmlFinal = "";

    if (blocos.length === 0) {
        // ✅ Sem blocos → usa só o HTML base
        htmlFinal = htmlBase;
    } else {
        // ✅ Com blocos → insere no {{blocos}} ou no final
        if (htmlBase.includes("{{blocos}}")) {
            htmlFinal = htmlBase.replace("{{blocos}}", htmlBlocos);
        } else {
            htmlFinal = htmlBase + "\n" + htmlBlocos;
        }
    }

    // ✅ Aplica placeholders usando os dados da newsletter
    htmlFinal = aplicarPlaceholders(htmlFinal, dados);

    // ✅ Exibe no modal
    const modal = document.getElementById("modal-preview-html");
    const content = document.getElementById("preview-html-content");
    content.innerHTML = htmlFinal;
    modal.style.display = "flex";
}


function selecionarTodosEnvios(chk) {
    const todos = document.querySelectorAll(".chk-envio-final");
    todos.forEach(c => c.checked = chk.checked);
}

async function carregarRelatorioEnvios() {
    const emailFiltro = document.getElementById("filtro-relatorio-email").value.trim().toLowerCase();
    const corpo = document.querySelector("#tabela-relatorio-envios tbody");
    corpo.innerHTML = "<tr><td colspan='5'>Carregando envios...</td></tr>";

    const leadsSnap = await db.collection("leads").get();
    let linhas = "";

    for (const leadDoc of leadsSnap.docs) {
        const lead = leadDoc.data();
        const leadId = leadDoc.id;
        const email = (lead.email || "").toLowerCase();

        if (emailFiltro && !email.includes(emailFiltro)) continue;

        const enviosSnap = await db.collection("leads").doc(leadId).collection("envios").orderBy("data_envio", "desc").get();

        for (const envioDoc of enviosSnap.docs) {
            const envio = envioDoc.data();
            const nlSnap = await db.collection("newsletters").doc(envio.newsletter_id).get();
            const newsletter = nlSnap.exists ? nlSnap.data() : {};

            const data = envio.data_envio?.toDate?.() || envio.data_envio;
            const dataFormatada = data ? formatDateBR(data) : "-";

            linhas += `
        <tr>
          <td>${lead.nome || ""}</td>
          <td>${lead.email || ""}</td>
          <td>${newsletter.titulo || "(sem título)"}</td>
          <td>${dataFormatada}</td>
          <td>${envio.status || "enviado"}</td>
        </tr>
      `;
        }
    }

    corpo.innerHTML = linhas || "<tr><td colspan='5'>Nenhum envio encontrado.</td></tr>";
}

function mostrarAba(id) {
    preencherFiltroTipoNewsletter(document.getElementById("filtro-tipo-news-envio"));

    const todas = [
        "secao-newsletters-envio",
        "secao-envio-leads",
        "secao-envio-usuarios",
        "secao-preview-envio",
        "secao-lotes-envio",
        "secao-relatorio-envios",
        "secao-descadastramentos",
        "secao-todos-os-lotes",
        "secao-orientacoes"
    ];

    todas.forEach(sec => {
        const el = document.getElementById(sec);
        if (!el) {
            console.warn("⚠️ Seção não encontrada no DOM:", sec);
            return;
        }
        el.style.display = sec === id ? "block" : "none";
    });

    if (id === "secao-newsletters-envio") {
        document.querySelectorAll("#dados-newsletter-selecionada").forEach(div => {
            div.innerHTML = 'A newsletter selecionada aparecerá aqui ...';
        });
    } else {
        mostrarDadosNewsletterSelecionada();
    }
}


let newsletterSelecionada = null;

async function prepararEnvioParaLeads(newsletterId) {
    const snap = await db.collection("newsletters").doc(newsletterId).get();
    if (!snap.exists) {
        mostrarMensagem("Newsletter não encontrada.");
        return;
    }

    newsletterSelecionada = snap.data();
    newsletterSelecionada.id = newsletterId;

    // Esconde a tabela de destinatários
    const tabelaDest = document.querySelector("#tabela-preview-envio-destinatario");
    if (tabelaDest) {
        tabelaDest.style.display = "none";
    }

    // Mostra a tabela de prévia
    const tabelaPrevio = document.querySelector("#tabela-preview-envio");
    if (tabelaPrevio) {
        tabelaPrevio.style.display = "table";
    }

    await listarLeadsComPreferencias(); // carrega os dados
    await gerarPreviaEnvio();           // monta a prévia
}


async function prepararEnvioParaUsuarios(newsletterId) {
    const snap = await db.collection("newsletters").doc(newsletterId).get();
    if (!snap.exists) {
        mostrarMensagem("Newsletter não encontrada.");
        return;
    }

    newsletterSelecionada = snap.data();
    newsletterSelecionada.id = newsletterId;

    // Esconde a tabela de destinatários
    const tabelaDest = document.querySelector("#tabela-preview-envio-destinatario");
    if (tabelaDest) {
        tabelaDest.style.display = "none";
    }

    // Mostra a tabela de prévia
    const tabelaPrevio = document.querySelector("#tabela-preview-envio");
    if (tabelaPrevio) {
        tabelaPrevio.style.display = "table";
    }

    await listarUsuariosComAssinaturas(newsletterId);
    await gerarPreviaEnvioUsuarios(); // ✅ monta a prévia com base nos usuários
}

async function listarNewslettersDisponiveis() {
    const corpo = document.querySelector("#tabela-newsletters-envio tbody");
    corpo.innerHTML = "<tr><td colspan='5'>Carregando newsletters...</td></tr>";

    const snap = await db.collection("newsletters").orderBy("data_publicacao", "desc").get();
    let linhas = "";

    for (const doc of snap.docs) {
        const n = doc.data();
        const id = doc.id;
        const data = n.data_publicacao?.toDate?.() || n.data_publicacao;
        const dataFormatada = data ? formatDateBR(data) : "-";

        linhas += `
            <tr>
                <td>${n.titulo || "(sem título)"}</td>
                <td>${n.edicao || "-"}</td>
                <td>${n.tipo || "-"}</td>
                <td>${n.classificacao || "-"}</td>
                <td>${dataFormatada}</td>
                <td>
                <button onclick="visualizarNewsletterHtml('${id}')">👁️ Visualizar</button>
                <button class="btn-preparar-envio" onclick="prepararEnvioNewsletter('${id}')" disabled>
                    📬 Preparar envio
                </button>
                </td>
            </tr>
            `;
    }

    corpo.innerHTML = linhas || "<tr><td colspan='5'>Nenhuma newsletter encontrada.</td></tr>";
}

function prepararEnvioNewsletter(newsletterId) {
    if (!tipoDestinatarioSelecionado) {
        mostrarMensagem("Selecione primeiro se deseja enviar para Leads ou Usuários.");
        return;
    }
    configurarBotoesPrevia("envio");
    if (tipoDestinatarioSelecionado === "leads") {
        prepararEnvioParaLeads(newsletterId);
    } else if (tipoDestinatarioSelecionado === "usuarios") {
        prepararEnvioParaUsuarios(newsletterId);
    }
}

function selecionarTodosEnvioFinalLeads(chkMaster) {
    const todos = document.querySelectorAll("#tabela-preview-envio .chk-envio-final");
    for (const chk of todos) {
        chk.checked = chkMaster.checked;
    }
}

async function gerarPreviaEnvio() {
    const corpo = document.querySelector("#tabela-preview-envio tbody");
    const cabecalho = document.querySelector("#tabela-preview-envio thead tr");

    corpo.innerHTML = "";
    // Cabeçalho consistente com checkbox master
    cabecalho.innerHTML = `
        <th>
            <input type="checkbox" id="chk-master-preview-leads"
                title="Selecionar todos"
                onclick="selecionarTodosEnvioFinalLeads(this)" />
            Enviar?
        </th>
        <th>Nome</th>
        <th>Perfil</th>
        <th>Email</th>
        <th>Newsletter</th>
        <th>Interesses</th>
        <th class="col-compativel">Compatível</th>
        <th class="col-enviado">Newsletter enviada?</th>
        `;

    const linhasLeads = document.querySelectorAll("#tabela-leads-envio tbody tr");
    if (linhasLeads.length === 0) {
        mostrarMensagem("Nenhum lead disponível para gerar prévia.");
        return;
    }

    const enviadosMap = {};

    try {
        const promessasEnvio = Array.from(linhasLeads)
            .filter(linha => linha.querySelector("input[type='checkbox']")?.checked)
            .map(async linha => {
                const leadId = linha.dataset.leadId;
                try {
                    const snap = await db
                        .collection("leads")
                        .doc(leadId)
                        .collection("envios")
                        .where("newsletter_id", "==", newsletterSelecionada.id)
                        .limit(1)
                        .get();

                    if (!snap.empty) {
                        const envio = snap.docs[0].data();
                        enviadosMap[leadId] = envio.status === "enviado" ? "enviado" : "erro";
                    } else {
                        enviadosMap[leadId] = "nao-enviado";
                    }
                } catch (e) {
                    console.warn("Erro ao verificar envios para lead:", leadId, e);
                    enviadosMap[leadId] = false;
                }
            });

        await Promise.all(promessasEnvio);
    } catch (e) {
        console.warn("Erro ao carregar envios da newsletter:", e);
    }

    for (const linha of linhasLeads) {
        const checkbox = linha.querySelector("input[type='checkbox']");
        if (!checkbox || !checkbox.checked) continue;

        const leadId = linha.dataset.leadId;
        const nome = linha.cells[1].textContent.trim();
        const email = linha.cells[2].textContent.trim();
        const perfil = linha.cells[3].textContent.trim();   // 🔹 pega perfil da tabela original
        const interesses = linha.cells[4].textContent.trim();
        const status = linha.cells[5].textContent.trim();

        const tipoNewsletter = newsletterSelecionada?.tipo?.toLowerCase() || "";
        const interessesArray = interesses.toLowerCase().split(",").map(i => i.trim());
        const compativel = interessesArray.includes(tipoNewsletter);

        const statusEnvio = enviadosMap[leadId];
        const enviada = statusEnvio === "enviado";
        const erroEnvio = statusEnvio === "erro";
        const precisaEnviar = compativel && !enviada;

        const statusTexto = enviada
            ? "Sim"
            : erroEnvio
                ? "Erro ao enviar"
                : "Não";

        const tr = document.createElement("tr");
        tr.dataset.leadId = leadId;
        tr.dataset.newsletterId = newsletterSelecionada.id;
        tr.dataset.perfil = perfil;
        tr.dataset.compativel = compativel ? "true" : "false";
        tr.dataset.statusEnvio = statusEnvio;

        tr.innerHTML = `
            <td><input type="checkbox" class="chk-envio-final" ${precisaEnviar ? "checked" : ""} /></td>
            <td>${nome}</td>
            <td>${perfil}</td>
            <td>${email}</td>
            <td>${newsletterSelecionada.titulo || "(sem título)"}</td>
            <td>${interesses}</td>
            <td class="col-compativel">${compativel ? "✅" : "❌"}</td>
            <td class="col-enviado">${statusTexto}</td>
        `;

        if (enviada) {
            tr.classList.add("tr-enviado");
        }

        corpo.appendChild(tr);
    }

    if (corpo.children.length === 0) {
        corpo.innerHTML = "<tr><td colspan='8'>Nenhum lead selecionado para prévia.</td></tr>";
    }

    aplicarFiltroPreviewEnvio();

    document.querySelectorAll(".filtro-preview").forEach(chk => {
        if (!chk.dataset.listenerAdicionado) {
            chk.addEventListener("change", aplicarFiltroPreviewEnvio);
            chk.dataset.listenerAdicionado = "true";
        }
    });

    // 🔹 também registra listener para o select de perfil
    const perfilSelect = document.getElementById("filtro-perfil-lead");
    if (perfilSelect && !perfilSelect.dataset.listenerAdicionado) {
        perfilSelect.addEventListener("change", aplicarFiltroPreviewEnvio);
        perfilSelect.dataset.listenerAdicionado = "true";
    }

    mostrarAba("secao-preview-envio");
}


function aplicarFiltroPreviewEnvio() {
    const filtros = Array.from(document.querySelectorAll(".filtro-preview:checked")).map(f => f.value);
    const perfilSelecionado = document.getElementById("filtro-perfil-lead")?.value || "";
    const linhas = document.querySelectorAll("#tabela-preview-envio tbody tr");

    const aplicarFiltro = filtros.length > 0 || perfilSelecionado;

    let totalVisiveis = 0;
    let totalCompativeis = 0;
    let totalNaoEnviados = 0;
    let totalEnviados = 0;
    let totalNaoCompativeis = 0;
    let totalErroEnvio = 0;

    for (const linha of linhas) {
        const compativel = linha.dataset.compativel === "true";
        const statusEnvio = linha.dataset.statusEnvio; // "enviado", "nao-enviado", "erro"
        const perfilLead = linha.dataset.perfil || "";

        const enviada = statusEnvio === "enviado";
        const erroEnvio = statusEnvio === "erro";
        const naoEnviado = statusEnvio === "nao-enviado";

        let mostrar = true;

        if (aplicarFiltro) {
            if (filtros.includes("compativeis") && !compativel) mostrar = false;
            if (filtros.includes("nao-compativeis") && compativel) mostrar = false;
            if (filtros.includes("enviados") && !enviada) mostrar = false;
            if (filtros.includes("nao-enviados") && !naoEnviado) mostrar = false;
            if (filtros.includes("erro-envio") && !erroEnvio) mostrar = false;

            if (perfilSelecionado && perfilLead !== perfilSelecionado) mostrar = false;
        }

        linha.style.display = mostrar ? "table-row" : "none";

        if (compativel) totalCompativeis++;
        else totalNaoCompativeis++;

        if (enviada) totalEnviados++;
        if (naoEnviado) totalNaoEnviados++;
        if (erroEnvio) totalErroEnvio++;
        if (mostrar) totalVisiveis++;
    }

    document.getElementById("contador-compativeis").textContent = totalCompativeis;
    document.getElementById("contador-nao-enviados").textContent = totalNaoEnviados;
    document.getElementById("contador-enviados").textContent = totalEnviados;
    document.getElementById("contador-nao-compativeis").textContent = totalNaoCompativeis;
    document.getElementById("contador-erro-envio").textContent = totalErroEnvio;
    document.getElementById("contador-visiveis").textContent = totalVisiveis;
}


function limparFiltrosPreview() {
    document.querySelectorAll(".filtro-preview").forEach(chk => chk.checked = false);
    const perfilSelect = document.getElementById("filtro-perfil-lead");
    if (perfilSelect) perfilSelect.value = ""; // volta para "Todos"
    aplicarFiltroPreviewEnvio();
}


function selecionarTodosLeads(chkMaster) {
    const todos = document.querySelectorAll(".chk-lead-envio");
    for (const chk of todos) {
        chk.checked = chkMaster.checked;
    }
}

function exportarCSVPrevia() {
    const linhas = document.querySelectorAll("#tabela-preview-envio tbody tr");
    const visiveis = Array.from(linhas).filter(l => l.style.display !== "none");

    if (visiveis.length === 0) {
        mostrarMensagem("Nenhum dado visível para exportar.");
        return;
    }

    const csv = [];
    csv.push("Nome;Email;Newsletter;Interesses;Compatível;Newsletter enviada?");

    for (const linha of visiveis) {
        const nome = linha.cells[1]?.textContent.trim();
        const email = linha.cells[2]?.textContent.trim();
        const newsletter = linha.cells[3]?.textContent.trim();
        const interesses = linha.cells[4]?.textContent.trim();
        const compativel = linha.cells[5]?.textContent.trim();
        const status = linha.cells[6]?.textContent.trim();

        csv.push(`${nome};${email};${newsletter};${interesses};${compativel};${status}`);
    }

    const blob = new Blob([csv.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "previa_envio.csv";
    link.click();
}


async function listarDescadastramentos() {

    const corpo = document.querySelector("#tabela-descadastramentos tbody");
    corpo.innerHTML = "<tr><td colspan='5'>Carregando...</td></tr>";

    const leadsSnap = await db.collection("leads").where("status", "==", "Descartado").get();
    let linhas = "";

    for (const leadDoc of leadsSnap.docs) {
        const lead = leadDoc.data();
        const leadId = leadDoc.id;

        if (!leadId) {
            console.warn("Lead sem ID:", lead);
            continue;
        }

        const descSnap = await db.collection("leads").doc(leadId).collection("descadastramentos").orderBy("data", "desc").get();

        if (descSnap.empty) {
            // Lead descartado manualmente, sem registro
            linhas += `
        <tr>
          <td>${lead.nome || ""}</td>
          <td>${lead.email || ""}</td>
          <td>-</td>
          <td>-</td>
          <td><em>Descartado manualmente (sem motivo registrado)</em></td>
        </tr>
      `;
        } else {
            for (const descDoc of descSnap.docs) {
                const desc = descDoc.data();

                let newsletter = {};
                if (desc.newsletter_id) {
                    try {
                        const nlSnap = await db.collection("newsletters").doc(desc.newsletter_id).get();
                        newsletter = nlSnap.exists ? nlSnap.data() : {};
                    } catch (e) {
                        console.warn("Erro ao buscar newsletter:", desc.newsletter_id, e);
                    }
                }

                const data = desc.data?.toDate?.() || desc.data;
                const dataFormatada = data ? formatDateBR(data) : "-";

                linhas += `
                    <tr>
                    <td>${lead.nome || ""}</td>
                    <td>${lead.email || ""}</td>
                    <td>${newsletter.titulo || "(Sem Newsletter)"}</td>
                    <td>${dataFormatada}</td>
                    <td>${desc.motivo || "-"}</td>
                    </tr>
                `;
            }

        }
    }

    corpo.innerHTML = linhas || "<tr><td colspan='5'>Nenhum descadastramento encontrado.</td></tr>";
}


function abrirAbaDescadastramentos() {
    mostrarAba("secao-descadastramentos");
    listarDescadastramentos();
}

let tipoDestinatarioSelecionado = null;

function alterarTipoDestinatario(tipo) {
    const botoes = document.querySelectorAll(".btn-preparar-envio");

    if (!tipo) {
        tipoDestinatarioSelecionado = null;
        botoes.forEach(btn => btn.disabled = true); // desabilita todos
        return;
    }

    tipoDestinatarioSelecionado = tipo;
    botoes.forEach(btn => btn.disabled = false); // habilita todos
}



let usuariosFiltraveis = []; // array global para manipulação

// Listar usuários com suas assinaturas
async function listarUsuariosComAssinaturas(newsletterId) {
    const corpo = document.querySelector("#tabela-usuarios-envio tbody");
    corpo.innerHTML = "<tr><td colspan='5'>Carregando usuários...</td></tr>";

    if (!newsletterSelecionada) {
        corpo.innerHTML = "<tr><td colspan='5'>Selecione primeiro uma newsletter.</td></tr>";
        return;
    }

    // 🔹 Busca apenas assinaturas ativas da newsletter selecionada
    const snapAssinaturas = await db.collectionGroup("assinaturas")
        .where("status", "==", "ativo")
        .where("tipo_newsletter", "==", newsletterSelecionada.tipo)
        .get();

    usuariosFiltraveis = [];
    let linhas = "";

    for (const doc of snapAssinaturas.docs) {
        const assinatura = doc.data();
        const assinaturaId = doc.id;
        const usuarioId = doc.ref.parent.parent.id;

        const usuarioSnap = await db.collection("usuarios").doc(usuarioId).get();
        if (!usuarioSnap.exists) continue;

        const usuario = usuarioSnap.data();

        // 🔹 Busca todos os pagamentos do usuário
        const pagamentosSnap = await db.collection("usuarios")
            .doc(usuarioId)
            .collection("pagamentos")
            .get();

        let emDia = true;
        pagamentosSnap.forEach(p => {
            const dados = p.data();
            const venc = dados?.data_vencimento?.toMillis?.() ??
                (typeof dados?.data_vencimento === "number" ? dados.data_vencimento : NaN);
            if (dados?.status === "pendente" && Number.isFinite(venc) && venc < Date.now()) {
                emDia = false;
            }
        });

        usuariosFiltraveis.push({
            id: usuarioId,
            nome: usuario.nome || "",
            perfil: usuario.tipo_perfil || "",
            email: usuario.email || "",
            assinaturaId,
            assinatura_status: assinatura.status,
            emDia
        });

        linhas += `
                <tr data-usuario-id="${usuarioId}" 
                    data-assinatura-id="${assinaturaId}" 
                    data-perfil="${usuario.tipo_perfil || ""}"
                    data-em-dia="${emDia ? "true" : "false"}"
                    class="${emDia ? "" : "linha-vencida"}">
                    <td><input type="checkbox" class="chk-usuario-envio" checked /></td>
                    <td>${usuario.nome || ""}</td>
                    <td>${usuario.tipo_perfil || ""}</td>
                    <td>${usuario.email || ""}</td>
                    <td>${assinatura.status}</td>
                    <td>${emDia ? "✅ Sim" : "❌ Não"}</td>
                </tr>
                `;
    }

    if (usuariosFiltraveis.length === 0) {
        corpo.innerHTML = `<tr><td colspan='5'>⚠️ Nenhum usuário possui assinatura ativa para a newsletter selecionada.</td></tr>`;
        mostrarMensagem("Nenhum usuário com assinatura ativa foi encontrado para esta newsletter.");
    } else {
        corpo.innerHTML = linhas;
    }
}



// Filtro de usuários
function filtrarUsuariosEnvio() {
    const nomeFiltro = document.getElementById("filtro-usuario-nome").value.toLowerCase();
    const emailFiltro = document.getElementById("filtro-usuario-email").value.toLowerCase();
    const assinaturaFiltro = document.getElementById("filtro-assinatura").value;

    const corpo = document.querySelector("#tabela-usuarios-envio tbody");
    let linhas = "";

    for (const usuario of usuariosFiltraveis) {
        const matchNome = usuario.nome.toLowerCase().includes(nomeFiltro);
        const matchEmail = usuario.email.toLowerCase().includes(emailFiltro);
        const matchAssinatura = !assinaturaFiltro || usuario.assinatura_status === assinaturaFiltro;

        if (matchNome && matchEmail && matchAssinatura) {
            linhas += `
          <tr data-usuario-id="${usuario.id}" data-perfil="${usuario.perfil || ""}">
            <td><input type="checkbox" class="chk-usuario-envio" checked /></td>
            <td>${usuario.nome}</td>
            <td>${usuario.perfil || ""}</td>
            <td>${usuario.email}</td>
            <td>${usuario.assinatura_status}</td>
          </tr>
        `;
        }
    }

    corpo.innerHTML = linhas || "<tr><td colspan='5'>Nenhum usuário encontrado com os filtros.</td></tr>";
}

function selecionarTodosEnvioFinal(chkMaster) {
    const todos = document.querySelectorAll("#tabela-preview-envio .chk-envio-final");
    for (const chk of todos) {
        chk.checked = chkMaster.checked;
    }
}


// Preparar prévia de envio para usuários
async function gerarPreviaEnvioUsuarios() {
    if (!newsletterSelecionada) {
        mostrarMensagem("Selecione uma newsletter primeiro.");
        return;
    }

    const corpo = document.querySelector("#tabela-preview-envio tbody");
    const cabecalho = document.querySelector("#tabela-preview-envio thead tr");

    // Cabeçalho consistente
    // Cabeçalho consistente com checkbox master
    cabecalho.innerHTML = `
        <th>
            <input type="checkbox" id="chk-master-preview"
                title="Selecionar todos"
                onclick="selecionarTodosEnvioFinal(this)" />
            Enviar?
        </th>
        <th>Nome</th>
        <th>Perfil</th>
        <th>Email</th>
        <th>Newsletter</th>
        <th>Interesses</th>
        <th class="col-pagamento">Em dia?</th>
        <th class="col-enviado">Newsletter enviada?</th>
        `;

    corpo.innerHTML = "<tr><td colspan='8'>Gerando prévia...</td></tr>";

    // Coleta os usuários selecionados na tabela de usuários
    const selecionados = Array.from(document.querySelectorAll(".chk-usuario-envio:checked"))
        .map(chk => {
            const tr = chk.closest("tr");
            return {
                usuarioId: tr.dataset.usuarioId,
                assinaturaId: tr.dataset.assinaturaId,
                nome: tr.children[1]?.innerText.trim() || "",
                perfil: tr.dataset.perfil || tr.children[2]?.innerText.trim() || "",
                email: tr.children[3]?.innerText.trim() || "",
                emDia: tr.dataset.emDia === "true"
            };
        });

    if (selecionados.length === 0) {
        corpo.innerHTML = "<tr><td colspan='8'>Nenhum usuário selecionado para prévia.</td></tr>";
        aplicarFiltroPreviewEnvio();
        return;
    }

    // Verifica status de envio para cada usuário/assinatura em paralelo
    const enviadosMap = {};
    await Promise.all(selecionados.map(async (u) => {
        try {
            const snapEnvio = await db
                .collection("usuarios")
                .doc(u.usuarioId)
                .collection("assinaturas")
                .doc(u.assinaturaId)
                .collection("envios")
                .where("newsletter_id", "==", newsletterSelecionada.id)
                .limit(1)
                .get();

            if (!snapEnvio.empty) {
                const status = snapEnvio.docs[0].data()?.status;
                enviadosMap[`${u.usuarioId}|${u.assinaturaId}`] = status === "enviado" ? "enviado" : "erro";
            } else {
                enviadosMap[`${u.usuarioId}|${u.assinaturaId}`] = "nao-enviado";
            }
        } catch (e) {
            console.warn("Erro ao consultar envios de usuário:", u.usuarioId, e);
            enviadosMap[`${u.usuarioId}|${u.assinaturaId}`] = "erro";
        }
    }));

    const tipoNewsletter = (newsletterSelecionada?.tipo || "").toLowerCase();
    const tituloNewsletter = newsletterSelecionada?.titulo || "(sem título)";

    const frag = document.createDocumentFragment();

    for (const u of selecionados) {


        const key = `${u.usuarioId}|${u.assinaturaId}`;
        const statusEnvio = enviadosMap[key];
        const enviada = statusEnvio === "enviado";
        const erroEnvio = statusEnvio === "erro";
        const precisaEnviar = u.emDia && !enviada;
        const statusTexto = enviada ? "Sim" : (erroEnvio ? "Erro ao enviar" : "Não");

        const tr = document.createElement("tr");
        tr.dataset.usuarioId = u.usuarioId;
        tr.dataset.assinaturaId = u.assinaturaId;
        tr.dataset.newsletterId = newsletterSelecionada.id;
        tr.dataset.perfil = u.perfil || "";

        tr.dataset.statusEnvio = statusEnvio;

        tr.innerHTML = `
            <td><input type="checkbox" class="chk-envio-final" ${precisaEnviar ? "checked" : ""} /></td>
            <td>${u.nome}</td>
            <td>${u.perfil || ""}</td>
            <td>${u.email}</td>
            <td>${tituloNewsletter}</td>
            <td>-</td>
            <td class="col-pagamento">${u.emDia ? "✅ Sim" : "❌ Não"}</td>
            <td class="col-enviado">${statusTexto}</td>
        `;

        if (enviada) tr.classList.add("tr-enviado");
        if (erroEnvio) tr.classList.add("tr-erro");

        frag.appendChild(tr);
    }

    corpo.innerHTML = "";
    corpo.appendChild(frag);

    aplicarFiltroPreviewEnvio();

    document.querySelectorAll(".filtro-preview").forEach(chk => {
        if (!chk.dataset.listenerAdicionado) {
            chk.addEventListener("change", aplicarFiltroPreviewEnvio);
            chk.dataset.listenerAdicionado = "true";
        }
    });

    const perfilSelect = document.getElementById("filtro-perfil-lead");
    if (perfilSelect && !perfilSelect.dataset.listenerAdicionado) {
        perfilSelect.addEventListener("change", aplicarFiltroPreviewEnvio);
        perfilSelect.dataset.listenerAdicionado = "true";
    }

    mostrarAba("secao-preview-envio");
}


async function gerarPreviaEnvioLeads() {
    if (!newsletterSelecionada) {
        mostrarMensagem("Selecione uma newsletter primeiro.");
        return;
    }

    const corpo = document.querySelector("#tabela-preview-envio tbody");
    corpo.innerHTML = "<tr><td colspan='7'>Gerando prévia...</td></tr>";

    let linhas = "";

    // 🔑 Seleciona apenas os leads marcados
    const selecionados = Array.from(document.querySelectorAll(".chk-lead-envio:checked"))
        .map(chk => {
            const tr = chk.closest("tr");
            return {
                leadId: tr.dataset.leadId,
                nome: tr.children[1].innerText,
                email: tr.children[2].innerText,
                interesses: tr.children[4].innerText.split(",").map(i => i.trim()).filter(i => i)
            };
        });

    // 🔑 Monta prévia apenas com os selecionados
    for (const lead of selecionados) {
        const compativel = verificarCompatibilidadeNewsletter(lead, newsletterSelecionada);

        linhas += `
      <tr data-lead-id="${lead.leadId}" data-newsletter-id="${newsletterSelecionada.id}">
        <td><input type="checkbox" class="chk-envio-final" checked /></td>
        <td>${lead.nome}</td>
        <td>${lead.email}</td>
        <td>${newsletterSelecionada.titulo}</td>
        <td>${lead.interesses.join(", ")}</td>
        <td>${compativel ? "✅" : "❌"}</td>
        <td>Não</td>
      </tr>
    `;
    }

    corpo.innerHTML = linhas || "<tr><td colspan='7'>Nenhum lead selecionado para prévia.</td></tr>";
    mostrarAba("secao-preview-envio");
}

function voltarParaEnvio() {

    if (tipoDestinatarioSelecionado === "leads") {
        mostrarAba("secao-envio-leads");
    } else if (tipoDestinatarioSelecionado === "usuarios") {
        mostrarAba("secao-envio-usuarios");
    } else {
        // fallback: volta para lista de newsletters
        mostrarAba("secao-newsletters-envio");
    }
}

function verificarCompatibilidadeNewsletter(destinatario, newsletter) {
    // Caso seja Lead
    if (destinatario.id && destinatario.status !== undefined && !destinatario.assinatura_status) {
        // Leads só recebem newsletters básicas
        if (newsletter.classificacao === "premium") return false;
        if (destinatario.receber_newsletter === false) return false;
        return true;
    }

    // Caso seja Usuário (com assinatura)
    if (destinatario.assinatura_status) {
        // Newsletter premium só para assinaturas com status "ativo"
        if (newsletter.classificacao === "premium" && destinatario.assinatura_status !== "ativo") return false;
        if (["cancelada", "expirada"].includes(destinatario.assinatura_status)) return false;
        return true;
    }

    return false;
}

// Selecionar todos os usuários
function selecionarTodosUsuarios(chkMaster) {
    const todos = document.querySelectorAll(".chk-usuario-envio");
    for (const chk of todos) {
        chk.checked = chkMaster.checked;
    }
}

// Configuração do provedor de envio
// Troque para "ses" quando migrar para Amazon SES
const EMAIL_PROVIDER = "vercel";

// Função utilitária para pausar (controla taxa de envio)
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Função genérica para processar tarefas em paralelo com limite de workers
 * @param {Array<Function>} tarefas - lista de funções async que fazem o envio
 * @param {number} limiteParalelo - quantos envios simultâneos
 * @param {number} delayMs - pausa entre cada envio (rate limiting)
 */
async function processarEmLotes(tarefas, limiteParalelo = 5, delayMs = 600) {
    const resultados = [];
    const fila = [...tarefas]; // copia da lista de tarefas

    // Worker: pega uma tarefa da fila, executa, pausa, repete
    async function worker() {
        while (fila.length) {
            const tarefa = fila.shift();
            try {
                const resultado = await tarefa();
                resultados.push(resultado);
            } catch (err) {
                resultados.push({ erro: err });
            }
            // pausa entre envios para respeitar limite de taxa
            await sleep(delayMs);
        }
    }

    // Cria N workers em paralelo
    await Promise.all(Array.from({ length: limiteParalelo }, worker));
    return resultados;
}

function abrirAbaOrientacoes() {
    mostrarAba("secao-orientacoes");
}

async function confirmarPrevia(newsletterId, filtros) {
    const tamanhoLote = parseInt(document.getElementById("tamanho-lote").value) || 100;

    const linhasSelecionadas = Array.from(document.querySelectorAll(".chk-envio-final:checked"))
        .map(chk => chk.closest("tr"));

    const destinatarios = linhasSelecionadas.map(tr => {
        const nome = tr.children[1].innerText;
        const email = tr.children[3].innerText;
        const tipo = tipoDestinatarioSelecionado;

        return {
            id: tipo === "leads" ? tr.dataset.leadId : tr.dataset.usuarioId,
            nome,
            email,
            tipo,
            ...(tipo === "usuarios" && { assinaturaId: tr.dataset.assinaturaId })
        };
    });

    if (destinatarios.length === 0) {
        mostrarMensagem("Nenhum destinatário selecionado para envio.");
        return;
    }

    // Criação da campanha
    const envioRef = db.collection("newsletters").doc(newsletterId).collection("envios").doc();
    const envioId = envioRef.id;

    await envioRef.set({
        status: "pendente",
        tipo: filtros.tipo,
        total_destinatarios: destinatarios.length,
        total_lotes: Math.ceil(destinatarios.length / tamanhoLote),
        enviados: 0,
        erros: 0,
        abertos: 0,
        //data_envio: firebase.firestore.Timestamp.now(),
        tamanho_lote: destinatarios.length
    });

    // 🔎 Busca o último número de lote global
    const ultimoLoteSnap = await db.collection("lotes_gerais")
        .orderBy("numero_lote", "desc")
        .limit(1)
        .get();

    let ultimoNumeroGlobal = 0;
    if (!ultimoLoteSnap.empty) {
        ultimoNumeroGlobal = ultimoLoteSnap.docs[0].data().numero_lote || 0;
    }

    // Criação dos lotes sequenciais
    let numero = ultimoNumeroGlobal + 1;
    for (let i = 0; i < destinatarios.length; i += tamanhoLote) {
        const chunk = destinatarios.slice(i, i + tamanhoLote);

        // Cria o lote dentro do envio
        const loteRef = await envioRef.collection("lotes").add({
            numero_lote: numero,
            status: "pendente",
            quantidade: chunk.length,
            enviados: 0,
            erros: 0,
            abertos: 0,
            destinatarios: chunk
        });

        // Cria o índice global em lotes_gerais
        await db.collection("lotes_gerais").add({
            newsletterId: newsletterSelecionada.id,
            envioId: envioId,
            loteId: loteRef.id,
            titulo: newsletterSelecionada.titulo,
            edicao: newsletterSelecionada.edicao || newsletterSelecionada.id,
            data_geracao: firebase.firestore.Timestamp.now(),
            numero_lote: numero,
            tipo: filtros.tipo,
            status: "pendente",
            quantidade: chunk.length,
            enviados: 0,
            erros: 0,
            abertos: 0
        });

        numero++;
    }

    mostrarMensagem(`Campanha criada com ${destinatarios.length} destinatários em ${numero - ultimoNumeroGlobal - 1} novos lotes.`);
    await listarLotesEnvio(newsletterId, envioId);

    mostrarAba("secao-lotes-envio");
}


async function listarLotesEnvio(newsletterId, envioId) {
    envioSelecionadoId = envioId;
    const corpo = document.getElementById("corpo-lotes-envio");
    corpo.innerHTML = "<tr><td colspan='10'>Carregando lotes...</td></tr>";

    // Filtros de data (se existirem na tela)
    const filtroDataTipo = document.getElementById("filtro-data-tipo")?.value || "envio";
    const filtroDataInicio = document.getElementById("filtro-data-inicio")?.value;
    const filtroDataFim = document.getElementById("filtro-data-fim")?.value;
    const campoData = filtroDataTipo === "geracao" ? "data_geracao" : "data_envio";

    let query = db.collection("newsletters")
        .doc(newsletterId)
        .collection("envios")
        .doc(envioId)
        .collection("lotes")
        .orderBy("numero_lote");

    if (filtroDataInicio) {
        const [ano, mes, dia] = filtroDataInicio.split("-");
        const inicio = new Date(ano, mes - 1, dia, 0, 0, 0, 0);
        query = query.where(campoData, ">=", inicio);
    }
    if (filtroDataFim) {
        const [ano, mes, dia] = filtroDataFim.split("-");
        const fim = new Date(ano, mes - 1, dia, 23, 59, 59, 999);
        query = query.where(campoData, "<=", fim);
    }

    const snap = await query.get();

    // Busca logs de envio para identificar reenvios
    const todosLogsSnap = await db.collectionGroup("envios_log").get();
    const mapaReenvios = {};
    const mapaUltimoEnvio = {};

    todosLogsSnap.forEach(doc => {
        const partes = doc.ref.path.split("/");
        const loteId = partes[5];
        const log = doc.data();
        const data = log.data_envio.toDate();

        if (!mapaReenvios[loteId]) {
            mapaReenvios[loteId] = [];
            mapaUltimoEnvio[loteId] = data;
        } else {
            mapaReenvios[loteId].push(log);
            if (data > mapaUltimoEnvio[loteId]) mapaUltimoEnvio[loteId] = data;
        }
    });

    let linhas = "";

    for (const doc of snap.docs) {
        const lote = doc.data();
        const loteId = doc.id;
        const reenvios = mapaReenvios[loteId] || [];

        const dataGeracao = lote.data_geracao?.toDate ? lote.data_geracao.toDate() : null;
        const dataEnvio = lote.data_envio?.toDate ? lote.data_envio.toDate() : null;
        const ultimoEnvio = mapaUltimoEnvio[loteId] || dataEnvio || dataGeracao;

        const progresso = lote.quantidade > 0 ? Math.round((lote.enviados / lote.quantidade) * 100) : 0;
        const destaqueReenvio = reenvios.length > 1 ? "style='background-color:#fff3cd'" : "";

        linhas += `
      <tr ${destaqueReenvio}>
        <td>${lote.numero_lote}</td>
        <td>${lote.status}</td>
        <td>${lote.quantidade}</td>
        <td>${lote.enviados}</td>
        <td>${lote.erros}</td>
        <td>${lote.abertos}</td>
        <td>${dataGeracao ? dataGeracao.toLocaleString() : "-"}</td>
        <td>${dataEnvio ? dataEnvio.toLocaleString() : "-"}</td>
        <td>${ultimoEnvio ? ultimoEnvio.toLocaleString() : "-"}</td>
        <td>
            <button onclick="verDestinatariosLoteUnificado('${loteId}')">👥 Ver Destinatários</button>
            <button onclick="enviarLoteIndividual('${newsletterId}', '${envioId}', '${loteId}')">📤 Enviar Newsletter</button>
            ${reenvios.length > 0
                ? `<button onclick="verHistoricoEnvios('${newsletterId}', '${envioId}', '${loteId}')">📜 Ver Reenvios (${reenvios.length})</button>`
                : `<button disabled title='Sem reenvios registrados'>📜 Ver Reenvios</button>`}
        </td>
      </tr>
    `;
    }

    corpo.innerHTML = linhas || "<tr><td colspan='10'>Nenhum lote encontrado.</td></tr>";
}


async function enviarLoteIndividual(newsletterId, envioId, loteId) {
    try {
        const loteRef = db.collection("newsletters")
            .doc(newsletterId)
            .collection("envios")
            .doc(envioId)
            .collection("lotes")
            .doc(loteId);

        const loteSnap = await loteRef.get();
        if (!loteSnap.exists) {
            mostrarMensagem("❌ Lote não encontrado.");
            return;
        }

        const lote = loteSnap.data();
        const numeroLote = lote.numero_lote || loteId;

        const newsletterSnap = await db.collection("newsletters").doc(newsletterId).get();
        const newsletter = newsletterSnap.exists ? newsletterSnap.data() : {};
        const titulo = newsletter.titulo || "Sem título";
        const edicao = newsletter.edicao || newsletterId;

        const jaEnviado = lote.enviados && lote.enviados >= lote.quantidade;
        const confirmar = confirm(
            jaEnviado
                ? `⚠️ O lote nº ${numeroLote} da newsletter "${titulo}" (${edicao}) já foi enviado.\nDeseja enviar novamente?`
                : `📤 Deseja enviar o lote nº ${numeroLote} da newsletter "${titulo}" (${edicao})?`
        );
        if (!confirmar) return;

        const destinatarios = lote.destinatarios || [];
        let enviados = 0;

        for (const dest of destinatarios) {
            const tipo = dest.tipo || (dest.assinaturaId ? "usuarios" : "leads");

            // 🔹 Identificador consistente para logs
            const emailDest = (dest.email || "").trim();
            const idDest = dest.id || "-";
            const identificador = emailDest || `ID:${idDest}`;

            // Determina segmento
            const segmento = tipo === "leads" ? "leads" : "assinantes";

            // Monta HTML final com blocos + segmentação + placeholders
            const htmlMontado = montarHtmlNewsletterParaEnvio(
                newsletter,
                {
                    nome: dest.nome,
                    email: emailDest,
                    edicao: newsletter.edicao,
                    tipo: newsletter.tipo,
                    titulo: newsletter.titulo,
                    data_publicacao: newsletter.data_publicacao,
                    newsletterId
                },
                segmento
            );


            // Gera token de acesso e data de expiração
            const token = gerarTokenAcesso();
            const expiraEm = firebase.firestore.Timestamp.fromDate(
                new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // expira em 30 dias
            );

            // Aplica rastreamento
            const htmlFinal = aplicarRastreamento(
                htmlMontado,
                envioId,
                idDest,
                newsletterId,
                assinaturaId = dest.assinaturaId || null,
                token
            );


            try {

                // 🔹 Endpoint SES no backend
                const response = await fetch("https://api.radarsiope.com.br/api/sendViaSES", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        nome: dest.nome,
                        email: emailDest,
                        mensagemHtml: htmlFinal,
                        assunto: newsletter.titulo || "Newsletter Radar SIOPE"
                    })
                });

                const text = await response.text();

                let result;
                try {
                    result = JSON.parse(text);
                } catch (e) {
                    console.error("Falha ao converter resposta em JSON:", e);
                    throw new Error("Resposta inválida do backend: " + text);
                }

                if (!response.ok || !result.ok) {
                    throw new Error(result.error || "Falha no envio via SES");
                }

                enviados++;

                // Registro do envio

                if (tipo === "leads") {
                    await db.collection("leads").doc(idDest).collection("envios").add({
                        newsletter_id: newsletterId,
                        data_envio: firebase.firestore.Timestamp.now(),
                        status: "enviado",
                        destinatarioId: idDest,
                        token_acesso: token,
                        expira_em: expiraEm,
                        ultimo_acesso: null,
                        acessos_totais: 0
                    });
                } else {
                    await db.collection("usuarios").doc(idDest)
                        .collection("assinaturas").doc(dest.assinaturaId)
                        .collection("envios").add({
                            newsletter_id: newsletterId,
                            data_envio: firebase.firestore.Timestamp.now(),
                            status: "enviado",
                            destinatarioId: idDest,
                            assinaturaId: dest.assinaturaId, // 🔥 incluímos para facilitar validação
                            token_acesso: token,
                            expira_em: expiraEm,
                            ultimo_acesso: null,
                            acessos_totais: 0
                        });
                }
            } catch (err) {
                console.error(`❌ Falha ao enviar para ${identificador}`, err);

                const registroErro = {
                    newsletter_id: newsletterId,
                    data_envio: firebase.firestore.Timestamp.now(),
                    status: "erro",
                    erro: err.message || "Falha desconhecida"
                };

                if (tipo === "leads") {
                    await db.collection("leads").doc(idDest).collection("envios").add(registroErro);
                } else {
                    await db.collection("usuarios").doc(idDest)
                        .collection("assinaturas").doc(dest.assinaturaId)
                        .collection("envios").add(registroErro);
                }
                continue;
            }
        }

        const usuarioLogado = JSON.parse(localStorage.getItem("usuarioLogado"));
        const feitoPor = usuarioLogado?.nome || usuarioLogado?.email || "Desconhecido";

        await loteRef.collection("envios_log").add({
            data_envio: firebase.firestore.Timestamp.now(),
            quantidade: destinatarios.length,
            enviados,
            origem: "manual",
            operador: feitoPor,
            status: enviados === destinatarios.length ? "completo" : "parcial"
        });

        await loteRef.update({
            enviados,
            status: enviados === destinatarios.length ? "completo" : "parcial",
            data_envio: firebase.firestore.Timestamp.now()
        });

        const loteGeralSnap = await db.collection("lotes_gerais")
            .where("loteId", "==", loteId)
            .where("envioId", "==", envioId)
            .limit(1)
            .get();

        if (!loteGeralSnap.empty) {
            const loteGeralRef = loteGeralSnap.docs[0].ref;
            await loteGeralRef.update({
                enviados,
                status: enviados === destinatarios.length ? "completo" : "parcial",
                data_envio: firebase.firestore.Timestamp.now()
            });
        }
        // 🔥 Marca a newsletter como enviada/publicada
        await db.collection("newsletters").doc(newsletterId).update({
            enviada: true,
            data_publicacao: firebase.firestore.Timestamp.now()
        });

        mostrarMensagem(`✅ Lote nº ${numeroLote} enviado com sucesso!`);
    } catch (err) {
        console.error("Erro ao enviar lote:", err);
        mostrarMensagem("❌ Erro ao enviar lote.");
    }
}

function montarHtmlNewsletterParaEnvio(newsletter, dados, segmento = null) {
    // ✅ HTML base da edição
    let htmlBase = newsletter.html_conteudo || "";
    const blocos = newsletter.blocos || [];

    let htmlBlocos = "";

    // ✅ Monta blocos filtrados por segmento
    if (blocos.length > 0) {
        blocos.forEach(b => {
            // Filtra por segmento (lead/assinante)
            if (segmento && b.acesso !== "todos" && b.acesso !== segmento) return;

            htmlBlocos += b.html || "";
        });
    }

    let htmlFinal = "";

    if (blocos.length === 0) {
        // ✅ Sem blocos → usa apenas o HTML base
        htmlFinal = htmlBase;
    } else {
        // ✅ Com blocos → insere no {{blocos}} ou no final
        if (htmlBase.includes("{{blocos}}")) {
            htmlFinal = htmlBase.replace("{{blocos}}", htmlBlocos);
        } else {
            htmlFinal = htmlBase + "\n" + htmlBlocos;
        }
    }

    // ✅ Aplica placeholders reais do destinatário
    htmlFinal = aplicarPlaceholders(htmlFinal, dados);

    return htmlFinal;
}

/* function aplicarRastreamento(htmlBase, envioId, destinatarioId, newsletterId) {
 
    // 1) Inserir pixel de abertura
    const pixelTag = `
    <img src="https://api.radarsiope.com.br/api/pixel?envioId=${encodeURIComponent(envioId)}&destinatarioId=${encodeURIComponent(destinatarioId)}&newsletterId=${encodeURIComponent(newsletterId)}"
         width="1" height="1" style="display:none;" alt="" />
  `;
    let htmlComPixel = htmlBase + pixelTag;

    // 2) Reescrever links para passar pelo redirecionador
    htmlComPixel = htmlComPixel.replace(/href="([^"]+)"/g, (match, urlDestino) => {
        const urlTrack = `https://api.radarsiope.com.br/api/click?envioId=${encodeURIComponent(envioId)}&destinatarioId=${encodeURIComponent(destinatarioId)}&newsletterId=${encodeURIComponent(newsletterId)}&url=${encodeURIComponent(urlDestino)}`;
        return `href="${urlTrack}"`;
    });
 
    return htmlComPixel;

*/

function aplicarRastreamento(htmlBase, envioId, destinatarioId, newsletterId, assinaturaId, token) {
    // 1) Pixel (uma vez)
    const pixelTag = `
            <img src="https://api.radarsiope.com.br/api/pixel?envioId=${encodeURIComponent(envioId)}&destinatarioId=${encodeURIComponent(destinatarioId)}&newsletterId=${encodeURIComponent(newsletterId)}"
                width="1" height="1" style="display:none;" alt="" />
        `;
    let html = htmlBase + pixelTag;

    /*     const hasPixel = /api\/pixel\?/i.test(htmlBase);
        const pixel = `<img src="https://api.radarsiope.com.br/api/pixel?envioId=${encodeURIComponent(envioId)}&destinatarioId=${encodeURIComponent(destinatarioId)}&newsletterId=${encodeURIComponent(newsletterId)}" width="1" height="1" style="display:none" alt="" />`;
        let html = hasPixel ? htmlBase : htmlBase + pixel; */

    // 2) Monta qs e gera d (Base64 + encodeURIComponent)
    const parts = [
        `nid=${newsletterId || ''}`,
        `env=${envioId || ''}`,
        `uid=${destinatarioId || ''}`
    ];
    if (assinaturaId) parts.push(`assinaturaId=${assinaturaId}`);
    if (token) parts.push(`token=${token}`);
    const qs = parts.join('&');

    let b64;
    try {
        if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
            b64 = Buffer.from(qs).toString('base64');
        } else {
            b64 = btoa(qs);
        }
    } catch (e) {
        b64 = encodeURIComponent(qs);
    }
    const encodedD = encodeURIComponent(b64);
    const hrefOfuscado = `https://api.radarsiope.com.br/verNewsletterComToken.html?d=${encodedD}`;

    // 3) Substitui o primeiro link de visualização por ?d=ENCODED
    html = html.replace(/href="([^"]*verNewsletterComToken\.html[^"]*)"/i, () => `href="${hrefOfuscado}"`);

    // 4) Reescreve outros links para o redirecionador, preservando casos especiais
    html = html.replace(/href="([^"]+)"/g, (m, href) => {
        const u = String(href).trim();
        const lower = u.toLowerCase();

        if (
            lower.startsWith('mailto:') ||
            lower.startsWith('tel:') ||
            lower.startsWith('javascript:') ||
            lower.startsWith('#') ||
            /descadastramento\.html/i.test(u) ||
            /vernewslettercomtoken\.html/i.test(u) ||
            /\/api\/click/i.test(u)
        ) {
            return `href="${u}"`;
        }

        let destino = u;
        try { destino = decodeURIComponent(u); } catch (e) { destino = u; }

        const track = `https://api.radarsiope.com.br/api/click?envioId=${encodeURIComponent(envioId)}&destinatarioId=${encodeURIComponent(destinatarioId)}&newsletterId=${encodeURIComponent(newsletterId)}&url=${encodeURIComponent(destino)}`;
        return `href="${track}"`;
    });

    return html;
}


function voltarParaPrevia() {
    // Esconde a section de lotes
    document.getElementById("secao-lotes-envio").style.display = "none";
    // Mostra novamente a section de prévia
    document.getElementById("secao-preview-envio").style.display = "block";
}

function coletarFiltros() {
    if (tipoDestinatarioSelecionado === "leads") {
        return {
            tipo: "leads",
            nome: document.getElementById("filtro-nome").value.trim().toLowerCase(),
            email: document.getElementById("filtro-email").value.trim().toLowerCase(),
            perfil: document.getElementById("filtro-perfil").value.trim().toLowerCase(),
            preferencias: document.getElementById("filtro-tipo-news-envio").value.trim().toLowerCase(),
            status: document.getElementById("filtro-status-lead").value.trim().toLowerCase()
        };
    } else if (tipoDestinatarioSelecionado === "usuarios") {
        return {
            tipo: "usuarios",
            nome: document.getElementById("filtro-usuario-nome").value.trim().toLowerCase(),
            email: document.getElementById("filtro-usuario-email").value.trim().toLowerCase(),
            assinatura: document.getElementById("filtro-assinatura").value.trim().toLowerCase()
        };
    } else {
        return { tipo: null };
    }
}

function abrirLotesGerados() {
    if (!newsletterSelecionada || !newsletterSelecionada.id) {
        mostrarMensagem("Nenhuma newsletter selecionada.");
        return;
    }

    // 🔎 Primeiro tenta ordenar por data_geracao (para lotes novos)
    db.collection("newsletters")
        .doc(newsletterSelecionada.id)
        .collection("envios")
        .where("tipo", "==", tipoDestinatarioSelecionado)
        .orderBy("data_geracao", "desc")
        .limit(1)
        .get()
        .then(async snapshot => {
            // Se não houver resultados (ou se os docs não tiverem data_geracao), cai para data_envio
            if (snapshot.empty) {
                snapshot = await db.collection("newsletters")
                    .doc(newsletterSelecionada.id)
                    .collection("envios")
                    .where("tipo", "==", tipoDestinatarioSelecionado)
                    .orderBy("data_envio", "desc")
                    .limit(1)
                    .get();
            }

            if (snapshot.empty) {
                mostrarMensagem("Nenhum lote encontrado para esse tipo.");
                return;
            }

            const envio = snapshot.docs[0];
            envioSelecionadoId = envio.id;

            // ✅ Ajusta cabeçalhos da tabela
            const cabecalho = document.getElementById("cabecalho-lotes-envio");
            cabecalho.innerHTML = `
              <tr>
                <th>Nº Lote</th>
                <th>Status</th>
                <th>Qtd</th>
                <th>Enviados</th>
                <th>Erros</th>
                <th>Abertos</th>
                <th>Data de Geração</th>
                <th>Data de Envio</th>
                <th>Último Envio/Reenvio</th>
                <th>Ações</th>
              </tr>
            `;

            listarLotesEnvio(newsletterSelecionada.id, envio.id);
            mostrarAba("secao-lotes-envio");
        })
        .catch(err => {
            console.error("Erro ao abrir lotes gerados:", err);
            mostrarMensagem("❌ Erro ao carregar lotes.");
        });
}


function verDestinatariosLote(loteId) {
    const corpo = document.querySelector("#tabela-preview-envio tbody");
    corpo.innerHTML = "<tr><td colspan='7'>Carregando destinatários...</td></tr>";

    db.collection("newsletters")
        .doc(newsletterSelecionada.id)
        .collection("envios")
        .doc(envioSelecionadoId)
        .collection("lotes")
        .doc(loteId)
        .get()
        .then(doc => {
            if (!doc.exists) {
                mostrarMensagem("Lote não encontrado.");
                return;
            }

            const lote = doc.data();
            let linhas = "";

            for (const d of lote.destinatarios) {
                linhas += `
          <tr>
            <td>✅</td>
            <td>${d.nome}</td>
            <td>${d.email}</td>
            <td>${newsletterSelecionada.titulo}</td>
            <td>-</td>
            <td>✅</td>
            <td>Não</td>
          </tr>
        `;
            }

            corpo.innerHTML = linhas;
            mostrarAba("secao-preview-envio");
        });
}

async function listarTodosOsLotes() {
    const corpo = document.getElementById("corpo-todos-os-lotes");
    corpo.innerHTML = "<tr><td colspan='12'>Carregando lotes...</td></tr>";

    const filtroNewsletter = document.getElementById("filtro-newsletter").value;
    const filtroTipo = document.getElementById("filtro-tipo").value;
    const filtroStatus = document.getElementById("filtro-status").value;
    const filtroDataTipo = document.getElementById("filtro-data-tipo").value; // geracao ou envio
    const filtroDataInicio = document.getElementById("filtro-data-inicio").value;
    const filtroDataFim = document.getElementById("filtro-data-fim").value;

    const campoData = filtroDataTipo === "geracao" ? "data_geracao" : "data_envio";

    let query = db.collection("lotes_gerais").orderBy(campoData, "desc").limit(500);

    if (filtroNewsletter) query = query.where("newsletterId", "==", filtroNewsletter);
    if (filtroTipo) query = query.where("tipo", "==", filtroTipo);
    if (filtroStatus) query = query.where("status", "==", filtroStatus);

    if (filtroDataInicio) {
        const [ano, mes, dia] = filtroDataInicio.split("-");
        const inicio = new Date(ano, mes - 1, dia, 0, 0, 0, 0);
        query = query.where(campoData, ">=", inicio);
    }
    if (filtroDataFim) {
        const [ano, mes, dia] = filtroDataFim.split("-");
        const fim = new Date(ano, mes - 1, dia, 23, 59, 59, 999);
        query = query.where(campoData, "<=", fim);
    }

    const snap = await query.get();

    const todosLogsSnap = await db.collectionGroup("envios_log").get();
    const mapaReenvios = {};
    const mapaUltimoEnvio = {};

    todosLogsSnap.forEach(doc => {
        const partes = doc.ref.path.split("/");
        const loteId = partes[5];
        const log = doc.data();
        const data = log.data_envio.toDate();

        if (!mapaReenvios[loteId]) {
            mapaReenvios[loteId] = [];
            mapaUltimoEnvio[loteId] = data;
        } else {
            mapaReenvios[loteId].push(log);
            if (data > mapaUltimoEnvio[loteId]) mapaUltimoEnvio[loteId] = data;
        }
    });

    const lotesComDados = snap.docs.map(doc => {
        const lote = doc.data();
        const loteId = doc.id;
        const reenvios = mapaReenvios[loteId] || [];

        const dataGeracao = lote.data_geracao?.toDate ? lote.data_geracao.toDate() : null;
        const dataEnvio = lote.data_envio?.toDate ? lote.data_envio.toDate() : null;
        const ultimoEnvio = mapaUltimoEnvio[loteId] || dataEnvio;

        return { docId: loteId, lote, reenvios, dataGeracao, dataEnvio, ultimoEnvio };
    });

    if (filtroDataInicio || filtroDataFim) {
        lotesComDados.sort((a, b) => b.ultimoEnvio - a.ultimoEnvio);
    } else {
        lotesComDados.sort((a, b) => b.lote.numero_lote - a.lote.numero_lote);
    }

    corpo.innerHTML = lotesComDados.length === 0
        ? "<tr><td colspan='12'>Nenhum lote encontrado com os filtros aplicados.</td></tr>"
        : lotesComDados.map(item => {
            const { docId, lote, reenvios, dataGeracao, dataEnvio, ultimoEnvio } = item;
            const progresso = lote.quantidade > 0 ? Math.round((lote.enviados / lote.quantidade) * 100) : 0;
            const destaqueReenvio = reenvios.length > 1 ? "style='background-color:#fff3cd'" : "";

            return `
              <tr ${destaqueReenvio}>
                <td>${lote.titulo}</td>
                <td>${lote.edicao}</td>
                <td>${dataGeracao ? dataGeracao.toLocaleString() : "-"}</td>
                <td>${dataEnvio ? dataEnvio.toLocaleString() : "-"}</td>
                <td>${lote.numero_lote}</td>
                <td>${lote.tipo}</td>
                <td>${lote.status}</td>
                <td>
                  <div class="barra-progresso">
                    <div class="preenchimento" style="width:${progresso}%">${progresso}%</div>
                  </div>
                </td>
                <td>${lote.quantidade}</td>
                <td>${lote.tamanho_lote || "-"}</td>
                <td>${ultimoEnvio ? ultimoEnvio.toLocaleString() : "-"}</td>
                <td>
                    <button onclick="verDestinatariosLoteUnificado('${lote.loteId}')">👥 Ver Destinatários</button>
                    <button onclick="enviarLoteIndividual('${lote.newsletterId}', '${lote.envioId}', '${lote.loteId}')">📤 Enviar Newsletter</button>
                  ${reenvios.length > 0
                    ? `<button onclick="verHistoricoEnvios('${lote.newsletterId}', '${lote.envioId}', '${docId}')">📜 Ver Reenvios (${reenvios.length})</button>`
                    : `<button disabled title='Sem reenvios registrados'>📜 Ver Reenvios</button>`}
                </td>
              </tr>
            `;
        }).join("");

    mostrarAba("secao-todos-os-lotes");
}



async function verHistoricoEnvios(newsletterId, envioId, loteId) {
    const corpo = document.getElementById("corpo-historico-reenvios");
    corpo.innerHTML = "<tr><td colspan='5'>Carregando histórico...</td></tr>";

    const logRef = db.collection("newsletters")
        .doc(newsletterId)
        .collection("envios")
        .doc(envioId)
        .collection("lotes")
        .doc(loteId)
        .collection("envios_log")
        .orderBy("data_envio", "desc");

    const snap = await logRef.get();
    let linhas = "";

    if (snap.empty) {
        corpo.innerHTML = "<tr><td colspan='5'>Nenhum reenvio registrado.</td></tr>";
    } else {
        for (const doc of snap.docs) {
            const loteId = doc.id;
            const lote = doc.data();
            const log = doc.data();
            linhas += `
        <tr>
          <td>${new Date(log.data_envio.toDate())}</td>
          <td>${log.quantidade}</td>
          <td>${log.enviados}</td>
          <td>${log.status}</td>
          <td>${log.operador}</td>
        </tr>
      `;
        }
        corpo.innerHTML = linhas;
    }

    mostrarAba("secao-historico-reenvios");
}

function verDestinatariosLoteCompleto(newsletterId, envioId, loteId) {
    const corpo = document.querySelector("#tabela-preview-envio tbody");
    corpo.innerHTML = "<tr><td colspan='8'>Carregando destinatários...</td></tr>";

    const loteRef = db.collection("newsletters")
        .doc(newsletterId)
        .collection("envios")
        .doc(envioId)
        .collection("lotes")
        .doc(loteId);

    loteRef.get().then(doc => {
        if (!doc.exists) {
            mostrarMensagem("Lote não encontrado.");
            return;
        }

        const lote = doc.data();
        const destinatarios = lote.destinatarios || [];

        if (destinatarios.length === 0) {
            corpo.innerHTML = "<tr><td colspan='8'>Nenhum destinatário encontrado.</td></tr>";
            return;
        }

        let linhas = "";
        destinatarios.forEach(d => {
            linhas += `
                <tr>
                  <td><input type="checkbox" /></td>
                  <td>${d.nome || "-"}</td>
                  <td>${d.perfil || "-"}</td>
                  <td>${d.email || "-"}</td>
                  <td>${newsletterSelecionada?.titulo || "-"}</td>
                  <td>${d.interesses || "-"}</td>
                  <td>${d.compativel ? "✅" : "❌"}</td>
                  <td>${d.enviado ? "Sim" : "Não"}</td>
                </tr>
            `;
        });

        corpo.innerHTML = linhas;
        mostrarAba("secao-preview-envio");
    });

    configurarBotoesPrevia("visualizacao");
}



async function enviarLote(newsletterId, envioId, loteId) {
    const loteRef = db.collection("newsletters")
        .doc(newsletterId)
        .collection("envios")
        .doc(envioId)
        .collection("lotes")
        .doc(loteId);

    const loteSnap = await loteRef.get();
    if (!loteSnap.exists) {
        mostrarMensagem("Lote não encontrado.");
        return;
    }

    const lote = loteSnap.data();
    const destinatarios = lote.destinatarios;

    let enviados = 0;
    let erros = 0;
    let abertos = 0;

    for (const d of destinatarios) {
        try {
            // Simula envio (substitua com lógica real)
            await enviarEmailParaDestinatario(d);
            enviados++;
        } catch (e) {
            erros++;
        }
    }

    // Atualiza o lote original
    await loteRef.update({
        status: "finalizado",
        enviados,
        erros,
        abertos // se tiver lógica de rastreamento
    });

    // Atualiza o índice global
    const indexSnap = await db.collection("lotes_gerais")
        .where("newsletterId", "==", newsletterId)
        .where("envioId", "==", envioId)
        .where("loteId", "==", loteId)
        .limit(1)
        .get();

    if (!indexSnap.empty) {
        const indexRef = indexSnap.docs[0].ref;
        await indexRef.update({
            status: "finalizado",
            enviados,
            erros,
            abertos
        });
    }

    mostrarMensagem(`Lote ${lote.numero_lote} enviado: ${enviados} enviados, ${erros} erros.`);
}

async function preencherFiltroNewsletters() {
    const select = document.getElementById("filtro-newsletter");

    // ✅ Limpa todas as opções anteriores
    select.innerHTML = "";

    // ✅ Adiciona a opção padrão
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Todas as newsletters";
    select.appendChild(defaultOption);

    // ✅ Preenche com os dados reais
    const snap = await db.collection("newsletters").get();
    for (const doc of snap.docs) {
        const n = doc.data();
        const option = document.createElement("option");
        option.value = doc.id;
        option.textContent = `${n.titulo} (${n.edicao || doc.id})`;
        select.appendChild(option);
    }
}

function abrirTelaTodosOsLotes() {

    preencherFiltroNewsletters(); // ✅ só uma vez
    listarTodosOsLotes();         // ✅ com filtros aplicados
}

function configurarBotoesPrevia(contexto) {
    const botoesPadrao = document.getElementById("botoes-envio-padrao");

    if (contexto === "envio") {
        botoesPadrao.style.display = "block"; // mostra todos
    } else if (contexto === "visualizacao") {
        botoesPadrao.style.display = "none"; // esconde os extras
    }
}

async function verDestinatariosLoteUnificado(loteId) {
    const tabelaPrevio = document.querySelector("#tabela-preview-envio");
    if (tabelaPrevio) tabelaPrevio.style.display = "none";

    const tabelaDest = document.querySelector("#tabela-preview-envio-destinatario");
    if (tabelaDest) tabelaDest.style.display = "table";

    const corpo = document.querySelector("#tabela-preview-envio-destinatario tbody");
    corpo.innerHTML = "<tr><td colspan='6'>Carregando destinatários...</td></tr>";

    try {
        const loteSnap = await db.collection("lotes_gerais")
            .where("loteId", "==", loteId)
            .limit(1)
            .get();

        if (loteSnap.empty) {
            mostrarMensagem("❌ Lote não encontrado.");
            return;
        }

        const loteData = loteSnap.docs[0].data();
        const { newsletterId, envioId, titulo, numero_lote } = loteData;

        const cabecalhoEl = document.querySelector("#cabecalho-newsletter-destinatario");
        if (cabecalhoEl) {
            cabecalhoEl.innerHTML = `
              <h3>Destinatários da Newsletter: ${titulo || "-"} (Lote ${numero_lote || "-"})</h3>
            `;
        }

        const doc = await db.collection("newsletters")
            .doc(newsletterId)
            .collection("envios")
            .doc(envioId)
            .collection("lotes")
            .doc(loteId)
            .get();

        if (!doc.exists) {
            mostrarMensagem("❌ Lote não encontrado dentro da newsletter.");
            return;
        }

        const lote = doc.data();
        const destinatarios = lote.destinatarios || [];

        if (destinatarios.length === 0) {
            corpo.innerHTML = "<tr><td colspan='6'>Nenhum destinatário encontrado.</td></tr>";
            return;
        }

        const dadosPromises = destinatarios.map(async d => {
            try {
                if (d.tipo === "leads" || (!d.tipo && !d.assinaturaId)) {
                    // 🔹 Leads: interesses vêm do array
                    const leadDoc = await db.collection("leads").doc(d.id).get();
                    if (leadDoc.exists) {
                        const leadData = leadDoc.data();
                        return {
                            perfil: leadData.perfil || "-",
                            email: leadData.email || d.email || "-",
                            tipo: "lead"
                        };
                    }
                } else {
                    // 🔹 Usuários: interesses vêm da subcoleção preferencias_newsletter
                    const usuarioDoc = await db.collection("usuarios").doc(d.id).get();
                    if (usuarioDoc.exists) {
                        const usuarioData = usuarioDoc.data();
                        return {
                            perfil: usuarioData.tipo_perfil || "-",
                            email: usuarioData.email || d.email || "-",
                            tipo: "usuario"
                        };
                    }
                }
            } catch (err) {
                console.warn(`⚠️ Não foi possível obter dados para ${d.id}`, err);
            }
            return { perfil: "-", email: d.email || "-", tipo: "desconhecido" };
        });

        const dados = await Promise.all(dadosPromises);

        let linhas = "";
        destinatarios.forEach((d, i) => {
            const info = dados[i];
            let statusColuna = "-";

            linhas += `
                    <tr>
                    <td>${d.nome || "-"}</td>
                    <td>${info.perfil}</td>
                    <td>${info.email}</td>
                    <td>${d.enviado ? "Sim" : "Não"}</td>
                    </tr>
                `;
        });


        corpo.innerHTML = linhas;
        mostrarAba("secao-preview-envio");
        configurarBotoesPrevia("visualizacao");

    } catch (err) {
        console.error("Erro ao listar destinatários:", err);
        corpo.innerHTML = "<tr><td colspan='6'>Erro ao carregar destinatários.</td></tr>";
    }
}
