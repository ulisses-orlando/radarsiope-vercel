/* ==========================================================================
quizApp.js — Módulo de Quiz Interativo por Edição
Integração com: verNewsletterComToken.js + API /api/pagamentoMP
========================================================================== */
(function () {
'use strict';

let _config     = null;  // newsletter.quiz
let _state      = null;  // sessão ativa
let _historico  = null;  // cache da resposta da API { tentativas[], tentativas_total, tentativas_max }

const _localKey = (uid, nid) => `rs_quiz_${uid}_${nid}`;

// ────────────────────────────────────────────────────────────────────────
// PÚBLICO
// ────────────────────────────────────────────────────────────────────────

async function init(newsletter, user) {
    if (!newsletter?.quiz?.ativo) return;
    if (!user?.uid) return;

    _config = newsletter.quiz;

    const isAssinante = user.segmento === 'assinante' || user.segmento === 'assinantes';
    const visivelParaLeads = (_config.visivel_leads === true);
    if (!isAssinante && !visivelParaLeads) return;

    injetarEstilosCSS();

    // Exibe skeleton enquanto aguarda API
    _renderizarSkeleton(newsletter.id);

    try {
        _historico = await _buscarHistorico(user.uid, newsletter.id);
    } catch (e) {
        console.warn('[QuizApp] Falha ao buscar histórico, usando fallback local:', e);
        _historico = _carregarCacheLocal(user.uid, newsletter.id);
    }

    _removerSkeleton();

    if (!_historico || _historico.tentativas_total === 0) {
        _renderizarCardConvite(newsletter.id, user.uid);
    } else {
        _renderizarCardConcluido(newsletter.id, user.uid);
    }
}

function jaConcluiu(uid, nid) {
    if (_historico) return _historico.tentativas_total > 0;
    const c = _carregarCacheLocal(uid, nid);
    return c && c.tentativas_total > 0;
}

function getEstatisticas(uid, nid) {
    if (_historico) return _historico;
    return _carregarCacheLocal(uid, nid);
}

// ────────────────────────────────────────────────────────────────────────
// CARDS
// ────────────────────────────────────────────────────────────────────────

function _renderizarSkeleton(nid) {
    const app = document.getElementById('rs-app');
    if (!app) return;
    _removerCardQuiz();
    const sk = document.createElement('div');
    sk.id = 'rs-quiz-skeleton';
    sk.className = 'rs-quiz-skeleton';
    sk.innerHTML = `<div class="rs-quiz-sk-line w60"></div><div class="rs-quiz-sk-line w40"></div>`;
    const ctaWrap = document.getElementById('rs-cta-wrap');
    ctaWrap ? app.insertBefore(sk, ctaWrap) : app.appendChild(sk);
}

function _removerSkeleton() {
    document.getElementById('rs-quiz-skeleton')?.remove();
}

function _removerCardQuiz() {
    document.getElementById('rs-quiz-cta-card')?.remove();
}

function _renderizarCardConvite(nid, uid) {
    const app = document.getElementById('rs-app');
    if (!app) return;
    _removerCardQuiz();

    const card = document.createElement('div');
    card.id = 'rs-quiz-cta-card';
    card.className = 'rs-quiz-cta-card';
    card.innerHTML = `
        <div class="rs-quiz-cta-icon">🧠</div>
        <div class="rs-quiz-cta-content">
            <h3>Teste seus conhecimentos</h3>
            <p>Responda ao quiz desta edição e valide seu aprendizado.</p>
            ${_config.tentativas_max > 1
                ? `<span class="rs-quiz-info">Até ${_config.tentativas_max} tentativas permitidas</span>`
                : ''}
        </div>
        <button id="rs-quiz-btn-iniciar" type="button">Iniciar Quiz →</button>
    `;

    const ctaWrap = document.getElementById('rs-cta-wrap');
    ctaWrap ? app.insertBefore(card, ctaWrap) : app.appendChild(card);

    document.getElementById('rs-quiz-btn-iniciar').addEventListener('click', () => {
        _abrirQuizModal(nid, uid);
    });
}

function _renderizarCardConcluido(nid, uid) {
    const app = document.getElementById('rs-app');
    if (!app) return;
    _removerCardQuiz();

    // 🔧 CORREÇÃO: Validação defensiva para garantir que seja array
    const tentativas = Array.isArray(_historico?.tentativas) ? _historico.tentativas : [];
    const tentativas_total = _historico?.tentativas_total || 0;
    const tentativas_max = _historico?.tentativas_max || _config?.tentativas_max || 3;

    const melhor    = tentativas.reduce((m, t) => Math.max(m, t.pontuacao), 0);
    const aprovado  = tentativas.some(t => t.aprovado);
    const podeReiniciar = tentativas_total < tentativas_max;

    const card = document.createElement('div');
    card.id = 'rs-quiz-cta-card';
    card.className = 'rs-quiz-cta-card rs-quiz-cta-card--concluido';
    card.innerHTML = `
        <div class="rs-quiz-cta-icon">${aprovado ? '🏆' : '📚'}</div>
        <div class="rs-quiz-cta-content">
            <h3>Quiz respondido</h3>
            <p>
               Melhor pontuação: <strong>${melhor}%</strong>
                &nbsp;· &nbsp;
                <span class="rs-quiz-badge-status ${aprovado ? 'aprovado' : 'reprovado'}">
                   ${aprovado ? 'Aprovado' : 'Não aprovado'}
                </span>
            </p>
            <span class="rs-quiz-info">
               ${tentativas_total} de ${tentativas_max} tentativa${tentativas_max > 1 ? 's' : ''} usada${tentativas_total > 1 ? 's' : ''}
            </span>
        </div>
        <div class="rs-quiz-cta-acoes">
            <button id="rs-quiz-btn-historico" type="button" class="rs-quiz-btn-sec">Ver resultados</button>
           ${podeReiniciar
               ? `<button id="rs-quiz-btn-reiniciar" type="button" class="rs-quiz-btn-pri">Tentar novamente →</button>`
               : ''}
        </div>
    `;

    const ctaWrap = document.getElementById('rs-cta-wrap');
    ctaWrap ? app.insertBefore(card, ctaWrap) : app.appendChild(card);

    document.getElementById('rs-quiz-btn-historico').addEventListener('click', () => {
        _abrirModalHistorico();
    });
    if (podeReiniciar) {
        document.getElementById('rs-quiz-btn-reiniciar').addEventListener('click', () => {
            _abrirQuizModal(nid, uid);
        });
    }
}

// ────────────────────────────────────────────────────────────────────────
// MODAL DO QUIZ
// ────────────────────────────────────────────────────────────────────────

function _abrirQuizModal(nid, uid) {
    document.getElementById('rs-quiz-cta-card')?.remove();

    _state = { nid, uid, qIndex: 0, answers: [], score: 0, finished: false };

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
                <div class="rs-quiz-progress-bar"><div class="fill" style="width:0%"></div></div>
            </div>
            <div id="rs-quiz-body">
                <div id="rs-quiz-question-container"></div>
            </div>
            <footer id="rs-quiz-footer"></footer>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) _cancelarQuiz(nid, uid);
    });
    document.getElementById('rs-quiz-fechar').addEventListener('click', () => {
        _cancelarQuiz(nid, uid);
    });

    _renderizarPergunta();
}

