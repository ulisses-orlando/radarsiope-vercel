/* ==========================================================================
   onesignal-init.js — Radar SIOPE
   Responsabilidades:
   - Inicializar o OneSignal SDK
   - Gerenciar opt-in com LGPD (banner próprio antes do prompt do browser)
   - Aplicar tags de segmentação (plano, UF, município, perfil)
   - Salvar o Player ID no Firestore (assinante) ou Supabase via API (lead)
   - Registrar consentimento LGPD no Firestore (assinante) ou Supabase via API (lead)
   - Exibir banner de instalação PWA com instrução para iOS

   Dependências:
   - OneSignal SDK carregado via <script> no HTML
   - window.db (Firestore) inicializado
   - window._radarUser (definido após autenticação/token)

   CONFIGURAÇÃO:
   App ID configurado. REST API Key → Vercel Environment Variables.
   ========================================================================== */

'use strict';

// ─── Configuração ─────────────────────────────────────────────────────────────
const ONESIGNAL_APP_ID = '040469b1-fa2a-499f-9911-aa417b0cd4bd';

const LS_CONSENT_KEY   = 'rs_push_consent';   // 'granted' | 'denied' | null
const LS_INSTALL_DELAY = 'rs_install_delay';

// ─── Init principal ──────────────────────────────────────────────────────────
async function initRadarPWA() {
  await registrarServiceWorker();
  agendarBannerInstalacao();
  await initOneSignal();
}

// ─── Service Worker ───────────────────────────────────────────────────────────
async function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker?.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          mostrarBannerAtualizacao();
        }
      });
    });
  } catch (err) {
    console.warn('[PWA] Falha ao registrar SW:', err);
  }
}

// ─── OneSignal ────────────────────────────────────────────────────────────────
async function initOneSignal() {
  if (typeof OneSignalDeferred === 'undefined' && typeof OneSignal === 'undefined') {
    console.warn('[OneSignal] SDK não carregado.');
    return;
  }

  const consentimento = localStorage.getItem(LS_CONSENT_KEY);

  if (consentimento === 'denied') return;

  if (!consentimento) {
    mostrarBannerConsentimentoPush();
    return;
  }

  await _inicializarOneSignal();
}

async function _inicializarOneSignal() {
  const oneSignalFn = async () => {
    try {
      await OneSignal.init({
        appId:              ONESIGNAL_APP_ID,
        // OneSignal v16 usa OneSignalSDKWorker.js na raiz por padrão.
        // Não especificar serviceWorkerPath evita conflito de registro.
        serviceWorkerParam: { scope: '/' },
        promptOptions: { slidedown: { prompts: [] } },
        notifyButton:  { enable: false },
        allowLocalhostAsSecureOrigin: true,
      });

      const permission = await OneSignal.Notifications.requestPermission();
      if (permission) {
        await _aplicarTagsSegmentacao();
        await _salvarPlayerId();
      }
    } catch (err) {
      console.warn('[OneSignal] Erro na inicialização:', err);
    }
  };

  if (typeof OneSignalDeferred !== 'undefined') {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(oneSignalFn);
  } else {
    await oneSignalFn();
  }
}

// ─── Tags de segmentação ──────────────────────────────────────────────────────
async function _aplicarTagsSegmentacao() {
  const user = window._radarUser;
  if (!user) return;

  const tags = {
    segmento:           user.segmento       || 'lead',
    plano:              user.plano_slug     || 'none',
    perfil:             user.perfil         || '',
    uf:                 user.uf             || '',
    municipio_cod:      user.municipio_cod  || '',
    municipio_nome:     user.municipio_nome || '',
    alerta_municipio:   _temAlertaMunicipio(user) ? '1' : '0',
    alerta_nova_edicao: '1',
    app_version:        '1.0',
  };

  try {
    await OneSignal.User.addTags(tags);
  } catch (err) {
    console.warn('[OneSignal] Erro ao aplicar tags:', err);
  }
}

function _temAlertaMunicipio(user) {
  return ['profissional', 'premium', 'supreme'].includes(user?.plano_slug);
}

