// faleConosco.js
// Botão "Fale Conosco" no app verNewsletterComToken
// ─────────────────────────────────────────────────────────────────────────────
(function () {
'use strict';
const MAX_CHARS = 250;
const STORAGE_KEY_BADGE = 'rs_fc_respondidas_vistas';

// ── Inicialização ─────────────────────────────────────────────────────────
function init() {
  _injetarHTML();
  _injetarCSS();
  _bindEventos();
  _atualizarBadge();
}

// ── HTML ──────────────────────────────────────────────────────────────────
function _injetarHTML() {
  const overlay = document.createElement('div');
  overlay.id = 'rs-fc-overlay';
  overlay.setAttribute('role', 'presentation');
  document.body.appendChild(overlay);

  const drawer = document.createElement('aside');
  drawer.id = 'rs-fc-panel';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', 'Fale Conosco');
  drawer.innerHTML = `
     <div id="rs-fc-header">
       <span id="rs-fc-titulo">💬 Ações</span>
       <button id="rs-fc-fechar" type="button" aria-label="Fechar">×</button>
     </div>
     <div id="rs-fc-body">
       <div class="rs-fc-loading">Carregando…</div>
     </div>
  `;
  document.body.appendChild(drawer);
}

// ── CSS ───────────────────────────────────────────────────────────────────
function _injetarCSS() {
  const style = document.createElement('style');
  style.textContent = `
  #rs-fc-badge { min-width: 18px; height: 18px; padding: 0 5px; background: #22c55e; color: #fff; border-radius: 99px; font-size: 10px; font-weight: 800; line-height: 18px; text-align: center; margin-left: 2px; }
  #rs-fc-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 600; opacity: 0; pointer-events: none; transition: opacity .25s; backdrop-filter: blur(2px); }
  #rs-fc-overlay.rs-fc-show { opacity: 1; pointer-events: all; }
  #rs-fc-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(500px, 96vw); background: var(--rs-card, #1e293b); z-index: 700; display: flex; flex-direction: column; transform: translateX(110%); transition: transform .28s cubic-bezier(.4,0,.2,1); box-shadow: -4px 0 32px rgba(0,0,0,.3); overflow: hidden; }
  #rs-fc-panel.rs-fc-show { transform: translateX(0); }
  #rs-fc-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--rs-borda, rgba(148,163,184,.12)); background: var(--rs-card2, #162032); flex-shrink: 0; }
  #rs-fc-titulo { font-size: 15px; font-weight: 700; color: var(--rs-text, #f8fafc); font-family: 'Syne', system-ui, sans-serif; }
  #rs-fc-fechar { background: none; border: none; color: var(--rs-muted, #94a3b8); font-size: 22px; cursor: pointer; line-height: 1; padding: 0 4px; }
  #rs-fc-fechar:hover { color: var(--rs-text, #f8fafc); }
  #rs-fc-body { flex: 1; overflow-y: auto; padding: 14px 4px; display: flex; flex-direction: column; gap: 12px; }
  .rs-fc-loading, .rs-fc-vazio { text-align: center; padding: 40px 20px; color: var(--rs-muted, #94a3b8); font-size: 13px; line-height: 1.6; }
  .rs-fc-vazio span { font-size: 36px; display: block; margin-bottom: 12px; }
  .rs-fc-aviso { background: rgba(14,116,144,.12); border: 1px solid rgba(14,116,144,.25); border-radius: 8px; padding: 10px 12px; font-size: 12px; color: var(--rs-muted, #94a3b8); line-height: 1.5; }
  .rs-fc-tipos { display: flex; gap: 8px; flex-wrap: wrap; }
  .rs-fc-tipo-btn { flex: 1; min-width: 120px; padding: 10px 8px; background: var(--rs-card2, #162032); border: 2px solid var(--rs-borda, rgba(148,163,184,.12)); border-radius: 10px; color: var(--rs-text, #f8fafc); font-size: 12px; font-weight: 600; font-family: 'Syne', system-ui, sans-serif; cursor: pointer; text-align: center; transition: border-color .15s, background .15s; }
  .rs-fc-tipo-btn:hover { border-color: #0e7490; }
  .rs-fc-tipo-btn.ativo { border-color: #0e7490; background: rgba(14,116,144,.15); }
  .rs-fc-tipo-btn.bloqueado { opacity: .6; cursor: default; border-style: dashed; }
  .rs-fc-label { font-size: 12px; font-weight: 600; color: var(--rs-muted, #94a3b8); margin-bottom: 4px; display: block; }
  .rs-fc-textarea { width: 100%; background: var(--rs-card2, #162032); border: 1px solid var(--rs-borda, rgba(148,163,184,.12)); border-radius: 8px; color: var(--rs-text, #f8fafc); font-size: 13px; line-height: 1.5; padding: 10px 12px; resize: vertical; min-height: 110px; font-family: inherit; transition: border-color .15s; }
  .rs-fc-textarea:focus { outline: none; border-color: #0e7490; }
  .rs-fc-chars { font-size: 11px; color: var(--rs-muted, #94a3b8); text-align: right; margin-top: 2px; }
  .rs-fc-chars.limite { color: #ef4444; font-weight: 700; }
  .rs-fc-enviar { width: 100%; padding: 11px; background: #0e7490; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 700; font-family: 'Syne', system-ui, sans-serif; cursor: pointer; transition: background .15s; }
  .rs-fc-enviar:hover { background: #0c6680; }
  .rs-fc-enviar:disabled { opacity: .5; cursor: not-allowed; }
  .rs-fc-sep { font-size: 11px; font-weight: 700; color: var(--rs-muted, #94a3b8); text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid var(--rs-borda, rgba(148,163,184,.12)); padding-bottom: 6px; margin-top: 4px; display: block; width: 100%; }
  .rs-fc-msg-card { background: var(--rs-card2, #162032); border: 1px solid var(--rs-borda, rgba(148,163,184,.12)); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
  .rs-fc-msg-card.respondida { border-color: #22c55e; }
  .rs-fc-msg-topo { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .rs-fc-msg-tipo { font-size: 11px; font-weight: 700; color: var(--rs-muted, #94a3b8); text-transform: uppercase; letter-spacing: .5px; }
  .rs-fc-msg-data { font-size: 11px; color: var(--rs-muted, #94a3b8); }
  .rs-fc-msg-texto { font-size: 13px; color: var(--rs-text, #f8fafc); line-height: 1.5; }
  .rs-fc-msg-resposta { background: rgba(34,197,94,.1); border-left: 3px solid #22c55e; border-radius: 4px; padding: 8px 10px; font-size: 12px; color: var(--rs-text, #f8fafc); line-height: 1.5; }
  .rs-fc-msg-resposta-label { font-size: 10px; font-weight: 700; color: #22c55e; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
  .rs-fc-badge-status { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 99px; text-transform: uppercase; }
  .rs-fc-badge-status.aberta { background: rgba(251,191,36,.15); color: #d97706; }
  .rs-fc-badge-status.respondida { background: rgba(34,197,94,.15); color: #16a34a; }
  
  .rs-sugestao-card { background: var(--rs-card2, #162032); border: 1px solid var(--rs-borda, rgba(148,163,184,.12)); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
  .rs-sugestao-header { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--rs-muted, #94a3b8); }
  .rs-sugestao-posicao { font-weight: 700; color: #0e7490; }
  .rs-sugestao-votos { font-weight: 600; }
  .rs-sugestao-texto { font-size: 13px; color: var(--rs-text, #f8fafc); line-height: 1.4; }
  .rs-sugestao-data { font-size: 10px; color: var(--rs-muted, #94a3b8); text-transform: uppercase; letter-spacing: .5px; }
  .rs-voto-btn { align-self: flex-start; padding: 6px 12px; background: var(--rs-card2, #162032); border: 2px solid var(--rs-borda, rgba(148,163,184,.12)); border-radius: 20px; color: var(--rs-text, #f8fafc); font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s; }
  .rs-voto-btn:hover { border-color: #0e7490; background: rgba(14,116,144,.1); }
  .rs-voto-btn.votado { border-color: #22c55e; background: rgba(34,197,94,.15); color: #22c55e; }

  .rs-resultado-card { background: var(--rs-card2, #162032); border: 1px solid var(--rs-borda, rgba(148,163,184,.12)); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; margin: 8px 0; }
  .rs-resultado-header { font-size: 12px; font-weight: 700; color: #a78bfa; text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px dashed var(--rs-borda); padding-bottom: 8px; margin-bottom: 2px; }
  .rs-res-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid rgba(148,163,184,.08); }
  .rs-res-item:last-child { border-bottom: none; }
  .rs-res-pos { font-weight: 800; font-size: 14px; min-width: 28px; color: var(--rs-muted, #94a3b8); }
  .rs-res-item.vencedor .rs-res-pos { color: #fbbf24; font-size: 16px; }
  .rs-res-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .rs-res-texto { font-size: 13px; color: var(--rs-text, #f8fafc); line-height: 1.3; }
  .rs-res-item.vencedor .rs-res-texto { font-weight: 700; color: #fbbf24; }
  .rs-res-meta { font-size: 10px; color: var(--rs-muted, #94a3b8); display: flex; gap: 8px; align-items: center; }
  .rs-res-votos { background: rgba(14,116,144,.15); color: #0e7490; padding: 2px 6px; border-radius: 4px; font-weight: 700; }
  `;
  document.head.appendChild(style);
}

// ── Eventos ───────────────────────────────────────────────────────────────
function _bindEventos() {
  document.getElementById('rs-fc-fechar').addEventListener('click', _fecharDrawer);
  document.getElementById('rs-fc-overlay').addEventListener('click', _fecharDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _fecharDrawer(); });
}

// ── Abrir / Fechar ────────────────────────────────────────────────────────
function _abrirDrawer() {
  document.getElementById('rs-fc-overlay').classList.add('rs-fc-show');
  document.getElementById('rs-fc-panel').classList.add('rs-fc-show');
  document.body.style.overflow = 'hidden';
  _renderDrawer('mensagem');
}
function _fecharDrawer() {
  document.getElementById('rs-fc-overlay').classList.remove('rs-fc-show');
  document.getElementById('rs-fc-panel').classList.remove('rs-fc-show');
  document.body.style.overflow = '';
  _atualizarBadge();
}

// ── Render principal ──────────────────────────────────────────────────────
async function _renderDrawer(tipoAtivo = 'mensagem') {
  const body = document.getElementById('rs-fc-body');
  body.innerHTML = '<div class="rs-fc-loading">Carregando…</div>';
  const user = window._radarUser;
  if (!user) {
    body.innerHTML = '<div class="rs-fc-vazio"><span>🔒</span>Faça login para enviar mensagens.</div>';
    return;
  }

  const isAssinante = user.segmento === 'assinante';
  let quotaTema = 0;
  let usoTemaMes = 0;

  if (isAssinante && user.assinaturaId) {
    try {
      const assinSnap = await window.db.collection('usuarios').doc(user.uid).collection('assinaturas').doc(user.assinaturaId).get();
      if (assinSnap.exists) {
        const feat = assinSnap.data().features_snapshot || {};
        quotaTema = feat.sugestao_tema_quota || 0;
      }
      if (quotaTema > 0) {
        const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
        const snap = await window.db.collection('usuarios').doc(user.uid).collection('solicitacoes').where('tipo', '==', 'sugestao_tema').get();
        usoTemaMes = snap.docs.filter(d => { const ds = d.data().data_solicitacao; return ds && new Date(ds) >= inicioMes; }).length;
      }
    } catch(e) { console.warn('[faleConosco] quota:', e.message); }
  }

  const historico = await _buscarHistorico(user);
  _marcarRespostasVistas(historico);

  let html = '';
  const avisoTexto = tipoAtivo === 'sugestao_tema'
    ? 'Esta área é destinada apenas para sugestão de temas para as próximas edições.'
    : 'Este canal é para dúvidas sobre a sua assinatura e feedbacks.';
  html += `<div class="rs-fc-aviso">${avisoTexto}</div>`;

  const quotaEsgotada = quotaTema > 0 && usoTemaMes >= quotaTema;
  const temFeatureTema = isAssinante && quotaTema > 0;

  // ABAS
  html += `<div class="rs-fc-tipos">`;
  html += `<button class="rs-fc-tipo-btn ${tipoAtivo === 'mensagem' ? 'ativo' : ''}" onclick="window._fcSelecionarTipo('mensagem')">💬 Mensagem</button>`;
  if (isAssinante) {
    if (temFeatureTema) {
      const btnClass = `rs-fc-tipo-btn ${tipoAtivo === 'sugestao_tema' ? 'ativo' : ''} ${quotaEsgotada ? 'bloqueado' : ''}`;
      const btnOnclick = quotaEsgotada ? '' : `onclick="window._fcSelecionarTipo('sugestao_tema')"`;
      const btnText = quotaEsgotada ? '⛔ Cota esgotada' : '💡 Sugerir tema';
      html += `<button class="${btnClass}" ${btnOnclick}>${btnText}</button>`;
    } else {
      html += `<button class="rs-fc-tipo-btn bloqueado" title="Disponível em planos superiores">💡 Sugerir tema 🔒</button>`;
    }
  }
  html += `</div>`;

  // FLUXO SOLICITADO
  if (tipoAtivo === 'sugestao_tema') {
    html += await _renderVotacaoAtual(user, temFeatureTema);
    if (!quotaEsgotada) {
      html += `
        <div style="margin-top: 16px;">
          <label class="rs-fc-label" for="rs-fc-txt">💡 Sugestão de tema</label>
          <textarea id="rs-fc-txt" class="rs-fc-textarea" placeholder="Descreva o tema que gostaria que fosse abordado…" maxlength="${MAX_CHARS}"></textarea>
          <div class="rs-fc-chars" id="rs-fc-chars">0/${MAX_CHARS}</div>
        </div>
        <button class="rs-fc-enviar" id="rs-fc-enviar" disabled onclick="window._fcEnviar('sugestao_tema')">Enviar</button>
      `;
    }
    html += await _renderResultadoAnterior(user, temFeatureTema);
  } else {
    html += `
      <div>
        <label class="rs-fc-label" for="rs-fc-txt">💬 Nova mensagem</label>
        <textarea id="rs-fc-txt" class="rs-fc-textarea" placeholder="Digite sua mensagem ou dúvida…" maxlength="${MAX_CHARS}"></textarea>
        <div class="rs-fc-chars" id="rs-fc-chars">0/${MAX_CHARS}</div>
      </div>
      <button class="rs-fc-enviar" id="rs-fc-enviar" disabled onclick="window._fcEnviar('mensagem')">Enviar</button>
    `;
  }

  // HISTÓRICO
  const historicoFiltrado = tipoAtivo === 'mensagem'
    ? historico.filter(m => m.tipo !== 'sugestao_tema')
    : historico.filter(m => m.tipo === 'sugestao_tema');

  if (historicoFiltrado.length > 0) {
    html += `<div class="rs-fc-sep">Histórico</div>`;
    historicoFiltrado.forEach(msg => {
      const respondida = !!msg.resposta;
      const data = msg.criado_em ? new Date(msg.criado_em?.seconds ? msg.criado_em.seconds * 1000 : msg.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' }) : '—';
      const tipoLabel = msg.tipo === 'sugestao_tema' ? '💡 Sugestão de tema' : '💬 Mensagem';
      const respostaHtml = respondida ? `<div class="rs-fc-msg-resposta"><div class="rs-fc-msg-resposta-label">✅ Resposta da equipe</div>${msg.resposta}</div>` : '';
      html += `
        <div class="rs-fc-msg-card ${respondida ? 'respondida' : ''}">
          <div class="rs-fc-msg-topo">
            <span class="rs-fc-msg-tipo">${tipoLabel}</span>
            <div style="display:flex;gap:6px;align-items:center">
              <span class="rs-fc-badge-status ${respondida ? 'respondida' : 'aberta'}">${msg.tipo === 'sugestao_tema' ? 'Enviada' : (respondida ? 'Respondida' : 'Aguardando')}</span>
              <span class="rs-fc-msg-data">${data}</span>
            </div>
          </div>
          <div class="rs-fc-msg-texto">${msg.texto || msg.descricao || ''}</div>
          ${respostaHtml}
        </div>`;
    });
  } else {
    html += `<div class="rs-fc-vazio"><span>💬</span>Nenhuma mensagem ainda.</div>`;
  }

  body.innerHTML = html;

  const textarea = document.getElementById('rs-fc-txt');
  const chars = document.getElementById('rs-fc-chars');
  const btnEnv = document.getElementById('rs-fc-enviar');
  if (textarea) {
    textarea.addEventListener('input', () => {
      const n = textarea.value.length;
      chars.textContent = `${n}/${MAX_CHARS}`;
      chars.classList.toggle('limite', n >= MAX_CHARS);
      if (btnEnv) btnEnv.disabled = n === 0;
    });
  }
}

// ── Selecionar tipo ───────────────────────────────────────────────────────
window._fcSelecionarTipo = function(tipo) { _renderDrawer(tipo); };

// ── Enviar mensagem ───────────────────────────────────────────────────────
window._fcEnviar = async function(tipo) {
  const textarea = document.getElementById('rs-fc-txt');
  const btnEnv = document.getElementById('rs-fc-enviar');
  const texto = textarea?.value?.trim();
  if (!texto) return;
  const user = window._radarUser;
  if (!user) return;

  if (btnEnv) { btnEnv.disabled = true; btnEnv.textContent = 'Enviando…'; }

  try {
    if (user.segmento === 'assinante') {
      const solicitacaoRef = await window.db.collection('usuarios').doc(user.uid).collection('solicitacoes').add({
        tipo, descricao: texto, status: 'aberta', data_solicitacao: new Date().toISOString()
      });

      if (tipo === 'sugestao_tema') {
        await _autoEncerrarMesAnterior();
        const periodoAtual = new Date().toISOString().slice(0, 7);
        await window.db.collection('sugestoes_publicas').doc(`sugestao_${solicitacaoRef.id}`).set({
          solicitacao_ref: solicitacaoRef.path,
          texto_preview: texto.substring(0, 100) + (texto.length > 100 ? '...' : ''),
          autor_uid: user.uid, votos: 0, votantes: [], status: 'ativa', periodo: periodoAtual, criado_em: new Date(), atualizado_em: new Date()
        });
      }
      await window.db.collection('admin_contadores').doc('pendencias').set({ solicitacoes: firebase.firestore.FieldValue.increment(1) }, { merge: true });
    } else {
      const leadId = parseInt(user.uid, 10);
      if (!leadId) throw new Error('ID do lead inválido.');
      const { error } = await window.supabase.from('leads_mensagens').insert({ lead_id: leadId, texto, tipo });
      if (error) throw new Error(error.message);
      await window.db.collection('admin_contadores').doc('pendencias').set({ leads_mensagens: firebase.firestore.FieldValue.increment(1) }, { merge: true });
    }

    if (btnEnv) { btnEnv.textContent = '✅ Enviado!'; btnEnv.disabled = true; }
    setTimeout(() => _renderDrawer(tipo), 700);
  } catch(e) {
    console.error('[faleConosco] enviar:', e);
    if (btnEnv) { btnEnv.disabled = false; btnEnv.textContent = 'Enviar'; }
    alert('Erro ao enviar. Tente novamente.');
  }
};

// ── Buscar histórico ──────────────────────────────────────────────────────
async function _buscarHistorico(user) {
  try {
    if (user.segmento === 'assinante') {
      const snap = await window.db.collection('usuarios').doc(user.uid).collection('solicitacoes').where('tipo', 'in', ['mensagem', 'sugestao_tema']).orderBy('data_solicitacao', 'desc').limit(20).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } else {
      const { data, error } = await window.supabase.from('leads_mensagens').select('*').eq('lead_id', parseInt(user.uid, 10)).order('criado_em', { ascending: false }).limit(20);
      if (error) throw new Error(error.message);
      return data || [];
    }
  } catch(e) { console.warn('[faleConosco] histórico:', e.message); return []; }
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
    const novas = historico.filter(m => m.resposta && !vistas.has(String(m.id || m.data_solicitacao)));
    badge.textContent = novas.length > 9 ? '9+' : String(novas.length);
    badge.style.display = novas.length > 0 ? 'inline-block' : 'none';
  } catch(e) { badge.style.display = 'none'; }
}
function _getVistas() { try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_BADGE) || '[]')); } catch { return new Set(); } }
function _marcarRespostasVistas(historico) {
  try {
    const vistas = _getVistas();
    historico.forEach(m => { if (m.resposta) vistas.add(String(m.id || m.data_solicitacao)); });
    localStorage.setItem(STORAGE_KEY_BADGE, JSON.stringify([...vistas]));
  } catch {}
}

