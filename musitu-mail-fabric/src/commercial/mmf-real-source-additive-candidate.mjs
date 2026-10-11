/**
 * Source-grounded, additive, OFFLINE-ONLY shared Paynow Worker MMF stage probe.
 * It does not implement, authorize or initiate any provider payment, refunds,
 * callback acceptance, billing entitlement, customer email or deployment.
 * Existing exports/functions and non-MMF request semantics are retained.
 * The patched source MUST be sealed before leaving the trusted local process.
 */
import {createHash} from 'node:crypto';
const ERROR='MMF_OFFLINE_SOURCE_PATCH_DENIED';
const deny=()=>{throw Error(ERROR)};
const sha=v=>createHash('sha256').update(v).digest('hex');
const CONFIG=Object.freeze({
 'mft-phase8-external-authority':Object.freeze({role:'AUTHORITY',anchor:'export default {fetch:handleRequest};',delegate:'handleRequest(request, env, ctx)'}),
 'mft-paynow-transport-gateway':Object.freeze({role:'TRANSPORT',anchor:'export default { fetch: (request, env, ctx) => handleRequest(request, env, ctx, fetch) };',delegate:'handleRequest(request, env, ctx, fetch)'})
});
const STAGE_SNIPPET=String.raw`
// MUSITU MMF independent product route boundary: SYNTHETIC ONLY, NEVER PAYMENTS.
// Missing staging gates deny by construction; no legacy merchant authorization reused.
const __mmf20261011AllRoutes=new Set(['/internal/paynow/sign-initiate-mmf','/internal/paynow/verify-callback-mmf','/internal/paynow/initiate-mmf']);
const __mmf20261011RoleRoutes={AUTHORITY:new Set(['/internal/paynow/sign-initiate-mmf','/internal/paynow/verify-callback-mmf']),TRANSPORT:new Set(['/internal/paynow/initiate-mmf'])};
const __mmf20261011TokenName={AUTHORITY:'MMF_AUTHORITY_BRIDGE_TOKEN',TRANSPORT:'MMF_TRANSPORT_BRIDGE_TOKEN'};
const __mmf20261011CrossNames=['FMI_AUTHORITY_BRIDGE_TOKEN','FMI_TRANSPORT_BRIDGE_TOKEN','CHEMISTRY_AUTHORITY_BRIDGE_TOKEN','CHEMISTRY_TRANSPORT_BRIDGE_TOKEN','AXIOM_AUTHORITY_BRIDGE_TOKEN','AXIOM_TRANSPORT_BRIDGE_TOKEN'];
const __mmf20261011Response=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const __mmf20261011Plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
const __mmf20261011Token=t=>typeof t==='string'&&t.length>=32&&t.length<=300&&!/[\r\n\u0000-\u001f]/.test(t);
async function __mmf20261011SameToken(a,b){
 if(!__mmf20261011Token(a)||!__mmf20261011Token(b))return false;
 const enc=new TextEncoder();const [da,db]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(a)),crypto.subtle.digest('SHA-256',enc.encode(b))]);
 const x=new Uint8Array(da),y=new Uint8Array(db);let v=0;for(let i=0;i<x.length;i++)v|=x[i]^y[i];return v===0;
}
async function __mmf20261011Stage(request,env,role){
 let path,url;try{url=new URL(request.url);path=url.pathname}catch{return __mmf20261011Response(400,{error:'INVALID_REQUEST'})}
 if(!__mmf20261011AllRoutes.has(path))return null;
 if(!__mmf20261011RoleRoutes[role].has(path))return __mmf20261011Response(404,{error:'NOT_FOUND'});
 if(!env||env.MMF_PRODUCT_STAGE_ONLY!=='true'||env.MMF_PRODUCT_STAGE_TENANT!=='mmf_stage_20261011'||
  env.MMF_PRODUCTION_PAYMENTS_ENABLED!=='false'||env.MMF_COMMERCE_ENABLED!=='false'||
  env.MMF_REAL_SEND_ENABLED!=='false'||env.MMF_MAIL_SENDING_ENABLED!=='false')return __mmf20261011Response(503,{error:'MMF_PRODUCT_ROUTE_DISABLED'});
 const t=env[__mmf20261011TokenName[role]];
 if(!__mmf20261011Token(t)||__mmf20261011CrossNames.some(k=>env[k]===t)||
  (role==='AUTHORITY'?env.MMF_TRANSPORT_BRIDGE_TOKEN===t:env.MMF_AUTHORITY_BRIDGE_TOKEN===t))
   return __mmf20261011Response(503,{error:'MMF_PRODUCT_ROUTE_DISABLED'});
 if(request.method!=='POST'||url.search||url.hash||url.username||url.password)return __mmf20261011Response(405,{error:'METHOD_NOT_ALLOWED'});
 const h=request.headers.get('authorization')||'';
 if(!h.startsWith('Bearer ')||!(await __mmf20261011SameToken(h.slice(7),t)))return __mmf20261011Response(401,{error:'UNAUTHORIZED'});
 if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')||''))return __mmf20261011Response(415,{error:'UNSUPPORTED_MEDIA_TYPE'});
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>768))return __mmf20261011Response(413,{error:'PAYLOAD_TOO_LARGE'});
 let raw;try{raw=await request.text()}catch{return __mmf20261011Response(400,{error:'INVALID_BODY'})}
 if(new TextEncoder().encode(raw).length>768)return __mmf20261011Response(413,{error:'PAYLOAD_TOO_LARGE'});
 let p;try{p=JSON.parse(raw)}catch{return __mmf20261011Response(400,{error:'INVALID_JSON'})}
 const fields=['schema','product','tenant','stageOnly','operation','nonce'];
 if(!__mmf20261011Plain(p)||Object.keys(p).length!==fields.length||fields.some(k=>!Object.hasOwn(p,k))||
   p.schema!=='mmf-scope-probe-v1'||p.product!=='musitu-mail-fabric'||
   p.tenant!==env.MMF_PRODUCT_STAGE_TENANT||p.stageOnly!==true||p.operation!=='PROBE'||
   typeof p.nonce!=='string'||!/^[A-Za-z0-9_-]{24,80}$/.test(p.nonce))
     return __mmf20261011Response(422,{error:'MMF_PRODUCT_SCOPE_REJECTED'});
 return __mmf20261011Response(200,{product:'musitu-mail-fabric',role,route:path,stageProbeOnly:true,syntheticOnly:true,
  merchantAuthorityProven:false,realProviderPaymentInitiated:false,realProviderPollCertified:false,
  bankSettlementVerified:false,customerEmailEnabled:false,commercialReleaseAuthorized:false});
}
`;
/** Input source MUST come from a trusted encrypted GET-only backup and hash match. */
export function buildMmfAdditiveSourceCandidate({workerName,sourceText,expectedSourceSha256}={}){
 try{
  const cfg=CONFIG[workerName];
  if(!cfg||typeof sourceText!=='string'||sourceText.length<80||sourceText.length>1_000_000||
   typeof expectedSourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedSourceSha256)||
   sha(sourceText)!==expectedSourceSha256||sourceText.includes('__mmf20261011Stage'))deny();
  const chunks=sourceText.split(cfg.anchor);
  if(chunks.length!==2)deny();
  const patch=`${STAGE_SNIPPET}\nconst __mmf20261011LegacyFetch=(request,env,ctx)=>${cfg.delegate};\nexport default {fetch:async(request,env,ctx)=>{const stage=await __mmf20261011Stage(request,env,'${cfg.role}');return stage===null?__mmf20261011LegacyFetch(request,env,ctx):stage;}};`;
  const patchedSourceText=chunks.join(patch);
  if(patchedSourceText.split(patch).join(cfg.anchor)!==sourceText)deny();
  return Object.freeze({workerName,role:cfg.role,patchedSourceText,
   originalSha256:expectedSourceSha256,patchedSha256:sha(patchedSourceText),
   legacySourceCanBeRecovered:true,stageOnly:true,
   realProviderPaymentInitiated:false,cloudflareWorkerMutated:false,
   merchantSecretIncluded:false});
 }catch{deny()}
}