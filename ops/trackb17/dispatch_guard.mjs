/**
 * B17 S0 independent model-dispatch boundary, isolated candidate ONLY.
 * Scope: A cryptographically bound provider payload is mandatory BEFORE a B16
 * signed-workload/B15 signed-quota reservation can trigger one provider send.
 * No HTTP endpoint, provider token, OpenHands worker, deployment or live request.
 * Source dependency: verified B16 `routeQuota()`; this module cannot issue grants.
 */
import {routeQuota,utcDay} from '../trackb16/src/identity.mjs';
export class GateDenied extends Error {
  constructor(code){super(code);this.name='GateDenied';this.code=code;}
}
const HEX=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const MODEL_ID=/^[A-Za-z0-9@][A-Za-z0-9@._/-]{0,119}$/;
const UPPER=/^[A-Z][A-Z0-9_]{0,79}$/;
const encoder=new TextEncoder();
const FIELDS='auth,neurons,request_id,request_sha,signed,tenant_id,workload_id';
const BODY_FIELDS='max_output_tokens,messages,model';
const MESSAGE_FIELDS='content,role';
const ROLES=new Set(['system','user','assistant','tool']);

// Strict canonicalization cannot call user-defined toJSON hooks or serialize
// weird objects (whose stringification might silently mutate the signed body).
function encodePlain(value,depth=0,counter={n:0}) {
  if(depth>10 || ++counter.n>500)throw new GateDenied('PAYLOAD_STRUCTURE_DENIED');
  if(value===null)return 'null';
  if(typeof value==='string')return JSON.stringify(value);
  if(typeof value==='boolean')return value?'true':'false';
  if(typeof value==='number') {
    if(!Number.isFinite(value)||!Number.isSafeInteger(value))throw new GateDenied('PAYLOAD_STRUCTURE_DENIED');
    return JSON.stringify(value);
  }
  if(Array.isArray(value)) {
    if(value.length>100 || Object.keys(value).length!==value.length)throw new GateDenied('PAYLOAD_STRUCTURE_DENIED');
    return '['+value.map(x=>encodePlain(x,depth+1,counter)).join(',')+']';
  }
  if(typeof value==='object' && (Object.getPrototypeOf(value)===Object.prototype || Object.getPrototypeOf(value)===null)) {
    const keys=Object.keys(value).sort();
    if(keys.length>100 || keys.some(x=>['__proto__','prototype','constructor','toJSON'].includes(x)))
      throw new GateDenied('PROVIDER_PAYLOAD_SCHEMA_DENIED');
    return '{'+keys.map(k=>JSON.stringify(k)+':'+encodePlain(value[k],depth+1,counter)).join(',')+'}';
  }
  throw new GateDenied('PAYLOAD_STRUCTURE_DENIED');
}
function serialize(body) {
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!==BODY_FIELDS)
    throw new GateDenied('PROVIDER_PAYLOAD_SCHEMA_DENIED');
  if(typeof body.model!=='string'||!MODEL_ID.test(body.model))throw new GateDenied('MODEL_SCOPE_DENIED');
  if(!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>40)
    throw new GateDenied('PROVIDER_PAYLOAD_SCHEMA_DENIED');
  for(const m of body.messages) {
    if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).sort().join(',')!==MESSAGE_FIELDS||
       !ROLES.has(m.role)||typeof m.content!=='string')throw new GateDenied('PROVIDER_PAYLOAD_SCHEMA_DENIED');
  }
  if(!Number.isSafeInteger(body.max_output_tokens)||body.max_output_tokens<1)
    throw new GateDenied('OUTPUT_LIMIT_DENIED');
  const bytes=encoder.encode(encodePlain(body));
  if(bytes.byteLength>32768)throw new GateDenied('PAYLOAD_SIZE_DENIED');
  return bytes;
}
async function hexSha(bytes) {
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return Array.from(hash,x=>x.toString(16).padStart(2,'0')).join('');
}
export async function digestPayload(body){return hexSha(serialize(body));}
function checkRequest(request) {
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).sort().join(',')!==FIELDS ||
     ![request.request_id,request.tenant_id,request.workload_id].every(x=>typeof x==='string'&&ID.test(x))||
     typeof request.request_sha!=='string'||!HEX.test(request.request_sha)||
     !Number.isSafeInteger(request.neurons)||request.neurons<1||request.neurons>1500 ||
     !request.signed||!request.auth || typeof request.signed!=='object'||typeof request.auth!=='object')
    throw new GateDenied('REQUEST_SCHEMA_DENIED');
}
function checkReceipt(receipt,request) {
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||typeof receipt.status!=='string'||
    typeof receipt.dispatch_allowed!=='boolean')throw new GateDenied('QUOTA_RECEIPT_INVALID');
  if(receipt.status==='RESERVED'&&receipt.dispatch_allowed===true) {
    if(typeof receipt.grant_id!=='string'||!ID.test(receipt.grant_id)||receipt.request_id!==request.request_id ||
       receipt.neurons!==request.neurons || !Number.isSafeInteger(receipt.used)||
       !Number.isSafeInteger(receipt.safe_limit)||receipt.used<0||receipt.safe_limit<receipt.used)
      throw new GateDenied('QUOTA_RECEIPT_INVALID');
    return {admitted:true};
  }
  if(receipt.status==='ALREADY_RESERVED' && receipt.dispatch_allowed===false)
    return {admitted:false,status:'REPLAY_DENIED'};
  if(receipt.status==='DENIED'&&receipt.dispatch_allowed===false&&typeof receipt.reason==='string'&&UPPER.test(receipt.reason))
    return {admitted:false,status:'DENIED',reason:receipt.reason};
  throw new GateDenied('QUOTA_RECEIPT_INVALID');
}
export async function guardedDispatch({trustedEnv,request,payload,allowedModels,maxOutputTokens,now,sendProvider}) {
  if(!trustedEnv||typeof trustedEnv!=='object'||typeof now!=='function'||typeof sendProvider!=='function'||
     !Array.isArray(allowedModels)||allowedModels.length<1||allowedModels.some(x=>typeof x!=='string'||!MODEL_ID.test(x))||
     !Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>1024)
    throw new GateDenied('TRUSTED_BROKER_CONFIG_REQUIRED');
  checkRequest(request);
  const body=serialize(payload);
  if(!allowedModels.includes(payload.model))throw new GateDenied('MODEL_SCOPE_DENIED');
  if(payload.max_output_tokens>maxOutputTokens)throw new GateDenied('OUTPUT_LIMIT_DENIED');
  if(await hexSha(body)!==request.request_sha)throw new GateDenied('PAYLOAD_HASH_MISMATCH');
  // Use only trusted account/day routing. The requester supplies no URL/bucket.
  const before=now(); const day=utcDay(before);
  const stub=routeQuota(trustedEnv,before);
  // S0: a failed quota call does NOT enter any provider path.
  const outcome=checkReceipt(await stub.reserve(request),request);
  if(!outcome.admitted)return {status:outcome.status,reason:outcome.reason,dispatch_allowed:false};
  // A midnight rollover or transport delay after a durable reservation burns
  // the reservation; never refund or move it to a different account/day.
  if(utcDay(now())!==day)
    return {status:'ABORTED_AFTER_RESERVATION',dispatch_allowed:false,resend_prohibited:true};
  try {
    // The provider sees a canonical immutable copy of the hash-bound payload,
    // not the worker's original mutable JavaScript object.
    const result=await sendProvider(new Uint8Array(body));
    return {status:'COMPLETED',dispatch_allowed:false,provider_result:result};
  } catch {
    // Ambiguous provider outcome => charged reservation and NO automatic retry.
    return {status:'UNKNOWN_AFTER_RESERVATION',dispatch_allowed:false,resend_prohibited:true};
  }
}
