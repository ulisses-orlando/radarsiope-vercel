// Estado global de filtro
let filtroStatusSolicitacoes = "todos";

// 🔐 Validação de sessão baseada no localStorage
document.addEventListener("DOMContentLoaded", () => {
  const usuario = JSON.parse(localStorage.getItem("usuarioLogado"));
  if (!usuario) {
    // Se não houver dados no localStorage, volta para login
    window.location.href = "login.html";
    return;
  }

  // Se houver usuário, carrega os dados normalmente
  const usuarioId = usuario.id;
  carregarAssinaturas(usuarioId);
  carregarPagamentos(usuarioId);
  carregarBibliotecaTecnica(usuarioId, usuario.email);
  carregarHistoricoSolicitacoes(usuario.id);

  // Exibe nome e perfil no header
  const nomeEl = document.getElementById("nome-usuario");
  if (nomeEl) {
    const nome = usuario.nome || usuario.email || "Usuário";
    nomeEl.textContent = nome;

    const perfilSpan = document.createElement("span");
    perfilSpan.textContent = ` (${usuario.tipo_perfil || "indefinido"})`;
    perfilSpan.style.fontWeight = "normal";
    perfilSpan.style.fontSize = "0.9em";
    nomeEl.appendChild(perfilSpan);
  }
});

// 🚪 Logout baseado no localStorage
document.getElementById("btn-logout").addEventListener("click", () => {
  localStorage.removeItem("usuarioLogado");
  window.location.href = "login.html";
});


function editarSolicitacao(usuarioId, solicitacaoId, descricaoAtual) {
  solicitacaoEmEdicao.usuarioId = usuarioId;
  solicitacaoEmEdicao.solicitacaoId = solicitacaoId;

  document.getElementById("nova-descricao").value = descricaoAtual;
  document.getElementById("modal-editar-solicitacao").style.display = "flex";
}

function salvarEdicaoSolicitacao() {
  const novaDescricao = document.getElementById("nova-descricao").value.trim();
  if (!novaDescricao) {
    mostrarMensagem("A descrição não pode estar vazia.");
    return;
  }

  db.collection("usuarios")
    .doc(solicitacaoEmEdicao.usuarioId)
    .collection("solicitacoes")
    .doc(solicitacaoEmEdicao.solicitacaoId)
    .update({ descricao: novaDescricao })
    .then(() => {
      fecharModalEdicao();
      mostrarMensagem("Solicitação atualizada com sucesso.");
      carregarHistoricoSolicitacoes(solicitacaoEmEdicao.usuarioId);
    })
    .catch(error => {
      console.error("Erro ao editar solicitação:", error);
      mostrarMensagem("Erro ao atualizar a solicitação.");
    });
}

function fecharModalEdicao() {
  document.getElementById("modal-editar-solicitacao").style.display = "none";
}

function filtrarSolicitacoes(status) {
  filtroStatusSolicitacoes = status;
  const usuario = JSON.parse(localStorage.getItem("usuarioLogado"));
  carregarHistoricoSolicitacoes(usuario.id);
}

