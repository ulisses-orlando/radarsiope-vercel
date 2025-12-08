// 🔹 Carrega newsletters e separa por classificação
async function carregarNewslettersPublicas() {
  const snap = await db.collection("newsletters").orderBy("data_publicacao", "desc").get();

  const listaBasicas = document.getElementById("lista-basicas");
  const listaPremium = document.getElementById("lista-premium");

  snap.forEach(doc => {
    const d = doc.data();
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${d.titulo}</h3>
      <p><strong>Tipo:</strong> ${d.tipo}</p>
      <button onclick="abrirNewsletter('${doc.id}', '${d.classificacao}')">Visualizar</button>
    `;

    if (d.classificacao === "Básica") listaBasicas.appendChild(card);
    else listaPremium.appendChild(card);
  });
}

// 🔹 Controle de acesso ao visualizar
async function abrirNewsletter(id, classificacao) {
  if (classificacao === "Básica") {
    window.location.href = `visualizar.html?id=${id}`;
    return;
  }

  const user = firebase.auth().currentUser;

  if (!user) {
    const modal = document.getElementById("modal-interesse");
    const modalBody = document.getElementById("modal-body");

    if (!modal || !modalBody) {
      alert("Erro ao exibir o formulário. Elementos do modal não encontrados.");
      return;
    }

    modal.style.display = "flex";

    const tiposSnap = await db.collection("tipo_newsletters").get();
    const tipos = tiposSnap.docs.map(doc => doc.data().nome).filter(Boolean);

    // Renderiza o formulário no modal
    modalBody.innerHTML = `
  <h2>🔒 Esta newsletter é exclusiva para assinantes</h2>
  <p>Preencha o formulário abaixo para receber informações sobre planos, capacitação ou consultoria.</p>
  <form id="form-interesse" style="margin-top:20px">
    <label for="nome">Nome:</label>
    <input type="text" id="nome" required style="width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc">

    <label for="email">E-mail:</label>
    <input type="email" id="email" required style="width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc">
    <input type="email" name="confirmar_email" placeholder="Confirme seu e-mail" required style="width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc">

    <label for="telefone">Telefone:</label>
    <input type="tel" id="telefone" required style="width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc">

    <label for="preferencia-contato">Como prefere ser contatado?</label>
    <select id="preferencia-contato" required style="width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc">
      <option value="">Selecione...</option>
      <option value="E-mail">📧 E-mail</option>
      <option value="WhatsApp">🟢 WhatsApp</option>
      <option value="Ligação">📞 Ligação</option>
    </select>

    <input type="hidden" name="origem" value="newsletter_publica">

    <label for="perfil">Qual o seu Perfil?</label>
    <select id="perfil" name="perfil" required style="width:100%;margin-bottom:10px">
      <option value="">Selecione...</option>
      <option value="secretario">Secretário</option>
      <option value="tecnico">Técnico</option>
      <option value="contador">Contador</option>
      <option value="pesquisador">Pesquisador</option>
      <option value="cacs">CACS</option>
      <option value="cidadao">Cidadão</option>
    </select>

    <label for="mensagem">Deixe sua mensagem aqui (Queremos te ouvir):</label>
    <textarea id="mensagem" name="mensagem" rows="4" style="width:100%;margin-bottom:10px" placeholder="Escreva aqui se quiser deixar uma observação ou dúvida..."></textarea>

    <button type="submit" style="padding:10px 20px;background:#007acc;color:#fff;border:none;border-radius:6px">Quero saber mais</button>
    <p id="status-envio" class="status-msg" style="margin-top:10px;font-weight:bold"></p>
  </form>
`;

    const form = document.getElementById("form-interesse");

    // ✅ Local onde os campos devem ser inseridos
    const referencia = form.querySelector('label[for="preferencia-contato"]');

    // ✅ Cria um contêiner temporário para os campos
    const grupoLocalizacao = document.createElement("div");

    // ✅ Insere os campos UF e Município dentro do contêiner
    const validarLocalizacao = await inserirCamposUfMunicipio(grupoLocalizacao);

    // ✅ Insere o contêiner antes do campo de preferência de contato
    form.insertBefore(grupoLocalizacao, referencia);

    // Insere os checkboxes de tipo de newsletter antes do botão de envio
    (async () => {
      try {
        const tiposSnap = await db.collection("tipo_newsletters").get();
        const tipos = tiposSnap.docs.map(doc => {
          const data = doc.data();
          return data.nome;
        }).filter(Boolean);

        if (tipos.length === 0) {
          console.warn("Nenhum tipo de newsletter encontrado.");
          return;
        }

        const grupoInteresse = document.querySelector("#form-interesse");
        if (!grupoInteresse) {
          console.warn("Formulário #form-interesse não encontrado.");
          return;
        }

        const campoExistente = document.getElementById("campo-newsletters");
        if (campoExistente) return;

        const grupo = document.createElement("div");
        grupo.id = "campo-newsletters";
        grupo.style.marginBottom = "10px";
        grupo.innerHTML = `
          <label>Selecione o(s) seu(s) interesse(s)</label>
          <div class="checkbox-group" id="grupo-newsletters" style="margin-bottom:10px">
            ${tipos.map(tipo => `
              <label style="display:block;margin-bottom:6px">
                <input type="checkbox" value="${tipo}"> ${tipo}
              </label>
            `).join("")}
          </div>
        `;

        const botaoEnvio = grupoInteresse.querySelector('button[type="submit"]');
        grupoInteresse.insertBefore(grupo, botaoEnvio);
      } catch (error) {
        console.error("Erro ao buscar tipos de newsletter:", error);
      }
    })();

    // Máscara de telefone
    const telefoneInput = document.getElementById("telefone");
    telefoneInput.addEventListener("input", () => {
      let v = telefoneInput.value.replace(/\D/g, "");
      if (v.length > 11) v = v.slice(0, 11);
      if (v.length > 10) {
        telefoneInput.value = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
      } else if (v.length > 6) {
        telefoneInput.value = `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
      } else if (v.length > 2) {
        telefoneInput.value = `(${v.slice(0, 2)}) ${v.slice(2)}`;
      } else {
        telefoneInput.value = v;
      }
    });


    document.getElementById("form-interesse").addEventListener("submit", async (e) => {
      e.preventDefault();

      const botao = e.submitter || document.querySelector('#form-interesse button[type="submit"]');
      const nome = document.getElementById("nome").value.trim();
      const email = document.getElementById("email").value.trim();
      const telefone = document.getElementById("telefone").value.trim();
      const perfil = document.getElementById("perfil").value;
      const mensagem = document.getElementById("mensagem").value.trim();
      const preferencia = document.getElementById("preferencia-contato").value;
      const checks = document.querySelectorAll('#grupo-newsletters input[type="checkbox"]:checked');
      const interesses = Array.from(checks).map(cb => cb.value).filter(Boolean);
      const status = document.getElementById("status-envio");
      const origem = document.querySelector('input[name="origem"]')?.value || null;

      const localizacao = validarLocalizacao();
      if (!localizacao) return;

      const cod_uf = localizacao.cod_uf;
      const cod_municipio = localizacao.cod_municipio;
      const nome_municipio = localizacao.nome_municipio;

      // Limpa estilos
      ["nome", "email", "telefone", "confirmar_email", "perfil", "preferencia-contato"].forEach(id => {
        const el = document.getElementById(id) || document.getElementsByName(id)[0];
        if (el) el.style.border = "1px solid #ccc";
      });

      status.innerText = "";
      status.style.color = "black";

      // Validações
      let erro = false;

      if (nome.length < 3) {
        erro = true;
        status.innerText = "⚠️ Nome deve ter pelo menos 3 caracteres.";
        document.getElementById("nome").style.border = "2px solid red";
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        erro = true;
        status.innerText = "⚠️ E-mail inválido.";
        document.getElementById("email").style.border = "2px solid red";
      }

      const emailtela = document.getElementById("email").value.trim();
      const confirmar = document.getElementsByName("confirmar_email")[0].value.trim();

      if (emailtela !== confirmar) {
        status.innerText = "⚠️ Os e-mails não coincidem.";
        document.getElementsByName("confirmar_email")[0].style.border = "2px solid red";
        return;
      }

      const telefoneNumerico = telefone.replace(/\D/g, "");
      const telefoneRegex = /^\(\d{2}\)\s?\d{4,5}-\d{4}$/;
      if (telefoneNumerico.length < 10 || !telefoneRegex.test(telefone)) {
        erro = true;
        status.innerText = "⚠️ Telefone incompleto. Digite o número com DDD e 9 dígitos: (XX) XXXXX-XXXX.";
        document.getElementById("telefone").style.border = "2px solid red";
      }

      if (!perfil) {
        erro = true;
        status.innerText = "⚠️ Selecione o perfil";
        document.getElementById("perfil").style.border = "2px solid red";
      }

      if (interesses.length === 0) {
        erro = true;
        status.innerText = "⚠️ Selecione pelo menos um tipo de interesse.";
        status.style.color = "red";
      }

      document.getElementById("preferencia-contato").style.border = "1px solid #ccc";

      if (!preferencia) {
        erro = true;
        status.innerText = "⚠️ Selecione uma preferência de contato.";
        document.getElementById("preferencia-contato").style.border = "2px solid red";
      }

      if (erro) return;

      // Gravação
      status.innerText = "Enviando...";
      status.style.color = "black";
      botao.disabled = true;
      botao.textContent = "Enviando...";

      try {
        await db.collection("leads").add({
          nome,
          nome_lowercase: nome ? nome.toLowerCase() : "",
          email,
          telefone,
          perfil,
          mensagem: mensagem || null,
          interesses,
          preferencia_contato: preferencia,
          origem,
          cod_uf,
          cod_municipio,
          nome_municipio,
          status: "Novo",
          data_criacao: firebase.firestore.Timestamp.now()
        });

        status.innerText = "✅ Interesse registrado com sucesso!";
        status.style.color = "green";
        e.target.reset();
        setTimeout(() => {
          mostrarModalAgradecimento(nome);
        }, 100);
      } catch (err) {
        console.error("Erro ao enviar:", err);
        status.innerText = "Erro ao enviar. Tente novamente.";
        status.style.color = "red";
      } finally {
        botao.disabled = false;
        botao.textContent = "Quero saber mais";
      }
    });

    return;
  }

  window.location.href = `visualizar.html?id=${id}`;
}

