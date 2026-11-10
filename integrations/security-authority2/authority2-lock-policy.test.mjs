import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAuthority2R2LockPolicy,LockPolicyHold} from './authority2-lock-policy.mjs';
const account_id='67469478aa9349fa0a57fe3a72da200a',bucket_name='musitu-axiom-b27-highwater-a2',token='T'.repeat(40);
const good={success:true,errors:[],result:{rules:[{id:'permanent-b27',enabled:true,prefix:'b27/',condition:{type:'Indefinite'}}]}};
function fake(data, status=200){return async(url,init)=>{assert.equal(new URL(url).host,'api.cloudflare.com');assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.equal(init.headers.authorization,'Bearer '+token);return {status,text:async()=>JSON.stringify(data)};};}
const args={account_id,bucket_name,token};
test('Cloudflare-origin policy readback accepts a genuine enabled indefinite b27-prefix rule',async()=>{
 const result=await verifyAuthority2R2LockPolicy({...args,fetchImpl:fake(good)});
 assert.equal(result.status,'POLICY_READBACK_VERIFIED_NOT_INDEPENDENT_CUSTODY');
 assert.equal(result.retention,'Indefinite');
 assert.equal(result.account_id,account_id);
});
test('rejects same-name bucket in a different account',async()=>{
 await assert.rejects(verifyAuthority2R2LockPolicy({...args,account_id:'0'.repeat(32),fetchImpl:fake(good)}),/ACCOUNT_PIN_MISMATCH/);
});
test('rejects a differently named bucket even inside the correct account',async()=>{
 await assert.rejects(verifyAuthority2R2LockPolicy({...args,bucket_name:'other-r2-bucket',fetchImpl:fake(good)}),/BUCKET_PIN_MISMATCH/);
});
test('rejects an enabled short-duration lock',async()=>{
 const reply=structuredClone(good); reply.result.rules[0].condition={type:'Age',maxAgeSeconds:3600};
 await assert.rejects(verifyAuthority2R2LockPolicy({...args,fetchImpl:fake(reply)}),/INDEFINITE_POLICY_MISSING/);
});
test('rejects disabled or insufficient-prefix protection',async()=>{
 for(const change of [{enabled:false},{prefix:'b27/private/'},{prefix:'other/'},{condition:{type:'Date',date:'2030-01-01T00:00:00Z'}}]){
  const reply=structuredClone(good);Object.assign(reply.result.rules[0],change);
  await assert.rejects(verifyAuthority2R2LockPolicy({...args,fetchImpl:fake(reply)}),/INDEFINITE_POLICY_MISSING/);
 }
});
test('allows a policy that locks the whole bucket as well as b27/',async()=>{
 const reply=structuredClone(good);reply.result.rules[0].prefix='';
 assert.equal((await verifyAuthority2R2LockPolicy({...args,fetchImpl:fake(reply)})).retention,'Indefinite');
});
test('Cloudflare origin error, redirect or malformed payload cannot count as evidence',async()=>{
 for(const [reply,status] of [[{success:false,errors:[{message:'denied'}]},403],[{success:true,result:{}},200],[{success:false,result:good.result},200]]){
  await assert.rejects(verifyAuthority2R2LockPolicy({...args,fetchImpl:fake(reply,status)}),LockPolicyHold);
 }
});

test('B27: R2 lock read does not hang when provider ignores AbortSignal',async()=>{
  const outcome=await Promise.race([
    verifyAuthority2R2LockPolicy({...args,timeoutMs:200,
      fetchImpl:()=>new Promise(()=>{})})
      .then(()=>({type:'ALLOW'}),e=>({type:'DENIED',code:e.code})),
    new Promise(resolve=>setTimeout(()=>resolve({type:'HUNG'}),850))
  ]);
  assert.deepEqual(outcome,{type:'DENIED',code:'PROVIDER_LOCK_UNAVAILABLE_HOLD'});
});
test('B27: R2 lock body does not hang when response.text ignores abort',async()=>{
  const outcome=await Promise.race([
    verifyAuthority2R2LockPolicy({...args,timeoutMs:200,
      fetchImpl:async()=>({status:200,text:()=>new Promise(()=>{})})})
      .then(()=>({type:'ALLOW'}),e=>({type:'DENIED',code:e.code})),
    new Promise(resolve=>setTimeout(()=>resolve({type:'HUNG'}),850))
  ]);
  assert.deepEqual(outcome,{type:'DENIED',code:'PROVIDER_LOCK_UNAVAILABLE_HOLD'});
});
test('B27: oversized R2 lock response is rejected before materializing whole body',async()=>{
  let textWasCalled=false;
  const res={status:200,
    body:new ReadableStream({start(controller){controller.enqueue(new Uint8Array(16385).fill(65));controller.close()}}),
    text:async()=>{textWasCalled=true;return JSON.stringify(good)}
  };
  await assert.rejects(verifyAuthority2R2LockPolicy({...args,fetchImpl:async()=>res}),
    e=>e?.code==='PROVIDER_LOCK_REPLY_INVALID_HOLD');
  assert.equal(textWasCalled,false,'oversized untrusted response must not be read as unbounded text');
});
test('transport outage and malformed credentials fail closed without privilege escalation',async()=>{
 await assert.rejects(verifyAuthority2R2LockPolicy({...args,token:'tiny',fetchImpl:fake(good)}),LockPolicyHold);
 await assert.rejects(verifyAuthority2R2LockPolicy({...args,fetchImpl:async()=>{throw Error('offline')}}),LockPolicyHold);
});
