// Verifica se o usuário está logado e redireciona conforme a página
firebase.auth().onAuthStateChanged(user => {
  const path = window.location.pathname;

  if (path.includes("area-do-assinante") || path.includes("admin")) {
    if (!user) {
      window.location.href = "/login";
    }
  }

  if (path.includes("login") && user) {
    window.location.href = "/area-do-assinante";
  }
});

// Função de logout
function logout() {
  firebase.auth().signOut().then(() => {
    window.location.href = "/login";
  });
}
