import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildMmfAdditiveSourceCandidate} from '../src/commercial/mmf-real-source-additive-candidate.mjs';

const hash=t=>createHash('sha256').update(t).digest('hex');
const fixtures={
 authority:'export async function handleRequest(req,env){ return new Response(`LEGACY:${new URL(req.url).pathname}`) }\nexport default {fetch:handleRequest};\n',
 transport:'export async function handleRequest(req,env,ctx,fetchImpl=fetch){ return new Response(`LEGACY:${new URL(req.url).pathname}`) }\nexport default { fetch: (request, env, ctx) => handleRequest(request, env, ctx, fetch) };\nexport class CallbackVault {}\n'
};
const roles={authority:'mft-phase8-external-authority',transport:'mft-paynow-transport-gateway'};
const scoped={authority:'/internal/paynow/sign-initiate-mmf',transport:'/internal/paynow/initiate-mmf'};
const token='MMF_PRIVATE_STAGE_TOKEN_NOT_MERCHANT_1234567890';
const envFor=role=>({MMF_PRODUCT_STAGE_ONLY:'true',MMF_PRODUCT_STAGE_TENANT:'mmf_stage_20261011',
 MMF_PRODUCTION_PAYMENTS_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false',MMF_MAIL_SENDING_ENABLED:'false',
 [role==='authority'?'MMF_AUTHORITY_BRIDGE_TOKEN':'MMF_TRANSPORT_BRIDGE_TOKEN']:token});
const body=()=>JSON.stringify({schema:'mmf-scope-probe-v1',product:'musitu-mail-fabric',tenant:'mmf_stage_20261011',stageOnly:true,operation:'PROBE',nonce:'TEST_NONCE_1234567890123456'});
async function loaded(role){
 const source=fixtures[role]; const x=buildMmfAdditiveSourceCandidate({workerName:roles[role],sourceText:source,expectedSourceSha256:hash(source)});
 assert.equal(x.originalSha256,hash(source));
 assert.equal(x.patchedSha256,hash(x.patchedSourceText));
 assert.equal(x.legacySourceCanBeRecovered,true);
 const mod=await import(`data:text/javascript;base64,${Buffer.from(x.patchedSourceText).toString('base64')}`);
 return {mod,x};
}
const request=(path,headers={},payload=body())=>new Request('https://isolated.invalid'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:payload});
test('both real-worker signature shapes preserve all old legacy routes, including callback',async()=>{
 for(const role of Object.keys(fixtures)){
  const {mod}=await loaded(role);
  for(const p of ['/healthz','/billing','/internal/paynow/initiate','/internal/paynow/verify-callback','/chemistry']){
   const r=await mod.default.fetch(new Request('https://isolated.invalid'+p),envFor(role));
   assert.equal(await r.text(),'LEGACY:'+p);
  }
 }
});
test('staged authority/transport private probe is synthetic only; no commerce escalation',async()=>{
 for(const role of Object.keys(fixtures)){
  const {mod}=await loaded(role);
  const r=await mod.default.fetch(request(scoped[role],{authorization:'Bearer '+token}),envFor(role));
  assert.equal(r.status,200);const j=await r.json();
  assert.equal(j.stageProbeOnly,true);assert.equal(j.commercialReleaseAuthorized,false);
  assert.equal(j.realProviderPaymentInitiated,false);assert.equal(j.customerEmailEnabled,false);
 }
});
test('missing flags and absent role-specific binding always fail closed',async()=>{
 for(const role of Object.keys(fixtures)){
  const {mod}=await loaded(role);
  const r=await mod.default.fetch(request(scoped[role],{authorization:'Bearer '+token}),{});
  assert.equal(r.status,503);
  const env=envFor(role); env.MMF_PRODUCTION_PAYMENTS_ENABLED='true';
  const q=await mod.default.fetch(request(scoped[role],{authorization:'Bearer '+token}),env);
  assert.equal(q.status,503);
 }
});
test('cross-product, wrong tokens, malformed and oversize bodies cannot trigger anything',async()=>{
 const {mod}=await loaded('transport');
 const env=envFor('transport');
 assert.equal((await mod.default.fetch(request(scoped.transport,{authorization:'Bearer other-foreign-token-1234567890'}),env)).status,401);
 assert.equal((await mod.default.fetch(request(scoped.transport,{authorization:'Bearer '+token},body().replace('musitu-mail-fabric','mft-fmi')),env)).status,422);
 assert.equal((await mod.default.fetch(request(scoped.transport,{authorization:'Bearer '+token},'x'.repeat(2000)),env)).status,413);
 env.FMI_TRANSPORT_BRIDGE_TOKEN=token;
 assert.equal((await mod.default.fetch(request(scoped.transport,{authorization:'Bearer '+token}),env)).status,503);
});
test('source drift, double patch and ambiguous export are denied without fallback',()=>{
 const a=fixtures.authority;
 assert.throws(()=>buildMmfAdditiveSourceCandidate({workerName:roles.authority,sourceText:a,expectedSourceSha256:'0'.repeat(64)}),/MMF_OFFLINE_SOURCE_PATCH_DENIED/);
 assert.throws(()=>buildMmfAdditiveSourceCandidate({workerName:roles.authority,sourceText:a+a,expectedSourceSha256:hash(a+a)}),/MMF_OFFLINE_SOURCE_PATCH_DENIED/);
 assert.throws(()=>buildMmfAdditiveSourceCandidate({workerName:roles.transport,sourceText:a,expectedSourceSha256:hash(a)}),/MMF_OFFLINE_SOURCE_PATCH_DENIED/);
});