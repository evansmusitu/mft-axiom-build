import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assessMmfBindingMetadata, auditMmfLegacyBindingInventory, MMF_LEGACY_BINDING_BASELINE}
 from '../src/staging/mmf-shared-binding-drift-readonly.mjs';
const mk=(n)=>Array.from({length:n},(_,i)=>({name:`TEST_BINDING_${String(i).padStart(2,'0')}`,type:i%3===0?'secret_text':'durable_object_namespace'}));
const digest=x=>createHash('sha256').update(JSON.stringify(x.slice().sort((a,b)=>a.name.localeCompare(b.name)))).digest('hex');
const api='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61/workers/scripts/';
const token='test_only_token_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
const env={accountId:'93f395f5121954671f92fffa453d6b61',token};
const asResponse=x=>new Response(JSON.stringify({success:true,result:{bindings:x}}),{headers:{'content-type':'application/json'}});

test('stable sorted synthetic metadata digest matches exact full baseline and preserves no secret values',()=>{
 const records=mk(13),expect={count:13,sha256:digest(records)};
 const result=assessMmfBindingMetadata(records.reverse(),expect);
 assert.equal(result.baselineMatches,true);
 assert.equal(result.bindingCount,13);
 assert.equal(result.bindingMetadataSha256,expect.sha256);
 assert.equal(result.secretValuesRead,false);
 assert.equal(result.mayDeploySharedWorker,false);
 assert.ok(!JSON.stringify(result).includes('TEST_BINDING_'));
});

test('a removed, substituted, duplicate, or new legacy binding cannot match pinned baseline',()=>{
 const x=mk(7),expect={count:7,sha256:digest(x)};
 for(const altered of [x.slice(1),x.map((b,i)=>i===0?{...b,type:'secret_text_v2'}:b),[...x,x[0]], [...x,{name:'EXTRA',type:'secret_text'}]]){
  if(altered.length===8 && altered[7]===x[0])assert.throws(()=>assessMmfBindingMetadata(altered,expect),/MMF_BINDING_BASELINE_DENIED/);
  else assert.equal(assessMmfBindingMetadata(altered,expect).baselineMatches,false);
 }
});

test('Cloudflare inventory strictly GET only, no-store, two fixed workers; synthetic mismatches remain blocked',async()=>{
 const paths=[];
 const fetchImpl=async(url,opts)=>{
  paths.push(url);
  assert.equal(opts.method,'GET');assert.equal(opts.cache,'no-store');assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.authorization,`Bearer ${token}`);
  assert.equal(opts.headers['cache-control'],'no-store');
  return asResponse(mk(url.includes('external-authority')?13:7));
 };
 const report=await auditMmfLegacyBindingInventory({...env,fetchImpl});
 assert.equal(paths.length,2);
 assert.deepEqual(paths,[api+'mft-phase8-external-authority/settings',api+'mft-paynow-transport-gateway/settings']);
 assert.equal(report.cloudflareMutationCount,0);
 assert.equal(report.cloudflareGetCount,2);
 assert.equal(report.bindingBaselineMatches,false);
 assert.equal(report.mayDeploySharedWorkers,false);
 assert.equal(report.nonExportableSecretValuesRecovered,false);
 assert.equal(report.independentApprovalConfirmed,false);
 assert.ok(!JSON.stringify(report).includes('TEST_BINDING_'));
 assert.ok(!JSON.stringify(report).includes(token));
});

test('GET-only fail closed on wrong account, HTTP error, malformed binding, duplicate, unbounded JSON and content-type',async()=>{
 const ok=asResponse(mk(13));
 for(const input of [
  {...env,accountId:'WRONG',fetchImpl:async()=>ok},
  {...env,fetchImpl:async()=>new Response('no',{status:403})},
  {...env,fetchImpl:async()=>asResponse([...mk(13),mk(13)[0]])},
  {...env,fetchImpl:async()=>asResponse([{name:'x',type:'secret_text',value:'DO_NOT_EXPORT'}])},
  {...env,fetchImpl:async()=>new Response('x'.repeat(210001),{headers:{'content-type':'application/json'}})},
  {...env,fetchImpl:async()=>new Response('{}',{headers:{'content-type':'text/html'}})}
 ]){
  await assert.rejects(()=>auditMmfLegacyBindingInventory(input),/MMF_BINDING_BASELINE_DENIED/);
 }
});

test('known baseline constants have expected count and well-formed SHA-256 digests',()=>{
 assert.equal(MMF_LEGACY_BINDING_BASELINE['mft-phase8-external-authority'].count,13);
 assert.equal(MMF_LEGACY_BINDING_BASELINE['mft-paynow-transport-gateway'].count,7);
 for(const x of Object.values(MMF_LEGACY_BINDING_BASELINE))assert.match(x.sha256,/^[a-f0-9]{64}$/);
});