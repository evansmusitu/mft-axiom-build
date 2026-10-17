import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
const VALID={schema:'musitu.blender.job.v1',job_id:'Scene01',objects:[{name:'Cube',type:'cube',location:[0,0,0],dimensions:[1,1,1],material:'ivory'}]};
function fake(){
 const projects=new Map(), jobs=new Map(), submissions=new Map(), assets=new Map(), r2=new Map(), audits=[];
 const DB={prepare(sql){let args=[];
 return {bind(...a){args=a;return this;},
  async first(){
    if(sql.includes('FROM projects WHERE id='))return projects.get(args[0])||null;
    if(sql.includes('FROM jobs WHERE submission_key='))return jobs.get(submissions.get(args[0]))||null;
    if(sql.includes('FROM jobs WHERE id='))return jobs.get(args[0])||null;
    if(sql.includes('FROM assets WHERE job_id='))return assets.get(args[0]+':'+args[1])||null;
    throw Error('unknown read: '+sql);
  },
  async all(){if(sql.includes('FROM projects'))return{results:[...projects.values()]};if(sql.includes('FROM jobs'))return{results:[...jobs.values()]};throw Error('bad query: '+sql);},
  async run(){
    if(sql.startsWith('INSERT INTO projects')){projects.set(args[0],{id:args[0],title:args[1],created_at:args[2]});return{meta:{changes:1}};}
    if(sql.startsWith('INSERT INTO audit_events')){audits.push(args);return{meta:{changes:1}};}
    if(sql.startsWith('INSERT INTO jobs')){
      if(submissions.has(args[2]))return{meta:{changes:0}};
      jobs.set(args[0],{id:args[0],project_id:args[1],submission_key:args[2],payload_json:args[3],payload_sha256:args[4],render_device:args[5],state:args[6],created_at:args[7],error:null});
      submissions.set(args[2],args[0]);return{meta:{changes:1}};
    }
    if(sql.startsWith("UPDATE jobs SET state='APPROVED'")){
      const j=jobs.get(args[1]);if(j?.state!=='PENDING_APPROVAL')return{meta:{changes:0}};
      j.state='APPROVED';j.approved_at=args[0];return{meta:{changes:1}};
    }
    if(sql.startsWith("UPDATE jobs SET state='DISPATCHING'")){
      const j=jobs.get(args[0]);if(j?.state!=='APPROVED')return{meta:{changes:0}};
      j.state='DISPATCHING';return{meta:{changes:1}};
    }
    if(sql.startsWith("UPDATE jobs SET state='RUNNING'")){
      const j=jobs.get(args[0]);if(j?.state!=='DISPATCHING')return{meta:{changes:0}};
      j.state='RUNNING';return{meta:{changes:1}};
    }
    if(sql.startsWith("UPDATE jobs SET state='FAILED'")){
      const j=jobs.get(args[2]);if(!['DISPATCHING','RUNNING'].includes(j?.state))return{meta:{changes:0}};
      j.state='FAILED';j.error=args[0];j.finished_at=args[1];return{meta:{changes:1}};
    }
    if(sql.startsWith("UPDATE jobs SET state='COMPLETED'")){
      const j=jobs.get(args[1]);if(!['DISPATCHING','RUNNING'].includes(j?.state))return{meta:{changes:0}};
      j.state='COMPLETED';j.finished_at=args[0];return{meta:{changes:1}};
    }
    if(sql.startsWith('INSERT INTO assets')){
      assets.set(args[0]+':'+args[1],{job_id:args[0],filename:args[1],object_key:args[2],sha256:args[3],bytes:args[4]});
      return{meta:{changes:1}};
    }
    throw Error('unknown update '+sql);
  }
 }}};
 return {STUDIO_DB:DB,STUDIO_ASSETS:{async get(key){return r2.has(key)?{body:r2.get(key),async arrayBuffer(){return r2.get(key).slice().buffer}}:null},async put(key,bytes){r2.set(key,bytes)}},STUDIO_ADMIN_TOKEN:'A'.repeat(48),STUDIO_LOCAL_TEST_ONLY:'true',STUDIO_MODAL_CALLBACK_KEY:'B'.repeat(48),ENABLE_RENDER_DISPATCH:'false',GPU_EXECUTION_APPROVED:'false',ASSETS:{fetch:async()=>new Response('dashboard',{status:200})},projects,jobs,r2,assets,audits};
}
function req(path,method='GET',data,key='A'.repeat(48),origin='http://127.0.0.1'){
 return new Request('http://127.0.0.1'+path,{method,headers:{authorization:'Bearer '+key,origin,...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
}
async function response(env,path,method='GET',data,key){const r=await worker.fetch(req(path,method,data,key),env);return{status:r.status,data:await r.json()};}
test('unauthenticated API refused',async()=>{const e=fake(),r=await response(e,'/api/status','GET',undefined,'bad');assert.equal(r.status,401);});
test('dashboard served as static asset without leaking data',async()=>{const r=await worker.fetch(new Request('http://127.0.0.1/'),fake());assert.equal(await r.text(),'dashboard');});
test('strict origin for POST',async()=>{const e=fake();const r=await worker.fetch(new Request('http://127.0.0.1/api/projects',{method:'POST',headers:{origin:'https://evil.test',authorization:'Bearer '+e.STUDIO_ADMIN_TOKEN},body:'{}'}),e);assert.equal(r.status,403);});
test('status confirms dispatch disabled',async()=>{const r=await response(fake(),'/api/status');assert.equal(r.status,200);assert.equal(r.data.dispatch_enabled,false);});
test('end-to-end project, job, approval and no-spend dispatch refusal',async()=>{
 const env=fake();
 const p=await response(env,'/api/projects','POST',{title:'Studio Exhibit'});
 assert.equal(p.status,201);
 const first=await response(env,'/api/jobs','POST',{project_id:p.data.project_id,scene:VALID,device:'CPU',submission_key:'sample_key_12345678'});
 assert.equal(first.status,201);assert.equal(first.data.state,'PENDING_APPROVAL');
 const dup=await response(env,'/api/jobs','POST',{project_id:p.data.project_id,scene:VALID,device:'CPU',submission_key:'sample_key_12345678'});
 assert.equal(dup.status,200);assert.equal(dup.data.duplicate,true);assert.equal(env.jobs.size,1);
 const id=first.data.job_id;
 const blocked=await response(env,'/api/jobs/'+id+'/dispatch','POST',{});
 assert.equal(blocked.status,503);assert.equal(blocked.data.error,'ZERO_SPEND_GATE_CLOSED');
 const approval=await response(env,'/api/jobs/'+id+'/approve','POST',{});
 assert.equal(approval.status,200);assert.equal(env.jobs.get(id).state,'APPROVED');
 const twice=await response(env,'/api/jobs/'+id+'/approve','POST',{});
 assert.equal(twice.status,409);
 const list=await response(env,'/api/jobs');assert.equal(list.data.jobs.length,1);
 const asset=await response(env,'/api/jobs/'+id+'/assets/scene.blend');assert.equal(asset.status,409);
});
test('invalid Blender code field is rejected',async()=>{
 const e=fake();const p=await response(e,'/api/projects','POST',{title:'Demo'});
 const r=await response(e,'/api/jobs','POST',{project_id:p.data.project_id,device:'CPU',submission_key:'another_key_12345678',scene:{...VALID,python:'exec()'}});
 assert.equal(r.status,400);assert.equal(e.jobs.size,0);
});
test('GPU requests are only staged for approval, never dispatched without budget proof',async()=>{
 const e=fake();const p=await response(e,'/api/projects','POST',{title:'Demo'});
 const r=await response(e,'/api/jobs','POST',{project_id:p.data.project_id,scene:VALID,device:'GPU',submission_key:'gpu_key_123456789'});
 assert.equal(r.status,201);assert.equal(e.jobs.get(r.data.job_id).render_device,'GPU');
 const a=await response(e,'/api/jobs/'+r.data.job_id+'/approve','POST',{});
 assert.equal(a.status,200);
 const b=await response(e,'/api/jobs/'+r.data.job_id+'/dispatch','POST',{});
 assert.equal(b.status,503);
});
test('callback requires separate strong token',async()=>{
 const e=fake(),r=await response(e,'/internal/callback','POST',{job_id:'x',state:'COMPLETED'},'A'.repeat(48));
 assert.equal(r.status,401);
});
test('callback mismatched input is never accepted',async()=>{
 const e=fake();const p=await response(e,'/api/projects','POST',{title:'Demo'});
 const job=await response(e,'/api/jobs','POST',{project_id:p.data.project_id,device:'CPU',scene:VALID,submission_key:'callback_key_12345678'});
 e.jobs.get(job.data.job_id).state='RUNNING';
 const bad=await response(e,'/internal/callback','POST',{job_id:job.data.job_id,state:'COMPLETED',input_sha256:'0'.repeat(64),files:[]},'B'.repeat(48));
 assert.equal(bad.status,409);assert.equal(e.jobs.get(job.data.job_id).state,'RUNNING');
});

test('Fast callback does not regress terminal job state after Modal acknowledgment',async()=>{
 const e=fake();e.ENABLE_RENDER_DISPATCH='true';e.BUDGET_GUARD_APPROVED='true';e.STUDIO_MODAL_CONTROL_KEY='C'.repeat(48);
 e.STUDIO_MODAL_URL='https://studio-test.modal.run/jobs';
 const p=await response(e,'/api/projects','POST',{title:'Race Test'});
 const j=await response(e,'/api/jobs','POST',{project_id:p.data.project_id,device:'CPU',scene:VALID,submission_key:'race_key_1234567890'});
 await response(e,'/api/jobs/'+j.data.job_id+'/approve','POST',{});
 const previous=globalThis.fetch;
 globalThis.fetch=async(_url,opts)=>{
   assert.equal(JSON.parse(opts.body).scene_json,JSON.stringify(VALID));
   e.jobs.get(j.data.job_id).state='COMPLETED';
   return new Response('accepted',{status:200});
 };
 try{
  const r=await response(e,'/api/jobs/'+j.data.job_id+'/dispatch','POST',{});
  assert.equal(r.status,202);assert.equal(r.data.state,'COMPLETED');
  assert.equal(e.jobs.get(j.data.job_id).state,'COMPLETED');
 }finally{globalThis.fetch=previous;}
});
test('Provider rejection never creates a phantom running job',async()=>{
 const e=fake();e.ENABLE_RENDER_DISPATCH='true';e.BUDGET_GUARD_APPROVED='true';e.STUDIO_MODAL_CONTROL_KEY='C'.repeat(48);
 e.STUDIO_MODAL_URL='https://studio-test.modal.run/jobs';
 const p=await response(e,'/api/projects','POST',{title:'Failure Test'});
 const j=await response(e,'/api/jobs','POST',{project_id:p.data.project_id,device:'CPU',scene:VALID,submission_key:'provider_failure_key_1234'});
 await response(e,'/api/jobs/'+j.data.job_id+'/approve','POST',{});
 const prev=globalThis.fetch;globalThis.fetch=async()=>new Response('denied',{status:503});
 try{const r=await response(e,'/api/jobs/'+j.data.job_id+'/dispatch','POST',{});
   assert.equal(r.status,502);assert.equal(e.jobs.get(j.data.job_id).state,'FAILED');
 }finally{globalThis.fetch=prev;}
});
test('CUDA is separately blocked even when CPU budget gate is open',async()=>{
 const e=fake();e.ENABLE_RENDER_DISPATCH='true';e.BUDGET_GUARD_APPROVED='true';e.STUDIO_MODAL_CONTROL_KEY='C'.repeat(48);
 e.STUDIO_MODAL_URL='https://studio-test.modal.run/jobs';
 const p=await response(e,'/api/projects','POST',{title:'GPU Test'});
 const j=await response(e,'/api/jobs','POST',{project_id:p.data.project_id,device:'GPU',scene:VALID,submission_key:'gpu_block_key_1234567'});
 await response(e,'/api/jobs/'+j.data.job_id+'/approve','POST',{});
 const r=await response(e,'/api/jobs/'+j.data.job_id+'/dispatch','POST',{});
 assert.equal(r.status,503);assert.equal(r.data.error,'GPU_GATE_CLOSED');
});

test('reject oversized chunked JSON without content-length before D1 mutations',async()=>{
 const env=fake();
 const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(66000)));c.close();}});
 const req=new Request('http://127.0.0.1/api/projects',{
  method:'POST',duplex:'half',body:stream,
  headers:{authorization:'Bearer '+env.STUDIO_ADMIN_TOKEN,origin:'http://127.0.0.1'}
 });
 const r=await worker.fetch(req,env);
 assert.equal(r.status,413);assert.equal((await r.json()).error,'PAYLOAD_TOO_LARGE');
 assert.equal(env.projects.size,0);
});
test('GPU status must be a literal boolean, not a truthy string',async()=>{
 const env=fake(),p=await response(env,'/api/projects','POST',{title:'Proof'});
 const j=await response(env,'/api/jobs','POST',{project_id:p.data.project_id,scene:VALID,
   device:'CPU',submission_key:'boolean_guard_key_123456'});
 const row=env.jobs.get(j.data.job_id);row.state='RUNNING';
 const bad=await response(env,'/internal/callback','POST',{
   job_id:row.id,input_sha256:row.payload_sha256,state:'COMPLETED',gpu_verified:'false',files:[]
 },'B'.repeat(48));
 assert.equal(bad.status,409);assert.equal(bad.data.error,'DEVICE_PROOF_MISMATCH');
 assert.equal(row.state,'RUNNING');
});
test('download refuses R2 objects changed after recorded SHA-256 receipt',async()=>{
 const env=fake(),p=await response(env,'/api/projects','POST',{title:'Integrity'});
 const j=await response(env,'/api/jobs','POST',{project_id:p.data.project_id,scene:VALID,
   device:'CPU',submission_key:'r2_integrity_key_1234567'});
 const row=env.jobs.get(j.data.job_id);row.state='COMPLETED';
 const original=new Uint8Array(64);original.set(new TextEncoder().encode('BLENDER'));
 const expected=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',original)))
   .map(b=>b.toString(16).padStart(2,'0')).join('');
 const key='jobs/'+row.id+'/scene.blend';
 env.assets.set(row.id+':scene.blend',{job_id:row.id,filename:'scene.blend',object_key:key,
   sha256:expected,bytes:original.length});
 const altered=original.slice();altered[60]=4;env.r2.set(key,altered);
 const mismatch=await response(env,'/api/jobs/'+row.id+'/assets/scene.blend');
 assert.equal(mismatch.status,409);assert.equal(mismatch.data.error,'R2_OBJECT_INTEGRITY_FAILURE');
 env.r2.set(key,original);
 const restored=await worker.fetch(req('/api/jobs/'+row.id+'/assets/scene.blend'),env);
 assert.equal(restored.status,200);
 assert.deepEqual(new Uint8Array(await restored.arrayBuffer()),original);
 assert.equal(restored.headers.get('x-artifact-sha256'),expected);
});
