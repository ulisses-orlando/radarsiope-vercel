/**
 * parecerFundebTemplate.js
 * Renderização server-side do HTML final do Parecer Fundeb.
 * Porta 1:1 da função _montarHTMLParecer()/_cssParecerFinal() do
 * parecerFundeb.js (frontend) — mantenha as duas em sincronia se
 * alterar o layout em um dos lados.
 */
'use strict';

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function moeda(v) {
  if (v === null || v === undefined) return '—';
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(v) {
  if (v === null || v === undefined) return '—';
  return `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function labelLimite(item) {
  const mapa = {
    remuneracao_70: 'Mínimo 70% — Remuneração dos Profissionais da Educação Básica',
    iei_educacao_infantil: 'Indicador IEI — Complementação VAAT na Educação Infantil',
    capital_15: 'Mínimo 15% — Complementação VAAT em Despesas de Capital',
    max_10_nao_aplicado: 'Máximo 10% — Receitas não aplicadas no exercício',
    fomento_eti_4: 'Mínimo 4% — Recursos aplicados em Fomento ETI',
  };
  return mapa[item] || item;
}

function labelStatus(s) {
  return { cumprido: 'Cumprido', nao_cumprido: 'Não cumprido', atencao: 'Atenção', indefinido: 'Indefinido' }[s] || s;
}

function corBadge(s) {
  return { cumprido: 'verde', nao_cumprido: 'vermelho', atencao: 'amarelo' }[s] || 'cinza';
}

function hashVerif(cod, exercicio) {
  const str = `${cod || ''}|${exercicio}|PF`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return `RS-PF-${h.toString(16).toUpperCase().padStart(8, '0')}`;
}

function cssParecerFinal() {
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

/**
 * @param {Object} p
 * @param {Object} p.dadosExtraidos  — saída do parserDemonstrativoFundeb
 * @param {Object} p.form            — { presidenteNome, presidenteEmail, membros, checklist, conclusaoTipo, conclusaoTexto }
 * @param {Object} p.municipio       — { cod, nome, uf }
 * @param {Number} p.exercicio
 * @param {String} p.pdfNome
 * @param {Date}   [p.dataGeracao]
 */
export function montarHTMLParecer(p) {
  const d = p.dadosExtraidos || {};
  const f = p.form || {};
  const m = p.municipio || {};
  const limites = d.limites || [];
  const conc = d.conciliacao_bancaria || {};
  const dataGeracao = (p.dataGeracao || new Date()).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const corSelo = f.conclusaoTipo === 'aprovado' ? '#dcfce7' : f.conclusaoTipo === 'reprovado' ? '#fee2e2' : '#fef9c3';
  const fgSelo = f.conclusaoTipo === 'aprovado' ? '#166534' : f.conclusaoTipo === 'reprovado' ? '#991b1b' : '#854d0e';
  const labelSelo = f.conclusaoTipo === 'aprovado' ? '✅ Aprovado' : f.conclusaoTipo === 'reprovado' ? '❌ Reprovado' : '⚠ Aprovado com ressalvas';

  const linhasLimites = limites.map(l => `
    <div class="limite">
      <div class="limite-top">
        <span class="limite-nome">${esc(labelLimite(l.item))}</span>
        <span class="badge ${corBadge(l.status)}">${labelStatus(l.status)}</span>
      </div>
      <div class="limite-bar-track"><div class="limite-bar-fill ${corBadge(l.status)}" style="width:${Math.min(100, l.percentual || 0)}%"></div></div>
      <div class="limite-nums"><span>Exigido: <b>${moeda(l.exigido)}</b></span><span>Aplicado: <b>${moeda(l.aplicado)}</b> (${pct(l.percentual)})</span></div>
    </div>`).join('');

  const linhasAlertas = limites.filter(l => l.status !== 'cumprido').map(l => `
    <li class="alert-item ${l.status === 'nao_cumprido' ? 'vermelho' : 'amarelo'}">
      <span class="alert-dot"></span>
      <span><strong>${esc(labelLimite(l.item))}:</strong> ${pct(l.percentual)} — ${labelStatus(l.status).toLowerCase()}.</span>
    </li>`).join('') || '<li class="alert-item" style="background:#dcfce7"><span>✅ Nenhum ponto de atenção identificado.</span></li>';

  const linhasChecklist = (f.checklist || []).map(c => `
    <div class="check-item">
      <div class="check-box ${c.confirmado ? 'on' : ''}"></div>
      <div><div class="check-label">${esc(c.label)}</div><div class="check-obs">${esc(c.observacao) || '—'}</div></div>
    </div>`).join('');

  const linhasAssinaturas = [{ nome: f.presidenteNome, papel: 'Presidente do CACS' }, ...(f.membros || []).map(mb => ({ nome: mb.nome, papel: mb.cargo || 'Membro do CACS' }))]
    .map(s => `<div class="sign-slot"><div class="sign-line"></div><div class="sign-name">${esc(s.nome)}</div><div class="sign-role">${esc(s.papel)}</div></div>`).join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&display=swap">
<style>${cssParecerFinal()}</style></head><body>
<div class="pagina">
  <div class="cabecalho">
    <div class="cabecalho-logo">
      <div class="logo-icone"><img src="/icons/icon-192x192-transparent.png" alt="Radar SIOPE" onerror="this.style.display='none'"></div>
      <div class="logo-texto"><div class="marca">Radar SIOPE</div><div class="sub">radarsiope.com.br</div></div>
    </div>
    <div class="cabecalho-direita">
      <button class="btn-imprimir" onclick="window.print()">🖨️ Imprimir / PDF</button>
      <div class="cabecalho-titulo">PARECER DO CACS FUNDEB ${p.exercicio}</div>
      <div class="cabecalho-data">Gerado em: ${dataGeracao}</div>
    </div>
  </div>
  <div class="faixa-mun">
    <div class="faixa-mun-esq"><div class="faixa-mun-nome">${esc(m.nome)} / ${esc(m.uf)}</div><div class="faixa-mun-cod">Base: 6º Bimestre/${p.exercicio} (SIOPE)</div></div>
    <div class="faixa-mun-dir"><div class="faixa-mun-asin">Exercício ${p.exercicio}</div><div class="faixa-mun-plano">Conselho de Acompanhamento e Controle Social do Fundeb</div></div>
  </div>
  <div class="title-block">
    <div class="title-eyebrow">Análise das contas do Fundeb</div>
    <h1 class="title-main">Parecer sobre a Execução dos Recursos do Fundeb</h1>
    <p class="title-sub">Exercício <strong>${p.exercicio}</strong> · Município de <strong>${esc(m.nome)} — ${esc(m.uf)}</strong></p>
  </div>
  <div class="corpo">
    <div class="secao"><div class="secao-titulo"><span class="secao-num">01</span> Identificação</div>
      <div class="grid-2">
        <div class="field"><span class="field-label">Município</span><span class="field-value">${esc(m.nome)} — ${esc(m.uf)}</span></div>
        <div class="field"><span class="field-label">Exercício de referência</span><span class="field-value">${p.exercicio}</span></div>
        <div class="field"><span class="field-label">Presidente do CACS</span><span class="field-value">${esc(f.presidenteNome)}</span></div>
        <div class="field"><span class="field-label">E-mail do presidente</span><span class="field-value">${esc(f.presidenteEmail)}</span></div>
      </div>
    </div>
    <div class="secao"><div class="secao-titulo"><span class="secao-num">02</span> Fonte dos dados</div>
      <div class="source-note"><span>📄</span><span>Os dados deste parecer foram extraídos do <strong>Quadro Demonstrativo das Receitas e Despesas com o Fundeb</strong>, emitido pelo SIOPE/FNDE, arquivo <strong>${esc(p.pdfNome || '')}</strong>, anexado pelo gestor em ${dataGeracao}.</span></div>
    </div>
    <div class="secao"><div class="secao-titulo"><span class="secao-num">03</span> Análise dos limites obrigatórios</div>${linhasLimites}</div>
    <div class="secao"><div class="secao-titulo"><span class="secao-num">04</span> Disponibilidade financeira e conciliação bancária</div>
      <table class="conc">
        <tr><td>Disponibilidade financeira inicial</td><td>${moeda(conc.saldo_inicial)}</td></tr>
        <tr><td>(+) Ingresso de recursos até o bimestre</td><td>${moeda(conc.ingressos)}</td></tr>
        <tr><td>(−) Pagamentos efetuados até o bimestre</td><td>${moeda(conc.pagamentos)}</td></tr>
        <tr><td>(+) Ajustes positivos</td><td>${moeda(conc.ajustes_positivos)}</td></tr>
        <tr><td>(−) Ajustes negativos</td><td>${moeda(conc.ajustes_negativos)}</td></tr>
        <tr class="total"><td>Saldo financeiro conciliado</td><td>${moeda(conc.saldo_conciliado)}</td></tr>
      </table>
    </div>
    <div class="secao"><div class="secao-titulo"><span class="secao-num">05</span> Pontos de atenção</div><ul class="alert-list">${linhasAlertas}</ul></div>
    <div class="secao"><div class="secao-titulo"><span class="secao-num">06</span> Checklist de verificação documental</div>
      <div class="source-note" style="margin-bottom:8px;"><span>ℹ️</span><span>Os valores acima têm origem em <strong>dados autodeclarados pelo município ao SIOPE</strong>. O CACS confirmou os itens abaixo contra os documentos primários.</span></div>
      <div class="checklist">${linhasChecklist}</div>
    </div>
    <div class="secao"><div class="secao-titulo"><span class="secao-num">07</span> Conclusão do parecer</div>
      <div class="conclusao-selo" style="background:${corSelo};color:${fgSelo}">${labelSelo}</div>
      <p class="conclusao-texto">${esc(f.conclusaoTexto).replace(/\n/g, '<br>')}</p>
    </div>
    <div class="secao"><div class="secao-titulo"><span class="secao-num">08</span> Assinaturas</div><div class="sign-grid">${linhasAssinaturas}</div></div>
  </div>
  <div class="rodape">
    <div class="rodape-aviso"><strong>⚠️ Nota:</strong> os dados constantes neste parecer têm por base as informações declaradas pelo município ao SIOPE, de responsabilidade do Poder Executivo local. O CACS, a seu critério, poderá solicitar documentos contábeis, orçamentários e financeiros complementares que julgar necessários para a análise das contas do Fundeb. Este documento não substitui a fiscalização exercida pelo Conselho nem pelos órgãos de controle externo.</div>
    <div class="rodape-verif"><div class="rodape-url">radarsiope.com.br</div><div class="cod">ID: ${hashVerif(m.cod, p.exercicio)}</div></div>
  </div>
</div>
</body></html>`;
}

module.exports = { montarHTMLParecer, hashVerif };