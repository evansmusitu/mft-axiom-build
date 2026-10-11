/**
 * MMF-only integration boundary for proposed shared Paynow authority/transport.
 * OFFLINE STAGE PROBE ONLY: this module contains no Paynow network operation,
 * merchant credential read, paid/settled assertion, or customer email capability.
 * It is NOT deployed to the two existing shared Workers.
 *
 * A real future integration needs an independent product-scoped provider route,
 * merchant permission and deployment review, not merely an HTTP 200 from here.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {readBoundedWebhookBody} from '../webhooks/bounded-body.mjs';

const H=Object.freeze({'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
const respond=(status,payload)=>new Response(JSON.stringify(payload),{status,headers:H});
const paths=Object.freeze({
 AUTHORITY:Object.freeze(['/internal/paynow/sign-initiate-mmf','/internal/paynow/verify-callback-mmf']),
 TRANSPORT:Object.freeze(['/internal/paynow/initiate-mmf'])
});
const NAME=Object.freeze({AUTHORITY:'MMF_AUTHORITY_BRIDGE_TOKEN',TRANSPORT:'MMF_TRANSPORT_BRIDGE_TOKEN'});
const FLAG_FALSE=Object.freeze(['MMF_PRODUCTION_PAYMENTS_ENABLED','MMF_COMMERCE_ENABLED',
 'MMF_REAL_SEND_ENABLED','MMF_MAIL_SENDING_ENABLED']);
const DANGEROUS_CROSS_TOKENS=Object.freeze(['FMI_AUTHORITY_BRIDGE_TOKEN','FMI_TRANSPORT_BRIDGE_TOKEN',
 'CHEMISTRY_AUTHORITY_BRIDGE_TOKEN','CHEMISTRY_TRANSPORT_BRIDGE_TOKEN',
 'AXIOM_AUTHORITY_BRIDGE_TOKEN','AXIOM_TRANSPORT_BRIDGE_TOKEN']);
const FIELDS=Object.freeze(['schema','product','tenant','stageOnly','operation','nonce']);
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
function tokenOk(v){return typeof v==='string'&&v.length>=32&&v.length<=300&&!/[\r\n\u0000-\u001f]/.test(v)}
function active(env,role){
 if(!env||env.MMF_PRODUCT_STAGE_ONLY!=='true'||
   env.MMF_PRODUCT_STAGE_TENANT!=='mmf_stage_20261011'||
   FLAG_FALSE.some(k=>env[k]!=='false'))return false;
 const t=env[NAME[role]];
 if(!tokenOk(t)||DANGEROUS_CROSS_TOKENS.some(k=>env[k]===t)||
   (NAME[role]==='MMF_AUTHORITY_BRIDGE_TOKEN'?env.MMF_TRANSPORT_BRIDGE_TOKEN===t:env.MMF_AUTHORITY_BRIDGE_TOKEN===t))return false;
 return true;
}
function compare(a,b){
 if(!tokenOk(a)||!tokenOk(b))return false;
 return timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
}
/** No external provider, Cloudflare service binding or payment is called by this handler. */
export async function handleMmfSharedProductRoute(request,env,role){
 if(!Object.hasOwn(paths,role)||!active(env,role))return respond(503,{error:'MMF_PRODUCT_ROUTE_DISABLED'});
 if(!(request instanceof Request))return respond(400,{error:'INVALID_REQUEST'});
 let url;try{url=new URL(request.url)}catch{return respond(400,{error:'INVALID_REQUEST'})}
 if(!paths[role].includes(url.pathname)||request.method!=='POST'||url.search||url.hash||
   url.username||url.password)return respond(404,{error:'NOT_FOUND'});
 const header=request.headers.get('authorization')||'';
 if(!header.startsWith('Bearer ')||!compare(header.slice(7),env[NAME[role]]))
  return respond(401,{error:'UNAUTHORIZED'});
 const raw=await readBoundedWebhookBody(request,{maxBytes:768});
 if(raw.error)return respond(raw.status,{error:raw.error});
 let payload;try{payload=JSON.parse(raw.raw)}catch{return respond(400,{error:'INVALID_JSON'})}
 if(!plain(payload)||Object.keys(payload).length!==FIELDS.length||
   FIELDS.some(k=>!Object.hasOwn(payload,k))||payload.schema!=='mmf-scope-probe-v1'||
   payload.product!=='musitu-mail-fabric'||payload.tenant!==env.MMF_PRODUCT_STAGE_TENANT||
   payload.stageOnly!==true||payload.operation!=='PROBE'||
   typeof payload.nonce!=='string'||!/^[A-Za-z0-9_-]{24,80}$/.test(payload.nonce))
   return respond(422,{error:'MMF_PRODUCT_SCOPE_REJECTED'});
 return respond(200,{product:'musitu-mail-fabric',role,
  route:url.pathname,stageProbeOnly:true,syntheticOnly:true,
  merchantAuthorityProven:false,realProviderPaymentInitiated:false,
  realProviderPollCertified:false,bankSettlementVerified:false,
  customerEmailEnabled:false,commercialReleaseAuthorized:false});
}