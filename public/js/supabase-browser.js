/* ==========================================================================
   supabase-browser.js — Radar SIOPE
   Inicializa o cliente Supabase diretamente no browser, sem bundler.
   Deve ser carregado APÓS o SDK da CDN:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
     <script src="/js/supabase-browser.js"></script>

   Expõe: window.supabase (mesma interface que supabaseClient.js exporta)
   Usa a anon key — dados SIOPE são públicos, sem risco de exposição.
   ========================================================================== */

(function () {
  'use strict';

  const SUPABASE_URL     = 'https://ekrtekidjuwxfspjmmvl.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrcnRla2lkanV3eGZzcGptbXZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0OTQzNTAsImV4cCI6MjA4NjA3MDM1MH0.tm2y114xrBHeRU62beNln8TQmskm2yxap7MiRIAHhoc';

  if (window.supabase) {
    // Já inicializado (ex: por exposeSupabase.js em outra página) — não redefine
    console.log('[supabase-browser] window.supabase já disponível, reutilizando.');
    return;
  }

  if (!window.supabase?.createClient && typeof supabase === 'undefined') {
    console.error('[supabase-browser] SDK não carregado. Verifique o script da CDN.');
    return;
  }

  // O SDK UMD expõe `supabase` (sem window.) no escopo global
  const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,   // web app não faz login — não precisa de sessão
      autoRefreshToken: false,
    },
  });

  window.supabase = client;
  console.log('[supabase-browser] Cliente Supabase inicializado (anon, público).');
})();
