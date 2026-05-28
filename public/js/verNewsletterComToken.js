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
  uf: null,
  vitrine: null
};
// ─── Contexto dinâmico para o Chat (evita referência a edição antiga) ─────
window._chatContext = { nid: null, uid: null, edicaoNum: null };
// ─── Município ativo no seletor multi-município ────────────────────────────
let _municipioAtivo = null; // { _uid, cod_municipio, nome_municipio, cod_uf }

window.validarEabrirMidia = async (url, tipo) => {
  if (await _checarSessaoCritica()) {
    abrirModalMidia(url, tipo);
  }
};

// ─── Animações base (sheet + fade) ──────────────────────────────────────────
(function _injetarAnimacoesBase() {
  if (document.getElementById('rs-anim-base')) return;
  const s = document.createElement('style');
  s.id = 'rs-anim-base';
  s.textContent = `
    @keyframes rsFadeIn  { from { opacity:0 } to { opacity:1 } }
    @keyframes rsSlideUp { from { transform:translateY(100%) } to { transform:translateY(0) } }
    @keyframes rsScaleIn { from { opacity:0;transform:scale(.9) } to { opacity:1;transform:scale(1) } }
  `;
  document.head.appendChild(s);
})();

// ─── CSS dos Cards de Mídia (padrão unificado) ────────────────────────────
(function _injetarCSSMidia() {
  if (document.getElementById('rs-midia-style')) return;
  const s = document.createElement('style');
  s.id = 'rs-midia-style';
  s.textContent = `
    /* ── Container base ─────────────────────────────────────── */
    .rs-media-card {
      display: flex;
      align-items: center;
      gap: 14px;
      background: var(--rs-card2, #162032);
      border: 1px solid rgba(10,61,98,0.55);
      border-radius: 12px;
      padding: 16px 18px;
      margin: 12px 0;
      animation: rsFadeIn 0.35s ease;
      transition: background 0.2s ease;
    }
    
    /* Hover suave e unificado (inclui Mapa Mental) */
    .rs-media-card:hover,
    .rs-mm-card:hover {
      background: #1e293b; /* Apenas escurece levemente, sem movimento */
    }

    /* ── Cards bloqueados ──────────────────────────────────── */
    .rs-media-card.rs-media-card-bloqueado,
    .rs-mm-card.rs-mm-card-bloqueado {
      opacity: 0.7;
      background: rgba(22,32,50,0.6);
    }

    /* ── Ícone ─────────────────────────────────────────────── */
    .rs-media-card-icone,
    .rs-mm-card-icone {
      font-size: 30px;
      flex-shrink: 0;
      line-height: 1;
    }

    /* ── Informações ───────────────────────────────────────── */
    .rs-media-card-info,
    .rs-mm-card-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    /* ── Label (categoria) ─────────────────────────────────── */
    .rs-media-card-label,
    .rs-mm-card-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: #60A5FA;
    }

    /* ── Título ────────────────────────────────────────────── */
    .rs-media-card-titulo,
    .rs-mm-card-titulo {
      font-size: 14px;
      color: var(--rs-text, #f1f5f9);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ── Subtítulo ─────────────────────────────────────────── */
    .rs-media-card-sub {
      font-size: 12px;
      color: var(--rs-muted, #94a3b8);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ── Botões ────────────────────────────────────────────── */
    .rs-media-card-btn,
    .rs-mm-card-btn {
      background: var(--azul, #0A3D62);
      color: #fff;
      border: none;
      padding: 9px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: background .2s;
    }
    .rs-media-card-btn:hover,
    .rs-mm-card-btn:hover {
      background: #0d4f7c;
    }
    .rs-media-card-btn.rs-media-card-btn-lock,
    .rs-mm-card-btn.rs-mm-card-btn-lock {
      background: rgba(255,255,255,0.08);
      color: #94a3b8;
    }
    .rs-media-card-btn.rs-media-card-btn-lock:hover,
    .rs-mm-card-btn.rs-mm-card-btn-lock:hover {
      background: rgba(255,255,255,0.12);
      color: #f1f5f9;
    }

    /* ── Container de Áudio ────────────────────────────────── */
    .rs-media-card-audio {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      min-width: 120px;
    }
    .rs-media-card-audio button {
      width: 100%;
    }

    /* ── Player de Áudio Nativo (INJETADO) ─────────────────── */
    /* Garante que o player apareça mesmo dentro de containers flex */
    .rs-media-card-audio audio {
      display: block !important;
      width: 100% !important;
      max-width: 220px;
      height: 38px !important;
      min-height: 38px !important;
      border-radius: 8px;
      outline: none;
      background: #0f1729;
      margin: 0;
      padding: 0;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }
    
    /* ── Mobile ────────────────────────────────────────────── */
    @media (max-width: 640px) {
      .rs-media-card, .rs-mm-card {
        flex-wrap: wrap;
        gap: 12px;
      }
      .rs-media-card-icone, .rs-mm-card-icone {
        font-size: 26px;
      }
      .rs-media-card-info, .rs-mm-card-info {
        flex: 1 1 100%;
        order: 3;
        margin-top: 4px;
      }
      .rs-media-card-btn, .rs-mm-card-btn,
      .rs-media-card-audio, .rs-mm-card-audio {
        width: 100%;
        order: 2;
      }
      .rs-media-card-audio audio, .rs-mm-card-audio audio {
        max-width: 100%;
      }
    }
  `;
  document.head.appendChild(s);
})();

