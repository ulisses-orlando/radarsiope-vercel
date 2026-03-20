/* ==========================================================================
   EnvioLeads.js — Radar SIOPE · Admin
   Gerencia o fluxo completo de envio de newsletters:
     1. Seleção da newsletter
     2. Busca filtrada de leads/assinantes (server-side, sem carregar tudo)
     3. Prévia com verificação de envio anterior (query única)
     4. Geração de lotes
     5. Envio em massa via sendBatchViaSES.js
     6. Reenvio individual (somente 1 destinatário selecionado)

   Dependências globais (functions.js / main.js):
     gerarTokenAcesso()
     preencherFiltroTipoNewsletter(selectEl)
     formatDateBR(date)
     mostrarMensagem(msg)
     aplicarPlaceholders(html, dados)
   ========================================================================== */

'use strict';

// ─── Estado global do módulo ──────────────────────────────────────────────────

window.newsletterSelecionada   = null;
window.tipoDestinatarioSelecionado = null;

let _envioEmAndamento = false; // guard anti-duplo-clique

// ─── Mapa de nomes dos tipos (cache por sessão) ───────────────────────────────

let _mapaNomesTiposCache = null;

async function obterMapaNomesTipos() {
    if (_mapaNomesTiposCache) return _mapaNomesTiposCache;
    const mapa = {};
    const snap = await db.collection('tipo_newsletters').get();
    snap.forEach(doc => { mapa[doc.id] = doc.data().nome; });
    _mapaNomesTiposCache = mapa;
    return mapa;
}

// ─── Helpers de UI ────────────────────────────────────────────────────────────

function _setBtnEnviando(btn, sim) {
    if (!btn) return;
    btn.disabled = sim;
    btn.dataset.textoOriginal = btn.dataset.textoOriginal || btn.textContent;
    btn.textContent = sim ? '⏳ Aguarde...' : btn.dataset.textoOriginal;
}

/** Atualiza a área de log de progresso sem sobrescrever as linhas anteriores */
function _logProgresso(msg, tipo = 'info') {
    const area = document.getElementById('area-log-envio');
    if (!area) { mostrarMensagem(msg); return; }
    const cores = { info: '#555', ok: '#166534', erro: '#991b1b', aviso: '#92400e' };
    const linha = document.createElement('div');
    linha.style.cssText = `color:${cores[tipo] || '#555'};padding:2px 0;font-size:13px`;
    linha.textContent = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
    area.appendChild(linha);
    area.scrollTop = area.scrollHeight;
}

function _limparLogProgresso() {
    const area = document.getElementById('area-log-envio');
    if (area) area.innerHTML = '';
}

// ─── Dados da newsletter selecionada ─────────────────────────────────────────

async function mostrarDadosNewsletterSelecionada() {
    const divs = document.querySelectorAll('#dados-newsletter-selecionada');
    if (!window.newsletterSelecionada) {
        divs.forEach(d => { d.innerHTML = 'A newsletter selecionada aparecerá aqui...'; });
        return;
    }
    const mapa = await obterMapaNomesTipos();
    const nomeTipo = mapa[window.newsletterSelecionada.tipo] || window.newsletterSelecionada.tipo || '-';
    const html = `
        <strong>📰 Newsletter Selecionada:</strong>
        <b>Título:</b> ${window.newsletterSelecionada.titulo || '-'} &nbsp;
        <b>Tipo:</b> <span style="color:#007acc">${nomeTipo}</span> &nbsp;
        <b>Edição:</b> ${window.newsletterSelecionada.edicao || '-'} &nbsp;
        <b>Data:</b> ${formatDateBR(window.newsletterSelecionada.data_publicacao?.toDate?.()) || '-'}
    `;
    divs.forEach(d => { d.innerHTML = html; });
}

// ─── Abrir módulo de envio ────────────────────────────────────────────────────

function abrirEnvioNewsletterLeads() {
    document.querySelectorAll('section').forEach(s => { s.style.display = 'none'; });
    document.getElementById('secao-envio-newsletters').style.display = 'block';
    mostrarAba('secao-newsletters-envio');
    document.querySelectorAll('#dados-newsletter-selecionada').forEach(d => {
        d.innerHTML = 'A newsletter selecionada aparecerá aqui...';
    });
    listarNewslettersDisponiveis();
}
window.abrirEnvioNewsletterLeads = abrirEnvioNewsletterLeads;

// ─── Controle de abas ─────────────────────────────────────────────────────────

function mostrarAba(id) {
    preencherFiltroTipoNewsletter(document.getElementById('filtro-tipo-news-envio'));

    const todas = [
        'secao-newsletters-envio', 'secao-envio-leads', 'secao-envio-usuarios',
        'secao-preview-envio', 'secao-lotes-envio', 'secao-relatorio-envios',
        'secao-descadastramentos', 'secao-todos-os-lotes', 'secao-orientacoes',
        'secao-historico-reenvios'
    ];
    todas.forEach(sec => {
        const el = document.getElementById(sec);
        if (el) el.style.display = sec === id ? 'block' : 'none';
        else console.warn('⚠️ Seção não encontrada:', sec);
    });

    if (id === 'secao-newsletters-envio') {
        document.querySelectorAll('#dados-newsletter-selecionada').forEach(d => {
            d.innerHTML = 'A newsletter selecionada aparecerá aqui...';
        });
    } else {
        mostrarDadosNewsletterSelecionada();
    }
}
window.mostrarAba = mostrarAba;

// ─── Tipo de destinatário ─────────────────────────────────────────────────────

function alterarTipoDestinatario(tipo) {
    window.tipoDestinatarioSelecionado = tipo || null;
    const botoes = document.querySelectorAll('.btn-preparar-envio');
    botoes.forEach(btn => { btn.disabled = !tipo; });
}
window.alterarTipoDestinatario = alterarTipoDestinatario;

// ─── Lista de newsletters ─────────────────────────────────────────────────────

async function listarNewslettersDisponiveis() {
    const corpo = document.querySelector('#tabela-newsletters-envio tbody');
    corpo.innerHTML = "<tr><td colspan='6'>Carregando newsletters...</td></tr>";

    const mapa = await obterMapaNomesTipos();
    const snap = await db.collection('newsletters').orderBy('data_publicacao', 'desc').get();
    let linhas = '';

    for (const doc of snap.docs) {
        const n   = doc.data();
        const id  = doc.id;
        const dt  = n.data_publicacao?.toDate?.() || n.data_publicacao;
        const dtF = dt ? formatDateBR(dt) : '-';
        const nomeTipo = mapa[n.tipo] || n.tipo || '-';

        linhas += `
            <tr>
                <td>${n.titulo || '(sem título)'}</td>
                <td>${n.edicao || '-'}</td>
                <td><span class="badge-tipo">${nomeTipo}</span></td>
                <td>${n.classificacao || '-'}</td>
                <td>${dtF}</td>
                <td>
                    <button class="btn-visualizar-newsletter" data-id="${id}">👁️ Visualizar</button>
                    <button class="btn-preparar-envio" data-id="${id}" disabled>📬 Preparar envio</button>
                </td>
            </tr>`;
    }

    corpo.innerHTML = linhas || "<tr><td colspan='6'>Nenhuma newsletter encontrada.</td></tr>";

    corpo.querySelectorAll('.btn-preparar-envio').forEach(btn => {
        btn.addEventListener('click', () => prepararEnvioNewsletter(btn.dataset.id));
    });
    corpo.querySelectorAll('.btn-visualizar-newsletter').forEach(btn => {
        btn.addEventListener('click', () => visualizarNewsletterHtml(btn.dataset.id));
    });
}
window.listarNewslettersDisponiveis = listarNewslettersDisponiveis;

// ─── Visualizar HTML da newsletter ───────────────────────────────────────────

async function visualizarNewsletterHtml(newsletterId) {
    const snap = await db.collection('newsletters').doc(newsletterId).get();
    if (!snap.exists) return mostrarMensagem('Newsletter não encontrada.');

    const dados = snap.data();
    const segmento = window.tipoDestinatarioSelecionado === 'usuarios' ? 'assinantes' : 'leads';

    let htmlBase  = dados.html_conteudo || '';
    const blocos  = dados.blocos || [];
    let htmlBlocos = '';

    blocos.forEach(b => {
        if (segmento && b.acesso !== 'todos' && b.acesso !== segmento) return;
        if (b.destino === 'app') return;
        htmlBlocos += b.html || '';
    });

    let htmlFinal = blocos.length === 0
        ? htmlBase
        : (htmlBase.includes('{{blocos}}')
            ? htmlBase.replace('{{blocos}}', htmlBlocos)
            : htmlBase + '\n' + htmlBlocos);

    htmlFinal = aplicarPlaceholders(htmlFinal, dados);

    const modal   = document.getElementById('modal-preview-html');
    const content = document.getElementById('preview-html-content');
    if (content) content.innerHTML = htmlFinal;
    if (modal)   modal.style.display = 'flex';
}
window.visualizarNewsletterHtml = visualizarNewsletterHtml;

// ─── Preparar envio ───────────────────────────────────────────────────────────

function prepararEnvioNewsletter(newsletterId) {
    if (!window.tipoDestinatarioSelecionado) {
        mostrarMensagem('Selecione primeiro se deseja enviar para Leads ou Usuários.');
        return;
    }
    configurarBotoesPrevia('envio');
    if (window.tipoDestinatarioSelecionado === 'leads') {
        prepararEnvioParaLeads(newsletterId);
    } else {
        prepararEnvioParaUsuarios(newsletterId);
    }
}
window.prepararEnvioNewsletter = prepararEnvioNewsletter;