function mostrarModalAgradecimento(nome) {
  document.getElementById("nomeModal").textContent = nome;
  document.getElementById("modalAgradecimento").style.display = "block";
}

function fecharModalAgradecimento() {
  document.getElementById("modalAgradecimento").style.display = "none";
  fecharModal(); // Fecha a tela de captura
}

function abrirRecuperacaoSenha() {
  const modal = document.getElementById("modal-interesse");
  const modalBody = document.getElementById("modal-body");

  modalBody.innerHTML = `
    <h2>🔁 Recuperação de Senha</h2>
    <p>Informe seu e-mail cadastrado. Você receberá um link para redefinir sua senha.</p>

    <input type="email" id="email-recuperacao" placeholder="Seu e-mail" style="width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc">
    <button onclick="enviarEmailRecuperacao()" style="padding:10px 20px;background:#007acc;color:#fff;border:none;border-radius:6px">Enviar link</button>
    <p id="mensagem-recuperacao" class="status-msg" style="margin-top:10px;font-weight:bold"></p>
  `;

  modal.style.display = "flex";
}

function enviarEmailRecuperacao() {
  const email = document.getElementById("email-recuperacao").value.trim();
  const msg = document.getElementById("mensagem-recuperacao");

  msg.innerText = "";
  msg.style.color = "red";

  if (!email) {
    msg.innerText = "Informe seu e-mail.";
    return;
  }

  db.collection("usuarios")
    .where("email", "==", email)
    .limit(1)
    .get()
    .then(snapshot => {
      if (snapshot.empty) {
        msg.innerText = "E-mail não encontrado.";
        return;
      }

      const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const link = `https://radarsiope.web.app/resetar.html?token=${token}`;

      return db.collection("recuperacoes").add({
        email,
        token,
        criado_em: new Date()
      }).then(() => {
        // Aqui você pode integrar com EmailJS, SendGrid, etc.
        msg.style.color = "green";
        msg.innerHTML = `Link enviado! Verifique seu e-mail.<br><small><a href="${link}" target="_blank" style="color:#007acc">Abrir link de teste</a></small>`;
      });
    })
    .catch(error => {
      console.error("Erro ao enviar recuperação:", error);
      msg.innerText = "Erro ao enviar recuperação.";
    });
}


