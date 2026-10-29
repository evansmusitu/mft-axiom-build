import { ComputerStore } from './computer_store.js';
import { FIXTURES, uid } from './computer_security.js';

import { markup } from './computer_ui_markup.js';
import { createComputerRenderer } from './computer_ui_render.js';
import { installComputerUIEvents } from './computer_ui_events.js';
export async function initComputerWorkspace({projects,observability}={}){
  if(!projects?.store||!observability?.store)throw new TypeError('qualified Project and Observability substrates required');
  const main=document.querySelector('#main-workspace');if(!main)return null;
  const style=document.createElement('link');style.rel='stylesheet';style.href='./styles/computer.css';document.head.append(style);main.insertAdjacentHTML('beforeend',markup());
  const store=await ComputerStore.open(),space=document.querySelector('#computer-space'),hero=document.querySelector('.hero-card'),runStage=document.querySelector('.run-stage'),actor='local-user',ctx={current:'',currentAction:''};
  const frame=()=>document.querySelector('#computer-frame');
  const {render,syncFrameState}=createComputerRenderer({store,ctx,frame});
  async function refreshProjects(){const rows=await projects.store.listProjects(),sel=document.querySelector('#computer-project'),preferred=sel.value||projects.getCurrentProjectId?.()||'';sel.replaceChildren(new Option('Choose project',''));for(const p of rows)sel.add(new Option(`${p.name} · ${p.project_id}`,p.project_id));if(preferred&&rows.some(p=>p.project_id===preferred))sel.value=preferred;}
  async function observe(kind,linkage={},operational={}){if(!ctx.current)return;const trace=await observability.store.getRun(ctx.current);if(!trace)return;await observability.store.recordEvent(ctx.current,{kind,actorId:actor,linkage,operational});}
  async function ensureTrace(row){if(await observability.store.getRun(row.session_id))return;await observability.store.startRun({runId:row.session_id,traceId:uid('trace'),actorId:actor,userIntentId:`computer:${row.session_id}`,projectId:row.project_id,production:false,startedAt:row.started_at});await observe('policy.decided',{policy_decision_id:`policy:${row.session_id}`},{status:'SANDBOX_BOUND',policy_intervention:false});}
  function report(error,id='AXIOM-COMPUTER'){window.AxiomUI?.reportError?.({errorId:id,component:'Computer',impact:'Computer action not completed',failed:error.message,recovery:'Inspect the visible policy, approval and sandbox state, then retry'});}
  async function route(){const on=/^#\/computer(?:\/|$)/.test(location.hash);space.hidden=!on;if(hero)hero.hidden=on;if(runStage)runStage.hidden=on;if(on){document.querySelector('#workspace-title').textContent='Computer';document.querySelector('#workspace-description').textContent='Visible sandboxed browser execution with explicit approvals, takeover, receipts and rollback where supported.';await refreshProjects();await render();}}
  installComputerUIEvents(Object.assign(ctx,{store,projects,observability,actor,observe,ensureTrace,render,syncFrameState,report}));
  window.addEventListener('hashchange',()=>route().catch(()=>{}));await refreshProjects();await route();const api={store,fixtures:FIXTURES,getCurrentSessionId:()=>ctx.current,refresh:render,selectSession:async id=>{ctx.current=id;ctx.currentAction='';await render();}};window.AxiomComputer=Object.freeze(api);return api;
}