// ─── Parâmetros da URL ────────────────────────────────────────────────────────
// ─── Buscar config pública via API (variáveis de ambiente) ──────────────────
let _configCache = null;
async function _getConfigPublica() {
  // Retorna cache se já buscado
  if (_configCache) return _configCache;

  try {
    // ✅ URL absoluta para o domínio da API
    const resp = await fetch('https://api.radarsiope.com.br/api/click?acao=config', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    if (data.ok && data.config) {
      _configCache = data.config;
      // Opcional: salva no window para acesso global
      window.RADAR_CONFIG = data.config;
      return data.config;
    }
  } catch (err) {
    console.warn('[verNL] Falha ao buscar config pública:', err);
  }

  // Fallback: valores vazios
  return {
    NEXT_PUBLIC_WA_GRUPO_AVISOS_LINK: null,
    NEXT_PUBLIC_WA_GRUPO_ALERTAS_LINK: null,
    NEXT_PUBLIC_BASE_URL: null,
  };
}

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

  // ── Acesso temporário para leads: valida janela de horas a partir do envio ──
  // Calcula: data_envio (criado_em) + acesso_pro_horas → se ainda dentro da janela, concede.
  // NÃO usa expira_em (que é a expiração do link, não da janela pro).
  let acessoProTemp = false;
  if (!isAssinante
    && newsletter.acesso_pro_temporario === true
    && (newsletter.acesso_pro_horas || 0) > 0) {

    // Referência: data real de envio ao lead (criado_em / data_envio do leads_envios)
    const refRaw = envio?.criado_em || envio?.primeiro_acesso || null;
    if (refRaw) {
      const dataEnvio = refRaw.toDate ? refRaw.toDate() : new Date(refRaw);
      const msJanela = (newsletter.acesso_pro_horas) * 60 * 60 * 1000;
      const expiraAcesso = new Date(dataEnvio.getTime() + msJanela);
      acessoProTemp = new Date() < expiraAcesso;
    } else {
      // Sem data de envio: nega o acesso temporário por segurança
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
    temMapaMental: isAssinante ? !!features.newsletter_mapa_mental : acessoProTemp,
    temAlertas: isAssinante && !!features.alertas_prioritarios,
    temChat: isAssinante ? !!features.pergunta_edicao : acessoProTemp,
    temRelatorio: isAssinante ? !!features.relatorio_conformidade : acessoProTemp,
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
  const temAcesso = acesso.isAssinante || acesso.acessoProTemp;

  if (lista) {
    // Renderiza bullets - clicáveis se usuário tem acesso
    lista.innerHTML = visiveis.map((b, idx) => `
      <li class="${temAcesso ? 'rs-bullet-clicavel' : ''}" 
          ${temAcesso ? `data-bullet-idx="${idx}" style="cursor:pointer"` : ''}>
        ${_esc(b)}
      </li>
    `).join('');

    // Adiciona event listeners nos bullets clicáveis
    if (temAcesso) {
      lista.querySelectorAll('.rs-bullet-clicavel').forEach(bullet => {
        bullet.addEventListener('click', () => {
          // Troca para modo completo
          trocarModo('completo');
          // Scroll suave até o conteúdo completo
          setTimeout(() => {
            const modoCompleto = document.getElementById('modo-completo');
            if (modoCompleto) {
              modoCompleto.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 100);
        });
      });
    }
  }

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

    // Fade overlay — lê --rs-card (variável de fundo real do projeto) para
    // compatibilidade com todos os temas. Fallback para backgroundColor do body.
    const _bgAtual = getComputedStyle(document.documentElement)
      .getPropertyValue('--rs-card').trim() ||
      getComputedStyle(document.body).backgroundColor ||
      '#1e293b';
    const fade = document.createElement('div');
    fade.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:120px;' +
      `background:linear-gradient(transparent,${_bgAtual});pointer-events:none`;
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

async function renderMunicipio(destinatario, acesso, newsletter) {
  const container = document.getElementById('municipio-conteudo');
  const titulo = document.getElementById('municipio-titulo');

  // ── Lê municipios_plano da sessão ────────────────────────────────────────
  let municipiosPlano = [];
  try {
    const sess = JSON.parse(localStorage.getItem('rs_pwa_session') || '{}');
    municipiosPlano = sess.municipios_plano || [];
  } catch (_) { }

  const temMultiplos = acesso.isAssinante && municipiosPlano.length > 1;

  // Inicializa _municipioAtivo apenas na primeira chamada ou ao trocar de assinante
  if (!_municipioAtivo || _municipioAtivo._uid !== destinatario._uid) {
    _municipioAtivo = {
      _uid: destinatario._uid,
      cod_municipio: destinatario.cod_municipio || null,
      nome_municipio: destinatario.nome_municipio || '',
      cod_uf: destinatario.cod_uf || '',
    };
  }

  const cod = _municipioAtivo.cod_municipio;
  const nome = _municipioAtivo.nome_municipio;
  const uf = _municipioAtivo.cod_uf;

  // ── Título ou seletor (ocupa o mesmo espaço) ──────────────────────────────
  if (titulo) {
    if (temMultiplos) {
      _renderSeletorMunicipio(titulo, municipiosPlano, destinatario, acesso, newsletter);
    } else {
      titulo.textContent = nome ? `${nome}/${uf}` : '';
    }
  }

  // ── Aguarda módulo Supabase ───────────────────────────────────────────────
  await new Promise(resolve => {
    if (window.SupabaseMunicipio) return resolve();
    let n = 0;
    const t = setInterval(() => {
      if (window.SupabaseMunicipio || ++n > 40) { clearInterval(t); resolve(); }
    }, 100);
  });

  const SM = window.SupabaseMunicipio;
  if (!SM || !container) return;

  const btn = document.getElementById('btn-toggle-historico');
  if (btn) btn.style.display = 'none';

  SM.renderSkeleton(container);

  try {
    const resumo = cod ? await SM.getResumoMunicipio(cod) : null;
    SM.renderSecaoMunicipio({ container, blur: acesso.blurMunicipio, resumo, nomeMunicipio: nome, uf });

    if (resumo && cod && (acesso.isAssinante || acesso.acessoProTemp)) {
      dadosMunicipioAtual = { cod_municipio: cod, nome, uf, vitrine: newsletter?.vitrine || null };
      if (btn) btn.style.display = 'block';
    } else {
      dadosMunicipioAtual = { cod_municipio: null, nome: null, uf: null };
    }

    if ((acesso.isAssinante || acesso.acessoProTemp) && resumo && cod) {
      _injetarBotaoRelatorio(cod, nome, uf, acesso.temRelatorio);
    }

  } catch (err) {
    console.warn('[verNL] Município falhou (não fatal):', err);
    container.innerHTML = '';
    if (btn) btn.style.display = 'none';
  }
}

function _injetarBotaoRelatorio(cod, nome, uf, temRelatorio) {
  // Remove grupo anterior (troca de município)
  document.getElementById('rs-acoes-municipio')?.remove();
  const btnHistorico = document.getElementById('btn-toggle-historico');
  if (!btnHistorico) return; // seção município não renderizou

  // ── Wrapper flex que agrupa os dois botões ─────────────────────────────────
  const grupo = document.createElement('div');
  grupo.id = 'rs-acoes-municipio';
  grupo.style.cssText = [
    'display:flex', 'flex-wrap:wrap', 'gap:8px', 'margin-top:8px', 'width:100%',
  ].join(';');
  btnHistorico.style.flex = '1';
  btnHistorico.parentNode.insertBefore(grupo, btnHistorico);
  grupo.appendChild(btnHistorico);

  // ── Botão do relatório ─────────────────────────────────────────────────────
  const btnRel = document.createElement('button');
  btnRel.id = 'btn-relatorio-conformidade';

  // ✅ CORREÇÃO: Grava os dados NO DOM no momento da criação
  btnRel.dataset.cod = String(cod || '');
  btnRel.dataset.nome = String(nome || '');
  btnRel.dataset.uf = String(uf || '');

  if (temRelatorio) {
    btnRel.innerHTML = '📋 Conformidade';
    btnRel.title = 'Gerar Relatório de Conformidade Municipal (PDF)';
    btnRel.style.cssText = [
      'flex:1 1 120px', 'padding:9px 10px', 'background:var(--azul,#0A3D62)',
      'color:#fff', 'border:none', 'border-radius:8px', 'font-size:13px',
      'font-weight:600', 'cursor:pointer', 'white-space:nowrap', 'transition:opacity .2s',
    ].join(';');
    btnRel.addEventListener('mouseover', () => { btnRel.style.opacity = '.85'; });
    btnRel.addEventListener('mouseout', () => { btnRel.style.opacity = '1'; });
    // ✅ Chama SEM parâmetros. A função lerá diretamente do dataset.
    btnRel.addEventListener('click', () => gerarRelatorioConformidade());
  } else {
    btnRel.innerHTML = '🔒 Conformidade';
    btnRel.title = 'Disponível no plano Profissional';
    btnRel.style.cssText = [
      'flex:1 1 120px', 'padding:9px 10px', 'background:transparent',
      'color:var(--rs-muted,#94a3b8)', 'border:1.5px dashed var(--rs-borda,#334155)',
      'border-radius:8px', 'font-size:13px', 'font-weight:600',
      'cursor:pointer', 'white-space:nowrap', 'transition:border-color .2s, color .2s',
    ].join(';');
    btnRel.addEventListener('mouseover', () => {
      btnRel.style.borderColor = 'var(--azul,#0A3D62)';
      btnRel.style.color = 'var(--rs-texto,#f1f5f9)';
    });
    btnRel.addEventListener('mouseout', () => {
      btnRel.style.borderColor = 'var(--rs-borda,#334155)';
      btnRel.style.color = 'var(--rs-muted,#94a3b8)';
    });
    btnRel.addEventListener('click', () => {
      if (typeof _solicitarUpgrade === 'function') _solicitarUpgrade('relatorio', true);
    });
  }
  grupo.appendChild(btnRel);
}

// ─── Seletor inline de município (multi-município) ───────────────────────────
function _renderSeletorMunicipio(tituloEl, municipiosPlano, destinatario, acesso, newsletter) {
  // municipiosPlano já é array de objetos: [{ cod_municipio, nome, uf }]
  // Garante retrocompatibilidade se ainda vier como array de strings
  const detalhes = municipiosPlano.map(m =>
    typeof m === 'object' ? m : { cod_municipio: String(m), nome: String(m), uf: '' }
  );

  const ativo = _municipioAtivo.cod_municipio;

  tituloEl.innerHTML = `
    <select id="rs-seletor-municipio" style="
      background: transparent;
      border: none;
      border-bottom: 1px dashed currentColor;
      color: inherit;
      font: inherit;
      font-weight: inherit;
      cursor: pointer;
      padding: 0 18px 0 0;
      appearance: none; -webkit-appearance: none;
      background-image: url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%226%22 viewBox=%220 0 10 6%22><path d=%22M1 1l4 4 4-4%22 stroke=%22currentColor%22 stroke-width=%221.5%22 fill=%22none%22 stroke-linecap=%22round%22/></svg>');
      background-repeat: no-repeat;
      background-position: right 2px center;
      max-width: 100%;
      outline: none;
    ">
      ${detalhes.map(m => `
        <option value="${_esc(m.cod_municipio)}" ${m.cod_municipio === ativo ? 'selected' : ''}>
          ${_esc(m.nome)}${m.uf ? `/${_esc(m.uf)}` : ''}
        </option>
      `).join('')}
    </select>`;

  document.getElementById('rs-seletor-municipio')?.addEventListener('change', async (e) => {
    // 🔒 Validação Crítica ao trocar de município
    if (!(await _checarSessaoCritica())) return;

    const novoCod = e.target.value;
    const novo = detalhes.find(m => m.cod_municipio === novoCod);
    if (!novo) return;

    _municipioAtivo = {
      _uid: destinatario._uid,
      cod_municipio: novo.cod_municipio,
      nome_municipio: novo.nome,
      cod_uf: novo.uf || '',
    };

    // Notifica o calendário sobre a troca de município (se estiver aberto)
    window._calAtualizarMunicipio?.(novo.cod_municipio);

    const container = document.getElementById('municipio-conteudo');
    const btn = document.getElementById('btn-toggle-historico');
    const resumoEl = document.getElementById('municipio-resumo');
    const historicoEl = document.getElementById('municipio-historico');
    const SM = window.SupabaseMunicipio;
    if (!SM || !container) return;

    // Volta ao resumo se estava no histórico
    if (resumoEl) resumoEl.style.display = 'block';
    if (historicoEl) historicoEl.style.display = 'none';
    if (btn) { btn.style.display = 'none'; btn.innerHTML = '📈 Ver série histórica completa'; }

    SM.renderSkeleton(container);

    try {
      const resumo = await SM.getResumoMunicipio(novo.cod_municipio);
      SM.renderSecaoMunicipio({
        container,
        blur: acesso.blurMunicipio,
        resumo,
        nomeMunicipio: novo.nome,
        uf: novo.uf || '',
      });

      if (resumo && (acesso.isAssinante || acesso.acessoProTemp)) {
        dadosMunicipioAtual = {
          cod_municipio: novo.cod_municipio,
          nome: novo.nome,
          uf: novo.uf || '',
          vitrine: newsletter?.vitrine || null,
        };
        if (btn) btn.style.display = 'block';
      } else {
        dadosMunicipioAtual = { cod_municipio: null, nome: null, uf: null };
      }
      // Sincroniza o dataset do botão de relatório com o município selecionado
      const btnRel = document.getElementById('btn-relatorio-conformidade');
      if (btnRel) {
        btnRel.dataset.cod = String(novo.cod_municipio || '');
        btnRel.dataset.nome = String(novo.nome || '');
        btnRel.dataset.uf = String(novo.uf || '');
      }
    } catch (err) {
      console.warn('[verNL] Erro ao trocar município:', err);
      container.innerHTML = '';
    }
  });
}

// ─── MODAL DE MÍDIA INTERNA (Vídeo / Infográfico) ─────────────────────────
// ─── MODAL DE MÍDIA (Design System Radar SIOPE) ─────────────────────────────
function _injetarEstiloModalMidia() {
  if (document.getElementById('rs-modal-midia-style')) return;
  const style = document.createElement('style');
  style.id = 'rs-modal-midia-style';
  style.textContent = `
    .rs-midia-modal { position:fixed; inset:0; z-index:9990;
      background:rgba(15,23,42,0.85); display:flex; align-items:center; justify-content:center;
      opacity:0; pointer-events:none; transition:opacity .2s ease; }
    .rs-midia-modal.aberto { opacity:1; pointer-events:auto; }
    .rs-midia-modal-box { position:relative; width:92vw; max-width:880px; height:85vh;
      background:var(--rs-card,#fff); border-radius:16px; overflow:hidden;
      box-shadow:0 12px 40px rgba(0,0,0,0.35); display:flex; flex-direction:column; }
    .rs-midia-modal-header { display:flex; align-items:center; justify-content:space-between;
      padding:14px 18px; border-bottom:1px solid var(--rs-borda,#e2e8f0); background:var(--rs-card,#fff); }
    .rs-midia-modal-titulo { margin:0; font-size:15px; font-weight:600; color:var(--rs-texto,#0f172a); }
    .rs-midia-modal-fechar { background:none; border:none; color:var(--rs-muted,#94a3b8);
      font-size:20px; cursor:pointer; padding:6px 8px; border-radius:8px; transition:all .15s; }
    .rs-midia-modal-fechar:hover { background:var(--rs-borda,#e2e8f0); color:var(--rs-texto,#0f172a); }
    .rs-midia-modal-conteudo { flex:1; position:relative; background:#000; overflow:hidden; }
    .rs-midia-modal-conteudo iframe, .rs-midia-modal-conteudo video, .rs-midia-modal-conteudo img {
      width:100%; height:100%; border:none; display:block; object-fit:contain; background:#000; }
    @media(max-width:600px) {
      .rs-midia-modal-box { width:98vw; height:90vh; border-radius:12px; }
      .rs-midia-modal-header { padding:12px 14px; }
      .rs-midia-modal-titulo { font-size:14px; }
    }
  `;
  document.head.appendChild(style);
}

function _converterEmbedUrl(url, tipo) {
  if (!url) return url;
  const u = url.trim();

  // YouTube: watch?v= → embed/
  const ytMatch = u.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?rel=0&modestbranding=1&playsinline=1`;

  // YouTube: youtu.be/ → embed/
  const ytShort = u.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (ytShort) return `https://www.youtube.com/embed/${ytShort[1]}?rel=0&modestbranding=1&playsinline=1`;

  // Vimeo: vimeo.com/123456 → player.vimeo.com/video/123456
  const vimeoMatch = u.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}?badge=0&autopause=0&player_id=0&app_id=58479`;

  // Google Drive: visualização → embed
  if (u.includes('drive.google.com/file/d/') && u.includes('/view')) {
    const fileId = u.match(/file\/d\/([^/]+)/)?.[1];
    if (fileId) return `https://drive.google.com/file/d/${fileId}/preview`;
  }

  // Data Studio / Looker: já vem em formato embed, mas garantimos parâmetros seguros
  if (u.includes('lookerstudio.google.com') || u.includes('datastudio.google.com')) {
    return u.includes('?embed=') ? u : `${u}${u.includes('?') ? '&' : '?'}embed=1`;
  }

  // Fallback: retorna a URL original
  return u;
}

function abrirModalMidia(url, tipo) {
  _injetarEstiloModalMidia();
  let modal = document.getElementById('rs-midia-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'rs-midia-modal';
    modal.className = 'rs-midia-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="rs-midia-modal-box">
        <div class="rs-midia-modal-header">
          <span class="rs-midia-modal-titulo" id="rs-midia-modal-titulo-txt">Mídia</span>
          <button class="rs-midia-modal-fechar" onclick="fecharModalMidia()" aria-label="Fechar">✕</button>
        </div>
        <div class="rs-midia-modal-conteudo" id="rs-midia-conteudo"></div>
      </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) fecharModalMidia(); });
    document.body.appendChild(modal);
  }

  const tituloEl = document.getElementById('rs-midia-modal-titulo-txt');
  const container = document.getElementById('rs-midia-conteudo');

  const titulos = { video: '📺 Vídeo explicativo', infografico: '📊 Infográfico da edição', audio: '🎧 Podcast' };
  tituloEl.textContent = titulos[tipo] || 'Mídia da edição';

  // 🔁 Converte URL para formato embed
  const urlEmbed = _converterEmbedUrl(url, tipo);
  const urlLimpa = urlEmbed.split('?')[0].split('#')[0];
  const ext = urlLimpa.split('.').pop().toLowerCase();

  const isVideo = /\.(mp4|webm|ogg)(\?.*)?$/i.test(urlEmbed);
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext);
  const isPdf = ext === 'pdf';

  // HTML base com fallback embutido
  const criarFallback = (msg) => `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:20px;text-align:center;color:var(--rs-muted)">
      <div style="font-size:32px;margin-bottom:12px">⚠️</div>
      <p style="font-size:13px;line-height:1.6;margin-bottom:16px">${msg}</p>
      <a href="${_esc(url)}" target="_blank" rel="noopener noreferrer" 
         style="padding:8px 16px;background:var(--azul);color:#fff;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none">
        📥 Abrir em nova aba
      </a>
    </div>`;

  if (isVideo) {
    container.innerHTML = `<video src="${_esc(urlEmbed)}" controls autoplay playsinline onerror="this.parentElement.innerHTML='${criarFallback('Não foi possível carregar o vídeo.')}';"></video>`;
  } else if (isImage) {
    container.innerHTML = `<img src="${_esc(urlEmbed)}" alt="Infográfico" onerror="this.parentElement.innerHTML='${criarFallback('Não foi possível carregar a imagem.')}';">`;
  } else if (isPdf) {
    container.innerHTML = `<iframe src="${_esc(urlEmbed)}" style="background:#fff;" onload="this.onerror=null" onerror="this.parentElement.innerHTML='${criarFallback('Este PDF não permite visualização interna.')}';"></iframe>`;
  } else {
    // Iframe genérico com fallback para erro 403/CORS
    container.innerHTML = `
      <iframe src="${_esc(urlEmbed)}" 
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture" 
              allowfullscreen 
              style="width:100%;height:100%;border:none;background:#fff;"
              onload="this.dataset.loaded='1'"
              onerror="this.parentElement.innerHTML='${criarFallback('Este conteúdo não pode ser exibido dentro do app.')}';">
      </iframe>
      <script>
        // Fallback adicional: se o iframe carregar mas estiver vazio/bloqueado (ex: X-Frame-Options)
        setTimeout(() => {
          const iframe = document.querySelector('#rs-midia-conteudo iframe');
          if (iframe && iframe.dataset.loaded !== '1') {
            try {
              // Tenta acessar contentDocument — se falhar, é bloqueio de origem
              if (!iframe.contentDocument) throw new Error('blocked');
            } catch(e) {
              iframe.parentElement.innerHTML = '${criarFallback('Este conteúdo bloqueia visualização interna.')}';
            }
          }
        }, 3000);
      <\/script>`;
  }

  requestAnimationFrame(() => {
    modal.classList.add('aberto');
    document.body.style.overflow = 'hidden';
  });
}

function fecharModalMidia() {
  const modal = document.getElementById('rs-midia-modal');
  if (!modal) return;
  modal.classList.remove('aberto');
  setTimeout(() => {
    document.getElementById('rs-midia-conteudo').innerHTML = '';
    document.body.style.overflow = '';
  }, 200);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModalMidia(); });

