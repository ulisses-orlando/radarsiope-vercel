// Inicializa Firebase
const db = window.db;

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
    // 🔹 Só exibe o formulário se for Premium e usuário não estiver logado
    const container = document.getElementById("formulario-interesse");
    if (container) {
      container.innerHTML = "<p style='font-weight:bold;color:#c0392b'>🔒 Esta newsletter é exclusiva para assinantes.</p><p>Preencha o formulário abaixo para receber informações sobre planos, capacitação ou consultoria.</p>";

      // 🔹 Carrega tipos de newsletter
      const tiposSnap = await db.collection("tipo_newsletters").get();
      const tipos = tiposSnap.docs.map(doc => doc.data().nome).filter(Boolean);

      // 🔹 Monta formulário
      container.innerHTML += `
        <form id="form-interesse" style="margin-top:20px">
          <label>Nome:</label>
          <input type="text" id="nome" required style="width:100%;padding:8px;margin-bottom:10px">

          <label>E-mail:</label>
          <input type="email" id="email" required style="width:100%;padding:8px;margin-bottom:10px">

          <label>Telefone:</label>
          <input type="tel" id="telefone" required style="width:100%;padding:8px;margin-bottom:10px">

          <label>Interesse:</label>
          <div style="display:flex;gap:20px;margin-bottom:10px">
            <label><input type="checkbox" value="Capacitação"> Capacitação</label>
            <label><input type="checkbox" value="Consultoria"> Consultoria</label>
          </div>

          <label>Newsletters:</label>
          <div id="grupo-newsletters" style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;margin-bottom:10px">
            ${tipos.map(tipo => `
              <label><input type="checkbox" value="${tipo}"> ${tipo}</label>
            `).join("")}
          </div>

          <button type="submit" style="padding:10px 20px;background:#007acc;color:#fff;border:none;border-radius:6px">Quero saber mais</button>
          <p id="status-envio" style="margin-top:10px;font-weight:bold"></p>
        </form>
      `;

      // 🔹 Adiciona listener
      document.getElementById("form-interesse").addEventListener("submit", async (e) => {
        e.preventDefault();
        const nome = document.getElementById("nome").value;
        const email = document.getElementById("email").value;
        const telefone = document.getElementById("telefone").value;

        const checks = container.querySelectorAll("input[type='checkbox']:checked");
        const interesses = Array.from(checks).map(cb => cb.value);

        const status = document.getElementById("status-envio");
        status.innerText = "Enviando...";

        try {
          await db.collection("leads").add({
            nome, email, telefone, interesses,
            newsletter_id: id,
            timestamp: firebase.firestore.Timestamp.now()
          });
          status.innerText = "✅ Interesse registrado com sucesso!";
          status.style.color = "green";
          e.target.reset();
        } catch (err) {
          status.innerText = "Erro ao enviar. Tente novamente.";
          status.style.color = "red";
        }
      });
    }
    return;
  }

  // 🔹 Se estiver logado, pode verificar assinatura e redirecionar
  window.location.href = `visualizar.html?id=${id}`;
}



const formInteresse = document.getElementById("form-interesse");
if (formInteresse) {
  formInteresse.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nome = document.getElementById("nome").value;
    const email = document.getElementById("email").value;
    const telefone = document.getElementById("telefone").value;

    const checkboxes = document.querySelectorAll("#interesse input[type='checkbox']:checked");
    const interesses = Array.from(checkboxes).map(cb => cb.value);

    const status = document.getElementById("status-envio");
    status.innerText = "Enviando...";

    try {
      await db.collection("leads").add({
        nome,
        email,
        telefone,
        interesses,
        timestamp: firebase.firestore.Timestamp.now()
      });
      status.innerText = "✅ Interesse registrado com sucesso!";
      status.style.color = "green";
      e.target.reset();
    } catch (err) {
      status.innerText = "Erro ao enviar. Tente novamente.";
      status.style.color = "red";
    }
  });
}



// 🔹 Login simples por e-mail e senha
function loginUsuario() {
  const email = document.getElementById("email-login").value;
  const senha = document.getElementById("senha-login").value;
  const status = document.getElementById("login-status");

  auth.signInWithEmailAndPassword(email, senha)
    .then(async () => {
      status.innerText = "✅ Login realizado com sucesso!";
      status.style.color = "green";

      // 🔍 Busca dados do usuário logado no Firestore
      const snap = await db.collection("usuarios").where("email", "==", email).limit(1).get();
      if (!snap.empty) {
        const usuario = snap.docs[0].data();
        sessionStorage.setItem("usuario_nome", usuario.nome);
        sessionStorage.setItem("usuario_id", snap.docs[0].id);
      } else {
        sessionStorage.setItem("usuario_nome", "Desconhecido");
      }
    })
    .catch(err => {
      status.innerText = "Erro: " + err.message;
      status.style.color = "red";
    });
}


// 🔹 Executa ao carregar, somente se estiver na página pública
if (document.getElementById("lista-basicas") && document.getElementById("lista-premium")) {
  carregarNewslettersPublicas();
}