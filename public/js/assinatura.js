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
let _cicloAtual    = 3;          // 3 | 6 | 12 (meses)
let _planoAtual    = null;       // objeto completo do plano selecionado
let _tiposMap      = {};         // id -> nome dos tipos de newsletter
let _cupomAplicado = null;       // objeto cupom validado

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

// Retorna o percentual de desconto configurado no plano para o ciclo
function getDescontoPct(plano, cicloMeses) {
  if (!plano) return 0;
  if (cicloMeses === 6)  return Number(plano.desconto_pct_6m)  || 0;
  if (cicloMeses === 12) return Number(plano.desconto_pct_12m) || 0;
  return 0; // 3 meses sem desconto
}

// Retorna o preço mensal efetivo (com desconto) para o ciclo
function getPrecoPlano(plano, cicloMeses) {
  if (!plano) return 0;
  const base = Number(plano.valor_mensal) || Number(plano.valor) || 0;
  const pct  = getDescontoPct(plano, cicloMeses);
  return Math.round(base * (1 - pct / 100) * 100) / 100;
}

// Retorna o total do ciclo (mensal efetivo × meses)
function getTotalCiclo(plano, cicloMeses) {
  return Math.round(getPrecoPlano(plano, cicloMeses) * cicloMeses * 100) / 100;
}

// ─── Toggle ciclo mensal / anual ─────────────────────────────────────────────

