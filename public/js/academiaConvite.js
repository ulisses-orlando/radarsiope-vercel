/* ==========================================================================
academiaConvite.js — Modal de convite de adesão à Academia Radar SIOPE
Integração: dispara no evento `radarUserReady` (já emitido por
verNewsletterComToken.js após publicarRadarUser()).
Regras de exibição: Seção 21.2 da spec v1.7.
- Só para assinantes
- Só se academia_habilitada === true
- Só se academia.status ausente/nao_convidado/pendente
- Respeita cooldown de 5 dias após "mais tarde"
- Delay de 2,5s para não competir com outros modais
Ações:
- "Aceitar"  → redireciona para /academia.html?uid=UID (página de termos)
- "Mais tarde" → grava convite_ultima_exibicao no Firestore (sem mudar status)
- "Não, obrigado" → grava academia.status='recusado' no Firestore
========================================================================== */
(function () {
'use strict';

const COOLDOWN_MS = 5 * 24 * 60 * 60 * 1000; // 5 dias
const DELAY_EXIBICAO_MS = 2500; // 2,5s após radarUserReady

let _verificadoEstaSessao = false;
let _modalAberto = false;

// ────────────────────────────────────────────────────────────────────────
// PÚBLICO
// ────────────────────────────────────────────────────────────────────────
async function verificarConviteAcademia() {
  if (_verificadoEstaSessao || _modalAberto) return;
  _verificadoEstaSessao = true;

  const user = window._radarUser;
  if (!user?.uid || user.segmento !== 'assinante') return;

  try {
    // 1. Verificar feature flag
    const configSnap = await window.db.collection('config_academia').doc('selos').get();
    const config = configSnap.data() || {};
    if (!config.academia_habilitada) {
      console.info('[academiaConvite] Academia não habilitada — convite não exibido.');
      return;
    }

    // 2. Verificar status do usuário
    const userSnap = await window.db.collection('usuarios').doc(user.uid).get();
    const academia = userSnap.data()?.academia || {};

    // Se já é membro ou recusou explicitamente, não exibe
    if (academia.status === 'membro' || academia.status === 'recusado') return;

    // 3. Verificar cooldown (se já exibiu "mais tarde" recentemente)
    if (academia.convite_ultima_exibicao) {
      const ultimaMs = academia.convite_ultima_exibicao.toDate
        ? academia.convite_ultima_exibicao.toDate().getTime()
        : new Date(academia.convite_ultima_exibicao).getTime();
      const diasDesdeUltima = (Date.now() - ultimaMs) / (1000 * 60 * 60 * 24);
      if (diasDesdeUltima < 5) {
        console.info(`[academiaConvite] Cooldown ativo (${diasDesdeUltima.toFixed(1)} dias) — convite não exibido.`);
        return;
      }
    }

    // 4. Exibir modal com delay
    setTimeout(() => _mostrarModal(user.uid), DELAY_EXIBICAO_MS);
  } catch (e) {
    console.warn('[academiaConvite] Falha ao verificar convite:', e);
  }
}

// ────────────────────────────────────────────────────────────────────────
// MODAL
// ────────────────────────────────────────────────────────────────────────
function _mostrarModal(uid) {
  if (document.getElementById('rs-academia-convite-overlay')) return;
  _modalAberto = true;
  _injetarEstilosCSS();

  const overlay = document.createElement('div');
  overlay.id = 'rs-academia-convite-overlay';
  overlay.className = 'rs-academia-convite-overlay';
  overlay.innerHTML = `
    <div class="rs-academia-convite-modal" role="dialog" aria-modal="true" aria-labelledby="rs-academia-convite-titulo">
      <header class="rs-academia-convite-header">
        <div class="rs-academia-convite-header-left">
          <span class="rs-academia-convite-icone">🏆</span>
          <div>
            <h2 id="rs-academia-convite-titulo">Academia Radar SIOPE</h2>
            <p class="rs-academia-convite-subtitle">Programa de certificação profissional contínua</p>
          </div>
        </div>
        <button class="rs-academia-convite-fechar" aria-label="Fechar">✕</button>
      </header>

      <div class="rs-academia-convite-body">
        <p class="rs-academia-convite-intro">
          Você foi convidado para participar da Academia Radar SIOPE!
        </p>
        <ul class="rs-academia-convite-beneficios">
          <li><span class="rs-academia-convite-bullet">🥉</span> Conquiste selos de competência (Iniciante → Mestre)</li>
          <li><span class="rs-academia-convite-bullet">📄</span> Receba certificados validáveis publicamente</li>
          <li><span class="rs-academia-convite-bullet">🏆</span> Apareça no ranking nacional de especialistas</li>
          <li><span class="rs-academia-convite-bullet">💰</span> Ganhe descontos progressivos por fidelidade</li>
        </ul>
        <p class="rs-academia-convite-disclaimer">
          A participação é <strong>gratuita para assinantes</strong> e requer aceite dos termos de uso.
        </p>
      </div>

      <footer class="rs-academia-convite-footer">
        <button id="rs-academia-aceitar" class="rs-academia-btn-primary" type="button">
          ✅ Aceitar e Participar
        </button>
        <button id="rs-academia-adiar" class="rs-academia-btn-secondary" type="button">
          ⏰ Mais tarde
        </button>
        <button id="rs-academia-recusar" class="rs-academia-btn-text" type="button">
          Não, obrigado
        </button>
      </footer>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  // Event listeners
  overlay.querySelector('.rs-academia-convite-fechar').addEventListener('click', () => _fecharModal());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) _fecharModal(); });
  document.addEventListener('keydown', _onEsc);

  document.getElementById('rs-academia-aceitar').addEventListener('click', () => _aceitar(uid));
  document.getElementById('rs-academia-adiar').addEventListener('click', () => _adiar(uid));
  document.getElementById('rs-academia-recusar').addEventListener('click', () => _recusar(uid));
}

function _onEsc(e) {
  if (e.key === 'Escape' && _modalAberto) _fecharModal();
}

function _fecharModal() {
  document.getElementById('rs-academia-convite-overlay')?.remove();
  document.body.style.overflow = '';
  document.removeEventListener('keydown', _onEsc);
  _modalAberto = false;
}

// ────────────────────────────────────────────────────────────────────────
// AÇÕES
// ────────────────────────────────────────────────────────────────────────
async function _aceitar(uid) {
  // Redireciona para a página de termos (próximo item do roadmap)
  // A página valida que o uid bate com o assinante logado (rs_pwa_session)
  _fecharModal();
  const baseUrl = window.RADAR_CONFIG?.NEXT_PUBLIC_BASE_URL
    || window.location.origin;
  window.open(`${baseUrl}/academia.html?uid=${encodeURIComponent(uid)}`, '_blank');
}

async function _adiar(uid) {
  // Grava convite_ultima_exibicao SEM mudar status (permanece pendente/nao_convidado)
  try {
    await window.db.collection('usuarios').doc(uid).set({
      academia: {
        convite_ultima_exibicao: new Date().toISOString()
      }
    }, { merge: true });
    console.info('[academiaConvite] Convite adiado — volta em 5 dias.');
  } catch (e) {
    console.warn('[academiaConvite] Falha ao gravar adiantamento:', e);
  }
  _fecharModal();
}

async function _recusar(uid) {
  // Confirmação antes de recusar (evita clique acidental)
  const confirmar = confirm(
    'Tem certeza que deseja recusar o convite?\n\n' +
    'Você não receberá mais convites automáticos, mas ainda poderá aderir ' +
    'manualmente a qualquer momento pelo menu do app.'
  );
  if (!confirmar) return;

  try {
    await window.db.collection('usuarios').doc(uid).set({
      academia: {
        status: 'recusado',
        data_recusa: new Date().toISOString()
      }
    }, { merge: true });
    console.info('[academiaConvite] Convite recusado permanentemente.');
  } catch (e) {
    console.warn('[academiaConvite] Falha ao gravar recusa:', e);
    alert('Não foi possível registrar sua escolha. Tente novamente.');
    return;
  }
  _fecharModal();
}

// ────────────────────────────────────────────────────────────────────────
// CSS
// ────────────────────────────────────────────────────────────────────────
function _injetarEstilosCSS() {
  if (document.getElementById('rs-academia-convite-style')) return;
  const style = document.createElement('style');
  style.id = 'rs-academia-convite-style';
  style.textContent = `
    .rs-academia-convite-overlay {
      position: fixed; inset: 0; z-index: 10001;
      background: rgba(0,0,0,0.75);
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      backdrop-filter: blur(3px);
      animation: rsFadeIn .25s ease;
    }
    .rs-academia-convite-modal {
      background: var(--rs-card, #1e293b);
      width: 100%; max-width: 460px;
      border-radius: 16px;
      display: flex; flex-direction: column;
      animation: rsScaleIn 0.3s cubic-bezier(0.16,1,0.3,1);
      box-shadow: 0 24px 60px rgba(0,0,0,0.5);
      border: 1px solid rgba(139,92,246,0.3);
      overflow: hidden;
    }
    .rs-academia-convite-header {
      padding: 20px 24px 16px;
      display: flex; align-items: flex-start; justify-content: space-between;
      background: linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1));
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .rs-academia-convite-header-left { display: flex; align-items: center; gap: 14px; }
    .rs-academia-convite-icone {
      font-size: 40px;
      width: 56px; height: 56px;
      display: flex; align-items: center; justify-content: center;
      background: rgba(139,92,246,0.2);
      border-radius: 14px;
      flex-shrink: 0;
    }
    .rs-academia-convite-header h2 {
      margin: 0; font-size: 18px; font-weight: 700;
      color: var(--rs-text, #f1f5f9);
    }
    .rs-academia-convite-subtitle {
      margin: 2px 0 0; font-size: 12px;
      color: var(--rs-muted, #94a3b8);
    }
    .rs-academia-convite-fechar {
      background: rgba(255,255,255,0.06); border: none;
      color: var(--rs-muted, #94a3b8); font-size: 16px;
      width: 30px; height: 30px; border-radius: 50%; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background .2s; flex-shrink: 0;
    }
    .rs-academia-convite-fechar:hover { background: rgba(255,255,255,0.12); }
    .rs-academia-convite-body { padding: 20px 24px; }
    .rs-academia-convite-intro {
      font-size: 14px; color: var(--rs-text, #f1f5f9);
      margin: 0 0 16px; line-height: 1.5;
    }
    .rs-academia-convite-beneficios {
      list-style: none; padding: 0; margin: 0 0 16px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .rs-academia-convite-beneficios li {
      display: flex; align-items: flex-start; gap: 10px;
      font-size: 13px; color: var(--rs-text, #f1f5f9);
      line-height: 1.45;
    }
    .rs-academia-convite-bullet {
      flex-shrink: 0; font-size: 16px;
      width: 24px; text-align: center;
    }
    .rs-academia-convite-disclaimer {
      font-size: 12px; color: var(--rs-muted, #94a3b8);
      margin: 0; padding: 12px;
      background: rgba(139,92,246,0.08);
      border-left: 3px solid #8b5cf6;
      border-radius: 0 6px 6px 0;
      line-height: 1.5;
    }
    .rs-academia-convite-footer {
      padding: 16px 24px 20px;
      display: flex; flex-direction: column; gap: 8px;
      border-top: 1px solid rgba(255,255,255,0.08);
      background: var(--rs-card2, #162032);
    }
    .rs-academia-btn-primary {
      background: linear-gradient(135deg, #8b5cf6, #6366f1);
      color: #fff; border: none;
      padding: 12px 20px; border-radius: 10px;
      font-size: 14px; font-weight: 600; cursor: pointer;
      transition: transform .15s, box-shadow .2s;
      box-shadow: 0 4px 14px rgba(139,92,246,0.3);
    }
    .rs-academia-btn-primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(139,92,246,0.4);
    }
    .rs-academia-btn-secondary {
      background: rgba(255,255,255,0.06);
      color: var(--rs-text, #f1f5f9);
      border: 1px solid rgba(255,255,255,0.1);
      padding: 10px 20px; border-radius: 10px;
      font-size: 13px; font-weight: 500; cursor: pointer;
      transition: background .2s;
    }
    .rs-academia-btn-secondary:hover { background: rgba(255,255,255,0.1); }
    .rs-academia-btn-text {
      background: transparent; color: var(--rs-muted, #94a3b8);
      border: none; padding: 8px;
      font-size: 12px; cursor: pointer;
      transition: color .2s;
    }
    .rs-academia-btn-text:hover { color: var(--rs-text, #f1f5f9); }
    @media (max-width: 480px) {
      .rs-academia-convite-overlay { padding: 12px 8px; align-items: flex-end; }
      .rs-academia-convite-modal {
        border-radius: 16px 16px 0 0; max-height: 92vh;
        animation: rsSlideUp 0.3s cubic-bezier(0.16,1,0.3,1);
      }
    }
  `;
  document.head.appendChild(style);
}

// ────────────────────────────────────────────────────────────────────────
// REGISTRA LISTENER NO radarUserReady
// ────────────────────────────────────────────────────────────────────────
window.addEventListener('radarUserReady', verificarConviteAcademia);

// ────────────────────────────────────────────────────────────────────────
// EXPORTAÇÃO GLOBAL (para testes e chamada manual)
// ────────────────────────────────────────────────────────────────────────
window.AcademiaConvite = {
  verificar: verificarConviteAcademia,
  _reset: () => { _verificadoEstaSessao = false; _modalAberto = false; }
};
})();