// ── UTILITÁRIOS ───────────────────────────────────────────────────────────
function _getPeriodoAtual() { return new Date().toISOString().slice(0, 7); }
function _getPeriodoAnterior() {
  const d = new Date(); return d.getMonth() === 0 ? `${d.getFullYear()-1}-12` : `${d.getFullYear()}-${String(d.getMonth()).padStart(2,'0')}`;
}
function _formatarDataBr(dateInput) {
  if (!dateInput) return '—';
  const d = new Date(dateInput?.seconds ? dateInput.seconds * 1000 : dateInput);
  return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR');
}
function _formatarPeriodo(periodo) {
  const [ano, mes] = periodo.split('-');
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return `${meses[parseInt(mes)-1]} ${ano}`;
}
function _esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

async function _buscarTextoSolicitacao(solicitacaoPath) {
  try {
    if (!solicitacaoPath || typeof solicitacaoPath !== 'string') return '';
    const parts = solicitacaoPath.split('/');
    if (parts.length < 4) return '';
    const doc = await window.db.collection('usuarios').doc(parts[1]).collection('solicitacoes').doc(parts[3]).get();
    return doc.exists ? (doc.data().descricao || doc.data().texto || '') : '';
  } catch (e) { console.warn('[faleConosco] erro texto:', e.message); return ''; }
}

