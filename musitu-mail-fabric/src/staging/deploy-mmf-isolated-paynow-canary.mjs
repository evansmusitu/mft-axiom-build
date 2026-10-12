/**
 * Owner-authorized, NONFINANCIAL isolated Cloudflare canary only.
 * Never mutates shared Paynow Workers, routes, DNS, merchant keys or customer data.
 * The canary returns 503 for EVERY request and workers.dev is explicitly disabled.
 * No user-facing payment capability is created by success.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {canonicalCloudflareWorkerSource} from './canonical-cloudflare-worker-source.mjs';
const ACCOUNT='93f395f5121954671f92fffa453d6b61';
const BRANCH='product/musitu-mail-fabric-isolated-20261009';
export const MMF_CANARY_NAME='mmf-paynow-isolated-deny-canary-20261012';
export const MMF_CANARY_DENIED='MMF_CANARY_DEPLOY_DENIED';
const BASE=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts`;
const sha=v=>createHash('sha256').update(v).digest('hex');
const fail=()=>{throw Error(MMF_CANARY_DENIED)};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
export async function deployIsolatedMmfCanary({accountId,token,branch,script,scriptSha256,fetchImpl=globalThis.fetch}={}){
 let created=false;
 const url=BASE+'/'+MMF_CANARY_NAME;
 try{
  if(accountId!==ACCOUNT||branch!==BRANCH||typeof token!=='string'||token.length<20||token.length>500||
    typeof script!=='string'||script.length<200||script.length>8000||sha(script)!==scriptSha256||
    typeof fetchImpl!=='function')fail();
  // Pin to local, reviewed deny-all script, never accept arbitrary third-party code.
  const source=readFileSync(fileURLToPath(new URL('./mmf-paynow-canary.mjs',import.meta.url)),'utf8');
  if(script!==source||!script.includes("status:503")||!script.includes('paymentsEnabled:false'))fail();
  const headers={authorization:`Bearer ${token}`,'cache-control':'no-store',accept:'application/json'};
  async function call(path,method='GET',body){
    if(![BASE,url,url+'/settings',url+'/subdomain'].includes(path)||
      !['GET','PUT','POST','DELETE'].includes(method)||
      (method==='PUT'&&path!==url)||(method==='DELETE'&&path!==url)||
      (method==='POST'&&path!==url+'/subdomain'))fail();
    const h={...headers};if(method==='POST')h['content-type']='application/json';
    return await fetchImpl(path,{method,headers:h,body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20_000)});
  }
  async function json(r){if(!(r instanceof Response)||!r.ok)fail();const body=await r.text();if(body.length>100_000)fail();
   const v=JSON.parse(body);if(!plain(v)||v.success!==true)fail();return v.result;}
  const list=await json(await call(BASE));
  if(!Array.isArray(list)||list.length>500||list.some(x=>!plain(x)||typeof x.id!=='string'))fail();
  const scripts=new Set(list.map(x=>x.id));
  if(!scripts.has('mft-phase8-external-authority')||!scripts.has('mft-paynow-transport-gateway')||scripts.has(MMF_CANARY_NAME))fail();
  const existing=await call(url);
  if(!(existing instanceof Response)||existing.status!==404)fail();
  const payload=new FormData();
  payload.set('metadata',JSON.stringify({main_module:'canary.mjs',bindings:[],compatibility_date:'2026-10-12'}));
  payload.set('canary.mjs',new Blob([script],{type:'application/javascript+module'}),'canary.mjs');
  await json(await call(url,'PUT',payload));
  created=true;
  await json(await call(url+'/subdomain','POST',JSON.stringify({enabled:false,previews_enabled:false})));
  const sub=await json(await call(url+'/subdomain'));
  if(!plain(sub)||sub.enabled!==false||sub.previews_enabled!==false)fail();
  const settings=await json(await call(url+'/settings'));
  if(!plain(settings)||!Array.isArray(settings.bindings)||settings.bindings.length!==0)fail();
  const readback=await call(url);
  if(!(readback instanceof Response)||!readback.ok)fail();
  const recovered=await canonicalCloudflareWorkerSource(readback);
  if(recovered.sourceText!==script)fail();
  return Object.freeze({schema:'mmf-disabled-isolated-canary-proof-v1',
   gate:'MMF_ISOLATED_CANARY_DENY_ONLY_DEPLOYED',workerName:MMF_CANARY_NAME,
   sourceSha256:scriptSha256,workersDevEnabled:false,paymentEnabled:false,
   merchantSecretsTransferred:false,legacyWorkersMutated:false,
   cloudflareCanaryCreated:true,canDeploySharedWorkers:false,
   merchantProductEligibilityProven:false,independentReleaseApprovalVerified:false,
   customerEmailEnabled:false});
 }catch{
  if(created){
   // Cleanup is restricted to the exact never-preexisting disposable canary.
   try{await fetchImpl(url,{method:'DELETE',headers:{authorization:`Bearer ${token}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20_000)});}catch{}
  }
  fail();
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3||process.argv[2]!=='--owner-authorized-isolated-canary'||
   process.env.GITHUB_REF_NAME!==BRANCH||!process.env.RUNNER_TEMP)fail();
 const script=readFileSync(new URL('./mmf-paynow-canary.mjs',import.meta.url),'utf8');
 const result=await deployIsolatedMmfCanary({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
  token:process.env.CLOUDFLARE_API_TOKEN,branch:process.env.GITHUB_REF_NAME,
  script,scriptSha256:sha(script)});
 console.log(JSON.stringify(result));
}