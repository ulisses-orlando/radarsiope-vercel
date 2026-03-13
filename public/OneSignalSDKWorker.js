// OneSignalSDKWorker.js
// IMPORTANTE: o listener de notificationclick deve ser registrado ANTES
// de importar o SDK do OneSignal, para que nosso handler tenha prioridade.

self.addEventListener('notificationclick', event => {
  event.notification.close();

  // URL vem do campo "data" do payload (enviado por api/push.js)
  const data = event.notification.data || {};
  const url  = data.url
    || data.web_url
    || data.launchURL
    || 'https://app.radarsiope.com.br/verNewsletterComToken.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Se já tem aba do app aberta, navega nela
      for (const client of clientList) {
        if (client.url.startsWith('https://app.radarsiope.com.br') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Senão abre nova aba
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// SDK do OneSignal (registrado DEPOIS do nosso handler)
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
importScripts('/sw.js');
