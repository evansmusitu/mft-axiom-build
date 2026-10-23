import {createSubmissionIntent,submitSceneWithIdempotentRefresh} from './submission-intent.mjs';
'use strict';
// Access-only v0.3. No bearer tokens, external JS, eval, HTML injection or localStorage.
const el=id=>document.getElementById(id);
const scene={schema:'musitu.blender.job.v1',job_id:'StudioEnterprise01',frame_end:32,
 objects:[{name:'Foundation',type:'cube',location:[0,0,0],dimensions:[6,4,.3],material:'graphite'},
 {name:'Pavilion',type:'cube',location:[-1,0,1.5],dimensions:[2.4,2.4,2.4],material:'ivory'},
 {name:'Feature',type:'sphere',location:[2,0,1.3],dimensions:[1.6,1.6,1.6],material:'copper'}],
 animations:[{object:'Feature',axis:'Z',degrees:180,start:1,end:32}]};
el('scene').value=JSON.stringify(scene,null,2);
const state={me:null,projects:[],jobs:[],previewUrl:null};
const submitIntent=createSubmissionIntent();
let submitBusy=false;
const notify=(msg,bad=false)=>{el('message').textContent=msg;el('message').className='note'+(bad?' error':'')};
function element(tag,text,cl){
 const e=document.createElement(tag);if(cl)e.className=cl;
 if(text!==undefined)e.textContent=text;return e;
}
function allowedProject(project,capability){
 if(state.me?.role==='global_admin')return true;
 return ({create:['owner','reviewer','editor'],approve:['owner','reviewer'],team:['owner']})
    [capability]?.includes(project?.role)??false;
}
async function api(path,method='GET',data){
 const r=await fetch(path,{method,credentials:'same-origin',cache:'no-store',
   headers:method==='GET'?{}:{'Content-Type':'application/json'},
   body:data===undefined?undefined:JSON.stringify(data),
   signal:AbortSignal.timeout(30_000)});
 let b;try{b=await r.json()}catch{throw Error('Invalid server response ('+r.status+')')}
 if(!r.ok)throw Error(b?.error??'HTTP '+r.status);
 return b;
}
async function download(jobId,name,preview=false){
 const r=await fetch('/api/jobs/'+jobId+'/assets/'+name,{
   credentials:'same-origin',cache:'no-store'});
 if(!r.ok){let e;try{e=await r.json()}catch{}throw Error(e?.error??'Asset download denied')}
 const blob=await r.blob();
 if(preview){
   if(state.previewUrl)URL.revokeObjectURL(state.previewUrl);
   state.previewUrl=URL.createObjectURL(blob);
   const img=el('preview-image');img.src=state.previewUrl;img.hidden=false;
   el('preview-label').textContent='Verified R2 preview · '+jobId.slice(0,8);
   img.scrollIntoView({behavior:'smooth',block:'nearest'});
 }else{
   const addr=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=addr;a.download=jobId+'-'+name;document.body.append(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(addr),30_000);
 }
}
async function guarded(fn){
 try{await fn()}catch(e){notify(String(e?.message||'Action failed'),true)}
}
const teamProject=id=>state.projects.find(p=>p.id===id);
function button(text,handler,cls='ghost'){
 const b=element('button',text,cls);b.type='button';b.onclick=()=>guarded(handler);return b;
}
async function refresh(){
 const [me,status,projects,jobs]=await Promise.all([
   api('/api/session'),api('/api/status'),api('/api/projects'),api('/api/jobs')]);
 state.me=me;state.projects=projects.projects??[];state.jobs=jobs.jobs??[];
 el('connection').textContent='SIGNED IN · '+(me.role==='global_admin'?'ADMIN':'STAFF');
 el('projects-count').textContent=String(state.projects.length);
 el('jobs-count').textContent=String(state.jobs.length);
 el('render-gate').textContent=status.dispatch_enabled?'APPROVAL REQUIRED':'LOCKED';
 el('copy-subject').disabled=false;
 const projectList=el('project-list');projectList.replaceChildren();
 const projectSelect=el('project-select'),teamSelect=el('team-project');
 projectSelect.replaceChildren(new Option('Select a project',''));
 teamSelect.replaceChildren(new Option('Select a project',''));
 for(const p of state.projects){
   const row=element('div',undefined,'card'),text=element('div');
   text.append(element('strong',p.title),element('div',p.role??'Global admin view','scope'));
   row.append(text,element('span',p.id.slice(0,8)+' · '+p.created_at,'meta'));
   projectList.append(row);teamSelect.add(new Option(p.title,p.id));
   if(allowedProject(p,'create'))projectSelect.add(new Option(p.title,p.id));
 }
 if(!state.projects.length)projectList.textContent='No assigned projects. Create one to become its owner.';
 const container=el('job-list');container.replaceChildren();
 for(const j of state.jobs){
   const p=teamProject(j.project_id);
   const card=element('article',undefined,'card'),body=element('div'),actions=element('div',undefined,'card-actions');
   body.append(element('strong',j.id.slice(0,12)+' · '+j.device),
               element('span',(p?.title??'Studio project')+' · '+j.created_at,'meta'));
   const badge=element('span',j.state,'state '+(j.state==='FAILED'?'failed':
         j.state==='PENDING_APPROVAL'?'pending':''));
   actions.append(badge);
   const selfApproval=j.created_by_me&&p?.is_my_project===1&&
     p?.role==='owner'&&status.single_admin_approval_enabled===true;
   if(j.state==='PENDING_APPROVAL'&&allowedProject(p,'approve')&&(!j.created_by_me||selfApproval)){
     actions.append(button(selfApproval?'Approve as sole administrator':'Approve as reviewer',async()=>{
       if(selfApproval){
         if(!window.confirm('This is YOUR job. You are approving as the sole authorized administrator, NOT as an independent second reviewer. This approval will be permanently audited. Continue?'))return;
         await api('/api/jobs/'+j.id+'/approve','POST',
           {acknowledgement:'I_AM_THE_SOLE_APPROVER'});
       }else{
         await api('/api/jobs/'+j.id+'/approve','POST',{});
       }
       await refresh();
     }));
   }
   if(j.state==='APPROVED'&&allowedProject(p,'approve')&&status.dispatch_enabled){
     actions.append(button('Dispatch CPU',async()=>{
       await api('/api/jobs/'+j.id+'/dispatch','POST',{});await refresh()}));
   }
   if(j.state==='RUNNING'&&allowedProject(p,'approve')){
     actions.append(button('Check render',async()=>{
       const result=await api('/api/jobs/'+j.id+'/sync','POST',{});
       await refresh();notify(result.state==='COMPLETED'?'Artifacts verified and ready':
         'Rendering on Modal; check again later.')}));
   }
   if(j.state==='COMPLETED'){
     actions.append(button('Preview',()=>download(j.id,'preview.png',true)));
     for(const n of ['scene.blend','scene.glb','preview.png'])
       actions.append(button('↓ '+n,()=>download(j.id,n)));
   }
   if(allowedProject(p,'approve')){
     actions.append(button('Audit',async()=>{
       const result=await api('/api/jobs/'+j.id+'/audit');
       notify((result.events??[]).map(x=>x.action+' at '+x.at).join(' · ')||'No events.')}))
   }
   card.append(body,actions);container.append(card);
 }
 if(!state.jobs.length)container.textContent='No authorized jobs yet. Submit a scene for approval.';
 notify('Connected to '+status.backend+'. Signed Access identity and project authorization are required. '+
   (status.single_admin_approval_enabled?'Sole-administrator approvals are explicitly recorded without an independent reviewer. ':'Independent reviewer approval is required. ')+
   'CPU/GPU execution remains subject to separate provider spending and release gates.');
}
el('connect').onclick=()=>guarded(refresh);
el('refresh').onclick=()=>guarded(refresh);
el('copy-subject').onclick=()=>guarded(async()=>{
 if(!state.me?.subject)throw Error('Connect first');
 await navigator.clipboard.writeText(state.me.subject);
 notify('Your Access staff ID was copied. Share it privately with your project owner to receive access.');
});
el('project-form').onsubmit=e=>{e.preventDefault();guarded(async()=>{
 await api('/api/projects','POST',{title:el('project-title').value.trim()});
 el('project-title').value='';await refresh()})};
