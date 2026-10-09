const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let memberships=[],activeOrg=null,activeCase=null;

async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{accept:'application/json',...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.message||data.error||`Request failed (${response.status})`);
  return data;
}

function renderMemberships(){
  const target=$('#membership-list');
  target.innerHTML=memberships.length?memberships.map(m=>`<article><h3>${esc(m.org_ref)}</h3><p><strong>${esc(m.plan)}</strong> · ${esc(m.role)}</p><p>${(m.entitlements||[]).length?esc((m.entitlements||[]).join(', ')):'No additional entitlements'}</p><button class="secondary choose-org" data-org="${esc(m.org_ref)}">Open workspace</button></article>`).join(''):'<article><h3>No organization membership yet</h3><p>Use a one-time invitation above.</p></article>';
  target.querySelectorAll('.choose-org').forEach(button=>button.addEventListener('click',()=>selectOrg(button.dataset.org)));
}

async function loadMe(){
  try{
    const data=await api('/enterprise/api/v1/me');
    memberships=data.memberships||[];
    renderMemberships();
    if(activeOrg&&!memberships.some(x=>x.org_ref===activeOrg))activeOrg=null;
  }catch(error){$('#membership-list').innerHTML=`<p>${esc(error.message)}</p>`;}
}

async function selectOrg(orgRef){
  const membership=memberships.find(x=>x.org_ref===orgRef);if(!membership)return;
  activeOrg=orgRef;activeCase=null;
  $('#workspace').hidden=false;
  $('#case-thread').hidden=true;
  $('#workspace-meta').textContent=`${membership.org_ref} · ${membership.plan} · ${membership.role}`;
  await loadCases();
}

async function loadCases(){
  if(!activeOrg)return;
  const data=await api('/enterprise/api/v1/orgs/'+encodeURIComponent(activeOrg)+'/cases');
  const target=$('#enterprise-case-list');
  target.innerHTML=(data.cases||[]).length?(data.cases||[]).map(c=>`<button class="case-row enterprise-case" data-case="${esc(c.case_id)}"><strong>${esc(c.case_id)}</strong><span>${esc(c.priority)} · ${esc(c.state)} · ${esc(c.category)}</span></button>`).join(''):'<p>No shared cases yet.</p>';
  target.querySelectorAll('.enterprise-case').forEach(button=>button.addEventListener('click',()=>openCase(button.dataset.case)));
}

async function openCase(caseId){
  if(!activeOrg)return;
  const value=await api('/enterprise/api/v1/orgs/'+encodeURIComponent(activeOrg)+'/cases/'+encodeURIComponent(caseId));
  activeCase=caseId;
  $('#case-thread').hidden=false;
  $('#thread-title').textContent=value.case.case_id;
  $('#thread-meta').textContent=`${value.case.priority} · ${value.case.state} · ${value.case.category}`;
  $('#thread-messages').innerHTML=(value.messages||[]).length?(value.messages||[]).map(m=>`<article class="message ${m.type==='AGENT_REPLY'?'agent':'customer'}"><header><strong>${m.type==='AGENT_REPLY'?'MUSITU Support':'Organization member'}</strong></header><p>${esc(m.body)}</p></article>`).join(''):'<p>No follow-up messages yet.</p>';
  $('#case-thread').scrollIntoView({behavior:'smooth',block:'start'});
}

$('#join-form')?.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;
  const input=form.elements.invite_code;$('#join-status').textContent='Joining organization…';
  try{
    const value=await api('/enterprise/api/v1/join',{method:'POST',body:JSON.stringify({invite_code:String(input.value||'').trim().toUpperCase()})});
    input.value='';$('#join-status').textContent=`Joined ${value.org_ref} as ${value.role}.`;await loadMe();
  }catch(error){$('#join-status').textContent=error.message;}
});

$('#enterprise-case-form')?.addEventListener('submit',async event=>{
  event.preventDefault();if(!activeOrg)return;const form=event.currentTarget;if(!form.reportValidity())return;
  const data=Object.fromEntries(new FormData(form).entries());
  const body={
    surface:data.surface,category:data.category,affected_scope:data.affected_scope,
    summary:data.summary,description:data.description,reproduction:data.reproduction||'',impact:data.impact||'',
    language:data.language||navigator.language||'und',evidence_refs:[],consent_to_process:data.consent_to_process==='on'
  };
  $('#create-status').textContent='Creating shared case…';
  try{
    const value=await api('/enterprise/api/v1/orgs/'+encodeURIComponent(activeOrg)+'/cases',{method:'POST',body:JSON.stringify(body)});
    form.reset();$('#create-status').textContent=`Case ${value.case.case_id} created with ${value.organization.plan} support plan.`;
    $('#enterprise-recovery-code').textContent=value.recovery_code;$('#enterprise-receipt').hidden=false;$('#enterprise-receipt').focus();
    await loadCases();await openCase(value.case.case_id);
  }catch(error){$('#create-status').textContent=error.message;}
});

$('#enterprise-message-form')?.addEventListener('submit',async event=>{
  event.preventDefault();if(!activeOrg||!activeCase)return;const form=event.currentTarget;const body=String(form.elements.body.value||'').trim();if(!body)return;
  $('#message-status').textContent='Sending…';
  try{
    await api('/enterprise/api/v1/orgs/'+encodeURIComponent(activeOrg)+'/cases/'+encodeURIComponent(activeCase)+'/messages',{method:'POST',body:JSON.stringify({body})});
    form.elements.body.value='';$('#message-status').textContent='Reply sent.';await openCase(activeCase);
  }catch(error){$('#message-status').textContent=error.message;}
});

loadMe();
