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
async function carregarAssinaturas(uid) {
  const container = document.getElementById('minhas-assinaturas');
  if (!container) return;
  container.innerHTML = '<p class="loading">Carregando...</p>';
 
  try {
    // 1. Buscar features ativas dinamicamente da coleção 'features'
    let featuresList = [];
    try {
      if (window.FeaturesManager && typeof window.FeaturesManager.carregarFeatures === 'function') {
        featuresList = await window.FeaturesManager.carregarFeatures();
      } else {
        // Fallback direto ao Firestore
        const snap = await db.collection('features')
          .where('ativo', '==', true)
          .orderBy('ordem', 'asc')
          .get();
        featuresList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }
    } catch (e) {
      console.warn('[painel] Erro ao carregar features dinâmicas:', e);
      // Em caso de erro, continua com lista vazia (não quebra a tela)
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
      const userFeatures = a.features_snapshot || {};
 
      // 2. Renderização dinâmica das badges (substitui o objeto estático featuresLabels)
      const featuresHtml = featuresList
        .filter(f => f.ativo && userFeatures[f.id]) // Mostra apenas se ativo E se o usuário tem
        .map(f => {
          let label = `${f.icone} ${f.nome}`;
          // Exibe valor se for numérico ou texto (ex: 20h/mês, Premium)
          const val = userFeatures[f.id];
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
            <span>📅 Início: <strong>${fmtData(a.data_inicio)}</strong></span>
            <span>🔄 Renovação: <strong>${fmtData(a.data_proxima_renovacao)}</strong></span>
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
    container.innerHTML = '<p class="erro">Erro ao carregar assinaturas.</p>';
  }
}
 
// ─── Biblioteca de Newsletters ────────────────────────────────────────────────
async function carregarBibliotecaNewsletters(uid) {
  const container = document.getElementById('biblioteca-tecnica');
  if (!container) return;
  container.innerHTML = '<p class="loading">Carregando newsletters...</p>';

  try {
    // Busca assinaturas ativas para obter assinaturaId e tipos_selecionados
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

    // Usa a primeira assinatura ativa (caso comum — plano único)
    const assinDoc     = assinSnap.docs[0];
    const assinaturaId = assinDoc.id;
    const assinData    = assinDoc.data();
    const tiposSel     = Array.isArray(assinData.tipos_selecionados)
      ? assinData.tipos_selecionados.map(String)
      : [];

    // Busca newsletters publicadas (modelo novo — sem envios)
    const nlSnap = await db.collection('newsletters')
      .where('enviada', '==', true)
      .orderBy('data_publicacao', 'desc')
      .limit(50)
      .get();

    if (nlSnap.empty) {
      container.innerHTML = `
        <div class="empty-state">
          <div style="font-size:32px">📭</div>
          <p>Nenhuma edição publicada ainda.</p>
        </div>`;
      return;
    }

    const _noIframe = window.parent !== window;

    const cards = nlSnap.docs
      .filter(doc => {
        // Filtra por tipo se a assinatura tem tipos_selecionados
        if (!tiposSel.length) return true;
        const tipo = doc.data().tipo || doc.data().Tipo;
        return !tipo || tiposSel.includes(String(tipo));
      })
      .map(doc => {
        const nl     = doc.data();
        const nid    = doc.id;
        const titulo = nl.titulo || `Edição ${nl.numero || '—'}`;
        const numero = nl.numero || '—';
        const data   = fmtData(nl.data_publicacao);

        // URL sem token e sem envioId — assinante usa sessão
        const qs  = [`nid=${nid}`, `uid=${uid}`, `assinaturaId=${assinaturaId}`].join('&');
        const url = `https://app.radarsiope.com.br/verNewsletterComToken.html?d=${encodeURIComponent(btoa(qs))}`;

        const _btnAcao = _noIframe
          ? `<button class="btn-ver-nl"
               onclick="window.parent.postMessage({tipo:'rs:abrirEdicao',newsletterId:'${nid}'}, '*')">
               Ler edição →
             </button>`
          : `<a href="${url}" class="btn-ver-nl" target="_blank">Ler edição →</a>`;

        return `
          <article class="nl-card">
            <div class="nl-card-header">
              <div>
                <div class="nl-card-edicao">Edição ${numero}</div>
                <div class="nl-card-titulo">${titulo}</div>
                <div class="nl-card-data">📅 ${data}</div>
              </div>
            </div>
            <div class="nl-card-footer">${_btnAcao}</div>
          </article>`;
      }).join('');

    container.innerHTML = `<div class="nl-grid">${cards || '<p class="empty-state">Nenhuma edição disponível.</p>'}</div>`;

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
 
// ─── ENVIO DE SOLICITAÇÃO (ATUALIZADA COM FLUXO DE CANCELAMENTO) ─────────────
async function enviarSolicitacao() {
  const usuario = JSON.parse(localStorage.getItem('usuarioLogado'));
  const tipoEl  = document.getElementById('tipo-suporte');
  const descEl  = document.getElementById('mensagem-suporte');
  const feedback = document.getElementById('suporte-feedback');
  const tipo    = tipoEl?.value || '';
  const descricao = descEl?.value.trim() || '';
  if (feedback) feedback.innerHTML = '';

  if (!descricao && !tipo.toLowerCase().includes('cancelamento')) {
    if (feedback) feedback.innerHTML = `<span style="color:#ef4444">❌ Descreva sua solicitação.</span>`;
    return;
  }

  // 🔹 Intercepta cancelamento
  if (tipo.toLowerCase().includes('cancelamento')) {
    await _processarSolicitacaoCancelamento(usuario.id, descricao);
    return;
  }

  // ✅ Fluxo normal
  try {
    await db.collection('usuarios').doc(usuario.id).collection('solicitacoes').add({
      tipo, descricao, status: 'aberta', data_solicitacao: new Date().toISOString()
    });
    await db.collection('admin_contadores').doc('pendencias').set({ solicitacoes: firebase.firestore.FieldValue.increment(1) }, { merge: true });
    if (feedback) feedback.innerHTML = `<span style="color:#22c55e">✅ Solicitação enviada com sucesso!</span>`;
    if (descEl) descEl.value = '';
    carregarHistoricoSolicitacoes(usuario.id);
  } catch (err) {
    console.error('[suporte]', err);
    if (feedback) feedback.innerHTML = `<span style="color:#ef4444">❌ Erro ao enviar.</span>`;
  }
}

function _abrirModalConfirmacaoCancelamento(d) {
  _fecharModalCancelamento();
  const multaHtml = d.temFid
    ? `<div style="background:#fffbeb;border:1px solid #fde68a;padding:14px;border-radius:8px;margin:14px 0;font-size:13px"><strong>⚖️ Cláusula Aplicada</strong><br>Ajuste: ${d.mesesUsados}m × ${d.valorMulta.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}/m = <span style="color:#b45309;font-weight:700">${(d.valorMulta * d.mesesUsados).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</span></div>`
    : `<div style="background:#f0fdf4;border:1px solid #bbf7d0;padding:14px;border-radius:8px;margin:14px 0;font-size:13px"><strong>✅ Sem Multa</strong><br>Fora do período de fidelização ou plano sem ajuste.</div>`;

  const modal = document.createElement('div');
  modal.id = 'modal-cancelamento';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;';
  modal.innerHTML = `<div style="background:#fff;padding:24px;border-radius:12px;max-width:500px;width:92%">
    <h3 style="margin:0 0 16px">⛔ Solicitar Cancelamento</h3>
    <div style="background:#f8fafc;padding:12px;border-radius:8px;font-size:13px;line-height:1.7">
      <strong>Plano:</strong> ${d.plano} (${d.ciclo}m) | <strong>Início:</strong> ${d.inicio} | <strong>Usados:</strong> ${d.mesesUsados}
    </div>${multaHtml}
    <p style="font-size:12px;color:#64748b;margin-top:8px">Ao prosseguir, a equipe analisará e enviará o link de pagamento, se aplicável.</p>
    <div style="display:flex;gap:12px;margin-top:20px;justify-content:flex-end">
      <button id="btn-desistir-cancel" style="padding:9px 16px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer">❌ Desistir</button>
      <button id="btn-prosseguir-cancel" style="padding:9px 16px;border:none;background:#0A3D62;color:#fff;border-radius:6px;cursor:pointer">✅ Prosseguir</button>
    </div></div>`;
  document.body.appendChild(modal);
  document.getElementById('btn-desistir-cancel').onclick = d.onCancel;
  document.getElementById('btn-prosseguir-cancel').onclick = d.onConfirm;
}

function _fecharModalCancelamento() {
  const el = document.getElementById('modal-cancelamento');
  if (el) el.remove();
}

// ─── MODAL + CÁLCULO DE CANCELAMENTO ──────────────────────────────────────────
async function _processarSolicitacaoCancelamento(uid, descricao) {
  // 1. Buscar assinatura ativa
  const snap = await db.collection('usuarios').doc(uid)
    .collection('assinaturas').where('status', 'in', ['ativa', 'aprovada']).limit(1).get();
  console.log('[cancelamento] Assinatura snap:', snap); // ✅ Debug da F1
  if (snap.empty) {
    alert('⚠️ Nenhuma assinatura ativa encontrada para solicitar cancelamento.');
    return;
  }
  console.log('[cancelamento] Assinatura encontrada:', snap.docs[0].data()); // ✅ Debug da F1

  const assin = snap.docs[0].data();
  const assinId = snap.docs[0].id;

  // 2. Calcular valores da multa
  const agora = new Date();
  const dataInicio = assin.data_inicio?.toDate?.() || new Date(assin.data_inicio);
  const dataFimFid = assin.data_fim_fidelizacao?.toDate?.() || null;
  const temFid = !!assin.tem_fidelizacao && !!dataFimFid;
  const dentroFid = temFid && agora < dataFimFid;

  const msUsados = agora - dataInicio;
  const mesesUsados = Math.max(1, Math.ceil(msUsados / (30 * 24 * 60 * 60 * 1000)));
  const descontoMensal = Number(assin.desconto_mensal) || 0;
  const valorMulta = dentroFid ? Math.round(descontoMensal * mesesUsados * 100) / 100 : 0;

  // 3. Exibir modal de confirmação
  _abrirModalConfirmacaoCancelamento({
    plano: assin.plano_nome || assin.plano_slug || 'Plano',
    ciclo: assin.ciclo_meses || assin.ciclo || '—',
    inicio: dataInicio.toLocaleDateString('pt-BR'),
    fimFid: dataFimFid ? dataFimFid.toLocaleDateString('pt-BR') : 'Não se aplica',
    mesesUsados,
    valorMulta,
    temFid,
    onConfirm: async () => {
      // 4. Salvar no Firestore APÓS confirmação
      try {
        await db.collection('usuarios').doc(uid).collection('solicitacoes').add({
          tipo: 'cancelamento',
          descricao: descricao || 'Solicitação de cancelamento via painel do assinante',
          status: 'aberta',
          data_solicitacao: new Date().toISOString(),
          assinaturaId: assinId,
          calculo_multa: {
            tem_fidelizacao: temFid,
            meses_usados: mesesUsados,
            desconto_mensal: descontoMensal,
            valor_ajuste: valorMulta,
            dentro_periodo: dentroFid,
            data_fim_fidelizacao: dataFimFid?.toISOString() // ✅ Campo essencial da F1
          }
        });
        await db.collection('admin_contadores').doc('pendencias').set({
          solicitacoes: firebase.firestore.FieldValue.increment(1)
        }, { merge: true });

        alert('✅ Solicitação enviada! Nossa equipe analisará e entrará em contato, se necessário.');
        document.getElementById('mensagem-suporte').value = '';
        carregarHistoricoSolicitacoes(uid);
        _fecharModalCancelamento();
      } catch (err) {
        console.error('[cancelamento] Erro ao registrar:', err); // ✅ Debug da F2
        alert('❌ Erro ao registrar solicitação. Tente novamente.');
      }
    },
    onCancel: () => {
      _fecharModalCancelamento();
    }
  });
}

// ─── RENDERIZAÇÃO DO MODAL ────────────────────────────────────────────────────
function _abrirModalConfirmacaoCancelamento(dados) {
  _fecharModalCancelamento(); // Garante que não haja duplicata

  const multaHtml = dados.temFid
    ? `<div style="background:#fffbeb;border:1px solid #fde68a;padding:14px;border-radius:8px;margin:14px 0;font-size:13px">
         <strong>⚖️ Cláusula de Fidelização Aplicada</strong><br>
         Ajuste proporcional: ${dados.mesesUsados} meses × ${dados.desconto_mensal.toLocaleString('pt-BR', {style:'currency',currency:'BRL'})} = 
         <span style="color:#b45309;font-weight:700;font-size:15px">${dados.valorMulta.toLocaleString('pt-BR', {style:'currency',currency:'BRL'})}</span>
       </div>`
    : `<div style="background:#f0fdf4;border:1px solid #bbf7d0;padding:14px;border-radius:8px;margin:14px 0;font-size:13px">
         <strong>✅ Sem Multa</strong><br>
         Você está fora do período de fidelização ou seu plano não possui cláusula de ajuste.
       </div>`;

  const modal = document.createElement('div');
  modal.id = 'modal-cancelamento';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(2px);animation:fadeIn .2s ease;';
  modal.innerHTML = `
    <div style="background:#fff;padding:24px;border-radius:12px;max-width:500px;width:92%;box-shadow:0 10px 25px rgba(0,0,0,0.2);">
      <h3 style="margin:0 0 16px;font-size:18px;color:#0A3D62">⛔ Solicitar Cancelamento de Assinatura</h3>
      <div style="background:#f8fafc;padding:12px;border-radius:8px;font-size:13px;line-height:1.7;border:1px solid #e2e8f0">
        <strong>Plano:</strong> ${dados.plano} (${dados.ciclo} meses)<br>
        <strong>Início:</strong> ${dados.inicio}<br>
        <strong>Fidelização até:</strong> ${dados.fimFid}<br>
        <strong>Meses utilizados:</strong> ${dados.mesesUsados}
      </div>
      ${multaHtml}
      <p style="font-size:12px;color:#64748b;margin-top:8px;line-height:1.5">
        Ao prosseguir, sua solicitação será enviada para análise administrativa. 
        ${dados.valorMulta > 0 ? 'Se aplicável, você receberá um link de pagamento da multa para concluir o encerramento.' : 'O cancelamento será processado após confirmação da equipe.'}
      </p>
      <div style="display:flex;gap:12px;margin-top:20px;justify-content:flex-end">
        <button id="btn-desistir-cancel" style="padding:9px 16px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;font-weight:600;color:#475569;transition:all .2s">❌ Desistir</button>
        <button id="btn-prosseguir-cancel" style="padding:9px 16px;border:none;background:#0A3D62;color:#fff;border-radius:6px;cursor:pointer;font-weight:600;transition:all .2s">✅ Prosseguir</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('btn-desistir-cancel').onclick = dados.onCancel;
  document.getElementById('btn-prosseguir-cancel').onclick = dados.onConfirm;
}

function _fecharModalCancelamento() {
  const el = document.getElementById('modal-cancelamento');
  if (el) el.remove();
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
 