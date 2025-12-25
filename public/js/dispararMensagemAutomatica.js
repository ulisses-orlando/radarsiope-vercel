import fetch from "node-fetch"; // ou axios, se preferir
import { db } from "./firebase"; // ajuste conforme seu setup

async function dispararMensagemAutomatica(momento, usuario) {
  try {
    // 1. Buscar template ativo e automático
    const snapshot = await db.collection("respostas_automaticas")
      .where("momento_envio", "==", momento)
      .where("ativo", "==", true)
      .where("enviar_automaticamente", "==", true)
      .get();

    if (snapshot.empty) {
      console.log(`Nenhum template encontrado para ${momento}`);
      return;
    }

    // 2. Para cada template encontrado
    for (const doc of snapshot.docs) {
      const msg = doc.data();

      // 3. Substituir placeholders
      const mensagemHtml = aplicarPlaceholders(msg.mensagem_html, usuario);

      // 4. Chamar API enviarEmail.js
      await fetch("https://radarsiope.com/api/enviarEmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: usuario.nome,
          email: usuario.email,
          assunto: msg.titulo,
          mensagemHtml
        })
      });

      console.log(`Mensagem enviada: ${msg.titulo} → ${usuario.email}`);
    }
  } catch (error) {
    console.error("❌ Erro no disparo automático:", error);
  }
}

