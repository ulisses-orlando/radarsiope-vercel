// OneSignalSDKWorker.js
// Arquivo exigido pelo SDK do OneSignal v16 na raiz do domínio.
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
importScripts('/sw.js');

// Sobrescreve o notificationclick do SDK para usar a URL correta do payload
self.addEventListener('notificationclick', event => {
  event.notification.close();

  // Tenta extrair URL do campo data (enviado no payload via campo "data")
  const data = event.notification.data || {};
  const url  = data.url
    || data.web_url
    || data.launchURL
    || event.notification.actions?.[0]?.action
    || 'https://app.radarsiope.com.br/verNewsletterComToken.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
}, true); // true = capture phase, executa antes do handler do SDK
