import {validateAccess} from './access.mjs';
import {validateScene,sha256,equalSecret,assetType,validArtifactHeader} from './validation.mjs';
const DEFAULT_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer'};
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:DEFAULT_HEADERS});
const err=(code,status=400)=>json({ok:false,error:code},status);
const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
const now=()=>new Date().toISOString();
function auth(req,env,type='admin'){
  const key=type==='callback'?env.STUDIO_MODAL_CALLBACK_KEY:env.STUDIO_ADMIN_TOKEN;
  const supplied=req.headers.get('authorization')||'';
  return equalSecret(supplied.startsWith('Bearer ')?supplied.slice(7):'',key);
}
async function bodyJson(req,max=65536){
  const length=req.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max))throw new Error('PAYLOAD_TOO_LARGE');
  if(!req.body)throw new SyntaxError('MISSING_BODY');
  const reader=req.body.getReader();
  const chunks=[];let size=0;
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>max){await reader.cancel();throw new Error('PAYLOAD_TOO_LARGE');}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let position=0;
  for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function traceJob(row){
  if(!row)return null;
  return {id:row.id,project_id:row.project_id,payload_sha256:row.payload_sha256,
    device:row.render_device,state:row.state,error:row.error,created_at:row.created_at,
    approved_at:row.approved_at,finished_at:row.finished_at};
}
async function event(env,jobId,action,details={}){
  await statement(env.STUDIO_DB,'INSERT INTO audit_events(id,job_id,action,at,details) VALUES(?,?,?,?,?)',crypto.randomUUID(),jobId,action,now(),JSON.stringify(details)).run();
}
function checkBindings(env){
  return Boolean(env.STUDIO_DB&&env.STUDIO_ASSETS&&typeof env.STUDIO_ADMIN_TOKEN==='string'&&env.STUDIO_ADMIN_TOKEN.length>=32);
}
async function callback(req,env){
  if(!auth(req,env,'callback'))return err('UNAUTHORIZED',401);
  let b;try{b=await bodyJson(req,7500000)}catch(e){return e.message==='PAYLOAD_TOO_LARGE'?err('PAYLOAD_TOO_LARGE',413):err('INVALID_CALLBACK');}
  if(!b||typeof b.job_id!=='string'||!['COMPLETED','FAILED'].includes(b.state))return err('INVALID_CALLBACK');
  const row=await statement(env.STUDIO_DB,'SELECT * FROM jobs WHERE id=?',b.job_id).first();
  if(!row||!['DISPATCHING','RUNNING'].includes(row.state))return err('JOB_NOT_ACTIVE',409);
  if(b.input_sha256!==row.payload_sha256)return err('JOB_INPUT_HASH_MISMATCH',409);
  if(b.state==='FAILED'){
    const outcome=await statement(env.STUDIO_DB,"UPDATE jobs SET state='FAILED',error=?,finished_at=? WHERE id=? AND state IN ('DISPATCHING','RUNNING')",String(b.error||'RENDER_FAILED').slice(0,200),now(),row.id).run();
    if(outcome.meta?.changes!==1)return err('CONCURRENT_STATE_CHANGE',409);
    await event(env,row.id,'RENDER_FAILED');
    return json({ok:true,state:'FAILED'});
  }
  if(typeof b.gpu_verified!=='boolean'||(row.render_device==='GPU')!==b.gpu_verified)return err('DEVICE_PROOF_MISMATCH',409);
  if(!Array.isArray(b.files)||b.files.length!==3)return err('WRONG_ARTIFACT_COUNT',400);
  const expected=new Set(['scene.blend','scene.glb','preview.png']);
  const decoded=[];
  let total=0;
  for(const f of b.files){
    if(!f||!expected.delete(f.name)||typeof f.data_base64!=='string'||f.data_base64.length>5500000||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.data_base64))return err('INVALID_ARTIFACT');
    let bytes;try{bytes=Uint8Array.from(atob(f.data_base64),c=>c.charCodeAt(0));}catch{return err('INVALID_BASE64');}
    total+=bytes.length;
    if(bytes.length<1024||total>5000000||(await sha256(bytes))!==f.sha256)return err('INVALID_ARTIFACT_HASH',409);
    if(!validArtifactHeader(f.name,bytes))return err('INVALID_ARTIFACT_FORMAT',409);
    decoded.push({name:f.name,bytes,sha256:f.sha256});
  }
  if(expected.size)return err('MISSING_ARTIFACT');
  for(const f of decoded){
    const key='jobs/'+row.id+'/'+f.name;
    await env.STUDIO_ASSETS.put(key,f.bytes,{httpMetadata:{contentType:assetType(f.name)},customMetadata:{sha256:f.sha256}});
    await statement(env.STUDIO_DB,'INSERT INTO assets(job_id,filename,object_key,sha256,bytes) VALUES(?,?,?,?,?) ON CONFLICT(job_id,filename) DO NOTHING',row.id,f.name,key,f.sha256,f.bytes.length).run();
  }
  const update=await statement(env.STUDIO_DB,"UPDATE jobs SET state='COMPLETED',finished_at=? WHERE id=? AND state IN ('DISPATCHING','RUNNING')",now(),row.id).run();
  if(update.meta?.changes!==1)return err('CONCURRENT_STATE_CHANGE',409);
  await event(env,row.id,'RENDER_COMPLETED',{gpu_verified:Boolean(b.gpu_verified)});
  return json({ok:true,state:'COMPLETED'});
}
async function api(req,env,url){
  if(req.method==='POST'&&url.pathname==='/internal/callback')return callback(req,env);
  if(!auth(req,env))return err('UNAUTHORIZED',401);
  if(!checkBindings(env))return err('STUDIO_NOT_CONFIGURED',503);
  if(req.method==='GET'&&url.pathname==='/api/status')return json({ok:true,product:'MUSITU Studio',version:'0.2',dispatch_enabled:env.ENABLE_RENDER_DISPATCH==='true',gpu_execution_approved:env.GPU_EXECUTION_APPROVED==='true',billing_guard:'OPERATOR_MUST_VERIFY_PROVIDER_BUDGET'});
  if(req.method==='GET'&&url.pathname==='/api/projects'){
    const r=await env.STUDIO_DB.prepare('SELECT * FROM projects ORDER BY created_at DESC LIMIT 100').all();
    return json({ok:true,projects:r.results||[]});
  }
  if(req.method==='POST'&&url.pathname==='/api/projects'){
    const b=await bodyJson(req);
    if(typeof b.title!=='string'||b.title.trim().length<1||b.title.trim().length>120)return err('INVALID_TITLE');
    const id=crypto.randomUUID();
    await statement(env.STUDIO_DB,'INSERT INTO projects(id,title,created_at) VALUES(?,?,?)',id,b.title.trim(),now()).run();
    await event(env,null,'PROJECT_CREATED',{project_id:id});
    return json({ok:true,project_id:id},201);
  }
  if(req.method==='GET'&&url.pathname==='/api/jobs'){
    const r=await env.STUDIO_DB.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100').all();
    return json({ok:true,jobs:(r.results||[]).map(traceJob)});
  }
  if(req.method==='POST'&&url.pathname==='/api/jobs'){
    const b=await bodyJson(req);
    if(typeof b.project_id!=='string'||!b.scene||!['CPU','GPU'].includes(b.device)||typeof b.submission_key!=='string'||!(/^[A-Za-z0-9_-]{12,100}$/).test(b.submission_key))return err('INVALID_JOB_SUBMISSION');
    try{validateScene(b.scene)}catch{return err('INVALID_SCENE');}
    const project=await statement(env.STUDIO_DB,'SELECT id FROM projects WHERE id=?',b.project_id).first();
    if(!project)return err('PROJECT_NOT_FOUND',404);
    const input=JSON.stringify(b.scene),digest=await sha256(input);
    const existing=await statement(env.STUDIO_DB,'SELECT * FROM jobs WHERE submission_key=?',b.submission_key).first();
    if(existing){
      if(existing.project_id!==b.project_id||existing.render_device!==b.device||existing.payload_sha256!==digest)return err('SUBMISSION_KEY_CONFLICT',409);
      return json({ok:true,duplicate:true,job:traceJob(existing)});
    }
    const id=crypto.randomUUID();
    await statement(env.STUDIO_DB,'INSERT INTO jobs(id,project_id,submission_key,payload_json,payload_sha256,render_device,state,created_at) VALUES(?,?,?,?,?,?,?,?)',id,b.project_id,b.submission_key,input,digest,b.device,'PENDING_APPROVAL',now()).run();
    await event(env,id,'JOB_SUBMITTED',{device:b.device});
    return json({ok:true,job_id:id,state:'PENDING_APPROVAL'},201);
  }
  const m=url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})(?:\/(approve|dispatch|assets\/([a-z.]+)))?$/);
  if(!m)return err('NOT_FOUND',404);
  const id=m[1],action=m[2]||'';
  const row=await statement(env.STUDIO_DB,'SELECT * FROM jobs WHERE id=?',id).first();
  if(!row)return err('JOB_NOT_FOUND',404);
  if(req.method==='GET'&&!action)return json({ok:true,job:traceJob(row)});
  if(req.method==='GET'&&action.startsWith('assets/')){
    const filename=m[3];
    if(row.state!=='COMPLETED'||!assetType(filename))return err('ARTIFACT_NOT_READY',409);
    const meta=await statement(env.STUDIO_DB,'SELECT * FROM assets WHERE job_id=? AND filename=?',id,filename).first();
    if(!meta)return err('ARTIFACT_NOT_FOUND',404);
    const object=await env.STUDIO_ASSETS.get(meta.object_key);
    if(!object)return err('ASSET_STORAGE_MISSING',503);
    const bytes=new Uint8Array(await object.arrayBuffer());
    if(bytes.length!==meta.bytes||(await sha256(bytes))!==meta.sha256||!validArtifactHeader(filename,bytes))
      return err('R2_OBJECT_INTEGRITY_FAILURE',409);
    return new Response(bytes,{headers:{'content-type':assetType(filename),'content-disposition':'attachment; filename="'+filename+'"','cache-control':'no-store','x-content-type-options':'nosniff','x-artifact-sha256':meta.sha256}});
  }
  if(req.method==='POST'&&action==='approve'){
    const r=await statement(env.STUDIO_DB,"UPDATE jobs SET state='APPROVED',approved_at=? WHERE id=? AND state='PENDING_APPROVAL'",now(),id).run();
    if(r.meta?.changes!==1)return err('INVALID_APPROVAL_STATE',409);
    await event(env,id,'JOB_APPROVED');
    return json({ok:true,state:'APPROVED'});
  }
  if(req.method==='POST'&&action==='dispatch'){
    if(env.ENABLE_RENDER_DISPATCH!=='true'||env.BUDGET_GUARD_APPROVED!=='true')return err('ZERO_SPEND_GATE_CLOSED',503);
    if(row.render_device==='GPU'&&env.GPU_EXECUTION_APPROVED!=='true')return err('GPU_GATE_CLOSED',503);
    const endpoint=env.STUDIO_MODAL_URL;
    let uri;try{uri=new URL(endpoint)}catch{return err('MODAL_URL_UNCONFIGURED',503);}
    if(uri.protocol!=='https:'||!(uri.hostname==='modal.run'||uri.hostname.endsWith('.modal.run')))return err('UNAPPROVED_MODAL_DESTINATION',503);
    if(typeof env.STUDIO_MODAL_CONTROL_KEY!=='string'||env.STUDIO_MODAL_CONTROL_KEY.length<32)return err('MISSING_MODAL_AUTH',503);
    const r=await statement(env.STUDIO_DB,"UPDATE jobs SET state='DISPATCHING' WHERE id=? AND state='APPROVED'",id).run();
    if(r.meta?.changes!==1)return err('JOB_NOT_APPROVED',409);
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-studio-control-key':env.STUDIO_MODAL_CONTROL_KEY},body:JSON.stringify({job_id:id,scene_json:row.payload_json,input_sha256:row.payload_sha256,device:row.render_device}),signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error('MODAL_REJECTED_'+response.status);
      const ack=await statement(env.STUDIO_DB,"UPDATE jobs SET state='RUNNING' WHERE id=? AND state='DISPATCHING'",id).run();
      if(ack.meta?.changes!==1){
        const latest=await statement(env.STUDIO_DB,'SELECT * FROM jobs WHERE id=?',id).first();
        if(latest?.state==='COMPLETED'||latest?.state==='FAILED'){
          await event(env,id,'ACK_AFTER_CALLBACK',{terminal_state:latest.state});
          return json({ok:true,state:latest.state,job_id:id},202);
        }
        throw new Error('DISPATCH_STATE_CONFLICT');
      }
      await event(env,id,'DISPATCH_ACCEPTED',{device:row.render_device});
      return json({ok:true,state:'RUNNING',job_id:id},202);
    }catch(e){
      await statement(env.STUDIO_DB,"UPDATE jobs SET state='FAILED',error=?,finished_at=? WHERE id=? AND state='DISPATCHING'",String(e.message||'DISPATCH_FAILED').slice(0,120),now(),id).run();
      await event(env,id,'DISPATCH_FAILED');
      return err('DISPATCH_FAILED',502);
    }
  }
  return err('METHOD_NOT_ALLOWED',405);
}
export default {async fetch(request,env){
  const url=new URL(request.url);
  // Modal callbacks use their own strong shared key and remain excluded from
  // browser Cloudflare Access; all other paths require a signed Access JWT.
  if(url.pathname!=='/internal/callback'){
    if(!await validateAccess(request,env))return err('ACCESS_DENIED',403);
  }
  if(!url.pathname.startsWith('/api/')&&url.pathname!=='/internal/callback'){
    return env.ASSETS?env.ASSETS.fetch(request):err('NO_ASSETS',404);
  }
  if(['POST','PUT','PATCH','DELETE'].includes(request.method)){
    const origin=request.headers.get('origin');
    if(origin&&origin!==url.origin)return err('FOREIGN_ORIGIN',403);
  }
  try{return await api(request,env,url)}
  catch(e){
    if(e.message==='PAYLOAD_TOO_LARGE')return err('PAYLOAD_TOO_LARGE',413);
    if(e instanceof SyntaxError)return err('INVALID_JSON',400);
    // Do not expose D1, storage, account, or request details to clients.
    return err('REQUEST_FAILED',500);
  }
}};
