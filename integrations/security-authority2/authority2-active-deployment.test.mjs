import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAuthority2ActiveDeployment} from './authority2-active-deployment.mjs';
const account_id='67469478aa9349fa0a57fe3a72da200a',token='T'.repeat(40);
const item={id:'182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e',
 created_on:'2026-11-09T12:00:00.000Z',source:'api',strategy:'percentage',
 versions:[{percentage:100,version_id:'023e105f-2a42-4f8b-a1c1-73f6a2a30c0f'}]};
const good={success:true,errors:[],result:{deployments:[item]}},args={account_id,token};
const fake=(data=good,status=200)=>async(url,init)=>{
 assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+account_id+
  '/workers/scripts/axiom-security-authority2-highwater/deployments?page=1&per_page=1');
 assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');
 assert.equal(init.headers.authorization,'Bearer '+token);
 return {status,text:async()=>JSON.stringify(data)};
};
test('B27 accepts only one 100%-deployed version as metadata, not source qualification',async()=>{
 const r=await verifyAuthority2ActiveDeployment({...args,fetchImpl:fake()});
 assert.equal(r.status,'ACTIVE_DEPLOYMENT_METADATA_NOT_SOURCE_ATTESTATION');
 assert.equal(r.active_deployment_metadata_observed,true);
 assert.equal(r.active_deployment_source_qualified,false);
 assert.equal(r.release_eligible,false);
 assert.equal(r.active_version_id_sha256.length,64);
 assert.doesNotMatch(JSON.stringify(r),/182bd5e5-6e1a|023e105f-2a42|TTTTTT/);
});
test('B27 refuses missing or untrusted active deployment',async()=>{
 for(const versions of [[],[{...item.versions[0],percentage:50}],
  [{...item.versions[0],percentage:50},{percentage:50,version_id:'123e105f-2a42-4f8b-a1c1-73f6a2a30c0f'}]]){
  const data=structuredClone(good);data.result.deployments[0].versions=versions;
  await assert.rejects(verifyAuthority2ActiveDeployment({...args,fetchImpl:fake(data)}),
    /DEPLOYMENT_NOT_SINGLE_STABLE_VERSION_HOLD/);
 }
});
test('B27 rejects missing deployment, malformed UUID or invalid created timestamp',async()=>{
 for(const change of [
  {result:{deployments:[]}},
  {result:{deployments:[{...item,id:'not-a-uuid'}]}},
  {result:{deployments:[{...item,created_on:'not-a-time'}]}}
 ]){
  const data={...good,...change};
  await assert.rejects(verifyAuthority2ActiveDeployment({...args,fetchImpl:fake(data)}));
 }
});
test('B27 deployment account and credential must be pinned before contact',async()=>{
 let calls=0;const stub=async()=>{calls++;return fake()();};
 await assert.rejects(verifyAuthority2ActiveDeployment({...args,account_id:'0'.repeat(32),fetchImpl:stub}),
  /DEPLOYMENT_ACCOUNT_PIN_MISMATCH_HOLD/);
 await assert.rejects(verifyAuthority2ActiveDeployment({...args,token:'bad',fetchImpl:stub}),
  /DEPLOYMENT_READ_CREDENTIAL_REQUIRED_HOLD/);
 assert.equal(calls,0);
});
test('B27 redirects, auth failure and provider errors never count as deployment evidence',async()=>{
 for(const status of [302,401,403,404,503]){
  await assert.rejects(verifyAuthority2ActiveDeployment({...args,fetchImpl:fake(good,status)}),
   /DEPLOYMENT_READBACK_DENIED_HOLD/);
 }
});
test('B27 deployment GET cannot hang if provider ignores AbortSignal',async()=>{
 const out=await Promise.race([
  verifyAuthority2ActiveDeployment({...args,timeoutMs:200,fetchImpl:()=>new Promise(()=>{})})
   .then(()=>({result:'ALLOW'}),e=>({result:e.code})),
  new Promise(resolve=>setTimeout(()=>resolve({result:'HUNG'}),700))
 ]);
 assert.equal(out.result,'DEPLOYMENT_PROVIDER_UNAVAILABLE_HOLD');
});
test('B27 deployment body streaming cap avoids unbounded response materialization',async()=>{
 let textCalled=false;
 const response={status:200,body:new ReadableStream({
  start(c){c.enqueue(new Uint8Array(32769).fill(65));c.close()}
 }),text:async()=>{textCalled=true;return JSON.stringify(good)}};
 await assert.rejects(verifyAuthority2ActiveDeployment({...args,fetchImpl:async()=>response}),
   /DEPLOYMENT_REPLY_INVALID_HOLD/);
 assert.equal(textCalled,false);
});
