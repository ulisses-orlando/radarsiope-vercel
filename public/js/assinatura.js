// js/assinatura.js
// Versão completa do fluxo de assinatura (lista apenas planos ativos do tipo "assinatura")
// Requisitos externos: window.db (Firestore), inserirCamposUfMunicipio, aplicarMascaraTelefone,
// validarEmail, validarTelefoneFormato, mostrarMensagem, funções utilitárias do projeto.

// -----------------------------
// Helpers básicos
// -----------------------------
function getParametro(nome) {
  const url = new URL(window.location.href);
  return url.searchParams.get(nome);
}

const origem = getParametro("origem") || "origem_nao_informada";
const planIdFromUrl = getParametro("planId") || null;

// -----------------------------
// Parse de preço do plano (robusto)
// -----------------------------
function parsePlanPrice(plan) {
  if (!plan) return 0;
  if (plan.valorCentavos !== undefined && plan.valorCentavos !== null) {
    const n = Number(plan.valorCentavos);
    if (!isNaN(n)) return n / 100;
  }
  if (plan.valor !== undefined && plan.valor !== null) {
    const n = Number(plan.valor);
    if (!isNaN(n)) return n;
    const normalized = String(plan.valor).replace(/\./g, '').replace(',', '.');
    const n2 = Number(normalized);
    if (!isNaN(n2)) return n2;
  }
  if (plan.valor_unitario !== undefined && plan.valor_unitario !== null) {
    const n = Number(plan.valor_unitario);
    if (!isNaN(n)) return n;
  }
  return 0;
}

