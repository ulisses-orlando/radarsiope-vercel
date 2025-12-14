/* ========================
   UTILITÁRIOS
   ======================== */
function isTimestamp(v) { 
  return v && typeof v === 'object' && (v.seconds !== undefined); 
}
function formatDateBRFromTimestamp(ts){ 
  if(!isTimestamp(ts)) return ""; 
  const d = new Date(ts.seconds*1000); 
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; 
}
function dateInputValueFromTimestamp(ts){ 
  if(!isTimestamp(ts)) return ""; 
  const d = new Date(ts.seconds*1000); 
  return d.toISOString().slice(0,10); 
}

/* Modal helpers */
function openModal(id){ document.getElementById(id).classList.add('show'); document.getElementById(id).setAttribute('aria-hidden','false'); }
function closeModal(id){ document.getElementById(id).classList.remove('show'); document.getElementById(id).setAttribute('aria-hidden','true'); }

/* Confirm dialog (Promise<boolean>) */
function confirmDialog(message){
  return new Promise((resolve)=>{
    const ov = document.getElementById('confirm-overlay');
    document.getElementById('confirm-message').innerText = message;
    ov.classList.add('show');
    ov.setAttribute('aria-hidden','false');

    function cleanup(result){
      ov.classList.remove('show');
      ov.setAttribute('aria-hidden','true');
      document.getElementById('confirm-yes').removeEventListener('click', onYes);
      document.getElementById('confirm-no').removeEventListener('click', onNo);
      resolve(result);
    }
    function onYes(){ cleanup(true); }
    function onNo(){ cleanup(false); }

    document.getElementById('confirm-yes').addEventListener('click', onYes);
    document.getElementById('confirm-no').addEventListener('click', onNo);
  });
}

/* ========================
   Geradores de campos
   ======================== */
function generateTextField(name, value){
  const wrap = document.createElement('div'); wrap.className='field';
  const label = document.createElement('label'); label.innerText = name; wrap.appendChild(label);
  const input = document.createElement('input'); input.type='text'; input.value = value || ''; input.dataset.fieldName = name;
  wrap.appendChild(input);
  return wrap;
}

function generateBooleanSelect(name, value){
  const wrap = document.createElement('div'); wrap.className='field';
  const label = document.createElement('label'); label.innerText = name; wrap.appendChild(label);
  const select = document.createElement('select'); select.dataset.fieldName = name;
  const opts = [{v:'true',t:'Sim'},{v:'false',t:'Não'}];
  opts.forEach(o=>{ 
    const el=document.createElement('option'); el.value=o.v; el.text = o.t; 
    if(String(value)===o.v || (value===true && o.v==='true') || (value===false && o.v==='false')) el.selected=true; 
    select.appendChild(el); 
  });
  wrap.appendChild(select);
  return wrap;
}

function generateDomainSelect(name, optionsArray, value){
  const wrap = document.createElement('div'); wrap.className='field';
  const label = document.createElement('label'); label.innerText = name; wrap.appendChild(label);
  const select = document.createElement('select'); select.dataset.fieldName = name;
  optionsArray.forEach(optVal => {
    const el = document.createElement('option'); el.value = optVal; el.text = optVal;
    if(String(value) === String(optVal)) el.selected = true;
    select.appendChild(el);
  });
  wrap.appendChild(select);
  return wrap;
}

function generateDateInput(name, timestampOrStringOrDate){
  const wrap = document.createElement('div'); wrap.className='field';
  const label = document.createElement('label'); label.innerText = name; wrap.appendChild(label);
  const input = document.createElement('input'); input.type='date'; input.dataset.fieldName = name;
  if(isTimestamp(timestampOrStringOrDate)){
    input.value = dateInputValueFromTimestamp(timestampOrStringOrDate);
  } else if(timestampOrStringOrDate instanceof Date){
    input.value = timestampOrStringOrDate.toISOString().slice(0,10);
  } else if(typeof timestampOrStringOrDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(timestampOrStringOrDate)){
    input.value = timestampOrStringOrDate.slice(0,10);
  } else input.value = '';
  wrap.appendChild(input);
  return wrap;
}