function _cancelarQuiz(nid, uid) {
    _fecharQuizModal();
    if (!_historico || _historico.tentativas_total === 0) {
        _renderizarCardConvite(nid, uid);
    } else {
        _renderizarCardConcluido(nid, uid);
    }
}

function _renderizarPergunta() {
    if (!_state || _state.finished) return;

    const perguntas = _config.perguntas;
    const atual     = perguntas[_state.qIndex];
    const total     = perguntas.length;

    document.getElementById('rs-quiz-title').textContent = `Pergunta ${_state.qIndex + 1} de ${total}`;
    const pct = ((_state.qIndex + 1) / total) * 100;
    document.querySelector('.rs-quiz-progress-bar .fill').style.width = `${pct}%`;

    const container = document.getElementById('rs-quiz-question-container');
    const footer    = document.getElementById('rs-quiz-footer');
    footer.style.display = 'none';
    footer.innerHTML     = '';

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

    container.querySelectorAll('.rs-quiz-opcao-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            _processarResposta(parseInt(e.currentTarget.dataset.idx));
        });
    });
}

function _processarResposta(idxSelecionado) {
    const atual   = _config.perguntas[_state.qIndex];
    const acertou = idxSelecionado === parseInt(atual.correta);

    if (acertou) _state.score++;

    _state.answers.push({
        qId: atual.id || _state.qIndex,
        selecionada: idxSelecionado,
        correta: parseInt(atual.correta),
        acertou
    });

    const container = document.getElementById('rs-quiz-question-container');
    container.querySelectorAll('.rs-quiz-opcao-btn').forEach(btn => {
        btn.disabled = true;
        const i = parseInt(btn.dataset.idx);
        if (i === parseInt(atual.correta))        btn.classList.add('rs-quiz-correta');
        else if (i === idxSelecionado && !acertou) btn.classList.add('rs-quiz-errada');
    });

    if (atual.explicacao) {
        const exp = document.createElement('div');
        exp.className = 'rs-quiz-explicacao';
        exp.innerHTML = `<strong>💡 Explicação:</strong> ${atual.explicacao}`;
        container.appendChild(exp);
    }

    const footer  = document.getElementById('rs-quiz-footer');
    footer.style.display = 'flex';

    const isLast = _state.qIndex >= _config.perguntas.length - 1;
    footer.innerHTML = `<button id="rs-quiz-btn-acao" type="button">${isLast ? 'Ver Resultado' : 'Próxima Pergunta →'}</button>`;
    document.getElementById('rs-quiz-btn-acao').addEventListener('click', isLast ? _finalizarQuiz : _proximaPergunta);
}

