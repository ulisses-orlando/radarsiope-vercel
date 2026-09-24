/* ==========================================================================
academiaEspeciaisPanel.js — Painel de Quizzes Especiais (Academia)
Integração com: API /api/academia (acao=especiais-painel / especial-detalhe)
                 + QuizManager.initEspecial() (quizApp.js)
Segue o mesmo padrão estrutural de quizResumo.js: IIFE, injeção de CSS,
renderizar(containerId, uid) como entrada pública, skeleton de carregamento.

Pool aberto POR ETAPA (Seção 21.7, v1.7): o painel mostra só os especiais do
nivel_alvo que o assinante está mirando agora (decidido no backend) — nunca
uma lista global misturando Especialista e Mestre.
========================================================================== */
(function () {
'use strict';

let _uidAtual = null;
let _containerIdAtual = null;

// ────────────────────────────────────────────────────────────────────────
// PÚBLICO
// ────────────────────────────────────────────────────────────────────────
async function renderizar(containerId, uid) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!uid) { container.innerHTML = ''; return; }

    _uidAtual = uid;
    _containerIdAtual = containerId;

    injetarEstilosCSS();
    _renderizarSkeleton(container);

    let dados;
    try {
        dados = await _buscarPainel(uid);
    } catch (e) {
        console.warn('[AcademiaEspeciaisPanel] Falha ao buscar painel:', e);
        container.innerHTML = `<p class="rs-esp-erro">Não foi possível carregar os Desafios Especiais agora.</p>`;
        return;
    }

    _renderizarPainel(container, dados);

    // Reagir a um quiz especial concluído noutra parte da tela (o modal do
    // QuizManager já existe e dispara esse evento ao salvar o resultado)
    window.removeEventListener('rs:quizConcluido', _onQuizConcluido);
    window.addEventListener('rs:quizConcluido', _onQuizConcluido);
}

function _onQuizConcluido(ev) {
    if (ev.detail?.tipo !== 'especial') return;
    if (!_uidAtual || !_containerIdAtual) return;
    // Pequeno delay pra garantir que o backend já processou o salvamento
    setTimeout(() => renderizar(_containerIdAtual, _uidAtual), 400);
}

// ────────────────────────────────────────────────────────────────────────
// RENDER
// ────────────────────────────────────────────────────────────────────────
function _renderizarSkeleton(container) {
    container.innerHTML = `<div class="rs-esp-skeleton"><div class="rs-esp-sk-line w60"></div><div class="rs-esp-sk-line w40"></div></div>`;
}

function _renderizarPainel(container, dados) {
    if (dados.bloqueado) {
        container.innerHTML = _mensagemBloqueio(dados.motivo);
        return;
    }

    const { nivel_alvo_nome, total_ativos, total_aprovados, todos_concluidos, especiais } = dados;

    if (total_ativos === 0) {
        container.innerHTML = `
            <div class="rs-esp-vazio">
                <div class="rs-esp-icone">🧩</div>
                <p>Ainda não há Desafios Especiais publicados para o nível <strong>${nivel_alvo_nome}</strong>.
                   Volte em breve — novos são adicionados periodicamente.</p>
            </div>
        `;
        return;
    }

    const cards = especiais.map(e => _renderizarCard(e)).join('');

    const avisoConcluido = todos_concluidos ? `
        <div class="rs-esp-aviso-concluido">
            ✅ Você concluiu todos os Desafios Especiais disponíveis para <strong>${nivel_alvo_nome}</strong>.
            Novos serão publicados em breve — assim que saírem, você pode continuar sua progressão.
        </div>
    ` : '';

    container.innerHTML = `
        <div class="rs-esp-header">
            <h4>🧩 Desafios Especiais — rumo a ${nivel_alvo_nome}</h4>
            <div class="rs-esp-progresso-texto">${total_aprovados} de ${total_ativos} aprovados</div>
            <div class="rs-esp-progresso-barra"><div class="fill" style="width:${total_ativos ? (total_aprovados / total_ativos * 100) : 0}%"></div></div>
        </div>
        ${avisoConcluido}
        <div class="rs-esp-lista">${cards}</div>
    `;

    container.querySelectorAll('[data-responder-id]').forEach(btn => {
        btn.addEventListener('click', () => _responderEspecial(btn.getAttribute('data-responder-id')));
    });
}

