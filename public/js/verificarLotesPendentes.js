// verificarLotesPendentes.js
// Requisitos: window.db (Firestore) já inicializado; admin.html contém modal com ids:
// modal-verificar-lotes, verificar-status, verificar-lista, btn-executar-verificacao, btn-fechar-modal, fechar-modal-verificar, verificar-hours, verificar-limit, verificar-token
/* eslint-disable no-undef */
(function () {
    const db = window.db;
    if (!db) {
        console.warn('verificarLotesPendentes: window.db (Firestore) não encontrado. Inicialize o Firebase antes deste script.');
        return;
    }

    /* ======================
       Helpers DOM / utilitários
       ====================== */
    function $(id) { return document.getElementById(id); }

    function escapeHtml(str) {
        return String(str || '').replace(/[&<>"']/g, function (m) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
        });
    }

    function mostrarMensagemSimples(msg) {
        if (typeof mostrarMensagem === 'function') {
            mostrarMensagem(msg);
        } else {
            console.info('MSG:', msg);
            const status = $('verificar-status');
            if (status) status.textContent = msg;
        }
    }

    /* ======================
       Modal open/close
       ====================== */
    function abrirModalVerificarLotes(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const modal = $('modal-verificar-lotes');
        if (!modal) return console.warn('modal-verificar-lotes não encontrado');
        if (modal.parentElement !== document.body) document.body.appendChild(modal);
        modal.style.display = 'flex';
        modal.style.zIndex = '2147483647';
        const token = localStorage.getItem('admin_token') || '';
        const t = $('verificar-token');
        if (t && !t.value && token) t.value = token;
        // aplica layout ao abrir
        applyModalLayout();
    }

    function fecharModalVerificarLotes() {
        const modal = $('modal-verificar-lotes');
        if (!modal) return;
        modal.style.display = 'none';
        const status = $('verificar-status');
        const lista = $('verificar-lista');
        if (status) status.innerHTML = '';
        if (lista) lista.innerHTML = '';
    }

    /* ======================
       Layout helper (aplica ajustes para garantir visibilidade)
       ====================== */
    function applyModalLayout() {
        try {
            const modal = $('modal-verificar-lotes');
            if (!modal) return;
            // move para body para evitar stacking context
            if (modal.parentElement !== document.body) document.body.appendChild(modal);

            Object.assign(modal.style, {
                display: 'flex',
                position: 'fixed',
                left: '0',
                top: '0',
                width: '100vw',
                height: '100vh',
                zIndex: '2147483647',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.45)',
                overflow: 'auto',
                padding: '20px',
                boxSizing: 'border-box'
            });

            const content = modal.querySelector('.modal-content') || modal.querySelector('.modal-body') || modal;
            Object.assign(content.style, {
                display: 'flex',
                flexDirection: 'column',
                width: 'min(1100px, 98%)',
                maxHeight: 'calc(100vh - 80px)',
                overflow: 'hidden',
                position: 'relative',
                background: '#fff',
                padding: '16px',
                boxSizing: 'border-box',
                borderRadius: '6px'
            });

            const wrapper = document.getElementById('verificar-resultados') || content;
            Object.assign(wrapper.style, {
                display: 'flex',
                flexDirection: 'column',
                flex: '1 1 auto',
                minHeight: '0'
            });

            const lista = $('verificar-lista');
            if (lista) {
                Object.assign(lista.style, {
                    display: 'block',
                    flex: '1 1 auto',
                    minHeight: '0',
                    maxHeight: 'calc(100vh - 220px)',
                    overflow: 'auto',
                    paddingRight: '8px'
                });
            }
        } catch (e) {
            console.warn('applyModalLayout erro', e);
        }
    }

    /* ======================
       Render / UI
       ====================== */
    function criarLinhaLote(item) {
        // item: { loteId, lotePath, numero_lote, tipo, envioId, newsletterId, newsletterTitle, edicao, envioData, status, totalEnvios, amostra }
        const card = document.createElement('div');
        card.className = 'lote-card';

        const meta = document.createElement('div');
        meta.className = 'lote-meta';

        const titulo = document.createElement('div');
        titulo.innerHTML = `<strong>Lote ${escapeHtml(String(item.numero_lote || item.loteId || '—'))}</strong>`;

        const sub = document.createElement('div');
        sub.style.fontSize = '13px';
        sub.style.color = '#444';
        const newsTitle = item.newsletterTitle ? escapeHtml(item.newsletterTitle) : escapeHtml(item.newsletterId || '');
        const edicao = item.edicao ? escapeHtml(String(item.edicao)) : escapeHtml(item.envioId || '');
        const dataEnvioStr = item.envioData ? (new Date(item.envioData)).toLocaleString() : '—';
        sub.innerHTML = `${newsTitle} <span style="color:#888; margin-left:8px;">| Edição: ${edicao}</span> <span style="color:#888; margin-left:8px;">| Data envio: ${escapeHtml(dataEnvioStr)}</span>`;

        const info = document.createElement('div');
        info.className = 'small-muted';
        const totalDisplay = (item.totalEnvios === null || item.totalEnvios === undefined) ? '—' : item.totalEnvios;
        info.innerHTML = `status: <em>${escapeHtml(item.status || '—')}</em> — total envios: ${totalDisplay}`;

        meta.appendChild(titulo);
        meta.appendChild(sub);
        meta.appendChild(info);

        if (Number(totalDisplay) === 0) {
            const aviso = document.createElement('div');
            aviso.style.color = '#b00020';
            aviso.style.fontSize = '12px';
            aviso.style.marginTop = '6px';
            aviso.textContent = 'Atenção: lote sem envios registrados.';
            meta.appendChild(aviso);
        }

        const actions = document.createElement('div');
        actions.className = 'lote-actions';

        const btnProcessar = document.createElement('button');
        btnProcessar.textContent = 'Atualizar status';
        btnProcessar.className = 'btn-primary';
        btnProcessar.style.padding = '6px 10px';

        const btnDetalhes = document.createElement('button');
        btnDetalhes.textContent = 'Detalhes';
        btnDetalhes.className = 'btn-secondary';
        btnDetalhes.style.padding = '6px 10px';

        const detalhesBox = document.createElement('div');
        detalhesBox.style.display = 'none';
        detalhesBox.style.marginTop = '8px';
        detalhesBox.style.background = '#fafafa';
        detalhesBox.style.padding = '8px';
        detalhesBox.style.borderRadius = '4px';
        detalhesBox.style.border = '1px solid #eee';
        detalhesBox.style.fontSize = '13px';
        detalhesBox.style.color = '#222';

        const detalhesHtml = document.createElement('div');
        detalhesHtml.innerHTML = `
    <div><strong>Newsletter:</strong> ${newsTitle}</div>
    <div><strong>Edição / Envio:</strong> ${edicao} (${escapeHtml(item.envioId || '')})</div>
    <div><strong>Data de geração:</strong> ${escapeHtml(dataEnvioStr)}</div>
    <div><strong>Tipo:</strong> ${item.tipo}</div>
    <div><strong>Lote:</strong> ${escapeHtml(String(item.numero_lote || item.loteId || ''))} (${escapeHtml(item.lotePath || '')})</div>
    <div style="margin-top:8px;"><strong>Total envios:</strong> ${totalDisplay}</div>
  `;
        detalhesBox.appendChild(detalhesHtml);

        const amostraTitle = document.createElement('div');
        amostraTitle.style.marginTop = '8px';
        amostraTitle.style.fontWeight = '600';
        amostraTitle.textContent = 'Amostra de envios (até 5):';
        detalhesBox.appendChild(amostraTitle);

        const amostraPre = document.createElement('pre');
        amostraPre.style.whiteSpace = 'pre-wrap';
        amostraPre.style.wordBreak = 'break-word';
        amostraPre.style.background = '#fff';
        amostraPre.style.padding = '8px';
        amostraPre.style.border = '1px solid #eee';
        amostraPre.style.borderRadius = '4px';
        amostraPre.style.maxHeight = '220px';
        amostraPre.style.overflow = 'auto';

        if (!item.amostra || !item.amostra.length) {
            amostraPre.textContent = 'Nenhuma amostra disponível.';
        } else {
            const linhas = item.amostra.map(a => {
                const id = a.id || '';
                const nome = a.nome || a.st || '';
                const email = a.email || a.to || a.destinatario || '';
                return `ID: ${id} | nome: ${nome} | email: ${email}`;
            });
            amostraPre.textContent = linhas.join('\n');
        }
        detalhesBox.appendChild(amostraPre);

        const resultadoLine = document.createElement('div');
        resultadoLine.className = 'small-muted';
        resultadoLine.style.marginTop = '6px';

        btnDetalhes.onclick = () => {
            detalhesBox.style.display = detalhesBox.style.display === 'none' ? 'block' : 'none';
        };

        btnProcessar.onclick = async () => {
            if (!confirm(`Atualizar status do lote?\n${item.lotePath}\nTotal envios: ${totalDisplay}`)) return;
            resultadoLine.textContent = 'Processando...';
            btnProcessar.disabled = true;
            btnProcessar.dataset.origText = btnProcessar.textContent;
            btnProcessar.textContent = 'Processando…';
            try {
                await atualizarStatusLoteCliente(item);
                resultadoLine.style.color = 'green';
                resultadoLine.textContent = 'Atualização concluída.';
            } catch (err) {
                resultadoLine.style.color = '#b00020';
                resultadoLine.innerHTML = `<strong>Erro:</strong> ${err.message || String(err)}`;
            } finally {
                btnProcessar.disabled = false;
                btnProcessar.textContent = btnProcessar.dataset.origText || 'Atualizar status';
            }
        };

        actions.appendChild(btnProcessar);
        actions.appendChild(btnDetalhes);

        card.appendChild(meta);
        card.appendChild(actions);
        card.appendChild(resultadoLine);
        card.appendChild(detalhesBox);

        return card;
    }



    /* ======================
       Carregar lotes pendentes (sem collectionGroup)
       ====================== */
    async function carregarLotesPendentes() {
        const lista = document.getElementById('verificar-lista');
        const statusEl = document.getElementById('verificar-status');
        const btnExecutar = document.getElementById('btn-executar-verificacao');

        if (!lista || !statusEl || !btnExecutar) return;

        lista.innerHTML = '';
        statusEl.textContent = 'Executando verificação...';
        btnExecutar.disabled = true;

        try {
            const lotesSnap = await db.collection('lotes_gerais').where('status', '==', 'pendente').get();
            const detalhes = [];

            for (const loteDoc of lotesSnap.docs) {
                try {
                    const loteData = loteDoc.data() || {};
                    const loteGeraisId = loteDoc.id;
                    const numero_lote = loteData.numero_lote || null;
                    const tipo = loteData.tipo || null;
                    const envioId = loteData.envioId || loteData.envioID || loteData.envio || null;
                    const newsletterId = loteData.newsletterId || loteData.newsletter || null;
                    const newsletterTitleFromLote = loteData.titulo || loteData.title || null;
                    const edicaoFromLote = loteData.edicao || loteData.edition || null;

                    // --- localizar o documento real do lote usando numero_lote ---
                    let loteRealDoc = null;
                    let loteRealData = null;
                    try {
                        if (newsletterId && envioId && numero_lote != null) {
                            const lotesRef = db
                                .collection('newsletters')
                                .doc(newsletterId)
                                .collection('envios')
                                .doc(envioId)
                                .collection('lotes');

                            // procura por numero_lote igual ao número do lote
                            const q = await lotesRef.where('numero_lote', '==', numero_lote).limit(1).get();
                            if (!q.empty) {
                                loteRealDoc = q.docs[0];
                                loteRealData = loteRealDoc.data() || {};
                            } else {
                                console.warn(`Lote real não encontrado por numero_lote=${numero_lote} em newsletters/${newsletterId}/envios/${envioId}/lotes`);
                            }
                        } else {
                            console.warn(`Dados insuficientes para localizar lote real: newsletterId=${newsletterId}, envioId=${envioId}, numero_lote=${numero_lote}`);
                        }
                    } catch (errFind) {
                        console.warn('Erro ao buscar lote real por numero_lote:', errFind);
                        loteRealDoc = null;
                        loteRealData = null;
                    }

                    // título/edição: prioriza lotes_gerais
                    let newsletterTitle = newsletterTitleFromLote;
                    let edicao = edicaoFromLote;

                    // montar amostra a partir do campo array 'destinatarios' do lote real
                    let amostra = [];
                    try {
                        const loteDestArray = (loteRealData && (loteRealData.destinatarios || loteRealData.destinatario)) || null;
                        if (Array.isArray(loteDestArray) && loteDestArray.length) {
                            amostra = loteDestArray.slice(0, 5).map((d, idx) => ({
                                id: d.id || d.envioId || `dest-${idx}`,
                                nome: d.nome || d.name || null,
                                email: d.email || null,
                                tipo: d.tipo || null,
                                raw: d
                            }));
                        } else {
                            // fallback leve: tentar subcoleção envios/envios_log dentro do loteRealDoc (se existir)
                            /*                             if (loteRealDoc) {
                                                            const snapEnvios = await loteRealDoc.ref.collection('envios').limit(5).get();
                                                            if (!snapEnvios.empty) {
                                                                amostra = snapEnvios.docs.map(d => Object.assign({ id: d.id }, d.data()));
                                                            } else {
                                                                const snapEnviosLog = await loteRealDoc.ref.collection('envios_log').limit(5).get();
                                                                if (!snapEnviosLog.empty) {
                                                                    amostra = snapEnviosLog.docs.map(d => Object.assign({ id: d.id }, d.data()));
                                                                }
                                                            }
                                                        } */
                        }
                    } catch (errAmostra) {
                        console.warn('Erro ao montar amostra:', errAmostra);
                        amostra = [];
                    }

                    // totalEnvios: prioriza campos do lotes_gerais, senão usa tamanho do array do lote real
                    let totalEnvios = null;
                    if (typeof loteData.total === 'number') {
                        totalEnvios = loteData.total;
                    } else if (Array.isArray(loteData.destinatarios)) {
                        totalEnvios = loteData.destinatarios.length;
                    } else if (loteRealData && Array.isArray(loteRealData.destinatarios)) {
                        totalEnvios = loteRealData.destinatarios.length;
                    } else if (typeof loteData.enviados === 'number') {
                        totalEnvios = loteData.enviados;
                    } else if (amostra.length) {
                        totalEnvios = amostra.length;
                    }

                    // data do envio (prioriza lotes_gerais)
                    const envioData = (loteData.data_geracao && loteData.data_geracao.toDate) ? loteData.data_geracao.toDate() :
                        (loteData.data_geracao ? new Date(loteData.data_geracao) : null);

                    const item = {
                        loteGeraisId,
                        loteId: loteRealDoc ? loteRealDoc.id : loteGeraisId, // se não achou, usa id de lotes_gerais
                        lotePath: loteRealDoc ? loteRealDoc.ref.path : loteDoc.ref.path,
                        numero_lote,
                        tipo,
                        envioId,
                        newsletterId,
                        newsletterTitle,
                        edicao,
                        envioData,
                        status: loteData.status,
                        totalEnvios,
                        amostra
                    };

                    detalhes.push(item);
                } catch (errItem) {
                    console.warn('Erro processando lote_gerais:', loteDoc.id, errItem);
                    continue;
                }
            } // fim loop lotes_gerais

            // renderiza
            statusEl.innerHTML = `<strong>Verificados:</strong> ${detalhes.length}`;
            if (!detalhes.length) {
                lista.innerHTML = '<div>Nenhum lote pendente encontrado.</div>';
                return;
            }

            const frag = document.createDocumentFragment();
            for (const item of detalhes) {
                const card = criarLinhaLote(item);
                if (card) frag.appendChild(card);
            }
            lista.appendChild(frag);

            applyModalLayout();
        } catch (err) {
            statusEl.innerHTML = `<strong style="color:crimson">Erro:</strong> ${err.message || String(err)}`;
        } finally {
            btnExecutar.disabled = false;
        }
    }

    /* ======================
       Atualizar status de um lote (client-side, batched writes)
       ====================== */
    async function atualizarStatusLoteCliente(item) {
        if (!item || !item.loteId) throw new Error('Item de lote inválido');

        const now = firebase.firestore.Timestamp.now();
        const loteGeralRef = db.collection('lotes_gerais').doc(item.loteId);
        const sesCol = 'SES_NOTIFICACOES'; // ajuste se sua coleção tiver outro nome

        // destinatarios já deve vir em item (array de objetos { id, email, nome, tipo, ... })
        const destinatarios = Array.isArray(item.destinatarios) ? item.destinatarios : [];
        if (!destinatarios.length) {
            // marca como pendente e retorna
            await loteGeralRef.set({ status: 'pendente', data_atualizacao: now }, { merge: true });
            return { enviadosCount: 0, totalEnvios: 0, note: 'destinatarios vazio' };
        }

        // batch para atualizações
        let batch = db.batch();
        let writes = 0;
        const MAX_WRITES_BEFORE_COMMIT = 450;
        const flushIfNeeded = async () => {
            if (writes >= MAX_WRITES_BEFORE_COMMIT) {
                await batch.commit();
                batch = db.batch();
                writes = 0;
            }
        };

        let enviadosCount = 0;
        const totalEnvios = destinatarios.length;

        // Para reduzir leituras repetidas, vamos tentar buscar notificações por email em paralelo com limite
        // (cada query usa array-contains em mail.destination). Para lotes muito grandes, considere outra estratégia.
        const concurrency = 10; // número de queries paralelas
        const chunks = [];
        for (let i = 0; i < destinatarios.length; i += concurrency) {
            chunks.push(destinatarios.slice(i, i + concurrency));
        }

        for (const chunk of chunks) {
            // executa queries paralelas para este chunk
            const promises = chunk.map(async (dest) => {
                const email = dest.email || null;
                if (!email) return { dest, notif: null, error: 'sem email' };
                try {
                    const q = await db.collection(sesCol).where('mail.destination', 'array-contains', email).limit(1).get().catch(() => null);
                    if (q && !q.empty) return { dest, notif: q.docs[0].data() || null };
                    return { dest, notif: null };
                } catch (e) {
                    return { dest, notif: null, error: e.message || String(e) };
                }
            });

            const results = await Promise.all(promises);

            // processa resultados sequencialmente para aplicar updates em batch
            for (const res of results) {
                const dest = res.dest;
                const notif = res.notif;
                let novoStatus = 'pendente';
                let erroMsg = null;

                if (notif) {
                    const nType = notif.notificationType || (notif.bounce ? 'Bounce' : (notif.complaint ? 'Complaint' : (notif.delivery ? 'Delivery' : null)));
                    if (nType === 'Delivery') novoStatus = 'enviado';
                    else if (nType === 'Bounce' || nType === 'Complaint') {
                        novoStatus = 'erro';
                        if (notif.bounce && notif.bounce.bounceType) erroMsg = notif.bounce.bounceType;
                        else if (notif.complaint && notif.complaint.complaintFeedbackType) erroMsg = notif.complaint.complaintFeedbackType;
                        else erroMsg = nType.toLowerCase();
                    } else novoStatus = 'pendente';
                } else {
                    novoStatus = 'pendente';
                }

                // atualiza coleções conforme tipo
                try {
                    if (item.tipo === 'leads') {
                        // caminho esperado: /leads/{leadId}/envios/{envioId}
                        if (dest.id && item.envioId) {
                            const leadEnvioRef = db.collection('leads').doc(dest.id).collection('envios').doc(item.envioId);
                            const payload = { status: novoStatus };
                            if (novoStatus === 'enviado') payload.data_envio = now;
                            if (erroMsg) payload.erro = erroMsg;
                            batch.set(leadEnvioRef, payload, { merge: true });
                            writes++;
                        } else if (dest.id) {
                            // fallback: /leads/{leadId}
                            const leadRef = db.collection('leads').doc(dest.id);
                            const payload = { status: novoStatus };
                            if (novoStatus === 'enviado') payload.data_envio = now;
                            if (erroMsg) payload.erro = erroMsg;
                            batch.set(leadRef, payload, { merge: true });
                            writes++;
                        }
                    } else if (item.tipo === 'usuarios') {
                        // caminho esperado: /usuarios/{userId}/assinaturas/{assinaturaId}/envios/{envioId}
                        if (dest.id && dest.assinaturaId && item.envioId) {
                            const userEnvioRef = db.collection('usuarios').doc(dest.id)
                                .collection('assinaturas').doc(dest.assinaturaId)
                                .collection('envios').doc(item.envioId);
                            const payload = { status: novoStatus };
                            if (novoStatus === 'enviado') payload.data_envio = now;
                            if (erroMsg) payload.erro = erroMsg;
                            batch.set(userEnvioRef, payload, { merge: true });
                            writes++;
                        } else if (dest.id) {
                            // fallback simples: /usuarios/{userId}
                            const userRef = db.collection('usuarios').doc(dest.id);
                            const payload = { status: novoStatus };
                            if (novoStatus === 'enviado') payload.data_envio = now;
                            if (erroMsg) payload.erro = erroMsg;
                            batch.set(userRef, payload, { merge: true });
                            writes++;
                        }
                    } else {
                        // tipo desconhecido: não atualiza coleções específicas
                    }

                    if (novoStatus === 'enviado') enviadosCount++;
                    await flushIfNeeded();
                } catch (e) {
                    console.warn('Erro atualizando destinatario:', dest, e);
                }
            } // fim processamento chunk
        } // fim chunks

        // atualizar documento do lote em newsletters (se item.lotePath existir)
        try {
            const statusLote = (enviadosCount === totalEnvios) ? 'completo' : (enviadosCount > 0 ? 'parcial' : 'pendente');
            if (item.lotePath) {
                const loteRef = db.doc(item.lotePath);
                batch.set(loteRef, { enviados: enviadosCount, status: statusLote, data_envio: now }, { merge: true });
                writes++;
                await flushIfNeeded();
            }
        } catch (e) {
            console.warn('Erro atualizando lote em newsletters (lotePath):', e);
        }

        // atualizar lotes_gerais
        try {
            const statusLoteGeral = (enviadosCount === totalEnvios) ? 'completo' : (enviadosCount > 0 ? 'parcial' : 'pendente');
            batch.set(loteGeralRef, { enviados: enviadosCount, status: statusLoteGeral, data_atualizacao: now }, { merge: true });
            writes++;
            await flushIfNeeded();
        } catch (e) {
            console.warn('Erro atualizando lotes_gerais:', e);
        }

        // commit final
        if (writes > 0) {
            await batch.commit();
        }

        // log simples (opcional)
        try {
            await loteGeralRef.collection('envios_log').add({
                data_atualizacao: now,
                enviados: enviadosCount,
                quantidade: totalEnvios,
                origem: 'verificacao_ses_notificacoes',
                status: (enviadosCount === totalEnvios) ? 'completo' : (enviadosCount > 0 ? 'parcial' : 'pendente'),
                operador: (firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.email) ? firebase.auth().currentUser.email : 'sistema'
            });
        } catch (e) {
            // ignora falha de log
        }

        return { enviadosCount, totalEnvios };
    }


    /* ======================
       Liga eventos (botões do modal)
       ====================== */
    function ligarEventos() {
        const btnExecutar = $('btn-executar-verificacao');
        const btnFechar = $('btn-fechar-modal');
        const btnFecharX = $('fechar-modal-verificar');
        const modal = $('modal-verificar-lotes');

        if (btnExecutar) btnExecutar.addEventListener('click', carregarLotesPendentes);
        if (btnFechar) btnFechar.addEventListener('click', fecharModalVerificarLotes);
        if (btnFecharX) btnFecharX.addEventListener('click', fecharModalVerificarLotes);

        if (modal) {
            window.addEventListener('click', function (e) {
                if (e.target === modal) fecharModalVerificarLotes();
            });
        }

        // binding para botão do sidebar (id opcional)
        const btnSidebar = document.getElementById('btn-open-verificar-lotes') || document.getElementById('link-verificar-lotes');
        if (btnSidebar) {
            btnSidebar.addEventListener('click', function (ev) {
                if (window._verificarLotes && typeof window._verificarLotes.abrirModalVerificarLotes === 'function') {
                    window._verificarLotes.abrirModalVerificarLotes(ev);
                } else if (typeof abrirModalVerificarLotes === 'function') {
                    abrirModalVerificarLotes(ev);
                } else {
                    console.warn('Função de abrir modal não encontrada.');
                }
            });
        }

    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ligarEventos);
    } else {
        ligarEventos();
    }

    // export público compatível com estilo do cupons.js
    window._verificarLotes = {
        carregarLotesPendentes,
        atualizarStatusLoteCliente,
        abrirModalVerificarLotes,
        fecharModalVerificarLotes
    };
})();

