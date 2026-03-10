/* ==========================================================================
   api/push.js — Radar SIOPE · Vercel Function
   Rota: POST /api/push

   Ações (campo "acao" no body):
   ┌──────────────┬───────────────────────────────────────────────────────┐
   │ acao         │ descrição                                             │
   ├──────────────┼───────────────────────────────────────────────────────┤
   │ token        │ Salva onesignal_player_id do lead no Supabase         │
   │ consent      │ Registra consentimento LGPD do lead no Supabase       │
   │ alerta       │ Dispara push segmentado via OneSignal + loga Firestore │
   └──────────────┴───────────────────────────────────────────────────────┘

   Autenticação:
   - "token" e "consent": sem token (chamados pelo próprio usuário logado)
   - "alerta": requer header x-admin-token (chamado pelo painel admin / Python)

   Variáveis de ambiente necessárias (Vercel):
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY
   - ONESIGNAL_APP_ID
   - ONESIGNAL_REST_API_KEY
   - ADMIN_API_TOKEN
   - ALLOWED_ORIGIN
   ========================================================================== */

import { createClient } from '@supabase/supabase-js';
import admin            from 'firebase-admin';

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Firebase Admin ───────────────────────────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}
const db = admin.firestore();

// ─── OneSignal ────────────────────────────────────────────────────────────────
const ONESIGNAL_APP_ID  = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_REST_API_KEY;
const ONESIGNAL_URL     = 'https://onesignal.com/api/v1/notifications';

