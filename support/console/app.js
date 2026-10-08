const OPERATOR_STATE_ACTIONS=Object.freeze(['IN_PROGRESS_MUSITU_SUPPORT','ACTION_REQUIRED','SOLUTION_PROVIDED','ESCALATED','CLOSED']);
const $=selector=>document.querySelector(selector);
const list=$('#case-list'),search=$('#case-search'),conversation=$('#conversation'),messageBody=$('#message-body');
const send=$('#send-message'),status=$('#composer-status'),stateSelect=$('#state-select'),applyState=$('#apply-state'),assignButton=$('#assign-to-me'),approvalAction=$('#approval-action'),approvalEvidence=$('#approval-evidence'),requestApproval=$('#request-approval'),approvalStatus=$('#approval-status'),recoveryGovernance=$('#recovery-governance');
const opsAnalytics=$('#ops-analytics'),slaBreaches=$('#sla-breaches'),incidentList=$('#incident-list'),macroList=$('#macro-list');
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

async function decideSensitiveApproval(approvalId,decision){
  if(!selected)return;
  recoveryGovernance.querySelectorAll('button').forEach(button=>button.disabled=true);
  try{
    await api(`/api/v1/operator/cases/${encodeURIComponent(selected.case.case_id)}/approvals/${encodeURIComponent(approvalId)}/approve`,{
      method:'POST',body:JSON.stringify({decision}),
    });
    status.textContent=decision==='APPROVED'?'Recovery approval recorded.':'Recovery request rejected.';
    await openCase(selected.case.case_id);
  }catch(error){status.textContent=error.message;}
}
async function requestRecoveryApproval(request){
  if(!selected)return;
  recoveryGovernance.querySelectorAll('button').forEach(button=>button.disabled=true);
  try{
    const value=await api(`/api/v1/operator/cases/${encodeURIComponent(selected.case.case_id)}/approvals`,{
      method:'POST',body:JSON.stringify({action:'ACCOUNT_RECOVERY',evidence_hashes:[request.evidence_hash]}),
    });
    status.textContent=`Approval ${value.approval_id} is pending a different authorized operator.`;
    await openCase(selected.case.case_id);
  }catch(error){status.textContent=error.message;}
}
function renderRecoveryGovernance(value){
  const requests=value.recovery_requests||[];
  const approvals=(value.approvals||[]).filter(item=>item.action==='ACCOUNT_RECOVERY');
  const request=requests[requests.length-1]||null;
  const approval=approvals[approvals.length-1]||null;
  if(!request){
    recoveryGovernance.innerHTML='<p class="muted">No verified recovery request for this case.</p>';
    return;
  }
  if(!approval){
    recoveryGovernance.innerHTML=`<p><strong>Verified identity recovery requested</strong></p><p class="muted">Request ${esc(request.request_id)} · independent approval required.</p><button id="request-recovery-approval" class="secondary">Request ACCOUNT_RECOVERY approval</button>`;
    recoveryGovernance.querySelector('#request-recovery-approval')?.addEventListener('click',()=>requestRecoveryApproval(request));
    return;
  }
  if(!approval.decision){
    recoveryGovernance.innerHTML=`<p><strong>Approval pending</strong></p><p class="muted">${esc(approval.approval_id)} must be decided by a different authorized operator.</p><div class="case-access-actions"><button id="approve-recovery" class="secondary">Approve</button><button id="reject-recovery" class="secondary">Reject</button></div>`;
    recoveryGovernance.querySelector('#approve-recovery')?.addEventListener('click',()=>decideSensitiveApproval(approval.approval_id,'APPROVED'));
    recoveryGovernance.querySelector('#reject-recovery')?.addEventListener('click',()=>decideSensitiveApproval(approval.approval_id,'REJECTED'));
    return;
  }
  recoveryGovernance.innerHTML=`<p><strong>Recovery ${esc(approval.decision.toLowerCase())}</strong></p><p class="muted">${approval.decision==='APPROVED'?'Customer may retry verified recovery; the approval can be consumed only once.':'Customer recovery remains blocked.'}</p>`;
}

