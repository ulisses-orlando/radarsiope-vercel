// Gera um id simples para blocos
function generateUUID() {
    return 'blk_' + Math.random().toString(36).substr(2, 9);
}

// Cria elemento com atributos e classes
function el(tag, attrs = {}, text = "") {
    const e = document.createElement(tag);
    Object.keys(attrs).forEach(k => {
        if (k === 'class') e.className = attrs[k];
        else if (k === 'html') e.innerHTML = attrs[k];
        else e.setAttribute(k, attrs[k]);
    });
    if (text) e.appendChild(document.createTextNode(text));
    return e;
}

// Ajuste final em adicionarBlocoNewsletter: garanta que dataset.html e dataset.acesso sejam definidos
// (Se já tiver colado a função, apenas acrescente estas linhas dentro do btnSalvar.onclick)
// dentro de btnSalvar.onclick:
// ...
btnSalvar.onclick = () => {
    card.dataset.titulo = tituloInput.value;
    card.dataset.acesso = selectAcesso.value;
    card.dataset.html = ta.value;
    card.dataset.id = b.id;
    mostrarMensagem('Bloco salvo localmente.');
};

// Sanitização segura com whitelist de tags/atributos úteis para e-mail
function sanitizeHtml(html) {
    if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(String(html || ''), {
            ALLOWED_TAGS: [
                'p', 'a', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li',
                'h1', 'h2', 'h3', 'h4', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
                'br', 'div', 'span'
            ],
            ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'style']
        });
    }
    // fallback mínimo: remove scripts apenas
    return String(html || '').replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
}

function markedToHtml(md) {
    if (typeof marked === 'undefined') return md;
    if (typeof marked.parse === 'function') return marked.parse(md);
    if (typeof marked === 'function') return marked(md);
    if (typeof marked.default === 'function') return marked.default(md);
    return md;
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function pareceHtml(text) {
    return /<\/?[a-z][\s\S]*>/i.test(String(text || '').trim());
}

function converterTextoParaHtml(text) {
    const raw = String(text || '');
    if (!raw.trim()) return '';

    if (pareceHtml(raw)) {
        return sanitizeHtml(raw);
    }

    const temMarkdown = /(^#{1,6}\s)|(^[-*]\s)|(\*\*.+\*\*)|(```)|(^\d+\.\s)/m.test(raw);
    if (temMarkdown) {
        const html = markedToHtml(raw);
        return sanitizeHtml(html);
    }

    const linhas = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
    const html = linhas.map(l => `<p>${escapeHtml(l)}</p>`).join('\n');
    return sanitizeHtml(html);
}

// Inicializa drag & drop no container apenas uma vez
function initBlocosDragAndDrop() {
  const container = document.getElementById('container-blocos-newsletter');
  if (!container) return;
  if (container.dataset.dragInit === '1') return; // já inicializado

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    const after = getDragAfterElement(container, e.clientY);
    const dragging = container.querySelector('.dragging');
    if (!dragging) return;
    if (after == null) container.appendChild(dragging);
    else container.insertBefore(dragging, after);
  });

  container.dataset.dragInit = '1';
}

