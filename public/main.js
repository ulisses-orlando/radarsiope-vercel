// Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyDcS4nneXnN8Cdb-S_cQukwaguLXJYbQ1U",
  authDomain: "radarsiope.firebaseapp.com",
  projectId: "radarsiope",
  storageBucket: "radarsiope.firebasestorage.app",
  messagingSenderId: "357921899865",
  appId: "1:357921899865:web:3c7f93b4fa7b3ea7ab3848",
  measurementId: "G-6FSVXQRBJN"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Verifica se o usuário está logado
firebase.auth().onAuthStateChanged(user => {
  if (user) {
    document.getElementById("userInfo").innerHTML = `
      <p><strong>${user.displayName}</strong> (${user.email})</p>
    `;
  } else {
    window.location.href = "/login.html";
  }
});

// Navegação entre seções
function mostrar(secao) {
  switch (secao) {
    case 'perfil': mostrarPerfil(); break;
    case 'assinatura': mostrarAssinatura(); break;
    case 'relatorios': mostrarRelatorios(); break;
    case 'conteudo': mostrarConteudo(); break;
    case 'suporte': mostrarSuporte(); break;
  }
}

function logout() {
  firebase.auth().signOut().then(() => {
    window.location.href = "/login.html";
  });
}

function mostrarPerfil() {
  const user = firebase.auth().currentUser;
  const uid = user.uid;

  db.collection("usuarios").doc(uid).get().then(doc => {
    const dados = doc.exists ? doc.data() : {};

    document.getElementById("conteudo").innerHTML = `
      <h3>👤 Meu Perfil</h3>

<div id="perfilPainel">
  <p><strong>Nome:</strong> ${dados.nome || user.displayName || '-'}</p>
  <p><strong>Email:</strong> ${user.email}</p>
  <p><strong>Telefone:</strong> ${dados.telefone || '-'}</p>
  <p><strong>Data de Nascimento:</strong> ${dados.nascimento || '-'}</p>
  <p><strong>Instagram:</strong> ${dados.instagram || '-'}</p>
</div>


      <form id="formPerfil">
        <label>Nome:</label><br>
        <input type="text" id="nome" value="${dados.nome || user.displayName || ''}"><br><br>

        <label>Email:</label><br>
        <input type="email" id="email" value="${user.email}" disabled><br><br>

        <label>Telefone:</label><br>
        <input type="text" id="telefone" value="${dados.telefone || ''}"><br><br>

        <label>Data de Nascimento:</label><br>
        <input type="date" id="nascimento" value="${dados.nascimento || ''}"><br><br>

        <label>Instagram:</label><br>
        <input type="text" id="instagram" value="${dados.instagram || ''}" placeholder="@seuusuario"><br><br>

        <button type="submit">💾 Salvar</button>
      </form>
    `;

    document.getElementById("formPerfil").addEventListener("submit", e => {
      e.preventDefault();
      const nome = document.getElementById("nome").value;
      const telefone = document.getElementById("telefone").value;
      const nascimento = document.getElementById("nascimento").value;
      const instagram = document.getElementById("instagram").value;

      db.collection("usuarios").doc(uid).set({
        nome,
        telefone,
        nascimento,
        instagram
      }, { merge: true })
        .then(() => alert("✅ Dados atualizados com sucesso!"))
        .catch(err => alert("❌ Erro ao salvar: " + err));
    });
  });
}





function mostrarRelatorios() {
  document.getElementById("conteudo").innerHTML = `
    <h3>📊 Relatórios</h3>

    <div id="painelRelatorios">
      <p>Aqui você poderá acessar seus relatórios personalizados, gráficos e análises.</p>
      <ul>
        <li><a href="#">📁 Relatório de Desempenho</a></li>
        <li><a href="#">📈 Evolução Mensal</a></li>
        <li><a href="#">📊 Comparativo por Região</a></li>
      </ul>
    </div>
  `;
}

