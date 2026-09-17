import {inspectConnectedRuntime,runConnectedTask} from './runtime_execution_client.mjs';

const $=(selector,root=document)=>root.querySelector(selector);
const clean=(value,limit=2000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit);
const PHASES=Object.freeze(['ACCEPTED','RUNTIME_CONNECTED','RESEARCHING','EXECUTING','SYNTHESIZING','PERSISTING','COMPLETED']);
const LABELS=Object.freeze({ACCEPTED:'Task accepted',RUNTIME_CONNECTED:'Protected runtime connected',RESEARCHING:'Retrieving fixed-source evidence',EXECUTING:'Executing metered runtime operation',SYNTHESIZING:'Building the answer',PERSISTING:'Saving artifact and receipt',COMPLETED:'Completed',FAILED:'Failed safely'});
let running=false,lastObjective='';

function el(tag,{className='',text='',attrs={}}={}){
  const node=document.createElement(tag);if(className)node.className=className;if(text)node.textContent=text;
  for(const [name,value] of Object.entries(attrs))node.setAttribute(name,String(value));return node;
}

function executionPanel(objective){
  $('#runtime-execution-panel')?.remove();
  const section=el('section',{className:'runtime-execution',attrs:{id:'runtime-execution-panel','aria-live':'polite'}});
  const head=el('header',{className:'runtime-execution-head'}),copy=el('div');
  copy.append(el('small',{className:'eyebrow',text:'LIVE EXECUTION · PROTECTED RUNTIME'}),el('h2',{text:objective}),el('p',{className:'muted',text:'AXIOM is executing this task through the authenticated server pipeline. Progress below is emitted by the Worker, not simulated in the browser.'}));
  head.append(copy,el('span',{className:'runtime-state',text:'Starting',attrs:{'data-runtime-state':'running'}}));
  const timeline=el('ol',{className:'runtime-timeline'});
  for(const phase of PHASES){const item=el('li',{attrs:{'data-phase':phase,'data-state':'pending'}});item.append(el('span',{className:'runtime-step-dot',text:'·'}),el('strong',{text:LABELS[phase]}));timeline.append(item);}
  const output=el('div',{className:'runtime-output',attrs:{id:'runtime-output'}});
  section.append(head,timeline,output);
  const home=$('.hero-home');(home?.parentNode||$('#workspace-root'))?.insertBefore(section,home?.nextSibling||$('#workspace-root')?.firstChild||null);
  section.scrollIntoView?.({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  return section;
}

function updatePhase(panel,phase){
  const index=PHASES.indexOf(phase);
  if(index<0)return;
  panel.querySelectorAll('[data-phase]').forEach((item,itemIndex)=>{
    item.dataset.state=itemIndex<index?'done':itemIndex===index?'active':'pending';
    item.querySelector('.runtime-step-dot').textContent=itemIndex<index?'✓':itemIndex===index?'●':'·';
  });
  const state=$('.runtime-state',panel);state.textContent=LABELS[phase]||phase;state.dataset.runtimeState=phase==='COMPLETED'?'complete':'running';
  const status=$('#composer-status');if(status)status.textContent=LABELS[phase]||phase;
}

function renderAuthentication(panel,signInHref){
  const output=$('#runtime-output',panel);output.replaceChildren();
  const card=el('article',{className:'runtime-error'});card.append(el('h3',{text:'Sign in to execute'}),el('p',{text:'The full runtime connection is customer-bound and metered. Sign in with your MUSITU Axiom account key; the key is verified server-side and never returned to JavaScript.'}));
  if(signInHref)card.append(el('a',{className:'button primary runtime-link',text:'Sign in securely',attrs:{href:signInHref}}));
  output.append(card);const state=$('.runtime-state',panel);state.textContent='Authentication required';state.dataset.runtimeState='failed';
}

function renderFailure(panel,error){
  const output=$('#runtime-output',panel);output.replaceChildren();
  const card=el('article',{className:'runtime-error'});card.append(el('h3',{text:'Task stopped safely'}),el('p',{text:clean(error?.message||'The execution pipeline failed.',300)}));
  const retry=el('button',{className:'button primary',text:'Retry task',attrs:{type:'button'}});retry.addEventListener('click',()=>void execute(lastObjective));card.append(retry);output.append(card);
  const state=$('.runtime-state',panel);state.textContent='Failed safely';state.dataset.runtimeState='failed';
  const status=$('#composer-status');if(status)status.textContent='Execution failed safely · retry available';
}

function addLabeled(parent,label,value){
  const row=el('div',{className:'runtime-fact'});row.append(el('span',{text:label}),el('strong',{text:clean(value,300)}));parent.append(row);
}

function renderResult(panel,result){
  updatePhase(panel,'COMPLETED');const output=$('#runtime-output',panel);output.replaceChildren();
  const artifact=result.artifact||{},report=el('article',{className:'runtime-report'});
  report.append(el('small',{className:'eyebrow',text:'COMPLETED ARTIFACT'}),el('h3',{text:clean(artifact.title,180)||'Completed task'}),el('p',{className:'runtime-summary',text:clean(artifact.summary,4000)}));
  if(Array.isArray(artifact.findings)&&artifact.findings.length){report.append(el('h4',{text:'Findings'}));const list=el('ul');for(const finding of artifact.findings)list.append(el('li',{text:clean(finding,1200)}));report.append(list);}
  if(Array.isArray(artifact.citations)&&artifact.citations.length){report.append(el('h4',{text:'Sources'}));const sources=el('ol',{className:'runtime-sources'});for(const source of artifact.citations){const item=el('li'),link=el('a',{text:clean(source.title,240),attrs:{href:source.url,target:'_blank',rel:'noopener noreferrer'}});item.append(link,el('small',{text:`${clean(source.publisher,120)}${source.published_at?` · ${clean(source.published_at,60)}`:''}`}));sources.append(item);}report.append(sources);}
  if(Array.isArray(artifact.limitations)&&artifact.limitations.length){report.append(el('h4',{text:'Limitations'}));const list=el('ul',{className:'muted'});for(const item of artifact.limitations)list.append(el('li',{text:clean(item,800)}));report.append(list);}
  const facts=el('aside',{className:'runtime-proof'});facts.append(el('small',{className:'eyebrow',text:'EXECUTION PROOF'}),el('h3',{text:'Full connection verified'}));
  addLabeled(facts,'Runtime',`${result.runtime?.operation_count||0} operations · ${clean(result.runtime?.build_id,100)}`);
  addLabeled(facts,'Operation',result.execution?.operation||'No quantitative operation required');
  addLabeled(facts,'Metered',result.execution?.receipt?.customer_metered===true?'Yes · customer-bound':'Not applicable');
  addLabeled(facts,'Task',result.task_id||'');addLabeled(facts,'Receipt',result.receipt?.receipt_sha256||'');
  const download=el('button',{className:'button',text:'Download artifact + receipt',attrs:{type:'button'}});download.addEventListener('click',()=>{const blob=new Blob([JSON.stringify({artifact:result.artifact,receipt:result.receipt},null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=el('a',{attrs:{href:url,download:`${result.task_id||'axiom-task'}.json`}});anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});facts.append(download);
  output.append(report,facts);
}

async function ensureHome(){
  if(!location.hash.startsWith('#/home')){location.hash='#/home';await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
}

async function execute(objective){
  if(running)return;objective=clean(objective,2000);if(objective.length<3)return;running=true;lastObjective=objective;
  await ensureHome();const panel=executionPanel(objective);document.querySelectorAll('.execute-button').forEach(button=>button.disabled=true);
  try{
    const session=await (window.AxiomBrowserSessionReady||Promise.resolve(window.AxiomBrowserSession?.getState?.()));
    if(!session?.authenticated){renderAuthentication(panel,session?.signInHref);return;}
    const result=await runConnectedTask(objective,{onEvent:event=>{if(event.event==='phase')updatePhase(panel,event.data?.phase);}});renderResult(panel,result);
    const input=$('#composer-input');if(input)input.value='';
  }catch(error){if(error?.code==='AUTHENTICATION_REQUIRED')renderAuthentication(panel,error.signInHref);else renderFailure(panel,error);}
  finally{running=false;document.querySelectorAll('.execute-button').forEach(button=>button.disabled=false);}
}

document.addEventListener('submit',event=>{
  const form=event.target;if(!(form instanceof HTMLFormElement)||!['composer','hero-form'].includes(form.id))return;
  event.preventDefault();event.stopImmediatePropagation();const input=form.id==='composer'?$('#composer-input'):$('#hero-input');void execute(input?.value);
},true);

async function probe(){
  const status=$('#composer-status');
  try{const runtime=await inspectConnectedRuntime();if(status)status.textContent=`Live · ${runtime.operation_count} protected runtime operations connected`;document.documentElement.dataset.runtimeConnection='full';}
  catch{if(status)status.textContent='Protected runtime unavailable · tasks fail closed';document.documentElement.dataset.runtimeConnection='unavailable';}
}

void probe();
window.AxiomConnectedRuntime=Object.freeze({execute,inspect:inspectConnectedRuntime,boundary:'FULL_SERVER_PIPELINE_NO_BROWSER_CREDENTIALS'});
