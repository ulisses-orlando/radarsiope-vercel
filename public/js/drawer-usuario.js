// ─── drawer-usuario.js ───────────────────────────────────────────────────────
// Drawer lateral completo para gestão de assinantes
// Contador centralizado: /admin_contadores/pendencias

// ─── Estado ──────────────────────────────────────────────────────────────────
let _drawerUid = null;
let _drawerDados = {};
let _drawerTabAtual = 'resumo';
// _drawerAcessoSel removido — modelo de envios substituído por sessões
let _seedEmAndamento = false; // guard anti-loop

// ─── Helpers ─────────────────────────────────────────────────────────────────
function _fmtData(v) {
  if (!v) return '—';
  const d = typeof v?.toDate === 'function' ? v.toDate() : new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}
function _fmtHora(v) {
  if (!v) return '—';
  const d = typeof v?.toDate === 'function' ? v.toDate() : new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function _fmtBRL(centavos) {
  if (centavos == null) return '—';
  return (Number(centavos) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function _stColor(status) {
  const m = {
    ativa: '#22c55e', ativo: '#22c55e', pago: '#22c55e', aprovado: '#22c55e', atendida: '#22c55e',
    pendente: '#f59e0b', pendente_pagamento: '#f59e0b', aberta: '#3b82f6',
    cancelada: '#ef4444', cancelado: '#ef4444', falhou: '#ef4444', falha: '#ef4444', vencido: '#ef4444',
    enviado: '#22c55e', entregue: '#22c55e', erro: '#ef4444',
  };
  return m[String(status || '').toLowerCase()] || '#94a3b8';
}
function _stBadge(status) {
  const c = _stColor(status);
  return `<span style="background:${c}20;color:${c};border:1px solid ${c}40;
    border-radius:20px;padding:2px 9px;font-size:11px;font-weight:700;white-space:nowrap">${status || '—'}</span>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTADOR CENTRALIZADO — /admin_contadores/pendencias
// ─────────────────────────────────────────────────────────────────────────────
// Campos: solicitacoes | feedbacks | parcelas_vencidas
//
// Leitura: 1 documento, independente do número de usuários.
// Escrita: FieldValue.increment pontual nos eventos (ver instruções no README).
//
// Se o doc não existir, cria com zeros e exibe botão "Recalcular" no admin.
// O recálculo manual varre os dados e persiste — não roda automaticamente
// para não exigir permissões de leitura cruzada (auth.uid != userId).
// ═══════════════════════════════════════════════════════════════════════════════

const _CONTADOR_REF = () => db.collection('admin_contadores').doc('pendencias');

/**
 * Incrementa ou decrementa um campo do contador.
 * Nunca lança exceção — falhas são silenciosas no badge.
 */
async function _incrementarContador(campo, delta = 1) {
  try {
    await _CONTADOR_REF().set(
      { [campo]: firebase.firestore.FieldValue.increment(delta) },
      { merge: true }
    );
  } catch (e) {
    console.warn('[contador]', campo, delta, e.message);
  }
}

/**
 * Lê o badge a partir do doc contador (1 leitura).
 * Se o doc não existir, inicializa com zeros sem varrer dados.
 */
async function atualizarBadgeUsuarios() {
  const badge = document.getElementById('badge-usuarios');
  if (!badge) return;
  try {
    const snap = await _CONTADOR_REF().get();

    if (!snap.exists) {
      // Doc não existe — cria com zeros e dispara recálculo automático
      await _CONTADOR_REF().set({
        solicitacoes: 0, feedbacks: 0, parcelas_vencidas: 0,
        criado_em: firebase.firestore.FieldValue.serverTimestamp(),
      });
      // Recalcula automaticamente para popular o contador
      recalcularContadores();
      return;
    }

    const d = snap.data();
    const sol = Math.max(0, d.solicitacoes || 0);
    const feed = Math.max(0, d.feedbacks || 0);
    const pag = Math.max(0, d.parcelas_vencidas || 0);
    const total = sol + feed + pag;

    // Se tudo está zerado, faz uma verificação rápida de sanidade:
    // conta solicitações abertas via collectionGroup para detectar dessincronização
    if (total === 0) {
      try {
        const chk = await db.collectionGroup('solicitacoes')
          .where('status', 'in', ['pendente', 'aberta'])
          .limit(1).get();
        if (!chk.empty) {
          // Contador dessincronizado — recalcula silenciosamente
          console.warn('[badge-usuarios] Contador dessincronizado, recalculando...');
          recalcularContadores();
          return;
        }
      } catch (e) { /* collectionGroup pode não ter índice ainda — ignora */ }
    }

    badge.textContent = total > 99 ? '99+' : String(total);
    badge.style.display = total > 0 ? 'inline' : 'none';
    badge.title = [
      `📬 Solicitações pendentes/abertas: ${sol}`,
      `💬 Feedbacks sem resposta: ${feed}`,
      `💳 Parcelas vencidas: ${pag}`,
    ].join('\n');
  } catch (e) {
    badge.style.display = 'none';
    console.warn('[badge-usuarios]', e.message);
  }
}

/**
 * Recálculo manual — varrre os dados e atualiza o doc.
 * Chamado apenas pelo admin via botão "Recalcular contadores".
 * Exige que as Firestore Rules permitam leitura admin de /usuarios.
 */
async function recalcularContadores() {
  if (_seedEmAndamento) return;
  _seedEmAndamento = true;
  mostrarMensagem('🔄 Recalculando contadores...');

  let solicitacoes = 0, feedbacks = 0, parcelas_vencidas = 0;
  const hoje = new Date();

  try {
    const usersSnap = await db.collection('usuarios').limit(500).get();
    await Promise.all(usersSnap.docs.map(async uDoc => {
      // Solicitações
      try {
        const s = await db.collection('usuarios').doc(uDoc.id)
          .collection('solicitacoes').where('status', 'in', ['pendente', 'aberta']).get();
        solicitacoes += s.size;
      } catch (e) { }

      // Parcelas vencidas
      try {
        const assinSnap = await db.collection('usuarios').doc(uDoc.id)
          .collection('assinaturas').get();
        await Promise.all(assinSnap.docs.map(async aDoc => {
          try {
            const pagSnap = await db.collection('usuarios').doc(uDoc.id)
              .collection('assinaturas').doc(aDoc.id)
              .collection('pagamentos').where('status', '==', 'pendente').get();
            pagSnap.forEach(pDoc => {
              const v = pDoc.data().data_vencimento;
              const vd = v ? (v.toDate ? v.toDate() : new Date(v)) : null;
              if (vd && vd < hoje) parcelas_vencidas++;
            });
          } catch (e) { }
        }));
      } catch (e) { }
    }));

    // Feedbacks — lê subcoleção /newsletters/{id}/feedbacks
    try {
      const nlSnap = await db.collection('newsletters')
        .where('enviada', '==', true).limit(100).get();
      await Promise.all(nlSnap.docs.map(async doc => {
        try {
          const fbSnap = await db.collection('newsletters').doc(doc.id)
            .collection('feedbacks').where('respondido', '==', false).get();
          feedbacks += fbSnap.size;
        } catch (e) {
          // Fallback: array legado
          const fbs = doc.data().feedbacks || [];
          feedbacks += fbs.filter(f => !f.respondido).length;
        }
      }));
    } catch (e) { }

    // Leads novos e mensagens não respondidas — via Supabase
    let leads_novos = 0, leads_mensagens = 0;
    try {
      if (window.supabase) {
        const { count: n } = await window.supabase.from('leads')
          .select('*', { count: 'exact', head: true }).eq('status', 'Novo');
        leads_novos = n || 0;

        // Mensagens via campo legado (leads.mensagem)
        const { count: mLegado } = await window.supabase.from('leads')
          .select('*', { count: 'exact', head: true })
          .or('mensagem_respondida.is.null,mensagem_respondida.eq.false')
          .not('mensagem', 'is', null);

        // Mensagens via nova tabela leads_mensagens (Fale Conosco)
        const { count: mNovo } = await window.supabase.from('leads_mensagens')
          .select('*', { count: 'exact', head: true })
          .eq('respondido', false);

        leads_mensagens = (mLegado || 0) + (mNovo || 0);
      }
    } catch (e) { console.warn('[recalcular] leads:', e.message); }

    await _CONTADOR_REF().set({
      solicitacoes, feedbacks, parcelas_vencidas,
      leads_novos, leads_mensagens,
      recalculado_em: firebase.firestore.FieldValue.serverTimestamp(),
    });

    mostrarMensagem(`✅ Contadores atualizados: ${solicitacoes} sol. | ${feedbacks} fb | ${parcelas_vencidas} parc. | ${leads_novos} leads novos | ${leads_mensagens} msg`);
    atualizarBadgeUsuarios();
  } catch (e) {
    mostrarMensagem('Erro no recálculo: ' + e.message);
    console.warn('[recalcular]', e);
  } finally {
    _seedEmAndamento = false;
  }
}

// ─── Abrir / Fechar ───────────────────────────────────────────────────────────
async function abrirDrawerUsuario(uid) {
  _drawerUid = uid;
  _drawerTabAtual = 'resumo';

  const overlay = document.getElementById('drawer-usuario-overlay');
  const drawer = document.getElementById('drawer-usuario');
  if (!overlay || !drawer) return;

  overlay.style.display = 'flex';
  requestAnimationFrame(() => drawer.classList.add('open'));

  document.getElementById('drawer-usuario-nome').textContent = 'Carregando...';
  document.getElementById('drawer-usuario-sub').textContent = '';
  document.getElementById('drawer-usuario-body').innerHTML =
    '<div class="drawer-loading">⏳ Carregando dados...</div>';

  try {
    const doc = await db.collection('usuarios').doc(uid).get();
    _drawerDados = doc.exists ? doc.data() : {};
    document.getElementById('drawer-usuario-nome').textContent =
      _drawerDados.nome || _drawerDados.email || 'Usuário';
    document.getElementById('drawer-usuario-sub').textContent =
      [_drawerDados.tipo_perfil, _drawerDados.email].filter(Boolean).join(' · ');
  } catch (e) { _drawerDados = {}; }

  _ativarDrawerTab('resumo');
}

function fecharDrawerUsuario() {
  const drawer = document.getElementById('drawer-usuario');
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
    resumo: _renderResumo,
    pagamentos: _renderPagamentos,
    solicitacoes: _renderSolicitacoes,
    envios: _renderEnvios,
    interacoes: _renderInteracoes,
    acesso: _renderAcesso,
  };
  if (fn[tab]) fn[tab]();
}

// ─── ABA: RESUMO ─────────────────────────────────────────────────────────────
async function _renderResumo() {
  const body = document.getElementById('drawer-usuario-body');
  const d = _drawerDados, uid = _drawerUid;
  try {
    // 1. Buscar features ativas DIRETAMENTE no Firestore (ignora cache para dados atualizados)
    let featuresList = [];
    try {
      const snap = await db.collection('features').where('ativo', '==', true).get();

      featuresList = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(f => f.ativo === true)          // Filtro extra de segurança
        .sort((a, b) => (a.ordem || 99) - (b.ordem || 99)); // Ordenação client-side (evita erro de índice)
    } catch (e) {
      console.warn('[drawer-usuario] Erro ao carregar features:', e.message);
    }

    const assinSnap = await db.collection('usuarios').doc(uid).collection('assinaturas').get();
    let assinHtml = assinSnap.empty ? '<p style="color:#94a3b8;font-size:13px">Nenhuma assinatura.</p>' : '';

    for (const doc of assinSnap.docs) {
      const a = doc.data();
      const c = _stColor(a.status);
      const assinId = doc.id;
      const userFeats = a.features_snapshot || {};

      // Exibição visual das features ativas na assinatura
      const feats = featuresList
        .filter(f => (a.features_snapshot || {})[f.id])
        .map(f => `<span style="background:#0284c720;color:#0284c7;border:1px solid #0284c740;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:700">${f.icone} ${f.nome}</span>`)
        .join('');

      // Checkboxes para edição (dinâmico, baseado na coleção features)
      const featChecks = featuresList.map(f => {
        const valor = userFeats[f.id];

        // Renderização condicional por tipo
        if (f.tipo === 'number') {
          const unidade = f.unidade ? ` ${f.unidade}` : '';
          return `
          <div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 6px;border-radius:6px;background:#f8fafc;border:1px solid #e2e8f0">
            <span style="font-weight:600">${f.icone} ${f.nome}</span>
            <input type="number" data-feat="${f.id}" value="${Number(valor) || 0}" min="0" max="999" 
              style="width:70px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px">
            ${unidade ? `<span style="color:#64748b;font-size:11px">${unidade}</span>` : ''}
          </div>`;
        }

        if (f.tipo === 'text') {
          return `
          <div style="display:flex;flex-direction:column;gap:4px;font-size:12px;padding:4px 6px;border-radius:6px;background:#f8fafc;border:1px solid #e2e8f0">
            <span style="font-weight:600">${f.icone} ${f.nome}</span>
            <input type="text" data-feat="${f.id}" value="${(valor || '').toString().replace(/"/g, '&quot;')}" 
              style="width:100%;padding:4px 6px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px" placeholder="Digite o valor...">
          </div>`;
        }

        // Boolean (padrão)
        const isChecked = !!valor;
        const bg = isChecked ? '#e0f2fe' : '#f1f5f9';
        const border = isChecked ? '#0284c740' : '#e2e8f0';
        return `
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;padding:4px 6px;border-radius:6px;background:${bg};border:1px solid ${border}">
          <input type="checkbox" data-feat="${f.id}" ${isChecked ? 'checked' : ''} style="width:14px;height:14px;cursor:pointer">
          ${f.icone} ${f.nome}
        </label>`;
      }).join('');

      assinHtml += `
        <div style="border-left:4px solid ${c};border-radius:8px;background:#f8fafc;padding:10px 12px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div style="font-weight:700;font-size:13px">${a.plano_nome || a.plano_slug || 'Plano'}</div>
              <div style="font-size:11px;color:#64748b">${a.ciclo || ''} · ${_fmtBRL((a.valor_final || 0) * 100 || a.amountCentavos)}</div>
            </div>
            ${_stBadge(a.status)}
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:6px">
            📅 Início: <strong>${_fmtData(a.data_inicio)}</strong>
            &nbsp;&nbsp;🔄 Renovação: <strong>${_fmtData(a.data_proxima_renovacao)}</strong>
          </div>
          ${feats ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">${feats}</div>` : ''}
          <div style="margin-top:8px">
            <button onclick="
              const p = this.nextElementSibling;
              const aberto = p.style.display !== 'none';
              p.style.display = aberto ? 'none' : 'block';
              this.textContent = aberto ? '⚙️ Editar features' : '▲ Fechar';
            " style="font-size:11px;padding:3px 10px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;color:#0A3D62;font-weight:600">
              ⚙️ Editar features
            </button>
            ${a.status === 'ativa' || a.status === 'ativo' ? `
            <button onclick="_gerarEnviarLinkProativo('${uid}','${assinId}',this)"
              style="font-size:11px;padding:3px 10px;border-radius:6px;border:1px solid #0284c7;
                     background:#e0f2fe;cursor:pointer;color:#0284c7;font-weight:600;margin-left:6px">
              🔗 Gerar e enviar link
            </button>` : ''}
            <div style="display:none;margin-top:8px" id="feat-panel-${assinId}">
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
                ${featChecks}
              </div>
              <button onclick="_salvarFeatures('${uid}','${assinId}',this)" style="font-size:12px;padding:4px 14px;border-radius:6px;border:none;background:#0A3D62;color:#fff;cursor:pointer;font-weight:600">
                💾 Salvar features
              </button>
              <span id="feat-status-${assinId}" style="font-size:11px;color:#64748b;margin-left:8px"></span>
            </div>
          </div>
        </div>`;
    }

    // 🆕 GERAÇÃO DAS FEATURES DO USUÁRIO (ANTES do body.innerHTML)
    const userFeatChecksUsuario = (() => {
      const userFeatsNivelUsuario = _drawerDados.features || {};
      return featuresList.map(f => {
        const valor = userFeatsNivelUsuario[f.id];
        if (f.tipo === 'number') {
          const unidade = f.unidade ? ` ${f.unidade}` : '';
          return `<div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 6px;border-radius:6px;background:#f8fafc;border:1px solid #e2e8f0">
            <span style="font-weight:600">${f.icone} ${f.nome}</span>
            <input type="number" data-feat="${f.id}" value="${Number(valor) || 0}" min="0" max="999" style="width:70px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px">${unidade ? `<span style="color:#64748b;font-size:11px">${unidade}</span>` : ''}
          </div>`;
        }
        if (f.tipo === 'text') {
          return `<div style="display:flex;flex-direction:column;gap:4px;font-size:12px;padding:4px 6px;border-radius:6px;background:#f8fafc;border:1px solid #e2e8f0">
            <span style="font-weight:600">${f.icone} ${f.nome}</span>
            <input type="text" data-feat="${f.id}" value="${(valor || '').toString().replace(/"/g, '&quot;')}" style="width:100%;padding:4px 6px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px" placeholder="Digite o valor...">
          </div>`;
        }
        const isChecked = !!valor;
        const bg = isChecked ? '#e0f2fe' : '#f1f5f9';
        const border = isChecked ? '#0284c740' : '#e2e8f0';
        return `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;padding:4px 6px;border-radius:6px;background:${bg};border:1px solid ${border}">
          <input type="checkbox" data-feat="${f.id}" ${isChecked ? 'checked' : ''} style="width:14px;height:14px;cursor:pointer">${f.icone} ${f.nome}
        </label>`;
      }).join('');
    })();

    // ✅ Agora sim: body.innerHTML pode usar userFeatChecksUsuario
    body.innerHTML = `
      <div class="drawer-secao">
        <div class="drawer-secao-titulo">👤 Dados do usuário</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
          <div><span style="color:#64748b;font-size:11px">Nome</span><br><strong>${d.nome || '—'}</strong></div>
          <div><span style="color:#64748b;font-size:11px">E-mail</span><br><strong>${d.email || '—'}</strong></div>
          <div><span style="color:#64748b;font-size:11px">Perfil</span><br><strong>${d.tipo_perfil || '—'}</strong></div>
          <div><span style="color:#64748b;font-size:11px">Situação</span><br>${_stBadge(d.ativo ? 'ativo' : 'inativo')}</div>
          <div><span style="color:#64748b;font-size:11px">UF / Município</span><br><strong>${d.cod_uf || '—'} / ${d.nome_municipio || '—'}</strong></div>
          <div><span style="color:#64748b;font-size:11px">Telefone</span><br><strong>${d.telefone || '—'}</strong></div>
          <div><span style="color:#64748b;font-size:11px">Cadastro</span><br><strong>${_fmtData(d.data_cadastro)}</strong></div>
          <div><span style="color:#64748b;font-size:11px">Pref. contato</span><br><strong>${d.preferencia_contato || '—'}</strong></div>
        </div>
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-drawer-sm" onclick="abrirModalEditarUsuario('${uid}')">✏️ Editar</button>
          <button class="btn-drawer-sm" onclick="abrirModalEnvioManual('${uid}')">📧 Enviar e-mail</button>
        </div>
      </div>

      🆕  <div class="drawer-secao">
              <div class="drawer-secao-titulo">⚙️ Features do Usuário (Cortesia)</div>
              <div style="font-size:11px;color:#64748b;margin-bottom:8px;padding:6px 8px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;">
                💡 Estas features são <strong>concessões administrativas</strong> (fallback). A fonte da verdade do plano contratado está nas features da assinatura abaixo.
          </div>
          <div id="feat-panel-usuario">
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${userFeatChecksUsuario}</div>
          <div style="margin-bottom:8px">
              <label style="font-size:11px;font-weight:700;color:#334155;display:block;margin-bottom:3px">
                  📝 Motivo da alteração (opcional)
              </label>
              <input id="feat-motivo-usuario" type="text"
                placeholder="Ex: Retenção - cliente insatisfeito / Cortesia 3 meses / Teste"
                style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;box-sizing:border-box">
          </div>
          <button onclick="_salvarFeaturesUsuario('${uid}', this)" style="font-size:12px;padding:4px 14px;border-radius:6px;border:none;background:#0A3D62;color:#fff;cursor:pointer;font-weight:600">
              💾 Salvar features
          </button>
          <span id="feat-status-usuario" style="font-size:11px;color:#64748b;margin-left:8px"></span>
        </div>
      </div>

   🆕 <div id="feat-cortesia-log-${uid}" class="drawer-secao" style="display:none">
     <div class="drawer-secao-titulo">📜 Histórico de Cortesias</div>
     <div id="feat-cortesia-log-body-${uid}">
       <div class="drawer-loading">⏳ Carregando...</div>
     </div>
   </div>

      <div class="drawer-secao">
        <div class="drawer-secao-titulo">📑 Assinaturas</div>
        ${assinHtml}
      </div>`;
        // ✅ Carrega histórico de cortesias (fire-and-forget, não bloqueia)
        _carregarLogCortesia(uid);
  } catch (e) {
    body.innerHTML = `<p style="color:#ef4444">Erro: ${e.message}</p>`;
  }
}

// ─── SALVAR FEATURES DE ASSINATURA ───────────────────────────────────────────
async function _salvarFeatures(uid, assinId, btn) {
  const panel = document.getElementById(`feat-panel-${assinId}`);
  const status = document.getElementById(`feat-status-${assinId}`);

  // Coleta valores de todos os inputs [data-feat], respeitando o tipo
  const inputs = panel.querySelectorAll('[data-feat]');
  const novasFeatures = {};

  inputs.forEach(input => {
    const featId = input.dataset.feat;
    const tipo = input.type; // 'checkbox', 'number', 'text'

    if (tipo === 'checkbox') {
      novasFeatures[featId] = input.checked;
    } else if (tipo === 'number') {
      const val = Number(input.value);
      novasFeatures[featId] = isNaN(val) ? 0 : val;
    } else if (tipo === 'text') {
      novasFeatures[featId] = input.value.trim();
    }
  });

  btn.disabled = true;
  btn.textContent = '⏳ Salvando...';
  status.textContent = '';

  try {
    await db.collection('usuarios').doc(uid)
      .collection('assinaturas').doc(assinId)
      .update({ features_snapshot: novasFeatures });

    status.textContent = '✅ Salvo!';
    status.style.color = '#16a34a';
    setTimeout(() => { status.textContent = ''; }, 3000);

  } catch (e) {
    status.textContent = '❌ Erro: ' + e.message;
    status.style.color = '#dc2626';
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Salvar features';
  }
}

// ─── ABA: PAGAMENTOS ─────────────────────────────────────────────────────────
async function _renderPagamentos() {
  const body = document.getElementById('drawer-usuario-body');
  const uid = _drawerUid;
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
        .collection('pagamentos').get();

      if (pagSnap.empty) continue;

      let linhas = '';
      pagSnap.forEach(pd => {
        const p = pd.data();
        const status = (p.status || '').toLowerCase();
        const venc = p.data_vencimento?.toDate?.() || null;
        const vencido = venc && status !== 'pago' && venc < hoje;
        if (vencido) totalVencido++;
        else if (status === 'pendente') totalPendente++;

        const rowBg = vencido ? '#fff1f2' : status === 'pago' ? '#f0fdf4' : '';
        const parcela = p.numero_parcela
          ? `Parc. ${p.numero_parcela}${p.mpInstallments > 1 ? `/${p.mpInstallments}` : ''}` : 'Pgto.';

        linhas += `
          <tr style="background:${rowBg}">
            <td style="padding:5px 6px;font-size:12px">${parcela}</td>
            <td style="padding:5px 6px;font-size:12px">${_fmtData(p.data_pagamento || p.data_vencimento)}</td>
            <td style="padding:5px 6px">${_stBadge(vencido ? 'vencido' : p.status)}</td>
            <td style="padding:5px 6px;font-size:11px;color:#64748b">${p.mpPaymentMethod || p.metodo_pagamento || '—'}</td>
            <td style="padding:5px 6px;font-size:13px;font-weight:700;text-align:right">
              ${_fmtBRL(p.valor_centavos || (p.valor ? (p.valor * 100) : null))}</td>
            <td style="padding:5px 6px">
              <span class="icon-btn" title="Editar"
                onclick="abrirModalSubItem('${uid}','assinaturas/${assinDoc.id}/pagamentos','${pd.id}',true)">✏️</span>
            </td>
          </tr>`;
      });

      html += `
        <div class="drawer-secao">
          <div class="drawer-secao-titulo">
            📑 ${a.plano_nome || a.plano_slug || 'Plano'} &nbsp; ${_stBadge(a.status)}
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
            <tbody>${linhas || '<tr><td colspan="6" style="color:#94a3b8;padding:8px;font-size:12px">Nenhum pagamento.</td></tr>'}</tbody>
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
    if (totalVencido) alertas += `<div class="drawer-alerta vermelho">🔴 <strong>${totalVencido}</strong> parcela(s) vencida(s)</div>`;
    if (totalPendente) alertas += `<div class="drawer-alerta amarelo">⚠️ <strong>${totalPendente}</strong> parcela(s) pendente(s)</div>`;

    body.innerHTML = alertas + (html || '<p style="color:#94a3b8;font-size:13px">Nenhum pagamento.</p>');
  } catch (e) {
    body.innerHTML = `<p style="color:#ef4444">Erro: ${e.message}</p>`;
  }
}