// ─── Mídia ────────────────────────────────────────────────────────────────────
function renderMidia(newsletter, acesso) {
  const secao = document.getElementById('secao-midia');
  const wrap = document.getElementById('midia-conteudo');
  if (!secao || !wrap) return;

  const itens = [];

  // ── Helper para criar cards padronizados ──────────────────────────────
  const criarCard = ({ icone, label, titulo, sub, btnHtml, bloqueado = false }) => {
    const classeBloq = bloqueado ? ' rs-media-card-bloqueado' : '';
    return `
      <div class="rs-media-card${classeBloq}">
        <div class="rs-media-card-icone">${icone}</div>
        <div class="rs-media-card-info">
          <span class="rs-media-card-label">${label}</span>
          <span class="rs-media-card-titulo">${titulo}</span>
          <span class="rs-media-card-sub">${sub}</span>
        </div>
        ${btnHtml}
      </div>`;
  };

  // ── Áudio ─────────────────────────────────────────────────────────────
  if (newsletter.audio_url) {
    if (acesso.temAudio) {
      itens.push(criarCard({
        icone: '🎧',
        label: 'Podcast',
        titulo: 'Podcast desta edição',
        sub: 'Ouça no trabalho, no trânsito ou em casa.',
        btnHtml: `
          <div class="rs-media-card-audio">
            <button class="rs-media-card-btn" 
                    onclick="validarETocarAudio('${_esc(newsletter.audio_url)}', this)"
                    type="button">
              ▶ Ouvir podcast
            </button>
          </div>`
      }));
    } else {
      itens.push(criarCard({
        icone: '🎧',
        label: 'Podcast',
        titulo: 'Podcast desta edição',
        sub: 'Disponível no plano Essence ou superior',
        bloqueado: true,
        btnHtml: `
          <button class="rs-media-card-btn rs-media-card-btn-lock"
                  onclick="_solicitarUpgrade('audio', ${acesso.isAssinante})"
                  type="button">🔒 Desbloquear</button>`
      }));
    }
  }

  // ── Vídeo ─────────────────────────────────────────────────────────────
  if (newsletter.video_url) {
    itens.push(criarCard({
      icone: '📺',
      label: 'Vídeo',
      titulo: 'Vídeo explicativo',
      sub: 'Análise detalhada em vídeo',
      bloqueado: !acesso.temVideo,
      btnHtml: acesso.temVideo
        ? `<button class="rs-media-card-btn" onclick="validarEabrirMidia('${_esc(newsletter.video_url)}', 'video')" type="button">Assistir →</button>`
        : `<button class="rs-media-card-btn rs-media-card-btn-lock" onclick="_solicitarUpgrade('video', ${acesso.isAssinante})" type="button">🔒 Desbloquear</button>`
    }));
  }

  // ── Infográfico ───────────────────────────────────────────────────────
  if (newsletter.infografico_url) {
    itens.push(criarCard({
      icone: '📊',
      label: 'Infográfico',
      titulo: 'Infográfico da edição',
      sub: 'Visualização gráfica do conteúdo desta edição',
      bloqueado: !acesso.temInfografico,
      btnHtml: acesso.temInfografico
        ? `<button class="rs-media-card-btn" onclick="validarEabrirMidia('${_esc(newsletter.infografico_url)}', 'infografico')" type="button">Ver →</button>`
        : `<button class="rs-media-card-btn rs-media-card-btn-lock" onclick="_solicitarUpgrade('infografico', ${acesso.isAssinante})" type="button">🔒 Desbloquear</button>`
    }));
  }

  // ── Mapa Mental ──────────────────────────────────────────────────────
  if (newsletter.mapa_mental?.ativo) {
    if (acesso.temMapaMental) {
      itens.push('__MAPA_MENTAL__');
    } else {
      itens.push(criarCard({
        icone: '🗺️',
        label: 'Mapa Mental',
        titulo: 'Mapa Mental da edição',
        sub: 'Disponível no plano Profissional ou superior',
        bloqueado: true,
        btnHtml: `<button class="rs-media-card-btn rs-media-card-btn-lock" onclick="_solicitarUpgrade('mapa_mental', ${acesso.isAssinante})" type="button">🔒 Desbloquear</button>`
      }));
    }
  }

  // ── Renderização ──────────────────────────────────────────────────────
  if (itens.length) {
    secao.style.display = 'block';
    const itensSemMapa = itens.filter(i => i !== '__MAPA_MENTAL__');
    wrap.innerHTML = itensSemMapa.join('');

    if (itens.includes('__MAPA_MENTAL__') &&
      typeof window.MapaMentalManager?.init === 'function') {
      window.MapaMentalManager.init(newsletter, acesso);
    }
  } else {
    secao.style.display = 'none';
    wrap.innerHTML = '';
  }
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

function renderFAQ(newsletter, acesso) {
  const secao = document.getElementById('secao-faq');
  const wrap = document.getElementById('faq-conteudo');
  const faq = newsletter.faq || [];
  if (!secao || !wrap) return;

  // Sem FAQ nesta edição — limpa para não herdar conteúdo de edição anterior
  if (!faq.length) {
    secao.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }

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

  // Limpa imediatamente para não exibir reação de edição anterior enquanto carrega
  wrap.innerHTML = '<div style="opacity:.35;font-size:12px;color:var(--rs-muted);padding:8px 0">Carregando avaliação…</div>';
  const fbWrap = document.getElementById('rs-feedback-wrap');
  if (fbWrap) fbWrap.innerHTML = '';

  let minha = null;

  try {
    await db.collection('newsletters').doc(nid).get(); // mantém listener ativo
    // Chave inclui nid + uid para isolar voto por edição e por usuário
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

  // Registra esta chamada como a "ativa" para evitar que closures antigas votem
  const _rxToken = nid + '_' + (uid || 'anon');
  renderReactions._tokenAtivo = _rxToken;

  window.votar = async (newsletterId, userId, key) => {
    // Guard: ignora clique se já foi carregada uma edição mais recente
    if (renderReactions._tokenAtivo !== newsletterId + '_' + (userId || 'anon')) return;

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

// ─── Modal de Boas-Vindas: Links dos Grupos WhatsApp ────────────────────────
// Exibido quando links_grupos_ativos === false no Firestore
async function verificarEExibirLinksGrupos(uid, assinaturaId) {
  try {
    // Busca documento da assinatura
    const assinSnap = await db.collection('usuarios')
      .doc(uid)
      .collection('assinaturas')
      .doc(assinaturaId)
      .get();

    if (!assinSnap.exists) return;

    const assinData = assinSnap.data();

    // ✅ Verifica flag diretamente na raiz
    if (assinData.links_grupos_ativos !== false) return;

    // ✅ Busca config pública (cacheada)
    const config = await _getConfigPublica();

    // Segmentação por feature
    const features = assinData.features_snapshot || assinData.features || {};
    const temAlertasPrioritarios = features.alertas_prioritarios === true;

    // Usa config da API em vez de process.env
    const linkAvisos = config.NEXT_PUBLIC_WA_GRUPO_AVISOS_LINK;
    const linkAlertas = temAlertasPrioritarios
      ? config.NEXT_PUBLIC_WA_GRUPO_ALERTAS_LINK
      : null;

    if (!linkAvisos) return; // Sem links configurados → não exibe modal

    // Detecta dispositivo para instrução contextual
    const isMobile = /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent);

    // Cria modal
    const overlay = document.createElement('div');
    overlay.id = 'rs-modal-grupos-wa';
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(15,23,42,0.85); 
      z-index:9999; display:flex; align-items:center; justify-content:center;
      padding:16px; animation:rsFadeIn .2s ease;
    `;

    overlay.innerHTML = `
      <div style="background:var(--rs-card,#fff); border-radius:16px; max-width:420px; width:100%; padding:24px; box-shadow:0 12px 40px rgba(0,0,0,0.35); position:relative;">
        <button onclick="_fecharModalGruposWA()" 
                style="position:absolute; top:12px; right:12px; background:none; border:none; color:var(--rs-muted,#94a3b8); font-size:20px; cursor:pointer; padding:4px; border-radius:6px;"
                aria-label="Fechar">✕</button>
        
        <div style="text-align:center; margin-bottom:20px;">
          <div style="width:56px; height:56px; border-radius:50%; background:linear-gradient(135deg,#25D366,#128C7E); display:flex; align-items:center; justify-content:center; margin:0 auto 12px; font-size:24px; color:#fff; box-shadow:0 4px 14px rgba(37,211,102,0.4);">🟢</div>
          <h3 style="margin:0 0 4px; color:var(--rs-texto,#0f172a); font-size:17px;">Bem-vindo à comunidade Radar SIOPE!</h3>
          <p style="margin:0; color:var(--rs-muted,#64748b); font-size:13px;">Entre nos grupos para receber atualizações e alertas.</p>
        </div>
        
        <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:20px;">
          <!-- Grupo Avisos (sempre) -->
          <a href="${linkAvisos}" target="_blank" rel="noopener noreferrer"
             onclick="_registrarAcessoGrupo('avisos')"
             style="display:flex; align-items:center; gap:12px; padding:14px 16px; background:var(--rs-borda,#f1f5f9); border-radius:12px; text-decoration:none; color:var(--rs-texto,#0f172a); border:2px solid transparent; transition:all .15s;"
             onmouseover="this.style.borderColor='var(--azul,#0A3D62)'; this.style.background='var(--rs-card,#fff)'"
             onmouseout="this.style.borderColor='transparent'; this.style.background='var(--rs-borda,#f1f5f9)'">
            <span style="font-size:22px;">📢</span>
            <div style="flex:1;">
              <div style="font-weight:600; font-size:14px;">Grupo Avisos</div>
              <div style="font-size:12px; color:var(--rs-muted,#64748b);">Comunicados gerais e novidades</div>
            </div>
            <span style="font-size:18px; color:var(--azul,#0A3D62);">→</span>
          </a>
          
          <!-- Grupo Alertas (apenas com feature) -->
          ${linkAlertas ? `
          <a href="${linkAlertas}" target="_blank" rel="noopener noreferrer"
             onclick="_registrarAcessoGrupo('alertas')"
             style="display:flex; align-items:center; gap:12px; padding:14px 16px; background:var(--rs-borda,#f1f5f9); border-radius:12px; text-decoration:none; color:var(--rs-texto,#0f172a); border:2px solid transparent; transition:all .15s;"
             onmouseover="this.style.borderColor='var(--azul,#0A3D62)'; this.style.background='var(--rs-card,#fff)'"
             onmouseout="this.style.borderColor='transparent'; this.style.background='var(--rs-borda,#f1f5f9)'">
            <span style="font-size:22px;">🔔</span>
            <div style="flex:1;">
              <div style="font-weight:600; font-size:14px;">Grupo Alertas</div>
              <div style="font-size:12px; color:var(--rs-muted,#64748b);">Alertas prioritários exclusivos</div>
            </div>
            <span style="font-size:18px; color:var(--azul,#0A3D62);">→</span>
          </a>` : ''}
        </div>
        
        <!-- Instruções por dispositivo -->
        <div style="background:var(--rs-bg,#f8fafc); border-radius:10px; padding:12px 14px; margin-bottom:20px; font-size:12px; color:var(--rs-muted,#64748b); line-height:1.5;">
          ${isMobile
        ? '📱 <strong>No celular:</strong> Os links abrirão diretamente no WhatsApp.'
        : '💻 <strong>No computador:</strong> Os links abrirão o WhatsApp Web. Certifique-se de estar logado.'}
          ${!isMobile ? '<br><small>Se não abrir, verifique se o WhatsApp Web está ativo em <a href="https://web.whatsapp.com" target="_blank" style="color:var(--azul);">web.whatsapp.com</a>.</small>' : ''}
        </div>
        
        <button onclick="_fecharModalGruposWA()"
                style="width:100%; padding:12px; background:var(--azul,#0A3D62); color:#fff; border:none; border-radius:10px; font-size:14px; font-weight:600; cursor:pointer; transition:background .15s;"
                onmouseover="this.style.background='#0d4f7c'"
                onmouseout="this.style.background='var(--azul,#0A3D62)'">
          ✅ Já entrei nos grupos
        </button>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Fecha com ESC
    const onKey = (e) => { if (e.key === 'Escape') _fecharModalGruposWA(); };
    document.addEventListener('keydown', onKey);
    overlay.dataset.onKeyHandler = '1';

  } catch (err) {
    console.warn('[verNL] Erro ao exibir modal de grupos:', err);
  }
}

function _fecharModalGruposWA() {
  // Remove modal
  const overlay = document.getElementById('rs-modal-grupos-wa');
  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 200);
  }

  // Restaura scroll
  document.body.style.overflow = '';

  // Marca como visualizado no Firestore
  _marcarLinksVisualizados();
}

async function _marcarLinksVisualizados() {
  try {
    const ctx = window._radarUser;
    if (!ctx?.uid || !ctx.assinaturaId) return;

    const assinRef = db.collection('usuarios')
      .doc(ctx.uid)
      .collection('assinaturas')
      .doc(ctx.assinaturaId);

    // Atualiza flag diretamente na raiz
    await assinRef.update({ links_grupos_ativos: true });
  } catch (err) {
    console.warn('[verNL] Falha ao marcar links como visualizados:', err);
  }
}

function _registrarAcessoGrupo(grupo) {
  // Registro local para analytics (opcional)
  //console.log(`[WA] Usuário acessou grupo: ${grupo}`);
}

// Expor funções globalmente
window._fecharModalGruposWA = _fecharModalGruposWA;

// ─── _radarUser para OneSignal ────────────────────────────────────────────────

function publicarRadarUser(destinatario, segmento, assinaturaId) {
  const isAssinante = segmento === 'assinantes';
  const uid = isAssinante ? (destinatario._uid || null) : String(destinatario.id || '');

  window._radarUser = {
    uid,
    email: destinatario.email || '',
    nome: destinatario.nome || '',
    segmento: isAssinante ? 'assinante' : 'lead',
    plano_slug: destinatario.plano_slug || null,
    features: destinatario.features || {},
    uf: destinatario.cod_uf || '',
    municipio_cod: destinatario.cod_municipio || '',
    municipio_nome: destinatario.nome_municipio || '',
    perfil: destinatario.perfil || '',
    assinaturaId: assinaturaId || null,
  };

  window.dispatchEvent(new Event('radarUserReady'));

  // 🔐 SALVAR COM MERGE: preserva propriedades existentes (ex: municipios_plano)
  try {
    const sessaoExistente = JSON.parse(localStorage.getItem('rs_pwa_session') || '{}');
    const novaSessao = {
      ...sessaoExistente, // ← mantém dados antigos
      uid,
      assinaturaId: assinaturaId || null,
      segmento: isAssinante ? 'assinante' : 'lead',
      // Atualiza apenas os campos que realmente mudaram
      ...(destinatario.plano_slug && { plano_slug: destinatario.plano_slug }),
      ...(destinatario.features && { features: destinatario.features }),
      ...(destinatario.cod_uf && { cod_uf: destinatario.cod_uf }),
      ...(destinatario.cod_municipio && { cod_municipio: destinatario.cod_municipio }),
      ...(destinatario.nome_municipio && { nome_municipio: destinatario.nome_municipio }),
      ...(destinatario.perfil && { perfil: destinatario.perfil }),
    };
    localStorage.setItem('rs_pwa_session', JSON.stringify(novaSessao));
  } catch (e) { /* ignora se localStorage bloqueado */ }
}

// ─── Buscar newsletter pelo número (URL limpa) ────────────────────────────────

async function buscarPorNumero(numero) {
  const snap = await db.collection('newsletters')
    .where('numero', '==', String(numero)).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ─── Lógica Centralizada de Segurança de Sessão ────────────────────────────
// Cache para evitar múltiplas chamadas à API em cliques rápidos (janela de 1 min)
let _validacaoCriticaCache = { ts: 0, status: true };

// Invalida cache ao voltar a aba (para testes e produção)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    _validacaoCriticaCache.ts = 0; // Força revalidação
  }
});

async function _checarSessaoCritica() {

  // Lead com acesso pro temporário: verificação de sessão de assinante não se aplica
  if (window._leadAcessoProTemp === true) return true;

  // Se sessão já foi bloqueada nesta aba, exibe sheet e nega acesso direto
  if (_sessaoBloqueada) {
    _mostrarSheetSessaoBloqueada('sessao_invalida');
    return false;
  }

  // 🔒 Cache reduzido para 30s (segurança > performance)
  if (Date.now() - _validacaoCriticaCache.ts < 30 * 1000) {
    return _validacaoCriticaCache.status;
  }

  try {
    const sess = JSON.parse(localStorage.getItem('rs_pwa_session') || '{}');
    if (!sess?.uid) return false;

    // session_id: usa sessionStorage (tab-isolated) — evita que outra aba sobrescreva
    const session_id = sessionStorage.getItem('rs_tab_session_id') || sess.session_id;
    if (!session_id) return false;

    const resp = await fetch('/api/pagamentoMP?acao=validar-sessao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: sess.uid, session_id }),
    });

    const data = await resp.json().catch(() => ({}));

    // Se a API retornou inválido ou erro de resposta
    if (!resp.ok || !data.valido) {
      _bloquearAcessoPorSessaoInativa(data.motivo || 'Sessão inválida ou desativada.');
      _validacaoCriticaCache = { ts: Date.now(), status: false };
      return false;
    }

    // ✅ Sucesso: atualiza local e cache
    sess.validado_em = Date.now();
    localStorage.setItem('rs_pwa_session', JSON.stringify(sess));
    _validacaoCriticaCache = { ts: Date.now(), status: true };
    return true;

  } catch (e) {
    console.warn('[🛡️ Sessão] Falha na validação (offline/erro):', e.message);
    return true; // Benefício da dúvida em caso de instabilidade de rede
  }
}

// ─── Validação + Reprodução de Áudio (Ponto Crítico) ───────────────────────
async function validarETocarAudio(url, btn) {
  // 🔒 Valida sessão antes de liberar o player
  if (await _checarSessaoCritica()) {
    const wrap = btn.parentElement;
    btn.style.display = 'none'; // Esconde botão

    // Injeta player nativo dinamicamente
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = url;
    audio.preload = 'metadata';
    audio.style.cssText = 'width:100%;border-radius:8px;outline:none;';
    wrap.appendChild(audio);

    // Tenta iniciar reprodução automaticamente após validação
    try { await audio.play(); } catch (e) { /* autoplay bloqueado pelo browser, usuário clica manualmente */ }
  }
}
window.validarETocarAudio = validarETocarAudio; // Expõe para o onclick inline

// Flag global: impede pontos críticos de executarem sem destruir o DOM
let _sessaoBloqueada = false;

function _bloquearAcessoPorSessaoInativa(motivo) {
  _sessaoBloqueada = true;
  // NÃO limpa localStorage nem destrói o DOM —
  // o conteúdo já carregado permanece legível.
  _mostrarSheetSessaoBloqueada(motivo);
}

