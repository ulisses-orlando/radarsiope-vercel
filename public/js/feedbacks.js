// ─── feedbacks.js ─────────────────────────────────────────────────────────────
// Seção administrativa: feedbacks textuais de newsletters
// Estrutura: /newsletters/{nid}/feedbacks/{fbId}

// ─── Estado ───────────────────────────────────────────────────────────────────
let _fbFiltro       = 'pendentes'; // 'pendentes' | 'todos'
let _fbNewsletters  = {};          // cache nid → { titulo, edicao }
let _fbCursor       = null;        // último doc para paginação
let _fbCarregando   = false;

// ─── Entrypoint ───────────────────────────────────────────────────────────────
async function carregarSecaoFeedbacks() {
  const secao = document.getElementById('feedbacks');
  if (!secao) { console.error('[feedbacks] section#feedbacks não encontrada no DOM'); return; }

  secao.innerHTML = `
    <h2 style="margin:0 0 4px">💬 Feedbacks de Newsletters</h2>
    <p style="color:#64748b;font-size:13px;margin:0 0 16px">
      Feedbacks textuais enviados pelos assinantes ao ler as newsletters.
    </p>
    <!-- Toolbar -->
    <div style="display:flex;justify-content:space-between;align-items:center;
      flex-wrap:wrap;gap:10px;margin-bottom:16px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="fb-btn-pendentes" onclick="fbSetFiltro('pendentes')"
          class="fb-filtro-btn ativo">
          🟠 Não respondidos
        </button>
        <button id="fb-btn-todos" onclick="fbSetFiltro('todos')"
          class="fb-filtro-btn">
          📋 Todos
        </button>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="fbExportarCSV()"
          style="padding:7px 14px;background:#f1f5f9;border:1px solid #e2e8f0;
          border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
          📥 Exportar CSV
        </button>
        <button onclick="carregarSecaoFeedbacks()"
          style="padding:7px 14px;background:#f1f5f9;border:1px solid #e2e8f0;
          border-radius:8px;cursor:pointer;font-size:12px">
          🔄
        </button>
      </div>
    </div>

    <!-- Lista -->
    <div id="fb-lista"></div>
    <div id="fb-status" style="text-align:center;font-size:13px;color:#94a3b8;
      padding:12px">⏳ Carregando...</div>
    <div style="text-align:center;margin-top:8px">
      <button id="fb-btn-mais" onclick="fbCarregarMais()"
        style="display:none;padding:8px 20px;background:#fff;border:1px solid #e2e8f0;
        border-radius:8px;cursor:pointer;font-size:13px">
        Carregar mais
      </button>
    </div>`;

  // CSS inline (só injetado uma vez)
  if (!document.getElementById('fb-styles')) {
    const style = document.createElement('style');
    style.id = 'fb-styles';
    style.textContent = `
      .fb-filtro-btn {
        padding:7px 14px;background:#f1f5f9;border:1px solid #e2e8f0;
        border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;transition:.15s;
      }
      .fb-filtro-btn.ativo {
        background:#0284c7;color:#fff;border-color:#0284c7;
      }
      .fb-card {
        background:#fff;border:1px solid #e2e8f0;border-radius:10px;
        padding:14px 16px;margin-bottom:10px;transition:.15s;
        border-left:4px solid #e2e8f0;
      }
      .fb-card.pendente  { border-left-color:#f59e0b; }
      .fb-card.respondido { border-left-color:#22c55e; }
      .fb-nota-area {
        background:#fafafa;border:1px solid #e2e8f0;border-radius:6px;
        padding:8px 10px;margin-top:8px;font-size:12px;color:#475569;
      }
    `;
    document.head.appendChild(style);
  }

  _fbCursor   = null;
  await _fbCarregar(true);
}

function fbSetFiltro(filtro) {
  _fbFiltro = filtro;
  document.getElementById('fb-btn-pendentes')?.classList.toggle('ativo', filtro === 'pendentes');
  document.getElementById('fb-btn-todos')?.classList.toggle('ativo', filtro === 'todos');
  _fbCursor = null;
  _fbCarregar(true);
}

