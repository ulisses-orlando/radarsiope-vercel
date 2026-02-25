/* ==========================================================================
   supabase-browser.js — Radar SIOPE (VERSÃO CORRIGIDA)
   Inicializa o cliente Supabase diretamente no browser, sem bundler.
   Deve ser carregado APÓS o SDK da CDN:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
     <script src="/js/supabase-browser.js"></script>

   Expõe: window.supabase (mesma interface que supabaseClient.js exporta)
   Usa a anon key — dados SIOPE são públicos, sem risco de exposição.
   
   ✅ CORREÇÃO: Retry automático com espera pela CDN + timeout de segurança
   ========================================================================== */

(function () {
  'use strict';

  const SUPABASE_URL     = 'https://ekrtekidjuwxfspjmmvl.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrcnRla2lkanV3eGZzcGptbXZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0OTQzNTAsImV4cCI6MjA4NjA3MDM1MH0.tm2y114xrBHeRU62beNln8TQmskm2yxap7MiRIAHhoc';

  let attempts = 0;
  const MAX_ATTEMPTS = 100; // ~5-10 segundos com 100ms delay
  let initialized = false;

  function tryInitSupabase() {
    // ✅ Se já foi inicializado, não tenta novamente
    if (initialized) {
      return;
    }

    // ✅ Se window.supabase?.from já existe, significa que foi criado com sucesso
    if (window.supabase && typeof window.supabase.from === 'function') {
      console.log('[supabase-browser] ✅ window.supabase já disponível (reutilizando).');
      initialized = true;
      return;
    }

    // ✅ Verifica se o SDK da CDN foi carregado
    // O UMD expõe `supabase` (sem window.) no escopo global
    if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
      if (attempts < MAX_ATTEMPTS) {
        attempts++;
        // Tenta novamente em 100ms
        setTimeout(tryInitSupabase, 100);
        return;
      } else {
        console.error('[supabase-browser] ❌ SDK não carregou após tentativas. Verifique a CDN.');
        return;
      }
    }

    // ✅ SDK da CDN está pronto, agora cria o cliente
    try {
      const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: false,   // web app não faz login — não precisa de sessão
          autoRefreshToken: false,
        },
      });

      // ✅ Expõe como window.supabase
      window.supabase = client;
      initialized = true;

      console.log('[supabase-browser] ✅ Cliente Supabase inicializado (anon, público).');
      console.log('[supabase-browser] ✅ window.supabase.from está pronto para usar.');
    } catch (err) {
      console.error('[supabase-browser] ❌ Erro ao criar cliente:', err.message);
    }
  }

  // ✅ Tenta inicializar imediatamente e depois com retry
  tryInitSupabase();
})();
