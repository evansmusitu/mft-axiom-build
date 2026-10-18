import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createV03Worker} from '../src/v03_entry.mjs';
import {globalAdmin,can,safeDailyLimit,safeObjectKey,isModalDestination} from '../src/v03_policy.mjs';

const base='http://127.0.0.1', sha=x=>createHash('sha256').update(x).digest('hex');
const uu='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
class D1 {
  constructor(){
    this.db=new DatabaseSync(':memory:');
    for(const n of ['0001_enterprise.sql','0002_runtime_guards.sql'])
      this.db.exec(readFileSync(new URL('../migrations/v03/'+n,import.meta.url),'utf8'));
  }
  prepare(query){
    const db=this.db, stmt=db.prepare(query);
    return {bind(...params){
      return {all:async()=>({results:stmt.all(...params)}),
        first:async()=>stmt.get(...params)||null,
        run:async()=>({meta:{changes:Number(stmt.run(...params).changes)}}),
        execute:()=>stmt.run(...params)};
    }};
  }
  async batch(statements){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const results=statements.map(st=>({meta:{changes:Number(st.execute().changes)}}));
      this.db.exec('COMMIT');return results;
    }catch(e){this.db.exec('ROLLBACK');throw e}
  }
}
class R2 {
  constructor(){this.data=new Map()}
  async get(key){
    const r=this.data.get(key);if(!r)return null;
    return {size:r.bytes.length,arrayBuffer:async()=>r.bytes.slice().buffer,
      customMetadata:r.customMetadata};
  }
  async head(key){
    const r=this.data.get(key);
    return r?{size:r.bytes.length,customMetadata:r.customMetadata}:null;
  }
  async put(key,bytes,{onlyIf,customMetadata}={}){
    if(onlyIf instanceof Headers&&onlyIf.get('if-none-match')==='*'&&this.data.has(key))return null;
    const item={bytes:bytes.slice(),customMetadata};
    this.data.set(key,item);return item;
  }
}
const scene={schema:'musitu.blender.job.v1',job_id:'StudioEnterprise01',objects:[{
  name:'Cube',type:'cube',location:[0,0,0],dimensions:[1,1,1],material:'copper'
}]};
function fixture(){
  const db=new D1(),r2=new R2();
  const env={STUDIO_DB:db,STUDIO_ASSETS:r2,
    STUDIO_MODAL_CALLBACK_KEY:'C'.repeat(48),
    ENABLE_RENDER_DISPATCH:'false',BUDGET_GUARD_APPROVED:'false',
    STUDIO_V03_DAILY_CPU_LIMIT:'2',
    STUDIO_MODAL_URL:'https://studio-example.modal.run/jobs',
    STUDIO_MODAL_CONTROL_KEY:'D'.repeat(48),
    ASSETS:{fetch:async()=>new Response('dashboard',{status:200})}};
  const worker=createV03Worker({identify:async req=>{
    const sub=req.headers.get('x-simulated-staff');
    return sub?{sub,email:sub+'@example.test'}:null;
  }});
  async function call(sub,path,method='GET',data,token){
    const h={'x-simulated-staff':sub||''};
    if(token)h.authorization='Bearer '+token;
    if(method==='POST'){h.origin=base;h['content-type']='application/json'}
    const r=await worker.fetch(new Request(base+path,{
      method,headers:h,body:data===undefined?undefined:JSON.stringify(data)
    }),env);
    const raw=new Uint8Array(await r.arrayBuffer());
    let content;try{content=JSON.parse(new TextDecoder().decode(raw))}catch{content=raw}
    return {status:r.status,body:content,headers:r.headers};
  }
  return {db,r2,env,worker,call};
}
const submit=(p,key='abcdefghijklmnop')=>({project_id:p,scene,device:'CPU',submission_key:key});
async function project(f,sub='person-a'){
  const r=await f.call(sub,'/api/projects','POST',{title:'Enterprise proof'});
  assert.equal(r.status,201,JSON.stringify(r.body));return r.body.project_id;
}
async function job(f,p,sub='person-a',key='abcdefghijklmnop'){
  const r=await f.call(sub,'/api/jobs','POST',submit(p,key));
  assert.equal(r.status,201,JSON.stringify(r.body));return r.body.job_id;
}
function output(){
  const blend=new Uint8Array(1100);
  blend.set(new TextEncoder().encode('BLENDER'));
  const glb=new Uint8Array(1200),view=new DataView(glb.buffer);
  glb.set(new TextEncoder().encode('glTF'));view.setUint32(4,2,true);view.setUint32(8,1200,true);
  view.setUint32(12,32,true);glb.set(new TextEncoder().encode('JSON'),16);
  const png=new Uint8Array(1100),pv=new DataView(png.buffer);
  png.set([137,80,78,71,13,10,26,10]);
  pv.setUint32(8,13,false);png.set(new TextEncoder().encode('IHDR'),12);
  pv.setUint32(16,320,false);pv.setUint32(20,200,false);
  return [['scene.blend',blend],['scene.glb',glb],['preview.png',png]]
    .map(([name,bytes])=>({name,sha256:sha(bytes),data_base64:Buffer.from(bytes).toString('base64')}));
}
test('signature gate, no fallback staff header and independent callback bearer',async()=>{
  const f=fixture();
  assert.equal((await f.call(null,'/api/status')).status,403);
  assert.equal((await f.call(null,'/api/projects','POST',{title:'X'})).status,403);
  assert.equal((await f.call(null,'/internal/callback','POST',{state:'COMPLETED'})).status,401);
});
test('owner creation atomic, outsider cannot see project or jobs',async()=>{
  const f=fixture(),p=await project(f);
  assert.equal((await f.call('person-z','/api/projects')).body.projects.length,0);
  assert.equal((await f.call('person-z','/api/projects/'+p+'/members')).status,403);
  const m=await f.call('person-a','/api/projects/'+p+'/members');
  assert.equal(m.body.members.length,1);assert.equal(m.body.members[0].role,'owner');
  assert.equal((await f.call('person-a','/api/projects')).body.projects.length,1);
  assert.equal((await f.call('person-z','/api/jobs')).body.jobs.length,0);
});
test('membership role gates viewer; reviewer grants require owner and admin grants owner',async()=>{
  const f=fixture(),p=await project(f);
  const path='/api/projects/'+p+'/members';
  assert.equal((await f.call('person-z',path,'POST',{member_sub:'person-x',role:'editor'})).status,403);
  assert.equal((await f.call('person-a',path,'POST',{member_sub:'person-z',role:'owner'})).status,403);
  assert.equal((await f.call('person-a',path,'POST',{member_sub:'person-v',role:'viewer'})).status,200);
  assert.equal((await f.call('person-v','/api/jobs','POST',submit(p))).status,403);
  assert.equal((await f.call('person-v','/api/projects')).body.projects.length,1);
  assert.equal((await f.call('person-a',path,'POST',{member_sub:'person-v',role:'reviewer'})).status,200);
  assert.equal((await f.call('person-v','/api/jobs','POST',submit(p,'different-studio-key-1'))).status,201);
});
test('idempotency, creator cannot self-approve; reviewer separate person can',async()=>{
  const f=fixture(),p=await project(f),id=await job(f,p);
  assert.equal((await f.call('person-a','/api/jobs','POST',submit(p))).body.duplicate,true);
  assert.equal((await f.call('person-a','/api/jobs','POST',{...submit(p),device:'GPU'})).status,400);
  assert.equal((await f.call('person-a','/api/jobs/'+id+'/approve','POST',{})).status,403);
  assert.equal((await f.call('person-a','/api/projects/'+p+'/members','POST',
    {member_sub:'person-b',role:'reviewer'})).status,200);
  assert.equal((await f.call('person-b','/api/jobs/'+id+'/approve','POST',{})).status,200);
  assert.equal((await f.call('person-b','/api/jobs/'+id+'/approve','POST',{})).status,409);
  assert.equal((await f.call('person-a','/api/jobs/'+id+'/dispatch','POST',{})).status,503);
  assert.equal((await f.call('person-z','/api/jobs/'+id+'/audit')).status,403);
  const audit=(await f.call('person-b','/api/jobs/'+id+'/audit')).body.events;
  assert.ok(audit.some(x=>x.action==='JOB_APPROVED'));
});
test('same-origin required, no foreign origin, immutable founder role',async()=>{
  const f=fixture(),p=await project(f);
  assert.equal((await f.call('person-a','/api/projects/'+p+'/members','POST',
    {member_sub:'person-a',role:'viewer'})).status,409);
  const request=new Request('http://127.0.0.1/api/projects',{
    method:'POST',headers:{'x-simulated-staff':'person-a',origin:'https://evil.example',
    'content-type':'application/json'},body:JSON.stringify({title:'attack'})});
  assert.equal((await f.worker.fetch(request,f.env)).status,403);
});
test('CPU callback stores three immutable R2 artifacts and validates download',async()=>{
  const f=fixture(),p=await project(f),id=await job(f,p);
  const row=f.db.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  f.db.db.prepare("UPDATE jobs SET state='RUNNING' WHERE id=?").run(id);
  const receipt={job_id:id,input_sha256:row.payload_sha256,state:'COMPLETED',
    gpu_verified:false,files:output()};
  const cb=await f.call(null,'/internal/callback','POST',receipt,'C'.repeat(48));
  assert.equal(cb.status,200,JSON.stringify(cb.body));
  assert.equal((await f.call(null,'/internal/callback','POST',receipt,'C'.repeat(48))).body.duplicate,true);
  for(const file of receipt.files){
    const res=await f.call('person-a','/api/jobs/'+id+'/assets/'+file.name);
    assert.equal(res.status,200,file.name);
    assert.equal(sha(res.body),file.sha256);
  }
  assert.throws(()=>f.db.db.prepare("DELETE FROM audit_events").run(),/AUDIT_IMMUTABLE/);
  assert.throws(()=>f.db.db.prepare("DELETE FROM assets").run(),/COMPLETED_ASSET_IMMUTABLE/);
  assert.throws(()=>f.db.db.prepare("UPDATE jobs SET state='RUNNING' WHERE id=?").run(id),/TERMINAL_JOB_IMMUTABLE/);
});
test('SQL DB prevents incomplete completed jobs and unauthenticated callback writes',async()=>{
  const f=fixture(),p=await project(f),id=await job(f,p);
  assert.throws(()=>f.db.db.prepare("UPDATE jobs SET state='COMPLETED' WHERE id=?").run(id),/COMPLETED_JOB_REQUIRES_THREE_ASSETS/);
  assert.equal((await f.call(null,'/internal/callback','POST',{job_id:id,state:'FAILED'},'bad')).status,401);
  const meta=(await f.call('person-a','/api/jobs/'+id)).body.job;
  assert.equal(meta.state,'PENDING_APPROVAL');
});
test('policy enforces global staff separation, CPU-only and destination allowlist',()=>{
  assert.equal(can('viewer','dispatch'),false);
  assert.equal(can('editor','submit'),true);
  assert.equal(can('editor','approve'),false);
  assert.equal(globalAdmin({STUDIO_V03_GLOBAL_ADMINS:'person-x,person-y'},'person-y'),true);
  assert.equal(globalAdmin({STUDIO_V03_GLOBAL_ADMINS:'person-x,person-y'},'person'),false);
  assert.equal(safeDailyLimit('999'),2);
  assert.equal(safeDailyLimit('3'),3);
  assert.equal(isModalDestination('https://studio.modal.run/jobs'),true);
  assert.equal(isModalDestination('https://studio.modal.run.attacker.com/jobs'),false);
  assert.equal(safeObjectKey(uu,'scene.glb'),'studio-v03/jobs/'+uu+'/scene.glb');
  assert.throws(()=>safeObjectKey(uu,'../../token'));
});

