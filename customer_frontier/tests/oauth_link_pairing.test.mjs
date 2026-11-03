import test from 'node:test';
import assert from 'node:assert/strict';
import {setupContinuity,startFlow,consent,exchange,identity,sha} from './oauth_continuity_fixture.mjs';
test('immutable token linkage cannot attach another customer key to an approved identity',()=>{
 const t=setupContinuity();try{
  t.db._sqlite.exec("INSERT INTO customers(id,status) VALUES('other-customer','active'); INSERT INTO api_keys(id,customer_id,key_hash,status) VALUES('other-key','other-customer','hash','active')");
  const args=[identity.issuer,sha(identity.issuer+'\n'+identity.subject),identity.tenant_id];
  assert.throws(()=>t.db._sqlite.prepare(`INSERT INTO oauth_identity_token_links(api_key_id,issuer,subject_sha256,customer_id,tenant_id)
   SELECT 'other-key',issuer,subject_sha256,customer_id,tenant_id FROM oauth_identity_links WHERE issuer=? AND subject_sha256=? AND tenant_id=?`).run(...args),/identity_token_link_not_active/);
  assert.equal(t.db._sqlite.prepare('SELECT count(*) n FROM oauth_identity_token_links').get().n,0);
  assert.equal(t.db._sqlite.prepare("SELECT status FROM api_keys WHERE id='other-key'").get().status,'active');
 }finally{t.close();}
});
test('linked parent key and code cannot be reassigned to a different customer or identity',async()=>{
 const t=setupContinuity();try{
  const r=await consent(t.env,await startFlow(t.env));assert.equal(r.status,302);
  assert.equal((await exchange(t.env,new URL(r.headers.get('location')).searchParams.get('code'))).status,200);
  t.db._sqlite.exec("INSERT INTO customers(id,status) VALUES('other-customer','active')");
  for(const sql of ["UPDATE api_keys SET customer_id='other-customer'", "UPDATE api_keys SET id='replacement-key'",
   "UPDATE oauth_authorization_codes SET customer_id='other-customer'", "UPDATE oauth_authorization_codes SET code_hash='replacement-code'"]){
   assert.throws(()=>t.db._sqlite.exec(sql),/oauth_linked_parent_immutable/,sql);
  }
 }finally{t.close();}
});
test('REPLACE of a linked parent cannot silently rewrite its binding',async()=>{
 const t=setupContinuity();try{
  const r=await consent(t.env,await startFlow(t.env));assert.equal(r.status,302);
  assert.equal((await exchange(t.env,new URL(r.headers.get('location')).searchParams.get('code'))).status,200);
  assert.throws(()=>t.db._sqlite.exec('INSERT OR REPLACE INTO api_keys SELECT * FROM api_keys'),/oauth_linked_parent_immutable/);
  assert.throws(()=>t.db._sqlite.exec('INSERT OR REPLACE INTO oauth_authorization_codes SELECT * FROM oauth_authorization_codes'),/oauth_linked_parent_immutable/);
 }finally{t.close();}
});
test('revoked identity family cannot reactivate its linked API key',async()=>{
 const t=setupContinuity();try{
  const r=await consent(t.env,await startFlow(t.env));assert.equal(r.status,302);
  assert.equal((await exchange(t.env,new URL(r.headers.get('location')).searchParams.get('code'))).status,200);
  t.db._sqlite.exec("UPDATE oauth_identity_links SET state='revoked',revoked_at=CURRENT_TIMESTAMP");
  assert.throws(()=>t.db._sqlite.exec("UPDATE api_keys SET status='active',revoked_at=NULL"),/oauth_linked_key_revocation_terminal/);
 }finally{t.close();}
});
test('immutable code linkage cannot attach another customer code to an approved identity',async()=>{
 const t=setupContinuity();try{
  assert.equal((await consent(t.env,await startFlow(t.env))).status,302);
  t.db._sqlite.exec(`INSERT INTO customers(id,status) VALUES('other-customer','active');
   INSERT INTO oauth_authorization_codes(code_hash,client_id,customer_id,redirect_uri,resource,scope,code_challenge,created_at,expires_at)
   SELECT 'other-code',client_id,'other-customer',redirect_uri,resource,scope,code_challenge,created_at,expires_at FROM oauth_authorization_codes LIMIT 1;`);
  assert.throws(()=>t.db._sqlite.exec(`INSERT INTO oauth_identity_code_links(code_hash,issuer,subject_sha256,customer_id,tenant_id)
   SELECT 'other-code',issuer,subject_sha256,customer_id,tenant_id FROM oauth_identity_links`),/identity_code_link_not_active/);
  assert.equal(t.db._sqlite.prepare('SELECT count(*) n FROM oauth_identity_code_links').get().n,1);
 }finally{t.close();}
});
