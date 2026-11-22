/* ==========================================================================
   trilhaApp.js — Módulo de Trilha de Edições (Jornada do Assinante)
   Integração com: verNewsletterComToken.js + API /api/pagamentoMP
   
   Decisões de arquitetura:
   - Tela cheia (Opção A): substitui "RadarTeca" no menu para assinantes
   - Cada tipo tem sua própria trilha (001-012, 013-024, 025-036, 037-048)
   - Lead NÃO vê a trilha (botão só aparece para assinantes)
   - Clique em edição liberada → navegarParaEdicao()
   - Botão "📚 Ver por tipo" abre o drawer RadarTeca existente
   ========================================================================== */
(function () {
  'use strict';

  // ─── Constantes ────────────────────────────────────────────────────────────
  const NOMES_NIVEIS = ['Nível 1', 'Nível 2', 'Nível 3', 'Nível 4'];
  const EDICOES_POR_MODULO = 12;

  // ─── Mapa de ícones por tipo (fallback quando o Firestore não tem icone) ───
  const ICONE_POR_TIPO = {
    'fundeb': '⚖️',
    'siope': '📊',
    'salario-educacao': '💰',
    'salario_educacao': '💰',
    'cacs': '👥',
    'conselho': '👥',
    'parecer': '📄',
    'calendario': '📅',
    'alertas': '🔔',
  };

  function _iconeDoTipo(tipo) {
    if (tipo && tipo.icone && tipo.icone !== '📰') return tipo.icone;
    const nome = (tipo && tipo.nome ? tipo.nome : '').toLowerCase().trim();
    const id = (tipo && tipo.id ? tipo.id : '').toLowerCase().trim();
    return ICONE_POR_TIPO[id] || ICONE_POR_TIPO[nome] || '📚';
  }

  // ─── Estado ────────────────────────────────────────────────────────────────
  let _painel = null;
  let _quizResumo = null;
  let _edicoesCache = {};

  // ─── Inicialização ─────────────────────────────────────────────────────────
  function init() {
    _injetarCSS();
    window.addEventListener('rs:abrirTrilha', _abrir);
  }

  // ─── CSS ───────────────────────────────────────────────────────────────────
  function _injetarCSS() {
    if (document.getElementById('rs-trilha-style')) return;

    const style = document.createElement('style');
    style.id = 'rs-trilha-style';
    style.textContent = [
      '#rs-trilha-fullscreen {',
        'position: fixed; inset: 0; z-index: 800;',
        'background: #0f172a !important;',
        'color: #f1f5f9 !important;',
        'color-scheme: dark;',
        'overflow-y: auto;',
        'animation: rsFadeIn .2s ease;',
        'display: flex; flex-direction: column;',
        '--rs-bg: #0f172a;',
        '--rs-card: #1e293b;',
        '--rs-card2: #162032;',
        '--rs-text: #f1f5f9;',
        '--rs-muted: #94a3b8;',
        '--rs-borda: rgba(255,255,255,0.08);',
      '}',
      '.rs-trilha-header {',
        'position: sticky; top: 0; z-index: 10;',
        'background: #0f172a;',
        'border-bottom: 1px solid #1e293b;',
        'padding: 14px 16px;',
        'display: flex; align-items: center; gap: 12px;',
        'flex-wrap: nowrap;',
        'overflow: hidden;',
      '}',
      '.rs-trilha-btn-voltar {',
        'background: none; border: none; color: #94a3b8;',
        'font-size: 13px; font-weight: 700; cursor: pointer; padding: 0;',
        'font-family: inherit; display: flex; align-items: center; gap: 6px;',
        'white-space: nowrap; flex-shrink: 0;',
      '}',
      '.rs-trilha-btn-voltar:hover { color: #f1f5f9; }',
      '.rs-trilha-titulo {',
        'font-size: 15px; font-weight: 800; color: #f1f5f9 !important;',
        'margin: 0;',
        'flex: 1;',
        'min-width: 0;',
        'white-space: nowrap;',
        'overflow: hidden;',
        'text-overflow: ellipsis;',
      '}',
      '.rs-trilha-btn-radarTeca {',
        'background: #0A3D62;',
        'border: 1px solid #1e5a8a;',
        'color: #ffffff; font-size: 12px; font-weight: 700;',
        'padding: 7px 13px; border-radius: 8px; cursor: pointer;',
        'transition: all .15s;',
        'letter-spacing: 0.02em;',
        'white-space: nowrap; flex-shrink: 0;',
      '}',
      '.rs-trilha-btn-radarTeca:hover {',
        'background: #0d4f7c;',
        'border-color: #2a6fa8;',
      '}',
      '#rs-trilha-container {',
        'flex: 1; padding: 20px 16px 40px;',
        'max-width: 800px; margin: 0 auto; width: 100%;',
      '}',
      '.rs-trilha-tipo-section { margin-bottom: 32px; }',
      '.rs-trilha-tipo-header {',
        'display: flex; align-items: center; gap: 10px;',
        'margin-bottom: 16px; padding-bottom: 10px;',
        'border-bottom: 1px solid rgba(255, 255, 255, 0.08);',
      '}',
      '.rs-trilha-tipo-icone { font-size: 24px; flex-shrink: 0; }',
      '.rs-trilha-tipo-nome {',
        'font-size: 16px; font-weight: 700; color: #f1f5f9 !important; margin: 0;',
      '}',
      '.rs-trilha-modulo {',
        'background: #1e293b;',
        'border: 1px solid rgba(255, 255, 255, 0.08);',
        'border-radius: 12px; padding: 16px; margin-bottom: 16px;',
      '}',
      '.rs-trilha-modulo-header {',
        'display: flex; justify-content: space-between; align-items: center;',
        'margin-bottom: 12px; flex-wrap: wrap; gap: 8px;',
      '}',
      '.rs-trilha-modulo-titulo {',
        'font-size: 14px; font-weight: 700; color: #f1f5f9 !important; margin: 0;',
      '}',
      '.rs-trilha-modulo-status {',
        'font-size: 11px; font-weight: 600; padding: 3px 8px;',
        'border-radius: 12px; text-transform: uppercase; letter-spacing: 0.05em;',
      '}',
      '.rs-trilha-modulo-status.aguardando {',
        'background: rgba(100, 116, 139, 0.2); color: #94a3b8;',
      '}',
      '.rs-trilha-modulo-status.andamento {',
        'background: rgba(59, 130, 246, 0.2); color: #60a5fa;',
      '}',
      '.rs-trilha-modulo-status.completo {',
        'background: rgba(34, 197, 94, 0.2); color: #4ade80;',
      '}',
      '.rs-trilha-barra-wrap { margin-bottom: 12px; }',
      '.rs-trilha-barra-label {',
        'display: flex; justify-content: space-between;',
        'font-size: 11px; color: #94a3b8; margin-bottom: 6px;',
      '}',
      '.rs-trilha-barra {',
        'height: 6px; background: rgba(255, 255, 255, 0.08);',
        'border-radius: 3px; overflow: hidden;',
      '}',
      '.rs-trilha-barra-fill {',
        'height: 100%; border-radius: 3px; transition: width .3s ease;',
      '}',
      '.rs-trilha-barra-fill.lib {',
        'background: linear-gradient(90deg, #3b82f6, #60a5fa);',
      '}',
      '.rs-trilha-barra-fill.quiz {',
        'background: linear-gradient(90deg, #22c55e, #4ade80);',
      '}',
      '.rs-trilha-barra-fill.quiz.completo {',
        'background: linear-gradient(90deg, #22c55e, #16a34a);',
      '}',
      '.rs-trilha-edicoes-grid {',
        'display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));',
        'gap: 10px;',
      '}',
      '.rs-trilha-edicao-card {',
        'background: rgba(255, 255, 255, 0.04);',
        'border: 1px solid rgba(255, 255, 255, 0.08);',
        'border-radius: 8px; padding: 10px;',
        'cursor: pointer; transition: all .15s; position: relative;',
      '}',
      '.rs-trilha-edicao-card:hover:not(.bloqueado) {',
        'background: rgba(255, 255, 255, 0.08);',
        'border-color: rgba(255, 255, 255, 0.15);',
        'transform: translateY(-2px);',
      '}',
      '.rs-trilha-edicao-card.bloqueado {',
        'opacity: 0.4; cursor: not-allowed;',
      '}',
      '.rs-trilha-edicao-numero {',
        'font-size: 11px; font-weight: 700; color: #60a5fa; margin-bottom: 4px;',
      '}',
      '.rs-trilha-edicao-titulo {',
        'font-size: 12px; color: #f1f5f9; line-height: 1.4;',
        'display: -webkit-box; -webkit-line-clamp: 2;',
        '-webkit-box-orient: vertical; overflow: hidden;',
      '}',
      '.rs-trilha-edicao-badge {',
        'position: absolute; top: 6px; right: 6px; font-size: 14px;',
      '}',
      '.rs-trilha-edicao-data-liberacao {',
        'font-size: 10px; color: #94a3b8; margin-top: 4px;',
      '}',
      '.rs-trilha-extras-section {',
        'margin-top: 40px; padding-top: 24px;',
        'border-top: 1px solid rgba(255, 255, 255, 0.08);',
      '}',
      '.rs-trilha-extras-header {',
        'display: flex; align-items: center; gap: 10px; margin-bottom: 16px;',
      '}',
      '.rs-trilha-extras-titulo {',
        'font-size: 14px; font-weight: 700; color: #f1f5f9; margin: 0;',
      '}',
      '.rs-trilha-extras-badge {',
        'font-size: 10px; font-weight: 600; padding: 2px 6px;',
        'background: rgba(245, 158, 11, 0.2); color: #fbbf24;',
        'border-radius: 8px; text-transform: uppercase; letter-spacing: 0.05em;',
      '}',
      '.rs-trilha-loading {',
        'padding: 60px 20px; text-align: center; color: #94a3b8;',
      '}',
      '.rs-trilha-loading-icon { font-size: 40px; margin-bottom: 16px; }',
      '.rs-trilha-erro { padding: 40px 20px; text-align: center; color: #f87171; }',
      '.rs-trilha-debug {',
        'padding: 12px; margin: 12px 0;',
        'background: rgba(239, 68, 68, 0.1);',
        'border: 1px solid rgba(239, 68, 68, 0.3);',
        'border-radius: 8px;',
        'font-size: 12px; color: #fca5a5;',
        'font-family: monospace;',
        'white-space: pre-wrap;',
        'word-break: break-word;',
      '}',
      '@media (max-width: 640px) {',
        '.rs-trilha-edicoes-grid {',
          'grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));',
        '}',
        '.rs-trilha-titulo { font-size: 14px; }',
        '.rs-trilha-btn-radarTeca { font-size: 11px; padding: 6px 10px; }',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ─── Abrir Trilha ──────────────────────────────────────────────────────────
  async function _abrir() {
    if (typeof window._checarSessaoCritica === 'function') {
      if (!(await window._checarSessaoCritica())) return;
    }

    let sessao;
    try {
      sessao = JSON.parse(localStorage.getItem('rs_pwa_session') || '{}');
    } catch (e) {
      sessao = {};
    }

    if (!sessao.uid || sessao.segmento !== 'assinante') {
      console.warn('[Trilha] Usuário não é assinante');
      return;
    }

    try {
      _quizResumo = await _buscarQuizResumo(sessao.uid);
    } catch (e) {
      console.warn('[Trilha] Falha ao buscar quiz-resumo-geral:', e);
      _quizResumo = null;
    }

    _renderizarPainel(sessao);
  }

  // ─── Buscar Quiz Resumo Geral ──────────────────────────────────────────────
  async function _buscarQuizResumo(uid) {
    const resp = await fetch(
      '/api/pagamentoMP?acao=quiz-resumo-geral&uid=' + encodeURIComponent(uid)
    );
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    return data.ok ? data : null;
  }

  // ─── Renderizar Painel ─────────────────────────────────────────────────────
  function _renderizarPainel(sessao) {
    if (!_painel) {
      _painel = document.createElement('div');
      _painel.id = 'rs-trilha-fullscreen';

      const header = document.createElement('div');
      header.className = 'rs-trilha-header';
      header.innerHTML =
        '<button class="rs-trilha-btn-voltar" type="button">' +
          '<span>←</span><span>Voltar</span>' +
        '</button>' +
        '<h1 class="rs-trilha-titulo">Minha Trilha</h1>' +
        '<button class="rs-trilha-btn-radarTeca" type="button">' +
          '📚 Ver por tipo' +
        '</button>';

      const container = document.createElement('div');
      container.id = 'rs-trilha-container';

      _painel.appendChild(header);
      _painel.appendChild(container);
      document.body.appendChild(_painel);

      header.querySelector('.rs-trilha-btn-voltar').addEventListener('click', _fechar);
      header.querySelector('.rs-trilha-btn-radarTeca').addEventListener('click', function () {
        _fechar();
        window.dispatchEvent(new CustomEvent('rs:abrirEdicoes'));
      });
    } else {
      _painel.style.display = 'flex';
    }

    _renderizarConteudo(sessao);
  }

  // ─── Renderizar Conteúdo ───────────────────────────────────────────────────
  async function _renderizarConteudo(sessao) {
    const container = document.getElementById('rs-trilha-container');
    if (!container) return;

    container.innerHTML =
      '<div class="rs-trilha-loading">' +
        '<div class="rs-trilha-loading-icon">🗺️</div>' +
        '<div>Carregando sua trilha...</div>' +
      '</div>';

    try {
      const dataAtivacao = sessao.data_ativacao ? new Date(sessao.data_ativacao) : null;
      const tiposInclusos = sessao.tiposInclusos || [];

      console.log('[Trilha] tiposInclusos da sessão:', tiposInclusos);

      if (!tiposInclusos.length) {
        container.innerHTML =
          '<div class="rs-trilha-erro">' +
            '<div style="font-size:40px;margin-bottom:16px">📭</div>' +
            '<div>Nenhum tipo de newsletter encontrado no seu plano.</div>' +
          '</div>';
        return;
      }

      let html = '';
      let debugInfo = '';

      for (const tipo of tiposInclusos) {
        const edicoes = await _buscarEdicoesDoTipo(tipo.id);
        debugInfo += 'Tipo "' + tipo.nome + '" (id=' + tipo.id + '): ' + edicoes.length + ' edições\n';
        html += await _renderizarTipo(tipo, edicoes, dataAtivacao);
      }

      const extras = await _buscarExtras();
      if (extras.length) {
        html += _renderizarExtras(extras);
      }

      container.innerHTML = html;

      container.querySelectorAll('.rs-trilha-edicao-card:not(.bloqueado)').forEach(function (card) {
        card.addEventListener('click', function () {
          const nid = card.dataset.nid;
          if (nid && typeof window.navegarParaEdicao === 'function') {
            _fechar();
            window.navegarParaEdicao(nid);
          }
        });
      });

    } catch (err) {
      console.error('[Trilha] Erro ao renderizar:', err);
      container.innerHTML =
        '<div class="rs-trilha-erro">' +
          '<div style="font-size:40px;margin-bottom:16px">❌</div>' +
          '<div>Erro ao carregar a trilha.</div>' +
          '<div style="font-size:12px;margin-top:8px;opacity:0.7">' + _esc(err.message) + '</div>' +
        '</div>';
    }
  }

  // ─── Buscar Edições do Tipo ────────────────────────────────────────────────
  async function _buscarEdicoesDoTipo(tipoId) {
    if (_edicoesCache[tipoId]) return _edicoesCache[tipoId];

    if (!window.db) {
      console.warn('[Trilha] window.db não está disponível');
      return [];
    }

    try {
      console.log('[Trilha] Buscando edições do tipo:', tipoId);
      const snap = await window.db.collection('newsletters')
        .where('tipo', '==', tipoId)
        .where('enviada', '==', true)
        .orderBy('data_publicacao', 'asc')
        .get();
      
      const edicoes = snap.docs.map(function (d) {
        return { id: d.id, ...d.data() };
      });
      
      console.log('[Trilha] Encontrou', edicoes.length, 'edições para tipo', tipoId);
      
      _edicoesCache[tipoId] = edicoes;
      return edicoes;
    } catch (e) {
      console.warn('[Trilha] Falha ao buscar edições do tipo:', e);
      return [];
    }
  }

  // ─── Buscar Extras ─────────────────────────────────────────────────────────
  async function _buscarExtras() {
    if (_edicoesCache['__extras__']) return _edicoesCache['__extras__'];

    if (!window.db) return [];

    try {
      const snap = await window.db.collection('newsletters')
        .where('formato', '==', 'extra')
        .where('enviada', '==', true)
        .orderBy('data_publicacao', 'desc')
        .limit(20)
        .get();

      const extras = snap.docs.map(function (d) {
        return { id: d.id, ...d.data() };
      });
      _edicoesCache['__extras__'] = extras;
      return extras;
    } catch (e) {
      console.warn('[Trilha] Falha ao buscar extras:', e);
      return [];
    }
  }

  // ─── Renderizar Tipo ───────────────────────────────────────────────────────
  async function _renderizarTipo(tipo, edicoes, dataAtivacao) {
    const regulares = edicoes.filter(function (ed) {
      return ed.formato !== 'extra';
    });

    const modulos = _agruparEmModulos(regulares);
    const icone = _iconeDoTipo(tipo);

    let html =
      '<div class="rs-trilha-tipo-section">' +
        '<div class="rs-trilha-tipo-header">' +
          '<span class="rs-trilha-tipo-icone">' + _esc(icone) + '</span>' +
          '<h2 class="rs-trilha-tipo-nome">' + _esc(tipo.nome) + '</h2>' +
        '</div>';

    if (modulos.length === 0) {
      html +=
        '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px;">' +
          'Nenhuma edição encontrada para este tipo.' +
        '</div>';
    } else {
      modulos.forEach(function (modulo, idx) {
        html += _renderizarModulo(modulo, idx, dataAtivacao);
      });
    }

    html += '</div>';
    return html;
  }

  // ─── Agrupar em Módulos ────────────────────────────────────────────────────
  function _agruparEmModulos(edicoes) {
    const modulos = [];
    for (let i = 0; i < edicoes.length; i += EDICOES_POR_MODULO) {
      modulos.push(edicoes.slice(i, i + EDICOES_POR_MODULO));
    }
    return modulos;
  }

  // ─── Renderizar Módulo ─────────────────────────────────────────────────────
  function _renderizarModulo(edicoes, indice, dataAtivacao) {
    const nomeNivel = NOMES_NIVEIS[indice] || ('Nível ' + (indice + 1));

    const primeiraEdicao = edicoes[0];
    const ultimaEdicao   = edicoes[edicoes.length - 1];

    const numeroInicio = String(primeiraEdicao?.numero || '001').padStart(3, '0');
    const numeroFim    = String(ultimaEdicao?.numero || (EDICOES_POR_MODULO * (indice + 1))).padStart(3, '0');

    const estado = _calcularEstadoModulo(edicoes, dataAtivacao);
    const quizzesInfo = _calcularQuizzesModulo(edicoes, dataAtivacao);

    const pctLib = edicoes.length > 0 ? (estado.liberadas / edicoes.length) * 100 : 0;

    let html =
      '<div class="rs-trilha-modulo">' +
        '<div class="rs-trilha-modulo-header">' +
          '<h3 class="rs-trilha-modulo-titulo">' +
            _esc(nomeNivel) + ' · Ed. ' + _esc(numeroInicio) + '–' + _esc(numeroFim) +
          '</h3>' +
          '<span class="rs-trilha-modulo-status ' + _esc(estado.classe) + '">' +
            _esc(estado.label) +
          '</span>' +
        '</div>' +
        '<div class="rs-trilha-barra-wrap">' +
          '<div class="rs-trilha-barra-label">' +
            '<span>Liberação</span>' +
            '<span>' + estado.liberadas + '/' + edicoes.length + '</span>' +
          '</div>' +
          '<div class="rs-trilha-barra">' +
            '<div class="rs-trilha-barra-fill lib" style="width:' + pctLib + '%"></div>' +
          '</div>' +
        '</div>';

    if (quizzesInfo.total > 0) {
      const pctQuizzes = (quizzesInfo.aprovados / quizzesInfo.total) * 100;
      const classeCompleto = quizzesInfo.aprovados === quizzesInfo.total ? 'completo' : '';

      html +=
        '<div class="rs-trilha-barra-wrap">' +
          '<div class="rs-trilha-barra-label">' +
            '<span>🧠 Quizzes</span>' +
            '<span>' + quizzesInfo.aprovados + '/' + quizzesInfo.total + ' aprovados</span>' +
          '</div>' +
          '<div class="rs-trilha-barra">' +
            '<div class="rs-trilha-barra-fill quiz ' + classeCompleto + '" style="width:' + pctQuizzes + '%"></div>' +
          '</div>' +
        '</div>';
    }

    html += '<div class="rs-trilha-edicoes-grid">';

    edicoes.forEach(function (ed) {
      const liberada = _edicaoLiberadaParaAssinante(ed, dataAtivacao);
      const bloqueado = !liberada;
      const numero = ed.numero || ed.edicao || '';
      const titulo = ed.titulo || ('Edição ' + numero);

      let badge = '';
      let dataLiberacao = '';

      if (bloqueado) {
        const dataLib = _calcularDataLiberacao(ed, dataAtivacao);
        if (dataLib) {
          dataLiberacao = '<div class="rs-trilha-edicao-data-liberacao">Libera em ' + dataLib + '</div>';
        }
        badge = '<span class="rs-trilha-edicao-badge">🔒</span>';
      } else {
        const quizAprovado = _quizAprovado(ed.id);
        if (quizAprovado) {
          badge = '<span class="rs-trilha-edicao-badge">✅</span>';
        }
      }

      html +=
        '<div class="rs-trilha-edicao-card ' + (bloqueado ? 'bloqueado' : '') + '" data-nid="' + _esc(ed.id) + '">' +
          badge +
          '<div class="rs-trilha-edicao-numero">Ed. ' + _esc(numero) + '</div>' +
          '<div class="rs-trilha-edicao-titulo">' + _esc(titulo) + '</div>' +
          dataLiberacao +
        '</div>';
    });

    html += '</div></div>';
    return html;
  }

  // ─── Calcular Estado do Módulo ─────────────────────────────────────────────
  function _calcularEstadoModulo(edicoes, dataAtivacao) {
    const liberadas = edicoes.filter(function (ed) {
      return _edicaoLiberadaParaAssinante(ed, dataAtivacao);
    }).length;
    const total = edicoes.length;

    if (liberadas === 0) {
      return { classe: 'aguardando', label: 'Aguardando', liberadas: liberadas };
    } else if (liberadas < total) {
      return { classe: 'andamento', label: 'Em andamento', liberadas: liberadas };
    } else {
      return { classe: 'completo', label: 'Completo', liberadas: liberadas };
    }
  }

  // ─── Calcular Quizzes do Módulo ────────────────────────────────────────────
  function _calcularQuizzesModulo(edicoes, dataAtivacao) {
    const edicoesComQuiz = edicoes.filter(function (ed) {
      const liberada = _edicaoLiberadaParaAssinante(ed, dataAtivacao);
      const temQuiz = ed.quiz && ed.quiz.ativo === true;
      return liberada && temQuiz;
    });

    const total = edicoesComQuiz.length;
    const aprovados = edicoesComQuiz.filter(function (ed) {
      return _quizAprovado(ed.id);
    }).length;

    return { total: total, aprovados: aprovados };
  }

  // ─── Verificar Quiz Aprovado ───────────────────────────────────────────────
  function _quizAprovado(nid) {
    if (!_quizResumo || !_quizResumo.edicoes) return false;
    const edicao = _quizResumo.edicoes.find(function (e) {
      return e.newsletter_id === nid;
    });
    return edicao && edicao.aprovado === true;
  }

  // ─── Calcular Data de Liberação ────────────────────────────────────────────
  function _calcularDataLiberacao(edicao, dataAtivacao) {
    if (!dataAtivacao) return null;

    const numero = parseInt(edicao.numero, 10);
    if (!numero || isNaN(numero)) return null;

    const semanas = numero - 1;
    const msAtivacao = dataAtivacao instanceof Date
      ? dataAtivacao.getTime()
      : (dataAtivacao.toDate ? dataAtivacao.toDate().getTime() : Number(dataAtivacao));

    const dataLib = new Date(msAtivacao + semanas * 7 * 24 * 60 * 60 * 1000);

    return dataLib.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  // ─── Renderizar Extras ─────────────────────────────────────────────────────
  function _renderizarExtras(extras) {
    let html =
      '<div class="rs-trilha-extras-section">' +
        '<div class="rs-trilha-extras-header">' +
          '<span style="font-size:20px">⚡</span>' +
          '<h2 class="rs-trilha-extras-titulo">Extras</h2>' +
          '<span class="rs-trilha-extras-badge">Sempre abertos</span>' +
        '</div>' +
        '<div class="rs-trilha-edicoes-grid">';

    extras.forEach(function (ed) {
      const numero = ed.numero || ed.edicao || '';
      const titulo = ed.titulo || ('Extra ' + numero);

      html +=
        '<div class="rs-trilha-edicao-card" data-nid="' + _esc(ed.id) + '">' +
          '<div class="rs-trilha-edicao-numero">⚡ Extra</div>' +
          '<div class="rs-trilha-edicao-titulo">' + _esc(titulo) + '</div>' +
        '</div>';
    });

    html += '</div></div>';
    return html;
  }

  // ─── Fechar Trilha ─────────────────────────────────────────────────────────
  function _fechar() {
    if (_painel) {
      _painel.style.opacity = '0';
      _painel.style.transition = 'opacity .2s';
      setTimeout(function () {
        _painel.style.opacity = '';
        _painel.style.transition = '';
        _painel.style.display = 'none';
      }, 200);
    }
  }

  // ─── Verificar se Edição está Liberada ─────────────────────────────────────
  function _edicaoLiberadaParaAssinante(edicao, dataAtivacao) {
    if (!dataAtivacao) return true;
    if (edicao.formato === 'extra') return true;

    const numero = parseInt(edicao.numero, 10);
    if (!numero || isNaN(numero)) return true;

    const msAtivacao = dataAtivacao instanceof Date
      ? dataAtivacao.getTime()
      : (dataAtivacao.toDate ? dataAtivacao.toDate().getTime() : Number(dataAtivacao));

    const semanasDesdeAtivacao = Math.floor(
      (Date.now() - msAtivacao) / (7 * 24 * 60 * 60 * 1000)
    );

    return numero <= semanasDesdeAtivacao + 1;
  }

  // ─── Utilitário de Escape ──────────────────────────────────────────────────
  function _esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();