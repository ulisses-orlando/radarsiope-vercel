// Estado global de filtro
let filtroStatusSolicitacoes = "todos";
let solicitacaoEmEdicao = { usuarioId: null, solicitacaoId: null };

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
async function carregarAssinaturas(usuarioId) {
  const container = document.getElementById("minhas-assinaturas");
  if (!container) return;

  try {
    const assinaturasSnap = await db
      .collection("usuarios")
      .doc(usuarioId)
      .collection("assinaturas")
      .get();

    if (assinaturasSnap.empty) {
      container.innerHTML = "<p>Você não possui assinaturas registradas.</p>";
      return;
    }

    // coletar ids únicos de planos
    const planoIdsSet = new Set();
    assinaturasSnap.forEach(doc => {
      const a = doc.data();
      if (a && a.plano_id) planoIdsSet.add(String(a.plano_id));
    });
    const planoIds = Array.from(planoIdsSet);

    // buscar documentos de planos (paralelo)
    const planosMap = {};
    if (planoIds.length) {
      const planosPromises = planoIds.map(id =>
        db.collection("planos").doc(id).get().then(d => ({ id, doc: d }))
      );
      const planosResults = await Promise.all(planosPromises);
      planosResults.forEach(({ id, doc }) => {
        planosMap[id] = (doc && doc.exists) ? doc.data() : null;
      });
    }

    // função utilitária para formatar badge de envio
    const badgeForEnvio = (env) => {
      const data = env.data_envio ? (env.data_envio.toDate ? env.data_envio.toDate() : new Date(env.data_envio)) : null;
      const dataLabel = data ? formatarData(data) : '-';
      const title = data ? data.toLocaleString() : '';
      const status = (env.status || '').toLowerCase();

      let bg = '#f0f0f0';
      let color = '#333';
      if (status === 'enviado' || status === 'entregue') { bg = '#e6ffed'; color = '#1b7a3a'; }
      else if (status === 'falha' || status === 'erro') { bg = '#ffecec'; color = '#b02a37'; }
      else if (status === 'pendente') { bg = '#fff7e6'; color = '#8a5a00'; }
      else if (status === 'processando') { bg = '#eef6ff'; color = '#0b5ed7'; }

      // badge compacto: mostra data curta e um ponto/color para status
      return `<span class="envio-badge" title="${title}" style="
                display:inline-block;
                padding:4px 6px;
                margin:3px 6px 3px 0;
                font-size:12px;
                border-radius:6px;
                background:${bg};
                color:${color};
                border:1px solid rgba(0,0,0,0.06);
                white-space:nowrap;
                ">
                ${dataLabel}
              </span>`;
    };

    // montar HTML das assinaturas com envios
    let html = '';

    // Para performance: buscar envios em paralelo por assinatura (limit)
    const assinaturasDocs = assinaturasSnap.docs;
    const enviosPromises = assinaturasDocs.map(doc =>
      db.collection('usuarios').doc(usuarioId)
        .collection('assinaturas').doc(doc.id)
        .collection('envios')
        .orderBy('data_envio', 'desc') // pega os mais recentes
        .limit(200) // limite razoável; ajuste conforme necessidade
        .get()
        .then(s => ({ assinaturaId: doc.id, snap: s, data: doc.data() }))
    );

    const enviosResults = await Promise.all(enviosPromises);

    // transformar em mapa por assinaturaId para fácil acesso
    const enviosMap = {};
    enviosResults.forEach(r => {
      // r.snap.docs está em ordem desc (mais recente primeiro) — inverter para ordem cronológica (antigo -> novo)
      const docs = r.snap.docs.slice().reverse();
      enviosMap[r.assinaturaId] = docs.map(d => d.data());
    });

    assinaturasDocs.forEach(doc => {
      const a = doc.data();
      const status = (a.status || '').toLowerCase();
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

      const planoId = a.plano_id ? String(a.plano_id) : "";
      const plano = planoId ? planosMap[planoId] : null;
      const descricaoPlano = plano && plano.descricao ? plano.descricao : (planoId ? `Plano ${planoId}` : "Plano não informado");

      // envios para esta assinatura (pode ser vazio)
      const envios = enviosMap[doc.id] || [];

      // montar blocos de envios compactos (vários por linha)
      const enviosHtml = envios.length
        ? `<div class="envios-lista" style="margin-top:8px; display:flex; flex-wrap:wrap; align-items:center;">
             ${envios.map(e => badgeForEnvio(e)).join('')}
           </div>
           <div style="font-size:12px;color:#666;margin-top:6px;">Total de envios: ${envios.length}</div>`
        : `<div style="font-size:12px;color:#666;margin-top:8px;">Nenhum envio registrado.</div>`;

      html += `
        <div class="assinatura" style="border-left: 6px solid ${cor}; padding:10px 10px 12px 10px; margin-bottom: 15px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
            <div style="flex:1">
              <strong style="display:block">${a.tipo_newsletter || ''}</strong>
              <div style="font-style:italic;color:#333;margin-top:4px;">${descricaoPlano}</div>
              <div style="font-size:13px;color:#666;margin-top:6px;">
                Vigência: ${formatarData(a.data_inicio)} a ${formatarData(a.data_fim)}
              </div>
            </div>
            <div style="text-align:right;min-width:120px;">
              <div style="color:${cor};font-weight:700;">${icone} ${a.status || ''}</div>
            </div>
          </div>

          ${enviosHtml}
        </div>
      `;
    });

    // estilos adicionais (apenas se quiser garantir aparência)
    container.innerHTML = html;
  } catch (error) {
    console.error("Erro ao carregar assinaturas:", error);
    container.innerHTML = "<p>Erro ao carregar suas assinaturas.</p>";
  }
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
async function carregarBibliotecaTecnica(usuarioId, email) {
  const container = document.getElementById("biblioteca-tecnica");

  try {
    // Busca assinaturas ativas do usuário
    const assinaturasSnap = await db.collection("usuarios")
      .doc(usuarioId)
      .collection("assinaturas")
      .get();

    const tipos = [];
    assinaturasSnap.forEach(doc => {
      const assinatura = doc.data();
      if (assinatura.tipo_newsletter && assinatura.status === "ativo") {
        tipos.push(assinatura.tipo_newsletter);
      }
    });

    const tiposValidos = tipos.filter(t => t);

    // Se não houver assinaturas, ainda assim vamos mostrar as básicas
    if (tiposValidos.length === 0) {
      container.innerHTML = "<p>Você não possui newsletters premium no momento, mas pode acessar as básicas abaixo.</p>";
    }

    // Busca newsletters da assinatura (somente Premium)
    let premiumNews = [];
    if (tiposValidos.length > 0) {
      const premiumSnap = await db.collection("newsletters")
        .where("tipo", "in", tiposValidos)
        .where("classificacao", "==", "Premium") // 🔑 garante que só premium entram
        .orderBy("edicao", "desc")
        .get();

      premiumNews = premiumSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    // Busca newsletters básicas
    const basicasSnap = await db.collection("newsletters")
      .where("classificacao", "==", "Básica")
      .orderBy("data_publicacao", "desc")
      .get();

    const basicasNews = basicasSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Monta HTML
    container.innerHTML = "";

    if (premiumNews.length) {
      container.innerHTML += `<div class="bloco"><h2>📚 Minhas Newsletters Premium</h2><div class="lista-newsletters">${premiumNews.map(criarCardNewsletter).join("")}</div></div>`;
    }

    if (basicasNews.length) {
      container.innerHTML += `<div class="bloco"><h2>📖 Newsletters Básicas</h2><div class="lista-newsletters">${basicasNews.map(criarCardNewsletter).join("")}</div></div>`;
    }

    if (!premiumNews.length && !basicasNews.length) {
      container.innerHTML = "<p>Nenhuma newsletter encontrada.</p>";
    }

  } catch (error) {
    console.error("Erro ao carregar biblioteca técnica:", error);
    container.innerHTML = "<p>Erro ao carregar biblioteca técnica.</p>";
  }
}

// Função para criar card com novo visual
// Função para criar card com novo visual (substituir a existente)
function criarCardNewsletter(n) {
  const dataFormatada = formatarData(n.data_publicacao);
  const imgSrc = n.imagem_url || n.imagem_capa || "https://via.placeholder.com/400x225?text=Newsletter";
  const resumo = n.resumo || "";

  return `
    <article class="newsletter-card" data-id="${n.id}">
      <!-- imagem com classe 'thumb' para o CSS aplicar restrições -->
      <img class="thumb" src="${imgSrc}" alt="Capa da newsletter ${(n.titulo || '')}" />
      <div class="conteudo">
        <h3 class="card-title">${n.titulo || "Newsletter"}</h3>
        ${dataFormatada ? `<p class="card-date"><strong>Publicado:</strong> ${dataFormatada}</p>` : ""}
        ${resumo ? `<p class="card-summary">${resumo}</p>` : ""}
        <div class="card-actions">
          <button onclick="abrirNewsletter('${n.id}')">Visualizar</button>
        </div>
      </div>
    </article>
  `;
}


// Formata data_publicacao
function formatarData(valor) {
  if (!valor) return "";
  if (typeof valor === "string") return valor;
  if (valor.seconds) {
    const dt = new Date(valor.seconds * 1000);
    return dt.toLocaleDateString("pt-BR");
  }
  return "";
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

  // Inclui o novo tipo
  const tipos = ["consultoria", "treinamento", "newsletters", "outros", "envio_manual_admin"];
  const colunas = {};
  tipos.forEach(tipo => { colunas[tipo] = []; });

  // ✅ Inicializa contadores
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
        let tipo = s.tipo?.toLowerCase() || "outros";
        const status = s.status?.toLowerCase() || "pendente";

        // ✅ Atualiza contadores
        if (contadores[status] !== undefined) contadores[status]++;

        if (filtroStatusSolicitacoes !== "todos" && status !== filtroStatusSolicitacoes) return;

        // Renderização diferenciada para envio manual admin
        if (tipo === "envio_manual_admin") {
          const mensagemCurta = (s.mensagem || s.resposta_html_enviada || "")
            .substring(0, 200); // mostra só os primeiros 200 caracteres

          const html = `
            <div class="item-solicitacao" style="border-left-color:#007acc;">
              <strong>📧 Mensagem enviada pela administração</strong><br>
              <div style="margin-top:6px; background:#f1f1f1; padding:8px; border-radius:4px; max-height:120px; overflow:hidden;" id="msg-${doc.id}">
                <strong>Assunto:</strong> ${s.assunto || "-"}<br>
                <strong>Mensagem:</strong><br>${mensagemCurta}...
              </div>
              <div style="margin-top:4px;">
                <button id="btn-expandir-${doc.id}" class="btn-expandir"
                  onclick="expandirMensagem('${doc.id}', '${encodeURIComponent(s.mensagem || s.resposta_html_enviada || "")}')">
                  Expandir
                </button>
              </div>
              <small>${formatarData(s.data_envio || s.data_solicitacao)} — Status: 
                <span style="color:#007acc; font-weight:bold;">${s.status || "enviada"}</span>
              </small>
            </div>
            `;
          colunas[tipo].push(html);
        }
        else {
          // Mantém a lógica atual para os outros tipos
          let cor = "#999", icone = "❔";
          if (status === "pendente") { cor = "#ffc107"; icone = "⏳"; }
          else if (status === "aberta") { cor = "#17a2b8"; icone = "📤"; }
          else if (status === "atendida") { cor = "#28a745"; icone = "✅"; }
          else if (status === "cancelada") { cor = "#dc3545"; icone = "❌"; }

          const respostaHtml = (status === "atendida" || status === "cancelada") && s.resposta
            ? `<div style="margin-top:6px; background:#f1f1f1; padding:8px; border-radius:4px;">
                <strong>💡 Resposta do atendimento:</strong><br>${s.resposta}
              </div>`
            : "";

          const html = `
            <div class="item-solicitacao" style="border-left-color:${cor};">
              <strong>${icone} ${tipo}</strong><br>
              ${s.descricao}<br>
              <small>${formatarData(s.data_solicitacao)} — Status: 
                <span style="color:${cor}; font-weight:bold;">${s.status}</span>
              </small><br>
              ${status === "aberta" ? `<button onclick="cancelarSolicitacao('${usuarioId}', '${doc.id}')">Cancelar</button>` : ""}
              ${status === "pendente" ? `<button onclick="editarSolicitacao('${usuarioId}', '${doc.id}', '${s.descricao.replace(/'/g, "\\'")}')">✏️ Editar</button>` : ""}
              ${respostaHtml}
            </div>
          `;
          colunas[tipo]?.push(html);
        }
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
        const titulo = tipo === "envio_manual_admin" ? "Envios da Administração" : tipo.charAt(0).toUpperCase() + tipo.slice(1);
        container.innerHTML += `
          <div class="coluna-solicitacoes">
            <h4>${titulo}</h4>
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

function expandirMensagem(id, mensagemCompleta) {
  const div = document.getElementById("msg-" + id);
  const btn = document.getElementById("btn-expandir-" + id);

  if (div.dataset.expandido === "true") {
    // volta para versão curta
    div.innerHTML = div.dataset.curta;
    div.style.maxHeight = "120px";
    btn.textContent = "Expandir";
    div.dataset.expandido = "false";
  } else {
    // mostra versão completa
    const texto = decodeURIComponent(mensagemCompleta);
    div.dataset.curta = div.innerHTML; // guarda versão curta
    div.innerHTML = `<strong>Mensagem completa:</strong><br>${texto}`;
    div.style.maxHeight = "none";
    btn.textContent = "Recolher";
    div.dataset.expandido = "true";
  }
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
  window.open(`verNewsletterUsuario.html?nid=${newsletterId}`, "_blank");
}

