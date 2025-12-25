// public/js/firebaseInit.js
// Evita inicialização duplicada
if (!firebase.apps || !firebase.apps.length) {
  firebase.initializeApp(window.firebaseConfig);
}
window.db = firebase.firestore();
