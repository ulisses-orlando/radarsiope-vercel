export const config = { runtime: 'nodejs', api: { bodyParser: false } };

import crypto from 'crypto';
import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, '\n')
    })
  });
}
const db = admin.firestore();

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'sa-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_KEY
);

// ─── Parser CSV do Tesouro Transparente ──────────────────────────────────────
// Parser por índice: ignora headers corrompidos e retorna Array<string[]>
function parseCsvTesouro(csvText) {
  const lines = csvText.trim().split(/\r?\n/).filter(l => l.trim());
  // CSV do Tesouro: 3 linhas de metadados + header na linha 3 (índice 3)
  if (lines.length < 5) return [];

  // Encontra header real (deve ter ~35 colunas e conter "IBGE")
  let headerIdx = 3; // Padrão conhecido do CSV oficial
  for (let i = 0; i < Math.min(6, lines.length); i++) {
    const parts = lines[i].split(';').length;
    if (parts > 30 && lines[i].includes('IBGE')) {
      headerIdx = i;
      break;
    }
  }

  const headers = lines[headerIdx].split(';').map(h => h.replace(/^"|"$/g, '').trim());
  
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let char of lines[i]) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ';' && !inQuotes) {
        values.push(current.replace(/^"|"$/g, '').trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.replace(/^"|"$/g, '').trim());

    if (values.length >= 35) rows.push(values); // Garante linha completa
  }
  return rows;
}

