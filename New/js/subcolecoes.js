/* ========================
   Subcoleções
   ======================== */

async function abrirSubColecao(collectionName, docId, subName, userNome){
  await loadPlanos();
  const overlay = document.getElementById('modal-sub-overlay');
  const titleEl = document.getElementById('modal-sub-title');
  const hint = document.getElementById('modal-sub-hint');
  const head = document.getElementById('sub-head');
  const body = document.getElementById('sub-body');
  titleEl.innerText = `${subName} — ${userNome}`;
  hint.innerText = ''; head.innerHTML = ''; body.innerHTML = '';

  const ref = db.collection(collectionName).doc(docId).collection(subName);
  const snap = await ref.get();

  const colsSet = new Set();
  snap.forEach(s=> Object.keys(s.data()).forEach(k=> colsSet.add(k)) );
  const cols = Array.from(colsSet); cols.push('__acoes');

  const trh = document.createElement('tr');
  cols.forEach(c => { const th = document.createElement('th'); th.innerText = (c==='__acoes') ? 'Ações' : c; trh.appendChild(th); });
  head.appendChild(trh);

  snap.forEach(doc=>{
    const d = doc.data()||{};
    const tr = document.createElement('tr');
    cols.forEach(c=>{
      const td = document.createElement('td');
      if(c==='__acoes'){
        const edit = document.createElement('span'); edit.className='icon-btn'; edit.innerText='✏️';
        edit.title='Editar'; edit.onclick = ()=> abrirModalCriarSub(collectionName, docId, subName, doc.id, true);
        const del = document.createElement('span'); del.className='icon-btn'; del.innerText='🗑️';
        del.title='Excluir'; del.onclick = ()=> onExcluirSub(collectionName, docId, subName, doc.id, userNome, d);
        td.appendChild(edit); td.appendChild(del);
      } else if(c==='plano'){
        let display = ''; if(d[c]){ display = planMap[d[c]] || d[c]; }
        td.innerText = display;
      } else if(c.toLowerCase().includes('data')){
        td.innerText = d[c] ? formatDateBRFromTimestamp(d[c]) : '';
      } else { td.innerText = d[c]||''; }
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });

  document.getElementById('btn-sub-add').onclick = ()=> abrirModalCriarSub(collectionName, docId, subName, null, false);
  openModal('modal-sub-overlay');
}

async function onExcluirSub(collectionName, docId, subName, subId, userNome, dataObj){
  const label = (dataObj && (dataObj.tipo || dataObj.descricao || dataObj.nome || subId)) || subId;
  const ok = await confirmDialog(`Excluir ${subName} (${label}) do usuário ${userNome}?`);
  if(!ok) return;
  await db.collection(collectionName).doc(docId).collection(subName).doc(subId).delete();
  abrirSubColecao(collectionName, docId, subName, userNome);
}

async function abrirModalCriarSub(collectionName, docId, subName, subId=null, isEdit=false){
  await loadPlanos();
  const title = document.getElementById('modal-edit-title');
  const body = document.getElementById('modal-edit-body');
  title.innerText = (isEdit ? `Editar ${subName}` : `Criar ${subName}`);
  body.innerHTML = '';

  const ref = db.collection(collectionName).doc(docId).collection(subName);
  let data = {};
  if(isEdit && subId){ const snap = await ref.doc(subId).get(); data = snap.exists? snap.data():{}; }

  const keys = isEdit ? Object.keys(data) : (
    subName==='assinaturas' ? ['plano','status','data_inicio'] :
    subName==='logs_acesso'? ['data_acesso','ip_origem','dispositivo']:
    subName==='preferencias_newsletter'? ['assinante']:
    subName==='pagamentos'? ['assinatura_id','valor','moeda','status','metodo_pagamento','data_pagamento','comprovante_url']:
    subName==='solicitacoes'? ['tipo','descricao','data_solicitacao','status']: ['campo1']
  );

  for(const k of keys){
    if(subName==='assinaturas' && k==='status'){ body.appendChild(generateDomainSelect('status',['ativo','inativo','suspenso'], data[k]||'ativo')); }
    else if(subName==='assinaturas' && k==='plano'){ const wrap = await generatePlanSelect('plano', data[k]); body.appendChild(wrap); }
    else if(k.toLowerCase().includes('data')){ body.appendChild(generateDateInput(k,data[k])); }
    else if(k==='assinante'){ body.appendChild(generateBooleanSelect('assinante',data[k]===true?'true':'false')); }
    else if(k==='valor'){ body.appendChild(generateTextField('valor',data[k]||'')); }
    else if(k==='moeda'){ body.appendChild(generateDomainSelect('moeda',['BRL','USD','EUR'],data[k]||'BRL')); }
    else if(k==='status' && subName!=='assinaturas'){ body.appendChild(generateDomainSelect('status',['pendente','pago','falhou','estornado'],data[k]||'pendente')); }
    else { body.appendChild(generateTextField(k,data[k]||'')); }
  }

  document.getElementById('modal-edit-save').onclick = async ()=>{
    const payload = {};
    body.querySelectorAll('[data-field-name]').forEach(el=>{
      const f = el.dataset.fieldName;
      if(el.tagName==='SELECT'){
        if(f==='plano') payload[f] = el.value||'';
        else if(el.value==='true'||el.value==='false') payload[f] = (el.value==='true');
        else payload[f] = el.value;
      } else if(el.type==='date'){ payload[f] = el.value? firebase.firestore.Timestamp.fromDate(new Date(el.value+'T00:00:00')):null; }
      else payload[f] = el.value;
    });
    if(isEdit && subId) await ref.doc(subId).set(payload,{merge:true});
    else await ref.add(payload);
    closeModal('modal-edit-overlay');
    const userName = document.getElementById('modal-sub-title').innerText.split('—')[1]?.trim()||'';
    abrirSubColecao(collectionName, docId, subName, userName);
  };

  openModal('modal-edit-overlay');
}

window.abrirSubColecao = abrirSubColecao;
