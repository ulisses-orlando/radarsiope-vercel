// Inicializa o Firebase
// Configuração do Firebase
const db = window.db;

async function VerNewsletterComToken() {
  const params = new URLSearchParams(window.location.search);
  const nid = params.get("nid");
  const env = params.get("env");
  const uid = params.get("uid");
  const token = params.get("token");
  const assinaturaId = params.get("assinaturaId");
  const container = document.getElementById("conteudo-newsletter");
  container.innerHTML = "<p>Validando acesso...</p>";

  try {
    // 1. Buscar envio
    let envioRef;
    let envioSnap;
    if (assinaturaId) {
      envioRef = db.collection("usuarios")
        .doc(uid)
        .collection("assinaturas")
        .doc(assinaturaId)
        .collection("envios")
        .doc(env);
      envioSnap = await envioRef.get();
    } else {
      envioRef = db.collection("leads")
        .doc(uid)
        .collection("envios")
        .doc(env);
      envioSnap = await envioRef.get();
    }

    if (!envioSnap.exists) {
      container.innerHTML = "<p>Envio não encontrado para este destinatário.</p>";
      return;
    }

    const envio = envioSnap.data();

    // 2. Validar token e expiração (validação simples baseada no token salvo no envio)
    if (envio.token_acesso !== token) {
      console.warn("⚠️ Token inválido:", envio.token_acesso, token);
      container.innerHTML = "<p>Acesso inválido: token incorreto.</p>";
      return;
    }

    if (envio.expira_em) {
      const expiraDate = typeof envio.expira_em.toDate === "function"
        ? envio.expira_em.toDate()
        : new Date(envio.expira_em);

      const agora = new Date();

      if (agora > expiraDate) {
        console.warn("⚠️ Link expirado:", expiraDate);
        container.innerHTML = "<p>Este link expirou. Solicite novo acesso.</p>";
        return;
      }
    }

    // 3. Atualizar metadados do envio (ultimo_acesso, acessos_totais)
    await envioRef.update({
      ultimo_acesso: new Date(),
      acessos_totais: firebase.firestore.FieldValue.increment(1)
    });

    // Recarregar envio atualizado para verificar acessos
    const envioAtualizadoSnap = await envioRef.get();
    const dadosEnvio = envioAtualizadoSnap.data();

    // 4. Buscar newsletter
    const newsletterSnap = await db.collection("newsletters").doc(nid).get();
    if (!newsletterSnap.exists) {
      container.innerHTML = "<p>Newsletter não encontrada.</p>";
      return;
    }
    const newsletter = newsletterSnap.data();

    // 5. Buscar destinatário (usuário ou lead)
    let destinatarioSnap;
    if (assinaturaId) {
      destinatarioSnap = await db.collection("usuarios").doc(uid).get();
    } else {
      destinatarioSnap = await db.collection("leads").doc(uid).get();
    }
    if (!destinatarioSnap.exists) {
      container.innerHTML = "<p>Destinatário não encontrado.</p>";
      return;
    }
    const destinatario = destinatarioSnap.data();

    // 6. Registrar "view" / clique de acesso chamando a API de click
    // Observação: a API /api/click atualmente faz redirect quando usada para links.
    // Aqui chamamos a API apenas para registrar o evento; o fetch é feito em background
    // e não altera a navegação do usuário. Se no futuro houver /api/validateToken ou
    // endpoint específico para registro sem redirect, substitua a URL abaixo.
    (async function registrarAcesso() {
      try {
        const clickUrl = `https://api.radarsiope.com.br/api/click?envioId=${encodeURIComponent(env)}&destinatarioId=${encodeURIComponent(uid)}&newsletterId=${encodeURIComponent(nid)}&url=${encodeURIComponent(window.location.href)}`;
        // Fire-and-forget: não bloquear renderização por conta do registro
        // usamos fetch sem aguardar o corpo; erros são logados no console
        fetch(clickUrl, { method: "GET", keepalive: true })
          .then(resp => {
            // Não precisamos processar o redirect; apenas logamos sucesso/erro
            if (!resp.ok && resp.status !== 302 && resp.status !== 301) {
              console.warn("Registro de clique retornou status:", resp.status);
            } else {
              console.log("Registro de clique enviado (status):", resp.status);
            }
          })
          .catch(err => {
            console.warn("Erro ao chamar API de click (registro de acesso):", err);
          });
      } catch (err) {
        console.warn("Erro no registro de acesso (fetch):", err);
      }
    })();

    // 7. Verificar limiar de acessos (detecção de compartilhamento)
    const LIMIAR_ACESSOS = 5;
    if (dadosEnvio.acessos_totais > LIMIAR_ACESSOS) {
      await envioRef.update({
        sinalizacao_compartilhamento: true
      });
      container.innerHTML = `
        <div style="padding:20px; background:#fff3cd; color:#856404; border:1px solid #ffeeba; border-radius:4px; margin:20px 0;">
          <strong>Atenção:</strong> Detectamos múltiplos acessos a esta edição da newsletter.<br><br>
          Este conteúdo é exclusivo para você, ${destinatario.nome}. 
          Caso tenha compartilhado o link, pedimos que não o faça para manter sua assinatura ativa.<br><br>
          Se acredita que recebeu esta mensagem por engano, entre em contato com nosso suporte para regularizar seu acesso.<br><br>
          <em>Dica:</em> todas as edições da newsletter estão disponíveis de forma segura no 
          <strong><a href="https://radarsiope-vercel.vercel.app/login.html" target="_blank" style="color:#004080;text-decoration:none;">
          Painel do Assinante
          </a></strong>. 
          Acesse o painel para consultar o histórico completo sem precisar usar este link.
        </div>
      `;
      console.warn("⚠️ Sinalização de compartilhamento ativada para este envio.");
      return; // encerra aqui para não renderizar a newsletter
    }

    // 8. Montar objeto de dados para placeholders
    const dados = {
      nome: destinatario.nome,
      email: destinatario.email,
      edicao: newsletter.edicao,
      titulo: newsletter.titulo
    };

    // 9. Aplicar placeholders e renderizar conteúdo com watermark
    if (newsletter.conteudo_html_completo) {
      try {
        const htmlFinal = aplicarPlaceholders(newsletter.conteudo_html_completo, dados);

        // Gerar watermark dinâmica
        const watermark = `
          <div style="font-size:12px;color:#888;text-align:center;margin:10px 0;">
            Edição exclusiva para: ${dados.nome} · ${dados.email} · ${new Date().toLocaleString("pt-BR")}
          </div>
        `;

        // CSS específico da newsletter (bloqueio de seleção em áreas críticas)
        const bloqueioCss = `
          <style>
            .content, .footer {
              user-select: none;
            }
          </style>
        `;

        // Injetar watermark + CSS + conteúdo
        const htmlComWatermark = `
          ${bloqueioCss}
          ${watermark}
          ${htmlFinal}
          ${watermark}
        `;

        container.innerHTML = htmlComWatermark;
        console.log("📌 HTML final montado e renderizado.");
      } catch (err) {
        console.error("❌ Erro ao aplicar placeholders:", err);
        container.innerHTML = "<p>Erro ao montar newsletter.</p>";
      }
    } else {
      console.warn("⚠️ Campo conteudo_html_completo não encontrado.");
      container.innerHTML = "<p>Newsletter sem conteúdo completo.</p>";
    }
  } catch (err) {
    console.error("❌ Erro ao validar acesso:", err);
    container.innerHTML = "<p>Erro ao validar acesso.</p>";
  }
}

// ⚠️ Sem isso a função nunca roda
VerNewsletterComToken();
