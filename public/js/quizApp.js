/* ==========================================================================
quizApp.js — Módulo de Quiz Interativo por Edição (VERSÃO FINAL)
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
    const isAssinante = user.segmento === 'assinante';
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
    // Local para injetar o card: Tentamos colocar antes do CTA de assinatura ou no final do app
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
        <div class="rs-quiz-icon">🧠</div>
        <h3>Teste seus conhecimentos</h3>
        <p>Responda ao quiz desta edição e valide seu aprendizado.</p>
        <button id="rs-quiz-btn-iniciar" type="button">Iniciar Quiz</button>
        ${_config.tentativas_max > 1 ? `<div class="rs-quiz-info">Tentativas permitidas: ${_config.tentativas_max}</div>` : ''}
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
        abrirQuizOverlay(nid, uid);
    });
}

function abrirQuizOverlay(nid, uid) {
    // Remove o card de convite para não duplicar
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
        tentativas: 1 // contador de tentativas nesta sessão
    };

    // Cria Overlay
    const overlay = document.createElement('div');
    overlay.id = 'rs-quiz-overlay';
    overlay.className = 'rs-quiz-overlay';
    overlay.innerHTML = `
        <div id="rs-quiz-sheet" class="rs-quiz-sheet">
            <header id="rs-quiz-header">
                <span id="rs-quiz-title">Pergunta 1</span>
                <button id="rs-quiz-fechar" aria-label="Fechar">✕</button>
            </header>
            
            <div id="rs-quiz-body">
                <div class="rs-quiz-progress-bar"><div class="fill" style="width: 0%"></div></div>
                <div id="rs-quiz-question-container"></div>
            </div>

            <footer id="rs-quiz-footer"></footer>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Bind de Fechar (cancelar quiz)
    document.getElementById('rs-quiz-fechar').addEventListener('click', () => {
        fecharQuizOverlay();
        // Se cancelou no meio, volta a mostrar o card
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
    
    // Limpa Footer
    footer.style.display = 'none';
    footer.innerHTML = '';

    // Renderiza Conteúdo
    container.innerHTML = `
        <div class="rs-quiz-texto">${atual.pergunta}</div>
        <div class="rs-quiz-opcoes">
            ${atual.opcoes.map((opcao, idx) => `
                <button class="rs-quiz-opcao-btn" data-idx="${idx}" type="button">
                    ${opcao}
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

    // Feedback Visual (Trava botões e colore)
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
        expDiv.innerHTML = `<strong>Explicação:</strong> ${atual.explicacao}`;
        container.appendChild(expDiv);
    }

    // Exibe Botão de Avançar no Footer
    const footer = document.getElementById('rs-quiz-footer');
    footer.style.display = 'block';
    
    const isLast = (_state.qIndex >= perguntas.length - 1);
    const label = isLast ? 'Ver Resultado' : 'Próxima Pergunta';
    const action = isLast ? finalizarQuiz : proximaPergunta;

    footer.innerHTML = `<button id="rs-quiz-btn-acao" type="button">${label}</button>`;
    document.getElementById('rs-quiz-btn-acao').addEventListener('click', action);
}

function proximaPergunta() {
    _state.qIndex++;
    // Limpa container para nova renderização
    document.getElementById('rs-quiz-question-container').innerHTML = '';
    renderizarPergunta();
}

async function finalizarQuiz() {
    _state.finished = true;
    
    // 1. Calcula Resultado
    const total = _config.perguntas.length;
    const pontuacao = Math.round((_state.score / total) * 100);
    const minimo = _config.pontuacao_minima || 70;
    const aprovado = pontuacao >= minimo;

    // 2. Salva no Backend (formato esperado pela API)
    await salvarNoBackend({
        pontuacao,
        aprovado,
        tentativas_usadas: _state.tentativas,
        melhor_pontuacao: pontuacao, // em sessões futuras, comparar com localStorage
        detalhes: _state.answers.map(a => ({
            pergunta_id: a.qId,
            resposta_selecionada: a.selecionada,
            resposta_correta: a.correta,
            acertou: a.acertou
        }))
    });

    // 3. Renderiza Tela de Resultado
    renderizarResultado(pontuacao, aprovado, minimo);
}

function renderizarResultado(pontuacao, aprovado, minimo) {
    const body = document.getElementById('rs-quiz-body');
    const footer = document.getElementById('rs-quiz-footer');
    const header = document.getElementById('rs-quiz-header');

    // Oculta header padrão
    header.style.display = 'none';

    body.innerHTML = `
        <div class="rs-quiz-resultado ${aprovado ? 'aprovado' : 'reprovado'}">
            <div class="rs-quiz-icon">${aprovado ? '🏆' : '📚'}</div>
            <h2>${aprovado ? 'Parabéns!' : 'Continue Estudando!'}</h2>
            <div class="rs-quiz-score-circle">
                <span>${pontuacao}%</span>
            </div>
            <p>Você acertou <strong>${_state.score}</strong> de <strong>${_config.perguntas.length}</strong> questões.</p>
            <p class="rs-quiz-status-msg">
                ${aprovado 
                    ? 'Você atingiu a pontuação mínima necessária.' 
                    : `A pontuação mínima para aprovação é ${minimo}%.`}
            </p>
        </div>
    `;

    footer.style.display = 'block';
    footer.innerHTML = `<button id="rs-quiz-btn-sair" type="button">Fechar e Voltar à Leitura</button>`;
    document.getElementById('rs-quiz-btn-sair').addEventListener('click', fecharQuizOverlay);
}

function fecharQuizOverlay() {
    const overlay = document.getElementById('rs-quiz-overlay');
    if (overlay) overlay.remove();
    document.body.style.overflow = '';
    
    _state = null; // Limpa memória
}

// ────────────────────────────────────────────────────────────────────────
// API & PERSISTÊNCIA
// ────────────────────────────────────────────────────────────────────────

/**
 * Salva resultado no backend no formato esperado
 * @param {Object} dados - { pontuacao, aprovado, tentativas_usadas, melhor_pontuacao, detalhes }
 */
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
        // Chama o endpoint fornecido
        const resp = await fetch('/api/pagamentoMP?acao=salvar-quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await resp.json().catch(() => ({}));

        // Marca localmente como concluído (independente do sucesso da API)
        marcarConcluidoLocal(_state.uid, _state.nid, {
            completed: true,
            timestamp: Date.now(),
            pontuacao,
            aprovado,
            tentativas: tentativas_usadas
        });
        
        // Dispara evento para atualizar badges (se houver listener)
        window.dispatchEvent(new CustomEvent('rs:quizConcluido', { 
            detail: { nid: _state.nid, pontuacao, aprovado } 
        }));

        return data;
    } catch (err) {
        console.error('[QuizApp] Erro ao salvar resultado:', err);
        // Mesmo com erro de rede, marcamos localmente para não travar o usuário
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

// Helpers LocalStorage
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
        /* Card de Convite */
        .rs-quiz-cta-card {
            background: var(--rs-card2, #162032);
            border: 1px dashed var(--azul, #0A3D62);
            border-radius: 12px;
            padding: 24px;
            margin: 24px 0;
            text-align: center;
            animation: rsFadeIn 0.5s ease;
        }
        .rs-quiz-cta-card h3 { color: var(--rs-text, #fff); margin: 8px 0; }
        .rs-quiz-cta-card p { color: var(--rs-muted, #94a3b8); font-size: 14px; margin-bottom: 16px; }
        #rs-quiz-btn-iniciar {
            background: var(--azul, #0A3D62);
            color: #fff;
            border: none;
            padding: 10px 24px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
        }
        #rs-quiz-btn-iniciar:hover { transform: scale(1.05); }
        .rs-quiz-info { font-size: 11px; color: #64748b; margin-top: 8px; }

        /* Overlay e Sheet (Modal) */
        .rs-quiz-overlay {
            position: fixed; inset: 0; z-index: 10000;
            background: rgba(0,0,0,0.8);
            display: flex; align-items: flex-end; justify-content: center;
        }
        .rs-quiz-sheet {
            background: var(--rs-card, #1e293b);
            width: 100%; max-width: 600px;
            height: 90vh;
            border-radius: 16px 16px 0 0;
            display: flex; flex-direction: column;
            animation: rsSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            overflow: hidden;
        }
        @keyframes rsSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        
        #rs-quiz-header {
            padding: 16px; border-bottom: 1px solid var(--rs-borda);
            display: flex; justify-content: space-between; align-items: center;
            font-weight: 700; color: var(--rs-text, #fff);
        }
        #rs-quiz-fechar { background: none; border: none; color: var(--rs-muted); font-size: 20px; cursor: pointer; }

        #rs-quiz-body { flex: 1; padding: 20px; overflow-y: auto; position: relative; }
        
        .rs-quiz-progress-bar { height: 4px; background: #334155; border-radius: 2px; margin-bottom: 20px; overflow: hidden; }
        .rs-quiz-progress-bar .fill { height: 100%; background: #22c55e; transition: width 0.3s ease; }

        .rs-quiz-texto { font-size: 18px; margin-bottom: 24px; line-height: 1.5; color: var(--rs-text); font-weight: 500; }
        
        .rs-quiz-opcoes { display: flex; flex-direction: column; gap: 12px; }
        .rs-quiz-opcao-btn {
            background: var(--rs-bg, #f8fafc);
            border: 2px solid var(--rs-borda);
            padding: 14px; border-radius: 8px;
            text-align: left; font-size: 15px; cursor: pointer;
            transition: all 0.2s; color: var(--rs-texto, #0f172a);
        }
        .rs-quiz-opcao-btn:hover:not(:disabled) { border-color: var(--azul); background: rgba(10, 61, 98, 0.1); }
        .rs-quiz-opcao-btn:disabled { cursor: default; opacity: 0.7; }
        
        .rs-quiz-correta { background: #dcfce7 !important; border-color: #22c55e !important; color: #14532d !important; }
        .rs-quiz-errada { background: #fee2e2 !important; border-color: #ef4444 !important; color: #7f1d1d !important; }

        .rs-quiz-explicacao {
            margin-top: 20px; padding: 14px; background: rgba(139, 92, 246, 0.1);
            border-left: 4px solid #8b5cf6; border-radius: 4px;
            font-size: 14px; color: var(--rs-text); line-height: 1.5;
        }

        #rs-quiz-footer {
            padding: 16px; border-top: 1px solid var(--rs-borda);
            display: none; justify-content: center; background: var(--rs-card2);
        }
        #rs-quiz-btn-acao, #rs-quiz-btn-sair {
            background: var(--azul, #0A3D62); color: #fff;
            border: none; padding: 12px 32px; border-radius: 8px;
            font-size: 16px; font-weight: 600; cursor: pointer; width: 100%; max-width: 300px;
        }

        /* Tela de Resultado */
        .rs-quiz-resultado { text-align: center; padding-top: 40px; }
        .rs-quiz-icon { font-size: 64px; margin-bottom: 16px; }
        .rs-quiz-score-circle {
            width: 100px; height: 100px; border-radius: 50%;
            background: #0f172a; border: 4px solid var(--azul);
            display: flex; align-items: center; justify-content: center;
            font-size: 28px; font-weight: 700; color: #fff; margin: 24px auto;
        }
        .rs-quiz-status-msg { margin-top: 12px; color: var(--rs-muted); }
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