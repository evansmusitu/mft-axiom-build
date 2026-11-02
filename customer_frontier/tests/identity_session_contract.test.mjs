import test from 'node:test';
import assert from 'node:assert/strict';
import {openTestDB} from '../customer_control_plane/sqlite_d1_test_adapter.mjs';
import {handle} from '../customer_control_plane/worker.mjs';

const issuer='https://identity.example.test';
const digest=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
// A transport fixture, never a real identity provider or qualification evidence.
async function assertion(request,overrides={}){
 const raw=await request.text(), binding=raw?JSON.parse(raw):{}, now=Date.now();
 return {authenticated:true,verified:true,issuer,subject:'subject-a',tenant_id:'tenant-a',
  audience:'customer-control-plane',session_id:'opaque-session-abcdefghijklmnop',session_version:1,
  email_verified:true,mfa_verified:true,revoked:false,state_verified:true,nonce_verified:true,pkce_method:'S256',
  issued_at_ms:now-1000,auth_time_ms:now-2000,verified_at_ms:now,expires_at_ms:now+60000,
  challenge:binding.challenge,request_sha256:binding.request_sha256,...overrides};
}
function setup(overrides={},transport){
 const db=openTestDB(new URL('../customer_control_plane/schema.sql',import.meta.url));
 db._sqlite.exec(`INSERT INTO tenants(id,name) VALUES('tenant-a','A');
  INSERT INTO identities(id,issuer,external_sub) VALUES('identity-a','${issuer}','subject-a');
  INSERT INTO memberships(tenant_id,identity_id,role) VALUES('tenant-a','identity-a','owner');`);
 const env={CUSTOMER_DB:db,IDENTITY_VERIFIER_QUALIFIED:'qualified_private_binding',CUSTOMER_IDENTITY_ISSUER:issuer,
  IDENTITY_VERIFIER:{fetch:transport|| (async req=>Response.json(await assertion(req,overrides)))}};
 return {db,env};
}
const call=(env,headers={cookie:'__Host-axiom_session=opaque'})=>handle(new Request('https://portal.example.test/v1/customer/me',{headers}),env);

test('session response must be bound to this credential, request and a fresh challenge',async()=>{
 const {db,env}=setup();try{assert.equal((await call(env)).status,200);}finally{db.close();}
});
test('copied valid-looking response cannot authorize a later request or another cookie',async()=>{
 let saved;
 const {db,env}=setup({},async req=>{saved??=await assertion(req);return Response.json(saved);});
 try{assert.equal((await call(env)).status,200);assert.equal((await call(env)).status,403);
  assert.equal((await call(env,{cookie:'__Host-axiom_session=other'})).status,403);
 }finally{db.close();}
});
test('missing and downgraded session assurance fail closed before customer reads',async()=>{
 for(const override of [{email_verified:false},{mfa_verified:false},{revoked:true},{session_id:''},
  {session_version:0},{verified:false},{state_verified:false},{nonce_verified:false},{pkce_method:'plain'},
  {challenge:'substituted'},{request_sha256:'0'.repeat(64)}]){
  const {db,env}=setup(override);try{assert.equal((await call(env)).status,403,JSON.stringify(override));}finally{db.close();}
 }
});
test('stale, future, inverted, overlong and incorrectly typed session times are rejected',async()=>{
 const now=Date.now();
 for(const override of [{expires_at_ms:now-1},{verified_at_ms:now-31000},{verified_at_ms:now+60000},
  {issued_at_ms:now+60000},{auth_time_ms:now+60000},{auth_time_ms:now-43200001},
  {issued_at_ms:now-2000,expires_at_ms:now+900001},{issued_at_ms:now+1000,expires_at_ms:now+500},
  {expires_at_ms:String(now+50000)}]){
  const {db,env}=setup(override);try{assert.equal((await call(env)).status,403,JSON.stringify(override));}finally{db.close();}
 }
});
test('a qualified binding cannot authenticate an absent or ambiguous browser credential',async()=>{
 let calls=0;const {db,env}=setup({},async req=>{calls++;return Response.json(await assertion(req));});
 try{for(const headers of [{},{cookie:'s=a',authorization:'Bearer b'},{authorization:'Basic abc'}]){
  assert.equal((await call(env,headers)).status,401);
 }assert.equal(calls,0);}finally{db.close();}
});
test('private verifier gets a bounded request digest, never client asserted identity or role',async()=>{
 let seen;const {db,env}=setup({},async req=>{seen={body:await req.clone().json(),headers:req.headers};return Response.json(await assertion(req));});
 try{assert.equal((await call(env,{cookie:'__Host-axiom_session=opaque','x-tenant-id':'victim','x-role':'owner'})).status,200);
  assert.equal(seen.body.purpose,'customer-session');assert.match(seen.body.challenge,/^[a-f0-9]{64}$/);
  assert.equal(seen.body.request_sha256,await digest(JSON.stringify({audience:'customer-control-plane',purpose:'customer-session',
   method:'GET',url:'https://portal.example.test/v1/customer/me',cookie:'__Host-axiom_session=opaque',authorization:''})));
  assert.equal(seen.headers.get('x-role'),null);assert.equal(seen.headers.get('x-tenant-id'),null);
 }finally{db.close();}
});
test('verifier timeout, malformed response and outage never produce access or identity detail',async()=>{
 for(const fetch of [async()=>{throw new Error('sensitive upstream detail');},async()=>new Response('{bad'),async()=>new Response('',{status:503})]){
  const {db,env}=setup({},fetch);try{const r=await call(env);assert.notEqual(r.status,200);assert.doesNotMatch(await r.text(),/sensitive/);}finally{db.close();}
 }
});
