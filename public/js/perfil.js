// perfil.js
// Versão final: reaproveita inserirCamposUfMunicipio de functions.js quando disponível,
// faz fallback seguro, carrega perfil, popula interesses e salva alterações.
// Requisitos: functions.js (com inserirCamposUfMunicipio) deve ser carregado antes deste arquivo.
// Também requer window.db (Firestore) e window.firebase (opcional) já inicializados.

(async function () {
  // ---------- espera por window.db ----------
  async function waitForDb(timeoutMs = 5000, intervalMs = 100) {
    const start = Date.now();
    while (true) {
      if (window.db) return window.db;
      if (Date.now() - start > timeoutMs) return null;
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }

  const db = await waitForDb(5000, 100);
  if (!db) {
    console.warn('perfil.js: window.db não disponível. Verifique inicialização do Firebase.');
    return;
  }
  const firebaseGlobal = window.firebase || null;

  // ---------- helpers para uid ----------
  function getUidFromLocalStorage() {
    try {
      const raw = localStorage.getItem('usuarioLogado');
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj.uid || obj.usuarioId || obj.id || null;
    } catch (e) { return null; }
  }

  async function getCurrentUid() {
    try {
      if (firebaseGlobal && firebaseGlobal.auth && firebaseGlobal.auth().currentUser) {
        const u = firebaseGlobal.auth().currentUser;
        if (u && u.uid) return u.uid;
      }
    } catch (e) { /* ignore */ }
    return getUidFromLocalStorage();
  }

  // ---------- DOM ready ----------
  if (document.readyState === 'loading') {
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }

  // ---------- utilitário para disparar eventos e forçar reflow ----------
  function dispatchAndReflow(el, events = ['input', 'change']) {
    if (!el) return;
    events.forEach(ev => {
      try { el.dispatchEvent(new Event(ev, { bubbles: true })); } catch (e) { /* ignore */ }
    });
    try { void el.offsetWidth; } catch (e) { /* ignore */ }
  }

  // ---------- fallback simples para container UF/Município (apenas cria elementos mínimos) ----------
  function ensureUfMunicipioElementsFallback(container) {
    if (!container) return;
    // se já existem selects com ids esperados, não faz nada
    if (document.getElementById('uf') || document.getElementById('municipio') || document.getElementById('perfil-uf') || document.getElementById('perfil-municipio')) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div style="display:flex;gap:12px;align-items:flex-start;">
        <div style="flex:0 0 160px;">
          <label for="perfil-uf" style="font-weight:600;display:block;margin-bottom:6px">UF</label>
          <select id="perfil-uf" name="uf" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ccc">
            <option value="">Selecione...</option>
            <option value="AC">AC</option><option value="AL">AL</option><option value="AM">AM</option><option value="AP">AP</option>
            <option value="BA">BA</option><option value="CE">CE</option><option value="DF">DF</option><option value="ES">ES</option>
            <option value="GO">GO</option><option value="MA">MA</option><option value="MG">MG</option><option value="MS">MS</option>
            <option value="MT">MT</option><option value="PA">PA</option><option value="PB">PB</option><option value="PE">PE</option>
            <option value="PI">PI</option><option value="PR">PR</option><option value="RJ">RJ</option><option value="RN">RN</option>
            <option value="RR">RR</option><option value="RS">RS</option><option value="SC">SC</option><option value="SE">SE</option>
            <option value="SP">SP</option><option value="TO">TO</option>
          </select>
        </div>
        <div style="flex:1;">
          <label for="perfil-municipio" style="font-weight:600;display:block;margin-bottom:6px">Município</label>
          <select id="perfil-municipio" name="municipio" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ccc">
            <option value="">Selecione o município...</option>
          </select>
          <input type="hidden" id="perfil-cod-municipio" />
        </div>
      </div>
    `;
    container.appendChild(wrapper);
  }

  // ---------- carregar tipos de newsletter (reaproveita lógica do capturaLeads) ----------
  async function carregarTiposNewsletterParaPerfil(containerId, selecionados = []) {
    const container = document.getElementById(containerId);
    if (!container) return;
    try {
      const snap = await db.collection('tipo_newsletters').get();
      const tipos = snap.docs.map(d => d.data().nome).filter(Boolean);
      if (!tipos.length) {
        container.innerHTML = "<p style='color:#999'>Nenhum tipo de newsletter configurado.</p>";
        return;
      }
      container.innerHTML = tipos.map(tipo => {
        const safe = String(tipo).replace(/"/g, '&quot;');
        const checked = selecionados.includes(tipo) ? 'checked' : '';
        return `<label style="display:inline-flex;align-items:center;gap:8px;margin-right:12px">
                  <input type="checkbox" value="${safe}" ${checked} />
                  <span>${safe}</span>
                </label>`;
      }).join('');
    } catch (err) {
      container.innerHTML = "<p style='color:#999'>Erro ao carregar interesses.</p>";
    }
  }

  // ---------- função que garante uso de inserirCamposUfMunicipio de functions.js quando disponível ----------
  async function garantirUfMunicipioComFunctions(docData) {
    const container = document.getElementById('perfil-uf-municipio');
    if (!container) return null;

    // Se functions.js expôs inserirCamposUfMunicipio no escopo global, use-a
    if (typeof window.inserirCamposUfMunicipio === 'function') {
      try {
        const ufPadrao = docData?.cod_uf || '';
        const munPadrao = docData?.cod_municipio || '';
        const validar = await window.inserirCamposUfMunicipio(container, ufPadrao, munPadrao);
        // garantir que validar seja exposto globalmente para salvarPerfil
        if (typeof validar === 'function') window.validarUfMunicipio = validar;
        return validar;
      } catch (e) {
        console.warn('perfil.js: erro ao usar inserirCamposUfMunicipio de functions.js', e);
        // cairá no fallback abaixo
      }
    }

    // Fallback: criar elementos mínimos se necessário e mapear selects existentes
    ensureUfMunicipioElementsFallback(container);

    // se existem selects com ids 'uf'/'municipio' ou 'perfil-uf'/'perfil-municipio', aplicar valores do docData
    const ufSel = document.getElementById('uf') || document.getElementById('perfil-uf');
    const munSel = document.getElementById('municipio') || document.getElementById('perfil-municipio');

    if (ufSel && docData?.cod_uf) {
      // se o option com value igual ao cod_uf não existir, tenta selecionar por sigla (docData.cod_uf pode ser sigla)
      try { ufSel.value = docData.cod_uf; } catch (e) {}
      dispatchAndReflow(ufSel, ['change', 'input']);
    }

    // aguardar e selecionar município quando carregado (se munSel for preenchido por listener)
    setTimeout(() => {
      if (munSel && docData?.cod_municipio) {
        try { munSel.value = docData.cod_municipio; dispatchAndReflow(munSel, ['change', 'input']); } catch (e) {}
      }
    }, 300);

    // criar validarUfMunicipio simples se não existir
    if (!window.validarUfMunicipio) {
      window.validarUfMunicipio = function () {
        const uf = document.getElementById('uf') || document.getElementById('perfil-uf');
        const mun = document.getElementById('municipio') || document.getElementById('perfil-municipio');
        if (!uf || !mun) return null;
        const cod_uf = uf.value || null;
        const cod_municipio = mun.value || null;
        const nome_municipio = mun.options[mun.selectedIndex]?.textContent || null;
        if (!cod_uf || !cod_municipio) return null;
        return { cod_uf, cod_municipio, nome_municipio };
      };
    }

    return window.validarUfMunicipio;
  }

  // ---------- carregar perfil ----------
  async function carregarPerfil() {
    const uid = await getCurrentUid();
    if (!uid) {
      console.warn('carregarPerfil: usuário não identificado (getCurrentUid retornou null).');
      return;
    }
    try {
      const docSnap = await db.collection('usuarios').doc(uid).get();
      if (!docSnap.exists) return;
      const docData = docSnap.data();
      window._perfil_lastDocData = docData;

      // campos básicos
      const cpfEl = document.getElementById('perfil-cpf');
      const nomeEl = document.getElementById('perfil-nome');
      const emailEl = document.getElementById('perfil-email');
      const telEl = document.getElementById('perfil-telefone');
      const prefEl = document.getElementById('perfil-preferencia');
      const perfilEl = document.getElementById('perfil-perfil');

      if (cpfEl) cpfEl.value = docData.cpf || '';
      if (nomeEl) nomeEl.value = docData.nome || '';
      if (emailEl) emailEl.value = docData.email || '';
      if (telEl) telEl.value = docData.telefone || '';
      if (prefEl) prefEl.value = docData.preferencia_contato || '';
      if (perfilEl) perfilEl.value = docData.tipo_perfil || '';

      // Inserir campos UF/Município usando functions.js quando disponível
      await garantirUfMunicipioComFunctions(docData);

      // carregar interesses/newsletters
      const prefsSnap = await db.collection('usuarios').doc(uid).collection('preferencias_newsletter').get();
      const interessesAtuais = prefsSnap.docs.map(d => {
        const data = d.data();
        return data && data.nome ? data.nome : d.id;
      });
      await carregarTiposNewsletterParaPerfil('perfil-interesses', interessesAtuais);
    } catch (err) {
      console.error('carregarPerfil erro:', err);
    }
  }

  // ---------- salvar perfil ----------
  async function salvarPerfil() {
    const uid = await getCurrentUid();
    if (!uid) return;

    // coletar dados básicos
    const nome = (document.getElementById('perfil-nome')?.value || '').trim();
    const email = (document.getElementById('perfil-email')?.value || '').trim();
    const telefone = (document.getElementById('perfil-telefone')?.value || '').trim();
    const preferencia = document.getElementById('perfil-preferencia')?.value || null;
    const tipoPerfil = document.getElementById('perfil-perfil')?.value || null;

    // coletar UF/Município via validarUfMunicipio (retornada por inserirCamposUfMunicipio)
    let dadosUf = null;
    try {
      if (typeof window.validarUfMunicipio === 'function') {
        dadosUf = window.validarUfMunicipio();
      } else {
        // fallback: tentar ler selects diretamente
        const uf = document.getElementById('uf') || document.getElementById('perfil-uf');
        const mun = document.getElementById('municipio') || document.getElementById('perfil-municipio');
        if (uf && mun) {
          dadosUf = {
            cod_uf: uf.value || null,
            cod_municipio: mun.value || null,
            nome_municipio: mun.options[mun.selectedIndex]?.textContent || null
          };
        }
      }
    } catch (e) {
      console.warn('salvarPerfil: erro ao validar UF/Município', e);
    }

    const payload = {
      nome: nome || null,
      nome_lowercase: nome ? nome.toLowerCase() : null,
      email: email || null,
      telefone: telefone || null,
      preferencia_contato: preferencia,
      tipo_perfil: tipoPerfil,
      atualizado_em: (firebaseGlobal && firebaseGlobal.firestore && firebaseGlobal.firestore.Timestamp) ? firebaseGlobal.firestore.Timestamp.now() : new Date()
    };

    if (dadosUf && dadosUf.cod_uf) payload.cod_uf = dadosUf.cod_uf;
    if (dadosUf && dadosUf.cod_municipio) payload.cod_municipio = dadosUf.cod_municipio;
    if (dadosUf && dadosUf.nome_municipio) payload.nome_municipio = dadosUf.nome_municipio;

    try {
      await db.collection('usuarios').doc(uid).set(payload, { merge: true });
      const status = document.getElementById('perfil-status');
      if (status) { status.textContent = 'Perfil salvo com sucesso.'; status.style.color = 'green'; setTimeout(()=>status.textContent='',3000); }
    } catch (e) {
      console.error('Erro ao salvar perfil:', e);
      const status = document.getElementById('perfil-status');
      if (status) { status.textContent = 'Erro ao salvar perfil.'; status.style.color = 'red'; }
    }
  }

  // ---------- listeners e inicialização ----------
  const salvarBtn = document.getElementById('perfil-salvar');
  if (salvarBtn) salvarBtn.addEventListener('click', salvarPerfil);

  // garantir container e fallback visual (se functions.js não estiver presente)
  const container = document.getElementById('perfil-uf-municipio');
  if (container && typeof window.inserirCamposUfMunicipio !== 'function') {
    // cria selects mínimos para evitar que a UI fique vazia
    ensureUfMunicipioElementsFallback(container);
    // instalar listener simples para tentar carregar municípios via subcoleção/fallback quando UF mudar
    const ufEl = document.getElementById('perfil-uf') || document.getElementById('uf');
    if (ufEl && !ufEl.__perfilUfFallbackListener) {
      ufEl.addEventListener('change', async function () {
        const codUf = this.value;
        const munEl = document.getElementById('perfil-municipio') || document.getElementById('municipio');
        if (munEl && munEl.tagName === 'SELECT') munEl.innerHTML = '<option value="">Selecione o município...</option>';
        if (!codUf) return;
        // tenta subcoleção UF/{sigla}/Municipio e fallback para coleção 'municipio'
        try {
          const ufDocRef = db.collection('UF').doc(String(codUf));
          const subSnap = await ufDocRef.collection('Municipio').orderBy('nome').get();
          if (!subSnap.empty) {
            subSnap.docs.forEach(d => {
              const m = d.data();
              const opt = document.createElement('option');
              opt.value = m.cod_municipio || m.id || m.nome;
              opt.text = m.nome || opt.value;
              munEl.appendChild(opt);
            });
            return;
          }
        } catch (e) {
          console.warn('perfil.js fallback: erro ao ler UF/{sigla}/Municipio', e);
        }
        try {
          const snapFlat = await db.collection('municipio').where('uf','==',String(codUf)).orderBy('nome').get();
          if (!snapFlat.empty) {
            snapFlat.docs.forEach(d => {
              const m = d.data();
              const opt = document.createElement('option');
              opt.value = m.cod_municipio || m.id || m.nome;
              opt.text = m.nome || opt.value;
              munEl.appendChild(opt);
            });
          }
        } catch (e) {
          console.warn('perfil.js fallback: erro ao ler coleção "municipio"', e);
        }
      });
      ufEl.__perfilUfFallbackListener = true;
    }
  }

  // iniciar carregamento do perfil
  await carregarPerfil();

  // expor funções úteis para debug/integracao
  window.RadarSiopePerfil = {
    carregarPerfil,
    garantirUfMunicipioComFunctions,
    validarUfMunicipio: window.validarUfMunicipio || null
  };

})();
