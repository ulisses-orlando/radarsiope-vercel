/* ==========================================================================
academiaConvite.js — Modal de convite de adesão à Academia Radar SIOPE
v1.1 — Modal de Termos integrado (opção b: inline no mesmo container)

Integração: dispara automaticamente no evento `radarUserReady`
(já emitido por verNewsletterComToken.js após publicarRadarUser()).

Fluxo:
  1. Verifica feature flag (config_academia/selos.academia_habilitada)
  2. Verifica status do usuário (membro/recusado → não exibe)
  3. Verifica cooldown de "mais tarde"
  4. Exibe Modal 1: Convite (benefícios, como funciona, etc.)
  5. "Aceitar" → Modal 2: Termos de uso com checkbox (inline, mesmo container)
  6. Confirma → POST /api/academia?acao=aceitar-termos
  7. Sucesso → toast de boas-vindas

Textos generalizados: não expõe valores parametrizáveis (70%, 25%, etc.)
para evitar inconsistência se o admin alterar a configuração.
Tom híbrido: formal em pontos críticos (LGPD, certificados), amigável no resto.
========================================================================== */
(function () {
  'use strict';

  // ── Estado interno ──────────────────────────────────────────────────────
  let _verificadoEstaSessao = false;
  let _modalAberto = false;
  let _uidAtual = null;

  // ── Configurações lidas do Firestore (com fallbacks) ────────────────────
  let _cooldownDias = 5;
  let _delayExibicaoSeg = 2;

  // ========================================================================
  // PÚBLICO
  // ========================================================================
  async function verificarConviteAcademia() {
    if (_verificadoEstaSessao || _modalAberto) return;
    _verificadoEstaSessao = true;

    const user = window._radarUser;
    if (!user?.uid || user.segmento !== 'assinante') return;
    _uidAtual = user.uid;

    try {
      // 1. Ler configuração da Academia
      const configSnap = await window.db
        .collection('config_academia').doc('selos').get();
      const config = configSnap.data() || {};

      // Feature flag (folha direta na raiz)
      if (!config.academia_habilitada) {
        console.info('[academiaConvite] Academia não habilitada.');
        return;
      }

      // Parâmetros de adesão (com fallbacks)
      if (config.adesao?.cooldown_convite_dias) {
        _cooldownDias = config.adesao.cooldown_convite_dias;
      }
      if (config.adesao?.dias_delay_exibicao_convite) {
        _delayExibicaoSeg = config.adesao.dias_delay_exibicao_convite;
      }

      // 2. Verificar status do usuário
      const userSnap = await window.db
        .collection('usuarios').doc(user.uid).get();
      const academia = userSnap.data()?.academia || {};

      if (academia.status === 'membro' || academia.status === 'recusado') {
        return;
      }

      // 3. Verificar cooldown
      if (academia.convite_ultima_exibicao) {
        const ultimaMs = _toMs(academia.convite_ultima_exibicao);
        const diasDesde = (Date.now() - ultimaMs) / (1000 * 60 * 60 * 24);
        if (diasDesde < _cooldownDias) {
          console.info(
            `[academiaConvite] Cooldown ativo (${diasDesde.toFixed(1)} dias).`
          );
          return;
        }
      }

      // 4. Exibir modal com delay
      setTimeout(() => _mostrarModalConvite(), _delayExibicaoSeg * 1000);

    } catch (e) {
      console.warn('[academiaConvite] Falha ao verificar convite:', e);
    }
  }

  // ========================================================================
  // MODAL 1: CONVITE
  // ========================================================================
  function _mostrarModalConvite() {
    if (document.getElementById('rs-acad-overlay')) return;
    _modalAberto = true;
    _injetarCSS();

    const overlay = document.createElement('div');
    overlay.id = 'rs-acad-overlay';
    overlay.className = 'rs-acad-overlay';
    overlay.innerHTML = `
      <div class="rs-acad-modal" role="dialog" aria-modal="true"
           aria-labelledby="rs-acad-titulo">

        <!-- HEADER -->
        <header class="rs-acad-header">
          <div class="rs-acad-header-left">
            <span class="rs-acad-icone">🏆</span>
            <div>
              <h2 id="rs-acad-titulo">Academia Radar SIOPE</h2>
              <p class="rs-acad-subtitle">
                Programa de certificação profissional contínua
              </p>
            </div>
          </div>
          <button class="rs-acad-fechar" aria-label="Fechar" id="rs-acad-btn-fechar">✕</button>
        </header>

        <!-- BODY -->
        <div class="rs-acad-body">

          <p class="rs-acad-intro">
            Você foi convidado para participar da
            <strong>Academia Radar SIOPE</strong>!
          </p>

          <!-- BENEFÍCIOS -->
          <h3 class="rs-acad-secao-titulo">🎯 Benefícios</h3>
          <ul class="rs-acad-lista">
            <li>
              <span class="rs-acad-bullet">🥉</span>
              Conquiste níveis de certificação reconhecidos
            </li>
            <li>
              <span class="rs-acad-bullet">📄</span>
              Receba certificados PDF validáveis publicamente
            </li>
            <li>
              <span class="rs-acad-bullet">🏆</span>
              Apareça no ranking nacional de especialistas
            </li>
            <li>
              <span class="rs-acad-bullet">💰</span>
              Ganhe descontos progressivos por fidelidade
            </li>
          </ul>

          <!-- COMO FUNCIONA -->
          <h3 class="rs-acad-secao-titulo">📋 Como Funciona</h3>
          <ul class="rs-acad-lista">
            <li>
              <span class="rs-acad-bullet">📚</span>
              Responda quizzes semanais sobre nossos conteúdos de gestão educacional
            </li>
            <li>
              <span class="rs-acad-bullet">✅</span>
              Mantenha frequência e aproveitamento mínimo exigidos
            </li>
            <li>
              <span class="rs-acad-bullet">💎</span>
              Desafios especiais para níveis avançados
            </li>
            <li>
              <span class="rs-acad-bullet">🃏</span>
              Coringas para imprevistos (férias, doença, sobrecarga de trabalho)
            </li>
          </ul>

          <!-- CLUBE DE EXCELÊNCIA -->
          <div class="rs-acad-card-destaque">
            <h3 class="rs-acad-secao-titulo" style="margin-top:0">
              💎 Clube de Excelência
            </h3>
            <p class="rs-acad-card-texto">
              Ao manter o nível máximo por anos consecutivos, você recebe
              <strong>descontos progressivos na assinatura</strong> —
              quanto mais tempo, maior o desconto.
            </p>
          </div>

          <!-- TRANSPARÊNCIA -->
          <h3 class="rs-acad-secao-titulo">⚖️ Transparência</h3>
          <ul class="rs-acad-lista rs-acad-lista-sm">
            <li>Participação gratuita para assinantes ativos</li>
            <li>Você controla sua visibilidade no ranking</li>
            <li>Pode cancelar a adesão a qualquer momento</li>
            <li>Dados protegidos pela LGPD</li>
          </ul>

        </div>

        <!-- FOOTER -->
        <footer class="rs-acad-footer">
          <button id="rs-acad-aceitar" class="rs-acad-btn-primary" type="button">
            ✅ Aceitar e Participar
          </button>
          <button id="rs-acad-adiar" class="rs-acad-btn-secondary" type="button">
            ⏰ Mais tarde
          </button>
          <button id="rs-acad-recusar" class="rs-acad-btn-text" type="button">
            Não, obrigado
          </button>
        </footer>

      </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Event listeners
    document.getElementById('rs-acad-btn-fechar')
      .addEventListener('click', _fecharTudo);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) _fecharTudo();
    });
    document.addEventListener('keydown', _onEsc);

    document.getElementById('rs-acad-aceitar')
      .addEventListener('click', _mostrarModalTermos);
    document.getElementById('rs-acad-adiar')
      .addEventListener('click', _adiar);
    document.getElementById('rs-acad-recusar')
      .addEventListener('click', _recusar);
  }

  // ========================================================================
  // MODAL 2: TERMOS DE USO (v1.1 — tom híbrido + link para termosAcademia.html)
  // ========================================================================
  function _mostrarModalTermos() {
    // Substitui o conteúdo do modal existente (mesmo container)
    const modal = document.querySelector('.rs-acad-modal');
    if (!modal) return;

    modal.innerHTML = `
      <!-- HEADER -->
      <header class="rs-acad-header">
        <div class="rs-acad-header-left">
          <span class="rs-acad-icone">📜</span>
          <div>
            <h2>Termos de Participação</h2>
            <p class="rs-acad-subtitle">Academia Radar SIOPE</p>
          </div>
        </div>
        <button class="rs-acad-fechar" aria-label="Fechar" id="rs-acad-btn-fechar-termos">✕</button>
      </header>

      <!-- BODY -->
      <div class="rs-acad-body rs-acad-termos-body">

        <div class="rs-acad-termos-scroll">

          <!-- 1. Participação Voluntária (amigável) -->
          <h4>1. Participação Voluntária</h4>
          <p>
            A participação na Academia Radar SIOPE é <strong>voluntária e gratuita</strong>
            para assinantes ativos da plataforma. Você pode cancelar a adesão a qualquer
            momento, sem burocracia — e seu histórico de conquistas fica preservado.
          </p>

          <!-- 2. Certificação e Níveis (amigável) -->
          <h4>2. Certificação e Níveis</h4>
          <p>
            Os níveis de certificação (Iniciante, Dedicado, Especialista e Mestre) são
            conquistados com base no seu desempenho em quizzes semanais sobre gestão
            educacional municipal. Cada nível exige uma quantidade específica de quizzes
            aprovados com aproveitamento mínimo. A progressão é automática — assim que
            você atinge os requisitos, sobe de nível na hora.
          </p>

          <!-- 3. Manutenção do Selo (amigável) -->
          <h4>3. Manutenção do Selo</h4>
          <p>
            Para manter o selo ativo, basta responder periodicamente aos quizzes e manter
            o aproveitamento mínimo. A inatividade prolongada pode resultar em
            congelamento ou rebaixamento do nível — mas temos Coringas disponíveis para
            situações de imprevisto (férias, doença, sobrecarga).
          </p>

          <!-- 4. Visibilidade no Ranking (híbrido — privacidade é crítica) -->
          <h4>4. Visibilidade no Ranking</h4>
          <p>
            Por padrão, sua participação no ranking público é <strong>anônima</strong>
            (exibida como "Servidor de [Município/UF]"). Você pode optar por aparecer
            com seu nome completo ou não aparecer no ranking. Essa escolha pode ser
            alterada a qualquer momento nas configurações do app.
          </p>

          <!-- 5. Certificados (formal — documento oficial) -->
          <h4>5. Certificados</h4>
          <p>
            Os certificados emitidos pela Academia são <strong>documentos oficiais</strong>
            validáveis publicamente via QR Code e código único de verificação. O certificado
            inclui seu nome, nível conquistado, dados de desempenho e posicionamento
            percentil anonimizado no ranking.
          </p>

          <!-- 6. Clube de Excelência (amigável) -->
          <h4>6. Clube de Excelência</h4>
          <p>
            Assinantes que mantêm o nível máximo por anos consecutivos recebem
            <strong>descontos progressivos na assinatura</strong>. Os percentuais e regras
            de elegibilidade são definidos pela administração e podem ser consultados no
            painel do assinante.
          </p>

          <!-- 7. Proteção de Dados (formal — LGPD é crítico) -->
          <h4>7. Proteção de Dados (LGPD)</h4>
          <p>
            Os dados coletados para fins da Academia (desempenho em quizzes, nível,
            município) são tratados em <strong>estrita conformidade com a Lei Geral de
            Proteção de Dados (Lei 13.709/2018)</strong>. Você pode solicitar a exclusão
            de seus dados do ranking e do histórico a qualquer momento, exercendo seu
            direito ao esquecimento.
          </p>

          <!-- 8. Alterações nos Termos (híbrido) -->
          <h4>8. Alterações nos Termos</h4>
          <p>
            A administração reserva-se o direito de atualizar estes termos e as regras
            do programa. Alterações significativas serão comunicadas via notificação no
            app, com antecedência razoável.
          </p>

        </div>

        <!-- Link para versão completa -->
        <div class="rs-acad-termos-link-completo">
          📄 <a href="/termosAcademia.html" target="_blank" rel="noopener">
            Ver versão completa dos termos
          </a>
        </div>

        <!-- Checkbox obrigatório -->
        <label class="rs-acad-checkbox-label">
          <input type="checkbox" id="rs-acad-aceite-check">
          <span>Li e concordo com os <strong>Termos de Participação</strong> da Academia Radar SIOPE</span>
        </label>

      </div>

      <!-- FOOTER -->
      <footer class="rs-acad-footer">
        <button id="rs-acad-confirmar" class="rs-acad-btn-primary" type="button" disabled>
          ✅ Confirmar Adesão
        </button>
        <button id="rs-acad-voltar-convite" class="rs-acad-btn-secondary" type="button">
          ← Voltar
        </button>
      </footer>
    `;

    // Event listeners do modal de termos
    document.getElementById('rs-acad-btn-fechar-termos')
      .addEventListener('click', _fecharTudo);

    document.getElementById('rs-acad-voltar-convite')
      .addEventListener('click', () => {
        // Reabre o modal de convite
        _modalAberto = false;
        document.getElementById('rs-acad-overlay')?.remove();
        _mostrarModalConvite();
      });

    const check = document.getElementById('rs-acad-aceite-check');
    const btnConfirmar = document.getElementById('rs-acad-confirmar');
    check.addEventListener('change', () => {
      btnConfirmar.disabled = !check.checked;
    });

    btnConfirmar.addEventListener('click', _confirmarAdesao);
  }

  // ========================================================================
  // AÇÕES
  // ========================================================================

  async function _confirmarAdesao() {
    const btn = document.getElementById('rs-acad-confirmar');
    btn.disabled = true;
    btn.textContent = '⏳ Confirmando...';

    try {
      const resp = await fetch('/api/academia?acao=aceitar-termos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: _uidAtual,
          termos_versao: 'v1'
        })
      });

      const data = await resp.json();

      if (resp.ok && (data.status === 'membro' || data.status === 'ja_membro' || data.ok)) { // data.ok para compatibilidade com sua API atual
      
        // ✅ SINCRONIZA COM LOCALSTORAGE
        const sessao = JSON.parse(localStorage.getItem('rs_pwa_session') || '{}');
        sessao.academia = { status: 'membro', data_adesao: new Date().toISOString() };
        localStorage.setItem('rs_pwa_session', JSON.stringify(sessao));

        _fecharTudo();
        _mostrarToast('🎉 Bem-vindo à Academia Radar SIOPE!');
        console.info('[academiaConvite] Adesão confirmada com sucesso.');
        
        // Opcional: recarregar o menu para trocar o botão instantaneamente
        if (typeof window._rsMenuAtualizarBadges === 'function') window._rsMenuAtualizarBadges(); 
          // Ou simplesmente: location.reload(); se preferir um refresh limpo
      } else {
        throw new Error(data.erro || data.message || 'Erro desconhecido');
      }
    } catch (e) {
      console.error('[academiaConvite] Falha na adesão:', e);
      btn.disabled = false;
      btn.textContent = '✅ Confirmar Adesão';
      alert('Não foi possível confirmar sua adesão. Tente novamente.');
    }
  }

  async function _adiar() {
    try {
      await window.db.collection('usuarios').doc(_uidAtual).set({
        academia: {
          convite_ultima_exibicao: new Date().toISOString()
        }
      }, { merge: true });
        // ✅ SINCRONIZA COM LOCALSTORAGE
      const sessao = JSON.parse(localStorage.getItem('rs_pwa_session') || '{}');
      if (!sessao.academia) sessao.academia = {};
      sessao.academia.status = 'pendente'; // ou mantém como estava
      sessao.academia.convite_ultima_exibicao = new Date().toISOString();
      console.info(`[academiaConvite] Adiado — volta em ${_cooldownDias} dias.`);
    } catch (e) {
      console.warn('[academiaConvite] Falha ao gravar adiamento:', e);
    }
    _fecharTudo();
  }

  async function _recusar() {
    const confirmar = confirm(
      'Tem certeza que deseja recusar o convite?\n\n' +
      'Você não receberá mais convites automáticos, mas poderá aderir ' +
      'manualmente a qualquer momento pelo menu do app.'
    );
    if (!confirmar) return;

    try {
      const agoraISO = new Date().toISOString();
      
      // Grava no Firestore
      await window.db.collection('usuarios').doc(_uidAtual).set({
        academia: {
          status: 'recusado',
          data_recusa: agoraISO
        }
      }, { merge: true });

      // ✅ SINCRONIZA COM LOCALSTORAGE
      const sessao = JSON.parse(localStorage.getItem('rs_pwa_session') || '{}');
      sessao.academia = { status: 'recusado', data_recusa: agoraISO };
      localStorage.setItem('rs_pwa_session', JSON.stringify(sessao));

      console.info('[academiaConvite] Convite recusado.');
    } catch (e) {
      console.warn('[academiaConvite] Falha ao gravar recusa:', e);
      alert('Não foi possível registrar sua escolha. Tente novamente.');
      return;
    }
    _fecharTudo();
  }

  // ========================================================================
  // UTILITÁRIOS
  // ========================================================================

  function _fecharTudo() {
    document.getElementById('rs-acad-overlay')?.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', _onEsc);
    _modalAberto = false;
  }

  function _onEsc(e) {
    if (e.key === 'Escape' && _modalAberto) _fecharTudo();
  }

  function _toMs(ts) {
    if (ts?.toDate) return ts.toDate().getTime();
    if (ts instanceof Date) return ts.getTime();
    return new Date(ts).getTime();
  }

  function _mostrarToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'rs-acad-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('rs-acad-toast-show'));
    setTimeout(() => {
      toast.classList.remove('rs-acad-toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ========================================================================
  // CSS (v1.1 — adicionado estilo para link de termos completo)
  // ========================================================================
  function _injetarCSS() {
    if (document.getElementById('rs-acad-style')) return;
    const style = document.createElement('style');
    style.id = 'rs-acad-style';
    style.textContent = `
      /* ── Overlay ──────────────────────────────────────────────── */
      .rs-acad-overlay {
        position: fixed; inset: 0; z-index: 10001;
        background: rgba(0,0,0,0.75);
        display: flex; align-items: center; justify-content: center;
        padding: 16px;
        backdrop-filter: blur(3px);
        animation: rsAcadFadeIn .25s ease;
      }
      @keyframes rsAcadFadeIn {
        from { opacity: 0 } to { opacity: 1 }
      }

      /* ── Modal ────────────────────────────────────────────────── */
      .rs-acad-modal {
        background: var(--rs-card, #1e293b);
        width: 100%; max-width: 480px;
        max-height: 90vh;
        border-radius: 16px;
        display: flex; flex-direction: column;
        animation: rsAcadScaleIn .3s cubic-bezier(.16,1,.3,1);
        box-shadow: 0 24px 60px rgba(0,0,0,.5);
        border: 1px solid rgba(139,92,246,.25);
        overflow: hidden;
      }
      @keyframes rsAcadScaleIn {
        from { opacity: 0; transform: scale(.92) }
        to   { opacity: 1; transform: scale(1) }
      }

      /* ── Header ───────────────────────────────────────────────── */
      .rs-acad-header {
        padding: 20px 24px 16px;
        display: flex; align-items: flex-start;
        justify-content: space-between;
        background: linear-gradient(135deg,
          rgba(139,92,246,.12), rgba(59,130,246,.08));
        border-bottom: 1px solid rgba(255,255,255,.06);
      }
      .rs-acad-header-left {
        display: flex; align-items: center; gap: 14px;
      }
      .rs-acad-icone {
        font-size: 36px; width: 52px; height: 52px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(139,92,246,.15);
        border-radius: 14px; flex-shrink: 0;
      }
      .rs-acad-header h2 {
        margin: 0; font-size: 18px; font-weight: 700;
        color: var(--rs-text, #f1f5f9);
      }
      .rs-acad-subtitle {
        margin: 2px 0 0; font-size: 12px;
        color: var(--rs-muted, #94a3b8);
      }
      .rs-acad-fechar {
        background: rgba(255,255,255,.06); border: none;
        color: var(--rs-muted, #94a3b8); font-size: 15px;
        width: 30px; height: 30px; border-radius: 50%;
        cursor: pointer; display: flex;
        align-items: center; justify-content: center;
        transition: background .2s; flex-shrink: 0;
      }
      .rs-acad-fechar:hover { background: rgba(255,255,255,.12); }

      /* ── Body ─────────────────────────────────────────────────── */
      .rs-acad-body {
        padding: 20px 24px;
        overflow-y: auto; flex: 1;
      }
      .rs-acad-intro {
        font-size: 14px; color: var(--rs-text, #f1f5f9);
        margin: 0 0 18px; line-height: 1.5;
      }
      .rs-acad-secao-titulo {
        font-size: 12px; font-weight: 700;
        text-transform: uppercase; letter-spacing: .5px;
        color: var(--rs-muted, #94a3b8);
        margin: 18px 0 8px;
      }
      .rs-acad-secao-titulo:first-of-type { margin-top: 0; }

      /* ── Listas ───────────────────────────────────────────────── */
      .rs-acad-lista {
        list-style: none; padding: 0; margin: 0 0 4px;
        display: flex; flex-direction: column; gap: 8px;
      }
      .rs-acad-lista li {
        display: flex; align-items: flex-start; gap: 10px;
        font-size: 13px; color: var(--rs-text, #f1f5f9);
        line-height: 1.45;
      }
      .rs-acad-bullet {
        flex-shrink: 0; font-size: 15px;
        width: 22px; text-align: center;
      }
      .rs-acad-lista-sm li {
        font-size: 12px; color: var(--rs-muted, #94a3b8);
      }

      /* ── Card destaque (Clube de Excelência) ─────────────────── */
      .rs-acad-card-destaque {
        background: rgba(139,92,246,.08);
        border-left: 3px solid #8b5cf6;
        border-radius: 0 8px 8px 0;
        padding: 14px 16px; margin: 12px 0;
      }
      .rs-acad-card-texto {
        font-size: 13px; color: var(--rs-text, #f1f5f9);
        margin: 0; line-height: 1.5;
      }

      /* ── Termos (Modal 2) ─────────────────────────────────────── */
      .rs-acad-termos-body {
        display: flex; flex-direction: column;
      }
      .rs-acad-termos-scroll {
        flex: 1; overflow-y: auto;
        max-height: 45vh;
        padding-right: 8px;
        margin-bottom: 12px;
      }
      .rs-acad-termos-scroll h4 {
        font-size: 13px; font-weight: 600;
        color: var(--rs-text, #f1f5f9);
        margin: 16px 0 6px;
      }
      .rs-acad-termos-scroll h4:first-child { margin-top: 0; }
      .rs-acad-termos-scroll p {
        font-size: 12px; color: var(--rs-muted, #94a3b8);
        margin: 0 0 4px; line-height: 1.55;
      }
      .rs-acad-termos-scroll strong {
        color: var(--rs-text, #f1f5f9);
      }

      /* ── Link para versão completa ────────────────────────────── */
      .rs-acad-termos-link-completo {
        text-align: center;
        padding: 10px 0;
        margin-bottom: 12px;
        border-top: 1px solid rgba(255,255,255,.06);
        border-bottom: 1px solid rgba(255,255,255,.06);
      }
      .rs-acad-termos-link-completo a {
        color: #60a5fa;
        text-decoration: none;
        font-size: 12px;
        font-weight: 600;
        transition: color .2s;
      }
      .rs-acad-termos-link-completo a:hover {
        color: #93c5fd;
        text-decoration: underline;
      }

      /* ── Checkbox ─────────────────────────────────────────────── */
      .rs-acad-checkbox-label {
        display: flex; align-items: flex-start; gap: 10px;
        font-size: 13px; color: var(--rs-text, #f1f5f9);
        cursor: pointer; padding: 12px;
        background: rgba(139,92,246,.06);
        border-radius: 8px;
        border: 1px solid rgba(139,92,246,.15);
      }
      .rs-acad-checkbox-label input[type="checkbox"] {
        margin-top: 2px; flex-shrink: 0;
        accent-color: #8b5cf6;
        width: 16px; height: 16px;
      }

      /* ── Footer ───────────────────────────────────────────────── */
      .rs-acad-footer {
        padding: 16px 24px 20px;
        display: flex; flex-direction: column; gap: 8px;
        border-top: 1px solid rgba(255,255,255,.06);
        background: var(--rs-card2, #162032);
      }
      .rs-acad-btn-primary {
        background: linear-gradient(135deg, #8b5cf6, #6366f1);
        color: #fff; border: none;
        padding: 12px 20px; border-radius: 10px;
        font-size: 14px; font-weight: 600; cursor: pointer;
        transition: transform .15s, box-shadow .2s, opacity .2s;
        box-shadow: 0 4px 14px rgba(139,92,246,.3);
      }
      .rs-acad-btn-primary:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(139,92,246,.4);
      }
      .rs-acad-btn-primary:disabled {
        opacity: .45; cursor: not-allowed;
      }
      .rs-acad-btn-secondary {
        background: rgba(255,255,255,.06);
        color: var(--rs-text, #f1f5f9);
        border: 1px solid rgba(255,255,255,.1);
        padding: 10px 20px; border-radius: 10px;
        font-size: 13px; font-weight: 500; cursor: pointer;
        transition: background .2s;
      }
      .rs-acad-btn-secondary:hover { background: rgba(255,255,255,.1); }
      .rs-acad-btn-text {
        background: transparent; color: var(--rs-muted, #94a3b8);
        border: none; padding: 8px;
        font-size: 12px; cursor: pointer;
        transition: color .2s;
      }
      .rs-acad-btn-text:hover { color: var(--rs-text, #f1f5f9); }

      /* ── Toast ────────────────────────────────────────────────── */
      .rs-acad-toast {
        position: fixed; bottom: 24px; left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: linear-gradient(135deg, #8b5cf6, #6366f1);
        color: #fff; padding: 14px 28px;
        border-radius: 12px; font-size: 14px; font-weight: 600;
        box-shadow: 0 8px 30px rgba(139,92,246,.4);
        opacity: 0; transition: all .3s ease;
        z-index: 10002; white-space: nowrap;
      }
      .rs-acad-toast-show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      /* ── Mobile ───────────────────────────────────────────────── */
      @media (max-width: 480px) {
        .rs-acad-overlay {
          padding: 12px 8px; align-items: flex-end;
        }
        .rs-acad-modal {
          border-radius: 16px 16px 0 0;
          max-height: 92vh;
          animation: rsAcadSlideUp .3s cubic-bezier(.16,1,.3,1);
        }
        @keyframes rsAcadSlideUp {
          from { transform: translateY(100%) }
          to   { transform: translateY(0) }
        }
        .rs-acad-header { padding: 16px 16px 12px; }
        .rs-acad-body { padding: 16px; }
        .rs-acad-footer { padding: 12px 16px 16px; }
        .rs-acad-termos-scroll { max-height: 40vh; }
      }
    `;
    document.head.appendChild(style);
  }

  // ========================================================================
  // REGISTRO
  // ========================================================================
  window.addEventListener('radarUserReady', verificarConviteAcademia);

  // Exportação global (para testes manuais)
  window.AcademiaConvite = {
    verificar: verificarConviteAcademia,
    _reset: () => { _verificadoEstaSessao = false; _modalAberto = false; }
  };

})();