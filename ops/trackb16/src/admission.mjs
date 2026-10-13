/* Isolated B16 S0: independent workload issuer gates every quota reservation.
 * B15's separate quota signature is still mandatory and verified downstream.
 * This gateway does NOT certify issuer independence, production identity, or
 * provider remaining capacity; it is not publicly routable or deployable.
 */
import {utcDay} from './identity.mjs';
export class OperationDenied extends Error {constructor(code){super(code);this.name='OperationDenied';this.code=code;}}
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SHA=/^[a-f0-9]{64}$/;
const FIELDS=['schema','audience','account_id','utc_day','tenant_id','workload_id','request_id','request_sha','neurons','grant_sha256','issued_at','expires_at','production_authority'].sort().join(',');
const EXPECTED_SCHEMA='axiom.trackb16.s0.workload-auth.v1';
const AUDIENCE='axiom.trackb16.s0.reserve';
const textBytes=new TextEncoder();
function binB64(x,max=4096){
  if(typeof x!=='string'||x.length===0||x.length>max||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(x))throw new OperationDenied('ENCODING_DENIED');
  try{const raw=Uint8Array.from(atob(x),c=>c.charCodeAt(0));if(btoa(String.fromCharCode(...raw))!==x)throw Error();return raw;}
  catch{throw new OperationDenied('ENCODING_DENIED');}
}
function key(x){const raw=binB64(x,44);if(raw.length!==32)throw new OperationDenied('ISSUER_KEY_INVALID');return raw;}
function sameBytes(a,b){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
function getEnvelope(x){
  if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join(',')!=='payload_b64,signature_b64')throw new OperationDenied('SIGNED_WORKLOAD_AUTH_REQUIRED');
  const payload=binB64(x.payload_b64),sig=binB64(x.signature_b64,88);
  if(sig.length!==64||payload.length>3072)throw new OperationDenied('SIGNED_WORKLOAD_AUTH_REQUIRED');
  return {payload,sig};
}
function exactTime(now,document,day){
  if(!Number.isSafeInteger(now)||now<0||utcDay(now)!==day)throw new OperationDenied('WORKLOAD_TIME_DENIED');
  const nowSec=Math.floor(now/1000);
  if(!Number.isSafeInteger(document.issued_at)||!Number.isSafeInteger(document.expires_at)||
     document.issued_at>nowSec+5||document.expires_at<=nowSec||
     document.expires_at-document.issued_at>120||document.issued_at>=document.expires_at)
    throw new OperationDenied('WORKLOAD_TIME_DENIED');
}
export async function authorizeThenReserve(request,context){
  if(!context||typeof context!=='object'||typeof context.now!=='function'||!context.core||typeof context.core.reserve!=='function'||
     typeof context.accountId!=='string'||!ID.test(context.accountId)||typeof context.utcDay!=='string')throw new OperationDenied('TRUSTED_CONTEXT_REQUIRED');
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).sort().join(',')!==
      'auth,neurons,request_id,request_sha,signed,tenant_id,workload_id')throw new OperationDenied('WORKLOAD_REQUEST_SCHEMA_DENIED');
  const signedGrant=request.signed;
  if(!signedGrant||typeof signedGrant!=='object'||Array.isArray(signedGrant)||Object.keys(signedGrant).sort().join(',')!=='payload_b64,signature_b64')
    throw new OperationDenied('B15_SIGNED_GRANT_REQUIRED');
  const workloadKey=key(context.workloadIssuerPublicB64),quotaKey=key(context.quotaIssuerPublicB64);
  if(sameBytes(workloadKey,quotaKey))throw new OperationDenied('INDEPENDENT_ISSUER_REQUIRED');
  const {payload,sig}=getEnvelope(request.auth);
  let imported;
  try{imported=await crypto.subtle.importKey('raw',workloadKey,{name:'Ed25519'},false,['verify']);}
  catch{throw new OperationDenied('ISSUER_KEY_INVALID');}
  if(!await crypto.subtle.verify('Ed25519',imported,sig,payload))throw new OperationDenied('WORKLOAD_SIGNATURE_INVALID');
  let auth;
  try{auth=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));}catch{throw new OperationDenied('WORKLOAD_DOCUMENT_DENIED');}
  if(!auth||typeof auth!=='object'||Array.isArray(auth)||Object.keys(auth).sort().join(',')!==FIELDS)throw new OperationDenied('WORKLOAD_SCHEMA_DENIED');
  if(auth.schema!==EXPECTED_SCHEMA||auth.audience!==AUDIENCE||auth.production_authority!==false||auth.account_id!==context.accountId||auth.utc_day!==context.utcDay)
    throw new OperationDenied('WORKLOAD_CONTEXT_DENIED');
  exactTime(context.now(),auth,context.utcDay);
  if(![auth.tenant_id,auth.workload_id,auth.request_id].every(x=>typeof x==='string'&&ID.test(x))||
      typeof auth.request_sha!=='string'||!SHA.test(auth.request_sha)||
      typeof auth.grant_sha256!=='string'||!SHA.test(auth.grant_sha256)||
      !Number.isSafeInteger(auth.neurons)||auth.neurons<1||auth.neurons>1500)throw new OperationDenied('WORKLOAD_BINDING_DENIED');
  if(auth.tenant_id!==request.tenant_id||auth.workload_id!==request.workload_id||auth.request_id!==request.request_id||
     auth.request_sha!==request.request_sha||auth.neurons!==request.neurons)throw new OperationDenied('WORKLOAD_BINDING_DENIED');
  if(typeof signedGrant.payload_b64!=='string'||typeof signedGrant.signature_b64!=='string'||
     signedGrant.payload_b64.length>4096||signedGrant.signature_b64.length>100)throw new OperationDenied('B15_SIGNED_GRANT_REQUIRED');
  const grantDigest=new Uint8Array(await crypto.subtle.digest('SHA-256',textBytes.encode(signedGrant.payload_b64+'.'+signedGrant.signature_b64)));
  const hex=Array.from(grantDigest,x=>x.toString(16).padStart(2,'0')).join('');
  if(auth.grant_sha256!==hex)throw new OperationDenied('WORKLOAD_BINDING_DENIED');
  // Verify clock after the async cryptographic work before releasing to the durable ledger.
  exactTime(context.now(),auth,context.utcDay);
  // Only exact B15 fields are forwarded. The broker never forwards the auth envelope.
  return context.core.reserve({signed:signedGrant,request_id:request.request_id,request_sha:request.request_sha,
    neurons:request.neurons,tenant_id:request.tenant_id,workload_id:request.workload_id});
}

// RPC boundary preserves explicit fail-closed results for known, typed
// authorization/quota denials. Do not normalize unexpected runtime failures.
export async function safeQuotaOutcome(dispatch,denialClasses) {
  if(typeof dispatch!=="function" || !Array.isArray(denialClasses) || denialClasses.length<1 ||
     denialClasses.some(x=>typeof x!=="function"))throw new OperationDenied('DENIAL_POLICY_INVALID');
  try{return await dispatch();}
  catch(err){
    if(!denialClasses.some(klass=>err instanceof klass))throw err;
    const reason=typeof err.code==='string'?err.code:err.message;
    if(typeof reason!=='string'||!/^[A-Z][A-Z0-9_]{0,79}$/.test(reason))throw err;
    return {status:'DENIED',dispatch_allowed:false,reason};
  }
}
