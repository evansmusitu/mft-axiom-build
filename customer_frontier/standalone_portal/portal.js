import {AXIOMCustomerAdapter} from '../customer_control_plane/browser_adapter.mjs';
const api=new AXIOMCustomerAdapter();const el=id=>document.getElementById(id);const state={page:'overview',account:null,connected:false,selectedProject:null,selectedWork:null};
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n};
const box=(title)=>{const n=node('section',undefined,'panel');n.append(node('h2',title));return n};
function row(container,label,value){const r=node('div',undefined,'row');r.append(node('span',label),node('strong',value));container.append(r);}
function note(text,cls='muted'){return node('p',text,cls)};
function renderMessage(text){el('message').textContent=text;}
function submitForm(parent,fields,label,fn){const form=node('form',undefined,'form');for(const f of fields){const labelEl=node('label',f.label);const input=node(f.multiline?'textarea':'input');input.name=f.key;input.required=true;if(f.type)input.type=f.type;input.maxLength=f.max||300;labelEl.append(input);form.append(labelEl);}const submit=node('button',label,'primary');submit.type='submit';form.append(submit);const status=node('p','', 'muted');status.setAttribute('role','status');form.append(status);form.addEventListener('submit',async ev=>{ev.preventDefault();submit.disabled=true;status.textContent='Working…';try{const values=Object.fromEntries(new FormData(form).entries());await fn(values);status.textContent='Saved. Refreshing…';form.reset();await render();}catch(e){status.textContent='Not completed: '+e.message}finally{submit.disabled=false}});parent.append(form);}
async function viewOverview(root){const a=state.account;const grid=node('div',undefined,'grid');for(const [name,value] of [['Available compute units',a.credit.available??'Restricted'],['Reserved',a.credit.reserved??'Restricted'],['Outstanding debt',a.credit.debt??'Restricted']]){const panel=box(name);panel.append(node('p',value,'metric'));grid.append(panel)}root.append(grid);const p=box('One account, five permanent objects');p.append(note('Your authenticated tenant is the basis for Projects, Work, Agents, Artifacts and Evidence. Public ChatGPT capability access must use the same independently verified identity.'));row(p,'Tenant',a.tenant_id);row(p,'Your role',a.role);row(p,'Live checkout','Not qualified');root.append(p);}
async function viewCredits(root){const data=await api.getLedger();const summary=box('Compute-unit position');row(summary,'Booked units',data.credit.booked);row(summary,'Active holds',data.credit.reserved);row(summary,'Spendable',data.credit.available);row(summary,'Debt',data.credit.debt);root.append(summary);const history=box('Credit ledger — last 100 entries');if(!data.entries.length)history.append(note('No verified ledger events yet.'));for(const e of data.entries)row(history,e.source_key,`${e.delta>0?'+':''}${e.delta} units`);root.append(history);}
async function viewBilling(root){const policy=box('Commercial account');policy.append(note('This is an independent browser account surface, not a ChatGPT plugin checkout. Payment capture is disabled until authentic provider reconciliation, refunds, currency and legal gates pass.','warn'));root.append(policy);const orders=await api.getOrders();const panel=box('Orders');if(!orders.orders.length)panel.append(note('No orders yet.'));for(const o of orders.orders)row(panel,o.id,`${o.currency} ${(o.amount_minor/100).toFixed(2)} · ${o.state}`);root.append(panel);const invoices=await api.getInvoices();const inv=box('Payment receipts / tax review');if(!invoices.invoices.length)inv.append(note('No settled payments; no receipts issued.'));for(const i of invoices.invoices)row(inv,i.id,`${i.currency} ${(i.amount_minor/100).toFixed(2)} · ${i.tax_status}`);root.append(inv);const refunded=await api.getRefunds();const re=box('Refund requests');if(!refunded.refunds.length)re.append(note('No refund requests.'));for(const r of refunded.refunds)row(re,r.id,`${r.amount_minor} minor units · ${r.state}`);submitForm(re,[{key:'order_id',label:'Settled order ID',max:80},{key:'amount_minor',label:'Refund amount (smallest currency unit)',type:'number',max:10},{key:'reason',label:'Reason',multiline:true,max:500}], 'Request a refund',v=>api.requestRefund(v.order_id,Number(v.amount_minor),v.reason));root.append(re);}
async function viewProjects(root){
 const data=await api.getProjects();const panel=box('Persistent projects');
 if(!data.projects.length)panel.append(note('Your team has no projects yet. Create a project to begin an auditable work contract.'));
 for(const p of data.projects){
  const block=box(p.name);block.append(note(p.objective));
  const btn=node('button',state.selectedProject===p.id?'Hide work':'View work','button secondary');btn.type='button';
  btn.onclick=()=>{state.selectedProject=state.selectedProject===p.id?null:p.id;void render()};block.append(btn);
  if(state.selectedProject===p.id){
   const work=await api.getWork(p.id);
   const list=box('Work contracts');
   if(!work.work.length)list.append(note('No work contracts yet. New work starts as a draft and cannot execute without independent approval.'));
   for(const w of work.work){
    const card=node('div',undefined,'row');card.append(node('span',w.title),node('strong',w.state));list.append(card);
    const evidenceBtn=node('button','View evidence','button secondary');evidenceBtn.type='button';
    evidenceBtn.onclick=()=>{state.selectedWork=w.id;state.page='evidence';setSelectedNavigation();void render()};list.append(evidenceBtn);
   }
   submitForm(list,[{key:'title',label:'Work title',max:160},{key:'desired_outcome',label:'Verified outcome required',multiline:true,max:5000}], 'Create draft work',v=>api.createWork(p.id,v.title,v.desired_outcome));
   block.append(list);
  }
  panel.append(block);
 }
 root.append(panel);
 submitForm(root,[{key:'name',label:'Project name',max:120},{key:'objective',label:'Objective',multiline:true,max:4000}], 'Create project',v=>api.createProject(v.name,v.objective));
}
function setSelectedNavigation(){document.querySelectorAll('[data-page]').forEach(b=>{const selected=b.dataset.page===state.page;b.classList.toggle('active',selected);b.setAttribute('aria-current',selected?'page':'false');if(selected)el('title').textContent=b.textContent;});}
async function viewEvidence(root){
 const panel=box('Evidence and artifacts');panel.append(note('Independent verification is mandatory. Unverified records never imply successful execution.'));
 const data=await api.getProjects();let displayed=0;
 for(const p of data.projects){
  const w=await api.getWork(p.id);
  for(const work of w.work){
   if(state.selectedWork&&work.id!==state.selectedWork)continue;
   const item=box(`${p.name}: ${work.title}`);
   const [ev,ar,ag]=await Promise.all([api.getEvidence(work.id),api.getArtifacts(work.id),api.getAgents(work.id)]);
   row(item,'Work state',work.state);
   row(item,'Independent evidence records',ev.evidence.length);
   row(item,'Artifact records',ar.artifacts.length);
   row(item,'Agent records',ag.agents.length);
   for(const evidence of ev.evidence){const e=node('div',undefined,'row');e.append(node('span',evidence.claim),node('strong','Recorded evidence'));item.append(e)}
   panel.append(item);displayed++;
  }
 }
 if(!displayed)panel.append(note('No qualifying work/evidence is visible.'));
 if(state.selectedWork){const back=node('button','View all work evidence','button secondary');back.onclick=()=>{state.selectedWork=null;void render()};panel.append(back)}
 root.append(panel);
}
async function viewSupport(root){
 const panel=box('Customer care and privacy');
 panel.append(note('Support and privacy requests are securely recorded for independent human handling. Submitting a deletion request does not erase data or bypass legal retention.'));
 const help=node('a','MUSITU help center','button secondary');help.href='https://support.mftintelligence.com/';help.rel='noopener noreferrer';panel.append(help);
 const cases=await api.getCases();if(!cases.cases.length)panel.append(note('No requests submitted.'));
 for(const request of cases.cases)row(panel,request.subject,`${request.kind.replaceAll('_',' ')} · ${request.status}`);
 submitForm(panel,[{key:'subject',label:'Support topic',max:160},{key:'detail',label:'What do you need help with?',multiline:true,max:3000}], 'Send a support request',v=>api.createCase('support',v.subject,v.detail));
 root.append(panel);
 const privacy=box('Privacy and data rights');privacy.append(note('Export and deletion are review requests, not immediate data transfers or irreversible erasure.'));
 for(const [kind,label,description] of [['privacy_export','Request a data export','Please review my personal data export request'],['privacy_delete','Request account data deletion','Please review my personal data deletion request']]){
  const button=node('button',label,'button secondary');button.type='button';const status=note('','muted');button.onclick=async()=>{button.disabled=true;try{await api.createCase(kind,label,description);status.textContent='Request recorded for review.';await render()}catch(e){status.textContent='Not completed: '+e.message}finally{button.disabled=false}};privacy.append(button,status);
 }
 root.append(privacy);
}
async function render(){const root=el('view');root.replaceChildren();if(!state.connected){renderMessage('Sign in or create an account through the independently verified identity provider. Account keys are never requested here. Enrollment is unavailable until identity qualification.');const p=box('Complete secure registration');p.append(note('After successfully signing in with verified email and MFA, finish provisioning your personal workspace. This is unavailable until the external identity service is qualified.'));const btn=node('button','Finish account setup','primary');btn.type='button';const msg=note('', 'muted');btn.onclick=async()=>{btn.disabled=true;msg.textContent='Verifying identity…';try{await api.enroll();state.account=await api.getAccount();state.connected=true;el('connection').textContent='Account verified';if(!state.account.billing_access)document.querySelectorAll('[data-page=credits],[data-page=billing]').forEach(b=>{b.hidden=true;b.disabled=true});await render()}catch(e){msg.textContent='Registration unavailable: '+e.message}finally{btn.disabled=false}};p.append(btn,msg);root.append(p);return;}renderMessage('Authenticated account. This candidate control plane does not provide live checkout.');try{if(state.page==='overview')await viewOverview(root);if(state.page==='credits')await viewCredits(root);if(state.page==='billing')await viewBilling(root);if(state.page==='projects')await viewProjects(root);if(state.page==='evidence')await viewEvidence(root);if(state.page==='support')await viewSupport(root);}catch(e){renderMessage('Section unavailable: '+e.message);}}
for(const b of document.querySelectorAll('[data-page]'))b.addEventListener('click',()=>{state.page=b.dataset.page;state.selectedWork=null;setSelectedNavigation();void render()});
try{state.account=await api.getAccount();state.connected=true;el('connection').textContent='Account verified';if(!state.account.billing_access)document.querySelectorAll('[data-page=credits],[data-page=billing]').forEach(b=>{b.hidden=true;b.disabled=true});}catch(e){state.connected=false;el('connection').textContent='Sign-in required';}await render();
