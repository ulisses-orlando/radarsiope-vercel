/* ==========================================================================
quizApp.js — Módulo de Quiz Interativo por Edição
Integração com: verNewsletterComToken.js e API de Pagamentos
========================================================================== */
(function () {
    'use strict';

    // Configuração do Quiz (vinda do Firestore via newsletter.quiz)
    let _config = null;

    // Estado da Sessão Atual (RAM)
    let _state = null;

    // Referência rápida para o quiz atual
    let _quizAtual = null;

    // Chave para persistência local
    const _localKey = (uid, nid) => `rs_quiz_${uid}_${nid}`;

    // ── Inicialização ─────────────────────────────────────────────────────────
    function init() {
        _injetarCSS();
        _bindEventos();
    }

    // ── Eventos ───────────────────────────────────────────────────────────────
    function _bindEventos() {
        // Botão de fechar no overlay
        document.addEventListener('click', (e) => {
            if (e.target.id === 'rs-quiz-overlay') _fecharDrawer();
        });
        // Fecha com ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') _fecharDrawer();
        });
    }

    // ── Abrir / Fechar ────────────────────────────────────────────────────────
    function _abrirDrawer(configQuiz, uid) {
        // Inicializa variáveis de estado
        _config = configQuiz;
        _quizAtual = configQuiz; // Referência para as perguntas
        
        // Cria overlay
        const overlay = document.createElement('div');
        overlay.id = 'rs-quiz-overlay';
        overlay.innerHTML = `
            <div id="rs-quiz-panel">
                <div id="rs-quiz-header">
                    <span id="rs-quiz-titulo">🧠 Quiz da Edição</span>
                    <button id="rs-quiz-fechar" type="button" aria-label="Fechar">×</button>
                </div>
                <div id="rs-quiz-body">
                    <div class="rs-quiz-loading">Carregando perguntas...</div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';

        // Inicializa estado da sessão do quiz
        _state = {
            nid: _quizAtual.id,
            uid: uid,
            qIndex: 0,
            answers: [],
            score: 0,
            finished: false
        };

        // Renderiza a primeira pergunta
        _renderizarPergunta();
    }

    function _fecharDrawer() {
        const overlay = document.getElementById('rs-quiz-overlay');
        if (overlay) overlay.remove();
        document.body.style.overflow = '';
        _state = null;
    }

    // ── Renderização ──────────────────────────────────────────────────────────
    function _renderizarPergunta() {
        if (!_state || !_quizAtual) return;

        const perguntas = _quizAtual.perguntas;
        const atual = perguntas[_state.qIndex];
        const total = perguntas.length;

        const body = document.getElementById('rs-quiz-body');
        body.innerHTML = `
            <div class="rs-quiz-progress-container">
                <div class="rs-quiz-progress-bar" style="width: ${((_state.qIndex + 1) / total) * 100}%"></div>
            </div>
            <div class="rs-quiz-pergunta-texto">${atual.pergunta}</div>
            <div class="rs-quiz-opcoes">
                ${atual.alternativas.map((alt, idx) => `
                    <button class="rs-quiz-opcao-btn" data-idx="${idx}" type="button">${alt}</button>
                `).join('')}
            </div>
        `;

        // Bind de eventos nas opções
        body.querySelectorAll('.rs-quiz-opcao-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idxSelecionada = parseInt(btn.dataset.idx);
                _processarResposta(idxSelecionada);
            });
        });
    }

    function _processarResposta(idxSelecionada) {
        if (!_state || !_quizAtual) return;
        
        const perguntas = _quizAtual.perguntas;
        const atual = perguntas[_state.qIndex];
        const acertou = idxSelecionada === parseInt(atual.correta);

        if (acertou) _state.score++;

        // Salva na memória
        _state.answers.push({
            qId: atual.id,
            selecionada: idxSelecionada,
            acertou: acertou
        });

        // Feedback visual
        const botoes = document.querySelectorAll('.rs-quiz-opcao-btn');
        botoes.forEach((btn, idx) => {
            btn.disabled = true;
            if (idx === parseInt(atual.correta)) {
                btn.classList.add('rs-quiz-correta');
            } else if (idx === idxSelecionada) {
                btn.classList.add('rs-quiz-errada');
            }
        });

        // Mostra explicação e botão de próxima
        const body = document.getElementById('rs-quiz-body');
        const explicacaoHtml = atual.explicacao ? `<div class="rs-quiz-explicacao">${atual.explicacao}</div>` : '';
        const isLast = _state.qIndex >= _quizAtual.perguntas.length - 1;
        
        body.innerHTML += `
            ${explicacaoHtml}
            <div style="text-align:center; margin-top: 15px;">
                <button id="rs-quiz-btn-proxima" type="button">
                    ${isLast ? 'Ver Resultado' : 'Próxima Pergunta →'}
                </button>
            </div>
        `;

        document.getElementById('rs-quiz-btn-proxima').addEventListener('click', () => {
            if (isLast) {
                _finalizarQuiz();
            } else {
                _state.qIndex++;
                _renderizarPergunta();
            }
        });
    }

    async function _finalizarQuiz() {
        _state.finished = true;
        
        const total = _quizAtual.perguntas.length;
        const pontuacao = Math.round((_state.score / total) * 100);
        const aprovado = pontuacao >= (_quizAtual.pontuacao_minima || 70);

        // Atualiza UI para resultado
        const body = document.getElementById('rs-quiz-body');
        body.innerHTML = `
            <div class="rs-quiz-resultado">
                <div class="rs-quiz-icon">${aprovado ? '🏆' : '📚'}</div>
                <h3>${aprovado ? 'Parabéns! Aprovado!' : 'Continue Estudando!'}</h3>
                <p>Pontuação: <strong>${pontuacao}%</strong></p>
                <p>Você acertou <strong>${_state.score}</strong> de <strong>${total}</strong> questões.</p>
                ${!aprovado ? `<p class="rs-quiz-status-msg">A pontuação mínima para aprovação é ${_quizAtual.pontuacao_minima || 70}%.</p>` : ''}
            </div>
        `;

        // Salva no backend
        await _salvarNoBackend(pontuacao, aprovado);
        
        // Fecha após 3 segundos
        setTimeout(() => _fecharDrawer(), 3000);
    }

    async function _salvarNoBackend(pontuacao, aprovado) {
        if (!_state) return;
        try {
            await fetch('/api/pagamentoMP?acao=salvar-quiz', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uid: _state.uid,
                    newsletter_id: _state.nid,
                    tentativas_usadas: 1,
                    melhor_pontuacao: pontuacao,
                    aprovado,
                    detalhes: _state.answers
                })
            });
        } catch (e) {
            console.error('Erro ao salvar quiz:', e);
        }
    }

    // ── CSS ───────────────────────────────────────────────────────────────────
    function _injetarCSS() {
        if (document.getElementById('rs-quiz-style')) return;
        const style = document.createElement('style');
        style.id = 'rs-quiz-style';
        style.textContent = `
            #rs-quiz-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:9999; display:flex; align-items:center; justify-content:center; }
            #rs-quiz-panel { background:var(--rs-card,#1e293b); width:90%; max-width:500px; border-radius:16px; overflow:hidden; box-shadow:0 10px 40px rgba(0,0,0,0.5); }
            #rs-quiz-header { padding:16px; background:#0f172a; display:flex; justify-content:space-between; align-items:center; color:#fff; font-weight:700; }
            #rs-quiz-fechar { background:none; border:none; color:#fff; font-size:24px; cursor:pointer; }
            #rs-quiz-body { padding:20px; color:var(--rs-text,#f8fafc); }
            .rs-quiz-progress-container { height:6px; background:#334155; border-radius:3px; margin-bottom:20px; overflow:hidden; }
            .rs-quiz-progress-bar { height:100%; background:#8b5cf6; transition:width 0.3s; }
            .rs-quiz-pergunta-texto { font-size:16px; font-weight:600; margin-bottom:20px; line-height:1.5; }
            .rs-quiz-opcoes { display:flex; flex-direction:column; gap:10px; }
            .rs-quiz-opcao-btn { padding:12px; background:#334155; border:2px solid transparent; border-radius:8px; color:#fff; cursor:pointer; text-align:left; transition:all 0.2s; }
            .rs-quiz-opcao-btn:hover:not(:disabled) { border-color:#8b5cf6; background:#1e293b; }
            .rs-quiz-correta { background:#052e16 !important; border-color:#22c55e !important; color:#22c55e !important; }
            .rs-quiz-errada { background:#450a0a !important; border-color:#ef4444 !important; color:#ef4444 !important; }
            .rs-quiz-explicacao { margin-top:15px; padding:12px; background:rgba(139,92,246,0.1); border-left:3px solid #8b5cf6; border-radius:4px; font-size:13px; line-height:1.5; color:#cbd5e1; }
            #rs-quiz-btn-proxima { padding:10px 20px; background:#8b5cf6; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600; }
            .rs-quiz-resultado { text-align:center; }
            .rs-quiz-icon { font-size:48px; margin-bottom:10px; }
        `;
        document.head.appendChild(style);
    }

    // Expõe função global para o App chamar
    window._abrirQuiz = _abrirDrawer;

    // Inicializa módulo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();