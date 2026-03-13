// OneSignalSDKWorker.js
// CRÍTICO: registrar ANTES do importScripts do OneSignal SDK.
// stopImmediatePropagation() impede que o SDK abra sua própria URL depois.

self.addEventListener('notificationclick', event => {
  event.stopImmediatePropagation();
  event.notification.close();

  const data = event.notification.data || {};
  // app.html lê rs_pwa_session e busca o envio mais recente automaticamente
  const url  = data.url
    || data.web_url
    || data.launchURL
    || 'https://app.radarsiope.com.br/app.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.startsWith('https://app.radarsiope.com.br') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
importScripts('/sw.js');
