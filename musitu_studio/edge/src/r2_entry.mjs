import {validateAccess} from './access.mjs';
import {validateScene,sha256,equalSecret,assetType,validArtifactHeader} from './validation.mjs';

// Limited single-admin Studio control plane using one R2 compare-and-swap state
// object. D1 remains the preferred transactional multiuser production database.
const KEY='studio-control/v1/state.json';
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer'};
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:HEADERS});
const err=(code,status=400)=>json({ok:false,error:code},status);
const now=()=>new Date().toISOString();
const MAXSTATE=6_000_000,MAXJOBS=100,MAXPROJECTS=100;
const clean=()=>({revision:0,projects:[],jobs:[],audit:[]});
const uid=/^[0-9a-f-]{36}$/;
function auth(req,env,type='admin'){
  const value=type==='callback'?env.STUDIO_MODAL_CALLBACK_KEY:env.STUDIO_ADMIN_TOKEN;
  const supplied=req.headers.get('authorization')||'';
  return equalSecret(supplied.startsWith('Bearer ')?supplied.slice(7):'',value);
}
async function bodyJson(req,max=65536){
  const v=req.headers.get('content-length');
  if(v!==null&&(!/^\d+$/.test(v)||Number(v)>max))throw new Error('PAYLOAD_TOO_LARGE');
  if(!req.body)throw new SyntaxError('MISSING_BODY');
  const reader=req.body.getReader();const chunks=[];let size=0;
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>max){await reader.cancel();throw new Error('PAYLOAD_TOO_LARGE');}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
async function loadState(env){
  const blob=await env.STUDIO_ASSETS.get(KEY);
  if(!blob)return {state:clean(),etag:null};
  if(blob.size>MAXSTATE)throw Error('STATE_TOO_LARGE');
  const state=JSON.parse(await blob.text());
  if(!state||!Array.isArray(state.projects)||!Array.isArray(state.jobs)||!Array.isArray(state.audit))throw Error('STATE_CORRUPT');
  return {state,etag:blob.etag};
}
async function atomic(env,update){
  for(let n=0;n<6;n++){
    const {state,etag}=await loadState(env);
    const result=update(state);
    if(result&&result.fail)return {fail:result.fail,status:result.status||409};
    state.revision=(state.revision||0)+1;
    const raw=JSON.stringify(state);
    if(raw.length>MAXSTATE)return {fail:'STATE_CAP_REACHED',status:507};
    const condition=etag?{etagMatches:etag}:new Headers({'If-None-Match':'*'});
    const saved=await env.STUDIO_ASSETS.put(KEY,raw,{
      onlyIf:condition,httpMetadata:{contentType:'application/json'}});
    if(saved)return {ok:true,data:result};
  }
  return {fail:'CONCURRENT_WRITE_RETRY',status:503};
}
function audit(s,id,action,details={}){
  s.audit.push({id:crypto.randomUUID(),job_id:id,action,details,at:now()});
  if(s.audit.length>500)s.audit.shift();
}
function trace(j){
  if(!j)return null;
  return {id:j.id,project_id:j.project_id,payload_sha256:j.payload_sha256,
    device:j.render_device,state:j.state,error:j.error||null,
    created_at:j.created_at,approved_at:j.approved_at||null,
    finished_at:j.finished_at||null};
}
async function callback(req,env){
  if(!auth(req,env,'callback'))return err('UNAUTHORIZED',401);
  let b;try{b=await bodyJson(req,7_500_000)}catch(e){return e.message==='PAYLOAD_TOO_LARGE'?err('PAYLOAD_TOO_LARGE',413):err('INVALID_CALLBACK');}
  if(!b||typeof b.job_id!=='string'||!uid.test(b.job_id)||!['COMPLETED','FAILED'].includes(b.state))return err('INVALID_CALLBACK');
  const {state}=await loadState(env);const job=state.jobs.find(j=>j.id===b.job_id);
  if(!job||!['DISPATCHING','RUNNING'].includes(job.state))return err('JOB_NOT_ACTIVE',409);
  if(b.input_sha256!==job.payload_sha256)return err('JOB_INPUT_HASH_MISMATCH',409);
  if(b.state==='FAILED'){
    const r=await atomic(env,s=>{const j=s.jobs.find(x=>x.id===b.job_id);
      if(!j||!['DISPATCHING','RUNNING'].includes(j.state))return {fail:'JOB_NOT_ACTIVE'};
      j.state='FAILED';j.error=String(b.error||'RENDER_FAILED').slice(0,160);j.finished_at=now();
      audit(s,j.id,'RENDER_FAILED');return{state:j.state};
    });
    return r.fail?err(r.fail,r.status):json({ok:true,state:'FAILED'});
  }
  if(typeof b.gpu_verified!=='boolean'||b.gpu_verified||job.render_device!=='CPU')return err('DEVICE_PROOF_MISMATCH',409);
  if(!Array.isArray(b.files)||b.files.length!==3)return err('WRONG_ARTIFACT_COUNT');
  const expected=new Set(['scene.blend','scene.glb','preview.png']);
  let total=0;const files=[];
  for(const f of b.files){
    if(!f||!expected.delete(f.name)||typeof f.data_base64!=='string'||f.data_base64.length>5_500_000||
       !/^[A-Za-z0-9+/]*={0,2}$/.test(f.data_base64))return err('INVALID_ARTIFACT');
    let bytes;try{bytes=Uint8Array.from(atob(f.data_base64),c=>c.charCodeAt(0))}catch{return err('INVALID_BASE64')}
    total+=bytes.length;
    if(bytes.length<1024||total>5_000_000||await sha256(bytes)!==f.sha256)return err('INVALID_ARTIFACT_HASH',409);
    if(!validArtifactHeader(f.name,bytes))return err('INVALID_ARTIFACT_FORMAT',409);
    files.push({name:f.name,bytes,sha256:f.sha256});
  }
  if(expected.size)return err('MISSING_ARTIFACT');
  // Assets are immutable. If a prior callback attempt wrote them, compare hashes.
  for(const f of files){
    const key='jobs/'+job.id+'/'+f.name;
    const previous=await env.STUDIO_ASSETS.head(key);
    if(previous){
      if(previous.size!==f.bytes.length||previous.customMetadata?.sha256!==f.sha256)return err('ARTIFACT_COLLISION',409);
    }else{
      const saved=await env.STUDIO_ASSETS.put(key,f.bytes,{
        onlyIf:new Headers({'If-None-Match':'*'}),
        httpMetadata:{contentType:assetType(f.name)},
        customMetadata:{sha256:f.sha256}
      });
      if(!saved){
        const after=await env.STUDIO_ASSETS.head(key);
        if(!after||after.size!==f.bytes.length||after.customMetadata?.sha256!==f.sha256)return err('ARTIFACT_COLLISION',409);
      }
    }
  }
  const r=await atomic(env,s=>{
    const j=s.jobs.find(x=>x.id===b.job_id);
    if(!j||!['DISPATCHING','RUNNING'].includes(j.state))return{fail:'JOB_NOT_ACTIVE'};
    if(j.payload_sha256!==b.input_sha256)return{fail:'JOB_INPUT_HASH_MISMATCH'};
    j.assets=Object.fromEntries(files.map(f=>[f.name,{key:'jobs/'+j.id+'/'+f.name,sha256:f.sha256,bytes:f.bytes.length}]));
    j.state='COMPLETED';j.finished_at=now();audit(s,j.id,'RENDER_COMPLETED',{gpu_verified:false});
    return{state:j.state};
  });
  return r.fail?err(r.fail,r.status):json({ok:true,state:'COMPLETED'});
}
async function api(req,env,url){
  if(req.method==='POST'&&url.pathname==='/internal/callback')return callback(req,env);
  if(!auth(req,env))return err('UNAUTHORIZED',401);
  if(!env.STUDIO_ASSETS||!env.STUDIO_ADMIN_TOKEN||env.STUDIO_ADMIN_TOKEN.length<32)return err('STUDIO_NOT_CONFIGURED',503);
  if(req.method==='GET'&&url.pathname==='/api/status')return json({
    ok:true,product:'MUSITU Studio',version:'0.8-r2-pilot',
    backend:'R2_CAS_SINGLE_ADMIN',dispatch_enabled:env.ENABLE_RENDER_DISPATCH==='true'&&env.BUDGET_GUARD_APPROVED==='true',
    gpu_execution_approved:false});
  if(req.method==='GET'&&url.pathname==='/api/projects'){
    const {state}=await loadState(env);
    return json({ok:true,projects:state.projects.slice().reverse().slice(0,100)});
  }
  if(req.method==='POST'&&url.pathname==='/api/projects'){
    const b=await bodyJson(req);
    if(typeof b.title!=='string'||b.title.trim().length<1||b.title.trim().length>120)return err('INVALID_TITLE');
    const id=crypto.randomUUID(),created=now();
    const r=await atomic(env,s=>{
      if(s.projects.length>=MAXPROJECTS)return{fail:'PROJECT_LIMIT',status:507};
      s.projects.push({id,title:b.title.trim(),created_at:created});audit(s,null,'PROJECT_CREATED',{project_id:id});
      return {project_id:id};
    });
    return r.fail?err(r.fail,r.status):json({ok:true,project_id:id},201);
  }
  if(req.method==='GET'&&url.pathname==='/api/jobs'){
    const {state}=await loadState(env);
    return json({ok:true,jobs:state.jobs.slice().reverse().slice(0,100).map(trace)});
  }
  if(req.method==='POST'&&url.pathname==='/api/jobs'){
    const b=await bodyJson(req);
    if(typeof b.project_id!=='string'||!b.scene||!['CPU','GPU'].includes(b.device)||
       typeof b.submission_key!=='string'||!/^[A-Za-z0-9_-]{12,100}$/.test(b.submission_key))return err('INVALID_JOB_SUBMISSION');
    try{validateScene(b.scene)}catch{return err('INVALID_SCENE')}
    const input=JSON.stringify(b.scene),digest=await sha256(input),id=crypto.randomUUID(),created=now();
    const r=await atomic(env,s=>{
      if(!s.projects.some(p=>p.id===b.project_id))return{fail:'PROJECT_NOT_FOUND',status:404};
      const previous=s.jobs.find(j=>j.submission_key===b.submission_key);
      if(previous){
        if(previous.project_id!==b.project_id||previous.render_device!==b.device||previous.payload_sha256!==digest)
          return{fail:'SUBMISSION_KEY_CONFLICT'};
        return{duplicate:true,job:trace(previous)};
      }
      if(s.jobs.length>=MAXJOBS)return{fail:'JOB_LIMIT',status:507};
      s.jobs.push({id,project_id:b.project_id,submission_key:b.submission_key,
        payload_json:input,payload_sha256:digest,render_device:b.device,
        state:'PENDING_APPROVAL',created_at:created});
      audit(s,id,'JOB_SUBMITTED',{device:b.device});
      return{job_id:id,state:'PENDING_APPROVAL'};
    });
    return r.fail?err(r.fail,r.status):json({ok:true,...r.data},r.data.duplicate?200:201);
  }
  const m=url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})(?:\/(approve|dispatch|assets\/([a-z.]+)))?$/);
  if(!m)return err('NOT_FOUND',404);
  const id=m[1],action=m[2]||'';
  const {state}=await loadState(env),job=state.jobs.find(j=>j.id===id);
  if(!job)return err('JOB_NOT_FOUND',404);
  if(req.method==='GET'&&!action)return json({ok:true,job:trace(job)});
  if(req.method==='GET'&&action.startsWith('assets/')){
    const name=m[3],meta=job.assets?.[name];
    if(job.state!=='COMPLETED'||!assetType(name))return err('ARTIFACT_NOT_READY',409);
    if(!meta)return err('ARTIFACT_NOT_FOUND',404);
    const object=await env.STUDIO_ASSETS.get(meta.key);
    if(!object)return err('ARTIFACT_STORAGE_MISSING',503);
    const bytes=new Uint8Array(await object.arrayBuffer());
    if(bytes.length!==meta.bytes||await sha256(bytes)!==meta.sha256||!validArtifactHeader(name,bytes))
      return err('ARTIFACT_INTEGRITY_FAILURE',409);
    return new Response(bytes,{headers:{'content-type':assetType(name),
      'content-disposition':'attachment; filename="'+name+'"','cache-control':'no-store',
      'x-content-type-options':'nosniff','x-artifact-sha256':meta.sha256}});
  }
  if(req.method==='POST'&&action==='approve'){
    const r=await atomic(env,s=>{
      const j=s.jobs.find(x=>x.id===id);
      if(!j||j.state!=='PENDING_APPROVAL')return{fail:'INVALID_APPROVAL_STATE'};
      j.state='APPROVED';j.approved_at=now();audit(s,id,'JOB_APPROVED');
      return{state:j.state};
    });
    return r.fail?err(r.fail,r.status):json({ok:true,...r.data});
  }
  if(req.method==='POST'&&action==='dispatch'){
    if(env.ENABLE_RENDER_DISPATCH!=='true'||env.BUDGET_GUARD_APPROVED!=='true')return err('DISPATCH_GATE_CLOSED',503);
    if(job.render_device!=='CPU')return err('GPU_PAYMENT_METHOD_REQUIRED',503);
    let destination;
    try{destination=new URL(env.STUDIO_MODAL_URL)}catch{return err('MODAL_URL_MISSING',503)}
    if(destination.protocol!=='https:'||!destination.hostname.endsWith('.modal.run')||
       destination.pathname!=='/jobs')return err('MODAL_DESTINATION_REJECTED',503);
    if(!env.STUDIO_MODAL_CONTROL_KEY||env.STUDIO_MODAL_CONTROL_KEY.length<32)return err('MODAL_CONTROL_KEY_MISSING',503);
    const started=await atomic(env,s=>{
      const j=s.jobs.find(x=>x.id===id);
      if(!j||j.state!=='APPROVED')return{fail:'JOB_NOT_APPROVED'};
      j.state='DISPATCHING';audit(s,id,'DISPATCH_STARTED',{device:'CPU'});
      return{state:j.state};
    });
    if(started.fail)return err(started.fail,started.status);
    try{
      const response=await fetch(destination.href,{method:'POST',headers:{
        'content-type':'application/json','x-studio-control-key':env.STUDIO_MODAL_CONTROL_KEY},
        body:JSON.stringify({job_id:id,scene_json:job.payload_json,
          input_sha256:job.payload_sha256,device:'CPU'}),signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error('MODAL_HTTP_'+response.status);
      const ack=await atomic(env,s=>{
        const j=s.jobs.find(x=>x.id===id);
        if(j?.state==='COMPLETED'||j?.state==='FAILED')return{state:j.state};
        if(j?.state!=='DISPATCHING')return{fail:'DISPATCH_STATE_MISMATCH'};
        j.state='RUNNING';audit(s,id,'DISPATCH_ACCEPTED');
        return{state:j.state};
      });
      return ack.fail?err(ack.fail,ack.status):json({ok:true,job_id:id,state:ack.data.state},202);
    }catch{
      await atomic(env,s=>{const j=s.jobs.find(x=>x.id===id);
        if(j?.state==='DISPATCHING'){j.state='FAILED';j.error='MODAL_DISPATCH_UNAVAILABLE';j.finished_at=now();audit(s,id,'DISPATCH_FAILED')}
        return{state:j?.state};
      });
      return err('DISPATCH_FAILED',502);
    }
  }
  return err('METHOD_NOT_ALLOWED',405);
}
export default {async fetch(req,env){
  const url=new URL(req.url);
  if(url.pathname!=='/internal/callback'&&!await validateAccess(req,env))return err('ACCESS_DENIED',403);
  if(!url.pathname.startsWith('/api/')&&url.pathname!=='/internal/callback')
    return env.ASSETS?env.ASSETS.fetch(req):err('NO_ASSETS',404);
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)){
    const origin=req.headers.get('origin');
    if(origin&&origin!==url.origin)return err('FOREIGN_ORIGIN',403);
  }
  try{return await api(req,env,url)}
  catch(e){
    if(e.message==='PAYLOAD_TOO_LARGE')return err('PAYLOAD_TOO_LARGE',413);
    if(e instanceof SyntaxError)return err('INVALID_JSON',400);
    return err('REQUEST_FAILED',500);
  }
}};