// ─── ENVIAR MENSAGEM DIRETA AO ASSINANTE ─────────────────────────────────────
async function _enviarMensagemAdmin(uid, btn) {
  const titulo = document.getElementById('rs-admmsg-titulo')?.value?.trim();
  const corpo  = document.getElementById('rs-admmsg-corpo')?.value?.trim();
  const permite = document.getElementById('rs-admmsg-permite')?.checked || false;
  const status  = document.getElementById('rs-admmsg-status');

  if (!titulo) { status.textContent = '⚠️ Informe um título.'; status.style.color = '#d97706'; return; }
  if (!corpo)  { status.textContent = '⚠️ Informe o corpo da mensagem.'; status.style.color = '#d97706'; return; }

  const admin = JSON.parse(localStorage.getItem('usuarioLogado') || '{}');
  btn.disabled = true; btn.textContent = '⏳ Enviando...'; status.textContent = '';

  try {
    await db.collection('usuarios').doc(uid).collection('solicitacoes').add({
      tipo: 'mensagem_admin',
      titulo,
      descricao: corpo,
      status: 'atendida',
      permite_resposta: permite,
      lida: false,
      enviado_por: admin.nome || admin.email || 'Admin',
      data_solicitacao: new Date().toISOString(),
    });

    status.textContent = '✅ Mensagem enviada!'; status.style.color = '#16a34a';
    document.getElementById('rs-admmsg-titulo').value = '';
    document.getElementById('rs-admmsg-corpo').value = '';
    document.getElementById('rs-admmsg-chars').textContent = '0/500';

    // Recarrega lista de mensagens enviadas
    await _carregarMensagensAdmin(uid);
    setTimeout(() => { status.textContent = ''; }, 3000);
  } catch (e) {
    status.textContent = '❌ Erro: ' + e.message; status.style.color = '#dc2626';
  } finally {
    btn.disabled = false; btn.textContent = '📨 Enviar mensagem';
  }
}
window._enviarMensagemAdmin = _enviarMensagemAdmin;

