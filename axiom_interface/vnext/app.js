import {initBrowserSession} from "../browser_session.js";
import {ATOMIC_OPERATIONS, ARCHETYPES, DERIVED_CAPABILITY_COUNT, routeCapability, capabilityFamilies} from "./capability_registry.js";
import {VNextDataAdapter, VNEXT_DATA_BOUNDARY} from "./data_adapters.js";

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const clean=(value,limit=300)=>String(value??"").replace(/[\u0000-\u001f\u007f]/g,"").trim().slice(0,limit);

const routeMeta={
  home:["Home","State an objective. AXIOM turns it into governed work, artifacts and evidence."],
  projects:["Projects","Persistent intelligence graphs for goals, sources, work, artifacts, agents, memory and evidence."],
  work:["Work","Outcome Contracts: objectives, acceptance criteria, plans, agents, approvals, progress and verification."],
  agents:["Agents","Persistent or ephemeral execution identities with explicit scope, authority, budget and control."],
  artifacts:["Artifacts","Documents, sheets, presentations, reports, dashboards, apps, datasets and other first-class outputs."],
  research:["Research","Claim-native research with sources, contradictions, exact provenance and freshness."],
  analyze:["Analyze","Intent-led quantitative analysis backed by AXIOM's certified 74-operation compute registry."],
  build:["Build","Governed software delivery: plan, implement, run, inspect, test, repair, verify and deploy."],
  create:["Create","Universal artifact canvas with versions, sources, comments, dependencies and evidence."],
  live:["Live","Permissioned voice, camera and screen work with truthful modality boundaries."],
  computer:["Computer","Visible browser/computer execution with previews, approvals, receipts and takeover."],
  automations:["Automations","Triggered Outcome Contracts with budgets, policies and material-change notification."],
  developer:["Developer","API, MCP, A2A, capabilities, traces, usage, policies and evaluation."],
  trust:["Trust","Security, privacy, qualification, accessibility and claim-authorization status."],
  settings:["Settings","Identity, privacy, memory, notifications, accessibility and application preferences."]
};

const state={
  inspector:true,
  inspectorTab:"context",
  activity:[],
  controls:{autonomy:"Policy-bounded",privacy:"Private",evidence:"Verified",budget:""},
  lastRoutePreview:null,
  lastObjective:"",
  selectedCommand:0,
  data:null,
  dataReady:false,
  dataError:null,
  projects:[],
  work:[],
  activeProjectId:localStorage.getItem("axiom.vnext.active-project") || ""
};

function activeProject(){
  return state.projects.find(p=>p.project_id===state.activeProjectId) || null;
}
function setActiveProject(projectId){
  state.activeProjectId=projectId || "";
  try{
    if(state.activeProjectId)localStorage.setItem("axiom.vnext.active-project",state.activeProjectId);
    else localStorage.removeItem("axiom.vnext.active-project");
  }catch{}
  const project=activeProject();
  $("#active-project-name").textContent=project?.name || "No project selected";
}
async function refreshData({rerender=true}={}){
  if(!state.data)return;
  state.projects=await state.data.listProjects();
  if(state.activeProjectId && !state.projects.some(p=>p.project_id===state.activeProjectId)) state.activeProjectId="";
  if(!state.activeProjectId && state.projects[0]) state.activeProjectId=state.projects[0].project_id;
  setActiveProject(state.activeProjectId);
  state.work=state.activeProjectId ? await state.data.listWork(state.activeProjectId) : [];
  if(rerender){renderRoute();renderInspector();}
}
async function bootstrapData(){
  try{
    state.data=await VNextDataAdapter.open();
    state.dataReady=true;
    await refreshData({rerender:false});
    event("data.ready",{persistence:VNEXT_DATA_BOUNDARY.projectPersistence,projects:state.projects.length});
    renderRoute();renderInspector();
  }catch(error){
    state.dataError=clean(error?.message||"Browser-local data unavailable",220);
    event("data.error",{message:state.dataError});
    renderRoute();renderInspector();
  }
}

function event(type,detail={}){
  state.activity.unshift({type,at:new Date().toISOString(),detail});
  state.activity=state.activity.slice(0,40);
  if(state.inspectorTab==="activity") renderInspector();
}

