/* End-to-end LOCAL Cloudflare Worker+D1+R2 test with GENUINE Blender CPU artifacts.
   Billing disabled, no provider API credentials and no Modal calls.
   Stage: submit + approve. CLI manually marks RUNNING to simulate a Modal executor.
   Complete: authenticated callback with actual .blend/.glb/.png, verify R2 readback. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const base='http://127.0.0.1:8787';
const admin='A'.repeat(48),callback='B'.repeat(48);
function digest(bytes){return createHash('sha256').update(bytes).digest('hex');}
async function request(path,method='GET',body,auth=admin){
  const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+auth,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  let data;const text=await r.text();try{data=JSON.parse(text)}catch{data=text}
  return {status:r.status,data,headers:r.headers};
}
const mode=process.argv[2];
if(mode==='stage'){
  const status=await request('/api/status');
  assert.equal(status.status,200,'Live local Cloudflare Worker API');
  assert.equal(status.data.dispatch_enabled,false,'No paid Modal dispatch');
  const unauthorized=await request('/api/status','GET',undefined,'bad');
  assert.equal(unauthorized.status,401);
  const project=await request('/api/projects','POST',{title:'LOCAL_Cloudflare_D1_R2_Proof'});
  assert.equal(project.status,201,JSON.stringify(project.data));
  const scene=JSON.parse(readFileSync(resolve('../examples/approved_demo.json'),'utf8'));
  const key='local-e2e-'+Date.now()+'-'+Math.random().toString(36).slice(2,12);
  const job=await request('/api/jobs','POST',{project_id:project.data.project_id,scene,device:'CPU',submission_key:key});
  assert.equal(job.status,201,JSON.stringify(job.data));
  const dup=await request('/api/jobs','POST',{project_id:project.data.project_id,scene,device:'CPU',submission_key:key});
  assert.equal(dup.status,200);assert.equal(dup.data.duplicate,true);
  const sceneChanged={...scene,objects:scene.objects.map((o,i)=>i===0?{...o,material:o.material==='copper'?'teal':'copper'}:o)};
  const collision=await request('/api/jobs','POST',{project_id:project.data.project_id,scene:sceneChanged,device:'CPU',submission_key:key});
  assert.equal(collision.status,409,'Job key reuse with different scene must fail');
  assert.equal(collision.data.error,'SUBMISSION_KEY_CONFLICT');
  const deviceCollision=await request('/api/jobs','POST',{project_id:project.data.project_id,scene,device:'GPU',submission_key:key});
  assert.equal(deviceCollision.status,409,'Job key reuse with different device must fail');
  const approved=await request('/api/jobs/'+job.data.job_id+'/approve','POST',{});
  assert.equal(approved.status,200,JSON.stringify(approved.data));
  const spendBlock=await request('/api/jobs/'+job.data.job_id+'/dispatch','POST',{});
  assert.equal(spendBlock.status,503,'No-spend gate must block Modal');
  assert.equal(spendBlock.data.error,'ZERO_SPEND_GATE_CLOSED');
  writeFileSync('local-job-id.txt',job.data.job_id+'\n');
  console.log('LOCAL_CLOUDFLARE_STAGE_PASS',JSON.stringify({id:job.data.job_id,initial:'APPROVED',dispatch:'BLOCKED'}));
} else if(mode==='complete'){
  const id=readFileSync('local-job-id.txt','utf8').trim();
  const job=await request('/api/jobs/'+id);
  assert.equal(job.status,200);
  assert.equal(job.data.job.state,'RUNNING','CLI simulated only state transition');
  const proof=resolve(process.argv[3]||'../proof-v02');
  const names=['scene.blend','scene.glb','preview.png'];
  const files=names.map(name=>{const bytes=readFileSync(resolve(proof,name));return{name,data_base64:bytes.toString('base64'),sha256:digest(bytes)}});
  const cb={job_id:id,input_sha256:job.data.job.payload_sha256,state:'COMPLETED',gpu_verified:false,files};
  const denied=await request('/internal/callback','POST',cb,'wrong-key');
  assert.equal(denied.status,401);
  const wrongHash=await request('/internal/callback','POST',{...cb,input_sha256:'0'.repeat(64)},callback);
  assert.equal(wrongHash.status,409);
  // SHA-256 alone cannot detect a structurally malformed file whose hash
  // was recomputed; reject both invalid PNG IHDR and GLB2 declared length.
  for(const invalidName of ['preview.png','scene.glb']){
    const damaged=files.map(f=>({...f}));
    const item=damaged.find(f=>f.name===invalidName);
    const bytes=Buffer.from(item.data_base64,'base64');
    if(invalidName==='preview.png')bytes.writeUInt32BE(201,20);
    else bytes.writeUInt32LE(bytes.byteLength+4,8);
    item.data_base64=bytes.toString('base64');
    item.sha256=digest(bytes);
    const corrupted=await request('/internal/callback','POST',
      {...cb,files:damaged},callback);
    assert.equal(corrupted.status,409,'Corrupted '+invalidName+' must fail despite valid hash');
    assert.equal(corrupted.data.error,'INVALID_ARTIFACT_FORMAT');
    const stillRunning=await request('/api/jobs/'+id);
    assert.equal(stillRunning.data.job.state,'RUNNING');
  }
  const success=await request('/internal/callback','POST',cb,callback);
  assert.equal(success.status,200,JSON.stringify(success.data));
  assert.equal(success.data.state,'COMPLETED');
  const current=await request('/api/jobs/'+id);
  assert.equal(current.data.job.state,'COMPLETED');
  for(const f of files){
    const d=await fetch(base+'/api/jobs/'+id+'/assets/'+f.name,{headers:{authorization:'Bearer '+admin}});
    assert.equal(d.status,200,'Verified R2 download '+f.name);
    const bytes=Buffer.from(await d.arrayBuffer());
    assert.equal(digest(bytes),f.sha256,'R2 hash '+f.name);
    assert.equal(d.headers.get('x-artifact-sha256'),f.sha256);
  }
  const replay=await request('/internal/callback','POST',cb,callback);
  assert.equal(replay.status,409,'Replay rejected');
  console.log('LOCAL_CLOUDFLARE_D1_R2_REAL_BLENDER_ARTIFACT_PASS',JSON.stringify({
    job_id:id,files:files.map(f=>({name:f.name,sha256:f.sha256})),gpu_verified:false,modal_invoked:false}));
}else{throw Error('Usage: node tests/local_runtime_e2e.mjs stage|complete [proofdir]');}