function fecharModal() {
  const modal = document.getElementById("modal-interesse");
  if (modal) {
    modal.style.display = "none";
    const modalBody = document.getElementById("modal-body");
    if (modalBody) modalBody.innerHTML = ""; // limpa o conteúdo
  }
}


// 🔹 Executa ao carregar, somente se estiver na página pública
if (document.getElementById("lista-basicas") && document.getElementById("lista-premium")) {
  carregarNewslettersPublicas();
}

function abrirPrimeiroAcesso() {
  const modal = document.getElementById("modal-interesse");
  modal.style.display = "flex";

  // Aguarda o DOM do modal renderizar antes de acessar modal-body
  setTimeout(() => {
    const modalBody = document.getElementById("modal-body");
    if (!modalBody) {
      console.error("Elemento modal-body não encontrado.");
      return;
    }

    modalBody.innerHTML = `
      <h2>🔑 Primeiro Acesso</h2>
      <p>Informe seu e-mail cadastrado e defina uma senha para ativar seu acesso ao painel.</p>

      <label for="email-primeiro">E-mail:</label>
      <input type="email" id="email-primeiro" required style="width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc">

      <label for="senha-primeiro">Nova senha:</label>
      <input type="password" id="senha-primeiro" required style="width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc">

      <button onclick="salvarSenhaPrimeiroAcesso()" style="padding:10px 20px;background:#007acc;color:#fff;border:none;border-radius:6px">Salvar senha</button>
      <p id="mensagem-primeiro-acesso" class="status-msg" style="margin-top:10px;font-weight:bold"></p>
    `;
  }, 50); // pequeno delay para garantir que o modal esteja visível
}


