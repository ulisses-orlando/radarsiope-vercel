// ─── drawer-usuario.js ───────────────────────────────────────────────────────
// Drawer lateral completo para gestão de assinantes no admin
// Contador centralizado em /admin_contadores/pendencias

// ─── Estado ──────────────────────────────────────────────────────────────────
let _drawerUid       = null;
let _drawerDados     = {};
let _drawerTabAtual  = 'resumo';
let _drawerAcessoSel = {};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function _fmtData(v) {
  if (!v) return '—';
  const d = typeof v?.toDate === 'function' ? v.toDate() : new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
}
function _fmtHora(v) {
  if (!v) return '—';
  const d = typeof v?.toDate === 'function' ? v.toDate() : new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function _fmtBRL(centavos) {
  if (centavos == null) return '—';
  return (Number(centavos) / 100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}
function _stColor(status) {
  const m = {
    ativa:'#22c55e', ativo:'#22c55e', pago:'#22c55e', aprovado:'#22c55e', atendida:'#22c55e',
    pendente:'#f59e0b', pendente_pagamento:'#f59e0b', aberta:'#3b82f6',
    cancelada:'#ef4444', cancelado:'#ef4444', falhou:'#ef4444', falha:'#ef4444', vencido:'#ef4444',
    enviado:'#22c55e', entregue:'#22c55e', erro:'#ef4444',
  };
  return m[String(status||'').toLowerCase()] || '#94a3b8';
}
function _stBadge(status) {
  const c = _stColor(status);
  return `<span style="background:${c}20;color:${c};border:1px solid ${c}40;
    border-radius:20px;padding:2px 9px;font-size:11px;font-weight:700;white-space:nowrap">${status||'—'}</span>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTADOR CENTRALIZADO — /admin_contadores/pendencias
// ─────────────────────────────────────────────────────────────────────────────
// Campos: solicitacoes | feedbacks | parcelas_vencidas
//
// Leitura: sempre 1 documento, independente do número de usuários.
// Escrita: FieldValue.increment pontual nos eventos relevantes.
//
// Quando o doc não existe (primeiro acesso), dispara _recalcularESeedContadores()
// que varre os dados uma única vez, persiste o resultado e depois só lê o doc.
// ═══════════════════════════════════════════════════════════════════════════════

const _CONTADOR_REF = () => db.collection('admin_contadores').doc('pendencias');

/**
 * Incrementa ou decrementa um campo do doc contador.
 * Uso: _incrementarContador('solicitacoes', -1)
 */
async function _incrementarContador(campo, delta = 1) {
  try {
    await _CONTADOR_REF().set(
      { [campo]: firebase.firestore.FieldValue.increment(delta) },
      { merge: true }
    );
  } catch(e) {
    console.warn('[contador]', campo, delta, e.message);
  }
}

/**
 * Lê o badge a partir do doc contador — 1 leitura sempre.
 * Se o doc não existir, dispara o seed automático.
 */
async function atualizarBadgeUsuarios() {
  const badge = document.getElementById('badge-usuarios');
  if (!badge) return;
  try {
    const snap = await _CONTADOR_REF().get();
    if (!snap.exists) {
      // Primeiro acesso: calcula, persiste e depois atualiza o badge
      badge.textContent = '…';
      badge.style.display = 'inline';
      await _recalcularESeedContadores();
      return;
    }
    const d = snap.data();
    const sol  = Math.max(0, d.solicitacoes      || 0);
    const feed = Math.max(0, d.feedbacks         || 0);
    const pag  = Math.max(0, d.parcelas_vencidas || 0);
    const total = sol + feed + pag;

    badge.textContent   = total > 99 ? '99+' : total;
    badge.style.display = total > 0 ? 'inline' : 'none';
    badge.title = [
      `📬 Solicitações pendentes/abertas: ${sol}`,
      `💬 Feedbacks sem resposta: ${feed}`,
      `💳 Parcelas vencidas: ${pag}`,
    ].join('\n');
  } catch(e) {
    console.warn('[badge-usuarios]', e.message);
  }
}

/**
 * Calcula contadores varrendo os dados reais e persiste no doc.
 * Chamado automaticamente só quando o doc não existe.
 * Pode ser chamado manualmente pelo admin via botão "Recalcular".
 */
async function _recalcularESeedContadores() {
  let solicitacoes = 0, feedbacks = 0, parcelas_vencidas = 0;
  const hoje = new Date();
  try {
    const usersSnap = await db.collection('usuarios').limit(500).get();
    await Promise.all(usersSnap.docs.map(async uDoc => {
      try {
        const s = await db.collection('usuarios').doc(uDoc.id)
          .collection('solicitacoes').where('status','in',['pendente','aberta']).get();
        solicitacoes += s.size;
      } catch(e) {}
      try {
        const assinSnap = await db.collection('usuarios').doc(uDoc.id)
          .collection('assinaturas').get();
        await Promise.all(assinSnap.docs.map(async aDoc => {
          try {
            const pagSnap = await db.collection('usuarios').doc(uDoc.id)
              .collection('assinaturas').doc(aDoc.id)
              .collection('pagamentos').where('status','==','pendente').get();
            pagSnap.forEach(pDoc => {
              const v = pDoc.data().data_vencimento;
              const vd = v ? (v.toDate ? v.toDate() : new Date(v)) : null;
              if (vd && vd < hoje) parcelas_vencidas++;
            });
          } catch(e) {}
        }));
      } catch(e) {}
    }));

    // Feedbacks de newsletters (coleção raiz, sem collectionGroup)
    const nlSnap = await db.collection('newsletters')
      .where('enviada','==',true).limit(100).get();
    nlSnap.forEach(doc => {
      const fbs = doc.data().feedbacks || [];
      feedbacks += fbs.filter(f => !f.respondido && !f.nota_interna).length;
    });

    await _CONTADOR_REF().set({
      solicitacoes, feedbacks, parcelas_vencidas,
      recalculado_em: firebase.firestore.FieldValue.serverTimestamp(),
    });
    console.info('[contador] seed:', { solicitacoes, feedbacks, parcelas_vencidas });
  } catch(e) {
    console.warn('[contador seed]', e.message);
  }
  atualizarBadgeUsuarios();
}

// ─── Abrir / Fechar ───────────────────────────────────────────────────────────
async function abrirDrawerUsuario(uid) {
  _drawerUid      = uid;
  _drawerTabAtual = 'resumo';
  _drawerAcessoSel = {};

  const overlay = document.getElementById('drawer-usuario-overlay');
  const drawer  = document.getElementById('drawer-usuario');
  if (!overlay || !drawer) return;

  overlay.style.display = 'flex';
  requestAnimationFrame(() => drawer.classList.add('open'));

  document.getElementById('drawer-usuario-nome').textContent = 'Carregando...';
  document.getElementById('drawer-usuario-sub').textContent  = '';
  document.getElementById('drawer-usuario-body').innerHTML   =
    '<div class="drawer-loading">⏳ Carregando dados...</div>';

  try {
    const doc = await db.collection('usuarios').doc(uid).get();
    _drawerDados = doc.exists ? doc.data() : {};
    document.getElementById('drawer-usuario-nome').textContent =
      _drawerDados.nome || _drawerDados.email || 'Usuário';
    document.getElementById('drawer-usuario-sub').textContent  =
      [_drawerDados.tipo_perfil, _drawerDados.email].filter(Boolean).join(' · ');
  } catch(e) { _drawerDados = {}; }

  _ativarDrawerTab('resumo');
}

function fecharDrawerUsuario() {
  const drawer  = document.getElementById('drawer-usuario');
  const overlay = document.getElementById('drawer-usuario-overlay');
  drawer?.classList.remove('open');
  setTimeout(() => { if (overlay) overlay.style.display = 'none'; }, 280);
  _drawerUid = null;
}

// ─── Navegação de abas ────────────────────────────────────────────────────────
function _ativarDrawerTab(tab) {
  _drawerTabAtual = tab;
  document.querySelectorAll('.drawer-tab-btn').forEach(b =>
    b.classList.toggle('ativo', b.dataset.tab === tab));
  document.getElementById('drawer-usuario-body').innerHTML =
    '<div class="drawer-loading">⏳ Carregando...</div>';

  const fn = {
    resumo:       _renderResumo,
    pagamentos:   _renderPagamentos,
    solicitacoes: _renderSolicitacoes,
    envios:       _renderEnvios,
    interacoes:   _renderInteracoes,
    acesso:       _renderAcesso,
  };
  if (fn[tab]) fn[tab]();
}

// ─── ABA: RESUMO ─────────────────────────────────────────────────────────────
async function _renderResumo() {
  const body = document.getElementById('drawer-usuario-body');
  const d = _drawerDados, uid = _drawerUid;
  try {
    const assinSnap = await db.collection('usuarios').doc(uid)
      .collection('assinaturas').get();

    const featLabels = {
      newsletter_texto:'📰 Newsletter', newsletter_audio:'🎧 Podcast',
      newsletter_video:'🎬 Vídeo', newsletter_infografico:'📊 Infográfico',
      biblioteca_acesso:'📚 Biblioteca', alertas_prioritarios:'🔔 Alertas',
      grupo_whatsapp_vip:'💬 WhatsApp VIP',
    };

    let assinHtml = assinSnap.empty
      ? '<p style="color:#94a3b8;font-size:13px">Nenhuma assinatura.</p>' : '';

    for (const doc of assinSnap.docs) {
      const a = doc.data();
      const c = _stColor(a.status);
      const feats = Object.entries(featLabels)
        .filter(([k]) => (a.features_snapshot||{})[k])
        .map(([,v]) => `<span style="background:#0284c720;color:#0284c7;
          border:1px solid #0284c740;border-radius:20px;padding:2px 8px;
          font-size:11px;font-weight:700">${v}</span>`).join('');

      assinHtml += `
        <div style="border-left:4px solid ${c};border-radius:8px;background:#f8fafc;
          padding:10px 12px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div style="font-weight:700;font-size:13px">${a.plano_nome||a.plano_slug||'Plano'}</div>
              <div style="font-size:11px;color:#64748b">
                ${a.ciclo||''} · ${_fmtBRL((a.valor_final||0)*100 || a.amountCentavos)}
              </div>
            </div>
            ${_stBadge(a.status)}
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:6px">
            📅 Início: <strong>${_fmtData(a.data_inicio)}</strong>
            &nbsp;&nbsp;🔄 Renovação: <strong>${_fmtData(a.data_proxima_renovacao)}</strong>
          </div>
          ${feats ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">${feats}</div>` : ''}
        </div>`;
    }

    body.innerHTML = `
      <div class="drawer-secao">
        <div class="drawer-secao-titulo">👤 Dados do usuário</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
          <div><span style="color:#64748b;font-size:11px">Nome</span><br><strong>${d.nome||'—'}</strong></div>
          <div><span style="color:#64748b;font-size:11px">E-mail</span><br><strong>${d.email||'—'}</strong></div>
          <div><span style="color:#64748b;font-size:11px">Perfil</span><br><strong>${d.tipo_perfil||'—'}</strong></div>
          <div><span style="color:#64748b;font-size:11px">Situação</span><br>${_stBadge(d.ativo?'ativo':'inativo')}</div>
          <div><span style="color:#64748b;font-size:11px">UF / Município</span><br>
            <strong>${d.cod_uf||'—'} / ${d.nome_municipio||'—'}</strong></div>
          <div><span style="color:#64748b;font-size:11px">Telefone</span><br><strong>${d.telefone||'—'}</strong></div>
          <div><span style="color:#64748b;font-size:11px">Cadastro</span><br><strong>${_fmtData(d.data_cadastro)}</strong></div>
          <div><span style="color:#64748b;font-size:11px">Pref. contato</span><br><strong>${d.preferencia_contato||'—'}</strong></div>
        </div>
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-drawer-sm" onclick="abrirModalEditarUsuario('${uid}')">✏️ Editar</button>
          <button class="btn-drawer-sm" onclick="abrirModalEnvioManual('${uid}')">📧 Enviar e-mail</button>
        </div>
      </div>
      <div class="drawer-secao">
        <div class="drawer-secao-titulo">📑 Assinaturas</div>
        ${assinHtml}
      </div>`;
  } catch(e) {
    body.innerHTML = `<p style="color:#ef4444">Erro: ${e.message}</p>`;
  }
}

// ─── ABA: PAGAMENTOS ─────────────────────────────────────────────────────────
async function _renderPagamentos() {
  const body = document.getElementById('drawer-usuario-body');
  const uid  = _drawerUid;
  try {
    const assinSnap = await db.collection('usuarios').doc(uid).collection('assinaturas').get();
    if (assinSnap.empty) {
      body.innerHTML = '<p style="color:#94a3b8;font-size:13px">Nenhuma assinatura.</p>'; return;
    }

    const hoje = new Date();
    let html = '';
    let totalPendente = 0, totalVencido = 0;

    for (const assinDoc of assinSnap.docs) {
      const a = assinDoc.data();
      const pagSnap = await db.collection('usuarios').doc(uid)
        .collection('assinaturas').doc(assinDoc.id)
        .collection('pagamentos').orderBy('numero_parcela','asc').get();

      if (pagSnap.empty) continue;

      let linhas = '';
      pagSnap.forEach(pd => {
        const p = pd.data();
        const status = (p.status||'').toLowerCase();
        const venc = p.data_vencimento?.toDate?.() || null;
        const vencido = venc && status !== 'pago' && venc < hoje;
        if (vencido) totalVencido++;
        else if (status === 'pendente') totalPendente++;

        const rowBg = vencido ? '#fff1f2' : status === 'pago' ? '#f0fdf4' : '';
        const parcela = p.numero_parcela
          ? `Parc. ${p.numero_parcela}${p.mpInstallments>1?`/${p.mpInstallments}`:''}` : 'Pgto.';

        linhas += `
          <tr style="background:${rowBg}">
            <td style="padding:5px 6px;font-size:12px">${parcela}</td>
            <td style="padding:5px 6px;font-size:12px">${_fmtData(p.data_pagamento||p.data_vencimento)}</td>
            <td style="padding:5px 6px">${_stBadge(vencido?'vencido':p.status)}</td>
            <td style="padding:5px 6px;font-size:11px;color:#64748b">${p.mpPaymentMethod||p.metodo_pagamento||'—'}</td>
            <td style="padding:5px 6px;font-size:13px;font-weight:700;text-align:right">
              ${_fmtBRL(p.valor_centavos||(p.valor?(p.valor*100):null))}</td>
            <td style="padding:5px 6px">
              <span class="icon-btn" title="Editar"
                onclick="abrirModalSubItem('${uid}','assinaturas/${assinDoc.id}/pagamentos','${pd.id}',true)">✏️</span>
            </td>
          </tr>`;
      });

      html += `
        <div class="drawer-secao">
          <div class="drawer-secao-titulo">
            📑 ${a.plano_nome||a.plano_slug||'Plano'} &nbsp; ${_stBadge(a.status)}
          </div>
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f1f5f9;font-size:11px;color:#64748b">
              <th style="text-align:left;padding:4px 6px">Parcela</th>
              <th style="text-align:left;padding:4px 6px">Data</th>
              <th style="text-align:left;padding:4px 6px">Status</th>
              <th style="text-align:left;padding:4px 6px">Método</th>
              <th style="text-align:right;padding:4px 6px">Valor</th>
              <th></th>
            </tr></thead>
            <tbody>${linhas||'<tr><td colspan="6" style="color:#94a3b8;padding:8px;font-size:12px">Nenhum pagamento.</td></tr>'}</tbody>
          </table>
          <div style="margin-top:8px">
            <button class="btn-drawer-sm"
              onclick="abrirGeradorParcelasAssinatura('${uid}','${assinDoc.id}')">
              📆 Gerar parcelas
            </button>
          </div>
        </div>`;
    }

    let alertas = '';
    if (totalVencido)  alertas += `<div class="drawer-alerta vermelho">🔴 <strong>${totalVencido}</strong> parcela(s) vencida(s)</div>`;
    if (totalPendente) alertas += `<div class="drawer-alerta amarelo">⚠️ <strong>${totalPendente}</strong> parcela(s) pendente(s)</div>`;

    body.innerHTML = alertas + (html || '<p style="color:#94a3b8;font-size:13px">Nenhum pagamento.</p>');
  } catch(e) {
    body.innerHTML = `<p style="color:#ef4444">Erro: ${e.message}</p>`;
  }
}

// ─── ABA: SOLICITAÇÕES ───────────────────────────────────────────────────────
async function _renderSolicitacoes() {
  const body = document.getElementById('drawer-usuario-body');
  const uid  = _drawerUid;
  try {
    const snap = await db.collection('usuarios').doc(uid)
      .collection('solicitacoes').orderBy('data_solicitacao','desc').get();

    let html = `<div style="margin-bottom:10px">
      <button class="btn-drawer-sm" onclick="abrirModalEnvioManual('${uid}')">
        📧 Enviar mensagem manual
      </button>
    </div>`;

    if (snap.empty) {
      body.innerHTML = html + '<p style="color:#94a3b8;font-size:13px">Nenhuma solicitação.</p>';
      return;
    }

    let pendentes = 0;
    snap.forEach(doc => {
      const s   = doc.data();
      const status = (s.status||'pendente').toLowerCase();
      if (status === 'aberta' || status === 'pendente') pendentes++;
      const c       = _stColor(status);
      const isAdmin = s.tipo === 'envio_manual_admin';

      const respostaHtml = s.resposta
        ? `<div style="background:#f1f5f9;border-left:3px solid #0284c7;
            border-radius:4px;padding:6px 8px;font-size:12px;margin-top:6px">
            💡 ${s.resposta}
           </div>` : '';

      const acoes = (status === 'aberta' || status === 'pendente') ? `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <button class="btn-drawer-sm btn-verde"
            onclick="_drawerResponderSolicitacao('${uid}','${doc.id}','atendida')">
            ✅ Atendida
          </button>
          <button class="btn-drawer-sm btn-vermelho"
            onclick="_drawerResponderSolicitacao('${uid}','${doc.id}','cancelada')">
            ❌ Cancelar
          </button>
          <button class="btn-drawer-sm"
            onclick="abrirModalEnvioManual('${uid}','${doc.id}',${JSON.stringify({
              ...s, email: _drawerDados.email, nome: _drawerDados.nome
            }).replace(/"/g,'&quot;')})">
            📧 Responder
          </button>
        </div>` : '';

      html += `
        <div style="border-left:4px solid ${c};border-radius:8px;background:#f8fafc;
          padding:10px 12px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:12px;font-weight:700;color:#334155">
              ${isAdmin ? '📧 Mensagem da equipe' : (s.tipo||'Outros')}
            </span>
            ${_stBadge(s.status)}
          </div>
          <div style="font-size:13px;color:#334155;margin-top:6px;line-height:1.5">
            ${isAdmin ? (s.assunto?`<strong>${s.assunto}</strong><br>`:'') : ''}
            ${s.descricao || s.mensagem || '—'}
          </div>
          ${respostaHtml}${acoes}
          <div style="font-size:11px;color:#94a3b8;margin-top:6px">${_fmtHora(s.data_solicitacao||s.data_envio)}</div>
        </div>`;
    });

    if (pendentes) {
      html = `<div class="drawer-alerta amarelo">🟠 <strong>${pendentes}</strong> solicitação(ões) aguardando atendimento</div>` + html;
    }
    body.innerHTML = html;
  } catch(e) {
    body.innerHTML = `<p style="color:#ef4444">Erro: ${e.message}</p>`;
  }
}

// Responder → decrementa contador
async function _drawerResponderSolicitacao(uid, solId, novoStatus) {
  const resposta = prompt(`Resposta para o usuário (status → ${novoStatus}):`);
  if (resposta === null) return;
  try {
    await db.collection('usuarios').doc(uid).collection('solicitacoes').doc(solId)
      .update({ status: novoStatus, resposta, data_resposta: new Date() });

    // ▼ decrementa contador central
    await _incrementarContador('solicitacoes', -1);

    mostrarMensagem('Solicitação atualizada!');
    _ativarDrawerTab('solicitacoes');
    atualizarBadgeUsuarios();
  } catch(e) { mostrarMensagem('Erro: ' + e.message); }
}

// ─── ABA: ENVIOS ─────────────────────────────────────────────────────────────
async function _renderEnvios() {
  const body = document.getElementById('drawer-usuario-body');
  const uid  = _drawerUid;
  try {
    const assinSnap = await db.collection('usuarios').doc(uid).collection('assinaturas').get();
    if (assinSnap.empty) {
      body.innerHTML = '<p style="color:#94a3b8;font-size:13px">Nenhuma assinatura.</p>'; return;
    }

    let html = '';
    let totalFalhos = 0;

    for (const assinDoc of assinSnap.docs) {
      const a = assinDoc.data();
      const enviosSnap = await db.collection('usuarios').doc(uid)
        .collection('assinaturas').doc(assinDoc.id)
        .collection('envios').orderBy('data_envio','desc').get();

      if (enviosSnap.empty) continue;

      let linhas = '';
      for (const ed of enviosSnap.docs) {
        const e      = ed.data();
        const status = (e.status||'').toLowerCase();
        if (status === 'falhou' || status === 'erro' || status === 'falha') totalFalhos++;

        let tituloNL = e.newsletter_id || e.id_edicao || ed.id;
        try {
          const nlid = e.newsletter_id || e.id_edicao;
          if (nlid) {
            const nlDoc = await db.collection('newsletters').doc(nlid).get();
            if (nlDoc.exists) {
              const nl = nlDoc.data();
              tituloNL = `${nl.titulo||''} (Ed.${nl.numero||nl.edicao||'—'})`;
            }
          }
        } catch(_) {}

        const qs = btoa([
          `nid=${e.newsletter_id||e.id_edicao||''}`,
          `env=${ed.id}`, `uid=${uid}`,
          `assinaturaId=${assinDoc.id}`,
          e.token_acesso ? `token=${e.token_acesso}` : ''
        ].filter(Boolean).join('&'));
        const urlVer  = `https://app.radarsiope.com.br/verNewsletterComToken.html?d=${encodeURIComponent(qs)}`;
        const expirou = e.expira_em && new Date() >
          (e.expira_em?.toDate ? e.expira_em.toDate() : new Date(e.expira_em));

        linhas += `
          <tr>
            <td style="padding:5px 6px;font-size:12px;max-width:180px">${tituloNL}</td>
            <td style="padding:5px 6px;font-size:12px">${_fmtData(e.data_envio)}</td>
            <td style="padding:5px 6px">${_stBadge(e.status)}</td>
            <td style="padding:5px 6px">
              ${expirou
                ? '<span style="font-size:11px;color:#94a3b8">⏰ Expirado</span>'
                : `<a href="${urlVer}" target="_blank" style="font-size:11px;color:#0284c7;text-decoration:none">🔗 Ver</a>`}
            </td>
            <td style="padding:5px 6px;font-size:11px;color:#94a3b8">${_fmtData(e.expira_em)}</td>
            <td style="padding:5px 6px;font-size:12px;text-align:center">${e.acessos_totais||0}</td>
          </tr>`;
      }

      html += `
        <div class="drawer-secao">
          <div class="drawer-secao-titulo">
            📑 ${a.plano_nome||a.plano_slug||'Assinatura'} &nbsp; ${_stBadge(a.status)}
          </div>
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f1f5f9;font-size:11px;color:#64748b">
              <th style="text-align:left;padding:4px 6px">Edição</th>
              <th style="text-align:left;padding:4px 6px">Enviado</th>
              <th style="text-align:left;padding:4px 6px">Status</th>
              <th style="text-align:left;padding:4px 6px">Link</th>
              <th style="text-align:left;padding:4px 6px">Expira</th>
              <th style="text-align:center;padding:4px 6px">👁</th>
            </tr></thead>
            <tbody>${linhas||'<tr><td colspan="6" style="color:#94a3b8;padding:8px;font-size:12px">Nenhum envio.</td></tr>'}</tbody>
          </table>
          <div style="margin-top:8px">
            <button class="btn-drawer-sm"
              onclick="abrirModalEnvioNewsletterManual('${uid}','${assinDoc.id}')">
              📧 Enviar newsletter manual
            </button>
          </div>
        </div>`;
    }

    const alertas = totalFalhos
      ? `<div class="drawer-alerta vermelho">❌ <strong>${totalFalhos}</strong> envio(s) com falha</div>` : '';
    body.innerHTML = alertas + (html || '<p style="color:#94a3b8;font-size:13px">Nenhum envio registrado.</p>');
  } catch(e) {
    body.innerHTML = `<p style="color:#ef4444">Erro: ${e.message}</p>`;
  }
}

