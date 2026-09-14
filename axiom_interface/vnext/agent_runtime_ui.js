import {ProjectStore} from '../projects.js';
import {ObservabilityStore} from '../observability.js';
import {AgentAutomationStore} from '../agent_store.js';

const $=(selector,root=document)=>root.querySelector(selector);
const clean=(value,max=1000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max);
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const activeProjectId=()=>{try{return localStorage.getItem('axiom.vnext.active-project')||''}catch{return ''}};
const route=()=>((location.hash.match(/^#\/([^/?#]+)/)||[])[1]||'home');

let store=null;
let projects=null;
let observability=null;
let opening=null;

async function open(){
  if(store)return store;
  if(opening)return opening;
  opening=(async()=>{
    projects=await ProjectStore.open();
    observability=await ObservabilityStore.open();
    store=await AgentAutomationStore.open({projects:{store:projects},observability:{store:observability}});
    return store;
  })();
  try{return await opening}finally{opening=null}
}

function ensureDialog(){
  if($('#vnext-agent-dialog'))return;
  const dialog=document.createElement('dialog');
  dialog.id='vnext-agent-dialog';
  dialog.setAttribute('aria-labelledby','vnext-agent-dialog-title');
  dialog.innerHTML=`<form id="vnext-agent-form">
    <div class="dialog-head"><h2 id="vnext-agent-dialog-title">Create local governed agent</h2><button class="icon-button" data-agent-close type="button" aria-label="Close agent form">×</button></div>
    <p class="muted">Creates a browser-local agent with least-privilege defaults. It cannot access external networks or execute external actions.</p>
    <div class="control-grid">
      <label style="grid-column:1/-1">Name<input id="vnext-agent-name" maxlength="120" required placeholder="Research specialist"></label>
      <label style="grid-column:1/-1">Declared purpose<textarea id="vnext-agent-purpose" rows="4" maxlength="1000" required placeholder="Describe the agent's bounded purpose"></textarea></label>
      <label>Autonomy<select id="vnext-agent-autonomy"><option value="PROPOSE_ONLY">Propose only</option><option value="LOCAL_PREVIEW">Local preview</option></select></label>
      <label>Run budget<input id="vnext-agent-runs" type="number" min="1" max="1000" value="10"></label>
    </div>
    <p id="vnext-agent-error" class="muted" role="alert" hidden></p>
    <div class="dialog-actions"><button class="button secondary" data-agent-close type="button">Cancel</button><button class="button primary" type="submit">Create agent</button></div>
  </form>`;
  document.body.append(dialog);
  dialog.querySelectorAll('[data-agent-close]').forEach(button=>button.addEventListener('click',()=>dialog.close()));
  $('#vnext-agent-form',dialog).addEventListener('submit',event=>void createAgent(event));
}

async function createAgent(event){
  event.preventDefault();
  const projectId=activeProjectId();
  const error=$('#vnext-agent-error');
  error.hidden=true;
  try{
    if(!projectId)throw new Error('Select a project before creating an agent.');
    const db=await open();
    await db.createAgent({
      projectId,
      actorId:'local-user',
      name:$('#vnext-agent-name').value,
      purpose:$('#vnext-agent-purpose').value,
      toolScopes:['project.read'],
      dataScopes:['project.metadata'],
      autonomy:$('#vnext-agent-autonomy').value,
      maxRuns:Number($('#vnext-agent-runs').value||10),
      maxComputeUnits:100
    });
    $('#vnext-agent-dialog').close();
    await renderAgents();
  }catch(reason){
    error.textContent=clean(reason?.message||'Agent could not be created',240);
    error.hidden=false;
  }
}

async function renderAgents(){
  if(route()!=='agents')return;
  const root=$('#workspace-root');
  if(!root)return;
  const projectId=activeProjectId();
  if(!projectId){
    root.innerHTML=`<header class="page-head"><div><small class="eyebrow">MUSITU AXIOM</small><h1>Agents</h1><p>Governed execution identities with explicit purpose, grants, budgets and kill switches.</p></div></header><div class="card"><h3>Select a project first</h3><p>Agents are always scoped to a Project graph.</p><p style="margin-top:12px"><a class="button primary" href="#/projects">Open projects</a></p></div>`;
    return;
  }
  try{
    const db=await open();
    const [agents,project]=await Promise.all([db.listAgents(projectId),projects.getProject(projectId)]);
    root.innerHTML=`<header class="page-head"><div><small class="eyebrow">MUSITU AXIOM</small><h1>Agents</h1><p>Governed execution identities with explicit purpose, grants, budgets and kill switches.</p></div><button class="button primary" id="vnext-agent-new" type="button">Create agent</button></header>
      <div class="card" style="margin-bottom:14px"><small class="eyebrow">Qualified local boundary</small><h3>${esc(project?.name||'Project agents')}</h3><p>Agent registry is browser-local. Model policy is deterministic local preview, external network is denied, and external action execution is not claimed.</p></div>
      <div class="metric-grid"><div class="metric"><strong>${agents.length}</strong><span>Registered agents</span></div><div class="metric"><strong>${agents.filter(a=>a.status==='ACTIVE').length}</strong><span>Active registry records</span></div><div class="metric"><strong>0</strong><span>External actions claimed</span></div><div class="metric"><strong>Deny</strong><span>External network policy</span></div></div>
      <section class="section"><div class="card-grid">${agents.length?agents.map(agent=>`<article class="card"><div class="card-top"><div><h3>${esc(agent.name)}</h3><p>${esc(agent.purpose)}</p></div><span class="badge ${agent.status==='ACTIVE'?'ok':'warn'}">${esc(agent.status)}</span></div><small class="muted">${esc(agent.grant?.autonomy||'PROPOSE_ONLY')} · ${esc((agent.grant?.tool_scopes||[]).join(', '))}</small><div class="evidence-list" style="margin-top:12px"><div class="evidence-item"><strong>Workload identity</strong><span>${esc(agent.workload_identity_id)}</span></div><div class="evidence-item"><strong>Budget</strong><span>${Number(agent.usage?.runs||0)} / ${Number(agent.grant?.budget?.max_runs||0)} runs used</span></div></div></article>`).join(''):`<div class="card"><h3>No governed agents yet</h3><p>Create one with the minimum safe grant, then expand authority only when required.</p></div>`}</div></section>`;
    $('#vnext-agent-new')?.addEventListener('click',()=>{ensureDialog();$('#vnext-agent-form').reset();$('#vnext-agent-runs').value='10';$('#vnext-agent-error').hidden=true;$('#vnext-agent-dialog').showModal();});
  }catch(reason){
    root.innerHTML=`<header class="page-head"><div><small class="eyebrow">MUSITU AXIOM</small><h1>Agents</h1><p>Governed execution identities with explicit purpose, grants, budgets and kill switches.</p></div></header><div class="card"><h3>Agent registry unavailable</h3><p>${esc(clean(reason?.message||'Unable to open the browser-local registry',240))}</p></div>`;
  }
}

async function renderAutomations(){
  if(route()!=='automations')return;
  const root=$('#workspace-root');
  if(!root)return;
  const projectId=activeProjectId();
  if(!projectId){
    root.innerHTML=`<header class="page-head"><div><small class="eyebrow">MUSITU AXIOM</small><h1>Automations</h1><p>Triggered, approved local-preview work bound to governed agents.</p></div></header><div class="card"><h3>Select a project first</h3><p>Automations inherit project and agent authority.</p></div>`;
    return;
  }
  try{
    const db=await open();
    const rows=await db.listAutomations(projectId);
    root.innerHTML=`<header class="page-head"><div><small class="eyebrow">MUSITU AXIOM</small><h1>Automations</h1><p>Triggered, approved local-preview work bound to governed agents.</p></div></header>
      <div class="card" style="margin-bottom:14px"><small class="eyebrow">Execution boundary</small><h3>Local preview only</h3><p>Existing automation records require explicit configuration approval. The earned browser substrate does not claim a cloud scheduler or external action execution.</p></div>
      <div class="list">${rows.length?rows.map(row=>`<article class="list-row"><span><strong>${esc(row.name)}</strong><small>${esc(row.objective)} · ${esc(row.trigger?.kind||'trigger')} · ${esc(row.action_scope)}</small></span><span class="badge ${row.status==='ENABLED'?'ok':''}">${esc(row.status)}</span></article>`).join(''):`<div class="card"><h3>No automation records yet</h3><p>Create and approve automations only after the corresponding agent has the exact required scope.</p></div>`}</div>`;
  }catch(reason){
    root.innerHTML=`<header class="page-head"><div><small class="eyebrow">MUSITU AXIOM</small><h1>Automations</h1></div></header><div class="card"><h3>Automation registry unavailable</h3><p>${esc(clean(reason?.message||'Unable to open the browser-local registry',240))}</p></div>`;
  }
}

async function render(){
  if(route()==='agents')await renderAgents();
  else if(route()==='automations')await renderAutomations();
}

window.addEventListener('hashchange',()=>queueMicrotask(()=>void render()));
queueMicrotask(()=>void render());
window.AxiomVNextAgentUI=Object.freeze({refresh:render,boundary:'LOCAL_PREVIEW_ONLY_NO_EXTERNAL_ACTION'});
