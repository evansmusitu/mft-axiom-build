import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditMmfCurrentSharedWorkerDrift} from '../src/staging/mmf-current-cloudflare-drift-readonly.mjs';

const account='93f395f5121954671f92fffa453d6b61';
const names=['mft-phase8-external-authority','mft-paynow-transport-gateway'];
const src='export default { fetch(request) { return new Response("LEGACY_TEST"); } }; // no mmf scope, this is synthetic test fixture intentionally long enough for parsing\n';
const digest=createHash('sha256').update(src).digest('hex');
const baseline=Object.fromEntries(names.map(n=>[n,digest]));
function mockApi({drift=false,missingToken=false,failSettings=false}={}) {
 const calls=[];
 const fetchImpl=async (url,opt)=>{
  calls.push({url,method:opt.method,cache:opt.cache,auth:opt.headers.authorization,redirect:opt.redirect});
  const n=names.find(x=>url.includes('/'+x));
  assert.ok(n);
  if(url.endsWith('/settings')) {
   if(failSettings)return new Response('forbidden',{status:403});
   return new Response(JSON.stringify({success:true,result:{bindings:[{name:'PAYNOW_INTEGRATION_KEY',type:'secret_text'}]}}),{headers:{'content-type':'application/json'}});
  }
  const text=drift&&n===names[0] ? src+' // drift' : src;
  return new Response(text,{headers:{'content-type':'text/javascript'}});
 };
 return {fetchImpl,calls};
}
test('two-worker GET-only audit emits bounded inventory and never grants production release',async()=>{
 const api=mockApi();
 const result=await auditMmfCurrentSharedWorkerDrift({accountId:account,token:'EXAMPLE_CLOUDFLARE_CREDENTIAL_NONSENSITIVE',fetchImpl:api.fetchImpl,baselineByWorker:baseline});
 assert.equal(result.gate,'MMF_SHARED_PAYNOW_GET_ONLY_SOURCE_BASELINE_MATCH');
 assert.equal(result.baselineSourceMatch,true);
 assert.equal(result.cloudflareMutationCount,0);
 assert.equal(result.realProviderPaymentsAllowed,false);
 assert.equal(result.productionReleaseAuthorized,false);
 assert.equal(result.independentApprovalConfirmed,false);
 assert.equal(result.nonexportableSecretsRollbackProven,false);
 assert.equal(api.calls.length,6);
 assert.ok(api.calls.every(c=>c.method==='GET'&&c.cache==='no-store'&&c.redirect==='error'&&c.auth.startsWith('Bearer ')));
 assert.equal(JSON.stringify(result).includes('EXAMPLE_CLOUDFLARE'),false);
 assert.equal(JSON.stringify(result).includes('LEGACY_TEST'),false);
});
test('source drift fails the release gate but never publishes source',async()=>{
 const api=mockApi({drift:true});
 const result=await auditMmfCurrentSharedWorkerDrift({accountId:account,token:'EXAMPLE_CLOUDFLARE_CREDENTIAL_NONSENSITIVE',fetchImpl:api.fetchImpl,baselineByWorker:baseline});
 assert.equal(result.gate,'MMF_SHARED_PAYNOW_GET_ONLY_SOURCE_DRIFT_BLOCKED');
 assert.equal(result.baselineSourceMatch,false);
 assert.equal(result.productionReleaseAuthorized,false);
 assert.equal(JSON.stringify(result).includes('LEGACY_TEST'),false);
});
test('Cloudflare 403, wrong account and untrusted expected baselines deny without fallback',async()=>{
 const api=mockApi({failSettings:true});
 await assert.rejects(()=>auditMmfCurrentSharedWorkerDrift({accountId:account,token:'EXAMPLE_CLOUDFLARE_CREDENTIAL_NONSENSITIVE',fetchImpl:api.fetchImpl,baselineByWorker:baseline}),/MMF_READONLY_SOURCE_DRIFT_DENIED/);
 await assert.rejects(()=>auditMmfCurrentSharedWorkerDrift({accountId:'wrong',token:'EXAMPLE_CLOUDFLARE_CREDENTIAL_NONSENSITIVE',fetchImpl:api.fetchImpl,baselineByWorker:baseline}),/MMF_READONLY_SOURCE_DRIFT_DENIED/);
 await assert.rejects(()=>auditMmfCurrentSharedWorkerDrift({accountId:account,token:'EXAMPLE_CLOUDFLARE_CREDENTIAL_NONSENSITIVE',fetchImpl:api.fetchImpl,baselineByWorker:{[names[0]]:digest}}),/MMF_READONLY_SOURCE_DRIFT_DENIED/);
});
test('auditor cannot be tricked into POST even if custom fetch boundary returns a permissive Response',async()=>{
 const api=mockApi();
 const result=await auditMmfCurrentSharedWorkerDrift({accountId:account,token:'EXAMPLE_CLOUDFLARE_CREDENTIAL_NONSENSITIVE',fetchImpl:api.fetchImpl,baselineByWorker:baseline});
 assert.ok(result.workerChecks.every(x=>x.workerName===names[0]||x.workerName===names[1]));
 assert.equal(api.calls.filter(x=>x.method!=='GET').length,0);
});