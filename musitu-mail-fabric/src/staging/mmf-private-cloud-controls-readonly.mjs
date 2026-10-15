/**
 * MMF account-wide GET-only preflight. Never mutates Worker routes, mail, DNS,
 * billing, or customer state. Outputs only de-identified gate booleans/counts.
 * Does not establish absence of custom zone routes or production authorization.
 */
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assessMmfBindingMetadata,MMF_LEGACY_BINDING_BASELINE} from './mmf-shared-binding-drift-readonly.mjs';

const ACCOUNT='93f395f5121954671f92fffa453d6b61';
const ROOT='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/workers/scripts/';
const STAGE='mmf-commercial-private-sqlite-stage-20261012';
const CANARY='mmf-paynow-isolated-deny-canary-20261012';
const SHARED=['mft-phase8-external-authority','mft-paynow-transport-gateway'];
const FLAGS=['MMF_STAGE_ONLY','MMF_REAL_SEND_ENABLED','MMF_COMMERCE_ENABLED','MMF_CUSTOMER_API_ENABLED','MMF_MAIL_SENDING_ENABLED'];
const DENIED='MMF_PRIVATE_GETONLY_CONTROL_DENIED';
const deny=()=>{throw Error(DENIED)};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const hasOnlyKeys=(v,allowed)=>plain(v)&&Object.keys(v).every(k=>allowed.includes(k));

export async function inspectMmfPrivateCloudControls({accountId,token,fetchImpl=globalThis.fetch,
 sharedBaselines=MMF_LEGACY_BINDING_BASELINE}={}){
 try{
  if(accountId!==ACCOUNT||typeof token!=='string'||token.length<20||token.length>500||
   typeof fetchImpl!=='function'||!plain(sharedBaselines)||
   Object.keys(sharedBaselines).length!==2||SHARED.some(n=>!plain(sharedBaselines[n])))deny();
  const allowed=new Set([
   ...[STAGE,CANARY].flatMap(n=>[n+'/settings',n+'/subdomain']),
   STAGE+'/secrets',...SHARED.map(n=>n+'/settings')
  ]);
  let calls=0;
  async function get(path){
   if(!allowed.has(path)||calls>=9)deny();calls++;
   const r=await fetchImpl(ROOT+path,{method:'GET',headers:{authorization:'Bearer '+token,
    accept:'application/json','cache-control':'no-store'},cache:'no-store',
    redirect:'error',signal:AbortSignal.timeout(15_000)});
   if(!(r instanceof Response)||r.status!==200||!r.ok||r.redirected||
    !/^application\/json(?:\s*;|\s*$)/i.test(r.headers.get('content-type')||''))deny();
   const len=r.headers.get('content-length');
   if(len!==null&&(!/^\d+$/.test(len)||Number(len)>100_000))deny();
   if(!r.body)deny();
   const chunks=[];let size=0;const reader=r.body.getReader();
   try{while(true){const {done,value}=await reader.read();if(done)break;
    if(!(value instanceof Uint8Array))deny();size+=value.byteLength;
    if(size>100_000)deny();chunks.push(value);
   }}finally{try{reader.releaseLock()}catch{}}
   const bytes=new Uint8Array(size);let offset=0;
   for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
   const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(!plain(data)||data.success!==true||!Object.hasOwn(data,'result'))deny();
   return data.result;
  }
  const stageSettings=await get(STAGE+'/settings');
  const stageSub=await get(STAGE+'/subdomain');
  const stageSecrets=await get(STAGE+'/secrets');
  if(!plain(stageSettings)||!Array.isArray(stageSettings.bindings)||
    !plain(stageSub)||!Array.isArray(stageSecrets))deny();
  const bindings=stageSettings.bindings;
  const stageDisabled=stageSub.enabled===false&&stageSub.previews_enabled===false&&
   stageSecrets.length===0&&bindings.length===6&&
   FLAGS.every(name=>bindings.filter(b=>plain(b)&&b.name===name&&b.type==='plain_text'&&b.text==='false').length===1)&&
   bindings.filter(b=>plain(b)&&b.name==='MMF_COMMERCIAL_PRIVATE_STAGE'&&
    b.type==='durable_object_namespace'&&b.class_name==='MmfCommercialPrivateStageDO').length===1;
  const canarySettings=await get(CANARY+'/settings');
  const canarySub=await get(CANARY+'/subdomain');
  if(!plain(canarySettings)||!Array.isArray(canarySettings.bindings)||!plain(canarySub))deny();
  const services=canarySettings.bindings;
  const canaryDisabled=canarySub.enabled===false&&canarySub.previews_enabled===false&&services.length===2&&
   [['MMF_PAYNOW_AUTHORITY',SHARED[0]],['MMF_PAYNOW_TRANSPORT',SHARED[1]]].every(([name,service])=>
    services.filter(b=>plain(b)&&b.name===name&&b.type==='service'&&b.service===service).length===1);
  let sharedBindingsMatch=true,sharedStable=true;
  for(const name of SHARED){
   const first=await get(name+'/settings'),second=await get(name+'/settings');
   if(!plain(first)||!Array.isArray(first.bindings)||!plain(second)||!Array.isArray(second.bindings))deny();
   const expected=sharedBaselines[name];
   if(!hasOnlyKeys(expected,['count','sha256']))deny();
   const one=assessMmfBindingMetadata(first.bindings,expected);
   const two=assessMmfBindingMetadata(second.bindings,expected);
   sharedStable&&=one.bindingMetadataSha256===two.bindingMetadataSha256;
   sharedBindingsMatch&&=one.baselineMatches&&two.baselineMatches;
  }
  if(calls!==9)deny();
  const pass=stageDisabled&&canaryDisabled&&sharedBindingsMatch&&sharedStable;
  return Object.freeze({schema:'mmf-private-cloud-getonly-preflight-v20261015',
   gate:pass?'MMF_PRIVATE_GETONLY_CONTROL_BASELINE_MATCH':'MMF_PRIVATE_GETONLY_CONTROL_DRIFT_BLOCKED',
   observedAtUtc:new Date().toISOString(),stageDisabled,canaryDisabled,
   sharedBindingsMatch,sharedBindingReadbackStable:sharedStable,sharedWorkersInspected:2,
   cloudflareGetCount:calls,cloudflareMutationCount:0,secretValuesReturned:false,
   publicRoutesIndependentlyInspected:false,productionReleaseAuthorized:false,
   realCustomerSendingEnabled:false,realPaymentsEnabled:false,
   authorizeNewDeployment:false,authorizeCustomerSignup:false});
 }catch{deny()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3||process.argv[2]!=='--get-only'||!process.env.RUNNER_TEMP)deny();
 const result=await inspectMmfPrivateCloudControls({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
  token:process.env.CLOUDFLARE_API_TOKEN});
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-private-control-getonly-20261015.json'),
  JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({gate:result.gate,stageDisabled:result.stageDisabled,
  canaryDisabled:result.canaryDisabled,sharedBindingsMatch:result.sharedBindingsMatch,
  cloudflareGetCount:result.cloudflareGetCount,cloudflareMutationCount:0,
  productionReleaseAuthorized:false}));
 if(result.gate!=='MMF_PRIVATE_GETONLY_CONTROL_BASELINE_MATCH')process.exitCode=2;
}