function _renderizarCard(e) {
    const statusClasse = e.aprovado ? 'aprovado' : (e.tentativas_usadas > 0 ? 'pendente' : 'novo');
    const statusTexto = e.aprovado
        ? `✅ Aprovado · ${e.melhor_pontuacao}%`
        : e.tentativas_usadas > 0
            ? `${e.tentativas_usadas}/${e.tentativas_max} tentativa(s) · melhor: ${e.melhor_pontuacao}%`
            : 'Ainda não respondido';

    const podeResponder = !e.aprovado && e.tentativas_usadas < e.tentativas_max;
    const dificuldadeTexto = e.dificuldade ? `Dificuldade ${e.dificuldade}/10` : '';

    return `
        <div class="rs-esp-card ${statusClasse}">
            <div class="rs-esp-card-info">
                <div class="rs-esp-card-titulo">${_escapeHtml(e.titulo)}</div>
                ${e.descricao ? `<div class="rs-esp-card-desc">${_escapeHtml(e.descricao)}</div>` : ''}
                <div class="rs-esp-card-meta">${dificuldadeTexto}${dificuldadeTexto ? ' · ' : ''}${statusTexto}</div>
            </div>
            ${e.aprovado
                ? `<span class="rs-esp-badge-ok">✅</span>`
                : podeResponder
                    ? `<button class="rs-esp-btn-responder" data-responder-id="${e.id}">Responder</button>`
                    : `<span class="rs-esp-badge-esgotado">Tentativas esgotadas</span>`}
        </div>
    `;
}

function _mensagemBloqueio(motivo) {
    const mapa = {
        nao_e_membro: {
            icone: '🎓',
            texto: 'Os Desafios Especiais são exclusivos para membros da Academia Radar SIOPE.'
        },
        ainda_nao_desbloqueou: {
            icone: '🔒',
            texto: 'Você desbloqueia os Desafios Especiais ao atingir o nível Dedicado (24 quizzes normais aprovados).'
        },
        ja_e_mestre: {
            icone: '💎',
            texto: 'Parabéns! Você já é Mestre do FUNDEB e concluiu todos os Desafios Especiais necessários.'
        }
    };
    const m = mapa[motivo] || { icone: 'ℹ️', texto: 'Desafios Especiais indisponíveis no momento.' };
    return `<div class="rs-esp-vazio"><div class="rs-esp-icone">${m.icone}</div><p>${m.texto}</p></div>`;
}

// ────────────────────────────────────────────────────────────────────────
// AÇÃO: responder um especial
// ────────────────────────────────────────────────────────────────────────
async function _responderEspecial(quizEspecialId) {
    if (!window.QuizManager?.initEspecial) {
        console.error('[AcademiaEspeciaisPanel] QuizManager.initEspecial não disponível — quizApp.js carregado?');
        return;
    }
    try {
        const detalhe = await _buscarDetalheEspecial(_uidAtual, quizEspecialId);
        const user = window._radarUser || {};
        await window.QuizManager.initEspecial(detalhe, { uid: _uidAtual, segmento: user.segmento || 'assinante' });
    } catch (e) {
        console.warn('[AcademiaEspeciaisPanel] Falha ao carregar Quiz Especial:', e);
        alert('Não foi possível carregar este Desafio agora. Tente novamente em instantes.');
    }
}

// ────────────────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────────────────
async function _buscarPainel(uid) {
    const url = `/api/academia?acao=especiais-painel&uid=${encodeURIComponent(uid)}`;
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.message || 'Erro ao buscar painel de especiais');
    return data;
}

