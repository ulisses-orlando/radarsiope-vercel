/* ==========================================================================
   alertas.js — Radar SIOPE · Backend (Vercel Function)
   Rota: POST /api/alertas

   Responsabilidades:
   - Receber eventos dos scripts Python de importação de dados
   - Receber eventos do webhook do Mercado Pago
   - Disparar push notifications segmentadas via OneSignal REST API
   - Registrar o alerta no Firestore (histórico + auditoria)

   TAGS ONESGINAL (plano gratuito = 3 tags por device):
   ┌──────────────────┬─────────────────────────────────────────┐
   │ Tag              │ Valores                                 │
   ├──────────────────┼─────────────────────────────────────────┤
   │ segmento         │ 'assinante' | 'lead'                    │
   │ municipio_cod    │ código IBGE do município monitorado     │
   │ alerta_municipio │ '1' = opt-in para alertas municipais   │
   └──────────────────┴─────────────────────────────────────────┘

   TIPOS DE ALERTA:
   ┌─────────────────────────────┬──────────────┬──────────────────────────────┐
   │ tipo                        │ segmento     │ filtro OneSignal              │
   ├─────────────────────────────┼──────────────┼──────────────────────────────┤
   │ nova_edicao                 │ assinantes   │ segmento=assinante            │
   │ nova_edicao_acesso_pro      │ leads        │ segmento=lead                 │
   │ siope_prazo_proximo         │ Profiss.+    │ alerta_municipio=1 + mun_cod  │
   │ siope_homologado            │ Profiss.+    │ alerta_municipio=1 + mun_cod  │
   │ siope_percentual_baixo      │ Profiss.+    │ alerta_municipio=1 + mun_cod  │
   │ siope_nao_enviado           │ Profiss.+    │ alerta_municipio=1 + mun_cod  │
   │ fundeb_repasse_creditado    │ Profiss.+    │ alerta_municipio=1 + mun_cod  │
   │ portaria_publicada          │ assinantes   │ segmento=assinante            │
   └─────────────────────────────┴──────────────┴──────────────────────────────┘
   ========================================================================== */

import admin from 'firebase-admin';

// ─── Firebase Admin ───────────────────────────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}
const db = admin.firestore();

// ─── OneSignal Config ─────────────────────────────────────────────────────────
const ONESIGNAL_APP_ID  = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_REST_API_KEY;
const ONESIGNAL_URL     = 'https://onesignal.com/api/v1/notifications';
const BASE_URL          = 'https://app.radarsiope.com.br';