// ─── Carregar feedbacks ───────────────────────────────────────────────────────
async function _fbCarregar(reset = false) {
  if (_fbCarregando) return;
  _fbCarregando = true;

  const lista   = document.getElementById('fb-lista');
  const status  = document.getElementById('fb-status');
  const btnMais = document.getElementById('fb-btn-mais');
  if (reset && lista) lista.innerHTML = '';
  if (status) status.textContent = '⏳ Carregando...';

  try {
    // Busca todas as newsletters que têm feedbacks
    // (lê até 50 newsletters; em produção use índice ou paginação própria)
    const nlSnap = await db.collection('newsletters')
      .orderBy('data_publicacao', 'desc').limit(50).get();

    // Cache de newsletters
    nlSnap.forEach(doc => {
      const d = doc.data();
      _fbNewsletters[doc.id] = {
        titulo: d.titulo || '—',
        edicao: d.edicao || d.numero || '',
      };
    });

    // Coleta todos os feedbacks das newsletters
    let todos = [];
    await Promise.all(nlSnap.docs.map(async nlDoc => {
      try {
        // Busca sem filtro e filtra em memória (evita exigir índice composto no Firestore)
        const q = db.collection('newsletters').doc(nlDoc.id)
          .collection('feedbacks').orderBy('data', 'desc').limit(100);
        const fbSnap = await q.get();
        fbSnap.forEach(fbDoc => {
          const d = fbDoc.data();
          // Filtra pendentes em memória (sem índice composto)
          if (_fbFiltro === 'pendentes' && d.respondido === true) return;
          todos.push({ id: fbDoc.id, nid: nlDoc.id, nl: _fbNewsletters[nlDoc.id], ...d });
        });
      } catch(e) {
        console.warn('[feedbacks] newsletter', nlDoc.id, e.message);
      }
    }));

    // Ordena por data desc
    todos.sort((a, b) => {
      const da = a.data ? (a.data.toDate ? a.data.toDate() : new Date(a.data)) : new Date(0);
      const db_ = b.data ? (b.data.toDate ? b.data.toDate() : new Date(b.data)) : new Date(0);
      return db_ - da;
    });

    if (!todos.length) {
      if (status) status.textContent = _fbFiltro === 'pendentes'
        ? '✅ Nenhum feedback pendente. Tudo respondido!'
        : '📭 Nenhum feedback registrado ainda.';
      if (btnMais) btnMais.style.display = 'none';
      _fbCarregando = false;
      return;
    }

    if (status) status.textContent = `${todos.length} feedback(s) encontrado(s)`;
    if (btnMais) btnMais.style.display = 'none'; // paginação futura

    todos.forEach(fb => _fbRenderCard(fb));

    // Atualiza badge
    const pendentes = todos.filter(f => !f.respondido).length;
    _fbAtualizarBadge(pendentes);

  } catch(e) {
    if (status) status.textContent = `Erro: ${e.message}`;
    console.error('[feedbacks]', e);
  }
  _fbCarregando = false;
}

async function fbCarregarMais() {
  await _fbCarregar(false);
}