// ─── Salvar Player ID ─────────────────────────────────────────────────────────
async function _salvarPlayerId() {
  try {
    const playerId = await OneSignal.User.PushSubscription.id;
    if (!playerId) return;

    const user = window._radarUser;
    if (!user?.uid) return;

    if (user.segmento === 'assinante' && user.assinaturaId) {
      // Assinante → Firestore
      const db = window.db;
      if (!db) return;
      await db.collection('usuarios').doc(user.uid).update({
        onesignal_player_id: playerId,
        push_opt_in:         true,
        push_opt_in_em:      firebase.firestore.FieldValue.serverTimestamp(),
        push_plataforma:     _detectarPlataforma(),
      });
    } else {
      // Lead → Supabase via API
      await fetch('/api/leads/push-token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          leadId:     user.uid,
          playerId,
          plataforma: _detectarPlataforma(),
        }),
      });
    }
  } catch (err) {
    console.warn('[OneSignal] Erro ao salvar Player ID:', err);
  }
}

// ─── Registrar consentimento ──────────────────────────────────────────────────
async function _registrarConsentimento(aceito) {
  const user = window._radarUser;
  if (!user?.uid) return;

  if (user.segmento === 'assinante') {
    // Assinante → Firestore
    const db = window.db;
    if (!db) return;
    try {
      await db.collection('usuarios').doc(user.uid).update({
        push_consentimento:    aceito,
        push_consentimento_em: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) { /* não crítico */ }

  } else {
    // Lead → Supabase via API
    try {
      await fetch('/api/leads/push-consent', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          leadId:    user.uid,
          aceito,
          plataforma: _detectarPlataforma(),
          // timestamp gerado no servidor para consistência
        }),
      });
    } catch (e) { /* não crítico */ }
  }
}

function _detectarPlataforma() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua))          return 'android';
  if (/Windows/.test(ua))          return 'windows';
  if (/Mac/.test(ua))              return 'mac';
  return 'desktop';
}

// ─── Banner de consentimento LGPD ─────────────────────────────────────────────
function mostrarBannerConsentimentoPush() {
  if (document.getElementById('rs-push-banner')) return;

  const banner = document.createElement('div');
  banner.id    = 'rs-push-banner';
  banner.style.cssText = `
    position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
    width: min(440px, 94vw); background: #0A3D62; color: #fff;
    border-radius: 16px; padding: 18px 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.35);
    z-index: 9998; font-family: system-ui, sans-serif; font-size: 14px;
    animation: rsSlideUp .35s ease;
  `;

  banner.innerHTML = `
    <style>
      @keyframes rsSlideUp {
        from { opacity:0; transform: translateX(-50%) translateY(20px); }
        to   { opacity:1; transform: translateX(-50%) translateY(0); }
      }
      #rs-push-banner button { border:none; border-radius:8px; padding:9px 18px; font-size:13px; font-weight:600; cursor:pointer; }
    </style>
    <div style="display:flex; align-items:flex-start; gap:12px">
      <span style="font-size:26px; flex-shrink:0">🔔</span>
      <div style="flex:1">
        <strong style="font-size:15px; display:block; margin-bottom:4px">Ativar alertas do Radar SIOPE?</strong>
        <p style="margin:0 0 12px; color:#cbd5e1; line-height:1.45">
          Receba notificações de <strong>prazos SIOPE</strong>, <strong>repasses FUNDEB</strong>
          e novas edições — direto no seu celular.
          <span id="rs-push-plano-note" style="display:none; color:#86efac"></span>
        </p>
        <div style="display:flex; gap:8px; flex-wrap:wrap">
          <button id="rs-push-aceitar"    style="background:#16a34a; color:#fff; flex:1">✅ Ativar alertas</button>
          <button id="rs-push-agora-nao"  style="background:rgba(255,255,255,0.12); color:#fff; flex:1">Agora não</button>
          <button id="rs-push-nunca"      style="background:transparent; color:#94a3b8; font-size:11px; padding:4px 8px; flex:0 0 auto">Não mostrar mais</button>
        </div>
        <p style="margin:10px 0 0; font-size:11px; color:#64748b; line-height:1.4">
          🔒 Você pode cancelar a qualquer momento nas configurações do app.<br>
          Seus dados são protegidos conforme a LGPD.
        </p>
      </div>
    </div>
  `;

  document.body.appendChild(banner);

  // FIX 1: ID corrigido — era 'rs-push-note-plano', agora bate com o HTML 'rs-push-plano-note'
  const user = window._radarUser;
  const note = document.getElementById('rs-push-plano-note');
  if (user && note) {
    if (_temAlertaMunicipio(user)) {
      note.style.display = 'inline';
      note.textContent   = ` Seu plano inclui alertas específicos de ${user.municipio_nome || 'seu município'}.`;
    } else if (user.segmento === 'lead') {
      note.style.display = 'inline';
      note.textContent   = ' Assine um plano para receber alertas do seu município.';
    }
  }

  document.getElementById('rs-push-aceitar').onclick = async () => {
    localStorage.setItem(LS_CONSENT_KEY, 'granted');
    banner.remove();
    await _registrarConsentimento(true);  // FIX 3: registra para leads também
    await _inicializarOneSignal();
  };

  document.getElementById('rs-push-agora-nao').onclick = () => {
    banner.remove();
    // Não salva — reaparece na próxima sessão
  };

  document.getElementById('rs-push-nunca').onclick = async () => {
    localStorage.setItem(LS_CONSENT_KEY, 'denied');
    banner.remove();
    await _registrarConsentimento(false); // FIX 3: registra negativa para leads também
  };
}

