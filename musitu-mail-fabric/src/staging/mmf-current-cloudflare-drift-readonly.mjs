/**
 * Fresh Cloudflare GET-only worker source baseline check, intended to block
 * rollout on source drift. NO source or secret values are emitted or persisted.
 * A positive match is never production authorization or proof of rollback.
 */
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalCloudflareWorkerSource} from './canonical-cloudflare-worker-source.mjs';

export const MMF_EXPECTED_SOURCE_HASHES=Object.freeze({
  'mft-phase8-external-authority':'66b9386b9e5966dd4a27d2498e9eb4048e806321ea5ff63b827e6b82b7539df3',
  'mft-paynow-transport-gateway':'293a32510bb0722f5301f8e63ca368ecc79c6bd5b7ab20d415742d9bdda103a3'
});
const ACCOUNT='93f395f5121954671f92fffa453d6b61';
const NAMES=Object.keys(MMF_EXPECTED_SOURCE_HASHES);
const ENDPOINT=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/`;
const DENIED='MMF_READONLY_SOURCE_DRIFT_DENIED';
const validObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const deny=()=>{throw Error(DENIED)};
/** Optional alternate baseline is strictly for an isolated synthetic test, NEVER release approval. */
export async function auditMmfCurrentSharedWorkerDrift({accountId,token,fetchImpl=globalThis.fetch,baselineByWorker=MMF_EXPECTED_SOURCE_HASHES}={}){
 try {
  if(accountId!==ACCOUNT||typeof token!=='string'||token.length<20||token.length>500||
   typeof fetchImpl!=='function'||!validObject(baselineByWorker)||
   Object.keys(baselineByWorker).length!==NAMES.length||
   NAMES.some(n=>!/^[a-f0-9]{64}$/.test(baselineByWorker[n])))deny();
  const headers={authorization:`Bearer ${token}`,accept:'application/json','cache-control':'no-store'};
  const get=async suffix=>{
   const res=await fetchImpl(ENDPOINT+suffix,{method:'GET',headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15_000)});
   if(!(res instanceof Response)||!res.ok)deny();
   const length=res.headers.get('content-length');
   if(length!==null&&(!/^\d+$/.test(length)||Number(length)>2_000_000))deny();
   return res;
  };
  const checks=[];
  for(const name of NAMES){
   const a=await canonicalCloudflareWorkerSource(await get(name));
   const b=await canonicalCloudflareWorkerSource(await get(name));
   if(a.sourceSha256!==b.sourceSha256)deny();
   const response=await get(name+'/settings');
   const ct=response.headers.get('content-type')||'';
   if(!/^application\/json(?:\s*;|\s*$)/i.test(ct))deny();
   const raw=await response.text();
   if(raw.length>200_000)deny();
   const settings=JSON.parse(raw);
   const bindings=settings?.result?.bindings;
   if(settings.success!==true||!Array.isArray(bindings)||bindings.length>150||
    bindings.some(x=>!validObject(x)||typeof x.name!=='string'||x.name.length>100))deny();
   const bindingNames=new Set(bindings.map(x=>x.name));
   const authority=name===NAMES[0];
   const routeMarkers=authority?
    ['/internal/paynow/sign-initiate-mmf','/internal/paynow/verify-callback-mmf']:
    ['/internal/paynow/initiate-mmf'];
   const nameOfToken=authority?'MMF_AUTHORITY_BRIDGE_TOKEN':'MMF_TRANSPORT_BRIDGE_TOKEN';
   checks.push(Object.freeze({workerName:name,normalizedSourceSha256:a.sourceSha256,
    pinnedBaselineSha256:baselineByWorker[name],sourceMatchesPinnedBaseline:a.sourceSha256===baselineByWorker[name],
    multipartSourceNormalized:a.multipartNormalized,sourceStableAcrossRepeatedGET:true,
    observedBindingsCount:bindings.length,observedMmfRouteMarkerCount:routeMarkers.filter(s=>a.sourceText.includes(s)).length,
    observedMmfTokenBindingName:bindingNames.has(nameOfToken),
    tokenValuesRead:false,commercialCapabilityVerified:false}));
  }
  const same=checks.every(x=>x.sourceMatchesPinnedBaseline);
  return Object.freeze({schema:'mmf-fresh-shared-paynow-getonly-baseline-v1',
   gate:same?'MMF_SHARED_PAYNOW_GET_ONLY_SOURCE_BASELINE_MATCH':'MMF_SHARED_PAYNOW_GET_ONLY_SOURCE_DRIFT_BLOCKED',
   observedAtUtc:new Date().toISOString(),workerChecks:Object.freeze(checks),
   baselineSourceMatch:same,sourceComparability:'NORMALIZED_JS_GET_ONLY',
   cloudflareRequestMethod:'GET',cloudflareGetCount:6,cloudflareMutationCount:0,
   merchantSecretValuesRead:false,productionReleaseAuthorized:false,
   realProviderPaymentsAllowed:false,customerEmailAllowed:false,
   independentApprovalConfirmed:false,nonexportableSecretsRollbackProven:false,
   merchantProductEligibilityProven:false,mayDeploySharedWorkers:false});
 }catch{deny()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3||process.argv[2]!=='--get-only'||!process.env.RUNNER_TEMP)deny();
 const result=await auditMmfCurrentSharedWorkerDrift({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});
 // A drift result is safe evidence, NOT a success release gate.
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-paynow-current-source-baseline-sanitized.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({gate:result.gate,baselineSourceMatch:result.baselineSourceMatch,
  cloudflareGetCount:result.cloudflareGetCount,cloudflareMutationCount:0,
  productionReleaseAuthorized:false,workerCount:result.workerChecks.length}));
 if(!result.baselineSourceMatch)process.exitCode=2;
}