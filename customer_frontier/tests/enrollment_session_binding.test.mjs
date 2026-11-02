import test from 'node:test';
import assert from 'node:assert/strict';
import {openTestDB} from '../customer_control_plane/sqlite_d1_test_adapter.mjs';
import {handle} from '../customer_control_plane/worker.mjs';
import {sessionFixture} from './identity_fixture.mjs';
const issuer='https://identity.example.test';
const request=()=>new Request('https://portal.example.test/v1/customer/enroll',{method:'POST',
 headers:{cookie:'__Host-axiom_session=offline-fixture',origin:'https://portal.example.test','x-axiom-intent':'customer-action'},
 body:JSON.stringify({issuer:'https://evil.test',subject:'attacker',role:'owner',tenant_id:'victim'})});
function setup(overrides={}){
 const db=openTestDB(new URL('../customer_control_plane/schema.sql',import.meta.url));
 const env={CUSTOMER_DB:db,CUSTOMER_IDENTITY_ISSUER:issuer,IDENTITY_ENROLLMENT_QUALIFIED:'qualified_private_binding',
  IDENTITY_ENROLLMENT_VERIFIER:{fetch:async req=>Response.json({...await sessionFixture(req,{authenticated:true,issuer,subject:'new-subject'}),
   production_qualified:true,tenant_kind:'personal',proof_id:'enrollment-proof-0001',verifier_identity:'offline-verifier',...overrides})}};
 return {db,env};
}
test('first session enrollment is pinned and bound without trusting browser identity or minting a production customer',async()=>{
 const {db,env}=setup();try{assert.equal((await handle(request(),env)).status,201);
  assert.equal(db._sqlite.prepare('SELECT external_sub FROM identities').get().external_sub,'new-subject');
  assert.equal(db._sqlite.prepare('SELECT count(*) n FROM canonical_customer_links').get().n,0);
  assert.equal(db._sqlite.prepare('SELECT count(*) n FROM credit_ledger').get().n,0);
  assert.equal((await handle(request(),env)).status,200);
 }finally{db.close();}
});
test('enrollment refuses issuer substitution, stale session, changed challenge and downgraded MFA',async()=>{
 for(const overrides of [{issuer:'https://evil.test'},{challenge:'replayed'}, {request_sha256:'0'.repeat(64)},
  {expires_at_ms:Date.now()-1},{verified_at_ms:Date.now()-60000},{nonce_verified:false},{mfa_verified:false}]){
  const {db,env}=setup(overrides);try{assert.equal((await handle(request(),env)).status,403);
   assert.equal(db._sqlite.prepare('SELECT count(*) n FROM tenants').get().n,0);
  }finally{db.close();}
 }
});
test('a suspended original enrollment home cannot be replaced with another active membership',async()=>{
 const {db,env}=setup();try{const first=await (await handle(request(),env)).json();
  db._sqlite.exec(`UPDATE tenants SET status='suspended';INSERT INTO tenants(id,name) VALUES('other','Other');
   INSERT INTO memberships(tenant_id,identity_id,role) SELECT 'other',id,'member' FROM identities;`);
  const retry=await handle(request(),env);assert.equal(retry.status,403);
  assert.equal((await retry.json()).error,'enrollment_existing_identity_review_required');
  assert.equal(db._sqlite.prepare('SELECT count(*) n FROM tenants').get().n,2);
  assert.ok(first.enrollment.tenant_id);
 }finally{db.close();}
});
