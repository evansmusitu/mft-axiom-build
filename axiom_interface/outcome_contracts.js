const DB_NAME='musitu-axiom-outcome-contracts-v1';
const DB_VERSION=1;
const SCHEMA='musitu.axiom.outcome-contract.v1';
const EXECUTION_BOUNDARY='PREVIEW_ONLY_NO_EXTERNAL_CONSEQUENTIAL_ACTIONS';
const WRITERS=new Set(['owner','editor']);
const PRIVACY=new Set(['Private','Project','Organization']);
const EVIDENCE=new Set(['Standard','Strict','Independent validation']);
const AUTONOMY=new Set(['Preview only','Approval each action','Policy-bounded']);
const APPROVAL=new Set(['Before consequential action','Every tool action','Read-only auto, writes approved']);

const clean=(value,max=1000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const clone=value=>structuredClone(value);
const lines=(value,max=20)=>clean(value,8000).split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,max);
function canonical(value){if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object'){return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;}return JSON.stringify(value);}
async function sha256(value){const bytes=new TextEncoder().encode(canonical(value));const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function id(prefix){return `${prefix}_${crypto.randomUUID?.()||`${Date.now()}_${Math.random().toString(16).slice(2)}`}`;}
function request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('transaction aborted'));});}
function authorize(project,actor){const role=project.permissions?.find(x=>x.principal_id===actor)?.role;if(!WRITERS.has(role))throw new DOMException('project write permission required','NotAllowedError');return role;}
function normalize(payload){
  const project_id=clean(payload.projectId,180),title=clean(payload.title,180),outcome=clean(payload.outcome,4000),success_criteria=lines(payload.successCriteria);
  if(!project_id||!title||!outcome||!success_criteria.length)throw new TypeError('project, title, outcome and at least one success criterion are required');
  const privacy=clean(payload.privacy,40)||'Project',evidence=clean(payload.evidence,40)||'Standard',autonomy=clean(payload.autonomy,60)||'Preview only',approval=clean(payload.approval,80)||'Before consequential action';
  if(!PRIVACY.has(privacy)||!EVIDENCE.has(evidence)||!AUTONOMY.has(autonomy)||!APPROVAL.has(approval))throw new TypeError('invalid outcome contract constraint');
  const budgetRaw=clean(payload.computeBudget,32);const compute_budget=budgetRaw===''?null:Number(budgetRaw);if(compute_budget!==null&&(!Number.isFinite(compute_budget)||compute_budget<0))throw new TypeError('compute budget must be non-negative');
  return {schema:SCHEMA,project_id,title,outcome,success_criteria,constraints:{privacy,evidence,autonomy,approval,deadline:clean(payload.deadline,80)||null,compute_budget},execution_boundary:EXECUTION_BOUNDARY,supersedes_contract_id:clean(payload.supersedesContractId,180)||null};
}

export class OutcomeContractStore{
  constructor(db){this.db=db;}
  static async open(){const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('contracts')){const s=db.createObjectStore('contracts',{keyPath:'contract_id'});s.createIndex('project_id','project_id');s.createIndex('contract_sha256','contract_sha256',{unique:true});}};return new OutcomeContractStore(await request(req));}
  async create(projects,actor,payload){
    const body=normalize(payload);const project=await projects.store.getProject(body.project_id);authorize(project,actor);
    if(body.supersedes_contract_id){const old=await this.get(body.supersedes_contract_id);if(old.project_id!==body.project_id)throw new DOMException('superseded contract must belong to the same project','InvalidStateError');}
    const contract_sha256=await sha256(body);const existing=await this.findByHash(contract_sha256);if(existing)return existing;
    const record={...body,contract_id:id('oc'),contract_sha256,project_object_id:null,created_at:new Date().toISOString(),created_by:actor};
    await this.put(record);
    try{
      const task=await projects.store.addObject(body.project_id,actor,{type:'task',title:`Outcome Contract · ${body.title}`,provenanceSource:`outcome-contract:${contract_sha256}`,evidenceLinks:[`contract:${record.contract_id}`,`sha256:${contract_sha256}`]});
      record.project_object_id=task.object_id;await this.put(record);return clone(record);
    }catch(error){await this.delete(record.contract_id);throw error;}
  }
  async put(record){const tx=this.db.transaction('contracts','readwrite');tx.objectStore('contracts').put(clone(record));await done(tx);}
  async delete(contractId){const tx=this.db.transaction('contracts','readwrite');tx.objectStore('contracts').delete(contractId);await done(tx);}
  async get(contractId){const tx=this.db.transaction('contracts','readonly');const row=await request(tx.objectStore('contracts').get(contractId));await done(tx);if(!row)throw new DOMException('outcome contract not found','NotFoundError');return clone(row);}
  async list(projectId){const tx=this.db.transaction('contracts','readonly');const rows=await request(tx.objectStore('contracts').index('project_id').getAll(projectId));await done(tx);return rows.sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(clone);}
  async findByHash(hash){const tx=this.db.transaction('contracts','readonly');const row=await request(tx.objectStore('contracts').index('contract_sha256').get(hash));await done(tx);return row?clone(row):null;}
  async verify(contractId){const row=await this.get(contractId);const body={schema:row.schema,project_id:row.project_id,title:row.title,outcome:row.outcome,success_criteria:row.success_criteria,constraints:row.constraints,execution_boundary:row.execution_boundary,supersedes_contract_id:row.supersedes_contract_id};return (await sha256(body))===row.contract_sha256;}
  async approval(projects,contractId){const row=await this.get(contractId);const graph=await projects.store.graph(row.project_id);const edge=graph.edges.find(e=>e.to_id===row.project_object_id&&e.relation==='approves');if(!edge)return null;const decision=graph.objects.find(o=>o.object_id===edge.from_id);return decision?{receipt_id:decision.object_id,edge_id:edge.edge_id,contract_id:row.contract_id,contract_sha256:row.contract_sha256,provenance:decision.provenance}:null;}
  async approve(projects,actor,contractId){
    const row=await this.get(contractId);const project=await projects.store.getProject(row.project_id);authorize(project,actor);if(!(await this.verify(contractId)))throw new DOMException('outcome contract integrity failure','DataError');
    const prior=await this.approval(projects,contractId);if(prior)return prior;
    const decision=await projects.store.addObject(row.project_id,actor,{type:'decision',title:`Approval receipt · ${row.title}`,provenanceSource:'explicit-user-approval',evidenceLinks:[`contract:${row.contract_id}`,`sha256:${row.contract_sha256}`]});
    const edge=await projects.store.addEdge(row.project_id,actor,{fromId:decision.object_id,toId:row.project_object_id,relation:'approves',provenanceSource:'explicit-user-approval'});
    return {receipt_id:decision.object_id,edge_id:edge.edge_id,contract_id:row.contract_id,contract_sha256:row.contract_sha256,provenance:decision.provenance};
  }
}

