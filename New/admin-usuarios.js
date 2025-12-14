// ========================
// Usuários CRUD
// ========================
async function listarUsuarios(){
  const tbody = document.getElementById('lista-usuarios');
  tbody.innerHTML = '';
  const snap = await db.collection('usuarios').get();
  snap.forEach(doc => {
    const d = doc.data() || {};
    const tr = document.createElement('tr');
    const ativoTxt = (d.ativo === true || String(d.ativo).toLowerCase()==='true') ? 'Sim' : 'Não';
    tr.innerHTML = `
      <td>${d.nome||''}</td>
      <td>${d.email||''}</td>
      <td>${d.tipo_perfil||''}</td>
      <td>${ativoTxt}</td>
      <td>
        <span class="icon-btn" title="Editar" onclick="abrirModalEditarUsuario('${doc.id}')">✏️</span>
        <span class="icon-btn" title="Excluir" onclick="onExcluirUsuario('${doc.id}','${(d.nome||'sem-nome').replace(/'/g,"\\'")}')">🗑️</span>
        <span class="icon-btn" title="Assinaturas" onclick="abrirSubColecao('usuarios','${doc.id}','assinaturas','${(d.nome||'sem-nome').replace(/'/g,"\\'")}')">📝</span>
        <span class="icon-btn" title="Pagamentos" onclick="abrirSubColecao('usuarios','${doc.id}','pagamentos','${(d.nome||'sem-nome').replace(/'/g,"\\'")}')">💳</span>
        <span class="icon-btn" title="Solicitações" onclick="abrirSubColecao('usuarios','${doc.id}','solicitacoes','${(d.nome||'sem-nome').replace(/'/g,"\\'")}')">📬</span>
      </td>`;
    tbody.appendChild(tr);
  });
}

function abrirModalCriarUsuario(){
  const title = document.getElementById('modal-edit-title');
  const body = document.getElementById('modal-edit-body');
  title.innerText = 'Criar Usuário';
  body.innerHTML = '';
  body.appendChild(generateTextField('nome',''));
  body.appendChild(generateTextField('email',''));
  body.appendChild(generateDomainSelect('tipo_perfil',['secretario','pesquisador','tecnico','cidadao','CACS','contador'],''));
  body.appendChild(generateBooleanSelect('ativo','true'));
  document.getElementById('modal-edit-save').onclick = async ()=>{
    const payload = {};
    body.querySelectorAll('[data-field-name]').forEach(el=>{
      let v = el.value;
      if(el.tagName==='SELECT' && el.dataset.fieldName==='ativo') v = (v==='true'||v==='Sim');
      payload[el.dataset.fieldName] = v;
    });
    await db.collection('usuarios').add(payload);
    closeModal('modal-edit-overlay');
    await listarUsuarios();
  };
  openModal('modal-edit-overlay');
}

async function abrirModalEditarUsuario(userId){
  const doc = await db.collection('usuarios').doc(userId).get();
  const data = doc.exists ? doc.data() : {};
  const title = document.getElementById('modal-edit-title');
  const body = document.getElementById('modal-edit-body');
  title.innerText = 'Editar Usuário';
  body.innerHTML = '';
  body.appendChild(generateTextField('nome', data.nome||''));
  body.appendChild(generateTextField('email', data.email||''));
  body.appendChild(generateDomainSelect('tipo_perfil',['secretario','pesquisador','tecnico','cidadao','CACS','contador'], data.tipo_perfil||''));
  body.appendChild(generateBooleanSelect('ativo', (data.ativo===true?'true':(data.ativo===false?'false':String(data.ativo)))));
  document.getElementById('modal-edit-save').onclick = async ()=>{
    const payload = {};
    body.querySelectorAll('[data-field-name]').forEach(el=>{
      let v = el.value;
      if(el.tagName==='SELECT' && el.dataset.fieldName==='ativo') v = (v==='true'||v==='Sim');
      payload[el.dataset.fieldName] = v;
    });
    await db.collection('usuarios').doc(userId).set(payload,{merge:true});
    closeModal('modal-edit-overlay');
    await listarUsuarios();
  };
  openModal('modal-edit-overlay');
}

async function onExcluirUsuario(userId,nome){
  const ok = await confirmDialog(`Deseja excluir o usuário "${nome}"?`);
  if(!ok) return;
  await db.collection('usuarios').doc(userId).delete();
  await listarUsuarios();
}

function filtrarUsuarios(){
  const filtro = document.getElementById('busca-usuarios').value.trim().toLowerCase();
  document.querySelectorAll('#lista-usuarios tr').forEach(tr=>{
    tr.style.display = tr.innerText.toLowerCase().includes(filtro) ? '' : 'none';
  });
}

// Inicializa
listarUsuarios();