async function prepararEnvioParaLeads(newsletterId) {
    const snap = await db.collection('newsletters').doc(newsletterId).get();
    if (!snap.exists) { mostrarMensagem('Newsletter não encontrada.'); return; }

    window.newsletterSelecionada    = { id: newsletterId, ...snap.data() };
    // Limpa tabela de leads — o operador precisará aplicar filtros para carregar
    const corpo = document.querySelector('#tabela-leads-envio tbody');
    if (corpo) corpo.innerHTML = "<tr><td colspan='6' style='color:#888;text-align:center;padding:20px'>Aplique ao menos um filtro e clique em <strong>🔎 Buscar Leads</strong> para carregar os destinatários.</td></tr>";

    document.querySelector('#tabela-preview-envio')?.style.setProperty('display', 'none');
    document.querySelector('#tabela-preview-envio-destinatario')?.style.setProperty('display', 'none');

    mostrarAba('secao-envio-leads');
}

async function prepararEnvioParaUsuarios(newsletterId) {
    const snap = await db.collection('newsletters').doc(newsletterId).get();
    if (!snap.exists) { mostrarMensagem('Newsletter não encontrada.'); return; }

    window.newsletterSelecionada    = { id: newsletterId, ...snap.data() };
    await listarUsuariosComAssinaturas(newsletterId);
}

// ─── BUSCA DE LEADS — server-side com filtros ─────────────────────────────────
//
// Nunca carrega todos os leads. Requer ao menos 1 filtro aplicado.
// Faz query no Supabase com todos os filtros combinados.
// Cruza com leads_envios para exibir status de envio desta newsletter.
// Limite: 500 resultados por busca.
// ─────────────────────────────────────────────────────────────────────────────

const LIMITE_BUSCA_LEADS = 500;

async function buscarLeadsFiltrados() {
    if (!window.newsletterSelecionada) {
        mostrarMensagem('Selecione uma newsletter antes de buscar leads.');
        return;
    }

    const newsletterId = window.newsletterSelecionada.id;

    // Coleta filtros
    const nome           = document.getElementById('filtro-nome')?.value.trim()             || '';
    const email          = document.getElementById('filtro-email')?.value.trim()            || '';
    const perfil         = document.getElementById('filtro-perfil')?.value                  || '';
    const statusLead     = document.getElementById('filtro-status-lead')?.value             || '';
    const tipoNews       = document.getElementById('filtro-tipo-news-envio')?.value         || '';
    const uf             = document.getElementById('filtro-uf-lead')?.value                 || '';
    const statusEnvio    = document.getElementById('filtro-status-envio-lead')?.value       || '';

    // Exige pelo menos um critério
    const temFiltro = nome || email || perfil || statusLead || tipoNews || uf || statusEnvio;
    if (!temFiltro) {
        mostrarMensagem('Informe ao menos um filtro antes de buscar (UF, perfil, interesse, nome, e-mail ou status de envio).');
        return;
    }

    const corpo = document.querySelector('#tabela-leads-envio tbody');
    corpo.innerHTML = "<tr><td colspan='7'>Buscando leads...</td></tr>";

    try {
        // ── Etapa 1: resolver IDs por status de envio (se filtro de envio ativo) ──
        let idsEnviados    = null; // Set de lead_ids que já receberam (status=enviado)
        let idsErro        = null; // Set de lead_ids com erro
        let idsNaoEnviados = null; // Set de lead_ids que NÃO receberam

        if (statusEnvio) {
            const { data: enviosData } = await window.supabase
                .from('leads_envios')
                .select('lead_id, status')
                .eq('newsletter_id', newsletterId);

            const enviados = new Set();
            const comErro  = new Set();
            (enviosData || []).forEach(r => {
                if (r.status === 'enviado') enviados.add(String(r.lead_id));
                else comErro.add(String(r.lead_id));
            });

            if (statusEnvio === 'enviado')    idsEnviados    = enviados;
            if (statusEnvio === 'erro')        idsErro        = comErro;
            if (statusEnvio === 'nao-enviado') idsNaoEnviados = enviados; // usamos para excluir
        }

        // ── Etapa 2: query principal de leads com filtros ─────────────────────────
        let query = window.supabase
            .from('leads')
            .select('id, nome, email, perfil, interesses, status, cod_uf')
            .in('status', ['Novo', 'Em contato'])
            .limit(LIMITE_BUSCA_LEADS);

        if (nome)      query = query.ilike('nome', `%${nome}%`);
        if (email)     query = query.ilike('email', `%${email}%`);
        if (perfil)    query = query.eq('perfil', perfil);
        if (statusLead) query = query.eq('status', statusLead);
        if (uf)        query = query.eq('cod_uf', uf);
        if (tipoNews)  query = query.contains('interesses', [tipoNews]);

        // Filtro por IDs de envio (quando status de envio foi selecionado)
        if (statusEnvio === 'enviado') {
            if (!idsEnviados || idsEnviados.size === 0) {
                corpo.innerHTML = "<tr><td colspan='7'>Nenhum lead recebeu esta newsletter ainda.</td></tr>";
                return;
            }
            query = query.in('id', [...idsEnviados]);
        } else if (statusEnvio === 'erro') {
            if (!idsErro || idsErro.size === 0) {
                corpo.innerHTML = "<tr><td colspan='7'>Nenhum lead com erro de envio para esta newsletter.</td></tr>";
                return;
            }
            query = query.in('id', [...idsErro]);
        }
        // 'nao-enviado': busca normalmente e filtra depois com o mapaStatusEnvio

        const { data: leads, error } = await query;

        if (error) {
            console.error('Erro ao buscar leads:', error);
            corpo.innerHTML = "<tr><td colspan='7'>Erro ao buscar leads.</td></tr>";
            return;
        }

        if (!leads || leads.length === 0) {
            corpo.innerHTML = "<tr><td colspan='7'>Nenhum lead encontrado com os filtros aplicados.</td></tr>";
            return;
        }

        // ── Etapa 3: busca status de envio para os leads retornados ───────────────
        // (uma única query, não N queries)
        const idsRetornados = leads.map(l => String(l.id));
        const { data: enviosLeads } = await window.supabase
            .from('leads_envios')
            .select('lead_id, status')
            .eq('newsletter_id', newsletterId)
            .in('lead_id', idsRetornados);

        const mapaStatusEnvio = {};
        (enviosLeads || []).forEach(r => { mapaStatusEnvio[String(r.lead_id)] = r.status; });

        // ── Etapa 4: filtro "não enviado" aplicado no resultado (evita .not() do Supabase)
        const leadsFiltrados = (statusEnvio === 'nao-enviado')
            ? leads.filter(l => !mapaStatusEnvio[String(l.id)])
            : leads;

        if (leadsFiltrados.length === 0) {
            corpo.innerHTML = "<tr><td colspan='7'>Nenhum lead encontrado sem envio para esta newsletter com os filtros aplicados.</td></tr>";
            return;
        }

        // ── Etapa 4: renderizar tabela ────────────────────────────────────────────
        let linhas = '';
        for (const lead of leadsFiltrados) {
            const interesses = Array.isArray(lead.interesses) ? lead.interesses.join(', ') : '-';
            const statusEnvioLead = mapaStatusEnvio[String(lead.id)] || 'nao-enviado';
            const badgeEnvio = statusEnvioLead === 'enviado'
                ? '<span style="color:#166534;font-weight:700">✅ Enviado</span>'
                : statusEnvioLead === 'erro'
                    ? '<span style="color:#991b1b;font-weight:700">❌ Erro</span>'
                    : '<span style="color:#92400e">➖ Não enviado</span>';

            linhas += `
                <tr data-lead-id="${lead.id}">
                    <td><input type="checkbox" class="chk-lead-envio" ${statusEnvioLead !== 'enviado' ? 'checked' : ''} /></td>
                    <td>${lead.nome || ''}</td>
                    <td>${lead.email || ''}</td>
                    <td>${lead.perfil || ''}</td>
                    <td>${interesses}</td>
                    <td>${lead.status || ''}</td>
                    <td>${badgeEnvio}</td>
                </tr>`;
        }

        corpo.innerHTML = linhas;

        const aviso = leadsFiltrados.length >= LIMITE_BUSCA_LEADS
            ? `<div style="color:#92400e;padding:8px;background:#fef3c7;border-radius:4px;margin-top:8px">
                ⚠️ Exibindo ${LIMITE_BUSCA_LEADS} resultados (limite atingido). Refine os filtros para ver mais.
               </div>`
            : '';

        const contador = document.getElementById('contador-leads-buscados');
        if (contador) contador.textContent = `${leadsFiltrados.length} lead(s) encontrado(s)`;

        if (aviso) {
            const tabelaWrap = document.querySelector('#secao-envio-leads');
            if (tabelaWrap) tabelaWrap.insertAdjacentHTML('beforeend', aviso);
        }

    } catch (err) {
        console.error('Erro em buscarLeadsFiltrados:', err);
        corpo.innerHTML = `<tr><td colspan='7'>Erro: ${err.message}</td></tr>`;
    }
}
window.buscarLeadsFiltrados = buscarLeadsFiltrados;

// ─── Listar usuários com assinaturas ─────────────────────────────────────────
// fix #I9: removida verificação de pagamentos em loop — usa só status da assinatura

let usuariosFiltraveis = [];
window.usuariosFiltraveis = usuariosFiltraveis;

