// faleConosco.js
// Botão "Fale Conosco" no app verNewsletterComToken
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const MAX_CHARS = 250;
  const STORAGE_KEY_BADGE = 'rs_fc_respondidas_vistas';
  let _historicoCache = null;
  let _historicoCacheTs = 0;
  const _HISTORICO_TTL = 5 * 60 * 1000; // 5 min

  // ✅ NOVO: Utilitário para converter Timestamps do Firestore em ms
  function _tsMs(ts) { if (!ts) return null; if (ts.seconds) return ts.seconds * 1000; if (ts instanceof Date) return ts.getTime(); return new Date(ts).getTime(); }

  // ✅ NOVO: Validação rigorosa de datas e status
  function _validarJanelaCiclo(cicloDoc, acao) {
    if (!cicloDoc) return { valido: false, erro: 'Nenhum ciclo configurado.' };
    const agora = Date.now();
    if (cicloDoc.status === 'inativo' || cicloDoc.status === 'encerrado') return { valido: false, erro: 'Ciclo encerrado ou inativo.' };

    if (acao === 'indicacao') {
      const ini = _tsMs(cicloDoc.inicio_indicacao);
      const fim = _tsMs(cicloDoc.fim_indicacao);
      if (!ini || agora < ini) return { valido: false, erro: 'O período de sugestão de tema ainda não abriu.' };
      if (fim && agora > fim) return { valido: false, erro: 'Período de sugestão de tema já encerrou.' };
    } else if (acao === 'votacao') {
      const ini = _tsMs(cicloDoc.inicio_votacao);
      const fim = _tsMs(cicloDoc.fim_votacao);
      if (!ini || agora < ini) return { valido: false, erro: 'O período de votação ainda não abriu.' };
      if (fim && agora > fim) return { valido: false, erro: 'O período de votação já encerrou.' };
    }
    return { valido: true, ciclo: cicloDoc };
  }

  // ✅ Helper para verificar estados da indicação e votação antes de renderizar
  function _tsMs(ts) {
    if (!ts) return null;
    if (ts.seconds) return ts.seconds * 1000;
    if (ts instanceof Date) return ts.getTime();
    return new Date(ts).getTime();
  }

  async function _checarEstadosCiclo() {
    const snap = await window.db.collection('ciclos_votacao').orderBy('inicio_indicacao', 'desc').limit(1).get();
    if (snap.empty) return { indicacaoAberta: false, msgIndicacao: 'Nenhum ciclo configurado.', votacaoAberta: false, msgVotacao: '' };

    const c = { id: snap.docs[0].id, ...snap.docs[0].data() };
    const agora = Date.now();
    const ini_ind = _tsMs(c.inicio_indicacao), fim_ind = _tsMs(c.fim_indicacao);
    const ini_vot = _tsMs(c.inicio_votacao), fim_vot = _tsMs(c.fim_votacao);
    const bloqueado = c.status === 'inativo' || c.status === 'encerrado';

    return {
      cicloId: c.id,
      indicacaoAberta: !bloqueado && ini_ind && agora >= ini_ind && (!fim_ind || agora <= fim_ind),
      msgIndicacao: bloqueado ? 'Ciclo encerrado ou inativo.' : (!ini_ind || agora < ini_ind ? 'O período de sugestão de tema ainda não abriu.' : 'O período de sugestão de tema já encerrou.'),
      votacaoAberta: !bloqueado && ini_vot && agora >= ini_vot && (!fim_vot || agora <= fim_vot),
      msgVotacao: bloqueado ? 'Ciclo encerrado ou inativo.' : (!ini_vot || agora < ini_vot ? 'O período de votação ainda não abriu.' : 'O período de votação já encerrou.')
    };
  }

  function _validarCicloParaIndicacao(cicloDoc) {
    if (!cicloDoc) return { valido: false, erro: 'Nenhum ciclo configurado.' };
    if (cicloDoc.status === 'inativo' || cicloDoc.status === 'encerrado') return { valido: false, erro: 'Ciclo encerrado ou inativo.' };
    const agora = Date.now();
    const ini = _tsMs(cicloDoc.inicio_indicacao);
    const fim = _tsMs(cicloDoc.fim_indicacao);
    if (!ini || agora < ini) return { valido: false, erro: 'O período de sugestão de tema ainda não abriu.' };
    if (fim && agora > fim) return { valido: false, erro: 'O período de sugestão de tema já encerrou.' };
    return { valido: true };
  }

  // Formata descricao de mensagem_admin: escapa HTML, converte URLs em links e \n em <br>
  function _formatarDescricaoAdmin(texto) {
    if (!texto) return '';
    // 1. Escapa HTML para segurança
    const escapado = texto
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    // 2. Converte URLs em links clicáveis (abre em nova aba)
    const comLinks = escapado.replace(
      /(https?:\/\/[^\s]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" ' +
      'style="color:#60a5fa;font-weight:700;word-break:break-all;text-decoration:underline">Clique aqui para acessar →</a>'
    );
    // 3. Converte \n em <br>
    return comLinks.replace(/\n/g, '<br>');
  }

  // ── Inicialização ─────────────────────────────────────────────────────────
  function init() {
    _injetarHTML();
    _injetarCSS();
    _bindEventos();

    // _radarUser pode ainda não estar disponível no momento do init()
    // (publicarRadarUser() é chamado depois, no fluxo do verNewsletterComToken).
    // Aguarda até 8s em polling de 200ms; quando disponível, atualiza badge e
    // liga o listener em tempo real do Firestore para mensagens_admin.
    let _tentativas = 0;
    const _aguardarUser = setInterval(() => {
      const user = window._radarUser;
      if (user && user.uid && user.segmento === 'assinante') {
        clearInterval(_aguardarUser);
        _atualizarBadge();
        _iniciarListenerMensagensAdmin(user.uid);
      } else if (++_tentativas >= 40) { // 40 × 200ms = 8s
        clearInterval(_aguardarUser);
        _atualizarBadge(); // tenta mesmo assim (pode ser lead ou sem user)
      }
    }, 200);
  }

  // ── Listener em tempo real: mensagens_admin não lidas ─────────────────────
  let _unsubscribeMensagensAdmin = null;
  function _iniciarListenerMensagensAdmin(uid) {
    // Garante que não duplica listeners em navegações
    if (_unsubscribeMensagensAdmin) {
      try { _unsubscribeMensagensAdmin(); } catch (_) { }
    }

    try {
      _unsubscribeMensagensAdmin = window.db
        .collection('usuarios').doc(uid)
        .collection('solicitacoes')
        .where('tipo', '==', 'mensagem_admin')
        .where('lida', '==', false)
        .onSnapshot(snap => {
          const badge = document.getElementById('rs-fc-badge');
          if (!badge) return;

          // Filtra pelo Set local (pode ter sido marcada vista mas ainda não gravada)
          const vistas = _getVistas();
          const novas = snap.docs.filter(d => !vistas.has(d.id));
          const count = novas.length;

          badge.textContent = count > 9 ? '9+' : String(count);
          badge.style.display = count > 0 ? 'inline-block' : 'none';

          // Invalida cache do histórico para forçar reload na próxima abertura
          if (count > 0) _historicoCache = null;

          // Notifica menuApp.js para atualizar badge de Ações e total
          window._rsMenuAtualizarBadges?.();
        }, err => {
          console.warn('[faleConosco] listener mensagens_admin:', err.message);
        });
    } catch (e) {
      console.warn('[faleConosco] _iniciarListenerMensagensAdmin:', e.message);
    }
  }
  // ── HTML ──────────────────────────────────────────────────────────────────
  function _injetarHTML() {
    const overlay = document.createElement('div'); overlay.id = 'rs-fc-overlay'; overlay.setAttribute('role', 'presentation'); document.body.appendChild(overlay);
    const drawer = document.createElement('aside'); drawer.id = 'rs-fc-panel'; drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.setAttribute('aria-label', 'Fale Conosco'); drawer.innerHTML = `<div id="rs-fc-header"><span id="rs-fc-titulo">💬 Ações</span><button id="rs-fc-fechar" type="button" aria-label="Fechar">×</button></div><div id="rs-fc-body"><div class="rs-fc-loading">Carregando…</div></div>`; document.body.appendChild(drawer);
    if (!document.getElementById('rs-fc-badge')) { const b = document.createElement('span'); b.id = 'rs-fc-badge'; b.style.display = 'none'; b.textContent = '0'; document.body.appendChild(b); }
  }
  // ── CSS ───────────────────────────────────────────────────────────────────
  function _injetarCSS() { const style = document.createElement('style'); style.textContent = `#rs-fc-badge { min-width: 18px; height: 18px; padding: 0 5px; background: #22c55e; color: #fff; border-radius: 99px; font-size: 10px; font-weight: 800; line-height: 18px; text-align: center; margin-left: 2px; } #rs-fc-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 600; opacity: 0; pointer-events: none; transition: opacity .25s; backdrop-filter: blur(2px); } #rs-fc-overlay.rs-fc-show { opacity: 1; pointer-events: all; } #rs-fc-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(500px, 96vw); background:  var(--rs-card, #1e293b); z-index: 700; display: flex; flex-direction: column; transform: translateX(110%); transition: transform .28s cubic-bezier(.4,0,.2,1); box-shadow: -4px 0 32px rgba(0,0,0,.3); overflow: hidden; } #rs-fc-panel.rs-fc-show { transform: translateX(0); } #rs-fc-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--rs-borda, rgba(148,163,184,.12)); background: var(--rs-card2, #162032); flex-shrink: 0; } #rs-fc-titulo { font-size: 15px; font-weight: 700; color: var(--rs-text, #f8fafc); font-family: 'Syne', system-ui, sans-serif; } #rs-fc-fechar { background: none; border: none; color: var(--rs-muted, #94a3b8); font-size: 22px; cursor: pointer; line-height: 1; padding: 0 4px; } #rs-fc-fechar:hover { color: var(--rs-text, #f8fafc); } #rs-fc-body { flex: 1; overflow-y: auto; padding: 14px 4px; display: flex; flex-direction: column; gap: 12px; } .rs-fc-loading, .rs-fc-vazio { text-align: center; padding: 40px 20px; color: var(--rs-muted, #94a3b8); font-size: 13px; line-height: 1.6; } .rs-fc-vazio span { font-size: 36px; display: block; margin-bottom: 12px; } .rs-fc-aviso { background: rgba(14,116,144,.12); border: 1px solid rgba(14,116,144,.25); border-radius: 8px; padding: 10px 12px; font-size: 12px; color: var(--rs-muted, #94a3b8); line-height: 1.5; } .rs-fc-tipos { display: flex; gap: 8px; flex-wrap: wrap; } .rs-fc-tipo-btn { flex: 1; min-width: 120px; padding: 10px 8px; background: var(--rs-card2, #162032); border: 2px solid var(--rs-borda, rgba(148,163,184,.12)); border-radius: 10px; color: var(--rs-text, #f8fafc); font-size: 12px; font-weight: 600; font-family: 'Syne', system-ui, sans-serif; cursor: pointer; text-align: center; transition: border-color .15s, background .15s; } .rs-fc-tipo-btn:hover { border-color: #0e7490; } .rs-fc-tipo-btn.ativo { border-color: #0e7490; background: rgba(14,116,144,.15); } .rs-fc-tipo-btn.bloqueado { opacity: .6; cursor: default; border-style: dashed; } .rs-fc-label { font-size: 12px; font-weight: 600; color: var(--rs-muted, #94a3b8); margin-bottom: 4px; display: block; } .rs-fc-textarea { width: 100%; background: var(--rs-card2, #162032); border: 1px solid var(--rs-borda, rgba(148,163,184,.12)); border-radius: 8px; color: var(--rs-text, #f8fafc); font-size: 13px; line-height: 1.5; padding: 10px 12px; resize: vertical; min-height: 110px; font-family: inherit; transition: border-color .15s; } .rs-fc-textarea:focus { outline: none; border-color: #0e7490; } .rs-fc-chars { font-size: 11px; color: var(--rs-muted, #94a3b8); text-align: right; margin-top: 2px; } .rs-fc-chars.limite { color: #ef4444; font-weight: 700; } .rs-fc-enviar { width: 100%; padding: 11px; background: #0e7490; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 700; font-family: 'Syne', system-ui, sans-serif; cursor: pointer; transition: background .15s; } .rs-fc-enviar:hover { background: #0c6680; } .rs-fc-enviar:disabled { opacity: .5; cursor: not-allowed; } .rs-fc-sep { font-size: 11px; font-weight: 700; color: var(--rs-muted, #94a3b8); text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid var(--rs-borda, rgba(148,163,184,.12)); padding-bottom: 6px; margin-top: 4px; display: block; width: 100%; } .rs-fc-msg-card { background: var(--rs-card2, #162032); border: 1px solid var(--rs-borda, rgba(148,163,184,.12)); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 6px; } .rs-fc-msg-card.respondida { border-color: #22c55e; } .rs-fc-msg-topo { display: flex; justify-content: space-between; align-items: center; gap: 8px; } .rs-fc-msg-tipo { font-size: 11px; font-weight: 700; color: var(--rs-muted, #94a3b8); text-transform: uppercase; letter-spacing: .5px; } .rs-fc-msg-data { font-size: 11px; color: var(--rs-muted, #94a3b8); } .rs-fc-msg-texto { font-size: 13px; color: var(--rs-text, #f8fafc); line-height: 1.5; } .rs-fc-msg-resposta { background: rgba(34,197,94,.1); border-left: 3px solid #22c55e; border-radius: 4px; padding: 8px 10px; font-size: 12px; color: var(--rs-text, #f8fafc); line-height: 1.5; } .rs-fc-msg-resposta-label { font-size: 10px; font-weight: 700; color: #22c55e; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; } .rs-fc-badge-status { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 99px; text-transform: uppercase; } .rs-fc-badge-status.aberta { background: rgba(251,191,36,.15); color: #d97706; } .rs-fc-badge-status.respondida { background: rgba(34,197,94,.15); color: #16a34a; } .rs-sugestao-card { background: var(--rs-card2, #162032); border: 1px solid var(--rs-borda, rgba(148,163,184,.12)); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; } .rs-sugestao-header { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--rs-muted, #94a3b8); } .rs-sugestao-posicao { font-weight: 700; color: #0e7490; } .rs-sugestao-votos { font-weight: 600; } .rs-sugestao-texto { font-size: 13px; color: var(--rs-text, #f8fafc); line-height: 1.4; } .rs-sugestao-data { font-size: 10px; color: var(--rs-muted, #94a3b8); text-transform: uppercase; letter-spacing: .5px; } .rs-voto-btn { align-self: flex-start; padding: 6px 12px; background: var(--rs-card2, #162032); border: 2px solid var(--rs-borda, rgba(148,163,184,.12)); border-radius: 20px; color: var(--rs-text, #f8fafc); font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s; } .rs-voto-btn:hover { border-color: #0e7490; background: rgba(14,116,144,.1); } .rs-voto-btn.votado { border-color: #22c55e; background: rgba(34,197,94,.15); color: #22c55e; } .rs-resultado-card { background: var(--rs-card2, #162032); border: 1px solid var(--rs-borda, rgba(148,163,184,.12)); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; margin: 8px 0; } .rs-resultado-header { font-size: 12px; font-weight: 700; color: #a78bfa; text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px dashed var(--rs-borda); padding-bottom: 8px; margin-bottom: 2px; } .rs-res-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid rgba(148,163,184,.08); } .rs-res-item:last-child { border-bottom: none; } .rs-res-pos { font-weight: 800; font-size: 14px; min-width: 28px; color: var(--rs-muted, #94a3b8); } .rs-res-item.vencedor .rs-res-pos { color: #fbbf24; font-size: 16px; } .rs-res-info { flex: 1; display: flex; flex-direction: column; gap: 2px; } .rs-res-texto { font-size: 13px; color: var(--rs-text, #f8fafc); line-height: 1.3; } .rs-res-item.vencedor .rs-res-texto { font-weight: 700; color: #fbbf24; } .rs-res-meta { font-size: 10px; color: var(--rs-muted, #94a3b8); display: flex; gap: 8px; align-items: center; } .rs-res-votos { background: rgba(14,116,144,.15); color: #0e7490; padding: 2px 6px; border-radius: 4px; font-weight: 700; }`; document.head.appendChild(style); }
  // ── Eventos ───────────────────────────────────────────────────────────────
  function _bindEventos() { document.getElementById('rs-fc-fechar').addEventListener('click', _fecharDrawer); document.getElementById('rs-fc-overlay').addEventListener('click', _fecharDrawer); document.addEventListener('keydown', e => { if (e.key === 'Escape') _fecharDrawer(); }); }
  // ── Abrir / Fechar ────────────────────────────────────────────────────────
  function _abrirDrawer() { document.getElementById('rs-fc-overlay').classList.add('rs-fc-show'); document.getElementById('rs-fc-panel').classList.add('rs-fc-show'); document.body.style.overflow = 'hidden'; _renderDrawer('mensagem'); }
  function _fecharDrawer() { document.getElementById('rs-fc-overlay').classList.remove('rs-fc-show'); document.getElementById('rs-fc-panel').classList.remove('rs-fc-show'); document.body.style.overflow = ''; _atualizarBadge(); }
  // ── Render principal ──────────────────────────────────────────────────────
  async function _renderDrawer(tipoAtivo = 'mensagem') {
    const body = document.getElementById('rs-fc-body');
    const user = window._radarUser;

    // Lead com acesso pro temporário: exibe card explicativo, bloqueia acesso
    if (window._leadAcessoProTemp === true) {
      body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:32px 16px;text-align:center;">
        <span style="font-size:40px;">💬</span>
        <strong style="font-size:15px;color:var(--rs-text,#f8fafc);font-family:'Syne',system-ui,sans-serif;">
          Canal Direto com a Equipe
        </strong>
        <p style="font-size:13px;color:var(--rs-muted,#94a3b8);line-height:1.6;margin:0;">
          Envie dúvidas, sinalize irregularidades e sugira temas para as próximas edições.
          Assinantes têm retorno direto da equipe Radar SIOPE.
        </p>
        <button onclick="if(typeof _solicitarUpgrade==='function')_solicitarUpgrade('acoes',false)"
          style="margin-top:8px;padding:11px 24px;background:#0e7490;color:#fff;border:none;
                 border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;
                 font-family:'Syne',system-ui,sans-serif;">
          Assinar para enviar mensagens
        </button>
      </div>`;
      return;
    }

    body.innerHTML = '<div class="rs-fc-loading">Carregando…</div>';

    if (!user) { body.innerHTML = '<div class="rs-fc-vazio"><span>🔒</span>Faça login para enviar mensagens.</div>'; return; }
    const isAssinante = user.segmento === 'assinante';
    let quotaTema = 0; let usoTemaMes = 0;

    if (isAssinante) {
      try {
        const _sessao = JSON.parse(localStorage.getItem('rs_pwa_session') || '{}');
        quotaTema = (_sessao.features || user.features || {}).sugestao_tema_quota || 0;
      } catch (e) { /* ignora */ }
    }

    const [historico] = await Promise.all([
      _buscarHistorico(user),
      quotaTema > 0 ? (async () => {
        try {
          const inicioMes = new Date();
          inicioMes.setDate(1);
          inicioMes.setHours(0, 0, 0, 0);
          const snap = await window.db.collection('usuarios').doc(user.uid).collection('solicitacoes').where('tipo', '==', 'sugestao_tema').get();
          usoTemaMes = snap.docs.filter(d => {
            const ds = d.data().data_solicitacao;
            return ds && new Date(ds) >= inicioMes;
          }).length;
        } catch (e) { console.warn('[faleConosco] quota:', e.message); }
      })() : Promise.resolve(),
    ]);

    _marcarRespostasVistas(historico);
    const quotaEsgotada = quotaTema > 0 && usoTemaMes >= quotaTema;
    const temFeatureTema = isAssinante && quotaTema > 0;

    let html = '';
    const avisoTexto = tipoAtivo === 'sugestao_tema' ? 'Área destinada para sugestão de temas para as próximas edições e para visualização do resultado da votação.' : 'Área destinada para dúvidas sobre a sua assinatura e feedbacks.';
    html += `<div class="rs-fc-aviso">${avisoTexto}</div>`;

    html += `<div class="rs-fc-tipos">`;
    html += `<button class="rs-fc-tipo-btn ${tipoAtivo === 'mensagem' ? 'ativo' : ''}" onclick="window._fcSelecionarTipo('mensagem')">💬 Mensagem</button>`;
    if (isAssinante) { html += temFeatureTema ? `<button class="rs-fc-tipo-btn ${tipoAtivo === 'sugestao_tema' ? 'ativo' : ''}" onclick="window._fcSelecionarTipo('sugestao_tema')">💡 Sugerir tema</button>` : `<button class="rs-fc-tipo-btn bloqueado" title="Disponível em planos superiores">💡 Sugerir tema 🔒</button>`; }
    html += `</div>`;

    if (tipoAtivo === 'sugestao_tema') {
      html += await _renderVotacaoAtual(user, temFeatureTema);

      const restantes = Math.max(0, quotaTema - usoTemaMes);

      let estadoCiclo = null;
      try { estadoCiclo = await _checarEstadosCiclo(); } catch (e) { /* ignora */ }

      let isBlocked = quotaEsgotada;
      let blockMsg = '⛔ Sua quota de sugestões para este mês já foi atingida. Aguarde o próximo ciclo para enviar novas sugestões.';

      // Placeholder padrão (caso não esteja bloqueado)
      let placeholderTxt = `Descreva o tema que gostaria que fosse abordado… você ainda tem direito a ${restantes} sugestão(ões).`;

      if (!isBlocked && estadoCiclo && !estadoCiclo.indicacaoAberta) {
        isBlocked = true;
        blockMsg = `⛔ ${estadoCiclo.msgIndicacao || 'O período de sugestão de tema não está aberto no momento.'}`;
      }

      // Aplica bloqueio visual e de interação
      if (isBlocked) {
        placeholderTxt = blockMsg;
      }

      const textareaAttrs = isBlocked
        ? 'disabled readonly style="opacity:0.6; cursor:not-allowed;"'
        : '';

      html += `
        <div style="margin-top:16px">
          <label class="rs-fc-label" for="rs-fc-txt">💡 Sugestão de tema</label>
          <textarea id="rs-fc-txt" class="rs-fc-textarea" placeholder="${_esc(placeholderTxt)}"
            maxlength="${MAX_CHARS}" ${textareaAttrs}></textarea>
          <div class="rs-fc-chars" id="rs-fc-chars">0/${MAX_CHARS}</div>
        </div>
        <button class="rs-fc-enviar" id="rs-fc-enviar" disabled ${isBlocked ? 'disabled' : ''}
          onclick="window._fcEnviar('sugestao_tema')">Enviar</button>`;

      html += await _renderResultadoAnterior(user, temFeatureTema);

      window.__fcSugestaoBloqueada = isBlocked;
    } else {
      window.__fcSugestaoBloqueada = false;
      html += `...`; // (mantém igual)
    }

    const historicoFiltrado = tipoAtivo === 'mensagem'
      ? historico.filter(m => m.tipo !== 'sugestao_tema')
      : historico.filter(m => m.tipo === 'sugestao_tema');
    if (historicoFiltrado.length > 0) {
      html += `<div class="rs-fc-sep">Histórico</div>`;
      historicoFiltrado.forEach(msg => {
        // ── Card especial para mensagem_admin ──────────────────────────────
        if (msg.tipo === 'mensagem_admin') {
          let dataFormatada = '—';
          try { const rawDate = msg.data_solicitacao; if (rawDate) { const d = new Date(rawDate); if (!isNaN(d.getTime())) dataFormatada = `em ${d.toLocaleDateString('pt-BR')}`; } } catch (e) { }
          const respostaBtn = msg.permite_resposta
            ? `<button class="rs-fc-enviar" style="margin-top:8px;font-size:12px;padding:8px 14px;background:#1d4ed8"
                onclick="window._fcResponderMensagemAdmin('${msg.id || ''}')">
                💬 Responder
               </button>` : '';
          const respostaAssinante = msg.resposta_assinante
            ? `<div class="rs-fc-msg-resposta" style="border-color:#3b82f6;background:rgba(59,130,246,.1)">
                <div class="rs-fc-msg-resposta-label" style="color:#3b82f6">✅ Sua resposta</div>
                ${_esc(msg.resposta_assinante)}
               </div>` : '';
          // Marca como lida no Firestore (fire-and-forget)
          if (!msg.lida && msg.id) {
            window.db.collection('usuarios').doc(user.uid)
              .collection('solicitacoes').doc(msg.id)
              .update({ lida: true }).catch(() => { });
          }
          html += `
            <div class="rs-fc-msg-card respondida"
              style="border-color:#3b82f6;background:rgba(59,130,246,.08)">
              <div class="rs-fc-msg-topo">
                <span class="rs-fc-msg-tipo" style="color:#3b82f6">📣 Equipe Radar SIOPE</span>
                <span class="rs-fc-msg-data">${dataFormatada}</span>
              </div>
              ${msg.titulo ? `<div style="font-size:13px;font-weight:700;color:var(--rs-text,#f8fafc);margin-bottom:2px">${_esc(msg.titulo)}</div>` : ''}
              <div class= "rs-fc-msg-texto " style= "word-break:break-word; " >${_formatarDescricaoAdmin(msg.descricao || '')} </div >
              ${respostaAssinante}
              ${!msg.resposta_assinante ? respostaBtn : ''}
            </div>`;
          return;
        }

        // ── Card padrão (mensagem / sugestao_tema) ─────────────────────────
        const respondida = !!msg.resposta; let dataFormatada = '—';
        try { const rawDate = msg.criado_em || msg.data_solicitacao; if (rawDate) { const d = rawDate.seconds ? new Date(rawDate.seconds * 1000) : new Date(rawDate); if (!isNaN(d.getTime())) dataFormatada = `em ${d.toLocaleDateString('pt-BR')}`; } } catch (e) { }
        const tipoLabel = msg.tipo === 'sugestao_tema' ? '💡 Sugestão de tema' : '💬 Mensagem';
        const respostaHtml = respondida ? `<div class="rs-fc-msg-resposta"><div class="rs-fc-msg-resposta-label">✅ Resposta da equipe</div>${msg.resposta}</div>` : '';
        html += `<div class="rs-fc-msg-card ${respondida ? 'respondida' : ''}"><div class="rs-fc-msg-topo"><span class="rs-fc-msg-tipo">${tipoLabel}</span><div style="display:flex;gap:6px;align-items:center"><span class="rs-fc-badge-status ${respondida ? 'respondida' : 'aberta'}">${msg.tipo === 'sugestao_tema' ? 'Enviada' : (respondida ? 'Respondida' : 'Aguardando')}</span><span class="rs-fc-msg-data">${dataFormatada}</span></div></div><div class="rs-fc-msg-texto">${msg.texto || msg.descricao || ''}</div>${respostaHtml}</div>`;
      });
    } else { html += `<div class="rs-fc-vazio"><span>💬</span>Nenhuma mensagem ainda.</div>`; }

    body.innerHTML = html;

    const textarea = document.getElementById('rs-fc-txt'); const chars = document.getElementById('rs-fc-chars'); const btnEnv = document.getElementById('rs-fc-enviar');
    if (textarea) {
      textarea.addEventListener('input', () => {
        const n = textarea.value.length; chars.textContent = `${n}/${MAX_CHARS}`; chars.classList.toggle('limite', n >= MAX_CHARS); if (!btnEnv) return;
        if (tipoAtivo === 'sugestao_tema') {
          btnEnv.disabled = (n === 0) || !!window.__fcSugestaoBloqueada;
        } else { btnEnv.disabled = (n === 0); }
      });
    }
  }
  // ── Selecionar tipo ───────────────────────────────────────────────────────
  window._fcSelecionarTipo = function (tipo) { _renderDrawer(tipo); };
  // ── Enviar mensagem ───────────────────────────────────────────────────────
  window._fcEnviar = async function (tipo) {
    const textarea = document.getElementById('rs-fc-txt');
    const btnEnv = document.getElementById('rs-fc-enviar');
    const texto = textarea?.value?.trim();
    if (!texto) return;
    const user = window._radarUser;
    if (!user) return;
    if (btnEnv) { btnEnv.disabled = true; btnEnv.textContent = 'Enviando…'; }

    try {
      // 1️⃣ Validação SERVER-SIDE de quota (assinante)
      if (user.segmento === 'assinante' && tipo === 'sugestao_tema') {
        const _sessao = JSON.parse(localStorage.getItem('rs_pwa_session') || '{}');
        const quota = (_sessao.features || user.features || {}).sugestao_tema_quota || 0;
        if (quota === 0) throw new Error('Seu plano não permite sugestões de tema.');

        const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
        const snap = await window.db.collection('usuarios').doc(user.uid).collection('solicitacoes').where('tipo', '==', 'sugestao_tema').get();
        const uso = snap.docs.filter(d => d.data().data_solicitacao && new Date(d.data().data_solicitacao) >= inicioMes).length;
        if (uso >= quota) throw new Error('Cota mensal de sugestões esgotada.');
      }

      // 2️⃣ Cria a solicitação privada
      const solicitacaoRef = await window.db.collection('usuarios').doc(user.uid).collection('solicitacoes').add({
        tipo, descricao: texto, status: 'aberta', data_solicitacao: new Date().toISOString()
      });

      // 3️⃣ Se for tema, vincula ao ciclo válido e cria documento público
      if (tipo === 'sugestao_tema') {
        const ciclosSnap = await window.db.collection('ciclos_votacao').orderBy('inicio_indicacao', 'desc').limit(5).get();
        let cicloAtivo = null;
        for (const doc of ciclosSnap.docs) {
          const cicloData = { id: doc.id, ...doc.data() };
          if (_validarCicloParaIndicacao(cicloData).valido) {
            cicloAtivo = cicloData;
            break;
          }
        }
        if (!cicloAtivo) throw new Error('Não há ciclo de indicação aberto no momento.');

        // Extrai o período com segurança (evita crash com .toDate())
        const periodoStr = new Date(_tsMs(cicloAtivo.inicio_indicacao)).toISOString().slice(0, 7);

        await window.db.collection('sugestoes_publicas').doc(`sugestao_${solicitacaoRef.id}`).set({
          solicitacao_ref: solicitacaoRef.path,
          texto_preview: texto.substring(0, 100) + (texto.length > 100 ? '...' : ''),
          autor_uid: user.uid, votos: 0, votantes: [],
          status: 'ativa',
          ciclo_id: cicloAtivo.id,
          periodo: periodoStr,
          criado_em: new Date(), atualizado_em: new Date()
        });
      }

      // 4️⃣ Atualiza contador admin
      await window.db.collection('admin_contadores').doc('pendencias').set({ solicitacoes: firebase.firestore.FieldValue.increment(1) }, { merge: true });

      if (btnEnv) { btnEnv.textContent = '✅ Enviado!'; btnEnv.disabled = true; }
      _historicoCache = null;
      setTimeout(() => _renderDrawer(tipo), 700);

    } catch (e) {
      console.error('[faleConosco] enviar:', e);
      if (btnEnv) { btnEnv.disabled = false; btnEnv.textContent = 'Enviar'; }
      alert(e.message || 'Erro ao enviar. Tente novamente.');
    }
  };

  // ── Responder mensagem do admin ───────────────────────────────────────────
  window._fcResponderMensagemAdmin = function (solId) {
    const user = window._radarUser;
    if (!user || !solId) return;

    // Cria modal inline simples no body
    const existing = document.getElementById('rs-fc-resposta-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'rs-fc-resposta-modal';
    modal.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;
      display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box`;
    modal.innerHTML = `
      <div style="background:#1e293b;border:1px solid #3b82f6;border-radius:10px;
                  padding:20px;width:100%;max-width:420px;box-sizing:border-box">
        <div style="font-size:14px;font-weight:700;color:#e2e8f0;margin-bottom:12px">
          💬 Responder mensagem da equipe
        </div>
        <textarea id="rs-fc-resposta-txt" maxlength="500"
          placeholder="Escreva sua resposta…"
          style="width:100%;min-height:100px;padding:8px 10px;border:1px solid #3b82f6;
                 border-radius:6px;background:#0f172a;color:#f8fafc;font-size:13px;
                 resize:vertical;box-sizing:border-box;font-family:inherit"></textarea>
        <div style="font-size:10px;color:#64748b;text-align:right;margin-bottom:10px"
             id="rs-fc-resposta-chars">0/500</div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button onclick="document.getElementById('rs-fc-resposta-modal').remove()"
            style="padding:7px 14px;background:transparent;border:1px solid #475569;
                   border-radius:6px;color:#94a3b8;font-size:12px;cursor:pointer">
            Cancelar
          </button>
          <button id="rs-fc-resposta-btn"
            onclick="window._fcEnviarRespostaAdmin('${solId}')"
            style="padding:7px 14px;background:#1d4ed8;border:none;border-radius:6px;
                   color:#fff;font-size:12px;font-weight:700;cursor:pointer">
            Enviar resposta
          </button>
        </div>
        <div id="rs-fc-resposta-status" style="font-size:11px;margin-top:6px;text-align:right"></div>
      </div>`;
    document.body.appendChild(modal);

    const ta = document.getElementById('rs-fc-resposta-txt');
    const ch = document.getElementById('rs-fc-resposta-chars');
    if (ta) ta.addEventListener('input', () => { ch.textContent = ta.value.length + '/500'; });
    ta?.focus();
  };

  window._fcEnviarRespostaAdmin = async function (solId) {
    const user = window._radarUser;
    const ta = document.getElementById('rs-fc-resposta-txt');
    const btn = document.getElementById('rs-fc-resposta-btn');
    const status = document.getElementById('rs-fc-resposta-status');
    const texto = ta?.value?.trim();
    if (!texto) { status.textContent = '⚠️ Escreva uma resposta.'; status.style.color = '#d97706'; return; }

    btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      await window.db.collection('usuarios').doc(user.uid)
        .collection('solicitacoes').doc(solId)
        .update({ resposta_assinante: texto, lida: true });

      status.textContent = '✅ Resposta enviada!'; status.style.color = '#22c55e';
      _historicoCache = null;
      setTimeout(() => {
        document.getElementById('rs-fc-resposta-modal')?.remove();
        _renderDrawer('mensagem');
      }, 800);
    } catch (e) {
      status.textContent = '❌ Erro: ' + e.message; status.style.color = '#ef4444';
      btn.disabled = false; btn.textContent = 'Enviar resposta';
    }
  };

  // ✅ NOVO: Helper para validar quota de indicação
  function _checarQuotaIndicacao(user) {
    try {
      const _sessao = JSON.parse(localStorage.getItem('rs_pwa_session') || '{}');
      const quota = (_sessao.features || user.features || {}).sugestao_tema_quota || 0;
      if (quota === 0) return { valido: false, erro: 'Seu plano não permite sugestões de tema.' };
      const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
      return window.db.collection('usuarios').doc(user.uid).collection('solicitacoes').where('tipo', '==', 'sugestao_tema').get().then(snap => {
        const uso = snap.docs.filter(d => new Date(d.data().data_solicitacao) >= inicioMes).length;
        if (uso >= quota) return { valido: false, erro: 'Cota mensal de sugestões esgotada.' };
        return { valido: true };
      });
    } catch { return { valido: true }; } // Fallback permissivo se falhar, mas o envio principal valida async
  }

  // ── Buscar histórico ──────────────────────────────────────────────────────
  async function _buscarHistorico(user, forceRefresh = false) {
    if (!forceRefresh && _historicoCache && (Date.now() - _historicoCacheTs) < _HISTORICO_TTL) return _historicoCache;
    try {
      if (user.segmento === 'assinante') {
        const dataCorte = user._assinaturaCreatedAt || null;
        const snap = await window.db.collection('usuarios').doc(user.uid).collection('solicitacoes').where('tipo', 'in', ['mensagem', 'sugestao_tema', 'mensagem_admin']).orderBy('data_solicitacao', 'desc').limit(20).get();
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const resultado = !dataCorte ? docs : docs.filter(d => { const ds = d.data_solicitacao; return ds && new Date(ds) >= dataCorte; });
        _historicoCache = resultado; _historicoCacheTs = Date.now(); return resultado;
      } else {
        const leadId = parseInt(user.uid, 10); if (!leadId) return []; let dataCorte = null;
        try { const { data: leadRow } = await window.supabase.from('leads').select('data_criacao').eq('id', leadId).single(); if (leadRow?.data_criacao) dataCorte = new Date(leadRow.data_criacao); } catch (e) { console.warn('[faleConosco] data_criacao lead:', e.message); }
        let query = window.supabase.from('leads_mensagens').select('*').eq('lead_id', leadId).order('criado_em', { ascending: false }).limit(20);
        if (dataCorte) query = query.gte('criado_em', dataCorte.toISOString());
        const { data, error } = await query; if (error) throw new Error(error.message);
        const resultado = data || []; _historicoCache = resultado; _historicoCacheTs = Date.now(); return resultado;
      }
    } catch (e) { console.warn('[faleConosco] histórico:', e.message); return []; }
  }
  // ── Badge ─────────────────────────────────────────────────────────────────
  async function _atualizarBadge() {
    const badge = document.getElementById('rs-fc-badge');
    if (!badge) return;
    const user = window._radarUser;
    if (!user) { badge.style.display = 'none'; return; }
    try {
      const historico = await _buscarHistorico(user);
      const vistas = _getVistas();
      // Conta: respostas da equipe não vistas + mensagens_admin não lidas
      const novas = historico.filter(m => {
        const key = String(m.id || m.data_solicitacao);
        if (m.tipo === 'mensagem_admin') return !m.lida && !vistas.has(key);
        return m.resposta && !vistas.has(key);
      });
      badge.textContent = novas.length > 9 ? '9+' : String(novas.length);
      badge.style.display = novas.length > 0 ? 'inline-block' : 'none';
      // Notifica menuApp.js
      window._rsMenuAtualizarBadges?.();
    } catch (e) { badge.style.display = 'none'; }
  }
  function _getVistas() { try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_BADGE) || '[]')); } catch { return new Set(); } }
  function _marcarRespostasVistas(historico) {
    try {
      const vistas = _getVistas();
      historico.forEach(m => {
        // Marca como vista: respostas da equipe + mensagens_admin (lida no Firestore, mas também no Set local)
        if (m.resposta || m.tipo === 'mensagem_admin') vistas.add(String(m.id || m.data_solicitacao));
      });
      localStorage.setItem(STORAGE_KEY_BADGE, JSON.stringify([...vistas]));
    } catch { }
  }
  // ── UTILITÁRIOS ───────────────────────────────────────────────────────────
  function _getPeriodoAtual() { return new Date().toISOString().slice(0, 7); }
  function _getPeriodoAnterior() { const d = new Date(); return d.getMonth() === 0 ? `${d.getFullYear() - 1}-12` : `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`; }
  function _formatarPeriodo(periodo) { const [ano, mes] = periodo.split('-'); const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']; return `${meses[parseInt(mes) - 1]} ${ano}`; }
  function _esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
  async function _buscarTextoSolicitacao(solicitacaoPath) { try { if (!solicitacaoPath || typeof solicitacaoPath !== 'string') return ''; const parts = solicitacaoPath.split('/'); if (parts.length < 4) return ''; const doc = await window.db.collection('usuarios').doc(parts[1]).collection('solicitacoes').doc(parts[3]).get(); return doc.exists ? (doc.data().descricao || doc.data().texto || '') : ''; } catch (e) { console.warn('[faleConosco] erro texto:', e.message); return ''; } }
  // ── RENDER: Votação Atual ─────────────────────────────────────────────────
  async function _renderVotacaoAtual(user, temFeatureTema, estadoCiclo = null) {
    try {
      if (!estadoCiclo) estadoCiclo = await _checarEstadosCiclo();
      const podeVotar = user.segmento === 'assinante' && temFeatureTema && estadoCiclo.votacaoAberta;

      if (!estadoCiclo.votacaoAberta) {
        return `<div class="rs-fc-sep">🗳️ Votação</div><div class="rs-fc-vazio">${estadoCiclo.msgVotacao || 'Aguardando abertura.'}</div>`;
      }

      let snap;
      try {
        snap = await window.db.collection('sugestoes_publicas').where('ciclo_id', '==', estadoCiclo.cicloId).orderBy('votos', 'desc').limit(50).get();
      } catch (e) {
        snap = await window.db.collection('sugestoes_publicas').where('ciclo_id', '==', estadoCiclo.cicloId).limit(50).get();
      }

      if (snap.empty) return `<div class="rs-fc-sep">🗳️ Votação</div><div class="rs-fc-vazio">Nenhuma sugestão ativa ainda.</div>`;

      const docsArray = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      docsArray.sort((a, b) => (b.votos || 0) - (a.votos || 0));
      const sugestoes = docsArray.slice(0, 5).map(d => ({ ...d, texto: d.texto_preview || d.texto || '(sem texto)' }));

      let html = `<div class="rs-fc-sep">🗳️ Votação Aberta</div>`;
      sugestoes.forEach((s, i) => {
        const jaVotou = podeVotar ? localStorage.getItem(`rs_voto_sugestao_${s.id}`) : null;
        const voteBtn = podeVotar
          ? `<button class="rs-voto-btn ${jaVotou ? 'votado' : ''}" onclick="window.votarSugestao('${_esc(s.id)}', '${_esc(user.uid)}', '${estadoCiclo.cicloId}')">${jaVotou ? '✅ Votado' : '👍 Votar'}</button>`
          : `<button class="rs-voto-btn" disabled style="opacity:0.4; cursor:not-allowed;">Votação indisponível</button>`;

        const dataEnv = s.criado_em ? new Date(s.criado_em.seconds ? s.criado_em.seconds * 1000 : s.criado_em).toLocaleDateString('pt-BR') : '—';
        html += `
        <div class="rs-sugestao-card">
          <div class="rs-sugestao-header"><span class="rs-sugestao-posicao">#${i + 1}</span><span class="rs-sugestao-votos">👍 ${s.votos || 0}</span></div>
          <div class="rs-sugestao-texto">${_esc(s.texto)}</div>
          <div class="rs-sugestao-data">ENVIADA em ${dataEnv}</div>
          ${voteBtn}
        </div>`;
      });
      return html;
    } catch (err) {
      console.error('[faleConosco] Erro detalhado ao carregar votação:', err);
      return `<div class="rs-fc-vazio"><span>⚠️</span>Erro ao carregar votação.</div>`;
    }
  }
  // ── RENDER: Resultado Mês Anterior ────────────────────────────────────────
  async function _renderResultadoAnterior(user, temFeatureTema) {
    try {
      const periodoAnt = _getPeriodoAnterior();
      const snap = await window.db.collection('sugestoes_publicas').where('periodo', '==', periodoAnt).orderBy('votos', 'desc').get();
      if (snap.empty) return '';
      const raw = snap.docs.map(d => ({ id: d.id, ...d.data() })); let ordenado = raw; if (raw[0]?.ranking_final) { ordenado = raw[0].ranking_final.map(item => { const orig = raw.find(r => r.solicitacao_ref === item.solicitacao_ref); return orig ? { ...orig, posicao_fixa: item.posicao, votos_fixos: item.votos } : null; }).filter(Boolean); } const top5 = ordenado.slice(0, 5).map(s => ({ ...s, texto: s.texto_preview || s.texto || '(sem texto)' })); if (top5.length === 0) return ''; let html = `<div class="rs-resultado-card">`; html += `<div class="rs-resultado-header">🏁 VOTAÇÃO DE ${_formatarPeriodo(periodoAnt).toUpperCase()} ENCERRADA - Veja abaixo o resultado</div>`; top5.forEach((s, i) => { const isWinner = i === 0; const votos = s.votos_fixos !== undefined ? s.votos_fixos : (s.votos || 0); const pos = isWinner ? '🥇' : `#${i + 1}`; const dataEnv = s.criado_em ? new Date(s.criado_em.seconds ? s.criado_em.seconds * 1000 : s.criado_em).toLocaleDateString('pt-BR') : '—'; html += `<div class="rs-res-item ${isWinner ? 'vencedor' : ''}"><div class="rs-res-pos">${pos}</div><div class="rs-res-info"><div class="rs-res-texto">${_esc(s.texto)}</div><div class="rs-res-meta"><span class="rs-res-votos">👍 ${votos}</span><span>ENVIADA em ${dataEnv}</span></div></div></div>`; }); html += `</div>`; return html;
    } catch (err) { console.error('[faleConosco] resultado ant:', err); return ''; }
  }
  // ── Votar ─────────────────────────────────────────────────────────────────
  window.votarSugestao = async function (sugestaoId, userId, cicloId) { // ✅ AJUSTADO: Recebe cicloId
    try {
      // ✅ AJUSTADO: Valida datas do ciclo antes de permitir voto
      const cicloSnap = await window.db.collection('ciclos_votacao').doc(cicloId).get();
      if (!cicloSnap.exists) throw new Error('Ciclo não encontrado.');
      const cicloData = { id: cicloSnap.id, ...cicloSnap.data() };
      const val = _validarJanelaCiclo(cicloData, 'votacao');
      if (!val.valido) throw new Error(val.erro);

      const lsKey = `rs_voto_sugestao_${sugestaoId}`; const jaVotou = localStorage.getItem(lsKey); const ref = window.db.collection('sugestoes_publicas').doc(sugestaoId);
      if (jaVotou) { await ref.update({ votos: firebase.firestore.FieldValue.increment(-1), votantes: firebase.firestore.FieldValue.arrayRemove(userId), atualizado_em: new Date() }); localStorage.removeItem(lsKey); }
      else { await ref.update({ votos: firebase.firestore.FieldValue.increment(1), votantes: firebase.firestore.FieldValue.arrayUnion(userId), atualizado_em: new Date() }); localStorage.setItem(lsKey, 'true'); }
      _renderDrawer('sugestao_tema');
    } catch (err) { console.error('[faleConosco] voto:', err); alert(err.message || 'Erro ao registrar voto.'); }
  };
  // ── Boot ──────────────────────────────────────────────────────────────────
  function _boot() {
    if (window._radarUser && window.db) init();
    else window.addEventListener('radarUserReady', () => setTimeout(init, 500), { once: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot); else _boot();
  window._rsFcAbrir = _abrirDrawer;
  window._rsFcBadgeAtualizar = _atualizarBadge;
  // Cleanup: cancela listener ao destruir (ex: troca de edição)
  window._rsFcDestroy = () => {
    if (_unsubscribeMensagensAdmin) {
      try { _unsubscribeMensagensAdmin(); } catch (_) { }
      _unsubscribeMensagensAdmin = null;
    }
  };
})();