// Exposição global adicional e fallback para compatibilidade com onclick inline
(function ensureGlobalExposure() {
    try {
        if (window._verificarLotes && typeof window._verificarLotes.abrirModalVerificarLotes === 'function') {
            window.abrirModalVerificarLotes = window._verificarLotes.abrirModalVerificarLotes;
        } else if (typeof window.abrirModalVerificarLotes !== 'function' && window._verificarLotes) {
            window.abrirModalVerificarLotes = window._verificarLotes.abrirModalVerificarLotes || function () {
                console.warn('abrirModalVerificarLotes não disponível');
            };
        }
        if (window._verificarLotes && typeof window._verificarLotes.carregarLotesPendentes === 'function') {
            window.executarVerificacao = window._verificarLotes.carregarLotesPendentes;
        }
    } catch (e) {
        console.warn('Erro ao expor funções globalmente:', e);
    }
})();

// Estilos permanentes e ajustes de layout (remova quando não precisar)
(function injectPersistentStyles() {
    try {
        if (document.getElementById('verificar-lotes-style')) return;
        const style = document.createElement('style');
        style.id = 'verificar-lotes-style';
        style.textContent = `
      #verificar-lista { display:block !important; visibility:visible !important; opacity:1 !important; max-height:70vh; overflow:auto; }
      .lote-card { display:block !important; visibility:visible !important; opacity:1 !important; border:1px solid #ddd; background:#fff; margin-bottom:8px; padding:8px; border-radius:4px; }
      .lote-meta { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
      .lote-actions { display:flex; gap:8px; margin-top:8px; }
      .lote-card pre { white-space: pre-wrap; word-break: break-word; }
    `;
        document.head.appendChild(style);
    } catch (e) {
        console.warn('Erro ao injetar estilos persistentes:', e);
    }
})();
