// ========================
// Newsletters CRUD
// ========================
async function listarNewsletters(){
  const tbody = document.getElementById('lista-newsletters');
  tbody.innerHTML = '';
  const snap = await db.collection('newsletters').get();
  snap.forEach(doc=>{
    const d = doc.data()||{};
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${d.titulo||''}</td>
      <td>${d.descricao||''}</td>
      <td>
        <span class="icon-btn" title="Editar" onclick="abrirModalEditarNewsletter('${doc.id}')">✏️</span>
        <span class="icon-btn" title="Excluir" onclick="onExcluirNewsletter('${doc.id}','${(d.titulo||'sem-titulo').replace(/'/g,"\\'")}')">🗑️</span>
        <span class="icon-btn" title="Envios" onclick="abrirSubColecao('newsletters','${doc.id}','envios','${(d.titulo||'sem-titulo').replace(/'/g,"\\'")}')">📤</span>
      </td>`;
    tbody.appendChild(tr);
  });
}

function abrirModalCriarNewsletter(){
  const title=document.getElementById('modal-edit-title');
  const body=document.getElementById('modal-edit-body');
  title.innerText='Criar Newsletter';
  body.innerHTML='';
  body.appendChild(generateTextField('titulo',''));
  body.appendChild(generateTextField('descricao',''));
  document.getElementById('modal-edit-save').onclick=async ()=>{
    const payload={};
    body.querySelectorAll('[data-field-name]').forEach(el=>payload[el.dataset.fieldName]=el.value);
    await db.collection('newsletters').add(payload);
    closeModal('modal-edit-overlay');
    await listarNewsletters();
  };
  openModal('modal-edit-overlay');
}

async function abrirModalEditarNewsletter(newsId){
  const doc = await db.collection('newsletters').doc(newsId).get();
  const data=doc.exists?doc.data():{};
  const title=document.getElementById('modal-edit-title');
  const body=document.getElementById('modal-edit-body');
  title.innerText='Editar Newsletter';
  body.innerHTML='';
  body.appendChild(generateTextField('titulo',data.titulo||''));
  body.appendChild(generateTextField('descricao',data.descricao||''));
  document.getElementById('modal-edit-save').onclick=async ()=>{
    const payload={};
    body.querySelectorAll('[data-field-name]').forEach(el=>payload[el.dataset.fieldName]=el.value);
    await db.collection('newsletters').doc(newsId).set(payload,{merge:true});
    closeModal('modal-edit-overlay');
    await listarNewsletters();
  };
  openModal('modal-edit-overlay');
}

async function onExcluirNewsletter(newsId,titulo){
  const ok=await confirmDialog(`Deseja excluir a newsletter "${titulo}"?`);
  if(!ok) return;
  await db.collection('newsletters').doc(newsId).delete();
  await listarNewsletters();
}

// Inicializa
listarNewsletters();