// -----------------------------
// Carregar um plano por ID
// -----------------------------
async function carregarPlano(planId) {
  if (!planId) return null;
  try {
    const doc = await db.collection('planos').doc(planId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  } catch (err) {
    console.error('Erro ao carregar plano:', err);
    return null;
  }
}

// ----------------------------- 
// // Atualizar campo parcelas como <select> 
// // ----------------------------- 
function atualizarCampoParcelas(plan) {
  const parcelasEl = document.getElementById('parcelas');
  if (!parcelasEl) return;
  const maxParcelas = plan.qtde_parcelas || 1;
  // limpar opções anteriores 
  parcelasEl.innerHTML = '';
  // gerar opções de 1 até maxParcelas 
  for (let i = 1; i <= maxParcelas; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${i}x`;
    parcelasEl.appendChild(opt);
  }
  // valor inicial = 1 
  parcelasEl.value = "1";
}

// -----------------------------
// Render de mensagem para consultoria/capacitação
// -----------------------------
function renderarMensagemServicos(containerId = 'planos-lista') {
  const container = document.getElementById(containerId);
  if (!container) return;
  const html = `
    <div style="margin-top:12px;padding:12px;border-radius:6px;border:1px solid #f0ad4e;background:#fff8e6;color:#333;font-size:14px;line-height:1.4">
      <strong>Consultoria e Capacitação</strong>
      <div style="margin-top:6px">
        Para contratação de consultoria ou capacitação, por favor acesse
        <a href="https://www.radarsiope.com.br/entre-em-contato" target="_blank" rel="noopener noreferrer" style="color:#0a66c2">radarsiope.com.br/entre-em-contato</a>.
        Nossa equipe retornará com as opções e orçamento.
      </div>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', html);
}

// carregarListaPlanos - lista somente planos ativos do tipo "assinatura"
// gera cartões com estrutura .plano-card > input + .plano-content
async function carregarListaPlanos(containerId = 'planos-lista') {
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.style.margin = '12px 0';
    const ref = document.getElementById('campo-newsletters') || document.getElementById('form-assinatura');
    if (ref && ref.parentNode) ref.parentNode.insertBefore(container, ref);
    else document.body.appendChild(container);
  }

  container.innerHTML = '<strong>Escolha um plano</strong><div id="planos-cards" style="margin-top:8px"></div>';
  const cardsWrap = document.getElementById('planos-cards');

  try {
    // buscar apenas planos do tipo "assinatura" e com status "ativo"
    const snap = await db.collection('planos')
      .where('tipo', '==', 'assinatura')
      .where('status', '==', 'ativo')
      .get();

    const planos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // verificar se existem serviços (consultoria/capacitação) ativos para exibir banner informativo
    const otherSnap = await db.collection('planos')
      .where('status', '==', 'ativo')
      .where('tipo', 'in', ['consultoria', 'capacitação'])
      .get();
    const hasOtherServices = !otherSnap.empty;

    if (!planos.length) {
      let html = '<div style="color:#999">Nenhum plano de assinatura ativo disponível no momento.</div>';
      cardsWrap.innerHTML = html;
      if (hasOtherServices) renderarMensagemServicos('planos-cards');
      return [];
    }

    // renderizar planos de assinatura no formato do cartão
    cardsWrap.innerHTML = planos.map(p => {
      const titulo = p.nome || p.id;
      const preco = (p.valor !== undefined && p.valor !== null) ? Number(p.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
      const descricao = p.descricao ? `<div class="plano-descricao">${p.descricao}</div>` : `<div class="plano-descricao"></div>`;
      const note = (Array.isArray(p.tipos_inclusos) && p.tipos_inclusos.length) ? `<div class="plano-note">${p.tipos_inclusos.length} tipos incluídos</div>` : '';
      // cada label envolve o input e o conteúdo para manter área clicável
      return `
        <label class="plano-card" tabindex="0">
          <input type="radio" name="plano-selecionado" value="${p.id}">
          <div class="plano-content">
            <div class="plano-top">
              <div class="plano-titulo">${titulo}</div>
              <div class="plano-preco">${preco}</div>
            </div>
            ${descricao}
            ${note}
          </div>
        </label>
      `;
    }).join('');

    if (hasOtherServices) renderarMensagemServicos('planos-cards');

    // listener: quando selecionar um plano, carregar e aplicar
    // delegação no container para capturar mudança do radio
    cardsWrap.addEventListener('change', async (ev) => {
      const radio = ev.target;
      if (radio && radio.name === 'plano-selecionado') {
        const selectedId = radio.value;
        const plan = await carregarPlano(selectedId);
        if (!plan) return;
        window._currentPlan = plan;
        const planIdEl = document.getElementById('planId');
        if (planIdEl) planIdEl.value = selectedId;
        atualizarCampoParcelas(plan);
        await carregarTiposNewsletterParaAssinatura('campo-newsletters', Array.isArray(plan.tipos_inclusos) ? plan.tipos_inclusos : []);
        atualizarPreview();
      }
    });

    // acessibilidade: permitir seleção via Enter/Space ao focar o label
    cardsWrap.querySelectorAll('.plano-card').forEach(label => {
      label.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          const radio = label.querySelector('input[type="radio"]');
          if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      });
    });

    return planos;
  } catch (err) {
    console.error('Erro ao carregar lista de planos:', err);
    cardsWrap.innerHTML = '<div style="color:#c00">Erro ao carregar planos.</div>';
    return [];
  }
}


