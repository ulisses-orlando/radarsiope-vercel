/* ==========================================================================
quizResumo.js — Resumo Geral de Quiz (todas as edições)
Integração com: Central + API /api/pagamentoMP (acao=quiz-resumo-geral)
Reaproveita as classes CSS já injetadas por quizApp.js quando disponíveis
(rs-quiz-hist-*, rs-quiz-score-circle) e injeta apenas o que falta.
========================================================================== */
(function () {
'use strict';

// ────────────────────────────────────────────────────────────────────────
// PÚBLICO
// ────────────────────────────────────────────────────────────────────────

async function renderizar(containerId, uid) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!uid) { container.innerHTML = ''; return; }

    injetarEstilosCSS();
    _renderizarSkeleton(container);

    let resumo;
    try {
        resumo = await _buscarResumoGeral(uid);
    } catch (e) {
        console.warn('[QuizResumo] Falha ao buscar resumo geral:', e);
        container.innerHTML = `<p class="rs-quiz-resumo-erro">Não foi possível carregar seu desempenho no quiz agora.</p>`;
        return;
    }

    _renderizarResumo(container, resumo);
}

// ────────────────────────────────────────────────────────────────────────
// RENDER
// ────────────────────────────────────────────────────────────────────────

function _renderizarSkeleton(container) {
    container.innerHTML = `
        <div class="rs-quiz-skeleton">
            <div class="rs-quiz-sk-line w60"></div>
            <div class="rs-quiz-sk-line w40"></div>
        </div>
    `;
}

function _renderizarResumo(container, resumo) {
    const {
        edicoes = [],
        total_edicoes_feitas = 0,
        total_edicoes_aprovadas = 0,
        media_geral = 0
    } = resumo;

    if (total_edicoes_feitas === 0) {
        container.innerHTML = `
            <div class="rs-quiz-resumo-vazio">
                <div class="rs-quiz-cta-icon">🧠</div>
                <p>Você ainda não respondeu nenhum quiz. Responda aos quizzes das edições para acompanhar seu desempenho aqui.</p>
            </div>
        `;
        return;
    }

    const percentualAprovacao = Math.round((total_edicoes_aprovadas / total_edicoes_feitas) * 100);

    const linhas = edicoes
        .slice()
        .sort((a, b) => (a.titulo || '').localeCompare(b.titulo || ''))
        .map(e => `
            <div class="rs-quiz-hist-row rs-quiz-resumo-row">
                <span class="rs-quiz-hist-status">${e.aprovado ? '✅' : '❌'}</span>
                <span class="rs-quiz-hist-score ${e.aprovado ? 'aprovado' : 'reprovado'}">${e.melhor_pontuacao}%</span>
                <span class="rs-quiz-resumo-titulo-edicao" title="${e.titulo}">${e.titulo}</span>
                <span class="rs-quiz-hist-data">${e.tentativas_usadas}× tentativa${e.tentativas_usadas > 1 ? 's' : ''}</span>
            </div>
        `).join('');

    container.innerHTML = `
        <div class="rs-quiz-resumo-card">
            <div class="rs-quiz-score-circle ${percentualAprovacao >= 70 ? 'aprovado' : 'reprovado'}">
                <span>${media_geral}%</span>
            </div>
            <div class="rs-quiz-resumo-stats">
                <p class="rs-quiz-resumo-media">Média geral entre as edições que você já respondeu</p>
                <p class="rs-quiz-resumo-aprovacao">
                    <strong>${total_edicoes_aprovadas}</strong> de <strong>${total_edicoes_feitas}</strong> edições aprovadas
                    <span class="rs-quiz-info">${percentualAprovacao}%</span>
                </p>
            </div>
        </div>
        <div class="rs-quiz-hist-lista rs-quiz-resumo-lista">
            ${linhas}
        </div>
    `;
}

// ────────────────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────────────────

async function _buscarResumoGeral(uid) {
    const url = `/api/pagamentoMP?acao=quiz-resumo-geral&uid=${encodeURIComponent(uid)}`;
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.message || 'Erro ao buscar resumo geral');
    return data;
}

// ────────────────────────────────────────────────────────────────────────
// CSS (complementar — reaproveita variáveis e classes de quizApp.js)
// ────────────────────────────────────────────────────────────────────────

function injetarEstilosCSS() {
    if (document.getElementById('rs-quiz-resumo-style')) return;

    const style = document.createElement('style');
    style.id = 'rs-quiz-resumo-style';
    style.textContent = `
        /* ── Skeleton (fallback caso quizApp.js não tenha injetado ainda) ── */
        .rs-quiz-skeleton {
            padding: 20px; margin: 24px 0;
            background: var(--rs-card2, #162032);
            border-radius: 12px;
            display: flex; flex-direction: column; gap: 10px;
        }
        .rs-quiz-sk-line {
            height: 12px; border-radius: 6px;
            background: rgba(255,255,255,0.06);
            animation: rsPulseResumo 1.4s ease-in-out infinite;
        }
        .rs-quiz-sk-line.w60 { width: 60%; }
        .rs-quiz-sk-line.w40 { width: 40%; }
        @keyframes rsPulseResumo { 0%,100% { opacity:.4 } 50% { opacity:.9 } }

        /* ── Estado vazio / erro ── */
        .rs-quiz-resumo-vazio {
            text-align: center; padding: 32px 16px;
            color: var(--rs-muted, #94a3b8);
        }
        .rs-quiz-resumo-vazio .rs-quiz-cta-icon { font-size: 36px; margin-bottom: 8px; }
        .rs-quiz-resumo-erro { color: var(--rs-muted, #94a3b8); font-size: 13px; padding: 16px 0; }

        /* ── Card resumo ── */
        .rs-quiz-resumo-card {
            display: flex; align-items: center; gap: 20px;
            background: var(--rs-card2, #162032);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px; padding: 20px; margin-bottom: 20px;
        }
        .rs-quiz-resumo-stats { flex: 1; min-width: 0; }
        .rs-quiz-resumo-media { font-size: 13px; color: var(--rs-muted, #94a3b8); margin: 0 0 6px; }
        .rs-quiz-resumo-aprovacao { font-size: 15px; color: var(--rs-text, #f1f5f9); margin: 0; }

        /* ── Lista por edição ── */
        .rs-quiz-resumo-row {
            grid-template-columns: 24px 52px 1fr auto;
        }
        .rs-quiz-resumo-titulo-edicao {
            font-size: 13px; color: var(--rs-text, #f1f5f9);
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        /* ── Mobile ── */
        @media (max-width: 480px) {
            .rs-quiz-resumo-card { flex-direction: column; text-align: center; }
            .rs-quiz-resumo-row { grid-template-columns: 20px 44px 1fr; }
            .rs-quiz-resumo-row .rs-quiz-hist-data { display: none; }
        }
    `;
    document.head.appendChild(style);
}

// ────────────────────────────────────────────────────────────────────────
// EXPORTAÇÃO GLOBAL
// ────────────────────────────────────────────────────────────────────────

window.QuizResumoManager = {
    renderizar
};

})();
