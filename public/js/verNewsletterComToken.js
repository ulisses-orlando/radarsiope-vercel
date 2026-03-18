/* ==========================================================================
   verNewsletterComToken.js — Radar SIOPE  (versão final)
   Dependências globais:
     window.db                → firebase-init.js
     window.supabase          → supabase-browser.js
     window.SupabaseMunicipio → supabase-municipio.js (v2)
     aplicarPlaceholders()    → functions.js
   ========================================================================== */

'use strict';

// Variável global para dados do município (histórico)
let dadosMunicipioAtual = {
  cod_municipio: null,
  nome: null,
  uf: null
};

// ─── Parâmetros da URL ────────────────────────────────────────────────────────

function normalizeParam(value) {
  if (!value) return null;
  const t = String(value).trim();
  if (!t || t.toLowerCase().includes('sem envioid') ||
    t.includes('{{') || t.includes('}}')) return null;
  return t;
}

function getParams() {
  const params = new URLSearchParams(window.location.search);

  // Parâmetro ofuscado Base64 (mantido idêntico ao original)
  const d = params.get('d');
  if (d) {
    try {
      const decoded = atob(decodeURIComponent(d));
      new URLSearchParams(decoded).forEach((v, k) => params.set(k, v));
    } catch (e) {
      console.warn('[verNL] Falha ao decodificar parâmetro d:', e);
    }
  }

  // URL limpa /edicao/001 → extrai número do pathname
  const match = window.location.pathname.match(/\/edicao\/([^/?#]+)/);
  if (match && !params.get('nid')) {
    params.set('edicao_numero', match[1]);
  }

  return params;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function mostrarLoading(sim) {
  const el = document.getElementById('rs-loading');
  if (el) el.style.display = sim ? 'flex' : 'none';
}

function mostrarErro(msg, detalhe = '') {
  mostrarLoading(false);
  const el = document.getElementById('rs-erro');
  const msgEl = document.getElementById('rs-erro-msg');
  if (el) el.style.display = 'block';
  if (msgEl) msgEl.innerHTML = msg +
    (detalhe ? `<br><small style="color:#94a3b8;margin-top:6px;display:block">${detalhe}</small>` : '');
}

function mostrarApp() {
  mostrarLoading(false);
  const el = document.getElementById('rs-app');
  if (!el) return;
  el.style.opacity = '0';
  el.style.transition = 'opacity .35s ease';
  el.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1'; }));
}

function _fmtData(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function _esc(s) {
  return String(s || '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

function _set(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

// ─── Toggle modo rápido / completo ────────────────────────────────────────────

function trocarModo(modo) {
  const rapido = document.getElementById('modo-rapido');
  const completo = document.getElementById('modo-completo');
  const btnR = document.getElementById('btn-rapido');
  const btnC = document.getElementById('btn-completo');

  if (modo === 'rapido') {
    rapido?.classList.add('visivel');
    completo?.classList.remove('visivel');
    btnR?.classList.add('ativo');
    btnC?.classList.remove('ativo');
    // Desativa flipbook se estiver ativo
    window._flipbook?.desativarFlipbook();
  } else {
    completo?.classList.add('visivel');
    rapido?.classList.remove('visivel');
    btnC?.classList.add('ativo');
    btnR?.classList.remove('ativo');
    // Ativa flipbook no mobile (aguarda a section ficar visível)
    if (window._flipbook && window.innerWidth <= 768) {
      setTimeout(() => window._flipbook.construirFlipbook(), 50);
    }
  }
  sessionStorage.setItem('rs_modo_leitura', modo);
}

// ─── Registro de clique (fire & forget) ──────────────────────────────────────

function registrarClique(env, uid, nid) {
  fetch(
    `https://api.radarsiope.com.br/api/click` +
    `?envioId=${encodeURIComponent(env)}` +
    `&destinatarioId=${encodeURIComponent(uid)}` +
    `&newsletterId=${encodeURIComponent(nid)}` +
    `&url=${encodeURIComponent(window.location.href)}`,
    { method: 'GET', keepalive: true }
  ).catch(() => { });
}

// ─── Montagem de blocos (idêntico ao original) ────────────────────────────────

async function montarBlocos(newsletter, dados, segmento) {
  let htmlBase = newsletter.conteudo_html_completo || '';
  const blocos = newsletter.blocos || [];
  let htmlBlocos = '';

  blocos.forEach(b => {
    // Filtro de acesso (existente)
    if (segmento && b.acesso !== 'todos' && b.acesso !== segmento) return;
    // Filtro de destino: blocos só de e-mail não aparecem no app
    if (b.destino === 'email') return;
    // Envolve em wrapper com data-tipo para o flipbook paginar por tipo
    const tipo = b.tipo || 'conteudo';
    htmlBlocos += `<div class="rs-bloco" data-tipo="${tipo}">${b.html || ''}</div>`;
  });

  const htmlFinal = blocos.length === 0
    ? htmlBase
    : htmlBase.includes('{{blocos}}')
      ? htmlBase.replace('{{blocos}}', htmlBlocos)
      : htmlBase + '\n' + htmlBlocos;

  return aplicarPlaceholders(htmlFinal, dados);
}

// ─── Regras de acesso por segmento / plano ────────────────────────────────────

function detectarAcesso(destinatario, newsletter, segmento, envio) {
  const isAssinante = segmento === 'assinantes';
  const plano_slug = destinatario.plano_slug || null;
  const features = destinatario.features || {};

  // ── Acesso temporário para leads: valida janela de horas real ────────────
  // Leva em conta o horário de abertura (envio.primeiro_acesso ou envio.criado_em)
  // versus acesso_pro_horas da newsletter.
  let acessoProTemp = false;
  if (!isAssinante
    && newsletter.acesso_pro_temporario === true
    && (newsletter.acesso_pro_horas || 0) > 0) {

    // Tenta obter o timestamp de referência do envio (primeiro acesso ou data de criação)
    const ref = envio?.primeiro_acesso || envio?.expira_em || null;
    if (ref) {
      // expira_em é mais direto: se existir e ainda não venceu, concede acesso
      const expira = ref.toDate ? ref.toDate() : new Date(ref);
      acessoProTemp = new Date() < expira;
    } else {
      // fallback: sem timestamp de referência, nega o acesso temporário
      acessoProTemp = false;
    }
  }

  return {
    isAssinante,
    plano_slug,
    features,
    acessoProTemp,
    temAudio: isAssinante ? !!features.newsletter_audio
      : (!!newsletter.acesso_audio_leads || acessoProTemp),
    temInfografico: isAssinante ? !!features.newsletter_infografico : acessoProTemp,
    temVideo: isAssinante ? !!features.newsletter_video : acessoProTemp,
    temAlertas: isAssinante && !!features.alertas_prioritarios,
    blurMunicipio: !isAssinante && !acessoProTemp,
    truncarTexto: !isAssinante && !acessoProTemp,
    modoPadrao: isAssinante && window.innerWidth > 768 ? 'completo' : 'rapido',
  };
}

// ─── Header ───────────────────────────────────────────────────────────────────

function renderHeader(newsletter, destinatario) {
  const num = newsletter.numero || newsletter.edicao || '—';
  const titulo = newsletter.titulo || 'Radar SIOPE';
  const nome = (destinatario.nome || '').split(' ')[0];

  _set('hd-edicao', `Edição ${num}`);
  _set('hd-data', _fmtData(newsletter.data_publicacao));
  _set('hd-titulo', titulo);
  _set('hd-saudacao', nome ? `Olá, ${nome}!` : '');
  document.title = `Radar SIOPE · Ed. ${num} · ${titulo}`;
}

// ─── Modo rápido — bullets ────────────────────────────────────────────────────

function renderModoRapido(newsletter, acesso) {
  const lista = document.getElementById('lista-bullets');
  const bullets = newsletter.resumo_bullets || [];

  if (!bullets.length) {
    document.getElementById('rs-toggle-modo')?.style.setProperty('display', 'none');
    trocarModo('completo');
    return;
  }

  const visiveis = (acesso.isAssinante || acesso.acessoProTemp) ? bullets : bullets.slice(0, 2);
  const temRestante = !acesso.isAssinante && !acesso.acessoProTemp && bullets.length > 2;

  if (lista) lista.innerHTML = visiveis.map(b => `<li>${_esc(b)}</li>`).join('');

  if (temRestante && lista) {
    lista.closest('.rs-section-body')?.classList.add('rs-bullets-truncado');
    lista.insertAdjacentHTML('afterend', `
      <div style="text-align:center;padding:14px 0 0;position:relative;z-index:1">
        <a href="/assinatura.html"
           style="font-size:13px;font-weight:700;color:var(--azul);text-decoration:none">
          + ${bullets.length - 2} pontos restantes — Assine para ver todos →
        </a>
      </div>`);
  }
}

// ─── Modo completo — HTML da edição ───────────────────────────────────────────

async function renderModoCompleto(newsletter, dados, segmento, acesso) {
  const container = document.getElementById('conteudo-newsletter');
  if (!container) return;

  if (!newsletter.conteudo_html_completo && !newsletter.blocos?.length) {
    container.innerHTML = '<p style="color:#94a3b8;font-size:14px">Conteúdo não disponível.</p>';
    return;
  }

  const html = await montarBlocos(newsletter, dados, segmento);

  if (acesso.truncarTexto) {
    const wrap = container.parentElement;
    container.innerHTML = html;
    container.style.cssText = 'max-height:300px;overflow:hidden;position:relative';

    // Fade overlay
    const fade = document.createElement('div');
    fade.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:120px;' +
      'background:linear-gradient(transparent,#fff);pointer-events:none';
    container.appendChild(fade);

    wrap.insertAdjacentHTML('afterend', `
      <div style="text-align:center;padding:16px 0">
        <a href="/assinatura.html"
           style="display:inline-block;padding:11px 28px;background:var(--azul);
                  color:#fff;border-radius:8px;font-size:13px;font-weight:700;
                  text-decoration:none;box-shadow:0 2px 10px rgba(10,61,98,.2)">
          📖 Ler edição completa — Assine agora →
        </a>
      </div>`);
  } else {
    container.innerHTML = html;
  }
}

// ─── Município (API v2: getResumoMunicipio + renderSecaoMunicipio) ─────────────

async function renderMunicipio(destinatario, acesso) {
  const container = document.getElementById('municipio-conteudo');
  const titulo = document.getElementById('municipio-titulo');
  const nome = destinatario.nome_municipio || '';
  const uf = destinatario.cod_uf || '';
  const cod = destinatario.cod_municipio || null;

  if (titulo && nome) titulo.textContent = `${nome}/${uf}`;

  // Aguarda SupabaseMunicipio estar pronto (carrega após o JS principal)
  await new Promise(resolve => {
    if (window.SupabaseMunicipio) return resolve();
    let n = 0;
    const t = setInterval(() => {
      if (window.SupabaseMunicipio || ++n > 40) { clearInterval(t); resolve(); }
    }, 100);
  });

  const SM = window.SupabaseMunicipio;
  if (!SM || !container) return;

  SM.renderSkeleton(container);

  try {
    const resumo = cod ? await SM.getResumoMunicipio(cod) : null;
    SM.renderSecaoMunicipio({ container, blur: acesso.blurMunicipio, resumo, nomeMunicipio: nome, uf });

    // Salvar dados do município para o histórico
    if (resumo && cod) {
      dadosMunicipioAtual = {  // ⭐ SEM window.
        cod_municipio: cod,
        nome: nome,
        uf: uf
      };

      // Mostrar botão de histórico
      const btnHistorico = document.getElementById('btn-ver-historico');
      if (btnHistorico) {
        btnHistorico.style.display = 'inline-block';
      }
    }
  } catch (err) {
    console.warn('[verNL] Município falhou (não fatal):', err);
    container.innerHTML = '';
  }
}

// ─── Mídia ────────────────────────────────────────────────────────────────────

function renderMidia(newsletter, acesso) {
  const secao = document.getElementById('secao-midia');
  const wrap = document.getElementById('midia-conteudo');
  if (!secao || !wrap) return;

  const itens = [];

  if (newsletter.audio_url) {
    itens.push(acesso.temAudio ? `
      <div class="rs-media-item">
        <div class="rs-media-icon">🎧</div>
        <div class="rs-media-info">
          <div class="rs-media-titulo">Podcast desta edição</div>
          <div class="rs-media-sub">Produzido com NotebookLM · Ouça enquanto trabalha</div>
          <audio controls src="${_esc(newsletter.audio_url)}" preload="none"
                 style="width:100%;margin-top:8px;border-radius:8px"></audio>
        </div>
      </div>` : `
      <div class="rs-media-item">
        <div class="rs-media-icon" style="opacity:.4">🎧</div>
        <div class="rs-media-info">
          <div class="rs-media-titulo">Podcast desta edição</div>
          <div class="rs-media-sub">Disponível no plano Essence ou superior</div>
        </div>
        <a href="/assinatura.html?plano=essence" class="rs-media-btn rs-media-btn-lock">🔒 Desbloquear</a>
      </div>`);
  }

  if (newsletter.video_url) {
    itens.push(acesso.temVideo ? `
    <div class="rs-media-item">
      <div class="rs-media-icon">📺</div>
      <div class="rs-media-info">
        <div class="rs-media-titulo">Vídeo explicativo</div>
        <div class="rs-media-sub">Análise detalhada em vídeo</div>
      </div>
      <a href="${_esc(newsletter.video_url)}" target="_blank" rel="noopener noreferrer"
         class="rs-media-btn rs-media-btn-primary">Assistir →</a>
    </div>` : `
    <div class="rs-media-item">
      <div class="rs-media-icon" style="opacity:.4">📺</div>
      <div class="rs-media-info">
        <div class="rs-media-titulo">Vídeo explicativo</div>
        <div class="rs-media-sub">Disponível no plano Profissional ou superior</div>
      </div>
      <a href="/assinatura.html?plano=profissional" class="rs-media-btn rs-media-btn-lock">🔒 Desbloquear</a>
    </div>`);
  }

  if (newsletter.infografico_url) {
    itens.push(acesso.temInfografico ? `
      <div class="rs-media-item">
        <div class="rs-media-icon">📊</div>
        <div class="rs-media-info">
          <div class="rs-media-titulo">Infográfico da edição</div>
          <div class="rs-media-sub">Visualização dos principais indicadores</div>
        </div>
        <a href="${_esc(newsletter.infografico_url)}" target="_blank" rel="noopener noreferrer"
           class="rs-media-btn rs-media-btn-primary">Ver →</a>
      </div>` : `
      <div class="rs-media-item">
        <div class="rs-media-icon" style="opacity:.4">📊</div>
        <div class="rs-media-info">
          <div class="rs-media-titulo">Infográfico da edição</div>
          <div class="rs-media-sub">Disponível no plano Profissional ou superior</div>
        </div>
        <a href="/assinatura.html?plano=profissional" class="rs-media-btn rs-media-btn-lock">🔒 Desbloquear</a>
      </div>`);
  }

  if (itens.length) { secao.style.display = 'block'; wrap.innerHTML = itens.join(''); }
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

function renderFAQ(newsletter, acesso) {
  const secao = document.getElementById('secao-faq');
  const wrap = document.getElementById('faq-conteudo');
  const faq = newsletter.faq || [];
  if (!faq.length || !secao || !wrap) return;

  const visiveis = (acesso.isAssinante || acesso.acessoProTemp) ? faq : faq.slice(0, 1);
  const temRestante = !acesso.isAssinante && !acesso.acessoProTemp && faq.length > 1;

  secao.style.display = 'block';
  wrap.innerHTML = visiveis.map((item, i) => `
    <div class="rs-faq-item" id="faq-${i}">
      <button class="rs-faq-pergunta" onclick="toggleFaq(${i})">
        <span>${_esc(item.pergunta || '')}</span>
        <span class="rs-faq-icon">+</span>
      </button>
      <div class="rs-faq-resposta">${_esc(item.resposta || '')}</div>
    </div>`).join('');

  if (temRestante) {
    wrap.insertAdjacentHTML('beforeend', `
      <div style="padding:10px 0 0;font-size:12px;color:var(--subtexto);text-align:center">
        Mais ${faq.length - 1} perguntas disponíveis para assinantes.
        <a href="/assinatura.html" style="color:var(--azul);font-weight:700"> Ver planos →</a>
      </div>`);
  }
}

function toggleFaq(idx) {
  document.getElementById(`faq-${idx}`)?.classList.toggle('aberto');
}

// ─── Reactions ────────────────────────────────────────────────────────────────

// Escala de avaliação — 5 níveis de progressão emocional
const REACTIONS = [
  { emoji: '😞', label: 'Decepcionou', key: 'decepcionou' },
  { emoji: '😐', label: 'Regular', key: 'regular' },
  { emoji: '🙂', label: 'Bom', key: 'bom' },
  { emoji: '😀', label: 'Muito bom', key: 'muito_bom' },
  { emoji: '🤩', label: 'Excelente', key: 'excelente' },
];

async function renderReactions(nid, uid) {
  const wrap = document.getElementById('reactions-wrap');
  if (!wrap) return;

  let minha = null;

  try {
    await db.collection('newsletters').doc(nid).get(); // mantém listener ativo
    // Chave inclui uid para isolar voto por usuário no mesmo browser
    minha = localStorage.getItem(`rs_rx_${nid}_${uid || 'anon'}`);
  } catch (e) { /* não fatal */ }

  function pintar() {
    // Exibe 1 na reação do usuário e 0 nas demais — não expõe totais globais
    wrap.innerHTML = REACTIONS.map(r => `
      <button class="rs-reaction-btn ${minha === r.key ? 'ativo' : ''}"
              onclick="votar('${_esc(nid)}','${_esc(uid || '')}','${r.key}')">
        <span>${r.emoji}</span>
        <span class="rs-reaction-count">${minha === r.key ? 1 : 0}</span>
        <span class="rs-reaction-label">${_esc(r.label)}</span>
      </button>`).join('');
  }

  pintar();

  // Renderizar campo de feedback abaixo das reações
  renderFeedback(nid);

  window.votar = async (newsletterId, userId, key) => {
    const fb = document.getElementById('reaction-feedback');
    const lsKey = `rs_rx_${newsletterId}_${userId || 'anon'}`;
    const anterior = localStorage.getItem(lsKey);

    // Atualiza estado local
    if (anterior === key) {
      minha = null;
      localStorage.removeItem(lsKey);
    } else {
      minha = key;
      localStorage.setItem(lsKey, key);
    }

    pintar();
    if (fb) {
      fb.textContent = minha ? '✓ Obrigado pelo feedback!' : '';
      setTimeout(() => { if (fb) fb.textContent = ''; }, 2500);
    }

    // Persiste no Firestore com increment atômico (evita race condition)
    try {
      const upd = {};
      if (anterior === key) {
        // Desvoto
        upd[`reactions.${key}`] = firebase.firestore.FieldValue.increment(-1);
      } else {
        // Voto novo
        upd[`reactions.${key}`] = firebase.firestore.FieldValue.increment(1);
        // Remove voto anterior se existia
        if (anterior) upd[`reactions.${anterior}`] = firebase.firestore.FieldValue.increment(-1);
      }
      await db.collection('newsletters').doc(newsletterId).update(upd);
    } catch (e) { /* não fatal */ }
  };
}

// ─── CTA por segmento / plano ─────────────────────────────────────────────────

function renderCTA(acesso, newsletter) {
  const wrap = document.getElementById('rs-cta-wrap');
  if (!wrap) return;

  const plano = acesso.plano_slug;

  // Profissional, Premium, Supreme → sem CTA
  if (acesso.isAssinante && ['profissional', 'premium', 'supreme'].includes(plano)) {
    wrap.innerHTML = ''; return;
  }

  // Básico → upgrade para áudio
  if (acesso.isAssinante && plano === 'basico') {
    wrap.innerHTML = `
      <div class="rs-cta rs-cta-basico">
        <h3 style="color:var(--azul)">🎧 Esta edição tem podcast</h3>
        <p style="color:var(--subtexto)">Evolua para o Essence e ouça todas as edições.</p>
        <a href="/assinatura.html?plano=essence" class="rs-cta-btn">Ver plano Essence →</a>
      </div>`; return;
  }

  // Essence com infográfico → upgrade
  if (acesso.isAssinante && plano === 'essence' && newsletter.infografico_url) {
    wrap.innerHTML = `
      <div class="rs-cta rs-cta-basico">
        <h3 style="color:var(--azul)">📊 Esta edição tem infográfico</h3>
        <p style="color:var(--subtexto)">Disponível no Profissional — visualize os dados graficamente.</p>
        <a href="/assinatura.html?plano=profissional" class="rs-cta-btn">Ver plano Profissional →</a>
      </div>`; return;
  }

  // Lead com acesso temporário
  if (!acesso.isAssinante && acesso.acessoProTemp) {
    wrap.innerHTML = `
      <div class="rs-cta rs-cta-basico">
        <h3 style="color:var(--azul)">⏳ Acesso completo por ${newsletter.acesso_pro_horas || 24}h</h3>
        <p style="color:var(--subtexto)">Você está vendo esta edição completa. Assine para ter sempre.</p>
        <a href="/assinatura.html" class="rs-cta-btn">Assinar agora →</a>
      </div>`; return;
  }

  if (acesso.isAssinante) { wrap.innerHTML = ''; return; }

  // Lead padrão
  wrap.innerHTML = `
    <div class="rs-cta rs-cta-lead">
      <h3>📡 Leve o Radar SIOPE para o seu município</h3>
      <p>Dados em tempo real, alertas de prazo, podcast semanal e
         infográficos — tudo sobre educação pública do seu município.</p>
      <a href="/assinatura.html" class="rs-cta-btn">Ver planos e assinar →</a>
    </div>`;
}

// ─── Watermark ────────────────────────────────────────────────────────────────

function renderWatermark(destinatario, newsletter) {
  const el = document.getElementById('rs-watermark');
  if (!el) return;
  el.textContent =
    `Edição ${newsletter.numero || newsletter.edicao || '—'} · ` +
    `Exclusivo para ${destinatario.nome || ''} · ` +
    `${destinatario.email || ''} · ` +
    new Date().toLocaleString('pt-BR');
}

// ─── _radarUser para OneSignal ────────────────────────────────────────────────

function publicarRadarUser(destinatario, segmento, assinaturaId) {
  // Para assinantes: uid = Firebase doc ID (_uid)
  // Para leads: uid = Supabase row ID (id) — usado em leads_mensagens.lead_id
  const isAssinante = segmento === 'assinantes';
  window._radarUser = {
    uid:           isAssinante ? (destinatario._uid || null) : String(destinatario.id || ''),
    email:         destinatario.email || '',
    nome:          destinatario.nome || '',
    segmento:      isAssinante ? 'assinante' : 'lead',
    plano_slug:    destinatario.plano_slug || null,
    features:      destinatario.features || {},
    uf:            destinatario.cod_uf || '',
    municipio_cod: destinatario.cod_municipio || '',
    municipio_nome:destinatario.nome_municipio || '',
    perfil:        destinatario.perfil || '',
    assinaturaId:  assinaturaId || null,
  };
  window.dispatchEvent(new Event('radarUserReady')); // ← aqui, indentado junto

  // Salva sessão para o PWA (app.html usa ao abrir sem parâmetros)
  try {
    localStorage.setItem('rs_pwa_session', JSON.stringify({
      uid:         isAssinante ? (destinatario._uid || null) : String(destinatario.id || ''),
      assinaturaId: assinaturaId || null,
      segmento:    isAssinante ? 'assinante' : 'lead',
    }));
  } catch (e) { /* ignora se localStorage bloqueado */ }
}

// ─── Buscar newsletter pelo número (URL limpa) ────────────────────────────────

async function buscarPorNumero(numero) {
  const snap = await db.collection('newsletters')
    .where('numero', '==', String(numero)).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ─── MODO ASSINANTE — LINK EXPIRADO ──────────────────────────────────────────
// Ativado quando o assinante abre um link com expira_em vencido (sem bypass).
// Carrega os dados do assinante pelos parâmetros da URL (uid + assinaturaId),
// exibe um banner orientativo e mantém o app funcionando normalmente.
// O drawer NÃO é aberto automaticamente — o assinante navega por conta própria.

async function _abrirModoAssinanteExpirado(uid, assinaturaId) {
  try {
    const userSnap = await db.collection('usuarios').doc(uid).get();
    if (!userSnap.exists) {
      mostrarErro('Sessão inválida.', 'Acesse a <a href="/login.html">Área do Assinante</a>.');
      return;
    }
    const destinatario = { _uid: userSnap.id, ...userSnap.data() };

    if (assinaturaId) {
      try {
        const assSnap = await db.collection('usuarios').doc(uid)
          .collection('assinaturas').doc(assinaturaId).get();
        if (assSnap.exists) {
          const d = assSnap.data();
          destinatario.features   = d.features_snapshot || d.features || destinatario.features || {};
          destinatario.plano_slug = d.plano_slug || destinatario.plano_slug || null;
        }
      } catch (e) { /* não fatal */ }
    }

    // Popula _radarUser (drawer e alertas dependem disso)
    publicarRadarUser(destinatario, 'assinantes', assinaturaId);

    // Header mínimo
    const nome = (destinatario.nome || '').split(' ')[0];
    _set('hd-saudacao', nome ? `Olá, ${nome}!` : '');
    _set('hd-titulo', 'Radar SIOPE');
    _set('hd-edicao', '');
    _set('hd-data', '');
    document.title = 'Radar SIOPE';

    // Oculta seções de conteúdo da edição
    ['rs-toggle-modo', 'modo-rapido', 'modo-completo', 'secao-midia',
     'secao-faq', 'rs-banner-recente', 'rs-watermark', 'rs-cta-wrap'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    // Banner orientativo
    const munConteudo = document.getElementById('municipio-conteudo');
    if (munConteudo) {
      munConteudo.innerHTML = `
        <div style="padding:24px 20px;text-align:center;color:var(--rs-muted)">
          <div style="font-size:32px;margin-bottom:12px">⏰</div>
          <p style="font-size:14px;line-height:1.7;margin-bottom:4px;color:var(--rs-text)">
            <strong>Seu acesso a esta edição expirou.</strong>
          </p>
          <p style="font-size:13px;line-height:1.6">
            Selecione uma edição disponível no menu <strong>Edições</strong>.<br>
            Caso deseje visualizar edições expiradas, acesse o menu <strong>"Minha Área"</strong>.
          </p>
        </div>`;
      const btnHist = document.getElementById('btn-ver-historico');
      if (btnHist) btnHist.style.display = 'none';
    }

    // Exibe o app e inicializa o drawer (sem abri-lo automaticamente)
    mostrarApp();
    iniciarDrawer({ id: null, tipo: null });

  } catch (err) {
    console.error('[verNL] Erro no modo assinante expirado:', err);
    mostrarErro('Erro ao carregar seus dados.', err.message);
  }
}

// ─── MODO ALERTA (sem parâmetros de edição) ────────────────────────────────────
// Ativado quando o app é aberto via notificação push sem link de edição específica.
// Carrega usuário da sessão PWA e abre a Central de Mensagens automaticamente.

async function _tentarModoAlerta() {
  let sessao = null;
  try {
    const raw = localStorage.getItem('rs_pwa_session');
    if (raw) sessao = JSON.parse(raw);
  } catch (e) { /* ignora */ }

  if (!sessao || !sessao.uid) {
    // Sem sessão → erro padrão com link para login
    mostrarErro(
      '<strong>Link inválido ou incompleto.</strong>',
      'Verifique o link recebido por e-mail ou acesse a <a href="/login.html">Área do Assinante</a>.'
    );
    return;
  }

  try {
    // Busca dados do usuário no Firestore
    const userSnap = await db.collection('usuarios').doc(sessao.uid).get();
    if (!userSnap.exists) {
      mostrarErro('Sessão expirada.', 'Acesse a <a href="/login.html">Área do Assinante</a>.');
      return;
    }

    const destinatario = { _uid: userSnap.id, ...userSnap.data() };

    // Busca assinatura ativa se disponível
    if (sessao.assinaturaId) {
      try {
        const assinaturaSnap = await db.collection('usuarios').doc(sessao.uid)
          .collection('assinaturas').doc(sessao.assinaturaId).get();
        if (assinaturaSnap.exists) {
          const assinaturaData = assinaturaSnap.data();
          destinatario.features  = assinaturaData.features_snapshot || assinaturaData.features || destinatario.features || {};
          destinatario.plano_slug = assinaturaData.plano_slug || destinatario.plano_slug || null;
        }
      } catch (e) { /* ignora, continua sem features */ }
    }

    // Popula _radarUser para que a Central de Mensagens funcione
    publicarRadarUser(destinatario, sessao.segmento === 'assinante' ? 'assinantes' : 'leads', sessao.assinaturaId);

    // Renderiza header mínimo (sem edição específica)
    const headerSaudacao = document.getElementById('hd-saudacao');
    const headerTitulo   = document.getElementById('hd-titulo');
    const headerEdicao   = document.getElementById('hd-edicao');
    const headerData     = document.getElementById('hd-data');
    const nome = (destinatario.nome || '').split(' ')[0];
    if (headerSaudacao) headerSaudacao.textContent = nome ? `Olá, ${nome}!` : '';
    if (headerTitulo)   headerTitulo.textContent   = 'Radar SIOPE';
    if (headerEdicao)   headerEdicao.textContent   = '';
    if (headerData)     headerData.textContent     = '';
    document.title = 'Radar SIOPE';

    // Oculta seções de conteúdo de edição — não há edição carregada
    ['rs-toggle-modo', 'modo-rapido', 'modo-completo', 'secao-midia',
     'secao-faq', 'rs-banner-recente', 'rs-watermark', 'rs-cta-wrap'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    // Mostra placeholder amigável na seção de município
    const munConteudo = document.getElementById('municipio-conteudo');
    if (munConteudo) {
      munConteudo.innerHTML = `
        <div style="padding:20px;text-align:center;color:var(--rs-muted)">
          <div style="font-size:28px;margin-bottom:8px">📬</div>
          <div style="font-size:13px;line-height:1.6">
            Você chegou via notificação.<br>
            Use o botão <strong>📚 Edições</strong> para ler a newsletter,<br>
            ou confira seus alertas em <strong>🔔 Alertas</strong>.
          </div>
        </div>`;
      const btnHist = document.getElementById('btn-ver-historico');
      if (btnHist) btnHist.style.display = 'none';
    }

    // Exibe o app
    mostrarApp();

    // Abre a Central de Mensagens automaticamente após um pequeno delay
    setTimeout(() => {
      const btnAlertas = document.getElementById('rs-alertas-btn');
      if (btnAlertas) btnAlertas.click();
    }, 600);

  } catch (err) {
    console.error('[verNL] Erro no modo alerta:', err);
    mostrarErro('Erro ao carregar seus dados.', err.message);
  }
}

// ─── FLUXO PRINCIPAL ──────────────────────────────────────────────────────────

async function VerNewsletterComToken() {
  const params = getParams();
  const d_nid = normalizeParam(params.get('nid'));
  const env = normalizeParam(params.get('env'));
  const uid = normalizeParam(params.get('uid'));
  const token = params.get('token');
  const assinaturaId = normalizeParam(params.get('assinaturaId'));
  const edicaoNum = params.get('edicao_numero');
  // bypass_exp=1 vem do painel (Minha Área) para ignorar expiração do link
  const bypass_exp = params.get('bypass_exp') === '1';

  // 0. Validação inicial
  // Se não há parâmetros mas existe sessão PWA salva → abre em "modo alerta"
  // (usuário chegou via notificação push sem link de edição específica)
  if ((!d_nid && !edicaoNum) || !env || !uid || !token) {
    await _tentarModoAlerta();
    return;
  }

  try {
    // 1. Buscar envio
    // Assinantes → Firestore (usuarios/{uid}/assinaturas/{aid}/envios/{env})
    // Leads      → Supabase  (tabela leads_envios, id = env)
    let envio;

    if (assinaturaId) {
      // ── Assinante: Firestore ──────────────────────────────────────────────
      const envioRef = db.collection('usuarios').doc(uid)
        .collection('assinaturas').doc(assinaturaId)
        .collection('envios').doc(env);
      const envioSnap = await envioRef.get();
      if (!envioSnap.exists) {
        mostrarErro('Envio não encontrado.',
          'O link pode ter expirado. Acesse a <a href="/login.html">Área do Assinante</a>.');
        return;
      }
      envio = envioSnap.data();

      // Validar token
      if (!envio.token_acesso || envio.token_acesso !== token) {
        mostrarErro('Acesso negado.', 'Token inválido.'); return;
      }

      // Validar expiração.
      // bypass_exp=1 (vindo do painel/Minha Área): ignora expiração e abre a edição.
      // Link expirado sem bypass: abre app com banner orientativo + drawer disponível.
      if (envio.expira_em && !bypass_exp) {
        const exp = envio.expira_em.toDate ? envio.expira_em.toDate() : new Date(envio.expira_em);
        if (new Date() > exp) {
          await _abrirModoAssinanteExpirado(uid, assinaturaId);
          return;
        }
      }

      // Atualizar metadados (fire & forget) — não contabiliza acesso via bypass
      if (!bypass_exp) {
        envioRef.update({
          ultimo_acesso: new Date(),
          acessos_totais: firebase.firestore.FieldValue.increment(1),
        }).catch(() => { });

        // Compartilhamento excessivo → mesmo fluxo do link expirado
        const envioAtual = (await envioRef.get()).data() || envio;
        if (Number(envioAtual.acessos_totais || 0) > 5) {
          envioRef.update({ sinalizacao_compartilhamento: true }).catch(() => { });
          await _abrirModoAssinanteExpirado(uid, assinaturaId);
          return;
        }
      }

    } else {
      // ── Lead: Supabase (leads_envios) ─────────────────────────────────────
      // env = id numérico do registro em leads_envios
      // Usa anon key — a policy "le_select_by_token" permite SELECT onde token IS NOT NULL
      const { data: leRow, error: leErr } = await window.supabase
        .from('leads_envios')
        .select('*')
        .eq('id', env)
        .eq('lead_id', uid)
        .maybeSingle();

      if (leErr || !leRow) {
        mostrarErro('Envio não encontrado.',
          'O link pode ter expirado. Assine agora <a href="/assinatura.html">Assine agora</a>.');
        return;
      }

      // Validar token
      if (!leRow.token_acesso || leRow.token_acesso !== token) {
        mostrarErro('Acesso negado.', 'Token inválido.'); return;
      }

      // Validar expiração
      if (leRow.expira_em && new Date() > new Date(leRow.expira_em)) {
        mostrarErro('Este link expirou.',
          'Assine agora<a href="/assinatura.html">Assine agora</a> para continuar tendo acesso.');
        return;
      }

      // Atualizar metadados (fire & forget) — anon pode UPDATE via policy le_update_acesso
      const novoTotal = (leRow.acessos_totais || 0) + 1;
      window.supabase
        .from('leads_envios')
        .update({ ultimo_acesso: new Date().toISOString(), acessos_totais: novoTotal })
        .eq('id', env)
        .then(() => { })
        .catch(() => { });

      // Verificar compartilhamento excessivo
      if (novoTotal > 5) {
        window.supabase
          .from('leads_envios')
          .update({ sinalizacao_compartilhamento: true })
          .eq('id', env)
          .then(() => { }).catch(() => { });
        mostrarErro('<strong>Conteúdo exclusivo.</strong>',
          'Identificamos múltiplos acessos. ' +
          '<a href="/assinatura.html">Assine agora</a> para continuar tendo acesso.');
        return;
      }

      // Normaliza para o mesmo formato usado no restante do fluxo
      envio = {
        token_acesso: leRow.token_acesso,
        expira_em: leRow.expira_em,
        acessos_totais: novoTotal,
      };
    }

    // 6. Buscar newsletter
    let newsletter;
    if (d_nid) {
      const snap = await db.collection('newsletters').doc(d_nid).get();
      if (!snap.exists) { mostrarErro('Edição não encontrada.'); return; }
      newsletter = { id: snap.id, ...snap.data() };
    } else {
      newsletter = await buscarPorNumero(edicaoNum);
      if (!newsletter) { mostrarErro(`Edição "${edicaoNum}" não encontrada.`); return; }
    }
    const nid = newsletter.id;

    // 7. Buscar destinatário
    let destinatario = null;
    let segmento = null;

    if (assinaturaId) {
      // ✅ Assinante → Firebase
      const destinatarioSnap = await db.collection("usuarios").doc(uid).get();

      if (!destinatarioSnap.exists) { mostrarErro('Destinatário não encontrado.'); return; }

      destinatario = { _uid: destinatarioSnap.id, ...destinatarioSnap.data() };

      // Lê features_snapshot da assinatura (fonte de verdade das permissões)
      try {
        const assinaturaSnap = await db.collection('usuarios').doc(uid)
          .collection('assinaturas').doc(assinaturaId).get();
        if (assinaturaSnap.exists) {
          const assinaturaData = assinaturaSnap.data();
          // features_snapshot tem precedência sobre qualquer features do usuário
          destinatario.features = assinaturaData.features_snapshot || assinaturaData.features || destinatario.features || {};
          destinatario.plano_slug = assinaturaData.plano_slug || destinatario.plano_slug || null;

          // Fallback: busca pelo planId se plano_slug não estiver na assinatura
          if (!destinatario.plano_slug && assinaturaData.planId) {
            try {
              const planoSnap = await db.collection('planos').doc(assinaturaData.planId).get();
              if (planoSnap.exists) {
                destinatario.plano_slug = planoSnap.data().slug || planoSnap.data().nome || assinaturaData.planId;
              }
            } catch (e) {
              console.warn('[acesso] Não foi possível ler plano:', e);
            }
          }
        }
      } catch (e) {
        console.warn('[acesso] Não foi possível ler features_snapshot da assinatura:', e);
      }

      segmento = "assinantes";
    } else {
      // ✅ Lead → Supabase
      const { data: leadData, error: leadError } = await window.supabase
        .from('leads')
        .select('*')
        .eq('id', uid)
        .single();

      if (leadError || !leadData) { mostrarErro('Destinatário não encontrado.'); return; }

      destinatario = leadData;
      segmento = "leads";
    }

    // 8. Regras de acesso
    const acesso = detectarAcesso(destinatario, newsletter, segmento, envio);

    // 9. Side effects não bloqueantes
    registrarClique(env, uid, nid);
    publicarRadarUser(destinatario, segmento, assinaturaId);

    // 10. Dados para placeholders
    const dados = {
      nome: destinatario.nome || '',
      email: destinatario.email || '',
      edicao: newsletter.numero || newsletter.edicao || '',
      titulo: newsletter.titulo || '',
      data_publicacao: newsletter.data_publicacao || null,
      cod_uf: destinatario.cod_uf || '',
      nome_municipio: destinatario.nome_municipio || '',
      perfil: destinatario.perfil || '',
      plano: destinatario.plano_slug || '',
    };

    // 11. Render (header + conteúdo primeiro para UX)
    renderHeader(newsletter, destinatario);

    const modoPadrao = sessionStorage.getItem('rs_modo_leitura') || acesso.modoPadrao;
    trocarModo(modoPadrao);

    renderModoRapido(newsletter, acesso);
    await renderModoCompleto(newsletter, dados, segmento, acesso);

    // Município em paralelo — não bloqueia o conteúdo principal
    renderMunicipio(destinatario, acesso);

    renderMidia(newsletter, acesso);
    renderFAQ(newsletter, acesso);
    await renderReactions(nid, uid);
    renderCTA(acesso, newsletter);
    renderWatermark(destinatario, newsletter);

    // 12. Exibe com fade-in
    mostrarApp();

    // 13. Iniciar drawer (após app visível)
    iniciarDrawer(newsletter);

    // 14. Notificação de edição mais recente (somente assinante)
    if (segmento === 'assinantes') {
      verificarEdicaoMaisRecente(newsletter);
    }

  } catch (err) {
    console.error('[verNL] Erro geral:', err);
    mostrarErro('Erro ao carregar a edição.', err.message);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// CONTROLE DE HISTÓRICO DO MUNICÍPIO
// ══════════════════════════════════════════════════════════════════════════

async function verHistoricoCompleto() {
  if (!dadosMunicipioAtual || !dadosMunicipioAtual.cod_municipio) {
    alert('Município não identificado');
    console.warn('[verNL] Dados do município:', dadosMunicipioAtual);
    return;
  }

  const resumo = document.getElementById('municipio-resumo');
  const historico = document.getElementById('municipio-historico');

  if (!resumo || !historico) {
    console.error('[verNL] Elementos não encontrados');
    return;
  }

  // Ocultar resumo, mostrar histórico
  resumo.style.display = 'none';
  historico.style.display = 'block';

  // Loading
  historico.innerHTML = `
    <div style="text-align:center;padding:40px">
      <div class="rs-spinner" style="margin:0 auto 16px"></div>
      <div style="color:var(--subtexto);font-size:14px">Carregando histórico...</div>
    </div>
  `;

  try {
    // Aguardar módulo estar pronto
    if (!window.SupabaseMunicipio) {
      throw new Error('Módulo SupabaseMunicipio não carregado');
    }

    // Buscar histórico
    const dados = await window.SupabaseMunicipio.getHistoricoCompleto(
      dadosMunicipioAtual.cod_municipio
    );

    // Renderizar
    window.SupabaseMunicipio.renderHistoricoCompleto(
      historico,
      dados,
      dadosMunicipioAtual.nome,
      dadosMunicipioAtual.uf
    );
  } catch (err) {
    console.error('[verNL] Erro ao carregar histórico:', err);
    historico.innerHTML = `
      <div style="text-align:center;padding:40px;color:#dc2626">
        <div style="font-size:18px;margin-bottom:12px">❌</div>
        <div style="font-weight:600;margin-bottom:8px">Erro ao carregar histórico</div>
        <div style="font-size:13px;color:#94a3b8;margin-bottom:16px">${err.message}</div>
        <button onclick="voltarResumo()" style="padding:8px 16px;background:var(--azul);
                color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">
          ← Voltar ao resumo
        </button>
      </div>
    `;
  }
}

function voltarResumo() {
  const resumo = document.getElementById('municipio-resumo');
  const historico = document.getElementById('municipio-historico');

  if (historico) historico.style.display = 'none';
  if (resumo) resumo.style.display = 'block';
}

// Inicializar listener do botão quando DOM estiver pronto
function initHistoricoButton() {
  const btn = document.getElementById('btn-ver-historico');
  if (btn) {
    btn.addEventListener('click', verHistoricoCompleto);
  }
}

// Expor funções globalmente
window.verHistoricoCompleto = verHistoricoCompleto;
window.voltarResumo = voltarResumo;

// Inicializar quando DOM carregar
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHistoricoButton);
} else {
  initHistoricoButton();
}

// ─── Expõe para inline handlers ──────────────────────────────────────────────
window.trocarModo = trocarModo;
window.toggleFaq = toggleFaq;

// ══════════════════════════════════════════════════════════════════════════
// SISTEMA DE TEMAS
// ══════════════════════════════════════════════════════════════════════════

// Temas disponíveis
const TEMAS_DISPONIVEIS = ['claro', 'escuro', 'suave', 'minimalista', 'exito', 'aurora'];

// Carregar tema salvo (ou usar 'claro' como padrão)
function carregarTema() {
  const temaSalvo = localStorage.getItem('radar-tema');

  // Verificar se o tema salvo é válido
  if (temaSalvo && TEMAS_DISPONIVEIS.includes(temaSalvo)) {
    aplicarTema(temaSalvo);
  } else {
    // Tema padrão: claro
    aplicarTema('claro');
  }
}

// Aplicar tema ao documento
function aplicarTema(tema) {
  if (!TEMAS_DISPONIVEIS.includes(tema)) {
    console.warn('[Tema] Tema inválido:', tema);
    tema = 'claro';
  }

  document.body.setAttribute('data-theme', tema);

  // Atualizar botões ativos (se existirem)
  document.querySelectorAll('[data-theme-btn]').forEach(btn => {
    const btnTema = btn.getAttribute('data-theme-btn');
    if (btnTema === tema) {
      btn.classList.add('ativo');
    } else {
      btn.classList.remove('ativo');
    }
  });

}

// Trocar tema (chamado pelo onclick dos botões)
function setTheme(tema) {

  if (!TEMAS_DISPONIVEIS.includes(tema)) {
    console.warn('[Tema] Tema inválido:', tema);
    return;
  }

  // Aplicar tema
  aplicarTema(tema);

  // Salvar no localStorage
  localStorage.setItem('radar-tema', tema);

  // Feedback visual (opcional)
  const btn = document.querySelector(`[data-theme-btn="${tema}"]`);
  if (btn) {
    btn.style.transform = 'scale(1.1)';
    setTimeout(() => {
      btn.style.transform = '';
    }, 200);
  }
}

// Expor função globalmente (para onclick do HTML)
window.setTheme = setTheme;
window.carregarTema = carregarTema;

// Carregar tema ao iniciar (imediatamente)
carregarTema();

// Também carregar quando DOM estiver pronto (por segurança)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', carregarTema);
}
// ══════════════════════════════════════════════════════════════════════════
// DRAWER DE NAVEGAÇÃO DE EDIÇÕES
// ══════════════════════════════════════════════════════════════════════════

// ─── Estado do drawer ────────────────────────────────────────────────────────
const _drawer = {
  aberto: false,
  nivel: 1,          // 1 = tipos, 2 = edições do tipo
  tipoAtivo: null,       // { id, nome, icone }
  edicaoAtual: null,       // id da edição sendo lida
  tipoAtual: null,       // tipo da edição sendo lida
  edicoesCache: {},         // { [tipoId]: [array de edições] } — memória de sessão
  contadores: [],         // refs dos setInterval dos contadores regressivos
};

// ─── Cache de tipos no localStorage (24h) ───────────────────────────────────
const DRAWER_CACHE_KEY = 'rs_tipos_cache';
const DRAWER_CACHE_TS_KEY = 'rs_tipos_cache_ts';
const DRAWER_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h em ms

async function _getTipos() {
  try {
    const ts = parseInt(localStorage.getItem(DRAWER_CACHE_TS_KEY) || '0', 10);
    const raw = localStorage.getItem(DRAWER_CACHE_KEY);
    if (raw && (Date.now() - ts) < DRAWER_CACHE_TTL) {
      return JSON.parse(raw);
    }
  } catch (e) { /* cache corrompido — vai buscar no Firestore */ }

  const snap = await db.collection('tipo_newsletters')
    .where('is_newsletter', '==', true)
    .get();

  const tipos = snap.docs.map(d => ({
    id: d.id,
    nome: d.data().nome || d.id,
    icone: d.data().icone || '📰',
  }));

  try {
    localStorage.setItem(DRAWER_CACHE_KEY, JSON.stringify(tipos));
    localStorage.setItem(DRAWER_CACHE_TS_KEY, String(Date.now()));
  } catch (e) { /* quota excedida — ignora */ }

  return tipos;
}

// ─── Verificar acesso do assinante a um tipo ─────────────────────────────────
function _assinanteTemAcesso(tipoId) {
  const ctx = _getCtx();
  if (!ctx || ctx.segmento !== 'assinante') return false;
  // Normaliza para String para evitar mismatch number vs string do Firestore
  return (_drawer.tiposInclusos || []).map(String).includes(String(tipoId));
}

// ─── Contexto de identidade ──────────────────────────────────────────────────
function _getCtx() {
  if (window._radarUser) return window._radarUser;
  try {
    const raw = sessionStorage.getItem('rs_drawer_ctx');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

// ─── Inicializar drawer ──────────────────────────────────────────────────────
async function iniciarDrawer(newsletter) {
  // Salvar contexto de identidade no sessionStorage (proteção contra reload)
  if (window._radarUser) {
    try {
      sessionStorage.setItem('rs_drawer_ctx', JSON.stringify({
        uid: _radarUser.uid,
        segmento: _radarUser.segmento,
        plano_slug: _radarUser.plano_slug,
        features: _radarUser.features,
        assinaturaId: _radarUser.assinaturaId,
        email: _radarUser.email,
      }));
    } catch (e) { /* ignora */ }
  }

  // Guardar referência da edição atual
  _drawer.edicaoAtual = newsletter.id;
  _drawer.tipoAtual = newsletter.Tipo || newsletter.tipo || null;

  // Carregar tipos_selecionados da assinatura do usuário
  // (fonte de verdade: o que o assinante efetivamente contratou)
  const ctx = _getCtx();
  if (ctx && ctx.segmento === 'assinante' && ctx.uid) {
    try {
      let tiposCarregados = false;

      // 1ª tentativa: assinaturaId direto (mais rápido)
      if (ctx.assinaturaId) {
        const assSnap = await db.collection('usuarios')
          .doc(ctx.uid)
          .collection('assinaturas')
          .doc(ctx.assinaturaId)
          .get();
        if (assSnap.exists) {
          const d = assSnap.data();
          _drawer.tiposInclusos = Array.isArray(d.tipos_selecionados)
            ? d.tipos_selecionados.map(String)
            : [];
          tiposCarregados = true;
        }
      }

      // 2ª tentativa: busca a assinatura ativa (fallback)
      if (!tiposCarregados) {
        const assSnap = await db.collection('usuarios')
          .doc(ctx.uid)
          .collection('assinaturas')
          .where('status', 'in', ['ativa', 'aprovada'])
          .limit(1)
          .get();
        if (!assSnap.empty) {
          const d = assSnap.docs[0].data();
          _drawer.tiposInclusos = Array.isArray(d.tipos_selecionados)
            ? d.tipos_selecionados.map(String)
            : [];
        } else {
          _drawer.tiposInclusos = [];
        }
      }
    } catch (e) {
      console.warn('[drawer] Falha ao carregar tipos da assinatura:', e);
      _drawer.tiposInclusos = [];
    }
  }

  // Registrar event listeners
  // Botão Edições agora é chamado via evento do menuApp.js
  window.addEventListener('rs:abrirEdicoes', abrirDrawer);
  document.getElementById('rs-drawer-overlay')
    ?.addEventListener('click', fecharDrawer);
  document.getElementById('rs-drawer-fechar')
    ?.addEventListener('click', fecharDrawer);
  document.getElementById('rs-drawer-voltar')
    ?.addEventListener('click', voltarParaTipos);

  // Swipe para fechar (mobile)
  _initSwipeFechar();
}

// ─── Swipe para fechar ───────────────────────────────────────────────────────
function _initSwipeFechar() {
  const panel = document.getElementById('rs-drawer-panel');
  if (!panel) return;
  let startX = 0;
  panel.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  panel.addEventListener('touchend', e => {
    if (e.changedTouches[0].clientX - startX > 60) fecharDrawer();
  }, { passive: true });
}

// ─── Abrir / fechar drawer ───────────────────────────────────────────────────
function abrirDrawer() {
  const ctx = _getCtx();
  const overlay = document.getElementById('rs-drawer-overlay');
  const panel = document.getElementById('rs-drawer-panel');
  if (!overlay || !panel) return;

  // Edge case: sem identificação
  if (!ctx) {
    _renderDrawerSemContexto();
    overlay.classList.add('rs-drawer-show');
    panel.classList.add('rs-drawer-show');
    _drawer.aberto = true;
    document.body.style.overflow = 'hidden';
    return;
  }

  overlay.classList.add('rs-drawer-show');
  panel.classList.add('rs-drawer-show');
  _drawer.aberto = true;
  document.body.style.overflow = 'hidden';
  _renderNivel1();
}

function fecharDrawer() {
  document.getElementById('rs-drawer-overlay')?.classList.remove('rs-drawer-show');
  document.getElementById('rs-drawer-panel')?.classList.remove('rs-drawer-show');
  _drawer.aberto = false;
  document.body.style.overflow = '';
  _limparContadores();
}

// ─── Edge case sem contexto ──────────────────────────────────────────────────
function _renderDrawerSemContexto() {
  _setDrawerHeader('Edições', false);
  document.getElementById('rs-drawer-body').innerHTML = `
    <div style="padding:32px 20px;text-align:center;color:var(--rs-muted)">
      <div style="font-size:40px;margin-bottom:16px">📬</div>
      <p style="font-size:14px;line-height:1.7;margin-bottom:20px">
        Para navegar pelas edições, acesse o link enviado para seu e-mail.
      </p>
      <p style="font-size:13px;line-height:1.6">
        Quer conhecer todos os nossos produtos?<br>
        <a href="https://radarsiope.com.br" target="_blank" rel="noopener"
           style="color:var(--azul);font-weight:700">Visite radarsiope.com.br →</a>
      </p>
    </div>`;
}

// ─── Nível 1 — lista de tipos ────────────────────────────────────────────────
async function _renderNivel1() {
  _drawer.nivel = 1;
  _setDrawerHeader('Edições por tipo', false);
  const body = document.getElementById('rs-drawer-body');
  body.innerHTML = `
    <div style="padding:20px;text-align:center;color:var(--rs-muted);font-size:13px">
      <div class="rs-spinner" style="margin:0 auto 12px;width:24px;height:24px;border-width:2px"></div>
      Carregando tipos…
    </div>`;

  let tipos;
  try {
    tipos = await _getTipos();
  } catch (e) {
    body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--rs-muted);font-size:13px">
      Não foi possível carregar os tipos.</div>`;
    return;
  }

  const ctx = _getCtx();
  const isAssinante = ctx?.segmento === 'assinante';

  const cards = tipos.map(tipo => {
    const temAcesso = !isAssinante || _assinanteTemAcesso(tipo.id);
    const isTipoAtual = tipo.id === _drawer.tipoAtual;
    return `
      <button class="rs-drawer-tipo-card ${isTipoAtual ? 'rs-drawer-tipo-atual' : ''}"
              onclick="abrirTipo('${_esc(tipo.id)}','${_esc(tipo.nome)}','${_esc(tipo.icone)}')"
              type="button">
        <span class="rs-drawer-tipo-icone">${tipo.icone}</span>
        <span class="rs-drawer-tipo-nome">${_esc(tipo.nome)}</span>
        ${isTipoAtual ? '<span class="rs-drawer-tipo-badge">lendo agora</span>' : ''}
        ${!temAcesso ? '<span class="rs-drawer-lock" title="Não incluso no plano">🔒</span>' : '<span class="rs-drawer-chevron">›</span>'}
      </button>`;
  }).join('');

  body.innerHTML = `<div class="rs-drawer-tipos-lista">${cards}</div>`;
}

// ─── Nível 2 — lista de edições do tipo ─────────────────────────────────────
async function abrirTipo(tipoId, tipoNome, tipoIcone) {
  _drawer.nivel = 2;
  _drawer.tipoAtivo = { id: tipoId, nome: tipoNome, icone: tipoIcone };
  _setDrawerHeader(`${tipoIcone} ${tipoNome}`, true);
  _limparContadores();

  const body = document.getElementById('rs-drawer-body');
  body.innerHTML = `
    <div style="padding:20px;text-align:center;color:var(--rs-muted);font-size:13px">
      <div class="rs-spinner" style="margin:0 auto 12px;width:24px;height:24px;border-width:2px"></div>
      Carregando edições…
    </div>`;

  const ctx = _getCtx();
  const isAssinante = ctx?.segmento === 'assinante';
  const temAcesso = !isAssinante || _assinanteTemAcesso(tipoId);

  // Cabeçalho de up-sell para assinante sem acesso ao tipo
  const upSellBanner = (!isAssinante || temAcesso) ? '' : `
    <div class="rs-drawer-upsell">
      🔒 Este tipo não está no seu plano atual.<br>
      <a href="/contato.html" style="color:var(--azul);font-weight:700">
        Entre em contato para fazer upgrade →
      </a>
    </div>`;

  // Buscar edições (cache de memória por sessão)
  let edicoes = _drawer.edicoesCache[tipoId];
  if (!edicoes) {
    try {
      const snap = await db.collection('newsletters')
        .where('tipo', '==', tipoId)
        .where('enviada', '==', true)
        .orderBy('data_publicacao', 'desc')
        .limit(8)
        .get();
      edicoes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _drawer.edicoesCache[tipoId] = edicoes;
    } catch (e) {
      body.innerHTML = `${upSellBanner}
        <div style="padding:24px;text-align:center;color:var(--rs-muted);font-size:13px">
          Não foi possível carregar as edições.</div>`;
      return;
    }
  }

  // Para leads: buscar envios recebidos para cruzar com as edições
  let enviosLead = {};
  if (!isAssinante && ctx?.uid) {
    try {
      const { data } = await window.supabase
        .from('leads_envios')
        .select('newsletter_id, expira_em, acessos_totais')
        .eq('lead_id', ctx.uid)
        .in('newsletter_id', edicoes.map(e => e.id));
      if (data) {
        data.forEach(row => { enviosLead[row.newsletter_id] = row; });
      }
    } catch (e) { /* não fatal — trata como não recebido */ }
  }

  // Para leads: exibir apenas edições que foram enviadas a ele E ainda com expira_em vigente
  const edicoesVisiveis = isAssinante
    ? edicoes
    : edicoes.filter(ed => {
        const envio = enviosLead[ed.id];
        if (!envio) return false;                                       // nunca recebida
        if (envio.expira_em && new Date(envio.expira_em) <= new Date()) return false; // expirada
        return true;
      });

  // Para assinantes: buscar envios para identificar expiradas no drawer
  let enviosAssinante = {};
  if (isAssinante && ctx?.uid && ctx?.assinaturaId) {
    try {
      const nids = edicoes.map(e => e.id).filter(Boolean);
      if (nids.length > 0) {
        const snap = await db.collection('usuarios').doc(ctx.uid)
          .collection('assinaturas').doc(ctx.assinaturaId)
          .collection('envios')
          .where('newsletter_id', 'in', nids)
          .get();
        snap.docs.forEach(d => {
          const row = d.data();
          if (row.newsletter_id) enviosAssinante[row.newsletter_id] = row;
        });
      }
    } catch (e) { /* não fatal */ }
  }

  // Renderizar cards
  const listaHTML = edicoesVisiveis.map(ed => {
    const isAtual = ed.id === _drawer.edicaoAtual;
    if (isAssinante) {
      return _cardEdicaoAssinante(ed, isAtual, temAcesso, enviosAssinante[ed.id] || null);
    } else {
      return _cardEdicaoLead(ed, isAtual, enviosLead[ed.id] || null);
    }
  }).join('');

  // Mensagem de lista vazia para leads sem edições vigentes
  const listaOuVazio = (!isAssinante && edicoesVisiveis.length === 0)
    ? `<div style="padding:32px 20px;text-align:center;color:var(--rs-muted)">
        <div style="font-size:36px;margin-bottom:12px">📭</div>
        <p style="font-size:14px;line-height:1.7">Você ainda não possui edições disponíveis.</p>
      </div>`
    : `<div class="rs-drawer-edicoes-lista">${listaHTML}</div>`;

  // Rodapé condicional por segmento
  const rodape = isAssinante
    ? `<div class="rs-drawer-rodape" style="color:var(--rs-muted);font-size:12px">
        Para edições mais antigas, acesse <strong style="color:var(--azul)">"Minha Área"</strong> no menu.
      </div>`
    : `<div class="rs-drawer-rodape">
        <a href="/assinatura.html" style="color:var(--azul);font-size:12px;font-weight:600">
          📬 Assine para receber todas as edições →
        </a>
      </div>`;

  body.innerHTML = `${upSellBanner}${listaOuVazio}${rodape}`;

  // Iniciar contadores regressivos para leads
  if (!isAssinante) {
    edicoesVisiveis.forEach(ed => {
      const envio = enviosLead[ed.id];
      if (envio?.expira_em) {
        iniciarContador(envio.expira_em, `rs-contador-${ed.id}`);
      }
    });
  }
}

// ─── Card de edição — assinante ──────────────────────────────────────────────
function _cardEdicaoAssinante(ed, isAtual, temAcesso, envio) {
  const num = ed.numero || ed.edicao || '';
  const titulo = _esc(ed.titulo || `Edição ${num}`);
  const data = _fmtData(ed.data_publicacao);
  const classeAtual = isAtual ? 'rs-drawer-ed-atual' : '';
  const bloqueado = !temAcesso;

  if (bloqueado) {
    return `
      <div class="rs-drawer-ed-card rs-drawer-ed-bloqueado">
        <div class="rs-drawer-ed-info">
          <div class="rs-drawer-ed-titulo">${titulo}</div>
          <div class="rs-drawer-ed-data">${data}${num ? ` · Ed. ${num}` : ''}</div>
        </div>
        <span class="rs-drawer-ed-lock">🔒</span>
      </div>`;
  }

  // Verifica se este envio específico está expirado
  const expiraRaw = envio?.expira_em;
  const expiraDate = expiraRaw
    ? (expiraRaw?.toDate ? expiraRaw.toDate() : new Date(expiraRaw))
    : null;
  const expirou = expiraDate && new Date() > expiraDate;

  if (expirou) {
    return `
      <div class="rs-drawer-ed-card rs-drawer-ed-expirada"
           title="Edição expirada, acesso somente pela &quot;Minha Área&quot;"
           onclick="_alertarEdicaoExpiradaAssinante()"
           style="cursor:pointer">
        <div class="rs-drawer-ed-info">
          <div class="rs-drawer-ed-titulo">${titulo}</div>
          <div class="rs-drawer-ed-data">${data}${num ? ` · Ed. ${num}` : ''}</div>
          <div class="rs-drawer-ed-status rs-drawer-ed-status-exp">
            ⏰ Acesse pela "Minha Área"
          </div>
        </div>
        <span class="rs-drawer-chevron" style="opacity:.3">›</span>
      </div>`;
  }

  return `
    <button class="rs-drawer-ed-card ${classeAtual}"
            onclick="navegarParaEdicao('${_esc(ed.id)}')"
            type="button">
      <div class="rs-drawer-ed-info">
        <div class="rs-drawer-ed-titulo">${titulo}</div>
        <div class="rs-drawer-ed-data">${data}${num ? ` · Ed. ${num}` : ''}</div>
      </div>
      ${isAtual
      ? '<span class="rs-drawer-ed-badge-atual">👁 lendo agora</span>'
      : '<span class="rs-drawer-chevron">›</span>'}
    </button>`;
}

// ─── Toast para edição expirada no drawer (assinante) ────────────────────────
function _alertarEdicaoExpiradaAssinante() {
  fecharDrawer();
  let toast = document.getElementById('rs-toast-expirado');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'rs-toast-expirado';
    toast.style.cssText = [
      'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
      'background:#1e293b;color:#f8fafc;padding:12px 20px;border-radius:10px',
      'font-size:13px;font-weight:600;z-index:9999;text-align:center',
      'box-shadow:0 4px 20px rgba(0,0,0,.4);max-width:90vw;line-height:1.6',
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.innerHTML = '⏰ Edição expirada.<br>'
    + '<span style="font-weight:400">Acesse pelo menu <strong>"Minha Área"</strong> para visualizá-la.</span>';
  toast.style.display = 'block';
  setTimeout(() => { if (toast) toast.style.display = 'none'; }, 4500);
}

// ─── Card de edição — lead ───────────────────────────────────────────────────
function _cardEdicaoLead(ed, isAtual, envio) {
  const num = ed.numero || ed.edicao || '';
  const titulo = _esc(ed.titulo || `Edição ${num}`);
  const data = _fmtData(ed.data_publicacao);

  // Sem envio = edição nunca recebida
  if (!envio) {
    return `
      <div class="rs-drawer-ed-card rs-drawer-ed-naorecebida">
        <div class="rs-drawer-ed-info">
          <div class="rs-drawer-ed-titulo">${titulo}</div>
          <div class="rs-drawer-ed-data">${data}${num ? ` · Ed. ${num}` : ''}</div>
          <div class="rs-drawer-ed-cta-text">Assine para receber esta e todas as próximas edições</div>
        </div>
        <span class="rs-drawer-ed-lock">🔒</span>
      </div>`;
  }

  const expira = envio.expira_em ? new Date(envio.expira_em) : null;
  const agora = new Date();
  const expirou = expira && agora > expira;
  const expira2h = expira && !expirou && (expira - agora) < 2 * 60 * 60 * 1000;

  // Acesso expirado
  if (expirou) {
    const horas = ed.acesso_pro_horas || 24;
    return `
      <div class="rs-drawer-ed-card rs-drawer-ed-expirada"
           onclick="_mostrarExpirado('${_esc(ed.id)}','${titulo}',${horas})">
        <div class="rs-drawer-ed-info">
          <div class="rs-drawer-ed-titulo">${titulo}</div>
          <div class="rs-drawer-ed-data">${data}${num ? ` · Ed. ${num}` : ''}</div>
          <div class="rs-drawer-ed-status rs-drawer-ed-status-exp">⏰ Acesso expirado</div>
        </div>
        <span class="rs-drawer-chevron" style="opacity:.4">›</span>
      </div>`;
  }

  // Acesso ativo (normal ou expirando)
  const classeExpirando = expira2h ? 'rs-drawer-ed-expirando' : '';
  const badgeExpirando = expira2h
    ? '<div class="rs-drawer-ed-status rs-drawer-ed-status-warn">⚠️ Expira em breve</div>'
    : '';
  const contadorHTML = expira
    ? `<div class="rs-drawer-ed-contador" id="rs-contador-${_esc(ed.id)}">—</div>`
    : '';

  return `
    <button class="rs-drawer-ed-card rs-drawer-ed-ativa ${classeExpirando} ${isAtual ? 'rs-drawer-ed-atual' : ''}"
            onclick="navegarParaEdicao('${_esc(ed.id)}')"
            type="button">
      <div class="rs-drawer-ed-info">
        <div class="rs-drawer-ed-titulo">${titulo}</div>
        <div class="rs-drawer-ed-data">${data}${num ? ` · Ed. ${num}` : ''}</div>
        ${badgeExpirando}
        ${contadorHTML}
      </div>
      ${isAtual
      ? '<span class="rs-drawer-ed-badge-atual">👁 lendo agora</span>'
      : '<span class="rs-drawer-chevron">›</span>'}
    </button>`;
}

// ─── Modal de edição expirada ────────────────────────────────────────────────
function _mostrarExpirado(edicaoId, titulo, horas) {
  const modal = document.getElementById('rs-drawer-modal-expirado');
  if (!modal) return;
  document.getElementById('rs-modal-exp-titulo').textContent = titulo;
  document.getElementById('rs-modal-exp-horas').textContent = horas;
  modal.classList.add('rs-drawer-show');
}

// ─── Voltar para nível 1 ─────────────────────────────────────────────────────
function voltarParaTipos() {
  _limparContadores();
  _renderNivel1();
}

// ─── Utilitários de drawer ───────────────────────────────────────────────────
function _setDrawerHeader(titulo, mostrarVoltar) {
  const el = document.getElementById('rs-drawer-titulo');
  const btnVoltar = document.getElementById('rs-drawer-voltar');
  if (el) el.textContent = titulo;
  if (btnVoltar) btnVoltar.style.display = mostrarVoltar ? 'flex' : 'none';
}

function _limparContadores() {
  _drawer.contadores.forEach(id => clearInterval(id));
  _drawer.contadores = [];
}

// ─── Contador regressivo ─────────────────────────────────────────────────────
function iniciarContador(expiraEm, elementId) {
  const expira = new Date(expiraEm);

  function atualizar() {
    const el = document.getElementById(elementId);
    if (!el) { clearInterval(intervId); return; }

    const diff = expira - Date.now();
    if (diff <= 0) {
      el.textContent = 'Acesso expirado';
      el.style.color = 'var(--vermelho)';
      clearInterval(intervId);
      // Atualizar o card para estado expirado
      const card = el.closest('.rs-drawer-ed-ativa');
      if (card) {
        card.classList.remove('rs-drawer-ed-ativa', 'rs-drawer-ed-expirando');
        card.classList.add('rs-drawer-ed-expirada');
      }
      return;
    }

    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);

    if (h > 0) {
      el.textContent = `Acesso em ${h}h ${String(m).padStart(2, '0')}m`;
      el.style.color = 'var(--verde)';
    } else if (m >= 10) {
      el.textContent = `Expira em ${m}:${String(s).padStart(2, '0')}`;
      el.style.color = 'var(--amarelo)';
    } else {
      el.textContent = `⚠ Expira em ${m}:${String(s).padStart(2, '0')}`;
      el.style.color = 'var(--vermelho)';
      el.style.animation = 'rs-pulso .8s ease infinite';
    }
  }

  atualizar();
  const intervId = setInterval(atualizar, 1000);
  _drawer.contadores.push(intervId);
}

// ─── Navegar para edição via drawer ─────────────────────────────────────────
async function navegarParaEdicao(edicaoId) {
  if (edicaoId === _drawer.edicaoAtual) {
    fecharDrawer();
    return;
  }

  fecharDrawer();

  // Mostrar loading
  const appEl = document.getElementById('rs-app');
  if (appEl) {
    appEl.style.opacity = '.3';
    appEl.style.transition = 'opacity .2s';
  }
  mostrarLoading(true);

  try {
    // Buscar edição
    const snap = await db.collection('newsletters').doc(edicaoId).get();
    if (!snap.exists) { mostrarErro('Edição não encontrada.'); return; }
    const newsletter = { id: snap.id, ...snap.data() };

    const ctx = _getCtx();
    if (!ctx) { mostrarErro('Sessão expirada. Acesse pelo link do e-mail.'); return; }

    // Verificar acesso para lead
    if (ctx.segmento === 'lead') {
      const { data: envio } = await window.supabase
        .from('leads_envios')
        .select('expira_em')
        .eq('lead_id', ctx.uid)
        .eq('newsletter_id', edicaoId)
        .maybeSingle();

      if (!envio) {
        mostrarLoading(false);
        if (appEl) appEl.style.opacity = '1';
        _mostrarCTAConversao('nao_recebida');
        return;
      }
      if (envio.expira_em && new Date() > new Date(envio.expira_em)) {
        mostrarLoading(false);
        if (appEl) appEl.style.opacity = '1';
        _mostrarCTAConversao('expirada', newsletter.acesso_pro_horas || 24);
        return;
      }
    }

    // Reconstruir dados do destinatário a partir do contexto
    const destinatario = {
      _uid: ctx.uid,
      email: ctx.email || '',
      nome: ctx.nome || '',
      plano_slug: ctx.plano_slug || '',
      features: ctx.features || {},
      cod_uf: ctx.uf || '',
      cod_municipio: ctx.municipio_cod || '',
      nome_municipio: ctx.municipio_nome || '',
      perfil: ctx.perfil || '',
    };
    const segmento = ctx.segmento === 'assinante' ? 'assinantes' : 'leads';

    // Acesso sem envio real (drawer) — cria objeto envio mínimo
    const envioDrawer = ctx.segmento === 'assinante'
      ? { token_acesso: null, expira_em: null }
      : null;

    const acesso = detectarAcesso(destinatario, newsletter, segmento, envioDrawer);
    const dados = {
      nome: destinatario.nome,
      email: destinatario.email,
      edicao: newsletter.numero || newsletter.edicao || '',
      titulo: newsletter.titulo || '',
      data_publicacao: newsletter.data_publicacao || null,
      cod_uf: destinatario.cod_uf,
      nome_municipio: destinatario.nome_municipio,
      perfil: destinatario.perfil,
      plano: destinatario.plano_slug,
    };

    // Atualizar edição atual no estado do drawer
    _drawer.edicaoAtual = edicaoId;
    _drawer.tipoAtual = newsletter.Tipo || newsletter.tipo || null;

    // Limpar e re-renderizar
    renderHeader(newsletter, destinatario);
    const modoPadrao = sessionStorage.getItem('rs_modo_leitura') || acesso.modoPadrao;
    trocarModo(modoPadrao);
    renderModoRapido(newsletter, acesso);
    await renderModoCompleto(newsletter, dados, segmento, acesso);
    renderMunicipio(destinatario, acesso);
    renderMidia(newsletter, acesso);
    renderFAQ(newsletter, acesso);
    await renderReactions(edicaoId, ctx.uid);
    renderCTA(acesso, newsletter);
    renderWatermark(destinatario, newsletter);

    // Notificação de edição mais recente (apenas assinante)
    if (ctx.segmento === 'assinante') {
      verificarEdicaoMaisRecente(newsletter);
    }

    mostrarLoading(false);
    if (appEl) {
      appEl.style.display = 'block';
      appEl.style.opacity = '1';
    }

    // Scroll ao topo
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    console.error('[Drawer] Erro ao navegar:', err);
    mostrarErro('Erro ao carregar a edição.', err.message);
  }
}

// ─── CTA de conversão inline (para lead sem acesso via drawer) ───────────────
function _mostrarCTAConversao(motivo, horas) {
  const ctaWrap = document.getElementById('rs-cta-wrap');
  if (!ctaWrap) return;

  const msgs = {
    nao_recebida: {
      titulo: '📬 Conteúdo exclusivo para assinantes',
      texto: 'Assine para receber esta e todas as próximas edições com acesso permanente.',
      cta: 'Assinar agora →',
    },
    expirando: {
      titulo: '⏳ Seu acesso está expirando',
      texto: 'Não perca o próximo envio — assine agora e tenha acesso permanente.',
      cta: 'Assinar e não perder →',
    },
    expirada: {
      titulo: `⌛ Conteúdo disponível por ${horas}h após o envio`,
      texto: 'Este conteúdo ficou disponível por tempo limitado. Assine para ter acesso permanente a todas as edições.',
      cta: 'Assinar para acesso permanente →',
    },
  };

  const m = msgs[motivo] || msgs.nao_recebida;
  ctaWrap.innerHTML = `
    <div class="rs-cta rs-cta-lead" style="margin-top:16px">
      <h3>${m.titulo}</h3>
      <p>${m.texto}</p>
      <a href="/assinatura.html" class="rs-cta-btn">${m.cta}</a>
    </div>`;
  ctaWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ─── Notificação de edição mais recente ──────────────────────────────────────
async function verificarEdicaoMaisRecente(newsletter) {
  if (!newsletter.tipo) return;
  const tipoId = newsletter.tipo;

  try {
    const snap = await db.collection('newsletters')
      .where('tipo', '==', tipoId)
      .orderBy('data_publicacao', 'desc')
      .limit(1)
      .get();

    if (snap.empty) return;
    const maisRecente = snap.docs[0];
    if (maisRecente.id === newsletter.id) return; // já é a mais recente

    // Exibir notificação
    const banner = document.getElementById('rs-banner-recente');
    const link = document.getElementById('rs-banner-recente-link');
    if (!banner || !link) return;

    banner.style.display = 'flex';
    link.onclick = (e) => {
      e.preventDefault();
      banner.style.display = 'none';
      navegarParaEdicao(maisRecente.id);
    };
  } catch (e) { /* não fatal */ }
}

// ─── Expor globalmente ───────────────────────────────────────────────────────
window.abrirDrawer = abrirDrawer;
window._alertarEdicaoExpiradaAssinante = _alertarEdicaoExpiradaAssinante;
window.fecharDrawer = fecharDrawer;
window.abrirTipo = abrirTipo;
window.voltarParaTipos = voltarParaTipos;
window.navegarParaEdicao = navegarParaEdicao;
window._mostrarExpirado = _mostrarExpirado;

// ══════════════════════════════════════════════════════════════════════════
// FEEDBACK (integrado ao bloco de reações)
// ══════════════════════════════════════════════════════════════════════════

async function renderFeedback(nid) {
  const wrap = document.getElementById('rs-feedback-wrap');
  if (!wrap) return;

  // Verificar se já enviou feedback nesta edição
  if (localStorage.getItem(`rs_fb_${nid}`)) {
    wrap.innerHTML = `
      <div class="rs-feedback-enviado">
        ✅ Obrigado pelo seu feedback!
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="rs-feedback-area">
      <label class="rs-feedback-label" for="rs-feedback-txt">
        Quer nos contar mais? <span style="font-weight:400;opacity:.7">(opcional)</span>
      </label>
      <textarea id="rs-feedback-txt" class="rs-feedback-textarea"
                maxlength="500"
                placeholder="O que achou desta edição? Sugestões, elogios ou críticas são bem-vindos…"
                rows="3"></textarea>
      <div class="rs-feedback-footer">
        <span class="rs-feedback-contador" id="rs-feedback-chars">0/500</span>
        <button id="rs-feedback-btn" class="rs-feedback-btn" disabled
                onclick="enviarFeedback('${_esc(nid)}')">
          Enviar
        </button>
      </div>
    </div>`;

  // Contador de caracteres + habilitar botão
  document.getElementById('rs-feedback-txt')?.addEventListener('input', function () {
    const len = this.value.length;
    const counter = document.getElementById('rs-feedback-chars');
    const btn = document.getElementById('rs-feedback-btn');
    if (counter) counter.textContent = `${len}/500`;
    if (btn) btn.disabled = len === 0;
  });
}

async function enviarFeedback(nid) {
  const textarea = document.getElementById('rs-feedback-txt');
  const btn = document.getElementById('rs-feedback-btn');
  const texto = textarea?.value?.trim();
  if (!texto) return;

  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }

  const ctx = _getCtx();

  try {
    await db.collection('newsletters').doc(nid)
      .collection('feedbacks').add({
        texto,
        segmento: ctx?.segmento || 'desconhecido',
        plano: ctx?.plano_slug || ctx?.plano || null,
        data: firebase.firestore.Timestamp.now(),
        email: ctx?.email || null,
        respondido: false,
        usuario_id: ctx?._uid || ctx?.uid || null,
        nome: ctx?.nome || null,
      });

    // Marcar como enviado
    localStorage.setItem(`rs_fb_${nid}`, '1');

    // Atualizar UI
    const wrap = document.getElementById('rs-feedback-wrap');
    if (wrap) wrap.innerHTML = `
      <div class="rs-feedback-enviado">✅ Obrigado pelo seu feedback!</div>`;

  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar'; }
    console.warn('[Feedback] Erro ao enviar:', e);
  }
}

window.enviarFeedback = enviarFeedback;

// ─── Inicia ───────────────────────────────────────────────────────────────────
VerNewsletterComToken();