// -----------------------------
// Carregar tipos de newsletter (exibe checkboxes; respeita plano fixado)
// -----------------------------
// carregarTiposNewsletterParaAssinatura - lista apenas tipos com is_newsletter = true
async function carregarTiposNewsletterParaAssinatura(containerId = 'campo-newsletters', preselected = []) {
  const container = document.getElementById(containerId);
  try {
    // consulta filtrada: somente tipos marcados como newsletter
    const snap = await db.collection("tipo_newsletters").where('is_newsletter', '==', true).get();
    const tipos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // criar mapa global id -> nome para uso no cálculo do preview
    window._tiposMap = {};
    tipos.forEach(t => { window._tiposMap[t.id] = t.nome || t.id; });

    if (!tipos.length) {
      container.innerHTML = "<p style='color:#999'>Nenhum tipo de newsletter configurado.</p>";
      return tipos;
    }

    const planFixado = !!(window._currentPlan && Array.isArray(window._currentPlan.tipos_inclusos) && window._currentPlan.tipos_inclusos.length);

    container.innerHTML = `<label>Selecione o(s) seu(s) interesse(s)</label>
      <div id="grupo-newsletters" class="caixa-interesses duas-colunas">
        ${tipos.map(t => {
      const checked = planFixado ? (window._currentPlan.tipos_inclusos.map(String).includes(String(t.id))) : preselected.includes(t.id);
      const disabledAttr = planFixado ? 'disabled' : '';
      return `
            <label class="item-interesse">
              <input type="checkbox" value="${t.id}" id="tipo-${t.id}" ${checked ? 'checked' : ''} ${disabledAttr}>
              <span class="icone"></span>
              <span class="texto">${t.nome || t.id}</span>
            </label>
          `;
    }).join("")}
      </div>
      ${!planFixado ? '<div style="margin-top:8px"><button type="button" id="btn-selecionar-todos">Selecionar tudo</button></div>' : '<div style="margin-top:8px;color:#666;font-size:13px">Tipos definidos pelo plano</div>'}
      `;

    if (!planFixado) {
      const btn = document.getElementById('btn-selecionar-todos');
      if (btn) btn.addEventListener('click', () => {
        document.querySelectorAll('#grupo-newsletters input[type="checkbox"]').forEach(cb => cb.checked = true);
        atualizarPreview();
      });
    }

    if (!planFixado) {
      container.addEventListener('change', () => {
        if (window._currentPlan && !window._currentPlan.allow_multi_select) {
          const checks = Array.from(document.querySelectorAll('#grupo-newsletters input[type="checkbox"]'));
          const checked = checks.filter(c => c.checked);
          if (checked.length > 1) {
            const last = checked[checked.length - 1];
            checks.forEach(c => { if (c !== last) c.checked = false; });
          }
        }
        atualizarPreview();
      });
    } else {
      atualizarPreview();
    }

    return tipos;
  } catch (err) {
    console.error('Erro ao carregar tipos de newsletter:', err);
    container.innerHTML = "<p style='color:#999'>Erro ao carregar tipos.</p>";
    return [];
  }
}

// Função auxiliar para validar cupom no Firestore
async function validarCupom(codigo) {
  if (!codigo) return null;
  try {
    const snap = await db.collection('cupons')
      .where('codigo', '==', codigo)
      .limit(1)
      .get();
    if (snap.empty) {
      mostrarMensagem('Cupom não encontrado.');
      return null;
    }
    const cupom = snap.docs[0].data();

    // checar status
    if (!cupom.status || cupom.status !== 'ativo') {
      mostrarMensagem('Cupom inativo.');
      return null;
    }

    // checar validade por data
    if (cupom.expira_em && cupom.expira_em.toDate() < new Date()) {
      mostrarMensagem('Cupom expirado.');
      return null;
    }

    return cupom;
  } catch (err) {
    console.error('Erro ao validar cupom:', err);
    mostrarMensagem('Erro ao validar cupom. Veja console.');
    return null;
  }
}