function getDragAfterElement(containerEl, y) {
  const draggableElements = [...containerEl.querySelectorAll('.bloco-newsletter:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Função completa para adicionar bloco (substitua a sua por esta)
function adicionarBlocoNewsletter(bloco = {}, index = null) {
  const container = document.getElementById("container-blocos-newsletter");
  if (!container) return;

  const wrapper = document.createElement("div");
  wrapper.className = "bloco-newsletter bloco-card";
  wrapper.style.border = "1px solid #ccc";
  wrapper.style.padding = "8px";
  wrapper.style.marginBottom = "8px";
  wrapper.style.borderRadius = "4px";
  wrapper.style.background = "#fafafa";

  const id = bloco.id || 'blk_' + Math.random().toString(36).substr(2, 9);
  wrapper.dataset.id = id;

  // HEADER (toggle + título + select)
  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.gap = "8px";
  header.style.alignItems = "center";
  header.style.marginBottom = "6px";

  const btnToggle = document.createElement("button");
  btnToggle.type = "button";
  btnToggle.innerText = "▾";
  btnToggle.title = "Expandir / Colapsar";
  btnToggle.style.flex = "0 0 28px";

  const inputTitulo = document.createElement("input");
  inputTitulo.type = "text";
  inputTitulo.placeholder = "Título do bloco (opcional)";
  inputTitulo.style.flex = "1";
  inputTitulo.value = bloco.titulo || "";
  inputTitulo.dataset.blocoField = "titulo";

  const selectAcesso = document.createElement("select");
  selectAcesso.dataset.blocoField = "acesso";
  selectAcesso.style.flex = "0 0 160px";
  selectAcesso.innerHTML = `
    <option value="todos">Todos</option>
    <option value="leads">Somente leads</option>
    <option value="assinantes">Somente assinantes</option>
  `;
  selectAcesso.value = bloco.acesso || "todos";

  header.appendChild(btnToggle);
  header.appendChild(inputTitulo);
  header.appendChild(selectAcesso);

  // TEXTAREA
  const taBloco = document.createElement("textarea");
  taBloco.rows = 5;
  taBloco.style.width = "100%";
  taBloco.style.marginTop = "6px";
  taBloco.placeholder = "HTML do bloco...";
  taBloco.value = bloco.html || "";
  taBloco.dataset.blocoField = "html";

  // FOOTER com botões
  const footer = document.createElement("div");
  footer.style.display = "flex";
  footer.style.gap = "6px";
  footer.style.marginTop = "8px";
  footer.style.flexWrap = "wrap";

  const btnSalvar = document.createElement("button");
  btnSalvar.type = "button";
  btnSalvar.innerText = "Salvar";
  btnSalvar.style.padding = "6px 8px";

  const btnDuplicar = document.createElement("button");
  btnDuplicar.type = "button";
  btnDuplicar.innerText = "Duplicar";
  btnDuplicar.style.padding = "6px 8px";

  const btnUp = document.createElement("button");
  btnUp.type = "button";
  btnUp.innerText = "↑";
  btnUp.title = "Mover para cima";
  btnUp.style.padding = "6px 8px";

  const btnDown = document.createElement("button");
  btnDown.type = "button";
  btnDown.innerText = "↓";
  btnDown.title = "Mover para baixo";
  btnDown.style.padding = "6px 8px";

  const btnRemover = document.createElement("button");
  btnRemover.type = "button";
  btnRemover.innerText = "Remover";
  btnRemover.style.padding = "6px 8px";
  btnRemover.style.background = "#f2a0a0";

  footer.appendChild(btnSalvar);
  footer.appendChild(btnDuplicar);
  footer.appendChild(btnUp);
  footer.appendChild(btnDown);

  // Gerar HTML do bloco — adiciona com append (seguro)
  const btnGerarHtmlBloco = document.createElement('button');
  btnGerarHtmlBloco.type = 'button';
  btnGerarHtmlBloco.innerText = 'Gerar HTML';
  btnGerarHtmlBloco.style.padding = '6px 8px';
  btnGerarHtmlBloco.onclick = () => {
    taBloco.value = converterTextoParaHtml(taBloco.value);
    wrapper.dataset.html = taBloco.value;
    mostrarMensagem('HTML do bloco gerado e sanitizado.');
  };
  footer.appendChild(btnGerarHtmlBloco);

  // agora adiciona o botão Remover
  footer.appendChild(btnRemover);

  // monta wrapper
  wrapper.appendChild(header);
  wrapper.appendChild(taBloco);
  wrapper.appendChild(footer);

  // inserção segura no container
  if (typeof index === "number" && index >= 0) {
    const refNode = container.children[index] || null;
    if (refNode && refNode.parentNode === container) {
      container.insertBefore(wrapper, refNode);
    } else {
      container.appendChild(wrapper);
    }
  } else {
    container.appendChild(wrapper);
  }

  // dataset iniciais
  wrapper.dataset.titulo = inputTitulo.value || "";
  wrapper.dataset.acesso = selectAcesso.value || "todos";
  wrapper.dataset.html = taBloco.value || "";
  wrapper.dataset.ordem = (typeof bloco.ordem === "number") ? bloco.ordem : Array.from(container.children).indexOf(wrapper);

  // toggle colapsar/expandir (usa elementos já criados)
  btnToggle.onclick = () => {
    const collapsed = wrapper.dataset.collapsed === "true";
    wrapper.dataset.collapsed = (!collapsed).toString();
    if (!collapsed) {
      taBloco.style.display = "none";
      footer.style.display = "none";
      btnToggle.innerText = "▸";
    } else {
      taBloco.style.display = "";
      footer.style.display = "flex";
      btnToggle.innerText = "▾";
    }
  };
  // aplica estado inicial se vier no bloco
  if (bloco.collapsed) {
    wrapper.dataset.collapsed = 'true';
    taBloco.style.display = 'none';
    footer.style.display = 'none';
    btnToggle.innerText = '▸';
  } else {
    wrapper.dataset.collapsed = 'false';
    btnToggle.innerText = '▾';
  }

  // EVENTOS
  btnSalvar.onclick = () => {
    wrapper.dataset.titulo = inputTitulo.value || "";
    wrapper.dataset.acesso = selectAcesso.value || "todos";
    wrapper.dataset.html = taBloco.value || "";
    mostrarMensagem("Bloco salvo localmente.");
  };

  btnDuplicar.onclick = () => {
    const novo = {
      titulo: (inputTitulo.value || "") + " (cópia)",
      acesso: selectAcesso.value || "todos",
      html: taBloco.value || ""
    };
    const idxAtual = Array.from(container.children).indexOf(wrapper);
    adicionarBlocoNewsletter(novo, idxAtual + 1);
    setTimeout(() => {
      const prox = container.children[idxAtual + 1];
      if (prox) {
        const inputNovo = prox.querySelector('input[type="text"]');
        if (inputNovo) { inputNovo.focus(); inputNovo.select(); }
      }
    }, 50);
  };

  btnUp.onclick = () => {
    const prev = wrapper.previousElementSibling;
    if (prev) container.insertBefore(wrapper, prev);
  };

  btnDown.onclick = () => {
    const next = wrapper.nextElementSibling;
    if (next) container.insertBefore(next, wrapper);
  };

  btnRemover.onclick = () => {
    if (confirm("Remover este bloco?")) wrapper.remove();
  };

  // atualiza dataset ao perder foco
  inputTitulo.addEventListener("blur", () => { wrapper.dataset.titulo = inputTitulo.value || ""; });
  selectAcesso.addEventListener("change", () => { wrapper.dataset.acesso = selectAcesso.value || "todos"; });
  taBloco.addEventListener("blur", () => { wrapper.dataset.html = taBloco.value || ""; });

  // Drag & drop básico (marca o item; o listener de dragover é global via initBlocosDragAndDrop)
  wrapper.draggable = true;
  wrapper.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", wrapper.dataset.id);
    wrapper.classList.add("dragging");
  });
  wrapper.addEventListener("dragend", () => wrapper.classList.remove("dragging"));
}


// ------------------------------------------------------------

// Função que coleta todos os blocos do container e normaliza para salvar
function coletarBlocosNewsletter() {
    const container = document.getElementById('container-blocos-newsletter');
    if (!container) return [];

    const blocos = Array.from(container.children).map((card, idx) => {
        // tenta ler do dataset (preenchido ao salvar) ou dos inputs dentro do card
        const id = card.dataset.id || card.getAttribute('data-bloco-id') || generateUUID();
        const titulo = card.dataset.titulo ?? (card.querySelector('.bloco-titulo')?.value || '').toString().trim();
        const acesso = card.dataset.acesso ?? (card.querySelector('.bloco-acesso')?.value || 'todos');
        const html = card.dataset.html ?? (card.querySelector('.bloco-html')?.value || '');

        return {
            id,
            ordem: idx,
            titulo,
            acesso: ['todos', 'leads', 'assinantes'].includes(acesso) ? acesso : 'todos',
            html: html.toString()
        };
    });

    return blocos;
}

// Função utilitária para re-renderizar o container a partir de um array de blocos (opcional)
// Útil se quiser reconstruir a lista após carregar do banco
function renderizarBlocos(blocos = []) {
    const container = document.getElementById('container-blocos-newsletter');
    if (!container) return;
    container.innerHTML = '';
    blocos.forEach((b, idx) => adicionarBlocoNewsletter(b, idx));
}

// Função que coleta todos os blocos do container e normaliza para salvar
function coletarBlocosNewsletter() {
    const container = document.getElementById('container-blocos-newsletter');
    if (!container) return [];

    const blocos = Array.from(container.children).map((card, idx) => {
        // tenta ler do dataset (preenchido ao salvar) ou dos inputs dentro do card
        const id = card.dataset.id || card.getAttribute('data-bloco-id') || generateUUID();
        const titulo = card.dataset.titulo ?? (card.querySelector('.bloco-titulo')?.value || '').toString().trim();
        const acesso = card.dataset.acesso ?? (card.querySelector('.bloco-acesso')?.value || 'todos');
        const html = card.dataset.html ?? (card.querySelector('.bloco-html')?.value || '');

        return {
            id,
            ordem: idx,
            titulo,
            acesso: ['todos', 'leads', 'assinantes'].includes(acesso) ? acesso : 'todos',
            html: html.toString()
        };
    });

    return blocos;
}

// Extrai tokens do tipo {{token}} do HTML/texto
function extrairPlaceholders(text) {
    const re = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
    const found = new Set();
    let m;
    while ((m = re.exec(String(text || ''))) !== null) {
        found.add(m[1]);
    }
    return Array.from(found);
}

// Valida placeholders contra uma lista permitida (opcional)
// Se quiser permitir qualquer placeholder, retorne true diretamente
function validarPlaceholdersNoTemplate(html, listaPermitida = null) {
    const tokens = extrairPlaceholders(html);
    if (!listaPermitida) return true; // sem lista, aceita tudo (ou você pode definir defaults)
    const invalidos = tokens.filter(t => !listaPermitida.includes(t));
    if (invalidos.length > 0) {
        mostrarMensagem(`Placeholders inválidos: ${invalidos.join(', ')}`);
        console.warn('Placeholders inválidos encontrados:', invalidos);
        return false;
    }
    return true;
}


// Detecta se o texto parece HTML (tem tags) ou Markdown/texto puro
function pareceHtml(text) {
    return /<\/?[a-z][\s\S]*>/i.test(String(text || '').trim());
}

// Converte texto para HTML: se for HTML retorna sanitizado; se for Markdown converte; se for texto puro transforma em parágrafos
function converterTextoParaHtml(text) {
    const raw = String(text || '');
    if (!raw.trim()) return '';

    // já é HTML? apenas sanitiza e retorna
    if (pareceHtml(raw)) {
        return sanitizeHtml(raw);
    }

    // se contém sintaxe Markdown comum (ex: #, -, *, **, `) -> converte com marked
    const temMarkdown = /(^#{1,6}\s)|(^[-*]\s)|(\*\*.+\*\*)|(```)|(^\d+\.\s)/m.test(raw);
    if (temMarkdown && typeof marked !== 'undefined') {
        const html = marked.parse(raw);
        return sanitizeHtml(html);
    }

    // texto puro: converte quebras de linha em <p>
    const linhas = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
    const html = linhas.map(l => `<p>${escapeHtml(l)}</p>`).join('\n');
    return sanitizeHtml(html);
}

// escape simples para conteúdo de texto que vira HTML
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
