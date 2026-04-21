/* ==========================================================================
alertas.js — Radar SIOPE · Backend (Vercel Function)
Rota: POST /api/alertas
Responsabilidades:
- Disparar push notifications segmentadas via OneSignal REST API
- Registrar o alerta no Firestore (histórico + auditoria)
- WhatsApp: apenas registro de intenção (envio manual via frontend)
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

// ─── Definição dos templates de alerta ───────────────────────────────────────
const TEMPLATES_ALERTA = {
  nova_edicao: {
    titulo:    '📡 Nova edição Radar SIOPE!',
    corpo:     'A edição #{edicao} já está disponível. {titulo}',
    icon:      '/icons/icon-192x192.png',
    url:       '/verNewsletterComToken.html',
    filtros:   [{ field: 'alerta_nova_edicao', relation: '=', value: '1' }],
  },
  nova_edicao_acesso_pro: {
    titulo:    '🔓 Acesso especial liberado!',
    corpo:     'Edição #{edicao} com acesso completo por {horas}h. Exclusivo para você!',
    icon:      '/icons/icon-192x192.png',
    url:       '/verNewsletterComToken.html',
    filtros:   [
      { field: 'segmento', relation: '=', value: 'lead' },
      { field: 'alerta_nova_edicao', relation: '=', value: '1' },
    ],
  },
  siope_prazo_proximo: {
    titulo:    '⏰ Prazo SIOPE se aproximando!',
    corpo:     '{municipio}/{uf}: prazo de envio em {dias} dias ({data_prazo}). Não perca!',
    icon:      '/icons/icon-192x192.png',
    url:       '/painel.html',
    filtros:   [
      { field: 'alerta_municipio', relation: '=', value: '1' },
      { field: 'uf', relation: '=', value: '{uf}' },
      { field: 'municipio_cod', relation: '=', value: '{municipio_cod}' },
    ],
  },
  siope_homologado: {
    titulo:    '✅ SIOPE homologado!',
    corpo:     '{municipio}/{uf}: dados do {bimestre}º bimestre de {ano} foram homologados.',
    icon:      '/icons/icon-192x192.png',
    url:       '/painel.html',
    filtros:   [
      { field: 'alerta_municipio', relation: '=', value: '1' },
      { field: 'uf', relation: '=', value: '{uf}' },
      { field: 'municipio_cod', relation: '=', value: '{municipio_cod}' },
    ],
  },
  siope_percentual_baixo: {
    titulo:    '⚠️ Alerta: percentual MDE baixo!',
    corpo:     '{municipio}/{uf}: {percentual}% aplicado em MDE ({bimestre}º bim/{ano}). Mínimo exigido: {minimo}%.',
    icon:      '/icons/icon-192x192.png',
    url:       '/painel.html',
    filtros:   [
      { field: 'alerta_municipio', relation: '=', value: '1' },
      { field: 'uf', relation: '=', value: '{uf}' },
      { field: 'municipio_cod', relation: '=', value: '{municipio_cod}' },
    ],
  },
  siope_nao_enviado: {
    titulo:    '🚨 SIOPE não enviado!',
    corpo:     '{municipio}/{uf}: dados do {bimestre}º bimestre ainda não foram enviados ao SIOPE. Prazo: {data_prazo}.',
    icon:      '/icons/icon-192x192.png',
    url:       '/painel.html',
    filtros:   [
      { field: 'alerta_municipio', relation: '=', value: '1' },
      { field: 'uf', relation: '=', value: '{uf}' },
      { field: 'municipio_cod', relation: '=', value: '{municipio_cod}' },
    ],
  },
  fundeb_repasse_creditado: {
    titulo:    '💰 Repasse FUNDEB creditado!',
    corpo:     '{municipio}/{uf}: R$ {valor} creditados referentes a {mes}/{ano}.',
    icon:      '/icons/icon-192x192.png',
    url:       '/painel.html',
    filtros:   [
      { field: 'alerta_municipio', relation: '=', value: '1' },
      { field: 'uf', relation: '=', value: '{uf}' },
      { field: 'municipio_cod', relation: '=', value: '{municipio_cod}' },
    ],
  },
  portaria_publicada: {
    titulo:    '📋 Nova portaria publicada!',
    corpo:     '{titulo_portaria}. Análise completa disponível no Radar SIOPE.',
    icon:      '/icons/icon-192x192.png',
    url:       '/verNewsletterComToken.html',
    filtros:   [{ field: 'plano', relation: '=', value: 'supreme' }],
  },
};

// ─── Handler principal ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://app.radarsiope.com.br');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido.' });

  // Autenticação
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_API_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Não autorizado.' });
  }

  // ── POST acao=enviar-whatsapp (modo manual — apenas registro) ─────────────
  if (req.method === 'POST' && req.body?.acao === 'enviar-whatsapp') {
    const { comunidade, mensagem, uids } = req.body || {};
    
    // Apenas registra a intenção no histórico (frontend faz o envio manual)
    try {
      await db.collection('alertas_disparados').add({
        canal: 'whatsapp',
        tipo: comunidade ? `comunidade_${comunidade}` : 'manual_admin',
        mensagem: mensagem?.slice(0, 200) || '',
        destinatarios_est: Array.isArray(uids) ? uids.length : 0,
        status: 'registrado_manual',
        disparado_em: admin.firestore.FieldValue.serverTimestamp(),
        _modo: 'assistido_frontend',
      });
    } catch (e) {
      console.warn('[alertas] Falha ao registrar intenção WhatsApp:', e);
    }
    
    return res.status(200).json({
      ok: true,
      message: 'Intenção registrada. Envio manual deve ser concluído via frontend.',
      modo: 'assistido',
    });
  }

  // ── Push Notification via OneSignal ───────────────────────────────────────
  const { tipo, parametros = {}, habilitado = true } = req.body;
  if (!tipo) return res.status(400).json({ ok: false, error: 'Campo "tipo" obrigatório.' });
  if (!habilitado) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'Alerta desabilitado pelo admin.' });
  }

  // Carrega template (com override do Firestore)
  let template = { ...TEMPLATES_ALERTA[tipo] };
  if (!template.titulo) {
    return res.status(400).json({ ok: false, error: `Tipo de alerta desconhecido: ${tipo}` });
  }
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

  // Substitui parâmetros
  const titulo = _substituir(template.titulo, parametros);
  const corpo  = _substituir(template.corpo,  parametros);
  const url    = _substituir(template.url,    parametros);
  const filtros = template.filtros.map(f => ({ ...f, value: _substituir(f.value, parametros) }));

  // Payload OneSignal
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    headings: { pt: titulo, en: titulo },
    contents: { pt: corpo, en: corpo },
    url,
    chrome_web_icon: template.icon,
    firefox_icon: template.icon,
    filters: filtros,
    priority: tipo.includes('prazo') || tipo.includes('nao_enviado') ? 10 : 6,
    ttl: 86400,
    data: { tipo, parametros, url },
  };

  // Dispara via OneSignal
  let oneSignalResult;
  try {
    const resp = await fetch(ONESIGNAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Key ${ONESIGNAL_API_KEY}` },
      body: JSON.stringify(payload),
    });
    oneSignalResult = await resp.json();
    if (!resp.ok) throw new Error(JSON.stringify(oneSignalResult));
  } catch (err) {
    console.error('[alertas] Erro OneSignal:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao disparar notificação.' });
  }

  // Registra histórico
  try {
    await db.collection('alertas_disparados').add({
      tipo, titulo, corpo, parametros, filtros,
      onesignal_id: oneSignalResult.id,
      destinatarios_est: oneSignalResult.recipients || 0,
      disparado_em: admin.firestore.FieldValue.serverTimestamp(),
      status: 'enviado',
    });
  } catch (e) { console.warn('[alertas] Erro ao registrar histórico:', e); }

  return res.status(200).json({
    ok: true,
    tipo, titulo,
    destinatarios: oneSignalResult.recipients || 0,
    onesignal_id: oneSignalResult.id,
  });
}

// ─── Utilitário: substitui {variavel} no template ────────────────────────────
function _substituir(template, params) {
  if (!template) return '';
  return template.replace(/{(\w+)}/g, (match, key) =>
    params[key] !== undefined ? String(params[key]) : match
  );
}