// calcularPreview: monta items e aplica regras de cobrança + cupom
async function calcularPreview(plan, tiposSelecionados = [], cupomCodigo = '') {
  const tiposInclusos = Array.isArray(plan && plan.tipos_inclusos ? plan.tipos_inclusos : []) ? plan.tipos_inclusos.map(String) : [];
  const bundles = Array.isArray(plan && plan.bundles ? plan.bundles : []) ? plan.bundles : [];
  const allowMulti = !!(plan && plan.allow_multi_select);

  const basePrice = parsePlanPrice(plan);
  const pricePerTipo = (plan && plan.price_per_tipo) ? Number(plan.price_per_tipo) : basePrice;

  const tipos = Array.from(tiposSelecionados);

  const items = tipos.map(tipoId => {
    const tipoNome = (window._tiposMap && window._tiposMap[tipoId]) ? window._tiposMap[tipoId] : null;
    const included = tiposInclusos.includes(String(tipoId)) || (tipoNome && tiposInclusos.includes(String(tipoNome)));
    const price = included ? 0 : (isNaN(pricePerTipo) ? 0 : pricePerTipo);
    return { tipoId, tipoNome: tipoNome || tipoId, price, included };
  });

  let total = 0;
  if (allowMulti) {
    total = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
  } else {
    const naoIncluidos = items.filter(i => !i.included);
    if (naoIncluidos.length > 0) {
      total = Number(naoIncluidos[0].price) || 0;
    } else if (items.length > 0) {
      total = basePrice;
    } else {
      total = 0;
    }
  }

  // aplicar bundles
  bundles.forEach(bundle => {
    if (!Array.isArray(bundle.types) || bundle.types.length === 0) return;
    const match = bundle.types.every(t => tipos.includes(t));
    if (!match) return;
    if (bundle.discount_percent) {
      const pct = Number(bundle.discount_percent) || 0;
      const discount = total * (pct / 100);
      total -= discount;
    } else if (bundle.discount_fixed) {
      const fixed = Number(bundle.discount_fixed) || 0;
      total -= fixed;
    }
  });

  // capturar total antes do cupom
  const totalAntesDoCupom = total;

  let cupomData = null;

  // aplicar cupom
  if (cupomCodigo) {
    cupomData = await validarCupom(cupomCodigo);
    if (cupomData) {
      if (cupomData.tipo === 'percentual') {
        const pct = Number(cupomData.valor) || 0;
        const desconto = totalAntesDoCupom * (pct / 100);
        total -= desconto;
        mostrarMensagem(`Cupom aplicado: ${cupomCodigo} (-${pct}% = ${desconto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`);
      } else if (cupomData.tipo === 'fixo') {
        const desconto = Number(cupomData.valor) || 0;
        total -= desconto;
        mostrarMensagem(`Cupom aplicado: ${cupomCodigo} (-${desconto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`);
      }
    }
  }

  const totalNormalized = Math.max(0, total);
  const amountCentavos = Math.round(totalNormalized * 100);

  return {
    items,
    total: totalNormalized,
    amountCentavos,
    allowMulti,
    pricePerTipo,
    basePrice,
    baseTotal: totalAntesDoCupom, // valor original antes do cupom
    cupomData // dados do cupom se válido
  };
}