async function salvarSenhaPrimeiroAcesso() {
  const email = document.getElementById("email-primeiro").value.trim();
  const senha = document.getElementById("senha-primeiro").value.trim();
  const msg = document.getElementById("mensagem-primeiro-acesso");

  msg.innerText = "";
  msg.style.color = "red";

  if (!email || !senha) {
    msg.innerText = "Preencha e-mail e senha.";
    return;
  }

  try {
    const senhaCriptografada = await gerarHashSenha(senha);

    const snapshot = await db.collection("usuarios")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (snapshot.empty) {
      msg.innerHTML = `
        E-mail não encontrado. Você pode se cadastrar <button onclick="abrirNewsletter()" style="margin-left:6px;padding:4px 10px;background:#007acc;color:#fff;border:none;border-radius:4px;cursor:pointer">agora</button>.
      `;
      msg.style.color = "red";
      return;
    }

    const docId = snapshot.docs[0].id;
    await db.collection("usuarios").doc(docId).update({ senha: senhaCriptografada });

    msg.style.color = "green";
    msg.innerText = "Senha cadastrada com sucesso! Redirecionando para login...";

    setTimeout(() => {
      window.location.href = "login.html";
    }, 2000);
  } catch (error) {
    console.error("Erro ao salvar senha:", error);
    if (!msg.innerText && !msg.innerHTML) {
      msg.innerText = "Erro ao salvar senha.";
      msg.style.color = "red";
    }
  }
}


