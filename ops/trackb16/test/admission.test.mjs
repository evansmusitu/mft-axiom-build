import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomUUID,createHash} from 'node:crypto';
import {authorizeThenReserve,OperationDenied} from '../src/admission.mjs';

// Ephemeral synthetic keys generated per local execution; no production material.
const makeSigner = () => {
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  return {publicB64:Buffer.from(publicKey.export({format:'jwk'}).x,'base64url').toString('base64'),
          signDoc: (x) => {const raw=Buffer.from(JSON.stringify(x));return {payload_b64:raw.toString('base64'),signature_b64:sign(null,raw,privateKey).toString('base64')}}};
};
const quota = makeSigner(), workload=makeSigner(), adversary=makeSigner();
const account='axiom-s0-isolated';
const day='2026-10-13';
const now=Date.parse('2026-10-13T12:00:00Z');
const shaHex=(bytes)=>createHash('sha256').update(bytes).digest('hex');
function setup(opts={}){
  const reserveCalls=[];
  const core={async reserve(body){reserveCalls.push(body);return {status:'RESERVED',dispatch_allowed:true,receipt:'synthetic'}}};
  const grant=quota.signDoc({kind:'synthetic-b15-signature'});
  const body={signed:grant,request_id:'req-1',request_sha:'a'.repeat(64),neurons:100,tenant_id:'tenant-A',workload_id:'agent-A'};
  const authFields={schema:'axiom.trackb16.s0.workload-auth.v1',audience:'axiom.trackb16.s0.reserve',account_id:account,utc_day:day,tenant_id:body.tenant_id,workload_id:body.workload_id,request_id:body.request_id,request_sha:body.request_sha,neurons:body.neurons,grant_sha256:shaHex(Buffer.from(grant.payload_b64+'.'+grant.signature_b64)),issued_at:Math.floor(now/1000)-5,expires_at:Math.floor(now/1000)+30,production_authority:false};
  const signedAuth=workload.signDoc(authFields);
  const context={accountId:account,utcDay:day,now:()=>now,quotaIssuerPublicB64:quota.publicB64,workloadIssuerPublicB64:workload.publicB64,core};
  return {core,context,body,authFields,signedAuth,reserveCalls,makeAuth:(fields=authFields, signer=workload)=>signer.signDoc(fields),...opts};
}
async function success(x){return authorizeThenReserve({...x.body,auth:x.signedAuth},x.context);}
async function denied(x,code){await assert.rejects(()=>success(x),e=>e instanceof OperationDenied&&e.code===code);assert.equal(x.reserveCalls.length,0,'unauthorized request must not enter ledger');}

test('independent Ed25519 workload authority and exact bound operation admit once',async()=>{const x=setup();assert.equal((await success(x)).dispatch_allowed,true);assert.equal(x.reserveCalls.length,1);assert.deepEqual(x.reserveCalls[0],x.body);});
test('no workload authorization denies without entering ledger',async()=>{let x=setup();x.signedAuth=undefined;await denied(x,'SIGNED_WORKLOAD_AUTH_REQUIRED');});
test('invalid Ed25519 signature denies before quota',async()=>{let x=setup();x.signedAuth=x.makeAuth(x.authFields,adversary);await denied(x,'WORKLOAD_SIGNATURE_INVALID');});
test('token signed for another account denies',async()=>{let x=setup();x.signedAuth=x.makeAuth({...x.authFields,account_id:'other-account'});await denied(x,'WORKLOAD_CONTEXT_DENIED');});
test('token signed for another tenant denies',async()=>{let x=setup();x.signedAuth=x.makeAuth({...x.authFields,tenant_id:'other-tenant'});await denied(x,'WORKLOAD_BINDING_DENIED');});
test('token cannot be replayed for altered request id',async()=>{let x=setup();x.body.request_id='req-2';await denied(x,'WORKLOAD_BINDING_DENIED');});
test('token cannot authorize altered neurons',async()=>{let x=setup();x.body.neurons=200;await denied(x,'WORKLOAD_BINDING_DENIED');});
test('token cannot authorize mutated B15 signed grant',async()=>{let x=setup();x.body.signed={...x.body.signed,payload_b64:'a'.repeat(20)};await denied(x,'WORKLOAD_BINDING_DENIED');});
test('token cannot authorize new body digest',async()=>{let x=setup();x.body.request_sha='b'.repeat(64);await denied(x,'WORKLOAD_BINDING_DENIED');});
test('future issued token denied',async()=>{let x=setup();x.signedAuth=x.makeAuth({...x.authFields,issued_at:Math.floor(now/1000)+60,expires_at:Math.floor(now/1000)+90});await denied(x,'WORKLOAD_TIME_DENIED');});
test('expired token denied',async()=>{let x=setup();x.signedAuth=x.makeAuth({...x.authFields,expires_at:Math.floor(now/1000)});await denied(x,'WORKLOAD_TIME_DENIED');});
test('excessive signed token TTL denied',async()=>{let x=setup();x.signedAuth=x.makeAuth({...x.authFields,expires_at:Math.floor(now/1000)+500});await denied(x,'WORKLOAD_TIME_DENIED');});
test('workload and quota issuer must be cryptographically distinct',async()=>{let x=setup();x.context.workloadIssuerPublicB64=quota.publicB64;await denied(x,'INDEPENDENT_ISSUER_REQUIRED');});
test('caller cannot grant production authority even if signed',async()=>{let x=setup();x.signedAuth=x.makeAuth({...x.authFields,production_authority:true});await denied(x,'WORKLOAD_CONTEXT_DENIED');});
test('unknown signed fields rejected',async()=>{let x=setup();x.signedAuth=x.makeAuth({...x.authFields,isAdmin:true});await denied(x,'WORKLOAD_SCHEMA_DENIED');});
test('ledger failure does not get converted to success',async()=>{let x=setup();x.context.core.reserve=async()=>{throw Error('QUOTA_DENIED')};await assert.rejects(()=>success(x),/QUOTA_DENIED/);});
test('signed token with wrong audience does not enter quota',async()=>{let x=setup();x.signedAuth=x.makeAuth({...x.authFields,audience:'anything-else'});await denied(x,'WORKLOAD_CONTEXT_DENIED');});
test('signed token with wrong UTC day denied',async()=>{let x=setup();x.signedAuth=x.makeAuth({...x.authFields,utc_day:'2026-10-14'});await denied(x,'WORKLOAD_CONTEXT_DENIED');});
test('signed token with wrong workload denied',async()=>{let x=setup();x.signedAuth=x.makeAuth({...x.authFields,workload_id:'agent-B'});await denied(x,'WORKLOAD_BINDING_DENIED');});
test('missing B15 grant denied, even with auth signature',async()=>{let x=setup();delete x.body.signed;await denied(x,'WORKLOAD_REQUEST_SCHEMA_DENIED');});
test('forged unsafe request field rejected',async()=>{let x=setup();x.body.new_secret='abc';await denied(x,'WORKLOAD_REQUEST_SCHEMA_DENIED');});
test('untrusted clock crosses UTC midnight, deny before any quota',async()=>{let x=setup();x.context.now=()=>Date.parse('2026-10-14T00:00:00Z');await denied(x,'WORKLOAD_TIME_DENIED');});
test('malformed signed envelope rejected',async()=>{let x=setup();x.signedAuth={payload_b64:'%',signature_b64:'!'};await denied(x,'ENCODING_DENIED');});