function _proximaPergunta() {
    _state.qIndex++;
    document.getElementById('rs-quiz-question-container').innerHTML = '';
    _renderizarPergunta();
}

async function _finalizarQuiz() {
    _state.finished = true;

    const total    = _config.perguntas.length;
    const pontuacao = Math.round((_state.score / total) * 100);
    const minimo   = _config.pontuacao_minima || 70;
    const aprovado = pontuacao >= minimo;

    // Trava botão enquanto salva
    const btnAcao = document.getElementById('rs-quiz-btn-acao');
    if (btnAcao) { btnAcao.disabled = true; btnAcao.textContent = 'Salvando...'; }

    try {
        const respApi = await _salvarNoBackend({ pontuacao, aprovado });

        // Atualiza histórico em memória com retorno da API (preferencial)
        if (respApi?.historico) {
            _historico = respApi.historico;
        } else {
            // Fallback: atualiza manualmente
            const entrada = { pontuacao, aprovado, criado_em: new Date().toISOString() };
            if (!_historico) {
                _historico = {
                    tentativas: [],
                    tentativas_total: 0,
                    tentativas_max: _config.tentativas_max || 3
                };
            }
            _historico.tentativas.unshift(entrada);
            _historico.tentativas_total += 1;
        }

        _salvarCacheLocal(_state.uid, _state.nid, _historico);

        window.dispatchEvent(new CustomEvent('rs:quizConcluido', {
            detail: { nid: _state.nid, pontuacao, aprovado }
        }));
    } catch (err) {
        console.error('[QuizApp] Erro ao salvar resultado:', err);
    }

    _renderizarResultadoFinal(pontuacao, aprovado, minimo);
}

