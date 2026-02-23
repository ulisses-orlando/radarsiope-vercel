/* ==========================================================================
   planos.js — Radar SIOPE
   Gestão completa de planos de assinatura no painel admin
   Compatível com: window.db (Firestore), modal HTML existente,
   funções globais: mostrarMensagem, abrirConfirmacao, openModal,
   closeModal, validateValorEParcelas, escapeHtml (redefinida aqui)
   ========================================================================== */

'use strict';

// ─── Definição canônica dos 5 planos ────────────────────────────────────────
// Usada para pré-preencher features ao selecionar o slug e para validação.
// Valores em branco — você define no admin antes do lançamento.
const PLANOS_CANON = {
  basico: {
    nome: 'Radar Básico',
    ordem: 1,
    cor_destaque: '#6B7280',
    destaque: false,
    badge: '',
    features: {
      newsletter_texto:    true,
      newsletter_audio:    false,
      newsletter_infografico: false,
      alertas_prioritarios: false,
      grupo_whatsapp_vip:  false,
      biblioteca_acesso:   true,
      sugestao_tema_quota: 0,
      consultoria_horas_mes: 0,
    }
  },
  essence: {
    nome: 'Radar Essence',
    ordem: 2,
    cor_destaque: '#0891B2',
    destaque: false,
    badge: '',
    features: {
      newsletter_texto:    true,
      newsletter_audio:    true,
      newsletter_infografico: false,
      alertas_prioritarios: false,
      grupo_whatsapp_vip:  false,
      biblioteca_acesso:   true,
      sugestao_tema_quota: 0,
      consultoria_horas_mes: 0,
    }
  },
  profissional: {
    nome: 'Radar Profissional',
    ordem: 3,
    cor_destaque: '#0A3D62',
    destaque: true,
    badge: '⭐ Mais popular',
    features: {
      newsletter_texto:    true,
      newsletter_audio:    true,
      newsletter_infografico: true,
      alertas_prioritarios: true,
      grupo_whatsapp_vip:  false,
      biblioteca_acesso:   true,
      sugestao_tema_quota: 0,
      consultoria_horas_mes: 0,
    }
  },
  premium: {
    nome: 'Radar Premium',
    ordem: 4,
    cor_destaque: '#7C3AED',
    destaque: false,
    badge: '🏆 VIP',
    features: {
      newsletter_texto:    true,
      newsletter_audio:    true,
      newsletter_infografico: true,
      alertas_prioritarios: true,
      grupo_whatsapp_vip:  true,
      biblioteca_acesso:   true,
      sugestao_tema_quota: 2,
      consultoria_horas_mes: 0,
    }
  },
  supreme: {
    nome: 'Radar Supreme',
    ordem: 5,
    cor_destaque: '#B45309',
    destaque: false,
    badge: '💎 Elite',
    features: {
      newsletter_texto:    true,
      newsletter_audio:    true,
      newsletter_infografico: true,
      alertas_prioritarios: true,
      grupo_whatsapp_vip:  true,
      biblioteca_acesso:   true,
      sugestao_tema_quota: 2,
      consultoria_horas_mes: 4,
    }
  }
};

const FEATURES_LABELS = {
  newsletter_texto:       '📝 Newsletter em texto',
  newsletter_audio:       '🎧 Newsletter em áudio (podcast)',
  newsletter_infografico: '📊 Infográfico por edição',
  alertas_prioritarios:   '🔔 Alertas prioritários',
  grupo_whatsapp_vip:     '💬 Grupo VIP WhatsApp',
  biblioteca_acesso:      '📚 Biblioteca vitalícia',
  sugestao_tema_quota:    '💡 Sugestão de tema (por mês)',
  consultoria_horas_mes:  '🎯 Consultoria direta (h/mês)',
};

// ─── Utilitários ────────────────────────────────────────────────────────────

function safeNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]
  );
}

