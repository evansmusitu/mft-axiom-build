import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openTestDB} from '../customer_control_plane/sqlite_d1_test_adapter.mjs';
import worker from '../../auth/axiom_keyless_oauth_worker_candidate.mjs';
const dir=dirname(fileURLToPath(import.meta.url));
const issuer='https://id.mftintelligence.com',subject='qualified-user',tenant='tenant-linked';
const redirect='https://chatgpt.com/connector/oauth/axiom';
const host='https://auth.mftintelligence.com';
const resource='https://mcp.mftintelligence.com';
const sha=t=>createHash('sha256').update(t).digest('hex');
const verifier='V'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url');
function setup(){
 const db=openTestDB(resolve(dir,'../customer_control_plane/schema.sql'));
 db._sqlite.exec("CREATE TABLE customers(id TEXT PRIMARY KEY,status TEXT NOT NULL,email TEXT,plan TEXT);");
 db._sqlite.exec("CREATE TABLE api_keys(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,key_hash TEXT NOT NULL,key_prefix TEXT,label TEXT,status TEXT NOT NULL,created_at TEXT,last_used_at TEXT,expires_at TEXT,revoked_at TEXT);");
 db._sqlite.exec("CREATE TABLE oauth_clients(client_id TEXT PRIMARY KEY,redirect_uris_json TEXT NOT NULL,client_name TEXT,created_at TEXT);");
 db._sqlite.exec("CREATE TABLE oauth_authorization_flows(id TEXT PRIMARY KEY,client_id TEXT,redirect_uri TEXT,state TEXT,resource TEXT,scope TEXT,code_challenge TEXT,nonce_hash TEXT,created_at TEXT,expires_at TEXT,used_at TEXT);");
 db._sqlite.exec("CREATE TABLE oauth_authorization_codes(code_hash TEXT PRIMARY KEY,client_id TEXT,customer_id TEXT,redirect_uri TEXT,resource TEXT,scope TEXT,code_challenge TEXT,created_at TEXT,expires_at TEXT,used_at TEXT);");
 db._sqlite.exec("CREATE TABLE oauth_access_tokens(token_hash TEXT PRIMARY KEY,api_key_id TEXT,client_id TEXT,customer_id TEXT,issuer TEXT,resource TEXT,scope TEXT,created_at TEXT,expires_at TEXT,revoked_at TEXT);");
 db._sqlite.exec("CREATE TABLE oauth_refresh_tokens(token_hash TEXT PRIMARY KEY,api_key_id TEXT,client_id TEXT,customer_id TEXT,resource TEXT,scope TEXT,created_at TEXT,expires_at TEXT,revoked_at TEXT);");
 db._sqlite.exec("CREATE TABLE oauth_identity_claims(customer_id TEXT PRIMARY KEY,email_verified_at TEXT);");
 db._sqlite.exec(readFileSync(resolve(dir,'../../auth/keyless_customer_link_candidate.sql'),'utf8'));
 db._sqlite.exec(readFileSync(resolve(dir,'../../auth/keyless_token_revocation_candidate.sql'),'utf8'));
 db._sqlite.prepare('INSERT INTO customers(id,status,email,plan) VALUES(?,?,?,?)').run('existing-customer','active','verified@example.test','developer');
 db._sqlite.prepare("INSERT INTO oauth_identity_claims(customer_id,email_verified_at) VALUES(?,datetime('now'))").run('existing-customer');
 db._sqlite.prepare("INSERT INTO oauth_clients(client_id,redirect_uris_json,client_name,created_at) VALUES(?,?,?,?)")
  .run('chatgpt-customer',JSON.stringify([redirect]),'ChatGPT',new Date().toISOString());
 db._sqlite.prepare("INSERT INTO oauth_identity_links(issuer,subject_sha256,tenant_id,customer_id,witness_sha256) VALUES(?,?,?,?,?)")
  .run(issuer,sha(issuer+'\n'+subject),tenant,'existing-customer','f'.repeat(64));
 const privateVerifier={fetch:async req=>{
  const {flow_id}=await req.json(),now=Date.now();
  return Response.json({authenticated:true,production_qualified:true,audience:'chatgpt-oauth-keyless',issuer,
   subject,tenant_id:tenant,flow_id,email_verified:true,mfa_verified:true,auth_at_ms:now-500,
   expires_at_ms:now+60000});
 }};
 const env={AXIOM_DB:db,OAUTH_KEYLESS_QUALIFIED:'qualified_private_binding',OAUTH_IDENTITY_ISSUER:issuer,OAUTH_SESSION_VERIFIER:privateVerifier};
 return {db,env};
}
async function requestCode(env){
 const query=new URLSearchParams({response_type:'code',client_id:'chatgpt-customer',redirect_uri:redirect,resource,
  scope:'openid email axiom.execute',state:'state-s1',code_challenge:challenge,code_challenge_method:'S256'});
 const start=await worker.fetch(new Request(host+'/oauth/authorize?'+query),env);
 assert.equal(start.status,200);
 const flow=env.AXIOM_DB._sqlite.prepare('SELECT id FROM oauth_authorization_flows ORDER BY created_at DESC LIMIT 1').get()?.id;
 assert.ok(flow);
 const cookie=(start.headers.get('set-cookie')||'').split(';')[0]+'; idp_session=qualified';
 const consent=await worker.fetch(new Request(host+'/oauth/authorize',{method:'POST',
  headers:{cookie,'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({flow_id:flow,auth_mode:'verified_session'})}),env);
 assert.equal(consent.status,302);
 return new URL(consent.headers.get('location')).searchParams.get('code');
}
async function token(env,form){
 const r=await worker.fetch(new Request(host+'/oauth/token',{method:'POST',body:new URLSearchParams({
  client_id:'chatgpt-customer',resource,...form})}),env);
 return {status:r.status,body:await r.json()};
}
async function mintToken(env,code){
 return token(env,{grant_type:'authorization_code',code,redirect_uri:redirect,code_verifier:verifier});
}
const userinfo=(env,access)=>worker.fetch(new Request(host+'/oauth/userinfo',{headers:{authorization:'Bearer '+access}}),env);
test('verified OIDC consent binds authorization code and issued bearer/refresh family to immutable principal',async()=>{
 const {db,env}=setup();
 try{
  const code=await requestCode(env);
  assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM oauth_identity_code_links').get().n,1);
  const result=await mintToken(env,code);
  assert.equal(result.status,200);
  assert.ok(result.body.access_token&&result.body.refresh_token);
  assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM oauth_identity_token_links').get().n,1);
  assert.equal((await userinfo(env,result.body.access_token)).status,200);
  db._sqlite.exec("UPDATE oauth_identity_links SET state='revoked',revoked_at=CURRENT_TIMESTAMP WHERE customer_id='existing-customer'");
  assert.equal((await userinfo(env,result.body.access_token)).status,401);
  assert.equal(db._sqlite.prepare("SELECT status FROM api_keys WHERE label='chatgpt-oauth-access'").get().status,'revoked');
  assert.ok(db._sqlite.prepare("SELECT revoked_at FROM oauth_refresh_tokens").get().revoked_at);
  assert.equal((await token(env,{grant_type:'refresh_token',refresh_token:result.body.refresh_token})).status,400);
 }finally{db.close();}
});
test('a revoked identity cannot exchange a previously valid unredeemed code',async()=>{
 const {db,env}=setup();
 try{
  const code=await requestCode(env);
  db._sqlite.exec("UPDATE oauth_identity_links SET state='revoked',revoked_at=CURRENT_TIMESTAMP");
  const res=await mintToken(env,code);
  assert.equal(res.status,400);
  assert.equal(db._sqlite.prepare("SELECT COUNT(*) AS n FROM api_keys").get().n,0);
 }finally{db.close();}
});
test('refreshed token remains tied to original identity and gets revoked in same D1 transaction',async()=>{
 const {db,env}=setup();
 try{
  const minted=await mintToken(env,await requestCode(env));
  assert.equal(minted.status,200);
  const rotated=await token(env,{grant_type:'refresh_token',refresh_token:minted.body.refresh_token});
  assert.equal(rotated.status,200);
  assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM oauth_identity_token_links').get().n,2);
  assert.equal((await userinfo(env,rotated.body.access_token)).status,200);
  db._sqlite.exec("UPDATE oauth_identity_links SET state='revoked',revoked_at=CURRENT_TIMESTAMP");
  assert.equal((await userinfo(env,rotated.body.access_token)).status,401);
  assert.equal((await token(env,{grant_type:'refresh_token',refresh_token:rotated.body.refresh_token})).status,400);
  assert.equal(db._sqlite.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE status='active'").get().n,0);
 }finally{db.close();}
});
test('customer suspension disables both keyless OAuth credentials and existing legacy customer keys',async()=>{
 const {db,env}=setup();
 try{
  db._sqlite.prepare("INSERT INTO api_keys(id,customer_id,key_hash,status) VALUES(?,?,?,?)")
   .run('legacy-customer-key','existing-customer',sha('some-existing-key'),'active');
  const minted=await mintToken(env,await requestCode(env));
  assert.equal(minted.status,200);
  db._sqlite.exec("UPDATE customers SET status='disabled' WHERE id='existing-customer'");
  assert.equal((await userinfo(env,minted.body.access_token)).status,401);
  assert.equal(db._sqlite.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE status='active'").get().n,0);
  assert.equal((await token(env,{grant_type:'refresh_token',refresh_token:minted.body.refresh_token})).status,400);
 }finally{db.close();}
});
