import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAuthority2WorkerBindings} from './authority2-worker-bindings.mjs';
const account_id='67469478aa9349fa0a57fe3a72da200a',token='R'.repeat(40);
const settings={success:true,errors:[],result:{bindings:[
 {name:'HIGHWATER_STATE',type:'durable_object_namespace',class_name:'Authority2Highwater'},
 {name:'HIGHWATER_WORM',type:'r2_bucket',bucket_name:'musitu-axiom-authority2-worm'},
 {name:'HW_CONFIG_JSON',type:'secret_text'},
 {name:'HW_ROLE_TOKEN_SHA256_JSON',type:'secret_text'},
 {name:'HW_SIGNING_JWK',type:'secret_text'}]}};
const args={account_id,token};
const fake=(data=settings,status=200)=>async(url,init)=>{
 assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+account_id+
  '/workers/scripts/axiom-security-authority2-highwater/settings');
 assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');
 assert.equal(init.credentials,'omit');assert.equal(init.headers.authorization,'Bearer '+token);
 return {status,text:async()=>JSON.stringify(data)};
};
test('Worker provider metadata requires exact DO, R2 and three secret names without release approval',async()=>{
 const result=await verifyAuthority2WorkerBindings({...args,fetchImpl:fake()});
 assert.equal(result.checked_binding_count,5);
 assert.equal(result.release_eligible,false);
 assert.equal(result.active_deployment_verified,false);
 assert.equal(result.signer_custody_verified,false);
 assert.equal(JSON.stringify(result).includes(token),false);
});
test('unverified account or missing credential cannot contact provider',async()=>{
 let calls=0;const stub=async()=>{calls++;return fake()();};
 await assert.rejects(verifyAuthority2WorkerBindings({...args,account_id:'f'.repeat(32),fetchImpl:stub}),
  /WORKER_ACCOUNT_PIN_MISMATCH_HOLD/);
 await assert.rejects(verifyAuthority2WorkerBindings({...args,token:'tiny',fetchImpl:stub}),
  /WORKER_READ_CREDENTIAL_REQUIRED_HOLD/);
 assert.equal(calls,0);
});
test('missing, duplicate or unexpected binding is denied',async()=>{
 for(const bindings of [
  settings.result.bindings.slice(1),
  [...settings.result.bindings,settings.result.bindings[0]],
  [...settings.result.bindings,{name:'EVIL_EXTERNAL_SERVICE',type:'service',service:'other'}]
 ]){
  const reply={...settings,result:{bindings}};
  await assert.rejects(verifyAuthority2WorkerBindings({...args,fetchImpl:fake(reply)}));
 }
});
test('DO class substitution and R2 bucket substitution are denied',async()=>{
 for(const changed of [
  {name:'HIGHWATER_STATE',class_name:'AttackerWorker'},
  {name:'HIGHWATER_STATE',script_name:'foreign-script'},
  {name:'HIGHWATER_WORM',bucket_name:'untrusted-bucket'},
  {name:'HW_SIGNING_JWK',type:'plain_text'}
 ]){
  const reply=structuredClone(settings);
  const binding=reply.result.bindings.find(x=>x.name===changed.name);
  Object.assign(binding,changed);
  await assert.rejects(verifyAuthority2WorkerBindings({...args,fetchImpl:fake(reply)}));
 }
});
test('provider errors and unauthorized redirects cannot count as binding evidence',async()=>{
 for(const status of [301,403,404,503]){
  await assert.rejects(verifyAuthority2WorkerBindings({...args,fetchImpl:fake(settings,status)}),
    /WORKER_SETTINGS_READBACK_DENIED_HOLD/);
 }
});
test('Worker settings readback has absolute deadline despite ignoring AbortSignal',async()=>{
 const result=await Promise.race([
   verifyAuthority2WorkerBindings({...args,timeoutMs:200,fetchImpl:()=>new Promise(()=>{})})
     .then(()=>({value:'ALLOW'}),e=>({value:e.code})),
   new Promise(resolve=>setTimeout(()=>resolve({value:'HUNG'}),700))
 ]);
 assert.equal(result.value,'WORKER_PROVIDER_UNAVAILABLE_HOLD');
});
test('oversize Worker settings stream rejected before text materialization',async()=>{
 let called=false;
 const response={status:200,body:new ReadableStream({
   start(c){c.enqueue(new Uint8Array(32769).fill(65));c.close();}
 }),text:async()=>{called=true;return JSON.stringify(settings);}};
 await assert.rejects(verifyAuthority2WorkerBindings({...args,fetchImpl:async()=>response}),
   /WORKER_SETTINGS_REPLY_INVALID_HOLD/);
 assert.equal(called,false);
});
