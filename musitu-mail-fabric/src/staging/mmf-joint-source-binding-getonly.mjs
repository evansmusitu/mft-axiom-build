/**
 * SAME-RUN, GET-ONLY baseline for the exact two shared Paynow Worker source
 * payloads and legacy binding NAME+TYPE metadata. The complete source is kept
 * in process; no source, binding values, secrets or credentials reach evidence.
 * A match is an integrity signal, NEVER merchant permission or deployment.
 */
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalCloudflareWorkerSource} from './canonical-cloudflare-worker-source.mjs';
import {MMF_EXPECTED_SOURCE_HASHES} from './mmf-current-cloudflare-drift-readonly.mjs';
import {MMF_LEGACY_BINDING_BASELINE,assessMmfBindingMetadata} from './mmf-shared-binding-drift-readonly.mjs';

const ACCOUNT='93f395f5121954671f92fffa453d6b61';
const NAMES=['mft-phase8-external-authority','mft-paynow-transport-gateway'];
const ROOT=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/`;
const DENIED='MMF_JOINT_CLOUDFLARE_READONLY_DENIED';
const deny=()=>{throw Error(DENIED)};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const validSource=a=>plain(a)&&Object.keys(a).length===2&&NAMES.every(n=>/^[a-f0-9]{64}$/.test(a[n]));
const validBinding=a=>plain(a)&&Object.keys(a).length===2&&NAMES.every(n=>plain(a[n])&&
 Object.keys(a[n]).length===2&&Number.isInteger(a[n].count)&&a[n].count>=0&&a[n].count<=150&&
 /^[a-f0-9]{64}$/.test(a[n].sha256));

/** No alternate baseline may be provided via the executable workflow's CLI. */
export async function auditMmfJointReadOnly({accountId,token,fetchImpl=globalThis.fetch,
 sourceBaselines=MMF_EXPECTED_SOURCE_HASHES,bindingBaselines=MMF_LEGACY_BINDING_BASELINE}={}){
 try{
  if(accountId!==ACCOUNT||typeof token!=='string'||token.length<20||token.length>500||
    typeof fetchImpl!=='function'||!validSource(sourceBaselines)||!validBinding(bindingBaselines))deny();
  const start=Date.now();
  const get=async url=>{
   const response=await fetchImpl(url,{method:'GET',cache:'no-store',redirect:'error',
    headers:{authorization:`Bearer ${token}`,accept:'application/json','cache-control':'no-store'},
    signal:AbortSignal.timeout(15_000)});
   if(!(response instanceof Response)||!response.ok)deny();
   const len=response.headers.get('content-length');
   if(len!==null&&(!/^\d+$/.test(len)||Number(len)>2_000_000))deny();
   return response;
  };
  const observed=[];
  // Two complete serial sweeps: a one-sided source read or settings read cannot
  // independently establish a consistent combined observation window.
  for(let round=0;round<2;round++)for(const workerName of NAMES){
   const source=await canonicalCloudflareWorkerSource(await get(ROOT+workerName));
   const response=await get(ROOT+workerName+'/settings');
   if(!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type')||''))deny();
   const raw=await response.text();
   if(Buffer.byteLength(raw)>200_000)deny();
   const settings=JSON.parse(raw);
   if(!plain(settings)||settings.success!==true||!plain(settings.result)||
      !Array.isArray(settings.result.bindings))deny();
   const meta=assessMmfBindingMetadata(settings.result.bindings,bindingBaselines[workerName]);
   const existing=observed.find(x=>x.workerName===workerName);
   if(existing){
    if(existing.sourceSha256!==source.sourceSha256||
       existing.bindingMetadataSha256!==meta.bindingMetadataSha256||
       existing.bindingCount!==meta.bindingCount)deny();
   }else{
    const mmfToken=workerName===NAMES[0]?'MMF_AUTHORITY_BRIDGE_TOKEN':'MMF_TRANSPORT_BRIDGE_TOKEN';
    const mmfRoutes=workerName===NAMES[0]?
      ['/internal/paynow/sign-initiate-mmf','/internal/paynow/verify-callback-mmf']:
      ['/internal/paynow/initiate-mmf'];
    observed.push({workerName,sourceSha256:source.sourceSha256,
      sourceBaselineMatches:source.sourceSha256===sourceBaselines[workerName],
      bindingMetadataSha256:meta.bindingMetadataSha256,
      bindingCount:meta.bindingCount,bindingBaselineMatches:meta.baselineMatches,
      mmfRouteMarkersPresent:mmfRoutes.filter(x=>source.sourceText.includes(x)).length,
      mmfSecretBindingNamePresent:settings.result.bindings.some(x=>x.name===mmfToken),
      sourceStableAcrossReads:true,bindingMetadataStableAcrossReads:true,
      secretValuesRead:false});
   }
  }
  const elapsedMs=Date.now()-start;
  if(elapsedMs<0||elapsedMs>120_000||observed.length!==2)deny();
  const match=observed.every(w=>w.sourceBaselineMatches&&w.bindingBaselineMatches);
  return Object.freeze({schema:'mmf-joint-source-binding-getonly-v1',
   gate:match?'MMF_JOINT_CLOUDFLARE_GET_ONLY_BASELINE_MATCH':'MMF_JOINT_CLOUDFLARE_GET_ONLY_DRIFT_BLOCKED',
   observedAtUtc:new Date().toISOString(),observedWithinMs:elapsedMs,
   workerChecks:Object.freeze(observed.map(x=>Object.freeze(x))),
   jointBaselineMatches:match,cloudflareRequestMethod:'GET',cloudflareGetCount:8,
   cloudflareMutationCount:0,merchantSecretValuesRead:false,customerFundsTouched:false,
   paymentProviderInvoked:false,independentApprovalConfirmed:false,
   merchantProductEligibilityProven:false,nonExportableSecretsRollbackProven:false,
   productionReleaseAuthorized:false,mayDeploySharedWorkers:false,
   realProviderPaymentsAllowed:false});
 }catch{deny()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3||process.argv[2]!=='--get-only'||!process.env.RUNNER_TEMP)deny();
 const result=await auditMmfJointReadOnly({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
  token:process.env.CLOUDFLARE_API_TOKEN});
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-paynow-joint-source-binding-getonly.json'),
  JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({gate:result.gate,jointBaselineMatches:result.jointBaselineMatches,
   cloudflareGetCount:result.cloudflareGetCount,cloudflareMutationCount:0,
   productionReleaseAuthorized:false,workerCount:result.workerChecks.length}));
 if(!result.jointBaselineMatches)process.exitCode=2;
}