async function _carregarMensagensAdmin(uid) {
  const wrap = document.getElementById('rs-admmsg-historico');
  if (!wrap) return;
  wrap.innerHTML = '<div style="color:#94a3b8;font-size:12px;padding:8px 0">⏳ Carregando...</div>';
  try {
    const snap = await db.collection('usuarios').doc(uid)
      .collection('solicitacoes')
      .where('tipo', '==', 'mensagem_admin')
      .orderBy('data_solicitacao', 'desc')
      .limit(10)
      .get();

    if (snap.empty) {
      wrap.innerHTML = '<div style="color:#94a3b8;font-size:12px;padding:6px 0">Nenhuma mensagem enviada ainda.</div>';
      return;
    }

    wrap.innerHTML = snap.docs.map(doc => {
      const m = doc.data();
      let dataStr = '—';
      try { dataStr = new Date(m.data_solicitacao).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }); } catch (e) {}
      const lidaLabel = m.lida
        ? `<span style="color:#22c55e;font-size:10px;font-weight:700">✅ Lida</span>`
        : `<span style="color:#f59e0b;font-size:10px;font-weight:700">👁 Não lida</span>`;
      const respostaHtml = m.resposta_assinante
        ? `<div style="margin-top:6px;padding:6px 8px;background:#eff6ff;border-left:3px solid #3b82f6;border-radius:0 4px 4px 0;font-size:11px;color:#1e40af">
            <span style="font-weight:700;font-size:10px;display:block;margin-bottom:2px">💬 Resposta do assinante</span>
            ${m.resposta_assinante}
           </div>` : '';
      return `
        <div style="border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;margin-bottom:6px;background:#fff;font-size:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
            <strong style="color:#0A3D62;font-size:12px">${m.titulo || '—'}</strong>
            <div style="display:flex;gap:6px;align-items:center">${lidaLabel}<span style="color:#94a3b8;font-size:10px">${dataStr}</span></div>
          </div>
          <div style="color:#475569;line-height:1.4">${m.descricao || ''}</div>
          <div style="margin-top:4px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            ${m.permite_resposta ? '<span style="font-size:10px;color:#0284c7;background:#e0f2fe;padding:1px 6px;border-radius:10px;font-weight:600">Permite resposta</span>' : '<span style="font-size:10px;color:#94a3b8">Sem resposta</span>'}
          </div>
          ${respostaHtml}
        </div>`;
    }).join('');
  } catch (e) {
    wrap.innerHTML = `<div style="color:#ef4444;font-size:12px">Erro: ${e.message}</div>`;
  }
}
window._carregarMensagensAdmin = _carregarMensagensAdmin;