// ─── Sync CAUC: baixa CSV do Tesouro e atualiza Supabase ─────────────────────
async function syncCaucData({ force = false } = {}) {
  const CSV_URL = 'https://www.tesourotransparente.gov.br/ckan/dataset/72b5f371-0c35-4613-8076-c99c821a6410/resource/07af297a-5e59-494a-a88a-55ddfd2f4b01/download/relatorio-situacao-de-varios-entes---municipios---uf-todas---abrangencia-1.csv';

  // 1. Verifica cache
  if (!force) {
    const { data: meta } = await supabase
      .from('cauc_cache_meta')
      .select('last_sync, sync_status')
      .eq('id', 1)
      .maybeSingle();

    if (meta?.sync_status === 'success' &&
      new Date(meta.last_sync) > new Date(Date.now() - 24 * 60 * 60 * 1000)) {
      return { skipped: true, message: 'Cache válido (24h)' };
    }
  }

  await supabase.from('cauc_cache_meta').upsert({
    id: 1, sync_status: 'pending', last_sync: new Date()
  });

  try {
    // 3. Baixa e parseia o CSV FORÇANDO UTF-8
    // 3. Baixa e parseia o CSV (leitura ÚNICA do corpo)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(CSV_URL, {
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status} - ${response.statusText}`);

    // 🔧 LEITURA ÚNICA: usa .text() diretamente (não arrayBuffer + TextDecoder)
    const csvText = await response.text();

    const rows = parseCsvTesouro(csvText);

    // Mapeamento POR ÍNDICE (imune a encoding quebrado nos headers)
    // Estrutura conhecida do CSV do Tesouro:
    // 0=UF | 1=Nome | 2=IBGE | 18=3.2.3 | 28=5.1 | 32=5.5 | 33=5.6 | 34=5.7
    const records = rows.map(cols => {
      const codRaw = String(cols[2] || '').replace(/\D/g, '');
      const cod_ibge = codRaw.padStart(7, '0');

      if (!cod_ibge || cod_ibge.length !== 7) return null;

      return {
        cod_ibge,
        uf: String(cols[0] || '').substring(0, 2).toUpperCase(),
        municipio: String(cols[1] || '').substring(0, 255),
        item_3_2_3: cols[18] || null,
        item_5_1: cols[28] || null,
        item_5_5: cols[32] || null,
        item_5_6: cols[33] || null,
        item_5_7: cols[34] || null,
      };
    }).filter(r => r !== null);

    // Deduplica por cod_ibge (evita erro "ON CONFLICT... second time")
    const uniqueRecords = [...new Map(records.map(r => [r.cod_ibge, r])).values()];

    // Debug: confirma se 1200385 está presente
    const target = uniqueRecords.find(r => r.cod_ibge === '1200385');
    if (target) {
    } else {
      const acSamples = uniqueRecords.filter(r => r.uf === 'AC').slice(0, 3);
    }

    // Upsert em batch
    for (let i = 0; i < uniqueRecords.length; i += 1000) {
      const batch = uniqueRecords.slice(i, i + 1000);

      const { error } = await supabase
        .from('cauc_municipios')
        .upsert(batch, {
          onConflict: 'cod_ibge',
          ignoreDuplicates: false // Tenta atualizar; se falhar por duplicata no batch, o Map já resolveu
        });

      if (error) {
        // Fallback: tenta com ignoreDuplicates: true (só insere, não atualiza)
        console.warn('[CAUC Sync] Tentando fallback com ignoreDuplicates...');
        const { error: error2 } = await supabase
          .from('cauc_municipios')
          .upsert(batch, { onConflict: 'cod_ibge', ignoreDuplicates: true });

        if (error2) throw new Error(`Upsert falhou: ${error2.message}`);
      }
    }

    // Atualiza meta
    await supabase.from('cauc_cache_meta').upsert({
      id: 1, sync_status: 'success', last_sync: new Date(), source_url: CSV_URL, error_log: null
    });

    return { success: true, processed: records.length };

  } catch (err) {
    console.error('[CAUC Sync] ❌ FALHA DETALHADA:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    await supabase.from('cauc_cache_meta').upsert({
      id: 1, sync_status: 'failed', error_log: err.message
    });
    throw err;
  }
}

// ─── Helper: lê body com stream (bodyParser:false) ────────────────────────────
function _lerBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk.toString(); });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// ─── Helper: filtra alertas pelo código do município ──────────────────────────
function _alertaDoMunicipio(alerta, cod) {
  const TIPOS_MUNICIPAIS = [
    'siope_prazo_proximo', 'siope_homologado',
    'siope_percentual_baixo', 'siope_nao_enviado',
    'fundeb_repasse_creditado',
  ];
  if (!TIPOS_MUNICIPAIS.includes(alerta.tipo)) return false;
  const codStr = String(cod);
  if (alerta.parametros?.municipio_cod &&
    String(alerta.parametros.municipio_cod) === codStr) return true;
  if (Array.isArray(alerta.municipios) &&
    alerta.municipios.some(m => String(m?.cod || m) === codStr)) return true;
  if (Array.isArray(alerta.filtros) &&
    alerta.filtros.some(f => f.key === 'municipio_cod' && String(f.value) === codStr)) return true;
  return false;
}

// ─── CAUC: itens de educação monitorados ─────────────────────────────────────
const CAUC_ITENS_EDUCACAO = {
  '3.2.3': 'Encaminhamento do Anexo 8 do Relatório Resumido de Execução Orçamentária ao Siope',
  '5.1': 'Aplicação Mínima de recursos em Educação',
  '5.5': 'Regularidade na aplicação mínima do Fundeb para pagamento de profissionais da educação básica',
  '5.6': 'Regularidade na aplicação mínima da complementação da União ao Fundeb em despesas de capital',
  '5.7': 'Regularidade na aplicação de 50% da complementação VAAT do Fundeb na educação infantil',
};
const CAUC_ITENS_KEYS = Object.keys(CAUC_ITENS_EDUCACAO);

// ─── Busca código IBGE 7 dígitos no Firestore (UF/{uf}/Municipio) ────────────
async function _buscarCod7Firestore(cod6, cod_uf) {
  if (!cod6 || !cod_uf) return null;

  try {
    const uf = String(cod_uf).toUpperCase().trim();

    // 1. Converter a busca para Número (pois o campo no Firestore é int64)
    const strLimpo = String(cod6).replace(/\D/g, '');
    const numBase = Number(strLimpo);
    if (isNaN(numBase)) return null;

    // 2. Calcular o intervalo numérico de busca
    // Se buscamos o prefixo "35001", queremos números entre 350010 e 350019.
    const startVal = numBase * 10;
    const endVal = startVal + 10;        // O operador '<' exclui este valor final

    // 3. Query com filtros numéricos (>= e <)
    const snap = await db.collection('UF').doc(uf)
      .collection('Municipio')
      .where('cod_municipio', '>=', startVal)
      .where('cod_municipio', '<', endVal)
      .limit(1)
      .get();

    if (!snap.empty) {
      const doc = snap.docs[0];
      const val = doc.data().cod_municipio;

      // Retorna o valor encontrado formatado como string de 7 dígitos
      // (padStart garante zeros à esquerda se o banco salvou como int sem eles)
      return val ? String(val).padStart(7, '0') : null;
    }

    return null;

  } catch (e) {
    console.warn('[cauc] Erro ao buscar cod7 no Firestore:', e.message);
    return null;
  }
}

// ─── Busca CAUC via Supabase (com fallback para sync on-demand) ──────────────
async function _buscarCaucComCache(cod7) {
  const codStr = String(cod7).padStart(7, '0');

  // 1. Tenta buscar no cache
  const { data, error } = await supabase
    .from('cauc_municipios')
    .select('item_3_2_3, item_5_1, item_5_5, item_5_6, item_5_7, updated_at, cod_ibge, uf, municipio')
    .eq('cod_ibge', codStr)
    .maybeSingle();

  if (error) {
    console.warn(`[CAUC] Erro na query: ${error.message}`);
    return { ok: false, erro: 'Erro ao consultar dados do CAUC.' };
  }

  if (data) {
    const itens = [
      { cod_item: '3.2.3', situacao: data.item_3_2_3, descricao: 'Encaminhamento do Anexo 8 do Relatório Resumido de Execução Orçamentária ao Siope' },
      { cod_item: '5.1', situacao: data.item_5_1, descricao: 'Aplicação Mínima de recursos em Educação' },
      { cod_item: '5.5', situacao: data.item_5_5, descricao: 'Regularidade na aplicação mínima do Fundeb para pagamento de profissionais da educação básica' },
      { cod_item: '5.6', situacao: data.item_5_6, descricao: 'Regularidade na aplicação mínima da complementação da União ao Fundeb em despesas de capital' },
      { cod_item: '5.7', situacao: data.item_5_7, descricao: 'Regularidade na aplicação de 50% da complementação VAAT do Fundeb na educação infantil' },
    ].filter(i => i.situacao && i.situacao.trim() !== '');

    const horasDesdeSync = (Date.now() - new Date(data.updated_at)) / (1000 * 60 * 60);
    const fonte = horasDesdeSync < 24 ? 'cache (atualizado hoje)' : 'cache (atualizado recentemente)';

    return { ok: true, itens, fonte, updated_at: data.updated_at };
  }

  // 2. Não encontrou: tenta sync on-demand
  try {
    const { data: meta } = await supabase
      .from('cauc_cache_meta')
      .select('sync_status, last_sync')
      .eq('id', 1)
      .maybeSingle();

    const podeTentarSync = !meta ||
      meta.sync_status !== 'failed' ||
      (meta.last_sync && new Date(meta.last_sync) < new Date(Date.now() - 4 * 60 * 60 * 1000));

    if (podeTentarSync) {
      await syncCaucData({ force: false });

      // Tenta buscar novamente
      const { data: data2, error: error2 } = await supabase
        .from('cauc_municipios')
        .select('item_3_2_3, item_5_1, item_5_5, item_5_6, item_5_7, updated_at, cod_ibge')
        .eq('cod_ibge', codStr)
        .maybeSingle();

      if (data2) {
        const itens = [ /* mesmo mapeamento acima */].filter(i => i.situacao?.trim());
        return { ok: true, itens, fonte: 'api (sincronizado agora)', updated_at: data2.updated_at };
      }
    } else {
      console.warn('[CAUC Busca] Sync bloqueado por falha recente');
    }
  } catch (syncErr) {
    console.warn(`[CAUC] Sync on-demand falhou: ${syncErr.message}`);
  }

  return { ok: false, erro: `Município ${codStr} não encontrado na base do CAUC.` };
}

// ─── Relatório de Conformidade ────────────────────────────────────────────────
async function _relatorioConformidade(req, res) {
  const origin = process.env.ALLOWED_ORIGIN || 'https://app.radarsiope.com.br';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido.' });

  // ── Parse de body ──────────────────────────────────────────────────────────
  const body = await _lerBody(req);
  const { uid, cod_municipio } = body;

  if (!uid) return res.status(400).json({ ok: false, error: 'uid obrigatório.' });
  if (!cod_municipio) return res.status(400).json({ ok: false, error: 'cod_municipio obrigatório.' });

  // ── Carrega usuário e verifica feature ────────────────────────────────────
  const userSnap = await db.collection('usuarios').doc(uid).get();
  if (!userSnap.exists) return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });
  const user = userSnap.data();

  if (!user.features?.relatorio_conformidade) {
    return res.status(403).json({
      ok: false,
      error: 'Recurso não disponível no plano atual.',
      upgrade_slug: 'profissional',
    });
  }

  const codStr = String(cod_municipio).replace(/\D/g, '');
  const { data: siopeRows, error: siopeErr } = await supabase
    .from('vw_municipio_resumo')
    .select([
      'siope_id', 'cod_municipio', 'uf', 'ano', 'bimestre',
      'situacao', 'data_envio', 'prazo_envio', 'enviado_no_prazo', 'homologado',
      'pct_mde_aplicado', 'pct_fundeb_remuneracao', 'pct_fundeb_outras_mde',
      'pct_fundeb_nao_aplicado', 'pct_vaat_capital', 'pct_fundeb_eti',
      'vlr_exigido_mde', 'vlr_aplicado_mde',
      'invest_aluno_infantil', 'invest_aluno_fundamental', 'invest_aluno_basica',
      'saldo_fundeb', 'fundeb_nao_utilizado',
      'ideb_iniciais', 'ideb_finais',
    ].join(','))
    .eq('cod_municipio', codStr)
    .order('ano', { ascending: false })
    .order('bimestre', { ascending: false, nullsFirst: false });

  if (siopeErr) {
    console.error('[relatorio] Supabase:', siopeErr);
    return res.status(500).json({ ok: false, error: 'Erro ao consultar dados municipais.' });
  }

  const series = siopeRows || [];

  // Registro mais recente com indicadores financeiros
  const ultimoComDados = series.find(r =>
    r.pct_mde_aplicado !== null || r.vlr_aplicado_mde !== null
  ) || series[0] || null;

  // ── Firestore: alertas do município (12 meses) ────────────────────────────
  const dozeAtras = new Date();
  dozeAtras.setMonth(dozeAtras.getMonth() - 12);
  let alertas = [];
  try {
    const alertasSnap = await db.collection('alertas_disparados')
      .where('disparado_em', '>=', admin.firestore.Timestamp.fromDate(dozeAtras))
      .orderBy('disparado_em', 'desc')
      .limit(60)
      .get();
    alertas = alertasSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(a => _alertaDoMunicipio(a, codStr))
      .slice(0, 10)
      .map(a => ({
        tipo: a.tipo || '',
        titulo: a.titulo || '',
        disparado_em: a.disparado_em?.toDate?.()?.toISOString() || null,
      }));
  } catch (e) { console.warn('[relatorio] alertas:', e.message); }

  // ── Firestore: quiz do assinante ──────────────────────────────────────────
  let quizResultados = [];
  try {
    const quizSnap = await db.collection('usuarios').doc(uid)
      .collection('quiz_resultados')
      .orderBy('criado_em', 'desc')
      .limit(24)
      .get();
    quizResultados = quizSnap.docs.map(d => {
      const data = d.data();
      const tentativas = Array.isArray(data.tentativas) ? data.tentativas : [];
      const melhorPontuacao = tentativas.length > 0
        ? Math.max(...tentativas.map(t => t.pontuacao || 0))
        : (data.pontuacao || 0);
      return {
        newsletter_id: d.id,
        newsletter_numero: data.newsletter_numero || null,
        newsletter_titulo: data.newsletter_titulo || '',
        melhor_pontuacao: melhorPontuacao,
        tentativas_total: data.tentativas_total || tentativas.length || 0,
        aprovado: tentativas.some(t => t.aprovado) || data.aprovado || false,
        criado_em: data.criado_em?.toDate?.()?.toISOString() || null,
      };
    });
  } catch (e) { console.warn('[relatorio] quiz:', e.message); }

  // ── Firestore: total de edições com quiz ──────────────────────────────────
  let edicoesPublicadas = 0;
  try {
    const edSnap = await db.collection('newsletters')
      .where('publicado', '==', true)
      .where('quiz.ativo', '==', true)
      .get();
    edicoesPublicadas = edSnap.size;
  } catch { edicoesPublicadas = quizResultados.length; }

  const quizComDados = quizResultados.filter(q => q.tentativas_total > 0);
  const mediaPontuacao = quizComDados.length > 0
    ? Math.round(quizComDados.reduce((s, q) => s + q.melhor_pontuacao, 0) / quizComDados.length)
    : null;

  // ── CAUC: situação nos itens de educação ──────────────────────────────────
  let caucResult;
  const cod7 = await _buscarCod7Firestore(codStr, user.cod_uf);
  if (!cod7) {
    caucResult = { disponivel: false, motivo: `${cod7}: user.cod_uf ${user.cod_uf} -  Código IBGE de 7 dígitos não localizado no Firestore.` };
  } else {
    const cauc = await _buscarCaucComCache(cod7);
    if (!cauc.ok) {
      caucResult = { disponivel: false, motivo: cauc.erro };
    } else {
      caucResult = { disponivel: true, cod7, itens: cauc.itens, fonte: cauc.fonte };
    }
  }

  return res.status(200).json({
    ok: true,
    assinante: {
      nome: user.nome || '',
      municipio: user.nome_municipio || '',
      uf: user.cod_uf || '',
      cod_municipio: codStr,
      plano_nome: user.plano_nome || user.plano_slug || '',
    },
    siope: {
      series,          // todos os registros, ordenados por ano desc
      ultimo: ultimoComDados,
    },
    alertas,
    quiz: {
      edicoes_com_quiz: edicoesPublicadas,
      edicoes_respondidas: quizComDados.length,
      taxa_participacao: edicoesPublicadas > 0
        ? Math.round((quizComDados.length / edicoesPublicadas) * 100) : 0,
      media_pontuacao: mediaPontuacao,
      resultados: quizResultados,
    },
    cauc: caucResult,
    gerado_em: new Date().toISOString(),
  });
}

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const acao = req.query?.acao ? String(req.query.acao) : null;

  if (acao === 'relatorio_conformidade') {
    return _relatorioConformidade(req, res);
  }

  // Dentro do handler principal, após a verificação de 'relatorio_conformidade':
  if (req.query.acao === 'sync_cauc') {
    const force = req.query.force === 'true';
    try {
      const result = await syncCaucData({ force });
      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message, log: err.stack });
    }
  }

  // ── SES: envio de e-mail ───────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', 'https://radarsiope-vercel.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido' });

  const body = await _lerBody(req);
  const { email, nome, mensagemHtml, assunto } = body;

  if (!email || !mensagemHtml) {
    return res.status(400).json({ ok: false, error: 'Campos obrigatórios: email e mensagemHtml' });
  }

  const params = {
    Source: '"Radar SIOPE - Newsletter" <contato@radarsiope.com.br>',
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Charset: 'UTF-8', Data: assunto || 'Radar SIOPE - Newsletter' },
      Body: { Html: { Charset: 'UTF-8', Data: mensagemHtml } }
    }
  };

  try {
    const result = await sesClient.send(new SendEmailCommand(params));
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('❌ Erro SES:', err);
    return res.status(500).json({ ok: false, error: err.message, code: err.name });
  }
}