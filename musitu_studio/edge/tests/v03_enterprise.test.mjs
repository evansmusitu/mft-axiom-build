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
