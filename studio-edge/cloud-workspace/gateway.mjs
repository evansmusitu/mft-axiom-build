/**
 * MUSITU cloud workspace v0.1 — NOT deployed or connected to production.
 * Defense-in-depth: explicit disabled-by-default switch, Access RS256 identity,
 * allowlisted Origin, per-subject rate limiting, D1 tenant RBAC, 5-slot bounds,
 * opaque existing AES-GCM envelope validation, atomic versioned CAS writes.
 * No plaintext is accepted, decrypted, logged, indexed or returned.
 */
import {verifyAccessJWT,accessConfiguration,AccessVerificationError} from './access-jwt.mjs';

const PRIVATE_SITE='https://workspace.mftintelligence.com';
// A dedicated first-party, Access-protected workspace origin. The public
// GitHub Pages origin may not reach this private API by browser CORS.
const ROUTE=/^\/api\/workspace\/v1\/tenants\/([a-z][a-z0-9_-]{2,39})\/slots\/([1-5])$/;
const MAX_JSON=250250;
const FIXED={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'none'; frame-ancestors 'none'",
  'vary':'Origin'
};
function answer(payload,status=200,origin=''){
  const headers=new Headers(FIXED);
  if(origin===PRIVATE_SITE)headers.set('access-control-allow-origin',PRIVATE_SITE);
  return new Response(JSON.stringify(payload),{status,headers});
}
function denied(code,status,origin){return answer({code,error:'Cloud workspace operation denied.'},status,origin);}
function exactKeys(v,keys){return v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
function b64len(input){
  if(typeof input!=='string'||!input.length||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input))return -1;
  try{return atob(input).length;}catch{return -1;}
}
/** Accept *only* existing browser vault's encrypted JSON envelope format. */
export function validOpaqueEnvelope(data){
  if(typeof data!=='string'||data.length<100||data.length>250000)return false;
  let obj;try{obj=JSON.parse(data);}catch{return false;}
  if(!exactKeys(obj,['kind','version','cipher','kdf','iterations','salt','iv','ciphertext']))return false;
  return obj.kind==='musitu-local-encrypted-workspace'&&obj.version===1&&
    obj.cipher==='AES-256-GCM'&&obj.kdf==='PBKDF2-SHA-256'&&obj.iterations===310000&&
    b64len(obj.salt)===16&&b64len(obj.iv)===12&&
    b64len(obj.ciphertext)>=17&&b64len(obj.ciphertext)<=160096;
}
function configReady(env){
  if(env?.WORKSPACE_ENABLED!=='true'||env?.WORKSPACE_ORIGIN!==PRIVATE_SITE||!env?.WORKSPACE_DB?.prepare||
      !env?.WORKSPACE_RATE?.limit)return false;
  try{accessConfiguration(env);return true;}catch{return false;}
}
function successCount(result){return result?.success===true&&result?.meta?.changes===1;}
function safeVersion(v,min=0){return Number.isInteger(v)&&v>=min&&v<=2147483646;}
async function subjectRate(env,subject){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(subject));
  const key=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,40);
  try{return (await env.WORKSPACE_RATE.limit({key})).success===true;}
  catch{return false;}
}
/** Exported for offline contract tests; public config remains disabled by default. */
export async function workspaceFetch(request,env,{verifyJWT=verifyAccessJWT}={}){
  const origin=request.headers.get('origin')||'';
  const url=new URL(request.url);
  const path=url.pathname;
  const method=request.method.toUpperCase();
  if(!configReady(env))return denied('WORKSPACE_NOT_CONFIGURED',503,origin);
  // Only the Access-protected first-party hostname is supported. Same-origin
  // GETs often omit Origin; state-changing requests must supply it. Host and
  // Origin checks supplement cryptographic Access and D1 authorization.
  if(url.origin!==PRIVATE_SITE||(origin && origin!==PRIVATE_SITE)||
     (!origin && method!=='GET'))return denied('ORIGIN_DENIED',403,origin);
  if(method==='OPTIONS'&&ROUTE.test(path)){
    return new Response(null,{status:204,headers:{
      'access-control-allow-origin':PRIVATE_SITE,'access-control-allow-methods':'GET, PUT, DELETE, OPTIONS',
      'access-control-allow-headers':'content-type,cf-access-jwt-assertion',
      'access-control-max-age':'300','cache-control':'no-store','vary':'Origin'
    }});
  }
  const match=ROUTE.exec(path);
  if(!match||!['GET','PUT','DELETE'].includes(method))return denied('NOT_FOUND',404,origin);
  const [,tenant,slotText]=match,slot=Number(slotText);
  const token=request.headers.get('cf-access-jwt-assertion');
  let subject;
  try{({subject}=await verifyJWT(token,env));}
  catch(error){return denied(error instanceof AccessVerificationError?'INVALID_ACCESS_IDENTITY':'AUTH_UNAVAILABLE',401,origin);}
  if(!(await subjectRate(env,subject)))return denied('WORKSPACE_RATE_LIMITED',429,origin);
  try{
    const membership=await env.WORKSPACE_DB.prepare(
      'SELECT role FROM workspace_memberships WHERE tenant_id = ? AND subject = ? LIMIT 1'
    ).bind(tenant,subject).first();
    if(!membership||!['owner','editor','viewer'].includes(membership.role))return denied('TENANT_ACCESS_DENIED',403,origin);
    if(method==='GET'){
      const row=await env.WORKSPACE_DB.prepare(
        `SELECT version, encrypted, updated_at FROM workspace_blobs WHERE tenant_id = ? AND slot = ?
         AND EXISTS (SELECT 1 FROM workspace_memberships WHERE tenant_id = ? AND subject = ? AND role IN ('owner','editor','viewer')) LIMIT 1`
      ).bind(tenant,slot,tenant,subject).first();
      if(!row)return denied('WORKSPACE_EMPTY',404,origin);
      return answer({tenant,slot,version:row.version,encrypted:row.encrypted,updatedAt:row.updated_at},200,origin);
    }
    if(membership.role==='viewer')return denied('WORKSPACE_WRITE_DENIED',403,origin);
    let input;
    const declared=request.headers.get('content-length');
    if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_JSON)){
      return denied('BODY_TOO_LARGE',413,origin);
    }
    if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')){
      return denied('JSON_REQUIRED',415,origin);
    }
    const raw=await request.text();
    if(raw.length>MAX_JSON)return denied('BODY_TOO_LARGE',413,origin);
    try{input=JSON.parse(raw);}catch{return denied('INVALID_BODY',400,origin);}
    const isPut=method==='PUT';
    if(!exactKeys(input,isPut?['expectedVersion','encrypted']:['expectedVersion'])||
      !safeVersion(input.expectedVersion,isPut?0:1)||
      (isPut&&!validOpaqueEnvelope(input.encrypted))){
      return denied('INVALID_INPUT',400,origin);
    }
    const version=input.expectedVersion;
    // SQL includes a membership authorization predicate AGAIN at the write point,
    // preventing a stale membership read from authorizing a concurrent revocation.
    const permission="EXISTS (SELECT 1 FROM workspace_memberships WHERE tenant_id = ? AND subject = ? AND role IN ('owner','editor'))";
    let result;
    if(isPut&&version===0){
      result=await env.WORKSPACE_DB.prepare(
        `INSERT INTO workspace_blobs (tenant_id,slot,version,encrypted,updated_at)
         SELECT ?,?,1,?,? WHERE ${permission} ON CONFLICT(tenant_id,slot) DO NOTHING`
      ).bind(tenant,slot,input.encrypted,new Date().toISOString(),tenant,subject).run();
    }else if(isPut){
      result=await env.WORKSPACE_DB.prepare(
        `UPDATE workspace_blobs SET encrypted=?, version=version+1, updated_at=?
         WHERE tenant_id=? AND slot=? AND version=? AND ${permission}`
      ).bind(input.encrypted,new Date().toISOString(),tenant,slot,version,tenant,subject).run();
    }else{
      result=await env.WORKSPACE_DB.prepare(
        `DELETE FROM workspace_blobs WHERE tenant_id=? AND slot=? AND version=? AND ${permission}`
      ).bind(tenant,slot,version,tenant,subject).run();
    }
    if(!successCount(result))return denied('VERSION_CONFLICT',409,origin);
    return answer(isPut?{tenant,slot,version:version+1,stored:true}:{tenant,slot,deleted:true},200,origin);
  }catch{
    // D1 failures must never trigger in-memory fallback or public partial data.
    return denied('WORKSPACE_STORAGE_UNAVAILABLE',503,origin);
  }
}
export default {fetch:workspaceFetch};