async function listarUsuariosComAssinaturas(newsletterId) {
    const corpo = document.querySelector('#tabela-usuarios-envio tbody');
    corpo.innerHTML = "<tr><td colspan='5'>Carregando usuários...</td></tr>";
    usuariosFiltraveis = [];

    if (!window.newsletterSelecionada) {
        corpo.innerHTML = "<tr><td colspan='5'>Selecione primeiro uma newsletter.</td></tr>";
        return;
    }

    const tipoId = window.newsletterSelecionada.tipo;
    if (!tipoId) {
        corpo.innerHTML = "<tr><td colspan='5'>⚠️ Newsletter sem tipo definido.</td></tr>";
        return;
    }

    const statusEnvio = document.getElementById('filtro-status-envio-usuario')?.value || '';
    const ufFiltro    = document.getElementById('filtro-uf-usuario')?.value           || '';
    const nomeFiltro  = document.getElementById('filtro-usuario-nome')?.value.toLowerCase() || '';
    const emailFiltro = document.getElementById('filtro-usuario-email')?.value.toLowerCase() || '';

    const snapAss = await db.collectionGroup('assinaturas')
        .where('status', 'in', ['ativa', 'aprovada'])
        .where('tipos_selecionados', 'array-contains', tipoId)
        .get();

    // Coleta IDs de envio para esta newsletter (uma única query)
    const userIds = snapAss.docs.map(d => d.ref.parent.parent.id);
    const mapaStatusEnvio = {};

    if (statusEnvio || userIds.length > 0) {
        // Para assinantes os envios ficam no Firestore
        // Fazemos uma única collectionGroup query filtrada por newsletter_id
        try {
            const snapEnvios = await db.collectionGroup('envios')
                .where('newsletter_id', '==', newsletterId)
                .get();
            snapEnvios.forEach(d => {
                const uid = d.ref.parent.parent?.parent?.parent?.id;
                if (uid) mapaStatusEnvio[uid] = d.data().status || 'enviado';
            });
        } catch (e) {
            console.warn('Falha ao carregar envios de assinantes:', e);
        }
    }

    let linhas = '';
    const frag = document.createDocumentFragment();

    for (const doc of snapAss.docs) {
        const assinatura    = doc.data();
        const assinaturaId  = doc.id;
        const usuarioId     = doc.ref.parent.parent.id;

        const usuarioSnap = await db.collection('usuarios').doc(usuarioId).get();
        if (!usuarioSnap.exists) continue;

        const usuario  = usuarioSnap.data();
        const statusEn = mapaStatusEnvio[usuarioId] || 'nao-enviado';

        // Filtros opcionais
        if (ufFiltro && usuario.cod_uf !== ufFiltro) continue;
        if (nomeFiltro && !(usuario.nome || '').toLowerCase().includes(nomeFiltro)) continue;
        if (emailFiltro && !(usuario.email || '').toLowerCase().includes(emailFiltro)) continue;
        if (statusEnvio && statusEn !== statusEnvio) continue;

        const badgeEnvio = statusEn === 'enviado'
            ? '<span style="color:#166534;font-weight:700">✅ Enviado</span>'
            : statusEn === 'erro'
                ? '<span style="color:#991b1b;font-weight:700">❌ Erro</span>'
                : '<span style="color:#92400e">➖ Não enviado</span>';

        usuariosFiltraveis.push({
            id: usuarioId, nome: usuario.nome || '', perfil: usuario.tipo_perfil || '',
            email: usuario.email || '', assinaturaId, assinatura_status: assinatura.status,
            statusEnvio: statusEn
        });

        linhas += `
            <tr data-usuario-id="${usuarioId}"
                data-assinatura-id="${assinaturaId}"
                data-perfil="${usuario.tipo_perfil || ''}"
                data-status-envio="${statusEn}">
                <td><input type="checkbox" class="chk-usuario-envio" ${statusEn !== 'enviado' ? 'checked' : ''} /></td>
                <td>${usuario.nome || ''}</td>
                <td>${usuario.tipo_perfil || ''}</td>
                <td>${usuario.email || ''}</td>
                <td>${assinatura.status}</td>
                <td>${badgeEnvio}</td>
            </tr>`;
    }

    if (!usuariosFiltraveis.length) {
        corpo.innerHTML = "<tr><td colspan='6'>Nenhum usuário encontrado com os filtros aplicados.</td></tr>";
        mostrarMensagem('Nenhum usuário com assinatura ativa encontrado para esta newsletter.');
    } else {
        corpo.innerHTML = linhas;
    }

    mostrarAba('secao-envio-usuarios');
}
window.listarUsuariosComAssinaturas = listarUsuariosComAssinaturas;

function filtrarUsuariosEnvio() {
    if (!window.newsletterSelecionada) {
        mostrarMensagem('Selecione uma newsletter primeiro.');
        return;
    }
    listarUsuariosComAssinaturas(window.newsletterSelecionada.id);
}
window.filtrarUsuariosEnvio = filtrarUsuariosEnvio;

// ─── Checkboxes master ────────────────────────────────────────────────────────

function selecionarTodosLeads(chkMaster) {
    document.querySelectorAll('.chk-lead-envio').forEach(c => { c.checked = chkMaster.checked; });
}
function selecionarTodosUsuarios(chkMaster) {
    document.querySelectorAll('.chk-usuario-envio').forEach(c => { c.checked = chkMaster.checked; });
}
function selecionarTodosEnvios(chkMaster) {
    document.querySelectorAll('.chk-envio-final').forEach(c => { c.checked = chkMaster.checked; });
}
function selecionarTodosEnvioFinalLeads(chkMaster) {
    document.querySelectorAll('#tabela-preview-envio .chk-envio-final').forEach(c => { c.checked = chkMaster.checked; });
}
function selecionarTodosEnvioFinal(chkMaster) {
    document.querySelectorAll('#tabela-preview-envio .chk-envio-final').forEach(c => { c.checked = chkMaster.checked; });
}
window.selecionarTodosLeads         = selecionarTodosLeads;
window.selecionarTodosUsuarios      = selecionarTodosUsuarios;
window.selecionarTodosEnvios        = selecionarTodosEnvios;
window.selecionarTodosEnvioFinalLeads = selecionarTodosEnvioFinalLeads;
window.selecionarTodosEnvioFinal    = selecionarTodosEnvioFinal;

// ─── Gérar Prévia — Leads ─────────────────────────────────────────────────────
// fix #C4: verifica envios em UMA query (não N queries)

async function gerarPreviaEnvio() {
    if (!window.newsletterSelecionada) {
        mostrarMensagem('Selecione uma newsletter primeiro.');
        return;
    }

    const corpo     = document.querySelector('#tabela-preview-envio tbody');
    const cabecalho = document.querySelector('#tabela-preview-envio thead tr');

    cabecalho.innerHTML = `
        <th><input type="checkbox" id="chk-master-preview-leads"
            onclick="selecionarTodosEnvioFinalLeads(this)" title="Selecionar todos" /> Enviar?</th>
        <th>Nome</th><th>Perfil</th><th>Email</th>
        <th>Newsletter</th><th>Interesses</th>
        <th class="col-compativel">Compatível</th>
        <th class="col-enviado">Já enviado?</th>`;

    corpo.innerHTML = "<tr><td colspan='8'>Gerando prévia...</td></tr>";

    const linhasLeads = Array.from(document.querySelectorAll('#tabela-leads-envio tbody tr'));
    const selecionados = linhasLeads.filter(tr => tr.querySelector('.chk-lead-envio')?.checked);

    if (selecionados.length === 0) {
        mostrarMensagem('Nenhum lead selecionado. Aplique os filtros e selecione os destinatários.');
        corpo.innerHTML = "<tr><td colspan='8'>Nenhum lead selecionado.</td></tr>";
        return;
    }

    // ── Query única para status de envio de todos os leads selecionados ────────
    const ids = selecionados.map(tr => tr.dataset.leadId).filter(Boolean);
    const { data: enviosData } = await window.supabase
        .from('leads_envios')
        .select('lead_id, status')
        .eq('newsletter_id', window.newsletterSelecionada.id)
        .in('lead_id', ids);

    const enviadosMap = {};
    (enviosData || []).forEach(r => { enviadosMap[String(r.lead_id)] = r.status; });

    const frag = document.createDocumentFragment();

    for (const tr of selecionados) {
        const leadId     = tr.dataset.leadId;
        const nome       = tr.children[1].textContent.trim();
        const email      = tr.children[2].textContent.trim();
        const perfil     = tr.children[3].textContent.trim();
        const interesses = tr.children[4].textContent.trim();

        const tipoNL  = (window.newsletterSelecionada?.tipo || '').toLowerCase();
        const intArr  = interesses.toLowerCase().split(',').map(i => i.trim());
        const compativel = intArr.includes(tipoNL);

        const statusEnvio = enviadosMap[String(leadId)] || 'nao-enviado';
        const enviada     = statusEnvio === 'enviado';
        const erroEnvio   = statusEnvio === 'erro';
        const precisaEnviar = compativel && !enviada;

        const statusTexto = enviada ? 'Sim' : erroEnvio ? 'Erro ao enviar' : 'Não';

        const row = document.createElement('tr');
        row.dataset.leadId     = leadId;
        row.dataset.newsletterId = window.newsletterSelecionada.id;
        row.dataset.perfil     = perfil;
        row.dataset.compativel = compativel ? 'true' : 'false';
        row.dataset.statusEnvio = statusEnvio;
        if (enviada) row.classList.add('tr-enviado');
        if (erroEnvio) row.classList.add('tr-erro');

        row.innerHTML = `
            <td><input type="checkbox" class="chk-envio-final" ${precisaEnviar ? 'checked' : ''} /></td>
            <td>${nome}</td><td>${perfil}</td><td>${email}</td>
            <td>${window.newsletterSelecionada.titulo || ''}</td>
            <td>${interesses}</td>
            <td class="col-compativel">${compativel ? '✅' : '❌'}</td>
            <td class="col-enviado">${statusTexto}</td>`;

        frag.appendChild(row);
    }

    corpo.innerHTML = '';
    corpo.appendChild(frag);

    aplicarFiltroPreviewEnvio();
    _bindFiltrosPreview();
    mostrarAba('secao-preview-envio');
    document.querySelector('#tabela-preview-envio').style.display = 'table';
    document.querySelector('#tabela-preview-envio-destinatario').style.display = 'none';
}
window.gerarPreviaEnvio = gerarPreviaEnvio;