// -----------------------------
// Render do preview no DOM
// -----------------------------
async function atualizarPreview() {
  const previewWrap = document.getElementById('preview-breakdown');
  const itemsWrap = document.getElementById('preview-items');
  const totalWrap = document.getElementById('preview-total');

  if (!window._currentPlan) {
    if (previewWrap) previewWrap.style.display = 'none';
    return null;
  }

  const checks = document.querySelectorAll('#grupo-newsletters input[type="checkbox"]:checked');
  const tiposSelecionados = Array.from(checks).map(cb => cb.value);

  const cupom = document.getElementById('cupom') ? document.getElementById('cupom').value.trim() : '';
  const preview = await calcularPreview(window._currentPlan, tiposSelecionados, cupom);

  if (!tiposSelecionados.length) {
    if (previewWrap) previewWrap.style.display = 'none';
    if (totalWrap) totalWrap.innerHTML = '';
    return preview;
  }

  if (previewWrap) previewWrap.style.display = 'block';

  if (itemsWrap) {
    itemsWrap.innerHTML = preview.items.map(it => {
      const nomeTipo = it.tipoNome || (document.querySelector(`#tipo-${it.tipoId} + .texto`)?.textContent) || it.tipoId;
      const precoTexto = it.included ? 'Incluído' : (it.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
      return `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
                <div style="flex:1">${nomeTipo}</div>
                <div style="margin-left:12px">${precoTexto}</div>
              </div>`;
    }).join('');
  }

  if (totalWrap) {
    const total = preview.total;
    const parcelasEl = document.getElementById('parcelas');
    const numParcelas = parcelasEl ? parseInt(parcelasEl.value, 10) || 1 : 1;
    const valorParcela = total / numParcelas;

    let textoResumo = '';

    // valor original sempre mostrado
    textoResumo += `Valor original: ${preview.baseTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}<br>`;

    // se cupom aplicado
    if (preview.cupomData) {
      if (preview.cupomData.tipo === 'percentual') {
        const pct = Number(preview.cupomData.valor) || 0;
        const desconto = (preview.baseTotal * pct / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        textoResumo += `Cupom ${preview.cupomData.codigo} aplicado: (-${pct}% = ${desconto})<br>`;
      } else if (preview.cupomData.tipo === 'fixo') {
        const desconto = Number(preview.cupomData.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        textoResumo += `Cupom ${preview.cupomData.codigo} aplicado: (-${desconto})<br>`;
      }
    }

    // total final
    textoResumo += `Total final: ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em ${numParcelas} parcela${numParcelas > 1 ? 's' : ''} de ${valorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;

    totalWrap.innerHTML = `<strong>${textoResumo}</strong>`;
  }

  return preview;
}

// quando o usuário selecionar um plano
function onPlanoSelecionado(planId) {
  window._currentPlanId = planId;
  aplicarCupomBtn.disabled = false; // libera botão
  atualizarPreview();
}

// -----------------------------
// Upsert usuário por email
// -----------------------------
async function upsertUsuario({ nome, email, telefone, perfil, mensagem, preferencia, cod_uf, cod_municipio, nome_municipio }) {
  try {
    const q = await db.collection('usuarios').where('email', '==', email).limit(1).get();
    if (!q.empty) {
      const doc = q.docs[0];
      await db.collection('usuarios').doc(doc.id).update({
        nome,
        telefone: telefone || null,
        perfil: perfil || null,
        mensagem: mensagem || null,
        preferencia_contato: preferencia || null,
        cod_uf: cod_uf || null,
        cod_municipio: cod_municipio || null,
        nome_municipio: nome_municipio || null,
        origem,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return doc.id;
    } else {
      const ref = await db.collection('usuarios').add({
        nome,
        email,
        telefone: telefone || null,
        perfil: perfil || null,
        mensagem: mensagem || null,
        preferencia_contato: preferencia || null,
        cod_uf: cod_uf || null,
        cod_municipio: cod_municipio || null,
        nome_municipio: nome_municipio || null,
        origem,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return ref.id;
    }
  } catch (err) {
    console.error('Erro no upsertUsuario:', err);
    throw err;
  }
}

async function registrarAssinatura(userId, payload, preview) {
  try {
    const assinaturaData = {
      planId: payload.planId,
      tipos_selecionados: payload.tipos_selecionados,
      cupom: payload.cupom || null,
      forma_pagamento: payload.forma_pagamento,
      parcelas: payload.parcelas,
      origem: payload.origem || null,
      valor_original: preview.baseTotal,
      valor_final: preview.total,
      desconto: preview.baseTotal - preview.total,
      status: 'pendente_pagamento',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('usuarios')
      .doc(userId)
      .collection('assinaturas')
      .add(assinaturaData);

    console.log('Assinatura registrada com sucesso');
  } catch (err) {
    console.error('Erro ao registrar assinatura:', err);
    throw err;
  }
}

async function gerarParcelasAssinatura(userId, assinaturaId, valorTotal, numParcelas, metodoPagamento, dataPrimeiroVencimento) {
  try {
    const valorParcela = valorTotal / numParcelas;
    const pagamentosRef = db.collection('usuarios')
      .doc(userId)
      .collection('assinaturas')
      .doc(assinaturaId)
      .collection('pagamentos');

    for (let i = 0; i < numParcelas; i++) {
      const vencimento = new Date(dataPrimeiroVencimento);
      vencimento.setMonth(vencimento.getMonth() + i); // cada parcela no mês seguinte

      await pagamentosRef.add({
        numero_parcela: i + 1,
        valor: valorParcela,
        metodo_pagamento: metodoPagamento,
        data_vencimento: vencimento,
        data_pagamento: null,
        status: 'pendente',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    console.log(`Parcelas geradas para assinatura ${assinaturaId}`);
  } catch (err) {
    console.error('Erro ao gerar parcelas da assinatura:', err);
    throw err;
  }
}

// -----------------------------
// Chamada ao backend para criar order + assinaturas
// -----------------------------
async function createOrderBackend(payload) {
  const url = '/create-order';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Erro create-order: ${resp.status} ${txt}`);
  }
  return resp.json();
}

// -----------------------------
// Prefill a partir de leadId (simplificado; UF/Mun tratados no init)
// -----------------------------
async function prefillFromLeadIfPresent() {
  const leadId = getParametro('leadId') || getParametro('idLead') || null;
  if (!leadId) return null;

  try {
    const doc = await db.collection('leads').doc(leadId).get();
    if (!doc.exists) {
      console.warn('leadId informado não encontrado:', leadId);
      return null;
    }
    const lead = doc.data();

    if (lead.nome) document.getElementById('nome').value = lead.nome;
    if (lead.email) document.getElementById('email').value = lead.email;
    if (lead.telefone) document.getElementById('telefone').value = lead.telefone;
    if (lead.perfil) document.getElementById('perfil').value = lead.perfil;
    if (lead.preferencia_contato) document.getElementById('preferencia-contato').value = lead.preferencia_contato;

    if (Array.isArray(lead.interesses) && lead.interesses.length) {
      lead.interesses.forEach(val => {
        const cbById = document.querySelector(`#tipo-${val}`);
        if (cbById) cbById.checked = true;
        else {
          const cbByValue = Array.from(document.querySelectorAll('#grupo-newsletters input[type="checkbox"]'))
            .find(cb => cb.value === val || (cb.nextElementSibling && cb.nextElementSibling.textContent.trim() === val));
          if (cbByValue) cbByValue.checked = true;
        }
      });
    }

    if (typeof atualizarPreview === 'function') atualizarPreview();

    const status = document.getElementById('status-envio');
    if (status) {
      status.innerText = 'Formulário preenchido a partir do seu cadastro.';
      status.style.color = '#006600';
    }

    return lead;
  } catch (err) {
    console.error('Erro ao buscar lead para prefill:', err);
    return null;
  }
}

// -----------------------------
// Processamento do envio do formulário de assinatura
// -----------------------------
async function processarEnvioAssinatura(e) {
  e.preventDefault();
  const status = document.getElementById('status-envio');
  const botao = document.getElementById('btn-assinar');
  clearFormErrors();
  if (status) { status.innerText = ''; status.style.color = 'black'; }

  const nome = document.getElementById('nome').value.trim();
  const email = document.getElementById('email').value.trim();
  const telefone = document.getElementById('telefone').value.trim();
  const perfil = document.getElementById('perfil').value;
  const mensagem = document.getElementById('mensagem').value.trim();
  const preferencia = document.getElementById('preferencia-contato').value;
  const cupom = document.getElementById('cupom').value.trim();
  const forma = document.getElementById('forma-pagamento').value;
  const parcelas = document.getElementById('parcelas').value;
  const aceita = !!document.getElementById('aceita-termos').checked;

  const checks = document.querySelectorAll('#grupo-newsletters input[type="checkbox"]:checked');
  const tiposSelecionados = Array.from(checks).map(cb => cb.value);

  if (nome.length < 3) { showFormError('nome', 'Nome deve ter pelo menos 3 caracteres.'); return; }
  if (!validarEmail(email)) { showFormError('email', 'E-mail inválido.'); return; }
  if (telefone) {
    const telefoneNumerico = telefone.replace(/\D/g, "");
    if (telefoneNumerico.length < 10 || !validarTelefoneFormato(telefone)) { showFormError('telefone', 'Telefone inválido.'); return; }
  }
  if (!tiposSelecionados.length) { if (status) status.innerText = "⚠️ Selecione pelo menos um interesse."; return; }
  if (!aceita) { showFormError('aceita_termos', 'Você precisa aceitar os termos.'); return; }

  // Obter UF / Município — usar API do helper (capturaLead.js)
  let dadosUf = null;
  try {
    if (typeof validarUfMunicipio === 'function') {
      dadosUf = await validarUfMunicipio();
    } else if (validarUfMunicipio && typeof validarUfMunicipio.getValues === 'function') {
      dadosUf = validarUfMunicipio.getValues();
    } else {
      dadosUf = null;
    }
  } catch (err) {
    console.warn('Erro ao obter dados UF/Mun via validarUfMunicipio():', err);
    dadosUf = null;
  }

  const preview = calcularPreview(window._currentPlan || {}, tiposSelecionados, cupom);
  if (!preview) {
    if (status) { status.innerText = "Erro ao calcular o valor. Tente novamente."; status.style.color = 'red'; }
    return;
  }

  botao.disabled = true;
  if (status) { status.innerText = "Processando..."; status.style.color = 'black'; }

  try {
    const userId = await upsertUsuario({
      nome, email, telefone, perfil, mensagem,
      preferencia, cod_uf: dadosUf ? dadosUf.cod_uf : null, cod_municipio: dadosUf ? dadosUf.cod_municipio : null, nome_municipio: dadosUf ? dadosUf.nome_municipio : null
    });

    const payload = {
      userId,
      planId: document.getElementById('planId').value || null,
      tipos_selecionados: tiposSelecionados,
      cupom: cupom || null,
      forma_pagamento: forma,
      parcelas: parcelas ? Number(parcelas) : null,
      origem
    };

    // 🔹 grava assinatura na subcoleção
    await registrarAssinatura(userId, payload, preview);

    await gerarParcelasAssinatura(
      userId,
      assinaturaId,
      preview.total,          // valor final da assinatura
      payload.parcelas || 1,  // número de parcelas
      payload.forma_pagamento,
      new Date()              // data da primeira parcela (pode ser hoje ou ajustada)
    );
    
    // 🔹 chamar backend para criar order + pagamento
    const backendResp = await createOrderBackend(payload);

    if (backendResp.redirectUrl) {
      window.location.href = backendResp.redirectUrl;
      return;
    } else if (backendResp.clientSecret) {
      mostrarMensagem && mostrarMensagem('Pagamento iniciado. Complete o formulário de pagamento.');
      const modal = document.getElementById('modalConfirmacao');
      if (modal) {
        modal.style.display = 'flex';
        const msg = document.getElementById('modal-msg');
        if (msg) msg.textContent = 'Complete o pagamento no modal (fluxo integrado).';
      }
      return;
    } else {
      const modal = document.getElementById('modalConfirmacao');
      if (modal) {
        modal.style.display = 'flex';
        const msg = document.getElementById('modal-msg');
        if (msg) msg.textContent = backendResp.message || 'Pedido criado. Aguardando confirmação.';
      }
      return;
    }
  } catch (err) {
    console.error('Erro no processo de assinatura', err);
    if (status) { status.innerText = 'Erro ao processar assinatura. Veja console.'; status.style.color = 'red'; }
  } finally {
    botao.disabled = false;
  }
}

// -----------------------------
// Validação / UI helpers
// -----------------------------
function clearFormErrors() {
  document.querySelectorAll('#form-assinatura .field-error').forEach(s => { s.textContent = ''; s.style.display = 'none'; });
}
function showFormError(id, msg) {
  const el = document.getElementById('error-' + id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
  else console.warn('Erro form', id, msg);
}
function showGlobalMessage(msg, color = '#000') {
  const status = document.getElementById('status-envio');
  if (status) { status.innerText = msg; status.style.color = color; }
}

async function atualizarEstadoBotaoCupom() {
  const aplicarCupomBtn = document.getElementById('aplicar-cupom');
  const cupomEl = document.getElementById('cupom');
  if (!aplicarCupomBtn || !cupomEl) return;

  const codigo = cupomEl.value.trim();
  const planoSelecionado = !!window._currentPlanId;

  if (planoSelecionado && codigo) {
    const cupomData = await validarCupom(codigo);
  }
}

// -----------------------------
// Inicialização (busca lead antes de inserir campos UF/Mun para permitir prefill do município)
// -----------------------------
async function initAssinatura() {
  aplicarMascaraTelefone(document.getElementById("telefone"));

  // tentar obter leadId antecipadamente para passar UF/Mun como padrão ao helper
  const leadId = getParametro('leadId') || getParametro('idLead') || null;
  let leadDataForUf = null;

  if (leadId) {
    try {
      const leadDoc = await db.collection('leads').doc(leadId).get();
      if (leadDoc.exists) {
        leadDataForUf = leadDoc.data();
      } else {
        console.warn('leadId informado não encontrado (initAssinatura):', leadId);
      }
    } catch (err) {
      console.warn('Erro ao buscar lead preliminar para UF/Mun:', err);
    }
  }

  // inserir UF e Município passando valores padrão do lead (se houver)
  const ufPadrao = leadDataForUf && leadDataForUf.cod_uf ? leadDataForUf.cod_uf : "";
  const municipioPadrao = leadDataForUf && leadDataForUf.cod_municipio ? leadDataForUf.cod_municipio : "";
  window.validarUfMunicipio = await inserirCamposUfMunicipio(
    document.getElementById("campo-uf-municipio"),
    ufPadrao,
    municipioPadrao
  );

  // carregar plano se houver planId
  const planId = planIdFromUrl;
  document.getElementById('planId').value = planId || '';
  if (planId) {
    const plan = await carregarPlano(planId);
    if (!plan) {
      showGlobalMessage('Plano não encontrado.', 'red');
      return;
    }
    // se o planId não for do tipo assinatura, interromper e mostrar mensagem
    if (plan.tipo && plan.tipo !== 'assinatura') {
      const container = document.getElementById('planos-lista') || document.body;
      container.innerHTML = '';
      renderarMensagemServicos(container.id || 'planos-lista');
      showGlobalMessage('O plano selecionado não é do tipo assinatura.', 'red');
      return;
    }
    window._currentPlan = plan;
    atualizarCampoParcelas(plan);
    const preselected = Array.isArray(plan.tipos_inclusos) ? plan.tipos_inclusos : [];
    await carregarTiposNewsletterParaAssinatura('campo-newsletters', preselected);
    atualizarPreview();
  } else {
    // sem planId: mostrar lista de planos de assinatura
    await carregarListaPlanos('planos-lista');
    await carregarTiposNewsletterParaAssinatura('campo-newsletters', []);
  }

  // preencher o restante do formulário a partir do lead (se houver)
  await prefillFromLeadIfPresent();

  // listeners e bindings
  const cupomEl = document.getElementById('cupom');
  if (cupomEl) {
    cupomEl.addEventListener('input', atualizarEstadoBotaoCupom);
  }

  // Botão aplicar cupom → sempre habilitado
  const aplicarCupomBtn = document.getElementById('aplicar-cupom');
  if (aplicarCupomBtn) {
    aplicarCupomBtn.addEventListener('click', async () => {
      const cupomEl = document.getElementById('cupom');
      const codigo = cupomEl ? cupomEl.value.trim() : '';

      console.log('Cupom digitado:', codigo); // debug

      if (!window._currentPlan) {
        mostrarMensagem('Selecione um plano antes de aplicar o cupom.');
        return;
      }

      if (!codigo || codigo.length === 0) {
        mostrarMensagem('Digite um código de cupom.');
        return;
      }

      const cupomData = await validarCupom(codigo);
      if (!cupomData) {
        mostrarMensagem('Cupom inválido, inativo ou expirado.');
        return;
      }

      atualizarPreview();
    });
  }

  const formaEl = document.getElementById('forma-pagamento');
  if (formaEl) formaEl.addEventListener('change', atualizarPreview);
  const form = document.getElementById('form-assinatura');
  if (form) form.addEventListener('submit', processarEnvioAssinatura);
  const parcelasEl = document.getElementById('parcelas');
  if (parcelasEl) {
    parcelasEl.addEventListener('change', atualizarPreview);
  }

  // Carregar plano inicial se já houver 
  if (window._currentPlanId) {
    onPlanoSelecionado(window._currentPlanId);
  }
}

// inicializa automaticamente
initAssinatura();