function markup(){return `<section id="outcome-contract-space" class="outcome-space" aria-labelledby="outcome-space-title" hidden>
  <div class="outcome-heading"><div><span class="eyebrow">Phase 3 · Outcome Contracts</span><h2 id="outcome-space-title">Outcome Contracts</h2><p>Turn desired outcomes into immutable, evidence-linked acceptance contracts before execution.</p></div><span class="status-pill neutral">Preview-only execution boundary</span></div>
  <p class="boundary-note">Contracts persist on this browser-local device and link into the Project graph. Approval creates an inspectable decision receipt; it does not execute any consequential action.</p>
  <div class="outcome-layout">
    <form id="outcome-contract-form" class="outcome-card" aria-label="Create Outcome Contract">
      <h3>Create Outcome Contract</h3>
      <label>Project<select id="outcome-project" required></select></label>
      <label>Contract title<input id="outcome-title" maxlength="180" required></label>
      <label>Desired outcome<textarea id="outcome-goal" rows="3" required></textarea></label>
      <label>Success criteria <span class="field-hint">one per line</span><textarea id="outcome-success" rows="4" required></textarea></label>
      <div class="outcome-grid">
        <label>Privacy<select id="outcome-privacy"><option>Project</option><option>Private</option><option>Organization</option></select></label>
        <label>Evidence<select id="outcome-evidence"><option>Standard</option><option>Strict</option><option>Independent validation</option></select></label>
        <label>Autonomy<select id="outcome-autonomy"><option>Preview only</option><option>Approval each action</option><option>Policy-bounded</option></select></label>
        <label>Approval policy<select id="outcome-approval"><option>Before consequential action</option><option>Every tool action</option><option>Read-only auto, writes approved</option></select></label>
        <label>Deadline<input id="outcome-deadline" type="datetime-local"></label>
        <label>Compute budget<input id="outcome-budget" type="number" min="0" inputmode="numeric" placeholder="Optional"></label>
      </div>
      <button class="button primary" type="submit">Create contract</button>
    </form>
    <section class="outcome-card" aria-labelledby="outcome-list-title"><div class="section-heading"><div><span class="eyebrow">Inspectable agreements</span><h3 id="outcome-list-title">Project contracts</h3></div><button class="button secondary" id="outcome-refresh" type="button">Refresh</button></div><div id="outcome-list" class="outcome-list" aria-live="polite"><p class="proof-empty">Choose a project to inspect contracts.</p></div></section>
  </div>
</section>`;}

