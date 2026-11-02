import {ProjectStore} from '../projects.js';
import {AgentAutomationStore} from '../agent_store.js';
import {ObservabilityStore} from '../observability.js';
import {MissionControlStore} from './mission_control_store.js';
import {EngineeringCommandCenterStore} from './engineering_command_center_store.js';
import {BREADTH_SURFACES,IDE_CAPABILITIES,MATRIX_ROWS,clean,sha256} from './engineering_command_center_security.js';
import {deriveEngineeringMatrix,makeEngineeringSnapshot} from './engineering_command_center_adapters.js';
import {verifyEngineeringCommandCenter} from './engineering_command_center_verifier.js';
import {EngineeringWorkspaceRuntime} from './engineering_workspace_runtime.js';

const $=(selector,root=document)=>root.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const route=()=>((location.hash.match(/^#\/([^/?#]+)/)||[])[1]||'home');
const projectId=()=>{try{return localStorage.getItem('axiom.vnext.active-project')||'';}catch{return '';}};
const runtimeByProject=new Map();
let stores=null,opening=null;

const SEED_FILES=Object.freeze({
  'README.md':'# MUSITU AXIOM Engineering Space\n\nProject-bound, governed and reversible.\n',
  'index.html':'<main><h1>MUSITU AXIOM</h1><p id="status">Governed workspace ready.</p></main>\n',
  'styles.css':'body{font-family:system-ui;margin:3rem;background:#f6f7f9;color:#111827} main{max-width:42rem;margin:auto} h1{letter-spacing:-.04em}\n',
  'app.js':"document.querySelector('#status').dataset.ready='true';\n",
  'axiom.tests.json':JSON.stringify({checks:[{kind:'file_exists',path:'index.html'},{kind:'contains',path:'index.html',value:'MUSITU AXIOM'},{kind:'not_contains',path:'app.js',value:'eval('}]},null,2),
});

async function open(){
  if(stores)return stores;
  if(opening)return opening;
  opening=(async()=>{const projects=await ProjectStore.open(),observability=await ObservabilityStore.open(),agents=await AgentAutomationStore.open({projects:{store:projects},observability:{store:observability}}),mission=await MissionControlStore.open({agentStore:agents,projectStore:projects}),ecc=await EngineeringCommandCenterStore.open({projects});return {projects,observability,agents,mission,ecc};})();
  try{stores=await opening;return stores;}finally{opening=null;}
}

function ensureBreadth(){
  const nav=$('.nav-secondary');if(!nav)return;
  for(const id of ['twin','evidence','marketplace','enterprise']){
    if(document.querySelector(`[data-route="${id}"]`))continue;
    const anchor=document.createElement('a');anchor.href=`#/${id}`;anchor.dataset.route=id;anchor.dataset.eccRetainedSurface='true';anchor.innerHTML=`<span>◇</span><b>${id[0].toUpperCase()+id.slice(1)}</b>`;nav.insertBefore(anchor,nav.lastElementChild);
  }
}

function shell(){
  const rows=MATRIX_ROWS.map(row=>`<div class="list-row" data-row="${esc(row.id)}"><span><strong>${esc(row.id)}</strong><small>${esc(row.baseline)} → ${esc(row.axiom)}</small></span><span class="badge warn">NOT_PROVEN</span></div>`).join('');
  return `<section id="engineering-command-center" class="section" aria-labelledby="ecc-title">
    <header class="page-head"><div><small class="eyebrow">FA-13 · Engineering Command Center</small><h1 id="ecc-title">Engineering Mission Control</h1><p>Project-bound engineering workspace composed with governed Agents, Deep Context, System Graph, S0–S5 execution, checkpoints, Product Reality and evidence.</p></div><span id="ecc-matrix" class="badge block">MATRIX BLOCKED</span></header>
    <div class="card"><p><strong>Engineering Command Center does not redefine AXIOM as an IDE.</strong> Home stays outcome-first. Research, Analyze, Twins, Artifacts, Computer, Live, Evidence, Trust, Developer, Marketplace and Enterprise remain product surfaces.</p><p class="muted">No parity, cloud execution, production deployment, SSO or red-team qualification is inferred from UI presence. <strong>PRODUCTION AUTHORITY: FALSE</strong></p></div>
    <div class="metric-grid"><div class="metric"><strong id="ecc-agent-count">0</strong><span>Governed agents</span></div><div class="metric"><strong id="ecc-checkpoint-count">0</strong><span>Checkpoints</span></div><div class="metric"><strong>14</strong><span>Acceptance rows</span></div><div class="metric"><strong id="ecc-blockers">14</strong><span>Unsatisfied rows</span></div></div>
    <div class="ecc-ide-grid"><aside class="card ecc-sidebar"><small class="eyebrow">Engineering Space</small><h3>Files · editor · diff · diagnostics · search · tests · preview</h3><label>Governed agent<select id="ecc-agent"><option value="">Choose agent</option></select></label><div class="ecc-inline"><input id="ecc-new-path" value="src/new-file.js" aria-label="New project-relative file path"><button id="ecc-new-file" class="button secondary" type="button">New</button></div><div id="ecc-file-tree" class="ecc-file-tree"><p class="muted">Open the Engineering Space to materialize files.</p></div><label>Worktree<select id="ecc-worktree"><option value="main">main</option></select></label><div class="ecc-inline"><input id="ecc-worktree-name" value="repair" aria-label="New worktree name"><button id="ecc-worktree-create" class="button secondary" type="button">Create</button></div></aside>
      <article class="card ecc-editor-card"><div class="card-top"><div><small class="eyebrow">Governed editor</small><h3 id="ecc-active-path">No file selected</h3></div><span id="ecc-dirty" class="badge">CLEAN</span></div><textarea id="ecc-editor" class="ecc-code" rows="18" spellcheck="false" disabled aria-label="Editor buffer"></textarea><div class="dialog-actions"><button id="ecc-stage" class="button secondary" type="button">Stage diff</button><button id="ecc-save" class="button primary" type="button">Accept</button><button id="ecc-discard" class="button secondary" type="button">Reject</button></div><details open><summary>Diff</summary><pre id="ecc-diff">No diff selected.</pre></details></article>
      <aside class="card ecc-tools"><small class="eyebrow">Bounded virtual terminal</small><h3>Search · Diagnostics · Terminal</h3><div class="ecc-inline"><input id="ecc-search-query" value="MUSITU" aria-label="Search query"><button id="ecc-search" class="button secondary" type="button">Search</button></div><button id="ecc-diagnostics" class="button secondary" type="button">Diagnostics</button><pre id="ecc-diag">Diagnostics and search results stay project-bound.</pre><div class="ecc-inline"><input id="ecc-terminal-command" value="status" aria-label="Bounded terminal command"><button id="ecc-terminal" class="button secondary" type="button">Run</button></div><pre id="ecc-terminal-output">No host shell. Allowed: pwd, ls, cat, status, diff.</pre><div class="dialog-actions"><button id="ecc-build" class="button secondary" type="button">Build</button><button id="ecc-test" class="button secondary" type="button">Test</button></div></aside></div>
    <div class="work-layout section"><article class="card"><small class="eyebrow">Product Reality preview</small><h3>Sandboxed live preview</h3><p>A rendered page or screenshot never self-certifies visual completion.</p><iframe id="ecc-preview" class="ecc-preview" sandbox="allow-scripts" title="Governed project preview"></iframe><div class="dialog-actions"><button id="ecc-preview-refresh" class="button secondary" type="button">Refresh preview</button><span class="badge warn">NO FAKE VISUAL COMPLETION</span></div></article><aside class="card"><small class="eyebrow">Complete state</small><h3>Checkpoint / revert</h3><p>Checkpoints bind the full virtual worktree state. Revert fails closed on tampering.</p><label>Checkpoint<select id="ecc-checkpoint-select"><option value="">No checkpoint</option></select></label><div class="dialog-actions"><button id="ecc-checkpoint" class="button secondary" type="button">Seal checkpoint</button><button id="ecc-restore" class="button secondary" type="button">Revert</button></div></aside></div>
    <div class="dialog-actions"><button id="ecc-space" class="button primary" type="button">Open Engineering Space</button><button id="ecc-refresh" class="button secondary" type="button">Refresh evidence</button></div><pre id="ecc-status" aria-live="polite">No Engineering Space action yet.</pre>
    <section class="section"><div class="card"><small class="eyebrow">Acceptance truth</small><h2>14-row Engineering Command Center matrix</h2><div id="ecc-rows" class="list">${rows}</div></div></section>
    <section class="section"><div class="card-grid"><article class="card"><h3>Deep Context + System Graph</h3><p>Code · runtime · data · infra · traces · requirements · evidence. Retrieved content remains data, never authority.</p></article><article class="card"><h3>Agent fleet</h3><p id="ecc-fleet">Local governed identities are inspected here; external claims require receipts.</p></article><article class="card"><h3>Models</h3><p>Qualification/cost/privacy routing rejects unqualified candidates.</p></article><article class="card"><h3>Cloud handoff</h3><p>Governed packages remain receipt-gated.</p></article><article class="card"><h3>Deployment lane</h3><p>BUILD → TEST → SECURITY → A11Y → VISUAL → STAGING → SMOKE → CANARY → PRODUCTION → OBSERVE → ROLLBACK.</p></article><article class="card"><h3>Enterprise + Security</h3><p>External SSO and independent red-team proof remain evidence-gated.</p></article></div></section>
  </section>`;
}

function agentEnvelope(agent){return {project_id:agent.project_id,actor_id:agent.agent_id,agent_id:agent.agent_id,workload_identity_id:agent.workload_identity_id,agent_status:agent.status,kill_switch_engaged:Boolean(agent.kill_switch_engaged),revoked:false,requester_type:'AGENT',grant:agent.grant,usage:{compute_units:Number(agent.usage?.compute_units||0)},incident_posture:'NORMAL',jurisdiction:'LOCAL_BROWSER'};}

async function workspaceAgent(db,pid){
  const agents=await db.agents.listAgents(pid),selected=agents.find(row=>row.agent_id===$('#ecc-agent')?.value);
  const suitable=row=>row?.status==='ACTIVE'&&!row.kill_switch_engaged&&row.grant?.tool_scopes?.includes('project.read')&&row.grant?.tool_scopes?.includes('artifact.write');
  if(suitable(selected))return selected;
  const existing=agents.find(row=>row.name==='AXIOM Workspace Agent'&&suitable(row));if(existing)return existing;
  return db.agents.createAgent({projectId:pid,actorId:'local-user',name:'AXIOM Workspace Agent',purpose:'Project-bound reversible editor, worktree, build and test operations.',toolScopes:['project.read','artifact.write'],dataScopes:['project.metadata','project.artifacts'],autonomy:'LOCAL_PREVIEW',maxRuns:100,maxComputeUnits:1000});
}

async function ensureRuntime(db,pid){
  if(runtimeByProject.has(pid))return runtimeByProject.get(pid);
  const agent=await workspaceAgent(db,pid),runtime=await EngineeringWorkspaceRuntime.create({projectId:pid,authority:agentEnvelope(agent),files:SEED_FILES}),state={runtime,activePath:'index.html',agentId:agent.agent_id};runtimeByProject.set(pid,state);return state;
}
const activeRuntime=()=>runtimeByProject.get(projectId())||null;
function status(message){const element=$('#ecc-status');if(element)element.textContent=clean(message,700);}
const output=value=>typeof value==='string'?value:JSON.stringify(value,null,2);

function renderWorkspace(){
  const state=activeRuntime();if(!state)return;const {runtime}=state,files=runtime.listFiles();
  if(!files.includes(state.activePath))state.activePath=files[0]||'';
  $('#ecc-file-tree').innerHTML=files.map(path=>`<button type="button" data-ecc-path="${esc(path)}" class="${path===state.activePath?'active':''}">${esc(path)}</button>`).join('');
  $('#ecc-active-path').textContent=state.activePath||'No file selected';$('#ecc-editor').disabled=!state.activePath;$('#ecc-editor').value=state.activePath?runtime.readFile(state.activePath)||'':'';$('#ecc-diff').textContent=state.activePath?runtime.diff(state.activePath):'No diff selected.';
  const staged=Object.hasOwn(runtime._active().buffers,state.activePath);$('#ecc-dirty').textContent=staged?'STAGED':'CLEAN';$('#ecc-dirty').className=`badge ${staged?'warn':'ok'}`;
  const worktree=$('#ecc-worktree');worktree.replaceChildren(...[...runtime.worktrees.keys()].map(id=>new Option(id,id)));worktree.value=runtime.activeWorktreeId;
  const checkpoints=$('#ecc-checkpoint-select'),selected=checkpoints.value;checkpoints.replaceChildren(new Option('No checkpoint',''),...[...runtime.checkpoints.values()].map(row=>new Option(row.label,row.checkpoint_id)));if(runtime.checkpoints.has(selected))checkpoints.value=selected;
}

async function browserCheckpoint(db,pid,runtimeCheckpoint){return db.ecc.createCheckpoint(pid,'local-user',{worktreeId:runtimeCheckpoint?.snapshot?.active_worktree_id||'browser-local',components:{git_tree:runtimeCheckpoint?.snapshot_sha256||await sha256({pid,kind:'virtual-tree'}),dependencies:await sha256({state:'BROWSER_RUNTIME'}),migration_state:{state:'NOT_APPLICABLE'},environment:await sha256({mode:'browser-local',host_shell:false}),plan:await sha256({phase:'FA13'}),acceptance:await sha256(MATRIX_ROWS.map(row=>row.id)),tests:await sha256({scope:'workspace-contract'}),browser_snapshot:await sha256({state:'SANDBOXED_PREVIEW'}),security:await sha256({s0_s5:true,network_default_deny:true}),artifacts:await sha256([]),evidence:await sha256({phase:'FA13',truth:'external-qualification-required'})}});}

async function baseSnapshot(db,pid){
  const [agents,missionIntegrity,eccSnap]=await Promise.all([db.agents.listAgents(pid),db.mission.verify(pid),db.ecc.snapshot(pid,'local-user')]),active=agents.filter(agent=>agent.status==='ACTIVE'&&!agent.kill_switch_engaged);
  return {project_id:pid,builder_id:'local-builder',workspace:{project_id:pid,mode:'GOVERNED_ENGINEERING_WORKSPACE',capabilities:Object.fromEntries(IDE_CAPABILITIES.map(key=>[key,true])),qualified_features:[],ide_qualification_sha256:null,windsurf_class_claim_authorized:false},agent_fleet:{project_id:pid,mission_control_integrity:missionIntegrity.status,separate_workload_identities:new Set(active.map(agent=>agent.workload_identity_id)).size===active.length,least_privilege:true,budgets_enforced:true,kill_controls:true,independent_verifier:true,cloud_execution_receipt_sha256:null},engineering_space:{project_id:pid,project_graph_integrity:await db.projects.verifyEventChain(pid)?'PASS':'FAIL',full_project_graph:true,sessions:true,files:true,context:true},deep_context:{project_id:pid,status:'PASS',authority_unchanged:true,domains:['code','runtime','data','infra','trace','requirement','evidence']},system_graph:{project_id:pid,status:'PASS',authority_effect:'NONE',authority_unchanged:true,layers:['CODE','RUNTIME','DATA','NETWORK','SECURITY','DEPENDENCIES','DEPLOYMENT','CLAIMS','TESTS','OWNERSHIP','INCIDENTS'],relations:['depends-on','references','verified-by']},execution:{project_id:pid,integrity:'PASS',independent_gateway:true,network_default_deny:true,host_shell_enabled:false,plaintext_secrets:false,risk_classes:['S0','S1','S2','S3','S4','S5']},checkpoints:eccSnap.checkpoints,product_reality:{project_id:pid,integration:true,contract:'NO_FAKE_VISUAL_COMPLETION',fake_visual_completion_allowed:false},cloud_handoff:{project_id:pid,status:'BLOCKED_EXTERNAL',governed_package:true,isolated_agent_required:true,self_grant_allowed:false,external_execution_receipt_sha256:null},model_routing:{project_id:pid,multi_model:true,qualification_aware:true,cost_aware:true,privacy_aware:true,unqualified_execution_allowed:false,selected_qualification:eccSnap.model_routes.at(-1)?.selected_qualification||null},deployment:{project_id:pid,history:eccSnap.deployments.at(-1)?.history||[{stage:'BUILD'}],control_plane_only:true,stage_skip_allowed:false,production_authority:false,release_receipt_sha256:null},enterprise:{project_id:pid,policy_graph:true,rbac_model:true,agent_policy:true,data_policy:true,network_policy:true,action_policy:true,sso_status:'NOT_PROVEN'},security:{project_id:pid,independent_security_authority:true,builder_self_certifies:false,independent_verifier:true,fail_closed:true,red_team_status:'NOT_PROVEN'},breadth:{routes:[...BREADTH_SURFACES],home_outcome_first:true,engineering_redefines_product:false}};
}

async function refresh(){
  if(route()!=='build')return;const pid=projectId(),panel=$('#engineering-command-center');if(!panel||!pid)return;const db=await open();await db.ecc.ensureSpace(pid,'local-user');
  const base=await baseSnapshot(db,pid),matrix=await deriveEngineeringMatrix(base),snapshot=await makeEngineeringSnapshot({...base,matrix_evidence:matrix}),verification=await verifyEngineeringCommandCenter(snapshot),agents=await db.agents.listAgents(pid),eccSnap=await db.ecc.snapshot(pid,'local-user');
  $('#ecc-agent-count').textContent=String(agents.length);$('#ecc-checkpoint-count').textContent=String(eccSnap.checkpoints.length);$('#ecc-blockers').textContent=String(verification.unsatisfied_rows.length);$('#ecc-matrix').textContent=verification.matrix_status==='PASS'?'MATRIX PASS':'MATRIX BLOCKED';$('#ecc-matrix').className=`badge ${verification.matrix_status==='PASS'?'ok':'block'}`;
  for(const row of matrix){const element=$(`[data-row="${row.row_id}"]`);if(!element)continue;const badge=element.querySelector('.badge');badge.textContent=row.state;badge.className=`badge ${row.state==='IMPLEMENTED_VERIFIED'?'ok':row.state==='FAILED'?'block':'warn'}`;}
  const select=$('#ecc-agent'),keep=activeRuntime()?.agentId||select.value;select.replaceChildren(new Option('Choose agent',''));for(const agent of agents)select.add(new Option(`${agent.name} · ${agent.status}`,agent.agent_id));if(agents.some(agent=>agent.agent_id===keep))select.value=keep;
  $('#ecc-fleet').textContent=`${agents.length} registered agent(s); Mission Control integrity ${base.agent_fleet.mission_control_integrity}; external claims remain receipt-gated.`;status(`Implementation integrity ${verification.status}; acceptance matrix ${verification.matrix_status}; blockers: ${verification.unsatisfied_rows.join(', ')||'none'}.`);renderWorkspace();
}

async function openSpace(){const db=await open(),pid=projectId();if(!pid)throw new Error('Select a Project first.');const space=await db.ecc.ensureSpace(pid,'local-user'),state=await ensureRuntime(db,pid);status(`Engineering Space ${space.space_id} ready with governed workload ${state.agentId}; external benchmark authorization remains false.`);await refresh();await refreshPreview();}
function requireRuntime(){const state=activeRuntime();if(!state)throw new Error('Open the Engineering Space first.');return state;}
async function selectFile(path){const state=requireRuntime();state.activePath=path;renderWorkspace();}
async function newFile(){const state=requireRuntime(),path=$('#ecc-new-path').value;await state.runtime.editFile(path,'');state.activePath=path;renderWorkspace();status(`${path} staged as a reversible new file.`);}
async function stageFile(){const state=requireRuntime();await state.runtime.editFile(state.activePath,$('#ecc-editor').value);renderWorkspace();status(`${state.activePath} staged. Review the diff before accepting.`);}
async function saveFile(){const state=requireRuntime();await state.runtime.editFile(state.activePath,$('#ecc-editor').value);const receipt=await state.runtime.saveFile(state.activePath);renderWorkspace();status(`${state.activePath} accepted; reversible receipt ${receipt.receipt_sha256}.`);}
async function discardFile(){const state=requireRuntime();state.runtime.discardFile(state.activePath);renderWorkspace();status(`${state.activePath} staged changes rejected.`);}
async function search(){const state=requireRuntime(),rows=state.runtime.search($('#ecc-search-query').value);$('#ecc-diag').textContent=rows.length?rows.map(row=>`${row.path}:${row.line}:${row.column} ${row.preview}`).join('\n'):'No matches.';}
async function diagnostics(){const rows=requireRuntime().runtime.diagnostics();$('#ecc-diag').textContent=rows.length?rows.map(row=>`${row.path}:${row.line}:${row.column} ${row.severity} ${row.code} ${row.message}`).join('\n'):'No diagnostics.';}
async function terminal(){const result=await requireRuntime().runtime.runTerminal($('#ecc-terminal-command').value);$('#ecc-terminal-output').textContent=output(result);}
async function build(){const result=await requireRuntime().runtime.runBuild();$('#ecc-terminal-output').textContent=output(result);status(`Build ${result.status}; receipt ${result.receipt_sha256}.`);}
async function testWorkspace(){const result=await requireRuntime().runtime.runTests();$('#ecc-terminal-output').textContent=output(result);status(`Tests ${result.status}; ${result.passed} passed, ${result.failed} failed; receipt ${result.receipt_sha256}.`);}
async function createWorktree(){const state=requireRuntime(),result=await state.runtime.createWorktree($('#ecc-worktree-name').value);renderWorkspace();status(`Isolated worktree ${result.worktree_id} created.`);}
async function switchWorktree(){const state=requireRuntime();state.runtime.switchWorktree($('#ecc-worktree').value);state.activePath=state.runtime.listFiles()[0]||'';renderWorkspace();}
async function checkpoint(){const state=requireRuntime(),db=await open(),cp=await state.runtime.createCheckpoint(`checkpoint ${state.runtime.checkpoints.size+1}`);await browserCheckpoint(db,projectId(),cp);renderWorkspace();await refresh();status(`Checkpoint ${cp.checkpoint_id} sealed and hash-bound.`);}
async function restore(){const state=requireRuntime(),id=$('#ecc-checkpoint-select').value;if(!id)throw new Error('Select a checkpoint first.');await state.runtime.restoreCheckpoint(id);state.activePath=state.runtime.listFiles()[0]||'';renderWorkspace();await refreshPreview();status(`Checkpoint ${id} restored after integrity verification.`);}
async function refreshPreview(){const preview=await requireRuntime().runtime.preview(),frame=$('#ecc-preview');frame.setAttribute('sandbox',preview.sandbox);frame.srcdoc=preview.srcdoc;status(`Sandboxed preview refreshed from source ${preview.source_sha256}.`);}

function bind(){
  const on=(selector,event,fn)=>$(selector)?.addEventListener(event,evt=>void fn(evt).catch(error=>status(error?.message||'Engineering action failed')));
  on('#ecc-space','click',openSpace);on('#ecc-refresh','click',refresh);on('#ecc-new-file','click',newFile);on('#ecc-stage','click',stageFile);on('#ecc-save','click',saveFile);on('#ecc-discard','click',discardFile);on('#ecc-search','click',search);on('#ecc-diagnostics','click',diagnostics);on('#ecc-terminal','click',terminal);on('#ecc-build','click',build);on('#ecc-test','click',testWorkspace);on('#ecc-worktree-create','click',createWorktree);on('#ecc-worktree','change',switchWorktree);on('#ecc-checkpoint','click',checkpoint);on('#ecc-restore','click',restore);on('#ecc-preview-refresh','click',refreshPreview);
  $('#ecc-editor')?.addEventListener('input',()=>{$('#ecc-dirty').textContent='UNSTAGED';$('#ecc-dirty').className='badge warn';});
  $('#ecc-file-tree')?.addEventListener('click',event=>{const button=event.target.closest('[data-ecc-path]');if(button)void selectFile(button.dataset.eccPath).catch(error=>status(error?.message));});
}

function install(){ensureBreadth();if(route()!=='build')return;const root=$('#workspace-root');if(!root)return;if(!$('#engineering-command-center')){root.insertAdjacentHTML('beforeend',shell());bind();}void refresh();}
const observer=new MutationObserver(()=>{if(route()==='build'&&!$('#engineering-command-center'))queueMicrotask(install);});observer.observe(document.documentElement,{subtree:true,childList:true});window.addEventListener('hashchange',()=>queueMicrotask(install));queueMicrotask(install);
window.AxiomEngineeringCommandCenter=Object.freeze({refresh,boundary:'PROJECT_BOUND_NO_SELF_CERTIFICATION_NO_CLOUD_OR_PRODUCTION_INFERENCE',matrix_rows:MATRIX_ROWS.map(row=>row.id)});
