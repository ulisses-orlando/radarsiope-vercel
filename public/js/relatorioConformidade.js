/* ==========================================================================
relatorioConformidade.js — Radar SIOPE
Geração do Relatório de Conformidade Municipal (frontend)
Funções públicas:
gerarRelatorioConformidade(cod, nome, uf)  → chamada pelo botão
_injetarBotaoRelatorio(cod, nome, uf)      → chamada por renderMunicipio()
========================================================================== */
'use strict';

// ─── Ponto de entrada público ─────────────────────────────────────────────────
async function gerarRelatorioConformidade() {
  const btn = document.getElementById('btn-relatorio-conformidade');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Gerando…'; }

  try {
    const user = window._radarUser;
    if (!user?.uid) throw new Error('Usuário não autenticado.');

    // ✅ LÊ EXCLUSIVAMENTE DO DATASET
    const codMun = btn?.dataset?.cod;
    console.log('[Relatório] codMun lido:', codMun);

    if (!codMun || codMun === 'undefined' || codMun === '') {
      throw new Error('Município não identificado. Selecione um município válido.');
    }

    const resp = await fetch('/api/sendViaSES?acao=relatorio_conformidade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: user.uid, cod_municipio: codMun }),
    });

    let dados;
    const textoResposta = await resp.text();
    try { dados = JSON.parse(textoResposta); } 
    catch { throw new Error('Erro interno no servidor.'); }

    if (!dados.ok) {
      const msg = dados.error || 'Erro ao gerar relatório.';
      if (typeof mostrarMensagem === 'function') mostrarMensagem(msg);
      else alert(msg);
      return;
    }

    const html = _montarHTMLRelatorio(dados);
    const win = window.open('', '_blank');
    if (!win) {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return;
    }

    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch (err) {
    console.error('[Relatório] Erro:', err);
    if (typeof mostrarMensagem === 'function') mostrarMensagem('Não foi possível gerar o relatório.');
    else alert('Não foi possível gerar o relatório.');
  } finally {
    const btn = document.getElementById('btn-relatorio-conformidade');
    if (btn) { btn.disabled = false; btn.innerHTML = '📋 Relatório de Conformidade'; }
  }
}

// ─── Injeta o botão no DOM ─────────────────────────────────────────────────────
function _injetarBotaoRelatorio(cod, nome, uf, temRelatorio) {
  document.getElementById('rs-acoes-municipio')?.remove();
  const btnHistorico = document.getElementById('btn-toggle-historico');
  if (!btnHistorico) return;

  const grupo = document.createElement('div');
  grupo.id = 'rs-acoes-municipio';
  grupo.style.cssText = 'display:flex; gap:8px; margin-top:8px; width:100%;';
  btnHistorico.style.flex = '1';
  btnHistorico.parentNode.insertBefore(grupo, btnHistorico);
  grupo.appendChild(btnHistorico);

  const btnRel = document.createElement('button');
  btnRel.id = 'btn-relatorio-conformidade';
  
  // ✅ CORREÇÃO: Grava os dados NO botão no momento da criação
  btnRel.dataset.cod = String(cod || '');
  btnRel.dataset.nome = String(nome || '');
  btnRel.dataset.uf = String(uf || '');

  if (temRelatorio) {
    btnRel.innerHTML = '📋 Conformidade';
    btnRel.title = 'Gerar Relatório de Conformidade Municipal (PDF)';
    btnRel.style.cssText = 'flex:1;padding:9px 10px;background:var(--azul,#0A3D62);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:opacity .2s;';
    btnRel.addEventListener('mouseover', () => { btnRel.style.opacity = '.85'; });
    btnRel.addEventListener('mouseout',  () => { btnRel.style.opacity = '1'; });
    // ✅ CORREÇÃO: Chama SEM parâmetros. A função lerá diretamente do dataset.
    btnRel.addEventListener('click', () => gerarRelatorioConformidade());
  } else {
    btnRel.innerHTML = '🔒 Conformidade';
    btnRel.title = 'Disponível no plano Profissional';
    btnRel.style.cssText = 'flex:1;padding:9px 10px;background:transparent;color:var(--rs-muted,#94a3b8);border:1.5px dashed var(--rs-borda,#334155);border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:border-color .2s, color .2s;';
    btnRel.addEventListener('mouseover', () => { btnRel.style.borderColor = 'var(--azul,#0A3D62)'; btnRel.style.color = 'var(--rs-texto,#f1f5f9)'; });
    btnRel.addEventListener('mouseout',  () => { btnRel.style.borderColor = 'var(--rs-borda,#334155)'; btnRel.style.color = 'var(--rs-muted,#94a3b8)'; });
    btnRel.addEventListener('click', () => { if (typeof _solicitarUpgrade === 'function') _solicitarUpgrade('relatorio', true); });
  }
  grupo.appendChild(btnRel);
}

