// OneSignalSDKWorker.js
// Arquivo exigido pelo SDK do OneSignal v16 na raiz do domínio.
// Importa o SDK do OneSignal para o Service Worker e em seguida
// delega para o sw.js principal do projeto (cache offline, etc).
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
importScripts('/sw.js');
