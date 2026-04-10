/* ==========================================================================
sw.js — Service Worker · Radar SIOPE PWA
Versão: radar-siope-v2
========================================================================== */
'use strict';

// 🔑 v2 força descarte do cache antigo e evita conflitos de caminhos
const CACHE_NAME = 'radar-siope-v2';

// Caminhos RELATIVOS À RAIZ DO SERVIDOR (dist/ após build)
const CACHE_STATIC = [
  '/',
  '/index.html',
  '/verNewsletterComToken.html',          // Está em public/ → serve como /
  '/js/verNewsletterComToken.js',         // Está em public/js/ → serve como /js/
  '/painel.html',
  '/login.html',
  '/css/style.css',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
];

// ─── Install ─────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Instalando v2...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      const urls = CACHE_STATIC.filter(url => !url.startsWith('http') || url.includes('googleapis'));
      return Promise.allSettled(urls.map(url => cache.add(url)));
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate ────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Removendo:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('onesignal.com') ||
    url.hostname.includes('mercadopago') ||
    url.pathname.startsWith('/api/')
  ) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Mantive sua lógica original: só cacheia respostas locais (basic)
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ─── Push ────────────────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } 
  catch { payload = { title: 'Radar SIOPE', body: event.data.text(), url: '/' }; }

  const options = {
    body: payload.body || 'Nova atualização.',
    icon: payload.icon || '/icons/icon-192x199.png',
    badge: '/icons/icon-192x192.png',
    image: payload.image || null,
    data: { url: payload.url || payload.launch_url || '/' },
    tag: payload.tag || 'radar-siope',
    renotify: true,
    requireInteraction: payload.requireInteraction || false,
    actions: payload.actions || [],
    vibrate: [200, 100, 200],
  };
  event.waitUntil(self.registration.showNotification(payload.title || 'Radar SIOPE', options));
});

// ─── NotificationClick ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return clients.openWindow ? clients.openWindow(url) : Promise.resolve();
      })
  );
});

// ─── Message ─────────────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_NAME });
  }
});