window.gerarHashSenha = async function (senha) {
  const encoder = new TextEncoder();
  const data = encoder.encode(senha);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

async function Atualizarnomelower() {
  const usuariosRef = db.collection("usuarios");
  const snapshot = await usuariosRef.get();

  let atualizados = 0;

  for (const doc of snapshot.docs) {
    const dados = doc.data();
    const nome = dados.nome;

    if (nome && nome.toLowerCase() !== dados.nome_lowercase) {
      await doc.ref.update({
        nome_lowercase: nome.toLowerCase()
      });
      atualizados++;
    }
  }

  atualizarNomeLowercaseLeads();
}

async function atualizarNomeLowercaseLeads() {
  const leadsRef = db.collection("leads");
  const snapshot = await leadsRef.get();

  let atualizados = 0;

  for (const doc of snapshot.docs) {
    const dados = doc.data();
    const nome = dados.nome;

    if (nome && nome.toLowerCase() !== dados.nome_lowercase) {
      await doc.ref.update({
        nome_lowercase: nome.toLowerCase()
      });
      atualizados++;
    }
  }
}

async function popularDatas() {
  const snapshot = await db.collection("lotes_gerais").get();
  console.log(`Encontrados ${snapshot.size} documentos.`);

  const updates = snapshot.docs.map(async doc => {
    const lote = doc.data();

    // Gera datas aleatórias entre 2023 e 2025
    const dataGeracao = new Date(
      2023 + Math.floor(Math.random() * 3), // ano 2023-2025
      Math.floor(Math.random() * 12),       // mês 0-11
      Math.floor(Math.random() * 28) + 1,   // dia 1-28
      Math.floor(Math.random() * 24),       // hora
      Math.floor(Math.random() * 60)        // minuto
    );

    const dataEnvio = new Date(
      dataGeracao.getTime() + Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000) // até 7 dias depois
    );

    await doc.ref.update({
      data_geracao: dataGeracao,
      data_envio: dataEnvio
    });

    console.log(`✅ Atualizado lote ${doc.id}`);
  });

  await Promise.all(updates);
  console.log("🎯 Todos os documentos foram atualizados com datas aleatórias.");
}

window.migrarSenhasAntigas = async function () {
  const status = document.getElementById("status-migracao");
  status.innerText = "Processando...";
  status.style.color = "black";

  try {
    const snapshot = await db.collection("usuarios").get();
    let atualizados = 0;

    for (const doc of snapshot.docs) {
      const usuario = doc.data();
      const senhaAtual = usuario.senha;

      // Etapa 1: Se não tiver campo 'senha', cria com valor "abc"
      if (!senhaAtual) {
        await db.collection("usuarios").doc(doc.id).update({ senha: "abc" });
      }

      // Etapa 2: Criptografa a senha atual (se ainda não estiver criptografada)
      const senhaFinal = usuario.senha || "abc";
      const pareceCriptografada = senhaFinal.length === 64 && /^[a-f0-9]+$/.test(senhaFinal);

      if (!pareceCriptografada) {
        const senhaCriptografada = await gerarHashSenha(senhaFinal);
        await db.collection("usuarios").doc(doc.id).update({ senha: senhaCriptografada });
        atualizados++;
      }
    }

    status.innerText = `✅ Senhas migradas: ${atualizados}`;
    status.style.color = "green";
  } catch (error) {
    console.error("Erro ao migrar senhas:", error);
    status.innerText = "Erro ao migrar senhas.";
    status.style.color = "red";
  }
};

window.fazerLogoff = function () {
  const status = document.getElementById("status-logoff");
  status.innerText = "Encerrando sessão...";
  status.style.color = "black";

  // Limpa dados do usuário
  localStorage.removeItem("usuarioLogado");

  // Redireciona para login
  setTimeout(() => {
    window.location.href = "login.html";
  }, 1000);
};

