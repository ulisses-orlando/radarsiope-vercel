/**
 * parserDemonstrativoFundeb.js
 *
 * Extrai os dados do "Quadro Demonstrativo das Receitas e Despesas com o Fundeb"
 * (PDF gerado pelo SIOPE/FNDE) e retorna o objeto `dados_extraidos` usado pela
 * tabela pareceres_fundeb.
 *
 * Estratégia: ancorar pela numeração fixa dos itens (1, 1.1, 11.2, ...), não
 * pelo texto do rótulo — a numeração é estável entre municípios/bimestres,
 * o texto pode variar em espaçamento/quebra de linha.
 */

import pdf from 'pdf-parse';

// -----------------------------------------------------------------------
// Mapeamento: número do item do demonstrativo -> caminho no objeto de saída
// -----------------------------------------------------------------------
const MAPA_ITENS = {
  '1':      'receitas.total_recebido',
  '1.1':    'receitas.transferencias_impostos',
  '1.2':    'receitas.complementacao_uniao',
  '1.2.1':  'receitas.complementacao_vaaf',
  '1.2.2':  'receitas.complementacao_vaat',
  '1.2.3':  'receitas.complementacao_vaar',

  '2':      'despesas.remuneracao_profissionais',
  '3':      'despesas.outras_despesas',
  '4':      'despesas.total_fundeb',

  '16':     'conciliacao_bancaria.saldo_inicial',
  '17':     'conciliacao_bancaria.ingressos',
  '18':     'conciliacao_bancaria.pagamentos',
  '19':     'conciliacao_bancaria.saldo_ate_bimestre',
  '20':     'conciliacao_bancaria.ajustes_positivos',
  '21':     'conciliacao_bancaria.ajustes_negativos',
  '22':     'conciliacao_bancaria.saldo_conciliado',
};

// Itens com duas colunas (Valor e Percentual) -> viram entradas do array `limites`
const MAPA_LIMITES = {
  '11': { item: 'remuneracao_70',         exigidoItem: '11.1', aplicadoItem: '11.2' },
  '12': { item: 'iei_educacao_infantil',  exigidoItem: '12.1', aplicadoItem: '12.2' },
  '13': { item: 'capital_15',             exigidoItem: '13.1', aplicadoItem: '13.2' },
  '14': { item: 'max_10_nao_aplicado',    exigidoItem: '14.1', aplicadoItem: '14.2' },
  '15': { item: 'fomento_eti_4',          exigidoItem: '15.1', aplicadoItem: '15.2' },
};

// -----------------------------------------------------------------------
// Utilitários
// -----------------------------------------------------------------------

/** Converte "3.360.065,72" -> 3360065.72 */
function parseValorBR(str) {
  if (str == null) return null;
  const limpo = str.trim().replace(/\./g, '').replace(',', '.');
  const num = parseFloat(limpo);
  return Number.isNaN(num) ? null : num;
}

/**
 * Junta linhas quebradas: se uma linha começa com "N.N - texto" mas não
 * termina em valor monetário, concatena com as próximas até achar um valor.
 */
function reconstituirLinhas(linhasBrutas) {
  const linhaInicio = /^(\d+(?:\.\d+)*)\s*[-–]\s*(.+)$/;
  const terminaEmValor = /([\d.]+,\d{2})\s*1?\s*$/;

  const linhas = [];
  let buffer = null;

  for (const linhaRaw of linhasBrutas) {
    const linha = linhaRaw.trim();
    if (!linha) continue;

    if (buffer) {
      buffer += ' ' + linha;
      if (terminaEmValor.test(buffer)) {
        linhas.push(buffer);
        buffer = null;
      }
      continue;
    }

    if (linhaInicio.test(linha)) {
      if (terminaEmValor.test(linha)) {
        linhas.push(linha);
      } else {
        buffer = linha; // linha quebrada, aguarda continuação
      }
    }
  }
  // Buffer que sobrou sem nunca encontrar um valor não é uma linha de dado
  // válida (ex: texto corrido de nota de rodapé) — descarta em vez de
  // empurrar pro resultado.

  return linhas;
}

/**
 * A extração de texto do PDF ocasionalmente "cola" um ano de 4 dígitos
 * direto no valor monetário seguinte, sem espaço entre eles (ex:
 * "DEZEMBRO DE 20251.257.390,09" em vez de "...DE 2025 1.257.390,09").
 * Insere o espaço de volta antes de rodar qualquer regex de valor.
 */
function normalizarColagemDeAno(linha) {
  return linha.replace(/(20\d{2})(\d{1,3}(?:\.\d{3})*,\d{2})/g, '$1 $2');
}

/** Extrai { numero, valores: [...] } de uma linha reconstituída */
function parseLinha(linhaOriginal) {
  const linha = normalizarColagemDeAno(linhaOriginal);
  const matchNumero = linha.match(/^(\d+(?:\.\d+)*)\s*[-–]\s*/);
  if (!matchNumero) return null;

  const numero = matchNumero[1];
  const resto = linha.slice(matchNumero[0].length);

  // Pega todos os valores no formato "1.234,56" ou "0,00" presentes na linha
  // (itens de limite têm 2: Valor e Percentual; os demais têm 1)
  const valores = [...resto.matchAll(/-?[\d.]+,\d{2}/g)].map(m => m[0]);

  return { numero, valores, textoOriginal: linha };
}

