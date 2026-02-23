/* ==========================================================================
   assinatura.js — Radar SIOPE
   Fluxo completo de assinatura: planos, ciclo mensal/anual, WhatsApp,
   cupom, preview, upsert usuário, registro assinatura, pagamento MP.

   Dependências globais:
   - window.db (Firestore inicializado)
   - inserirCamposUfMunicipio, aplicarMascaraTelefone (functions.js)
   - validarEmail, validarTelefoneFormato, mostrarMensagem (functions.js)
   - validateValorEParcelas (functions.js)
   - firebase.firestore.FieldValue (Firebase SDK)
   ========================================================================== */

'use strict';

// ─── Parâmetros de URL ────────────────────────────────────────────────────────
function getParam(nome) {
  return new URL(window.location.href).searchParams.get(nome);
}

const _origem      = getParam('origem') || 'direto';
const _planIdUrl   = getParam('planId') || null;
const _leadIdUrl   = getParam('leadId') || getParam('idLead') || null;

// ─── Estado global da sessão ──────────────────────────────────────────────────
let _cicloAtual    = 'mensal';   // 'mensal' | 'anual'
let _planoAtual    = null;       // objeto completo do plano selecionado
let _tiposMap      = {};         // id -> nome dos tipos de newsletter
let _cupomAplicado = null;       // objeto cupom validado