window.loginUsuario = async function () {
  const email = document.getElementById("email-login").value.trim();
  const senha = document.getElementById("senha-login").value.trim();
  const msg = document.getElementById("mensagem-login");

  if (!msg) {
    console.warn("Elemento #mensagem-login não encontrado.");
    return;
  }

  msg.innerText = "";
  msg.style.color = "red";

  if (!email || !senha) {
    msg.innerText = "Preencha e-mail e senha.";
    return;
  }

  const senhaCriptografada = await gerarHashSenha(senha);

  db.collection("usuarios")
    .where("email", "==", email)
    .limit(1)
    .get()
    .then(snapshot => {
      if (snapshot.empty) {
        msg.innerText = "Usuário não encontrado.";
        return;
      }

      const usuarioDoc = snapshot.docs[0];
      const usuarioData = usuarioDoc.data();

      if (!usuarioData || !usuarioData.senha) {
        msg.innerText = "Dados do usuário incompletos.";
        return;
      }

      if (usuarioData.senha !== senhaCriptografada) {
        msg.innerText = "Senha incorreta.";
        return;
      }

      const usuarioLogado = {
        id: usuarioDoc.id,
        email: usuarioData.email || "",
        nome: usuarioData.nome || "",
        tipo_perfil: usuarioData.tipo_perfil || "cliente"
      };

      try {
        localStorage.setItem("usuarioLogado", JSON.stringify(usuarioLogado));
      } catch (e) {
        console.error("Erro ao salvar no localStorage:", e);
        msg.innerText = "Erro interno ao salvar login.";
        return;
      }

      msg.style.color = "green";
      msg.innerText = "Login realizado com sucesso!";

      setTimeout(() => {
        if (usuarioLogado.tipo_perfil === "Admin") {
          window.location.href = "admin.html";
        } else {
          window.location.href = "painel.html";
        }
      }, 1000);
    })
    .catch(error => {
      console.error("Erro ao fazer login:", error);
      msg.innerText = "Erro ao fazer login. Tente novamente.";
    });
}

window.irParaLogin = function () {
  window.location.href = "login.html";
};

async function enviarCapturaPorEmail() {
  const nome = document.getElementById("nome").value.trim();
  const email = document.getElementById("email").value.trim();
  const telefone = document.getElementById("telefone").value.trim();
  const preferencia = document.getElementById("preferencia-contato").value;
  const perfil = document.getElementById("perfil").value;
  const mensagem = document.getElementById("mensagem").value.trim();

  const interesses = Array.from(document.querySelectorAll('#form-interesse input[type="checkbox"]:checked'))
    .map(el => el.value);

  const newslettersSelecionadas = Array.from(document.querySelectorAll('#grupo-newsletters input[type="checkbox"]:checked'))
    .map(el => el.value);

  const dataEnvio = new Date().toISOString();

  // Salvar lead no Firestore
  const leadRef = await db.collection("leads").add({
    nome,
    email,
    telefone,
    preferencia,
    perfil,
    mensagem,
    interesses,
    newsletters: newslettersSelecionadas,
    data_envio: dataEnvio
  });

  // Se a preferência for E-mail, enviar respostas automáticas
  if (preferencia === "E-mail") {
    for (const interesse of interesses) {
      let respostaId = interesse.toLowerCase();

      // Se for newsletter, usar tipo específico
      if (respostaId === "newsletter" && newslettersSelecionadas.length > 0) {
        for (const tipo of newslettersSelecionadas) {
          const id = `newsletter_${tipo.toLowerCase()}`;
          await enviarEmailComRespostaAutomatica(id, nome, email, interesse, preferencia, leadRef);
        }
      } else {
        await enviarEmailComRespostaAutomatica(respostaId, nome, email, interesse, preferencia, leadRef);
      }
    }
  }
}

