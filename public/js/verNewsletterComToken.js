/* ==========================================================================
   verNewsletterComToken.js — Radar SIOPE
   Mantém 100% da lógica original de validação.
   Adiciona: segmentação por plano, dados município (Supabase),
   modo rápido/completo, mídia, FAQ, reactions, CTA dinâmico,
   acesso pro temporário para leads, integração OneSignal.
   ========================================================================== */

'use strict';

// ─── Helpers de URL ───────────────────────────────────────────────────────────

function normalizeParam(value) {
  if (!value) return null;
  const t = String(value).trim();
  if (!t || t.toLowerCase().includes('sem envioid') || t.includes('{{') || t.includes('}}')) return null;
  return t;
}

function getParams() {
  const params = new URLSearchParams(window.location.search);

  // Suporte ao parâmetro ofuscado 'd' (Base64) — mantido idêntico ao original
  const d = params.get('d');
  if (d) {
    try {
      const decoded = atob(decodeURIComponent(d));
      new URLSearchParams(decoded).forEach((v, k) => params.set(k, v));
    } catch (err) {
      console.warn('[verNL] Falha ao decodificar parâmetro d:', err);
    }
  }

  // Suporte à URL limpa /edicao/001 — extrai número do pathname
  const match = window.location.pathname.match(/\/edicao\/([^/?#]+)/);
  if (match && !params.get('nid')) {
    // nid pode ser o número da edição ou o ID Firestore —
    // o JS tenta ambos (primeiro pelo campo 'numero', depois direto por ID)
    params.set('edicao_numero', match[1]);
  }

  return params;
}

// ─── Helpers de UI ────────────────────────────────────────────────────────────

function mostrarLoading(sim) {
  document.getElementById('rs-loading').style.display = sim ? 'flex' : 'none';
}

function mostrarErro(msg, detalhe = '') {
  mostrarLoading(false);
  const el    = document.getElementById('rs-erro');
  const msgEl = document.getElementById('rs-erro-msg');
  el.style.display = 'block';
  if (msgEl) msgEl.innerHTML = msg + (detalhe ? `<br><small style="color:#94a3b8">${detalhe}</small>` : '');
}

function mostrarApp() {
  mostrarLoading(false);
  document.getElementById('rs-app').style.display = 'block';
}

function _fmtData(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function _esc(s) {
  return String(s || '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]
  );
}

// ─── Toggle modo rápido / completo ────────────────────────────────────────────

function trocarModo(modo) {
  const rapido   = document.getElementById('modo-rapido');
  const completo = document.getElementById('modo-completo');
  const btnR     = document.getElementById('btn-rapido');
  const btnC     = document.getElementById('btn-completo');

  if (modo === 'rapido') {
    rapido.classList.add('visivel');
    completo.classList.remove('visivel');
    btnR.classList.add('ativo');
    btnC.classList.remove('ativo');
  } else {
    completo.classList.add('visivel');
    rapido.classList.remove('visivel');
    btnC.classList.add('ativo');
    btnR.classList.remove('ativo');
  }
  sessionStorage.setItem('rs_modo_leitura', modo);
}

// ─── Registro de clique background — idêntico ao original ────────────────────

async function registrarCliqueBackground(env, uid, nid) {
  try {
    const url = `https://api.radarsiope.com.br/api/click?envioId=${encodeURIComponent(env)}&destinatarioId=${encodeURIComponent(uid)}&newsletterId=${encodeURIComponent(nid)}&url=${encodeURIComponent(window.location.href)}`;
    await fetch(url, { method: 'GET', keepalive: true });
  } catch (err) {
    console.warn('[verNL] Registro de clique falhou (não fatal):', err);
  }
}

// ─── Montar blocos — idêntico ao original ────────────────────────────────────

async function montarBlocos(newsletter, dados, segmento) {
  let htmlBase   = newsletter.conteudo_html_completo || '';
  const blocos   = newsletter.blocos || [];
  let htmlBlocos = '';

  blocos.forEach(b => {
    if (segmento && b.acesso !== 'todos' && b.acesso !== segmento) return;
    htmlBlocos += b.html || '';
  });

  let htmlFinal = blocos.length === 0
    ? htmlBase
    : htmlBase.includes('{{blocos}}')
      ? htmlBase.replace('{{blocos}}', htmlBlocos)
      : htmlBase + '\n' + htmlBlocos;

  return aplicarPlaceholders(htmlFinal, dados);
}

// ─── Detectar plano e features do destinatário ────────────────────────────────

function detectarAcesso(destinatario, newsletter, segmento) {
  const isAssinante  = segmento === 'assinantes';
  const plano_slug   = destinatario.plano_slug || null;
  const features     = destinatario.features   || {};

  // Acesso pro temporário para leads (campo na newsletter)
  const acessoProTemp = !isAssinante
    && newsletter.acesso_pro_temporario === true
    && newsletter.acesso_pro_horas > 0;

  // Regras por feature
  const temTexto       = isAssinante || acessoProTemp;
  const temAudio       = isAssinante
    ? !!features.newsletter_audio
    : (newsletter.acesso_audio_leads === true || acessoProTemp);
  const temInfografico = isAssinante
    ? !!features.newsletter_infografico
    : acessoProTemp;
  const temAlertas     = isAssinante && !!features.alertas_prioritarios;
  const temFaq         = true; // todos veem FAQ (lead vê parcial)
  const temMunicipio   = true; // todos veem seção município (lead vê blur)
  const blurMunicipio  = !isAssinante && !acessoProTemp;
  const truncarTexto   = !isAssinante && !acessoProTemp;

  // Modo padrão: lead → rápido, assinante → completo
  const modoPadrao = isAssinante ? 'completo' : 'rapido';

  return {
    isAssinante, plano_slug, features, acessoProTemp,
    temTexto, temAudio, temInfografico, temAlertas,
    temFaq, temMunicipio, blurMunicipio, truncarTexto,
    modoPadrao,
  };
}

// ─── Renderizar header ────────────────────────────────────────────────────────

function renderHeader(newsletter, destinatario) {
  const num   = newsletter.numero   || newsletter.edicao || '—';
  const titulo = newsletter.titulo  || 'Radar SIOPE';
  const data  = _fmtData(newsletter.data_publicacao);
  const nome  = (destinatario.nome || '').split(' ')[0];

  document.getElementById('hd-edicao').textContent  = `Edição ${num}`;
  document.getElementById('hd-data').textContent    = data;
  document.getElementById('hd-titulo').textContent  = titulo;
  document.getElementById('hd-saudacao').textContent = nome ? `Olá, ${nome}!` : '';
  document.title = `Radar SIOPE · Edição ${num}`;
}

// ─── Renderizar modo rápido (bullets) ────────────────────────────────────────

function renderModoRapido(newsletter, acesso) {
  const lista   = document.getElementById('lista-bullets');
  const bullets = newsletter.resumo_bullets || [];

  if (!bullets.length) {
    // Sem bullets → esconde o toggle todo e vai direto ao completo
    document.getElementById('rs-toggle-modo').style.display = 'none';
    return;
  }

  // Lead vê só os 2 primeiros bullets
  const visíveis = acesso.isAssinante || acesso.acessoProTemp
    ? bullets
    : bullets.slice(0, 2);

  const restantes = (!acesso.isAssinante && !acesso.acessoProTemp) && bullets.length > 2;

  lista.innerHTML = visíveis.map(b => `<li>${_esc(b)}</li>`).join('');

  if (restantes) {
    lista.parentElement.classList.add('rs-bullets-truncado');
    lista.insertAdjacentHTML('afterend', `
      <div style="text-align:center;padding:12px 0 0;position:relative;z-index:1">
        <a href="/assinatura.html"
           style="font-size:13px;font-weight:700;color:var(--azul);text-decoration:none">
          + ${bullets.length - 2} pontos restantes — Assine para ver todos →
        </a>
      </div>
    `);
  }
}

// ─── Renderizar modo completo ─────────────────────────────────────────────────

async function renderModoCompleto(newsletter, dados, segmento, acesso) {
  const container = document.getElementById('conteudo-newsletter');
  if (!newsletter.conteudo_html_completo) {
    container.innerHTML = '<p style="color:#94a3b8">Conteúdo não disponível.</p>';
    return;
  }

  const html = await montarBlocos(newsletter, dados, segmento);

  if (acesso.truncarTexto) {
    container.parentElement.classList.add('rs-conteudo-truncado');
    container.innerHTML = html;
    container.parentElement.insertAdjacentHTML('afterend', `
      <div style="text-align:center;padding:14px 0 4px;position:relative;z-index:1">
        <a href="/assinatura.html"
           style="display:inline-block;padding:10px 24px;background:var(--azul);
                  color:#fff;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">
          📖 Ler edição completa — Assine agora
        </a>
      </div>
    `);
  } else {
    container.innerHTML = html;
  }
}

// ─── Renderizar seção de mídia ────────────────────────────────────────────────

function renderMidia(newsletter, acesso) {
  const secao   = document.getElementById('secao-midia');
  const wrap    = document.getElementById('midia-conteudo');
  const itens   = [];

  // Áudio
  if (newsletter.audio_url) {
    if (acesso.temAudio) {
      itens.push(`
        <div class="rs-media-item">
          <div class="rs-media-icon">🎧</div>
          <div class="rs-media-info">
            <div class="rs-media-titulo">Podcast desta edição</div>
            <div class="rs-media-sub">Ouça enquanto trabalha</div>
            <audio controls src="${_esc(newsletter.audio_url)}" preload="none"></audio>
          </div>
        </div>
      `);
    } else {
      itens.push(`
        <div class="rs-media-item">
          <div class="rs-media-icon" style="opacity:.4">🎧</div>
          <div class="rs-media-info">
            <div class="rs-media-titulo">Podcast desta edição</div>
            <div class="rs-media-sub">Disponível no plano Essence ou superior</div>
          </div>
          <a href="/assinatura.html" class="rs-media-btn rs-media-btn-lock">🔒 Desbloquear</a>
        </div>
      `);
    }
  }

  // Vídeo
  if (newsletter.video_url) {
    itens.push(`
      <div class="rs-media-item">
        <div class="rs-media-icon">📺</div>
        <div class="rs-media-info">
          <div class="rs-media-titulo">Vídeo explicativo</div>
          <div class="rs-media-sub">Análise em vídeo desta edição</div>
        </div>
        <a href="${_esc(newsletter.video_url)}" target="_blank" rel="noopener"
           class="rs-media-btn rs-media-btn-primary">Assistir →</a>
      </div>
    `);
  }

  // Infográfico
  if (newsletter.infografico_url) {
    if (acesso.temInfografico) {
      itens.push(`
        <div class="rs-media-item">
          <div class="rs-media-icon">📊</div>
          <div class="rs-media-info">
            <div class="rs-media-titulo">Infográfico da edição</div>
            <div class="rs-media-sub">Visualização dos principais dados</div>
          </div>
          <a href="${_esc(newsletter.infografico_url)}" target="_blank" rel="noopener"
             class="rs-media-btn rs-media-btn-primary">Ver →</a>
        </div>
      `);
    } else {
      itens.push(`
        <div class="rs-media-item">
          <div class="rs-media-icon" style="opacity:.4">📊</div>
          <div class="rs-media-info">
            <div class="rs-media-titulo">Infográfico da edição</div>
            <div class="rs-media-sub">Disponível no plano Profissional ou superior</div>
          </div>
          <a href="/assinatura.html" class="rs-media-btn rs-media-btn-lock">🔒 Desbloquear</a>
        </div>
      `);
    }
  }

  if (itens.length) {
    secao.style.display  = 'block';
    wrap.innerHTML       = itens.join('');
  }
}

// ─── Renderizar FAQ ───────────────────────────────────────────────────────────

function renderFAQ(newsletter, acesso) {
  const secao = document.getElementById('secao-faq');
  const wrap  = document.getElementById('faq-conteudo');
  const faq   = newsletter.faq || [];
  if (!faq.length) return;

  // Lead vê só o primeiro item
  const visíveis = acesso.isAssinante || acesso.acessoProTemp
    ? faq
    : faq.slice(0, 1);

  secao.style.display = 'block';
  wrap.innerHTML = visíveis.map((item, i) => `
    <div class="rs-faq-item" id="faq-${i}">
      <button class="rs-faq-pergunta" onclick="toggleFaq(${i})">
        <span>${_esc(item.pergunta)}</span>
        <span class="rs-faq-icon">+</span>
      </button>
      <div class="rs-faq-resposta">${_esc(item.resposta)}</div>
    </div>
  `).join('');

  if (!acesso.isAssinante && faq.length > 1) {
    wrap.insertAdjacentHTML('beforeend', `
      <div style="padding:10px 0;font-size:12px;color:var(--subtexto);text-align:center">
        + ${faq.length - 1} perguntas disponíveis no plano Básico ou superior.
        <a href="/assinatura.html" style="color:var(--azul);font-weight:700">Ver planos →</a>
      </div>
    `);
  }
}

function toggleFaq(idx) {
  const item = document.getElementById(`faq-${idx}`);
  item?.classList.toggle('aberto');
}

// ─── Reactions ────────────────────────────────────────────────────────────────

const REACTIONS = [
  { emoji: '🔥', label: 'Top',    key: 'fogo'    },
  { emoji: '😮', label: 'Uau',    key: 'surpresa' },
  { emoji: '🚀', label: 'Útil',   key: 'util'    },
  { emoji: '👍', label: 'Ótimo',  key: 'otimo'   },
];

async function renderReactions(nid, uid) {
  const wrap = document.getElementById('reactions-wrap');
  if (!wrap) return;

  // Busca contagens atuais
  let counts = {};
  let minha  = null;
  try {
    const snap = await db.collection('newsletters').doc(nid).get();
    counts = snap.data()?.reactions || {};
    // Reação pessoal — guardada no localStorage (leve, sem necessidade de auth)
    minha = localStorage.getItem(`rs_reaction_${nid}`);
  } catch (e) {}

  function renderBotoes() {
    wrap.innerHTML = REACTIONS.map(r => `
      <button class="rs-reaction-btn ${minha === r.key ? 'ativo' : ''}"
              onclick="votar('${nid}','${uid}','${r.key}')"
              title="${r.label}">
        <span>${r.emoji}</span>
        <span class="rs-reaction-count">${counts[r.key] || 0}</span>
        <span class="rs-reaction-label">${r.label}</span>
      </button>
    `).join('');
  }

  renderBotoes();

  // Expõe função global de votação
  window.votar = async (newsletterId, userId, key) => {
    const feedback = document.getElementById('reaction-feedback');
    const anterior = localStorage.getItem(`rs_reaction_${newsletterId}`);

    // Mesmo clique = desfaz
    if (anterior === key) {
      counts[key] = Math.max(0, (counts[key] || 1) - 1);
      minha       = null;
      localStorage.removeItem(`rs_reaction_${newsletterId}`);
    } else {
      // Troca ou nova
      if (anterior && counts[anterior]) {
        counts[anterior] = Math.max(0, counts[anterior] - 1);
      }
      counts[key] = (counts[key] || 0) + 1;
      minha       = key;
      localStorage.setItem(`rs_reaction_${newsletterId}`, key);
    }

    renderBotoes();
    if (feedback) {
      feedback.textContent = minha ? '✓ Obrigado pelo feedback!' : '';
      setTimeout(() => { if (feedback) feedback.textContent = ''; }, 2500);
    }

    // Persiste no Firestore (não bloqueante)
    try {
      const update = {};
      REACTIONS.forEach(r => { update[`reactions.${r.key}`] = counts[r.key] || 0; });
      await db.collection('newsletters').doc(newsletterId).update(update);
    } catch (e) { console.warn('[verNL] Reaction save falhou (não fatal):', e); }
  };
}

// ─── CTA dinâmico por segmento ────────────────────────────────────────────────

function renderCTA(acesso, newsletter) {
  const wrap = document.getElementById('rs-cta-wrap');
  if (!wrap) return;

  if (acesso.isAssinante && !['basico'].includes(acesso.plano_slug)) {
    // Profissional+ → não mostra CTA de upgrade (já tem tudo)
    wrap.innerHTML = '';
    return;
  }

  if (acesso.isAssinante && acesso.plano_slug === 'basico') {
    // Básico → upgrade para Essence (áudio)
    wrap.innerHTML = `
      <div class="rs-cta rs-cta-basico">
        <h3 style="color:var(--azul)">🎧 Ouça esta edição em formato podcast</h3>
        <p style="color:var(--subtexto)">Upgrade para o plano Essence e tenha acesso ao áudio de todas as edições.</p>
        <a href="/assinatura.html?planId=essence" class="rs-cta-btn">Ver plano Essence →</a>
      </div>
    `;
    return;
  }

  // Lead (com ou sem acesso pro temporário)
  if (!acesso.isAssinante) {
    if (acesso.acessoProTemp) {
      const horas = newsletter.acesso_pro_horas || 24;
      wrap.innerHTML = `
        <div class="rs-cta rs-cta-basico">
          <h3 style="color:var(--azul)">⏳ Acesso especial por ${horas}h</h3>
          <p style="color:var(--subtexto)">Você está com acesso completo a esta edição. Assine para ter isso sempre.</p>
          <a href="/assinatura.html" class="rs-cta-btn">Assinar agora →</a>
        </div>
      `;
    } else {
      wrap.innerHTML = `
        <div class="rs-cta rs-cta-lead">
          <h3>📡 Leve o Radar SIOPE para o seu município</h3>
          <p>Dados fiscais, alertas de prazo, infográficos e podcast — tudo sobre educação do seu município.</p>
          <a href="/assinatura.html" class="rs-cta-btn">Ver planos e assinar →</a>
        </div>
      `;
    }
  }
}

// ─── Watermark ────────────────────────────────────────────────────────────────

function renderWatermark(destinatario, newsletter) {
  const el = document.getElementById('rs-watermark');
  if (!el) return;
  const nome  = destinatario.nome  || '';
  const email = destinatario.email || '';
  const num   = newsletter.numero  || newsletter.edicao || '';
  const agora = new Date().toLocaleString('pt-BR');
  el.textContent = `Edição ${num} · Exclusivo para ${nome} · ${email} · ${agora}`;
}

// ─── Seção município ──────────────────────────────────────────────────────────

async function renderMunicipio(destinatario, acesso) {
  const container = document.getElementById('municipio-conteudo');
  const titulo    = document.getElementById('municipio-titulo');
  const nome      = destinatario.nome_municipio || '';
  const uf        = destinatario.cod_uf         || '';
  const cod       = destinatario.cod_municipio  || null;

  if (titulo && nome) titulo.textContent = `${nome}/${uf}`;

  // Aguarda window.supabase estar disponível (exposeSupabase.js é module)
  await new Promise(resolve => {
    if (window.supabase) return resolve();
    let tentativas = 0;
    const t = setInterval(() => {
      if (window.supabase || ++tentativas > 20) { clearInterval(t); resolve(); }
    }, 150);
  });

  const SM = window.SupabaseMunicipio;
  if (!SM) { container.innerHTML = ''; return; }

  try {
    const [siope, fundeb] = await Promise.all([
      SM.getUltimoSIOPE(cod),
      SM.getUltimoFUNDEB(cod),
    ]);

    SM.renderSecaoMunicipio({
      container,
      blur:         acesso.blurMunicipio,
      dadosSiope:   siope,
      dadosFundeb:  fundeb,
      nomeMunicipio: nome,
      uf,
    });
  } catch (err) {
    console.warn('[verNL] Seção município falhou (não fatal):', err);
    container.innerHTML = '';
  }
}

// ─── Buscar newsletter por número (URL /edicao/001) ───────────────────────────

async function buscarNewsletterPorNumero(numero) {
  const snap = await db.collection('newsletters')
    .where('numero', '==', String(numero))
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ─── Inicialização do _radarUser (para OneSignal) ─────────────────────────────

function publicarRadarUser(destinatario, segmento, assinaturaId) {
  window._radarUser = {
    uid:           destinatario._uid || null,
    email:         destinatario.email || '',
    nome:          destinatario.nome  || '',
    segmento:      segmento === 'assinantes' ? 'assinante' : 'lead',
    plano_slug:    destinatario.plano_slug    || null,
    features:      destinatario.features      || {},
    uf:            destinatario.cod_uf        || '',
    municipio_cod: destinatario.cod_municipio || '',
    municipio_nome: destinatario.nome_municipio || '',
    perfil:        destinatario.perfil        || '',
    assinaturaId:  assinaturaId               || null,
  };
}

// ─── FLUXO PRINCIPAL ──────────────────────────────────────────────────────────

async function VerNewsletterComToken() {
  const params       = getParams();
  const d_nid        = normalizeParam(params.get('nid'));
  const env          = normalizeParam(params.get('env'));
  const uid          = normalizeParam(params.get('uid'));
  const token        = params.get('token');
  const assinaturaId = normalizeParam(params.get('assinaturaId'));
  const edicaoNumero = params.get('edicao_numero'); // da URL limpa /edicao/001

  // ── Validação inicial ──────────────────────────────────────────────────────
  const temNid = d_nid || edicaoNumero;
  if (!temNid || !env || !uid || !token) {
    mostrarErro(
      '<strong>Link inválido ou incompleto.</strong>',
      'Verifique o link recebido por e-mail ou acesse a Área do Assinante.'
    );
    return;
  }

  try {
    // ── 1. Buscar envio ────────────────────────────────────────────────────
    let envioRef;
    if (assinaturaId) {
      envioRef = db.collection('usuarios').doc(uid)
                   .collection('assinaturas').doc(assinaturaId)
                   .collection('envios').doc(env);
    } else {
      envioRef = db.collection('leads').doc(uid).collection('envios').doc(env);
    }

    const envioSnap = await envioRef.get();
    if (!envioSnap.exists) {
      mostrarErro('Envio não encontrado.', `uid: ${uid} · env: ${env}`);
      return;
    }
    const envio = envioSnap.data();

    // ── 2. Validar token ───────────────────────────────────────────────────
    if (!envio.token_acesso || envio.token_acesso !== token) {
      mostrarErro('Acesso negado.', 'Token de acesso inválido.');
      return;
    }

    // ── 3. Validar expiração ───────────────────────────────────────────────
    if (envio.expira_em) {
      const exp = envio.expira_em.toDate ? envio.expira_em.toDate() : new Date(envio.expira_em);
      if (new Date() > exp) {
        mostrarErro(
          'Este link expirou.',
          'Acesse a Área do Assinante para visualizar edições anteriores.'
        );
        return;
      }
    }

    // ── 4. Atualizar metadados (não bloqueante) ────────────────────────────
    envioRef.update({
      ultimo_acesso:  new Date(),
      acessos_totais: firebase.firestore.FieldValue.increment(1),
    }).catch(() => {});

    // ── 5. Verificar compartilhamento excessivo ────────────────────────────
    const envioAtual = (await envioRef.get()).data() || envio;
    const acessos    = Number(envioAtual.acessos_totais || 0);
    const LIMIAR     = 5;

    if (acessos > LIMIAR) {
      envioRef.update({ sinalizacao_compartilhamento: true }).catch(() => {});
      mostrarErro(
        `<strong>Conteúdo exclusivo para: ${_esc(envioAtual._destinatario_nome || '')}</strong>`,
        `Identificamos múltiplos acessos. <a href="/login.html">Acesse a Área do Assinante</a> para visualizar com segurança.`
      );
      return;
    }

    // ── 6. Buscar newsletter ───────────────────────────────────────────────
    let newsletter;
    if (d_nid) {
      const snap = await db.collection('newsletters').doc(d_nid).get();
      if (!snap.exists) { mostrarErro('Edição não encontrada.'); return; }
      newsletter = { id: snap.id, ...snap.data() };
    } else {
      // URL limpa /edicao/001 — busca pelo campo numero
      newsletter = await buscarNewsletterPorNumero(edicaoNumero);
      if (!newsletter) { mostrarErro(`Edição ${edicaoNumero} não encontrada.`); return; }
    }

    const nid = newsletter.id;

    // ── 7. Buscar destinatário ─────────────────────────────────────────────
    let destinatarioSnap;
    let segmento;

    if (assinaturaId) {
      destinatarioSnap = await db.collection('usuarios').doc(uid).get();
      segmento         = 'assinantes';
    } else {
      destinatarioSnap = await db.collection('leads').doc(uid).get();
      segmento         = 'leads';
    }

    if (!destinatarioSnap.exists) { mostrarErro('Destinatário não encontrado.'); return; }
    const destinatario     = { _uid: uid, ...destinatarioSnap.data() };

    // ── 8. Determinar acesso ───────────────────────────────────────────────
    const acesso = detectarAcesso(destinatario, newsletter, segmento);

    // ── 9. Registrar clique (não bloqueante) ───────────────────────────────
    registrarCliqueBackground(env, uid, nid);

    // ── 10. Publicar _radarUser (OneSignal vai ler isso) ──────────────────
    publicarRadarUser(destinatario, segmento, assinaturaId);

    // ── 11. Dados do destinatário para placeholders ────────────────────────
    const dados = {
      nome:           destinatario.nome          || '',
      email:          destinatario.email         || '',
      edicao:         newsletter.numero          || newsletter.edicao || '',
      titulo:         newsletter.titulo          || '',
      data_publicacao: newsletter.data_publicacao || null,
      cod_uf:         destinatario.cod_uf        || '',
      nome_municipio: destinatario.nome_municipio || '',
      perfil:         destinatario.perfil        || '',
      plano:          destinatario.plano_slug    || '',
    };

    // ── 12. Renderizar tudo ────────────────────────────────────────────────

    // Header
    renderHeader(newsletter, destinatario);

    // Modo padrão (salvo na sessão tem prioridade)
    const modoPadrao = sessionStorage.getItem('rs_modo_leitura') || acesso.modoPadrao;
    trocarModo(modoPadrao);

    // Modo rápido (bullets)
    renderModoRapido(newsletter, acesso);

    // Modo completo (HTML da edição)
    await renderModoCompleto(newsletter, dados, segmento, acesso);

    // Município (Supabase — roda em paralelo, não bloqueia)
    renderMunicipio(destinatario, acesso);

    // Mídia
    renderMidia(newsletter, acesso);

    // FAQ
    renderFAQ(newsletter, acesso);

    // Reactions
    await renderReactions(nid, uid);

    // CTA
    renderCTA(acesso, newsletter);

    // Watermark
    renderWatermark(destinatario, newsletter);

    // ── 13. Exibe o app ───────────────────────────────────────────────────
    mostrarApp();

  } catch (err) {
    console.error('[verNL] Erro geral:', err);
    mostrarErro('Erro ao carregar a edição.', err.message);
  }
}

// ─── Expõe funções para o HTML ────────────────────────────────────────────────
window.trocarModo = trocarModo;
window.toggleFaq  = toggleFaq;

// ─── Executa ──────────────────────────────────────────────────────────────────
VerNewsletterComToken();