// ─── Renderizar card ──────────────────────────────────────────────────────────
function _fbRenderCard(fb) {
  const lista = document.getElementById('fb-lista');
  if (!lista) return;

  const respondido = fb.respondido === true;
  const data = fb.data
    ? (fb.data.toDate ? fb.data.toDate() : new Date(fb.data))
      .toLocaleString('pt-BR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : '—';

  const nlLabel = fb.nl
    ? `${fb.nl.titulo}${fb.nl.edicao ? ` (Ed. ${fb.nl.edicao})` : ''}`
    : fb.nid;

  const respostaHtml = fb.resposta_admin
    ? `<div style="background:#f0fdf4;border-left:3px solid #22c55e;border-radius:4px;
        padding:8px 10px;margin-top:8px;font-size:12px;color:#166534">
        💬 <strong>Resposta:</strong> ${fb.resposta_admin}
        <span style="font-size:11px;color:#94a3b8;margin-left:8px">${
          fb.data_resposta
            ? (fb.data_resposta.toDate ? fb.data_resposta.toDate() : new Date(fb.data_resposta))
                .toLocaleDateString('pt-BR')
            : ''
        }</span>
      </div>` : '';

  const notaHtml = fb.nota_interna
    ? `<div class="fb-nota-area">🔒 Nota interna: ${fb.nota_interna}</div>` : '';

  const acoesHtml = !respondido ? `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
      <button onclick="fbResponder('${fb.nid}','${fb.id}')"
        style="padding:5px 12px;background:#0284c7;color:#fff;border:none;
        border-radius:6px;cursor:pointer;font-size:12px;font-weight:700">
        📧 Responder por e-mail
      </button>
      <button onclick="fbMarcarTratado('${fb.nid}','${fb.id}')"
        style="padding:5px 12px;background:#22c55e;color:#fff;border:none;
        border-radius:6px;cursor:pointer;font-size:12px;font-weight:700">
        ✅ Marcar como tratado
      </button>
      <button onclick="fbAdicionarNota('${fb.nid}','${fb.id}')"
        style="padding:5px 12px;background:#f1f5f9;border:1px solid #e2e8f0;
        border-radius:6px;cursor:pointer;font-size:12px">
        🔒 Nota interna
      </button>
    </div>` : `
    <div style="margin-top:8px">
      <button onclick="fbAdicionarNota('${fb.nid}','${fb.id}')"
        style="padding:4px 10px;background:#f1f5f9;border:1px solid #e2e8f0;
        border-radius:6px;cursor:pointer;font-size:11px">
        🔒 Nota interna
      </button>
    </div>`;

  const card = document.createElement('div');
  card.id = `fb-card-${fb.id}`;
  card.className = `fb-card ${respondido ? 'respondido' : 'pendente'}`;
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;
      gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <div>
        <div style="font-size:11px;color:#0284c7;font-weight:700;margin-bottom:2px">
          📰 ${nlLabel}
        </div>
        <div style="font-size:11px;color:#94a3b8">
          ${fb.nome || fb.email || 'Anônimo'}
          ${fb.email ? `· ${fb.email}` : ''}
          ${fb.segmento ? `· ${fb.segmento}` : ''}
          ${fb.plano ? `· Plano: ${fb.plano}` : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <span style="background:${respondido ? '#22c55e20' : '#f59e0b20'};
          color:${respondido ? '#22c55e' : '#f59e0b'};border:1px solid ${respondido ? '#22c55e40' : '#f59e0b40'};
          border-radius:20px;padding:2px 9px;font-size:11px;font-weight:700">
          ${respondido ? '✅ Tratado' : '🟠 Pendente'}
        </span>
        <span style="font-size:11px;color:#94a3b8">${data}</span>
      </div>
    </div>
    <div style="font-size:13px;color:#334155;line-height:1.6;
      background:#f8fafc;border-radius:6px;padding:10px 12px">
      "${fb.texto || '—'}"
    </div>
    ${respostaHtml}
    ${notaHtml}
    ${acoesHtml}`;

  lista.appendChild(card);
}

// ─── Ações ────────────────────────────────────────────────────────────────────

async function fbMarcarTratado(nid, fbId) {
  try {
    await db.collection('newsletters').doc(nid)
      .collection('feedbacks').doc(fbId)
      .update({ respondido: true, data_resposta: new Date() });

    // ▼ decrementa contador central
    if (typeof _incrementarContador === 'function') {
      await _incrementarContador('feedbacks', -1);
    }

    // Atualiza card na UI sem reload completo
    const card = document.getElementById(`fb-card-${fbId}`);
    if (card) {
      card.classList.remove('pendente');
      card.classList.add('respondido');
      // Remove botões de ação
      card.querySelectorAll('button').forEach(b => {
        if (b.textContent.includes('Responder') || b.textContent.includes('Marcar')) b.remove();
      });
    }
    mostrarMensagem('✅ Feedback marcado como tratado.');
    atualizarBadgeUsuarios?.();
  } catch(e) { mostrarMensagem('Erro: ' + e.message); }
}

async function fbResponder(nid, fbId) {
  // Abre o modal de envio de e-mail existente, pré-configurado
  const fbDoc = await db.collection('newsletters').doc(nid)
    .collection('feedbacks').doc(fbId).get();
  if (!fbDoc.exists) return;
  const fb = fbDoc.data();

  // Usa o modal já existente de envio manual
  if (typeof abrirModalEnvioManual === 'function' && fb.usuario_id) {
    abrirModalEnvioManual(fb.usuario_id, null, { email: fb.email, nome: fb.nome });
  } else if (fb.email) {
    // Fallback: prompt simples
    const resposta = prompt(`Resposta para ${fb.email}:`);
    if (!resposta) return;
    try {
      await fetch('/api/enviarEmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: fb.nome || 'Leitor',
          email: fb.email,
          assunto: 'Resposta ao seu feedback',
          mensagemHtml: `<p>Olá ${fb.nome || ''},</p><p>${resposta}</p>`,
        }),
      });
      await db.collection('newsletters').doc(nid)
        .collection('feedbacks').doc(fbId)
        .update({
          respondido: true,
          resposta_admin: resposta,
          data_resposta: new Date(),
        });

      if (typeof _incrementarContador === 'function') {
        await _incrementarContador('feedbacks', -1);
      }

      mostrarMensagem('✅ E-mail enviado e feedback marcado como tratado.');
      const card = document.getElementById(`fb-card-${fbId}`);
      if (card) card.classList.replace('pendente', 'respondido');
      atualizarBadgeUsuarios?.();
    } catch(e) { mostrarMensagem('Erro: ' + e.message); }
  }
}

async function fbAdicionarNota(nid, fbId) {
  const nota = prompt('Nota interna (visível apenas para o admin):');
  if (nota === null || !nota.trim()) return;
  try {
    await db.collection('newsletters').doc(nid)
      .collection('feedbacks').doc(fbId)
      .update({ nota_interna: nota.trim() });
    mostrarMensagem('🔒 Nota salva.');
    // Atualiza visualmente
    const card = document.getElementById(`fb-card-${fbId}`);
    if (card) {
      let nota_el = card.querySelector('.fb-nota-area');
      if (nota_el) { nota_el.textContent = `🔒 Nota interna: ${nota.trim()}`; }
      else {
        const div = document.createElement('div');
        div.className = 'fb-nota-area';
        div.textContent = `🔒 Nota interna: ${nota.trim()}`;
        card.appendChild(div);
      }
    }
  } catch(e) { mostrarMensagem('Erro: ' + e.message); }
}

// ─── Exportar CSV ─────────────────────────────────────────────────────────────
async function fbExportarCSV() {
  try {
    const nlSnap = await db.collection('newsletters').limit(50).get();
    let rows = [['Newsletter', 'Edição', 'Nome', 'E-mail', 'Segmento', 'Plano', 'Texto', 'Data', 'Respondido', 'Resposta Admin']];

    await Promise.all(nlSnap.docs.map(async nlDoc => {
      const nl = nlDoc.data();
      const fbSnap = await db.collection('newsletters').doc(nlDoc.id)
        .collection('feedbacks').get();
      fbSnap.forEach(fbDoc => {
        const f = fbDoc.data();
        const data = f.data
          ? (f.data.toDate ? f.data.toDate() : new Date(f.data)).toLocaleDateString('pt-BR')
          : '';
        rows.push([
          nl.titulo || '',
          nl.edicao || nl.numero || '',
          f.nome || '',
          f.email || '',
          f.segmento || '',
          f.plano || '',
          `"${(f.texto || '').replace(/"/g, "'")}"`,
          data,
          f.respondido ? 'Sim' : 'Não',
          `"${(f.resposta_admin || '').replace(/"/g, "'")}"`,
        ]);
      });
    }));

    const csv  = rows.map(r => r.join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `feedbacks_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch(e) { mostrarMensagem('Erro ao exportar: ' + e.message); }
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function _fbAtualizarBadge(n) {
  const badge = document.getElementById('badge-feedbacks');
  if (!badge) return;
  badge.textContent   = n > 99 ? '99+' : n;
  badge.style.display = n > 0 ? 'inline' : 'none';
}

/**
 * Conta feedbacks pendentes e atualiza o badge — sem renderizar a seção.
 * Chamado na inicialização do admin junto com os outros badges.
 */
async function atualizarBadgeFeedbacks() {
  try {
    const nlSnap = await db.collection('newsletters')
      .where('enviada', '==', true).limit(50).get();

    let pendentes = 0;
    await Promise.all(nlSnap.docs.map(async nlDoc => {
      try {
        const fbSnap = await db.collection('newsletters').doc(nlDoc.id)
          .collection('feedbacks').where('respondido', '==', false).get();
        pendentes += fbSnap.size;
      } catch(e) { /* newsletter sem feedbacks */ }
    }));

    _fbAtualizarBadge(pendentes);
  } catch(e) {
    console.warn('[badge-feedbacks]', e.message);
  }
}

// ─── Exportações globais ─────────────────────────────────────────────────────
window.carregarSecaoFeedbacks  = carregarSecaoFeedbacks;
window.atualizarBadgeFeedbacks = atualizarBadgeFeedbacks;
window.fbSetFiltro            = fbSetFiltro;
window.fbCarregarMais         = fbCarregarMais;
window.fbMarcarTratado        = fbMarcarTratado;
window.fbResponder            = fbResponder;
window.fbAdicionarNota        = fbAdicionarNota;
window.fbExportarCSV          = fbExportarCSV;
