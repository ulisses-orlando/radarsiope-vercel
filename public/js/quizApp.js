/* ==========================================================================
quizApp.js — Módulo de Quiz Interativo por Edição
Integração com: verNewsletterComToken.js + API /api/pagamentoMP?acao=salvar-quiz
========================================================================== */
(function () {
'use strict';

// Configuração do Quiz (vinda do Firestore via newsletter.quiz)
let _config = null;

// Estado da Sessão Atual (RAM)
// Estrutura: { nid, uid, qIndex, answers: [], score: 0, finished: boolean, tentativas: number }
let _state = null;

// Chave para persistência local (evita mostrar card se já completou na aba)
const _localKey = (uid, nid) => `rs_quiz_${uid}_${nid}`;

// ────────────────────────────────────────────────────────────────────────
// PÚBLICO
// ────────────────────────────────────────────────────────────────────────

/**
 * Inicializa o módulo. Deve ser chamado após o carregamento da newsletter e do usuário.
 * @param {Object} newsletter - Objeto da newsletter completa
 * @param {Object} user - Objeto do usuário atual (_radarUser)
 */
function init(newsletter, user) {
    // 1. Validações básicas
    if (!newsletter?.quiz?.ativo) return;
    if (!user?.uid) return;

    _config = newsletter.quiz;

    // 2. Regras de Visibilidade
    // FIX #1: aceita 'assinante' (singular, de _radarUser) e 'assinantes' (plural, de userParaQuiz)
    const isAssinante = user.segmento === 'assinante' || user.segmento === 'assinantes';
    const visivelParaLeads = (_config.visivel_leads === true);

    if (!isAssinante && !visivelParaLeads) return;

    // 3. Verifica se já concluiu (Cache Local)
    if (obteveConclusaoLocal(user.uid, newsletter.id)) return;

    // 4. Renderiza o Card de Convite
    renderizarCardConvite(newsletter.id, user.uid);
}

/**
 * Verifica se o usuário já concluiu o quiz desta edição
 * @param {string} uid
 * @param {string} nid
 * @returns {boolean}
 */
function jaConcluiu(uid, nid) {
    return obteveConclusaoLocal(uid, nid);
}

/**
 * Obtém estatísticas do quiz para exibição (ex: "Você acertou 80%")
 * @param {string} uid
 * @param {string} nid
 * @returns {Object|null}
 */
function getEstatisticas(uid, nid) {
    try {
        const d = localStorage.getItem(_localKey(uid, nid));
        return d ? JSON.parse(d) : null;
    } catch { return null; }
}

// ────────────────────────────────────────────────────────────────────────
// LÓGICA DE UI
// ────────────────────────────────────────────────────────────────────────

function renderizarCardConvite(nid, uid) {
    const ctaWrap = document.getElementById('rs-cta-wrap');
    const app = document.getElementById('rs-app');
    const target = ctaWrap || app;

    if (!target) return;

    // Remove card existente se houver
    const existente = document.getElementById('rs-quiz-cta-card');
    if (existente) existente.remove();

    const card = document.createElement('div');
    card.id = 'rs-quiz-cta-card';
    card.className = 'rs-quiz-cta-card';
    card.innerHTML = `
        <div class="rs-quiz-cta-icon">🧠</div>
        <div class="rs-quiz-cta-content">
            <h3>Teste seus conhecimentos</h3>
            <p>Responda ao quiz desta edição e valide seu aprendizado.</p>
            ${_config.tentativas_max > 1 ? `<span class="rs-quiz-info">Até ${_config.tentativas_max} tentativas permitidas</span>` : ''}
        </div>
        <button id="rs-quiz-btn-iniciar" type="button">Iniciar Quiz →</button>
    `;

    // Injeta CSS se necessário
    injetarEstilosCSS();

    // Insere no DOM
    if (ctaWrap) {
        app.insertBefore(card, ctaWrap);
    } else {
        app.appendChild(card);
    }

    // Evento de Início
    document.getElementById('rs-quiz-btn-iniciar').addEventListener('click', () => {
        abrirQuizModal(nid, uid);
    });
}

function abrirQuizModal(nid, uid) {
    // Remove card de convite para não duplicar
    const card = document.getElementById('rs-quiz-cta-card');
    if (card) card.remove();

    // Inicializa Estado
    _state = {
        nid,
        uid,
        qIndex: 0,
        answers: [],
        score: 0,
        finished: false,
        tentativas: 1
    };

    // Cria Overlay com modal centralizado
    const overlay = document.createElement('div');
    overlay.id = 'rs-quiz-overlay';
    overlay.className = 'rs-quiz-overlay';
    overlay.innerHTML = `
        <div id="rs-quiz-modal" class="rs-quiz-modal" role="dialog" aria-modal="true" aria-labelledby="rs-quiz-title">
            <header id="rs-quiz-header">
                <div class="rs-quiz-header-left">
                    <span class="rs-quiz-badge">Quiz</span>
                    <span id="rs-quiz-title">Pergunta 1</span>
                </div>
                <button id="rs-quiz-fechar" aria-label="Fechar quiz">✕</button>
            </header>

            <div class="rs-quiz-progress-wrap">
                <div class="rs-quiz-progress-bar"><div class="fill" style="width: 0%"></div></div>
            </div>

            <div id="rs-quiz-body">
                <div id="rs-quiz-question-container"></div>
            </div>

            <footer id="rs-quiz-footer"></footer>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Fecha ao clicar no backdrop
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            fecharQuizModal();
            renderizarCardConvite(nid, uid);
        }
    });

    // Bind de Fechar
    document.getElementById('rs-quiz-fechar').addEventListener('click', () => {
        fecharQuizModal();
        renderizarCardConvite(nid, uid);
    });

    renderizarPergunta();
}

function renderizarPergunta() {
    if (!_state || _state.finished) return;

    const perguntas = _config.perguntas;
    const atual = perguntas[_state.qIndex];
    const total = perguntas.length;

    // Atualiza Header/Progresso
    document.getElementById('rs-quiz-title').textContent = `Pergunta ${_state.qIndex + 1} de ${total}`;
    const pct = ((_state.qIndex + 1) / total) * 100;
    document.querySelector('.rs-quiz-progress-bar .fill').style.width = `${pct}%`;

    const container = document.getElementById('rs-quiz-question-container');
    const footer = document.getElementById('rs-quiz-footer');

    footer.style.display = 'none';
    footer.innerHTML = '';

    // FIX #2: campo correto é 'alternativas', não 'opcoes'
    const alternativas = atual.alternativas || [];

    container.innerHTML = `
        <div class="rs-quiz-texto">${atual.pergunta}</div>
        <div class="rs-quiz-opcoes">
            ${alternativas.map((alt, idx) => `
                <button class="rs-quiz-opcao-btn" data-idx="${idx}" type="button">
                    <span class="rs-quiz-opcao-letra">${String.fromCharCode(65 + idx)}</span>
                    <span class="rs-quiz-opcao-texto">${alt}</span>
                </button>
            `).join('')}
        </div>
    `;

    // Bind de Cliques nas Opções
    container.querySelectorAll('.rs-quiz-opcao-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.dataset.idx);
            processarResposta(idx);
        });
    });
}

function processarResposta(idxSelecionado) {
    const perguntas = _config.perguntas;
    const atual = perguntas[_state.qIndex];
    const acertou = (idxSelecionado === parseInt(atual.correta));

    if (acertou) _state.score++;

    // Salva na memória
    _state.answers.push({
        qId: atual.id || _state.qIndex,
        selecionada: idxSelecionado,
        correta: parseInt(atual.correta),
        acertou
    });

    // Feedback Visual — trava botões e colore
    const container = document.getElementById('rs-quiz-question-container');
    const botoes = container.querySelectorAll('.rs-quiz-opcao-btn');

    botoes.forEach(btn => {
        btn.disabled = true;
        const idxBtn = parseInt(btn.dataset.idx);

        if (idxBtn === parseInt(atual.correta)) {
            btn.classList.add('rs-quiz-correta');
        } else if (idxBtn === idxSelecionado && !acertou) {
            btn.classList.add('rs-quiz-errada');
        }
    });

    // Exibe Explicação (se houver)
    if (atual.explicacao) {
        const expDiv = document.createElement('div');
        expDiv.className = 'rs-quiz-explicacao';
        expDiv.innerHTML = `<strong>💡 Explicação:</strong> ${atual.explicacao}`;
        container.appendChild(expDiv);
    }

    // Exibe Botão de Avançar no Footer
    // FIX #3: display 'flex' para que justify-content funcione corretamente
    const footer = document.getElementById('rs-quiz-footer');
    footer.style.display = 'flex';

    const isLast = (_state.qIndex >= perguntas.length - 1);
    const label = isLast ? 'Ver Resultado' : 'Próxima Pergunta →';
    const action = isLast ? finalizarQuiz : proximaPergunta;

    footer.innerHTML = `<button id="rs-quiz-btn-acao" type="button">${label}</button>`;
    document.getElementById('rs-quiz-btn-acao').addEventListener('click', action);
}

function proximaPergunta() {
    _state.qIndex++;
    document.getElementById('rs-quiz-question-container').innerHTML = '';
    renderizarPergunta();
}

async function finalizarQuiz() {
    _state.finished = true;

    const total = _config.perguntas.length;
    const pontuacao = Math.round((_state.score / total) * 100);
    const minimo = _config.pontuacao_minima || 70;
    const aprovado = pontuacao >= minimo;

    await salvarNoBackend({
        pontuacao,
        aprovado,
        tentativas_usadas: _state.tentativas,
        melhor_pontuacao: pontuacao,
        detalhes: _state.answers.map(a => ({
            pergunta_id: a.qId,
            resposta_selecionada: a.selecionada,
            resposta_correta: a.correta,
            acertou: a.acertou
        }))
    });

    renderizarResultado(pontuacao, aprovado, minimo);
}

function renderizarResultado(pontuacao, aprovado, minimo) {
    const body = document.getElementById('rs-quiz-body');
    const footer = document.getElementById('rs-quiz-footer');
    const header = document.getElementById('rs-quiz-header');

    header.style.display = 'none';
    document.querySelector('.rs-quiz-progress-wrap').style.display = 'none';

    body.innerHTML = `
        <div class="rs-quiz-resultado">
            <div class="rs-quiz-resultado-icon">${aprovado ? '🏆' : '📚'}</div>
            <h2 class="rs-quiz-resultado-titulo">${aprovado ? 'Parabéns!' : 'Continue Estudando!'}</h2>
            <div class="rs-quiz-score-circle ${aprovado ? 'aprovado' : 'reprovado'}">
                <span>${pontuacao}%</span>
            </div>
            <p class="rs-quiz-resultado-acertos">
                Você acertou <strong>${_state.score}</strong> de <strong>${_config.perguntas.length}</strong> questões.
            </p>
            <p class="rs-quiz-status-msg">
                ${aprovado
                    ? '✅ Você atingiu a pontuação mínima necessária.'
                    : `📌 A pontuação mínima para aprovação é ${minimo}%.`}
            </p>
        </div>
    `;

    // FIX #3: display 'flex' para que justify-content funcione corretamente
    footer.style.display = 'flex';
    footer.innerHTML = `<button id="rs-quiz-btn-sair" type="button">Fechar e Voltar à Leitura</button>`;
    document.getElementById('rs-quiz-btn-sair').addEventListener('click', fecharQuizModal);
}

function fecharQuizModal() {
    const overlay = document.getElementById('rs-quiz-overlay');
    if (overlay) overlay.remove();
    document.body.style.overflow = '';
    _state = null;
}

// ────────────────────────────────────────────────────────────────────────
// API & PERSISTÊNCIA
// ────────────────────────────────────────────────────────────────────────

async function salvarNoBackend({ pontuacao, aprovado, tentativas_usadas, melhor_pontuacao, detalhes }) {
    if (!_state) return;

    const payload = {
        uid: _state.uid,
        newsletter_id: _state.nid,
        tentativas_usadas: tentativas_usadas || 1,
        melhor_pontuacao: melhor_pontuacao || pontuacao,
        aprovado: aprovado || false,
        detalhes: detalhes || _state.answers.map(a => ({
            pergunta_id: a.qId,
            resposta_selecionada: a.selecionada,
            resposta_correta: a.correta,
            acertou: a.acertou
        }))
    };

    try {
        const resp = await fetch('/api/pagamentoMP?acao=salvar-quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await resp.json().catch(() => ({}));

        marcarConcluidoLocal(_state.uid, _state.nid, {
            completed: true,
            timestamp: Date.now(),
            pontuacao,
            aprovado,
            tentativas: tentativas_usadas
        });

        window.dispatchEvent(new CustomEvent('rs:quizConcluido', {
            detail: { nid: _state.nid, pontuacao, aprovado }
        }));

        return data;
    } catch (err) {
        console.error('[QuizApp] Erro ao salvar resultado:', err);
        marcarConcluidoLocal(_state.uid, _state.nid, {
            completed: true,
            timestamp: Date.now(),
            pontuacao,
            aprovado,
            error: true
        });
        throw err;
    }
}

// ────────────────────────────────────────────────────────────────────────
// HELPERS LOCALSTORAGE
// ────────────────────────────────────────────────────────────────────────

function obterConclusaoLocal(uid, nid) {
    try {
        const d = localStorage.getItem(_localKey(uid, nid));
        return d ? JSON.parse(d) : null;
    } catch { return null; }
}

function marcarConcluidoLocal(uid, nid, dados) {
    try {
        localStorage.setItem(_localKey(uid, nid), JSON.stringify({
            completed: true,
            timestamp: Date.now(),
            ...dados
        }));
    } catch {}
}

function obteveConclusaoLocal(uid, nid) {
    const d = obterConclusaoLocal(uid, nid);
    return d && d.completed === true;
}

// ────────────────────────────────────────────────────────────────────────
// CSS INJECTION
// ────────────────────────────────────────────────────────────────────────

function injetarEstilosCSS() {
    if (document.getElementById('rs-quiz-style')) return;

    const style = document.createElement('style');
    style.id = 'rs-quiz-style';
    style.textContent = `
        /* ── Card de Convite ── */
        .rs-quiz-cta-card {
            background: var(--rs-card2, #162032);
            border: 1px solid rgba(10, 61, 98, 0.5);
            border-radius: 12px;
            padding: 20px;
            margin: 24px 0;
            display: flex;
            align-items: center;
            gap: 16px;
            animation: rsFadeIn 0.4s ease;
        }
        .rs-quiz-cta-icon { font-size: 36px; flex-shrink: 0; }
        .rs-quiz-cta-content { flex: 1; min-width: 0; }
        .rs-quiz-cta-content h3 {
            color: var(--rs-text, #fff);
            margin: 0 0 4px;
            font-size: 15px;
        }
        .rs-quiz-cta-content p {
            color: var(--rs-muted, #94a3b8);
            font-size: 13px;
            margin: 0;
        }
        .rs-quiz-info {
            display: inline-block;
            margin-top: 6px;
            font-size: 11px;
            color: #64748b;
            background: rgba(255,255,255,0.05);
            padding: 2px 8px;
            border-radius: 20px;
        }
        #rs-quiz-btn-iniciar {
            background: var(--azul, #0A3D62);
            color: #fff;
            border: none;
            padding: 10px 18px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            white-space: nowrap;
            flex-shrink: 0;
            transition: background 0.2s, transform 0.15s;
        }
        #rs-quiz-btn-iniciar:hover { background: #0d4f7c; transform: translateY(-1px); }

        /* ── Overlay e Modal Centralizado ── */
        .rs-quiz-overlay {
            position: fixed;
            inset: 0;
            z-index: 10000;
            background: rgba(0, 0, 0, 0.75);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            backdrop-filter: blur(2px);
        }
        .rs-quiz-modal {
            background: var(--rs-card, #1e293b);
            width: 100%;
            max-width: 560px;
            max-height: 90vh;
            border-radius: 16px;
            display: flex;
            flex-direction: column;
            animation: rsScaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            overflow: hidden;
            box-shadow: 0 24px 60px rgba(0,0,0,0.5);
        }

        /* ── Header ── */
        #rs-quiz-header {
            padding: 14px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--rs-borda, rgba(255,255,255,0.08));
        }
        .rs-quiz-header-left {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .rs-quiz-badge {
            background: rgba(10, 61, 98, 0.5);
            color: #60a5fa;
            font-size: 11px;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 20px;
            letter-spacing: 0.05em;
            text-transform: uppercase;
        }
        #rs-quiz-title {
            font-size: 14px;
            font-weight: 600;
            color: var(--rs-muted, #94a3b8);
        }
        #rs-quiz-fechar {
            background: rgba(255,255,255,0.06);
            border: none;
            color: var(--rs-muted, #94a3b8);
            font-size: 16px;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }
        #rs-quiz-fechar:hover { background: rgba(255,255,255,0.12); }

        /* ── Barra de Progresso ── */
        .rs-quiz-progress-wrap { padding: 0 16px 12px; }
        .rs-quiz-progress-bar {
            height: 4px;
            background: rgba(255,255,255,0.08);
            border-radius: 2px;
            overflow: hidden;
        }
        .rs-quiz-progress-bar .fill {
            height: 100%;
            background: linear-gradient(90deg, #0A3D62, #22c55e);
            border-radius: 2px;
            transition: width 0.4s ease;
        }

        /* ── Body / Pergunta ── */
        #rs-quiz-body {
            flex: 1;
            padding: 0 20px 4px;
            overflow-y: auto;
        }
        .rs-quiz-texto {
            font-size: 17px;
            line-height: 1.55;
            color: var(--rs-text, #f1f5f9);
            font-weight: 500;
            margin-bottom: 20px;
            padding-top: 16px;
        }
        .rs-quiz-opcoes { display: flex; flex-direction: column; gap: 10px; }
        .rs-quiz-opcao-btn {
            background: rgba(255,255,255,0.04);
            border: 1.5px solid rgba(255,255,255,0.1);
            padding: 12px 14px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            gap: 12px;
            text-align: left;
            font-size: 14px;
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s;
            color: var(--rs-text, #f1f5f9);
            width: 100%;
        }
        .rs-quiz-opcao-btn:hover:not(:disabled) {
            border-color: var(--azul, #0A3D62);
            background: rgba(10, 61, 98, 0.15);
        }
        .rs-quiz-opcao-btn:disabled { cursor: default; }
        .rs-quiz-opcao-letra {
            width: 26px;
            height: 26px;
            border-radius: 50%;
            background: rgba(255,255,255,0.08);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 700;
            flex-shrink: 0;
            color: var(--rs-muted, #94a3b8);
        }
        .rs-quiz-opcao-texto { flex: 1; line-height: 1.4; }

        /* Estados de Resposta */
        .rs-quiz-correta {
            background: rgba(34, 197, 94, 0.12) !important;
            border-color: #22c55e !important;
        }
        .rs-quiz-correta .rs-quiz-opcao-letra {
            background: #22c55e !important;
            color: #fff !important;
        }
        .rs-quiz-errada {
            background: rgba(239, 68, 68, 0.12) !important;
            border-color: #ef4444 !important;
        }
        .rs-quiz-errada .rs-quiz-opcao-letra {
            background: #ef4444 !important;
            color: #fff !important;
        }

        /* Explicação */
        .rs-quiz-explicacao {
            margin-top: 16px;
            padding: 14px;
            background: rgba(139, 92, 246, 0.1);
            border-left: 3px solid #8b5cf6;
            border-radius: 0 8px 8px 0;
            font-size: 13px;
            color: var(--rs-muted, #94a3b8);
            line-height: 1.55;
        }
        .rs-quiz-explicacao strong { color: #a78bfa; }

        /* ── Footer ── */
        #rs-quiz-footer {
            padding: 14px 20px;
            border-top: 1px solid var(--rs-borda, rgba(255,255,255,0.08));
            display: none;
            justify-content: center;
            background: var(--rs-card2, #162032);
        }
        #rs-quiz-btn-acao, #rs-quiz-btn-sair {
            background: var(--azul, #0A3D62);
            color: #fff;
            border: none;
            padding: 12px 32px;
            border-radius: 8px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            max-width: 320px;
            transition: background 0.2s, transform 0.15s;
        }
        #rs-quiz-btn-acao:hover, #rs-quiz-btn-sair:hover {
            background: #0d4f7c;
            transform: translateY(-1px);
        }

        /* ── Tela de Resultado ── */
        .rs-quiz-resultado { text-align: center; padding: 32px 0 16px; }
        .rs-quiz-resultado-icon { font-size: 56px; margin-bottom: 12px; }
        .rs-quiz-resultado-titulo {
            font-size: 22px;
            font-weight: 700;
            color: var(--rs-text, #f1f5f9);
            margin: 0 0 16px;
        }
        .rs-quiz-score-circle {
            width: 96px;
            height: 96px;
            border-radius: 50%;
            border: 4px solid var(--azul, #0A3D62);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            font-weight: 700;
            color: #fff;
            margin: 0 auto 20px;
            background: rgba(10, 61, 98, 0.2);
        }
        .rs-quiz-score-circle.aprovado { border-color: #22c55e; background: rgba(34, 197, 94, 0.15); }
        .rs-quiz-score-circle.reprovado { border-color: #f59e0b; background: rgba(245, 158, 11, 0.15); }
        .rs-quiz-resultado-acertos {
            font-size: 15px;
            color: var(--rs-text, #f1f5f9);
            margin: 0 0 8px;
        }
        .rs-quiz-status-msg {
            font-size: 13px;
            color: var(--rs-muted, #94a3b8);
            margin: 0;
        }

        /* ── Mobile ── */
        @media (max-width: 480px) {
            .rs-quiz-overlay { padding: 12px 8px; align-items: flex-end; }
            .rs-quiz-modal {
                border-radius: 16px 16px 0 0;
                max-height: 92vh;
                animation: rsSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .rs-quiz-cta-card { flex-direction: column; text-align: center; }
            #rs-quiz-btn-iniciar { width: 100%; }
        }
    `;
    document.head.appendChild(style);
}

// ────────────────────────────────────────────────────────────────────────
// EXPORTAÇÕES GLOBAIS
// ────────────────────────────────────────────────────────────────────────

window.QuizManager = {
    init,
    jaConcluiu,
    getEstatisticas,
    // Para testes/debug
    _getState: () => _state,
    _getConfig: () => _config
};

})();