function formatarData(dataStr) {
  if (!dataStr) return "-";

  // Se for Timestamp do Firestore, converte para Date
  const d = typeof dataStr.toDate === "function" ? dataStr.toDate() : new Date(dataStr);

  if (isNaN(d)) return dataStr; // se falhar, mostra o texto original

  return d.toLocaleString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatarValor(valor) {
  if (!valor) return "0,00";
  return parseFloat(valor).toFixed(2).replace(".", ",");
}


// 📄 Minhas Assinaturas
function carregarAssinaturas(usuarioId) {
  const container = document.getElementById("minhas-assinaturas");

  db.collection("usuarios")
    .doc(usuarioId)
    .collection("assinaturas")
    .get()
    .then(snapshot => {
      if (snapshot.empty) {
        container.innerHTML = "<p>Você não possui assinaturas registradas.</p>";
        return;
      }

      let html = "";
      snapshot.forEach(doc => {
        const a = doc.data();
        const status = a.status.toLowerCase();
        let cor = "#999";
        let icone = "❔";

        if (status === "ativo") {
          cor = "#28a745";
          icone = "✅";
        } else if (status === "cancelado") {
          cor = "#dc3545";
          icone = "❌";
        } else if (status === "pendente") {
          cor = "#ffc107";
          icone = "⏳";
        } else if (status === "cancelamento_solicitado") {
          cor = "#17a2b8";
          icone = "📤";
        }

        html += `
          <div class="assinatura" style="border-left: 6px solid ${cor}; padding-left: 10px; margin-bottom: 15px;">
            <strong>${a.tipo_newsletter}</strong> — Plano ${a.plano_id}<br>
            Início: ${formatarData(a.data_inicio)} — Status: <span style="color:${cor}; font-weight:bold;">${icone} ${a.status}</span><br>
            ${status === "ativo" ? `<button onclick="solicitarCancelamento('${usuarioId}', '${doc.id}')">Solicitar cancelamento</button>` : ""}
          </div>
        `;
      });

      container.innerHTML = html;
    })
    .catch(error => {
      console.error("Erro ao carregar assinaturas:", error);
      container.innerHTML = "<p>Erro ao carregar suas assinaturas.</p>";
    });
}


// 💳 Pagamentos
function carregarPagamentos(usuarioId) {
  const container = document.getElementById("meus-pagamentos");

  db.collection("usuarios")
    .doc(usuarioId)
    .collection("pagamentos")
    .orderBy("data_pagamento", "desc")
    .get()
    .then(snapshot => {
      if (snapshot.empty) {
        container.innerHTML = "<p>Nenhum pagamento registrado.</p>";
        return;
      }

      let html = "";
      snapshot.forEach(doc => {
        const p = doc.data();
        const status = p.status?.toLowerCase() || "desconhecido";
        let cor = "#999";
        let icone = "❔";

        if (status === "pago") {
          cor = "#28a745";
          icone = "💰";
        } else if (status === "pendente") {
          cor = "#ffc107";
          icone = "⏳";
        } else if (status === "falhou") {
          cor = "#dc3545";
          icone = "❌";
        }

        html += `
          <div class="pagamento" style="border-left: 6px solid ${cor}; padding-left: 10px; margin-bottom: 15px;">
            <strong>${icone} ${status.toUpperCase()}</strong><br>
            Data: ${formatarData(p.data_pagamento)}<br>
            Valor: R$ ${formatarValor(p.valor)}<br>
            Método: ${p.metodo_pagamento || "-"}<br>
            ${p.comprovante_url ? `<a href="${p.comprovante_url}" target="_blank">📄 Ver comprovante</a>` : ""}
          </div>
        `;
      });

      container.innerHTML = html;
    })
    .catch(error => {
      console.error("Erro ao carregar pagamentos:", error);
      container.innerHTML = "<p>Erro ao carregar pagamentos.</p>";
    });
}


// 📚 Biblioteca Técnica
function carregarBibliotecaTecnica(usuarioId, email) {
  const container = document.getElementById("biblioteca-tecnica");

  db.collection("usuarios")
    .doc(usuarioId)
    .collection("assinaturas")
    .get()
    .then(snapshot => {
      const tipos = [];
      snapshot.forEach(doc => {
        const assinatura = doc.data();
        if (assinatura.tipo_newsletter && assinatura.status === "ativa") {
          tipos.push(assinatura.tipo_newsletter);
        }
      });

      const tiposValidos = tipos.filter(t => t !== undefined && t !== null);

      if (tiposValidos.length === 0) {
        container.innerHTML = "<p>Você não possui acesso a newsletters no momento.</p>";
        return;
      }

      db.collection("newsletters")
        .where("tipo", "in", tiposValidos)
        .orderBy("edicao", "desc")
        .get()
        .then(newsSnapshot => {
          if (newsSnapshot.empty) {
            container.innerHTML = "<p>Nenhuma newsletter encontrada.</p>";
            return;
          }

          // Cria o grid
          container.innerHTML = `<div class="lista-newsletters" id="lista-newsletters"></div>`;
          const grid = document.getElementById("lista-newsletters");

          // Renderiza os cards
          grid.innerHTML = newsSnapshot.docs.map(doc => {
            const n = doc.data();
            return `
        <div class="newsletter-card">
          <h4>${n.titulo || "Newsletter"}</h4>
          <p>Edição ${n.edicao || "-"} · ${n.tipo || ""}</p>
          <div class="acoes">
            <button onclick="abrirNewsletter('${doc.id}')">Ver</button>
          </div>
        </div>
      `;
          }).join("");
        });
    })
    .catch(error => {
      console.error("Erro ao carregar biblioteca técnica:", error);
      container.innerHTML = "<p>Erro ao carregar biblioteca técnica.</p>";
    });
}

// 💬 Suporte
document.getElementById("btn-enviar-suporte").addEventListener("click", () => {
  const usuario = JSON.parse(localStorage.getItem("usuarioLogado"));
  const tipo = document.getElementById("tipo-suporte").value;
  const descricao = document.getElementById("mensagem-suporte").value.trim();
  const feedback = document.getElementById("suporte-feedback");

  feedback.innerHTML = "";

  if (!descricao) {
    feedback.innerHTML = `<div style="color:#dc3545;">❌ Por favor, descreva sua solicitação.</div>`;
    return;
  }

  const novaSolicitacao = {
    tipo,
    descricao,
    status: "aberta",
    data_solicitacao: new Date().toISOString()
  };

  db.collection("usuarios")
    .doc(usuario.id)
    .collection("solicitacoes")
    .add(novaSolicitacao)
    .then(() => {
      feedback.innerHTML = `<div style="color:#28a745;">✅ Solicitação registrada com sucesso!</div>`;
      document.getElementById("mensagem-suporte").value = "";
    })
    .catch(error => {
      console.error("Erro ao registrar solicitação:", error);
      feedback.innerHTML = `<div style="color:#dc3545;">❌ Erro ao enviar sua solicitação.</div>`;
    });
});

function carregarHistoricoSolicitacoes(usuarioId) {
  const container = document.getElementById("historico-solicitacoes");
  container.innerHTML = "";

  const tipos = ["consultoria", "treinamento", "newsletters", "outros"];
  const colunas = {};
  tipos.forEach(tipo => { colunas[tipo] = []; });

  // ✅ Inicializa contadores aqui
  const contadores = { pendente: 0, aberta: 0, atendida: 0, cancelada: 0 };

  db.collection("usuarios")
    .doc(usuarioId)
    .collection("solicitacoes")
    .orderBy("data_solicitacao", "desc")
    .get()
    .then(snapshot => {
      if (snapshot.empty) {
        container.innerHTML = "<p>Você ainda não fez nenhuma solicitação.</p>";
        return;
      }

      snapshot.forEach(doc => {
        const s = doc.data();
        const tipo = s.tipo?.toLowerCase() || "outros";
        const status = s.status?.toLowerCase() || "pendente";

        // ✅ Atualiza contadores
        if (contadores[status] !== undefined) contadores[status]++;

        if (filtroStatusSolicitacoes !== "todos" && status !== filtroStatusSolicitacoes) return;

        let cor = "#999", icone = "❔";
        if (status === "pendente") { cor = "#ffc107"; icone = "⏳"; }
        else if (status === "aberta") { cor = "#17a2b8"; icone = "📤"; }
        else if (status === "atendida") { cor = "#28a745"; icone = "✅"; }
        else if (status === "cancelada") { cor = "#dc3545"; icone = "❌"; }

        const respostaHtml = (status === "atendida" || status === "cancelada") && s.resposta
          ? `<div style="margin-top:6px; background:#f1f1f1; padding:8px; border-radius:4px;">
              <strong>💡 Resposta do atendimento:</strong><br>${s.resposta}
              ${!s.avaliacao ? `
                <div style="margin-top:8px;">
                  <span style="margin-right:10px;">Avaliação:</span>
                  <button onclick="avaliarSolicitacao('${usuarioId}', '${doc.id}', 'positivo')">👍</button>
                  <button onclick="avaliarSolicitacao('${usuarioId}', '${doc.id}', 'negativo')">👎</button>
                </div>` : `
                <div style="margin-top:8px; color:#555;">
                  ✅ Você avaliou como: <strong>${s.avaliacao === "positivo" ? "👍 Positivo" : "👎 Negativo"}</strong>
                </div>`}
            </div>`
          : "";

        const html = `
          <div class="item-solicitacao" style="border-left-color:${cor};">
            <strong>${icone} ${tipo}</strong><br>
            ${s.descricao}<br>
            <small>${formatarData(s.data_solicitacao)} — Status: <span style="color:${cor}; font-weight:bold;">${s.status}</span></small><br>
            ${status === "aberta" ? `<button onclick="cancelarSolicitacao('${usuarioId}', '${doc.id}')">Cancelar</button>` : ""}
            ${status === "pendente" ? `<button onclick="editarSolicitacao('${usuarioId}', '${doc.id}', '${s.descricao.replace(/'/g, "\\'")}')">✏️ Editar</button>` : ""}
            ${respostaHtml}
          </div>
        `;

        colunas[tipo]?.push(html);
      });

      // ✅ Atualiza botões de filtro com contadores
      document.querySelector("#filtros-solicitacoes").innerHTML = `
        <button onclick="filtrarSolicitacoes('todos')">Todos</button>
        <button onclick="filtrarSolicitacoes('pendente')">Pendente (${contadores.pendente})</button>
        <button onclick="filtrarSolicitacoes('aberta')">Aberta (${contadores.aberta})</button>
        <button onclick="filtrarSolicitacoes('atendida')">Atendida (${contadores.atendida})</button>
        <button onclick="filtrarSolicitacoes('cancelada')">Cancelada (${contadores.cancelada})</button>
      `;

      // Montar colunas
      tipos.forEach(tipo => {
        container.innerHTML += `
          <div class="coluna-solicitacoes">
            <h4>${tipo.charAt(0).toUpperCase() + tipo.slice(1)}</h4>
            ${colunas[tipo].join("") || "<p style='text-align:center;'>Nenhuma solicitação</p>"}
          </div>
        `;
      });
    })
    .catch(error => {
      console.error("Erro ao carregar histórico de solicitações:", error);
      container.innerHTML = "<p>Erro ao carregar histórico.</p>";
    });
}

function cancelarSolicitacao(usuarioId, solicitacaoId) {
  if (!confirm("Deseja realmente cancelar esta solicitação?")) return;

  db.collection("usuarios")
    .doc(usuarioId)
    .collection("solicitacoes")
    .doc(solicitacaoId)
    .update({ status: "cancelada" })
    .then(() => {
      mostrarMensagem("Solicitação cancelada com sucesso.");
      carregarHistoricoSolicitacoes(usuarioId);
    })
    .catch(error => {
      console.error("Erro ao cancelar solicitação:", error);
      mostrarMensagem("Erro ao cancelar a solicitação.");
    });
}


// 🚫 Cancelamento de assinatura
function solicitarCancelamento(usuarioId, assinaturaId) {
  if (!confirm("Deseja realmente solicitar o cancelamento desta assinatura?")) return;

  db.collection("usuarios")
    .doc(usuarioId)
    .collection("assinaturas")
    .doc(assinaturaId)
    .update({ status: "cancelamento_solicitado" })
    .then(() => {
      mostrarMensagem("Cancelamento solicitado com sucesso.");
      carregarAssinaturas(usuarioId);
    })
    .catch(error => {
      console.error("Erro ao solicitar cancelamento:", error);
      mostrarMensagem("Erro ao solicitar cancelamento.");
    });
}

function avaliarSolicitacao(usuarioId, solicitacaoId, avaliacao) {
  db.collection("usuarios")
    .doc(usuarioId)
    .collection("solicitacoes")
    .doc(solicitacaoId)
    .update({ avaliacao })
    .then(() => {
      carregarHistoricoSolicitacoes(usuarioId);
    })
    .catch(error => {
      console.error("Erro ao registrar avaliação:", error);
      mostrarMensagem("Erro ao salvar sua avaliação.");
    });
}

function abrirNewsletter(newsletterId) {
  // Redireciona para o formulário de leitura já existente
  window.location.href = `verNewsletterUsuario.html?nid=${newsletterId}`;
}