function nav(route){
  location.hash=`#/${route}`;
}
function currentRoute(){
  return (location.hash.match(/^#\/([^/?#]+)/)||[])[1]||"home";
}
function setActiveNav(route){
  $$('[data-route]').forEach(a=>{
    const active=a.dataset.route===route;
    if(active)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");
  });
}
function pageHead(route,actions=""){
  const [title,desc]=routeMeta[route]||[route,""];
  return `<header class="page-head"><div><small class="eyebrow">MUSITU AXIOM</small><h1>${esc(title)}</h1><p>${esc(desc)}</p></div>${actions}</header>`;
}
function badge(text,type=""){return `<span class="badge ${type}">${esc(text)}</span>`;}

function renderHome(){
  const projects=state.projects.slice(0,3);
  const work=state.work.slice(0,3);
  const dataNote=state.dataError
    ? `<div class="card"><h3>Browser-local workspace unavailable</h3><p>${esc(state.dataError)}</p></div>`
    : !state.dataReady
      ? `<div class="card"><h3>Loading workspace…</h3><p>Opening the earned browser-local Project and Outcome Contract stores.</p></div>`
      : "";
  return `
    <section class="hero-home">
      <h1>What do you want accomplished?</h1>
      <p>Ask a question, analyze something, build software, research a decision, create an artifact or delegate multi-step work.</p>
      <form id="hero-form" class="hero-prompt">
        <label class="sr-only" for="hero-input">Describe an outcome</label>
        <textarea id="hero-input" placeholder="Describe the outcome you want…"></textarea>
        <button class="execute-button" type="submit">Execute →</button>
        <div class="quick-tools">
          <button type="button" data-quick="files">＋ Files</button>
          <button type="button" data-quick="data">▦ Data</button>
          <button type="button" data-quick="camera">▣ Camera</button>
          <button type="button" data-quick="screen">▤ Screen</button>
          <button type="button" data-quick="research">⌕ Research</button>
        </div>
      </form>
    </section>
    ${dataNote}
    <section class="section">
      <div class="section-head"><h2>Continue</h2><button class="button ghost" data-goto="work">View work</button></div>
      ${work.length?`<div class="card-grid">${work.map(w=>`<article class="card"><div class="card-top"><div><h3>${esc(w.title)}</h3><p>${esc(w.outcome)}</p></div>${badge(w.approval?"Approved":"Draft",w.approval?"ok":"")}</div><small class="muted">${w.integrity_verified?"Integrity verified":"Verification pending"} · preview-only execution boundary</small></article>`).join("")}</div>`:`<div class="card"><h3>No active work yet</h3><p>${state.activeProjectId?"Create an Outcome Contract for the selected project.":"Create or select a project to begin governed work."}</p></div>`}
    </section>
    <section class="section">
      <div class="section-head"><h2>Projects</h2><button class="button ghost" data-goto="projects">Open projects</button></div>
      ${projects.length?`<div class="card-grid">${projects.map(p=>`<article class="card"><div class="card-top"><div><h3>${esc(p.name)}</h3><p>${esc(p.goal||"No goal set")}</p></div>${badge(p.event_chain_verified?"Verified chain":"Chain check",p.event_chain_verified?"ok":"warn")}</div><small class="muted">${p.object_count} linked objects · ${p.contract_count} work contracts · browser-local</small></article>`).join("")}</div>`:`<div class="card"><h3>No projects yet</h3><p>Your first project becomes a persistent browser-local intelligence graph with provenance-linked objects and events.</p></div>`}
    </section>`;
}

function renderProjects(){
  const rows=state.projects;
  const objectCount=rows.reduce((n,p)=>n+(p.object_count||0),0);
  const workCount=rows.reduce((n,p)=>n+(p.contract_count||0),0);
  const verified=rows.filter(p=>p.event_chain_verified).length;
  return `${pageHead("projects",'<button class="button primary" type="button" data-action="new-project">New project</button>')}
    <div class="metric-grid">
      <div class="metric"><strong>${rows.length}</strong><span>Browser-local projects</span></div>
      <div class="metric"><strong>${objectCount}</strong><span>Linked graph objects</span></div>
      <div class="metric"><strong>${workCount}</strong><span>Outcome Contracts</span></div>
      <div class="metric"><strong>${verified}/${rows.length||0}</strong><span>Event chains verified</span></div>
    </div>
    <section class="section list">
      ${rows.length?rows.map(p=>`<button class="list-row" type="button" data-project="${esc(p.project_id)}"><span><strong>${esc(p.name)}</strong><small>${esc(p.goal||"No goal set")} · ${esc(p.memory_scope)}</small></span>${badge(p.project_id===state.activeProjectId?"Selected":p.event_chain_verified?"Verified":"Inspect",p.project_id===state.activeProjectId||p.event_chain_verified?"ok":"")}</button>`).join(""):`<div class="card"><h3>No project graph exists yet</h3><p>Create one here. This uses the earned Phase 2 IndexedDB ProjectStore and does not claim cloud or multi-device sync.</p></div>`}
    </section>`;
}

function renderWork(){
  const project=activeProject();
  const rows=state.work;
  const actions=project?'<button class="button primary" type="button" data-action="new-work">New work</button>':'<button class="button" type="button" data-goto="projects">Choose project</button>';
  return `${pageHead("work",actions)}
    ${project?`<div class="card" style="margin-bottom:14px"><small class="eyebrow">Active project</small><h3>${esc(project.name)}</h3><p>${esc(project.goal||"No goal set")}</p><small class="muted">Browser-local ProjectStore · ${project.event_chain_verified?"event chain verified":"event chain not verified"}</small></div>`:""}
    ${project?`<div class="list">${rows.length?rows.map(row=>`<article class="list-row" data-contract="${esc(row.contract_id)}"><span><strong>${esc(row.title)}</strong><small>${esc(row.outcome)} · ${row.success_criteria.length} success criteria · ${row.integrity_verified?"integrity verified":"integrity pending"}</small></span><span style="display:flex;gap:6px;align-items:center">${badge(row.approval?"Approved":"Draft",row.approval?"ok":"")}<button class="button" type="button" data-verify-work="${esc(row.contract_id)}">Verify</button>${row.approval?"":`<button class="button" type="button" data-approve-work="${esc(row.contract_id)}">Approve</button>`}</span></article>`).join(""):`<div class="card"><h3>No Outcome Contracts yet</h3><p>Create one to define the outcome, success criteria, constraints and approval boundary before execution.</p></div>`}</div>`:`<div class="card"><h3>Select a project first</h3><p>Work is always bound to a project graph. Create or select a project before creating an Outcome Contract.</p></div>`}
    <section class="section"><div class="card"><small class="eyebrow">Execution boundary</small><h3>Preview-only until a qualified executor is connected</h3><p>Approval records policy intent and an evidence-linked decision receipt. It does not execute a consequential external action.</p></div></section>`;
}

function renderAgents(){
  const templates=[
    {name:"Planner",purpose:"Decomposes objectives into governed work",scope:"Project read · plan create"},
    {name:"Quant specialist",purpose:"Routes certified quantitative workflows",scope:"Compute-only"},
    {name:"Verifier",purpose:"Challenges outputs and checks evidence",scope:"Read · verify"},
    {name:"Builder",purpose:"Implements and tests software changes",scope:"No public deployment without approval"}
  ];
  return `${pageHead("agents",'<button class="button primary" type="button" data-action="new-agent">Create agent</button>')}
    <div class="card" style="margin-bottom:14px"><small class="eyebrow">Foundation boundary</small><h3>Agent runtime adapter not connected yet</h3><p>These are role templates for the vNext control surface, not claims that autonomous agents are currently running here.</p></div>
    <div class="card-grid">${templates.map(a=>`<article class="card"><div class="card-top"><div><h3>${esc(a.name)}</h3><p>${esc(a.purpose)}</p></div>${badge("Template")}</div><small class="muted">${esc(a.scope)}</small></article>`).join("")}</div>`;
}
function renderArtifacts(){
  return `${pageHead("artifacts",'<button class="button primary" type="button" data-action="new-artifact">Create artifact</button>')}
    <div class="surface-tabs">${["All","Documents","Sheets","Presentations","Apps","Reports","Datasets"].map((x,i)=>`<button class="${i===0?"active":""}" type="button">${x}</button>`).join("")}</div>
    <div class="card-grid">
      <article class="card"><h3>Final application architecture</h3><p>Audit-grounded product architecture. Versioned design authority candidate.</p></article>
      <article class="card"><h3>2,400 native capability catalog</h3><p>Derived workflow registry. Compute-only, not separate atomic certification.</p></article>
      <article class="card"><h3>Full Phase 0–15 audit</h3><p>Current truth boundaries, earned phases and qualification gaps.</p></article>
    </div>`;
}
function renderResearch(){
  return `${pageHead("research")}
    <div class="work-layout">
      <article class="card"><small class="eyebrow">Report</small><h3>Research workspace</h3><p>Claims, source bindings, contradiction preservation, lineage and freshness belong in the primary research canvas.</p>
        <div class="section"><div class="list">
          <div class="list-row"><span><strong>Material claim</strong><small>Exact source span and freshness state</small></span>${badge("Verified","ok")}</div>
          <div class="list-row"><span><strong>Contradicting evidence</strong><small>Dissent is preserved rather than silently collapsed</small></span>${badge("Open","warn")}</div>
        </div></div>
      </article>
      <aside class="card"><small class="eyebrow">Evidence map</small><h3>Source quality</h3><p>Retrieved content remains data-only and cannot elevate its own instruction authority.</p></aside>
    </div>`;
}
function renderAnalyze(){
  const families=capabilityFamilies();
  return `${pageHead("analyze")}
    <div class="metric-grid">
      <div class="metric"><strong>${ATOMIC_OPERATIONS.length}</strong><span>Certified atomic operations</span></div>
      <div class="metric"><strong>${DERIVED_CAPABILITY_COUNT.toLocaleString()}</strong><span>Derived native compositions</span></div>
      <div class="metric"><strong>${ARCHETYPES.length}</strong><span>Workflow archetypes</span></div>
      <div class="metric"><strong>Compute-only</strong><span>Derived side-effect class</span></div>
    </div>
    <section class="section">
      <div class="section-head"><h2>Capability families</h2><span class="muted">Advanced view</span></div>
      <div class="card-grid">${families.map(f=>`<article class="card"><div class="card-top"><h3>${esc(f.family)}</h3>${badge(String(f.count))}</div><p>${ATOMIC_OPERATIONS.filter(op=>op.startsWith(f.family+".")).slice(0,4).map(esc).join(" · ")}</p></article>`).join("")}</div>
    </section>`;
}
function renderBuild(){
  return `${pageHead("build",'<button class="button primary" type="button" data-action="new-build">New build</button>')}
    <div class="work-layout">
      <article class="card">
        <div class="surface-tabs">${["Files","Agent","Diff","Preview"].map((x,i)=>`<button class="${i===1?"active":""}" type="button">${x}</button>`).join("")}</div>
        <small class="eyebrow">AXIOM builds AXIOM</small><h3>vNext application implementation</h3>
        <p>This isolated branch is the first target for the future sealed app-building acceptance challenge.</p>
        <div class="step-list">
          ${["SPEC","PLAN","IMPLEMENT","RUN","INSPECT","TEST","ATTACK","REPAIR","VERIFY","DEPLOY","SMOKE","RECEIPT"].map((x,i)=>`<div class="step" data-state="${i<3?"done":i===3?"running":"todo"}"><span class="step-state">${i<3?"✓":i+1}</span><div><strong>${x}</strong><small>${i===3?"Pending real runtime integration":"Governed build stage"}</small></div></div>`).join("")}
        </div>
      </article>
      <aside class="card"><small class="eyebrow">Live preview</small><h3>Self-hosted application preview</h3><p>No public deployment is performed by this foundation shell. The existing browser application remains untouched.</p></aside>
    </div>`;
}
function renderCreate(){return `${pageHead("create")}<div class="card"><small class="eyebrow">Universal Artifact Canvas</small><h3>One canvas, typed renderers</h3><p>Documents, sheets, presentations, reports, dashboards, apps, datasets, diagrams, media and simulations share versioning, provenance, dependencies and rollback.</p></div>`}
function renderLive(){return `${pageHead("live")}<div class="card"><h3>Focused live workspace</h3><p>Voice, camera and screen capture are presented with explicit permission and modality boundaries. General vision is never implied where only scoped OCR/text/QR evidence exists.</p></div>`}
function renderComputer(){return `${pageHead("computer")}<div class="card"><h3>Visible controlled execution</h3><p>Consequential actions follow preview → approval → action → receipt → rollback when possible. Prompt-injection warnings remain first-class.</p></div>`}
function renderAutomations(){return `${pageHead("automations",'<button class="button primary" type="button" data-action="new-automation">New automation</button>')}<div class="card"><h3>Triggered Outcome Contracts</h3><p>Schedules, events and conditions can launch bounded work with budget, authority, notification and evidence policies.</p></div>`}
function renderDeveloper(){
  return `${pageHead("developer")}
    <div class="surface-tabs">${["Overview","Playground","Capabilities","API","MCP","A2A","Agents","Webhooks","Usage","Traces","Evaluation"].map((x,i)=>`<button class="${i===0?"active":""}" type="button">${x}</button>`).join("")}</div>
    <div class="card-grid">
      <article class="card"><h3>Certified compute registry</h3><p>74 atomic operations with qualification and schemas.</p></article>
      <article class="card"><h3>Derived workflow registry</h3><p>2,400 native compositions generated from certified operations.</p></article>
      <article class="card"><h3>Frontier capability registry</h3><p>Projects, Work, Research, Artifacts, Agents, Memory, Computer, Live, Evidence and governance remain separately qualified.</p></article>
    </div>`;
}
function renderTrust(){
  return `${pageHead("trust")}
    <div class="list">
      <div class="list-row"><span><strong>Phase 12 · Developer platform</strong><small>Implementation + seal authority recorded</small></span>${badge("EARNED","ok")}</div>
      <div class="list-row"><span><strong>Phase 13 · Independent review</strong><small>Required external review not completed</small></span>${badge("NOT EARNED","block")}</div>
      <div class="list-row"><span><strong>Phase 14 · Real-device hardening</strong><small>Real-phone subset evidenced; physical tablet scenario missing</small></span>${badge("INCOMPLETE","warn")}</div>
      <div class="list-row"><span><strong>Phase 15 · Frontier comparison</strong><small>Authenticated independent external evidence not verified</small></span>${badge("CLAIM BLOCKED","block")}</div>
      <div class="list-row"><span><strong>Global superiority</strong><small>No world-best claim is authorized by current evidence</small></span>${badge("NOT VERIFIED","block")}</div>
    </div>`;
}
function renderSettings(){
  return `${pageHead("settings")}
    <div class="card-grid">
      <article class="card"><h3>Appearance</h3><p>System theme by default. High-contrast and reduced-motion behavior remain design requirements.</p><p style="margin-top:12px"><button class="button" type="button" data-action="toggle-theme">Toggle light/dark</button></p></article>
      <article class="card"><h3>Execution controls</h3><p>${esc(state.controls.autonomy)} · ${esc(state.controls.privacy)} · ${esc(state.controls.evidence)}</p><p style="margin-top:12px"><button class="button" type="button" data-action="open-controls">Edit controls</button></p></article>
    </div>`;
}

const renderers={home:renderHome,projects:renderProjects,work:renderWork,agents:renderAgents,artifacts:renderArtifacts,research:renderResearch,analyze:renderAnalyze,build:renderBuild,create:renderCreate,live:renderLive,computer:renderComputer,automations:renderAutomations,developer:renderDeveloper,trust:renderTrust,settings:renderSettings};

function renderRoute(){
  const route=currentRoute();
  const renderer=renderers[route]||renderHome;
  setActiveNav(route);
  $("#workspace-root").innerHTML=renderer();
  bindPageEvents();
  renderInspector();
  $("#workspace").scrollTop=0;
  event("route.change",{route});
}

function renderInspector(){
  const route=currentRoute();
  $("#inspector-title").textContent=state.inspectorTab[0].toUpperCase()+state.inspectorTab.slice(1);
  const body=$("#inspector-body");
  if(state.inspectorTab==="activity"){
    body.innerHTML=state.activity.length?`<div class="evidence-list">${state.activity.map(e=>`<div class="evidence-item"><strong>${esc(e.type)}</strong><span>${esc(new Date(e.at).toLocaleTimeString())} · ${esc(JSON.stringify(e.detail))}</span></div>`).join("")}</div>`:`<p class="muted">No local activity yet.</p>`;
    return;
  }
  if(state.inspectorTab==="evidence"){
    body.innerHTML=`<div class="evidence-list">
      <div class="evidence-item"><strong>vNext authority</strong><span>Isolated implementation branch. Not production promotion authority.</span></div>
      <div class="evidence-item"><strong>Compute registry</strong><span>74 certified atomic operations.</span></div>
      <div class="evidence-item"><strong>Derived registry</strong><span>${DERIVED_CAPABILITY_COUNT.toLocaleString()} local routing compositions; not separate atomic certification.</span></div>
      <div class="evidence-item"><strong>Claim boundary</strong><span>Global superiority remains unverified.</span></div>
    </div>`;
    return;
  }
  const routeInfo=routeMeta[route]||routeMeta.home;
  const chain=state.lastRoutePreview?.atomic_operations||[];
  body.innerHTML=`<p><strong>${esc(routeInfo[0])}</strong></p><p class="muted">${esc(routeInfo[1])}</p>
    ${state.lastRoutePreview?`<hr style="border:0;border-top:1px solid var(--line);margin:16px 0"><small class="eyebrow">Last capability route</small><p><strong>${esc(state.lastRoutePreview.category)}</strong><br><span class="muted">${esc(state.lastRoutePreview.intent)} · preview only</span></p><div class="capability-chain">${chain.map(op=>`<code>${esc(op)}</code>`).join("")}</div>`:""}`;
}

function presentPlan(text){
  state.lastObjective=clean(text,500);
  const plan=routeCapability(text);
  state.lastRoutePreview=plan;
  const safe=clean(text,500);
  const node=document.createElement("section");
  node.className="plan-preview";
  node.innerHTML=`<header><div><small class="eyebrow">Routing preview</small><h2></h2><p class="muted">AXIOM has classified this objective locally. No external action was executed.</p></div>${badge("PREVIEW ONLY","warn")}</header>
    <div class="route-meta"><div><strong>Category</strong>${esc(plan.category)}</div><div><strong>Intent</strong>${esc(plan.intent)}</div><div><strong>Side effect</strong>${esc(plan.side_effect_class)}</div></div>
    <small class="eyebrow">Native capability chain</small><div class="capability-chain">${plan.atomic_operations.map(op=>`<code>${esc(op)}</code>`).join("")}</div>
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap"><button class="button primary" type="button" data-action="open-work">Create Work preview</button><button class="button" type="button" data-action="inspect-plan">Inspect route</button></div>`;
  $("h2",node).textContent=safe;
  $("#workspace-root").prepend(node);
  state.inspector=true;$("#inspector").classList.add("open");
  renderInspector();
  event("capability.route-preview",{archetype:plan.archetype,intent:plan.intent});
}

function handleSubmit(textSource){
  const input=$(textSource);
  const text=input?.value?.trim();
  if(!text){input?.focus();input?.setAttribute("aria-invalid","true");return}
  input.removeAttribute("aria-invalid");
  if(currentRoute()!=="home") nav("home");
  setTimeout(()=>presentPlan(text),0);
}

function openProjectDialog(){
  const dialog=$("#project-dialog");
  $("#project-form").reset();
  $("#project-memory-scope").value="project-only";
  $("#project-form-error").hidden=true;
  dialog.showModal();
  setTimeout(()=>$("#project-name").focus(),0);
}

function openWorkDialog(){
  if(!state.activeProjectId){nav("projects");return;}
  const dialog=$("#work-dialog");
  $("#work-form").reset();
  $("#work-privacy").value="Project";
  $("#work-evidence").value="Standard";
  $("#work-autonomy").value="Preview only";
  $("#work-approval").value="Before consequential action";
  $("#work-form-error").hidden=true;
  if(state.lastObjective){
    $("#work-title").value=state.lastObjective.slice(0,120);
    $("#work-outcome").value=state.lastObjective;
    if(state.lastRoutePreview?.atomic_operations?.length){
      $("#work-success").value=[
        "Produce the requested outcome",
        "Use only qualified capabilities for the selected route",
        "Preserve an inspectable native capability chain",
        "Verify the result before completion"
      ].join("\n");
    }
  }
  dialog.showModal();
  setTimeout(()=>$("#work-title").focus(),0);
}

async function submitProjectForm(eventObject){
  eventObject.preventDefault();
  if(!state.data)return;
  const error=$("#project-form-error");
  error.hidden=true;
  try{
    const project=await state.data.createProject({
      name:$("#project-name").value,
      goal:$("#project-goal").value,
      memoryScope:$("#project-memory-scope").value
    });
    state.activeProjectId=project.project_id;
    $("#project-dialog").close();
    event("project.created",{project_id:project.project_id});
    await refreshData();
  }catch(err){
    error.textContent=clean(err?.message||"Project could not be created",220);
    error.hidden=false;
  }
}

async function submitWorkForm(eventObject){
  eventObject.preventDefault();
  if(!state.data||!state.activeProjectId)return;
  const error=$("#work-form-error");
  error.hidden=true;
  try{
    const row=await state.data.createWork(state.activeProjectId,{
      title:$("#work-title").value,
      outcome:$("#work-outcome").value,
      successCriteria:$("#work-success").value,
      privacy:$("#work-privacy").value,
      evidence:$("#work-evidence").value,
      autonomy:$("#work-autonomy").value,
      approval:$("#work-approval").value,
      deadline:$("#work-deadline").value,
      computeBudget:$("#work-budget").value
    });
    $("#work-dialog").close();
    event("work.created",{contract_id:row.contract_id});
    await refreshData();
    nav("work");
  }catch(err){
    error.textContent=clean(err?.message||"Outcome Contract could not be created",260);
    error.hidden=false;
  }
}

async function verifyWork(contractId){
  try{
    const ok=await state.data?.verifyWork(contractId);
    event("work.verify",{contract_id:contractId,state:ok?"verified":"invalid"});
    await refreshData();
  }catch(err){event("work.verify-error",{contract_id:contractId,message:clean(err?.message,180)})}
}

async function approveWork(contractId){
  try{
    await state.data?.approveWork(contractId);
    event("work.approve",{contract_id:contractId,state:"receipt-recorded"});
    await refreshData();
  }catch(err){event("work.approve-error",{contract_id:contractId,message:clean(err?.message,180)})}
}

function bindPageEvents(){
  $("#hero-form")?.addEventListener("submit",e=>{e.preventDefault();handleSubmit("#hero-input")});
  $$('[data-goto]').forEach(b=>b.addEventListener("click",()=>nav(b.dataset.goto)));
  $$('[data-project]').forEach(b=>b.addEventListener("click",async()=>{
    setActiveProject(b.dataset.project);
    state.work=state.data?await state.data.listWork(state.activeProjectId):[];
    event("project.select",{project_id:b.dataset.project});
    renderRoute();
  }));
  $$('[data-action]').forEach(b=>b.addEventListener("click",()=>{
    const action=b.dataset.action;
    if(action==="open-controls")$("#control-dialog").showModal();
    else if(action==="toggle-theme")toggleTheme();
    else if(action==="open-work")openWorkDialog();
    else if(action==="new-project")openProjectDialog();
    else if(action==="new-work")openWorkDialog();
    else if(action==="inspect-plan"){state.inspectorTab="context";renderInspector();}
    else event("ui.preview-action",{action});
  }));
  $$('[data-verify-work]').forEach(b=>b.addEventListener("click",()=>void verifyWork(b.dataset.verifyWork)));
  $$('[data-approve-work]').forEach(b=>b.addEventListener("click",()=>void approveWork(b.dataset.approveWork)));
  $$('[data-quick]').forEach(b=>b.addEventListener("click",()=>event("composer.quick-input",{type:b.dataset.quick})));
}

function resizeComposer(){
  const el=$("#composer-input");
  el.style.height="auto";
  el.style.height=`${Math.min(el.scrollHeight,140)}px`;
}
function applyControls(){
  state.controls={
    autonomy:$("#control-autonomy").value,
    privacy:$("#control-privacy").value,
    evidence:$("#control-evidence").value,
    budget:$("#control-budget").value
  };
  $("#control-chip").textContent=`${state.controls.autonomy} · ${state.controls.privacy} · ${state.controls.evidence}`;
  $("#control-dialog").close();
  event("controls.update",{autonomy:state.controls.autonomy,privacy:state.controls.privacy,evidence:state.controls.evidence});
}
function toggleInspector(){
  state.inspector=!state.inspector;
  $("#inspector").classList.toggle("open",state.inspector);
  $("#inspector-toggle").setAttribute("aria-expanded",String(state.inspector));
}
function toggleTheme(){
  const current=document.documentElement.dataset.theme||"system";
  document.documentElement.dataset.theme=current==="dark"?"light":"dark";
  event("theme.change",{theme:document.documentElement.dataset.theme});
}

const commands=[
  ["Home","home","Go to objective-first home"],
  ["Projects","projects","Open persistent project graphs"],
  ["Work","work","Open Outcome Contracts"],
  ["Agents","agents","Open governed agent society"],
  ["Artifacts","artifacts","Open artifact library"],
  ["Research","research","Open claim-native research"],
  ["Analyze","analyze","Open certified quantitative core"],
  ["Build","build","Open software build studio"],
  ["Create","create","Open universal artifact canvas"],
  ["Live","live","Open multimodal live workspace"],
  ["Computer","computer","Open controlled browser/computer execution"],
  ["Automations","automations","Open triggered work"],
  ["Developer","developer","Open APIs, MCP, traces and evaluation"],
  ["Trust","trust","Open qualification and claim boundaries"],
  ["Settings","settings","Open preferences"]
];
function renderCommands(query=""){
  const q=clean(query,100).toLowerCase();
  const filtered=commands.filter(([name,,desc])=>!q||name.toLowerCase().includes(q)||desc.toLowerCase().includes(q));
  state.selectedCommand=Math.min(state.selectedCommand,Math.max(0,filtered.length-1));
  $("#command-results").innerHTML=filtered.map(([name,route,desc],i)=>`<button class="command-result ${i===state.selectedCommand?"selected":""}" type="button" data-command-route="${route}" role="option" aria-selected="${i===state.selectedCommand}"><span><strong>${esc(name)}</strong><small>${esc(desc)}</small></span><span>↵</span></button>`).join("")||`<p class="muted" style="padding:12px">No matching command.</p>`;
  $$('[data-command-route]').forEach(b=>b.addEventListener("click",()=>{nav(b.dataset.commandRoute);$("#command-dialog").close();}));
  return filtered;
}
function openCommand(){
  state.selectedCommand=0;
  renderCommands("");
  $("#command-dialog").showModal();
  setTimeout(()=>$("#command-input").focus(),0);
}

function updateNetwork(){
  const online=navigator.onLine;
  $("#connection-state").dataset.state=online?"online":"offline";
  $("#connection-state span").textContent=online?"Online":"Offline";
  $("#network-banner").hidden=online;
  $("#network-banner").textContent=online?"":"Offline · local vNext shell and planning preview remain available.";
}

function installGlobalEvents(){
  window.addEventListener("hashchange",renderRoute);
  window.addEventListener("online",updateNetwork);
  window.addEventListener("offline",updateNetwork);
  $("#inspector-toggle").addEventListener("click",toggleInspector);
  $("#inspector-close").addEventListener("click",toggleInspector);
  $$('[data-inspector-tab]').forEach(tab=>tab.addEventListener("click",()=>{
    state.inspectorTab=tab.dataset.inspectorTab;
    $$('[data-inspector-tab]').forEach(t=>t.setAttribute("aria-selected",String(t===tab)));
    renderInspector();
  }));
  $("#composer").addEventListener("submit",e=>{e.preventDefault();handleSubmit("#composer-input")});
  $("#composer-input").addEventListener("input",resizeComposer);
  $("#composer-add").addEventListener("click",()=>event("composer.add",{state:"preview-only"}));
  $("#composer-voice").addEventListener("click",()=>event("composer.voice",{state:"preview-only"}));
  $("#control-chip").addEventListener("click",()=>$("#control-dialog").showModal());
  $('[data-close-control]').addEventListener("click",()=>$("#control-dialog").close());
  $('[data-save-control]').addEventListener("click",applyControls);
  $("#command-trigger").addEventListener("click",openCommand);
  $("#project-switcher").addEventListener("click",()=>nav("projects"));
  $("#project-form").addEventListener("submit",e=>void submitProjectForm(e));
  $("#work-form").addEventListener("submit",e=>void submitWorkForm(e));
  $$('[data-close-project]').forEach(b=>b.addEventListener("click",()=>$("#project-dialog").close()));
  $$('[data-close-work]').forEach(b=>b.addEventListener("click",()=>$("#work-dialog").close()));
  $("#command-input").addEventListener("input",e=>{state.selectedCommand=0;renderCommands(e.target.value)});
  $("#command-input").addEventListener("keydown",e=>{
    const filtered=renderCommands(e.currentTarget.value);
    if(e.key==="ArrowDown"){e.preventDefault();state.selectedCommand=Math.min(filtered.length-1,state.selectedCommand+1);renderCommands(e.currentTarget.value)}
    if(e.key==="ArrowUp"){e.preventDefault();state.selectedCommand=Math.max(0,state.selectedCommand-1);renderCommands(e.currentTarget.value)}
    if(e.key==="Enter"&&filtered[state.selectedCommand]){e.preventDefault();nav(filtered[state.selectedCommand][1]);$("#command-dialog").close()}
  });
  document.addEventListener("keydown",e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openCommand()}
    if(e.key==="Escape"&&matchMedia("(max-width:860px)").matches&&state.inspector)toggleInspector();
  });
}

installGlobalEvents();
updateNetwork();
renderRoute();
initBrowserSession({emit:(type,detail)=>event(type,detail)});
event("vnext.ready",{atomic_operations:ATOMIC_OPERATIONS.length,derived_capabilities:DERIVED_CAPABILITY_COUNT});
void bootstrapData();
