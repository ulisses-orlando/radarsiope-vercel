/* ==========================================================================
academiaDashboard.js — Dashboard da Academia Radar SIOPE
Versão simplificada e funcional
========================================================================== */
(function () {
'use strict';

let _uidAtual = null;

// ────────────────────────────────────────────────────────────────────────
// PÚBLICO
// ────────────────────────────────────────────────────────────────────────
async function abrir(uid) {
  if (!uid) {
    console.warn('[AcademiaDashboard] uid obrigatório');
    return;
  }
  _uidAtual = uid;
  _injetarCSS();
  _montarEstrutura();
  
  try {
    const dados = await _buscarDadosAcademia(uid);
    _renderizarDashboard(dados);
  } catch (e) {
    console.error('[AcademiaDashboard] Erro ao carregar:', e);
    _renderizarErro(e.message);
  }
}

function fechar() {
  const painel = document.getElementById('rs-acad-dashboard');
  if (!painel) return;
  painel.style.opacity = '0';
  painel.style.transition = 'opacity .2s';
  setTimeout(() => {
    painel.remove();
    document.body.style.overflow = '';
  }, 200);
}

// ────────────────────────────────────────────────────────────────────────
// ESTRUTURA
// ────────────────────────────────────────────────────────────────────────
function _montarEstrutura() {
  document.getElementById('rs-acad-dashboard')?.remove();
  
  const painel = document.createElement('div');
  painel.id = 'rs-acad-dashboard';
  painel.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 800;
    background: var(--rs-bg, #0f172a);
    overflow-y: auto;
    animation: rsFadeIn .2s ease;
    display: flex;
    flex-direction: column;
  `;
  
  painel.innerHTML = `
    <header class="rs-acad-dash-header">
      <button class="rs-acad-dash-voltar" id="rs-acad-dash-voltar">← Voltar</button>
      <div class="rs-acad-dash-titulo-wrap">
        <span class="rs-acad-dash-titulo-icone">🏆</span>
        <div>
          <h1 class="rs-acad-dash-titulo">Minha Academia</h1>
          <p class="rs-acad-dash-subtitulo">Sua jornada de certificação profissional</p>
        </div>
      </div>
      <div class="rs-acad-dash-header-spacer"></div>
    </header>
    <main class="rs-acad-dash-main" id="rs-acad-dash-main">
      <div class="rs-acad-dash-skeleton">
        <div class="rs-acad-dash-sk-card"></div>
        <div class="rs-acad-dash-sk-row"></div>
        <div class="rs-acad-dash-sk-row"></div>
      </div>
    </main>
  `;
  
  document.body.appendChild(painel);
  document.body.style.overflow = 'hidden';
  
  document.getElementById('rs-acad-dash-voltar')
    .addEventListener('click', fechar);
}

// ────────────────────────────────────────────────────────────────────────
// BUSCA DE DADOS
// ────────────────────────────────────────────────────────────────────────
async function _buscarDadosAcademia(uid) {
  const [userSnap, certSnap, configSnap] = await Promise.all([
    window.db.collection('usuarios').doc(uid).get(),
    window.db.collection('certificados').doc(uid).get(),
    window.db.collection('config_academia').doc('selos').get(),
  ]);
  
  const userData = userSnap.data() || {};
  const certData = certSnap.data() || {};
  const configData = configSnap.data() || {};
  
  let cicloAtual = null;
  if (certData.ciclo_contrato_atual) {
    const cicloSnap = await certSnap.ref
      .collection('historico')
      .doc(String(certData.ciclo_contrato_atual))
      .get();
    if (cicloSnap.exists) cicloAtual = cicloSnap.data();
  }
  
  const niveisConquistadosSnap = await userSnap.ref
    .collection('academia_niveis')
    .get();
  const niveisConquistados = niveisConquistadosSnap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));
  
  const [especialistaAtivosSnap, mestreAtivosSnap] = await Promise.all([
    window.db.collection('quizzes_especiais')
      .where('nivel_alvo', '==', 'especialista')
      .where('ativo', '==', true)
      .get(),
    window.db.collection('quizzes_especiais')
      .where('nivel_alvo', '==', 'mestre')
      .where('ativo', '==', true)
      .get(),
  ]);
  
  return {
    usuario: userData,
    certificado: certData,
    config: configData,
    cicloAtual,
    niveisConquistados,
    especiaisAtivos: {
      especialista: especialistaAtivosSnap.size,
      mestre: mestreAtivosSnap.size,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// RENDER
// ────────────────────────────────────────────────────────────────────────
function _renderizarErro(msg) {
  const main = document.getElementById('rs-acad-dash-main');
  if (!main) return;
  main.innerHTML = `
    <div class="rs-acad-dash-erro">
      <div class="rs-acad-dash-erro-icone">⚠️</div>
      <h3>Não foi possível carregar sua Academia</h3>
      <p>${_escapeHtml(msg)}</p>
      <button onclick="window.AcademiaDashboard.abrir('${_uidAtual}')">Tentar novamente</button>
    </div>
  `;
}

function _renderizarDashboard(dados) {
  const main = document.getElementById('rs-acad-dash-main');
  if (!main) return;
  
  const { certificado, config, cicloAtual, niveisConquistados, especiaisAtivos } = dados;
  const nivelAtual = certificado.nivel_atual_global || 'iniciante';
  const configNivel = config.niveis?.[nivelAtual] || {};
  
  const normaisAprovados = cicloAtual?.quizzes_normais_aprovados_ciclo || 0;
  const normaisNecessarios = 48;
  const normaisPct = Math.min(100, Math.round((normaisAprovados / normaisNecessarios) * 100));
  
  const espEspecialista = cicloAtual?.quizzes_especiais_aprovados_especialista || 0;
  const espMestre = cicloAtual?.quizzes_especiais_aprovados_mestre || 0;
  
  main.innerHTML = `
    <section class="rs-acad-dash-card rs-acad-dash-card-nivel" style="border-left-color:${configNivel.cor || '#8b5cf6'}">
      <div class="rs-acad-dash-nivel-header">
        <div class="rs-acad-dash-nivel-icone-grande" style="background:${configNivel.cor || '#8b5cf6'}20;color:${configNivel.cor || '#8b5cf6'}">
          ${configNivel.icone || '🏆'}
        </div>
        <div class="rs-acad-dash-nivel-texto">
          <div class="rs-acad-dash-nivel-label">Nível atual</div>
          <div class="rs-acad-dash-nivel-nome-grande">${configNivel.nome || nivelAtual}</div>
          <div class="rs-acad-dash-nivel-ciclo">
            ${certificado.ciclo_contrato_atual ? `Ano de contrato ${certificado.ciclo_contrato_atual}` : ''}
          </div>
        </div>
      </div>
    </section>
    
    <section class="rs-acad-dash-card">
      <h3 class="rs-acad-dash-card-titulo">📚 Quizzes Normais</h3>
      <div class="rs-acad-dash-progresso">
        <div class="rs-acad-dash-progresso-info">
          <span class="rs-acad-dash-progresso-num">${normaisAprovados}</span>
          <span class="rs-acad-dash-progresso-total">de ${normaisNecessarios} aprovados</span>
        </div>
        <div class="rs-acad-dash-progresso-barra">
          <div class="rs-acad-dash-progresso-fill" style="width:${normaisPct}%"></div>
        </div>
        <div class="rs-acad-dash-progresso-pct">${normaisPct}%</div>
      </div>
    </section>
    
    <section class="rs-acad-dash-card rs-acad-dash-card-especiais">
      <h3 class="rs-acad-dash-card-titulo">💎 Desafios Especiais</h3>
      <div class="rs-acad-dash-especiais-stats">
        <div class="rs-acad-dash-especial-stat">
          <div class="rs-acad-dash-especial-num">${espEspecialista}</div>
          <div class="rs-acad-dash-especial-label">
            de ${especiaisAtivos.especialista} Especialista
          </div>
        </div>
        <div class="rs-acad-dash-especial-stat">
          <div class="rs-acad-dash-especial-num">${espMestre}</div>
          <div class="rs-acad-dash-especial-label">
            de ${especiaisAtivos.mestre} Mestre
          </div>
        </div>
      </div>
      <div id="rs-acad-dash-especiais-panel"></div>
    </section>
    
    ${niveisConquistados.length > 0 ? `
      <section class="rs-acad-dash-card">
        <h3 class="rs-acad-dash-card-titulo">🏅 Níveis Conquistados</h3>
        <div class="rs-acad-dash-niveis-lista">
          ${niveisConquistados.map(n => {
            const cfg = config.niveis?.[n.nivel] || {};
            return `
              <div class="rs-acad-dash-nivel-card">
                <span class="rs-acad-dash-nivel-icone">${cfg.icone || '🏆'}</span>
                <div class="rs-acad-dash-nivel-info">
                  <div class="rs-acad-dash-nivel-nome">${cfg.nome || n.nivel}</div>
                  <div class="rs-acad-dash-nivel-data">
                    Conquistado em ${_formatarData(n.data_conquista)}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    ` : ''}
    
    <section class="rs-acad-dash-card">
      <h3 class="rs-acad-dash-card-titulo">📊 Meu Desempenho Histórico</h3>
      <div id="rs-acad-dash-quiz-resumo"></div>
    </section>
  `;
  
  if (window.AcademiaEspeciaisPanel?.renderizar) {
    window.AcademiaEspeciaisPanel.renderizar('rs-acad-dash-especiais-panel', _uidAtual);
  }
  
  if (window.QuizResumoManager?.renderizar) {
    window.QuizResumoManager.renderizar('rs-acad-dash-quiz-resumo', _uidAtual);
  }
}

// ────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────
function _formatarData(value) {
  if (!value) return '—';
  try {
    const d = value?._seconds
      ? new Date(value._seconds * 1000)
      : (value?.toDate ? value.toDate() : new Date(value));
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return '—'; }
}

function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ────────────────────────────────────────────────────────────────────────
// CSS
// ────────────────────────────────────────────────────────────────────────
function _injetarCSS() {
  if (document.getElementById('rs-acad-dash-style')) return;
  const style = document.createElement('style');
  style.id = 'rs-acad-dash-style';
  style.textContent = `
    .rs-acad-dash-header {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--rs-bg, #0f172a);
      border-bottom: 1px solid #1e293b;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .rs-acad-dash-voltar {
      background: none;
      border: none;
      color: #94a3b8;
      font-size: 13px;
      font-weight: 700;
      padding: 8px 12px;
      cursor: pointer;
      font-family: inherit;
      border-radius: 6px;
      transition: background .15s;
    }
    .rs-acad-dash-voltar:hover {
      background: rgba(255,255,255,.06);
      color: #f1f5f9;
    }
    .rs-acad-dash-titulo-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
    }
    .rs-acad-dash-titulo-icone { font-size: 24px; }
    .rs-acad-dash-titulo {
      margin: 0;
      font-size: 16px;
      font-weight: 800;
      color: #f1f5f9;
      font-family: 'Syne', system-ui, sans-serif;
    }
    .rs-acad-dash-subtitulo {
      margin: 0;
      font-size: 11px;
      color: #94a3b8;
    }
    .rs-acad-dash-header-spacer { width: 80px; }
    .rs-acad-dash-main {
      flex: 1;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-width: 720px;
      margin: 0 auto;
      width: 100%;
    }
    .rs-acad-dash-card {
      background: var(--rs-card, #1e293b);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 12px;
      padding: 18px;
      border-left: 4px solid transparent;
    }
    .rs-acad-dash-card-titulo {
      margin: 0 0 12px;
      font-size: 14px;
      font-weight: 700;
      color: #f1f5f9;
    }
    .rs-acad-dash-card-nivel {
      background: linear-gradient(135deg, var(--rs-card, #1e293b), rgba(139,92,246,.08));
    }
    .rs-acad-dash-nivel-header {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .rs-acad-dash-nivel-icone-grande {
      width: 64px;
      height: 64px;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      flex-shrink: 0;
    }
    .rs-acad-dash-nivel-texto { flex: 1; }
    .rs-acad-dash-nivel-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: #94a3b8;
      margin-bottom: 2px;
    }
    .rs-acad-dash-nivel-nome-grande {
      font-size: 18px;
      font-weight: 800;
      color: #f1f5f9;
      font-family: 'Syne', system-ui, sans-serif;
    }
    .rs-acad-dash-nivel-ciclo {
      font-size: 11px;
      color: #94a3b8;
      margin-top: 2px;
    }
    .rs-acad-dash-progresso { margin-bottom: 4px; }
    .rs-acad-dash-progresso-info {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-bottom: 6px;
    }
    .rs-acad-dash-progresso-num {
      font-size: 28px;
      font-weight: 800;
      color: #f1f5f9;
      font-family: 'Syne', system-ui, sans-serif;
    }
    .rs-acad-dash-progresso-total {
      font-size: 12px;
      color: #94a3b8;
    }
    .rs-acad-dash-progresso-barra {
      height: 8px;
      background: rgba(255,255,255,.08);
      border-radius: 4px;
      overflow: hidden;
    }
    .rs-acad-dash-progresso-fill {
      height: 100%;
      background: linear-gradient(90deg, #8b5cf6, #a78bfa);
      border-radius: 4px;
      transition: width .4s ease;
    }
    .rs-acad-dash-progresso-pct {
      margin-top: 4px;
      font-size: 11px;
      color: #94a3b8;
      text-align: right;
    }
    .rs-acad-dash-card-especiais {
      border-left-color: #8b5cf6;
    }
    .rs-acad-dash-especiais-stats {
      display: flex;
      gap: 10px;
      margin-bottom: 14px;
    }
    .rs-acad-dash-especial-stat {
      flex: 1;
      padding: 10px;
      background: rgba(139,92,246,.08);
      border: 1px solid rgba(139,92,246,.2);
      border-radius: 8px;
      text-align: center;
    }
    .rs-acad-dash-especial-num {
      font-size: 22px;
      font-weight: 800;
      color: #a78bfa;
      font-family: 'Syne', system-ui, sans-serif;
    }
    .rs-acad-dash-especial-label {
      font-size: 10px;
      color: #94a3b8;
      margin-top: 2px;
      text-transform: uppercase;
      letter-spacing: .03em;
    }
    .rs-acad-dash-niveis-lista {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .rs-acad-dash-nivel-card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px;
      background: rgba(255,255,255,.03);
      border-radius: 8px;
    }
    .rs-acad-dash-nivel-card .rs-acad-dash-nivel-icone {
      font-size: 24px;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,.05);
      border-radius: 8px;
      flex-shrink: 0;
    }
    .rs-acad-dash-nivel-info { flex: 1; }
    .rs-acad-dash-nivel-card .rs-acad-dash-nivel-nome {
      font-size: 13px;
      font-weight: 600;
      color: #f1f5f9;
    }
    .rs-acad-dash-nivel-card .rs-acad-dash-nivel-data {
      font-size: 11px;
      color: #94a3b8;
      margin-top: 2px;
    }
    .rs-acad-dash-skeleton {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .rs-acad-dash-sk-card {
      height: 140px;
      background: rgba(255,255,255,.04);
      border-radius: 12px;
      animation: rsAcadDashPulse 1.4s ease-in-out infinite;
    }
    .rs-acad-dash-sk-row {
      height: 80px;
      background: rgba(255,255,255,.04);
      border-radius: 12px;
      animation: rsAcadDashPulse 1.4s ease-in-out infinite;
    }
    @keyframes rsAcadDashPulse {
      0%, 100% { opacity: .4 }
      50% { opacity: .9 }
    }
    .rs-acad-dash-erro {
      text-align: center;
      padding: 40px 20px;
      color: #94a3b8;
    }
    .rs-acad-dash-erro-icone { font-size: 40px; margin-bottom: 12px; }
    .rs-acad-dash-erro h3 {
      color: #f1f5f9;
      margin: 0 0 8px;
      font-size: 15px;
    }
    .rs-acad-dash-erro p {
      font-size: 13px;
      margin: 0 0 16px;
    }
    .rs-acad-dash-erro button {
      padding: 10px 20px;
      background: #8b5cf6;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    @media (max-width: 480px) {
      .rs-acad-dash-header { padding: 12px; }
      .rs-acad-dash-titulo { font-size: 14px; }
      .rs-acad-dash-subtitulo { display: none; }
      .rs-acad-dash-main { padding: 12px; gap: 12px; }
      .rs-acad-dash-card { padding: 14px; }
      .rs-acad-dash-nivel-icone-grande { width: 52px; height: 52px; font-size: 26px; }
      .rs-acad-dash-nivel-nome-grande { font-size: 16px; }
      .rs-acad-dash-especiais-stats { flex-direction: column; }
    }
  `;
  document.head.appendChild(style);
}

// ────────────────────────────────────────────────────────────────────────
// EXPORTAÇÃO
// ────────────────────────────────────────────────────────────────────────
window.AcademiaDashboard = {
  abrir,
  fechar,
};

})();