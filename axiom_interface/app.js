const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const safeText = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 500);
const routeCopy = {
  home:['Home','State your outcome. Axiom prepares inspectable work before consequential action.'],
  projects:['Projects','Persistent goals, sources, artifacts, runs, memories and decisions will converge here.'],
  work:['Work','Outcome Contracts and checkpointed execution will live in this surface.'],
  research:['Research','Claim-native investigation will connect statements to evidence and provenance.'],
  create:['Create','Artifacts are first-class, editable, versioned and reversible objects.'],
  code:['Code','Code work stays inspectable, sandboxed and policy-bounded.'],
  live:['Live','Multimodal live work will preserve privacy, interruption and explicit action boundaries.'],
  agents:['Agents','Agents expose roles, scopes, tools, policy and dissent rather than hidden reasoning.'],
  evidence:['Evidence','Claims, attestations, evaluations and receipts remain linked to provenance.'],
  observability:['Observability','Operational traces expose runs, tools, policy, latency, errors and recovery—not private chain-of-thought.'],
  developer:['Developer','API, MCP, A2A, SDK, webhooks, usage and traces converge here.'],
  settings:['Settings','Control identity, privacy, memory, accessibility, notifications and policy preferences.']
};
const state = { verb:'Ask', theme:localStorage.getItem('axiom.ui.theme') || 'system', trace:[], proofOpen:false };