function _renderizarResultadoFinal(pontuacao, aprovado, minimo) {
    document.getElementById('rs-quiz-header').style.display = 'none';
    document.querySelector('.rs-quiz-progress-wrap').style.display = 'none';

    document.getElementById('rs-quiz-body').innerHTML = `
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

    const footer = document.getElementById('rs-quiz-footer');
    footer.style.display = 'flex';
    footer.innerHTML = `<button id="rs-quiz-btn-sair" type="button">Fechar e Voltar à Leitura</button>`;
    document.getElementById('rs-quiz-btn-sair').addEventListener('click', () => {
        const nid = _state?.nid;
        const uid = _state?.uid;
        _fecharQuizModal();
        _renderizarCardConcluido(nid, uid);
    });
}

function _fecharQuizModal() {
    document.getElementById('rs-quiz-overlay')?.remove();
    document.body.style.overflow = '';
    _state = null;
}

// ────────────────────────────────────────────────────────────────────────
// MODAL DE HISTÓRICO
// ────────────────────────────────────────────────────────────────────────

function _abrirModalHistorico() {
    document.getElementById('rs-quiz-historico-overlay')?.remove();

    // 🔧 CORREÇÃO: Validação defensiva
    const tentativas = Array.isArray(_historico?.tentativas) ? _historico.tentativas : [];
    const tentativas_total = _historico?.tentativas_total || 0;
    const tentativas_max = _historico?.tentativas_max || _config?.tentativas_max || 3;
    
    const linhas = tentativas.map((t, i) => {
        const data  = _formatarData(t.criado_em);
        const icone = t.aprovado ? '✅' : '❌';
        return `
            <div class="rs-quiz-hist-row">
                <span class="rs-quiz-hist-num">${i + 1}ª</span>
                <span class="rs-quiz-hist-score ${t.aprovado ? 'aprovado' : 'reprovado'}">${t.pontuacao}%</span>
                <span class="rs-quiz-hist-status">${icone} ${t.aprovado ? 'Aprovado' : 'Não aprovado'}</span>
                <span class="rs-quiz-hist-data">${data}</span>
            </div>
        `;
    }).join('');

    const overlay = document.createElement('div');
    overlay.id    = 'rs-quiz-historico-overlay';
    overlay.className = 'rs-quiz-overlay';
    overlay.innerHTML = `
        <div class="rs-quiz-modal" role="dialog" aria-modal="true" aria-label="Histórico de tentativas">
            <header id="rs-quiz-header">
                <div class="rs-quiz-header-left">
                    <span class="rs-quiz-badge">Quiz</span>
                    <span>Seus Resultados</span>
                </div>
                <button id="rs-quiz-hist-fechar" aria-label="Fechar">✕</button>
            </header>
            <div id="rs-quiz-body" style="padding: 20px;">
                <p class="rs-quiz-hist-meta">
                    ${tentativas_total} de ${tentativas_max} tentativa${tentativas_max > 1 ? 's' : ''} realizada${tentativas_total > 1 ? 's' : ''}
                </p>
                <div class="rs-quiz-hist-lista">
                    ${linhas}
                </div>
            </div>
            <footer id="rs-quiz-footer" style="display:flex;">
                <button id="rs-quiz-hist-ok" type="button">Fechar</button>
            </footer>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const fechar = () => {
        overlay.remove();
        document.body.style.overflow = '';
    };
    document.getElementById('rs-quiz-hist-fechar').addEventListener('click', fechar);
    document.getElementById('rs-quiz-hist-ok').addEventListener('click', fechar);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });
}

// ────────────────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────────────────

async function _buscarHistorico(uid, nid) {
    const url = `/api/pagamentoMP?acao=quiz-historico&uid=${encodeURIComponent(uid)}&newsletter_id=${encodeURIComponent(nid)}`;
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.message || 'Erro ao buscar histórico');
    return {
        tentativas:      data.tentativas      || [],
        tentativas_total: data.tentativas_total || 0,
        tentativas_max:  data.tentativas_max  || _config.tentativas_max || 3
    };
}

async function _salvarNoBackend({ pontuacao, aprovado }) {
    if (!_state) return;

    const payload = {
        uid:           _state.uid,
        newsletter_id: _state.nid,
        pontuacao,
        aprovado,
        detalhes: _state.answers.map(a => ({
            pergunta_id:         a.qId,
            resposta_selecionada: a.selecionada,
            resposta_correta:    a.correta,
            acertou:             a.acertou
        }))
    };

    const resp = await fetch('/api/pagamentoMP?acao=salvar-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${resp.status}`);
    }

    return resp.json().catch(() => ({}));
}

// ────────────────────────────────────────────────────────────────────────
// CACHE LOCAL (display apenas — não é fonte de verdade para tentativas)
// ────────────────────────────────────────────────────────────────────────

function _salvarCacheLocal(uid, nid, historico) {
    try {
        localStorage.setItem(_localKey(uid, nid), JSON.stringify(historico));
    } catch {}
}

function _carregarCacheLocal(uid, nid) {
    try {
        const d = localStorage.getItem(_localKey(uid, nid));
        return d ? JSON.parse(d) : null;
    } catch { return null; }
}