// ── AUTOMATIZAÇÃO: Encerrar mês anterior ──────────────────────────────────
async function _autoEncerrarMesAnterior() {
  try {
    const periodoAnterior = _getPeriodoAnterior();
    const snap = await window.db.collection('sugestoes_publicas').where('status', '==', 'ativa').where('periodo', '==', periodoAnterior).get();
    if (!snap.empty) {
      const batch = window.db.batch();
      const rankingFinal = [];
      snap.docs.sort((a,b) => (b.data().votos||0)-(a.data().votos||0)).forEach((doc, i) => {
        const d = doc.data();
        rankingFinal.push({ posicao: i+1, votos: d.votos, texto_preview: d.texto_preview, solicitacao_ref: d.solicitacao_ref });
        batch.update(doc.ref, { status: 'encerrada', ranking_final: rankingFinal, encerrado_em: new Date() });
      });
      await batch.commit();
    }
  } catch (err) { console.warn('[faleConosco] auto-encerrar:', err); }
}

// ── RENDER: Votação Atual (COM FALLBACK DE ÍNDICE) ────────────────────────
async function _renderVotacaoAtual(user, temFeatureTema) {
  try {
    let snap;
    try {
      // Tenta usar índice composto do Firestore
      snap = await window.db.collection('sugestoes_publicas')
        .where('status', '==', 'ativa')
        .where('periodo', '==', _getPeriodoAtual())
        .orderBy('votos', 'desc')
        .limit(50)
        .get();
    } catch (e) {
      // Fallback se o índice não existir ou falhar
      console.warn('[faleConosco] Índice composto indisponível. Ordenando no cliente.', e);
      snap = await window.db.collection('sugestoes_publicas')
        .where('status', '==', 'ativa')
        .where('periodo', '==', _getPeriodoAtual())
        .limit(50)
        .get();
    }

    if (snap.empty) return `<div class="rs-fc-sep">🗳️ Votação Atual</div><div class="rs-fc-vazio">Nenhuma sugestão ativa ainda.</div>`;

    // Ordenação segura no cliente
    const docsArray = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docsArray.sort((a, b) => (b.votos || 0) - (a.votos || 0));
    const top5 = docsArray.slice(0, 5);

    const sugestoes = await Promise.all(top5.map(async d => ({
      ...d,
      texto: await _buscarTextoSolicitacao(d.solicitacao_ref)
    })));

    const podeVotar = user.segmento === 'assinante' && temFeatureTema;
    let html = `<div class="rs-fc-sep">🗳️ Votação Atual</div>`;

    sugestoes.forEach((s, i) => {
      const jaVotou = podeVotar ? localStorage.getItem(`rs_voto_sugestao_${s.id}`) : null;
      const voteBtn = podeVotar ? `<button class="rs-voto-btn ${jaVotou ? 'votado' : ''}" onclick="window.votarSugestao('${_esc(s.id)}', '${_esc(user.uid)}')">${jaVotou ? '✅ Votado' : '👍 Votar'}</button>` : '';
      html += `
        <div class="rs-sugestao-card">
          <div class="rs-sugestao-header"><span class="rs-sugestao-posicao">#${i+1}</span><span class="rs-sugestao-votos">👍 ${s.votos || 0}</span></div>
          <div class="rs-sugestao-texto">${_esc(s.texto)}</div>
          <div class="rs-sugestao-data">ENVIADA em ${_formatarDataBr(s.criado_em)}</div>
          ${voteBtn}
        </div>`;
    });
    return html;
  } catch (err) {
    console.error('[faleConosco] Erro detalhado ao carregar votação:', err); // <-- Log visível no DevTools
    return `<div class="rs-fc-vazio"><span>⚠️</span>Erro ao carregar votação. Verifique o console.</div>`;
  }
}