function _toggleMensagemAdmin(uid) {
  const painel = document.getElementById('rs-admmsg-painel');
  const chevron = document.getElementById('rs-admmsg-chevron');
  if (!painel) return;
  const aberto = painel.style.display !== 'none';
  painel.style.display = aberto ? 'none' : 'block';
  if (chevron) chevron.textContent = aberto ? '▸' : '▾';
  if (!aberto) _carregarMensagensAdmin(uid);
}
window._toggleMensagemAdmin = _toggleMensagemAdmin;

// ─── ABA: SOLICITAÇÕES ───────────────────────────────────────────────────────
async function _renderSolicitacoes() {
  const body = document.getElementById('drawer-usuario-body');
  const uid = _drawerUid;
  try {
    const snap = await db.collection('usuarios').doc(uid)
      .collection('solicitacoes')
      .orderBy('data_solicitacao', 'desc')
      .get();

    // Bloco "Enviar mensagem direta" — expansível, no topo da aba
    let html = `
      <div style="border:1px solid #bfdbfe;border-radius:8px;background:#eff6ff;margin-bottom:12px;overflow:hidden">
        <button onclick="_toggleMensagemAdmin('${uid}')"
          style="width:100%;display:flex;justify-content:space-between;align-items:center;
                 padding:10px 12px;background:transparent;border:none;cursor:pointer;
                 font-size:13px;font-weight:700;color:#1e40af;text-align:left">
          <span>📣 Enviar mensagem ao assinante</span>
          <span id="rs-admmsg-chevron" style="font-size:12px;color:#3b82f6">▸</span>
        </button>
        <div id="rs-admmsg-painel" style="display:none;padding:0 12px 12px">
          <div style="display:flex;flex-direction:column;gap:8px">
            <div>
              <label style="font-size:11px;font-weight:700;color:#1e40af;display:block;margin-bottom:3px">Título</label>
              <input id="rs-admmsg-titulo" type="text" maxlength="80"
                placeholder="Ex: Atualização sobre seu acesso"
                style="width:100%;padding:7px 9px;border:1px solid #bfdbfe;border-radius:6px;
                       font-size:12px;box-sizing:border-box;background:#fff;color:#0f172a">
            </div>
            <div>
              <label style="font-size:11px;font-weight:700;color:#1e40af;display:block;margin-bottom:3px">Mensagem</label>
              <textarea id="rs-admmsg-corpo" maxlength="500"
                placeholder="Escreva a mensagem para o assinante…"
                oninput="document.getElementById('rs-admmsg-chars').textContent=this.value.length+'/500'"
                style="width:100%;min-height:80px;padding:7px 9px;border:1px solid #bfdbfe;border-radius:6px;
                       font-size:12px;resize:vertical;box-sizing:border-box;background:#fff;color:#0f172a;
                       font-family:inherit"></textarea>
              <div id="rs-admmsg-chars" style="font-size:10px;color:#94a3b8;text-align:right">0/500</div>
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#1e40af;cursor:pointer">
              <input id="rs-admmsg-permite" type="checkbox"
                style="width:14px;height:14px;cursor:pointer;accent-color:#3b82f6">
              Permitir que o assinante responda esta mensagem
            </label>
            <div style="display:flex;align-items:center;gap:10px">
              <button onclick="_enviarMensagemAdmin('${uid}', this)"
                style="padding:7px 16px;background:#1d4ed8;color:#fff;border:none;border-radius:6px;
                       font-size:12px;font-weight:700;cursor:pointer">
                📨 Enviar mensagem
              </button>
              <span id="rs-admmsg-status" style="font-size:11px"></span>
            </div>
          </div>

          <div style="margin-top:12px;padding-top:10px;border-top:1px solid #bfdbfe">
            <div style="font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;
                        letter-spacing:0.5px;margin-bottom:6px">Mensagens enviadas</div>
            <div id="rs-admmsg-historico">
              <div style="color:#94a3b8;font-size:12px">Expanda para carregar.</div>
            </div>
          </div>
        </div>
      </div>`;

    if (snap.empty) {
      body.innerHTML = html + '<p style="color:#94a3b8;font-size:13px">Nenhuma solicitação.</p>';
      return;
    }

    let pendentes = 0;

    snap.forEach(doc => {
      const s = doc.data();
      const status = (s.status || 'pendente').toLowerCase();

      // ✅ FILTRO 1: Ignorar completamente sugestões de tema e mensagens admin (têm bloco próprio)
      if (s.tipo === 'sugestao_tema' || s.tipo === 'mensagem_admin') return;

      // ✅ FILTRO 2: Contar pendentes apenas para tipos permitidos
      //const tiposPermitidos = ['mensagem', 'cancelamento','treinamento'];
      //if (!tiposPermitidos.includes(s.tipo)) return;

      if (status === 'aberta' || status === 'pendente' || status === 'cancelamento_pendente_multa') {
        pendentes++;
      }

      const c = _stColor(status);
      const isCancel = s.tipo === 'cancelamento';
      const calculo = s.calculo_multa || {};
      const valorMulta = Number(calculo.valor_ajuste || 0);

      // ✅ FILTRO 3: Botões de ação apenas para tipos permitidos
      let acoes = '';

      // ✅ Resposta exibida quando status for "atendida"
      let respostaHtml = '';
      if (status === 'atendida' && s.resposta) {
        respostaHtml = `
          <div style="margin-top:8px;padding:8px 10px;background:#f0fdf4;
            border-left:3px solid #22c55e;border-radius:0 6px 6px 0">
            <div style="font-size:10px;font-weight:700;color:#16a34a;
              text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">
              ✅ Resposta da equipe · ${_fmtHora(s.data_resposta)}
            </div>
            <div style="font-size:12px;color:#334155;line-height:1.4;white-space:pre-wrap">
              ${s.resposta}
            </div>
          </div>`;
      }

      // Botões para "mensagem" (com botão Responder)
      //if (s.tipo === 'mensagem' && (status === 'aberta' || status === 'pendente')) {
      if (status === 'aberta' || status === 'pendente') {
        acoes = `
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
            <button class="btn-drawer-sm" onclick="_drawerResponderSolicitacao('${uid}','${doc.id}','atendida')">✍️ Responder</button>
          </div>`;
      }

      // Botões exclusivos para CANCELAMENTO
      if (isCancel) {
        if (status === 'aberta' || status === 'pendente') {
          acoes = `
            <div style="margin-top:8px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:12px">
              <div style="font-weight:600;margin-bottom:6px;color:#0A3D62">⛔ Cálculo de Fidelização (Pré-aprovado)</div>
              <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 8px;color:#475569;line-height:1.5">
                <span>📅 Meses usados:</span><strong>${calculo.meses_usados || '—'}</strong>
                <span>🔒 Fidelização até:</span><strong>${calculo.data_fim_fidelizacao ? new Date(calculo.data_fim_fidelizacao).toLocaleDateString('pt-BR') : 'Não se aplica'}</strong>
                <span>💰 Desconto/mês:</span><strong>${calculo.desconto_mensal ? calculo.desconto_mensal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00'}</strong>
                <span>🧾 Valor do ajuste:</span><strong style="color:${valorMulta > 0 ? '#b45309' : '#16a34a'};font-size:13px">${valorMulta.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
              </div>
              ${valorMulta > 0
              ? `<button class="btn-drawer-sm" style="background:#2563eb;color:#fff;border:none;margin-top:8px;width:100%" onclick="_gerarLinkMulta('${uid}','${doc.id}',${valorMulta})">🔗 Gerar Link de Multa (MP)</button>`
              : `<button class="btn-drawer-sm btn-verde" style="margin-top:8px;width:100%" onclick="_confirmarEncerramentoDireto('${uid}','${doc.id}')">✅ Confirmar Encerramento (Isento)</button>`
            }
            </div>`;
        } else if (status === 'cancelamento_pendente_multa' && s.mp_link_multa) {
          acoes = `
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
              <button class="btn-drawer-sm" style="background:#2563eb;color:#fff;border:none" onclick="window.open('${s.mp_link_multa}', '_blank')">🔍 Visualizar Pagamento</button>
              <button class="btn-drawer-sm btn-verde" onclick="_confirmarEncerramentoFinal('${uid}','${doc.id}')">✅ Confirmar Encerramento</button>
            </div>`;
        } else if (status === 'multa_pago' || status === 'cancelada') {
          acoes = `<div style="margin-top:6px;font-size:12px;color:#22c55e">✅ Processo finalizado</div>`;
        }
      }

      // ── Botões exclusivos para SOLICITAR LINK DE ACESSO ──────────────────
      const isLinkAcesso = s.tipo === 'solicitar_link_acesso';
      if (isLinkAcesso) {
        const assinaturaId = s.assinaturaId || '';
        const selfCount = s.self_count_no_momento != null ? s.self_count_no_momento : '—';

        if (status === 'aberta' || status === 'pendente') {
          acoes = `
            <div style="margin-top:8px;padding:10px;background:#fffbeb;border:1px solid #fde68a;
              border-radius:6px;font-size:12px">
              <div style="font-weight:600;margin-bottom:4px;color:#92400e">
                🔗 Solicitação de Link de Acesso
              </div>
              <div style="color:#78350f;font-size:11px;margin-bottom:8px">
                Uso self-service no momento da solicitação: <strong>${selfCount}/3</strong>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn-drawer-sm btn-verde"
                  onclick="_enviarLinkAcessoAdmin('${uid}','${doc.id}','${assinaturaId}',false)"
                  title="Gera novo token e envia e-mail. Contador permanece em 3.">
                  🔗 Enviar novo link
                </button>
                <button class="btn-drawer-sm"
                  style="background:#7c3aed;color:#fff;border:none"
                  onclick="_enviarLinkAcessoAdmin('${uid}','${doc.id}','${assinaturaId}',true)"
                  title="Zera o contador self-service, gera novo token e envia e-mail.">
                  🔄 Resetar contador + enviar link
                </button>
              </div>
            </div>`;
        } else if (status === 'atendida') {
          acoes = `<div style="margin-top:6px;font-size:12px;color:#22c55e">✅ Link enviado por e-mail.</div>`;
        }
      }

      // Renderização do card da solicitação
      html += `
        <div id="sol-card-${doc.id}" style="border-left:4px solid ${c};border-radius:8px;background:#f8fafc;padding:10px 12px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div style="min-width:0;flex:1">
              <div style="font-weight:700;font-size:13px">${s.tipo || '—'}</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px">${s.descricao || s.texto || '—'}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px">📅 ${_fmtHora(s.data_solicitacao)}</div>
            </div>
            <div style="margin-left:8px;flex-shrink:0">${_stBadge(status)}</div>
          </div>
          ${acoes}
          ${respostaHtml}  
        </div>`;
    });

    // Alerta de pendentes (apenas para tipos filtrados)
    if (pendentes) {
      html = `<div class="drawer-alerta amarelo">🟠 <strong>${pendentes}</strong> solicitação(ões) aguardando atendimento</div>` + html;
    }

    body.innerHTML = html || '<p style="color:#94a3b8;font-size:13px">Nenhuma solicitação.</p>';

  } catch (e) {
    body.innerHTML = `<p style="color:#ef4444">Erro: ${e.message}</p>`;
  }
}

