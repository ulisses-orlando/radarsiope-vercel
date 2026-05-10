/* ==========================================================================
   quizApp.js — Módulo de Quiz Interativo por Edição
   Integração: verNewsletterComToken.js + API /api/pagamentoMP
   Modal centralizado, responsivo e com fallback para variáveis do app.
========================================================================== */
(function () {
  'use strict';

  // Estado interno
  let _state = null;
  let _config = null;
  let _currentQuestion = 0;
  let _answers = {};

  const STORAGE_KEY = (uid, nid) => `rs_quiz_progress_${uid}_${nid}`;

  // ── Injeção de CSS (Modal Centralizado) ────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('quiz-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'quiz-modal-styles';
    style.textContent = `
      .quiz-overlay {
        position: fixed; inset: 0;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(6px);
        z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
        opacity: 0; pointer-events: none;
        transition: opacity 0.25s ease;
      }
      .quiz-overlay.active { opacity: 1; pointer-events: auto; }
      .quiz-modal-box {
        background: var(--rs-card, #1e293b);
        color: var(--rs-text, #f8fafc);
        width: 100%; max-width: 540px; max-height: 90vh;
        border-radius: 16px; box-shadow: 0 12px 32px rgba(0,0,0,0.4);
        display: flex; flex-direction: column; overflow: hidden;
        transform: scale(0.95) translateY(8px);
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .quiz-overlay.active .quiz-modal-box { transform: scale(1) translateY(0); }
      .quiz-header {
        padding: 18px 20px; border-bottom: 1px solid var(--rs-borda, #334155);
        display: flex; justify-content: space-between; align-items: center;
      }
      .quiz-title { font-size: 16px; font-weight: 700; margin: 0; }
      .quiz-close {
        background: none; border: none; color: #94a3b8;
        font-size: 22px; cursor: pointer; padding: 4px; line-height: 1;
      }
      .quiz-close:hover { color: #f8fafc; }
      .quiz-body { padding: 20px; overflow-y: auto; flex: 1; }
      .quiz-footer {
        padding: 16px 20px; border-top: 1px solid var(--rs-borda, #334155);
        display: flex; justify-content: flex-end; gap: 10px;
        background: var(--rs-card2, #162032);
      }
      .quiz-progress { height: 4px; background: #334155; border-radius: 2px; margin-bottom: 16px; overflow: hidden; }
      .quiz-progress-fill { height: 100%; background: #3b82f6; transition: width 0.3s ease; }
      .quiz-q-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; line-height: 1.4; }
      .quiz-opts { display: flex; flex-direction: column; gap: 10px; }
      .quiz-opt-btn {
        padding: 12px 14px; background: #0f172a; border: 2px solid #334155;
        border-radius: 8px; color: #f8fafc; font-size: 14px; text-align: left;
        cursor: pointer; transition: all 0.2s; width: 100%;
      }
      .quiz-opt-btn:hover:not(:disabled) { border-color: #3b82f6; background: #1e293b; }
      .quiz-opt-btn:disabled { cursor: default; opacity: 0.8; }
      .quiz-opt-btn.correct { background: rgba(34,197,94,0.15) !important; border-color: #22c55e !important; }
      .quiz-opt-btn.wrong { background: rgba(239,68,68,0.15) !important; border-color: #ef4444 !important; }
      .quiz-feedback { margin-top: 14px; padding: 12px; background: rgba(59,130,246,0.1); border-left: 3px solid #3b82f6; border-radius: 4px; font-size: 13px; line-height: 1.5; }
      .quiz-btn { padding: 10px 20px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; transition: background 0.2s; }
      .quiz-btn:hover { background: #2563eb; }
      .quiz-btn.secondary { background: #475569; }
      .quiz-btn.secondary:hover { background: #334155; }
      .quiz-result { text-align: center; padding: 10px 0; }
      .quiz-result-icon { font-size: 48px; margin-bottom: 12px; }
      .quiz-result-score { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
      .quiz-result-msg { font-size: 14px; color: #94a3b8; margin-bottom: 16px; }
      @media(max-width: 480px) {
        .quiz-overlay { padding: 10px; }
        .quiz-modal-box { max-height: 95vh; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Lógica do Quiz ─────────────────────────────────────────────────────
  function openQuiz(config) {
    if (!config?.perguntas?.length) return;
    _injectCSS();
    _config = config;
    _currentQuestion = 0;
    _answers = {};

    const overlay = document.createElement('div');
    overlay.className = 'quiz-overlay';
    overlay.innerHTML = `
      <div class="quiz-modal-box">
        <div class="quiz-header">
          <h3 class="quiz-title">📝 Quiz da Edição</h3>
          <button class="quiz-close" aria-label="Fechar">✕</button>
        </div>
        <div class="quiz-body" id="q-body"></div>
        <div class="quiz-footer" id="q-footer"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    overlay.querySelector('.quiz-close').onclick = closeQuiz;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeQuiz(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeQuiz(); });

    _render();
  }

  function closeQuiz() {
    const overlay = document.querySelector('.quiz-overlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    document.removeEventListener('keydown', e => { if (e.key === 'Escape') closeQuiz(); });
    setTimeout(() => { overlay.remove(); _state = null; }, 250);
  }

  function _render() {
    if (!_config || _currentQuestion >= _config.perguntas.length) {
      _showResult(); return;
    }

    const q = _config.perguntas[_currentQuestion];
    const progress = ((_currentQuestion + 1) / _config.perguntas.length) * 100;
    const answered = _answers[q.id];
    const body = document.getElementById('q-body');
    const footer = document.getElementById('q-footer');

    body.innerHTML = `
      <div class="quiz-progress"><div class="quiz-progress-fill" style="width:${progress}%"></div></div>
      <div class="quiz-q-title">${_currentQuestion + 1}. ${q.pergunta}</div>
      <div class="quiz-opts" id="q-opts">
        ${q.alternativas.map((alt, i) => `
          <button class="quiz-opt-btn" data-idx="${i}" ${answered ? 'disabled' : ''}>
            ${String.fromCharCode(65 + i)}. ${alt}
          </button>
        `).join('')}
      </div>
      ${answered ? `<div class="quiz-feedback">${answered.explicacao}</div>` : ''}
    `;

    if (answered) {
      const btns = document.querySelectorAll('.quiz-opt-btn');
      btns[answered.selected].classList.add(answered.acertou ? 'correct' : 'wrong');
      btns[answered.correct].classList.add('correct');
    } else {
      document.querySelectorAll('.quiz-opt-btn').forEach(btn => {
        btn.onclick = () => _handleAnswer(parseInt(btn.dataset.idx));
      });
    }

    footer.innerHTML = answered
      ? `<button class="quiz-btn" id="q-next">${_currentQuestion < _config.perguntas.length - 1 ? 'Próxima →' : 'Ver Resultado'}</button>`
      : `<button class="quiz-btn secondary" disabled>Selecione uma alternativa</button>`;

    const nextBtn = document.getElementById('q-next');
    if (nextBtn) nextBtn.onclick = () => { _currentQuestion++; _render(); };
  }

  function _handleAnswer(idx) {
    if (_answers[_config.perguntas[_currentQuestion].id]) return;
    const q = _config.perguntas[_currentQuestion];
    const acertou = idx === q.correta;
    _answers[q.id] = { selected: idx, acertou, explicacao: q.explicacao };
    _render();
  }

  function _showResult() {
    const total = _config.perguntas.length;
    const acertos = Object.values(_answers).filter(a => a.acertou).length;
    const pct = Math.round((acertos / total) * 100);
    const aprovado = pct >= (_config.pontuacao_minima || 70);
    const body = document.getElementById('q-body');
    const footer = document.getElementById('q-footer');

    body.innerHTML = `
      <div class="quiz-result">
        <div class="quiz-result-icon">${aprovado ? '🏆' : '📚'}</div>
        <div class="quiz-result-score">${pct}% de acertos</div>
        <div class="quiz-result-msg">${acertos} de ${total} corretas. ${aprovado ? 'Parabéns!' : 'Continue estudando!'}</div>
        <div style="font-size:13px;color:#94a3b8;margin-bottom:16px;">Pontuação mínima: ${_config.pontuacao_minima || 70}%</div>
      </div>`;

    footer.innerHTML = `
      <button class="quiz-btn secondary" id="q-retry">Tentar Novamente</button>
      <button class="quiz-btn" id="q-close">Fechar</button>`;

    document.getElementById('q-retry').onclick = () => { _answers = {}; _currentQuestion = 0; _render(); };
    document.getElementById('q-close').onclick = () => { _save(); closeQuiz(); };
    _save();
  }

  async function _save() {
    if (!_config?.uid || !_config?.newsletter_id) return;
    localStorage.setItem(STORAGE_KEY(_config.uid, _config.newsletter_id), JSON.stringify({
      responses: _answers, completed: _currentQuestion >= _config.perguntas.length, ts: Date.now()
    }));

    if (_currentQuestion >= _config.perguntas.length) {
      try {
        await fetch('/api/pagamentoMP?acao=salvar-quiz', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: _config.uid, newsletter_id: _config.newsletter_id,
            pontuacao: Math.round((Object.values(_answers).filter(a => a.acertou).length / _config.perguntas.length) * 100),
            aprovado: Math.round((Object.values(_answers).filter(a => a.acertou).length / _config.perguntas.length) * 100) >= (_config.pontuacao_minima || 70),
            respostas: _answers
          })
        });
      } catch (e) { console.warn('[Quiz] Falha ao salvar:', e); }
    }
  }

  // Expõe apenas o necessário globalmente
  window.QuizApp = { open: openQuiz, close: closeQuiz };
})();