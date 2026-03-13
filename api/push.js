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

// Runtime Node obrigatório — firebase-admin não é compatível com Edge runtime
export const config = { runtime: 'nodejs' };

import admin from 'firebase-admin';

// ─── Supabase (lazy — só instanciado nas ações token/consent) ─────────────────
let _supabase = null;
async function getSupabase() {
  if (_supabase) return _supabase;
  const { createClient } = await import('@supabase/supabase-js');
  _supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  return _supabase;
}

// ─── Firebase Admin ───────────────────────────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, '\n'),
    }),
  });
}
const db = admin.firestore();

// ─── OneSignal ────────────────────────────────────────────────────────────────
const ONESIGNAL_APP_ID  = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_REST_API_KEY;
const ONESIGNAL_URL     = 'https://onesignal.com/api/v1/notifications';

// ─── Templates de alerta ──────────────────────────────────────────────────────
// Admin pode sobrescrever título/corpo via Firestore (coleção: config_alertas)
const TEMPLATES = {

  // nova_edicao: e-mail é o canal principal. Push aqui serve como aviso geral.
  nova_edicao: {
    titulo:  '📡 Nova edição Radar SIOPE!',
    corpo:   'A edição #{edicao} já está disponível. {titulo}',
    icon:    '/icons/icon-192x192.png',
    url:     '/verNewsletterComToken.html',
    filtros: [{ field: 'tag', key: 'segmento', relation: '=', value: 'assinante' }],
  },

  // Acesso pro temporário para leads
  nova_edicao_acesso_pro: {
    titulo:  '🔓 Acesso especial liberado!',
    corpo:   'Edição #{edicao} com acesso completo por {horas}h. Exclusivo para você!',
    icon:    '/icons/icon-192x192.png',
    url:     '/verNewsletterComToken.html',
    filtros: [{ field: 'tag', key: 'segmento', relation: '=', value: 'lead' }],
  },

  siope_prazo_proximo: {
    titulo:  '⏰ Prazo SIOPE se aproximando!',
    corpo:   '{municipio}/{uf}: prazo de envio em {dias} dias ({data_prazo}). Não perca!',
    icon:    '/icons/icon-192x192.png',
    url:     '/painel.html',
    filtros: [
      { field: 'tag', key: 'alerta_municipio', relation: '=', value: '1'              },
      { field: 'tag', key: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },

  siope_homologado: {
    titulo:  '✅ SIOPE homologado!',
    corpo:   '{municipio}/{uf}: dados do {bimestre}º bimestre de {ano} foram homologados.',
    icon:    '/icons/icon-192x192.png',
    url:     '/painel.html',
    filtros: [
      { field: 'tag', key: 'alerta_municipio', relation: '=', value: '1'              },
      { field: 'tag', key: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },

  siope_percentual_baixo: {
    titulo:  '⚠️ Alerta: percentual MDE baixo!',
    corpo:   '{municipio}/{uf}: {percentual}% em MDE ({bimestre}º bim/{ano}). Mínimo: {minimo}%.',
    icon:    '/icons/icon-192x192.png',
    url:     '/painel.html',
    filtros: [
      { field: 'tag', key: 'alerta_municipio', relation: '=', value: '1'              },
      { field: 'tag', key: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },

  siope_nao_enviado: {
    titulo:  '🚨 SIOPE não enviado!',
    corpo:   '{municipio}/{uf}: {bimestre}º bimestre não enviado. Prazo: {data_prazo}.',
    icon:    '/icons/icon-192x192.png',
    url:     '/painel.html',
    filtros: [
      { field: 'tag', key: 'alerta_municipio', relation: '=', value: '1'              },
      { field: 'tag', key: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },

  fundeb_repasse_creditado: {
    titulo:  '💰 Repasse FUNDEB creditado!',
    corpo:   '{municipio}/{uf}: R$ {valor} referentes a {mes}/{ano}.',
    icon:    '/icons/icon-192x192.png',
    url:     '/painel.html',
    filtros: [
      { field: 'tag', key: 'alerta_municipio', relation: '=', value: '1'              },
      { field: 'tag', key: 'municipio_cod',   relation: '=', value: '{municipio_cod}' },
    ],
  },

  portaria_publicada: {
    titulo:  '📋 Nova portaria publicada!',
    corpo:   '{titulo_portaria}. Análise completa disponível no Radar SIOPE.',
    icon:    '/icons/icon-192x192.png',
    url:     '/verNewsletterComToken.html',
    filtros: [{ field: 'tag', key: 'plano', relation: '=', value: 'supreme' }],
  },
};

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  const _allowedOrigins = [
    'https://app.radarsiope.com.br',
    'https://radarsiope-vercel.vercel.app',
    ...(process.env.ALLOWED_ORIGIN ? [process.env.ALLOWED_ORIGIN] : []),
  ];
  const _origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', _allowedOrigins.includes(_origin) ? _origin : _allowedOrigins[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false, error: 'Método não permitido.' });

  const { acao, ...dados } = req.body || {};

  if (!acao) return res.status(400).json({ ok: false, error: 'Campo "acao" obrigatório.' });

  switch (acao) {
    case 'token':             return _handleToken(dados, res);
    case 'consent':           return _handleConsent(dados, res);
    case 'admin-token':       return _handleAdminToken(dados, res);
    case 'buscar-municipios': return _handleBuscarMunicipios(req, dados, res);
    case 'alerta':            return _handleAlerta(req, dados, res);
    case 'sincronizar-tags':  return _handleSincronizarTags(dados, res);
    default:                  return res.status(400).json({ ok: false, error: `Ação desconhecida: ${acao}` });
  }
}

// ─── AÇÃO: buscar-municipios ──────────────────────────────────────────────────
// Retorna lista de municípios únicos de users com push ativo.
// Assinantes → Firestore (usuarios com push_opt_in=true)
// Leads      → Supabase  (leads com push_opt_in=true)
// Requer header x-admin-token.
// Body extra: { publico: 'assinantes' | 'leads' }
async function _handleBuscarMunicipios(req, { publico }, res) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_API_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Não autorizado.' });
  }

  if (!publico || !['assinantes', 'leads'].includes(publico)) {
    return res.status(400).json({ ok: false, error: 'publico deve ser "assinantes" ou "leads".' });
  }

  try {
    if (publico === 'assinantes') {
      // Firestore: usuarios com push ativo
      // Campos confirmados: cod_municipio, nome_municipio, cod_uf
      const snap = await db.collection('usuarios')
        .where('push_opt_in', '==', true)
        .get();

      const mapa = new Map();
      snap.docs.forEach(doc => {
        const d   = doc.data();
        const cod  = d.cod_municipio || '';
        const nome = d.nome_municipio || cod;
        const uf   = d.cod_uf || '';
        if (cod && !mapa.has(cod)) {
          mapa.set(cod, { cod, nome, uf });
        }
      });

      const municipios = Array.from(mapa.values())
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

      return res.status(200).json({ ok: true, municipios });

    } else {
      // Leads: busca municípios únicos com push ativo
      // Campos confirmados: cod_municipio, nome_municipio, cod_uf
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from('leads')
        .select('cod_municipio, nome_municipio, cod_uf')
        .eq('push_opt_in', true)
        .not('cod_municipio', 'is', null);

      if (error) throw error;

      const mapa = new Map();
      (data || []).forEach(row => {
        const cod  = row.cod_municipio || '';
        const nome = row.nome_municipio || cod;
        const uf   = row.cod_uf || '';
        if (cod && !mapa.has(cod)) {
          mapa.set(cod, { cod, nome, uf });
        }
      });

      const municipios = Array.from(mapa.values())
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

      return res.status(200).json({ ok: true, municipios });
    }

  } catch (err) {
    console.error('[push/buscar-municipios]:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao buscar municípios.' });
  }
}

// ─── AÇÃO: admin-token ────────────────────────────────────────────────────────
// Valida se o email pertence a um admin no Firestore e retorna o ADMIN_API_TOKEN.
// O painel chama isso automaticamente no carregamento — zero digitação manual.
// Body extra: { email }
async function _handleAdminToken({ email }, res) {
  if (!email) {
    return res.status(400).json({ ok: false, error: 'email é obrigatório.' });
  }

  try {
    // Busca o usuário no Firestore pelo email
    const snap = await db.collection('usuarios')
      .where('email', '==', email.toLowerCase().trim())
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(403).json({ ok: false, error: 'Usuário não encontrado.' });
    }

    const usuario = snap.docs[0].data();

    // Só admins podem obter o token
    if (usuario.tipo_perfil !== 'Admin') {
      return res.status(403).json({ ok: false, error: 'Acesso negado.' });
    }

    // Retorna o token — trafega sobre HTTPS, exposto apenas para Admin validado
    return res.status(200).json({
      ok:    true,
      token: process.env.ADMIN_API_TOKEN,
    });

  } catch (err) {
    console.error('[push/admin-token] Firestore:', err);
    return res.status(500).json({ ok: false, error: 'Erro interno.' });
  }
}

// ─── AÇÃO: token ──────────────────────────────────────────────────────────────
// Salva o onesignal_player_id do lead no Supabase.
// Body extra: { leadId, playerId, plataforma }
async function _handleToken({ leadId, playerId, plataforma }, res) {
  if (!leadId || !playerId) {
    return res.status(400).json({ ok: false, error: 'leadId e playerId são obrigatórios.' });
  }

  const supabase = await getSupabase();
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

  const supabase = await getSupabase();
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
//
// Campos especiais em `parametros` (enviados pelo painel admin, removidos antes
// de passar ao template para não poluir a interpolação):
//   _publico      : 'leads' | 'assinantes' | 'todos'     → adiciona filtro segmento
//   _feature      : 'com'   | 'sem'        | 'todos'     → controla alerta_municipio
//   _url_override : string                               → substitui a URL do template
//   _municipios   : [{ cod, nome }, ...]                 → múltiplos municípios com OR
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

  // ── Extrai campos de controle do painel (não são variáveis de template) ──────
  // _municipios: array de { cod, nome } para alertas de município com múltipla seleção
  const { _publico, _feature, _url_override, _municipios, ...params } = parametros;

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

  // ── Interpola variáveis {chave} nos templates (usa params limpos) ────────────
  const titulo = _sub(template.titulo, params);
  const corpo  = _sub(template.corpo,  params);
  const BASE_URL = 'https://app.radarsiope.com.br';
  const url    = _url_override?.trim() || (BASE_URL + _sub(template.url, params));

  // ── Monta filtros base do template (sem municipio_cod — tratado abaixo) ────────
  // OneSignal tags customizadas usam field:"tag" + key:"nome_da_tag"
  const filtrosBase = template.filtros
    .filter(f => !(f.field === 'tag' && f.key === 'municipio_cod') && f.field !== 'municipio_cod')
    .map(f => ({
      field:    'tag',
      key:      f.key || f.field,   // templates novos têm f.key, antigos usavam f.field
      relation: f.relation,
      value:    _sub(f.value, params),
    }));

  // ── Filtro de público (_publico) ─────────────────────────────────────────────
  const temSegmento = filtrosBase.some(f => f.key === 'segmento');
  if (!temSegmento && _publico && _publico !== 'todos') {
    const val = _publico === 'assinantes' ? 'assinante' : 'lead';
    filtrosBase.push({ field: 'tag', key: 'segmento', relation: '=', value: val });
  }

  // ── Filtro de feature de alerta (_feature) ───────────────────────────────────
  if (_feature && _feature !== 'todos') {
    const idx = filtrosBase.findIndex(f => f.key === 'alerta_municipio');
    if (idx !== -1) filtrosBase.splice(idx, 1);
    const val = _feature === 'com' ? '1' : '0';
    filtrosBase.push({ field: 'tag', key: 'alerta_municipio', relation: '=', value: val });
    if (_feature === 'sem') {
      const temSeg = filtrosBase.some(f => f.key === 'segmento');
      if (!temSeg) filtrosBase.push({ field: 'tag', key: 'segmento', relation: '=', value: 'assinante' });
    }
  }

  // ── Múltiplos municípios → grupos com OR no OneSignal ────────────────────────
  // OneSignal avalia: (filtrosBase AND cod=A) OR (filtrosBase AND cod=B) OR ...
  // Para 1 município ou nenhum: usa filtrosBase direto (sem OR)
  let filtros;
  const muns = Array.isArray(_municipios) && _municipios.length > 0 ? _municipios : null;

  if (!muns) {
    // Sem seleção de município — usa o params.municipio_cod do template se existir
    filtros = filtrosBase;
  } else if (muns.length === 1) {
    // Município único — adiciona direto, sem OR
    filtros = [...filtrosBase, { field: 'tag', key: 'municipio_cod', relation: '=', value: String(muns[0].cod) }];
  } else {
    // Múltiplos municípios — expande em grupos (filtrosBase AND cod=X) OR (filtrosBase AND cod=Y)
    filtros = [];
    muns.forEach((mun, i) => {
      if (i > 0) filtros.push({ operator: 'OR' });
      filtrosBase.forEach(f => filtros.push({ ...f }));
      filtros.push({ field: 'tag', key: 'municipio_cod', relation: '=', value: String(mun.cod) });
    });
  }

  // ── Payload OneSignal ─────────────────────────────────────────────────────────
  const payload = {
    app_id:          ONESIGNAL_APP_ID,
    headings:        { pt: titulo, en: titulo },
    contents:        { pt: corpo,  en: corpo  },
    web_url:         url,
    launch_url:      url,
    chrome_web_icon: template.icon,
    firefox_icon:    template.icon,
    filters:         filtros,
    priority:        tipo.includes('prazo') || tipo.includes('nao_enviado') ? 10 : 6,
    ttl:             86400,
    data:            { tipo, parametros: params, url },
  };

  // ── Dispara ───────────────────────────────────────────────────────────────────
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

  // ── Histórico no Firestore ────────────────────────────────────────────────────
  try {
    await db.collection('alertas_disparados').add({
      tipo,
      titulo,
      corpo,
      parametros:        params,
      filtros,
      publico:           _publico    || 'todos',
      feature:           _feature    || 'todos',
      url_override:      _url_override || null,
      municipios:        _municipios  || null,
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
    filtros,
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

// ─── Sincronizar tags via REST API (contorna 409 do SDK browser) ──────────────
async function _handleSincronizarTags(dados, res) {
  // subscriptionId = PushSubscription.id (API v1 player_id)
  const { subscriptionId, tags } = dados;
  if (!subscriptionId || !tags) return res.status(400).json({ ok: false, error: 'subscriptionId e tags obrigatórios.' });

  try {
    // API v1 — PUT /players/:id com app_id + tags
    const r = await fetch(
      `https://onesignal.com/api/v1/players/${subscriptionId}`,
      {
        method:  'PUT',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Key ${ONESIGNAL_API_KEY}`,
        },
        body: JSON.stringify({ app_id: ONESIGNAL_APP_ID, tags }),
      }
    );
    const data = await r.json();
    if (!r.ok || !data.success) {
      console.error('[push/sincronizar-tags] Erro OneSignal:', JSON.stringify(data));
      return res.status(500).json({ ok: false, error: JSON.stringify(data) });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[push/sincronizar-tags] Exceção:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