// ─── Modal para gerar link MP usando o valor JÁ CALCULADO ─────────────────────
async function _abrirModalGerarLinkMulta(uid, solId, valorReais) {
  const valor = Number(valorReais) || 0;
  const mensagem = `Gerar link de cobrança de ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} para o assinante?`;

  if (!confirm(mensagem)) return;

  const btn = event.target;
  btn.disabled = true;
  btn.textContent = '⏳ Gerando...';

  try {
    const resp = await fetch('/api/pagamentoMP?acao=gerar-cobranca-cancelamento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, solicitacaoId: solId, valorReais: valor })
    });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.message || 'Erro ao gerar link');

    await db.collection('usuarios').doc(uid).collection('solicitacoes').doc(solId)
      .update({
        status: 'cancelamento_pendente_multa',
        mp_link_multa: data.link,
        mp_preference_multa: data.preferenceId,
        atualizadoEm: new Date().toISOString()
      });

    mostrarMensagem('✅ Link gerado! O assinante poderá pagar pelo painel ou por e-mail.');
    _ativarDrawerTab('solicitacoes');
  } catch (e) {
    mostrarMensagem('❌ Erro ao gerar link: ' + e.message);
  }
}

// Não esqueça de exportar a função no final do arquivo:
window._abrirModalGerarLinkMulta = _abrirModalGerarLinkMulta;

// ─── Encerramento direto (quando multa = R$ 0,00) ───────────────────────────
async function _confirmarEncerramentoDireto(uid, solId) {
  if (!confirm('Confirmar encerramento da assinatura sem cobrança de multa?')) return;
  try {
    // 1. Busca assinatura ativa
    const assSnap = await db.collection('usuarios').doc(uid).collection('assinaturas')
      .where('status', 'in', ['ativa', 'aprovada']).limit(1).get();
    if (assSnap.empty) throw new Error('Assinatura ativa não encontrada.');
    const assinId = assSnap.docs[0].id;

    // 2. Atualiza tudo em batch
    const batch = db.batch();
    batch.update(db.collection('usuarios').doc(uid).collection('assinaturas').doc(assinId), {
      status: 'cancelada',
      cancelado_em: new Date().toISOString(),
      atualizadoEm: new Date().toISOString()
    });
    batch.update(db.collection('usuarios').doc(uid).collection('solicitacoes').doc(solId), {
      status: 'cancelada',
      resposta: 'Cancelamento processado e encerrado pelo administrador (isento de multa).',
      data_resposta: new Date().toISOString(),
      atualizadoEm: new Date().toISOString()
    });
    // 3. Desativa sessões
    const sessoes = await db.collection('usuarios').doc(uid).collection('sessoes').where('ativo', '==', true).get();
    sessoes.docs.forEach(doc => batch.update(doc.ref, { ativo: false, desativado_motivo: 'cancelamento_admin' }));

    await batch.commit();
    mostrarMensagem('✅ Encerramento confirmado. Sessões desativadas.');
    _ativarDrawerTab('solicitacoes');
    atualizarBadgeUsuarios();
  } catch (e) {
    mostrarMensagem('❌ Erro: ' + e.message);
  }
}

// ─── Confirmar Encerramento ─────────────────────────────────────────────────
async function _confirmarEncerramentoCancelamento(uid, solId) {
  if (!confirm('Confirmar o encerramento definitivo da assinatura? Esta ação não pode ser desfeita.')) return;
  try {
    // Busca assinatura ativa
    const assSnap = await db.collection('usuarios').doc(uid).collection('assinaturas').where('status', 'in', ['ativa', 'aprovada', 'cancelamento_pendente_multa', 'multa_pago']).limit(1).get();
    if (assSnap.empty) throw new Error('Assinatura não encontrada.');
    const assinId = assSnap.docs[0].id;

    const batch = db.batch();
    // 1. Atualiza assinatura
    batch.update(db.collection('usuarios').doc(uid).collection('assinaturas').doc(assinId), {
      status: 'cancelada',
      cancelado_em: admin.firestore.FieldValue.serverTimestamp(),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
    });
    // 2. Atualiza solicitação
    batch.update(db.collection('usuarios').doc(uid).collection('solicitacoes').doc(solId), {
      status: 'cancelada',
      resposta: 'Cancelamento processado e encerrado pelo administrador.',
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
    });
    // 3. Desativa sessões
    const sessoes = await db.collection('usuarios').doc(uid).collection('sessoes').where('ativo', '==', true).get();
    sessoes.docs.forEach(doc => batch.update(doc.ref, { ativo: false, desativado_motivo: 'cancelamento_admin' }));

    await batch.commit();
    mostrarMensagem('✅ Encerramento confirmado. Sessões desativadas.');
    _ativarDrawerTab('solicitacoes');
    await atualizarBadgeUsuarios();
  } catch (e) { mostrarMensagem('Erro: ' + e.message); }
}

// Não esqueça de exportar no final do arquivo:
window._abrirModalProcessarCancelamento = _abrirModalProcessarCancelamento;
window._confirmarEncerramentoCancelamento = _confirmarEncerramentoCancelamento;
window._gerarLinkMulta = _gerarLinkMulta;

// Responder solicitação → mostra campo inline, decrementa contador, dispara push
async function _drawerResponderSolicitacao(uid, solId, novoStatus) {
  // Abre modal inline de resposta
  const body = document.getElementById('drawer-usuario-body');
  const solRef = db.collection('usuarios').doc(uid).collection('solicitacoes').doc(solId);
  const solSnap = await solRef.get();
  if (!solSnap.exists) return;
  const sol = solSnap.data();

  // Injeta form inline no card da solicitação
  const cardId = `sol-card-${solId}`;
  const card = document.getElementById(cardId);
  if (!card) {
    // Fallback — recarrega aba e usa prompt
    const resposta = prompt(`Resposta para o usuário:`);
    if (!resposta) return;
    await _salvarResposta(uid, solId, solSnap, novoStatus, resposta);
    return;
  }

  // Injeta form de resposta inline
  card.insertAdjacentHTML('beforeend', `
    <div id="rs-resp-form-${solId}" style="margin-top:10px">
      <textarea id="rs-resp-txt-${solId}"
        style="width:100%;background:#f1f5f9;border:1px solid #cbd5e1;
               border-radius:6px;padding:8px;font-size:13px;resize:vertical;min-height:80px"
        placeholder="Digite a resposta para o usuário…" maxlength="500"></textarea>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn-drawer-sm btn-verde"
          onclick="_confirmarResposta('${uid}','${solId}','${novoStatus}')">
          ✅ Enviar resposta
        </button>
        <button class="btn-drawer-sm"
          onclick="document.getElementById('rs-resp-form-${solId}').remove()">
          Cancelar
        </button>
      </div>
    </div>`);
  document.getElementById(`rs-resp-txt-${solId}`)?.focus();
}