function selecionarCiclo(cicloMeses) {
  _cicloAtual = Number(cicloMeses);
  document.getElementById('planCiclo').value = _cicloAtual;

  [3, 6, 12].forEach(m => {
    document.getElementById(`btn-ciclo-${m}`)?.classList.toggle('ativo', m === _cicloAtual);
  });

  // Atualiza badges de desconto nos botões (lê do primeiro plano disponível)
  const primeiroPlan = document.querySelector('.plano-card:not(.em-breve)')?._planoData;
  if (primeiroPlan) {
    const pct6  = getDescontoPct(primeiroPlan, 6);
    const pct12 = getDescontoPct(primeiroPlan, 12);
    const b6  = document.getElementById('badge-eco-6');
    const b12 = document.getElementById('badge-eco-12');
    if (b6)  { b6.textContent  = pct6  > 0 ? `${pct6}% off`  : ''; b6.style.display  = pct6  > 0 ? '' : 'none'; }
    if (b12) { b12.textContent = pct12 > 0 ? `${pct12}% off` : ''; b12.style.display = pct12 > 0 ? '' : 'none'; }
  }

  // Re-renderiza preços nos cards sem recarregar do Firestore
  document.querySelectorAll('.plano-card').forEach(card => {
    const p = card._planoData;
    if (!p) return;

    const base    = Number(p.valor_mensal) || Number(p.valor) || 0;
    const pct     = getDescontoPct(p, _cicloAtual);
    const mensal  = getPrecoPlano(p, _cicloAtual);
    const total   = getTotalCiclo(p, _cicloAtual);
    const economia = Math.round(base * _cicloAtual * pct / 100 * 100) / 100;

    card.querySelector('.plano-preco-valor').textContent = fmtBRL(mensal);
    card.querySelector('.plano-preco-ciclo').textContent = '/mês';

    const totalEl = card.querySelector('.plano-preco-total');
    if (totalEl) totalEl.textContent = `Total: ${fmtBRL(total)}`;

    const econEl = card.querySelector('.plano-preco-anual-economia');
    if (econEl) {
      if (pct > 0 && economia > 0) {
        econEl.textContent = `${pct}% off · economia de ${fmtBRL(economia)}`;
        econEl.style.display = 'block';
      } else {
        econEl.style.display = 'none';
      }
    }
  });

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
    // Verificar se FeaturesManager está disponível
    if (!window.FeaturesManager || !window.FeaturesManager.carregarFeatures) {
      console.error('[assinatura] FeaturesManager não está disponível');
      wrap.innerHTML = '<div style="color:#c00;font-size:13px">Erro: FeaturesManager não carregado.</div>';
      return;
    }

    // Verificar se db está disponível
    if (!window.db) {
      console.error('[assinatura] Firebase db não está disponível');
      wrap.innerHTML = '<div style="color:#c00;font-size:13px">Erro: Firebase não inicializado.</div>';
      return;
    }

    // Carregar todas as features disponíveis
    let allFeatures = [];
    try {
      allFeatures = await window.FeaturesManager.carregarFeatures() || [];
    } catch (err) {
      console.error('[assinatura] Erro ao carregar features do Firestore:', err);
    }

    allFeatures = allFeatures.filter(f => f.ativo !== false);

    // Fallback se não conseguiu carregar do Firestore
    if (allFeatures.length === 0) {
      allFeatures = [
        { id: 'newsletter_texto', nome: 'Newsletter em texto' },
        { id: 'newsletter_audio', nome: 'Newsletter em áudio (podcast)' },
        { id: 'newsletter_video', nome: 'Newsletter em vídeo' },
        { id: 'newsletter_infografico', nome: 'Infográfico por edição' },
        { id: 'alertas_prioritarios', nome: 'Alertas prioritários' },
        { id: 'grupo_whatsapp_vip', nome: 'Grupo VIP WhatsApp' },
        { id: 'biblioteca_acesso', nome: 'Biblioteca vitalícia' },
        { id: 'sugestao_tema_quota', nome: 'Sugestão de tema' },
        { id: 'consultoria_horas_mes', nome: 'Consultoria direta' },
      ];
    }

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

      // lista de features - cada feature renderiza de forma independente
      const featuresHtml = allFeatures.map(f => {
        const val  = features[f.id];
        const ativo = !!val;
        let label  = f.nome || f.id;

        // Features com quota numérica — exibe o valor no label
        if (f.id === 'sugestao_tema_quota' && Number(val) > 0) {
          label = `${val} sugestão${Number(val) > 1 ? 'ões' : ''} de tema/mês`;
        } else if (f.id === 'consultoria_horas_mes' && Number(val) > 0) {
          label = `Consultoria ${val}h/mês`;
        }

        return `<li class="${ativo ? '' : 'inativo'}">${label}</li>`;
      }).join('');

      const card = document.createElement('label');
      card.className     = `plano-card${p.destaque ? ' destaque' : ''}${p.em_breve ? ' em-breve' : ''}`;
      card.dataset.id    = p.id;
      card.dataset.slug  = p.plano_slug || '';
      card.dataset.emBreve = p.em_breve ? 'true' : 'false';
      card.style.setProperty('--plano-cor', cor);
      card._planoData    = p; // referência para selecionarCiclo()

      card.innerHTML = `
        ${p.em_breve ? `<div class="plano-badge-em-breve">🚀 Em breve</div>` : ''}
        ${!p.em_breve && p.destaque && p.badge ? `<div class="plano-badge-destaque">${p.badge}</div>` : ''}
        <input type="radio" name="plano-selecionado" value="${p.id}" ${p.em_breve ? 'disabled' : ''}>
        <div class="plano-content${p.em_breve ? ' plano-content--bloqueado' : ''}">
          <div class="plano-nome">${p.nome || p.id}</div>
          <div class="plano-preco-wrap">
            <span class="plano-preco-valor" style="color:${cor}">${fmtBRL(val)}</span>
            <div class="plano-preco-total" style="font-size:11px;color:#666;margin-top:1px">${_cicloAtual > 3 ? `Total: ${fmtBRL(getTotalCiclo(p, _cicloAtual))}` : ''}</div>
            <span class="plano-preco-ciclo">${_cicloAtual === 'anual' ? '/ano' : '/mês'}</span>
            <div class="plano-preco-anual-economia" style="${economia > 0 && _cicloAtual === 'anual' ? '' : 'display:none'}">
              ${economia > 0 ? `Economia de ${fmtBRL(economia)}/ano` : ''}
            </div>
          </div>
          ${p.descricao ? `<div class="plano-descricao">${p.descricao}</div>` : ''}
          <ul class="plano-features">${featuresHtml}</ul>
          ${p.em_breve ? `<div class="plano-em-breve-aviso">Disponível em breve — cadastre-se em <a href="capturaLead.html" style="pointer-events: auto; position: relative; z-index: 10; text-decoration: underline; cursor: pointer;">nossa página</a> para garantir sua vaga.</div>` : ''}
        </div>
      `;

      card.addEventListener('click', () => {
        if (p.em_breve) return; // plano ainda não disponível para assinatura
        _onPlanoSelecionado(p.id);
      });
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

  // Bloqueia seleção de planos marcados como "em breve"
  if (plano.em_breve) return;

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
  const wpInput   = document.getElementById('whatsapp');
  const optinWrap = document.getElementById('whatsapp-optin-wrap');
  if (!wpInput || !optinWrap) return;

  const mostrar = () => {
    // Exibe o opt-in se o plano tiver "alertas_prioritarios" OU "grupo_whatsapp_vip"
    const planoTemFeatureAlvo = !!(_planoAtual?.features?.alertas_prioritarios || _planoAtual?.features?.grupo_whatsapp_vip);
    const numOk               = wpInput.value.replace(/\D/g, '').length >= 10;
    optinWrap.style.display   = (planoTemFeatureAlvo && numOk) ? 'flex' : 'none';
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
  const cicloMeses   = _cicloAtual;
  const baseMensal   = Number(plano.valor_mensal) || Number(plano.valor) || 0;
  const pct          = getDescontoPct(plano, cicloMeses);
  const basePrice    = getPrecoPlano(plano, cicloMeses); // mensal com desconto
  const descontoMensal = Math.round((baseMensal - basePrice) * 100) / 100;

  const tiposIncl    = Array.isArray(plano.tipos_inclusos) ? plano.tipos_inclusos.map(String) : [];
  const allowMulti   = !!plano.allow_multi_select;
  const bundles      = Array.isArray(plano.bundles) ? plano.bundles : [];

  const items = tiposSelecionados.map(id => ({
    id,
    nome:     _tiposMap[id] || id,
    included: tiposIncl.includes(String(id)),
    price:    tiposIncl.includes(String(id)) ? 0 : (Number(plano.price_per_tipo) || basePrice),
  }));

  let totalMensal = allowMulti
    ? items.reduce((s, i) => s + i.price, 0)
    : items.find(i => !i.included)?.price ?? (items.length ? basePrice : 0);

  // bundles
  bundles.forEach(b => {
    if (Array.isArray(b.types) && b.types.every(t => tiposSelecionados.includes(t))) {
      if (b.discount_percent) totalMensal -= totalMensal * (Number(b.discount_percent) / 100);
      else if (b.discount_fixed) totalMensal -= Number(b.discount_fixed);
    }
  });

  const totalMensalBruto = Math.max(0, totalMensal);
  let descontoCupom = 0;

  if (cupomObj) {
    if (cupomObj.tipo === 'percentual') descontoCupom = totalMensalBruto * ((Number(cupomObj.valor) || 0) / 100);
    else if (cupomObj.tipo === 'fixo')  descontoCupom = Number(cupomObj.valor) || 0;
  }

  const totalMensalFinal = Math.max(0, totalMensalBruto - descontoCupom);
  const totalCiclo       = Math.round(totalMensalFinal * cicloMeses * 100) / 100;

  // Campos de fidelização
  const temFidelizacao = cicloMeses >= 6 && pct > 0;
  const agora = new Date();
  const dataFimFidelizacao = new Date(agora);
  dataFimFidelizacao.setMonth(dataFimFidelizacao.getMonth() + cicloMeses);

  return {
    items,
    basePrice,
    baseMensal,
    totalBruto:              totalMensalBruto,
    desconto:                descontoCupom,
    total:                   totalCiclo,           // total do ciclo completo
    valor_mensal_contratado: totalMensalFinal,      // mensal efetivo após desconto de ciclo
    amountCentavos:          Math.round(totalCiclo * 100),
    ciclo:                   cicloMeses,            // mantém compatibilidade
    ciclo_meses:             cicloMeses,
    desconto_pct:            pct,
    desconto_mensal:         descontoMensal,
    tem_fidelizacao:         temFidelizacao,
    data_fim_fidelizacao:    dataFimFidelizacao,
    cupom:                   cupomObj,
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

    // Linha de desconto de ciclo
    if (pv.desconto_pct > 0 && pv.desconto_mensal > 0) {
      html += `<div class="preview-row desconto">
                 <span>🏷 Desconto ${pv.ciclo_meses} meses (${pv.desconto_pct}% off)</span>
                 <span>− ${fmtBRL(pv.desconto_mensal)}/mês</span>
               </div>`;
    }

    let textoTotal = '';
    if (pv.ciclo_meses > 1) {
      textoTotal = `${fmtBRL(pv.valor_mensal_contratado)}/mês × ${pv.ciclo_meses} = ${fmtBRL(pv.total)}`;
    } else if (parcelas > 1) {
      const parcVal = pv.total / parcelas;
      textoTotal = `${parcelas}× de ${fmtBRL(parcVal)}${semJuros ? ' sem juros' : ''}`;
    } else {
      textoTotal = fmtBRL(pv.total);
    }

    html += `<div class="preview-row total"><span>Total do período</span><span>${textoTotal}</span></div>`;

    // Cláusula de fidelização
    if (pv.tem_fidelizacao) {
      const dtFim = pv.data_fim_fidelizacao.toLocaleDateString('pt-BR');
      html += `<div class="preview-row" style="margin-top:8px;padding:8px 10px;background:#fffbeb;border-radius:6px;font-size:12px;color:#92400e;border:1px solid #fde68a">
                 <span>⚖️ Fidelização até ${dtFim}</span>
                 <span>Cancelamento antecipado: devolução de ${fmtBRL(pv.desconto_mensal)} × meses usados</span>
               </div>`;
    }

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
  const waRaw = whatsapp;
  const waNumber = waRaw ? String(waRaw).replace(/\D/g, '') : '';

  // Campos base (sempre salvos)
  const base = {
    nome,
    cpfNormalizado: cpfNorm,
    telefone:          telefone  || null,
    whatsapp:          whatsapp  || null,
    whatsapp_number:   waNumber,   // dígitos normalizados — usado no painel de disparo
    whatsapp_optin:    whatsapp  ? (whatsappOptin ?? true) : false,
    whatsapp_optin_em: whatsapp ? firebase.firestore.FieldValue.serverTimestamp() : null,
    tipo_perfil:       perfil    || null,
    ativo:             false, // ativo somente após confirmação de pagamento
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
  const cicloMeses = preview.ciclo_meses || 3;
  const renovacao = new Date(agora);
  renovacao.setMonth(renovacao.getMonth() + cicloMeses);

  const data = {
    // Identificação
    planId:       payload.planId  || null,
    plano_slug:   payload.plano_slug || null,
    plano_nome:   payload.plano_nome || null,
    ciclo:        String(cicloMeses), // mantém campo legado
    ciclo_meses:  cicloMeses,
    // Tipos
    tipos_selecionados: Array.isArray(payload.tipos_selecionados) ? payload.tipos_selecionados : [],
    // Valores
    valor_original:          preview.totalBruto            ?? 0,
    valor_desconto:          preview.desconto               ?? 0,
    valor_final:             preview.total                  ?? 0,
    amountCentavos:          preview.amountCentavos         ?? 0,
    valor_base_mensal:       preview.baseMensal             ?? 0,
    valor_mensal_contratado: preview.valor_mensal_contratado ?? 0,
    desconto_mensal:         preview.desconto_mensal        ?? 0,
    desconto_pct:            preview.desconto_pct           ?? 0,
    // Fidelização
    tem_fidelizacao:         preview.tem_fidelizacao        ?? false,
    data_fim_fidelizacao:    preview.tem_fidelizacao
      ? firebase.firestore.Timestamp.fromDate(preview.data_fim_fidelizacao)
      : null,
    // Cupom
    cupom:           payload.cupom || null,
    // Features snapshot — garante histórico mesmo se o plano mudar depois
    features_snapshot: payload.features || null,
    // Datas
    data_inicio:            firebase.firestore.Timestamp.fromDate(agora),
    data_proxima_renovacao: firebase.firestore.Timestamp.fromDate(renovacao),
    // Status
    status:          'pendente_pagamento',
    paymentProvider: 'mercadopago',
    orderId:         payload.orderId || null,
    pedidoId:        null,
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

// Validação condicional do WhatsApp e Opt-in
const temFeatureWhatsApp = !!(_planoAtual?.features?.alertas_prioritarios || _planoAtual?.features?.grupo_whatsapp_vip);

if (temFeatureWhatsApp) {
  if (!whatsapp || !validarTelefoneFormato(whatsapp)) {
    erro('whatsapp', 'WhatsApp é obrigatório para receber alertas ou acessar o grupo VIP.');
  }
  if (!wpOptin) {
    erro('whatsapp-optin', 'Autorização de envio pelo WhatsApp é obrigatória para este plano.');
  }
} else if (whatsapp && !validarTelefoneFormato(whatsapp)) {
  // Para planos sem a feature, o campo é opcional, mas valida o formato se preenchido
  erro('whatsapp', 'Formato de WhatsApp inválido.');
}

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
      descricao:       `${_planoAtual.nome || 'Assinatura Radar SIOPE'} — ${preview.ciclo_meses} meses`,
      installmentsMax: _planoAtual.parcelas_sem_juros || preview.ciclo_meses,
      dataPrimeiroVencimento: new Date().toISOString().split('T')[0],
      ciclo_meses:     preview.ciclo_meses,
      plano_slug:      _planoAtual.plano_slug || null,
      metodosPagamento: Array.isArray(_planoAtual.metodos_pagamento) && _planoAtual.metodos_pagamento.length
        ? _planoAtual.metodos_pagamento
        : ['credit_card'],
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
