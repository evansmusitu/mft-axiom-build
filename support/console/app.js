const $=selector=>document.querySelector(selector);
const list=$('#case-list'),search=$('#case-search'),conversation=$('#conversation'),messageBody=$('#message-body');
const send=$('#send-message'),status=$('#composer-status'),stateSelect=$('#state-select'),applyState=$('#apply-state');
let cases=[],selected=null,mode='AGENT_REPLY',filter='all';

const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const age=iso=>{const ms=Date.now()-Date.parse(iso);const m=Math.max(0,Math.floor(ms/60000));return m<60?`${m}m`:m<1440?`${Math.floor(m/60)}h`:`${Math.floor(m/1440)}d`;};
const stateLabel=value=>({NEW:'NEW',TRIAGED:'ESCALATED',WAITING_FOR_CUSTOMER:'ACTION REQUIRED',IN_PROGRESS:'IN PROGRESS',MITIGATED:'IN PROGRESS',RESOLVED:'SOLUTION PROVIDED',CLOSED:'CLOSED',DUPLICATE:'CLOSED',REJECTED:'CLOSED'})[value]||value;

async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{accept:'application/json',...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.message||data.error||`Request failed (${response.status})`);
  return data;
}

function renderList(){
  const q=search.value.trim().toLowerCase();
  const rows=cases.filter(item=>{
    if(filter==='urgent'&&!['P0','P1'].includes(item.priority))return false;
    if(filter==='waiting'&&item.state!=='WAITING_FOR_CUSTOMER')return false;
    if(!q)return true;
    return [item.case_id,item.surface,item.category,item.state,item.priority].some(v=>String(v||'').toLowerCase().includes(q));
  });
  list.innerHTML=rows.length?rows.map(item=>`<button class="case-row" role="listitem" data-case-id="${esc(item.case_id)}" aria-current="${selected?.case?.case_id===item.case_id}">
    <span class="case-row-top"><span class="priority ${esc(item.priority)}">${esc(item.priority)}</span><span class="case-row-id">${esc(item.case_id)}</span><span class="case-row-age">${esc(age(item.updated_at||item.created_at))}</span></span>
    <span class="case-row-title">${esc(item.category.replaceAll('_',' '))}</span><span class="case-row-meta">${esc(item.surface.replaceAll('_',' '))} · ${esc(stateLabel(item.state))}</span></button>`).join(''):'<p class="muted">No cases match this view.</p>';
  $('#new-count').textContent=`${cases.filter(x=>x.state==='NEW').length} new`;
  list.querySelectorAll('[data-case-id]').forEach(button=>button.addEventListener('click',()=>openCase(button.dataset.caseId)));
}

function renderCase(value){
  selected=value;
  const c=value.case;
  $('#case-breadcrumb').textContent=`Inbox / ${c.case_id}`;
  $('#case-title').textContent=value.details?.summary||c.category?.replaceAll('_',' ')||c.case_id;
  $('#case-subtitle').textContent=`${String(c.category||'').replaceAll('_',' ')} · ${String(c.surface||'').replaceAll('_',' ')} · opened ${age(c.created_at)} ago`;
  $('#case-badges').innerHTML=`<span class="priority ${esc(c.priority)}">${esc(c.priority)}</span><span class="badge blue">${esc(stateLabel(c.state))}</span>`;
  $('#case-state').textContent=stateLabel(c.state);$('#case-priority').textContent=c.priority;$('#case-owner').textContent='Authenticated support operator';
  conversation.innerHTML=value.messages?.length?value.messages.map(m=>{
    const cls=m.visibility==='internal'?'internal':m.type==='AGENT_REPLY'?'agent':'customer';
    const author=m.visibility==='internal'?'Internal note':m.type==='AGENT_REPLY'?'MUSITU Support':'Customer';
    return `<article class="message ${cls}"><header class="message-head"><span>${author}</span><time datetime="${esc(m.created_at)}">${esc(new Date(m.created_at).toLocaleString())}</time></header><p>${esc(m.body)}</p></article>`;
  }).join(''):'<p class="muted">No follow-up messages yet.</p>';
  const audit=[...(value.messages||[])].reverse().slice(0,8);
  $('#audit-trail').innerHTML=audit.length?audit.map(m=>`<div class="audit-event"><time>${esc(new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</time><span>${esc(m.type.replaceAll('_',' ').toLowerCase())}</span></div>`).join(''):'<p class="muted">No conversation events yet.</p>';
  messageBody.disabled=false;send.disabled=false;stateSelect.disabled=false;applyState.disabled=false;renderList();
}

async function loadCases(){
  list.innerHTML='<p class="muted">Loading secure inbox…</p>';
  try{const data=await api('/api/v1/operator/cases');cases=data.cases||[];renderList();if(!selected&&cases[0])await openCase(cases[0].case_id);}
  catch(error){list.innerHTML=`<p class="muted">${esc(error.message)}</p>`;}
}
async function openCase(id){try{renderCase(await api(`/api/v1/operator/cases/${encodeURIComponent(id)}`));$('#case-workspace').focus();}catch(error){status.textContent=error.message;}}
async function postMessage(){
  if(!selected)return;const body=messageBody.value.trim();if(!body)return;
  send.disabled=true;status.textContent=mode==='INTERNAL_NOTE'?'Saving internal note…':'Sending secure reply…';
  try{await api(`/api/v1/operator/cases/${encodeURIComponent(selected.case.case_id)}/messages`,{method:'POST',body:JSON.stringify({type:mode,body})});messageBody.value='';status.textContent=mode==='INTERNAL_NOTE'?'Internal note saved.':'Reply added to the customer thread.';await openCase(selected.case.case_id);await loadCases();}
  catch(error){status.textContent=error.message;}finally{send.disabled=false;}
}
async function changeState(){
  if(!selected||!stateSelect.value)return;applyState.disabled=true;
  try{await api(`/api/v1/operator/cases/${encodeURIComponent(selected.case.case_id)}/state`,{method:'POST',body:JSON.stringify({label:stateSelect.value})});stateSelect.value='';await openCase(selected.case.case_id);await loadCases();}
  catch(error){status.textContent=error.message;}finally{applyState.disabled=false;}
}
document.querySelectorAll('.filters button').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;document.querySelectorAll('.filters button').forEach(x=>x.classList.toggle('active',x===button));renderList();}));
document.querySelectorAll('.composer-tabs button').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.type;document.querySelectorAll('.composer-tabs button').forEach(x=>x.setAttribute('aria-selected',String(x===button)));send.textContent=mode==='INTERNAL_NOTE'?'Save internal note':'Send reply';messageBody.placeholder=mode==='INTERNAL_NOTE'?'Write a private internal note…':'Write a secure response…';}));
search.addEventListener('input',renderList);send.addEventListener('click',postMessage);applyState.addEventListener('click',changeState);
loadCases();