// ─── Features labels para renderizar nos cards ────────────────────────────────
const FEATURES_CARD = [
  { key: 'newsletter_texto',       label: 'Newsletter em texto'           },
  { key: 'newsletter_audio',       label: 'Newsletter em áudio (podcast)' },
  { key: 'newsletter_infografico', label: 'Infográfico por edição'        },
  { key: 'alertas_prioritarios',   label: 'Alertas prioritários'          },
  { key: 'grupo_whatsapp_vip',     label: 'Grupo VIP WhatsApp'            },
  { key: 'biblioteca_acesso',      label: 'Biblioteca vitalícia'          },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBRL(v) {
  const n = Number(v);
  if (isNaN(n) || v === null || v === undefined) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function safeNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function getPrecoPlano(plano, ciclo) {
  if (!plano) return 0;
  if (ciclo === 'anual' && plano.valor_anual != null) return Number(plano.valor_anual) || 0;
  if (plano.valor_mensal != null) return Number(plano.valor_mensal) || 0;
  // fallback campo legado
  return Number(plano.valor) || 0;
}

// ─── Toggle ciclo mensal / anual ─────────────────────────────────────────────

function selecionarCiclo(ciclo) {
  _cicloAtual = ciclo;
  document.getElementById('planCiclo').value = ciclo;

  document.getElementById('btn-ciclo-mensal').classList.toggle('ativo', ciclo === 'mensal');
  document.getElementById('btn-ciclo-anual').classList.toggle('ativo',  ciclo === 'anual');

  // re-renderizar preços nos cards sem recarregar do Firestore
  document.querySelectorAll('.plano-card').forEach(card => {
    const slug = card.dataset.slug;
    const p    = card._planoData;
    if (!p) return;

    const val  = getPrecoPlano(p, ciclo);
    const valM = getPrecoPlano(p, 'mensal');

    card.querySelector('.plano-preco-valor').textContent = fmtBRL(val);
    card.querySelector('.plano-preco-ciclo').textContent = ciclo === 'anual' ? '/ano' : '/mês';

    const econEl = card.querySelector('.plano-preco-anual-economia');
    if (econEl) {
      if (ciclo === 'anual' && valM > 0 && val > 0) {
        const economia = (valM * 12) - val;
        econEl.textContent = economia > 0 ? `Economia de ${fmtBRL(economia)}/ano` : '';
        econEl.style.display = 'block';
      } else {
        econEl.style.display = 'none';
      }
    }
  });

  // atualiza preview se já tiver plano selecionado
  if (_planoAtual) atualizarPreview();
}

// ─── Carregar plano por ID ────────────────────────────────────────────────────

async function carregarPlano(planId) {
  if (!planId) return null;
  try {
    const doc = await db.collection('planos').doc(planId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  } catch (err) {
    console.error('[assinatura] Erro ao carregar plano:', err);
    return null;
  }
}

// ─── Renderizar lista de planos em cards ──────────────────────────────────────

async function carregarListaPlanos() {
  const wrap = document.getElementById('planos-cards');
  if (!wrap) return;
  wrap.innerHTML = '<div style="color:#999;font-size:13px;padding:8px">Carregando planos...</div>';

  try {
    const snap = await db.collection('planos')
      .where('tipo', '==', 'assinatura')
      .where('status', '==', 'ativo')
      .orderBy('ordem', 'asc')
      .get()
      .catch(() =>
        db.collection('planos').where('tipo', '==', 'assinatura').where('status', '==', 'ativo').get()
      );

    if (snap.empty) {
      wrap.innerHTML = '<div style="color:#999">Nenhum plano disponível no momento.</div>';
      return;
    }

    wrap.innerHTML = '';

    snap.forEach(doc => {
      const p   = { id: doc.id, ...doc.data() };
      const cor = p.cor_destaque || '#0A3D62';
      const val = getPrecoPlano(p, _cicloAtual);
      const valM = getPrecoPlano(p, 'mensal');
      const features = p.features || {};

      const economia = (_cicloAtual === 'anual' && valM > 0 && p.valor_anual)
        ? (valM * 12) - Number(p.valor_anual)
        : 0;

      // lista de features
      const featuresHtml = FEATURES_CARD.map(f => {
        const ativo = !!features[f.key];
        // sugestão de tema e consultoria — mostra quota
        let label = f.label;
        if (f.key === 'grupo_whatsapp_vip' && ativo && features.sugestao_tema_quota) {
          label += ` + ${features.sugestao_tema_quota} sugestão/mês`;
        }
        if (f.key === 'grupo_whatsapp_vip' && features.consultoria_horas_mes) {
          label = `Consultoria ${features.consultoria_horas_mes}h/mês`;
        }
        return `<li class="${ativo ? '' : 'inativo'}">${label}</li>`;
      }).join('');

      const card = document.createElement('label');
      card.className     = `plano-card${p.destaque ? ' destaque' : ''}`;
      card.dataset.id    = p.id;
      card.dataset.slug  = p.plano_slug || '';
      card.style.setProperty('--plano-cor', cor);
      card._planoData    = p; // referência para selecionarCiclo()

      card.innerHTML = `
        ${p.destaque && p.badge ? `<div class="plano-badge-destaque">${p.badge}</div>` : ''}
        <input type="radio" name="plano-selecionado" value="${p.id}">
        <div class="plano-content">
          <div class="plano-nome">${p.nome || p.id}</div>
          <div class="plano-preco-wrap">
            <span class="plano-preco-valor" style="color:${cor}">${fmtBRL(val)}</span>
            <span class="plano-preco-ciclo">${_cicloAtual === 'anual' ? '/ano' : '/mês'}</span>
            <div class="plano-preco-anual-economia" style="${economia > 0 && _cicloAtual === 'anual' ? '' : 'display:none'}">
              ${economia > 0 ? `Economia de ${fmtBRL(economia)}/ano` : ''}
            </div>
          </div>
          ${p.descricao ? `<div class="plano-descricao">${p.descricao}</div>` : ''}
          <ul class="plano-features">${featuresHtml}</ul>
        </div>
      `;

      card.addEventListener('click', () => _onPlanoSelecionado(p.id));
      wrap.appendChild(card);
    });

    // Se veio planId na URL, pré-seleciona
    if (_planIdUrl) {
      const match = wrap.querySelector(`.plano-card[data-id="${_planIdUrl}"]`);
      if (match) {
        match.click();
      } else {
        await _onPlanoSelecionado(_planIdUrl);
      }
    }

  } catch (err) {
    console.error('[assinatura] Erro ao carregar planos:', err);
    wrap.innerHTML = '<div style="color:#c00;font-size:13px">Erro ao carregar planos. Recarregue a página.</div>';
  }
}

// ─── Ao selecionar um plano ───────────────────────────────────────────────────

async function _onPlanoSelecionado(planId) {
  const plano = await carregarPlano(planId);
  if (!plano) return;

  _planoAtual = plano;
  document.getElementById('planId').value = planId;

  // marca card visualmente
  document.querySelectorAll('.plano-card').forEach(c => {
    c.classList.toggle('selecionado', c.dataset.id === planId);
    const radio = c.querySelector('input[type="radio"]');
    if (radio) radio.checked = c.dataset.id === planId;
  });

  // atualiza campo de parcelas
  _atualizarCampoParcelas(plano);

  // mostra opt-in WhatsApp para todos os planos
  _mostrarWhatsappOptin();

  // carrega tipos de newsletter
  await carregarTiposNewsletter(Array.isArray(plano.tipos_inclusos) ? plano.tipos_inclusos : []);

  // atualiza preview
  await atualizarPreview();
}

// ─── Parcelas ────────────────────────────────────────────────────────────────

function _atualizarCampoParcelas(plano) {
  const el = document.getElementById('parcelas');
  if (!el) return;
  const max = plano.qtde_parcelas || 1;
  el.innerHTML = '';
  for (let i = 1; i <= max; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${i}x`;
    el.appendChild(opt);
  }
  el.value = '1';
}

// ─── WhatsApp opt-in ──────────────────────────────────────────────────────────

function _mostrarWhatsappOptin() {
  // Mostra o opt-in de WhatsApp se o campo tiver algum número digitado
  const wpInput = document.getElementById('whatsapp');
  const optinWrap = document.getElementById('whatsapp-optin-wrap');
  if (!wpInput || !optinWrap) return;

  const mostrar = () => {
    optinWrap.style.display = wpInput.value.replace(/\D/g, '').length >= 10 ? 'flex' : 'none';
  };

  wpInput.removeEventListener('input', mostrar);
  wpInput.addEventListener('input', mostrar);
  mostrar();
}

// ─── Tipos de newsletter ──────────────────────────────────────────────────────

async function carregarTiposNewsletter(preselected = []) {
  const container = document.getElementById('campo-newsletters');
  if (!container) return;

  try {
    const snap = await db.collection('tipo_newsletters').where('is_newsletter', '==', true).get();
    const tipos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    _tiposMap = {};
    tipos.forEach(t => { _tiposMap[t.id] = t.nome || t.id; });

    if (!tipos.length) {
      container.innerHTML = '<p style="color:#999;font-size:13px">Nenhum tipo de newsletter configurado.</p>';
      return;
    }

    const planFixado = !!(
      _planoAtual &&
      Array.isArray(_planoAtual.tipos_inclusos) &&
      _planoAtual.tipos_inclusos.length
    );

    container.innerHTML = `
      ${planFixado
        ? '<p style="font-size:12px;color:#666;margin:0 0 8px">Tipos incluídos no seu plano:</p>'
        : '<p style="font-size:12px;color:#666;margin:0 0 8px">Selecione seu(s) interesse(s):</p>'
      }
      <div id="grupo-newsletters" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${tipos.map(t => {
          const incl = planFixado
            ? _planoAtual.tipos_inclusos.map(String).includes(String(t.id))
            : preselected.includes(t.id);
          const disabled = planFixado ? 'disabled' : '';
          return `
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:${planFixado ? 'default' : 'pointer'}">
              <input type="checkbox" value="${t.id}" id="tipo-${t.id}"
                ${incl ? 'checked' : ''} ${disabled}
                style="width:15px;height:15px">
              <span>${t.nome || t.id}</span>
            </label>`;
        }).join('')}
      </div>
      ${!planFixado
        ? `<button type="button" id="btn-sel-todos"
             style="margin-top:8px;padding:5px 12px;font-size:12px;background:#f0f4f8;border:1px solid #d1d9e0;border-radius:6px;cursor:pointer">
             Selecionar todos
           </button>`
        : '<p style="font-size:12px;color:#0A3D62;margin:8px 0 0">✓ Tipos definidos pelo seu plano</p>'
      }
    `;

    if (!planFixado) {
      document.getElementById('btn-sel-todos')?.addEventListener('click', () => {
        container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
        atualizarPreview();
      });
      container.addEventListener('change', () => {
        if (_planoAtual && !_planoAtual.allow_multi_select) {
          const cbs = [...container.querySelectorAll('input[type="checkbox"]:checked')];
          if (cbs.length > 1) {
            const ultimo = cbs[cbs.length - 1];
            cbs.forEach(c => { if (c !== ultimo) c.checked = false; });
          }
        }
        atualizarPreview();
      });
    } else {
      await atualizarPreview();
    }

  } catch (err) {
    console.error('[assinatura] Erro ao carregar tipos:', err);
    container.innerHTML = '<p style="color:#c00;font-size:13px">Erro ao carregar tipos.</p>';
  }
}

// ─── Validar cupom ────────────────────────────────────────────────────────────

async function validarCupom(codigo) {
  if (!codigo) return null;
  try {
    const snap = await db.collection('cupons').where('codigo', '==', codigo).limit(1).get();
    if (snap.empty) { mostrarMensagem('Cupom não encontrado.'); return null; }
    const cupom = snap.docs[0].data();
    if (cupom.status !== 'ativo') { mostrarMensagem('Cupom inativo.'); return null; }
    if (cupom.expira_em && cupom.expira_em.toDate() < new Date()) { mostrarMensagem('Cupom expirado.'); return null; }
    return { ...cupom, _id: snap.docs[0].id };
  } catch (err) {
    console.error('[assinatura] Erro ao validar cupom:', err);
    return null;
  }
}

// ─── Calcular preview ─────────────────────────────────────────────────────────

async function calcularPreview(plano, tiposSelecionados = [], cupomObj = null) {
  const basePrice    = getPrecoPlano(plano, _cicloAtual);
  const tiposIncl    = Array.isArray(plano.tipos_inclusos) ? plano.tipos_inclusos.map(String) : [];
  const allowMulti   = !!plano.allow_multi_select;
  const bundles      = Array.isArray(plano.bundles) ? plano.bundles : [];

  const items = tiposSelecionados.map(id => ({
    id,
    nome:     _tiposMap[id] || id,
    included: tiposIncl.includes(String(id)),
    price:    tiposIncl.includes(String(id)) ? 0 : (Number(plano.price_per_tipo) || basePrice),
  }));

  let total = allowMulti
    ? items.reduce((s, i) => s + i.price, 0)
    : items.find(i => !i.included)?.price ?? (items.length ? basePrice : 0);

  // bundles
  bundles.forEach(b => {
    if (Array.isArray(b.types) && b.types.every(t => tiposSelecionados.includes(t))) {
      if (b.discount_percent) total -= total * (Number(b.discount_percent) / 100);
      else if (b.discount_fixed) total -= Number(b.discount_fixed);
    }
  });

  const totalBruto = Math.max(0, total);
  let desconto = 0;

  if (cupomObj) {
    if (cupomObj.tipo === 'percentual') desconto = totalBruto * ((Number(cupomObj.valor) || 0) / 100);
    else if (cupomObj.tipo === 'fixo')  desconto = Number(cupomObj.valor) || 0;
  }

  const totalFinal = Math.max(0, totalBruto - desconto);

  return {
    items,
    basePrice,
    totalBruto,
    desconto,
    total:        totalFinal,
    amountCentavos: Math.round(totalFinal * 100),
    ciclo:        _cicloAtual,
    cupom:        cupomObj,
  };
}

// ─── Atualizar preview no DOM ─────────────────────────────────────────────────

async function atualizarPreview() {
  const wrap     = document.getElementById('preview-breakdown');
  const itemsEl  = document.getElementById('preview-items');
  const totalEl  = document.getElementById('preview-total');
  if (!wrap) return;

  if (!_planoAtual) { wrap.style.display = 'none'; return; }

  const checks = [...document.querySelectorAll('#grupo-newsletters input[type="checkbox"]:checked')];
  const tipos  = checks.map(cb => cb.value);

  if (!tipos.length) { wrap.style.display = 'none'; return; }

  const pv = await calcularPreview(_planoAtual, tipos, _cupomAplicado);

  wrap.style.display = 'block';

  // itens
  if (itemsEl) {
    itemsEl.innerHTML = pv.items.map(it =>
      `<div class="preview-row">
        <span>${it.nome}</span>
        <span>${it.included ? '<span style="color:#16a34a">Incluído</span>' : fmtBRL(it.price)}</span>
      </div>`
    ).join('');
  }

  // total
  if (totalEl) {
    let html = '';

    if (pv.desconto > 0 && pv.cupom) {
      html += `<div class="preview-row desconto">
                 <span>🎟 Cupom ${pv.cupom.codigo}</span>
                 <span>- ${fmtBRL(pv.desconto)}</span>
               </div>`;
    }

    const parcelasEl = document.getElementById('parcelas');
    const parcelas = parcelasEl ? Number(parcelasEl.value) || 1 : 1;
    const semJuros = _planoAtual.permitir_sem_juros && parcelas <= (_planoAtual.parcelas_sem_juros || 1);

    let textoTotal = fmtBRL(pv.total);
    if (_cicloAtual === 'anual') {
      textoTotal += ' (pagamento anual)';
    } else if (parcelas > 1) {
      const parcVal = pv.total / parcelas;
      textoTotal = `${parcelas}× de ${fmtBRL(parcVal)}${semJuros ? ' sem juros' : ''}`;
    }

    html += `<div class="preview-row total"><span>Total</span><span>${textoTotal}</span></div>`;
    totalEl.innerHTML = html;
  }

  return pv;
}

// ─── Upsert usuário no Firestore ──────────────────────────────────────────────

async function upsertUsuario(dados) {
  const {
    nome, cpf, email, telefone, whatsapp, whatsappOptin,
    perfil, mensagem, preferencia,
    cod_uf, cod_municipio, nome_municipio,
    plano_slug, ciclo, features
  } = dados;

  const cpfNorm = (cpf || '').replace(/\D/g, '');

  // Campos base (sempre salvos)
  const base = {
    nome,
    cpfNormalizado: cpfNorm,
    telefone:          telefone  || null,
    whatsapp:          whatsapp  || null,
    whatsapp_opt_in:   whatsapp  ? (whatsappOptin ?? true) : false,
    whatsapp_opt_in_em: whatsapp ? firebase.firestore.FieldValue.serverTimestamp() : null,
    perfil:            perfil    || null,
    mensagem:          mensagem  || null,
    preferencia_contato: preferencia || null,
    cod_uf:            cod_uf        || null,
    cod_municipio:     cod_municipio || null,
    nome_municipio:    nome_municipio || null,
    origem:            _origem,
    updatedAt:         firebase.firestore.FieldValue.serverTimestamp(),
  };

  // Campos de plano — gravados APENAS quando o pagamento for confirmado via webhook.
  // Aqui salvamos somente o que é seguro gravar antes do pagamento.
  // (plano_slug, features, status — serão setados pelo webhook do MP)

  try {
    const q = await db.collection('usuarios').where('email', '==', email.toLowerCase()).limit(1).get();

    if (!q.empty) {
      const uid = q.docs[0].id;
      await db.collection('usuarios').doc(uid).update(base);
      return uid;
    } else {
      const ref = await db.collection('usuarios').add({
        ...base,
        email: email.toLowerCase(),
        // plano pendente — será ativado pelo webhook
        plano_status: 'pendente_pagamento',
        plano_slug:   plano_slug || null,
        plano_ciclo:  ciclo      || 'mensal',
        features:     features   || null,
        createdAt:    firebase.firestore.FieldValue.serverTimestamp(),
      });
      return ref.id;
    }
  } catch (err) {
    console.error('[assinatura] Erro em upsertUsuario:', err);
    throw err;
  }
}

// ─── Registrar assinatura (subcoleção) ───────────────────────────────────────

async function registrarAssinatura(userId, payload, preview) {
  if (!userId || !payload || !preview) throw new Error('Parâmetros obrigatórios ausentes.');

  const agora = new Date();
  const renovacao = new Date(agora);
  if (preview.ciclo === 'anual') renovacao.setFullYear(renovacao.getFullYear() + 1);
  else renovacao.setMonth(renovacao.getMonth() + 1);

  const data = {
    // Identificação
    planId:       payload.planId  || null,
    plano_slug:   payload.plano_slug || null,
    plano_nome:   payload.plano_nome || null,
    ciclo:        preview.ciclo   || 'mensal',
    // Tipos
    tipos_selecionados: Array.isArray(payload.tipos_selecionados) ? payload.tipos_selecionados : [],
    // Valores
    valor_original:  preview.totalBruto  ?? 0,
    valor_desconto:  preview.desconto    ?? 0,
    valor_final:     preview.total       ?? 0,
    amountCentavos:  preview.amountCentavos ?? 0,
    // Cupom
    cupom:           payload.cupom || null,
    // Features snapshot — garante histórico mesmo se o plano mudar depois
    features_snapshot: payload.features || null,
    // Datas
    data_inicio:         firebase.firestore.Timestamp.fromDate(agora),
    data_proxima_renovacao: firebase.firestore.Timestamp.fromDate(renovacao),
    // Status
    status:          'pendente_pagamento',
    paymentProvider: 'mercadopago',
    orderId:         payload.orderId || null,
    pedidoId:        null, // preenchido após retorno do backend
    // Auditoria
    origem:          _origem,
    createdAt:       firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt:       firebase.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const ref = await db.collection('usuarios').doc(userId).collection('assinaturas').add(data);
    return ref.id;
  } catch (err) {
    console.error('[assinatura] Erro em registrarAssinatura:', err);
    throw err;
  }
}

// ─── Criar pedido no backend (Mercado Pago) ───────────────────────────────────

async function criarPedidoBackend(payload) {
  const ctrl    = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);
  try {
    const resp = await fetch('/api/pagamentoMP?acao=criar-pedido', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  ctrl.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Backend ${resp.status}: ${txt}`);
    }
    return await resp.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ─── Prefill a partir do lead ─────────────────────────────────────────────────

async function prefillFromLead() {
  if (!_leadIdUrl) return null;
  try {
    const doc = await db.collection('leads').doc(_leadIdUrl).get();
    if (!doc.exists) return null;
    const lead = doc.data();

    const set = (id, val) => { if (val && document.getElementById(id)) document.getElementById(id).value = val; };
    set('nome',              lead.nome);
    set('email',             lead.email);
    set('telefone',          lead.telefone);
    set('whatsapp',          lead.whatsapp || lead.telefone);
    set('perfil',            lead.perfil);
    set('preferencia-contato', lead.preferencia_contato);

    if (Array.isArray(lead.interesses)) {
      lead.interesses.forEach(v => {
        const cb = document.getElementById(`tipo-${v}`)
          || document.querySelector(`#grupo-newsletters input[value="${v}"]`);
        if (cb) cb.checked = true;
      });
    }

    // mostra opt-in se tiver WhatsApp
    _mostrarWhatsappOptin();

    const st = document.getElementById('status-envio');
    if (st) { st.textContent = '✅ Dados preenchidos a partir do seu cadastro.'; st.style.color = '#16a34a'; }

    return lead;
  } catch (err) {
    console.error('[assinatura] Erro ao buscar lead:', err);
    return null;
  }
}

// ─── Validações do formulário ─────────────────────────────────────────────────

function clearErrors() {
  document.querySelectorAll('#form-assinatura .field-error').forEach(el => {
    el.textContent = '';
    el.style.display = 'none';
  });
}

function setError(id, msg) {
  const el = document.getElementById(`error-${id}`);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function validarCPF(cpf) {
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(cpf[i]) * (10 - i);
  let r = (s * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(cpf[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(cpf[i]) * (11 - i);
  r = (s * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  return r === parseInt(cpf[10]);
}

// ─── Submissão do formulário ──────────────────────────────────────────────────

async function processarEnvioAssinatura(e) {
  e.preventDefault();
  clearErrors();

  const btn    = document.getElementById('btn-assinar');
  const status = document.getElementById('status-envio');
  const setStatus = (msg, cor = '#555') => { if (status) { status.textContent = msg; status.style.color = cor; } };

  // ── Coleta de dados ──
  const nome       = document.getElementById('nome')?.value.trim()             || '';
  const cpf        = document.getElementById('cpf')?.value.trim()              || '';
  const email      = document.getElementById('email')?.value.trim()            || '';
  const telefone   = document.getElementById('telefone')?.value.trim()         || '';
  const whatsapp   = document.getElementById('whatsapp')?.value.trim()         || '';
  const wpOptin    = !!document.getElementById('whatsapp-optin')?.checked;
  const perfil     = document.getElementById('perfil')?.value                  || '';
  const mensagem   = document.getElementById('mensagem')?.value.trim()         || '';
  const preferencia = document.getElementById('preferencia-contato')?.value    || '';
  const cupomCod   = document.getElementById('cupom')?.value.trim()            || '';
  const aceita     = !!document.getElementById('aceita-termos')?.checked;
  const ciclo      = document.getElementById('planCiclo')?.value               || 'mensal';

  const tiposSelecionados = [...document.querySelectorAll('#grupo-newsletters input[type="checkbox"]:checked')]
    .map(cb => cb.value);

  // ── Validações ──
  let temErro = false;
  const erro = (campo, msg) => { setError(campo, msg); temErro = true; };

  if (nome.length < 3)       erro('nome',  'Nome deve ter pelo menos 3 caracteres.');
  if (!validarCPF(cpf))      erro('cpf',   'CPF inválido.');
  if (!validarEmail(email))  erro('email', 'E-mail inválido.');
  if (!perfil)               { mostrarMensagem('Selecione seu perfil.'); temErro = true; }
  if (!aceita)               { setError('aceita_termos', 'Você precisa aceitar os termos.'); temErro = true; }
  if (!tiposSelecionados.length) { mostrarMensagem('Selecione pelo menos um tipo de newsletter.'); temErro = true; }
  if (!_planoAtual)          { mostrarMensagem('Selecione um plano.'); temErro = true; }

  if (temErro) return;

  // ── Verificar se já tem assinatura ativa ──
  try {
    const exSnap = await db.collection('usuarios').where('email', '==', email.toLowerCase()).limit(1).get();
    if (!exSnap.empty) {
      const uid = exSnap.docs[0].id;
      const assSnap = await db.collection('usuarios').doc(uid).collection('assinaturas')
        .where('status', 'in', ['ativa', 'aprovada']).get();
      if (!assSnap.empty) {
        mostrarMensagem('Você já possui uma assinatura ativa. Acesse a Área do Assinante.');
        return;
      }
    }
  } catch (err) { console.warn('[assinatura] Verificação de ativo falhou:', err); }

  // ── UF / Município ──
  let dadosUf = null;
  try {
    dadosUf = typeof validarUfMunicipio === 'function' ? validarUfMunicipio() : null;
    if (!dadosUf) return; // validarUfMunicipio já mostra a mensagem de erro
  } catch (err) { console.warn('[assinatura] UF/Mun:', err); }

  // ── Preview final ──
  btn.disabled = true;
  setStatus('Calculando valores...', '#555');

  let preview;
  try {
    preview = await calcularPreview(_planoAtual, tiposSelecionados, _cupomAplicado);
  } catch (err) {
    setStatus('Erro ao calcular valores. Tente novamente.', '#c00');
    btn.disabled = false;
    return;
  }

  if (!preview || preview.amountCentavos <= 0) {
    setStatus('Valor inválido para pagamento.', '#c00');
    btn.disabled = false;
    return;
  }

  setStatus('Registrando dados...', '#555');

  try {
    // 1. Upsert do usuário
    const userId = await upsertUsuario({
      nome, cpf, email, telefone, whatsapp, whatsappOptin: wpOptin,
      perfil, mensagem, preferencia,
      cod_uf:        dadosUf?.cod_uf,
      cod_municipio: dadosUf?.cod_municipio,
      nome_municipio: dadosUf?.nome_municipio,
      plano_slug:    _planoAtual.plano_slug,
      ciclo,
      features:      _planoAtual.features || null,
    });

    // 2. Registrar assinatura
    const assinaturaId = await registrarAssinatura(userId, {
      planId:           _planoAtual.id,
      plano_slug:       _planoAtual.plano_slug || null,
      plano_nome:       _planoAtual.nome       || null,
      tipos_selecionados: tiposSelecionados,
      cupom:            cupomCod || null,
      features:         _planoAtual.features   || null,
    }, preview);

    // 3. Criar pedido no backend
    setStatus('Iniciando pagamento...', '#555');

    const backendResp = await criarPedidoBackend({
      userId,
      assinaturaId,
      amountCentavos:  preview.amountCentavos,
      cpf,
      nome,
      email,
      descricao:       _planoAtual.nome || 'Assinatura Radar SIOPE',
      installmentsMax: _planoAtual.parcelas_sem_juros || 1,
      dataPrimeiroVencimento: new Date().toISOString().split('T')[0],
      ciclo,
      plano_slug:      _planoAtual.plano_slug || null,
    });

    // 4. Salvar pedidoId localmente (opcional — webhook é a fonte de verdade)
    if (backendResp?.pedidoId) {
      db.collection('usuarios').doc(userId).collection('assinaturas').doc(assinaturaId)
        .update({ pedidoId: backendResp.pedidoId, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
        .catch(() => {});
    }

    // 5. Redirecionar para o Checkout
    if (backendResp?.redirectUrl) {
      window.location.href = backendResp.redirectUrl;
    } else {
      document.getElementById('modalConfirmacao').style.display = 'flex';
    }

  } catch (err) {
    console.error('[assinatura] Erro no processamento:', err);
    setStatus(err.message || 'Erro ao processar. Tente novamente.', '#c00');
  } finally {
    btn.disabled = false;
  }
}

// ─── Inicialização ────────────────────────────────────────────────────────────

async function initAssinatura() {
  // Máscaras
  const telEl = document.getElementById('telefone');
  const wpEl  = document.getElementById('whatsapp');
  if (telEl && typeof aplicarMascaraTelefone === 'function') aplicarMascaraTelefone(telEl);
  if (wpEl  && typeof aplicarMascaraTelefone === 'function') aplicarMascaraTelefone(wpEl);

  // Máscara CPF
  document.getElementById('cpf')?.addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').slice(0, 11);
    v = v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    this.value = v;
  });

  // UF / Município — busca lead antecipado para pré-preencher
  let leadPreload = null;
  if (_leadIdUrl) {
    try {
      const d = await db.collection('leads').doc(_leadIdUrl).get();
      if (d.exists) leadPreload = d.data();
    } catch (e) {}
  }

  window.validarUfMunicipio = await inserirCamposUfMunicipio(
    document.getElementById('campo-uf-municipio'),
    leadPreload?.cod_uf        || '',
    leadPreload?.cod_municipio || ''
  );

  // Carregar planos ou plano específico da URL
  if (_planIdUrl) {
    const plano = await carregarPlano(_planIdUrl);
    if (plano && plano.tipo === 'assinatura') {
      await _onPlanoSelecionado(_planIdUrl);
      // Esconde a seção de seleção se veio planId — o usuário já escolheu
      // (opcional — remova se quiser permitir troca)
      // document.getElementById('secao-planos').style.display = 'none';
    } else {
      await carregarListaPlanos();
    }
  } else {
    await carregarListaPlanos();
    await carregarTiposNewsletter([]);
  }

  // Prefill lead
  await prefillFromLead();

  // Cupom
  document.getElementById('aplicar-cupom')?.addEventListener('click', async () => {
    const codigo = document.getElementById('cupom')?.value.trim();
    const fb     = document.getElementById('cupom-feedback');
    if (!_planoAtual) { mostrarMensagem('Selecione um plano antes de aplicar o cupom.'); return; }
    if (!codigo)       { mostrarMensagem('Digite um código de cupom.'); return; }
    const cupom = await validarCupom(codigo);
    if (cupom) {
      _cupomAplicado = cupom;
      if (fb) { fb.textContent = `✅ Cupom "${codigo}" aplicado!`; fb.style.color = '#16a34a'; }
      await atualizarPreview();
    } else {
      _cupomAplicado = null;
      if (fb) { fb.textContent = ''; }
    }
  });

  // Parcelas → atualiza preview
  document.getElementById('parcelas')?.addEventListener('change', atualizarPreview);

  // Submit
  document.getElementById('form-assinatura')?.addEventListener('submit', processarEnvioAssinatura);
}

// ── Exporta selecionarCiclo para o HTML (chamado via onclick) ──
window.selecionarCiclo = selecionarCiclo;

// ── Auto-init ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAssinatura);
} else {
  initAssinatura();
}
