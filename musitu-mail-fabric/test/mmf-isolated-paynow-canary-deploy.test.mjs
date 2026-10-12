import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import canary from '../src/staging/mmf-paynow-canary.mjs';
import {deployIsolatedMmfCanary} from '../src/staging/deploy-mmf-isolated-paynow-canary.mjs';
const script=readFileSync(new URL('../src/staging/mmf-paynow-canary.mjs',import.meta.url),'utf8');
const hash=v=>createHash('sha256').update(v).digest('hex');
const account='93f395f5121954671f92fffa453d6b61';
const name='mmf-paynow-isolated-deny-canary-20261012';
const base=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/`;
const opts={accountId:account,token:'TEST_TOKEN_AUTHORIZE_GET_AND_CANARY_ONLY',branch:'product/musitu-mail-fabric-isolated-20261009',script,scriptSha256:hash(script)};
const response=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
const ok=v=>response({success:true,result:v});
function cloudMock({collide=false,disableFail=false,badSettings=false,wrongScript=false,multipartSource=false}={}){
 const calls=[]; let written=false; let disabled=false;
 async function fetchImpl(url,init){
  const path=url.slice(base.length);calls.push({url,method:init.method,body:init.body});
  if(url===base.slice(0,-1)&&init.method==='GET')return ok([{id:'mft-phase8-external-authority'},{id:'mft-paynow-transport-gateway'}]);
  if(path===name&&init.method==='GET'&&!written) return collide?ok({script:name}):response({success:false,errors:[{code:10007}]},404);
  if(path===name&&init.method==='PUT'){
   assert.equal(written,false);
   assert.equal(init.body instanceof FormData,true);
   const m=JSON.parse(init.body.get('metadata'));
   assert.deepEqual(m,{main_module:'canary.mjs',bindings:[],compatibility_date:'2026-10-12'});
   assert.equal(await init.body.get('canary.mjs').text(),script);
   written=true;return ok({id:name});
  }
  if(path===name+'/subdomain'&&init.method==='POST'){
   assert.deepEqual(JSON.parse(init.body),{enabled:false,previews_enabled:false});
   if(disableFail)return response({success:false,errors:[{code:1000}]},403);
   disabled=true;return ok({enabled:false,previews_enabled:false});
  }
  if(path===name+'/subdomain'&&init.method==='GET')return ok({enabled:!disabled,previews_enabled:!disabled});
  if(path===name+'/settings'&&init.method==='GET')return ok({bindings:badSettings?[{name:'PAYNOW_INTEGRATION_KEY',type:'secret_text'}]:[]});
  if(path===name&&init.method==='GET'&&written){
   if(multipartSource){
    const boundary='mmfSafeBoundary20261012';
    const raw='--'+boundary+'\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'+
      JSON.stringify({main_module:'canary.mjs'})+'\r\n--'+boundary+'\r\nContent-Disposition: form-data; name="canary.mjs"; filename="canary.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n'+
      script+'\r\n--'+boundary+'--\r\n';
    return new Response(raw,{headers:{'content-type':'multipart/form-data; boundary='+boundary}});
   }
   return new Response(wrongScript?script.replace('syntheticCanary','wrongField'):script,{headers:{'content-type':'text/javascript'}});
  }
  if(path===name&&init.method==='DELETE'){written=false;return ok({id:name});}
  throw Error('unexpected API action '+init.method+' '+url);
 }
 return {fetchImpl,calls,get written(){return written}};
}

test('runtime denies every path, any method, and all attempts at real payment',async()=>{
 for(const path of ['/healthz','/internal/paynow/initiate-mmf','/internal/paynow/sign-initiate-mmf','/admin','/']){
  const r=await canary.fetch(new Request('https://isolation.invalid'+path),{PAYNOW_INTEGRATION_KEY:'never-used'});
  assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');
  const j=await r.json();assert.equal(j.paymentsEnabled,false);assert.equal(j.customerEmailEnabled,false);
 }
});
test('fresh account-only canary writes exactly one new isolated script and denies subdomain',async()=>{
 const c=cloudMock();const r=await deployIsolatedMmfCanary({...opts,fetchImpl:c.fetchImpl});
 assert.equal(r.gate,'MMF_ISOLATED_CANARY_DENY_ONLY_DEPLOYED');
 assert.equal(r.legacyWorkersMutated,false);assert.equal(r.merchantSecretsTransferred,false);
 assert.equal(r.workersDevEnabled,false);assert.equal(r.paymentEnabled,false);
 assert.deepEqual(c.calls.filter(x=>x.method!=='GET').map(x=>x.method),['PUT','POST']);
 assert.equal(c.calls.some(x=>x.url.includes('mft-phase8-external-authority')||x.url.includes('mft-paynow-transport-gateway')),false);
});
test('existing canary name blocks overwrite without a write',async()=>{
 const c=cloudMock({collide:true});await assert.rejects(deployIsolatedMmfCanary({...opts,fetchImpl:c.fetchImpl}),/MMF_CANARY_DEPLOY_DENIED/);
 assert.equal(c.calls.every(x=>x.method==='GET'),true);
});
test('wrong account, branch, integrity and token cannot reach any endpoint',async()=>{
 for(const patch of [{accountId:'other'},{branch:'main'},{scriptSha256:'0'.repeat(64)},{token:''},{script:script.replace('status:503','status:200')}]){
  let called=0;await assert.rejects(deployIsolatedMmfCanary({...opts,...patch,fetchImpl:async()=>{called++;throw Error('bad')}}),/MMF_CANARY_DEPLOY_DENIED/);
  assert.equal(called,0);
 }
});
test('failed subdomain lockdown deletes only the fresh canary and rejects completion',async()=>{
 const c=cloudMock({disableFail:true});await assert.rejects(deployIsolatedMmfCanary({...opts,fetchImpl:c.fetchImpl}),/MMF_CANARY_DEPLOY_DENIED/);
 assert.equal(c.calls.some(x=>x.method==='DELETE'&&x.url===base+name),true);
 assert.equal(c.calls.every(x=>!['mft-phase8-external-authority','mft-paynow-transport-gateway'].some(v=>x.url.includes(v))),true);
});
test('unexpected secret binding or altered source triggers canary-only cleanup',async()=>{
 for(const v of [{badSettings:true},{wrongScript:true}]){
  const c=cloudMock(v);await assert.rejects(deployIsolatedMmfCanary({...opts,fetchImpl:c.fetchImpl}),/MMF_CANARY_DEPLOY_DENIED/);
  assert.equal(c.calls.some(x=>x.method==='DELETE'&&x.url===base+name),true);
 }
});

test('real Cloudflare multipart script download is compared semantically, not raw boundary bytes',async()=>{
 const c=cloudMock({multipartSource:true});const result=await deployIsolatedMmfCanary({...opts,fetchImpl:c.fetchImpl});
 assert.equal(result.gate,'MMF_ISOLATED_CANARY_DENY_ONLY_DEPLOYED');
 assert.equal(c.calls.filter(x=>x.method==='DELETE').length,0);
});