function mostrarConteudo() {
  const user = firebase.auth().currentUser;
  const uid = user.uid;

  db.collection("usuarios").doc(uid).get().then(doc => {
    const dados = doc.exists ? doc.data() : {};
    const plano = dados.plano || 'Gratuito';

    if (plano === 'Gratuito') {
      document.getElementById("conteudo").innerHTML = `
  <h3>🔒 Conteúdo Exclusivo</h3>
  <div id="bloqueioConteudo">
    <p>Este conteúdo é reservado para assinantes do plano <strong>Mensal</strong> ou <strong>Anual</strong>.</p>
    <p>Faça upgrade agora e desbloqueie materiais premium, tutoriais avançados e relatórios exclusivos.</p>
    <button id="btnUpgrade">🚀 Fazer Upgrade</button>
  </div>
`;

    } else {
      document.getElementById("conteudo").innerHTML = `
        <h3>🎓 Conteúdo Exclusivo</h3>
        <div id="painelConteudo">
          <ul>
            <li><a href="#">📘 Guia de Gestão Orçamentária</a></li>
            <li><a href="#">📊 Painel de Indicadores Municipais</a></li>
            <li><a href="#">🎥 Tutorial: Como interpretar o SIOPE</a></li>
          </ul>
        </div>
      `;
    }
  });
}

function mostrarAssinatura() {
  const user = firebase.auth().currentUser;
  const uid = user.uid;

  db.collection("usuarios").doc(uid).get().then(doc => {
    const dados = doc.exists ? doc.data() : {};

    let html = `
      <h3>💳 Minha Assinatura</h3>
      <div id="painelAssinatura">
        <p><strong>Plano:</strong> ${dados.plano || 'Gratuito'}</p>
        <p><strong>Status:</strong> ${dados.status || 'Ativo'}</p>
        <p><strong>Vencimento:</strong> ${dados.vencimento || '---'}</p>
      </div>

      <form id="formSolicitacao">
        <label for="novoPlano">Solicitar alteração de plano:</label>
        <select id="novoPlano">
          <option value="">-- Selecione --</option>
          <option value="Mensal">Mensal</option>
          <option value="Anual">Anual</option>
          <option value="Cancelar">Cancelar Assinatura</option>
        </select><br><br>
        <button type="submit">📤 Enviar Solicitação</button>
      </form>
    `;

    document.getElementById("conteudo").innerHTML = html;

    document.getElementById("formSolicitacao").addEventListener("submit", e => {
      e.preventDefault();
      const novoPlano = document.getElementById("novoPlano").value;

      if (!novoPlano) {
        alert("⚠️ Selecione uma opção antes de enviar.");
        return;
      }

      db.collection("suporte").add({
        uid,
        nome: user.displayName || '',
        email: user.email || '',
        mensagem: `Solicitação de alteração de plano para: ${novoPlano}`,
        data: firebase.firestore.Timestamp.now()
      })
      .then(() => {
        alert("✅ Solicitação enviada com sucesso!");
        document.getElementById("novoPlano").value = "";
      })
      .catch(err => {
        alert("❌ Erro ao enviar solicitação: " + err);
      });
    });
  });
}