el('job-form').onsubmit=e=>{e.preventDefault();if(submitBusy)return;
 submitBusy=true;
 const control=el('submit-scene');if(control)control.disabled=true;
 guarded(async()=>{
   const projectId=el('project-select').value;
   if(!projectId)throw Error('Select an editable project.');
   let payload;try{payload=JSON.parse(el('scene').value)}catch{throw Error('Invalid JSON scene.')}
   // A network failure may occur AFTER a job is committed. Retry the same
   // project+scene with the same key, never create an accidental duplicate.
   const {jobId,duplicate}=await submitSceneWithIdempotentRefresh({
     intent:submitIntent,projectId,scene:payload,
     post:intent=>api('/api/jobs','POST',intent),refresh});
   notify((duplicate?'Existing job ':'Created ')+jobId.slice(0,12)+
     '; job requires explicit approval; paid CPU dispatch remains locked.');
 }).finally(()=>{submitBusy=false;if(control)control.disabled=false});
};
el('add-member').onclick=()=>guarded(async()=>{
 const id=el('team-project').value;
 if(!id||!allowedProject(teamProject(id),'team'))throw Error('Only project owners can grant team roles.');
 const subject=el('new-member-sub').value.trim();
 if(!subject)throw Error('Paste the signed-in colleague’s Access staff ID.');
 await api('/api/projects/'+id+'/members','POST',{
   member_sub:subject,role:el('member-role').value});
 el('new-member-sub').value='';await viewMembers();
 notify('Role granted for the selected project.');});
async function viewMembers(){
 const id=el('team-project').value;
 if(!id||!allowedProject(teamProject(id),'team'))throw Error('Select a project you own.');
 const result=await api('/api/projects/'+id+'/members');
 const list=el('member-list');list.replaceChildren();
 for(const m of result.members??[]){
   const c=element('div',undefined,'card');c.append(
     element('strong',m.role),element('span',m.member_sub,'scope'));list.append(c);
 }
 if(!result.members?.length)list.textContent='No members found.';
}
el('view-members').onclick=()=>guarded(viewMembers);
el('check-recovery').onclick=()=>guarded(async()=>{
 const info=await api('/api/recovery/readiness');
 const message='Database schema v'+info.schema_version+' · '+
   (info.pitr_bookmark_available?'Cloudflare recovery bookmark API available':'Recovery bookmark not available in this environment')+
   ' · No database restore performed.';
 el('recovery-readiness').textContent=message;
 notify('Read-only recovery readiness checked for your authorized Studio owner session.');
});
guarded(refresh);
window.addEventListener('pagehide',()=>{if(state.previewUrl)URL.revokeObjectURL(state.previewUrl)});