// ─── Monta o documento HTML completo do relatório ────────────────────────────
function _montarHTMLRelatorio(d) {
  const { assinante, siope, alertas, quiz, gerado_em } = d;

  const series = siope?.series || [];
  const ultimo = siope?.ultimo || null;
  const anoGeracao = new Date(gerado_em || Date.now()).getFullYear();

  // Uma linha por registro histórico (ano + bimestre se existir)
  const linhasSeries = series.length > 0
    ? series.map(r => {
      const corSit = _corSituacao(r.situacao);
      const sitLabel = _labelSituacao(r.situacao);
      const prazo = r.enviado_no_prazo === true ? '<span class="badge verde">No prazo</span>'
        : r.enviado_no_prazo === false ? '<span class="badge vermelho">Fora do prazo</span>'
          : '—';
      const homol = r.homologado === true ? '<span class="badge verde">✓</span>'
        : r.homologado === false ? '<span class="badge cinza">Não</span>'
          : '—';
      const pctMde = _pct(r.pct_mde_aplicado);
      const corMde = (r.pct_mde_aplicado !== null && r.pct_mde_aplicado < 25)
        ? 'color:#b91c1c;font-weight:700' : '';
      const periodo = r.bimestre ? `${r.ano} · ${r.bimestre}º Bim` : String(r.ano || '—');

      return `
          <tr>
            <td style="font-weight:700;color:#1e3a5f;white-space:nowrap">${periodo}</td>
            <td><span class="badge" style="background:${corSit.bg};color:${corSit.fg}">${sitLabel}</span></td>
            <td>${prazo}</td>
            <td>${homol}</td>
            <td style="${corMde}">${pctMde}</td>
            <td>${_pct(r.pct_fundeb_remuneracao)}</td>
          </tr>`;
    }).join('')
    : `<tr><td colspan="6" style="text-align:center;color:#94a3b8;font-style:italic;padding:12px">
         Nenhum dado disponível para este município.
       </td></tr>`;

  // ── Indicadores financeiros do último bimestre disponível ───────────────────
  const indicadores = ultimo ? `
    <div class="ind-grid">
      ${_indCard('MDE Exigido', _moeda(ultimo.vlr_exigido_mde), '')}
      ${_indCard('MDE Aplicado', _moeda(ultimo.vlr_aplicado_mde), ultimo.pct_mde_aplicado !== null && ultimo.pct_mde_aplicado < 25 ? 'alerta' : 'ok')}
      ${_indCard('% MDE Aplicado', _pct(ultimo.pct_mde_aplicado), ultimo.pct_mde_aplicado !== null && ultimo.pct_mde_aplicado < 25 ? 'alerta' : 'ok')}
      ${_indCard('FUNDEB Remuneração', _pct(ultimo.pct_fundeb_remuneracao), '')}
      ${_indCard('FUNDEB não aplicado', _moeda(ultimo.fundeb_nao_utilizado), ultimo.fundeb_nao_utilizado > 0 ? 'alerta' : '')}
      ${_indCard('Invest./aluno (básica)', _moeda(ultimo.invest_aluno_basica), '')}
      ${_indCard('Saldo FUNDEB', _moeda(ultimo.saldo_fundeb), '')}
      ${_indCard('IDEB Anos Iniciais', _num(ultimo.ideb_iniciais), '')}
    </div>` : '<p class="sem-dados">Indicadores financeiros não disponíveis para o período.</p>';

  // ── Seção de alertas ─────────────────────────────────────────────────────────
  const listaAlertas = alertas?.length
    ? alertas.map(a =>
      `<div class="alerta-item">
           <span class="alerta-icone">${_iconeAlerta(a.tipo)}</span>
           <span class="alerta-txt">${_escHtml(a.titulo)}</span>
           <span class="alerta-data">${_dataAbrev(a.disparado_em)}</span>
         </div>`
    ).join('')
    : '<p class="sem-dados">Nenhum alerta registrado nos últimos 12 meses.</p>';

  // ── Seção de quiz ────────────────────────────────────────────────────────────
  const qTotal = quiz?.edicoes_com_quiz || 0;
  const qRespondidas = quiz?.edicoes_respondidas || 0;
  const qTaxa = quiz?.taxa_participacao || 0;
  const qMedia = quiz?.media_pontuacao;
  const qPct = Math.min(100, qTaxa);
  const qCorBarra = qTaxa >= 80 ? '#16a34a' : qTaxa >= 50 ? '#d97706' : '#dc2626';
  const qMediaTxt = qMedia !== null ? `${qMedia}%` : '—';
  const qCorMedia = qMedia !== null && qMedia >= 70 ? '#16a34a'
    : qMedia !== null && qMedia >= 50 ? '#d97706' : '#dc2626';

  // ── Data e verificação ───────────────────────────────────────────────────────
  const dataGeracao = gerado_em ? new Date(gerado_em).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) : '—';

  const anoRel = new Date(gerado_em || Date.now()).getFullYear();
  const verHash = _hashVerif(assinante?.cod_municipio, gerado_em);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Relatório de Conformidade — ${_escHtml(assinante?.municipio || '')}/${_escHtml(assinante?.uf || '')} — ${anoGeracao}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&display=swap">
  <style>
    /* ── Reset & base ─────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      font-family: 'Sora', 'Segoe UI', system-ui, sans-serif;
      font-size: 12px;
      color: #1e293b;
      background: #f8fafc;
      line-height: 1.45;
    }

    /* ── Página A4 ────────────────────────────────────────────────────── */
    .pagina {
      width: 210mm;
      min-height: 297mm;
      max-height: 297mm;
      margin: 0 auto;
      background: #fff;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 4px 32px rgba(0,0,0,.12);
    }

    /* ── Cabeçalho ───────────────────────────────────────────────────── */
    .cabecalho {
      background: linear-gradient(135deg, #0A3D62 0%, #1a5c91 100%);
      color: #fff;
      padding: 14px 20px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-shrink: 0;
    }
    .cabecalho-logo {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .logo-icone {
      width: 36px; height: 36px;
      background: rgba(255,255,255,0.15);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px;
    }
    .logo-texto { line-height: 1.15; }
    .logo-texto .marca { font-size: 15px; font-weight: 700; letter-spacing: .3px; }
    .logo-texto .sub   { font-size: 9.5px; opacity: .75; font-weight: 400; }
    .cabecalho-direita { text-align: right; line-height: 1.3; }
    .cabecalho-titulo  { font-size: 13px; font-weight: 700; letter-spacing: .5px; }
    .cabecalho-data    { font-size: 9.5px; opacity: .75; margin-top: 2px; }

    /* ── Faixa do município ───────────────────────────────────────────── */
    .faixa-mun {
      background: #e8f0f7;
      border-bottom: 2px solid #0A3D62;
      padding: 8px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-shrink: 0;
    }
    .faixa-mun-esq { display: flex; flex-direction: column; gap: 1px; }
    .faixa-mun-nome { font-size: 14px; font-weight: 700; color: #0A3D62; }
    .faixa-mun-cod  { font-size: 10px; color: #475569; }
    .faixa-mun-dir  { text-align: right; }
    .faixa-mun-asin { font-size: 11.5px; font-weight: 600; color: #1e293b; }
    .faixa-mun-plano{ font-size: 10px; color: #64748b; }

    /* ── Corpo principal ─────────────────────────────────────────────── */
    .corpo {
      flex: 1;
      padding: 12px 20px 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      overflow: hidden;
    }

    /* ── Seções ──────────────────────────────────────────────────────── */
    .secao { display: flex; flex-direction: column; gap: 5px; }
    .secao-titulo {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .8px;
      color: #0A3D62;
      border-bottom: 1.5px solid #dbeafe;
      padding-bottom: 3px;
    }

    /* ── Grid de duas colunas ────────────────────────────────────────── */
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    /* ── Tabela SIOPE ────────────────────────────────────────────────── */
    table.t-siope {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    table.t-siope thead tr {
      background: #0A3D62;
      color: #fff;
    }
    table.t-siope thead th {
      padding: 5px 8px;
      text-align: left;
      font-weight: 600;
      font-size: 10px;
      letter-spacing: .3px;
    }
    table.t-siope tbody tr { border-bottom: 1px solid #e2e8f0; }
    table.t-siope tbody tr:nth-child(even) { background: #f8fafc; }
    table.t-siope td { padding: 5px 8px; }

    /* ── Badges ─────────────────────────────────────────────────────── */
    .badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 20px;
      font-size: 10px;
      font-weight: 600;
    }
    .badge.verde   { background: #dcfce7; color: #166534; }
    .badge.vermelho{ background: #fee2e2; color: #991b1b; }
    .badge.amarelo { background: #fef9c3; color: #854d0e; }
    .badge.cinza   { background: #f1f5f9; color: #64748b; }
    .badge.azul    { background: #dbeafe; color: #1e40af; }

    /* ── Indicadores (cards compactos) ──────────────────────────────── */
    .ind-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
    }
    .ind-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 6px 8px;
    }
    .ind-card.ok    { border-left: 3px solid #16a34a; }
    .ind-card.alerta{ border-left: 3px solid #dc2626; background: #fff5f5; }
    .ind-card-label { font-size: 9.5px; color: #64748b; margin-bottom: 2px; }
    .ind-card-valor { font-size: 12px; font-weight: 700; color: #1e293b; }

    /* ── Alertas ─────────────────────────────────────────────────────── */
    .alerta-item {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 4px 0;
      border-bottom: 1px solid #f1f5f9;
      font-size: 10.5px;
    }
    .alerta-icone { flex-shrink: 0; font-size: 12px; }
    .alerta-txt   { flex: 1; color: #374151; }
    .alerta-data  { flex-shrink: 0; color: #94a3b8; font-size: 9.5px; }

    /* ── Quiz ────────────────────────────────────────────────────────── */
    .quiz-bloco {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .quiz-metricas {
      display: flex;
      gap: 12px;
    }
    .quiz-met {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .quiz-met-label { font-size: 9.5px; color: #64748b; }
    .quiz-met-valor { font-size: 14px; font-weight: 700; }
    .barra-wrap {
      height: 8px;
      background: #e2e8f0;
      border-radius: 4px;
      overflow: hidden;
    }
    .barra-fill {
      height: 100%;
      border-radius: 4px;
      transition: width .3s;
    }
    .quiz-legenda { font-size: 9.5px; color: #64748b; margin-top: 1px; }

    /* ── Sem dados ───────────────────────────────────────────────────── */
    .sem-dados { font-size: 10.5px; color: #94a3b8; font-style: italic; }

    /* ── Rodapé ──────────────────────────────────────────────────────── */
    .rodape {
      background: #f1f5f9;
      border-top: 1px solid #e2e8f0;
      padding: 7px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-shrink: 0;
    }
    .rodape-aviso { font-size: 9px; color: #64748b; max-width: 70%; }
    .rodape-aviso strong { color: #475569; }
    .rodape-verif { text-align: right; }
    .rodape-verif .cod { font-size: 9px; color: #94a3b8; font-family: monospace; }
    .rodape-url   { font-size: 9px; color: #0A3D62; font-weight: 600; }

    /* ── @media print ────────────────────────────────────────────────── */
    @media print {
      html, body { background: #fff; }
      .pagina {
        width: 100%;
        min-height: unset;
        max-height: unset;
        margin: 0;
        box-shadow: none;
      }
      @page {
        size: A4 portrait;
        margin: 0;
      }
    }
  </style>
</head>
<body>
<div class="pagina">

  <!-- ── Cabeçalho ─────────────────────────────────────────────────────── -->
  <div class="cabecalho">
    <div class="cabecalho-logo">
      <div class="logo-icone">📡</div>
      <div class="logo-texto">
        <div class="marca">Radar SIOPE</div>
        <div class="sub">radarsiope.com.br</div>
      </div>
    </div>
    <div class="cabecalho-direita">
      <div class="cabecalho-titulo">RELATÓRIO DE CONFORMIDADE ${anoGeracao}</div>
      <div class="cabecalho-data">Gerado em: ${dataGeracao}</div>
    </div>
  </div>

  <!-- ── Faixa do município ─────────────────────────────────────────────── -->
  <div class="faixa-mun">
    <div class="faixa-mun-esq">
      <div class="faixa-mun-nome">${_escHtml(assinante?.municipio || '—')} / ${_escHtml(assinante?.uf || '')}</div>
      <div class="faixa-mun-cod">Código IBGE: ${_escHtml(assinante?.cod_municipio || '—')}</div>
    </div>
    <div class="faixa-mun-dir">
      <div class="faixa-mun-asin">${_escHtml(assinante?.nome || '—')}</div>
      <div class="faixa-mun-plano">Plano ${_escHtml(assinante?.plano_nome || '—')}</div>
    </div>
  </div>

  <!-- ── Corpo ─────────────────────────────────────────────────────────── -->
  <div class="corpo">

    <!-- Tabela SIOPE -->
    <div class="secao">
      <div class="secao-titulo">📊 SIOPE/FUNDEB — Série Histórica</div>
      <table class="t-siope">
        <thead>
          <tr>
            <th>Período</th>
            <th>Situação</th>
            <th>Envio</th>
            <th>Homologado</th>
            <th>% MDE Apl.</th>
            <th>% Fund. Remun.</th>
          </tr>
        </thead>
        <tbody>
          ${linhasSeries}
        </tbody>
      </table>
    </div>

    <!-- Indicadores financeiros -->
    <div class="secao">
      <div class="secao-titulo">💰 Indicadores Financeiros — Registro Mais Recente</div>
      ${indicadores}
    </div>

    <!-- Alertas + Quiz lado a lado -->
    <div class="grid-2">

      <!-- Alertas -->
      <div class="secao">
        <div class="secao-titulo">🔔 Alertas Recebidos — Últimos 12 Meses</div>
        ${listaAlertas}
      </div>

      <!-- Quiz / Academia -->
      <div class="secao">
        <div class="secao-titulo">🧠 Desempenho nos Quizzes</div>
        <div class="quiz-bloco">
          <div class="quiz-metricas">
            <div class="quiz-met">
              <span class="quiz-met-label">Edições respondidas</span>
              <span class="quiz-met-valor" style="color:#0A3D62">${qRespondidas}/${qTotal}</span>
            </div>
            <div class="quiz-met">
              <span class="quiz-met-label">Taxa de participação</span>
              <span class="quiz-met-valor" style="color:${qCorBarra}">${qTaxa}%</span>
            </div>
            <div class="quiz-met">
              <span class="quiz-met-label">Média de aproveitamento</span>
              <span class="quiz-met-valor" style="color:${qCorMedia}">${qMediaTxt}</span>
            </div>
          </div>
          <div class="barra-wrap">
            <div class="barra-fill" style="width:${qPct}%;background:${qCorBarra}"></div>
          </div>
          <div class="quiz-legenda">
            ${qTaxa >= 80 ? '✅ Excelente engajamento com o conteúdo das edições.'
      : qTaxa >= 50 ? '📌 Engajamento moderado. Responda as edições pendentes.'
        : qTotal === 0 ? '—'
          : '⚠️ Baixa participação. Complete os quizzes para fortalecer sua capacitação.'}
          </div>
        </div>
      </div>

    </div><!-- /grid-2 -->

  </div><!-- /corpo -->

  <!-- ── Rodapé ─────────────────────────────────────────────────────────── -->
  <div class="rodape">
    <div class="rodape-aviso">
      <strong>⚠️ Documento informativo.</strong> Os dados são obtidos de fontes oficiais
      (SIOPE/FNDE) e podem não refletir atualizações recentes. Confirme sempre no
      portal oficial SIOPE antes de tomar decisões. Gerado pela plataforma Radar SIOPE.
    </div>
    <div class="rodape-verif">
      <div class="rodape-url">radarsiope.com.br</div>
      <div class="cod">ID: ${verHash}</div>
    </div>
  </div>

</div><!-- /pagina -->
</body>
</html>`;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────
function _labelSituacao(s) {
  const mapa = { enviado: 'Enviado', homologado: 'Homologado', pendente: 'Pendente', nao_enviado: 'Não enviado', em_analise: 'Em análise' };
  return mapa[(s || '').toLowerCase()] || (s || '—');
}
function _corSituacao(s) {
  const l = (s || '').toLowerCase();
  if (l === 'homologado') return { bg: '#dcfce7', fg: '#166534' };
  if (l === 'enviado' || l === 'em_analise') return { bg: '#dbeafe', fg: '#1e40af' };
  if (l === 'nao_enviado' || l === 'pendente') return { bg: '#fee2e2', fg: '#991b1b' };
  return { bg: '#f1f5f9', fg: '#475569' };
}
function _iconeAlerta(tipo) {
  const mapa = { siope_prazo_proximo: '⏰', siope_homologado: '✅', siope_percentual_baixo: '⚠️', siope_nao_enviado: '🚨', fundeb_repasse_creditado: '💰', portaria_publicada: '📋', nova_edicao: '📡' };
  return mapa[tipo] || '🔔';
}
function _indCard(label, valor, status) {
  const cls = status === 'ok' ? 'ok' : status === 'alerta' ? 'alerta' : '';
  return `<div class="ind-card ${cls}"><div class="ind-card-label">${label}</div><div class="ind-card-valor">${valor}</div></div>`;
}
function _pct(v) {
  if (v === null || v === undefined) return '—';
  return `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
function _moeda(v) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`;
  if (Math.abs(n) >= 1_000) return `R$ ${(n / 1_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil`;
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function _num(v) { if (v === null || v === undefined) return '—'; return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function _dataAbrev(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch { return '—'; }
}
function _escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}
function _hashVerif(cod, gerado_em) {
  const str = `${cod || ''}|${(gerado_em || '').slice(0, 16)}|RS`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return `RS-${h.toString(16).toUpperCase().padStart(8, '0')}`;
}