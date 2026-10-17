import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const base='http://127.0.0.1:8787', token=process.env.STUDIO_QA_ADMIN;
if(!token||token.length<32)throw Error('QA_ADMIN_NOT_SET');
async function api(path,method='GET',body){
  const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)});
  let data;try{data=await r.json()}catch{data={}}
  return{code:r.status,data};
}
const sha=v=>createHash('sha256').update(v).digest('hex');
const proof={schema:'musitu.studio.remote-r2-real-modal-cpu.v1',
   cloudflare_worker_execution:'WRANGLER_LOCAL_WORKER_REMOTE_R2',
   cloudflare_r2_binding_remote:true,
   modal_real_render:true,gpu_verified:false,
   account_existing_axiom_data_modified:false};
const status=await api('/api/status');
assert.equal(status.code,200,JSON.stringify(status.data));
assert.equal(status.data.backend,'R2_CAS_SINGLE_ADMIN');
assert.equal(status.data.dispatch_enabled,true,'Development pilot cost approval must be explicit');
const p=await api('/api/projects','POST',{title:'Enterprise remote R2 live Modal acceptance'});
assert.equal(p.code,201,JSON.stringify(p.data));
const scene=JSON.parse(readFileSync(resolve('../examples/approved_demo.json'),'utf8'));
const key='remote-e2e-'+Date.now()+'-cpu';
const j=await api('/api/jobs','POST',{project_id:p.data.project_id,scene,device:'CPU',submission_key:key});
assert.equal(j.code,201,JSON.stringify(j.data));
const id=j.data.job_id;
const duplicate=await api('/api/jobs','POST',{project_id:p.data.project_id,scene,device:'CPU',submission_key:key});
assert.equal(duplicate.code,200);
const approval=await api('/api/jobs/'+id+'/approve','POST',{});
assert.equal(approval.code,200,JSON.stringify(approval.data));
const dispatch=await api('/api/jobs/'+id+'/dispatch','POST',{});
assert.equal(dispatch.code,202,JSON.stringify(dispatch.data));
assert.equal(dispatch.data.state,'RUNNING');
console.log('STUDIO_REAL_CLOUDFLARE_REMOTE_R2_MODAL_DISPATCH_PASS');
let completed=false;
for(let t=0;t<37;t++){
 await new Promise(res=>setTimeout(res,8000));
 const sync=await api('/api/jobs/'+id+'/sync','POST',{});
 if(sync.code===202&&sync.data.state==='RUNNING')continue;
 if(sync.code===200&&sync.data.state==='COMPLETED'){completed=true;break;}
 if(sync.code===503||sync.code===502)continue;
 throw Error('SYNC_UNEXPECTED_'+sync.code+'_'+String(sync.data.error||sync.data.state));
}
assert.equal(completed,true,'Real Modal CPU render and R2 persistence must finish');
const final=await api('/api/jobs/'+id);
assert.equal(final.code,200);assert.equal(final.data.job.state,'COMPLETED');
const files=[];
for(const name of ['scene.blend','scene.glb','preview.png']){
 const r=await fetch(base+'/api/jobs/'+id+'/assets/'+name,{headers:{Authorization:'Bearer '+token}});
 assert.equal(r.status,200,'R2 remote file read '+name);
 const data=Buffer.from(await r.arrayBuffer());
 assert.ok(data.length>1024);
 assert.equal(sha(data),r.headers.get('x-artifact-sha256'));
 files.push({name,sha256:sha(data),bytes:data.length});
}
proof.job_id=id;proof.project_id=p.data.project_id;proof.files=files;
proof.result='PASS';
writeFileSync('studio-real-r2-modal-e2e.json',JSON.stringify(proof,null,2)+'\n');
console.log('STUDIO_REAL_MODAL_CPU_CLOUDFLARE_REMOTE_R2_VERIFIED='+JSON.stringify({result:'PASS',files,backend:proof.cloudflare_worker_execution}));
