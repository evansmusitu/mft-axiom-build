/**
 * Cloudflare GET-only MMF merchant-scope inventory. No mutation, polling,
 * provider transaction, auth token echo, source export, or customer data.
 */
import {canonicalCloudflareWorkerSource} from './canonical-cloudflare-worker-source.mjs';
import {assessMmfLivePaynowScope} from '../commercial/mmf-live-paynow-scope-audit.mjs';
const ACCOUNT='93f395f5121954671f92fffa453d6b61';
const NAMES=['mft-phase8-external-authority','mft-paynow-transport-gateway','mft-fmi-billing'];
const PATH_RE=/\/(?:internal\/paynow|billing|v1\/billing)\/[A-Za-z0-9_./-]{1,100}/g;
function deny(){throw Error('MMF_PAYNOW_CLOUDFLARE_READONLY_DENIED')}
export async function auditLiveMmfPaynowScope({accountId,token,fetchImpl=globalThis.fetch}={}){
 if(accountId!==ACCOUNT||typeof token!=='string'||token.length<20||typeof fetchImpl!=='function')deny();
 const base=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/`;
 const headers={authorization:`Bearer ${token}`,accept:'application/json'};
 const inventory={};
 let normalizedSourceStable=true,legacyRepresentationComparable=true;
 for(const name of NAMES){
  const get=async path=>{
   let res;try{res=await fetchImpl(base+name+path,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{deny()}
   if(!(res instanceof Response)||!res.ok)deny();
   const contentLength=res.headers.get('content-length');
   if(contentLength!==null&&(!/^\d+$/.test(contentLength)||Number(contentLength)>2_000_000))deny();
   return res;
  };
  const source=await canonicalCloudflareWorkerSource(await get(''));
  const repeat=await canonicalCloudflareWorkerSource(await get(''));
  if(source.sourceSha256!==repeat.sourceSha256)normalizedSourceStable=false;
  if(source.multipartNormalized||repeat.multipartNormalized)legacyRepresentationComparable=false;
  let settings;try{settings=await (await get('/settings')).json()}catch{deny()}
  if(settings?.success!==true||!Array.isArray(settings.result?.bindings))deny();
  const names=settings.result.bindings.map(b=>b?.name);
  if(names.some(x=>typeof x!=='string')||names.length>120)deny();
  inventory[name]={sourceSha256:source.sourceSha256,bindingNames:names,
   paths:[...new Set(source.sourceText.match(PATH_RE)||[])].sort()};
 }
 const status=assessMmfLivePaynowScope(inventory);
 const comparable=normalizedSourceStable&&legacyRepresentationComparable;
 return Object.freeze({...status,
  verifiedExistingMerchantStack:comparable&&status.verifiedExistingMerchantStack,
  changedSharedWorkers:comparable?status.changedSharedWorkers:Object.freeze([]),
  sourceReadbackStableAcrossReads:normalizedSourceStable,
  multipartSourceNormalized:!legacyRepresentationComparable,
  historicalRawHashBaselineComparable:legacyRepresentationComparable,
  sourceHashDriftIndependentlyProven:comparable&&status.changedSharedWorkers.length>0,
  baselineMismatchMayBeNondeterministicSource:!normalizedSourceStable,
  sourceCodeSemanticallyStableButBaselineUncomparable:normalizedSourceStable&&!legacyRepresentationComparable,
  observedWorkerCount:NAMES.length,
  cloudflareCalls:NAMES.length*3,cloudflareMethod:'GET',
  transactionOrCustomerDataAccessed:false,merchantSecretsRead:false,
  cloudflareMutations:false,customerFunds:false,customerEmail:false});
}