// ─── Templates de alerta ──────────────────────────────────────────────────────
// Admin pode sobrescrever título/corpo via Firestore (coleção: config_alertas)
const TEMPLATES = {

  nova_edicao: {
    titulo:  '📡 Nova edição Radar SIOPE!',
    corpo:   'A edição #{edicao} já está disponível. {titulo}',
    icon:    '/icons/icon-192x192.png',
    url:     '/verNewsletterComToken.html',
    filtros: [{ field: 'alerta_nova_edicao', relation: '=', value: '1' }],
  },

  nova_edicao_acesso_pro: {
    titulo:  '🔓 Acesso especial liberado!',
    corpo:   'Edição #{edicao} com acesso completo por {horas}h. Exclusivo para você!',
    icon:    '/icons/icon-192x192.png',
    url:     '/verNewsletterComToken.html',
    filtros: [
      { field: 'segmento',           relation: '=', value: 'lead' },
      { field: 'alerta_nova_edicao', relation: '=', value: '1'    },
    ],
  },

  siope_prazo_proximo: {
    titulo:  '⏰ Prazo SIOPE se aproximando!',
    corpo:   '{municipio}/{uf}: prazo de envio em {dias} dias ({data_prazo}). Não perca!',
    icon:    '/icons/icon-192x192.png',
    url:     '/painel.html',
    filtros: [
      { field: 'alerta_municipio', relation: '=', value: '1'              },
      { field: 'uf',              relation: '=', value: '{uf}'            },
      { field: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },

  siope_homologado: {
    titulo:  '✅ SIOPE homologado!',
    corpo:   '{municipio}/{uf}: dados do {bimestre}º bimestre de {ano} foram homologados.',
    icon:    '/icons/icon-192x192.png',
    url:     '/painel.html',
    filtros: [
      { field: 'alerta_municipio', relation: '=', value: '1'              },
      { field: 'uf',              relation: '=', value: '{uf}'            },
      { field: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },

  siope_percentual_baixo: {
    titulo:  '⚠️ Alerta: percentual MDE baixo!',
    corpo:   '{municipio}/{uf}: {percentual}% em MDE ({bimestre}º bim/{ano}). Mínimo: {minimo}%.',
    icon:    '/icons/icon-192x192.png',
    url:     '/painel.html',
    filtros: [
      { field: 'alerta_municipio', relation: '=', value: '1'              },
      { field: 'uf',              relation: '=', value: '{uf}'            },
      { field: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },

  siope_nao_enviado: {
    titulo:  '🚨 SIOPE não enviado!',
    corpo:   '{municipio}/{uf}: {bimestre}º bimestre não enviado. Prazo: {data_prazo}.',
    icon:    '/icons/icon-192x192.png',
    url:     '/painel.html',
    filtros: [
      { field: 'alerta_municipio', relation: '=', value: '1'              },
      { field: 'uf',              relation: '=', value: '{uf}'            },
      { field: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },

  fundeb_repasse_creditado: {
    titulo:  '💰 Repasse FUNDEB creditado!',
    corpo:   '{municipio}/{uf}: R$ {valor} referentes a {mes}/{ano}.',
    icon:    '/icons/icon-192x192.png',
    url:     '/painel.html',
    filtros: [
      { field: 'alerta_municipio', relation: '=', value: '1'              },
      { field: 'uf',              relation: '=', value: '{uf}'            },
      { field: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },

  portaria_publicada: {
    titulo:  '📋 Nova portaria publicada!',
    corpo:   '{titulo_portaria}. Análise completa disponível no Radar SIOPE.',
    icon:    '/icons/icon-192x192.png',
    url:     '/verNewsletterComToken.html',
    filtros: [{ field: 'plano', relation: '=', value: 'supreme' }],
  },
};

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin',  process.env.ALLOWED_ORIGIN || 'https://app.radarsiope.com.br');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false, error: 'Método não permitido.' });

  const { acao, ...dados } = req.body || {};

  if (!acao) return res.status(400).json({ ok: false, error: 'Campo "acao" obrigatório.' });

  switch (acao) {
    case 'token':   return _handleToken(dados, res);
    case 'consent': return _handleConsent(dados, res);
    case 'alerta':  return _handleAlerta(req, dados, res);
    default:        return res.status(400).json({ ok: false, error: `Ação desconhecida: ${acao}` });
  }
}

// ─── AÇÃO: token ──────────────────────────────────────────────────────────────
// Salva o onesignal_player_id do lead no Supabase.
// Body extra: { leadId, playerId, plataforma }
async function _handleToken({ leadId, playerId, plataforma }, res) {
  if (!leadId || !playerId) {
    return res.status(400).json({ ok: false, error: 'leadId e playerId são obrigatórios.' });
  }

  const { error } = await supabase
    .from('leads')
    .update({
      onesignal_player_id: playerId,
      push_opt_in:         true,
      push_opt_in_em:      new Date().toISOString(),
      push_plataforma:     plataforma || null,
    })
    .eq('id', leadId);

  if (error) {
    console.error('[push/token] Supabase:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao salvar token.' });
  }

  return res.status(200).json({ ok: true });
}

// ─── AÇÃO: consent ────────────────────────────────────────────────────────────
// Registra consentimento LGPD do lead no Supabase.
// Body extra: { leadId, aceito (boolean), plataforma }
async function _handleConsent({ leadId, aceito, plataforma }, res) {
  if (!leadId || typeof aceito !== 'boolean') {
    return res.status(400).json({ ok: false, error: 'leadId e aceito (boolean) são obrigatórios.' });
  }

  const agora = new Date().toISOString();

  const { error } = await supabase
    .from('leads')
    .update({
      push_consentimento:    aceito,
      push_consentimento_em: agora,
      push_plataforma:       plataforma || null,
      ...(aceito === false ? { push_opt_in: false } : {}),
    })
    .eq('id', leadId);

  if (error) {
    console.error('[push/consent] Supabase:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao registrar consentimento.' });
  }

  return res.status(200).json({ ok: true, aceito, registrado_em: agora });
}

// ─── AÇÃO: alerta ─────────────────────────────────────────────────────────────
// Dispara push segmentado via OneSignal e registra histórico no Firestore.
// Requer header x-admin-token.
// Body extra: { tipo, parametros, habilitado }
async function _handleAlerta(req, { tipo, parametros = {}, habilitado = true }, res) {
  // Autenticação — só admin/Python pode disparar alertas
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_API_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Não autorizado.' });
  }

  if (!tipo) return res.status(400).json({ ok: false, error: 'Campo "tipo" obrigatório.' });

  if (!habilitado) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'Alerta desabilitado pelo requisitante.' });
  }

  // Template base
  let template = { ...TEMPLATES[tipo] };
  if (!template.titulo) {
    return res.status(400).json({ ok: false, error: `Tipo de alerta desconhecido: ${tipo}` });
  }

  // Override via Firestore (admin pode customizar título/corpo sem deploy)
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
  } catch (e) { console.warn('[push/alerta] config Firestore:', e); }

  // Interpola variáveis {chave} nos templates
  const titulo  = _sub(template.titulo, parametros);
  const corpo   = _sub(template.corpo,  parametros);
  const url     = _sub(template.url,    parametros);
  const filtros = template.filtros.map(f => ({ ...f, value: _sub(f.value, parametros) }));

  // Payload OneSignal
  const payload = {
    app_id:          ONESIGNAL_APP_ID,
    headings:        { pt: titulo, en: titulo },
    contents:        { pt: corpo,  en: corpo  },
    url,
    chrome_web_icon: template.icon,
    firefox_icon:    template.icon,
    filters:         filtros,
    priority:        tipo.includes('prazo') || tipo.includes('nao_enviado') ? 10 : 6,
    ttl:             86400,
    data:            { tipo, parametros, url },
  };

  // Dispara
  let result;
  try {
    const resp = await fetch(ONESIGNAL_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Key ${ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    result = await resp.json();
    if (!resp.ok) throw new Error(JSON.stringify(result));
  } catch (err) {
    console.error('[push/alerta] OneSignal:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao disparar notificação.' });
  }

  // Histórico no Firestore
  try {
    await db.collection('alertas_disparados').add({
      tipo,
      titulo,
      corpo,
      parametros,
      filtros,
      onesignal_id:      result.id,
      destinatarios_est: result.recipients || 0,
      disparado_em:      admin.firestore.FieldValue.serverTimestamp(),
      status:            'enviado',
    });
  } catch (e) { console.warn('[push/alerta] histórico Firestore:', e); }

  return res.status(200).json({
    ok:            true,
    tipo,
    titulo,
    destinatarios: result.recipients || 0,
    onesignal_id:  result.id,
  });
}

// ─── Utilitário: substitui {chave} no template ────────────────────────────────
function _sub(str, params) {
  if (!str) return '';
  return str.replace(/\{(\w+)\}/g, (_, k) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`
  );
}