// ─── Templates de alerta ─────────────────────────────────────────────────────
const TEMPLATES_ALERTA = {

  nova_edicao: {
    titulo:  '📡 Nova edição Radar SIOPE!',
    corpo:   'A edição #{edicao} já está disponível. {titulo}',
    icon:    '/icons/icon-192x192.png',
    url:     '/app.html',
    filtros: [{ field: 'tag', key: 'segmento', relation: '=', value: 'assinante' }],
  },

  nova_edicao_acesso_pro: {
    titulo:  '🔓 Acesso especial liberado!',
    corpo:   'Edição #{edicao} com acesso completo por {horas}h. Exclusivo para você!',
    icon:    '/icons/icon-192x192.png',
    url:     '/app.html',
    filtros: [{ field: 'tag', key: 'segmento', relation: '=', value: 'lead' }],
  },

  siope_prazo_proximo: {
    titulo:  '⏰ Prazo SIOPE se aproximando!',
    corpo:   '{municipio}/{uf}: prazo de envio em {dias} dias ({data_prazo}). Não perca!',
    icon:    '/icons/icon-192x192.png',
    url:     '/app.html',
    filtros: [
      { field: 'tag', key: 'uf',              relation: '=', value: '{uf}'            },
      { field: 'tag', key: 'municipio_cod',    relation: '=', value: '{municipio_cod}' },
    ],
  },

  siope_homologado: {
    titulo:  '✅ SIOPE homologado!',
    corpo:   '{municipio}/{uf}: dados do {bimestre}º bimestre de {ano} foram homologados.',
    icon:    '/icons/icon-192x192.png',
    url:     '/app.html',
    filtros: [
      { field: 'tag', key: 'uf',              relation: '=', value: '{uf}'            },
      { field: 'tag', key: 'municipio_cod',    relation: '=', value: '{municipio_cod}' },
    ],
  },

  siope_percentual_baixo: {
    titulo:  '⚠️ Alerta: percentual MDE baixo!',
    corpo:   '{municipio}/{uf}: {percentual}% aplicado em MDE ({bimestre}º bim/{ano}). Mínimo exigido: {minimo}%.',
    icon:    '/icons/icon-192x192.png',
    url:     '/app.html',
    filtros: [
      { field: 'tag', key: 'uf',              relation: '=', value: '{uf}'            },
      { field: 'tag', key: 'municipio_cod',    relation: '=', value: '{municipio_cod}' },
    ],
  },

  siope_nao_enviado: {
    titulo:  '🚨 SIOPE não enviado!',
    corpo:   '{municipio}/{uf}: dados do {bimestre}º bimestre ainda não foram enviados ao SIOPE. Prazo: {data_prazo}.',
    icon:    '/icons/icon-192x192.png',
    url:     '/app.html',
    filtros: [
      { field: 'tag', key: 'uf',              relation: '=', value: '{uf}'            },
      { field: 'tag', key: 'municipio_cod',    relation: '=', value: '{municipio_cod}' },
    ],
  },

  fundeb_repasse_creditado: {
    titulo:  '💰 Repasse FUNDEB creditado!',
    corpo:   '{municipio}/{uf}: R$ {valor} creditados referentes a {mes}/{ano}.',
    icon:    '/icons/icon-192x192.png',
    url:     '/app.html',
    filtros: [
      { field: 'tag', key: 'uf',              relation: '=', value: '{uf}'            },
      { field: 'tag', key: 'municipio_cod',    relation: '=', value: '{municipio_cod}' },
    ],
  },

  portaria_publicada: {
    titulo:  '📋 Nova portaria publicada!',
    corpo:   '{titulo_portaria}. Análise completa disponível no Radar SIOPE.',
    icon:    '/icons/icon-192x192.png',
    url:     '/app.html',
    filtros: [{ field: 'tag', key: 'segmento', relation: '=', value: 'assinante' }],
  },
};

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://app.radarsiope.com.br');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido.' });

  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_API_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Não autorizado.' });
  }

  const { tipo, parametros = {}, habilitado = true } = req.body;
  if (!tipo) return res.status(400).json({ ok: false, error: 'Campo "tipo" obrigatório.' });
  if (!habilitado) return res.status(200).json({ ok: true, skipped: true, reason: 'Alerta desabilitado.' });

  let template = { ...TEMPLATES_ALERTA[tipo] };
  if (!template.titulo) {
    return res.status(400).json({ ok: false, error: `Tipo de alerta desconhecido: ${tipo}` });
  }

  // Override via Firestore (admin pode customizar título/corpo)
  try {
    const configSnap = await db.collection('config_alertas').doc(tipo).get();
    if (configSnap.exists) {
      const conf = configSnap.data();
      if (conf.habilitado === false) {
        return res.status(200).json({ ok: true, skipped: true, reason: 'Desabilitado via Firestore.' });
      }
      if (conf.titulo) template.titulo = conf.titulo;
      if (conf.corpo)  template.corpo  = conf.corpo;
    }
  } catch (e) { console.warn('[alertas] Erro ao ler config Firestore:', e); }

  const titulo = _sub(template.titulo, parametros);
  const corpo  = _sub(template.corpo,  parametros);
  const url    = BASE_URL + _sub(template.url, parametros);

  // Monta filtros substituindo variáveis
  const filtros = template.filtros.map(f => ({
    ...f,
    value: _sub(f.value, parametros),
  }));

  const payload = {
    app_id:          ONESIGNAL_APP_ID,
    headings:        { pt: titulo, en: titulo },
    contents:        { pt: corpo,  en: corpo  },
    web_url:         url,
    chrome_web_icon: template.icon,
    firefox_icon:    template.icon,
    filters:         filtros,
    priority:        tipo.includes('prazo') || tipo.includes('nao_enviado') ? 10 : 6,
    ttl:             86400,
    data:            { tipo, parametros, url },
  };

  let result;
  try {
    const resp = await fetch(ONESIGNAL_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Key ${ONESIGNAL_API_KEY}` },
      body:    JSON.stringify(payload),
    });
    result = await resp.json();
    if (!resp.ok) throw new Error(JSON.stringify(result));
  } catch (err) {
    console.error('[alertas] Erro OneSignal:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao disparar notificação.' });
  }

  // Histórico no Firestore
  try {
    await db.collection('alertas_disparados').add({
      tipo, titulo, corpo, parametros, filtros,
      onesignal_id:      result.id,
      destinatarios_est: result.recipients || 0,
      disparado_em:      admin.firestore.FieldValue.serverTimestamp(),
      status:            'enviado',
    });
  } catch (e) { console.warn('[alertas] Erro ao registrar histórico:', e); }

  return res.status(200).json({
    ok:           true,
    tipo,
    titulo,
    destinatarios: result.recipients || 0,
    onesignal_id:  result.id,
  });
}

function _sub(str, params) {
  if (!str) return '';
  return str.replace(/\{(\w+)\}/g, (_, k) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`
  );
}