// ─── Banner de instalação PWA ─────────────────────────────────────────────────
let _deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredInstallPrompt = e;
});

window.addEventListener('appinstalled', () => {
  localStorage.setItem('rs_pwa_installed', '1');
  _fecharBannerInstalacao();
});

function _ajustarThemeBar(alturaOffset) {
  const themeBar = document.querySelector('.rs-theme-bar');
  if (!themeBar) return;
  themeBar.style.bottom = alturaOffset > 0 ? (alturaOffset + 12) + 'px' : '';
}

function _fecharBannerInstalacao() {
  document.getElementById('rs-install-banner')?.remove();
  _ajustarThemeBar(0);
}

function agendarBannerInstalacao() {
  if (localStorage.getItem('rs_pwa_installed')) return;
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (sessionStorage.getItem('rs_install_shown_session')) return;

  const delay = localStorage.getItem(LS_INSTALL_DELAY) ? 15000 : 45000;
  localStorage.setItem(LS_INSTALL_DELAY, '1');
  setTimeout(() => mostrarBannerInstalacao(), delay);
}

function mostrarBannerInstalacao() {
  if (document.getElementById('rs-install-banner')) return;
  sessionStorage.setItem('rs_install_shown_session', '1');

  const isIOS     = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  if (!isIOS && !isAndroid && !_deferredInstallPrompt) return;

  const banner = document.createElement('div');
  banner.id    = 'rs-install-banner';
  banner.style.cssText = `
    position: fixed; bottom: 0; left: 0; right: 0;
    background: #fff; border-top: 3px solid #0A3D62;
    padding: 16px 20px; box-shadow: 0 -4px 20px rgba(0,0,0,0.15);
    z-index: 9997; font-family: system-ui, sans-serif;
    animation: rsSlideUp2 .3s ease;
  `;

  const conteudoAndroid = `
    <style>@keyframes rsSlideUp2 { from { transform:translateY(100%); } to { transform:translateY(0); } }</style>
    <div style="display:flex; align-items:center; gap:14px">
      <img src="/icons/icon-192x192.png" width="48" height="48" style="border-radius:12px; flex-shrink:0">
      <div style="flex:1">
        <strong style="color:#0A3D62; font-size:15px">Instalar Radar SIOPE</strong>
        <p style="margin:4px 0 0; font-size:13px; color:#555">Adicione à tela inicial para acesso rápido e alertas.</p>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px; flex-shrink:0">
        <button id="rs-install-btn"
          style="background:#0A3D62; color:#fff; border:none; border-radius:8px; padding:10px 16px; font-weight:600; cursor:pointer; white-space:nowrap; font-size:13px">
          Instalar
        </button>
        <button id="rs-install-fechar"
          style="background:none; border:1px solid #e2e8f0; border-radius:8px; padding:6px 12px; font-size:12px; color:#94a3b8; cursor:pointer; white-space:nowrap">
          Agora não
        </button>
      </div>
    </div>`;

  const conteudoIOS = `
    <style>@keyframes rsSlideUp2 { from { transform:translateY(100%); } to { transform:translateY(0); } }</style>
    <div style="display:flex; align-items:flex-start; gap:14px">
      <img src="/icons/icon-192x192.png" width="48" height="48" style="border-radius:12px; flex-shrink:0; margin-top:4px">
      <div style="flex:1">
        <div style="display:flex; justify-content:space-between; align-items:center">
          <strong style="color:#0A3D62; font-size:15px">Instalar Radar SIOPE no iPhone</strong>
          <button id="rs-install-fechar" style="background:none; border:none; font-size:20px; color:#999; cursor:pointer; padding:0">✕</button>
        </div>
        <p style="margin:8px 0 0; font-size:13px; color:#555; line-height:1.5">
          No Safari, toque em
          <strong style="color:#0A3D62">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
            Compartilhar
          </strong>
          → depois
          <strong style="color:#0A3D62">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Adicionar à Tela de Início
          </strong>
        </p>
        <div style="margin-top:10px; padding:8px 12px; background:#f0f7ff; border-radius:8px; font-size:12px; color:#1d4ed8">
          ⚠️ Abra este site no <strong>Safari</strong> para poder instalar.
          ${!/^((?!chrome|android).)*safari/i.test(navigator.userAgent)
            ? '<br>Você está usando outro navegador — copie a URL e abra no Safari.' : ''}
        </div>
      </div>
    </div>`;

  banner.innerHTML = isIOS ? conteudoIOS : conteudoAndroid;
  document.body.appendChild(banner);
  requestAnimationFrame(() => _ajustarThemeBar(banner.offsetHeight));

  if (!isIOS && _deferredInstallPrompt) {
    document.getElementById('rs-install-btn')?.addEventListener('click', async () => {
      _deferredInstallPrompt.prompt();
      await _deferredInstallPrompt.userChoice;
      _deferredInstallPrompt = null;
      _fecharBannerInstalacao();
    });
  }

  document.getElementById('rs-install-fechar')?.addEventListener('click', _fecharBannerInstalacao);
  if (isIOS) setTimeout(_fecharBannerInstalacao, 20000);
}

