import {verifiedV03Identity} from './v03_identity.mjs';
import {validateScene,sha256,equalSecret,assetType,validArtifactHeader} from './validation.mjs';
import {allowed,globalAdmin,validSubject,UUID,GLB_FILES,safeDailyLimit,securityHeaders,safeObjectKey,isModalDestination} from './v03_policy.mjs';

const headers=securityHeaders(), now=()=>new Date().toISOString();
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
const err=(value,status=400)=>json({ok:false,error:value},status);
const q=(db,sql,...values)=>db.prepare(sql).bind(...values);
const rows=async statement=>(await statement.all()).results||[];
const trace=(j,actor)=>({id:j.id,project_id:j.project_id,device:j.render_device,state:j.state,
  created_at:j.created_at,approved_at:j.approved_at,dispatched_at:j.dispatched_at,
  finished_at:j.finished_at,sha256:j.payload_sha256,error:j.error_code||null,created_by_me:actor?.sub===j.created_by_sub});
async function readJson(req,limit=65536){
  if(req.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')throw Error('CONTENT_TYPE');
  const declared=req.headers.get('content-length');
  if(declared&&(!/^[0-9]+$/.test(declared)||Number(declared)>limit))throw Error('TOO_LARGE');
  const reader=req.body?.getReader();if(!reader)throw Error('INVALID_BODY');
  const parts=[];let n=0;
  try{while(true){const x=await reader.read();if(x.done)break;n+=x.value.byteLength;
      if(n>limit){await reader.cancel();throw Error('TOO_LARGE')}parts.push(x.value)}
  }finally{reader.releaseLock()}
  const all=new Uint8Array(n);let i=0;for(const p of parts){all.set(p,i);i+=p.length}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
}
function configured(env){return Boolean(env.STUDIO_DB&&env.STUDIO_ASSETS&&
  typeof env.STUDIO_MODAL_CALLBACK_KEY==='string'&&env.STUDIO_MODAL_CALLBACK_KEY.length>=32)}
function cpuReady(env){return env.ENABLE_RENDER_DISPATCH==='true'&&
  env.BUDGET_GUARD_APPROVED==='true'&&isModalDestination(env.STUDIO_MODAL_URL)&&
  typeof env.STUDIO_MODAL_CONTROL_KEY==='string'&&env.STUDIO_MODAL_CONTROL_KEY.length>=32}
const auditStmt=(env,p,j,action,subject,details={})=>q(env.STUDIO_DB,
  'INSERT INTO audit_events(id,project_id,job_id,action,actor_sub,at,details) VALUES(?,?,?,?,?,?,?)',
  crypto.randomUUID(),p,j,action,subject,now(),JSON.stringify(details));
const audit=async (...args)=>(await auditStmt(...args).run());
async function permit(env,id,actor,operation){
  const m=await q(env.STUDIO_DB,
    'SELECT role FROM memberships WHERE project_id=? AND member_sub=?',id,actor.sub).first();
  return allowed(env,actor.sub,m?.role||null,operation);
}
function remotePath(env,path){return new URL(env.STUDIO_MODAL_URL).origin+'/jobs/'+path}
async function complete(env,b){
  if(!b||!UUID.test(b.job_id||'')||!['COMPLETED','FAILED'].includes(b.state))
    return err('INVALID_CALLBACK');
  const j=await q(env.STUDIO_DB,'SELECT * FROM jobs WHERE id=?',b.job_id).first();
  if(!j||j.payload_sha256!==b.input_sha256)return err('UNKNOWN_JOB_OR_HASH',409);
  if(j.state==='COMPLETED'&&b.state==='COMPLETED'){
    const meta=await rows(q(env.STUDIO_DB,'SELECT filename,sha256 FROM assets WHERE job_id=?',j.id));
    return meta.length===3&&Array.isArray(b.files)&&b.files.every(f=>meta.some(a=>a.filename===f.name&&a.sha256===f.sha256))
      ?json({ok:true,state:'COMPLETED',duplicate:true}):err('CALLBACK_CONFLICT',409);
  }
  if(j.state!=='RUNNING'&&j.state!=='DISPATCHING')return err('JOB_NOT_ACTIVE',409);
  if(b.state==='FAILED'){
    const u=await q(env.STUDIO_DB,"UPDATE jobs SET state='FAILED',error_code='RENDER_FAILED',finished_at=? WHERE id=? AND state IN ('RUNNING','DISPATCHING')",now(),j.id).run();
    if(u.meta?.changes!==1)return err('RESULT_RACE',409);
    await audit(env,j.project_id,j.id,'RENDER_FAILED',null);
    return json({ok:true,state:'FAILED'});
  }
  if(j.render_device!=='CPU'||b.gpu_verified!==false||!Array.isArray(b.files)||b.files.length!==3)
    return err('DEVICE_OR_ARTIFACT_MISMATCH',409);
  const needed=new Set(GLB_FILES),items=[];let total=0;
  for(const f of b.files){
    if(!f||!needed.delete(f.name)||typeof f.data_base64!=='string'||
       f.data_base64.length>5_500_000||!/^[a-zA-Z0-9+/]*={0,2}$/.test(f.data_base64))
      return err('INVALID_ARTIFACT');
    let bytes;
    try{bytes=Uint8Array.from(atob(f.data_base64),c=>c.charCodeAt(0))}catch{return err('INVALID_BASE64')}
    total+=bytes.length;
    if(bytes.length<1024||total>5_000_000||await sha256(bytes)!==f.sha256||
       !validArtifactHeader(f.name,bytes))return err('ASSET_HASH_OR_FORMAT',409);
    items.push({name:f.name,bytes,sha:f.sha256});
  }
  if(needed.size)return err('MISSING_ARTIFACT');
  for(const f of items){
    const key=safeObjectKey(j.id,f.name);
    const previous=await env.STUDIO_ASSETS.head(key);
    if(previous){
      if(previous.size!==f.bytes.length||previous.customMetadata?.sha256!==f.sha)
        return err('IMMUTABLE_ASSET_COLLISION',409);
      const original=await env.STUDIO_ASSETS.get(key);
      if(!original||await sha256(new Uint8Array(await original.arrayBuffer()))!==f.sha)
        return err('EXISTING_OBJECT_INTEGRITY_FAILURE',409);
    }else{
      const saved=await env.STUDIO_ASSETS.put(key,f.bytes,{
        onlyIf:new Headers({'If-None-Match':'*'}),
        customMetadata:{sha256:f.sha},httpMetadata:{contentType:assetType(f.name)}
      });
      if(!saved){
        const newer=await env.STUDIO_ASSETS.get(key);
        if(!newer||await sha256(new Uint8Array(await newer.arrayBuffer()))!==f.sha)
          return err('CONCURRENT_ASSET_COLLISION',409);
      }
    }
  }
  try{
    const statements=items.map(f=>q(env.STUDIO_DB,
      'INSERT INTO assets(job_id,filename,object_key,sha256,bytes) VALUES(?,?,?,?,?) ON CONFLICT(job_id,filename) DO NOTHING',
      j.id,f.name,safeObjectKey(j.id,f.name),f.sha,f.bytes.length));
    statements.push(q(env.STUDIO_DB,
      "UPDATE jobs SET state='COMPLETED',finished_at=? WHERE id=? AND state IN ('RUNNING','DISPATCHING')",now(),j.id));
    statements.push(auditStmt(env,j.project_id,j.id,'RENDER_COMPLETED',null,{gpu_verified:false}));
    const result=await env.STUDIO_DB.batch(statements);
    if(result[3]?.meta?.changes!==1)return err('RESULT_STATE_CONFLICT',409);
  }catch{return err('RESULT_TRANSACTION_FAILED',503)}
  return json({ok:true,state:'COMPLETED'});
}
async function api(req,env,url,actor){
  const path=url.pathname;
  if(req.method==='GET'&&path==='/api/session')
    return json({ok:true,role:globalAdmin(env,actor.sub)?'global_admin':'staff',subject:actor.sub});
  if(req.method==='GET'&&path==='/api/status')
    return json({ok:true,version:'0.3-d1-enterprise',backend:'D1_MULTIUSER',
      dispatch_enabled:cpuReady(env),gpu_execution_approved:false,
      daily_cpu_dispatch_limit:safeDailyLimit(env.STUDIO_V03_DAILY_CPU_LIMIT)});
  if(req.method==='GET'&&path==='/api/projects'){
    const statement=globalAdmin(env,actor.sub)
      ?q(env.STUDIO_DB,'SELECT id,title,created_at FROM projects ORDER BY created_at DESC LIMIT 100')
      :q(env.STUDIO_DB,'SELECT p.id,p.title,p.created_at,m.role FROM projects p JOIN memberships m ON p.id=m.project_id WHERE m.member_sub=? ORDER BY p.created_at DESC LIMIT 100',actor.sub);
    return json({ok:true,projects:await rows(statement)});
  }
  if(req.method==='POST'&&path==='/api/projects'){
    const data=await readJson(req);
    if(typeof data?.title!=='string'||!data.title.trim()||data.title.trim().length>120)return err('INVALID_TITLE');
    const id=crypto.randomUUID(),stamp=now();
    await env.STUDIO_DB.batch([
      q(env.STUDIO_DB,'INSERT INTO projects(id,title,owner_sub,created_at) VALUES(?,?,?,?)',id,data.title.trim(),actor.sub,stamp),
      q(env.STUDIO_DB,"INSERT INTO memberships(project_id,member_sub,role,created_at) VALUES(?,?,'owner',?)",id,actor.sub,stamp),
      auditStmt(env,id,null,'PROJECT_CREATED',actor.sub)
    ]);
    return json({ok:true,project_id:id},201);
  }
  const members=path.match(/^\/api\/projects\/([a-f0-9-]{36})\/members$/);
  if(members&&UUID.test(members[1])){
    const id=members[1],p=await q(env.STUDIO_DB,'SELECT owner_sub FROM projects WHERE id=?',id).first();
    if(!p)return err('PROJECT_NOT_FOUND',404);
    if(!await permit(env,id,actor,'invite'))return err('FORBIDDEN',403);
    if(req.method==='GET'){
      return json({ok:true,members:await rows(q(env.STUDIO_DB,
        'SELECT member_sub,role,created_at FROM memberships WHERE project_id=? LIMIT 100',id))});
    }
    if(req.method==='POST'){
      const b=await readJson(req,4096);
      if(!validSubject(b?.member_sub)||!['owner','editor','reviewer','viewer'].includes(b.role))
        return err('INVALID_MEMBER');
      if(b.role==='owner'&&!globalAdmin(env,actor.sub))return err('OWNER_GRANT_ADMIN_ONLY',403);
      if(b.member_sub===p.owner_sub&&b.role!=='owner')return err('PROJECT_FOUNDER_IMMUTABLE',409);
      await env.STUDIO_DB.batch([
        q(env.STUDIO_DB,'INSERT INTO memberships(project_id,member_sub,role,created_at) VALUES(?,?,?,?) ON CONFLICT(project_id,member_sub) DO UPDATE SET role=excluded.role',
          id,b.member_sub,b.role,now()),
        auditStmt(env,id,null,'MEMBERSHIP_SET',actor.sub,{role:b.role})
      ]);
      return json({ok:true});
    }
    return err('METHOD_NOT_ALLOWED',405);
  }
  if(req.method==='GET'&&path==='/api/jobs'){
    const statement=globalAdmin(env,actor.sub)
      ?q(env.STUDIO_DB,'SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100')
      :q(env.STUDIO_DB,'SELECT j.* FROM jobs j JOIN memberships m ON m.project_id=j.project_id WHERE m.member_sub=? ORDER BY j.created_at DESC LIMIT 100',actor.sub);
    return json({ok:true,jobs:(await rows(statement)).map(j=>trace(j,actor))});
  }
  if(req.method==='POST'&&path==='/api/jobs'){
    const b=await readJson(req);
    if(!UUID.test(b?.project_id||'')||b.device!=='CPU'||typeof b.submission_key!=='string'||
       !/^[a-zA-Z0-9_-]{12,100}$/.test(b.submission_key))return err('INVALID_JOB_SUBMISSION');
    if(!await q(env.STUDIO_DB,'SELECT id FROM projects WHERE id=?',b.project_id).first())return err('PROJECT_NOT_FOUND',404);
    if(!await permit(env,b.project_id,actor,'submit'))return err('FORBIDDEN',403);
    try{validateScene(b.scene)}catch{return err('INVALID_SCENE')}
    const raw=JSON.stringify(b.scene),digest=await sha256(raw);
    if(raw.length>65536)return err('SCENE_TOO_LARGE',413);
    const old=await q(env.STUDIO_DB,'SELECT * FROM jobs WHERE submission_key=?',b.submission_key).first();
    if(old){
      if(old.project_id!==b.project_id||old.created_by_sub!==actor.sub||
         old.payload_sha256!==digest)return err('SUBMISSION_KEY_CONFLICT',409);
      return json({ok:true,duplicate:true,job:trace(old,actor)});
    }
    const id=crypto.randomUUID();
    try{
      await env.STUDIO_DB.batch([
        q(env.STUDIO_DB,"INSERT INTO jobs(id,project_id,submission_key,payload_json,payload_sha256,render_device,state,created_by_sub,created_at) VALUES(?,?,?,?,?,'CPU','PENDING_APPROVAL',?,?)",
          id,b.project_id,b.submission_key,raw,digest,actor.sub,now()),
        auditStmt(env,b.project_id,id,'JOB_SUBMITTED',actor.sub,{device:'CPU'})
      ]);
    }catch{return err('CONCURRENT_SUBMISSION_RETRY_LOOKUP',409)}
    return json({ok:true,job_id:id,state:'PENDING_APPROVAL'},201);
  }
  const parts=path.match(/^\/api\/jobs\/([a-f0-9-]{36})(?:\/(approve|dispatch|sync|audit|assets\/([a-z.]+)))?$/);
  if(!parts||!UUID.test(parts[1]))return err('NOT_FOUND',404);
  const id=parts[1],action=parts[2]||'';
  const job=await q(env.STUDIO_DB,'SELECT * FROM jobs WHERE id=?',id).first();
  if(!job)return err('JOB_NOT_FOUND',404);
  const capability=['approve','dispatch','sync'].includes(action)?'approve':action==='audit'?'audit':'view';
  if(!await permit(env,job.project_id,actor,capability))return err('FORBIDDEN',403);
  if(req.method==='GET'&&!action)return json({ok:true,job:trace(job,actor)});
  if(req.method==='GET'&&action==='audit')
    return json({ok:true,events:await rows(q(env.STUDIO_DB,'SELECT action,actor_sub,at FROM audit_events WHERE job_id=? ORDER BY at DESC LIMIT 100',id))});
  if(req.method==='GET'&&action.startsWith('assets/')){
    const name=parts[3];
    if(job.state!=='COMPLETED'||!GLB_FILES.includes(name))return err('ASSET_NOT_READY',409);
    const meta=await q(env.STUDIO_DB,'SELECT * FROM assets WHERE job_id=? AND filename=?',id,name).first();
    if(!meta||meta.object_key!==safeObjectKey(id,name))return err('ASSET_NOT_FOUND',404);
    const blob=await env.STUDIO_ASSETS.get(meta.object_key);
    if(!blob||blob.size>5_000_000)return err('ASSET_UNAVAILABLE',503);
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(bytes.length!==meta.bytes||await sha256(bytes)!==meta.sha256||!validArtifactHeader(name,bytes))
      return err('ASSET_INTEGRITY_FAILED',409);
    return new Response(bytes,{headers:{'content-type':assetType(name),
      'content-disposition':'attachment; filename="'+name+'"','cache-control':'no-store',
      'x-content-type-options':'nosniff','x-artifact-sha256':meta.sha256}});
  }
  if(req.method==='POST'&&action==='approve'){
    if(actor.sub===job.created_by_sub)return err('SEPARATION_OF_DUTIES',403);
    const outcome=await q(env.STUDIO_DB,
      "UPDATE jobs SET state='APPROVED',approved_by_sub=?,approved_at=? WHERE id=? AND state='PENDING_APPROVAL'",
      actor.sub,now(),id).run();
    if(outcome.meta?.changes!==1)return err('NOT_PENDING_APPROVAL',409);
    await audit(env,job.project_id,id,'JOB_APPROVED',actor.sub);
    return json({ok:true,state:'APPROVED'});
  }
  if(req.method==='POST'&&action==='dispatch'){
    if(!cpuReady(env))return err('CPU_DISPATCH_GATES_CLOSED',503);
    if(job.render_device!=='CPU'||!job.approved_by_sub||job.approved_by_sub===job.created_by_sub)
      return err('APPROVAL_EVIDENCE_MISSING',409);
    const t=now(),max=safeDailyLimit(env.STUDIO_V03_DAILY_CPU_LIMIT);
    const moved=await q(env.STUDIO_DB,
      "UPDATE jobs SET state='DISPATCHING',dispatched_at=?,dispatched_by_sub=? WHERE id=? AND state='APPROVED' AND (SELECT COUNT(*) FROM jobs WHERE state IN ('RUNNING','DISPATCHING'))<2 AND (SELECT COUNT(*) FROM jobs WHERE dispatched_at>=substr(?,1,10) AND dispatched_at<date(substr(?,1,10),'+1 day'))<?",
      t,actor.sub,id,t,t,max).run();
    if(moved.meta?.changes!==1)return err('DISPATCH_CONCURRENCY_OR_DAILY_CAP',429);
    await audit(env,job.project_id,id,'DISPATCH_STARTED',actor.sub);
    try{
      const response=await fetch(remotePath(env,'pull'),{method:'POST',headers:{
        'content-type':'application/json','x-studio-control-key':env.STUDIO_MODAL_CONTROL_KEY},
        body:JSON.stringify({job_id:id,scene_json:job.payload_json,input_sha256:job.payload_sha256,device:'CPU'}),
        signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error('REMOTE_ACK_ERROR');
      const remote=await response.json();
      if(remote.accepted!==true||remote.job_id!==id||!/^fc-[a-zA-Z0-9_-]{8,128}$/.test(remote.call_id||''))
        throw Error('INVALID_ACK');
      const ack=await q(env.STUDIO_DB,"UPDATE jobs SET state='RUNNING',call_id=? WHERE id=? AND state='DISPATCHING'",remote.call_id,id).run();
      if(ack.meta?.changes!==1)return err('ACK_RACE',409);
      await audit(env,job.project_id,id,'DISPATCH_ACCEPTED',null,{mode:'PULL'});
      return json({ok:true,state:'RUNNING',job_id:id},202);
    }catch{
      await q(env.STUDIO_DB,"UPDATE jobs SET state='NEEDS_REVIEW',error_code='UNKNOWN_REMOTE_OUTCOME' WHERE id=? AND state='DISPATCHING'",id).run();
      await audit(env,job.project_id,id,'DISPATCH_AMBIGUOUS_NO_RETRY',null);
      return err('DISPATCH_OUTCOME_UNKNOWN_NO_AUTOMATIC_RETRY',502);
    }
  }
  if(req.method==='POST'&&action==='sync'){
    if(['COMPLETED','FAILED'].includes(job.state))return json({ok:true,state:job.state});
    if(job.state!=='RUNNING'||!/^fc-[a-zA-Z0-9_-]{8,128}$/.test(job.call_id||''))
      return err('JOB_NOT_POLLABLE',409);
    if(!cpuReady(env))return err('MODAL_POLL_GATED',503);
    let remote;
    try{
      const response=await fetch(remotePath(env,'pull/'+job.call_id),{
        headers:{'x-studio-control-key':env.STUDIO_MODAL_CONTROL_KEY},signal:AbortSignal.timeout(20000)});
      if(response.status===202)return json({ok:true,state:'RUNNING'},202);
      if(!response.ok)throw Error('REMOTE_POLL');
      remote=await response.json();
    }catch{return err('REMOTE_POLL_UNAVAILABLE',502)}
    const output=remote?.result;
    if(remote?.state!=='COMPLETED'||output?.result!=='FINISHED'||
       output.input_sha256!==job.payload_sha256||output.job_id!==id||output.gpu_verified!==false)
      return err('MODAL_RESULT_INTEGRITY_MISMATCH',409);
    return complete(env,{job_id:id,input_sha256:output.input_sha256,
      state:'COMPLETED',gpu_verified:false,files:output.files});
  }
  return err('METHOD_NOT_ALLOWED',405);
}
export function createV03Worker({identify=verifiedV03Identity}={}){
  return {async fetch(req,env){
    const url=new URL(req.url);
    if(!configured(env))return err('V03_D1_NOT_BOUND',503);
    if(url.pathname==='/internal/callback'&&req.method==='POST'){
      const auth=req.headers.get('authorization')||'';
      if(!equalSecret(auth.startsWith('Bearer ')?auth.slice(7):'',env.STUDIO_MODAL_CALLBACK_KEY))
        return err('UNAUTHORIZED_CALLBACK',401);
      try{return await complete(env,await readJson(req,7_500_000))}
      catch{return err('INVALID_CALLBACK',400)}
    }
    const actor=await identify(req,env);
    if(!actor||!validSubject(actor.sub))return err('ACCESS_DENIED',403);
    if(!url.pathname.startsWith('/api/')){
      if(!['GET','HEAD'].includes(req.method))return err('METHOD_NOT_ALLOWED',405);
      return env.ASSETS?env.ASSETS.fetch(req):err('STATIC_ASSETS_UNAVAILABLE',503);
    }
    if(['POST','PUT','PATCH','DELETE'].includes(req.method)){
      if(req.headers.get('origin')!==url.origin)return err('SAME_ORIGIN_REQUIRED',403);
      if(!['same-origin','none',null].includes(req.headers.get('sec-fetch-site')))
        return err('CROSS_SITE_REJECTED',403);
    }
    try{return await api(req,env,url,actor)}
    catch(e){
      if(e?.message==='TOO_LARGE')return err('BODY_TOO_LARGE',413);
      if(e?.message==='CONTENT_TYPE')return err('JSON_CONTENT_TYPE_REQUIRED',415);
      if(e instanceof SyntaxError||e instanceof TypeError||e?.message==='INVALID_BODY')return err('INVALID_JSON',400);
      return err('REQUEST_FAILED',500);
    }
  }};
}
export default createV03Worker();
