/* ==========================================================================
   alertas.js — Radar SIOPE · Backend (Vercel Function)
   Rota: POST /api/alertas
   
   Responsabilidades:
   - Receber eventos dos scripts Python de importação de dados
   - Receber eventos do webhook do Mercado Pago
   - Disparar push notifications segmentadas via OneSignal REST API
   - Registrar o alerta no Firestore (histórico + auditoria)
   
   TIPOS DE ALERTA:
   ┌─────────────────────────────┬──────────────┬──────────────────────────┐
   │ tipo                        │ segmento     │ tag OneSignal            │
   ├─────────────────────────────┼──────────────┼──────────────────────────┤
   │ nova_edicao                 │ todos        │ alerta_nova_edicao=1     │
   │ siope_prazo_proximo         │ Profiss.+    │ alerta_municipio=1 + uf  │
   │ siope_homologado            │ Profiss.+    │ alerta_municipio=1       │
   │ siope_percentual_baixo      │ Profiss.+    │ alerta_municipio=1       │
   │ siope_nao_enviado           │ Profiss.+    │ alerta_municipio=1       │
   │ fundeb_repasse_creditado    │ Profiss.+    │ alerta_municipio=1       │
   │ portaria_publicada          │ Supreme      │ plano=supreme            │
   │ nova_edicao_acesso_pro      │ leads        │ segmento=lead            │
   └─────────────────────────────┴──────────────┴──────────────────────────┘
   ========================================================================== */