function _mostrarSheetSessaoBloqueada(motivo) {
  document.getElementById('rs-sheet-sessao')?.remove();

  const isInativa = motivo === 'assinatura_inativa';

  const sheet = document.createElement('div');
  sheet.id = 'rs-sheet-sessao';
  // backdrop + caixa centralizada
  sheet.style.cssText = [
    'position:fixed;inset:0;z-index:9980',
    'display:flex;align-items:center;justify-content:center',
    'background:rgba(15,23,42,.55);backdrop-filter:blur(2px)',
    'animation:rsFadeIn .2s ease;padding:16px;box-sizing:border-box',
  ].join(';');

  sheet.innerHTML = `
    <div style="background:var(--rs-card,#fff);border-radius:16px;
                padding:28px 24px 24px;width:100%;max-width:380px;
                box-shadow:0 8px 32px rgba(0,0,0,.2);
                animation:rsScaleIn .2s cubic-bezier(.34,1.56,.64,1);
                text-align:center">
      <div style="font-size:32px;margin-bottom:12px">${isInativa ? '⚠️' : '📱'}</div>
      <h3 style="margin:0 0 10px;font-size:16px;font-weight:700;
                 color:var(--rs-texto,#0f172a)">
        ${isInativa ? 'Assinatura encerrada' : 'Sessão desativada'}
      </h3>
      <p style="margin:0 0 22px;font-size:13px;line-height:1.7;
                color:var(--rs-muted,#64748b)">
        ${isInativa
      ? 'Sua assinatura foi encerrada. Entre em contato com o suporte para reativar.'
      : 'Você abriu o Radar SIOPE em muitos dispositivos simultaneamente e esta sessão foi desativada.<br><br>Para retomar o acesso completo, abra o link recebido por e-mail.'}
      </p>
      ${isInativa
      ? `<a href="/contato.html" target="_blank" rel="noopener"
              style="display:block;padding:13px;background:var(--azul,#0A3D62);
                     color:#fff;border-radius:10px;font-size:14px;font-weight:700;
                     text-decoration:none;margin-bottom:10px">
             Falar com o suporte →
           </a>`
      : `<button onclick="_abrirEmailAcesso()"
                  style="display:block;width:100%;padding:13px;
                         background:var(--azul,#0A3D62);color:#fff;border-radius:10px;
                         font-size:14px;font-weight:700;border:none;cursor:pointer;
                         margin-bottom:10px">
             📧 Abrir meu e-mail para novo acesso
           </button>`}
      <button onclick="_fecharSheetSessao()"
              style="display:block;width:100%;padding:11px;
                     background:transparent;color:var(--rs-muted,#64748b);
                     border:1px solid var(--rs-borda,#e2e8f0);border-radius:10px;
                     font-size:13px;cursor:pointer">
        Continuar lendo sem recursos premium
      </button>
    </div>`;

  sheet.addEventListener('click', e => { if (e.target === sheet) _fecharSheetSessao(); });
  document.body.appendChild(sheet);
  document.body.style.overflow = 'hidden';
}

function _fecharSheetSessao() {
  const sheet = document.getElementById('rs-sheet-sessao');
  if (!sheet) return;
  sheet.style.opacity = '0';
  sheet.style.transition = 'opacity .2s';
  setTimeout(() => { sheet.remove(); document.body.style.overflow = ''; }, 200);
}

function _abrirEmailAcesso(e) {
  e.preventDefault();
  // Tenta abrir o cliente de e-mail na caixa de entrada (sem compor e-mail novo)
  // Fallback útil: abre a aba de e-mail para o usuário encontrar o link do Radar
  window.open('https://mail.google.com', '_blank');
  // Para outros clientes, deixa o mailto como href padrão
}

window._fecharSheetSessao = _fecharSheetSessao;
window._abrirEmailAcesso = _abrirEmailAcesso;

// ─── Validação de sessão em background (uma vez a cada 4h) ───────────────
async function _validarSessaoBackground(sessao) {
  if (!sessao?.session_id || !sessao?.uid) return;
  // ⏱️ Reduzido de 24h para 4h
  const INTERVALO = 4 * 60 * 60 * 1000;
  if (Date.now() - (sessao.validado_em || 0) < INTERVALO) return;

  try {
    const resp = await fetch('/api/pagamentoMP?acao=validar-sessao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: sessao.uid, session_id: sessao.session_id }),
    });

    if (!resp.ok && resp.status >= 500) return; // Erro de servidor ignora

    const data = await resp.json().catch(() => null);
    if (!data) return;

    if (!data.valido) {
      // ⛔ Invalidação silenciosa (background)
      _bloquearAcessoPorSessaoInativa(data.motivo);
      return;
    }

    // Atualiza dados da sessão (plano/features)
    const sessaoAtualizada = { ...sessao, validado_em: Date.now(), ...(data.plano_slug && { plano_slug: data.plano_slug }), ...(data.features && { features: data.features }) };
    localStorage.setItem('rs_pwa_session', JSON.stringify(sessaoAtualizada));
  } catch (e) {
    console.warn('[verNL] Validação background offline:', e.message);
  }
}

// ─── Modo Assinante (sessão salva, sem parâmetros de URL) ─────────────────
// Carrega a edição mais recente para assinantes que chegam via PWA/ícone.
async function _tentarModoAssinante(dadosSessao) {
  try {
    const sessao = dadosSessao || (() => {
      try { return JSON.parse(localStorage.getItem('rs_pwa_session')); } catch { return null; }
    })();
    if (!sessao || sessao.segmento !== 'assinante' || !sessao.uid) return false;

    // 🔒 BLOQUEANTE: Valida sessão antes de renderizar qualquer coisa
    // Inicializa session_id no sessionStorage (tab-isolated) antes de validar
    if (sessao.session_id) {
      try { sessionStorage.setItem('rs_tab_session_id', sessao.session_id); } catch (e) { }
    }
    if (!(await _checarSessaoCritica())) return false;

    // Inicia validação em background (silenciosa para atualizar features)
    _validarSessaoBackground(sessao);

    // Monta destinatário a partir da sessão local
    const destinatario = {
      _uid: sessao.uid,
      nome: sessao.nome || '',
      email: sessao.email || '',
      plano_slug: sessao.plano_slug || null,
      features: sessao.features || {},
      cod_uf: sessao.cod_uf || '',
      cod_municipio: sessao.cod_municipio || '',
      nome_municipio: sessao.nome_municipio || '',
      perfil: sessao.perfil || '',
    };

    publicarRadarUser(destinatario, 'assinantes', sessao.assinaturaId);

    // Busca edição mais recente publicada
    const snap = await db.collection('newsletters')
      .where('enviada', '==', true)
      .orderBy('data_publicacao', 'desc')
      .limit(1)
      .get();

    if (snap.empty) {
      // Nenhuma edição publicada ainda → exibe app sem edição
      _exibirAppSemEdicao(destinatario, sessao.assinaturaId);
      return true;
    }

    const newsletter = { id: snap.docs[0].id, ...snap.docs[0].data() };
    const nid = newsletter.id;
    const segmento = 'assinantes';

    // Acesso sem envio — objeto mínimo (token não necessário para assinante via sessão)
    const envioMinimo = { token_acesso: null, expira_em: null };
    const acesso = detectarAcesso(destinatario, newsletter, segmento, envioMinimo);

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

    renderHeader(newsletter, destinatario);
    const modoPadrao = sessionStorage.getItem('rs_modo_leitura') || acesso.modoPadrao;
    trocarModo(modoPadrao);
    renderModoRapido(newsletter, acesso);
    await renderModoCompleto(newsletter, dados, segmento, acesso);
    renderMunicipio(destinatario, acesso, newsletter);
    renderMidia(newsletter, acesso);
    renderFAQ(newsletter, acesso);
    await renderReactions(nid, sessao.uid);
    renderCTA(acesso, newsletter);
    renderWatermark(destinatario, newsletter);

    mostrarApp();

    if (typeof window.QuizManager?.init === 'function') {
      // Aguarda próximo tick para garantir que _radarUser está disponível
      setTimeout(() => {
        const user = window._radarUser;
        if (user && newsletter) {
          window.QuizManager.init(newsletter, user);
        }
      }, 0);
    }

    iniciarChatFAB(newsletter, sessao.uid, acesso);
    iniciarDrawer(newsletter);
    verificarEdicaoMaisRecente(newsletter);

    return true;

  } catch (err) {
    console.error('[verNL] Erro no modo assinante:', err);
    return false;
  }
}

// ─── Exibe app sem edição (usado quando nenhuma edição existe ainda) ───────
function _exibirAppSemEdicao(destinatario, assinaturaId) {
  publicarRadarUser(destinatario, 'assinantes', assinaturaId);

  const nome = (destinatario.nome || '').split(' ')[0];
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('hd-saudacao', nome ? `Olá, ${nome}!` : '');
  set('hd-titulo', 'Radar SIOPE');
  set('hd-edicao', '');
  set('hd-data', '');
  document.title = 'Radar SIOPE';

  ['rs-toggle-modo', 'modo-rapido', 'modo-completo', 'secao-midia',
    'secao-faq', 'rs-banner-recente', 'rs-watermark', 'rs-cta-wrap'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

  const munConteudo = document.getElementById('municipio-conteudo');
  if (munConteudo) {
    munConteudo.innerHTML = `
      <div style="padding:20px;text-align:center;color:var(--rs-muted)">
        <div style="font-size:28px;margin-bottom:8px">📬</div>
        <div style="font-size:13px;line-height:1.6">
          Selecione uma edição em <strong>📚 Edições</strong> para começar a leitura,<br>
          ou confira seus alertas em <strong>🔔 Sentinela</strong>.
        </div>
      </div>`;
    const btn = document.getElementById('btn-toggle-historico');
    if (btn) btn.style.display = 'none';
  }

  mostrarApp();
  setTimeout(() => {
    document.getElementById('rs-alertas-btn')?.click();
  }, 600);
}

// ─── Aviso de limite de sessões simultâneas ────────────────────────────────
function _mostrarAvisoSessoes() {
  const aviso = document.createElement('div');
  aviso.id = 'rs-aviso-sessoes';
  aviso.style.cssText = [
    'position:fixed;top:0;left:0;right:0;z-index:9999',
    'background:#f59e0b;color:#fff;font-size:13px;font-weight:600',
    'padding:12px 16px;text-align:center;line-height:1.5',
    'box-shadow:0 2px 8px rgba(0,0,0,0.2)',
  ].join(';');
  aviso.innerHTML = `

    A sessão mais antiga foi desativada automaticamente.
    <button onclick="document.getElementById('rs-aviso-sessoes').remove()"
      style="margin-left:12px;background:rgba(255,255,255,0.3);border:none;
             color:#fff;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:12px">
      OK
    </button>`;
  document.body.appendChild(aviso);
  setTimeout(() => document.getElementById('rs-aviso-sessoes')?.remove(), 8000);
}

// ─── Ativação de sessão via link pós-pagamento (?ativar=TOKEN&uid=UID) ─────
async function _executarAtivacaoSessao(token, uid) {
  mostrarLoading(true);
  try {
    const resp = await fetch('/api/pagamentoMP?acao=ativar-sessao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, session_token: token }),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok || !data.ok) {
      mostrarErro(
        '<strong>Link de ativação inválido ou expirado.</strong>',
        (data.message || '') + ' Entre em contato com o suporte se o problema persistir.'
      );
      return;
    }

    // Substitui qualquer sessão anterior (inclusive sessão de lead) pela de assinante
    try {
      localStorage.setItem('rs_pwa_session', JSON.stringify({
        uid: data.uid,
        assinaturaId: data.assinaturaId,
        segmento: 'assinante',
        session_id: data.session_id,
        plano_slug: data.plano_slug,
        features: data.features,
        nome: data.nome,
        email: data.email,
        cod_uf: data.cod_uf,
        cod_municipio: data.cod_municipio,
        nome_municipio: data.nome_municipio,
        perfil: data.tipo_perfil,
        municipios_plano: data.municipios_plano || [],
        validado_em: Date.now(),
      }));
    } catch (e) { /* ignora se localStorage bloqueado */ }

    // Grava session_id isolado por aba (sessionStorage é tab-specific)
    try { sessionStorage.setItem('rs_tab_session_id', data.session_id); } catch (e) { }

    // Limpa os parâmetros da URL sem recarregar (URL fica limpa após ativação)
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('ativar');
      url.searchParams.delete('uid');
      window.history.replaceState({}, '', url.toString());
    } catch (e) { /* ignora */ }

    if (data.aviso_limite_sessoes) _mostrarAvisoSessoes();

    // Carrega o app com a sessão recém-criada
    await _tentarModoAssinante(data);

  } catch (err) {
    console.error('[verNL] Erro na ativação de sessão:', err);
    mostrarErro('Erro ao ativar sua conta.', 'Verifique sua conexão e tente novamente.');
  }
}

// ─── MODO ALERTA (sem parâmetros de edição) ────────────────────────────────────
// Ativado quando o app é aberto via notificação push sem link de edição específica.
// Carrega usuário da sessão PWA e abre a Central de Mensagens automaticamente.
// A única mudança real é: se sessao.segmento === 'assinante' → delega para
// _tentarModoAssinante em vez de exibir o app sem edição.

async function _tentarModoAlerta() {
  let sessao = null;
  try {
    const raw = localStorage.getItem('rs_pwa_session');
    if (raw) sessao = JSON.parse(raw);
  } catch (e) { /* ignora */ }

  if (!sessao || !sessao.uid) {
    mostrarErro(
      '<strong>Link inválido ou incompleto.</strong>',
      'Verifique o link recebido por WhatsApp ou e-mail.'
    );
    return;
  }

  // ── Assinante com sessão registrada → carrega edição mais recente ────────
  if (sessao.segmento === 'assinante' && sessao.session_id) {
    const ok = await _tentarModoAssinante(sessao);
    if (!ok) {
      // Se o erro de bloqueio já foi exibido (rs-erro visível), não sobrescreve
      const erroBloqueioVisivel = document.getElementById('rs-erro')?.style.display === 'block';
      if (!erroBloqueioVisivel) {
        mostrarErro('Erro ao carregar sua área.', 'Tente novamente em instantes.');
      }
    }
    return;
  }

  // ── Assinante sem session_id (sessão mínima pós-cadastro) ─────────────────
  // Cria sessão no servidor — ele já valida status e retorna mensagem específica.
  if (sessao.segmento === 'assinante' && sessao.assinaturaId) {
    try {
      const _respSessao = await fetch('/api/pagamentoMP?acao=criar-sessao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: sessao.uid, assinaturaId: sessao.assinaturaId }),
      });

      if (!_respSessao.ok) {
        const _errData = await _respSessao.json().catch(() => ({}));
        // 403 = status bloqueado (pendente_pagamento, inativo, etc.)
        mostrarErro(
          '<strong>Acesso indisponível.</strong>',
          _errData.message || 'Entre em contato com o suporte.'
        );
        return;
      }

      const _sessaoNova = await _respSessao.json();
      if (_sessaoNova.ok) {
        const _sessaoCompleta = {
          uid: _sessaoNova.uid,
          assinaturaId: _sessaoNova.assinaturaId,
          segmento: 'assinante',
          session_id: _sessaoNova.session_id,
          plano_slug: _sessaoNova.plano_slug,
          features: _sessaoNova.features,
          municipios_plano: _sessaoNova.municipios_plano || [],
          nome: _sessaoNova.nome,
          email: _sessaoNova.email,
          cod_uf: _sessaoNova.cod_uf,
          cod_municipio: _sessaoNova.cod_municipio,
          nome_municipio: _sessaoNova.nome_municipio,
          perfil: _sessaoNova.perfil,
          validado_em: Date.now(),
        };
        try { localStorage.setItem('rs_pwa_session', JSON.stringify(_sessaoCompleta)); } catch (e) { /* ignora */ }
        if (_sessaoNova.aviso_limite_sessoes) _mostrarAvisoSessoes();
        const ok = await _tentarModoAssinante(_sessaoCompleta);
        if (!ok) mostrarErro('Erro ao carregar sua área.', 'Tente novamente em instantes.');
      } else {
        mostrarErro('<strong>Não foi possível iniciar sua sessão.</strong>', 'Tente novamente em instantes.');
      }
    } catch (err) {
      console.error('[verNL] Erro ao criar sessão (modo alerta):', err);
      mostrarErro('Erro ao carregar seus dados.', err.message);
    }
    return;
  }

  // ── Lead → comportamento original ─────────────────────────────────────────
  try {
    const userSnap = await db.collection('usuarios').doc(sessao.uid).get();
    if (!userSnap.exists) {
      mostrarErro(
        'Sessão expirada.',
        'Acesse pelo link recebido por WhatsApp ou e-mail.'
      );
      return;
    }
    const destinatario = { _uid: userSnap.id, ...userSnap.data() };
    publicarRadarUser(destinatario, 'leads', null);
    _exibirAppSemEdicao(destinatario, null);
  } catch (err) {
    console.error('[verNL] Erro no modo alerta (lead):', err);
    mostrarErro('Erro ao carregar seus dados.', err.message);
  }
}