test('signed reviewer dispatches exactly once, actual Modal-shaped CPU pull completes',async()=>{
 const f=fixture(),p=await project(f),id=await job(f,p);
 assert.equal((await f.call('person-a','/api/projects/'+p+'/members','POST',
   {member_sub:'person-b',role:'reviewer'})).status,200);
 assert.equal((await f.call('person-b','/api/jobs/'+id+'/approve','POST',{})).status,200);
 f.env.ENABLE_RENDER_DISPATCH='true';f.env.BUDGET_GUARD_APPROVED='true';
 const remoteFetch=globalThis.fetch;let sends=0;
 try{
   globalThis.fetch=async(url,opts)=>{
     if(String(url).endsWith('/jobs/pull')&&opts?.method==='POST'){
       sends++;
       assert.equal(opts.headers['x-studio-control-key'],'D'.repeat(48));
       const body=JSON.parse(opts.body);assert.equal(body.device,'CPU');
       assert.equal(body.job_id,id);
       return Response.json({accepted:true,job_id:id,call_id:'fc-test-job-accepted-001'});
     }
     if(String(url).endsWith('/jobs/pull/fc-test-job-accepted-001')){
       return Response.json({state:'COMPLETED',result:{
         result:'FINISHED',job_id:id,input_sha256:f.db.db.prepare('SELECT payload_sha256 FROM jobs WHERE id=?').get(id).payload_sha256,
         gpu_verified:false,files:output()
       }});
     }
     throw Error('UNAPPROVED_REMOTE_TEST_URL');
   };
   const go=await f.call('person-b','/api/jobs/'+id+'/dispatch','POST',{});
   assert.equal(go.status,202,JSON.stringify(go.body));
   assert.equal(sends,1);
   assert.equal((await f.call('person-b','/api/jobs/'+id+'/dispatch','POST',{})).status,429);
   const done=await f.call('person-b','/api/jobs/'+id+'/sync','POST',{});
   assert.equal(done.status,200,JSON.stringify(done.body));
   assert.equal(done.body.state,'COMPLETED');
   assert.equal(f.db.db.prepare('SELECT COUNT(*) AS n FROM assets WHERE job_id=?').get(id).n,3);
   assert.equal((await f.call('person-a','/api/jobs/'+id+'/assets/scene.glb')).status,200);
 }finally{globalThis.fetch=remoteFetch}
});
test('uncertain Modal dispatch never retries automatically or charges GPU',async()=>{
 const f=fixture(),p=await project(f),id=await job(f,p);
 await f.call('person-a','/api/projects/'+p+'/members','POST',{member_sub:'person-b',role:'reviewer'});
 await f.call('person-b','/api/jobs/'+id+'/approve','POST',{});
 f.env.ENABLE_RENDER_DISPATCH='true';f.env.BUDGET_GUARD_APPROVED='true';
 const old=globalThis.fetch;let calls=0;
 try{
   globalThis.fetch=async()=>{calls++;throw Error('UNKNOWN_NETWORK_OUTCOME')};
   const result=await f.call('person-b','/api/jobs/'+id+'/dispatch','POST',{});
   assert.equal(result.status,502);
   assert.equal(result.body.error,'DISPATCH_OUTCOME_UNKNOWN_NO_AUTOMATIC_RETRY');
   assert.equal(f.db.db.prepare('SELECT state FROM jobs WHERE id=?').get(id).state,'NEEDS_REVIEW');
   assert.equal((await f.call('person-b','/api/jobs/'+id+'/dispatch','POST',{})).status,429);
   assert.equal(calls,1);
 }finally{globalThis.fetch=old}
});
test('isolated R2 byte mismatch is detected at output download',async()=>{
 const f=fixture(),p=await project(f),id=await job(f,p);
 const row=f.db.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
 f.db.db.prepare("UPDATE jobs SET state='RUNNING' WHERE id=?").run(id);
 const receipt={job_id:id,input_sha256:row.payload_sha256,state:'COMPLETED',
   gpu_verified:false,files:output()};
 assert.equal((await f.call(null,'/internal/callback','POST',receipt,'C'.repeat(48))).status,200);
 const key='studio-v03/jobs/'+id+'/scene.glb';
 const raw=f.r2.data.get(key);raw.bytes[100]^=0xff;
 const failed=await f.call('person-a','/api/jobs/'+id+'/assets/scene.glb');
 assert.equal(failed.status,409);assert.equal(failed.body.error,'ASSET_INTEGRITY_FAILED');
});