async function _buscarDetalheEspecial(uid, quizEspecialId) {
    const url = `/api/academia?acao=especial-detalhe&uid=${encodeURIComponent(uid)}&quiz_especial_id=${encodeURIComponent(quizEspecialId)}`;
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.message || 'Erro ao buscar Quiz Especial');
    return data;
}

// ────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────
function _escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ────────────────────────────────────────────────────────────────────────
// CSS
// ────────────────────────────────────────────────────────────────────────
function injetarEstilosCSS() {
    if (document.getElementById('rs-esp-style')) return;
    const style = document.createElement('style');
    style.id = 'rs-esp-style';
    style.textContent = `
        .rs-esp-skeleton { padding: 20px; margin: 16px 0; background: var(--rs-card2, #162032); border-radius: 12px; display: flex; flex-direction: column; gap: 10px; }
        .rs-esp-sk-line { height: 12px; border-radius: 6px; background: rgba(255,255,255,0.06); animation: rsPulseEsp 1.4s ease-in-out infinite; }
        .rs-esp-sk-line.w60 { width: 60%; } .rs-esp-sk-line.w40 { width: 40%; }
        @keyframes rsPulseEsp { 0%,100% { opacity:.4 } 50% { opacity:.9 } }

        .rs-esp-erro { color: var(--rs-muted, #94a3b8); font-size: 13px; padding: 16px 0; }
        .rs-esp-vazio { text-align: center; padding: 28px 16px; color: var(--rs-muted, #94a3b8); }
        .rs-esp-vazio .rs-esp-icone { font-size: 32px; margin-bottom: 8px; }

        .rs-esp-header { margin-bottom: 12px; }
        .rs-esp-header h4 { margin: 0 0 6px; font-size: 15px; color: var(--rs-text, #f1f5f9); }
        .rs-esp-progresso-texto { font-size: 12px; color: var(--rs-muted, #94a3b8); margin-bottom: 4px; }
        .rs-esp-progresso-barra { height: 8px; border-radius: 4px; background: rgba(255,255,255,0.08); overflow: hidden; }
        .rs-esp-progresso-barra .fill { height: 100%; background: linear-gradient(90deg,#8b5cf6,#a78bfa); border-radius: 4px; transition: width .3s; }

        .rs-esp-aviso-concluido { background: rgba(139,92,246,0.12); border: 1px solid rgba(139,92,246,0.3); color: var(--rs-text, #f1f5f9); font-size: 12px; padding: 10px 12px; border-radius: 8px; margin-bottom: 12px; }

        .rs-esp-lista { display: flex; flex-direction: column; gap: 8px; }
        .rs-esp-card { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px; border-radius: 10px; background: var(--rs-card2, #162032); border: 1px solid rgba(255,255,255,0.08); }
        .rs-esp-card.aprovado { border-color: rgba(34,197,94,0.4); }
        .rs-esp-card-titulo { font-size: 13px; font-weight: 600; color: var(--rs-text, #f1f5f9); }
        .rs-esp-card-desc { font-size: 12px; color: var(--rs-muted, #94a3b8); margin-top: 2px; }
        .rs-esp-card-meta { font-size: 11px; color: var(--rs-muted, #94a3b8); margin-top: 4px; }

        .rs-esp-btn-responder { padding: 8px 14px; background: #8b5cf6; color: #fff; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
        .rs-esp-btn-responder:hover { background: #7c3aed; }
        .rs-esp-badge-ok { font-size: 18px; }
        .rs-esp-badge-esgotado { font-size: 11px; color: #dc2626; white-space: nowrap; }

        @media (max-width: 480px) {
            .rs-esp-card { flex-direction: column; align-items: flex-start; }
            .rs-esp-btn-responder { width: 100%; }
        }
    `;
    document.head.appendChild(style);
}

// ────────────────────────────────────────────────────────────────────────
// EXPORTAÇÃO GLOBAL
// ────────────────────────────────────────────────────────────────────────
window.AcademiaEspeciaisPanel = { renderizar };

})();