async function enviarEmailComRespostaAutomatica(respostaId, nome, email, interesse, preferencia, leadRef, momentoEnvio) {
  try {
    const docId = `${respostaId}_${momentoEnvio}`;
    const doc = await db.collection("respostas_automaticas").doc(docId).get();
    if (!doc.exists) return;

    const resposta = doc.data();
    if (!resposta.ativo || !resposta.enviar_automaticamente) return;

    const mensagemFinal = resposta.mensagem_html
      .replace(/{{nome}}/g, nome)
      .replace(/{{interesse}}/g, interesse)
      .replace(/{{preferencia}}/g, preferencia);

    await emailjs.send("SEU_SERVICE_ID", "SEU_TEMPLATE_ID", {
      to_name: nome,
      to_email: email,
      message_html: mensagemFinal
    });

    await leadRef.collection("solicitacoes").add({
      interesse,
      tipo_newsletter: respostaId.startsWith("newsletter_") ? respostaId.replace("newsletter_", "") : null,
      momento_envio: momentoEnvio,
      data_envio_email: new Date().toISOString(),
      status_envio: "email enviado",
      envio_manual: false,
      mensagem_enviada: mensagemFinal
    });

    document.getElementById("status-envio").innerText = "✅ E-mail enviado com sucesso!";
  } catch (error) {
    console.error("Erro ao enviar e-mail automático:", error);
    document.getElementById("status-envio").innerText = "❌ Erro ao enviar e-mail.";
  }
}


