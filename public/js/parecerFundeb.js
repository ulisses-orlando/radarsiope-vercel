/* ==========================================================================
parecerFundeb.js — Radar SIOPE
Wizard de geração do Parecer do CACS Fundeb (frontend)
Ponto de entrada público: window._abrirParecerFundeb()
========================================================================== */
'use strict';

(function () {

  const API = '/api/parecerFundeb';
  const EXERCICIO_ATUAL = new Date().getFullYear();

  // Ative apenas em ambiente local, sem backend ainda no ar.
  // Remover assim que os endpoints reais de /api/parecerFundeb existirem.
  const MODO_DEMO = true;

  // ── Estado do wizard ────────────────────────────────────────────────────
  let _st = _estadoInicial();

  function _estadoInicial() {
    return {
      etapa: 0, // 0 = status, 1 = upload, 2 = revisão, 3 = formulário, 4 = preview
      municipio: null, // { cod, nome, uf }
      exercicio: EXERCICIO_ATUAL,
      versaoAnterior: null, // preenchido em caso de regeração
      pdfFile: null,
      pdfNome: null,
      dadosExtraidos: null,
      avisos: [],
      checksumOk: null,
      forcarContinuar: false,
      form: {
        presidenteNome: '',
        presidenteEmail: '',
        membros: [],
        checklist: [
          { item: 'extrato_bancario_periodo', label: 'Extrato bancário da conta do Fundeb (período)', confirmado: false, observacao: '' },
          { item: 'empenhos_liquidacoes', label: 'Empenhos e liquidações de despesa', confirmado: false, observacao: '' },
          { item: 'atas_reuniao_cacs', label: 'Atas de reunião do CACS referentes ao exercício', confirmado: false, observacao: '' },
        ],
        conclusaoTipo: '',
        conclusaoTexto: '',
      },
      carregandoStatus: false,
      pareceerExistente: null,
      salvando: false,
      resultadoFinal: null,
    };
  }

  // ── Ponto de entrada público ────────────────────────────────────────────
  window._abrirParecerFundeb = async function (cod, nome, uf) {
    const user = window._radarUser;
    if (!user?.uid) { _msg('Faça login para acessar o Parecer Fundeb.'); return; }

    _st = _estadoInicial();
    _st.municipio = {
      cod: cod || user.cod_municipio,
      nome: nome || user.municipio,
      uf: uf || user.cod_uf,
    };
    if (!_st.municipio.cod) { _msg('Município não identificado.'); return; }

    _criarOverlay();
    _render();
    await _carregarStatus();
  };

  // ── Overlay (mesmo padrão do rs-relatorio-overlay) ─────────────────────
  function _criarOverlay() {
    const existente = document.getElementById('rs-parecer-overlay');
    if (existente) existente.remove();

    _injetarCSS();

    const overlay = document.createElement('div');
    overlay.id = 'rs-parecer-overlay';
    overlay.innerHTML = `
      <div class="pf-barra">
        <span class="pf-barra-titulo">⚖️ Parecer Fundeb</span>
        <button id="pf-fechar" class="pf-btn-fechar" aria-label="Fechar">✕</button>
      </div>
      <div id="pf-stepper" class="pf-stepper"></div>
      <div id="pf-corpo" class="pf-corpo"></div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('pf-fechar').addEventListener('click', _fechar);
    document.addEventListener('keydown', _escFecha);
  }

  function _escFecha(e) {
    if (e.key === 'Escape') _fechar();
  }

  function _fechar() {
    document.getElementById('rs-parecer-overlay')?.remove();
    document.removeEventListener('keydown', _escFecha);
  }

  // ── Render geral ─────────────────────────────────────────────────────────
  function _render() {
    _renderStepper();
    const corpo = document.getElementById('pf-corpo');
    if (!corpo) return;

    switch (_st.etapa) {
      case 0: corpo.innerHTML = _telaStatus(); _bindStatus(); break;
      case 1: corpo.innerHTML = _telaUpload(); _bindUpload(); break;
      case 2: corpo.innerHTML = _telaRevisao(); _bindRevisao(); break;
      case 3: corpo.innerHTML = _telaFormulario(); _bindFormulario(); break;
      case 4: corpo.innerHTML = _telaPreview(); _bindPreview(); break;
    }
  }

  function _renderStepper() {
    const el = document.getElementById('pf-stepper');
    if (!el) return;
    if (_st.etapa === 0) { el.style.display = 'none'; return; }
    el.style.display = 'flex';

    const nomes = ['Upload', 'Revisão', 'Formulário', 'Confirmação'];
    el.innerHTML = nomes.map((nome, i) => {
      const passo = i + 1;
      const estado = passo === _st.etapa ? 'ativo' : passo < _st.etapa ? 'feito' : '';
      return `
        <div class="pf-step ${estado}">
          <div class="pf-step-bolha">${passo < _st.etapa ? '✓' : passo}</div>
          <div class="pf-step-label">${nome}</div>
        </div>`;
    }).join('<div class="pf-step-linha"></div>');
  }

  // ─────────────────────────────────────────────────────────────────────
  // ETAPA 0 — Status (ponto de entrada)
  // ─────────────────────────────────────────────────────────────────────
  function _telaStatus() {
    if (_st.carregandoStatus) {
      return `<div class="pf-loading">⏳ Verificando parecer do exercício ${_st.exercicio}…</div>`;
    }

    if (_st.pareceerExistente) {
      const p = _st.pareceerExistente;
      return `
        <div class="pf-status-card">
          <div class="pf-status-icone">📄</div>
          <div class="pf-status-titulo">Parecer ${_st.exercicio} já gerado</div>
          <div class="pf-status-sub">Versão ${p.versao} · gerado em ${_fmtData(p.atualizado_em)}</div>
          <div class="pf-status-acoes">
            <button id="pf-ver" class="pf-btn pf-btn-secundario">Ver parecer</button>
            <button id="pf-regerar" class="pf-btn pf-btn-primario">Regerar</button>
          </div>
        </div>`;
    }

    return `
      <div class="pf-status-card">
        <div class="pf-status-icone">⚖️</div>
        <div class="pf-status-titulo">Nenhum parecer gerado para ${_st.exercicio}</div>
        <div class="pf-status-sub">Gere o parecer anual do CACS a partir do demonstrativo do SIOPE.</div>
        <div class="pf-status-acoes">
          <button id="pf-gerar" class="pf-btn pf-btn-primario">Gerar Parecer</button>
        </div>
      </div>`;
  }

  function _bindStatus() {
    document.getElementById('pf-gerar')?.addEventListener('click', () => { _st.etapa = 1; _render(); });
    document.getElementById('pf-regerar')?.addEventListener('click', async () => {
      const p = _st.pareceerExistente;
      if (p) {
        _st.versaoAnterior = p;
        _st.form.presidenteNome = p.presidente_cacs_nome || '';
        _st.form.presidenteEmail = p.presidente_cacs_email || '';
        _st.form.membros = p.membros_cacs || [];
        if (p.checklist_documental?.length) {
          _st.form.checklist = _st.form.checklist.map(item => {
            const anterior = p.checklist_documental.find(c => c.item === item.item);
            return anterior ? { ...item, confirmado: anterior.confirmado, observacao: anterior.observacao } : item;
          });
        }
        _st.form.conclusaoTipo = p.conclusao_tipo || '';
        _st.form.conclusaoTexto = p.conclusao_parecer || '';
      }
      _st.etapa = 1;
      _render();
    });
    document.getElementById('pf-ver')?.addEventListener('click', () => {
      if (_st.pareceerExistente?.url_download) window.open(_st.pareceerExistente.url_download, '_blank');
    });
  }

  async function _carregarStatus() {
    _st.carregandoStatus = true;
    _render();
    try {
      _st.pareceerExistente = await _apiStatus();
    } catch (err) {
      console.error('[ParecerFundeb] Erro ao checar status:', err);
    }
    _st.carregandoStatus = false;
    _render();
  }

  // ─────────────────────────────────────────────────────────────────────
  // ETAPA 1 — Upload
  // ─────────────────────────────────────────────────────────────────────
  function _telaUpload() {
    const urlSiope = 'https://www.fnde.gov.br/siope/demonstrativoFundebMunicipal.do';
    return `
      <div class="pf-etapa">
        <h3 class="pf-etapa-titulo">Envie o demonstrativo do Fundeb</h3>
        <div class="pf-info-box">
          📌 Baixe o PDF no <a href="${urlSiope}" target="_blank" rel="noopener">portal do SIOPE</a>,
          selecionando o <strong>6º bimestre de ${_st.exercicio}</strong> (dados acumulados do exercício).
        </div>

        <div id="pf-dropzone" class="pf-dropzone">
          <input type="file" id="pf-input-pdf" accept="application/pdf" style="display:none">
          <div id="pf-dropzone-conteudo">
            <div class="pf-dropzone-icone">📄</div>
            <div class="pf-dropzone-txt">Arraste o PDF aqui ou <strong>clique para selecionar</strong></div>
          </div>
        </div>

        <div id="pf-upload-resultado"></div>

        <div class="pf-acoes-rodape">
          <button id="pf-voltar" class="pf-btn pf-btn-secundario">Voltar</button>
          <button id="pf-continuar" class="pf-btn pf-btn-primario" disabled>Continuar</button>
        </div>
      </div>`;
  }

  function _bindUpload() {
    const dropzone = document.getElementById('pf-dropzone');
    const input = document.getElementById('pf-input-pdf');

    dropzone.addEventListener('click', () => input.click());
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('pf-drag'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('pf-drag'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('pf-drag');
      const file = e.dataTransfer.files?.[0];
      if (file) _processarUpload(file);
    });
    input.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) _processarUpload(file);
    });

    document.getElementById('pf-voltar').addEventListener('click', () => { _st.etapa = 0; _render(); });
    document.getElementById('pf-continuar').addEventListener('click', () => {
      if (!_st.checksumOk && !_st.forcarContinuar) {
        _msg('Corrija o PDF antes de continuar, ou confirme que deseja prosseguir mesmo assim.');
        return;
      }
      _st.etapa = 2;
      _render();
    });
  }

  async function _processarUpload(file) {
    if (file.type !== 'application/pdf') { _msg('Envie um arquivo PDF.'); return; }

    _st.pdfFile = file;
    _st.pdfNome = file.name;

    const resultadoEl = document.getElementById('pf-upload-resultado');
    resultadoEl.innerHTML = `<div class="pf-loading">⏳ Lendo e validando o PDF…</div>`;
    document.getElementById('pf-continuar').disabled = true;

    try {
      const resp = await _apiUpload(file);
      _st.dadosExtraidos = resp.dados_extraidos;
      _st.avisos = resp.dados_extraidos?.avisos || [];
      _st.checksumOk = resp.dados_extraidos?.checksum_ok;

      const bimestre = resp.dados_extraidos?.bimestre_pdf;
      let avisoBimestre = '';
      if (bimestre && bimestre !== 6) {
        avisoBimestre = `
          <div class="pf-aviso pf-aviso-amarelo">
            ⚠️ Este é o ${bimestre}º bimestre — os dados podem estar incompletos para o exercício ${_st.exercicio}.
            <label class="pf-checkbox-inline">
              <input type="checkbox" id="pf-forcar-continuar"> Desejo continuar mesmo assim
            </label>
          </div>`;
      }

      if (_st.checksumOk) {
        resultadoEl.innerHTML = `
          <div class="pf-aviso pf-aviso-verde">✅ PDF lido com sucesso — os totais conferem.</div>
          ${avisoBimestre}
          <div class="pf-arquivo-nome">📎 ${_esc(_st.pdfNome)}</div>`;
        document.getElementById('pf-continuar').disabled = !!avisoBimestre;
      } else {
        resultadoEl.innerHTML = `
          <div class="pf-aviso pf-aviso-vermelho">
            ❌ Não conseguimos confirmar os totais deste PDF — revise o arquivo ou tente novamente.
            ${_st.avisos.length ? `<ul class="pf-lista-avisos">${_st.avisos.map(a => `<li>${_esc(a)}</li>`).join('')}</ul>` : ''}
          </div>`;
        document.getElementById('pf-continuar').disabled = true;
      }

      document.getElementById('pf-forcar-continuar')?.addEventListener('change', e => {
        _st.forcarContinuar = e.target.checked;
        document.getElementById('pf-continuar').disabled = !e.target.checked;
      });

    } catch (err) {
      console.error('[ParecerFundeb] Erro no upload:', err);
      resultadoEl.innerHTML = `<div class="pf-aviso pf-aviso-vermelho">❌ Erro ao processar o PDF. Tente novamente.</div>`;
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // ETAPA 2 — Revisão dos dados extraídos (read-only)
  // ─────────────────────────────────────────────────────────────────────
  function _telaRevisao() {
    const d = _st.dadosExtraidos || {};
    const limites = d.limites || [];
    const conc = d.conciliacao_bancaria || {};

    return `
      <div class="pf-etapa">
        <h3 class="pf-etapa-titulo">Confira os dados extraídos</h3>
        <div class="pf-info-box">Esses valores vêm direto do PDF oficial e não podem ser editados aqui — confira se o parser leu corretamente antes de seguir.</div>

        <div class="pf-secao-mini">
          <div class="pf-secao-mini-titulo">Limites obrigatórios</div>
          ${limites.map(l => `
            <div class="limite">
              <div class="limite-top">
                <span class="limite-nome">${_esc(_labelLimite(l.item))}</span>
                <span class="badge ${_corBadge(l.status)}">${_labelStatus(l.status)}</span>
              </div>
              <div class="limite-bar-track"><div class="limite-bar-fill ${_corBadge(l.status)}" style="width:${Math.min(100, l.percentual || 0)}%"></div></div>
              <div class="limite-nums">
                <span>Exigido: <b>${_moeda(l.exigido)}</b></span>
                <span>Aplicado: <b>${_moeda(l.aplicado)}</b> (${_pct(l.percentual)})</span>
              </div>
            </div>`).join('')}
        </div>

        <div class="pf-secao-mini">
          <div class="pf-secao-mini-titulo">Conciliação bancária</div>
          <table class="conc">
            <tr><td>Saldo inicial</td><td>${_moeda(conc.saldo_inicial)}</td></tr>
            <tr><td>Ingressos até o bimestre</td><td>${_moeda(conc.ingressos)}</td></tr>
            <tr><td>Pagamentos até o bimestre</td><td>${_moeda(conc.pagamentos)}</td></tr>
            <tr class="total"><td>Saldo conciliado</td><td>${_moeda(conc.saldo_conciliado)}</td></tr>
          </table>
        </div>

        <div class="pf-acoes-rodape">
          <button id="pf-voltar" class="pf-btn pf-btn-secundario">Voltar</button>
          <button id="pf-continuar" class="pf-btn pf-btn-primario">Continuar</button>
        </div>
      </div>`;
  }

  function _bindRevisao() {
    document.getElementById('pf-voltar').addEventListener('click', () => { _st.etapa = 1; _render(); });
    document.getElementById('pf-continuar').addEventListener('click', () => {
      if (!_st.form.conclusaoTexto) _st.form.conclusaoTexto = _sugerirTextoConclusao();
      _st.etapa = 3;
      _render();
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // ETAPA 3 — Formulário manual
  // ─────────────────────────────────────────────────────────────────────
  function _telaFormulario() {
    const f = _st.form;
    const regerando = !!_st.versaoAnterior;

    return `
      <div class="pf-etapa">
        <h3 class="pf-etapa-titulo">Preenchimento do parecer</h3>
        ${regerando ? `<div class="pf-info-box">🔁 Regerando a partir da versão anterior — os campos abaixo já vêm preenchidos, confirme ou ajuste o que for necessário.</div>` : ''}

        <div class="pf-campo">
          <label class="pf-label">Presidente do CACS</label>
          <input type="text" id="pf-presidente-nome" class="pf-input" value="${_esc(f.presidenteNome)}" placeholder="Nome completo">
        </div>
        <div class="pf-campo">
          <label class="pf-label">E-mail do presidente</label>
          <input type="email" id="pf-presidente-email" class="pf-input" value="${_esc(f.presidenteEmail)}" placeholder="email@municipio.gov.br">
        </div>

        <div class="pf-secao-mini">
          <div class="pf-secao-mini-titulo">Checklist de verificação documental</div>
          <div class="pf-info-box">ℹ️ Os dados têm origem em informações autodeclaradas ao SIOPE. Confirme abaixo os documentos que o CACS já verificou.</div>
          ${f.checklist.map((item, i) => `
            <div class="pf-check-item">
              <label class="pf-checkbox-inline">
                <input type="checkbox" data-check-idx="${i}" ${item.confirmado ? 'checked' : ''}>
                ${_esc(item.label)}
              </label>
              <input type="text" class="pf-input pf-input-sm" data-obs-idx="${i}" placeholder="Observação (opcional)" value="${_esc(item.observacao || '')}">
            </div>`).join('')}
        </div>

        <div class="pf-secao-mini">
          <div class="pf-secao-mini-titulo">Conclusão do parecer</div>
          <div class="pf-campo">
            <label class="pf-label">Tipo de conclusão</label>
            <select id="pf-conclusao-tipo" class="pf-input">
              <option value="">Selecione…</option>
              <option value="aprovado" ${f.conclusaoTipo === 'aprovado' ? 'selected' : ''}>Aprovado</option>
              <option value="aprovado_com_ressalvas" ${f.conclusaoTipo === 'aprovado_com_ressalvas' ? 'selected' : ''}>Aprovado com ressalvas</option>
              <option value="reprovado" ${f.conclusaoTipo === 'reprovado' ? 'selected' : ''}>Reprovado</option>
            </select>
          </div>
          <div class="pf-campo">
            <label class="pf-label">Texto da conclusão</label>
            <textarea id="pf-conclusao-texto" class="pf-input pf-textarea" rows="5">${_esc(f.conclusaoTexto)}</textarea>
          </div>
        </div>

        <div class="pf-acoes-rodape">
          <button id="pf-voltar" class="pf-btn pf-btn-secundario">Voltar</button>
          <button id="pf-continuar" class="pf-btn pf-btn-primario">Revisar e gerar</button>
        </div>
      </div>`;
  }

  function _bindFormulario() {
    document.getElementById('pf-presidente-nome').addEventListener('input', e => _st.form.presidenteNome = e.target.value);
    document.getElementById('pf-presidente-email').addEventListener('input', e => _st.form.presidenteEmail = e.target.value);
    document.getElementById('pf-conclusao-tipo').addEventListener('change', e => _st.form.conclusaoTipo = e.target.value);
    document.getElementById('pf-conclusao-texto').addEventListener('input', e => _st.form.conclusaoTexto = e.target.value);

    document.querySelectorAll('[data-check-idx]').forEach(el => {
      el.addEventListener('change', e => {
        _st.form.checklist[+e.target.dataset.checkIdx].confirmado = e.target.checked;
      });
    });
    document.querySelectorAll('[data-obs-idx]').forEach(el => {
      el.addEventListener('input', e => {
        _st.form.checklist[+e.target.dataset.obsIdx].observacao = e.target.value;
      });
    });

    document.getElementById('pf-voltar').addEventListener('click', () => { _st.etapa = 2; _render(); });
    document.getElementById('pf-continuar').addEventListener('click', () => {
      if (!_st.form.presidenteNome || !_st.form.presidenteEmail) {
        _msg('Informe o nome e o e-mail do presidente do CACS.');
        return;
      }
      if (!_st.form.conclusaoTipo) {
        _msg('Selecione o tipo de conclusão do parecer.');
        return;
      }
      _st.etapa = 4;
      _render();
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // ETAPA 4 — Preview final + confirmação
  // ─────────────────────────────────────────────────────────────────────
  function _telaPreview() {
    return `
      <div class="pf-etapa pf-etapa-preview">
        <h3 class="pf-etapa-titulo">Confira o parecer antes de gerar</h3>
        <div class="pf-preview-wrap">
          <iframe id="pf-preview-iframe" class="pf-preview-iframe"></iframe>
        </div>
        <div class="pf-acoes-rodape">
          <button id="pf-voltar" class="pf-btn pf-btn-secundario" ${_st.salvando ? 'disabled' : ''}>Voltar e ajustar</button>
          <button id="pf-confirmar" class="pf-btn pf-btn-primario" ${_st.salvando ? 'disabled' : ''}>
            ${_st.salvando ? '⏳ Gerando…' : 'Confirmar e Gerar'}
          </button>
        </div>
      </div>`;
  }

  function _bindPreview() {
    const iframe = document.getElementById('pf-preview-iframe');
    iframe.setAttribute('srcdoc', _montarHTMLParecer());

    document.getElementById('pf-voltar').addEventListener('click', () => { _st.etapa = 3; _render(); });
    document.getElementById('pf-confirmar').addEventListener('click', _confirmarGeracao);
  }

  async function _confirmarGeracao() {
    _st.salvando = true;
    _render();
    try {
      const resp = await _apiFinalizar();
      _st.resultadoFinal = resp;
      _mostrarSucesso();
    } catch (err) {
      console.error('[ParecerFundeb] Erro ao finalizar:', err);
      _msg('Não foi possível gerar o parecer. Tente novamente.');
      _st.salvando = false;
      _render();
    }
  }

  function _mostrarSucesso() {
    const corpo = document.getElementById('pf-corpo');
    const r = _st.resultadoFinal;
    corpo.innerHTML = `
      <div class="pf-etapa">
        <div class="pf-status-card">
          <div class="pf-status-icone">✅</div>
          <div class="pf-status-titulo">Parecer gerado com sucesso</div>
          <div class="pf-status-sub">
            ${r?.enviado_email ? `Enviado por e-mail para ${_esc(_st.form.presidenteEmail)}.` : 'Disponível para download abaixo.'}
          </div>
          <div class="pf-status-acoes">
            <button id="pf-abrir-final" class="pf-btn pf-btn-primario">Abrir / Baixar parecer</button>
            <button id="pf-fechar-final" class="pf-btn pf-btn-secundario">Fechar</button>
          </div>
        </div>
      </div>`;
    document.getElementById('pf-stepper').style.display = 'none';

    document.getElementById('pf-abrir-final').addEventListener('click', () => {
      window.open(r?.url_download || '#', '_blank');
    });
    document.getElementById('pf-fechar-final').addEventListener('click', _fechar);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Montagem do HTML final do parecer (mesmo template aprovado)
  // ─────────────────────────────────────────────────────────────────────
  function _montarHTMLParecer() {
    const d = _st.dadosExtraidos || {};
    const f = _st.form;
    const m = _st.municipio;
    const limites = d.limites || [];
    const conc = d.conciliacao_bancaria || {};
    const dataGeracao = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const corSelo = f.conclusaoTipo === 'aprovado' ? '#dcfce7'
      : f.conclusaoTipo === 'reprovado' ? '#fee2e2' : '#fef9c3';
    const fgSelo = f.conclusaoTipo === 'aprovado' ? '#166534'
      : f.conclusaoTipo === 'reprovado' ? '#991b1b' : '#854d0e';
    const labelSelo = f.conclusaoTipo === 'aprovado' ? '✅ Aprovado'
      : f.conclusaoTipo === 'reprovado' ? '❌ Reprovado' : '⚠ Aprovado com ressalvas';

    const linhasLimites = limites.map(l => `
      <div class="limite">
        <div class="limite-top">
          <span class="limite-nome">${_esc(_labelLimite(l.item))}</span>
          <span class="badge ${_corBadge(l.status)}">${_labelStatus(l.status)}</span>
        </div>
        <div class="limite-bar-track"><div class="limite-bar-fill ${_corBadge(l.status)}" style="width:${Math.min(100, l.percentual || 0)}%"></div></div>
        <div class="limite-nums"><span>Exigido: <b>${_moeda(l.exigido)}</b></span><span>Aplicado: <b>${_moeda(l.aplicado)}</b> (${_pct(l.percentual)})</span></div>
      </div>`).join('');

    const linhasAlertas = limites.filter(l => l.status !== 'cumprido').map(l => `
      <li class="alert-item ${l.status === 'nao_cumprido' ? 'vermelho' : 'amarelo'}">
        <span class="alert-dot"></span>
        <span><strong>${_esc(_labelLimite(l.item))}:</strong> ${_pct(l.percentual)} — ${_labelStatus(l.status).toLowerCase()}.</span>
      </li>`).join('') || '<li class="alert-item" style="background:#dcfce7"><span>✅ Nenhum ponto de atenção identificado.</span></li>';

    const linhasChecklist = f.checklist.map(c => `
      <div class="check-item">
        <div class="check-box ${c.confirmado ? 'on' : ''}"></div>
        <div><div class="check-label">${_esc(c.label)}</div><div class="check-obs">${_esc(c.observacao) || '—'}</div></div>
      </div>`).join('');

    const linhasAssinaturas = [{ nome: f.presidenteNome, papel: 'Presidente do CACS' }, ...f.membros.map(mb => ({ nome: mb.nome, papel: mb.cargo || 'Membro do CACS' }))]
      .map(s => `<div class="sign-slot"><div class="sign-line"></div><div class="sign-name">${_esc(s.nome)}</div><div class="sign-role">${_esc(s.papel)}</div></div>`).join('');

    // CSS idêntico ao arquivo parecer-fundeb-template.html — mantido em sincronia manualmente.
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&display=swap">
<style>${_cssParecerFinal()}</style></head><body>
<div class="pagina">
  <div class="cabecalho">
    <div class="cabecalho-logo">
      <div class="logo-icone"><img src="/icons/icon-192x192-transparent.png" alt="Radar SIOPE" onerror="this.style.display='none'"></div>
      <div class="logo-texto"><div class="marca">Radar SIOPE</div><div class="sub">radarsiope.com.br</div></div>
    </div>
    <div class="cabecalho-direita">
      <button class="btn-imprimir" onclick="window.print()">🖨️ Imprimir / PDF</button>
      <div class="cabecalho-titulo">PARECER DO CACS FUNDEB ${_st.exercicio}</div>
      <div class="cabecalho-data">Gerado em: ${dataGeracao}</div>
    </div>
  </div>
  <div class="faixa-mun">
    <div class="faixa-mun-esq"><div class="faixa-mun-nome">${_esc(m.nome)} / ${_esc(m.uf)}</div><div class="faixa-mun-cod">Base: 6º Bimestre/${_st.exercicio} (SIOPE)</div></div>
    <div class="faixa-mun-dir"><div class="faixa-mun-asin">Exercício ${_st.exercicio}</div><div class="faixa-mun-plano">Conselho de Acompanhamento e Controle Social do Fundeb</div></div>
  </div>
  <div class="title-block">
    <div class="title-eyebrow">Análise das contas do Fundeb</div>
    <h1 class="title-main">Parecer sobre a Execução dos Recursos do Fundeb</h1>
    <p class="title-sub">Exercício <strong>${_st.exercicio}</strong> · Município de <strong>${_esc(m.nome)} — ${_esc(m.uf)}</strong></p>
  </div>
  <div class="corpo">
    <div class="secao"><div class="secao-titulo"><span class="secao-num">01</span> Identificação</div>
      <div class="grid-2">
        <div class="field"><span class="field-label">Município</span><span class="field-value">${_esc(m.nome)} — ${_esc(m.uf)}</span></div>
        <div class="field"><span class="field-label">Exercício de referência</span><span class="field-value">${_st.exercicio}</span></div>
        <div class="field"><span class="field-label">Presidente do CACS</span><span class="field-value">${_esc(f.presidenteNome)}</span></div>
        <div class="field"><span class="field-label">E-mail do presidente</span><span class="field-value">${_esc(f.presidenteEmail)}</span></div>
      </div>
    </div>
    <div class="secao"><div class="secao-titulo"><span class="secao-num">02</span> Fonte dos dados</div>
      <div class="source-note"><span>📄</span><span>Os dados deste parecer foram extraídos do <strong>Quadro Demonstrativo das Receitas e Despesas com o Fundeb</strong>, emitido pelo SIOPE/FNDE, arquivo <strong>${_esc(_st.pdfNome || '')}</strong>, anexado pelo gestor em ${dataGeracao}.</span></div>
    </div>
    <div class="secao"><div class="secao-titulo"><span class="secao-num">03</span> Análise dos limites obrigatórios</div>${linhasLimites}</div>
    <div class="secao"><div class="secao-titulo"><span class="secao-num">04</span> Disponibilidade financeira e conciliação bancária</div>
      <table class="conc">
        <tr><td>Disponibilidade financeira inicial</td><td>${_moeda(conc.saldo_inicial)}</td></tr>
        <tr><td>(+) Ingresso de recursos até o bimestre</td><td>${_moeda(conc.ingressos)}</td></tr>
        <tr><td>(−) Pagamentos efetuados até o bimestre</td><td>${_moeda(conc.pagamentos)}</td></tr>
        <tr><td>(+) Ajustes positivos</td><td>${_moeda(conc.ajustes_positivos)}</td></tr>
        <tr><td>(−) Ajustes negativos</td><td>${_moeda(conc.ajustes_negativos)}</td></tr>
        <tr class="total"><td>Saldo financeiro conciliado</td><td>${_moeda(conc.saldo_conciliado)}</td></tr>
      </table>
    </div>
    <div class="secao"><div class="secao-titulo"><span class="secao-num">05</span> Pontos de atenção</div><ul class="alert-list">${linhasAlertas}</ul></div>
    <div class="secao"><div class="secao-titulo"><span class="secao-num">06</span> Checklist de verificação documental</div>
      <div class="source-note" style="margin-bottom:8px;"><span>ℹ️</span><span>Os valores acima têm origem em <strong>dados autodeclarados pelo município ao SIOPE</strong>. O CACS confirmou os itens abaixo contra os documentos primários.</span></div>
      <div class="checklist">${linhasChecklist}</div>
    </div>
    <div class="secao"><div class="secao-titulo"><span class="secao-num">07</span> Conclusão do parecer</div>
      <div class="conclusao-selo" style="background:${corSelo};color:${fgSelo}">${labelSelo}</div>
      <p class="conclusao-texto">${_esc(f.conclusaoTexto).replace(/\n/g, '<br>')}</p>
    </div>
    <div class="secao"><div class="secao-titulo"><span class="secao-num">08</span> Assinaturas</div><div class="sign-grid">${linhasAssinaturas}</div></div>
  </div>
  <div class="rodape">
    <div class="rodape-aviso"><strong>⚠️ Nota:</strong> os dados constantes neste parecer têm por base as informações declaradas pelo município ao SIOPE, de responsabilidade do Poder Executivo local. O CACS, a seu critério, poderá solicitar documentos contábeis, orçamentários e financeiros complementares que julgar necessários para a análise das contas do Fundeb. Este documento não substitui a fiscalização exercida pelo Conselho nem pelos órgãos de controle externo.</div>
    <div class="rodape-verif"><div class="rodape-url">radarsiope.com.br</div><div class="cod">ID: ${_hashVerif(m.cod, _st.exercicio)}</div></div>
  </div>
</div>
</body></html>`;
  }

  function _cssParecerFinal() {
    // Idêntico ao <style> de parecer-fundeb-template.html
    return `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body{font-family:'Sora','Segoe UI',system-ui,sans-serif;font-size:12px;color:#1e293b;background:#f8fafc;line-height:1.5}
    .pagina{width:210mm;min-height:297mm;margin:0 auto;background:#fff;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,.12)}
    .cabecalho{background:linear-gradient(135deg,#0A3D62 0%,#1a5c91 100%);color:#fff;padding:14px 20px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px}
    .cabecalho-logo{display:flex;align-items:center;gap:10px}
    .logo-icone img{width:36px;height:36px;object-fit:contain}
    .logo-texto .marca{font-size:15px;font-weight:700}
    .logo-texto .sub{font-size:9.5px;opacity:.75}
    .cabecalho-direita{text-align:right;display:flex;flex-direction:column;gap:6px}
    .cabecalho-titulo{font-size:13px;font-weight:700;letter-spacing:.5px}
    .cabecalho-data{font-size:9.5px;opacity:.75}
    .btn-imprimir{background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.3);color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;align-self:flex-end}
    .faixa-mun{background:#e8f0f7;border-bottom:2px solid #0A3D62;padding:8px 20px;display:flex;justify-content:space-between;gap:16px}
    .faixa-mun-nome{font-size:14px;font-weight:700;color:#0A3D62}
    .faixa-mun-cod{font-size:10px;color:#475569}
    .faixa-mun-dir{text-align:right}
    .faixa-mun-asin{font-size:11.5px;font-weight:600}
    .faixa-mun-plano{font-size:10px;color:#64748b}
    .title-block{text-align:center;padding:20px 20px 16px;border-bottom:1.5px solid #dbeafe}
    .title-eyebrow{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#0A3D62;font-weight:700;margin-bottom:8px}
    .title-main{font-size:18px;font-weight:700;margin:0 0 4px}
    .title-sub{font-size:11px;color:#64748b}
    .corpo{flex:1;padding:12px 20px 10px;display:flex;flex-direction:column;gap:14px}
    .secao{display:flex;flex-direction:column;gap:8px}
    .secao-titulo{display:flex;gap:8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#0A3D62;border-bottom:1.5px solid #dbeafe;padding-bottom:3px}
    .secao-num{color:#64748b}
    .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px 20px}
    .field-label{display:block;font-size:9.5px;text-transform:uppercase;color:#64748b;margin-bottom:2px}
    .field-value{font-weight:600}
    .source-note{display:flex;gap:10px;background:#e8f0f7;border:1px solid #dbeafe;border-radius:6px;padding:10px 12px;font-size:10.5px;color:#475569}
    .limite{border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px}
    .limite-top{display:flex;justify-content:space-between;margin-bottom:6px;gap:10px}
    .limite-nome{font-size:11px;font-weight:600}
    .badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:600;white-space:nowrap}
    .badge.verde{background:#dcfce7;color:#166534}
    .badge.vermelho{background:#fee2e2;color:#991b1b}
    .badge.amarelo{background:#fef9c3;color:#854d0e}
    .limite-bar-track{height:6px;border-radius:4px;background:#e2e8f0;overflow:hidden;margin-bottom:6px}
    .limite-bar-fill{height:100%}
    .limite-bar-fill.verde{background:#16a34a}
    .limite-bar-fill.amarelo{background:#d97706}
    .limite-bar-fill.vermelho{background:#dc2626}
    .limite-nums{display:flex;justify-content:space-between;font-size:10.5px;color:#64748b}
    .limite-nums b{color:#1e293b}
    table.conc{width:100%;border-collapse:collapse;font-size:11px}
    table.conc td{padding:6px 4px;border-bottom:1px solid #e2e8f0}
    table.conc td:last-child{text-align:right;font-weight:600}
    table.conc tr.total td{border-top:2px solid #0A3D62;border-bottom:none;padding-top:8px}
    .alert-list{list-style:none;display:flex;flex-direction:column;gap:6px}
    .alert-item{display:flex;gap:8px;font-size:11px;padding:8px 10px;border-radius:6px}
    .alert-item.amarelo{background:#fef9c3}
    .alert-item.vermelho{background:#fee2e2}
    .alert-dot{width:7px;height:7px;border-radius:50%;margin-top:4px;background:#991b1b}
    .checklist{display:flex;flex-direction:column;gap:10px}
    .check-item{display:flex;gap:10px;padding-bottom:10px;border-bottom:1px dashed #e2e8f0}
    .check-box{width:16px;height:16px;border:1.5px solid #64748b;border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .check-box.on{background:#0A3D62;border-color:#0A3D62}
    .check-box.on::after{content:"✓";color:#fff;font-size:11px}
    .check-label{font-size:11px;font-weight:600}
    .check-obs{font-size:10px;color:#64748b}
    .conclusao-selo{display:inline-flex;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:10px}
    .conclusao-texto{font-size:11.5px;line-height:1.7;color:#374151}
    .sign-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:6px}
    .sign-slot{text-align:center}
    .sign-line{border-top:1px solid #1e293b;margin-bottom:6px;height:30px}
    .sign-name{font-size:11px;font-weight:600}
    .sign-role{font-size:9.5px;color:#64748b}
    .rodape{background:#f1f5f9;border-top:1px solid #e2e8f0;padding:8px 20px;display:flex;justify-content:space-between;gap:12px}
    .rodape-aviso{font-size:9px;color:#64748b;max-width:72%}
    .rodape-url{font-size:9px;color:#0A3D62;font-weight:600}
    .rodape-verif .cod{font-size:9px;color:#94a3b8;font-family:monospace}
    @media print{ .pagina{width:100%;box-shadow:none} @page{size:A4 portrait;margin:0} .btn-imprimir{display:none!important} .secao,.limite{page-break-inside:avoid} }
    `;
  }

  // ─────────────────────────────────────────────────────────────────────
  // API (com fallback de demonstração enquanto o backend não existe)
  // ─────────────────────────────────────────────────────────────────────
  async function _apiStatus() {
    if (MODO_DEMO) { await _delay(400); return null; }
    const resp = await fetch(`${API}?acao=status&cod_municipio=${_st.municipio.cod}&exercicio=${_st.exercicio}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.error || 'Erro ao checar status');
    return dados.existe ? dados.parecer : null;
  }

  async function _apiUpload(file) {
    if (MODO_DEMO) {
      await _delay(900);
      return _mockDadosExtraidos();
    }
    const user = window._radarUser;
    const formData = new FormData();
    formData.append('pdf', file);
    formData.append('uid', user.uid);
    formData.append('cod_municipio', _st.municipio.cod);
    formData.append('exercicio', _st.exercicio);

    const resp = await fetch(`${API}?acao=upload`, { method: 'POST', body: formData });
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.error || 'Erro ao processar PDF');
    return dados;
  }

  async function _apiFinalizar() {
    if (MODO_DEMO) {
      await _delay(1000);
      return { ok: true, url_download: '#', enviado_email: true };
    }
    const user = window._radarUser;
    const resp = await fetch(`${API}?acao=finalizar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: user.uid,
        cod_municipio: _st.municipio.cod,
        exercicio: _st.exercicio,
        dados_extraidos: _st.dadosExtraidos,
        presidente_cacs_nome: _st.form.presidenteNome,
        presidente_cacs_email: _st.form.presidenteEmail,
        membros_cacs: _st.form.membros,
        checklist_documental: _st.form.checklist,
        conclusao_tipo: _st.form.conclusaoTipo,
        conclusao_parecer: _st.form.conclusaoTexto,
      }),
    });
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.error || 'Erro ao finalizar parecer');
    return dados;
  }

  function _mockDadosExtraidos() {
    return {
      dados_extraidos: {
        bimestre_pdf: 6,
        exercicio_pdf: _st.exercicio,
        checksum_ok: true,
        avisos: [],
        conciliacao_bancaria: {
          saldo_inicial: 1257390.09, ingressos: 5128470.96, pagamentos: 3747249.55,
          ajustes_positivos: 247458.11, ajustes_negativos: 0, saldo_conciliado: 2886069.61,
        },
        limites: [
          { item: 'remuneracao_70', exigido: 3360065.72, aplicado: 4491945.46, percentual: 93.58, status: 'cumprido' },
          { item: 'iei_educacao_infantil', exigido: 0, aplicado: 671399.44, percentual: 94.23, status: 'cumprido' },
          { item: 'capital_15', exigido: 106874.86, aplicado: 63603.20, percentual: 8.93, status: 'nao_cumprido' },
          { item: 'max_10_nao_aplicado', exigido: 512847.10, aplicado: 489403.87, percentual: 95.4, status: 'atencao' },
          { item: 'fomento_eti_4', exigido: 205138.84, aplicado: 0, percentual: 0, status: 'nao_cumprido' },
        ],
      },
    };
  }

  // ── Helpers de formatação/label ─────────────────────────────────────────
  function _labelLimite(item) {
    const mapa = {
      remuneracao_70: 'Mínimo 70% — Remuneração dos Profissionais da Educação Básica',
      iei_educacao_infantil: 'Indicador IEI — Complementação VAAT na Educação Infantil',
      capital_15: 'Mínimo 15% — Complementação VAAT em Despesas de Capital',
      max_10_nao_aplicado: 'Máximo 10% — Receitas não aplicadas no exercício',
      fomento_eti_4: 'Mínimo 4% — Recursos aplicados em Fomento ETI',
    };
    return mapa[item] || item;
  }
  function _labelStatus(s) {
    return { cumprido: 'Cumprido', nao_cumprido: 'Não cumprido', atencao: 'Atenção', indefinido: 'Indefinido' }[s] || s;
  }
  function _corBadge(s) {
    return { cumprido: 'verde', nao_cumprido: 'vermelho', atencao: 'amarelo' }[s] || 'cinza';
  }
  function _sugerirTextoConclusao() {
    const limites = _st.dadosExtraidos?.limites || [];
    const problemas = limites.filter(l => l.status !== 'cumprido').map(l => _labelLimite(l.item));
    if (problemas.length === 0) {
      _st.form.conclusaoTipo = 'aprovado';
      return 'O Conselho de Acompanhamento e Controle Social do Fundeb, após análise do Quadro Demonstrativo e verificação documental complementar, conclui pela aprovação das contas, tendo em vista o cumprimento de todos os limites obrigatórios do exercício.';
    }
    _st.form.conclusaoTipo = 'aprovado_com_ressalvas';
    return `O Conselho de Acompanhamento e Controle Social do Fundeb, após análise do Quadro Demonstrativo e verificação documental complementar, conclui pela aprovação das contas com ressalvas, tendo em vista o não cumprimento de: ${problemas.join(', ')}. Recomenda-se à gestão a regularização desses itens no exercício corrente.`;
  }
  function _moeda(v) {
    if (v === null || v === undefined) return '—';
    return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  function _pct(v) {
    if (v === null || v === undefined) return '—';
    return `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }
  function _fmtData(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
    catch { return '—'; }
  }
  function _esc(s) {
    return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
  }
  function _hashVerif(cod, exercicio) {
    const str = `${cod || ''}|${exercicio}|PF`;
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return `RS-PF-${h.toString(16).toUpperCase().padStart(8, '0')}`;
  }
  function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
  function _msg(texto) {
    if (typeof mostrarMensagem === 'function') mostrarMensagem(texto);
    else alert(texto);
  }

  // ── CSS do wizard ────────────────────────────────────────────────────────
  function _injetarCSS() {
    if (document.getElementById('pf-css')) return;
    const style = document.createElement('style');
    style.id = 'pf-css';
    style.textContent = `
      #rs-parecer-overlay {
        position: fixed; inset: 0; z-index: 9999;
        background: #f8fafc; display: flex; flex-direction: column;
        font-family: 'Sora', 'Segoe UI', system-ui, sans-serif;
      }
      .pf-barra {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 18px; background: linear-gradient(135deg, #0A3D62 0%, #1a5c91 100%);
        color: #fff; flex-shrink: 0;
      }
      .pf-barra-titulo { font-weight: 700; font-size: 15px; }
      .pf-btn-fechar { background: none; border: none; color: #fff; font-size: 22px; cursor: pointer; line-height: 1; }

      .pf-stepper { display: flex; align-items: center; justify-content: center; gap: 4px; padding: 16px 12px; background: #fff; border-bottom: 1px solid #e2e8f0; flex-shrink: 0; }
      .pf-step { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 64px; }
      .pf-step-bolha { width: 26px; height: 26px; border-radius: 50%; background: #e2e8f0; color: #64748b; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
      .pf-step.ativo .pf-step-bolha { background: #0A3D62; color: #fff; }
      .pf-step.feito .pf-step-bolha { background: #16a34a; color: #fff; }
      .pf-step-label { font-size: 9.5px; color: #64748b; text-align: center; }
      .pf-step.ativo .pf-step-label { color: #0A3D62; font-weight: 700; }
      .pf-step-linha { width: 24px; height: 2px; background: #e2e8f0; margin-top: 13px; }

      .pf-corpo { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 20px 16px 60px; }
      .pf-etapa { max-width: 620px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
      .pf-etapa-titulo { font-size: 16px; font-weight: 700; color: #1e293b; }

      .pf-info-box { background: #e8f0f7; border: 1px solid #dbeafe; border-radius: 8px; padding: 10px 12px; font-size: 12.5px; color: #334155; line-height: 1.5; }
      .pf-info-box a { color: #0A3D62; font-weight: 600; }

      .pf-loading { text-align: center; padding: 30px; color: #64748b; font-size: 13px; }

      .pf-status-card { max-width: 420px; margin: 40px auto; text-align: center; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px 24px; }
      .pf-status-icone { font-size: 36px; margin-bottom: 10px; }
      .pf-status-titulo { font-size: 16px; font-weight: 700; color: #1e293b; margin-bottom: 4px; }
      .pf-status-sub { font-size: 12.5px; color: #64748b; margin-bottom: 20px; }
      .pf-status-acoes { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }

      .pf-btn { padding: 10px 18px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; border: none; font-family: inherit; }
      .pf-btn-primario { background: #0A3D62; color: #fff; }
      .pf-btn-primario:hover { background: #0d4d7a; }
      .pf-btn-primario:disabled { background: #94a3b8; cursor: not-allowed; }
      .pf-btn-secundario { background: #f1f5f9; color: #334155; }
      .pf-btn-secundario:hover { background: #e2e8f0; }

      .pf-dropzone { border: 2px dashed #cbd5e1; border-radius: 10px; padding: 36px 20px; text-align: center; cursor: pointer; background: #fff; transition: border-color .15s, background .15s; }
      .pf-dropzone:hover, .pf-dropzone.pf-drag { border-color: #0A3D62; background: #f0f6fb; }
      .pf-dropzone-icone { font-size: 30px; margin-bottom: 8px; }
      .pf-dropzone-txt { font-size: 12.5px; color: #475569; }

      .pf-aviso { border-radius: 8px; padding: 10px 12px; font-size: 12px; line-height: 1.5; margin-top: 8px; }
      .pf-aviso-verde { background: #dcfce7; color: #166534; }
      .pf-aviso-amarelo { background: #fef9c3; color: #854d0e; }
      .pf-aviso-vermelho { background: #fee2e2; color: #991b1b; }
      .pf-lista-avisos { margin: 6px 0 0 18px; }
      .pf-arquivo-nome { font-size: 11.5px; color: #64748b; margin-top: 6px; }
      .pf-checkbox-inline { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 11.5px; cursor: pointer; }

      .pf-secao-mini { display: flex; flex-direction: column; gap: 8px; }
      .pf-secao-mini-titulo { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: #0A3D62; border-bottom: 1.5px solid #dbeafe; padding-bottom: 4px; }

      .pf-campo { display: flex; flex-direction: column; gap: 4px; }
      .pf-label { font-size: 11px; font-weight: 600; color: #475569; }
      .pf-input { padding: 9px 11px; border: 1px solid #cbd5e1; border-radius: 7px; font-size: 12.5px; font-family: inherit; background: #fff; }
      .pf-input:focus { outline: none; border-color: #0A3D62; }
      .pf-input-sm { margin-top: 4px; }
      .pf-textarea { resize: vertical; }

      .pf-check-item { display: flex; flex-direction: column; gap: 4px; padding: 10px 0; border-bottom: 1px dashed #e2e8f0; }

      .pf-acoes-rodape { display: flex; justify-content: space-between; gap: 10px; margin-top: 10px; padding-top: 14px; border-top: 1px solid #e2e8f0; }

      .pf-etapa-preview { max-width: 900px; }
      .pf-preview-wrap { background: #e2e8f0; border-radius: 10px; overflow: hidden; height: 60vh; min-height: 420px; }
      .pf-preview-iframe { width: 100%; height: 100%; border: none; }

      .badge { display: inline-block; padding: 2px 9px; border-radius: 20px; font-size: 10px; font-weight: 600; white-space: nowrap; }
      .badge.verde { background: #dcfce7; color: #166534; }
      .badge.vermelho { background: #fee2e2; color: #991b1b; }
      .badge.amarelo { background: #fef9c3; color: #854d0e; }
      .badge.cinza { background: #f1f5f9; color: #64748b; }
      .limite { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; background: #fff; }
      .limite-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; gap: 10px; }
      .limite-nome { font-size: 11.5px; font-weight: 600; color: #1e293b; }
      .limite-bar-track { height: 6px; border-radius: 4px; background: #e2e8f0; overflow: hidden; margin-bottom: 6px; }
      .limite-bar-fill { height: 100%; border-radius: 4px; }
      .limite-bar-fill.verde { background: #16a34a; }
      .limite-bar-fill.amarelo { background: #d97706; }
      .limite-bar-fill.vermelho { background: #dc2626; }
      .limite-nums { display: flex; justify-content: space-between; font-size: 10.5px; color: #64748b; }
      .limite-nums b { color: #1e293b; }
      table.conc { width: 100%; border-collapse: collapse; font-size: 11.5px; background: #fff; }
      table.conc td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; }
      table.conc td:last-child { text-align: right; font-weight: 600; color: #1e293b; }
      table.conc tr.total td { border-top: 2px solid #0A3D62; }

      @media (max-width: 640px) {
        .pf-status-acoes { flex-direction: column; }
        .pf-acoes-rodape { flex-direction: column-reverse; }
        .pf-acoes-rodape .pf-btn { width: 100%; }
      }
    `;
    document.head.appendChild(style);
  }

})();
