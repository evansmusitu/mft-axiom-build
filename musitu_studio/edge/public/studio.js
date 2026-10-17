const $=(id)=>document.getElementById(id);
const seed={schema:'musitu.blender.job.v1',job_id:'StudioProof01',frame_end:32,objects:[
{name:'Foundation',type:'cube',location:[0,0,0],dimensions:[6,4,.3],material:'graphite'},
{name:'Pavilion',type:'cube',location:[-1,0,1.5],dimensions:[2.4,2.4,2.4],material:'ivory'},
{name:'Feature',type:'sphere',location:[2,0,1.3],dimensions:[1.6,1.6,1.6],material:'copper'}
],animations:[{object:'Feature',axis:'Z',degrees:180,start:1,end:32}]};
$('scene').value=JSON.stringify(seed,null,2);
let token=sessionStorage.getItem('musitu_studio_session')||'';
let accessSessionReady=false;
async function signInWithCloudflare(){
 const response=await fetch('/api/session',{method:'GET',credentials:'same-origin',cache:'no-store'});
 if(!response.ok)throw Error('Cloudflare Access staff sign-in is required. Use your approved MUSITU staff account.');
 accessSessionReady=true;
}
$('token').value=token;
const state={projects:[],jobs:[]};
function notice(s,bad=false){$('message').textContent=s;$('message').className='note'+(bad?' error':'');}
async function api(path,method='GET',body,retry=true){
 if(!token&&!accessSessionReady)await signInWithCloudflare();
 const res=await fetch(path,{method,credentials:'same-origin',
   headers:{...(token?{'Authorization':'Bearer '+token}:{}),'Content-Type':'application/json'},
   body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
 if(res.status===401&&!token&&retry){accessSessionReady=false;await signInWithCloudflare();return api(path,method,body,false);}
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
  if(j.state==='RUNNING'){
    const b=el('button','↻ Check render');
    b.onclick=()=>action(async()=>{const result=await api('/api/jobs/'+j.id+'/sync','POST',{});await refresh();
      notice(result.state==='COMPLETED'?'Blender results verified and available to download.':'Render is still running on Modal.');});
    right.append(b);
  }
  if(j.state==='COMPLETED'){
    for(const name of ['scene.blend','scene.glb','preview.png']){
      const b=el('button',name,'ghost');
      b.onclick=()=>action(async()=>{const res=await fetch('/api/jobs/'+j.id+'/assets/'+name,{credentials:'same-origin',headers:token?{Authorization:'Bearer '+token}:{}});
        if(!res.ok)throw Error('Download failed');const blob=await res.blob();const url=URL.createObjectURL(blob);
        const a=document.createElement('a');a.href=url;a.download=j.id+'-'+name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      });right.append(b);
    }
  }
  card.append(left,right);queue.append(card);
 }
 if(!state.jobs.length)queue.textContent='No jobs yet. Submit an approved JSON scene.';
 notice('Connected to '+status.backend+'. New CPU renders use verified Modal execution and Cloudflare R2 storage.');
}
$('connect').onclick=()=>action(async()=>{const entered=$('token').value.trim();if(entered){if(entered.length<32)throw Error('Token must be at least 32 characters.');token=entered;sessionStorage.setItem('musitu_studio_session',token);}else{token='';await signInWithCloudflare();}await refresh();});
$('forget').onclick=()=>{token='';accessSessionReady=false;$('token').value='';sessionStorage.removeItem('musitu_studio_session');$('state').textContent='DISCONNECTED';$('project-list').textContent='Disconnected.';$('job-list').textContent='Disconnected.';notice('Local token removed. Cloudflare Access remains responsible for your staff sign-in.')};
$('refresh').onclick=()=>action(refresh);
$('project-form').onsubmit=(e)=>{e.preventDefault();action(async()=>{await api('/api/projects','POST',{title:$('project-title').value});$('project-title').value='';await refresh();})};
$('job-form').onsubmit=(e)=>{e.preventDefault();action(async()=>{let scene;try{scene=JSON.parse($('scene').value)}catch{throw Error('Scene JSON is invalid.');}
 const project_id=$('project-select').value;if(!project_id)throw Error('Select a project.');
 const result=await api('/api/jobs','POST',{project_id,scene,device:$('device').value,submission_key:crypto.randomUUID().replaceAll('-','')});
 notice('Submitted '+result.job_id+' for explicit approval.');await refresh();
})};
action(refresh);
