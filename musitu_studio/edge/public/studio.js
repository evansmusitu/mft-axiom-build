const $=(id)=>document.getElementById(id);
const seed={schema:'musitu.blender.job.v1',job_id:'StudioProof01',frame_end:32,objects:[
{name:'Foundation',type:'cube',location:[0,0,0],dimensions:[6,4,.3],material:'graphite'},
{name:'Pavilion',type:'cube',location:[-1,0,1.5],dimensions:[2.4,2.4,2.4],material:'ivory'},
{name:'Feature',type:'sphere',location:[2,0,1.3],dimensions:[1.6,1.6,1.6],material:'copper'}
],animations:[{object:'Feature',axis:'Z',degrees:180,start:1,end:32}]};
$('scene').value=JSON.stringify(seed,null,2);
let token=sessionStorage.getItem('musitu_studio_session')||'';
$('token').value=token;
const state={projects:[],jobs:[]};
function notice(s,bad=false){$('message').textContent=s;$('message').className='note'+(bad?' error':'');}
async function api(path,method='GET',body){
 if(!token)throw Error('Connect with your admin token first.');
 const res=await fetch(path,{method,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
 let result;try{result=await res.json()}catch{throw Error('Unexpected server response '+res.status);}
 if(!res.ok)throw Error(result.error||'HTTP '+res.status);
 return result;
}
function el(tag,text,cl){const x=document.createElement(tag);if(cl)x.className=cl;if(text!==undefined)x.textContent=text;return x;}
async function action(fn){try{await fn()}catch(e){notice(e.message,true)}}
async function refresh(){
 const [status,projects,jobs]=await Promise.all([api('/api/status'),api('/api/projects'),api('/api/jobs')]);
 state.projects=projects.projects;state.jobs=jobs.jobs;
 $('state').textContent='CONNECTED';$('state').style.color='#80fce0';
 $('projects-count').textContent=state.projects.length;
 $('jobs-count').textContent=state.jobs.length;
 $('render-gate').textContent=status.dispatch_enabled?'ENABLED':'LOCKED';
 const list=$('project-list');list.replaceChildren();
 const select=$('project-select');select.replaceChildren(new Option('Select a project',''));
 for(const p of state.projects){
  const card=el('div',null,'card'),left=el('div');
  left.append(el('strong',p.title),el('span',p.id.slice(0,8)+' · '+p.created_at,'meta'));
  card.append(left);list.append(card);select.add(new Option(p.title,p.id));
 }
 if(!state.projects.length)list.textContent='No projects yet. Create your first project.';
 const queue=$('job-list');queue.replaceChildren();
 for(const j of state.jobs){
  const card=el('div',null,'card'),left=el('div'),right=el('div',null,'row');
  left.append(el('strong',j.id.slice(0,12)+' · '+j.device),el('span',j.created_at,'meta'));
  const badge=el('span',j.state,'state '+(j.state==='FAILED'?'failed':j.state==='PENDING_APPROVAL'?'pending':''));
  right.append(badge);
  if(j.state==='PENDING_APPROVAL'){
    const b=el('button','Approve');b.onclick=()=>action(async()=>{await api('/api/jobs/'+j.id+'/approve','POST',{});await refresh();});right.append(b);
  }
  if(j.state==='APPROVED'){
    const b=el('button','Dispatch');b.onclick=()=>action(async()=>{await api('/api/jobs/'+j.id+'/dispatch','POST',{});await refresh();});right.append(b);
  }
  if(j.state==='COMPLETED'){
    for(const name of ['scene.blend','scene.glb','preview.png']){
      const b=el('button',name,'ghost');
      b.onclick=()=>action(async()=>{const res=await fetch('/api/jobs/'+j.id+'/assets/'+name,{headers:{Authorization:'Bearer '+token}});
        if(!res.ok)throw Error('Download failed');const blob=await res.blob();const url=URL.createObjectURL(blob);
        const a=document.createElement('a');a.href=url;a.download=j.id+'-'+name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      });right.append(b);
    }
  }
  card.append(left,right);queue.append(card);
 }
 if(!state.jobs.length)queue.textContent='No jobs yet. Submit an approved JSON scene.';
 notice('Connected. Project and job data were loaded from Cloudflare D1.');
}
$('connect').onclick=()=>action(async()=>{token=$('token').value.trim();if(token.length<32)throw Error('Token must be at least 32 characters.');sessionStorage.setItem('musitu_studio_session',token);await refresh();});
$('forget').onclick=()=>{token='';$('token').value='';sessionStorage.removeItem('musitu_studio_session');$('state').textContent='DISCONNECTED';$('project-list').textContent='Disconnected.';$('job-list').textContent='Disconnected.';notice('Session access removed from this browser tab.')};
$('refresh').onclick=()=>action(refresh);
$('project-form').onsubmit=(e)=>{e.preventDefault();action(async()=>{await api('/api/projects','POST',{title:$('project-title').value});$('project-title').value='';await refresh();})};
$('job-form').onsubmit=(e)=>{e.preventDefault();action(async()=>{let scene;try{scene=JSON.parse($('scene').value)}catch{throw Error('Scene JSON is invalid.');}
 const project_id=$('project-select').value;if(!project_id)throw Error('Select a project.');
 const result=await api('/api/jobs','POST',{project_id,scene,device:$('device').value,submission_key:crypto.randomUUID().replaceAll('-','')});
 notice('Submitted '+result.job_id+' for explicit approval.');await refresh();
})};
if(token)action(refresh);
