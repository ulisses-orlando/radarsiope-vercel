// 🔥 Inicializa Firebase
const firebaseConfig = {
  apiKey: "AIzaSyDcS4nneXnN8Cdb-S_cQukwaguLXJYbQ1U",
  authDomain: "radarsiope.firebaseapp.com",
  projectId: "radarsiope"
};

firebase.initializeApp(firebaseConfig);

// 🔧 Exporta instâncias globais
window.db = firebase.firestore(); // 👈 define db no escopo global
window.auth = firebase.auth();    // 👈 se precisar usar auth também