async function montarCarrosselNoticias() {
  const snap = await db.collection("temas_noticias")
    .where("ativo", "==", true)
    .orderBy("prioridade")
    .get();

  const temas = snap.docs.map(doc => doc.data());
  const container = document.getElementById("lista-noticias");
  container.innerHTML = "";

  for (const tema of temas) {
    const url = gerarRSSUrl(tema.palavras_chave);
    const noticias = await buscarNoticias(url);
    const corBorda = tema.cor || "#ccc";

    // Criar seção do tema
    const secao = document.createElement("section");
    secao.style.marginBottom = "48px";
    secao.style.padding = "16px";
    secao.style.border = `2px solid ${corBorda}`;
    secao.style.borderRadius = "12px";
    secao.style.background = "#f9f9f9";
    secao.style.boxShadow = "0 2px 6px rgba(0,0,0,0.05)";
    secao.style.width = "1100px"; // 3 cards de 280px + espaçamento
    secao.style.margin = "40px auto"; // centraliza horizontalmente
    secao.style.display = "block";


    // Título do tema
    const titulo = document.createElement("h2");
    titulo.textContent = tema.nome;
    titulo.style.borderLeft = `8px solid ${corBorda}`;
    titulo.style.paddingLeft = "12px";
    titulo.style.color = corBorda;
    titulo.style.fontSize = "1.4em";
    secao.appendChild(titulo);

    // Wrapper com setas e carrossel
    const carrosselWrapper = document.createElement("div");
    carrosselWrapper.style.position = "relative";
    carrosselWrapper.style.display = "flex";
    carrosselWrapper.style.alignItems = "center";
    carrosselWrapper.style.marginTop = "12px";
    carrosselWrapper.style.width = "100%";
    carrosselWrapper.style.maxWidth = "1800px";
    carrosselWrapper.style.margin = "0 auto";


    // Botão esquerda
    const btnEsquerda = document.createElement("button");
    btnEsquerda.textContent = "◀";
    btnEsquerda.style.flex = "0 0 auto";
    btnEsquerda.style.height = "100%";
    btnEsquerda.style.fontSize = "24px";
    btnEsquerda.style.cursor = "pointer";
    btnEsquerda.style.border = "none";
    btnEsquerda.style.background = "#fff";
    btnEsquerda.style.width = "48px";

    // Botão direita
    const btnDireita = document.createElement("button");
    btnDireita.textContent = "▶";
    btnDireita.style.flex = "0 0 auto";
    btnDireita.style.height = "100%";
    btnDireita.style.fontSize = "24px";
    btnDireita.style.cursor = "pointer";
    btnDireita.style.border = "none";
    btnDireita.style.background = "#fff";
    btnDireita.style.width = "48px";

    btnEsquerda.className = "carrossel-seta";
    btnDireita.className = "carrossel-seta";

    // Carrossel interno
    const carrosselContainer = document.createElement("div");
    carrosselContainer.style.overflow = "hidden";
    carrosselContainer.style.width = "1000%";
    carrosselContainer.style.flex = "1";
    carrosselContainer.style.maxWidth = "904px"; // 3 cards de 280px + espaçamento
    carrosselContainer.style.margin = "0 auto"; // centraliza

    const carrossel = document.createElement("div");
    carrossel.style.display = "flex";
    carrossel.style.justifyContent = "flex-start";
    carrossel.style.overflowX = "auto";
    carrossel.style.scrollBehavior = "smooth";
    carrossel.style.gap = "16px";
    carrossel.style.padding = "8px 0";
    carrossel.style.paddingLeft = "16px";
    carrossel.style.paddingRight = "16px";
    carrossel.style.boxSizing = "border-box";
    carrossel.style.width = "954px"; // 3 cards + 2 gaps + 2 paddings
    carrossel.style.scrollSnapType = "x mandatory";


    let touchStartX = 0;
    let touchEndX = 0;

    carrossel.addEventListener("touchstart", e => {
      touchStartX = e.changedTouches[0].screenX;
    });

    carrossel.addEventListener("touchend", e => {
      touchEndX = e.changedTouches[0].screenX;
      const delta = touchEndX - touchStartX;
      if (delta > 50) {
        carrossel.scrollBy({ left: -300, behavior: "smooth" }); // swipe para direita
      } else if (delta < -50) {
        carrossel.scrollBy({ left: 300, behavior: "smooth" }); // swipe para esquerda
      }
    });

    btnEsquerda.onclick = () => carrossel.scrollBy({ left: -300, behavior: "smooth" });
    btnDireita.onclick = () => carrossel.scrollBy({ left: 300, behavior: "smooth" });

    noticias.forEach(n => {
      const card = document.createElement("div");
      card.className = "card";
      card.style.minWidth = "255px";
      card.style.maxWidth = "255px";
      card.style.flex = "0 0 auto";
      card.style.border = `2px solid ${corBorda}`;
      card.style.borderRadius = "8px";
      card.style.padding = "12px";
      card.style.scrollSnapAlign = "start";


      card.innerHTML = `
        <div style="height:6px;background:${corBorda};border-radius:4px;margin-bottom:8px;"></div>
        <h3>${n.titulo}</h3>
        ${n.imagem ? `<img src="${n.imagem}" alt="Imagem da notícia" style="width:100%;border-radius:6px;margin:8px 0;">` : ""}
        ${tema.prioridade <= 2 ? `<p style="color:#e67e22;font-weight:bold;">🔥 Prioridade Alta</p>` : ""}
        <p><a href="${n.link}" target="_blank">🔗 Ver notícia</a></p>
      `;
      carrossel.appendChild(card);
    });

    carrosselContainer.appendChild(carrossel);
    carrosselWrapper.appendChild(btnEsquerda);
    carrosselWrapper.appendChild(carrosselContainer);
    carrosselWrapper.appendChild(btnDireita);
    secao.appendChild(carrosselWrapper);
    container.appendChild(secao);
  }
}

function gerarRSSUrl(palavras_chave) {
  const query = palavras_chave.map(p => `"${p}"`).join(" OR ");
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}


async function buscarNoticias(rssUrl) {
  const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
  const res = await fetch(apiUrl);
  const json = await res.json();

  if (!json.items) return [];

  return json.items.map(item => ({
    titulo: item.title,
    link: item.link,
    imagem: item.thumbnail || null
  }));
}

// ... outras funções como montarCarrosselNoticias(), gerarRSSUrl(), buscarNoticias()

window.addEventListener("DOMContentLoaded", () => {
  montarCarrosselNoticias();
});
