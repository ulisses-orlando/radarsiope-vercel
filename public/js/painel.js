// ─── Estado global ────────────────────────────────────────────────────────────
let filtroStatusSolicitacoes = 'todos';
let solicitacaoEmEdicao = { usuarioId: null, solicitacaoId: null };
 
// ─── Inicialização ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const usuario = JSON.parse(localStorage.getItem('usuarioLogado'));
  if (!usuario) { window.location.href = 'login.html'; return; }
 
  const uid = usuario.id;
 
  carregarAssinaturas(uid);
  carregarBibliotecaNewsletters(uid);
  carregarHistoricoSolicitacoes(uid);
 
  const nomeEl = document.getElementById('nome-usuario');
  if (nomeEl) {
    nomeEl.textContent = (usuario.nome || usuario.email || 'Usuário') +
      (usuario.tipo_perfil ? ` (${usuario.tipo_perfil})` : '');
  }
});
 
// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtData(valor) {
  if (!valor) return '—';
  const d = typeof valor?.toDate === 'function' ? valor.toDate() : new Date(valor);
  if (isNaN(d)) return String(valor);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}
 
function fmtBRL(centavos) {
  if (!centavos && centavos !== 0) return '—';
  return (Number(centavos) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
 
function fmtStatus(status) {
  const mapa = {
    ativa: { cor: '#22c55e', icone: '✅', label: 'Ativa' },
    ativo: { cor: '#22c55e', icone: '✅', label: 'Ativa' },
    pendente_pagamento: { cor: '#f59e0b', icone: '⏳', label: 'Aguardando pagamento' },
    pendente: { cor: '#f59e0b', icone: '⏳', label: 'Pendente' },
    cancelada: { cor: '#ef4444', icone: '❌', label: 'Cancelada' },
    cancelado: { cor: '#ef4444', icone: '❌', label: 'Cancelada' },
    pago: { cor: '#22c55e', icone: '💰', label: 'Pago' },
    aprovado: { cor: '#22c55e', icone: '💰', label: 'Aprovado' },
    falhou: { cor: '#ef4444', icone: '❌', label: 'Falhou' },
    aberta: { cor: '#3b82f6', icone: '📤', label: 'Aberta' },
    atendida: { cor: '#22c55e', icone: '✅', label: 'Atendida' },
  };
  return mapa[String(status).toLowerCase()] || { cor: '#94a3b8', icone: '❔', label: status || '—' };
}
 
// Monta URL base64 para o web app (mesma lógica do EnvioLeads)
function montarUrlWebApp(nid, envioId, uid, assinaturaId, token) {
  const qs = [
    `nid=${nid || ''}`,
    `env=${envioId || ''}`,
    `uid=${uid || ''}`,
    assinaturaId ? `assinaturaId=${assinaturaId}` : '',
    token ? `token=${token}` : '',
  ].filter(Boolean).join('&');
  const b64 = btoa(qs);
  return `https://app.radarsiope.com.br/verNewsletterComToken.html?d=${encodeURIComponent(b64)}`;
}
 
// ─── Minhas Assinaturas ───────────────────────────────────────────────────────
// ─── Minhas Assinaturas ───────────────────────────────────────────────────────
async function carregarAssinaturas(uid) {
  const container = document.getElementById('minhas-assinaturas');
  if (!container) return;
  container.innerHTML = '<div class="loading">Carregando...</div>';
  try {
    // 1. Carregar features dinâmicas do gerenciador (se disponível)
    let featuresList = [];
    if (window.FeaturesManager && typeof window.FeaturesManager.carregarFeatures === 'function') {
      try { featuresList = await window.FeaturesManager.carregarFeatures(); }
      catch (e) { console.warn('[painel] Erro ao carregar features:', e); }
    }

    const assinSnap = await db.collection('usuarios').doc(uid)
      .collection('assinaturas').orderBy('createdAt', 'desc').get();
    
    if (assinSnap.empty) {
      container.innerHTML = `
         <div class="empty-state">
           <div style="font-size:32px">📄</div>
           <p>Você não possui assinaturas registradas.</p>
           <a href="/assinatura.html" class="btn-primary" style="display:inline-block;margin-top:8px;text-decoration:none">
            Ver planos →
           </a>
         </div>`;
      return;
    }

    let html = '';
    for (const doc of assinSnap.docs) {
      const a = doc.data();
      const assinaturaId = doc.id;
      const st = fmtStatus(a.status);
      // CORREÇÃO: typo original "a.f eatures_snapshot" -> "a.features_snapshot"
      const features = a.features_snapshot || {};

      // 2. Renderização dinâmica das badges de features (substitui o objeto estático)
      const featuresHtml = featuresList
        .filter(f => f.ativo && features[f.id])
        .map(f => {
          let label = `${f.icone} ${f.nome}`;
          const val = features[f.id];
          // Exibe valor se for numérico ou texto
          if (f.tipo === 'number' && val > 0) label += ` (${val}${f.unidade || ''})`;
          else if (f.tipo === 'text' && val) label += ` (${val})`;
          return `<span class="feature-badge">${label}</span>`;
        }).join('');

      // Buscar pagamentos desta assinatura
      let pagamentosHtml = '';
      try {
        const pagSnap = await db.collection('usuarios').doc(uid)
          .collection('assinaturas').doc(assinaturaId)
          .collection('pagamentos')
          .orderBy('data_pagamento', 'desc')
          .limit(12).get();

        if (!pagSnap.empty) {
          // CORREÇÃO: typo original "pag Snap.docs.map" -> "pagSnap.docs.map"
          const linhas = pagSnap.docs.map(pd => {
            const p = pd.data();
            const pst = fmtStatus(p.status);
            const parcela = p.numero_parcela
              ? `Parcela ${p.numero_parcela}${p.mpInstallments > 1 ? `/${p.mpInstallments}` : ''}` : 'Pagamento';
            const metodo = p.mpPaymentMethod || p.metodo_pagamento || '—';
            return `
               <div class="pagamento-row">
                 <div>
                   <span style="font-weight:700;font-size:12px">${parcela}</span>
                   <span style="font-size:11px;color:var(--muted);margin-left:6px">${metodo}</span>
                 </div>
                 <div style="display:flex;align-items:center;gap:10px">
                   <span style="font-size:12px">${fmtData(p.data_pagamento)}</span>
                   <span style="font-size:11px;font-weight:700;color:${pst.cor}">${pst.icone} ${pst.label}</span>
                   <span style="font-size:13px;font-weight:700">${fmtBRL(p.valor_centavos)}</span>
                 </div>
               </div>`;
          }).join('');

          pagamentosHtml = `
             <div class="pagamentos-lista">
               <div class="pagamentos-titulo">💳 Pagamentos</div>
              ${linhas}
             </div>`;
        }
      } catch (e) { /* pagamentos não críticos */ }

      html += `
         <div class="assinatura-card" style="--st-cor:${st.cor}">
           <div class="assinatura-header">
             <div>
               <div class="assinatura-plano">${a.plano_nome || a.plano_slug || 'Plano'}</div>
               <div class="assinatura-ciclo">${a.ciclo === 'anual' ? '🗓️ Anual' : '🗓️ Mensal'} · ${fmtBRL(a.valor_final * 100 || a.amountCentavos)}</div>
             </div>
             <div class="assinatura-status" style="color:${st.cor}">
              ${st.icone} ${st.label}
             </div>
           </div>

           <div class="assinatura-datas">
             <span>📅 Início:  <strong>${fmtData(a.data_inicio)}</strong></span>
             <span>🔄 Renovação:  <strong>${fmtData(a.data_proxima_renovacao)}</strong></span>
           </div>

          ${featuresHtml ? `<div class="features-lista">${featuresHtml}</div>` : ''}

          ${pagamentosHtml}

          ${a.status !== 'ativa' && a.status !== 'ativo' ? `
             <div style="margin-top:10px">
               <a href="/assinatura.html" class="btn-primary" style="display:inline-block;text-decoration:none;font-size:12px">
                🔄 Renovar assinatura →
               </a>
             </div>` : ''}
         </div>`;
    }
    container.innerHTML = html;
  } catch (err) {
    console.error('[assinaturas]', err);
    container.innerHTML = '<div class="error">Erro ao carregar assinaturas.</div>';
  }
}
 
// ─── Biblioteca de Newsletters ────────────────────────────────────────────────
async function carregarBibliotecaNewsletters(uid) {
  const container = document.getElementById('biblioteca-tecnica');
  if (!container) return;
  container.innerHTML = '<p class="loading">Carregando newsletters...</p>';
 
  try {
    // Buscar todas as assinaturas do usuário
    const assinSnap = await db.collection('usuarios').doc(uid)
      .collection('assinaturas')
      .where('status', 'in', ['ativa', 'ativo'])
      .get();
 
    if (assinSnap.empty) {
      container.innerHTML = `
        <div class="empty-state">
          <div style="font-size:32px">📚</div>
          <p>Nenhuma assinatura ativa encontrada.</p>
        </div>`;
      return;
    }
 
    // Buscar envios e tipos_selecionados de todas as assinaturas em paralelo
    const enviosPromises = assinSnap.docs.map(async doc => {
      const assinData = doc.data();
      const tiposSelecionados = Array.isArray(assinData.tipos_selecionados)
        ? assinData.tipos_selecionados.map(String)
        : [];
 
      const snap = await db.collection('usuarios').doc(uid)
        .collection('assinaturas').doc(doc.id)
        .collection('envios')
        .orderBy('data_envio', 'desc')
        .limit(100)
        .get();
 
      return snap.docs.map(d => ({
        ...d.data(),
        envioId:          d.id,
        assinaturaId:     doc.id,
        tiposSelecionados, // carrega junto para filtrar depois
      }));
    });
 
    const enviosArrays = await Promise.all(enviosPromises);
    const todosEnviosRaw = enviosArrays.flat();
 
    if (!todosEnviosRaw.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div style="font-size:32px">📭</div>
          <p>Nenhuma newsletter recebida ainda.</p>
        </div>`;
      return;
    }
 
    // Buscar dados das newsletters em paralelo (deduplica por newsletter_id)
    const nidsSet = [...new Set(todosEnviosRaw.map(e => e.newsletter_id).filter(Boolean))];
    const nlsMap = {};
    await Promise.all(nidsSet.map(async nid => {
      try {
        const snap = await db.collection('newsletters').doc(nid).get();
        if (snap.exists) nlsMap[nid] = { id: snap.id, ...snap.data() };
      } catch (e) { /* não crítico */ }
    }));
 
    // Deduplicar por newsletter_id (mantém o envio mais recente de cada edição)
    // e filtrar apenas newsletters cujo tipo está em tipos_selecionados da assinatura
    const vistos = new Set();
    const todosEnvios = todosEnviosRaw.filter(envio => {
      const nid  = envio.newsletter_id;
      if (!nid || vistos.has(nid)) return false;
      vistos.add(nid);
 
      // Filtra por tipo: só mostra se o tipo da newsletter está nos tipos selecionados
      const nl   = nlsMap[nid];
      const tipo = nl?.tipo || nl?.Tipo;
      const tiposSel = envio.tiposSelecionados || [];
 
      // Se a assinatura não tem tipos selecionados, mostra tudo
      if (tiposSel.length === 0) return true;
      // Se a newsletter não tem tipo, mostra (não bloqueia)
      if (!tipo) return true;
      // Verifica se o tipo está nos selecionados
      return tiposSel.includes(String(tipo));
    });
 
    // Ordenar por data_envio desc e montar cards
    todosEnvios.sort((a, b) => {
      const da = a.data_envio?.toDate ? a.data_envio.toDate() : new Date(a.data_envio || 0);
      const db_ = b.data_envio?.toDate ? b.data_envio.toDate() : new Date(b.data_envio || 0);
      return db_ - da;
    });
 
    const cards = todosEnvios.map(envio => {
      const nl = nlsMap[envio.newsletter_id] || {};
      const titulo = nl.titulo || `Edição ${nl.numero || '—'}`;
      const numero = nl.numero || '—';
      const dataEnvio = fmtData(envio.data_envio);
      const expirado = envio.expira_em && new Date() > new Date(
        envio.expira_em?.toDate ? envio.expira_em.toDate() : envio.expira_em
      );
      // Se rodando dentro do iframe do app → usa postMessage para navegar sem abrir nova aba
      const _noIframe = window.parent !== window;
      const _nid = envio.newsletter_id;
      const _bypassExp = !!expirado;
      const url = montarUrlWebApp(
        _nid,
        envio.envioId,
        uid,
        envio.assinaturaId,
        envio.token_acesso,
        _bypassExp
      );
      const _btnAcao = _noIframe
        ? `<button class="btn-ver-nl ${_bypassExp ? 'btn-ver-nl-exp' : ''}"
             onclick="window.parent.postMessage({tipo:'rs:abrirEdicao',newsletterId:'${_nid}',bypassExp:${_bypassExp}}, '*')">
             ${_bypassExp ? '⏰ Ver edição expirada →' : 'Ler edição →'}
           </button>`
        : `<a href="${url}" class="btn-ver-nl ${_bypassExp ? 'btn-ver-nl-exp' : ''}" target="_blank">
             ${_bypassExp ? '⏰ Ver edição expirada →' : 'Ler edição →'}
           </a>`;
 
      return `
        <article class="nl-card ${expirado ? 'nl-card-expirado' : ''}">
          <div class="nl-card-header">
            <div>
              <div class="nl-card-edicao">Edição ${numero}</div>
              <div class="nl-card-titulo">${titulo}</div>
              <div class="nl-card-data">📅 ${dataEnvio}</div>
            </div>
          </div>
          <div class="nl-card-footer">
            ${expirado && !_noIframe
              ? `<span class="nl-badge-expirado">⏰ Acesso expirado</span>${_btnAcao}`
              : _btnAcao}
          </div>
        </article>`;
    }).join('');
 
    container.innerHTML = `
      <div class="nl-grid">${cards}</div>`;
 
  } catch (err) {
    console.error('[biblioteca]', err);
    container.innerHTML = '<p class="erro">Erro ao carregar newsletters.</p>';
  }
}
 
// ─── Suporte ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const btnSuporte = document.getElementById('btn-enviar-suporte');
  if (btnSuporte) {
    btnSuporte.addEventListener('click', enviarSolicitacao);
  }
});
 
function enviarSolicitacao() {
  const usuario = JSON.parse(localStorage.getItem('usuarioLogado'));
  const tipo = document.getElementById('tipo-suporte').value;
  const descricao = document.getElementById('mensagem-suporte').value.trim();
  const feedback = document.getElementById('suporte-feedback');
 
  feedback.innerHTML = '';
  if (!descricao) {
    feedback.innerHTML = `<span style="color:#ef4444">❌ Descreva sua solicitação.</span>`;
    return;
  }
 
  db.collection('usuarios').doc(usuario.id).collection('solicitacoes').add({
    tipo,
    descricao,
    status: 'aberta',
    data_solicitacao: new Date().toISOString(),
  }).then(() => {
    feedback.innerHTML = `<span style="color:#22c55e">✅ Solicitação enviada com sucesso!</span>`;
    document.getElementById('mensagem-suporte').value = '';
    carregarHistoricoSolicitacoes(usuario.id);
  }).catch(err => {
    console.error('[suporte]', err);
    feedback.innerHTML = `<span style="color:#ef4444">❌ Erro ao enviar. Tente novamente.</span>`;
  });
 
  db.collection('admin_contadores').doc('pendencias').set(
    { solicitacoes: firebase.firestore.FieldValue.increment(1) },
    { merge: true }
  );
}
 
// ─── Histórico de Solicitações ────────────────────────────────────────────────
function filtrarSolicitacoes(status) {
  filtroStatusSolicitacoes = status;
  // Atualiza botão ativo
  document.querySelectorAll('#filtros-solicitacoes button').forEach(btn => {
    btn.classList.toggle('ativo', btn.dataset.filter === status);
  });
  const usuario = JSON.parse(localStorage.getItem('usuarioLogado'));
  carregarHistoricoSolicitacoes(usuario.id);
}
 
function carregarHistoricoSolicitacoes(uid) {
  const container = document.getElementById('historico-solicitacoes');
  if (!container) return;
  container.innerHTML = '<p class="loading">Carregando...</p>';
 
  const contadores = { aberta: 0, pendente: 0, atendida: 0, cancelada: 0 };
 
  db.collection('usuarios').doc(uid).collection('solicitacoes')
    .orderBy('data_solicitacao', 'desc')
    .get()
    .then(snap => {
      if (snap.empty) {
        container.innerHTML = '<p style="color:var(--muted);font-size:13px">Nenhuma solicitação registrada.</p>';
        return;
      }
 
      let html = '';
 
      snap.forEach(doc => {
        const s = doc.data();
        const status = (s.status || 'pendente').toLowerCase();
        contadores[status] = (contadores[status] || 0) + 1;
 
        if (filtroStatusSolicitacoes !== 'todos' && status !== filtroStatusSolicitacoes) return;
 
        const st = fmtStatus(status);
 
        // Mensagem administrativa
        if (s.tipo === 'envio_manual_admin') {
          html += `
            <div class="solicitacao-item" style="--st-cor:#3b82f6">
              <div class="solicitacao-tipo">📧 Mensagem da equipe Radar SIOPE</div>
              <div class="solicitacao-desc">
                ${s.assunto ? `<strong>${s.assunto}</strong><br>` : ''}
                <div class="msg-truncada" id="msg-${doc.id}">
                  ${(s.mensagem || s.resposta_html_enviada || '').substring(0, 200)}...
                </div>
                <button class="btn-expandir" id="btn-exp-${doc.id}"
                  onclick="expandirMensagem('${doc.id}', '${encodeURIComponent(s.mensagem || s.resposta_html_enviada || '')}')">
                  Ver mensagem completa
                </button>
              </div>
              <div class="solicitacao-meta">${fmtData(s.data_envio || s.data_solicitacao)}</div>
            </div>`;
          return;
        }
 
        const respostaHtml = s.resposta && (status === 'atendida' || status === 'cancelada')
          ? `<div class="solicitacao-resposta">
               💡 <strong>Resposta:</strong> ${s.resposta}
             </div>` : '';
 
        html += `
          <div class="solicitacao-item" style="--st-cor:${st.cor}">
            <div class="solicitacao-header">
              <span class="solicitacao-tipo">${s.tipo || 'Outros'}</span>
              <span class="solicitacao-status" style="color:${st.cor}">${st.icone} ${st.label}</span>
            </div>
            <div class="solicitacao-desc">${s.descricao || ''}</div>
            ${respostaHtml}
            <div class="solicitacao-footer">
              <span class="solicitacao-meta">${fmtData(s.data_solicitacao)}</span>
              <div style="display:flex;gap:6px">
                ${status === 'pendente'
            ? `<button class="btn-sm" onclick="editarSolicitacao('${uid}','${doc.id}','${(s.descricao || '').replace(/'/g, "\\'")}')">✏️ Editar</button>` : ''}
                ${status === 'aberta' || status === 'pendente'
            ? `<button class="btn-sm btn-sm-danger" onclick="cancelarSolicitacao('${uid}','${doc.id}')">Cancelar</button>` : ''}
              </div>
            </div>
          </div>`;
      });
 
      // Atualiza contadores nos filtros
      document.querySelectorAll('#filtros-solicitacoes button').forEach(btn => {
        const f = btn.dataset.filter;
        if (f === 'todos') { btn.textContent = 'Todos'; return; }
        const c = contadores[f] || 0;
        btn.textContent = `${f.charAt(0).toUpperCase() + f.slice(1)}${c ? ` (${c})` : ''}`;
      });
 
      container.innerHTML = html || '<p style="color:var(--muted);font-size:13px">Nenhuma solicitação neste filtro.</p>';
    })
    .catch(err => {
      console.error('[solicitacoes]', err);
      container.innerHTML = '<p class="erro">Erro ao carregar histórico.</p>';
    });
}
 
// ─── Editar / Cancelar Solicitação ────────────────────────────────────────────
function editarSolicitacao(uid, solicitacaoId, descricaoAtual) {
  solicitacaoEmEdicao = { usuarioId: uid, solicitacaoId };
  document.getElementById('nova-descricao').value = descricaoAtual;
  document.getElementById('modal-editar-solicitacao').classList.add('show');
}
 
function salvarEdicaoSolicitacao() {
  const novaDescricao = document.getElementById('nova-descricao').value.trim();
  if (!novaDescricao) { mostrarMensagem('A descrição não pode estar vazia.'); return; }
 
  db.collection('usuarios')
    .doc(solicitacaoEmEdicao.usuarioId)
    .collection('solicitacoes')
    .doc(solicitacaoEmEdicao.solicitacaoId)
    .update({ descricao: novaDescricao })
    .then(() => {
      fecharModalEdicao();
      carregarHistoricoSolicitacoes(solicitacaoEmEdicao.usuarioId);
    })
    .catch(err => { console.error(err); mostrarMensagem('Erro ao atualizar.'); });
}
 
function fecharModalEdicao() {
  document.getElementById('modal-editar-solicitacao').classList.remove('show');
}
 
function cancelarSolicitacao(uid, solicitacaoId) {
  if (!confirm('Deseja realmente cancelar esta solicitação?')) return;
  db.collection('usuarios').doc(uid).collection('solicitacoes').doc(solicitacaoId)
    .update({ status: 'cancelada' })
    .then(() => carregarHistoricoSolicitacoes(uid))
    .catch(err => { console.error(err); mostrarMensagem('Erro ao cancelar.'); });
 
  db.collection('admin_contadores').doc('pendencias').set(
    { solicitacoes: firebase.firestore.FieldValue.increment(-1) },
    { merge: true }
  );
 
}
 
// ─── Expandir mensagem admin ──────────────────────────────────────────────────
function expandirMensagem(id, mensagemEncoded) {
  const div = document.getElementById('msg-' + id);
  const btn = document.getElementById('btn-exp-' + id);
  if (!div || !btn) return;
 
  if (div.dataset.expandido === 'true') {
    div.innerHTML = div.dataset.curta;
    div.dataset.expandido = 'false';
    btn.textContent = 'Ver mensagem completa';
  } else {
    div.dataset.curta = div.innerHTML;
    div.innerHTML = decodeURIComponent(mensagemEncoded);
    div.dataset.expandido = 'true';
    btn.textContent = 'Recolher';
  }
}
 