// ─── FLUXO PRINCIPAL ──────────────────────────────────────────────────────────
// ── Modo Preview ─────────────────────────────────────────────────────────────
async function _executarPreview(params) {
  mostrarLoading(true);

  const nid = params.get('nid');
  const mun = params.get('mun');

  if (!nid) { mostrarErro('Parâmetro nid ausente.'); return; }
  if (!mun) { mostrarErro('Código do município ausente.'); return; }

  try {
    // Busca newsletter
    const snap = await db.collection('newsletters').doc(nid).get();
    if (!snap.exists) { mostrarErro('Edição não encontrada.'); return; }
    const newsletter = { id: snap.id, ...snap.data() };

    // Tenta buscar nome do município via vw_municipio_resumo
    let nomeMun = mun;
    let ufMun = '';
    try {
      const { data: mdata } = await window.supabase
        .from('vw_municipio_resumo')
        .select('uf')
        .eq('cod_municipio', String(mun))
        .limit(1)
        .maybeSingle();
      if (mdata) ufMun = mdata.uf || '';
    } catch (e) { /* não fatal */ }

    // Destinatário simulado — acesso total como assinante profissional
    const destinatario = {
      _uid: 'preview',
      nome: 'Admin (Preview)',
      email: 'preview@radarsiope.com.br',
      cod_municipio: mun,
      cod_uf: ufMun,
      nome_municipio: nomeMun,
      plano_slug: 'profissional',
      features: {
        newsletter_audio: true,
        newsletter_infografico: true,
        newsletter_video: true,
        newsletter_mapa_mental: true,
        alertas_prioritarios: true,
      },
    };

    const segmento = 'assinantes';
    const acesso = detectarAcesso(destinatario, newsletter, segmento, null);
    const dados = {
      nome: destinatario.nome,
      email: destinatario.email,
      edicao: newsletter.numero || newsletter.edicao || '',
      titulo: newsletter.titulo || '',
      data_publicacao: newsletter.data_publicacao || null,
      cod_uf: ufMun,
      nome_municipio: nomeMun,
      perfil: 'preview',
      plano: 'profissional',
    };

    // Pipeline de render — idêntico ao fluxo normal
    renderHeader(newsletter, destinatario);
    trocarModo('completo');
    renderModoRapido(newsletter, acesso);
    await renderModoCompleto(newsletter, dados, segmento, acesso);
    renderMunicipio(destinatario, acesso, newsletter);
    renderMidia(newsletter, acesso);
    renderFAQ(newsletter, acesso);
    await renderReactions(nid, 'preview');
    renderCTA(acesso, newsletter);

    if (window.QuizManager && newsletter?.quiz) {
      const userParaQuiz = {
        uid: destinatario._uid || destinatario.id || uid,
        segmento: segmento,
        plano_slug: destinatario.plano_slug || null,
        features: destinatario.features || {}
      };
      window.QuizManager.init(newsletter, userParaQuiz);
    }

    // Habilita chat para testes internos (mesmo sem token de acesso válido)  
    acesso.temChat = true;

    mostrarApp();

    iniciarChatFAB(newsletter, null, acesso);

    // Banner fixo de preview
    const banner = document.createElement('div');
    banner.style.cssText = `
      position:fixed;top:0;left:0;right:0;z-index:9999;
      background:linear-gradient(135deg,#667eea,#764ba2);
      color:#fff;font-size:13px;font-weight:600;
      padding:10px 16px;display:flex;gap:12px;
      align-items:center;justify-content:space-between;
      box-shadow:0 2px 12px rgba(0,0,0,.2)`;
    banner.innerHTML = `
      <span>
        🔍 Modo Preview
        · Município: <strong>${_esc(mun)}</strong>
        · Edição: <strong>${_esc(newsletter.numero || newsletter.edicao || nid)}</strong>
        · Acesso simulado: assinante profissional
      </span>
      <button onclick="window.close()"
              style="background:rgba(255,255,255,.25);border:none;color:#fff;
                     padding:4px 12px;border-radius:6px;cursor:pointer;
                     font-size:12px;font-weight:700;white-space:nowrap">
        ✕ Fechar
      </button>`;
    document.body.prepend(banner);

    // Empurra o app para não ficar sob o banner
    const app = document.getElementById('rs-app');
    if (app) app.style.paddingTop = '48px';

  } catch (err) {
    mostrarErro('Erro no modo preview.', err.message);
  }
}
// ─────────────────────────────────────────────────────────────────────────────
async function VerNewsletterComToken() {
  const params = getParams();
  // ── Detecta modo preview ─────────────────────────────────
  if (params.get('preview') === '1') {
    await _executarPreview(params);
    return;
  }
  // ─────────────────────────────────────────────────────────

  // Pré-carrega config pública (cache para uso posterior)
  await _getConfigPublica();

  // ── Detecta ativação de sessão pós-pagamento (?ativar=TOKEN&uid=UID) ────
  const _ativarToken = params.get('ativar');
  const _ativarUid = normalizeParam(params.get('uid'));
  if (_ativarToken && _ativarUid) {
    await _executarAtivacaoSessao(_ativarToken, _ativarUid);
    return;
  }

  const d_nid = normalizeParam(params.get('nid'));
  const env = normalizeParam(params.get('env'));
  const uid = normalizeParam(params.get('uid'));
  const token = params.get('token');
  const assinaturaId = normalizeParam(params.get('assinaturaId'));
  const edicaoNum = params.get('edicao_numero');

  // 0. Se o link não tem assinaturaId (link de lead), mas existe uma sessão de
  // assinante ativa no localStorage, o lead virou assinante: ignora o link antigo
  // e carrega com acesso total via sessão.
  if (!assinaturaId) {
    try {
      const _sessaoSalva = JSON.parse(localStorage.getItem('rs_pwa_session') || 'null');
      if (_sessaoSalva?.segmento === 'assinante' && _sessaoSalva?.session_id && _sessaoSalva?.uid) {
        await _tentarModoAssinante(_sessaoSalva);
        return;
      }
    } catch (e) { /* ignora — continua o fluxo normal de lead */ }
  }

  // 1. Validação inicial
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
      // ── Assinante: acesso controlado por status da assinatura (modelo de sessão).
      // Sem validação de envio — token/expiração/contador não se aplicam para assinantes.
      envio = { token_acesso: null, expira_em: null };

      // Bootstrap de sessão: se não há session_id local, cria sessão no servidor.
      // Isso ativa _validarSessaoBackground nos próximos acessos e registra o dispositivo.
      try {
        const _sessaoAtual = (() => {
          try { return JSON.parse(localStorage.getItem('rs_pwa_session')); } catch { return null; }
        })();

        if (!_sessaoAtual?.session_id) {
          // Sem sessão ativa — cria uma nova (o servidor verifica se a assinatura está ativa)
          const _respSessao = await fetch('/api/pagamentoMP?acao=criar-sessao', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid, assinaturaId }),
          });

          if (!_respSessao.ok) {
            const _errData = await _respSessao.json().catch(() => ({}));
            if (_respSessao.status === 403) {
              // 403 = assinatura bloqueada → mensagem específica do servidor
              const _msgErr = _errData.message || 'Para reativar sua assinatura, entre em contato com o suporte.';
              mostrarErro('<strong>Acesso indisponível.</strong>', _msgErr);
              return;
            }
            // 4xx/5xx inesperado: continua sem sessão (benefício da dúvida)
            console.warn('[verNL] Falha ao criar sessão (não fatal):', _errData.message);
          } else {
            const _sessaoNova = await _respSessao.json();
            if (_sessaoNova.ok) {
              try {
                localStorage.setItem('rs_pwa_session', JSON.stringify({
                  uid: _sessaoNova.uid,
                  assinaturaId: _sessaoNova.assinaturaId,
                  segmento: 'assinante',
                  session_id: _sessaoNova.session_id,
                  plano_slug: _sessaoNova.plano_slug,
                  features: _sessaoNova.features,
                  municipios_plano: _sessaoNova.municipios_plano || [],
                  nome: _sessaoNova.nome,
                  email: _sessaoNova.email,
                  cod_uf: _sessaoNova.cod_uf,
                  cod_municipio: _sessaoNova.cod_municipio,
                  nome_municipio: _sessaoNova.nome_municipio,
                  perfil: _sessaoNova.perfil,
                  validado_em: Date.now(),
                }));
              } catch (e) { /* ignora se localStorage bloqueado */ }
              if (_sessaoNova.aviso_limite_sessoes) _mostrarAvisoSessoes();
            }
          }
        } else {
          // Sessão existente com session_id — valida em background (a cada 24h)
          _validarSessaoBackground(_sessaoAtual);
        }
      } catch (e) {
        console.warn('[verNL] Erro no bootstrap de sessão (não fatal):', e.message);
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
          'O link pode ter expirado. <a href="/assinatura.html">Assine agora</a>.');
        return;
      }

      // Validar token
      if (!leRow.token_acesso || leRow.token_acesso !== token) {
        mostrarErro('Acesso negado.', 'Token inválido.'); return;
      }

      // Validar expiração
      if (leRow.expira_em && new Date() > new Date(leRow.expira_em)) {
        mostrarErro('Este link expirou.',
          '<a href="/assinatura.html">Assine agora</a> para continuar tendo acesso.');
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

      // Normaliza para o mesmo formato usado no restante do fluxo.
      // criado_em é a data de envio real — usada para calcular a janela de acesso pro temporário.
      envio = {
        token_acesso: leRow.token_acesso,
        expira_em: leRow.expira_em,
        acessos_totais: novoTotal,
        criado_em: leRow.criado_em || leRow.data_envio || null,
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

          // Verificação de status (novo modelo de controle de acesso para assinantes)
          if (assinaturaData.status !== 'ativa') {
            mostrarErro(
              '<strong>Assinatura inativa.</strong>',
              'Para reativar sua assinatura, entre em contato com o suporte.'
            );
            return;
          }

          // features do usuário tem precedencia, mas se estiverem ausentes, usa o snapshot da assinatura 
          destinatario.features = destinatario.features || assinaturaData.features_snapshot || {};
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

    // Registra acesso pro temporário de lead para uso em _checarSessaoCritica()
    window._leadAcessoProTemp = !assinaturaId && acesso.acessoProTemp;

    // 9. Side effects não bloqueantes
    // registrarClique só se aplica a leads — assinantes usam o sistema de sessão
    if (!assinaturaId) {
      registrarClique(env, uid, nid);
    }
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

    // Avaliação por seção (sem dependência de drawer)
    //await renderSecaoFeedbacks(newsletter);

    // Município em paralelo — não bloqueia o conteúdo principal
    renderMunicipio(destinatario, acesso, newsletter);

    renderMidia(newsletter, acesso);
    renderFAQ(newsletter, acesso);
    await renderReactions(nid, uid);
    renderCTA(acesso, newsletter);
    renderWatermark(destinatario, newsletter);

    // ─── INICIALIZAÇÃO DO QUIZ (após usuário e newsletter carregados) ─────────
    if (window.QuizManager && newsletter?.quiz) {
      const userParaQuiz = {
        uid: destinatario._uid || destinatario.id || uid,
        segmento: segmento,
        plano_slug: destinatario.plano_slug || null,
        features: destinatario.features || {}
      };
      window.QuizManager.init(newsletter, userParaQuiz);
    }

    // 12. Exibe com fade-in
    mostrarApp();

    // verificar links dos grupos no whatsApp (apenas assinantes)
    if (segmento === 'assinantes' && assinaturaId) {
      verificarEExibirLinksGrupos(uid, assinaturaId);
    }

    iniciarAutoMarcarLida(nid, uid);

    iniciarChatFAB(newsletter, uid, acesso);

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
  // 🔒 Validação Crítica antes de carregar dados pesados
  if (!(await _checarSessaoCritica())) return;

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

  // Atualizar botão toggle
  const btn = document.getElementById('btn-toggle-historico');
  if (btn) btn.innerHTML = '🔙 Voltar';

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

    // ── Substitui o gráfico fixo pelo(s) gráfico(s) da vitrine ──
    const vitrineGrafContainer = document.getElementById('vitrine-grafico-historico');
    const SM2 = window.SupabaseMunicipio;
    if (vitrineGrafContainer && dadosMunicipioAtual.vitrine?.length && typeof SM2.renderVitrine === 'function') {
      await SM2.renderVitrine(
        vitrineGrafContainer,
        dadosMunicipioAtual.vitrine,
        dadosMunicipioAtual.cod_municipio,
        false   // sem blur — histórico só aparece para assinante
      );
    }
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
  const btn = document.getElementById('btn-toggle-historico');

  if (historico) historico.style.display = 'none';
  if (resumo) resumo.style.display = 'block';
  if (btn) btn.innerHTML = '📈 Ver série histórica';
}

function toggleHistorico() {
  const historico = document.getElementById('municipio-historico');

  if (historico && historico.style.display === 'block') {
    // Está no histórico, voltar para resumo
    voltarResumo();
  } else {
    // Está no resumo, ir para histórico
    verHistoricoCompleto();
  }
}

// Inicializar listener do botão quando DOM estiver pronto
function initHistoricoButton() {
  const btn = document.getElementById('btn-toggle-historico');
  if (btn) {
    btn.addEventListener('click', toggleHistorico);
  }
}

// Expor funções globalmente
window.verHistoricoCompleto = verHistoricoCompleto;
window.voltarResumo = voltarResumo;
window.toggleHistorico = toggleHistorico;

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
  filtroLidas: 'todas',
  termoBusca: '',
};