export async function initOutcomeContractWorkspace({emit=()=>{},projects}={}){
  if(!projects?.store)throw new TypeError('qualified Project substrate is required');
  const workspace=document.querySelector('#main-workspace');if(!workspace)return null;
  const style=document.createElement('link');style.rel='stylesheet';style.href='./styles/outcomes.css';document.head.append(style);
  workspace.insertAdjacentHTML('beforeend',markup());
  const space=document.querySelector('#outcome-contract-space'),hero=document.querySelector('.hero-card'),run=document.querySelector('.run-stage'),store=await OutcomeContractStore.open(),actor='local-user';let currentContract='';
  async function refreshProjects(){const rows=await projects.store.listProjects();const select=document.querySelector('#outcome-project');const preferred=select.value||projects.getCurrentProjectId?.()||'';select.replaceChildren(new Option('Choose project',''));for(const p of rows)select.add(new Option(`${p.name} · ${p.project_id}`,p.project_id));if(preferred&&rows.some(p=>p.project_id===preferred))select.value=preferred;await render();}
  async function render(){const projectId=document.querySelector('#outcome-project').value,list=document.querySelector('#outcome-list');list.replaceChildren();if(!projectId){const p=document.createElement('p');p.className='proof-empty';p.textContent='Choose a project to inspect contracts.';list.append(p);return;}const rows=await store.list(projectId);if(!rows.length){const p=document.createElement('p');p.className='proof-empty';p.textContent='No Outcome Contracts yet.';list.append(p);return;}for(const row of [...rows].reverse()){const article=document.createElement('article');article.className='outcome-contract';article.dataset.contractId=row.contract_id;const approved=await store.approval(projects,row.contract_id);const h=document.createElement('h4');h.textContent=row.title;const state=document.createElement('span');state.className=`claim-state ${approved?'supported':'observation'}`;state.textContent=approved?'Approved':'Draft';const meta=document.createElement('p');meta.className='outcome-meta';meta.textContent=`${row.contract_id} · sha256:${row.contract_sha256.slice(0,12)}… · ${row.success_criteria.length} success criteria`;const goal=document.createElement('p');goal.textContent=row.outcome;const criteria=document.createElement('ul');for(const item of row.success_criteria){const li=document.createElement('li');li.textContent=item;criteria.append(li);}const controls=document.createElement('div');controls.className='outcome-actions';const verify=document.createElement('button');verify.type='button';verify.className='button secondary';verify.textContent='Verify integrity';verify.addEventListener('click',async()=>{const ok=await store.verify(row.contract_id);emit('outcome.verify',{state:ok?'verified':'invalid'});state.textContent=ok?(approved?'Approved · verified':'Draft · verified'):'Integrity failed';});controls.append(verify);if(!approved){const approve=document.createElement('button');approve.type='button';approve.className='button primary';approve.textContent='Approve contract';approve.addEventListener('click',async()=>{try{await store.approve(projects,actor,row.contract_id);currentContract=row.contract_id;emit('outcome.approved',{state:'receipt-recorded'});await render();}catch(error){window.AxiomUI?.reportError?.({errorId:'AXIOM-OUTCOME-APPROVE',component:'Outcome Contracts',impact:'Approval receipt not recorded',failed:error.message,recovery:'Verify project permission and contract integrity, then retry'});}});controls.append(approve);}const boundary=document.createElement('p');boundary.className='outcome-boundary';boundary.textContent='No external action executed. Approval records policy intent only.';article.append(state,h,meta,goal,criteria,controls,boundary);list.append(article);}}
  function route(){const on=/^#\/work(?:\/|$)/.test(location.hash);space.hidden=!on;if(on){if(hero)hero.hidden=true;if(run)run.hidden=true;document.querySelector('#workspace-title').textContent='Work';document.querySelector('#workspace-description').textContent='Define inspectable Outcome Contracts with explicit success criteria, constraints and approval receipts before execution.';refreshProjects().catch(error=>window.AxiomUI?.reportError?.({errorId:'AXIOM-OUTCOME-READ',component:'Outcome Contracts',impact:'Contracts unavailable',failed:error.message,recovery:'Reload the workspace and retry'}));}else if(!/^#\/(projects|project(?:\/|$))/.test(location.hash)){if(hero)hero.hidden=false;if(run)run.hidden=false;}}
  document.querySelector('#outcome-project').addEventListener('change',render);
  document.querySelector('#outcome-refresh').addEventListener('click',refreshProjects);
  document.querySelector('#outcome-contract-form').addEventListener('submit',async e=>{e.preventDefault();try{const row=await store.create(projects,actor,{projectId:document.querySelector('#outcome-project').value,title:document.querySelector('#outcome-title').value,outcome:document.querySelector('#outcome-goal').value,successCriteria:document.querySelector('#outcome-success').value,privacy:document.querySelector('#outcome-privacy').value,evidence:document.querySelector('#outcome-evidence').value,autonomy:document.querySelector('#outcome-autonomy').value,approval:document.querySelector('#outcome-approval').value,deadline:document.querySelector('#outcome-deadline').value,computeBudget:document.querySelector('#outcome-budget').value});currentContract=row.contract_id;e.target.reset();document.querySelector('#outcome-privacy').value='Project';document.querySelector('#outcome-evidence').value='Standard';document.querySelector('#outcome-autonomy').value='Preview only';document.querySelector('#outcome-approval').value='Before consequential action';document.querySelector('#outcome-project').value=row.project_id;emit('outcome.created',{state:'persisted-preview-only'});await render();}catch(error){window.AxiomUI?.reportError?.({errorId:'AXIOM-OUTCOME-CREATE',component:'Outcome Contracts',impact:'Contract not created',failed:error.message,recovery:'Choose a writable project, complete the required fields and retry'});}});
  window.addEventListener('hashchange',route);await refreshProjects();route();const api={store,getCurrentContractId:()=>currentContract,refresh:refreshProjects};window.AxiomOutcomes=Object.freeze(api);return api;
}
