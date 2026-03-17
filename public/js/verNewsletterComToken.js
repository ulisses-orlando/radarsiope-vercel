async function VerNewsletterComToken() {
  const params = getParams();
  const d_nid = normalizeParam(params.get('nid'));
  const env = normalizeParam(params.get('env'));
  const uid = normalizeParam(params.get('uid'));
  const token = params.get('token');
  const assinaturaId = normalizeParam(params.get('assinaturaId'));
  const edicaoNum = params.get('edicao_numero');
  const origem = normalizeParam(params.get('origem')); 

  // 0. Validação inicial
  if ((!d_nid && !edicaoNum) || !env || !uid || !token) {
    await _tentarModoAlerta();
    return;
  }

  try {
    let envio;

    // 1. Busca dados do envio (Firestore)
    if (assinaturaId) {
      const envioRef = db.collection('usuarios').doc(uid)
        .collection('assinaturas').doc(assinaturaId)
        .collection('envios').doc(env);
      
      const envioSnap = await envioRef.get();
      if (!envioSnap.exists) {
        await _tentarModoAlerta();
        return;
      }
      envio = envioSnap.data();

      // --- VALIDAÇÃO DE EXPIRAÇÃO ---
      if (envio.expira_em && origem !== 'painel') {
        const exp = envio.expira_em.toDate ? envio.expira_em.toDate() : new Date(envio.expira_em);
        
        if (new Date() > exp) {
          // 🛑 AQUI ESTÁ A CORREÇÃO PARA O "CARREGANDO..."
          
          // 1. Forçamos o loader a sumir imediatamente
          const loader = document.getElementById('rs-app-loader');
          if (loader) loader.style.display = 'none';
          
          // 2. Garantimos que o container do App fique visível para mostrar o card
          const appWrap = document.getElementById('rs-app-wrap');
          if (appWrap) appWrap.style.opacity = '1';
          if (appWrap) appWrap.style.display = 'block';

          // 3. Chamamos a função que renderiza a mensagem de expirado
          await _abrirModoAssinanteExpirado(uid, assinaturaId);
          
          console.log("[Radar] Fluxo interrompido: Link expirado.");
          return; // ⛔ Sai da função aqui e não faz mais nada
        }
      }

      // Validação de Token (após check de expiração)
      if (!envio.token_acesso || envio.token_acesso !== token) {
        mostrarErro('Acesso negado.'); 
        return;
      }

      envioRef.update({ ultimo_acesso: new Date() }).catch(() => {});

    } else {
      // Fluxo Lead (Supabase)
      const { data: leRow } = await window.supabase
        .from('leads_envios').select('*').eq('id', env).eq('lead_id', uid).maybeSingle();

      if (!leRow) { await _tentarModoAlerta(); return; }
      
      if (leRow.expira_em && origem !== 'painel' && new Date() > new Date(leRow.expira_em)) {
        // Remove loader antes de mostrar erro
        const loader = document.getElementById('rs-app-loader');
        if (loader) loader.style.display = 'none';
        mostrarErro('Este link expirou.');
        return;
      }
      envio = { token_acesso: leRow.token_acesso };
    }

    // 2. Carregamento da Newsletter (Só chega aqui se o acesso for válido)
    let newsletter;
    if (d_nid) {
      const snap = await db.collection('newsletters').doc(d_nid).get();
      if (!snap.exists) { mostrarErro('Edição não encontrada.'); return; }
      newsletter = { id: snap.id, ...snap.data() };
    } else {
      newsletter = await buscarPorNumero(edicaoNum);
      if (!newsletter) { mostrarErro(`Edição "${edicaoNum}" não encontrada.`); return; }
    }

    // 3. Busca dados do Destinatário
    const destinatarioSnap = await db.collection("usuarios").doc(uid).get();
    if (!destinatarioSnap.exists) { mostrarErro('Usuário não localizado.'); return; }
    const destinatario = { _uid: destinatarioSnap.id, ...destinatarioSnap.data() };

    // 4. Renderização Final
    renderHeader(newsletter, destinatario);
    
    // Função padrão que esconde o loader e mostra o app
    mostrarApp(); 
    
    if (window.iniciarDrawer) {
        iniciarDrawer(newsletter);
    }

  } catch (err) {
    console.error('[verNL] Erro:', err);
    // Em caso de erro, também precisamos remover o loader
    const loader = document.getElementById('rs-app-loader');
    if (loader) loader.style.display = 'none';
    mostrarErro('Erro ao carregar.');
  }
}