// ─── Gerar Prévia — Usuários ──────────────────────────────────────────────────
// fix: queries agrupadas em vez de N queries individuais

async function gerarPreviaEnvioUsuarios() {
    if (!window.newsletterSelecionada) {
        mostrarMensagem('Selecione uma newsletter primeiro.');
        return;
    }

    const corpo     = document.querySelector('#tabela-preview-envio tbody');
    const cabecalho = document.querySelector('#tabela-preview-envio thead tr');

    cabecalho.innerHTML = `
        <th><input type="checkbox" id="chk-master-preview"
            onclick="selecionarTodosEnvioFinal(this)" title="Selecionar todos" /> Enviar?</th>
        <th>Nome</th><th>Perfil</th><th>Email</th>
        <th>Newsletter</th><th>Tipos selecionados</th>
        <th class="col-pagamento">Assinatura</th>
        <th class="col-enviado">Já enviado?</th>`;

    corpo.innerHTML = "<tr><td colspan='8'>Gerando prévia...</td></tr>";

    const selecionados = Array.from(document.querySelectorAll('.chk-usuario-envio:checked'))
        .map(chk => {
            const tr = chk.closest('tr');
            return {
                usuarioId:   tr.dataset.usuarioId,
                assinaturaId: tr.dataset.assinaturaId,
                nome:  tr.children[1]?.innerText.trim() || '',
                perfil: tr.dataset.perfil || '',
                email: tr.children[3]?.innerText.trim() || '',
            };
        });

    if (selecionados.length === 0) {
        corpo.innerHTML = "<tr><td colspan='8'>Nenhum usuário selecionado para prévia.</td></tr>";
        return;
    }

    // ── Query única para status de envio ──────────────────────────────────────
    // Busca os envios desta newsletter para todos os usuários selecionados
    const enviadosMap  = {};
    try {
        const snapEnvios = await db.collectionGroup('envios')
            .where('newsletter_id', '==', window.newsletterSelecionada.id)
            .get();
        snapEnvios.forEach(d => {
            const uid = d.ref.parent?.parent?.parent?.parent?.id;
            if (uid) enviadosMap[uid] = d.data().status || 'enviado';
        });
    } catch (e) {
        console.warn('Falha ao carregar envios:', e);
    }

    // ── Tipos selecionados por assinatura (batch) ─────────────────────────────
    const mapa          = await obterMapaNomesTipos();
    const interessesMap = {};
    const interessesIds = {};

    await Promise.all(selecionados.map(async u => {
        try {
            const docAss = await db.collection('usuarios').doc(u.usuarioId)
                .collection('assinaturas').doc(u.assinaturaId).get();
            if (docAss.exists) {
                const ids = docAss.data().tipos_selecionados || [];
                interessesIds[`${u.usuarioId}|${u.assinaturaId}`] = ids;
                interessesMap[`${u.usuarioId}|${u.assinaturaId}`] = ids.map(id => mapa[id] || id).join(', ') || 'Nenhum';
            }
        } catch (e) { /* não fatal */ }
    }));

    const tipoNLId     = window.newsletterSelecionada.tipo_id || window.newsletterSelecionada.tipo;
    const tituloNL     = window.newsletterSelecionada.titulo  || '(sem título)';
    const frag         = document.createDocumentFragment();

    for (const u of selecionados) {
        const key         = `${u.usuarioId}|${u.assinaturaId}`;
        const statusEnvio = enviadosMap[u.usuarioId] || 'nao-enviado';
        const enviada     = statusEnvio === 'enviado';
        const erroEnvio   = statusEnvio === 'erro';
        const compativel  = (interessesIds[key] || []).includes(tipoNLId);
        const precisaEnviar = !enviada;
        const statusTexto = enviada ? 'Sim' : erroEnvio ? 'Erro ao enviar' : 'Não';

        const tr = document.createElement('tr');
        tr.dataset.usuarioId    = u.usuarioId;
        tr.dataset.assinaturaId = u.assinaturaId;
        tr.dataset.newsletterId = window.newsletterSelecionada.id;
        tr.dataset.perfil       = u.perfil;
        tr.dataset.statusEnvio  = statusEnvio;
        tr.dataset.compativel   = compativel ? 'true' : 'false';
        if (enviada) tr.classList.add('tr-enviado');
        if (erroEnvio) tr.classList.add('tr-erro');

        tr.innerHTML = `
            <td><input type="checkbox" class="chk-envio-final" ${precisaEnviar ? 'checked' : ''} /></td>
            <td>${u.nome}</td><td>${u.perfil}</td><td>${u.email}</td>
            <td>${tituloNL}</td>
            <td>${interessesMap[key] || '-'}</td>
            <td>${compativel ? '✅ Sim' : '❌ Não'}</td>
            <td class="col-enviado">${statusTexto}</td>`;

        frag.appendChild(tr);
    }

    corpo.innerHTML = '';
    corpo.appendChild(frag);

    aplicarFiltroPreviewEnvio();
    _bindFiltrosPreview();
    mostrarAba('secao-preview-envio');
    document.querySelector('#tabela-preview-envio').style.display = 'table';
    document.querySelector('#tabela-preview-envio-destinatario').style.display = 'none';
}
window.gerarPreviaEnvioUsuarios = gerarPreviaEnvioUsuarios;

// ─── Filtros da prévia ────────────────────────────────────────────────────────

function _bindFiltrosPreview() {
    document.querySelectorAll('.filtro-preview').forEach(chk => {
        if (!chk.dataset.listenerAdicionado) {
            chk.addEventListener('change', aplicarFiltroPreviewEnvio);
            chk.dataset.listenerAdicionado = 'true';
        }
    });
    const perfilSel = document.getElementById('filtro-perfil-lead');
    if (perfilSel && !perfilSel.dataset.listenerAdicionado) {
        perfilSel.addEventListener('change', aplicarFiltroPreviewEnvio);
        perfilSel.dataset.listenerAdicionado = 'true';
    }
}

function aplicarFiltroPreviewEnvio() {
    const filtros = Array.from(document.querySelectorAll('.filtro-preview:checked')).map(f => f.value);
    const perfilSel = document.getElementById('filtro-perfil-lead')?.value || '';
    const linhas    = document.querySelectorAll('#tabela-preview-envio tbody tr');

    const usarFiltro = filtros.length > 0 || perfilSel;
    let tot = { visiveis:0, compativeis:0, naoCompativeis:0, enviados:0, naoEnviados:0, erros:0 };

    for (const linha of linhas) {
        const compativel  = linha.dataset.compativel === 'true';
        const statusEnvio = linha.dataset.statusEnvio;
        const perfilLead  = linha.dataset.perfil || '';
        const enviada     = statusEnvio === 'enviado';
        const erroEnvio   = statusEnvio === 'erro';
        const naoEnviado  = statusEnvio === 'nao-enviado';

        let mostrar = true;
        if (usarFiltro) {
            if (filtros.includes('compativeis')     && !compativel)  mostrar = false;
            if (filtros.includes('nao-compativeis') && compativel)   mostrar = false;
            if (filtros.includes('enviados')        && !enviada)     mostrar = false;
            if (filtros.includes('nao-enviados')    && !naoEnviado)  mostrar = false;
            if (filtros.includes('erro-envio')      && !erroEnvio)   mostrar = false;
            if (perfilSel && perfilLead !== perfilSel) mostrar = false;
        }

        linha.style.display = mostrar ? 'table-row' : 'none';
        if (compativel) tot.compativeis++; else tot.naoCompativeis++;
        if (enviada)    tot.enviados++;
        if (naoEnviado) tot.naoEnviados++;
        if (erroEnvio)  tot.erros++;
        if (mostrar)    tot.visiveis++;
    }

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('contador-compativeis',    tot.compativeis);
    set('contador-nao-enviados',   tot.naoEnviados);
    set('contador-enviados',       tot.enviados);
    set('contador-nao-compativeis', tot.naoCompativeis);
    set('contador-erro-envio',     tot.erros);
    set('contador-visiveis',       tot.visiveis);
}
window.aplicarFiltroPreviewEnvio = aplicarFiltroPreviewEnvio;

function limparFiltrosPreview() {
    document.querySelectorAll('.filtro-preview').forEach(c => { c.checked = false; });
    const p = document.getElementById('filtro-perfil-lead');
    if (p) p.value = '';
    aplicarFiltroPreviewEnvio();
}
window.limparFiltrosPreview = limparFiltrosPreview;

// ─── Exportar CSV da prévia ───────────────────────────────────────────────────

function exportarCSVPrevia() {
    const linhas   = document.querySelectorAll('#tabela-preview-envio tbody tr');
    const visiveis = Array.from(linhas).filter(l => l.style.display !== 'none');
    if (visiveis.length === 0) { mostrarMensagem('Nenhum dado visível para exportar.'); return; }

    const csv = ['Nome;Email;Newsletter;Interesses;Compatível;Enviado?'];
    for (const l of visiveis) {
        csv.push([
            l.cells[1]?.textContent.trim(),
            l.cells[3]?.textContent.trim(),
            l.cells[4]?.textContent.trim(),
            l.cells[5]?.textContent.trim(),
            l.cells[6]?.textContent.trim(),
            l.cells[7]?.textContent.trim(),
        ].join(';'));
    }

    const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href     = URL.createObjectURL(blob);
    link.download = `previa_envio_${Date.now()}.csv`;
    link.click();
}
window.exportarCSVPrevia = exportarCSVPrevia;

// ─── Compatibilidade ──────────────────────────────────────────────────────────

