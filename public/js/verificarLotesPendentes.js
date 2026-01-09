// verificarLotesPendentes.js
(function () {
  const linkAbrir = document.getElementById('link-verificar-lotes');
  const modal = document.getElementById('modal-verificar-lotes');
  const btnFechar = document.getElementById('btn-fechar-modal');
  const btnFecharX = document.getElementById('fechar-modal-verificar');
  const btnExecutar = document.getElementById('btn-executar-verificacao');
  const statusEl = document.getElementById('verificar-status');
  const listaEl = document.getElementById('verificar-lista');

  function abrirModalVerificarLotes(e) {
    if (e) e.preventDefault();
    modal.style.display = 'flex';
    try {
      const usuario = JSON.parse(localStorage.getItem('usuarioLogado') || 'null');
      if (usuario && usuario.token) {
        const t = document.getElementById('verificar-token');
        if (t) t.value = usuario.token;
      }
    } catch {}
  }

  function fecharModal() {
    modal.style.display = 'none';
    statusEl.innerHTML = '';
    listaEl.innerHTML = '';
  }

  function criarCardLote(item) {
    const card = document.createElement('div');
    card.className = 'lote-card';

    const meta = document.createElement('div');
    meta.className = 'lote-meta';
    const titulo = document.createElement('div');
    titulo.innerHTML = `<strong>${item.lotePath}</strong>`;
    const info = document.createElement('div');
    info.className = 'small-muted';
    info.innerHTML = `status: <em>${item.loteStatus || '—'}</em> — total envios: ${item.totalEnvios}`;
    meta.appendChild(titulo);
    meta.appendChild(info);

    const amostra = document.createElement('pre');
    amostra.textContent = JSON.stringify(item.amostraEnvios || [], null, 2);
    amostra.style.display = 'none';

    const actions = document.createElement('div');
    actions.className = 'lote-actions';

    const btnProcessar = document.createElement('button');
    btnProcessar.textContent = 'Processar';
    btnProcessar.className = 'btn-primary';
    btnProcessar.style.padding = '6px 10px';

    const btnDetalhes = document.createElement('button');
    btnDetalhes.textContent = 'Detalhes';
    btnDetalhes.className = 'btn-secondary';
    btnDetalhes.style.padding = '6px 10px';

    const resultadoLine = document.createElement('div');
    resultadoLine.className = 'small-muted';
    resultadoLine.style.marginTop = '6px';

    btnDetalhes.onclick = () => {
      amostra.style.display = amostra.style.display === 'none' ? 'block' : 'none';
    };

    btnProcessar.onclick = async () => {
      // confirmação simples
      if (!confirm(`Processar lote?\n${item.lotePath}\nTotal envios: ${item.totalEnvios}`)) return;
      await processarLote(item, btnProcessar, resultadoLine);
    };

    actions.appendChild(btnProcessar);
    actions.appendChild(btnDetalhes);

    card.appendChild(meta);
    card.appendChild(actions);
    card.appendChild(resultadoLine);
    card.appendChild(amostra);

    return card;
  }

  async function executarVerificacao() {
    const hours = Number(document.getElementById('verificar-hours').value || 24);
    const limit = Number(document.getElementById('verificar-limit').value || 50);
    const token = (document.getElementById('verificar-token').value || '').trim();

    statusEl.textContent = 'Executando verificação...';
    listaEl.innerHTML = '';
    btnExecutar.disabled = true;

    try {
      const url = `/api/verificarLotesPendentes?hours=${encodeURIComponent(hours)}&limit=${encodeURIComponent(limit)}`;
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['x-admin-token'] = token;

      const resp = await fetch(url, { method: 'GET', headers, credentials: 'same-origin' });
      if (!resp.ok) {
        const txt = await resp.text();
        statusEl.innerHTML = `<strong style="color:crimson">Erro ${resp.status}:</strong> ${txt}`;
        return;
      }

      const data = await resp.json();
      if (!data.ok) {
        statusEl.innerHTML = `<strong style="color:crimson">Erro:</strong> ${data.error || 'Resposta inválida'}`;
        return;
      }

      statusEl.innerHTML = `<strong>Verificados:</strong> ${data.verificados || 0}`;
      const detalhes = data.detalhes || [];
      if (!detalhes.length) {
        listaEl.innerHTML = '<div>Nenhum lote pendente encontrado dentro dos parâmetros.</div>';
        return;
      }

      for (const item of detalhes) {
        const card = criarCardLote(item);
        listaEl.appendChild(card);
      }
    } catch (err) {
      console.error('Erro executarVerificacao:', err);
      statusEl.innerHTML = `<strong style="color:crimson">Erro:</strong> ${err.message}`;
    } finally {
      btnExecutar.disabled = false;
    }
  }

  async function processarLote(item, botao, resultadoLine) {
    botao.disabled = true;
    resultadoLine.textContent = 'Processando...';
    const token = (document.getElementById('verificar-token').value || '').trim();

    try {
      const parts = item.lotePath.split('/');
      const newsletterId = parts[1];
      const envioId = parts[3];
      const loteId = parts[5];

      const payload = { action: 'processarLote', newsletterId, envioId, loteId };
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['x-admin-token'] = token;

      const resp = await fetch('/api/sendBatchViaSES', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const txt = await resp.text();
        resultadoLine.innerHTML = `<strong style="color:crimson">Erro ${resp.status}:</strong> ${txt}`;
        return;
      }

      const data = await resp.json();
      if (!data.ok) {
        resultadoLine.innerHTML = `<strong style="color:crimson">Erro:</strong> ${data.error || 'Resposta inválida'}`;
        return;
      }

      // resumo do processamento
      const okCount = (data.results || []).filter(r => r.ok).length;
      const errCount = (data.results || []).filter(r => !r.ok).length;
      resultadoLine.innerHTML = `Processado: ${okCount} sucesso(s), ${errCount} erro(s).`;

      // opcional: atualizar visual do lote (re-executar verificação)
      await executarVerificacao();
    } catch (err) {
      console.error('Erro processarLote:', err);
      resultadoLine.innerHTML = `<strong style="color:crimson">Erro:</strong> ${err.message}`;
    } finally {
      botao.disabled = false;
    }
  }

  if (linkAbrir) linkAbrir.addEventListener('click', abrirModalVerificarLotes);
  if (btnFechar) btnFechar.addEventListener('click', fecharModal);
  if (btnFecharX) btnFecharX.addEventListener('click', fecharModal);
  if (btnExecutar) btnExecutar.addEventListener('click', executarVerificacao);

  window.addEventListener('click', function (e) {
    if (e.target === modal) fecharModal();
  });

  // expõe funções para debug
  window.__verificarLotesPendentes = { abrirModalVerificarLotes, executarVerificacao };
})();