// ─── ABA: INTERAÇÕES ─────────────────────────────────────────────────────────
async function _renderInteracoes() {
  const body = document.getElementById('drawer-usuario-body');
  const uid  = _drawerUid;

  body.innerHTML = `
    <div class="drawer-secao">
      <div class="drawer-secao-titulo">📞 Registrar contato</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <label style="font-size:11px;font-weight:700;color:#334155;display:block;margin-bottom:3px">Tipo</label>
          <select id="int-tipo" style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px">
            <option value="Telefone">📞 Telefone</option>
            <option value="WhatsApp">💬 WhatsApp</option>
            <option value="E-mail">📧 E-mail</option>
            <option value="Reunião">🤝 Reunião</option>
            <option value="Outro">🔖 Outro</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#334155;display:block;margin-bottom:3px">Resultado</label>
          <select id="int-resultado" style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px">
            <option value="Contato realizado">✅ Contato realizado</option>
            <option value="Sem resposta">📵 Sem resposta</option>
            <option value="Agendado retorno">📅 Agendado retorno</option>
            <option value="Cancelamento solicitado">⛔ Cancelamento solicitado</option>
            <option value="Renovação negociada">🔄 Renovação negociada</option>
            <option value="Problema resolvido">✔️ Problema resolvido</option>
          </select>
        </div>
      </div>
      <div style="margin-bottom:8px">
        <label style="font-size:11px;font-weight:700;color:#334155;display:block;margin-bottom:3px">Nota</label>
        <textarea id="int-nota" rows="2" placeholder="Observações..."
          style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:6px;
          font-size:12px;resize:vertical"></textarea>
      </div>
      <button class="btn-drawer-sm btn-verde" onclick="_salvarInteracaoUsuario('${uid}')">
        💾 Salvar interação
      </button>
    </div>
    <div id="interacoes-historico"><div class="drawer-loading">⏳ Carregando histórico...</div></div>`;

  try {
    const snap = await db.collection('usuarios').doc(uid)
      .collection('interacoes').orderBy('data','desc').limit(50).get();
    const hist = document.getElementById('interacoes-historico');
    if (snap.empty) {
      hist.innerHTML = '<p style="color:#94a3b8;font-size:13px">Nenhuma interação registrada.</p>';
      return;
    }
    let h = '<div class="drawer-secao"><div class="drawer-secao-titulo">📜 Histórico</div>';
    snap.forEach(doc => {
      const i = doc.data();
      h += `
        <div style="border-bottom:1px dashed #e2e8f0;padding:8px 0">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;font-weight:700">${i.tipo||'—'}</span>
            <span style="font-size:11px;color:#94a3b8">${_fmtHora(i.data)}</span>
          </div>
          <div style="font-size:12px;margin-top:3px">
            ${_stBadge(i.resultado||'—')}
            ${i.responsavel?`<span style="font-size:11px;color:#94a3b8;margin-left:6px">por ${i.responsavel}</span>`:''}
          </div>
          ${i.nota?`<div style="font-size:12px;color:#64748b;margin-top:4px;
            background:#f1f5f9;border-radius:4px;padding:4px 8px">${i.nota}</div>`:''}
        </div>`;
    });
    hist.innerHTML = h + '</div>';
  } catch(e) {
    const hist = document.getElementById('interacoes-historico');
    if (hist) hist.innerHTML = `<p style="color:#ef4444">Erro: ${e.message}</p>`;
  }
}

async function _salvarInteracaoUsuario(uid) {
  const tipo      = document.getElementById('int-tipo').value;
  const resultado = document.getElementById('int-resultado').value;
  const nota      = document.getElementById('int-nota').value.trim();
  const admin     = JSON.parse(localStorage.getItem('usuarioLogado')||'{}');
  try {
    await db.collection('usuarios').doc(uid).collection('interacoes').add({
      tipo, resultado, nota: nota||null,
      responsavel: admin.nome || admin.email || 'Admin',
      data: firebase.firestore.FieldValue.serverTimestamp(),
    });
    mostrarMensagem('Interação registrada!');
    _renderInteracoes();
  } catch(e) { mostrarMensagem('Erro: ' + e.message); }
}

// ─── ABA: ACESSO ─────────────────────────────────────────────────────────────
async function _renderAcesso() {
  const body = document.getElementById('drawer-usuario-body');
  const uid  = _drawerUid;
  _drawerAcessoSel = {};
  try {
    const assinSnap = await db.collection('usuarios').doc(uid).collection('assinaturas').get();
    if (assinSnap.empty) {
      body.innerHTML = '<p style="color:#94a3b8;font-size:13px">Nenhuma assinatura.</p>'; return;
    }

    let html  = '';
    const hoje = new Date();

    for (const assinDoc of assinSnap.docs) {
      const a = assinDoc.data();
      const enviosSnap = await db.collection('usuarios').doc(uid)
        .collection('assinaturas').doc(assinDoc.id)
        .collection('envios').orderBy('data_envio','desc').get();
      if (enviosSnap.empty) continue;

      let itens = '';
      for (const ed of enviosSnap.docs) {
        const e = ed.data();
        const expirou = e.expira_em &&
          hoje > (e.expira_em?.toDate ? e.expira_em.toDate() : new Date(e.expira_em));

        let titulo = e.newsletter_id || e.id_edicao || ed.id;
        try {
          const nlid = e.newsletter_id || e.id_edicao;
          if (nlid) {
            const nlDoc = await db.collection('newsletters').doc(nlid).get();
            if (nlDoc.exists) titulo = nlDoc.data().titulo || titulo;
          }
        } catch(_) {}

        itens += `
          <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px dashed #e2e8f0">
            <input type="checkbox" id="acesso-${ed.id}"
              data-assin="${assinDoc.id}" data-envio="${ed.id}"
              onchange="_toggleAcessoSel('${assinDoc.id}','${ed.id}',this.checked)"
              style="width:15px;height:15px;cursor:pointer;flex-shrink:0">
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${titulo}</div>
              <div style="font-size:11px;color:#94a3b8">
                Expira: ${_fmtData(e.expira_em)} · Acessos: ${e.acessos_totais||0}
              </div>
            </div>
            ${expirou
              ? '<span style="background:#fee2e2;color:#ef4444;border-radius:20px;padding:2px 8px;font-size:11px;flex-shrink:0">⛔ Expirado</span>'
              : '<span style="background:#dcfce7;color:#22c55e;border-radius:20px;padding:2px 8px;font-size:11px;flex-shrink:0">✅ Ativo</span>'}
          </div>`;
      }

      html += `
        <div class="drawer-secao">
          <div class="drawer-secao-titulo">${a.plano_nome||a.plano_slug||'Assinatura'}</div>
          ${itens||'<p style="color:#94a3b8;font-size:12px">Nenhum envio.</p>'}
        </div>`;
    }

    body.innerHTML = html + `
      <div class="drawer-secao" style="position:sticky;bottom:0;background:#fff;
        border-top:1px solid #e2e8f0;padding-top:12px;margin-top:4px">
        <div class="drawer-secao-titulo">⏰ Prorrogar selecionados</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
          <button class="btn-drawer-sm" onclick="_selecionarTodosAcesso(true)">☑️ Todos</button>
          <button class="btn-drawer-sm" onclick="_selecionarTodosAcesso(false)">⬜ Nenhum</button>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <button class="btn-drawer-sm" onclick="_confirmarProrrogacaoUsuario(7)">+7d</button>
          <button class="btn-drawer-sm" onclick="_confirmarProrrogacaoUsuario(15)">+15d</button>
          <button class="btn-drawer-sm" onclick="_confirmarProrrogacaoUsuario(30)">+30d</button>
          <button class="btn-drawer-sm" onclick="_confirmarProrrogacaoUsuario(60)">+60d</button>
          <input type="number" id="dias-custom" placeholder="Dias" min="1"
            style="width:65px;padding:5px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px">
          <button class="btn-drawer-sm btn-verde"
            onclick="_confirmarProrrogacaoUsuario()">✅ Aplicar</button>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-top:8px;cursor:pointer">
          <input type="checkbox" id="resetar-acessos"> Resetar contador de acessos
        </label>
      </div>`;
  } catch(e) {
    body.innerHTML = `<p style="color:#ef4444">Erro: ${e.message}</p>`;
  }
}

function _toggleAcessoSel(assinId, envioId, checked) {
  const key = `${assinId}|${envioId}`;
  if (checked) _drawerAcessoSel[key] = { assinId, envioId };
  else delete _drawerAcessoSel[key];
}

function _selecionarTodosAcesso(sel) {
  document.querySelectorAll('[id^="acesso-"]').forEach(cb => {
    cb.checked = sel;
    const key = `${cb.dataset.assin}|${cb.dataset.envio}`;
    if (sel) _drawerAcessoSel[key] = { assinId: cb.dataset.assin, envioId: cb.dataset.envio };
    else delete _drawerAcessoSel[key];
  });
}

async function _confirmarProrrogacaoUsuario(diasFixo) {
  const custom  = parseInt(document.getElementById('dias-custom')?.value || '0');
  const dias    = diasFixo || custom;
  const resetar = document.getElementById('resetar-acessos')?.checked;
  const uid     = _drawerUid;
  if (!dias || dias < 1) { mostrarMensagem('Informe quantos dias prorrogar.'); return; }
  const selecionados = Object.values(_drawerAcessoSel);
  if (!selecionados.length) { mostrarMensagem('Selecione ao menos um envio.'); return; }
  try {
    const batch  = db.batch();
    const novaExp = new Date();
    novaExp.setDate(novaExp.getDate() + dias);
    const ts = firebase.firestore.Timestamp.fromDate(novaExp);
    for (const { assinId, envioId } of selecionados) {
      const ref = db.collection('usuarios').doc(uid)
        .collection('assinaturas').doc(assinId)
        .collection('envios').doc(envioId);
      const upd = { expira_em: ts };
      if (resetar) upd.acessos_totais = 0;
      batch.update(ref, upd);
    }
    await batch.commit();
    mostrarMensagem(`✅ +${dias} dias aplicado em ${selecionados.length} envio(s).`);
    _renderAcesso();
  } catch(e) { mostrarMensagem('Erro: ' + e.message); }
}

// ─── Exportações globais ─────────────────────────────────────────────────────
window.abrirDrawerUsuario           = abrirDrawerUsuario;
window.fecharDrawerUsuario          = fecharDrawerUsuario;
window._ativarDrawerTab             = _ativarDrawerTab;
window._drawerResponderSolicitacao  = _drawerResponderSolicitacao;
window._salvarInteracaoUsuario      = _salvarInteracaoUsuario;
window._confirmarProrrogacaoUsuario = _confirmarProrrogacaoUsuario;
window._toggleAcessoSel             = _toggleAcessoSel;
window._selecionarTodosAcesso       = _selecionarTodosAcesso;
window.atualizarBadgeUsuarios       = atualizarBadgeUsuarios;
window._recalcularESeedContadores   = _recalcularESeedContadores;
window._incrementarContador         = _incrementarContador;

document.addEventListener('DOMContentLoaded', () => setTimeout(atualizarBadgeUsuarios, 1500));
