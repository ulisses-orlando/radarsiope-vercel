// OneSignalSDKWorker.js
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const data = event.notification.data || {};
  const url  = data.url
    || data.web_url
    || data.launchURL
    || 'https://app.radarsiope.com.br/verNewsletterComToken.html';

  console.log('[SW notificationclick] url:', url);
  console.log('[SW notificationclick] data:', JSON.stringify(data));

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      console.log('[SW notificationclick] clientes abertos:', clientList.length);
      clientList.forEach(c => console.log('[SW] client url:', c.url));

      for (const client of clientList) {
        if (client.url.startsWith('https://app.radarsiope.com.br') && 'focus' in client) {
          console.log('[SW] navegando cliente existente para:', url);
          client.navigate(url);
          return client.focus();
        }
      }
      console.log('[SW] abrindo nova janela:', url);
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
importScripts('/sw.js');
