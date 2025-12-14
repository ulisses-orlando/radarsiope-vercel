async function gerarHashSenha(senha) {
  const encoder = new TextEncoder();
  const data = encoder.encode(senha);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

async function resetarSenha() {
  const novaSenha = document.getElementById("nova-senha").value.trim();
  const msg = document.getElementById("mensagem-resetar");
  msg.innerText = "";
  msg.style.color = "red";

  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("token");

  if (!token || !novaSenha) {
    msg.innerText = "Token inválido ou senha não preenchida.";
    return;
  }

  try {
    const snapshot = await db.collection("recuperacoes")
      .where("token", "==", token)
      .limit(1)
      .get();

    if (snapshot.empty) {
      msg.innerText = "Token inválido ou expirado.";
      return;
    }

    const recuperacao = snapshot.docs[0].data();
    const email = recuperacao.email;

    const senhaCriptografada = await gerarHashSenha(novaSenha);

    const usuarioSnapshot = await db.collection("usuarios")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (usuarioSnapshot.empty) {
      msg.innerText = "Usuário não encontrado.";
      return;
    }

    const usuarioId = usuarioSnapshot.docs[0].id;
    await db.collection("usuarios").doc(usuarioId).update({ senha: senhaCriptografada });

    // Opcional: apagar o token após uso
    await db.collection("recuperacoes").doc(snapshot.docs[0].id).delete();

    msg.style.color = "green";
    msg.innerText = "Senha redefinida com sucesso! Redirecionando para login...";

    setTimeout(() => {
      window.location.href = "login.html";
    }, 2000);
  } catch (error) {
    console.error("Erro ao redefinir senha:", error);
    msg.innerText = "Erro ao redefinir senha. Tente novamente.";
  }
}
