/* ==========================================================================
   sw.js — Service Worker · Radar SIOPE PWA
   Responsabilidades:
   1. Cache de assets estáticos (offline básico)
   2. Receber e exibir push notifications via OneSignal
   3. Tratar clique na notificação (abrir URL correta)
   ========================================================================== */

'use strict';

// ─── Importa SDK do OneSignal para Service Worker ────────────────────────────
// O OneSignal injeta seu próprio SW via importScripts quando detecta o arquivo.
// Mantemos o nome "sw.js" na raiz e configuramos o OneSignal para usar este arquivo.
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

// ─── Configuração do Cache ────────────────────────────────────────────────────
const CACHE_NAME   = 'radar-siope-v1';
const CACHE_STATIC = [
  '/',
  '/verNewsletterComToken.html',
  '/painel.html',
  '/login.html',
  '/css/style.css',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/manifest.json',
  // fontes e assets críticos
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
];

// ─── Install: pré-carrega cache estático ─────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Instalando v1...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_STATIC.filter(url => !url.startsWith('http') || url.includes('googleapis'))))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: limpa caches antigos ──────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Ativando...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => { console.log('[SW] Removendo cache antigo:', k); return caches.delete(k); })
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch: Network First com fallback para cache ────────────────────────────
self.addEventListener('fetch', event => {
  // Ignora requests não-GET e requests de APIs (Firestore, Supabase, OneSignal)
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
        // Clona e armazena em cache se for resposta válida
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ─── Push: recebe notificação do OneSignal ────────────────────────────────────
// O OneSignal SDK cuida da maioria dos casos via importScripts acima.
// Este handler é um fallback para notificações customizadas enviadas diretamente.
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Radar SIOPE', body: event.data.text(), url: '/' };
  }

  const title   = payload.title   || 'Radar SIOPE';
  const options = {
    body:    payload.body    || 'Você tem uma nova notificação.',
    icon:    payload.icon    || '/icons/icon-192x192.png',
    badge:   '/icons/icon-192x192.png',
    image:   payload.image   || null,
    data:    { url: payload.url || payload.launch_url || '/' },
    tag:     payload.tag     || 'radar-siope',
    renotify: true,
    requireInteraction: payload.requireInteraction || false,
    actions: payload.actions || [],
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── NotificationClick: abre URL da notificação ──────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Se já tem uma janela aberta do app, foca ela
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        // Senão abre nova janela
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});

// ─── Message: comunicação com o app principal ─────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_NAME });
  }
});
