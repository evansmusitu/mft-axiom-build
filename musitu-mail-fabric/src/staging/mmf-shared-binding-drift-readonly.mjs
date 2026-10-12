/**
 * Cloudflare GET-only baseline of the two shared Paynow Workers' binding NAME+TYPE.
 * Expected hashes were derived offline from the authenticated, encrypted
 * source/settings backup, without placing binding values in the repository.
 * No source mutation, secret exposure, provider operation or release grant.
 */
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
export const MMF_LEGACY_BINDING_BASELINE = Object.freeze({
  'mft-phase8-external-authority': Object.freeze({count:13,sha256:'ceacccdcd5bcaae795ab62b828065fb53c7fed8046316992809773ce8c8454a7'}),
  'mft-paynow-transport-gateway': Object.freeze({count:7,sha256:'0c1205be099d0225367f98967c93a26f7d5a361a17fcd6719b5de9b16830d978'})
});
const ACCOUNT='93f395f5121954671f92fffa453d6b61';
const ENDPOINT=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/`;
const WORKERS=Object.keys(MMF_LEGACY_BINDING_BASELINE);
const DENIED='MMF_BINDING_BASELINE_DENIED';
const deny=()=>{throw Error(DENIED)};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const fp=x=>createHash('sha256').update(x).digest('hex');
/** Pure bounded projection: values, metadata and any unrecognized fields never leave the call. */
export function assessMmfBindingMetadata(bindings,expected){
 try{
  if(!Array.isArray(bindings)||bindings.length>150||
   !plain(expected)||!Number.isInteger(expected.count)||expected.count<0||expected.count>150||
   typeof expected.sha256!=='string'||!/^[0-9a-f]{64}$/.test(expected.sha256))deny();
  const names=new Set();
  const safe=bindings.map(b=>{
   if(!plain(b)||typeof b.name!=='string'||b.name.length<1||b.name.length>100||
     /[\x00-\x1f\x7f]/.test(b.name)||typeof b.type!=='string'||
     !/^[a-z][a-z0-9_]{1,65}$/.test(b.type)||names.has(b.name)||
     ['value','text','secret','token','privateKey'].some(k=>Object.hasOwn(b,k)))deny();
   names.add(b.name);
   return {name:b.name,type:b.type};
  });
  safe.sort((a,b)=>a.name.localeCompare(b.name));
  const metadataSha256=fp(JSON.stringify(safe));
  return Object.freeze({bindingCount:safe.length,bindingMetadataSha256:metadataSha256,
   baselineMatches:safe.length===expected.count&&metadataSha256===expected.sha256,
   secretValuesRead:false,mayDeploySharedWorker:false});
 }catch{deny()}
}
/** Observes settings ONLY; success never grants deployment or real payments. */
export async function auditMmfLegacyBindingInventory({accountId,token,fetchImpl=globalThis.fetch}={}){
 try{
  if(accountId!==ACCOUNT||typeof token!=='string'||token.length<20||token.length>500||typeof fetchImpl!=='function')deny();
  const checks=[];
  for(const workerName of WORKERS){
   const response=await fetchImpl(ENDPOINT+workerName+'/settings',{
    method:'GET',headers:{authorization:`Bearer ${token}`,accept:'application/json','cache-control':'no-store'},
    cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15_000)
   });
   if(!(response instanceof Response)||!response.ok)deny();
   const ct=response.headers.get('content-type')||'';
   const len=response.headers.get('content-length');
   if(!/^application\/json(?:\s*;|\s*$)/i.test(ct)||
     (len!==null&&(!/^\d+$/.test(len)||Number(len)>200_000)))deny();
   const body=await response.text();
   if(body.length>200_000)deny();
   const obj=JSON.parse(body);
   if(!plain(obj)||obj.success!==true||!plain(obj.result)||!Array.isArray(obj.result.bindings))deny();
   const result=assessMmfBindingMetadata(obj.result.bindings,MMF_LEGACY_BINDING_BASELINE[workerName]);
   checks.push(Object.freeze({workerName, ...result}));
  }
  const baselineMatches=checks.every(x=>x.baselineMatches);
  return Object.freeze({schema:'mmf-shared-paynow-legacy-binding-getonly-v1',
   gate:baselineMatches?'MMF_LEGACY_BINDING_BASELINE_MATCH':'MMF_LEGACY_BINDING_DRIFT_BLOCKED',
   observedAtUtc:new Date().toISOString(),workerChecks:Object.freeze(checks),
   bindingBaselineMatches:baselineMatches,cloudflareGetCount:2,cloudflareMutationCount:0,
   secretValuesRead:false,nonExportableSecretValuesRecovered:false,
   independentApprovalConfirmed:false,merchantProductEligibilityProven:false,
   mayDeploySharedWorkers:false,mayInitiateProviderPayments:false,
   productionReleaseAuthorized:false});
 }catch{deny()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3||process.argv[2]!=='--get-only'||!process.env.RUNNER_TEMP)deny();
 const result=await auditMmfLegacyBindingInventory({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-paynow-legacy-binding-getonly-sanitized.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({gate:result.gate,bindingBaselineMatches:result.bindingBaselineMatches,
  workerCount:result.workerChecks.length,cloudflareGetCount:2,cloudflareMutationCount:0,
  productionReleaseAuthorized:false}));
 if(!result.bindingBaselineMatches)process.exitCode=2;
}