import admin from 'firebase-admin';
import { enviarWhatsApp, enviarWhatsAppEmLote } from '../js/_whatsapp.js';

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
// Parametrizável: admin pode customizar títulos/corpos via Firestore (coleção: config_alertas)
const TEMPLATES_ALERTA = {

  nova_edicao: {
    titulo:    '📡 Nova edição Radar SIOPE!',
    corpo:     'A edição #{edicao} já está disponível. {titulo}',
    icon:      '/icons/icon-192x192.png',
    url:       '/verNewsletterComToken.html',
    // Filtra por tag — todos que optaram por alerta de nova edição
    filtros:   [{ field: 'alerta_nova_edicao', relation: '=', value: '1' }],
  },

  // Acesso pro temporário para leads (parametrizável — pode ser desabilitado)
  nova_edicao_acesso_pro: {
    titulo:    '🔓 Acesso especial liberado!',
    corpo:     'Edição #{edicao} com acesso completo por {horas}h. Exclusivo para você!',
    icon:      '/icons/icon-192x192.png',
    url:       '/verNewsletterComToken.html',
    filtros:   [
      { field: 'segmento',          relation: '=', value: 'lead' },
      { field: 'alerta_nova_edicao', relation: '=', value: '1' },
    ],
  },

  siope_prazo_proximo: {
    titulo:    '⏰ Prazo SIOPE se aproximando!',
    corpo:     '{municipio}/{uf}: prazo de envio em {dias} dias ({data_prazo}). Não perca!',
    icon:      '/icons/icon-192x192.png',
    url:       '/painel.html',
    // Filtra por uf + municipio_cod (segmentação por município)
    filtros:   [
      { field: 'alerta_municipio', relation: '=', value: '1' },
      { field: 'uf',              relation: '=', value: '{uf}' },
      { field: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },

  siope_homologado: {
    titulo:    '✅ SIOPE homologado!',
    corpo:     '{municipio}/{uf}: dados do {bimestre}º bimestre de {ano} foram homologados.',
    icon:      '/icons/icon-192x192.png',
    url:       '/painel.html',
    filtros:   [
      { field: 'alerta_municipio', relation: '=', value: '1' },
      { field: 'uf',              relation: '=', value: '{uf}' },
      { field: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },

  siope_percentual_baixo: {
    titulo:    '⚠️ Alerta: percentual MDE baixo!',
    corpo:     '{municipio}/{uf}: {percentual}% aplicado em MDE ({bimestre}º bim/{ano}). Mínimo exigido: {minimo}%.',
    icon:      '/icons/icon-192x192.png',
    url:       '/painel.html',
    filtros:   [
      { field: 'alerta_municipio', relation: '=', value: '1' },
      { field: 'uf',              relation: '=', value: '{uf}' },
      { field: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },

  siope_nao_enviado: {
    titulo:    '🚨 SIOPE não enviado!',
    corpo:     '{municipio}/{uf}: dados do {bimestre}º bimestre ainda não foram enviados ao SIOPE. Prazo: {data_prazo}.',
    icon:      '/icons/icon-192x192.png',
    url:       '/painel.html',
    filtros:   [
      { field: 'alerta_municipio', relation: '=', value: '1' },
      { field: 'uf',              relation: '=', value: '{uf}' },
      { field: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },

  fundeb_repasse_creditado: {
    titulo:    '💰 Repasse FUNDEB creditado!',
    corpo:     '{municipio}/{uf}: R$ {valor} creditados referentes a {mes}/{ano}.',
    icon:      '/icons/icon-192x192.png',
    url:       '/painel.html',
    filtros:   [
      { field: 'alerta_municipio', relation: '=', value: '1' },
      { field: 'uf',              relation: '=', value: '{uf}' },
      { field: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },

  portaria_publicada: {
    titulo:    '📋 Nova portaria publicada!',
    corpo:     '{titulo_portaria}. Análise completa disponível no Radar SIOPE.',
    icon:      '/icons/icon-192x192.png',
    url:       '/verNewsletterComToken.html',
    // Só Supreme
    filtros:   [{ field: 'plano', relation: '=', value: 'supreme' }],
  },
};

// ─── Handler principal (Vercel Function) ─────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://app.radarsiope.com.br');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido.' });

  // Autenticação simples (token do admin via env)
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_API_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Não autorizado.' });
  }

  // ── POST acao=enviar-whatsapp ────────────────────────────────────────────────
  if (req.method === 'POST' && req.body?.acao === 'enviar-whatsapp') {
    return _handleEnviarWhatsApp(req, res);
  }

  const { tipo, parametros = {}, habilitado = true } = req.body;

  if (!tipo) return res.status(400).json({ ok: false, error: 'Campo "tipo" obrigatório.' });

  // Verifica se o tipo de alerta está habilitado (parametrizável pelo admin)
  if (!habilitado) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'Alerta desabilitado pelo admin.' });
  }

  // Verifica configuração no Firestore (override de template pelo admin)
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
      // Merge: admin pode customizar título e corpo
      if (conf.titulo) template.titulo = conf.titulo;
      if (conf.corpo)  template.corpo  = conf.corpo;
    }
  } catch (e) { console.warn('[alertas] Erro ao ler config Firestore:', e); }

  // Substituir variáveis no template
  const titulo = _substituir(template.titulo, parametros);
  const corpo  = _substituir(template.corpo,  parametros);
  const url    = _substituir(template.url,    parametros);

  // Montar filtros com os parâmetros reais
  const filtros = template.filtros.map(f => ({
    ...f,
    value: _substituir(f.value, parametros)
  }));

  // Payload OneSignal
  const payload = {
    app_id:             ONESIGNAL_APP_ID,
    headings:           { pt: titulo, en: titulo },
    contents:           { pt: corpo,  en: corpo  },
    url,
    chrome_web_icon:    template.icon,
    firefox_icon:       template.icon,
    filters:            filtros,
    priority:           tipo.includes('prazo') || tipo.includes('nao_enviado') ? 10 : 6,
    ttl:                86400, // expira em 24h se não entregue
    // Dados extras para o service worker
    data: {
      tipo,
      parametros,
      url,
    }
  };

  // Dispara via OneSignal REST API
  let oneSignalResult;
  try {
    const resp = await fetch(ONESIGNAL_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Key ${ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    oneSignalResult = await resp.json();
    if (!resp.ok) throw new Error(JSON.stringify(oneSignalResult));
  } catch (err) {
    console.error('[alertas] Erro OneSignal:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao disparar notificação.' });
  }

  // Registrar no Firestore (histórico de alertas disparados)
  try {
    await db.collection('alertas_disparados').add({
      tipo,
      titulo,
      corpo,
      parametros,
      filtros,
      onesignal_id:       oneSignalResult.id,
      destinatarios_est:  oneSignalResult.recipients || 0,
      disparado_em:       admin.firestore.FieldValue.serverTimestamp(),
      status:             'enviado',
    });
  } catch (e) { console.warn('[alertas] Erro ao registrar histórico:', e); }

  // ── WhatsApp: apenas para nova_edicao ────────────────────────────────────────
  if (tipo === 'nova_edicao') {
    _dispararWhatsAppNovaEdicao(tipo, titulo, corpo, parametros)
      .catch(err => console.error('[alertas] Erro no disparo WhatsApp nova_edicao:', err.message));
  }

  return res.status(200).json({
    ok:           true,
    tipo,
    titulo,
    destinatarios: oneSignalResult.recipients || 0,
    onesignal_id:  oneSignalResult.id,
  });
}

// ─── Buscar assinantes com WhatsApp opt-in ────────────────────────────────────
async function _buscarAssinantesWhatsApp() {
  try {
    const [snap1, snap2] = await Promise.all([
      db.collection('usuarios').where('ativo', '==', true).where('whatsappOptin', '==', true).get(),
      db.collection('usuarios').where('ativo', '==', true).where('whatsapp_optin', '==', true).get(),
    ]);
    const vistos = new Set();
    return [...snap1.docs, ...snap2.docs]
      .filter(d => { if (vistos.has(d.id)) return false; vistos.add(d.id); return true; })
      .map(d => ({ uid: d.id, numero: d.data().whatsapp || d.data().whatsapp_number, nome: d.data().nome || '' }))
      .filter(a => a.numero);
  } catch (err) {
    console.error('[alertas] Erro ao buscar assinantes WhatsApp:', err.message);
    return [];
  }
}

// ─── Envio automático pós-nova_edicao ─────────────────────────────────────────
async function _dispararWhatsAppNovaEdicao(tipo, titulo, corpo, parametros) {
  const assinantes = await _buscarAssinantesWhatsApp();
  if (!assinantes.length) return;

  const urlBase   = process.env.NEXT_PUBLIC_BASE_URL || 'https://app.radarsiope.com.br';
  const edicaoNum = parametros.edicao || '';

  const destinatarios = assinantes.map(a => ({
    numero: a.numero,
    texto:  _textoNovaEdicaoWpp(a.nome, edicaoNum, parametros.titulo || titulo, urlBase),
  }));

  const resultado = await enviarWhatsAppEmLote(destinatarios, 1500);

  await db.collection('alertas_disparados').add({
    tipo:              `${tipo}_whatsapp`,
    canal:             'whatsapp',
    titulo,
    parametros,
    enviados:          resultado.enviados,
    erros:             resultado.erros,
    total:             resultado.total,
    disparado_em:      admin.firestore.FieldValue.serverTimestamp(),
    status:            resultado.erros === 0 ? 'enviado' : 'parcial',
  }).catch(() => {});
}

function _textoNovaEdicaoWpp(nome, edicaoNum, tituloEdicao, urlBase) {
  const primeiroNome = (nome || '').split(' ')[0] || 'olá';
  const numStr = edicaoNum ? ` #${edicaoNum}` : '';
  return [
    `📡 *Radar SIOPE${numStr}* — Nova edição disponível!`,
    ``,
    `Olá, ${primeiroNome}! A edição${numStr} já está no ar:`,
    `*${tituloEdicao}*`,
    ``,
    `👉 ${urlBase}`,
    ``,
    `_Acesse pelo app e confira os indicadores do seu município._`,
  ].join('\n');
}

// ─── Handler: enviar WhatsApp manual (admin) ──────────────────────────────────
async function _handleEnviarWhatsApp(req, res) {
  const { numero, uids, todos, comunidade, mensagem } = req.body || {};

  if (!mensagem?.trim()) {
    return res.status(400).json({ ok: false, error: 'Mensagem obrigatória.' });
  }

  // ── Modo: grupo/comunidade ─────────────────────────────────────────────────
  if (comunidade) {
    const jidMap = {
      edicoes: process.env.EVOLUTION_GROUP_EDICOES,
      alertas: process.env.EVOLUTION_GROUP_ALERTAS,
    };
    const jid = jidMap[comunidade];
    if (!jid) {
      return res.status(400).json({
        ok: false,
        error: `Grupo "${comunidade}" não configurado. Defina EVOLUTION_GROUP_${comunidade.toUpperCase()} no Vercel.`,
      });
    }
    const resultado = await enviarWhatsApp(jid, mensagem.trim());
    if (resultado.ok) {
      await db.collection('alertas_disparados').add({
        canal: 'whatsapp', tipo: `comunidade_${comunidade}`,
        mensagem: mensagem.slice(0, 200), jid,
        status: 'enviado', disparado_em: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
    }
    return res.status(resultado.ok ? 200 : 500).json(resultado);
  }

  // ── Modo: número avulso ────────────────────────────────────────────────────
  if (numero) {
    const resultado = await enviarWhatsApp(numero, mensagem.trim());
    return res.status(resultado.ok ? 200 : 500).json(resultado);
  }

  // ── Modo: UIDs selecionados ────────────────────────────────────────────────
  if (Array.isArray(uids) && uids.length > 0) {
    const destinatarios = [];
    for (const uid of uids) {
      try {
        const snap = await db.collection('usuarios').doc(uid).get();
        if (!snap.exists) continue;
        const d   = snap.data();
        const num = d.whatsapp || d.whatsapp_number;
        if (num && (d.whatsappOptin || d.whatsapp_optin)) {
          destinatarios.push({ numero: num, texto: mensagem.trim() });
        }
      } catch (e) { /* ignora uid inválido */ }
    }
    if (!destinatarios.length) {
      return res.status(400).json({ ok: false, error: 'Nenhum destinatário com WhatsApp autorizado.' });
    }
    const resultado = await enviarWhatsAppEmLote(destinatarios, 1500);
    await db.collection('alertas_disparados').add({
      canal: 'whatsapp', tipo: 'manual_admin',
      mensagem: mensagem.slice(0, 200),
      destinatarios_est: uids.length, destinatarios_env: resultado.enviados,
      erros: resultado.erros, status: resultado.erros === 0 ? 'enviado' : 'parcial',
      disparado_em: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});
    return res.status(200).json({ ok: true, ...resultado });
  }

  // ── Modo: todos com opt-in ─────────────────────────────────────────────────
  if (todos === true) {
    const assinantes = await _buscarAssinantesWhatsApp();
    if (!assinantes.length) {
      return res.status(400).json({ ok: false, error: 'Nenhum assinante com WhatsApp autorizado.' });
    }
    const destinatarios = assinantes.map(a => ({ numero: a.numero, texto: mensagem.trim() }));
    const resultado     = await enviarWhatsAppEmLote(destinatarios, 1500);
    await db.collection('alertas_disparados').add({
      canal: 'whatsapp', tipo: 'manual_todos',
      mensagem: mensagem.slice(0, 200),
      destinatarios_est: assinantes.length, destinatarios_env: resultado.enviados,
      erros: resultado.erros, status: resultado.erros === 0 ? 'enviado' : 'parcial',
      disparado_em: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});
    return res.status(200).json({ ok: true, ...resultado });
  }

  return res.status(400).json({ ok: false, error: 'Informe numero, uids, comunidade ou todos:true.' });
}

// ─── Utilitário: substitui {variavel} no template ────────────────────────────
function _substituir(template, params) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`
  );
}
