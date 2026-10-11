/**
 * Cloudflare GET-only MMF merchant-scope inventory. No mutation, polling,
 * provider transaction, auth token echo, source export, or customer data.
 */
import {createHash} from 'node:crypto';
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
 let sameBytesAcrossReads=true;
 for(const name of NAMES){
  const get=async path=>{
   let res;try{res=await fetchImpl(base+name+path,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{deny()}
   if(!(res instanceof Response)||!res.ok)deny();
   const contentLength=res.headers.get('content-length');
   if(contentLength!==null&&(!/^\d+$/.test(contentLength)||Number(contentLength)>2_000_000))deny();
   return res;
  };
  const source=await (await get('')).text();
  const repeat=await (await get('')).text();
  if(source.length<100||Buffer.byteLength(source)>2_000_000||
     repeat.length<100||Buffer.byteLength(repeat)>2_000_000)deny();
  if(source!==repeat)sameBytesAcrossReads=false;
  let settings;try{settings=await (await get('/settings')).json()}catch{deny()}
  if(settings?.success!==true||!Array.isArray(settings.result?.bindings))deny();
  const names=settings.result.bindings.map(b=>b?.name);
  if(names.some(x=>typeof x!=='string')||names.length>120)deny();
  inventory[name]={sourceSha256:createHash('sha256').update(source).digest('hex'),bindingNames:names,
   paths:[...new Set(source.match(PATH_RE)||[])].sort()};
 }
 const status=assessMmfLivePaynowScope(inventory);
 return Object.freeze({...status,
  verifiedExistingMerchantStack:sameBytesAcrossReads&&status.verifiedExistingMerchantStack,
  changedSharedWorkers:sameBytesAcrossReads?status.changedSharedWorkers:Object.freeze([]),
  sourceReadbackStableAcrossReads:sameBytesAcrossReads,
  sourceHashDriftIndependentlyProven:sameBytesAcrossReads&&status.changedSharedWorkers.length>0,
  baselineMismatchMayBeNondeterministicSource:!sameBytesAcrossReads,
  observedWorkerCount:NAMES.length,
  cloudflareCalls:NAMES.length*3,cloudflareMethod:'GET',
  transactionOrCustomerDataAccessed:false,merchantSecretsRead:false,
  cloudflareMutations:false,customerFunds:false,customerEmail:false});
}
