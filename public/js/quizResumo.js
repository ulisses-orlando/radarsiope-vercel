/* ==========================================================================
quizResumo.js — Resumo Geral de Quiz (todas as edições)
Integração com: Central + API /api/pagamentoMP (acao=quiz-resumo-geral)
Reaproveita as classes CSS já injetadas por quizApp.js quando disponíveis
(rs-quiz-hist-*, rs-quiz-score-circle) e injeta apenas o que falta.

MELHORIAS IMPLEMENTADAS:
- Ordenação por data_publicacao_app (mais recentes primeiro)
- Limite de 10 edições visíveis com scroll
- Botão "Ver todas" para expandir lista completa
- Scrollbar personalizada
- Cores ajustadas para contraste no tema dark
========================================================================== */
(function () {
'use strict';

// ────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÕES
// ────────────────────────────────────────────────────────────────────────
const MAX_EDICOES_VISIVEIS = 10;

// ───────────────────────────────────────────────────────────────────────
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
// ───────────────────────────────────────────────────────────────────────
function _renderizarSkeleton(container) {
    container.innerHTML = `<div class="rs-quiz-skeleton"> <div class="rs-quiz-sk-line w60"></div> <div class="rs-quiz-sk-line w40"></div> </div>`;
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
                <div class="rs-quiz-cta-icon"></div>
                <p>Você ainda não respondeu nenhum quiz. Responda aos quizzes das edições para acompanhar seu desempenho aqui.</p>
            </div>
        `;
        return;
    }

    const percentualAprovacao = Math.round((total_edicoes_aprovadas / total_edicoes_feitas) * 100);

    // ✅ NOVO: Ordenar por data_publicacao_app (mais recente primeiro)
    const edicoesOrdenadas = edicoes
        .slice()
        .sort((a, b) => {
            const dateA = a.data_publicacao_app ? new Date(a.data_publicacao_app) : new Date(0);
            const dateB = b.data_publicacao_app ? new Date(b.data_publicacao_app) : new Date(0);
            return dateB - dateA; // Decrescente: mais recente primeiro
        });

    // ✅ NOVO: Limita a 10 edições visíveis inicialmente
    const haMaisEdicoes = edicoesOrdenadas.length > MAX_EDICOES_VISIVEIS;
    const edicoesVisiveis = haMaisEdicoes 
        ? edicoesOrdenadas.slice(0, MAX_EDICOES_VISIVEIS) 
        : edicoesOrdenadas;

    const linhas = edicoesVisiveis.map(e => {
        const dataFormatada = e.data_publicacao_app 
            ? new Date(e.data_publicacao_app).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
            : '';
        
        return `
            <div class="rs-quiz-hist-row rs-quiz-resumo-row">
                <span class="rs-quiz-hist-status">${e.aprovado ? '✅' : '❌'}</span>
                <span class="rs-quiz-hist-score ${e.aprovado ? 'aprovado' : 'reprovado'}">${e.melhor_pontuacao}%</span>
                <span class="rs-quiz-resumo-titulo-edicao" title="${e.titulo}">${e.titulo}</span>
                <span class="rs-quiz-hist-data">${dataFormatada} · ${e.tentativas_usadas}× tentativa${e.tentativas_usadas > 1 ? 's' : ''}</span>
            </div>
        `;
    }).join('');

    // ✅ NOVO: Botão "Ver todas" se houver mais edições
    const botaoVerTodas = haMaisEdicoes ? `
        <button class="rs-quiz-ver-todas-btn" onclick="QuizResumoManager.mostrarTodas('${container.id}')">
            Ver todas as ${edicoesOrdenadas.length} edições ↓
        </button>
    ` : '';

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
        ${botaoVerTodas}
    `;
}

// ✅ NOVO: Função para mostrar todas as edições
function _mostrarTodas(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Busca os dados novamente e renderiza sem limite
    const uid = container.dataset.uid;
    if (!uid) {
        console.warn('[QuizResumo] UID não encontrado no container');
        return;
    }

    // Re-renderiza sem limite
    const btn = container.querySelector('.rs-quiz-ver-todas-btn');
    if (btn) btn.disabled = true;

    // Busca os dados novamente (ou poderia armazenar em cache)
    _buscarResumoGeral(uid)
        .then(resumo => {
            const {
                edicoes = [],
                total_edicoes_feitas = 0,
                total_edicoes_aprovadas = 0,
                media_geral = 0
            } = resumo;

            const percentualAprovacao = Math.round((total_edicoes_aprovadas / total_edicoes_feitas) * 100);

            // Ordena por data_publicacao_app (mais recente primeiro)
            const edicoesOrdenadas = edicoes
                .slice()
                .sort((a, b) => {
                    const dateA = a.data_publicacao_app ? new Date(a.data_publicacao_app) : new Date(0);
                    const dateB = b.data_publicacao_app ? new Date(b.data_publicacao_app) : new Date(0);
                    return dateB - dateA;
                });

            // Renderiza TODAS as edições (sem limite)
            const linhas = edicoesOrdenadas.map(e => {
                const dataFormatada = e.data_publicacao_app 
                    ? new Date(e.data_publicacao_app).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                    : '';
                
                return `
                    <div class="rs-quiz-hist-row rs-quiz-resumo-row">
                        <span class="rs-quiz-hist-status">${e.aprovado ? '✅' : '❌'}</span>
                        <span class="rs-quiz-hist-score ${e.aprovado ? 'aprovado' : 'reprovado'}">${e.melhor_pontuacao}%</span>
                        <span class="rs-quiz-resumo-titulo-edicao" title="${e.titulo}">${e.titulo}</span>
                        <span class="rs-quiz-hist-data">${dataFormatada} · ${e.tentativas_usadas}× tentativa${e.tentativas_usadas > 1 ? 's' : ''}</span>
                    </div>
                `;
            }).join('');

            // Atualiza apenas a lista (mantém o card de resumo)
            const lista = container.querySelector('.rs-quiz-resumo-lista');
            if (lista) {
                lista.innerHTML = linhas;
                lista.classList.add('rs-quiz-lista-expandida');
            }

            // Remove o botão "Ver todas"
            const btnAtual = container.querySelector('.rs-quiz-ver-todas-btn');
            if (btnAtual) btnAtual.remove();
        })
        .catch(e => {
            console.error('[QuizResumo] Erro ao carregar todas as edições:', e);
            if (btn) btn.disabled = false;
        });
}

// ───────────────────────────────────────────────────────────────────────
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
        
        /* ─ Card resumo ── */
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
        
        /* ✅ NOVO: Lista com scroll limitado */
        .rs-quiz-hist-lista {
            max-height: 320px;
            overflow-y: auto;
            padding-right: 4px;
        }
        
        /* Lista expandida (sem limite de altura) */
        .rs-quiz-lista-expandida {
            max-height: none;
            overflow-y: visible;
        }
        
        /* Scrollbar personalizada */
        .rs-quiz-hist-lista::-webkit-scrollbar {
            width: 6px;
        }
        .rs-quiz-hist-lista::-webkit-scrollbar-track {
            background: rgba(255,255,255,0.05);
            border-radius: 3px;
        }
        .rs-quiz-hist-lista::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.2);
            border-radius: 3px;
        }
        .rs-quiz-hist-lista::-webkit-scrollbar-thumb:hover {
            background: rgba(255,255,255,0.3);
        }
        
        /* ✅ NOVO: Botão "Ver todas" */
        .rs-quiz-ver-todas-btn {
            width: 100%;
            padding: 10px;
            margin-top: 12px;
            background: rgba(255,255,255,0.08);
            border: 1px solid rgba(255,255,255,0.15);
            border-radius: 8px;
            color: #94a3b8;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        .rs-quiz-ver-todas-btn:hover {
            background: rgba(255,255,255,0.12);
            color: #f1f5f9;
        }
        .rs-quiz-ver-todas-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        /* ✅ CORREÇÃO: Texto dentro do círculo de score - azul escuro para contraste */
        .rs-quiz-score-circle span {
            color: #0A3D62 !important;
            font-weight: 700;
        }
        
        /* ✅ CORREÇÃO: Forçar cores claras nos elementos herdados do quizApp */
        .rs-quiz-resumo-lista .rs-quiz-hist-row {
            color: #f1f5f9 !important;
        }
        .rs-quiz-resumo-lista .rs-quiz-resumo-titulo-edicao {
            color: #f1f5f9 !important;
            font-weight: 500;
        }
        .rs-quiz-resumo-lista .rs-quiz-hist-data {
            color: #94a3b8 !important;
            font-size: 12px;
        }
        
        /* ─ Mobile ── */
        @media (max-width: 480px) {
            .rs-quiz-resumo-card { flex-direction: column; text-align: center; }
            .rs-quiz-resumo-row { grid-template-columns: 20px 44px 1fr; }
            .rs-quiz-resumo-row .rs-quiz-hist-data { display: none; }
            .rs-quiz-hist-lista { max-height: 280px; }
        }
    `;
    document.head.appendChild(style);
}

// ────────────────────────────────────────────────────────────────────────
// EXPORTAÇÃO GLOBAL
// ────────────────────────────────────────────────────────────────────────
window.QuizResumoManager = {
    renderizar,
    mostrarTodas: _mostrarTodas
};

})();