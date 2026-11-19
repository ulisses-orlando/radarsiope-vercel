/**
vitrine-admin.js — Inicializa a vitrine global no painel admin
Carregar APÓS vitrine.js e supabase-browser.js
*/
'use strict';

// ─── Inicialização ao carregar a seção ──────────────────────────────────────
async function inicializarVitrineAdmin() {
  const container = document.getElementById('vitrine-admin-container');
  if (!container) return;
  
  try {
    // Chama a API pública do vitrine.js (que já está no escopo global)
    if (typeof window.inicializarVitrine !== 'function') {
      throw new Error('vitrine.js não foi carregado.');
    }
    
    // null = vitrine global (não vinculada a newsletter)
    await window.inicializarVitrine(null, container);
    
    console.log('[vitrine-admin] ✅ Vitrine global inicializada.');
  } catch (err) {
    console.error('[vitrine-admin] Erro ao inicializar:', err);
    container.innerHTML = `
      <div style="text-align:center; padding:40px; color:#dc2626;">
        <div style="font-size:32px; margin-bottom:12px;">❌</div>
        <div style="font-size:14px; font-weight:600;">Erro ao carregar vitrine</div>
        <div style="font-size:12px; color:#94a3b8; margin-top:8px;">${err.message}</div>
      </div>
    `;
  }
}

// ─── Salvar vitrine global ──────────────────────────────────────────────────
async function salvarVitrineGlobal() {
  const statusEl = document.getElementById('vitrine-status-msg');
  const btnSalvar = document.getElementById('btn-salvar-vitrine');
  
  if (!statusEl) return;
  
  // Valida se há itens
  // (usa getter exposto pelo vitrine.js via Object.defineProperty)
  const itens = (typeof window._getVitrineItems === 'function')
    ? window._getVitrineItems()
    : (window._vitrineItems || []);
  if (!itens || itens.length === 0) {
    statusEl.style.display = 'block';
    statusEl.style.background = '#fef3c7';
    statusEl.style.color = '#92400e';
    statusEl.textContent = '⚠️ Adicione pelo menos um indicador antes de salvar.';
    return;
  }
  
  // Desabilita botão durante salvamento
  if (btnSalvar) {
    btnSalvar.disabled = true;
    btnSalvar.textContent = '⏳ Salvando...';
  }
  
  try {
    await window.salvarVitrine(); // função global do vitrine.js
    
    // Feedback de sucesso
    statusEl.style.display = 'block';
    statusEl.style.background = '#dcfce7';
    statusEl.style.color = '#166534';
    statusEl.textContent = '✅ Vitrine salva com sucesso! As alterações serão refletidas para todos os assinantes.';
    
    // Auto-hide após 4s
    setTimeout(() => {
      if (statusEl) statusEl.style.display = 'none';
    }, 4000);
    
    console.log('[vitrine-admin] ✅ Vitrine global salva.');
  } catch (err) {
    console.error('[vitrine-admin] Erro ao salvar:', err);
    statusEl.style.display = 'block';
    statusEl.style.background = '#fee2e2';
    statusEl.style.color = '#991b1b';
    statusEl.textContent = `❌ Erro ao salvar: ${err.message}`;
  } finally {
    if (btnSalvar) {
      btnSalvar.disabled = false;
      btnSalvar.textContent = '💾 Salvar Vitrine';
    }
  }
}

// ─── Expõe globalmente ──────────────────────────────────────────────────────
window.inicializarVitrineAdmin = inicializarVitrineAdmin;
window.salvarVitrineGlobal = salvarVitrineGlobal;