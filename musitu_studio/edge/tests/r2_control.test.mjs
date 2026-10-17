import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../src/r2_entry.mjs';

const hex=x=>createHash('sha256').update(x).digest('hex');
const ADMIN='A'.repeat(48),CALLBACK='B'.repeat(48);
class Store {
  constructor(){this.items=new Map()}
  async get(key){const e=this.items.get(key);if(!e)return null;
    return {...e,size:e.bytes.byteLength,
      text:async()=>new TextDecoder().decode(e.bytes),
      arrayBuffer:async()=>e.bytes.slice().buffer}
  }
  async head(key){const x=this.items.get(key);
    return x?{size:x.bytes.byteLength,etag:x.etag,customMetadata:x.customMetadata}:null}
  async put(key,raw,{onlyIf,httpMetadata,customMetadata}={}){
    const previous=this.items.get(key);
    if(onlyIf instanceof Headers&&onlyIf.get('If-None-Match')==='*'&&previous)return null;
    if(onlyIf?.etagMatches&&previous?.etag!==onlyIf.etagMatches)return null;
    let bytes;
    if(typeof raw==='string')bytes=new TextEncoder().encode(raw);
    else bytes=raw.slice();
    const item={etag:hex(bytes),bytes,customMetadata:httpMetadata?.sha256||customMetadata||{}};
    this.items.set(key,item);return item;
  }
}
function env(){
 return {STUDIO_ASSETS:new Store(),STUDIO_LOCAL_TEST_ONLY:'true',
  STUDIO_ADMIN_TOKEN:ADMIN,STUDIO_MODAL_CALLBACK_KEY:CALLBACK,
  ENABLE_RENDER_DISPATCH:'false',BUDGET_GUARD_APPROVED:'false',
  ASSETS:{fetch:async()=>new Response('dashboard',{status:200})}};
}
const scene={schema:'musitu.blender.job.v1',job_id:'StudioSmoke01',objects:[{
  name:'Cube',type:'cube',location:[0,0,0],dimensions:[1,1,1],material:'ivory'}]};