async function _confirmarResposta(uid, solId, novoStatus) {
  const textarea = document.getElementById(`rs-resp-txt-${solId}`);
  const resposta = textarea?.value?.trim();
  if (!resposta) { alert('Digite uma resposta.'); return; }

  const solRef = db.collection('usuarios').doc(uid).collection('solicitacoes').doc(solId);
  const solSnap = await solRef.get();
  if (!solSnap.exists) return;

  await _salvarResposta(uid, solId, solSnap, novoStatus, resposta);
}

async function _salvarResposta(uid, solId, solSnap, novoStatus, resposta) {
  try {
    await db.collection('usuarios').doc(uid).collection('solicitacoes').doc(solId)
      .update({ status: novoStatus, resposta, data_resposta: new Date() });

    // Decrementa contador
    await _incrementarContador('solicitacoes', -1);

    // Dispara push de notificação ao usuário (se tiver player_id)
    try {
      const userSnap = await db.collection('usuarios').doc(uid).get();
      const playerId = userSnap.data()?.onesignal_player_id;
      if (playerId) {
        await fetch('/api/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-token': window._adminToken || '' },
          body: JSON.stringify({
            acao: 'resposta-mensagem',
            playerId,
            titulo: '💬 Você tem uma resposta!',
            corpo: 'A equipe Radar SIOPE respondeu sua mensagem. Acesse Ações na Central do app.',
          }),
        });
      }
    } catch (e) { console.warn('[drawer] push resposta:', e.message); }

    mostrarMensagem('Resposta enviada!');
    _ativarDrawerTab('solicitacoes');
    atualizarBadgeUsuarios();
  } catch (e) { mostrarMensagem('Erro: ' + e.message); }
}

