/**
 * Bind the existing MUSITU Paynow authority/transport workers as INTERNAL services
 * to the ALREADY-EXISTING, never-public, deny-all MMF canary.
 * No production payment-worker source, secret, route, DNS, payment or mail writes.
 * This is infrastructure connectivity only; the MMF canary continues returning 503.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {canonicalCloudflareWorkerSource} from './canonical-cloudflare-worker-source.mjs';
import {auditMmfJointReadOnly} from './mmf-joint-source-binding-getonly.mjs';
const ACCOUNT='93f395f5121954671f92fffa453d6b61';
const BRANCH='product/musitu-mail-fabric-isolated-20261009';
const SCRIPT='mmf-paynow-isolated-deny-canary-20261012';
const ROOT=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts`;
const AUTHORITY='mft-phase8-external-authority';
const TRANSPORT='mft-paynow-transport-gateway';
const EXPECTED_SHA='a9c9ffb29212104757e15dd9080ed9145b976d673921ac550940808a0a404083';
const BINDINGS=Object.freeze([
 Object.freeze({type:'service',name:'MMF_PAYNOW_AUTHORITY',service:AUTHORITY}),
 Object.freeze({type:'service',name:'MMF_PAYNOW_TRANSPORT',service:TRANSPORT})
]);
const sha=x=>createHash('sha256').update(x).digest('hex');
const denied=()=>{throw Error('MMF_EXISTING_PAYNOW_BINDING_DENIED')};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function verifyAudit(o){
 if(!plain(o)||o.jointBaselineMatches!==true||o.cloudflareMutationCount!==0||
   !Array.isArray(o.workerChecks)||o.workerChecks.length!==2||
   [AUTHORITY,TRANSPORT].some((name,i)=>o.workerChecks[i]?.workerName!==name||
      o.workerChecks[i]?.sourceBaselineMatches!==true||o.workerChecks[i]?.bindingBaselineMatches!==true))denied();
}
export async function bindMmfToExistingPaynowServices({accountId,token,branch,fetchImpl=globalThis.fetch,integrityAudit=auditMmfJointReadOnly}={}){
 try{
  if(accountId!==ACCOUNT||branch!==BRANCH||typeof token!=='string'||token.length<20||token.length>500||
    typeof fetchImpl!=='function'||typeof integrityAudit!=='function')denied();
  const script=readFileSync(new URL('./mmf-paynow-canary.mjs',import.meta.url),'utf8');
  if(sha(script)!==EXPECTED_SHA||!script.includes('status:503')||!script.includes('paymentsEnabled:false')||
    script.includes('env.'))denied();
  // A successful audit must match BOTH existing payment-worker source and binding
  // baselines. It never grants consent to perform a payment or shared-worker write.
  verifyAudit(await integrityAudit({accountId,token,fetchImpl}));
  const headers={authorization:`Bearer ${token}`,accept:'application/json','cache-control':'no-store'};
  const send=async(url,method='GET',body)=>{
   if(![ROOT,ROOT+'/'+SCRIPT,ROOT+'/'+SCRIPT+'/settings',ROOT+'/'+SCRIPT+'/subdomain'].includes(url)||
      (method!=='GET'&&!(method==='PUT'&&url===ROOT+'/'+SCRIPT)))denied();
   const res=await fetchImpl(url,{method,headers,body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20_000)});
   if(!(res instanceof Response)||!res.ok)denied();return res;
  };
  const obj=async r=>{
   const raw=await r.text();if(raw.length>100_000)denied();
   const parsed=JSON.parse(raw);if(!plain(parsed)||parsed.success!==true)denied();return parsed.result;
  };
  const catalog=await obj(await send(ROOT));
  if(!Array.isArray(catalog)||catalog.length>500||catalog.some(x=>!plain(x)||typeof x.id!=='string'))denied();
  const names=new Set(catalog.map(x=>x.id));
  if([SCRIPT,AUTHORITY,TRANSPORT].some(x=>!names.has(x)))denied();
  const source=await canonicalCloudflareWorkerSource(await send(ROOT+'/'+SCRIPT));
  if(source.sourceSha256!==EXPECTED_SHA||source.sourceText!==script)denied();
  const sub=await obj(await send(ROOT+'/'+SCRIPT+'/subdomain'));
  if(!plain(sub)||sub.enabled!==false||sub.previews_enabled!==false)denied();
  const current=await obj(await send(ROOT+'/'+SCRIPT+'/settings'));
  if(!plain(current)||!Array.isArray(current.bindings)||current.bindings.length>2)denied();
  const connected=exact(current.bindings,BINDINGS);
  if(!connected&&current.bindings.length!==0)denied();
  if(!connected){
   const form=new FormData();
   form.set('metadata',JSON.stringify({main_module:'canary.mjs',compatibility_date:'2026-10-12',bindings:BINDINGS}));
   form.set('canary.mjs',new Blob([script],{type:'application/javascript+module'}),'canary.mjs');
   await obj(await send(ROOT+'/'+SCRIPT,'PUT',form));
  }
  const after=await obj(await send(ROOT+'/'+SCRIPT+'/settings'));
  if(!plain(after)||!exact(after.bindings,BINDINGS))denied();
  const afterSub=await obj(await send(ROOT+'/'+SCRIPT+'/subdomain'));
  if(!plain(afterSub)||afterSub.enabled!==false||afterSub.previews_enabled!==false)denied();
  const afterSrc=await canonicalCloudflareWorkerSource(await send(ROOT+'/'+SCRIPT));
  if(afterSrc.sourceSha256!==EXPECTED_SHA||afterSrc.sourceText!==script)denied();
  verifyAudit(await integrityAudit({accountId,token,fetchImpl}));
  return Object.freeze({schema:'mmf-existing-paynow-services-connected-disabled-v1',
   gate:'MMF_EXISTING_PAYNOW_SERVICE_BINDINGS_CONNECTED_DISABLED',
   canaryWorker:SCRIPT,services:Object.freeze([AUTHORITY,TRANSPORT]),
   canarySourceSha256:EXPECTED_SHA,serviceBindingCount:2,
   idempotentReadback:connected,existingWorkersModified:false,workersDevEnabled:false,
   serviceBindingReadbackVerified:true,merchantCredentialsCopied:false,
   MMFProductRoutesAvailable:false,realPaymentsEnabled:false,
   paymentProviderCalled:false,merchantSecretsTransferred:false,
   independentReleaseApprovalVerified:false,canDeploySharedWorkers:false});
 }catch{denied()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3||process.argv[2]!=='--bind-existing-services-disabled'||
   process.env.GITHUB_REF_NAME!==BRANCH||!process.env.RUNNER_TEMP)denied();
 const result=await bindMmfToExistingPaynowServices({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
  token:process.env.CLOUDFLARE_API_TOKEN,branch:process.env.GITHUB_REF_NAME});
 console.log(JSON.stringify(result));
}