// -----------------------------------------------------------------------
// Extração do cabeçalho (município, bimestre, exercício)
// -----------------------------------------------------------------------
function extrairCabecalho(textoCompleto) {
  const municipioMatch = textoCompleto.match(/PREFEITURA MUNICIPAL DE (.+?) - ([A-Z]{2})/);
  const periodoMatch = textoCompleto.match(/PER[ÍI]ODO DE REFER[ÊE]NCIA\s*-\s*(\d+)[ºo]\s*Bimestre\/(\d{4})/i);

  return {
    municipio_pdf: municipioMatch ? `${municipioMatch[1].trim()} - ${municipioMatch[2]}` : null,
    bimestre_pdf: periodoMatch ? parseInt(periodoMatch[1], 10) : null,
    exercicio_pdf: periodoMatch ? parseInt(periodoMatch[2], 10) : null,
  };
}

// -----------------------------------------------------------------------
// Monta o status (cumprido / nao_cumprido / atencao) de um limite mínimo
// -----------------------------------------------------------------------
function statusLimite(exigido, aplicado) {
  if (aplicado == null || exigido == null) return 'indefinido';
  if (aplicado < exigido) return 'nao_cumprido';
  return 'cumprido';
}

// Item 14 é um TETO (máximo permitido), lógica inversa dos demais
function statusTeto(percentualUsoDoTeto) {
  if (percentualUsoDoTeto == null) return 'indefinido';
  if (percentualUsoDoTeto > 100) return 'nao_cumprido';
  if (percentualUsoDoTeto >= 90) return 'atencao';
  return 'cumprido';
}

// -----------------------------------------------------------------------
// Função principal
// -----------------------------------------------------------------------
async function parseDemonstrativoFundeb(bufferPdf) {
  const dadosPdf = await pdf(bufferPdf);
  const textoCompleto = dadosPdf.text;
  const linhasBrutas = textoCompleto.split('\n');

  const cabecalho = extrairCabecalho(textoCompleto);

  // O rodapé ("Fonte: ..." / "Nota: ...") cita números de item dentro de
  // texto corrido (ex: "1.2.1 - Complementação da União ao FUNDEB - VAAF,
  // 1.3.2 - Rendimentos ...") que colide com o padrão de linha de dado e
  // pode sobrescrever o valor real já capturado. Cortamos tudo a partir daí.
  const indiceRodape = linhasBrutas.findIndex(l => /^\s*(Fonte:|Nota:)/.test(l));
  const linhasUteis = indiceRodape >= 0 ? linhasBrutas.slice(0, indiceRodape) : linhasBrutas;

  const linhasReconstituidas = reconstituirLinhas(linhasUteis);

  const porNumero = {}; // '1.1' -> { valores, textoOriginal }
  for (const linha of linhasReconstituidas) {
    const parsed = parseLinha(linha);
    if (parsed) porNumero[parsed.numero] = parsed;
  }

  const saida = {
    municipio_pdf: cabecalho.municipio_pdf,
    bimestre_pdf: cabecalho.bimestre_pdf,
    exercicio_pdf: cabecalho.exercicio_pdf,
    receitas: {},
    despesas: {},
    conciliacao_bancaria: {},
    limites: [],
    avisos: [],
  };

  // ---- Valores simples (receitas, despesas, conciliação) ----
  for (const [numero, caminho] of Object.entries(MAPA_ITENS)) {
    const entrada = porNumero[numero];
    if (!entrada || entrada.valores.length === 0) {
      saida.avisos.push(`Item ${numero} não encontrado no PDF`);
      continue;
    }
    const valor = parseValorBR(entrada.valores[0]);
    const [grupo, campo] = caminho.split('.');
    saida[grupo][campo] = valor;
  }

  // ---- Limites (duas colunas: Valor e Percentual) ----
  for (const [numeroBase, config] of Object.entries(MAPA_LIMITES)) {
    const exigidoEntrada = porNumero[config.exigidoItem];
    const aplicadoEntrada = porNumero[config.aplicadoItem];

    const exigido = exigidoEntrada ? parseValorBR(exigidoEntrada.valores[0]) : null;
    const aplicado = aplicadoEntrada ? parseValorBR(aplicadoEntrada.valores[0]) : null;

    // O percentual geralmente está na linha do item-base (ex: "11- Mínimo de 70% ... 93,58")
    const linhaBase = porNumero[numeroBase];
    const percentual = linhaBase && linhaBase.valores.length
      ? parseValorBR(linhaBase.valores[linhaBase.valores.length - 1])
      : (exigido && aplicado ? Math.round((aplicado / exigido) * 10000) / 100 : null);

    const status = numeroBase === '14'
      ? statusTeto(percentual)
      : statusLimite(exigido, aplicado);

    saida.limites.push({ item: config.item, exigido, aplicado, percentual, status });
  }

  // ---- Checksum de sanidade (item 2 + item 3 = item 4) ----
  const somaDespesas = (saida.despesas.remuneracao_profissionais || 0) + (saida.despesas.outras_despesas || 0);
  const checksumDespesas = Math.abs(somaDespesas - (saida.despesas.total_fundeb || 0)) < 0.05;

  saida.checksum_ok = checksumDespesas;
  if (!checksumDespesas) {
    saida.avisos.push(
      `Checksum falhou: item 2 + item 3 (${somaDespesas.toFixed(2)}) ` +
      `≠ item 4 (${(saida.despesas.total_fundeb || 0).toFixed(2)})`
    );
  }

  // ---- Validação de período (parecer anual espera o 6º bimestre) ----
  if (cabecalho.bimestre_pdf !== 6) {
    saida.avisos.push(
      `PDF corresponde ao ${cabecalho.bimestre_pdf}º bimestre, não ao 6º — ` +
      `dados podem estar incompletos para o parecer anual`
    );
  }

  return saida;
}

export { parseDemonstrativoFundeb, parseValorBR, reconstituirLinhas, parseLinha };