async function req(e,path,method='GET',body,token=ADMIN,host='http://127.0.0.1'){
 const r=await worker.fetch(new Request(host+path,{method,headers:{
  authorization:'Bearer '+token,origin:host,
  ...(body!==undefined?{'content-type':'application/json'}:{})},
  body:body===undefined?undefined:JSON.stringify(body)}),e);
 let data;const bytes=new Uint8Array(await r.arrayBuffer());
 try{data=JSON.parse(new TextDecoder().decode(bytes))}catch{data=bytes}
 return {status:r.status,data,headers:r.headers};
}
function fakeArtifacts(){
 const blend=new Uint8Array(1100);blend.set(new TextEncoder().encode('BLENDER'));
 const glb=new Uint8Array(1200);
 glb.set(new TextEncoder().encode('glTF'));
 let dv=new DataView(glb.buffer);
 dv.setUint32(4,2,true);dv.setUint32(8,glb.length,true);
 dv.setUint32(12,32,true);glb.set(new TextEncoder().encode('JSON'),16);
 const png=new Uint8Array(1100);
 png.set([137,80,78,71,13,10,26,10],0);
 dv=new DataView(png.buffer);dv.setUint32(8,13,false);
 png.set(new TextEncoder().encode('IHDR'),12);dv.setUint32(16,320,false);dv.setUint32(20,200,false);
 return [['scene.blend',blend],['scene.glb',glb],['preview.png',png]]
   .map(([name,bytes])=>({name,data_base64:Buffer.from(bytes).toString('base64'),sha256:hex(bytes)}));
}
test('real public route denied if Access JWT absent',async()=>{
 const e=env();const r=await req(e,'/api/status','GET',undefined,ADMIN,'https://studio.mftintelligence.com');
 assert.equal(r.status,403);assert.equal(r.data.error,'ACCESS_DENIED');
});
test('project -> job -> idempotency conflict -> approval -> dispatch gate',async()=>{
 const e=env();const p=await req(e,'/api/projects','POST',{title:'Live Pilot'});
 assert.equal(p.status,201,p.data.error);
 const j=await req(e,'/api/jobs','POST',{project_id:p.data.project_id,scene,device:'CPU',submission_key:'r2-studio-test-key-1'});
 assert.equal(j.status,201);assert.equal(j.data.state,'PENDING_APPROVAL');
 const repeat=await req(e,'/api/jobs','POST',{project_id:p.data.project_id,scene,device:'CPU',submission_key:'r2-studio-test-key-1'});
 assert.equal(repeat.status,200);assert.equal(repeat.data.duplicate,true);
 const collision=await req(e,'/api/jobs','POST',{project_id:p.data.project_id,scene,device:'GPU',submission_key:'r2-studio-test-key-1'});
 assert.equal(collision.status,409);
 const approve=await req(e,'/api/jobs/'+j.data.job_id+'/approve','POST',{});
 assert.equal(approve.status,200);
 const closed=await req(e,'/api/jobs/'+j.data.job_id+'/dispatch','POST',{});
 assert.equal(closed.status,503);assert.equal(closed.data.error,'DISPATCH_GATE_CLOSED');
 assert.equal((await req(e,'/api/jobs')).data.jobs.length,1);
 assert.equal((await req(e,'/api/projects')).data.projects.length,1);
});
test('authenticated callback verifies three immutable assets, SHA and replay',async()=>{
 const e=env();
 const project=await req(e,'/api/projects','POST',{title:'Proof'});
 const job=await req(e,'/api/jobs','POST',{project_id:project.data.project_id,scene,device:'CPU',submission_key:'r2-test-evidence-2'});
 await req(e,'/api/jobs/'+job.data.job_id+'/approve','POST',{});
 const key='studio-control/v1/state.json',obj=await e.STUDIO_ASSETS.get(key);
 const state=JSON.parse(await obj.text()),row=state.jobs[0];row.state='RUNNING';
 await e.STUDIO_ASSETS.put(key,JSON.stringify(state),{onlyIf:{etagMatches:obj.etag}});
 const cb={job_id:job.data.job_id,input_sha256:row.payload_sha256,
  state:'COMPLETED',gpu_verified:false,files:fakeArtifacts()};
 assert.equal((await req(e,'/internal/callback','POST',cb,'wrong')).status,401);
 assert.equal((await req(e,'/internal/callback','POST',{...cb,input_sha256:'0'.repeat(64)},CALLBACK)).status,409);
 const ok=await req(e,'/internal/callback','POST',cb,CALLBACK);
 assert.equal(ok.status,200,JSON.stringify(ok.data));assert.equal(ok.data.state,'COMPLETED');
 assert.equal((await req(e,'/internal/callback','POST',cb,CALLBACK)).status,409);
 for(const f of cb.files){
   const r=await req(e,'/api/jobs/'+job.data.job_id+'/assets/'+f.name);
   assert.equal(r.status,200,'download '+f.name);assert.equal(hex(r.data),f.sha256);
   assert.equal(r.headers.get('x-artifact-sha256'),f.sha256);
 }
 const assetKey='jobs/'+row.id+'/scene.blend';
 const old=await e.STUDIO_ASSETS.get(assetKey);const altered=new Uint8Array(await old.arrayBuffer());altered[100]=99;
 await e.STUDIO_ASSETS.put(assetKey,altered);
 const tamper=await req(e,'/api/jobs/'+job.data.job_id+'/assets/scene.blend');
 assert.equal(tamper.status,409);assert.equal(tamper.data.error,'ARTIFACT_INTEGRITY_FAILURE');
});
test('no data mutation when stale R2 CAS tries to overwrite a newer state',async()=>{
 const e=env();const key='studio-control/v1/state.json';
 const initial=await req(e,'/api/projects','POST',{title:'First'});assert.equal(initial.status,201);
 const obj=await e.STUDIO_ASSETS.get(key);
 await req(e,'/api/projects','POST',{title:'Second'});
 const stale=await e.STUDIO_ASSETS.put(key,JSON.stringify({revision:0,projects:[],jobs:[],audit:[]}),
   {onlyIf:{etagMatches:obj.etag}});
 assert.equal(stale,null);
 assert.equal((await req(e,'/api/projects')).data.projects.length,2);
});