// ── RENDER: Resultado Mês Anterior ────────────────────────────────────────
async function _renderResultadoAnterior(user, temFeatureTema) {
  try {
    const periodoAnt = _getPeriodoAnterior();
    const snap = await window.db.collection('sugestoes_publicas').where('periodo', '==', periodoAnt).orderBy('votos', 'desc').get();
    if (snap.empty) return '';

    const raw = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    let ordenado = raw;
    if (raw[0]?.ranking_final) {
      ordenado = raw[0].ranking_final.map(item => {
        const orig = raw.find(r => r.solicitacao_ref === item.solicitacao_ref);
        return orig ? { ...orig, posicao_fixa: item.posicao, votos_fixos: item.votos } : null;
      }).filter(Boolean);
    }

    const top5 = await Promise.all(ordenado.slice(0, 5).map(async s => ({ ...s, texto: await _buscarTextoSolicitacao(s.solicitacao_ref) })));
    if (top5.length === 0) return '';

    let html = `<div class="rs-resultado-card">`;
    html += `<div class="rs-resultado-header">🏁 VOTAÇÃO DE ${_formatarPeriodo(periodoAnt).toUpperCase()} ENCERRADA - Veja abaixo o resultado</div>`;
    
    top5.forEach((s, i) => {
      const isWinner = i === 0;
      const votos = s.votos_fixos !== undefined ? s.votos_fixos : (s.votos || 0);
      const pos = isWinner ? '🥇' : `#${i+1}`;
      html += `
        <div class="rs-res-item ${isWinner ? 'vencedor' : ''}">
          <div class="rs-res-pos">${pos}</div>
          <div class="rs-res-info">
            <div class="rs-res-texto">${_esc(s.texto)}</div>
            <div class="rs-res-meta">
              <span class="rs-res-votos">👍 ${votos}</span>
              <span>ENVIADA em ${_formatarDataBr(s.criado_em)}</span>
            </div>
          </div>
        </div>`;
    });
    html += `</div>`;
    return html;
  } catch (err) { console.error('[faleConosco] resultado ant:', err); return ''; }
}

