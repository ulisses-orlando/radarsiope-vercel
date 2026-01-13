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
    <div><strong>Data de envio:</strong> ${escapeHtml(dataEnvioStr)}</div>
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
                const status = a.status || a.st || '';
                const email = a.email || a.to || a.destinatario || '';
                return `- ${id} | ${status} | ${email}`;
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

        if (!lista || !statusEl || !btnExecutar) {
            return;
        }

        // limpa UI e bloqueia botão
        lista.innerHTML = '';
        statusEl.textContent = 'Executando verificação...';
        btnExecutar.disabled = true;

        try {
            // 1) buscar lotes gerais pendentes
            const lotesSnap = await db.collection('lotes_gerais').where('status', '==', 'pendente').get();

            const detalhes = [];

            for (const loteDoc of lotesSnap.docs) {
                try {
                    const loteData = loteDoc.data() || {};
                    const loteId = loteDoc.id;
                    const numero_lote = loteData.numero_lote || null;
                    const tipo = loteData.tipo || null; // 'leads' | 'usuarios' expected
                    const envioId = loteData.envioId || loteData.envioID || loteData.envio || null;
                    const newsletterId = loteData.newsletterId || loteData.newsletter || null;

                    // 2) buscar envio no caminho apropriado conforme tipo
                    let envioDoc = null;
                    let envioDataObj = null;
                    try {
                        if (tipo === 'leads' && envioId) {
                            envioDoc = await db.collection('leads').doc('envios').collection('docs').doc(envioId).get().catch(() => null);
                            // NOTE: se sua estrutura for leads/envios/{envioId} sem subcoleção 'docs', ajuste para:
                            // envioDoc = await db.collection('leads').doc('envios').collection('...')...
                            // Para robustez, tentamos dois caminhos abaixo se o primeiro for nulo.
                            if (!envioDoc || !envioDoc.exists) {
                                // fallback: leads/envios/{envioId}
                                envioDoc = await db.collection('leads').doc('envios').get().catch(() => null);
                            }
                        } else if (tipo === 'usuarios' && envioId) {
                            // caminho: usuarios/assinaturas/envios/{envioId}
                            envioDoc = await db.collection('usuarios').doc('assinaturas').collection('envios').doc(envioId).get().catch(() => null);
                            if (!envioDoc || !envioDoc.exists) {
                                // fallback: usuarios/assinaturas/{some}/envios/{envioId} not known; try direct path
                                envioDoc = await db.collection('usuarios').doc('assinaturas').doc('envios').collection('docs').doc(envioId).get().catch(() => null);
                            }
                        } else if (envioId) {
                            // fallback genérico: tenta newsletters/envios/{envioId}
                            envioDoc = await db.collection('newsletters').doc(newsletterId || 'unknown').collection('envios').doc(envioId).get().catch(() => null);
                        }
                    } catch (e) {
                        envioDoc = null;
                    }

                    if (envioDoc && envioDoc.exists) {
                        envioDataObj = envioDoc.data() || {};
                    }

                    // 3) buscar newsletter (se newsletterId presente) para pegar edicao/titulo
                    let newsletterTitle = null;
                    let edicao = null;
                    if (newsletterId) {
                        try {
                            const newsDoc = await db.collection('newsletters').doc(newsletterId).get();
                            if (newsDoc && newsDoc.exists) {
                                const nd = newsDoc.data() || {};
                                newsletterTitle = nd.titulo || nd.title || nd.name || null;
                                edicao = nd.edicao || nd.edition || null;
                            }
                        } catch (e) {
                            newsletterTitle = null;
                            edicao = null;
                        }
                    }

                    // se edicao não veio da newsletter, tenta do envio
                    if (!edicao && envioDataObj) {
                        edicao = envioDataObj.edicao || envioDataObj.edition || null;
                    }

                    // 4) tentar ler amostra de envios dentro do lote (se houver subcoleção)
                    let amostra = [];
                    try {
                        const amostraSnap = await loteDoc.ref.collection('envios').limit(5).get();
                        if (!amostraSnap.empty) {
                            amostra = amostraSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
                        } else if (envioDoc && envioDoc.exists) {
                            // se não há subcoleção, incluir o envioDoc como amostra única
                            amostra = [{ id: envioDoc.id, ...(envioDataObj || {}) }];
                        }
                    } catch (e) {
                        amostra = [];
                    }

                    const envioData = envioDataObj && envioDataObj.data_envio ? (envioDataObj.data_envio.toDate ? envioDataObj.data_envio.toDate() : new Date(envioDataObj.data_envio)) : null;

                    const item = {
                        loteId,
                        lotePath: loteDoc.ref.path,
                        numero_lote,
                        tipo,
                        envioId,
                        newsletterId,
                        newsletterTitle,
                        edicao,
                        envioData,
                        status: loteData.status,
                        totalEnvios: (loteData.total !== undefined && loteData.total !== null) ? loteData.total : (loteData.enviados !== undefined ? loteData.enviados : (amostra.length ? amostra.length : null)),
                        amostra
                    };

                    detalhes.push(item);
                } catch (errItem) {
                    // ignora item com problema e continua
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

            // garante layout visível (se modal estiver aberto)
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
        // item: objeto completo gerado por carregarLotesPendentes
        if (!item || !item.loteId) throw new Error('Item de lote inválido');

        // referências
        const loteGeralRef = db.collection('lotes_gerais').doc(item.loteId);
        const now = firebase.firestore.Timestamp.now();

        // 1) tenta ler subcoleção envios dentro do lote (se existir)
        let enviosInLoteSnap = null;
        try {
            enviosInLoteSnap = await loteGeralRef.collection('envios').get();
        } catch (e) {
            enviosInLoteSnap = null;
        }

        // 2) prepara batch para atualizações
        let batch = db.batch();
        let writes = 0;
        let enviadosCount = 0;
        let totalEnvios = 0;

        if (enviosInLoteSnap && !enviosInLoteSnap.empty) {
            // atualiza cada envio dentro do lote
            totalEnvios = enviosInLoteSnap.size;
            for (const envioDoc of enviosInLoteSnap.docs) {
                const d = envioDoc.data() || {};
                const envioRef = loteGeralRef.collection('envios').doc(envioDoc.id);
                const statusAtual = d.status || null;
                const sesMessageId = d.sesMessageId || null;
                const erro = d.erro || null;

                if (sesMessageId && statusAtual !== 'enviado') {
                    batch.set(envioRef, { status: 'enviado', data_envio: now, sesMessageId }, { merge: true });
                    writes++; enviadosCount++;
                } else if (erro && statusAtual !== 'erro') {
                    batch.set(envioRef, { status: 'erro', erro, data_envio: now }, { merge: true });
                    writes++;
                } else if (statusAtual === 'enviado') {
                    enviadosCount++;
                }

                if (writes >= 450) {
                    await batch.commit();
                    batch = db.batch();
                    writes = 0;
                }
            }
        } else {
            // não há subcoleção: atualiza o envio único no caminho conforme tipo
            if (item.tipo === 'leads' && item.envioId) {
                // caminho provável: leads/envios/{envioId}
                const envioRef = db.collection('leads').doc('envios').collection('docs').doc(item.envioId);
                // tenta atualizar o envio (se existir)
                try {
                    const envioSnap = await envioRef.get();
                    if (envioSnap && envioSnap.exists) {
                        const d = envioSnap.data() || {};
                        const statusAtual = d.status || null;
                        const sesMessageId = d.sesMessageId || null;
                        const erro = d.erro || null;
                        if (sesMessageId && statusAtual !== 'enviado') {
                            batch.set(envioRef, { status: 'enviado', data_envio: now, sesMessageId }, { merge: true });
                            writes++; enviadosCount++;
                        } else if (erro && statusAtual !== 'erro') {
                            batch.set(envioRef, { status: 'erro', erro, data_envio: now }, { merge: true });
                            writes++;
                        } else if (statusAtual === 'enviado') {
                            enviadosCount++;
                        }
                        totalEnvios = 1;
                    }
                } catch (e) {
                    // fallback: tentar caminho alternativo leads/envios/{envioId}
                    try {
                        const altRef = db.collection('leads').doc('envios').doc(item.envioId);
                        const altSnap = await altRef.get();
                        if (altSnap && altSnap.exists) {
                            const d = altSnap.data() || {};
                            const statusAtual = d.status || null;
                            const sesMessageId = d.sesMessageId || null;
                            const erro = d.erro || null;
                            if (sesMessageId && statusAtual !== 'enviado') {
                                batch.set(altRef, { status: 'enviado', data_envio: now, sesMessageId }, { merge: true });
                                writes++; enviadosCount++;
                            } else if (erro && statusAtual !== 'erro') {
                                batch.set(altRef, { status: 'erro', erro, data_envio: now }, { merge: true });
                                writes++;
                            } else if (statusAtual === 'enviado') {
                                enviadosCount++;
                            }
                            totalEnvios = 1;
                        }
                    } catch (e2) { /* ignora */ }
                }
            } else if (item.tipo === 'usuarios' && item.envioId) {
                // caminho: usuarios/assinaturas/envios/{envioId}
                const envioRef = db.collection('usuarios').doc('assinaturas').collection('envios').doc(item.envioId);
                try {
                    const envioSnap = await envioRef.get();
                    if (envioSnap && envioSnap.exists) {
                        const d = envioSnap.data() || {};
                        const statusAtual = d.status || null;
                        const sesMessageId = d.sesMessageId || null;
                        const erro = d.erro || null;
                        if (sesMessageId && statusAtual !== 'enviado') {
                            batch.set(envioRef, { status: 'enviado', data_envio: now, sesMessageId }, { merge: true });
                            writes++; enviadosCount++;
                        } else if (erro && statusAtual !== 'erro') {
                            batch.set(envioRef, { status: 'erro', erro, data_envio: now }, { merge: true });
                            writes++;
                        } else if (statusAtual === 'enviado') {
                            enviadosCount++;
                        }
                        totalEnvios = 1;
                    }
                } catch (e) { /* ignora */ }
            } else {
                // tipo desconhecido: tenta atualizar newsletter envio se possível
                if (item.newsletterId && item.envioId) {
                    const envioRef = db.collection('newsletters').doc(item.newsletterId).collection('envios').doc(item.envioId);
                    try {
                        const envioSnap = await envioRef.get();
                        if (envioSnap && envioSnap.exists) {
                            const d = envioSnap.data() || {};
                            const statusAtual = d.status || null;
                            const sesMessageId = d.sesMessageId || null;
                            const erro = d.erro || null;
                            if (sesMessageId && statusAtual !== 'enviado') {
                                batch.set(envioRef, { status: 'enviado', data_envio: now, sesMessageId }, { merge: true });
                                writes++; enviadosCount++;
                            } else if (erro && statusAtual !== 'erro') {
                                batch.set(envioRef, { status: 'erro', erro, data_envio: now }, { merge: true });
                                writes++;
                            } else if (statusAtual === 'enviado') {
                                enviadosCount++;
                            }
                            totalEnvios = 1;
                        }
                    } catch (e) { /* ignora */ }
                }
            }
        }

        // 3) atualizar documento de lote em newsletters (se existir)
        try {
            if (item.newsletterId && item.envioId) {
                const loteRefInNewsletter = db.collection('newsletters').doc(item.newsletterId)
                    .collection('envios').doc(item.envioId)
                    .collection('lotes').doc(item.loteId);
                // define status do lote com base em enviadosCount/totalEnvios
                const statusLote = (totalEnvios && enviadosCount === totalEnvios) ? 'completo' : (enviadosCount > 0 ? 'parcial' : 'pendente');
                batch.set(loteRefInNewsletter, { enviados: enviadosCount, status: statusLote, data_envio: now }, { merge: true });
                writes++;
            }
        } catch (e) {
            // ignora se não existir
        }

        // 4) atualizar documento em lotes_gerais
        try {
            const statusLoteGeral = (totalEnvios && enviadosCount === totalEnvios) ? 'completo' : (enviadosCount > 0 ? 'parcial' : 'pendente');
            batch.set(loteGeralRef, { enviados: enviadosCount, status: statusLoteGeral, data_atualizacao: now }, { merge: true });
            writes++;
        } catch (e) {
            // ignora
        }

        // commit final
        if (writes > 0) {
            await batch.commit();
        }

        // 5) adicionar log de atualização (opcional)
        try {
            await loteGeralRef.collection('envios_log').add({
                data_atualizacao: now,
                enviados: enviadosCount,
                quantidade: totalEnvios,
                origem: 'verificacao_cliente',
                status: (totalEnvios && enviadosCount === totalEnvios) ? 'completo' : (enviadosCount > 0 ? 'parcial' : 'pendente'),
                operador: (firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.email) ? firebase.auth().currentUser.email : 'cliente'
            });
        } catch (e) {
            // ignora falha de log
        }

        // retorna resumo
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