function mostrarAdmin() {
  const user = firebase.auth().currentUser;
  const uid = user.uid;
  const isAdmin = uid === 'vgfzWGM3A1hUTly6Ehu73RVMK8r2'; // substitua pelo seu UID

  if (!isAdmin) {
    document.getElementById("conteudo").innerHTML = `
      <h3>🔒 Acesso Restrito</h3>
      <p>Você não tem permissão para acessar o painel de administração.</p>
    `;
    return;
  }

db.collection("usuarios").get().then(snapshot => {
  let html = `
    <h3>🛠️ Painel de Administração</h3>
    <button onclick="mostrarSolicitacoes()" style="margin-bottom: 20px;">📥 Ver Solicitações</button>
    <table>
      <thead>
        <tr>
          <th>Nome</th>
          <th>Email</th>
          <th>Plano</th>
          <th>Status</th>
          <th>Vencimento</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
  `;


    snapshot.forEach(doc => {
      const dados = doc.data();
      html += `
        <tr>
          <td>${dados.nome || '-'}</td>
          <td>${dados.email || '-'}</td>
          <td>
  <select data-id="${doc.id}" class="campoPlano">
    <option value="Gratuito" ${dados.plano === 'Gratuito' ? 'selected' : ''}>Gratuito</option>
    <option value="Mensal" ${dados.plano === 'Mensal' ? 'selected' : ''}>Mensal</option>
    <option value="Anual" ${dados.plano === 'Anual' ? 'selected' : ''}>Anual</option>
  </select>
</td>

<td>
  <select data-id="${doc.id}" class="campoStatus">
    <option value="Ativo" ${dados.status === 'Ativo' ? 'selected' : ''}>Ativo</option>
    <option value="Inativo" ${dados.status === 'Inativo' ? 'selected' : ''}>Inativo</option>
    <option value="Cancelado" ${dados.status === 'Cancelado' ? 'selected' : ''}>Cancelado</option>
  </select>
</td>

          <td><input type="date" value="${dados.vencimento || ''}" data-id="${doc.id}" class="campoVencimento"></td>
          <td><button class="btnSalvar" data-id="${doc.id}">💾 Salvar</button></td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    document.getElementById("conteudo").innerHTML = html;

    document.querySelectorAll(".btnSalvar").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const plano = document.querySelector(`.campoPlano[data-id="${id}"]`).value;
        const status = document.querySelector(`.campoStatus[data-id="${id}"]`).value;
        const vencimento = document.querySelector(`.campoVencimento[data-id="${id}"]`).value;

        db.collection("usuarios").doc(id).set({
          plano,
          status,
          vencimento
        }, { merge: true })
          .then(() => alert("✅ Usuário atualizado com sucesso!"))
          .catch(err => alert("❌ Erro ao salvar: " + err));
      });
    });
  });
}

firebase.auth().onAuthStateChanged(user => {
  if (user) {
    const uid = user.uid;
    const isAdmin = uid === 'vgfzWGM3A1hUTly6Ehu73RVMK8r2'; // substitua pelo seu UID real

    if (isAdmin) {
      document.getElementById("btnAdmin").style.display = "inline-block";
    }
  }
});

function mostrarSuporte() {
  document.getElementById("conteudo").innerHTML = `
    <h3>📞 Suporte</h3>

    <div id="painelSuporte">
      <p>Precisa de ajuda? Estamos aqui para apoiar você.</p>

      <ul>
        <li>📧 <strong>Email:</strong> suporte@radarsiope.com.br</li>
        <li>📱 <strong>WhatsApp:</strong> (61) 9 9999-9999</li>
        <li>📘 <strong>Manual do Usuário:</strong> <a href="#">Acessar PDF</a></li>
      </ul>

      <form id="formSuporte">
        <label for="mensagem">Envie uma mensagem:</label>
        <textarea id="mensagem" rows="4" placeholder="Descreva sua dúvida ou problema..."></textarea><br>
        <button type="submit">📤 Enviar</button>
      </form>
    </div>
  `;

  document.getElementById("formSuporte").addEventListener("submit", e => {
  e.preventDefault();
  const mensagem = document.getElementById("mensagem").value;
  const user = firebase.auth().currentUser;

  if (!mensagem.trim()) {
    alert("⚠️ Escreva uma mensagem antes de enviar.");
    return;
  }

  db.collection("suporte").add({
    uid: user.uid,
    nome: user.displayName || '',
    email: user.email || '',
    mensagem,
    data: firebase.firestore.Timestamp.now()
  })
  .then(() => {
    alert("✅ Sua mensagem foi enviada! Entraremos em contato em breve.");
    document.getElementById("mensagem").value = "";
  })
  .catch(err => {
    alert("❌ Erro ao enviar mensagem: " + err);
  });
});

}

function mostrarHistoricoSuporte() {
  const user = firebase.auth().currentUser;
  const uid = user.uid;

  db.collection("suporte")
    .where("uid", "==", uid)
    .orderBy("data", "desc")
    .get()
    .then(snapshot => {
      let html = `<h3>📜 Histórico de Suporte</h3><div id="historicoSuporte">`;

      if (snapshot.empty) {
        html += `<p>Você ainda não enviou nenhuma mensagem de suporte.</p>`;
      } else {
        snapshot.forEach(doc => {
          const dados = doc.data();
          const dataFormatada = dados.data.toDate().toLocaleString("pt-BR");

          html += `
            <div class="mensagemSuporte">
              <p><strong>Data:</strong> ${dataFormatada}</p>
              <p><strong>Mensagem:</strong> ${dados.mensagem}</p>
              <hr>
            </div>
          `;
        });
      }

      html += `</div>`;
      document.getElementById("conteudo").innerHTML = html;
    });
}

function mostrarSolicitacoes() {
  const user = firebase.auth().currentUser;
  const uid = user.uid;
  const isAdmin = uid === 'abc123xyz456'; // substitua pelo seu UID

  if (!isAdmin) {
    document.getElementById("conteudo").innerHTML = `
      <h3>🔒 Acesso Restrito</h3>
      <p>Você não tem permissão para acessar esta área.</p>
    `;
    return;
  }

  db.collection("suporte")
    .orderBy("data", "desc")
    .get()
    .then(snapshot => {
      let html = `<h3>📥 Solicitações de Usuários</h3><div id="painelSolicitacoes">`;

      if (snapshot.empty) {
        html += `<p>Nenhuma solicitação registrada até o momento.</p>`;
      } else {
        snapshot.forEach(doc => {
          const dados = doc.data();
          const dataFormatada = dados.data.toDate().toLocaleString("pt-BR");

          html += `
            <div class="solicitacaoItem">
              <p><strong>Usuário:</strong> ${dados.nome || '---'} (${dados.email})</p>
              <p><strong>Data:</strong> ${dataFormatada}</p>
              <p><strong>Mensagem:</strong> ${dados.mensagem}</p>
              <hr>
            </div>
          `;
        });
      }

      html += `</div>`;
      document.getElementById("conteudo").innerHTML = html;
    });
}

function loginGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider)
    .then(result => {
      console.log("✅ Login realizado:", result.user.displayName);
      document.getElementById("loginArea").style.display = "none";
      mostrarBibliotecaNews();
    })
    .catch(error => {
      console.error("❌ Erro no login:", error);
      alert("Falha ao fazer login com Google.");
    });
}

function mostrarBibliotecaNews() {
  const user = firebase.auth().currentUser;

  verificarAcessoPremium(user, temAcesso => {
    db.collection("newsletter")
      .where("visivel", "==", true)
      .orderBy("dataPublicacao", "desc")
      .get()
      .then(snapshot => {
        let html = "";

        snapshot.forEach(doc => {
          const dados = doc.data();
          const dataFormatada = dados.dataPublicacao.toDate().toLocaleDateString("pt-BR");
          const bloqueado = dados.tipo === "premium" && !temAcesso;

          html += `
            <div class="cardNews" style="min-width:250px; flex:0 0 auto;">
              <h3>${dados.titulo}</h3>
              <p><strong>Data:</strong> ${dataFormatada}</p>
              ${bloqueado ? `
                <p>🔒 Conteúdo exclusivo para assinantes premium.</p>
              ` : `
                <button onclick="abrirNewsletter('${doc.id}')">📖 Ler</button>
              `}
            </div>
          `;
        });

        document.getElementById("carouselNews").innerHTML = html;
      });
  });
}



function abrirNewsletter(id) {
  db.collection("newsletter").doc(id).get().then(doc => {
    const dados = doc.data();
    document.getElementById("listaNews").innerHTML = `
      <h2>${dados.titulo}</h2>
      <div>${dados.conteudoHtml}</div>
      <button onclick="mostrarBibliotecaNews()">🔙 Voltar</button>
    `;
  });
}
function verificarAcessoPremium(user, callback) {
  if (!user) {
    callback(false);
    return;
  }

  db.collection("usuarios").doc(user.uid).get()
    .then(doc => {
      if (doc.exists) {
        const dados = doc.data();
        const ativo = dados.status === "ativo";
        callback(ativo);
      } else {
        console.warn("Usuário não encontrado na coleção 'usuarios'.");
        callback(false);
      }
    })
    .catch(error => {
      console.error("Erro ao verificar acesso premium:", error);
      callback(false);
    });
}
function scrollCarousel(direction) {
  const container = document.getElementById("carouselNews");
  const scrollAmount = 300 * direction;
  container.scrollBy({ left: scrollAmount, behavior: "smooth" });
}