function verificarCompatibilidadeNewsletter(destinatario, newsletter) {
    if (destinatario.assinatura_status) {
        if (newsletter.classificacao === 'premium' && destinatario.assinatura_status !== 'ativo') return false;
        if (['cancelada', 'expirada'].includes(destinatario.assinatura_status)) return false;
        return true;
    }
    if (newsletter.classificacao === 'premium') return false;
    if (destinatario.receber_newsletter === false) return false;
    return true;
}
window.verificarCompatibilidadeNewsletter = verificarCompatibilidadeNewsletter;

// ─── Configurar botões da prévia ──────────────────────────────────────────────

function configurarBotoesPrevia(contexto) {
    const div = document.getElementById('botoes-envio-padrao');
    if (div) div.style.display = contexto === 'envio' ? 'flex' : 'none';
}
window.configurarBotoesPrevia = configurarBotoesPrevia;

function voltarParaEnvio() {
    if (window.tipoDestinatarioSelecionado === 'leads')    mostrarAba('secao-envio-leads');
    else if (window.tipoDestinatarioSelecionado === 'usuarios') mostrarAba('secao-envio-usuarios');
    else mostrarAba('secao-newsletters-envio');
}
window.voltarParaEnvio = voltarParaEnvio;

function voltarParaPrevia() {
    mostrarAba('secao-preview-envio');
    document.querySelector('#tabela-preview-envio').style.display = 'table';
    document.querySelector('#tabela-preview-envio-destinatario').style.display = 'none';
}
window.voltarParaPrevia = voltarParaPrevia;

// ─── Modal de confirmação de geração de lotes ─────────────────────────────────

let dadosCampanha = null;

function abrirModalConfirmacao(newsletter, filtros, totalSelecionados, haReenvio) {
    dadosCampanha = { newsletterId: newsletter.id, filtros };
    const tipo    = filtros.tipo === 'leads' ? 'Leads' : 'Usuários';
    const avisoReenvio = haReenvio
        ? '\n⚠️ ATENÇÃO: Um ou mais destinatários já receberam esta newsletter. O envio será feito assim mesmo.'
        : '';

    const info = `📰 Newsletter: ${newsletter.titulo} (${newsletter.edicao || newsletter.id})\n` +
                 `👥 Tipo: ${tipo}\n` +
                 `📬 Destinatários selecionados: ${totalSelecionados}` +
                 avisoReenvio;

    const infoEl = document.getElementById('info-campanha');
    if (infoEl) infoEl.innerText = info;

    const modal = document.getElementById('modal-confirmacao');
    if (modal) modal.style.display = 'flex';
}

function fecharModal() {
    const modal = document.getElementById('modal-confirmacao');
    if (modal) modal.style.display = 'none';
    dadosCampanha = null;
}

function fecharModalErrosEncontrados() {
    const m = document.getElementById('alert-modal');
    if (m) m.style.display = 'none';
    dadosCampanha = null;
}

async function prosseguirGeracao() {
    const modal = document.getElementById('modal-confirmacao');
    if (modal) modal.style.display = 'none';
    if (dadosCampanha && typeof window.confirmarPrevia === 'function') {
        try {
            await window.confirmarPrevia(dadosCampanha.newsletterId, dadosCampanha.filtros);
        } finally {
            dadosCampanha = null;
        }
    }
}

window.fecharModal                = fecharModal;
window.fecharModalErrosEncontrados = fecharModalErrosEncontrados;
window.prosseguirGeracao          = prosseguirGeracao;

// ─── Coletar filtros ativos ───────────────────────────────────────────────────

function coletarFiltros() {
    if (window.tipoDestinatarioSelecionado === 'leads') {
        return {
            tipo:       'leads',
            nome:       document.getElementById('filtro-nome')?.value.trim().toLowerCase()          || '',
            email:      document.getElementById('filtro-email')?.value.trim().toLowerCase()         || '',
            perfil:     document.getElementById('filtro-perfil')?.value.trim().toLowerCase()        || '',
            preferencias: document.getElementById('filtro-tipo-news-envio')?.value.trim().toLowerCase() || '',
            status:     document.getElementById('filtro-status-lead')?.value.trim().toLowerCase()   || '',
            uf:         document.getElementById('filtro-uf-lead')?.value                            || '',
            statusEnvio: document.getElementById('filtro-status-envio-lead')?.value                 || '',
        };
    }
    if (window.tipoDestinatarioSelecionado === 'usuarios') {
        return {
            tipo:       'usuarios',
            nome:       document.getElementById('filtro-usuario-nome')?.value.trim().toLowerCase()  || '',
            email:      document.getElementById('filtro-usuario-email')?.value.trim().toLowerCase() || '',
            assinatura: document.getElementById('filtro-assinatura')?.value.trim().toLowerCase()    || '',
            uf:         document.getElementById('filtro-uf-usuario')?.value                         || '',
            statusEnvio: document.getElementById('filtro-status-envio-usuario')?.value              || '',
        };
    }
    return { tipo: null };
}
window.coletarFiltros = coletarFiltros;

// ─── Botão Gerar Lotes ────────────────────────────────────────────────────────

function onClickGerarLotes() {
    const newsletter = window.newsletterSelecionada;
    if (!newsletter) { mostrarMensagem('Nenhuma newsletter selecionada.'); return; }

    const filtros = coletarFiltros();
    if (!filtros) { mostrarMensagem('Erro ao coletar filtros.'); return; }

    const linhasSelecionadas = Array.from(document.querySelectorAll('.chk-envio-final:checked'));
    const totalSelecionados  = linhasSelecionadas.length;

    if (totalSelecionados === 0) {
        mostrarMensagem('Nenhum destinatário selecionado para envio.');
        return;
    }

    // Verifica se há reenvios (destinatários que já receberam)
    const haReenvio = linhasSelecionadas.some(chk => {
        const tr = chk.closest('tr');
        return tr?.dataset.statusEnvio === 'enviado';
    });

    // Reenvio em massa bloqueado — só 1 permitido
    if (haReenvio && totalSelecionados > 1) {
        mostrarMensagem('⚠️ Há destinatários que já receberam esta newsletter selecionados junto com outros. Reenvio em massa não é permitido. Para reenviar, selecione apenas 1 destinatário por vez.');
        return;
    }

    abrirModalConfirmacao(newsletter, filtros, totalSelecionados, haReenvio);
}

// ─── Confirmar Prévia — cria os lotes no Firestore ───────────────────────────
// fix: numeração de lote usa contador atômico (sem race condition)
// fix: data_publicacao NÃO é alterada aqui

async function confirmarPrevia(newsletterId, filtros) {
    const btn = document.getElementById('btn-gerar-lotes');
    _setBtnEnviando(btn, true);

    try {
        const tamanhoLote = parseInt(document.getElementById('tamanho-lote')?.value) || 100;

        const linhasSelecionadas = Array.from(document.querySelectorAll('.chk-envio-final:checked'))
            .map(chk => chk.closest('tr'));

        const destinatarios = linhasSelecionadas.map(tr => {
            const tipo = window.tipoDestinatarioSelecionado;
            return {
                id:    tipo === 'leads' ? tr.dataset.leadId : tr.dataset.usuarioId,
                nome:  tr.children[1].innerText.trim(),
                email: tr.children[3].innerText.trim(),
                tipo,
                ...(tipo === 'usuarios' && { assinaturaId: tr.dataset.assinaturaId }),
            };
        });

        if (destinatarios.length === 0) {
            mostrarMensagem('Nenhum destinatário selecionado.');
            return;
        }

        // Cria o documento de envio (campanha)
        const envioRef = db.collection('newsletters').doc(newsletterId)
            .collection('envios').doc();
        const envioId  = envioRef.id;

        await envioRef.set({
            status:            'pendente',
            tipo:              filtros.tipo,
            total_destinatarios: destinatarios.length,
            total_lotes:       Math.ceil(destinatarios.length / tamanhoLote),
            tamanho_lote:      tamanhoLote,
            enviados:          0,
            erros:             0,
            abertos:           0,
            data_geracao:      firebase.firestore.Timestamp.now(),
        });

        // Numeração de lote com contador atômico (fix race condition)
        const contadorRef   = db.collection('config_envios').doc('contador_lotes');
        const totalLotes    = Math.ceil(destinatarios.length / tamanhoLote);
        let primeiroNumero  = 1;

        try {
            const resultado = await db.runTransaction(async tx => {
                const snap = await tx.get(contadorRef);
                const atual = snap.exists ? (snap.data().ultimo_numero || 0) : 0;
                tx.set(contadorRef, { ultimo_numero: atual + totalLotes }, { merge: true });
                return atual + 1; // primeiro número desta campanha
            });
            primeiroNumero = resultado;
        } catch (e) {
            // Fallback: usa timestamp para evitar conflito visual (não crítico)
            primeiroNumero = Date.now();
            console.warn('Falha no contador atômico, usando fallback:', e);
        }

        // Cria os lotes
        let numero = primeiroNumero;
        const batch = db.batch();

        for (let i = 0; i < destinatarios.length; i += tamanhoLote) {
            const chunk   = destinatarios.slice(i, i + tamanhoLote);
            const loteRef = envioRef.collection('lotes').doc();

            batch.set(loteRef, {
                numero_lote:  numero,
                status:       'pendente',
                quantidade:   chunk.length,
                enviados:     0,
                erros:        0,
                abertos:      0,
                destinatarios: chunk,
                data_geracao: firebase.firestore.Timestamp.now(),
            });

            batch.set(db.collection('lotes_gerais').doc(), {
                newsletterId:  window.newsletterSelecionada.id,
                envioId,
                loteId:        loteRef.id,
                titulo:        window.newsletterSelecionada.titulo,
                edicao:        window.newsletterSelecionada.edicao || window.newsletterSelecionada.id,
                data_geracao:  firebase.firestore.Timestamp.now(),
                numero_lote:   numero,
                tipo:          filtros.tipo,
                status:        'pendente',
                quantidade:    chunk.length,
                enviados:      0,
                erros:         0,
            });

            numero++;
        }

        await batch.commit();

        const lotesGerados = numero - primeiroNumero;
        mostrarMensagem(`✅ Campanha criada: ${destinatarios.length} destinatário(s) em ${lotesGerados} lote(s).`);
        await listarLotesEnvio(newsletterId, envioId);
        mostrarAba('secao-lotes-envio');

    } catch (err) {
        console.error('Erro em confirmarPrevia:', err);
        mostrarMensagem('❌ Erro ao gerar lotes: ' + err.message);
    } finally {
        _setBtnEnviando(btn, false);
    }
}
window.confirmarPrevia = confirmarPrevia;