// ─── ABA: ENVIOS ─────────────────────────────────────────────────────────────
async function _renderEnvios() {
  const body = document.getElementById('drawer-usuario-body');
  const uid = _drawerUid;
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
        .collection('envios').orderBy('data_envio', 'desc').get();

      if (enviosSnap.empty) continue;

      let linhas = '';
      for (const ed of enviosSnap.docs) {
        const e = ed.data();
        const status = (e.status || '').toLowerCase();
        if (status === 'falhou' || status === 'erro' || status === 'falha') totalFalhos++;

        let tituloNL = e.newsletter_id || e.id_edicao || ed.id;
        try {
          const nlid = e.newsletter_id || e.id_edicao;
          if (nlid) {
            const nlDoc = await db.collection('newsletters').doc(nlid).get();
            if (nlDoc.exists) {
              const nl = nlDoc.data();
              tituloNL = `${nl.titulo || ''} (Ed.${nl.numero || nl.edicao || '—'})`;
            }
          }
        } catch (_) { }

        const qs = btoa([
          `nid=${e.newsletter_id || e.id_edicao || ''}`,
          `env=${ed.id}`, `uid=${uid}`,
          `assinaturaId=${assinDoc.id}`,
          e.token_acesso ? `token=${e.token_acesso}` : ''
        ].filter(Boolean).join('&'));
        const urlVer = `https://app.radarsiope.com.br/verNewsletterComToken.html?d=${encodeURIComponent(qs)}`;
        const expirou = e.expira_em && new Date() >
          (e.expira_em?.toDate ? e.expira_em.toDate() : new Date(e.expira_em));

        const fbEnviado = e.feedback_enviado === true;
        const fbLabel = fbEnviado
          ? `<span style="font-size:11px;color:#22c55e">✅ Enviado</span>
             <button onclick="_resetarFeedbackEnvio('${assinDoc.id}','${ed.id}')"
               style="margin-left:4px;padding:1px 7px;font-size:10px;border:1px solid #e2e8f0;
               border-radius:4px;background:#fff;cursor:pointer;color:#94a3b8"
               title="Permitir novo feedback">↺ Resetar</button>`
          : `<span style="font-size:11px;color:#94a3b8">— não enviado</span>`;

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
            <td style="padding:5px 6px;font-size:12px;text-align:center">${e.acessos_totais || 0}</td>
            <td style="padding:5px 6px">${fbLabel}</td>
          </tr>`;
      }

      html += `
        <div class="drawer-secao">
          <div class="drawer-secao-titulo">
            📑 ${a.plano_nome || a.plano_slug || 'Assinatura'} &nbsp; ${_stBadge(a.status)}
          </div>
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f1f5f9;font-size:11px;color:#64748b">
              <th style="text-align:left;padding:4px 6px">Edição</th>
              <th style="text-align:left;padding:4px 6px">Enviado</th>
              <th style="text-align:left;padding:4px 6px">Status</th>
              <th style="text-align:left;padding:4px 6px">Link</th>
              <th style="text-align:left;padding:4px 6px">Expira</th>
              <th style="text-align:center;padding:4px 6px">👁</th>
              <th style="text-align:left;padding:4px 6px">Feedback</th>
            </tr></thead>
            <tbody>${linhas || '<tr><td colspan="6" style="color:#94a3b8;padding:8px;font-size:12px">Nenhum envio.</td></tr>'}</tbody>
          </table>
        </div>`;
    }

    const alertas = totalFalhos
      ? `<div class="drawer-alerta vermelho">❌ <strong>${totalFalhos}</strong> envio(s) com falha</div>` : '';
    body.innerHTML = alertas + (html || '<p style="color:#94a3b8;font-size:13px">Nenhum envio registrado.</p>');
  } catch (e) {
    body.innerHTML = `<p style="color:#ef4444">Erro: ${e.message}</p>`;
  }
}

// ─── ABA: INTERAÇÕES ─────────────────────────────────────────────────────────
async function _renderInteracoes() {
  const body = document.getElementById('drawer-usuario-body');
  const uid = _drawerUid;

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
      .collection('interacoes').orderBy('data', 'desc').limit(50).get();
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
            <span style="font-size:12px;font-weight:700">${i.tipo || '—'}</span>
            <span style="font-size:11px;color:#94a3b8">${_fmtHora(i.data)}</span>
          </div>
          <div style="font-size:12px;margin-top:3px">
            ${_stBadge(i.resultado || '—')}
            ${i.responsavel ? `<span style="font-size:11px;color:#94a3b8;margin-left:6px">por ${i.responsavel}</span>` : ''}
          </div>
          ${i.nota ? `<div style="font-size:12px;color:#64748b;margin-top:4px;
            background:#f1f5f9;border-radius:4px;padding:4px 8px">${i.nota}</div>` : ''}
        </div>`;
    });
    hist.innerHTML = h + '</div>';
  } catch (e) {
    const hist = document.getElementById('interacoes-historico');
    if (hist) hist.innerHTML = `<p style="color:#ef4444">Erro: ${e.message}</p>`;
  }
}

async function _salvarInteracaoUsuario(uid) {
  const tipo = document.getElementById('int-tipo').value;
  const resultado = document.getElementById('int-resultado').value;
  const nota = document.getElementById('int-nota').value.trim();
  const admin = JSON.parse(localStorage.getItem('usuarioLogado') || '{}');
  try {
    await db.collection('usuarios').doc(uid).collection('interacoes').add({
      tipo, resultado, nota: nota || null,
      responsavel: admin.nome || admin.email || 'Admin',
      data: firebase.firestore.FieldValue.serverTimestamp(),
    });
    mostrarMensagem('Interação registrada!');
    _renderInteracoes();
  } catch (e) { mostrarMensagem('Erro: ' + e.message); }
}

// ─── ABA: ACESSO ─────────────────────────────────────────────────────────────
// ─── ABA: ACESSOS (modelo de sessões) ────────────────────────────────────────
// Exibe sessões ativas do assinante com opção de revogar individualmente
// ou revogar todas de uma vez. Substitui o modelo antigo de envios/expiração.
async function _renderAcesso() {
  const body = document.getElementById('drawer-usuario-body');
  const uid = _drawerUid;

  try {
    // ── Assinatura ativa ──────────────────────────────────────────────────────
    const assinSnap = await db.collection('usuarios').doc(uid)
      .collection('assinaturas').get();

    let assinaturaHtml = '';
    for (const assinDoc of assinSnap.docs) {
      const a = assinDoc.data();
      const st = a.status || '—';
      const corStatus = {
        ativa: '#22c55e', ativo: '#22c55e',
        pendente_pagamento: '#f59e0b',
        cancelado: '#ef4444', cancelada: '#ef4444',
        inativo: '#94a3b8', suspenso: '#f59e0b',
      }[st] || '#94a3b8';

      assinaturaHtml += `
        <div style="display:flex;justify-content:space-between;align-items:center;
          padding:8px 0;border-bottom:1px dashed #e2e8f0;gap:8px">
          <div style="min-width:0">
            <div style="font-size:12px;font-weight:700">
              ${a.plano_nome || a.plano_slug || 'Plano'}
            </div>
            <div style="font-size:11px;color:#64748b">
              Renovação: ${_fmtData(a.data_proxima_renovacao)}
            </div>
          </div>
          <span style="background:${corStatus}1a;color:${corStatus};border-radius:20px;
            padding:2px 10px;font-size:11px;font-weight:700;white-space:nowrap">
            ${st}
          </span>
        </div>`;
    }

    // ── Sessões ativas ────────────────────────────────────────────────────────
    const sessoesSnap = await db.collection('usuarios').doc(uid)
      .collection('sessoes')
      .where('ativo', '==', true)
      .orderBy('ultimo_acesso', 'desc')
      .get();

    let sessoesHtml = '';
    if (sessoesSnap.empty) {
      sessoesHtml = '<p style="color:#94a3b8;font-size:12px;padding:8px 0">Nenhuma sessão ativa.</p>';
    } else {
      for (const sessDoc of sessoesSnap.docs) {
        const s = sessDoc.data();
        const sessId = sessDoc.id;
        const criado = _fmtData(s.criado_em);
        const ultimo = _fmtData(s.ultimo_acesso);
        const origem = s.origem === 'link_edicao' ? '🔗 Link de edição'
          : s.origem === 'ativar_sessao' ? '📧 Link de ativação'
            : '📱 App';
        const suspeito = s.compartilhamento_suspeito
          ? '<span style="background:#fee2e2;color:#ef4444;border-radius:20px;padding:1px 7px;font-size:10px;margin-left:4px">⚠️ Suspeito</span>'
          : '';

        sessoesHtml += `
          <div id="sessao-row-${sessId}"
            style="display:flex;align-items:center;gap:8px;padding:8px 0;
              border-bottom:1px dashed #e2e8f0">
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:700">
                ${origem}${suspeito}
              </div>
              <div style="font-size:11px;color:#64748b;margin-top:2px">
                Criada: ${criado} · Último acesso: ${ultimo}
              </div>
              ${s.acessos_ua_distintos > 0
            ? `<div style="font-size:10px;color:#f59e0b;margin-top:1px">
                     UAs distintos: ${s.acessos_ua_distintos}
                   </div>`
            : ''}
            </div>
            <button class="btn-drawer-sm btn-vermelho"
              onclick="_revogarSessao('${sessId}')"
              style="flex-shrink:0;font-size:11px;padding:4px 10px">
              🔌 Revogar
            </button>
          </div>`;
      }
    }

    // ── Botão revogar todas ───────────────────────────────────────────────────
    const totalAtivas = sessoesSnap.size;
    const rodapeHtml = totalAtivas > 1 ? `
      <div style="position:sticky;bottom:0;background:#fff;
        border-top:1px solid #e2e8f0;padding:12px 0 4px">
        <button class="btn-drawer-sm btn-vermelho" style="width:100%;font-size:12px"
          onclick="_revogarTodasSessoes()">
          🔌 Revogar todas as sessões (${totalAtivas})
        </button>
      </div>` : '';

    body.innerHTML = `
      <div class="drawer-secao">
        <div class="drawer-secao-titulo">📋 Assinatura</div>
        ${assinaturaHtml || '<p style="color:#94a3b8;font-size:12px">Nenhuma assinatura.</p>'}
      </div>
      <div class="drawer-secao">
        <div class="drawer-secao-titulo">📱 Sessões ativas (${totalAtivas}/3)</div>
        ${sessoesHtml}
      </div>
      ${rodapeHtml}`;

  } catch (e) {
    body.innerHTML = `<p style="color:#ef4444">Erro: ${e.message}</p>`;
  }
}

// Revoga uma sessão individual
async function _revogarSessao(sessaoId) {
  if (!confirm('Revogar esta sessão? O assinante precisará reabrir o app para criar uma nova.')) return;
  const uid = _drawerUid;
  try {
    await db.collection('usuarios').doc(uid)
      .collection('sessoes').doc(sessaoId)
      .update({
        ativo: false,
        desativado_motivo: 'revogado_admin',
        desativado_em: firebase.firestore.FieldValue.serverTimestamp(),
      });
    mostrarMensagem('✅ Sessão revogada.');
    _renderAcesso();
  } catch (e) { mostrarMensagem('Erro: ' + e.message); }
}

// Revoga todas as sessões ativas do assinante
async function _revogarTodasSessoes() {
  if (!confirm('Revogar TODAS as sessões ativas? O assinante precisará reabrir o app.')) return;
  const uid = _drawerUid;
  try {
    const snap = await db.collection('usuarios').doc(uid)
      .collection('sessoes').where('ativo', '==', true).get();
    if (snap.empty) { mostrarMensagem('Nenhuma sessão ativa.'); return; }
    const batch = db.batch();
    snap.docs.forEach(doc => batch.update(doc.ref, {
      ativo: false,
      desativado_motivo: 'revogado_admin',
      desativado_em: firebase.firestore.FieldValue.serverTimestamp(),
    }));
    await batch.commit();
    mostrarMensagem(`✅ ${snap.size} sessão(ões) revogada(s).`);
    _renderAcesso();
  } catch (e) { mostrarMensagem('Erro: ' + e.message); }
}

// ─── Admin: Enviar link de acesso por e-mail ──────────────────────────────────
// Retorna o link gerado (string) em caso de sucesso, ou null em caso de erro/cancelamento.
async function _enviarLinkAcessoAdmin(uid, solId, assinaturaId, resetarContador) {
  const acao = resetarContador
    ? 'Resetar contador (self-service volta a 0) e enviar novo link'
    : 'Gerar e enviar novo link (contador permanece em 3)';

  if (!confirm(`${acao}?\n\nUm e-mail com o link de ativação será enviado ao assinante.`)) return null;

  // Desabilita os botões do card de solicitação (apenas se veio de um card existente)
  const card = solId ? document.getElementById(`sol-card-${solId}`) : null;
  const btns = card?.querySelectorAll('button');
  btns?.forEach(b => { b.disabled = true; });

  try {
    const resp = await fetch('/api/pagamentoMP?acao=admin-enviar-link-acesso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, solId, assinaturaId, resetarContador }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) throw new Error(data.message || 'Erro ao processar.');

    // Atualiza a solicitação como atendida (apenas quando veio de uma solicitação)
    if (solId) {
      await db.collection('usuarios').doc(uid).collection('solicitacoes').doc(solId).update({
        status: 'atendida',
        resposta: resetarContador
          ? 'Contador resetado e novo link de acesso enviado por e-mail pelo administrador.'
          : 'Novo link de acesso enviado por e-mail pelo administrador.',
        data_resposta: new Date().toISOString(),
        atualizadoEm: new Date().toISOString(),
      });
      await _incrementarContador('solicitacoes', -1);
      await atualizarBadgeUsuarios();
      _ativarDrawerTab('solicitacoes');
    }

    const msg = resetarContador
      ? '✅ Contador zerado e link enviado por e-mail!'
      : '✅ Link enviado por e-mail com sucesso!';
    mostrarMensagem(msg);

    return data.link || null;

  } catch (err) {
    mostrarMensagem('❌ Erro: ' + err.message);
    btns?.forEach(b => { b.disabled = false; });
    return null;
  }
}

// ─── Admin: Gerar e enviar link proativamente (aba Resumo) ───────────────────
// Gera o link, envia por e-mail E entrega via mensagem_admin no app do assinante.
async function _gerarEnviarLinkProativo(uid, assinaturaId, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳ Gerando...'; }

  try {
    // 1. Gera + envia por e-mail (reutiliza função existente, solId = null)
    const link = await _enviarLinkAcessoAdmin(uid, null, assinaturaId, false);
    if (!link) {
      // Usuário cancelou no confirm ou ocorreu erro (já exibido por _enviarLinkAcessoAdmin)
      return;
    }

    // 2. Envia também via mensagem_admin no app
    const admin = JSON.parse(localStorage.getItem('usuarioLogado') || '{}');
    await db.collection('usuarios').doc(uid).collection('solicitacoes').add({
      tipo: 'mensagem_admin',
      titulo: '🔗 Seu novo link de acesso ao Radar SIOPE',
      descricao: `Seu novo link de acesso foi gerado e enviado também por e-mail.\n\nClique para acessar o app:\n${link}\n\n⏰ Válido por 72 horas.`,
      status: 'atendida',
      permite_resposta: false,
      lida: false,
      enviado_por: admin.nome || admin.email || 'Admin',
      data_solicitacao: new Date().toISOString(),
    });

    mostrarMensagem('✅ Link enviado por e-mail e notificação enviada no app!');

  } catch (err) {
    mostrarMensagem('❌ Erro: ' + err.message);
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '🔗 Gerar e enviar link'; }
  }
}
window._gerarEnviarLinkProativo = _gerarEnviarLinkProativo;

// ─── Reset de feedback por envio ─────────────────────────────────────────────
async function _resetarFeedbackEnvio(assinId, envioId) {
  if (!confirm('Permitir que o assinante envie um novo feedback neste envio?')) return;
  try {
    await db.collection('usuarios').doc(_drawerUid)
      .collection('assinaturas').doc(assinId)
      .collection('envios').doc(envioId)
      .update({ feedback_enviado: false });
    mostrarMensagem('✅ Feedback resetado. O assinante poderá enviar novamente.');
    _renderEnvios(); // recarrega a aba
  } catch (e) { mostrarMensagem('Erro: ' + e.message); }
}

async function _gerarLinkMulta(uid, solId, valor) {
  const mensagem = `Gerar link de cobrança de ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} para o assinante?`;

  if (!confirm(mensagem)) return;

  try {
    const resp = await fetch('/api/pagamentoMP?acao=gerar-cobranca-cancelamento', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, solicitacaoId: solId, valorReais: valor })
    });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.message);
    await db.collection('usuarios').doc(uid).collection('solicitacoes').doc(solId)
      .update({ status: 'cancelamento_pendente_multa', mp_link_multa: data.link, mp_preference_multa: data.preferenceId, atualizadoEm: new Date().toISOString() });
    mostrarMensagem('✅ Link gerado!');
    _ativarDrawerTab('solicitacoes');
  } catch (e) { mostrarMensagem('❌ Erro: ' + e.message); }
}

async function _confirmarEncerramentoDireto(uid, solId) {
  if (!confirm('Encerrar sem cobrança de multa?')) return;
  await _executarEncerramento(uid, solId, 'Isento de multa');
}

async function _confirmarEncerramentoFinal(uid, solId) {
  if (!confirm('Confirmar encerramento definitivo após pagamento?')) return;
  await _executarEncerramento(uid, solId, 'Pago e confirmado pelo admin');
}

async function _executarEncerramento(uid, solId, motivo) {
  try {
    const assSnap = await db.collection('usuarios').doc(uid).collection('assinaturas').where('status', 'in', ['ativa', 'aprovada', 'cancelamento_pendente_multa', 'multa_pago']).limit(1).get();
    if (assSnap.empty) throw new Error('Assinatura ativa não encontrada.');
    const assinId = assSnap.docs[0].id;

    const batch = db.batch();
    batch.update(db.collection('usuarios').doc(uid).collection('assinaturas').doc(assinId), { status: 'cancelada', cancelado_em: new Date().toISOString(), atualizadoEm: new Date().toISOString() });
    batch.update(db.collection('usuarios').doc(uid).collection('solicitacoes').doc(solId), { status: 'cancelada', resposta: motivo, atualizadoEm: new Date().toISOString() });
    const sessoes = await db.collection('usuarios').doc(uid).collection('sessoes').where('ativo', '==', true).get();
    sessoes.docs.forEach(doc => batch.update(doc.ref, { ativo: false, desativado_motivo: 'cancelamento_admin' }));
    await batch.commit();
    mostrarMensagem('✅ Encerramento confirmado. Sessões desativadas.');
    _ativarDrawerTab('solicitacoes');
    atualizarBadgeUsuarios();
  } catch (e) { mostrarMensagem('❌ Erro: ' + e.message); }
}

// ─── SALVAR FEATURES DO USUÁRIO (nível documento principal) ───────────────────
async function _salvarFeaturesUsuario(uid, btn) {
  const panel = document.getElementById('feat-panel-usuario');
  const status = document.getElementById('feat-status-usuario');
  const inputs = panel.querySelectorAll('[data-feat]');
  const novasFeatures = {};

  inputs.forEach(input => {
    const featId = input.dataset.feat;
    const tipo = input.type;
    if (tipo === 'checkbox') novasFeatures[featId] = input.checked;
    else if (tipo === 'number') {
      const val = Number(input.value);
      novasFeatures[featId] = isNaN(val) ? 0 : val;
    } else if (tipo === 'text') {
      novasFeatures[featId] = input.value.trim();
    }
  });

  // ✅ Captura motivo (cortesia comercial)
  const motivoInput = document.getElementById('feat-motivo-usuario');
  const motivo = motivoInput?.value?.trim() || '';
  if (motivoInput) motivoInput.value = ''; // limpa para próxima edição

  btn.disabled = true; btn.textContent = '⏳ Salvando...'; status.textContent = '';
  try {
    // 1. Lê features atuais para calcular diff
    const userDoc = await db.collection('usuarios').doc(uid).get();
    const featuresAnteriores = userDoc.data()?.features || {};

    // 2. Calcula diff (o que realmente mudou)
    const todasChaves = new Set([
      ...Object.keys(featuresAnteriores),
      ...Object.keys(novasFeatures)
    ]);
    const diff = [];
    todasChaves.forEach(k => {
      const antes = featuresAnteriores[k];
      const depois = novasFeatures[k];
      if (JSON.stringify(antes) !== JSON.stringify(depois)) {
        diff.push(k);
      }
    });

    // 3. Admin responsável
    const admin = JSON.parse(localStorage.getItem('usuarioLogado') || '{}');
    const adminIdentificador = admin.nome || admin.email || 'Admin';

    // 4. Monta entrada de log (apenas se houve alteração real)
    const logEntry = {
      alterado_em: Date.now(),
      alterado_por: adminIdentificador,
      motivo: motivo || null,
      features_anteriores: featuresAnteriores,
      features_novas: novasFeatures,
      diff: diff,
    };

    // 5. Salva features + log (array limitado a 20 entradas mais recentes)
    const userRef = db.collection('usuarios').doc(uid);
    await userRef.update({ features: novasFeatures });

    // Adiciona entrada ao log de cortesia
    await userRef.set({
      features_cortesia_log: firebase.firestore.FieldValue.arrayUnion(logEntry)
    }, { merge: true });

    // 6. Trunca log para 20 entradas (evita doc muito grande)
    try {
      const docAtual = await userRef.get();
      const log = docAtual.data()?.features_cortesia_log || [];
      if (log.length > 20) {
        await userRef.update({
          features_cortesia_log: log.slice(-20)
        });
      }
    } catch (e) { /* não fatal */ }

    // Atualiza cache local
    _drawerDados.features = novasFeatures;
    status.textContent = '✅ Salvo!'; status.style.color = '#16a34a';
    setTimeout(() => { status.textContent = ''; }, 3000);

    // Recarrega o histórico de cortesias (se a seção existir)
    _carregarLogCortesia(uid);
  } catch (e) {
    status.textContent = '❌ Erro: ' + e.message; status.style.color = '#dc2626';
  } finally {
    btn.disabled = false; btn.textContent = '💾 Salvar features';
  }
}

// ─── Carregar histórico de cortesias do usuário ─────────────────────────────
async function _carregarLogCortesia(uid) {
  const wrap = document.getElementById(`feat-cortesia-log-${uid}`);
  const body = document.getElementById(`feat-cortesia-log-body-${uid}`);
  if (!wrap || !body) return;

  try {
    const doc = await db.collection('usuarios').doc(uid).get();
    const log = doc.data()?.features_cortesia_log || [];

    if (!log.length) {
      wrap.style.display = 'none';
      return;
    }

    wrap.style.display = 'block';
    // Ordena do mais recente para o mais antigo
    const logOrdenado = [...log].sort((a, b) => {
      const ta = typeof a.alterado_em === 'number' 
        ? a.alterado_em 
        : (a.alterado_em?.toMillis?.() || a.alterado_em?.seconds * 1000 || 0);
      const tb = typeof b.alterado_em === 'number' 
        ? b.alterado_em 
        : (b.alterado_em?.toMillis?.() || b.alterado_em?.seconds * 1000 || 0);
      return tb - ta;
    });

    body.innerHTML = logOrdenado.map(entry => {
      let dataStr;
      if (typeof entry.alterado_em === 'number') {
        dataStr = new Date(entry.alterado_em).toLocaleString('pt-BR');
      } else if (entry.alterado_em?.toDate) {
        dataStr = entry.alterado_em.toDate().toLocaleString('pt-BR');
      } else {
        dataStr = '—';
      }
      const diff = entry.diff || [];
      const diffHtml = diff.length
        ? diff.map(k => `<span style="background:#e0f2fe;color:#0284c7;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;margin-right:4px;display:inline-block;margin-bottom:2px">${k}</span>`).join('')
        : '<span style="color:#94a3b8;font-size:11px">sem alterações</span>';

      return `
        <div style="border-left:3px solid #0284c7;background:#f8fafc;padding:8px 10px;border-radius:0 6px 6px 0;margin-bottom:6px;font-size:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:4px">
            <strong style="color:#0A3D62">${entry.alterado_por || 'Admin'}</strong>
            <span style="font-size:10px;color:#94a3b8">${dataStr}</span>
          </div>
          ${entry.motivo ? `<div style="color:#475569;font-style:italic;margin-bottom:4px">💬 "${entry.motivo}"</div>` : ''}
          <div style="margin-top:4px">
            <span style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase">Features alteradas:</span><br>
            ${diffHtml}
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    console.warn('[cortesia-log]', e.message);
    wrap.style.display = 'none';
  }
}