test('caps free-tier project creation to ten per verified owner without leaking other tenants',async()=>{
 const f=fixture();
 for(let n=0;n<10;n++){
   const made=await f.call('person-a','/api/projects','POST',{title:'Free Studio '+n});
   assert.equal(made.status,201,JSON.stringify(made.body));
 }
 const denied=await f.call('person-a','/api/projects','POST',{title:'overflow'});
 assert.equal(denied.status,429,JSON.stringify(denied.body));
 assert.equal(denied.body.error,'PROJECT_QUOTA_EXCEEDED');
 assert.equal(f.db.db.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner_sub=?').get('person-a').n,10);
 assert.equal((await f.call('person-b','/api/projects','POST',{title:'Independent team project'})).status,201);
 assert.equal((await f.call('person-b','/api/projects')).body.projects.length,1);
});
test('caps free-tier submissions to fifty per project without consuming quota for a duplicate',async()=>{
 const f=fixture(),id=await project(f);
 for(let n=0;n<50;n++){
   const key='idempotent-'+String(n).padStart(8,'0');
   const submitResult=await f.call('person-a','/api/jobs','POST',submit(id,key));
   assert.equal(submitResult.status,201,JSON.stringify(submitResult.body));
 }
 const duplicate=await f.call('person-a','/api/jobs','POST',submit(id,'idempotent-00000000'));
 assert.equal(duplicate.status,200);
 assert.equal(duplicate.body.duplicate,true);
 const denied=await f.call('person-a','/api/jobs','POST',submit(id,'idempotent-00000050'));
 assert.equal(denied.status,429,JSON.stringify(denied.body));
 assert.equal(denied.body.error,'PROJECT_JOB_QUOTA_EXCEEDED');
 assert.equal(f.db.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE project_id=?').get(id).n,50);
});


test('reviewer approval rolls back if audit insertion fails atomically',async()=>{
 const f=fixture(),p=await project(f),id=await job(f,p);
 await f.call('person-a','/api/projects/'+p+'/members','POST',
   {member_sub:'person-b',role:'reviewer'});
 f.db.db.exec("CREATE TRIGGER reject_review_audit BEFORE INSERT ON audit_events "+
   "WHEN NEW.action='JOB_APPROVED' BEGIN SELECT RAISE(ABORT,'SIMULATED_REVIEW_AUDIT_FAILURE'); END;");
 const result=await f.call('person-b','/api/jobs/'+id+'/approve','POST',{});
 assert.notEqual(result.status,200,'audit failed: approval cannot appear successful');
 const record=f.db.db.prepare('SELECT state,approved_by_sub FROM jobs WHERE id=?').get(id);
 assert.equal(record.state,'PENDING_APPROVAL','failed audit must not create unaudited approval');
 assert.equal(record.approved_by_sub,null);
 assert.equal(f.db.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE job_id=? AND action='JOB_APPROVED'")
   .get(id).n,0);
});

test('failed-render callback rolls back terminal state if audit insertion fails atomically',async()=>{
 const f=fixture(),p=await project(f),id=await job(f,p);
 const row=f.db.db.prepare('SELECT payload_sha256 FROM jobs WHERE id=?').get(id);
 f.db.db.prepare("UPDATE jobs SET state='RUNNING' WHERE id=?").run(id);
 f.db.db.exec("CREATE TRIGGER reject_render_failed_audit BEFORE INSERT ON audit_events "+
   "WHEN NEW.action='RENDER_FAILED' BEGIN SELECT RAISE(ABORT,'SIMULATED_RENDER_AUDIT_FAILURE'); END;");
 const result=await f.call(null,'/internal/callback','POST',{
   job_id:id,input_sha256:row.payload_sha256,state:'FAILED'},'C'.repeat(48));
 assert.notEqual(result.status,200,'callback cannot claim committed terminal transition without audit');
 const stateRow=f.db.db.prepare('SELECT state,finished_at FROM jobs WHERE id=?').get(id);
 assert.equal(stateRow.state,'RUNNING','audit failure must not leave an unaudited terminal job');
 assert.equal(stateRow.finished_at,null);
 assert.equal(f.db.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE job_id=? AND action='RENDER_FAILED'")
   .get(id).n,0);
});


test('dispatch audit failure rolls back to approved before any external CPU request',async()=>{
 const f=fixture(),p=await project(f),id=await job(f,p);
 await f.call('person-a','/api/projects/'+p+'/members','POST',{member_sub:'person-b',role:'reviewer'});
 assert.equal((await f.call('person-b','/api/jobs/'+id+'/approve','POST',{})).status,200);
 f.env.ENABLE_RENDER_DISPATCH='true';f.env.BUDGET_GUARD_APPROVED='true';
 f.db.db.exec("CREATE TRIGGER reject_dispatch_start_audit BEFORE INSERT ON audit_events "+
   "WHEN NEW.action='DISPATCH_STARTED' BEGIN SELECT RAISE(ABORT,'SIMULATED_START_AUDIT_FAILURE'); END;");
 const original=globalThis.fetch;let externalCalls=0;
 try{
   globalThis.fetch=async()=>{externalCalls++;throw Error('MUST_NOT_SEND');};
   const result=await f.call('person-b','/api/jobs/'+id+'/dispatch','POST',{});
   assert.notEqual(result.status,200);
   assert.equal(externalCalls,0,'No paid Modal request before durable dispatch audit');
   const current=f.db.db.prepare('SELECT state,dispatched_at,dispatched_by_sub FROM jobs WHERE id=?').get(id);
   assert.equal(current.state,'APPROVED');
   assert.equal(current.dispatched_at,null);
   assert.equal(current.dispatched_by_sub,null);
   assert.equal(f.db.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE job_id=? AND action='DISPATCH_STARTED'").get(id).n,0);
 }finally{globalThis.fetch=original}
});
test('successful Modal ack but rejected audit must be locked as NEEDS_REVIEW without retry',async()=>{
 const f=fixture(),p=await project(f),id=await job(f,p);
 await f.call('person-a','/api/projects/'+p+'/members','POST',{member_sub:'person-b',role:'reviewer'});
 await f.call('person-b','/api/jobs/'+id+'/approve','POST',{});
 f.env.ENABLE_RENDER_DISPATCH='true';f.env.BUDGET_GUARD_APPROVED='true';
 f.db.db.exec("CREATE TRIGGER reject_dispatch_ack_audit BEFORE INSERT ON audit_events "+
   "WHEN NEW.action='DISPATCH_ACCEPTED' BEGIN SELECT RAISE(ABORT,'SIMULATED_ACK_AUDIT_FAILURE'); END;");
 const original=globalThis.fetch;let requests=0;
 try{
   globalThis.fetch=async()=>{
     requests++;
     return Response.json({accepted:true,job_id:id,call_id:'fc-proven-test-ack-000001'});
   };
   const result=await f.call('person-b','/api/jobs/'+id+'/dispatch','POST',{});
   assert.equal(result.status,502,JSON.stringify(result.body));
   const current=f.db.db.prepare('SELECT state,call_id FROM jobs WHERE id=?').get(id);
   assert.equal(current.state,'NEEDS_REVIEW');
   assert.equal(current.call_id,null,'Rejected audit must roll back accepted call transition');
   assert.equal(requests,1);
   assert.equal((await f.call('person-b','/api/jobs/'+id+'/dispatch','POST',{})).status,429);
   assert.equal(requests,1,'Never retry potentially paid Modal execution automatically');
   const audit=f.db.db.prepare("SELECT action FROM audit_events WHERE job_id=? ORDER BY at").all(id);
   assert.equal(audit.some(x=>x.action==='DISPATCH_ACCEPTED'),false);
   assert.equal(audit.some(x=>x.action==='DISPATCH_AMBIGUOUS_NO_RETRY'),true);
 }finally{globalThis.fetch=original}
});
test('unknown remote outcome cannot transition to NEEDS_REVIEW without immutable audit',async()=>{
 const f=fixture(),p=await project(f),id=await job(f,p);
 await f.call('person-a','/api/projects/'+p+'/members','POST',{member_sub:'person-b',role:'reviewer'});
 await f.call('person-b','/api/jobs/'+id+'/approve','POST',{});
 f.env.ENABLE_RENDER_DISPATCH='true';f.env.BUDGET_GUARD_APPROVED='true';
 f.db.db.exec("CREATE TRIGGER reject_ambiguous_audit BEFORE INSERT ON audit_events "+
   "WHEN NEW.action='DISPATCH_AMBIGUOUS_NO_RETRY' BEGIN SELECT RAISE(ABORT,'SIMULATED_UNKNOWN_AUDIT_FAILURE'); END;");
 const original=globalThis.fetch;let requests=0;
 try{
   globalThis.fetch=async()=>{requests++;throw Error('NETWORK_OUTCOME_UNKNOWN')};
   const result=await f.call('person-b','/api/jobs/'+id+'/dispatch','POST',{});
   assert.notEqual(result.status,200);
   const current=f.db.db.prepare('SELECT state FROM jobs WHERE id=?').get(id);
   assert.equal(current.state,'DISPATCHING','Remain non-retryable rather than unaudited NEEDS_REVIEW state');
   assert.equal((await f.call('person-b','/api/jobs/'+id+'/dispatch','POST',{})).status,429);
   assert.equal(requests,1);
 }finally{globalThis.fetch=original}
});