function fmtBRL(v) {
  const n = Number(v);
  if (isNaN(n) || v === '' || v === null || v === undefined) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtFeatureBadges(features) {
  if (!features || typeof features !== 'object') return '—';
  const ativos = [];
  if (features.newsletter_audio)       ativos.push('🎧');
  if (features.newsletter_infografico) ativos.push('📊');
  if (features.alertas_prioritarios)   ativos.push('🔔');
  if (features.grupo_whatsapp_vip)     ativos.push('💬');
  if (features.consultoria_horas_mes)  ativos.push(`🎯${features.consultoria_horas_mes}h`);
  if (features.sugestao_tema_quota)    ativos.push(`💡${features.sugestao_tema_quota}/mês`);
  return ativos.length ? ativos.join(' ') : '📝 Básico';
}

// ─── Carregar e renderizar lista de planos ───────────────────────────────────

async function carregarPlanos() {
  const tbody = document.getElementById('lista-planos');
  if (!tbody) return console.warn('[planos] tbody #lista-planos não encontrado');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#999;padding:12px">Carregando planos...</td></tr>';

  try {
    const snap = await db.collection('planos').orderBy('ordem', 'asc').get()
      .catch(() => db.collection('planos').get()); // fallback se campo ordem não existir ainda

    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#999;padding:12px">Nenhum plano cadastrado. Clique em ➕ Novo Plano.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    snap.forEach(doc => {
      const d = doc.data() || {};
      const canon = PLANOS_CANON[d.plano_slug] || {};
      const tr = document.createElement('tr');

      // badge visual de destaque
      const badgeTd = d.destaque
        ? `<span style="background:${escapeHtml(d.cor_destaque||'#0A3D62')};color:#fff;padding:2px 7px;border-radius:10px;font-size:11px">${escapeHtml(d.badge||'⭐')}</span>`
        : '';

      // status colorido
      const statusColor = d.status === 'ativo' ? '#16a34a' : '#dc2626';
      const statusDot = `<span style="color:${statusColor};font-weight:700">${d.status === 'ativo' ? '● Ativo' : '● Inativo'}</span>`;

      tr.innerHTML = `
        <td style="font-weight:600">${escapeHtml(d.nome || d.plano_slug || '—')} ${badgeTd}</td>
        <td style="text-align:center;font-size:12px;color:#555">${escapeHtml(d.plano_slug || '—')}</td>
        <td style="text-align:right">${fmtBRL(d.valor_mensal)}</td>
        <td style="text-align:right">${fmtBRL(d.valor_anual)}</td>
        <td style="font-size:12px">${fmtFeatureBadges(d.features)}</td>
        <td style="text-align:center">${escapeHtml(String(d.qtde_parcelas || 1))}</td>
        <td style="text-align:center">${statusDot}</td>
        <td style="text-align:center;white-space:nowrap">
          <span class="icon-btn" title="Editar" onclick="abrirModalPlano('${doc.id}', true)">✏️</span>
          <span class="icon-btn" title="Duplicar" onclick="duplicarPlano('${doc.id}')">📋</span>
          <span class="icon-btn" title="Excluir" onclick="confirmarExclusaoPlano('${doc.id}','${escapeHtml((d.nome||'').replace(/'/g,"\\'"))}')">🗑️</span>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('[planos] Erro ao carregar:', err);
    tbody.innerHTML = '<tr><td colspan="8" style="color:#c00;padding:12px">Erro ao carregar planos. Veja o console.</td></tr>';
  }
}

// ─── Excluir ─────────────────────────────────────────────────────────────────

function confirmarExclusaoPlano(id, nome) {
  abrirConfirmacao(`Deseja excluir o plano "${nome}"?`, async () => {
    try {
      await db.collection('planos').doc(id).delete();
      await carregarPlanos();
      mostrarMensagem('Plano excluído com sucesso.');
    } catch (err) {
      console.error('[planos] Erro ao excluir:', err);
      mostrarMensagem('Erro ao excluir plano. Veja o console.');
    }
  });
}

// ─── Duplicar ────────────────────────────────────────────────────────────────

async function duplicarPlano(id) {
  try {
    const doc = await db.collection('planos').doc(id).get();
    if (!doc.exists) { mostrarMensagem('Plano não encontrado.'); return; }
    const dados = { ...doc.data(), nome: (doc.data().nome || '') + ' (cópia)', status: 'inativo' };
    delete dados.createdAt;
    dados.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    dados.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('planos').add(dados);
    await carregarPlanos();
    mostrarMensagem('Plano duplicado como rascunho (inativo).');
  } catch (err) {
    console.error('[planos] Erro ao duplicar:', err);
    mostrarMensagem('Erro ao duplicar plano.');
  }
}

// ─── Modal: Novo / Editar ─────────────────────────────────────────────────────

async function abrirModalPlano(id = null, editar = false) {
  const body = document.getElementById('modal-edit-body');
  if (!body) return console.warn('[planos] modal-edit-body não encontrado');

  document.getElementById('modal-edit-title').innerText = editar ? 'Editar Plano' : 'Novo Plano';
  document.getElementById('modal-edit-save').style.display = 'inline-block';
  body.innerHTML = '<p style="color:#999;text-align:center;padding:20px">Carregando...</p>';
  openModal && openModal('modal-edit-overlay');

  // defaults
  let d = {
    plano_slug:        '',
    nome:              '',
    descricao:         '',
    valor_mensal:      '',
    valor_anual:       '',
    qtde_parcelas:     1,
    permitir_sem_juros: false,
    parcelas_sem_juros: '',
    status:            'ativo',
    ordem:             99,
    destaque:          false,
    badge:             '',
    cor_destaque:      '#0A3D62',
    tipos_inclusos:    [],
    allow_multi_select: false,
    vagas_grupo_vip:   50,
    features: {
      newsletter_texto:       true,
      newsletter_audio:       false,
      newsletter_infografico: false,
      alertas_prioritarios:   false,
      grupo_whatsapp_vip:     false,
      biblioteca_acesso:      true,
      sugestao_tema_quota:    0,
      consultoria_horas_mes:  0,
    }
  };

  if (editar && id) {
    try {
      const doc = await db.collection('planos').doc(id).get();
      if (doc.exists) {
        const raw = doc.data();
        d = {
          ...d,
          ...raw,
          features: { ...d.features, ...(raw.features || {}) }
        };
      }
    } catch (err) {
      console.error('[planos] Erro ao carregar para edição:', err);
      mostrarMensagem('Erro ao carregar plano. Veja o console.');
      return;
    }
  }

  // ── Buscar tipos de newsletter ──
  let tipos = [];
  try {
    const snap = await db.collection('tipo_newsletters').where('is_newsletter', '==', true).get();
    tipos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (e) { console.warn('[planos] Erro ao buscar tipos:', e); }

  // ── Montar HTML do modal ──
  body.innerHTML = '';

  // Seção: Identificação
  body.appendChild(_secLabel('📋 Identificação do Plano'));

  // Slug (select canônico)
  body.appendChild(_field('Slug do plano', `
    <select id="pl-slug" style="${_inputStyle()}">
      <option value="">— Selecione o slug —</option>
      ${Object.keys(PLANOS_CANON).map(s =>
        `<option value="${s}" ${d.plano_slug === s ? 'selected' : ''}>${PLANOS_CANON[s].nome} (${s})</option>`
      ).join('')}
    </select>
    <div style="font-size:11px;color:#888;margin-top:4px">Selecionar o slug preenche automaticamente as features recomendadas.</div>
  `));

  // Botão auto-preencher
  const btnAuto = document.createElement('button');
  btnAuto.type = 'button';
  btnAuto.textContent = '⚡ Auto-preencher pelo slug';
  btnAuto.style.cssText = 'margin:6px 0 12px;padding:6px 14px;background:#0A3D62;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px';
  btnAuto.onclick = () => _autoPreencherPeloSlug();
  body.appendChild(btnAuto);

  body.appendChild(_field('Nome exibido', `<input id="pl-nome" type="text" value="${escapeHtml(d.nome)}" style="${_inputStyle()}" placeholder="Ex: Radar Profissional">`));
  body.appendChild(_field('Descrição (aparece nos cards)', `<textarea id="pl-descricao" rows="3" style="${_inputStyle()}">${escapeHtml(d.descricao)}</textarea>`));
  body.appendChild(_field('Ordem de exibição', `<input id="pl-ordem" type="number" value="${d.ordem}" min="1" max="10" style="${_inputStyle('80px')}">`));

  // Seção: Preços
  body.appendChild(_secLabel('💰 Preços'));
  const precoWrap = document.createElement('div');
  precoWrap.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px';
  precoWrap.innerHTML = `
    <div>
      <label style="font-size:12px;color:#555;display:block;margin-bottom:4px">Valor Mensal (R$)</label>
      <input id="pl-valor-mensal" type="text" value="${d.valor_mensal !== '' && d.valor_mensal != null ? d.valor_mensal : ''}" style="${_inputStyle()}" placeholder="Ex: 197">
      <span id="err-valor-mensal" style="color:#b00020;font-size:11px;display:none"></span>
    </div>
    <div>
      <label style="font-size:12px;color:#555;display:block;margin-bottom:4px">Valor Anual (R$) <span style="color:#16a34a;font-size:11px">≈ 20% off</span></label>
      <input id="pl-valor-anual" type="text" value="${d.valor_anual !== '' && d.valor_anual != null ? d.valor_anual : ''}" style="${_inputStyle()}" placeholder="Ex: 1970">
      <span id="err-valor-anual" style="color:#b00020;font-size:11px;display:none"></span>
    </div>
  `;
  body.appendChild(precoWrap);

  // Botão calcular anual automaticamente
  const btnCalcAnual = document.createElement('button');
  btnCalcAnual.type = 'button';
  btnCalcAnual.textContent = '🔢 Calcular anual (mensal × 10 meses)';
  btnCalcAnual.style.cssText = 'margin:6px 0;padding:5px 12px;background:#e5e7eb;color:#374151;border:none;border-radius:4px;cursor:pointer;font-size:12px';
  btnCalcAnual.onclick = () => {
    const m = safeNumber(document.getElementById('pl-valor-mensal').value);
    if (m) {
      document.getElementById('pl-valor-anual').value = (m * 10).toFixed(2).replace('.', ',');
    }
  };
  body.appendChild(btnCalcAnual);

  // Parcelas
  body.appendChild(_secLabel('💳 Parcelamento'));
  const parcGrid = document.createElement('div');
  parcGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px';
  parcGrid.innerHTML = `
    <div>
      <label style="font-size:12px;color:#555;display:block;margin-bottom:4px">Qtde máx. parcelas</label>
      <input id="pl-parcelas" type="number" value="${d.qtde_parcelas || 1}" min="1" max="12" style="${_inputStyle()}">
      <span id="err-parcelas" style="color:#b00020;font-size:11px;display:none"></span>
    </div>
    <div style="padding-top:22px">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="pl-sem-juros" ${d.permitir_sem_juros ? 'checked' : ''}>
        <span style="font-size:13px">Permitir sem juros</span>
      </label>
      <input id="pl-parcelas-sem-juros" type="number" value="${d.parcelas_sem_juros || ''}"
        min="1" max="12" placeholder="Qtde sem juros"
        style="${_inputStyle()};margin-top:6px;${d.permitir_sem_juros ? '' : 'opacity:0.4'}">
    </div>
  `;
  body.appendChild(parcGrid);

  // toggle sem juros
  document.getElementById('pl-sem-juros')?.addEventListener('change', function () {
    const el = document.getElementById('pl-parcelas-sem-juros');
    if (el) el.style.opacity = this.checked ? '1' : '0.4';
  });

  // Seção: Visual
  body.appendChild(_secLabel('🎨 Visual no Formulário de Assinatura'));
  const visualWrap = document.createElement('div');
  visualWrap.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;align-items:end';
  visualWrap.innerHTML = `
    <div>
      <label style="font-size:12px;color:#555;display:block;margin-bottom:4px">Badge (texto curto)</label>
      <input id="pl-badge" type="text" value="${escapeHtml(d.badge||'')}" style="${_inputStyle()}" placeholder="Ex: ⭐ Mais popular">
    </div>
    <div>
      <label style="font-size:12px;color:#555;display:block;margin-bottom:4px">Cor do card</label>
      <input id="pl-cor" type="color" value="${d.cor_destaque||'#0A3D62'}" style="width:100%;height:36px;border:1px solid #ccc;border-radius:4px;cursor:pointer">
    </div>
    <div style="padding-bottom:4px">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="pl-destaque" ${d.destaque ? 'checked' : ''}>
        <span style="font-size:13px">Plano em destaque</span>
      </label>
    </div>
  `;
  body.appendChild(visualWrap);

  // Seção: Features
  body.appendChild(_secLabel('⚙️ Features do Plano'));
  const featWrap = document.createElement('div');
  featWrap.id = 'pl-features-wrap';
  featWrap.style.cssText = 'display:grid;gap:8px;padding:12px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0';

  Object.entries(FEATURES_LABELS).forEach(([key, label]) => {
    const val = d.features[key];
    const isNumeric = key === 'sugestao_tema_quota' || key === 'consultoria_horas_mes';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between';

    if (isNumeric) {
      row.innerHTML = `
        <span style="font-size:13px">${escapeHtml(label)}</span>
        <input type="number" id="feat-${key}" value="${Number(val)||0}" min="0" max="100"
          style="width:70px;padding:4px 6px;border:1px solid #ccc;border-radius:4px;font-size:13px">
      `;
    } else {
      row.innerHTML = `
        <label for="feat-${key}" style="font-size:13px;cursor:pointer">${escapeHtml(label)}</label>
        <input type="checkbox" id="feat-${key}" ${val ? 'checked' : ''}
          style="width:16px;height:16px;cursor:pointer">
      `;
    }
    featWrap.appendChild(row);
  });
  body.appendChild(featWrap);

  // Vagas grupo VIP (condicional)
  const vagasWrap = document.createElement('div');
  vagasWrap.id = 'pl-vagas-wrap';
  vagasWrap.style.display = d.features.grupo_whatsapp_vip ? 'block' : 'none';
  vagasWrap.style.marginTop = '8px';
  vagasWrap.innerHTML = `
    <label style="font-size:12px;color:#555;display:block;margin-bottom:4px">💬 Limite de vagas no grupo VIP</label>
    <input id="pl-vagas" type="number" value="${d.vagas_grupo_vip||50}" min="1" max="500"
      style="${_inputStyle('120px')}">
  `;
  body.appendChild(vagasWrap);

  // mostra/esconde vagas quando feature grupo mudar
  document.getElementById('feat-grupo_whatsapp_vip')?.addEventListener('change', function () {
    vagasWrap.style.display = this.checked ? 'block' : 'none';
  });

  // Seção: Tipos de newsletter inclusos
  body.appendChild(_secLabel('📰 Tipos de Newsletter Inclusos'));
  if (tipos.length) {
    const tiposWrap = document.createElement('div');
    tiposWrap.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px';
    tipos.forEach(t => {
      const checked = Array.isArray(d.tipos_inclusos) && d.tipos_inclusos.includes(t.id);
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer';
      label.innerHTML = `<input type="checkbox" class="tipo-check" value="${escapeHtml(t.id)}" ${checked ? 'checked' : ''}> ${escapeHtml(t.nome||t.id)}`;
      tiposWrap.appendChild(label);
    });
    body.appendChild(tiposWrap);

    const chkMulti = document.createElement('label');
    chkMulti.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:8px;font-size:13px;cursor:pointer';
    chkMulti.innerHTML = `<input type="checkbox" id="pl-allow-multi" ${d.allow_multi_select ? 'checked' : ''}> Permitir seleção múltipla no checkout`;
    body.appendChild(chkMulti);
  } else {
    body.appendChild(_info('Nenhum tipo de newsletter cadastrado ainda.'));
  }

  // Seção: Status
  body.appendChild(_secLabel('🔘 Status'));
  const statusWrap = document.createElement('div');
  statusWrap.style.cssText = 'display:flex;gap:20px;padding:10px;background:#f8fafc;border-radius:6px';
  statusWrap.innerHTML = `
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px">
      <input type="radio" name="pl-status" id="pl-status-ativo" value="ativo" ${d.status !== 'inativo' ? 'checked' : ''}>
      <span style="color:#16a34a;font-weight:600">● Ativo</span>
    </label>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px">
      <input type="radio" name="pl-status" id="pl-status-inativo" value="inativo" ${d.status === 'inativo' ? 'checked' : ''}>
      <span style="color:#dc2626;font-weight:600">● Inativo</span>
    </label>
  `;
  body.appendChild(statusWrap);

  // ── Handler Salvar ──
  document.getElementById('modal-edit-save').onclick = async () => _salvarPlano(id, editar);
}

// ─── Auto-preencher features pelo slug ──────────────────────────────────────

function _autoPreencherPeloSlug() {
  const slug = document.getElementById('pl-slug')?.value;
  const canon = PLANOS_CANON[slug];
  if (!canon) { mostrarMensagem('Selecione um slug válido primeiro.'); return; }

  // preenche nome se vazio
  const nomeEl = document.getElementById('pl-nome');
  if (nomeEl && !nomeEl.value) nomeEl.value = canon.nome;

  // preenche ordem
  const ordemEl = document.getElementById('pl-ordem');
  if (ordemEl) ordemEl.value = canon.ordem;

  // cor e badge
  const corEl = document.getElementById('pl-cor');
  if (corEl) corEl.value = canon.cor_destaque;
  const badgeEl = document.getElementById('pl-badge');
  if (badgeEl && !badgeEl.value) badgeEl.value = canon.badge;
  const destaqueEl = document.getElementById('pl-destaque');
  if (destaqueEl) destaqueEl.checked = canon.destaque;

  // features
  Object.entries(canon.features).forEach(([key, val]) => {
    const el = document.getElementById(`feat-${key}`);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = Boolean(val);
    else el.value = Number(val) || 0;
  });

  // vagas VIP
  const vagasWrap = document.getElementById('pl-vagas-wrap');
  if (vagasWrap) vagasWrap.style.display = canon.features.grupo_whatsapp_vip ? 'block' : 'none';

  mostrarMensagem(`✅ Features do "${canon.nome}" aplicadas! Ajuste os valores de preço.`);
}

// ─── Salvar plano ────────────────────────────────────────────────────────────

async function _salvarPlano(id, editar) {
  // coleta
  const slug       = document.getElementById('pl-slug')?.value?.trim() || '';
  const nome       = document.getElementById('pl-nome')?.value?.trim() || '';
  const descricao  = document.getElementById('pl-descricao')?.value?.trim() || '';
  const ordemRaw   = document.getElementById('pl-ordem')?.value;
  const vmRaw      = document.getElementById('pl-valor-mensal')?.value;
  const vaRaw      = document.getElementById('pl-valor-anual')?.value;
  const parcRaw    = document.getElementById('pl-parcelas')?.value;
  const semJuros   = !!document.getElementById('pl-sem-juros')?.checked;
  const psjRaw     = document.getElementById('pl-parcelas-sem-juros')?.value;
  const badge      = document.getElementById('pl-badge')?.value?.trim() || '';
  const cor        = document.getElementById('pl-cor')?.value || '#0A3D62';
  const destaque   = !!document.getElementById('pl-destaque')?.checked;
  const statusVal  = document.querySelector('input[name="pl-status"]:checked')?.value || 'ativo';
  const allowMulti = !!document.getElementById('pl-allow-multi')?.checked;
  const vagasRaw   = document.getElementById('pl-vagas')?.value;

  // features
  const features = {};
  Object.keys(FEATURES_LABELS).forEach(key => {
    const el = document.getElementById(`feat-${key}`);
    if (!el) return;
    if (el.type === 'checkbox') features[key] = el.checked;
    else features[key] = Number(el.value) || 0;
  });

  // tipos inclusos
  const tipos_inclusos = Array.from(
    document.querySelectorAll('.tipo-check:checked')
  ).map(cb => cb.value);

  // ── Validações ──
  const erros = {};
  if (!nome) erros.nome = 'Nome é obrigatório.';
  if (!slug) erros.slug = 'Selecione o slug do plano.';

  const valor_mensal = safeNumber(vmRaw);
  const valor_anual  = safeNumber(vaRaw);
  if (valor_mensal === null || valor_mensal <= 0) erros.valor_mensal = 'Informe o valor mensal.';
  if (valor_anual !== null && valor_anual <= 0)   erros.valor_anual  = 'Valor anual inválido.';

  const qtde_parcelas = safeNumber(parcRaw);
  if (!qtde_parcelas || qtde_parcelas < 1) erros.parcelas = 'Informe o número de parcelas (mín. 1).';

  let parcelas_sem_juros = null;
  if (semJuros) {
    parcelas_sem_juros = safeNumber(psjRaw);
    if (!parcelas_sem_juros || parcelas_sem_juros < 1) {
      erros.parcelas_sem_juros = 'Informe o número de parcelas sem juros.';
    }
  }

  if (Object.keys(erros).length) {
    // mostra erros inline
    ['valor-mensal','valor-anual','parcelas','parcelas-sem-juros'].forEach(k => {
      const el = document.getElementById(`err-${k}`);
      if (el) { el.textContent = erros[k] || ''; el.style.display = erros[k] ? 'block' : 'none'; }
    });
    mostrarMensagem('⚠️ Corrija os campos destacados antes de salvar.');
    return;
  }

  // ── Montar payload ──
  const data = {
    plano_slug:        slug,
    nome,
    descricao,
    valor_mensal:      valor_mensal,
    valor_anual:       valor_anual,
    valor:             valor_mensal, // mantém campo legado para compatibilidade
    qtde_parcelas:     qtde_parcelas,
    permitir_sem_juros: semJuros,
    parcelas_sem_juros,
    status:            statusVal,
    ordem:             safeNumber(ordemRaw) || 99,
    destaque,
    badge,
    cor_destaque:      cor,
    allow_multi_select: allowMulti,
    tipos_inclusos,
    vagas_grupo_vip:   features.grupo_whatsapp_vip ? (safeNumber(vagasRaw) || 50) : null,
    features,
    tipo:              'assinatura', // mantém campo legado
    updatedAt:         firebase.firestore.FieldValue.serverTimestamp(),
  };

  // desabilita botão durante salvamento
  const btnSalvar = document.getElementById('modal-edit-save');
  const txtOrig = btnSalvar.textContent;
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  try {
    if (editar && id) {
      await db.collection('planos').doc(id).update(data);
      mostrarMensagem('✅ Plano atualizado com sucesso!');
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('planos').add(data);
      mostrarMensagem('✅ Plano criado com sucesso!');
    }
    closeModal && closeModal('modal-edit-overlay');
    await carregarPlanos();
  } catch (err) {
    console.error('[planos] Erro ao salvar:', err);
    mostrarMensagem('Erro ao salvar plano. Veja o console.');
  } finally {
    btnSalvar.disabled = false;
    btnSalvar.textContent = txtOrig;
  }
}

// ─── Filtro de busca ─────────────────────────────────────────────────────────

function filtrarPlanos() {
  const filtro = (document.getElementById('busca-planos')?.value || '').toLowerCase();
  document.querySelectorAll('#lista-planos tr').forEach(tr => {
    tr.style.display = tr.innerText.toLowerCase().includes(filtro) ? '' : 'none';
  });
}

// ─── Helpers de construção do modal ─────────────────────────────────────────

function _secLabel(texto) {
  const el = document.createElement('div');
  el.style.cssText = 'font-size:12px;font-weight:700;text-transform:uppercase;color:#0A3D62;letter-spacing:.5px;margin:18px 0 8px;padding-bottom:4px;border-bottom:2px solid #e2e8f0';
  el.textContent = texto;
  return el;
}

function _field(label, innerHtml) {
  const wrap = document.createElement('div');
  wrap.style.marginTop = '10px';
  wrap.innerHTML = `<label style="font-size:12px;color:#555;display:block;margin-bottom:4px">${label}</label>${innerHtml}`;
  return wrap;
}

function _info(texto) {
  const el = document.createElement('div');
  el.style.cssText = 'font-size:13px;color:#888;padding:8px;background:#f8fafc;border-radius:4px;margin-top:6px';
  el.textContent = texto;
  return el;
}

function _inputStyle(width = '100%') {
  return `width:${width};padding:8px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box`;
}

// ─── Atualizar header da tabela no admin ─────────────────────────────────────
// Chame esta função UMA VEZ após carregar a página para atualizar o <thead>
function atualizarHeaderTabelaPlanos() {
  const thead = document.querySelector('#lista-planos')?.closest('table')?.querySelector('thead tr');
  if (!thead) return;
  thead.innerHTML = `
    <th>Nome</th>
    <th>Slug</th>
    <th style="text-align:right">Mensal</th>
    <th style="text-align:right">Anual</th>
    <th>Features</th>
    <th style="text-align:center">Parcelas</th>
    <th style="text-align:center">Status</th>
    <th style="text-align:center">Ações</th>
  `;
}

// ─── Exportação global ───────────────────────────────────────────────────────
window._planosAdmin = {
  carregarPlanos,
  abrirModalPlano,
  confirmarExclusaoPlano,
  duplicarPlano,
  filtrarPlanos,
  atualizarHeaderTabelaPlanos,
  PLANOS_CANON,
};