// ── Votar ─────────────────────────────────────────────────────────────────
window.votarSugestao = async function(sugestaoId, userId) {
  try {
    const lsKey = `rs_voto_sugestao_${sugestaoId}`;
    const jaVotou = localStorage.getItem(lsKey);
    const ref = window.db.collection('sugestoes_publicas').doc(sugestaoId);
    if (jaVotou) {
      await ref.update({ votos: firebase.firestore.FieldValue.increment(-1), votantes: firebase.firestore.FieldValue.arrayRemove(userId), atualizado_em: new Date() });
      localStorage.removeItem(lsKey);
    } else {
      await ref.update({ votos: firebase.firestore.FieldValue.increment(1), votantes: firebase.firestore.FieldValue.arrayUnion(userId), atualizado_em: new Date() });
      localStorage.setItem(lsKey, 'true');
    }
    _renderDrawer('sugestao_tema');
  } catch (err) { console.error('[faleConosco] voto:', err); alert('Erro ao registrar voto.'); }
};

// ── Boot ──────────────────────────────────────────────────────────────────
function _boot() {
  if (window._radarUser && window.db) init();
  else window.addEventListener('radarUserReady', () => setTimeout(init, 500), { once: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot);
else _boot();

window._rsFcAbrir = _abrirDrawer;
window._rsFcBadgeAtualizar = _atualizarBadge;
})();