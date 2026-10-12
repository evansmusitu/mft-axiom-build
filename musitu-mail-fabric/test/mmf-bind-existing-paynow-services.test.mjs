import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {bindMmfToExistingPaynowServices,canReplaceDriftedCanary} from '../src/staging/mmf-bind-existing-paynow-services.mjs';
const account='93f395f5121954671f92fffa453d6b61';
const branch='product/musitu-mail-fabric-isolated-20261009';
const canary='mmf-paynow-isolated-deny-canary-20261012';
const authority='mft-phase8-external-authority',transport='mft-paynow-transport-gateway';
const BASE=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts`;
const script=readFileSync(new URL('../src/staging/mmf-paynow-canary.mjs',import.meta.url),'utf8');
const sha256=s=>createHash('sha256').update(s).digest('hex');
const SCOPED=[{type:'service',name:'MMF_PAYNOW_AUTHORITY',service:authority},{type:'service',name:'MMF_PAYNOW_TRANSPORT',service:transport}];
const js=v=>new Response(JSON.stringify({success:true,result:v}),{headers:{'content-type':'application/json'}});
const settings=b=>js({bindings:b});
const opts={accountId:account,token:'TEST_OWNER_CLOUDFLARE_READ_WRITE_TOKEN_0123456789',branch};
function cloud({oldBindings=[],badSource=false,subdomain=true,writeReject=false,alterSettings=false,shadowMissing=false}={}){
 const calls=[];let current=oldBindings;let writes=0;
 async function fetchImpl(url,init={}){
  const method=init.method||'GET';calls.push({url,method,body:init.body});
  if(url===BASE&&method==='GET')return js([{id:authority},...(shadowMissing?[]:[{id:transport}]),{id:canary}]);
  if(url===BASE+'/'+canary&&method==='GET')return new Response(badSource?script+'\n// changed':script,{headers:{'content-type':'application/javascript'}});
  if(url===BASE+'/'+canary+'/settings'&&method==='GET')return settings(alterSettings?[{type:'secret_text',name:'PAYNOW_INTEGRATION_KEY'}]:current);
  if(url===BASE+'/'+canary+'/subdomain'&&method==='GET')return js({enabled:!subdomain,previews_enabled:!subdomain});
  if(url===BASE+'/'+canary&&method==='PUT'){
   assert.ok(init.body instanceof FormData);
   assert.equal(await init.body.get('canary.mjs').text(),script);
   assert.deepEqual(JSON.parse(init.body.get('metadata')), {main_module:'canary.mjs',compatibility_date:'2026-10-12',bindings:SCOPED});
   writes++;if(writeReject)return new Response(JSON.stringify({success:false}),{status:403,headers:{'content-type':'application/json'}});
   current=SCOPED;return js({id:canary});
  }
  throw new Error(`UNEXPECTED_ACTION_${method}_${url}`);
 }
 return {fetchImpl,calls,get writes(){return writes}};
}
const positiveGate=async()=>({jointBaselineMatches:true,cloudflareMutationCount:0,workerChecks:[{workerName:authority,sourceBaselineMatches:true,bindingBaselineMatches:true},{workerName:transport,sourceBaselineMatches:true,bindingBaselineMatches:true}]});
const deny=async()=>{throw Error('BASELINE_DRIFT')};

test('only the isolated canary is updated to point to BOTH existing live payment workers',async()=>{
 const c=cloud();const r=await bindMmfToExistingPaynowServices({...opts,fetchImpl:c.fetchImpl,integrityAudit:positiveGate});
 assert.equal(r.gate,'MMF_EXISTING_PAYNOW_SERVICE_BINDINGS_CONNECTED_DISABLED');
 assert.deepEqual(r.services,[authority,transport]);
 assert.equal(r.realPaymentsEnabled,false);assert.equal(r.existingWorkersModified,false);
 assert.equal(r.workersDevEnabled,false);assert.equal(c.writes,1);
 assert.deepEqual(c.calls.filter(x=>x.method!=='GET').map(x=>x.url),[BASE+'/'+canary]);
 assert.ok(!c.calls.some(x=>x.method!=='GET'&&(x.url.endsWith(authority)||x.url.endsWith(transport))));
});
test('repeat is idempotent and never redeploys existing connection',async()=>{
 const c=cloud({oldBindings:SCOPED});const r=await bindMmfToExistingPaynowServices({...opts,fetchImpl:c.fetchImpl,integrityAudit:positiveGate});
 assert.equal(c.writes,0);assert.equal(r.idempotentReadback,true);
});
test('Cloudflare-reordered binding metadata with explicit production environment is idempotent',async()=>{
 const withEnvironment=SCOPED.map(b=>({...b,environment:'production'})).reverse();
 const c=cloud({oldBindings:withEnvironment});const r=await bindMmfToExistingPaynowServices({...opts,fetchImpl:c.fetchImpl,integrityAudit:positiveGate});
 assert.equal(r.idempotentReadback,true);assert.equal(c.writes,0);
});
test('wrong account, branch and credentials cannot reach any cloud endpoint',async()=>{
 for(const patch of [{accountId:'other'},{branch:'main'},{token:''}]){
  let calls=0;await assert.rejects(bindMmfToExistingPaynowServices({...opts,...patch,fetchImpl:async()=>{calls++;throw Error('bad')},integrityAudit:positiveGate}),/MMF_EXISTING_PAYNOW_BINDING_DENIED/);
  assert.equal(calls,0);
 }
});
test('source drift, foreign binding, enabled public access and missing target deny without write',async()=>{
 for(const config of [{badSource:true},{alterSettings:true},{subdomain:false},{shadowMissing:true}]){
  const c=cloud(config);await assert.rejects(bindMmfToExistingPaynowServices({...opts,fetchImpl:c.fetchImpl,integrityAudit:positiveGate}),/MMF_EXISTING_PAYNOW_BINDING_DENIED/);
  assert.equal(c.writes,0);
 }
});
test('failed independent source/binding audit blocks the deployment before PUT',async()=>{
 const c=cloud();await assert.rejects(bindMmfToExistingPaynowServices({...opts,fetchImpl:c.fetchImpl,integrityAudit:deny}),/MMF_EXISTING_PAYNOW_BINDING_DENIED/);
 assert.equal(c.writes,0);
});
test('failed Cloudflare write denies success, never touches an existing shared worker',async()=>{
 const c=cloud({writeReject:true});await assert.rejects(bindMmfToExistingPaynowServices({...opts,fetchImpl:c.fetchImpl,integrityAudit:positiveGate}),/MMF_EXISTING_PAYNOW_BINDING_DENIED/);
 assert.equal(c.writes,1);assert.equal(c.calls.some(x=>x.method!=='GET'&&x.url!==BASE+'/'+canary),false);
});

test('only the separately observed exact canary drift digest is eligible for disabled replacement',()=>{
 const pinned='bbfd33438e4c84ec507c17ae0b00a26000e10d2e2f83c406cf89212b1a15708c';
 assert.equal(canReplaceDriftedCanary({observedSha256:pinned,bindings:[],publicDisabled:true,previewDisabled:true}),true);
 assert.equal(canReplaceDriftedCanary({observedSha256:'f'.repeat(64),bindings:[],publicDisabled:true,previewDisabled:true}),false);
 assert.equal(canReplaceDriftedCanary({observedSha256:pinned,bindings:SCOPED,publicDisabled:true,previewDisabled:true}),false);
 assert.equal(canReplaceDriftedCanary({observedSha256:pinned,bindings:[],publicDisabled:false,previewDisabled:true}),false);
});