async function loadGlobalOps(){
  try{
    const [analytics,sla,incidents,macros]=await Promise.all([
      api('/api/v1/operator/analytics'),api('/api/v1/operator/sla/breaches'),api('/api/v1/operator/incidents'),api('/api/v1/operator/macros')
    ]);
    opsAnalytics.innerHTML=`<dl><div><dt>Open cases</dt><dd>${esc(analytics.open_cases??0)}</dd></div><div><dt>SLA breached</dt><dd>${esc(analytics.sla_breached??0)}</dd></div><div><dt>Open escalations</dt><dd>${esc(analytics.open_escalations??0)}</dd></div><div><dt>Active incidents</dt><dd>${esc(analytics.active_incidents??0)}</dd></div><div><dt>CSAT</dt><dd>${analytics.csat_average==null?'—':esc(analytics.csat_average)}</dd></div></dl>`;
    slaBreaches.innerHTML=(sla.breaches||[]).length?(sla.breaches||[]).slice(0,8).map(x=>`<p><strong>${esc(x.case_id)}</strong><span>${esc(x.breach)} · ${esc(x.priority)}</span></p>`).join(''):'<p class="muted">No current SLA breaches.</p>';
    incidentList.innerHTML=(incidents.incidents||[]).length?(incidents.incidents||[]).map(x=>`<p><strong>${esc(x.severity)} · ${esc(x.title)}</strong><span>${esc(x.state)} · ${esc(x.linked_cases??0)} linked cases</span></p>`).join(''):'<p class="muted">No active incident records.</p>';
    macroList.innerHTML=(macros.macros||[]).length?(macros.macros||[]).map(x=>`<button class="secondary macro-use" data-body="${esc(x.body||'')}">${esc(x.name)}</button>`).join(''):'<p class="muted">No saved macros.</p>';
    macroList.querySelectorAll('.macro-use').forEach(b=>b.addEventListener('click',()=>{messageBody.value=b.dataset.body||'';messageBody.focus();}));
  }catch(error){opsAnalytics.innerHTML=`<p class="muted">${esc(error.message)}</p>`;}
}
async function leaseCase(){if(!selected)return;try{const v=await api(`/api/v1/operator/cases/${encodeURIComponent(selected.case.case_id)}/lease`,{method:'POST',body:JSON.stringify({minutes:10})});status.textContent=`Work lease held until ${new Date(v.expires_at).toLocaleTimeString()}.`;}catch(e){status.textContent=e.message;}}
async function escalateCase(){if(!selected)return;try{await api(`/api/v1/operator/cases/${encodeURIComponent(selected.case.case_id)}/escalations`,{method:'POST',body:JSON.stringify({lane:$('#escalation-lane').value,reason_code:$('#escalation-reason').value.trim()||'OPERATOR_ESCALATION'})});status.textContent='Escalation recorded.';await loadGlobalOps();}catch(e){status.textContent=e.message;}}
async function handoffCase(){if(!selected)return;const note=$('#handoff-note').value.trim();if(!note)return;try{await api(`/api/v1/operator/cases/${encodeURIComponent(selected.case.case_id)}/handoff`,{method:'POST',body:JSON.stringify({to_lane:$('#escalation-lane').value,note})});$('#handoff-note').value='';status.textContent='Handoff recorded.';}catch(e){status.textContent=e.message;}}
async function saveQa(){if(!selected)return;try{await api(`/api/v1/operator/cases/${encodeURIComponent(selected.case.case_id)}/qa`,{method:'POST',body:JSON.stringify({quality:Number($('#qa-quality').value),policy:Number($('#qa-policy').value),accuracy:Number($('#qa-accuracy').value),notes:$('#qa-notes').value.trim()})});$('#qa-notes').value='';status.textContent='QA review saved.';}catch(e){status.textContent=e.message;}}
async function createIncident(){try{await api('/api/v1/operator/incidents',{method:'POST',body:JSON.stringify({title:$('#incident-title').value.trim(),severity:$('#incident-severity').value,public_summary:$('#incident-summary').value.trim()})});$('#incident-title').value='';$('#incident-summary').value='';await loadGlobalOps();}catch(e){status.textContent=e.message;}}
async function createMacro(){try{await api('/api/v1/operator/macros',{method:'POST',body:JSON.stringify({name:$('#macro-name').value.trim(),body:$('#macro-body').value.trim()})});$('#macro-name').value='';$('#macro-body').value='';await loadGlobalOps();}catch(e){status.textContent=e.message;}}

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
  renderRecoveryGovernance(value);
  const audit=[...(value.messages||[])].reverse().slice(0,8);
  $('#audit-trail').innerHTML=audit.length?audit.map(m=>`<div class="audit-event"><time>${esc(new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</time><span>${esc(m.type.replaceAll('_',' ').toLowerCase())}</span></div>`).join(''):'<p class="muted">No conversation events yet.</p>';
  messageBody.disabled=false;send.disabled=false;stateSelect.disabled=false;applyState.disabled=false;assignButton.disabled=false;approvalAction.disabled=false;approvalEvidence.disabled=false;requestApproval.disabled=false;['#lease-case','#escalation-lane','#escalation-reason','#escalate-case','#handoff-note','#handoff-case','#qa-quality','#qa-policy','#qa-accuracy','#qa-notes','#save-qa'].forEach(s=>{const el=$(s);if(el)el.disabled=false;});renderList();
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
async function assignToMe(){
  if(!selected)return;assignButton.disabled=true;
  try{const value=await api(`/api/v1/operator/cases/${encodeURIComponent(selected.case.case_id)}/assignment`,{method:'POST'});$('#case-owner').textContent=value.assigned_operator_ref||'Assigned';await loadCases();}
  catch(error){status.textContent=error.message;}finally{assignButton.disabled=false;}
}
async function requestSensitiveApproval(){
  if(!selected||!approvalAction.value)return;
  const hash=approvalEvidence.value.trim();
  if(!/^[a-f0-9]{64}$/i.test(hash)){approvalStatus.textContent='Enter one 64-character evidence SHA-256.';return;}
  requestApproval.disabled=true;approvalStatus.textContent='Recording immutable approval request…';
  try{
    const value=await api(`/api/v1/operator/cases/${encodeURIComponent(selected.case.case_id)}/approvals`,{method:'POST',body:JSON.stringify({action:approvalAction.value,evidence_hashes:[hash]})});
    approvalStatus.textContent=`Approval ${value.approval_id} is pending an independent operator.`;approvalAction.value='';approvalEvidence.value='';
  }catch(error){approvalStatus.textContent=error.message;}finally{requestApproval.disabled=false;}
}
async function changeState(){
  if(!selected||!stateSelect.value)return;if(!OPERATOR_STATE_ACTIONS.includes(stateSelect.value)){status.textContent='Unsupported state action.';return;}applyState.disabled=true;
  try{await api(`/api/v1/operator/cases/${encodeURIComponent(selected.case.case_id)}/state`,{method:'POST',body:JSON.stringify({label:stateSelect.value})});stateSelect.value='';await openCase(selected.case.case_id);await loadCases();}
  catch(error){status.textContent=error.message;}finally{applyState.disabled=false;}
}
document.querySelectorAll('.filters button').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;document.querySelectorAll('.filters button').forEach(x=>x.classList.toggle('active',x===button));renderList();}));
document.querySelectorAll('.composer-tabs button').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.type;document.querySelectorAll('.composer-tabs button').forEach(x=>x.setAttribute('aria-selected',String(x===button)));send.textContent=mode==='INTERNAL_NOTE'?'Save internal note':'Send reply';messageBody.placeholder=mode==='INTERNAL_NOTE'?'Write a private internal note…':'Write a secure response…';}));
search.addEventListener('input',renderList);send.addEventListener('click',postMessage);applyState.addEventListener('click',changeState);assignButton.addEventListener('click',assignToMe);requestApproval.addEventListener('click',requestSensitiveApproval);
$('#lease-case')?.addEventListener('click',leaseCase);$('#escalate-case')?.addEventListener('click',escalateCase);$('#handoff-case')?.addEventListener('click',handoffCase);$('#save-qa')?.addEventListener('click',saveQa);$('#create-incident')?.addEventListener('click',createIncident);$('#create-macro')?.addEventListener('click',createMacro);
loadCases();loadGlobalOps();