// ────────────────────────────────────────────────────────────────────────
// UTILS
// ────────────────────────────────────────────────────────────────────────

function _formatarData(value) {
    if (!value) return '—';
    try {
        // Suporta Firestore Timestamp serializado ({ _seconds }), ISO string ou Date
        const d = value?._seconds
            ? new Date(value._seconds * 1000)
            : new Date(value);
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return '—'; }
}

// ────────────────────────────────────────────────────────────────────────
// CSS
// ────────────────────────────────────────────────────────────────────────

function injetarEstilosCSS() {
    if (document.getElementById('rs-quiz-style')) return;

    const style = document.createElement('style');
    style.id = 'rs-quiz-style';
    style.textContent = `
        /* ── Skeleton ── */
        .rs-quiz-skeleton {
            padding: 20px; margin: 24px 0;
            background: var(--rs-card2, #162032);
            border-radius: 12px;
            display: flex; flex-direction: column; gap: 10px;
        }
        .rs-quiz-sk-line {
            height: 12px; border-radius: 6px;
            background: rgba(255,255,255,0.06);
            animation: rsPulse 1.4s ease-in-out infinite;
        }
        .rs-quiz-sk-line.w60 { width: 60%; }
        .rs-quiz-sk-line.w40 { width: 40%; }
        @keyframes rsPulse { 0%,100% { opacity:.4 } 50% { opacity:.9 } }

        /* ── Card Convite ── */
        .rs-quiz-cta-card {
            background: var(--rs-card2, #162032);
            border: 1px solid rgba(10,61,98,0.5);
            border-radius: 12px; padding: 20px; margin: 24px 0;
            display: flex; align-items: center; gap: 16px;
            animation: rsFadeIn 0.4s ease;
        }
        .rs-quiz-cta-card--concluido { border-color: rgba(255,255,255,0.08); }
        .rs-quiz-cta-icon { font-size: 36px; flex-shrink: 0; }
        .rs-quiz-cta-content { flex: 1; min-width: 0; }
        .rs-quiz-cta-content h3 { color: var(--rs-text, #f1f5f9); margin: 0 0 4px; font-size: 15px; }
        .rs-quiz-cta-content p  { color: var(--rs-muted, #94a3b8); font-size: 13px; margin: 0; }
        .rs-quiz-info {
            display: inline-block; margin-top: 6px;
            font-size: 11px; color: #64748b;
            background: rgba(255,255,255,0.05);
            padding: 2px 8px; border-radius: 20px;
        }
        .rs-quiz-badge-status {
            font-size: 11px; font-weight: 700;
            padding: 2px 7px; border-radius: 20px;
        }
        .rs-quiz-badge-status.aprovado  { background: rgba(34,197,94,0.15);  color: #4ade80; }
        .rs-quiz-badge-status.reprovado { background: rgba(245,158,11,0.15); color: #fbbf24; }
        .rs-quiz-cta-acoes { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
        .rs-quiz-btn-pri {
            background: var(--azul, #0A3D62); color: #fff;
            border: none; padding: 10px 18px; border-radius: 8px;
            font-weight: 600; font-size: 13px; cursor: pointer; white-space: nowrap;
            transition: background .2s, transform .15s;
        }
        .rs-quiz-btn-pri:hover { background: #0d4f7c; transform: translateY(-1px); }
        .rs-quiz-btn-sec {
            background: rgba(255,255,255,0.06); color: var(--rs-muted, #94a3b8);
            border: 1px solid rgba(255,255,255,0.1);
            padding: 9px 18px; border-radius: 8px;
            font-size: 13px; cursor: pointer; white-space: nowrap;
            transition: background .2s;
        }
        .rs-quiz-btn-sec:hover { background: rgba(255,255,255,0.1); }

        /* ── Overlay / Modal ── */
        .rs-quiz-overlay {
            position: fixed; inset: 0; z-index: 10000;
            background: rgba(0,0,0,0.75);
            display: flex; align-items: center; justify-content: center;
            padding: 16px;
            backdrop-filter: blur(2px);
        }
        .rs-quiz-modal {
            background: var(--rs-card, #1e293b);
            width: 100%; max-width: 560px; max-height: 90vh;
            border-radius: 16px;
            display: flex; flex-direction: column;
            animation: rsScaleIn 0.25s cubic-bezier(0.16,1,0.3,1);
            overflow: hidden;
            box-shadow: 0 24px 60px rgba(0,0,0,0.5);
        }

        /* ── Header ── */
        #rs-quiz-header {
            padding: 14px 16px; flex-shrink: 0;
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 1px solid var(--rs-borda, rgba(255,255,255,0.08));
        }
        .rs-quiz-header-left { display: flex; align-items: center; gap: 10px; }
        .rs-quiz-badge {
            background: rgba(10,61,98,0.5); color: #60a5fa;
            font-size: 11px; font-weight: 700;
            padding: 3px 8px; border-radius: 20px;
            letter-spacing: .05em; text-transform: uppercase;
        }
        #rs-quiz-title { font-size: 14px; font-weight: 600; color: var(--rs-muted, #94a3b8); }
        #rs-quiz-fechar, #rs-quiz-hist-fechar {
            background: rgba(255,255,255,0.06); border: none;
            color: var(--rs-muted, #94a3b8); font-size: 16px;
            width: 30px; height: 30px; border-radius: 50%; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: background .2s; flex-shrink: 0;
        }
        #rs-quiz-fechar:hover, #rs-quiz-hist-fechar:hover { background: rgba(255,255,255,0.12); }

        /* ── Progresso ── */
        .rs-quiz-progress-wrap { padding: 0 16px 12px; flex-shrink: 0; }
        .rs-quiz-progress-bar  { height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; }
        .rs-quiz-progress-bar .fill {
            height: 100%; border-radius: 2px;
            background: linear-gradient(90deg, #0A3D62, #22c55e);
            transition: width .4s ease;
        }

        /* ── Body / Pergunta ── */
        #rs-quiz-body { flex: 1; padding: 0 20px 4px; overflow-y: auto; }
        .rs-quiz-texto {
            font-size: 17px; line-height: 1.55;
            color: var(--rs-text, #f1f5f9); font-weight: 500;
            margin-bottom: 20px; padding-top: 16px;
        }
        .rs-quiz-opcoes { display: flex; flex-direction: column; gap: 10px; }
        .rs-quiz-opcao-btn {
            background: rgba(255,255,255,0.04);
            border: 1.5px solid rgba(255,255,255,0.1);
            padding: 12px 14px; border-radius: 10px;
            display: flex; align-items: center; gap: 12px;
            text-align: left; font-size: 14px; cursor: pointer;
            transition: border-color .2s, background .2s;
            color: var(--rs-text, #f1f5f9); width: 100%;
        }
        .rs-quiz-opcao-btn:hover:not(:disabled) {
            border-color: var(--azul, #0A3D62);
            background: rgba(10,61,98,0.15);
        }
        .rs-quiz-opcao-btn:disabled { cursor: default; }
        .rs-quiz-opcao-letra {
            width: 26px; height: 26px; border-radius: 50%;
            background: rgba(255,255,255,0.08);
            display: flex; align-items: center; justify-content: center;
            font-size: 12px; font-weight: 700; flex-shrink: 0;
            color: var(--rs-muted, #94a3b8);
        }
        .rs-quiz-opcao-texto { flex: 1; line-height: 1.4; }
        .rs-quiz-correta { background: rgba(34,197,94,0.12)  !important; border-color: #22c55e !important; }
        .rs-quiz-correta .rs-quiz-opcao-letra { background: #22c55e !important; color: #fff !important; }
        .rs-quiz-errada  { background: rgba(239,68,68,0.12)  !important; border-color: #ef4444 !important; }
        .rs-quiz-errada  .rs-quiz-opcao-letra { background: #ef4444 !important; color: #fff !important; }
        .rs-quiz-explicacao {
            margin-top: 16px; padding: 14px;
            background: rgba(139,92,246,0.1);
            border-left: 3px solid #8b5cf6; border-radius: 0 8px 8px 0;
            font-size: 13px; color: var(--rs-muted, #94a3b8); line-height: 1.55;
        }
        .rs-quiz-explicacao strong { color: #a78bfa; }

        /* ── Footer ── */
        #rs-quiz-footer {
            padding: 14px 20px; flex-shrink: 0;
            border-top: 1px solid var(--rs-borda, rgba(255,255,255,0.08));
            display: none; justify-content: center;
            background: var(--rs-card2, #162032);
        }
        #rs-quiz-btn-acao, #rs-quiz-btn-sair, #rs-quiz-hist-ok {
            background: var(--azul, #0A3D62); color: #fff;
            border: none; padding: 12px 32px; border-radius: 8px;
            font-size: 15px; font-weight: 600; cursor: pointer;
            width: 100%; max-width: 320px;
            transition: background .2s, transform .15s;
        }
        #rs-quiz-btn-acao:hover, #rs-quiz-btn-sair:hover, #rs-quiz-hist-ok:hover {
            background: #0d4f7c; transform: translateY(-1px);
        }
        #rs-quiz-btn-acao:disabled { opacity: .6; cursor: default; transform: none; }

        /* ── Resultado Final ── */
        .rs-quiz-resultado { text-align: center; padding: 32px 0 16px; }
        .rs-quiz-resultado-icon   { font-size: 56px; margin-bottom: 12px; }
        .rs-quiz-resultado-titulo { font-size: 22px; font-weight: 700; color: var(--rs-text, #f1f5f9); margin: 0 0 16px; }
        .rs-quiz-score-circle {
            width: 96px; height: 96px; border-radius: 50%;
            border: 4px solid var(--azul, #0A3D62);
            display: flex; align-items: center; justify-content: center;
            font-size: 26px; font-weight: 700; color: #fff;
            margin: 0 auto 20px;
            background: rgba(10,61,98,0.2);
        }
        .rs-quiz-score-circle.aprovado  { border-color: #22c55e; background: rgba(34,197,94,0.15); }
        .rs-quiz-score-circle.reprovado { border-color: #f59e0b; background: rgba(245,158,11,0.15); }
        .rs-quiz-resultado-acertos { font-size: 15px; color: var(--rs-text, #f1f5f9); margin: 0 0 8px; }
        .rs-quiz-status-msg        { font-size: 13px; color: var(--rs-muted, #94a3b8); margin: 0; }

        /* ── Histórico ── */
        .rs-quiz-hist-meta {
            font-size: 13px; color: var(--rs-muted, #94a3b8);
            margin: 0 0 16px; padding-bottom: 12px;
            border-bottom: 1px solid var(--rs-borda, rgba(255,255,255,0.08));
        }
        .rs-quiz-hist-lista { display: flex; flex-direction: column; gap: 10px; }
        .rs-quiz-hist-row {
            display: grid;
            grid-template-columns: 28px 52px 1fr auto;
            align-items: center; gap: 12px;
            padding: 12px 14px;
            background: rgba(255,255,255,0.04);
            border-radius: 10px;
        }
        .rs-quiz-hist-num    { font-size: 12px; color: #475569; }
        .rs-quiz-hist-score  { font-size: 18px; font-weight: 700; }
        .rs-quiz-hist-score.aprovado  { color: #4ade80; }
        .rs-quiz-hist-score.reprovado { color: #fbbf24; }
        .rs-quiz-hist-status { font-size: 13px; color: var(--rs-muted, #94a3b8); }
        .rs-quiz-hist-data   { font-size: 12px; color: #475569; white-space: nowrap; }

        /* ── Mobile ── */
        @media (max-width: 480px) {
            .rs-quiz-overlay { padding: 12px 8px; align-items: flex-end; }
            .rs-quiz-modal {
                border-radius: 16px 16px 0 0; max-height: 92vh;
                animation: rsSlideUp 0.3s cubic-bezier(0.16,1,0.3,1);
            }
            .rs-quiz-cta-card { flex-direction: column; text-align: center; }
            .rs-quiz-cta-acoes { flex-direction: row; width: 100%; }
            .rs-quiz-btn-pri, .rs-quiz-btn-sec { flex: 1; text-align: center; }
            .rs-quiz-hist-row { grid-template-columns: 28px 48px 1fr; }
            .rs-quiz-hist-data { display: none; }
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
    _getState:     () => _state,
    _getConfig:    () => _config,
    _getHistorico: () => _historico
};

})();