async function VerNewsletterComToken() {
  const params = getParams();
  const d_nid = normalizeParam(params.get('nid'));
  const env = normalizeParam(params.get('env'));
  const uid = normalizeParam(params.get('uid'));
  const token = params.get('token');
  const assinaturaId = normalizeParam(params.get('assinaturaId'));
  const edicaoNum = params.get('edicao_numero');
  const origem = normalizeParam(params.get('origem')); 

  // 0. Validação inicial de parâmetros
  if ((!d_nid && !edicaoNum) || !env || !uid || !token) {
    await _tentarModoAlerta();
    return;
  }

  try {
    let envio;

    // 1. Buscar envio no Firestore
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

      // Validar token
      if (!envio.token_acesso || envio.token_acesso !== token) {
        mostrarErro('Acesso negado.', 'Token inválido.'); 
        return;
      }

      // --- BLOCO DE EXPIRAÇÃO CRÍTICO ---
      if (envio.expira_em && origem !== 'painel') {
        const exp = envio.expira_em.toDate ? envio.expira_em.toDate() : new Date(envio.expira_em);
        if (new Date() > exp) {
          
          // 1. Limpa qualquer tentativa de abertura de menu/drawer via CSS
          document.body.classList.remove('menu-open', 'drawer-open', 'aside-open');
          
          // 2. Esconde o loader para que o utilizador veja o card de erro
          const loader = document.getElementById('rs-app-loader');
          if (loader) loader.style.display = 'none';

          // 3. Chama a função que mostra a mensagem: "Edição expirada, acesso somente pela Minha Área"
          await _abrirModoAssinanteExpirado(uid, assinaturaId);
          
          // 4. PARAGEM TOTAL: Impede que o código continue para o carregamento da edição
          console.warn("[Radar] Acesso bloqueado: Edição expirada.");
          return; 
        }
      }

      // Se chegou aqui, o acesso é válido. Atualizamos o acesso.
      envioRef.update({
        ultimo_acesso: new Date(),
        acessos_totais: firebase.firestore.FieldValue.increment(1),
      }).catch(() => { });

    } else {
      // Fluxo de Lead (Supabase)
      const { data: leRow } = await window.supabase
        .from('leads_envios').select('*').eq('id', env).eq('lead_id', uid).maybeSingle();

      if (!leRow) { await _tentarModoAlerta(); return; }

      if (leRow.expira_em && origem !== 'painel' && new Date() > new Date(leRow.expira_em)) {
        mostrarErro('Este link expirou.');
        return;
      }
      envio = { token_acesso: leRow.token_acesso };
    }

    // 2. Buscar a Newsletter (Só executa se NÃO estiver expirado)
    let newsletter;
    if (d_nid) {
      const snap = await db.collection('newsletters').doc(d_nid).get();
      if (!snap.exists) { mostrarErro('Edição não encontrada.'); return; }
      newsletter = { id: snap.id, ...snap.data() };
    } else {
      newsletter = await buscarPorNumero(edicaoNum);
      if (!newsletter) { mostrarErro(`Edição "${edicaoNum}" não encontrada.`); return; }
    }

    // 3. Buscar dados do Destinatário
    const destinatarioSnap = await db.collection("usuarios").doc(uid).get();
    if (!destinatarioSnap.exists) { mostrarErro('Usuário não localizado.'); return; }
    
    const destinatario = { _uid: destinatarioSnap.id, ...destinatarioSnap.data() };
    let segmento = "assinantes";

    // 4. Renderização Final (Apenas para acessos autorizados)
    const acesso = detectarAcesso(destinatario, newsletter, segmento, envio);
    const dados = {
      nome: destinatario.nome || '',
      email: destinatario.email || '',
      edicao: newsletter.numero || newsletter.edicao || '',
      titulo: newsletter.titulo || '',
      nome_municipio: destinatario.nome_municipio || '',
      cod_uf: destinatario.cod_uf || ''
    };

    renderHeader(newsletter, destinatario);
    const modoPadrao = sessionStorage.getItem('rs_modo_leitura') || acesso.modoPadrao;
    trocarModo(modoPadrao);
    
    renderModoRapido(newsletter, acesso);
    await renderModoCompleto(newsletter, dados, segmento, acesso);
    renderWatermark(destinatario, newsletter);
    renderCTA(acesso, newsletter);

    // 5. Mostrar a App e Iniciar Menu
    // Se o código chegou aqui, significa que a edição é válida.
    mostrarApp();
    if (window.iniciarDrawer) iniciarDrawer(newsletter);

  } catch (err) {
    console.error('[verNL] Erro geral:', err);
    mostrarErro('Erro ao carregar a edição.');
  }
}