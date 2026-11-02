import test from 'node:test';
import assert from 'node:assert/strict';
import {openTestDB} from '../customer_control_plane/sqlite_d1_test_adapter.mjs';
import {handle} from '../customer_control_plane/worker.mjs';
import {provisionPersonalTenant} from '../customer_control_plane/enrollment.mjs';
import {sessionFixture,SessionRequest} from './identity_fixture.mjs';
const issuer='https://identity.example.test',customer='5328af0f-8545-48b5-96ed-196627a2c334';
const principal={authenticated:true,issuer,subject:'subject-a',tenant_id:'tenant-a',audience:'customer-control-plane'};
function setup(){
 const db=openTestDB(new URL('../customer_control_plane/schema.sql',import.meta.url));
 db._sqlite.exec(`INSERT INTO tenants(id,name) VALUES('tenant-a','A'),('tenant-b','B');
 INSERT INTO identities(id,issuer,external_sub) VALUES('identity-a','${issuer}','subject-a'),('identity-b','${issuer}','subject-b');
 INSERT INTO memberships(tenant_id,identity_id,role) VALUES('tenant-a','identity-a','viewer'),('tenant-b','identity-b','owner');`);
 const env={CUSTOMER_DB:db,CUSTOMER_IDENTITY_ISSUER:issuer,IDENTITY_VERIFIER_QUALIFIED:'qualified_private_binding',
  IDENTITY_VERIFIER:{fetch:async req=>Response.json(await sessionFixture(req,principal))}};
 return {db,env};
}
const call=env=>handle(new SessionRequest('https://portal.example.test/v1/customer/identity'),env);
test('canonical identity readback fails closed when no approved production customer link exists',async()=>{
 const {db,env}=setup();try{const r=await call(env);assert.equal(r.status,409);assert.equal((await r.json()).error,'canonical_mapping_required');}finally{db.close();}
});
test('retry enrollment never picks an arbitrary tenant for a preexisting identity',async()=>{
 const {db}=setup(),now=Date.now();
 try{db._sqlite.exec("INSERT INTO memberships(tenant_id,identity_id,role) VALUES('tenant-b','identity-a','member')");
  await assert.rejects(provisionPersonalTenant(db,{verified:true,production_qualified:true,audience:'customer-control-plane',
   issuer,subject:'subject-a',email_verified:true,mfa_verified:true,tenant_kind:'personal',proof_id:'proof-new-session-0001',
   verifier_identity:'offline-authority',verified_at_ms:now,expires_at_ms:now+60000}),/existing_identity_review_required/);
  assert.equal(db._sqlite.prepare('SELECT count(*) n FROM tenants').get().n,2);
 }finally{db.close();}
});
// Loading the new private seam inside a test preserves a readable missing-contract RED.
async function linkModule(){try{return await import('../customer_control_plane/canonical_identity.mjs');}catch(e){assert.fail('canonical identity link contract is absent: '+e.code);}}
async function link(env,db,overrides={}){
 const {verifyAndLinkCanonicalAccount}=await linkModule();
 env.IDENTITY_ACCOUNT_LINK_QUALIFIED='qualified_private_binding';
 env.IDENTITY_ACCOUNT_LINK_VERIFIER={fetch:async req=>Response.json({...await sessionFixture(req,principal),
  production_customer_id:customer,customer_status:'active',link_kind:'legacy',consent_verified:true,
  consent_id:'consent-offline-0001',legacy_ownership_verified:true,ownership_proof_id:'ownership-offline-0001',
  proof_id:'link-proof-offline-0001',authority_subject:'independent-offline-authority',...overrides})};
 return verifyAndLinkCanonicalAccount(new SessionRequest('https://portal.example.test/private-link-candidate'),env,db);
}
test('website and ChatGPT candidate resolve the same approved UUID without elevating the database role',async()=>{
 const {db,env}=setup();try{
  await link(env,db,{role:'owner'});
  const r=await call(env);assert.equal(r.status,200);const web=await r.json();
  const {resolveOAuthCustomer}=await linkModule();
  env.IDENTITY_VERIFIER={fetch:async req=>Response.json(await sessionFixture(req,{...principal,audience:'axiom-chatgpt-oauth'}))};
  const oauth=await resolveOAuthCustomer(new SessionRequest('https://auth.example.test/oauth/authorize'),env,db);
  assert.equal(web.customer_id,customer);assert.equal(oauth.customer_id,web.customer_id);
  assert.equal(oauth.tenant_id,web.tenant_id);assert.equal(oauth.identity_id,web.identity_id);assert.equal(oauth.role,'viewer');
  assert.equal(db._sqlite.prepare("SELECT role FROM memberships WHERE identity_id='identity-a'").get().role,'viewer');
 }finally{db.close();}
});
test('unqualified link, absent consent and unproven legacy ownership cannot create a mapping',async()=>{
 for(const override of [{consent_verified:false},{legacy_ownership_verified:false},{ownership_proof_id:''},
  {customer_status:'suspended'},{production_customer_id:'identity-a'},{issuer:'https://evil.test'},{subject:'subject-b'},
  {tenant_id:'tenant-b'},{link_kind:'email-match'},{proof_id:''}]){
  const {db,env}=setup();try{await assert.rejects(link(env,db,override));
   assert.equal(db._sqlite.prepare('SELECT count(*) n FROM canonical_customer_links').get().n,0);
  }finally{db.close();}
 }
});
test('conflicts, proof replay and revoked mapping cannot silently relink or replace a UUID',async()=>{
 const {db,env}=setup();try{
  const a=await link(env,db);const b=await link(env,db);assert.equal(a.customer_id,b.customer_id);
  await assert.rejects(link(env,db,{production_customer_id:'ee7e91e7-7283-49f8-b086-d677f2dfe563'}),/canonical_link_conflict/);
  assert.throws(()=>db._sqlite.exec("UPDATE canonical_customer_links SET customer_id='another'"),/immutable/);
  assert.throws(()=>db._sqlite.exec('DELETE FROM canonical_customer_links'),/immutable/);
  db._sqlite.exec("UPDATE canonical_customer_links SET status='revoked'");
  await assert.rejects(link(env,db),/canonical_link_revoked/);
  assert.equal((await call(env)).status,403);
  assert.throws(()=>db._sqlite.exec("UPDATE canonical_customer_links SET status='active'"),/revocation/);
 }finally{db.close();}
});
test('revoked membership and suspended tenant block both surfaces after successful linkage',async()=>{
 for(const sql of ["UPDATE memberships SET status='revoked' WHERE identity_id='identity-a'", "UPDATE tenants SET status='suspended' WHERE id='tenant-a'"]){
  const {db,env}=setup();try{await link(env,db);db._sqlite.exec(sql);assert.equal((await call(env)).status,403);
   const {resolveOAuthCustomer}=await linkModule();
   env.IDENTITY_VERIFIER={fetch:async req=>Response.json(await sessionFixture(req,{...principal,audience:'axiom-chatgpt-oauth'}))};
   await assert.rejects(resolveOAuthCustomer(new SessionRequest('https://auth.example.test/oauth/authorize'),env,db),/membership_not_authorized/);
  }finally{db.close();}
 }
});
test('link authority qualification is required and browser identity never supplies linking proof',async()=>{
 const {db,env}=setup();try{
  const {verifyAndLinkCanonicalAccount}=await linkModule();let called=0;
  env.IDENTITY_ACCOUNT_LINK_VERIFIER={fetch:async()=>{called++;return Response.json({});}};
  await assert.rejects(verifyAndLinkCanonicalAccount(new SessionRequest('https://portal.example.test/link',{
   method:'POST',body:JSON.stringify({customer_id:customer,role:'owner',legacy_ownership_verified:true})}),env,db),/canonical_link_not_qualified/);
  assert.equal(called,0);assert.equal(db._sqlite.prepare('SELECT count(*) n FROM canonical_customer_links').get().n,0);
 }finally{db.close();}
});
test('another subject cannot reuse an approved customer UUID or a consumed proof id',async()=>{
 for(const override of [{proof_id:'link-proof-offline-0002'},{production_customer_id:'ee7e91e7-7283-49f8-b086-d677f2dfe563'}]){
  const {db,env}=setup();try{await link(env,db);
   await assert.rejects(link(env,db,{subject:'subject-b',tenant_id:'tenant-b',...override}),/canonical_link_conflict/);
   assert.equal(db._sqlite.prepare('SELECT count(*) n FROM canonical_customer_links').get().n,1);
  }finally{db.close();}
 }
});
test('revocation between proof verification and link insertion creates no mapping',async()=>{
 const {db,env}=setup();try{
  const original=db.prepare;let revoked=false;
  db.prepare=sql=>{if(sql.startsWith('INSERT INTO canonical_customer_links')&&!revoked){revoked=true;
   db._sqlite.exec("UPDATE memberships SET status='revoked' WHERE identity_id='identity-a'");}return original(sql);};
  await assert.rejects(link(env,db),/membership_not_authorized/);
  assert.equal(db._sqlite.prepare('SELECT count(*) n FROM canonical_customer_links').get().n,0);
 }finally{db.close();}
});
test('wrong OAuth audience and expired sessions cannot read an existing canonical link',async()=>{
 const {db,env}=setup();try{await link(env,db);const {resolveOAuthCustomer}=await linkModule();
  await assert.rejects(resolveOAuthCustomer(new SessionRequest('https://auth.example.test/oauth/authorize'),env,db),/identity_verifier_invalid/);
  env.IDENTITY_VERIFIER={fetch:async req=>Response.json({...await sessionFixture(req,{...principal,audience:'axiom-chatgpt-oauth'}),expires_at_ms:Date.now()-1})};
  await assert.rejects(resolveOAuthCustomer(new SessionRequest('https://auth.example.test/oauth/authorize'),env,db),/identity_session_stale/);
 }finally{db.close();}
});