// ─── Banner de atualização disponível ────────────────────────────────────────
function mostrarBannerAtualizacao() {
  const banner = document.createElement('div');
  banner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; background: #0A3D62; color: #fff;
    padding: 12px 20px; display: flex; justify-content: space-between; align-items: center;
    z-index: 9999; font-family: system-ui, sans-serif; font-size: 14px;
  `;
  banner.innerHTML = `
    <span>🔄 Nova versão do Radar SIOPE disponível!</span>
    <button onclick="window.location.reload()"
      style="background:#16a34a; color:#fff; border:none; border-radius:6px; padding:6px 14px; cursor:pointer; font-weight:600">
      Atualizar
    </button>`;
  document.body.prepend(banner);
}

// ─── API pública ──────────────────────────────────────────────────────────────
window.RadarPush = {
  async atualizarTagsPlano(novoSlug) {
    if (typeof OneSignal === 'undefined') return;
    try {
      const user = window._radarUser || {};
      user.plano_slug = novoSlug;
      await OneSignal.User.addTags({
        plano:            novoSlug,
        alerta_municipio: _temAlertaMunicipio(user) ? '1' : '0',
      });
    } catch (e) { console.warn('[RadarPush] Erro ao atualizar tags:', e); }
  },

  solicitarConsentimento() {
    localStorage.removeItem(LS_CONSENT_KEY);
    mostrarBannerConsentimentoPush();
  },

  async estaInscrito() {
    if (typeof OneSignal === 'undefined') return false;
    try { return await OneSignal.User.PushSubscription.optedIn; }
    catch { return false; }
  },
};

// ─── Auto-init ────────────────────────────────────────────────────────────────
// FIX 2: aguarda _radarUser estar disponível em vez de setTimeout fixo.
// verNewsletterComToken.js deve disparar o evento 'radarUserReady' após definir window._radarUser.
// Fallback: se o evento não chegar em 5s, tenta mesmo assim (compatibilidade).
function _aguardarRadarUser(cb) {
  if (window._radarUser) { cb(); return; }

  let disparou = false;

  window.addEventListener('radarUserReady', () => {
    if (disparou) return;
    disparou = true;
    cb();
  }, { once: true });

  // Fallback: 5 segundos
  setTimeout(() => {
    if (disparou) return;
    disparou = true;
    cb();
  }, 5000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => _aguardarRadarUser(initRadarPWA));
} else {
  _aguardarRadarUser(initRadarPWA);
}
