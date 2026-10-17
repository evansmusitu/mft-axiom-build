import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const base='http://127.0.0.1:8787',admin='A'.repeat(48),callback='B'.repeat(48);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function api(path,method='GET',body,auth=admin){
 const r=await fetch(base+path,{method,headers:{
   authorization:'Bearer '+auth,origin:base,
   ...(body!==undefined?{'content-type':'application/json'}:{})},
   body:body===undefined?undefined:JSON.stringify(body)});
 const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data=raw}
 return{status:r.status,data};
}
const cmd=process.argv[2];
if(cmd==='stage'){
 const status=await api('/api/status');assert.equal(status.status,200,JSON.stringify(status.data));
 assert.equal(status.data.backend,'R2_CAS_SINGLE_ADMIN');
 assert.equal(status.data.dispatch_enabled,false);
 const bad=await api('/api/status','GET',undefined,'wrong');
 assert.equal(bad.status,401);
 const p=await api('/api/projects','POST',{title:'R2 Local Browser Project'});
 assert.equal(p.status,201,JSON.stringify(p.data));
 const scene=JSON.parse(readFileSync(resolve('../examples/approved_demo.json'),'utf8'));
 const key='studio-local-r2-key-'+Date.now();
 const j=await api('/api/jobs','POST',{project_id:p.data.project_id,scene,
  device:'CPU',submission_key:key});
 assert.equal(j.status,201,JSON.stringify(j.data));
 const dup=await api('/api/jobs','POST',{project_id:p.data.project_id,scene,
  device:'CPU',submission_key:key});
 assert.equal(dup.status,200);assert.equal(dup.data.duplicate,true);
 const approve=await api('/api/jobs/'+j.data.job_id+'/approve','POST',{});
 assert.equal(approve.status,200);
 const dispatch=await api('/api/jobs/'+j.data.job_id+'/dispatch','POST',{});
 assert.equal(dispatch.status,503);assert.equal(dispatch.data.error,'DISPATCH_GATE_CLOSED');
 writeFileSync('local-r2-job.txt',j.data.job_id+'\n');
 console.log('STUDIO_R2_LOCAL_REAL_STATE_STAGE_PASS',JSON.stringify({job:j.data.job_id,approval:'PASS',dispatch:'BLOCKED'}));
}else if(cmd==='complete'){
 const id=readFileSync('local-r2-job.txt','utf8').trim();
 const j=await api('/api/jobs/'+id);assert.equal(j.status,200);
 assert.equal(j.data.job.state,'RUNNING');
 const outputs=resolve(process.argv[3]||'../proof-r2');
 const names=['scene.blend','scene.glb','preview.png'];
 const files=names.map(name=>{const b=readFileSync(resolve(outputs,name));return{
   name,data_base64:b.toString('base64'),sha256:sha(b)};});
 const body={job_id:id,input_sha256:j.data.job.payload_sha256,state:'COMPLETED',
  gpu_verified:false,files};
 const wrong=await api('/internal/callback','POST',body,'wrong');
 assert.equal(wrong.status,401);
 const corrupt=await api('/internal/callback','POST',{...body,input_sha256:'0'.repeat(64)},callback);
 assert.equal(corrupt.status,409);
 const ack=await api('/internal/callback','POST',body,callback);
 assert.equal(ack.status,200,JSON.stringify(ack.data));
 assert.equal(ack.data.state,'COMPLETED');
 const repeat=await api('/internal/callback','POST',body,callback);
 assert.equal(repeat.status,409);
 for(const f of files){
  const response=await fetch(base+'/api/jobs/'+id+'/assets/'+f.name,{headers:{authorization:'Bearer '+admin}});
  assert.equal(response.status,200,f.name+' download');
  const raw=Buffer.from(await response.arrayBuffer());
  assert.equal(sha(raw),f.sha256,f.name+' integrity');
  assert.equal(response.headers.get('x-artifact-sha256'),f.sha256);
 }
 console.log('STUDIO_R2_LOCAL_REAL_BLENDER_CALLBACK_AND_DOWNLOAD_PASS',JSON.stringify({
   job:id,artifacts:files.map(f=>({name:f.name,sha256:f.sha256})),
   modal_not_called:true}));
}else{throw Error('mode stage|complete [proofdir] required')}
