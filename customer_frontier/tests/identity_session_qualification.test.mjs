import {SessionRequest as Request,sessionFixture} from './identity_fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../customer_control_plane/worker.mjs';

// Isolated contract tests. This mock cannot qualify a real IdP.
const issuer='https://identity.example.test';
const proof=(overrides={})=>({authenticated:true,issuer,subject:'subject-001',tenant_id:'tenant-001',audience:'customer-control-plane',...overrides});
const db=(membership={identity_id:'identity-001',tenant_id:'tenant-001',role:'owner'})=>({
 prepare(sql){return {
  bind(...args){return {
   async first(){
    if(sql.includes('SELECT i.id AS identity_id'))return membership;
    if(sql.includes(' AS booked'))return {booked:0,reserved:0};
    throw new Error('unexpected_database_query');
   }
  }}
 }}
});
const env=(principal=proof(),overrides={})=>({
 CUSTOMER_DB:db(),
 IDENTITY_VERIFIER_QUALIFIED:'qualified_private_binding',
 CUSTOMER_IDENTITY_ISSUER:issuer,
 IDENTITY_VERIFIER:{fetch:async request=>Response.json(await sessionFixture(request,principal))},
 ...overrides
});
const call=(environment)=>handle(new Request('https://portal.mftintelligence.com/v1/customer/me',{headers:{cookie:'session=opaque-browser-cookie'}}),environment);

test('unqualified identity verifier cannot authorize a tenant even with a valid-looking principal',async()=>{
 const result=await call(env(proof(),{IDENTITY_VERIFIER_QUALIFIED:'not_qualified'}));
 assert.equal(result.status,403);
 assert.equal((await result.json()).error,'identity_verifier_not_qualified');
});

test('missing pinned issuer fails closed instead of trusting arbitrary private broker',async()=>{
 for(const invalid of [undefined,null,'', 'http://identity.example.test', 'https://identity.example.test@evil.example', 'https://identity.example.test/path']){
  const result=await call(env(proof(),{CUSTOMER_IDENTITY_ISSUER:invalid}));
  assert.equal(result.status,403);
  assert.equal((await result.json()).error,'identity_issuer_not_qualified');
 }
});

test('issuer substitution is rejected even if a membership is otherwise returned',async()=>{
 const result=await call(env(proof({issuer:'https://evil.example'})));
 assert.equal(result.status,403);
 assert.equal((await result.json()).error,'identity_issuer_mismatch');
});

test('admitted exact issuer and active tenant membership preserve existing account readback',async()=>{
 const result=await call(env());
 assert.equal(result.status,200);
 const body=await result.json();
 assert.equal(body.ok,true);
 assert.equal(body.tenant_id,'tenant-001');
 assert.equal(body.identity_id,'identity-001');
 assert.equal(body.credit.booked,0);
 assert.equal(body.payment_live,false);
});

test('independent identity attestation does not override a revoked or missing membership',async()=>{
 const result=await call(env(proof(),{CUSTOMER_DB:db(null)}));
 assert.equal(result.status,403);
 assert.equal((await result.json()).error,'membership_not_authorized');
});