// ─── Listar lotes de um envio ─────────────────────────────────────────────────

let envioSelecionadoId = null;
window.envioSelecionadoId = envioSelecionadoId;

async function listarLotesEnvio(newsletterId, envioId) {
    envioSelecionadoId = envioId;
    const corpo = document.getElementById('corpo-lotes-envio');
    corpo.innerHTML = "<tr><td colspan='9'>Carregando lotes...</td></tr>";

    const filtroDataTipo  = document.getElementById('filtro-data-tipo')?.value || 'geracao';
    const filtroDataInicio = document.getElementById('filtro-data-inicio')?.value;
    const filtroDataFim   = document.getElementById('filtro-data-fim')?.value;
    const campoData       = filtroDataTipo === 'geracao' ? 'data_geracao' : 'data_envio';

    let query = db.collection('newsletters').doc(newsletterId)
        .collection('envios').doc(envioId)
        .collection('lotes').orderBy('numero_lote');

    if (filtroDataInicio) {
        const [a, m, d] = filtroDataInicio.split('-');
        query = query.where(campoData, '>=', new Date(a, m - 1, d, 0, 0, 0));
    }
    if (filtroDataFim) {
        const [a, m, d] = filtroDataFim.split('-');
        query = query.where(campoData, '<=', new Date(a, m - 1, d, 23, 59, 59));
    }

    const snap = await query.get();
    let linhas = '';

    for (const doc of snap.docs) {
        const lote    = doc.data();
        const loteId  = doc.id;
        const dtGer   = lote.data_geracao?.toDate ? lote.data_geracao.toDate() : null;
        const dtEnv   = lote.data_envio?.toDate   ? lote.data_envio.toDate()   : null;
        const progresso = lote.quantidade > 0 ? Math.round((lote.enviados / lote.quantidade) * 100) : 0;

        linhas += `
            <tr>
                <td>${lote.numero_lote}</td>
                <td>${lote.status}</td>
                <td>${lote.quantidade}</td>
                <td>${lote.enviados}</td>
                <td>${lote.erros || 0}</td>
                <td>${dtGer ? dtGer.toLocaleString() : '-'}</td>
                <td>${dtEnv ? dtEnv.toLocaleString() : '-'}</td>
                <td>
                    <div class="barra-progresso">
                        <div class="preenchimento" style="width:${progresso}%">${progresso}%</div>
                    </div>
                </td>
                <td>
                    <button onclick="verDestinatariosLoteUnificado('${loteId}')">👥 Ver</button>
                    <button onclick="enviarLoteEmMassa('${newsletterId}','${envioId}','${loteId}')"
                            class="btn-enviar-lote">🚀 Enviar</button>
                    <button onclick="verHistoricoEnvios('${newsletterId}','${envioId}','${loteId}')">📜 Log</button>
                </td>
            </tr>`;
    }

    corpo.innerHTML = linhas || "<tr><td colspan='9'>Nenhum lote encontrado.</td></tr>";
}
window.listarLotesEnvio = listarLotesEnvio;

// ─── Ver todos os lotes ───────────────────────────────────────────────────────
// fix #I5: sem collectionGroup("envios_log") global — logs buscados por lote

async function listarTodosOsLotes() {
    const corpo = document.getElementById('corpo-todos-os-lotes');
    corpo.innerHTML = "<tr><td colspan='11'>Carregando lotes...</td></tr>";

    const filtroNewsletter = document.getElementById('filtro-newsletter')?.value || '';
    const filtroTipo       = document.getElementById('filtro-tipo')?.value       || '';
    const filtroStatus     = document.getElementById('filtro-status')?.value     || '';
    const filtroDataTipo   = document.getElementById('filtro-data-tipo')?.value  || 'geracao';
    const filtroDataInicio = document.getElementById('filtro-data-inicio')?.value;
    const filtroDataFim    = document.getElementById('filtro-data-fim')?.value;
    const campoData        = filtroDataTipo === 'geracao' ? 'data_geracao' : 'data_envio';

    let query = db.collection('lotes_gerais').orderBy(campoData, 'desc').limit(200);

    if (filtroNewsletter) query = query.where('newsletterId', '==', filtroNewsletter);
    if (filtroTipo)       query = query.where('tipo',          '==', filtroTipo);
    if (filtroStatus)     query = query.where('status',        '==', filtroStatus);
    if (filtroDataInicio) {
        const [a, m, d] = filtroDataInicio.split('-');
        query = query.where(campoData, '>=', new Date(a, m - 1, d, 0, 0, 0));
    }
    if (filtroDataFim) {
        const [a, m, d] = filtroDataFim.split('-');
        query = query.where(campoData, '<=', new Date(a, m - 1, d, 23, 59, 59));
    }

    const snap = await query.get();

    corpo.innerHTML = snap.empty
        ? "<tr><td colspan='11'>Nenhum lote encontrado com os filtros aplicados.</td></tr>"
        : snap.docs.map(doc => {
            const lote = doc.data();
            const dtGer = lote.data_geracao?.toDate ? lote.data_geracao.toDate() : null;
            const dtEnv = lote.data_envio?.toDate   ? lote.data_envio.toDate()   : null;
            const prog  = lote.quantidade > 0 ? Math.round((lote.enviados / lote.quantidade) * 100) : 0;

            return `
                <tr>
                    <td>${lote.titulo || '-'}</td>
                    <td>${lote.edicao || '-'}</td>
                    <td>${dtGer ? dtGer.toLocaleString() : '-'}</td>
                    <td>${dtEnv ? dtEnv.toLocaleString() : '-'}</td>
                    <td>${lote.numero_lote}</td>
                    <td>${lote.tipo}</td>
                    <td>${lote.status}</td>
                    <td><div class="barra-progresso"><div class="preenchimento" style="width:${prog}%">${prog}%</div></div></td>
                    <td>${lote.quantidade}</td>
                    <td>${lote.enviados}</td>
                    <td>
                        <button onclick="verDestinatariosLoteUnificado('${lote.loteId}')">👥 Ver</button>
                        <button onclick="enviarLoteEmMassa('${lote.newsletterId}','${lote.envioId}','${lote.loteId}')">🚀 Enviar</button>
                        <button onclick="verHistoricoEnvios('${lote.newsletterId}','${lote.envioId}','${doc.id}')">📜 Log</button>
                    </td>
                </tr>`;
        }).join('');

    mostrarAba('secao-todos-os-lotes');
}
window.listarTodosOsLotes = listarTodosOsLotes;

function abrirTelaTodosOsLotes() {
    preencherFiltroNewsletters();
    listarTodosOsLotes();
}
window.abrirTelaTodosOsLotes = abrirTelaTodosOsLotes;

// ─── Abrir lotes gerados da newsletter atual ──────────────────────────────────

function abrirLotesGerados() {
    if (!window.newsletterSelecionada?.id) {
        mostrarMensagem('Nenhuma newsletter selecionada.');
        return;
    }
    db.collection('newsletters').doc(window.newsletterSelecionada.id)
        .collection('envios')
        .where('tipo', '==', window.tipoDestinatarioSelecionado)
        .orderBy('data_geracao', 'desc')
        .limit(1)
        .get()
        .then(snap => {
            if (snap.empty) {
                mostrarMensagem('Nenhum lote encontrado para este tipo.');
                return;
            }
            const envio = snap.docs[0];
            envioSelecionadoId = envio.id;
            listarLotesEnvio(window.newsletterSelecionada.id, envio.id);
            mostrarAba('secao-lotes-envio');
        })
        .catch(err => mostrarMensagem('❌ Erro ao carregar lotes: ' + err.message));
}
window.abrirLotesGerados = abrirLotesGerados;

// ─── ENVIO EM MASSA (única função de envio) ───────────────────────────────────
//
// Responsabilidades do frontend:
//   • Lê lote e newsletter do Firestore
//   • fix #C1: verifica duplicidade antes de inserir (ON CONFLICT)
//   • fix #C2: envia apenas metadados — backend monta o HTML
//   • fix #I4: desabilita botão durante o envio
//   • Reenvio individual: permitido apenas quando lote tem 1 destinatário
//     OU operador selecionou apenas 1 na prévia (via confirmarPrevia)
// ─────────────────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 10;