async function _getTipos() {
  const snap = await db.collection('tipo_newsletters')
    .where('is_newsletter', '==', true)
    .get();

  return snap.docs.map(d => ({
    id: d.id,
    nome: d.data().nome || d.id,
    icone: d.data().icone || '📰',
  }));
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

// ─── Calendário: painel de tela cheia ─────────────────────────────────────────

function _abrirCalendario() {
  const PAINEL_ID = 'rs-cal-fullscreen';
  let painel = document.getElementById(PAINEL_ID);

  if (!painel) {
    painel = document.createElement('div');
    painel.id = PAINEL_ID;
    painel.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:800',
      'background:var(--rs-bg,#0f172a)',
      'overflow-y:auto',
      'animation:rsFadeIn .2s ease',
      'display:flex', 'flex-direction:column',
    ].join(';');

    const btnFechar = document.createElement('button');
    btnFechar.innerHTML = '← Voltar';
    btnFechar.style.cssText = [
      'position:sticky', 'top:0', 'z-index:10',
      'background:var(--rs-bg,#0f172a)',
      'border:none', 'border-bottom:1px solid #1e293b',
      'color:#94a3b8', 'font-size:13px', 'font-weight:700',
      'padding:14px 16px', 'text-align:left',
      'cursor:pointer', 'font-family:inherit', 'width:100%',
    ].join(';');
    btnFechar.addEventListener('click', () => {
      painel.style.opacity = '0';
      painel.style.transition = 'opacity .2s';
      setTimeout(() => {
        painel.style.opacity = '';
        painel.style.transition = '';
        painel.style.display = 'none';
      }, 200);
    });

    const container = document.createElement('div');
    container.id = 'rs-cal-container';
    container.style.flex = '1';

    painel.appendChild(btnFechar);
    painel.appendChild(container);
    document.body.appendChild(painel);
  } else {
    painel.style.display = 'flex';
  }

  const container = document.getElementById('rs-cal-container');
  if (!container) return;

  // ── Diagnóstico ──────────────────────────────────────────────────────────────
  if (typeof window.renderizarCalendario !== 'function') {
    console.error('[Calendário] window.renderizarCalendario não está disponível.',
      'Verifique se calendario.js está carregado na página.');
    container.innerHTML = `
      <div style="padding:40px 20px;text-align:center;color:#94a3b8">
        <div style="font-size:32px;margin-bottom:12px">⚠️</div>
        <div style="font-size:14px;font-weight:600;color:#f1f5f9;margin-bottom:6px">
          Módulo do calendário não carregado
        </div>
        <div style="font-size:12px;color:#64748b">
          Verifique se calendario.js está incluído na página.<br>
          Consulte o console para detalhes.
        </div>
      </div>`;
    return;
  }

  // ── Monta acesso e edicao ────────────────────────────────────────────────────
  // window._radarUser.features vem do Firestore — precisa ter { calendario: true }
  // para o usuário ter acesso. Sem isso, renderizarCalendario exibe o upgrade prompt.
  const acesso = window._radarUser || {};
  const edicao = {};

  window.renderizarCalendario(container, { acesso, edicao });
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
  window.addEventListener('rs:abrirEdicoes', abrirDrawer);

  window.addEventListener('rs:abrirCalendario', _abrirCalendario);

  // 🔒 Guard de sessão no botão Sentinela (intercepta antes dos handlers do menu)
  document.getElementById('rs-alertas-btn')?.addEventListener('click', async function (e) {
    if (this.dataset.sessaoOk === '1') { this.dataset.sessaoOk = '0'; return; }
    e.preventDefault();
    e.stopImmediatePropagation();
    if (_sessaoBloqueada || !(await _checarSessaoCritica())) return;
    this.dataset.sessaoOk = '1';
    this.click(); // re-dispara com flag de aprovado
  }, true); // capture=true: intercepta antes do handler do menu
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
async function abrirDrawer() {
  // 🔒 Validação Crítica: Se a sessão caiu, não abre o drawer
  if (!(await _checarSessaoCritica())) return;

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
  const _uid = ctx?.uid;
  let edicoesVisiveis;

  if (isAssinante) {
    const filtro = _drawer.filtroLidas || 'todas';
    edicoesVisiveis = edicoes.filter(ed => {
      const lida = _edicaoLida(_uid, ed.id);
      if (filtro === 'lidas') return lida;
      if (filtro === 'nao_lidas') return !lida;
      return true; // 'todas'
    });
  } else {
    edicoesVisiveis = edicoes.filter(ed => {
      const envio = enviosLead[ed.id];
      if (!envio) return false;
      if (envio.expira_em && new Date(envio.expira_em) <= new Date()) return false;
      return true;
    });
  }

  if (isAssinante) {
    // Favoritos sobem para o topo, ordenados por data de favoritamento (mais recente primeiro)
    const _favAtual = _getFavs(_uid);
    edicoesVisiveis.sort((a, b) => {
      const fa = _favAtual[a.id], fb = _favAtual[b.id];
      if (fa && !fb) return -1;
      if (!fa && fb) return 1;
      if (fa && fb) return (fb.ts || 0) - (fa.ts || 0);
      return 0;
    });
    // Filtrar por termo de busca
    const _termo = (_drawer.termoBusca || '').trim().toLowerCase();
    if (_termo) {
      edicoesVisiveis = edicoesVisiveis.filter(ed => {
        const t = (ed.titulo || '').toLowerCase();
        const n = String(ed.numero || ed.edicao || '');
        return t.includes(_termo) || n.includes(_termo);
      });
    }
  }

  // Renderizar cards
  const listaHTML = edicoesVisiveis.map(ed => {
    const isAtual = ed.id === _drawer.edicaoAtual;
    if (isAssinante) {
      return _cardEdicaoAssinante(ed, isAtual, temAcesso, _uid);
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

  const filtroTabs = isAssinante ? _htmlCabecalhoAssinante(_drawer.filtroLidas || 'todas') : '';
  body.innerHTML = `${upSellBanner}${filtroTabs}${listaOuVazio}${rodape}`;

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
function _cardEdicaoAssinante(ed, isAtual, temAcesso, uid) {
  const num = ed.numero || ed.edicao || '';
  const titulo = _esc(ed.titulo || `Edição ${num}`);
  const data = _fmtData(ed.data_publicacao);
  const classeAtual = isAtual ? 'rs-drawer-ed-atual' : '';
  const bloqueado = !temAcesso;
  const lida = _edicaoLida(uid, ed.id);
  const fav = _edicaoFavoritada(uid, ed.id);

  // 🔒 HTML do botão de favorito (consolidado e sem quebras de string)
  const favHtml = `<button 
    data-fav-nid="${_esc(ed.id)}" 
    onclick="event.stopPropagation();toggleFavorito('${_esc(uid || '')}','${_esc(ed.id)}')" 
    type="button" 
    title="${fav ? 'Remover dos favoritos' : 'Favoritar edição'}" 
    style="border:none;background:none;padding:4px 3px;cursor:pointer;font-size:17px;line-height:1;flex-shrink:0;transition:color .2s;color:${fav ? 'var(--amarelo,#F0A500)' : 'var(--rs-muted,#cbd5e1)'};">
    ${fav ? '★' : '☆'}
  </button>`;

  // Indicador visual: ponto azul = não lida, anel vazio = lida
  const dotStyle = `display:inline-block;width:8px;height:8px;border-radius:50%;background:${lida ? 'transparent' : 'var(--azul,#0A3D62)'};border:1.5px solid var(--azul,#0A3D62);flex-shrink:0;margin-top:3px;cursor:pointer;transition:background .2s;`;
  const dotHtml = `<span data-lida-nid="${_esc(ed.id)}" style="${dotStyle}" title="${lida ? 'Marcar como não lida' : 'Marcar como lida'}" onclick="event.stopPropagation();toggleLida('${_esc(uid || '')}','${_esc(ed.id)}')"></span>`;

  if (bloqueado) {
    return `<div class="rs-drawer-ed-card rs-drawer-ed-bloqueado">
      <div class="rs-drawer-ed-info">
        <div class="rs-drawer-ed-titulo">${titulo}</div>
        <div class="rs-drawer-ed-data">${data}${num ? ` · Ed. ${num}` : ''}</div>
      </div>
      <span class="rs-drawer-ed-lock">🔒</span>
    </div>`;
  }

  // 🔑 Retorno consolidado: garante injeção segura de ${favHtml}
  return `<div class="rs-drawer-ed-card-wrap" style="display:flex;align-items:center;gap:4px;padding:2px 4px;overflow:visible;">
    ${dotHtml}
    <button class="rs-drawer-ed-card ${classeAtual}" style="flex:1;margin:0;min-width:0;" onclick="navegarParaEdicao('${_esc(ed.id)}')" type="button">
      <div class="rs-drawer-ed-info">
        <div class="rs-drawer-ed-titulo">${titulo}</div>
        <div class="rs-drawer-ed-data">${data}${num ? ` · Ed. ${num}` : ''}</div>
      </div>
      ${isAtual ? '<span class="rs-drawer-ed-badge-atual">👁 lendo agora</span>' : '<span class="rs-drawer-chevron">›</span>'}
    </button>
    ${favHtml}
  </div>`;
}

// ─── FILTRO no drawer de edições ────────────────────────────────────────────
// Adicionar tabs "Todas | Não lidas | Lidas" no topo do corpo do drawer
// quando o usuário for assinante. Inserir este HTML no início de body.innerHTML
// em abrirTipo(), logo após o upSellBanner e antes da listaOuVazio.
// O estado do filtro ativo fica em _drawer.filtroLidas.

// Adicionar ao objeto _drawer (onde está definido no código original):
//   filtroLidas: 'todas',   // 'todas' | 'nao_lidas' | 'lidas'

// HTML dos tabs (inserir em abrirTipo antes de renderizar os cards):
function _htmlFiltroLidas(filtroAtivo) {
  const tabs = [
    { key: 'todas', label: 'Todas' },
    { key: 'nao_lidas', label: 'Não lidas' },
    { key: 'lidas', label: 'Lidas' },
  ];
  const tabsHtml = tabs.map(t => `
    <button onclick="_setFiltroLidas('${t.key}')"
            style="
              flex:1; padding:6px 0; font-size:11px; font-weight:${t.key === filtroAtivo ? '700' : '500'};
              border:none; cursor:pointer; border-radius:6px;
              background:${t.key === filtroAtivo ? 'var(--azul,#0A3D62)' : 'transparent'};
              color:${t.key === filtroAtivo ? '#fff' : 'var(--rs-muted,#64748b)'};
              transition:all .15s;
            "
            type="button">${t.label}</button>
  `).join('');

  return `
    <div style="display:flex;gap:4px;padding:8px 12px 4px;background:var(--rs-card);
                position:sticky;top:0;z-index:1;border-bottom:1px solid var(--rs-borda,#e2e8f0)">
      ${tabsHtml}
    </div>`;
}

function _setFiltroLidas(filtro) {
  _drawer.filtroLidas = filtro;
  // Re-renderiza o nível 2 com o novo filtro
  if (_drawer.tipoAtivo) {
    abrirTipo(_drawer.tipoAtivo.id, _drawer.tipoAtivo.nome, _drawer.tipoAtivo.icone);
  }
}
window._setFiltroLidas = _setFiltroLidas;

// ─── FAVORITOS ───────────────────────────────────────────────────────────────
function _getFavKey(uid) { return `rs_favs_${uid || 'anon'}`; }

function _getFavs(uid) {
  try { return JSON.parse(localStorage.getItem(_getFavKey(uid)) || '{}'); }
  catch { return {}; }
}

function _salvarFavs(uid, favs) {
  try { localStorage.setItem(_getFavKey(uid), JSON.stringify(favs)); }
  catch { /* ignora se localStorage bloqueado */ }
}

function _edicaoFavoritada(uid, nid) {
  return !!_getFavs(uid)[nid];
}

function toggleFavorito(uid, nid) {
  const favs = _getFavs(uid);
  if (favs[nid]) {
    delete favs[nid];
  } else {
    favs[nid] = { ts: Date.now() };
  }
  _salvarFavs(uid, favs);
  // Re-renderiza o drawer para refletir nova ordenação
  if (_drawer?.aberto && _drawer.nivel === 2 && _drawer.tipoAtivo) {
    abrirTipo(_drawer.tipoAtivo.id, _drawer.tipoAtivo.nome, _drawer.tipoAtivo.icone);
  }
}
window.toggleFavorito = toggleFavorito;

// ─── CABEÇALHO COMBINADO (busca + filtro lidas) ──────────────────────────────
// Substitui _htmlFiltroLidas no nível 2 para assinantes.
// Sticky único evita sobreposição entre dois elementos posicionados.

function _htmlCabecalhoAssinante(filtroAtivo) {
  const val = _esc(_drawer.termoBusca || '');
  const tabs = [
    { key: 'todas', label: 'Todas' },
    { key: 'nao_lidas', label: 'Não lidas' },
    { key: 'lidas', label: 'Lidas' },
  ];
  const tabsHtml = tabs.map(t => `
    <button onclick="_setFiltroLidas('${t.key}')"
            style="flex:1;padding:5px 0;font-size:11px;
                   font-weight:${t.key === filtroAtivo ? '700' : '500'};
                   border:none;cursor:pointer;border-radius:6px;
                   background:${t.key === filtroAtivo ? 'var(--azul,#0A3D62)' : 'transparent'};
                   color:${t.key === filtroAtivo ? '#fff' : 'var(--rs-muted,#64748b)'};
                   transition:all .15s"
            type="button">${t.label}</button>
  `).join('');

  return `
    <div style="position:sticky;top:0;z-index:2;background:var(--rs-card);
                border-bottom:1px solid var(--rs-borda,#e2e8f0);padding:8px 12px">
      <!-- Campo de busca -->
      <div style="display:flex;align-items:center;gap:6px;
                  background:var(--rs-bg,#f8fafc);border:1px solid var(--rs-borda,#e2e8f0);
                  border-radius:8px;padding:5px 10px;margin-bottom:8px">
        <span style="color:var(--rs-muted,#94a3b8);font-size:13px;flex-shrink:0">🔍</span>
        <input id="rs-busca-edicao" type="text"
               placeholder="Buscar por título…"
               value="${val}"
               style="flex:1;border:none;background:transparent;font-size:13px;
                      color:var(--rs-texto,#0f172a);outline:none;min-width:0"
               oninput="_setBusca(this.value)"
               autocomplete="off" autocorrect="off" spellcheck="false"/>
        ${val ? `<button onclick="_setBusca('')" type="button"
                   aria-label="Limpar busca"
                   style="border:none;background:none;padding:0;cursor:pointer;
                          font-size:14px;line-height:1;color:var(--rs-muted,#94a3b8)">✕</button>` : ''}
      </div>
      <!-- Tabs lidas / não lidas -->
      <div style="display:flex;gap:4px">${tabsHtml}</div>
    </div>`;
}

// ─── BUSCA: atualizar estado e re-renderizar ─────────────────────────────────
function _setBusca(termo) {
  _drawer.termoBusca = termo;
  if (_drawer.tipoAtivo) {
    abrirTipo(_drawer.tipoAtivo.id, _drawer.tipoAtivo.nome, _drawer.tipoAtivo.icone);
    // Restaura foco + posição do cursor no input após re-renderização
    requestAnimationFrame(() => {
      const inp = document.getElementById('rs-busca-edicao');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    });
  }
}
window._setBusca = _setBusca;

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
  _drawer.termoBusca = '';
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

  // 🔒 Validação Crítica: Garante que a sessão ainda é válida antes de carregar nova edição
  if (!(await _checarSessaoCritica())) return;

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

    // Limpar inline styles que possam ter sido aplicados pelo modo alerta
    // (el.style.display = 'none' tem prioridade sobre classes CSS como .visivel)
    ['rs-toggle-modo', 'rs-banner-recente', 'rs-watermark',
      'rs-cta-wrap', 'modo-rapido', 'modo-completo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
      });

    // Limpar e re-renderizar
    renderHeader(newsletter, destinatario);
    const modoPadrao = sessionStorage.getItem('rs_modo_leitura') || acesso.modoPadrao;
    trocarModo(modoPadrao);
    renderModoRapido(newsletter, acesso);
    await renderModoCompleto(newsletter, dados, segmento, acesso);
    //await renderSecaoFeedbacks(newsletter);
    renderMunicipio(destinatario, acesso, newsletter);
    renderMidia(newsletter, acesso);
    renderFAQ(newsletter, acesso);
    await renderReactions(edicaoId, ctx.uid);
    renderCTA(acesso, newsletter);
    renderWatermark(destinatario, newsletter);

    // ── Reseta chat ao trocar de edição ──────────────────────────────────────
    window._chatContext = {
      nid: newsletter.id,
      uid: window._radarUser?.uid || '',
      edicaoNum: newsletter.numero || newsletter.edicao || '',
      titulo: newsletter.titulo || ''
    };

    window._chatMensagens = []; // Limpa histórico

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

// ─── Avaliação por seção (👍 / 👎) ───────────────────────────────────────────

function _secaoFeedbackLocalKey(nid, secao) {
  return `rs_secao_feedback_${nid}_${secao}`;
}

function _getSecaoFeedbackLocal(nid, secao) {
  return localStorage.getItem(_secaoFeedbackLocalKey(nid, secao));
}

function _setSecaoFeedbackLocal(nid, secao, voto) {
  const key = _secaoFeedbackLocalKey(nid, secao);
  if (!voto) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, voto);
  }
}

async function carregarSecaoFeedbacks(nid) {
  window._secaoFeedbackCurrentNid = nid;
  window._secaoFeedbackData = {};

  if (!nid) return {};
  try {
    const doc = await db.collection('newsletters').doc(nid).get();
    if (!doc.exists) return {};
    const data = doc.data().feedback_secoes || {};
    window._secaoFeedbackData = data;
    return data;
  } catch (err) {
    console.warn('[secao-feedback] erro ao carregar:', err);
    return {};
  }
}

function _formatarSecaoTipo(tipo) {
  if (!tipo) return 'Conteúdo';
  const labels = {
    video: 'Vídeo',
    audio: 'Áudio',
    infografico: 'Infográfico',
    dados: 'Dados',
    resumo: 'Resumo',
    conteudo: 'Conteúdo completo',
    noticia: 'Notícia',
    geral: 'Geral'
  };
  return labels[tipo] || tipo.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function votarSecao(nid, secao, voto) {
  if (!nid || !secao || !['like', 'dislike'].includes(voto)) return;

  const atual = _getSecaoFeedbackLocal(nid, secao);
  const mesma = atual === voto;
  const proxima = mesma ? null : voto;

  // Ajuste local
  _setSecaoFeedbackLocal(nid, secao, proxima);

  const delta = { like: 0, dislike: 0 };
  if (mesma) {
    // remover voto
    delta[atual] = -1;
  } else {
    if (atual) delta[atual] = -1;
    delta[voto] = 1;
  }

  // Atualiza em memória para UI imediata
  const cache = window._secaoFeedbackData || {};
  cache[secao] = cache[secao] || { like: 0, dislike: 0 };
  cache[secao].like = Math.max(0, (cache[secao].like || 0) + delta.like);
  cache[secao].dislike = Math.max(0, (cache[secao].dislike || 0) + delta.dislike);
  window._secaoFeedbackData = cache;

  // Atualiza UI instantânea
  const buttonLike = document.querySelector(`#secao-feedback-${secao} .btn-like`);
  const buttonDislike = document.querySelector(`#secao-feedback-${secao} .btn-dislike`);

  if (buttonLike) buttonLike.classList.toggle('ativo', proxima === 'like');
  if (buttonDislike) buttonDislike.classList.toggle('ativo', proxima === 'dislike');

  // Persistência Firestore (incremento atômico)
  try {
    const update = {};
    if (delta.like !== 0) update[`feedback_secoes.${secao}.like`] = firebase.firestore.FieldValue.increment(delta.like);
    if (delta.dislike !== 0) update[`feedback_secoes.${secao}.dislike`] = firebase.firestore.FieldValue.increment(delta.dislike);
    if (Object.keys(update).length > 0) {
      await db.collection('newsletters').doc(nid).set(update, { merge: true });
    }
  } catch (err) {
    console.warn('[secao-feedback] erro ao gravar voto:', err);
  }

  // Re-renderiza o resumo geral
  //await renderSecaoFeedbacks({ id: nid, blocos: (window._secaoFeedbackCurrentNewsletter?.blocos || []) });
}

async function renderSecaoFeedbacks(newsletter) {
  let wrap = document.getElementById('secao-feedback-secoes');
  let body = document.getElementById('secao-feedback-secoes-conteudo');

  if (!wrap || !body) {
    const app = document.getElementById('rs-app');
    if (app) {
      wrap = document.createElement('section');
      wrap.id = 'secao-feedback-secoes';
      wrap.className = 'rs-section';
      wrap.style.display = 'none';
      wrap.innerHTML = `
        <div class="rs-section-header">
          <span>🧾</span>
          <h2>Avaliação por seção</h2>
        </div>
        <div class="rs-section-body" id="secao-feedback-secoes-conteudo">
          <p style="color:#999; margin:0;">Aguardando carregamento de avaliações...</p>
        </div>`;

      const mediaSection = document.getElementById('secao-midia');
      if (mediaSection && mediaSection.parentElement) {
        mediaSection.parentElement.insertBefore(wrap, mediaSection);
      } else {
        app.appendChild(wrap);
      }

      body = document.getElementById('secao-feedback-secoes-conteudo');
    }
  }

  if (!wrap || !body) return;
  wrap.style.display = 'block';

  const nid = typeof newsletter === 'string' ? newsletter : (newsletter?.id || window._secaoFeedbackCurrentNid);
  const blocos = (newsletter?.blocos || []) || (window._secaoFeedbackCurrentNewsletter?.blocos || []);

  await carregarSecaoFeedbacks(nid);

  const dados = window._secaoFeedbackData || {};
  const tipos = Array.from(new Set([
    ...Object.keys(dados),
    ...blocos.map(b => (b.tipo || 'conteudo'))
  ]));

  if (!tipos.length) {
    body.innerHTML = '<p style="color:#999;margin:0;">Nenhuma seção disponível para avaliação.</p>';
    return;
  }

  body.innerHTML = tipos.map(tipo => {
    const counts = dados[tipo] || { like: 0, dislike: 0 };
    const usuario = _getSecaoFeedbackLocal(nid, tipo);
    const total = (counts.like || 0) + (counts.dislike || 0);
    const score = total > 0 ? `${Math.round((counts.like / total) * 100)}% 👍` : 'Sem votos';

    return `
      <div id="secao-feedback-${tipo}" style="margin-bottom:12px;padding:8px;border:1px solid #d4d4d4;border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <strong>${_formatarSecaoTipo(tipo)}</strong>
          <small style="color:#666;font-size:12px;">${score}</small>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="rs-btn-secao-feedback btn-like" style="border:1px solid #0e7490;background:${usuario === 'like' ? '#0e7490' : 'transparent'};color:${usuario === 'like' ? '#fff' : '#0e7490'};padding:4px 8px;border-radius:6px;cursor:pointer;" onclick="votarSecao('${_esc(nid)}','${_esc(tipo)}','like')">👍 ${counts.like || 0}</button>
          <button class="rs-btn-secao-feedback btn-dislike" style="border:1px solid #c026d3;background:${usuario === 'dislike' ? '#c026d3' : 'transparent'};color:${usuario === 'dislike' ? '#fff' : '#c026d3'};padding:4px 8px;border-radius:6px;cursor:pointer;" onclick="votarSecao('${_esc(nid)}','${_esc(tipo)}','dislike')">👎 ${counts.dislike || 0}</button>
          <span style="color:#555;font-size:12px;">${total} voto${total === 1 ? '' : 's'}</span>
        </div>
      </div>`;
  }).join('');

  window._secaoFeedbackCurrentNewsletter = newsletter;
}

// ─── Chat FAB — Pergunte ao Radar ────────────────────────────────────────────

function iniciarChatFAB(newsletter, uid, acesso) {
  // Limpa UI anterior
  document.getElementById('rs-chat-fab')?.remove();
  document.getElementById('rs-chat-sheet')?.remove();
  document.getElementById('rs-chat-backdrop')?.remove();

  if (!acesso?.isAssinante && !acesso?.temChat) return;

  // ── 1. Atualiza contexto global (fonte única de verdade) ──
  window._chatContext = {
    nid: newsletter.id,
    uid: uid,
    edicaoNum: newsletter.numero || newsletter.edicao || '',
    titulo: newsletter.titulo || ''
  };

  // ── 2. Histórico global (evita closure) ──
  // Se mudou de edição, zera. Mantém se reabrir a mesma.
  if (!window._chatMensagens || window._chatMensagens._nid !== newsletter.id) {
    window._chatMensagens = [];
    window._chatMensagens._nid = newsletter.id;
  }

  const temChat = !!acesso.temChat;
  const sessionKey = `rs_chat_seen_${newsletter.id}`;
  const isNew = !sessionStorage.getItem(sessionKey);

  // ── 3. Injeta estilos (com CSS do título corrigido) ──
  if (!document.getElementById('rs-chat-styles')) {
    const style = document.createElement('style');
    style.id = 'rs-chat-styles';
    style.textContent = `
      #rs-chat-fab { position:fixed; bottom:68px; right:16px; width:52px; height:52px; border-radius:50%; background:${temChat ? 'linear-gradient(135deg,#f97316,#ef4444)' : 'linear-gradient(135deg,#64748b,#475569)'}; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; z-index:900; box-shadow:0 4px 18px rgba(100,116,139,.35); transition:opacity .22s ease, transform .18s ease; animation:rsChatFabPop .4s cubic-bezier(.34,1.56,.64,1) .3s both; }
      #rs-chat-fab:hover { transform:scale(1.08); } #rs-chat-fab:active { transform:scale(.93); } #rs-chat-fab.oculto { opacity:0; pointer-events:none; }
      #rs-chat-fab .rs-chat-badge { position:absolute; top:2px; right:2px; width:15px; height:15px; border-radius:50%; background:#22c55e; border:2px solid var(--rs-bg,#f4f6f9); display:flex; align-items:center; justify-content:center; font-size:7px; color:#fff; font-weight:700; animation:rsChatBadgePop .35s cubic-bezier(.34,1.56,.64,1) .7s both; }
      #rs-chat-fab .rs-chat-lock { position:absolute; bottom:-2px; right:-2px; font-size:13px; line-height:1; }
      #rs-chat-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:910; animation:rsChatFadeIn .2s ease; }
      #rs-chat-sheet { position:fixed; bottom:0; left:0; right:0; height:74vh; background:var(--rs-card,#fff); border-radius:20px 20px 0 0; z-index:10000; display:flex; flex-direction:column; box-shadow:0 -8px 40px rgba(0,0,0,.18); animation:rsChatSlideUp .35s cubic-bezier(.32,.72,0,1); }
      .rs-chat-handle-wrap { display:flex; justify-content:center; padding:11px 0 3px; }
      .rs-chat-handle { width:36px; height:4px; border-radius:2px; background:var(--rs-borda,#e2e8f0); }
      .rs-chat-header { padding:9px 18px 11px; border-bottom:1px solid var(--rs-borda,#e2e8f0); display:flex; align-items:center; gap:11px; flex-shrink:0; }
      .rs-chat-header-avatar { width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg,#f97316,#ef4444); display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; box-shadow:0 2px 10px rgba(249,115,22,.35); }
      .rs-chat-header-titulo { font-size:13.5px; font-weight:700; color:var(--rs-texto,#0f172a); font-family:Georgia,serif; line-height:1.25; white-space:normal; overflow:visible; text-overflow:clip; max-width:85vw; }
      .rs-chat-header-sub { font-size:10.5px; color:#22c55e; font-family:sans-serif; }
      .rs-chat-header-close { margin-left:auto; background:none; border:none; color:var(--rs-muted,#94a3b8); font-size:17px; cursor:pointer; padding:4px 8px; border-radius:6px; line-height:1; transition:color .15s; }
      .rs-chat-header-close:hover { color:var(--rs-texto,#0f172a); }
      .rs-chat-messages { flex:1; overflow-y:auto; padding:14px 14px 8px; display:flex; flex-direction:column; gap:10px; scroll-behavior:smooth; }
      .rs-chat-msg-row { display:flex; align-items:flex-end; gap:6px; } .rs-chat-msg-row.user { justify-content:flex-end; } .rs-chat-msg-row.assistant { justify-content:flex-start; }
      .rs-chat-bubble { max-width:78%; padding:9px 13px; border-radius:16px; font-size:13px; line-height:1.55; word-break:break-word; white-space:pre-wrap; }
      .rs-chat-bubble.user { background:var(--azul,#0A3D62); color:#fff; border-radius:16px 16px 4px 16px; }
      .rs-chat-bubble.assistant { background:var(--rs-borda,#e2e8f0); color:var(--rs-texto,#0f172a); border-radius:16px 16px 16px 4px; }
      .rs-chat-avatar-mini { width:26px; height:26px; border-radius:50%; background:linear-gradient(135deg,#f97316,#ef4444); display:flex; align-items:center; justify-content:center; font-size:11px; color:#fff; flex-shrink:0; }
      .rs-chat-typing { display:flex; align-items:center; gap:3px; padding:10px 14px; background:var(--rs-borda,#e2e8f0); border-radius:16px 16px 16px 4px; }
      .rs-chat-typing span { width:6px; height:6px; border-radius:50%; background:var(--rs-muted,#94a3b8); animation:rsChatTypingDot 1.2s ease-in-out infinite; } .rs-chat-typing span:nth-child(2) { animation-delay:.2s; } .rs-chat-typing span:nth-child(3) { animation-delay:.4s; }
      .rs-chat-input-row {display: flex; align-items: flex-end; gap: 8px; padding: 10px 12px 12px; border-top: 1px solid var(--rs-borda, #e2e8f0); flex-shrink: 0; position: relative; z-index: 10001; background: var(--rs-card, #fff); }      
      .rs-chat-input { flex:1; border:1px solid var(--rs-borda,#e2e8f0); border-radius:20px; padding:9px 14px; font-size:13px; color:var(--rs-texto,#0f172a); background:var(--rs-bg,#f4f6f9); resize:none; outline:none; line-height:1.45; transition:border-color .15s; font-family:inherit; max-height:120px; overflow-y:auto; }
      .rs-chat-input:focus { border-color:var(--azul,#0A3D62); }
      .rs-chat-send { width:36px; height:36px; border-radius:50%; background:var(--rs-borda,#e2e8f0); border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; transition:background .2s, transform .15s; }
      .rs-chat-send.ativo { background:var(--azul,#0A3D62); } .rs-chat-send.ativo path, .rs-chat-send.ativo line, .rs-chat-send.ativo polygon { stroke:#fff; }
      .rs-chat-send:active { transform:scale(.92); }
      @keyframes rsChatFabPop { from { opacity:0; transform:scale(.6); } to { opacity:1; transform:scale(1); } }
      @keyframes rsChatBadgePop { from { transform:scale(0); } to { transform:scale(1); } }
      @keyframes rsChatSlideUp { from { transform:translateY(100%); } to { transform:translateY(0); } }
      @keyframes rsChatFadeIn { from { opacity:0; } to { opacity:1; } }
      @keyframes rsChatTypingDot { 0%, 60%, 100% { transform:translateY(0); opacity:.5; } 30% { transform:translateY(-4px); opacity:1; } }
      @media(max-width:380px) { .rs-chat-header-titulo { font-size:12.5px; } }
    `;
    document.head.appendChild(style);
  }

  // ── 4. FAB ──
  const fab = document.createElement('button');
  fab.id = 'rs-chat-fab';
  fab.setAttribute('aria-label', temChat ? 'Pergunte ao Radar' : 'Recurso bloqueado');
  fab.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>${isNew && temChat ? '<div class="rs-chat-badge">N</div>' : ''}${!temChat ? '<div class="rs-chat-lock">🔒</div>' : ''}`;
  document.body.appendChild(fab);

  const _scrollEl = document.getElementById('rs-app') || window;
  let _lastY = 0;
  const _onScroll = () => {
    const y = _scrollEl.scrollTop ?? window.scrollY;
    fab.classList.toggle('oculto', y > _lastY + 10 && y > 120);
    if (Math.abs(y - _lastY) > 10) _lastY = y;
  };
  _scrollEl.addEventListener('scroll', _onScroll, { passive: true });

  let _digitando = false;

  // ── 5. Funções internas (agora leem do global) ──
  function _abrirChat() {
    if (document.getElementById('rs-chat-sheet')) return;
    sessionStorage.setItem(sessionKey, '1');

    // 🔒 Trava scroll do fundo e evita que o navegador de scroll sobreponha o input
    document.body.style.overflow = 'hidden';

    const backdrop = document.createElement('div');
    backdrop.id = 'rs-chat-backdrop';
    backdrop.onclick = _fecharChat;
    document.body.appendChild(backdrop);

    const sheet = document.createElement('div');
    sheet.id = 'rs-chat-sheet';

    // ✅ MONTA TÍTULO DINÂMICO a partir do contexto global
    const ctx = window._chatContext || {};
    const partes = ['Pergunte ao Radar'];
    if (ctx.edicaoNum) partes.push(`Edição: ${ctx.edicaoNum}`);
    if (ctx.titulo) partes.push(ctx.titulo);
    const tituloCompleto = partes.join(' - ');

    sheet.innerHTML = `
      <div class="rs-chat-handle-wrap"> <div class="rs-chat-handle"> </div> </div>
      <div class="rs-chat-header">
        <div class="rs-chat-header-avatar">✦</div>
        <div>
          <div class="rs-chat-header-titulo">${_esc(tituloCompleto)}</div>
          <div class="rs-chat-header-sub">● online agora</div>
        </div>
        <button class="rs-chat-header-close"
                onclick="document.getElementById('rs-chat-backdrop')?.click()"
                aria-label="Fechar">✕</button>
      </div>
      <div class="rs-chat-messages" id="rs-chat-messages"> </div>
      <div class="rs-chat-input-row">
        <textarea id="rs-chat-input" class="rs-chat-input"
                  placeholder="Pergunte sobre esta edição…"
                  rows="1" maxlength="500"> </textarea>
        <button id="rs-chat-send" class="rs-chat-send" aria-label="Enviar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2.5"
              stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>`;
    document.body.appendChild(sheet);

    const input = document.getElementById('rs-chat-input');
    const sendBtn = document.getElementById('rs-chat-send');

    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      const ativo = input.value.trim().length > 0;
      sendBtn?.classList.toggle('ativo', ativo);
      sendBtn?.querySelectorAll('path,line,polygon').forEach(p =>
        p.setAttribute('stroke', ativo ? '#fff' : '#94a3b8'));
    });

    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _enviar(); }
    });
    sendBtn?.addEventListener('click', _enviar);

    if (!window._chatMensagens?.length) {
      const ctx = window._chatContext || {};
      _adicionarMensagem('assistant',
        `Olá! Pode perguntar sobre qualquer tema da Edição ${ctx.edicaoNum || '—'}. Estou aqui para ajudar.`
      );
    } else {
      _renderizarMensagens();
    }

    setTimeout(() => input?.focus(), 380);
  }

  // ── Fechar sheet ─────────────────────────────────────────────────────────
  function _fecharChat() {
    document.getElementById('rs-chat-sheet')?.remove();
    document.getElementById('rs-chat-backdrop')?.remove();
    // 🔓 Restaura scroll do fundo
    document.body.style.overflow = '';
  }

  function _adicionarMensagem(role, text) {
    window._chatMensagens.push({ role, text });
    const wrap = document.getElementById('rs-chat-messages');
    if (!wrap) return;
    const row = document.createElement('div');
    row.className = `rs-chat-msg-row ${role}`;
    row.innerHTML = role === 'assistant'
      ? `<div class="rs-chat-avatar-mini">✦</div><div class="rs-chat-bubble assistant">${_esc(text)}</div>`
      : `<div class="rs-chat-bubble user">${_esc(text)}</div>`;
    wrap.appendChild(row);
    row.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  function _renderizarMensagens() {
    const wrap = document.getElementById('rs-chat-messages');
    if (!wrap) return; wrap.innerHTML = '';
    window._chatMensagens.forEach(m => _adicionarMensagem(m.role, m.text));
  }

  async function _enviar() {
    const input = document.getElementById('rs-chat-input');
    const sendBtn = document.getElementById('rs-chat-send');
    if (!input) return;
    const texto = input.value.trim();
    if (!texto || _digitando) return;
    input.value = ''; sendBtn?.classList.remove('ativo');

    _adicionarMensagem('user', texto);
    _digitando = true;
    const wrap = document.getElementById('rs-chat-messages');
    const typing = document.createElement('div');
    typing.className = 'rs-chat-msg-row assistant'; typing.id = 'rs-chat-typing-row';
    typing.innerHTML = `<div class="rs-chat-avatar-mini">✦</div><div class="rs-chat-typing"><span></span><span></span><span></span></div>`;
    wrap?.appendChild(typing); typing?.scrollIntoView({ behavior: 'smooth' });

    try {
      const ctx = window._chatContext; // ✅ Lê contexto ATUALIZADO
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pergunta: texto,
          nid: ctx.nid,
          municipio_cod: window._radarUser?.municipio_cod || '',
          uid: ctx.uid,
          segmento: window._radarUser?.segmento || '',
          acesso_pro_temp: window._leadAcessoProTemp === true,
          historico: window._chatMensagens.slice(-6)
        }),
      });
      let data; try { data = await res.json(); } catch { _digitando = false; typing?.remove(); return; }
      _digitando = false; typing?.remove();
      if (!res.ok || data.erro) { _adicionarMensagem('assistant', data.erro || 'Não consegui processar.'); return; }
      _adicionarMensagem('assistant', data.resposta);
    } catch (err) {
      _digitando = false; typing?.remove();
      _adicionarMensagem('assistant', 'Erro de conexão. Verifique sua internet.');
    }
  }

  fab.onclick = () => {
    if (!temChat) { _solicitarUpgrade('chat', acesso.isAssinante); return; }
    sessionStorage.setItem(sessionKey, '1');
    fab.querySelector('.rs-chat-badge')?.remove();
    _abrirChat();
  };

  window._rsChatDestroy = () => {
    document.getElementById('rs-chat-sheet')?.remove();
    document.getElementById('rs-chat-backdrop')?.remove();
    fab.remove(); _scrollEl.removeEventListener('scroll', _onScroll);
    delete window._rsChatDestroy;
  };
}

// Usa localStorage com chave por uid para isolar entre usuários.
// Estrutura: rs_lidas_<uid> = { "<nid>": { ts: <timestamp>, manual: <bool> } }

function _getLidasKey(uid) {
  return `rs_lidas_${uid || 'anon'}`;
}

function _getLidas(uid) {
  try {
    return JSON.parse(localStorage.getItem(_getLidasKey(uid)) || '{}');
  } catch { return {}; }
}

function _salvarLidas(uid, lidas) {
  try {
    localStorage.setItem(_getLidasKey(uid), JSON.stringify(lidas));
  } catch { /* ignora se localStorage bloqueado */ }
}

// Verifica se uma edição está marcada como lida
function _edicaoLida(uid, nid) {
  return !!_getLidas(uid)[nid];
}

// Marca como lida (manual = false para auto, true para clique do usuário)
function marcarLida(uid, nid, manual = false) {
  const lidas = _getLidas(uid);
  if (lidas[nid] && !manual) return; // auto não sobrescreve marcação manual
  lidas[nid] = { ts: Date.now(), manual };
  _salvarLidas(uid, lidas);
  _atualizarIndicadorCard(nid, true);
}

// Desmarca como lida (só manual)
function desmarcarLida(uid, nid) {
  const lidas = _getLidas(uid);
  delete lidas[nid];
  _salvarLidas(uid, lidas);
  _atualizarIndicadorCard(nid, false);
}

// Toggle lida/não lida
function toggleLida(uid, nid) {
  if (_edicaoLida(uid, nid)) {
    desmarcarLida(uid, nid);
  } else {
    marcarLida(uid, nid, true);
  }
  // Atualiza o drawer se estiver aberto
  if (_drawer?.aberto) {
    _atualizarIndicadoresDrawer(uid);
  }
}
window.toggleLida = toggleLida;

// Atualiza visualmente o indicador de um card específico (sem re-renderizar tudo)
function _atualizarIndicadorCard(nid, lida) {
  const dot = document.querySelector(`[data-lida-nid="${nid}"]`);
  if (!dot) return;
  dot.style.background = lida ? 'transparent' : 'var(--azul, #0A3D62)';
  dot.title = lida ? 'Marcar como não lida' : 'Marcar como lida';
}

// Re-aplica indicadores em todos os cards visíveis no drawer
function _atualizarIndicadoresDrawer(uid) {
  const lidas = _getLidas(uid);
  document.querySelectorAll('[data-lida-nid]').forEach(dot => {
    const nid = dot.dataset.lidaNid;
    const lida = !!lidas[nid];
    dot.style.background = lida ? 'transparent' : 'var(--azul, #0A3D62)';
  });
}


// ─── AUTO-MARCAR como lida após 45s de leitura ──────────────────────────────
// Chama esta função logo após mostrarApp() em navegarParaEdicao e no fluxo principal.

let _autoLidaTimer = null;

function iniciarAutoMarcarLida(nid, uid) {
  if (_autoLidaTimer) clearTimeout(_autoLidaTimer);
  if (!nid || !uid) return;

  _autoLidaTimer = setTimeout(() => {
    if (!_edicaoLida(uid, nid)) {
      marcarLida(uid, nid, false);
    }
  }, 45 * 1000); // 45 segundos
}

// ─── Painel de upgrade de mídia ───────────────────────────────────────────────
// Exibido ao clicar em "Desbloquear" em um item de mídia bloqueado.
// Distingue assinante (upgrade de plano) de lead (nova assinatura).

const _UPGRADE_INFO = {
  audio: { icone: '🎧', nome: 'Podcast', plano: 'Essence', slug: 'essence' },
  video: { icone: '📺', nome: 'Vídeo', plano: 'Profissional', slug: 'profissional' },
  infografico: { icone: '📊', nome: 'Infográfico', plano: 'Profissional', slug: 'profissional' },
  mapaMental: { icone: '📊', nome: 'Mapa Mental', plano: 'Profissional', slug: 'profissional' },
  chat: { icone: '✦', nome: 'Pergunte ao Radar', plano: 'Profissional', slug: 'profissional' },
  relatorio: { icone: '📋', nome: 'Relatório de Conformidade', plano: 'Profissional', slug: 'profissional' },
  calendario: { icone: '📅', nome: 'Calendário', plano: 'Essence', slug: 'essence' },
};

function _solicitarUpgrade(tipo, isAssinante) {
  // Remove painel anterior se existir
  document.getElementById('rs-upgrade-panel')?.remove();

  const info = _UPGRADE_INFO[tipo] || { icone: '🔒', nome: 'Recurso', plano: 'superior', slug: '' };

  const panel = document.createElement('div');
  panel.id = 'rs-upgrade-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Informações sobre upgrade');

  if (isAssinante) {
    // ── Assinante: orientar para upgrade via contato ─────────────────────────
    panel.innerHTML = `
      <div class="rs-upgrade-backdrop" onclick="_fecharUpgradePanel()"></div>
      <div class="rs-upgrade-box">
        <button class="rs-upgrade-close" onclick="_fecharUpgradePanel()"
                aria-label="Fechar">✕</button>
        <div class="rs-upgrade-icone">${info.icone}</div>
        <h3 class="rs-upgrade-titulo">Upgrade de plano</h3>
        <p class="rs-upgrade-texto">
          O <strong>${info.nome}</strong> está disponível a partir do plano
          <strong>${info.plano}</strong>. Como você já é assinante, basta
          solicitar o upgrade diretamente com a nossa equipe.
        </p>
         <h4 class="rs-upgrade-titulo">📩 Acesse Ações na Central do app</h4>
        <button class="rs-upgrade-btn-secundario" onclick="_fecharUpgradePanel()">
          Agora não
        </button>
      </div>`;
  } else {
    // ── Lead: direcionar para assinatura (nova aba — não sai do app) ─────────
    panel.innerHTML = `
      <div class="rs-upgrade-backdrop" onclick="_fecharUpgradePanel()"></div>
      <div class="rs-upgrade-box">
        <button class="rs-upgrade-close" onclick="_fecharUpgradePanel()"
                aria-label="Fechar">✕</button>
        <div class="rs-upgrade-icone">${info.icone}</div>
        <h3 class="rs-upgrade-titulo">${info.nome} exclusivo para assinantes</h3>
        <p class="rs-upgrade-texto">
          Este recurso está disponível a partir do plano
          <strong>${info.plano}</strong>. Assine agora e tenha acesso
          permanente a todas as edições com ${info.nome.toLowerCase()}.
        </p>
        <a href="/assinatura.html?plano=${info.slug}" target="_blank" rel="noopener"
           class="rs-upgrade-btn-primario">
          Ver plano ${info.plano} →
        </a>
        <button class="rs-upgrade-btn-secundario" onclick="_fecharUpgradePanel()">
          Continuar lendo
        </button>
      </div>`;
  }

  document.body.appendChild(panel);

  // Foco no painel para acessibilidade
  requestAnimationFrame(() => {
    panel.querySelector('.rs-upgrade-box')?.focus?.();
  });
}

function _fecharUpgradePanel() {
  const panel = document.getElementById('rs-upgrade-panel');
  if (!panel) return;
  panel.style.opacity = '0';
  setTimeout(() => panel.remove(), 200);
}

window._solicitarUpgrade = _solicitarUpgrade;
window._fecharUpgradePanel = _fecharUpgradePanel;
window._checarSessaoCritica = _checarSessaoCritica;
window._mostrarSheetSessaoBloqueada = _mostrarSheetSessaoBloqueada;

// ─── Inicia ───────────────────────────────────────────────────────────────────
VerNewsletterComToken();