// ─── Exportações globais ─────────────────────────────────────────────────────
window._resetarFeedbackEnvio = _resetarFeedbackEnvio;
window.abrirDrawerUsuario = abrirDrawerUsuario;
window.fecharDrawerUsuario = fecharDrawerUsuario;
window._ativarDrawerTab = _ativarDrawerTab;
window._drawerResponderSolicitacao = _drawerResponderSolicitacao;
window._salvarInteracaoUsuario = _salvarInteracaoUsuario;
window._confirmarProrrogacaoUsuario = _confirmarProrrogacaoUsuario;
window._toggleAcessoSel = _toggleAcessoSel;
window._selecionarTodosAcesso = _selecionarTodosAcesso;
window.atualizarBadgeUsuarios = atualizarBadgeUsuarios;
window._confirmarResposta = _confirmarResposta;
window.recalcularContadores = recalcularContadores;
window._incrementarContador = _incrementarContador;
window._abrirModalGerarLinkMulta = _abrirModalGerarLinkMulta;
window._confirmarEncerramentoDireto = _confirmarEncerramentoDireto;
window._gerarLinkMulta = _gerarLinkMulta;
window._confirmarEncerramentoDireto = _confirmarEncerramentoDireto;
window._confirmarEncerramentoFinal = _confirmarEncerramentoFinal;
window._salvarFeaturesUsuario = _salvarFeaturesUsuario;
window._enviarLinkAcessoAdmin = _enviarLinkAcessoAdmin;

document.addEventListener('DOMContentLoaded', () => setTimeout(atualizarBadgeUsuarios, 1500));