async function enviarLoteEmMassa(newsletterId, envioId, loteId) {
    // Guard anti-duplo-clique
    if (_envioEmAndamento) {
        mostrarMensagem('⏳ Envio já em andamento. Aguarde a conclusão.');
        return;
    }
    _envioEmAndamento = true;

    // Desabilita todos os botões de envio na tela
    document.querySelectorAll('.btn-enviar-lote').forEach(b => { b.disabled = true; });

    _limparLogProgresso();

    try {
        const [loteSnap, newsletterSnap] = await Promise.all([
            db.collection('newsletters').doc(newsletterId)
              .collection('envios').doc(envioId)
              .collection('lotes').doc(loteId).get(),
            db.collection('newsletters').doc(newsletterId).get(),
        ]);

        if (!loteSnap.exists)      { mostrarMensagem('❌ Lote não encontrado.');      return; }
        if (!newsletterSnap.exists){ mostrarMensagem('❌ Newsletter não encontrada.'); return; }

        const lote          = loteSnap.data();
        const destinatarios = lote.destinatarios || [];

        if (destinatarios.length === 0) { mostrarMensagem('⚠️ Nenhum destinatário no lote.'); return; }

        const eReenvio      = lote.enviados > 0;
        const numeroLote    = lote.numero_lote || loteId;
        const usuarioLogado = JSON.parse(localStorage.getItem('usuarioLogado') || '{}');
        const operador      = usuarioLogado?.nome || usuarioLogado?.email || 'Desconhecido';

        // Reenvio: só permitido para lotes com 1 destinatário
        if (eReenvio && destinatarios.length > 1) {
            mostrarMensagem('⚠️ Reenvio em massa não permitido. Para reenviar, gere um novo lote com apenas 1 destinatário selecionado.');
            return;
        }

        if (eReenvio) {
            const confirmar = confirm(`⚠️ Este lote já foi enviado antes.\n\nDestinatário: ${destinatarios[0].email}\n\nConfirma o REENVIO?`);
            if (!confirmar) return;
        }

        _logProgresso(`Preparando ${destinatarios.length} destinatário(s) para o lote nº ${numeroLote}...`);

        // ── Cria registros "pendente" e monta payload de metadados ────────────
        // fix #C2: não monta HTML aqui — backend recebe apenas metadados
        const payloadEmails = [];
        let totalIgnorados  = 0;

        for (let i = 0; i < destinatarios.length; i += CHUNK_SIZE) {
            const chunk = destinatarios.slice(i, i + CHUNK_SIZE);

            const settled = await Promise.allSettled(
                chunk.map(async (dest) => {
                    const tipo         = dest.tipo || (dest.assinaturaId ? 'usuarios' : 'leads');
                    const emailDest    = (dest.email || '').trim();
                    const idDest       = dest.id || '';
                    const assinaturaId = dest.assinaturaId || null;
                    const token        = gerarTokenAcesso();
                    const expiraEm     = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

                    let registroEnvioId;

                    if (tipo === 'leads') {
                        // fix #C1: usa upsert para evitar duplicata
                        const { data, error } = await window.supabase
                            .from('leads_envios')
                            .upsert({
                                lead_id:       idDest,
                                newsletter_id: newsletterId,
                                data_envio:    new Date().toISOString(),
                                status:        'pendente',
                                token_acesso:  token,
                                expira_em:     expiraEm.toISOString(),
                            }, {
                                onConflict:    'lead_id,newsletter_id',
                                ignoreDuplicates: !eReenvio, // reenvio: atualiza; envio normal: ignora duplicata
                            })
                            .select('id')
                            .single();

                        if (error) throw new Error(`Supabase upsert falhou para ${emailDest}: ${error.message}`);
                        if (!data) throw new Error(`Sem retorno para ${emailDest} (possível duplicata ignorada)`);
                        registroEnvioId = String(data.id);

                    } else {
                        const envioRef = await db
                            .collection('usuarios').doc(idDest)
                            .collection('assinaturas').doc(assinaturaId)
                            .collection('envios')
                            .add({
                                newsletter_id:  newsletterId,
                                data_envio:     firebase.firestore.Timestamp.now(),
                                status:         'pendente',
                                destinatarioId: idDest,
                                assinaturaId,
                                token_acesso:   token,
                                expira_em:      firebase.firestore.Timestamp.fromDate(expiraEm),
                                ultimo_acesso:  null,
                                acessos_totais: 0,
                            });
                        registroEnvioId = envioRef.id;
                    }

                    // Payload de metadados apenas (sem HTML)
                    return {
                        envioId:        registroEnvioId,
                        destinatarioId: idDest,
                        tipo,
                        assinaturaId,
                        email:          emailDest,
                        nome:           dest.nome,
                        token,
                        assunto:        newsletterSnap.data().titulo || 'Newsletter Radar SIOPE',
                    };
                })
            );

            settled.forEach((s, idx) => {
                if (s.status === 'fulfilled' && s.value) {
                    payloadEmails.push(s.value);
                } else {
                    totalIgnorados++;
                    const email = chunk[idx]?.email || `índice ${i + idx}`;
                    _logProgresso(`⚠️ Ignorado: ${email} — ${s.reason?.message || 'duplicata ou erro'}`, 'aviso');
                }
            });

            _logProgresso(`Preparados ${Math.min(i + CHUNK_SIZE, destinatarios.length)}/${destinatarios.length}...`);
        }

        if (payloadEmails.length === 0) {
            _logProgresso('⚠️ Nenhum destinatário pôde ser processado.', 'aviso');
            mostrarMensagem('⚠️ Nenhum destinatário processado. Verifique o log.');
            return;
        }

        // ── Envia para o backend ─────────────────────────────────────────────
        _logProgresso(`📤 Enviando ${payloadEmails.length} e-mail(s) via SES...`);

        const response = await fetch('https://api.radarsiope.com.br/api/sendBatchViaSES', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ newsletterId, envioId, loteId, operador, emails: payloadEmails }),
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Erro backend: ${response.status}`);

        const { enviados = 0, total = payloadEmails.length, status = '?' } = result;

        const msgFinal = totalIgnorados > 0
            ? `✅ Lote nº ${numeroLote}: ${enviados}/${total} enviados (${status}). ⚠️ ${totalIgnorados} ignorado(s).`
            : `✅ Lote nº ${numeroLote}: ${enviados}/${total} enviados (${status}).`;

        _logProgresso(msgFinal, 'ok');
        mostrarMensagem(msgFinal);
        return result;

    } catch (err) {
        console.error('Erro ao enviar lote em massa:', err);
        _logProgresso(`❌ ${err.message}`, 'erro');
        mostrarMensagem('❌ Erro ao enviar lote: ' + err.message);
    } finally {
        _envioEmAndamento = false;
        document.querySelectorAll('.btn-enviar-lote').forEach(b => { b.disabled = false; });
    }
}
window.enviarLoteEmMassa = enviarLoteEmMassa;

// ─── Ver destinatários do lote ────────────────────────────────────────────────

async function verDestinatariosLoteUnificado(loteId) {
    document.querySelector('#tabela-preview-envio')?.style.setProperty('display', 'none');
    const tabelaDest = document.querySelector('#tabela-preview-envio-destinatario');
    if (tabelaDest) tabelaDest.style.display = 'table';

    const corpo = document.querySelector('#tabela-preview-envio-destinatario tbody');
    corpo.innerHTML = "<tr><td colspan='4'>Carregando destinatários...</td></tr>";

    try {
        const loteSnap = await db.collection('lotes_gerais')
            .where('loteId', '==', loteId).limit(1).get();

        if (loteSnap.empty) { mostrarMensagem('❌ Lote não encontrado.'); return; }

        const { newsletterId, envioId, titulo, numero_lote } = loteSnap.docs[0].data();

        const cabecalhoEl = document.querySelector('#cabecalho-newsletter-destinatario');
        if (cabecalhoEl) cabecalhoEl.innerHTML = `<h3>Destinatários — ${titulo || '-'} (Lote ${numero_lote || '-'})</h3>`;

        const doc = await db.collection('newsletters').doc(newsletterId)
            .collection('envios').doc(envioId)
            .collection('lotes').doc(loteId).get();

        if (!doc.exists) { mostrarMensagem('❌ Lote não encontrado na newsletter.'); return; }

        const destinatarios = doc.data().destinatarios || [];
        if (destinatarios.length === 0) {
            corpo.innerHTML = '<tr><td colspan="4">Nenhum destinatário.</td></tr>';
            return;
        }

        // Busca status de envio em uma query
        const idsLeads = destinatarios.filter(d => !d.assinaturaId).map(d => String(d.id));
        let mapaEnvioLead = {};
        if (idsLeads.length > 0) {
            const { data } = await window.supabase
                .from('leads_envios')
                .select('lead_id, status')
                .eq('newsletter_id', newsletterId)
                .in('lead_id', idsLeads);
            (data || []).forEach(r => { mapaEnvioLead[String(r.lead_id)] = r.status; });
        }

        let linhas = '';
        destinatarios.forEach(d => {
            const statusEnvio = d.assinaturaId
                ? '-'
                : (mapaEnvioLead[String(d.id)] || 'nao-enviado');
            linhas += `
                <tr>
                    <td>${d.nome || '-'}</td>
                    <td>${d.email || '-'}</td>
                    <td>${d.tipo || (d.assinaturaId ? 'usuario' : 'lead')}</td>
                    <td>${statusEnvio}</td>
                </tr>`;
        });

        corpo.innerHTML = linhas;
        mostrarAba('secao-preview-envio');
        configurarBotoesPrevia('visualizacao');

    } catch (err) {
        console.error('Erro ao listar destinatários:', err);
        corpo.innerHTML = '<tr><td colspan="4">Erro ao carregar destinatários.</td></tr>';
    }
}
window.verDestinatariosLoteUnificado = verDestinatariosLoteUnificado;

// ─── Histórico de envios do lote ──────────────────────────────────────────────
// fix #I5: query scoped ao lote (não collectionGroup global)

async function verHistoricoEnvios(newsletterId, envioId, loteId) {
    const corpo = document.getElementById('corpo-historico-reenvios');
    corpo.innerHTML = "<tr><td colspan='5'>Carregando histórico...</td></tr>";

    const snap = await db.collection('newsletters').doc(newsletterId)
        .collection('envios').doc(envioId)
        .collection('lotes').doc(loteId)
        .collection('envios_log')
        .orderBy('data_envio', 'desc')
        .get();

    if (snap.empty) {
        corpo.innerHTML = "<tr><td colspan='5'>Nenhum envio registrado para este lote.</td></tr>";
    } else {
        corpo.innerHTML = snap.docs.map(doc => {
            const log = doc.data();
            const dt  = log.data_envio?.toDate ? log.data_envio.toDate() : null;
            return `
                <tr>
                    <td>${dt ? dt.toLocaleString() : '-'}</td>
                    <td>${log.quantidade}</td>
                    <td>${log.enviados}</td>
                    <td>${log.status}</td>
                    <td>${log.operador}</td>
                </tr>`;
        }).join('');
    }

    mostrarAba('secao-historico-reenvios');
}
window.verHistoricoEnvios = verHistoricoEnvios;

// ─── Relatório de envios ──────────────────────────────────────────────────────

async function carregarRelatorioEnvios() {
    const emailFiltro = document.getElementById('filtro-relatorio-email')?.value.trim().toLowerCase() || '';
    const corpo       = document.querySelector('#tabela-relatorio-envios tbody');
    corpo.innerHTML   = "<tr><td colspan='5'>Buscando...</td></tr>";

    if (!emailFiltro) {
        corpo.innerHTML = "<tr><td colspan='5'>Informe um e-mail para buscar.</td></tr>";
        return;
    }

    // Busca o lead pelo e-mail
    const { data: leads } = await window.supabase
        .from('leads')
        .select('id, nome, email')
        .ilike('email', `%${emailFiltro}%`)
        .limit(10);

    if (!leads || leads.length === 0) {
        corpo.innerHTML = "<tr><td colspan='5'>Nenhum lead encontrado com este e-mail.</td></tr>";
        return;
    }

    const leadIds  = leads.map(l => l.id);
    const { data: envios } = await window.supabase
        .from('leads_envios')
        .select('lead_id, newsletter_id, data_envio, status')
        .in('lead_id', leadIds)
        .order('data_envio', { ascending: false })
        .limit(100);

    if (!envios || envios.length === 0) {
        corpo.innerHTML = "<tr><td colspan='5'>Nenhum envio registrado para este e-mail.</td></tr>";
        return;
    }

    const mapaLeads = {};
    leads.forEach(l => { mapaLeads[l.id] = l; });

    // Busca títulos das newsletters em lote
    const nlIds  = [...new Set(envios.map(e => e.newsletter_id))];
    const nlsMap = {};
    await Promise.all(nlIds.map(async nid => {
        try {
            const s = await db.collection('newsletters').doc(nid).get();
            if (s.exists) nlsMap[nid] = s.data().titulo || '(sem título)';
        } catch (e) { /* não fatal */ }
    }));

    corpo.innerHTML = envios.map(e => {
        const lead = mapaLeads[e.lead_id] || {};
        const dt   = e.data_envio ? new Date(e.data_envio).toLocaleString('pt-BR') : '-';
        return `
            <tr>
                <td>${lead.nome || '-'}</td>
                <td>${lead.email || '-'}</td>
                <td>${nlsMap[e.newsletter_id] || e.newsletter_id}</td>
                <td>${dt}</td>
                <td>${e.status || '-'}</td>
            </tr>`;
    }).join('');
}
window.carregarRelatorioEnvios = carregarRelatorioEnvios;

// ─── Descadastramentos ────────────────────────────────────────────────────────

async function listarDescadastramentos() {
    const corpo = document.querySelector('#tabela-descadastramentos tbody');
    corpo.innerHTML = "<tr><td colspan='5'>Carregando...</td></tr>";

    const leadsSnap = await db.collection('leads').where('status', '==', 'Descartado').get();
    let linhas = '';

    for (const leadDoc of leadsSnap.docs) {
        const lead   = leadDoc.data();
        const leadId = leadDoc.id;
        if (!leadId) continue;

        const descSnap = await db.collection('leads').doc(leadId)
            .collection('descadastramentos').orderBy('data', 'desc').get();

        if (descSnap.empty) {
            linhas += `<tr><td>${lead.nome||''}</td><td>${lead.email||''}</td><td>-</td><td>-</td><td><em>Descartado manualmente</em></td></tr>`;
            continue;
        }

        for (const descDoc of descSnap.docs) {
            const desc = descDoc.data();
            let nlTitulo = '-';
            if (desc.newsletter_id) {
                try {
                    const nlSnap = await db.collection('newsletters').doc(desc.newsletter_id).get();
                    nlTitulo = nlSnap.exists ? (nlSnap.data().titulo || '-') : '-';
                } catch (e) { /* não fatal */ }
            }
            const dt = desc.data?.toDate?.() || desc.data;
            linhas += `<tr>
                <td>${lead.nome||''}</td><td>${lead.email||''}</td>
                <td>${nlTitulo}</td>
                <td>${dt ? formatDateBR(dt) : '-'}</td>
                <td>${desc.motivo||'-'}</td>
            </tr>`;
        }
    }

    corpo.innerHTML = linhas || "<tr><td colspan='5'>Nenhum descadastramento encontrado.</td></tr>";
}
window.listarDescadastramentos = listarDescadastramentos;

function abrirAbaDescadastramentos() { mostrarAba('secao-descadastramentos'); listarDescadastramentos(); }
function abrirAbaOrientacoes()        { mostrarAba('secao-orientacoes'); }
window.abrirAbaDescadastramentos = abrirAbaDescadastramentos;
window.abrirAbaOrientacoes       = abrirAbaOrientacoes;

// ─── Preenchimento de filtros ─────────────────────────────────────────────────

async function preencherFiltroNewsletters() {
    const sel = document.getElementById('filtro-newsletter');
    if (!sel) return;
    sel.innerHTML = '<option value="">Todas as newsletters</option>';
    const snap = await db.collection('newsletters').get();
    snap.docs.forEach(doc => {
        const n = doc.data();
        const opt = document.createElement('option');
        opt.value       = doc.id;
        opt.textContent = `${n.titulo || '(sem título)'} (${n.edicao || doc.id})`;
        sel.appendChild(opt);
    });
}
window.preencherFiltroNewsletters = preencherFiltroNewsletters;

// ─── Montagem de HTML da newsletter para envio ────────────────────────────────

function montarHtmlNewsletterParaEnvio(newsletter, dados, segmento = null) {
    let htmlBase   = newsletter.html_conteudo || '';
    const blocos   = newsletter.blocos || [];
    let htmlBlocos = '';

    blocos.forEach(b => {
        if (segmento && b.acesso !== 'todos' && b.acesso !== segmento) return;
        if (b.destino === 'app') return;
        htmlBlocos += b.html || '';
    });

    let htmlFinal = blocos.length === 0
        ? htmlBase.replace(/\{\{blocos\}\}/g, '')
        : (htmlBase.includes('{{blocos}}')
            ? htmlBase.replace(/\{\{blocos\}\}/g, htmlBlocos || '')
            : htmlBase + '\n' + htmlBlocos);

    return aplicarPlaceholders(htmlFinal, dados);
}
window.montarHtmlNewsletterParaEnvio = montarHtmlNewsletterParaEnvio;

// ─── Rastreamento de links e pixel ────────────────────────────────────────────

function aplicarRastreamento(htmlBase, envioId, destinatarioId, newsletterId, assinaturaId, token) {
    const pixelTag = `<img src="https://api.radarsiope.com.br/api/pixel?envioId=${encodeURIComponent(envioId)}&destinatarioId=${encodeURIComponent(destinatarioId)}&newsletterId=${encodeURIComponent(newsletterId)}" width="1" height="1" style="display:none" alt="" />`;
    let html = htmlBase + pixelTag;

    const parts = [
        `nid=${newsletterId||''}`, `env=${envioId||''}`, `uid=${destinatarioId||''}`
    ];
    if (assinaturaId) parts.push(`assinaturaId=${assinaturaId}`);
    if (token)        parts.push(`token=${token}`);
    const b64      = btoa(parts.join('&'));
    const linkApp  = `https://app.radarsiope.com.br/verNewsletterComToken.html?d=${encodeURIComponent(b64)}`;

    html = html.replace(/href="([^"]*verNewsletterComToken\.html[^"]*)"/i, () => `href="${linkApp}"`);

    html = html.replace(/href="([^"]+)"/g, (m, href) => {
        const u = String(href).trim();
        if (/^(mailto:|tel:|javascript:|#)|descadastramento\.html|vernewslettercomtoken\.html|\/api\/click/i.test(u)) return m;
        let destino = u;
        try { destino = decodeURIComponent(u); } catch (e) { /* mantém */ }
        const track = `https://api.radarsiope.com.br/api/click?envioId=${encodeURIComponent(envioId)}&destinatarioId=${encodeURIComponent(destinatarioId)}&newsletterId=${encodeURIComponent(newsletterId)}&url=${encodeURIComponent(destino)}`;
        return `href="${track}"`;
    });

    return html;
}
window.aplicarRastreamento = aplicarRastreamento;

