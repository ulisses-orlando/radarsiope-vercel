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
        tipo:         a.tipo || '',
        titulo:       a.titulo || '',
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
    gerado_em: new Date().toISOString(),
  });
}

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const acao = req.query?.acao ? String(req.query.acao) : null;

  if (acao === 'relatorio_conformidade') {
    return _relatorioConformidade(req, res);
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