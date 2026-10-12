import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditMmfJointReadOnly} from '../src/staging/mmf-joint-source-binding-getonly.mjs';

const account='93f395f5121954671f92fffa453d6b61';
const token='MOCK_ONLY_NO_REAL_CLOUDFLARE_API_TOKEN_000000000000';
const names=['mft-phase8-external-authority','mft-paynow-transport-gateway'];
const digest=s=>createHash('sha256').update(s).digest('hex');
const source=n=>'// LEGACY '+n+'\nexport default {fetch(){return new Response("legacy")}};\n'+'// original behavior'.repeat(8);
const bindings=n=>Array.from({length:n},(_,i)=>({name:`LEGACY_BINDING_${i.toString().padStart(3,'0')}`,type:i%2?'secret_text':'durable_object_namespace'}));
const bindingHash=b=>digest(JSON.stringify(b.slice().map(({name,type})=>({name,type})).sort((a,b)=>a.name.localeCompare(b.name))));
const sourceHashes=Object.fromEntries(names.map(n=>[n,digest(source(n))]));
const bindingBaselines=Object.fromEntries(names.map((n,i)=>[n,{count:i?7:13,sha256:bindingHash(bindings(i?7:13))}]));
const settings=n=>new Response(JSON.stringify({success:true,result:{bindings:bindings(n)}}),{headers:{'content-type':'application/json'}});
const src=n=>new Response(source(n),{headers:{'content-type':'text/javascript'}});
const api='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/';
function fakeCloudflare({changeSource=false,changeBinding=false,httpFailure=false,secretLeak=false}={}){
 const calls=[];const counts=new Map();
 return {calls,fetchImpl:async(url,opts)=>{
  calls.push({url,opts});
  assert.ok(url.startsWith(api));assert.equal(opts.method,'GET');assert.equal(opts.cache,'no-store');assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.authorization,'Bearer '+token);
  assert.equal(opts.headers['cache-control'],'no-store');
  if(httpFailure)return new Response('not available',{status:403});
  const suffix=url.slice(api.length),isSettings=suffix.endsWith('/settings');
  const name=isSettings?suffix.slice(0,-'/settings'.length):suffix;
  assert.ok(names.includes(name));
  const k=name+(isSettings?'s':'r'),count=(counts.get(k)||0)+1;counts.set(k,count);
  if(isSettings){const b=bindings(name===names[0]?13:7);
   if(changeBinding && count===2)b[0]={...b[0],type:'plain_text'};
   if(secretLeak)b[0].value='SECRET_NEVER_OUTPUT';
   return new Response(JSON.stringify({success:true,result:{bindings:b}}),{headers:{'content-type':'application/json'}});
  }
  if(changeSource && count===2)return new Response(source(name)+'\n// altered',{headers:{'content-type':'text/javascript'}});
  return src(name);
 }};
}
const args=f=>({accountId:account,token,fetchImpl:f.fetchImpl,sourceBaselines:sourceHashes,bindingBaselines});

test('joint read-only release gate reads source AND bindings twice for each worker and never authorizes launch',async()=>{
 const fake=fakeCloudflare();const result=await auditMmfJointReadOnly(args(fake));
 assert.equal(fake.calls.length,8);
 assert.equal(result.cloudflareGetCount,8);
 assert.equal(result.cloudflareMutationCount,0);
 assert.equal(result.jointBaselineMatches,true);
 assert.equal(result.productionReleaseAuthorized,false);
 assert.equal(result.mayDeploySharedWorkers,false);
 assert.equal(result.realProviderPaymentsAllowed,false);
 assert.equal(result.independentApprovalConfirmed,false);
 assert.deepEqual(result.workerChecks.map(w=>w.workerName),names);
 assert.deepEqual(fake.calls.map(x=>x.url),[api+names[0],api+names[0]+'/settings',api+names[1],api+names[1]+'/settings',api+names[0],api+names[0]+'/settings',api+names[1],api+names[1]+'/settings']);
 assert.equal(JSON.stringify(result).includes('LEGACY_BINDING_'),false);
 assert.equal(JSON.stringify(result).includes(token),false);
});

test('stable but changed source or bindings return blocked, never production release',async()=>{
 for(const variant of ['source','binding']){
  const fake=fakeCloudflare();
  const badSource={...sourceHashes,[names[0]]:digest('wrong pinned source')};
  const badBinding={...bindingBaselines,[names[1]]:{count:7,sha256:digest('wrong pinned binding')}};
  const r=await auditMmfJointReadOnly({...args(fake),sourceBaselines:variant==='source'?badSource:sourceHashes,bindingBaselines:variant==='binding'?badBinding:bindingBaselines});
  assert.equal(r.jointBaselineMatches,false);
  assert.equal(r.productionReleaseAuthorized,false);
  assert.equal(r.gate,'MMF_JOINT_CLOUDFLARE_GET_ONLY_DRIFT_BLOCKED');
 }
});

test('mid-window source or binding changes fail closed rather than allowing split-window approval',async()=>{
 await assert.rejects(()=>auditMmfJointReadOnly(args(fakeCloudflare({changeSource:true}))),/MMF_JOINT_CLOUDFLARE_READONLY_DENIED/);
 await assert.rejects(()=>auditMmfJointReadOnly(args(fakeCloudflare({changeBinding:true}))),/MMF_JOINT_CLOUDFLARE_READONLY_DENIED/);
});

test('fail closed on account mismatch, Cloudflare error and secret-bearing binding metadata',async()=>{
 await assert.rejects(()=>auditMmfJointReadOnly({...args(fakeCloudflare()),accountId:'other'}),/MMF_JOINT_CLOUDFLARE_READONLY_DENIED/);
 await assert.rejects(()=>auditMmfJointReadOnly(args(fakeCloudflare({httpFailure:true}))),/MMF_JOINT_CLOUDFLARE_READONLY_DENIED/);
 await assert.rejects(()=>auditMmfJointReadOnly(args(fakeCloudflare({secretLeak:true}))),/MMF_JOINT_CLOUDFLARE_READONLY_DENIED/);
});

test('unknown or partial baselines cannot be supplied to obtain a positive result',async()=>{
 for(const sourceBaselines of [{[names[0]]:sourceHashes[names[0]]},{...sourceHashes,EVIL:digest('evil')},{...sourceHashes,[names[1]]:'invalid'}]){
  await assert.rejects(()=>auditMmfJointReadOnly({...args(fakeCloudflare()),sourceBaselines}),/MMF_JOINT_CLOUDFLARE_READONLY_DENIED/);
 }
});