// ─── Inicialização (único DOMContentLoaded) ───────────────────────────────────

function _initEventos() {
    // Tipo de destinatário
    const selDest = document.getElementById('tipo-destinatario');
    if (selDest) selDest.addEventListener('change', e => alterarTipoDestinatario(e.target.value));

    // Botão abrir envio
    const btnAbrir = document.querySelector('#botaoEnvioNewsletterLeads');
    if (btnAbrir) btnAbrir.addEventListener('click', abrirEnvioNewsletterLeads);

    // Botão gerar lotes
    const btnGerar = document.getElementById('btn-gerar-lotes');
    if (btnGerar) {
        btnGerar.removeEventListener('click', onClickGerarLotes);
        btnGerar.addEventListener('click', onClickGerarLotes);
    }

    // Modal de confirmação
    const btnProsseguir = document.getElementById('btn-prosseguir-geracao');
    if (btnProsseguir) {
        btnProsseguir.removeEventListener('click', prosseguirGeracao);
        btnProsseguir.addEventListener('click', prosseguirGeracao);
    }

    window.fecharModal                 = fecharModal;
    window.fecharModalErrosEncontrados = fecharModalErrosEncontrados;
    window.prosseguirGeracao           = prosseguirGeracao;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initEventos);
} else {
    _initEventos();
}