function newId(prefix='evt') { return `${prefix}_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`; }
function emit(type, detail={}) {
  const event = { id:newId(), at:new Date().toISOString(), type:safeText(type), route:location.hash || '#/home', detail:{} };
  // Operational metadata is allow-listed. Never record composer text, credentials or private reasoning.
  for (const key of ['control','state','error_id','component','retry_state','progress','verb','theme']) if (key in detail) event.detail[key]=safeText(detail[key]);
  state.trace.unshift(event); state.trace = state.trace.slice(0, 24); renderTrace(); return event.id;
}
function renderTrace() {
  const list=$('#trace-list'); if(!list) return; list.replaceChildren();
  for(const event of state.trace){ const li=document.createElement('li'); const time=document.createElement('time'); time.dateTime=event.at; time.textContent=new Date(event.at).toLocaleTimeString(); const body=document.createElement('span'); body.textContent=`${event.type} · ${Object.entries(event.detail).map(([k,v])=>`${k}=${v}`).join(' · ') || 'operational'}`; li.append(time,body); list.append(li); }
}
function setRoute(route){ const [title,description]=routeCopy[route] || [route,'This surface is registered but not yet implemented.']; $('#workspace-title').textContent=title; $('#workspace-description').textContent=description; $$('.nav-item').forEach(a=>{ const active=a.dataset.route===route; a.classList.toggle('active',active); if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}); emit('route.change',{state:route}); }
function syncRoute(){ const route=(location.hash.match(/^#\/([^/]+)/)||[])[1] || 'home'; if(route==='project') return; setRoute(route); }

function applyTheme(theme){ state.theme=theme; document.documentElement.dataset.theme=theme; localStorage.setItem('axiom.ui.theme',theme); $('#theme-label').textContent=theme==='high-contrast'?'High contrast':theme[0].toUpperCase()+theme.slice(1); emit('theme.change',{theme}); }
function cycleTheme(){ const themes=['system','light','dark','high-contrast']; applyTheme(themes[(themes.indexOf(state.theme)+1)%themes.length]); }

function setProof(open){ state.proofOpen=Boolean(open); $('#proof-drawer').classList.toggle('open',state.proofOpen); $('#proof-mobile-button').setAttribute('aria-expanded',String(state.proofOpen)); emit('proof.toggle',{state:state.proofOpen?'open':'closed'}); if(state.proofOpen && matchMedia('(max-width: 52rem)').matches) $('#proof-drawer h2').focus?.(); }
function activateTab(tab){ const tabs=$$('[role="tab"]',$('#proof-drawer')); tabs.forEach(t=>{ const selected=t===tab; t.setAttribute('aria-selected',String(selected)); t.tabIndex=selected?0:-1; const panel=document.getElementById(t.getAttribute('aria-controls')); panel.hidden=!selected; }); emit('proof.tab',{control:tab.id}); }

function constraints(){ return { privacy:$('#privacy-scope').value, evidence:$('#evidence-level').value, autonomy:$('#autonomy-level').value, approval:$('#approval-policy').value }; }
function updateConstraintSummary(){ const c=constraints(); $('#constraint-summary').textContent=`${c.privacy} · ${c.approval.toLowerCase()} · ${c.evidence.toLowerCase()} evidence`; }
function previewOutcome(event){ event.preventDefault(); const input=$('#composer-input'); const text=input.value.trim(); if(!text){ input.setAttribute('aria-invalid','true'); input.focus(); reportError({errorId:'AXIOM-UI-001',component:'Universal composer',impact:'No preview created',succeeded:'Your draft remains local',failed:'Outcome description is empty',dataLost:'No',retryState:'Ready',recovery:'Describe an outcome and retry',supportTrace:'#proof-drawer'}); return; } input.removeAttribute('aria-invalid'); $('#error-region').hidden=true; const node=$('#preview-template').content.cloneNode(true); $('[data-preview-title]',node).textContent=`${state.verb}: ${text.slice(0,90)}${text.length>90?'…':''}`; const c=constraints(); $('[data-preview-autonomy]',node).textContent=c.autonomy; $('[data-preview-evidence]',node).textContent=c.evidence; $('[data-preview-privacy]',node).textContent=c.privacy; const target=$('#run-preview'); target.replaceChildren(node); target.classList.remove('empty-state'); $('#run-stage-title').textContent='Inspectable plan preview'; $('#run-status-badge').textContent='Preview only'; emit('outcome.preview',{verb:state.verb,state:'not-executed'}); setProgress(100,'Preview ready','No external action executed'); }

function setProgress(value,title='Working',detail=''){ const n=Math.max(0,Math.min(100,Number(value)||0)); const region=$('#progress-region'); region.hidden=false; $('#progress-title').textContent=safeText(title); $('#progress-detail').textContent=safeText(detail); $('#progress-value').textContent=`${n}%`; $('#progress-bar').style.width=`${n}%`; emit('run.progress',{progress:String(n),state:n===100?'complete':'active'}); }
function reportError({errorId='AXIOM-UI-UNKNOWN',component='Workspace',impact='Operation interrupted',succeeded='Existing workspace state preserved',failed='Requested operation',dataLost='Unknown',retryState='Available',recovery='Retry safely',supportTrace='#proof-drawer'}={}){ const region=$('#error-region'); region.hidden=false; region.replaceChildren(); const h=document.createElement('h3'); h.textContent=`${safeText(errorId)} · ${safeText(component)}`; const grid=document.createElement('div'); grid.className='error-grid'; for(const [label,value] of [['Impact',impact],['What succeeded',succeeded],['What failed',failed],['Data lost',dataLost],['Retry state',retryState],['Recovery',recovery]]){ const cell=document.createElement('div'); const strong=document.createElement('strong'); strong.textContent=label; const span=document.createElement('span'); span.textContent=safeText(value); cell.append(strong,span); grid.append(cell); } const actions=document.createElement('div'); actions.className='error-actions'; const retry=document.createElement('button'); retry.type='button'; retry.className='button secondary'; retry.textContent='Retry'; retry.addEventListener('click',()=>{region.hidden=true;emit('error.retry',{error_id:errorId,retry_state:'requested'});}); const trace=document.createElement('a'); trace.className='button secondary'; trace.href=supportTrace; trace.textContent='Open support trace'; actions.append(retry,trace); region.append(h,grid,actions); emit('error.report',{error_id:errorId,component,retry_state:retryState}); }

function saveDraft(){ const value=$('#composer-input').value; try{ if(value) localStorage.setItem('axiom.ui.draft',value); else localStorage.removeItem('axiom.ui.draft'); }catch{} }
function restoreDraft(){ try{ const draft=localStorage.getItem('axiom.ui.draft'); if(draft) $('#composer-input').value=draft; }catch{} }
function updateNetwork(){ const online=navigator.onLine; const badge=$('#connection-state'); badge.dataset.state=online?'online':'offline'; badge.lastElementChild.textContent=online?'Online':'Offline'; const banner=$('#network-banner'); banner.hidden=online; banner.textContent=online?'':'Offline: local draft and cached shell remain available. Consequential actions are unavailable.'; emit('network.change',{state:online?'online':'offline'}); }

function installEvents(){
  window.addEventListener('hashchange',syncRoute); window.addEventListener('online',updateNetwork); window.addEventListener('offline',updateNetwork);
  $('#theme-button').addEventListener('click',cycleTheme); $('#proof-mobile-button').addEventListener('click',()=>setProof(!state.proofOpen)); $('#proof-close-button').addEventListener('click',()=>setProof(false));
  $$('.nav-item').forEach(a=>a.addEventListener('click',()=>emit('nav.activate',{control:a.dataset.route})));
  $$('.verb').forEach(button=>button.addEventListener('click',()=>{ state.verb=button.dataset.verb; $$('.verb').forEach(v=>{const active=v===button;v.classList.toggle('active',active);v.setAttribute('aria-pressed',String(active));}); emit('composer.verb',{verb:state.verb}); }));
  $$('.tool-button').forEach(button=>button.addEventListener('click',()=>emit('composer.tool-preview',{control:button.dataset.tool,state:'surface-only'})));
  $$('#constraints select, #constraints input').forEach(el=>el.addEventListener('change',()=>{updateConstraintSummary();emit('composer.constraint',{control:el.id});}));
  $('#composer').addEventListener('submit',previewOutcome); $('#composer-input').addEventListener('input',saveDraft);
  $$('#proof-drawer [role="tab"]').forEach(tab=>{ tab.addEventListener('click',()=>activateTab(tab)); tab.addEventListener('keydown',e=>{const tabs=$$('#proof-drawer [role="tab"]');let i=tabs.indexOf(tab);if(e.key==='ArrowRight')i=(i+1)%tabs.length;else if(e.key==='ArrowLeft')i=(i-1+tabs.length)%tabs.length;else return;e.preventDefault();activateTab(tabs[i]);tabs[i].focus();}); });
  const dialog=$('#shortcuts-dialog'); $('#shortcuts-button').addEventListener('click',()=>dialog.showModal()); $('[data-close-dialog]').addEventListener('click',()=>dialog.close());
  document.addEventListener('keydown',e=>{ const mod=e.ctrlKey||e.metaKey; if(mod&&e.key.toLowerCase()==='k'){e.preventDefault();$('#composer-input').focus();emit('shortcut',{control:'composer-focus'});} if(mod&&e.shiftKey&&e.key.toLowerCase()==='p'){e.preventDefault();setProof(!state.proofOpen);} if(e.key==='?'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)){e.preventDefault();if(!dialog.open)dialog.showModal();} if(e.key==='Escape'&&state.proofOpen)setProof(false); });
}
function registerServiceWorker(){ if('serviceWorker' in navigator && location.protocol!=='file:') navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(()=>emit('pwa.service-worker',{state:'registered'})).catch(()=>emit('pwa.service-worker',{state:'registration-failed'})); }

applyTheme(state.theme); restoreDraft(); installEvents(); syncRoute(); updateConstraintSummary(); updateNetwork(); registerServiceWorker(); emit('shell.ready',{state:'phase1'});
window.AxiomUI = Object.freeze({ emit, reportError, setProgress, setProof, getTrace:()=>structuredClone(state.trace) });
