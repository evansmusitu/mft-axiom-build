import {oauthProofFixture,seedCanonicalFixture} from './identity_fixture.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openTestDB} from '../customer_control_plane/sqlite_d1_test_adapter.mjs';
import worker from '../../auth/axiom_keyless_oauth_worker_candidate.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const issuer='https://id.mftintelligence.com',subject='verified-customer-one',tenant='personal-tenant-1';
const url='https://auth.mftintelligence.com/oauth/authorize';
const redirect='https://chatgpt.com/connector/oauth/musitu-candidate';
const sha=t=>createHash('sha256').update(t).digest('hex');
function fixture(){
 const db=openTestDB(resolve(here,'../customer_control_plane/schema.sql'));
 db._sqlite.exec("CREATE TABLE customers(id TEXT PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('active','disabled')),email TEXT,plan TEXT);");
 db._sqlite.exec("CREATE TABLE api_keys(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,key_hash TEXT NOT NULL,key_prefix TEXT,label TEXT,status TEXT NOT NULL,created_at TEXT,last_used_at TEXT,expires_at TEXT,revoked_at TEXT);");
 db._sqlite.exec("CREATE TABLE oauth_clients(client_id TEXT PRIMARY KEY,redirect_uris_json TEXT NOT NULL,client_name TEXT NOT NULL,created_at TEXT NOT NULL);");
 db._sqlite.exec("CREATE TABLE oauth_authorization_flows(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,redirect_uri TEXT NOT NULL,state TEXT NOT NULL,resource TEXT NOT NULL,scope TEXT NOT NULL,code_challenge TEXT NOT NULL,nonce_hash TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT);");
 db._sqlite.exec("CREATE TABLE oauth_authorization_codes(code_hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,customer_id TEXT NOT NULL,redirect_uri TEXT NOT NULL,resource TEXT NOT NULL,scope TEXT NOT NULL,code_challenge TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT);");
 db._sqlite.exec(readFileSync(resolve(here,'../../auth/keyless_customer_link_candidate.sql'),'utf8'));
 db._sqlite.exec("CREATE TABLE oauth_access_tokens(token_hash TEXT PRIMARY KEY,api_key_id TEXT,client_id TEXT,customer_id TEXT,issuer TEXT,resource TEXT,scope TEXT,created_at TEXT,expires_at TEXT,revoked_at TEXT);");
 db._sqlite.exec("CREATE TABLE oauth_refresh_tokens(token_hash TEXT PRIMARY KEY,api_key_id TEXT,client_id TEXT,customer_id TEXT,resource TEXT,scope TEXT,created_at TEXT,expires_at TEXT,revoked_at TEXT);");
 db._sqlite.exec(readFileSync(resolve(here,'../../auth/keyless_token_revocation_candidate.sql'),'utf8'));
 db._sqlite.prepare("INSERT INTO customers(id,status) VALUES(?,?)").run('5328af0f-8545-48b5-96ed-196627a2c334','active');
 db._sqlite.prepare("INSERT INTO oauth_clients(client_id,redirect_uris_json,client_name,created_at) VALUES(?,?,?,?)")
  .run('chatgpt-client',JSON.stringify([redirect]),'ChatGPT','2026-11-02T00:00:00.000Z');
 db._sqlite.prepare("INSERT INTO oauth_identity_links(issuer,subject_sha256,tenant_id,customer_id,witness_sha256) VALUES(?,?,?,?,?)")
  .run(issuer,sha(issuer+'\n'+subject),tenant,'5328af0f-8545-48b5-96ed-196627a2c334','e'.repeat(64));
 const privateVerifier={fetch:async req=>{
  const p=await req.clone().json(),now=Date.now();
  return Response.json(await oauthProofFixture(req,{authenticated:true,production_qualified:true,audience:'axiom-chatgpt-oauth',
   issuer,subject,tenant_id:tenant,flow_id:p.flow_id,email_verified:true,mfa_verified:true,
   auth_at_ms:now-1000,expires_at_ms:now+60000}));
 }};
 seedCanonicalFixture(db,{issuer,subject,tenant,customer:'5328af0f-8545-48b5-96ed-196627a2c334'});
 const env={CUSTOMER_DB:db,CUSTOMER_IDENTITY_ISSUER:issuer,AXIOM_DB:db,OAUTH_KEYLESS_QUALIFIED:'qualified_private_binding',OAUTH_IDENTITY_ISSUER:issuer,
  OAUTH_SESSION_VERIFIER:privateVerifier};
 return {db,env};
}
async function begin(env){
 const qs=new URLSearchParams({response_type:'code',client_id:'chatgpt-client',redirect_uri:redirect,
  resource:'https://mcp.mftintelligence.com',scope:'axiom.execute',state:'client_owned_state_1',
  code_challenge:'B'.repeat(43),code_challenge_method:'S256'});
 const res=await worker.fetch(new Request(url+'?'+qs.toString()),env);
 assert.equal(res.status,200);
 const flow=env.AXIOM_DB._sqlite.prepare('SELECT id FROM oauth_authorization_flows').get()?.id;
 assert.ok(flow);
 const cookie=(res.headers.get('set-cookie')||'').split(';')[0]+'; idp_session=owner-verified-session';
 return {flow,cookie,page:await res.text()};
}
const submit=(env,flow,cookie,params)=>{
 const body=new URLSearchParams({flow_id:flow,...params});
 return worker.fetch(new Request(url,{method:'POST',headers:{cookie,'content-type':'application/x-www-form-urlencoded'},body}),env);
};
test('qualified session consent reaches authorization code without an AXIOM account key',async()=>{
 const {db,env}=fixture();
 try{
  const {flow,cookie,page}=await begin(env);
  assert.match(page,/auth_mode/);
  assert.match(page,/verified_session/);
  const res=await submit(env,flow,cookie,{auth_mode:'verified_session'});
  assert.equal(res.status,302);
  const cb=new URL(res.headers.get('location'));
  assert.equal(cb.origin,'https://chatgpt.com');
  assert.ok(cb.searchParams.get('code'));
  assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM oauth_authorization_codes').get().n,1);
  assert.equal(db._sqlite.prepare('SELECT customer_id FROM oauth_authorization_codes').get().customer_id,'5328af0f-8545-48b5-96ed-196627a2c334');
 }finally{db.close();}
});
test('qualified mode cannot issue a code when private session service is absent or link revoked',async()=>{
 const {db,env}=fixture();
 try{
  const start=await begin(env);
  const missing={...env,OAUTH_SESSION_VERIFIER:undefined};
  assert.doesNotMatch((await beginMissing(missing)).page,/verified_session/);
  assert.notEqual((await submit(missing,start.flow,start.cookie,{auth_mode:'verified_session'})).status,302);
  db._sqlite.exec("UPDATE oauth_identity_links SET state='revoked',revoked_at=CURRENT_TIMESTAMP");
  assert.notEqual((await submit(env,start.flow,start.cookie,{auth_mode:'verified_session'})).status,302);
  assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM oauth_authorization_codes').get().n,0);
 }finally{db.close();}
});
async function beginMissing(env){return begin(env);}
test('existing account-key authorization remains available and isolated from verified mode',async()=>{
 const {db,env}=fixture();
 try{
  db._sqlite.prepare('INSERT INTO api_keys(id,customer_id,key_hash,status) VALUES(?,?,?,?)')
   .run('old-key','5328af0f-8545-48b5-96ed-196627a2c334',sha('legacy-key-for-test'),'active');
  const {flow,cookie}=await begin({...env,OAUTH_KEYLESS_QUALIFIED:'disabled'});
  const res=await submit(env,flow,cookie,{musitu_account_key:'legacy-key-for-test'});
  assert.equal(res.status,302);
  assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM oauth_authorization_codes').get().n,1);
 }finally{db.close();}
});

test('two racing verified consents for one CSRF flow can issue at most one code',async()=>{
 const {db,env}=fixture();
 try{
  const {flow,cookie}=await begin(env);
  const original=env.OAUTH_SESSION_VERIFIER;
  let arrivals=0,release;
  const barrier=new Promise(resolve=>{release=resolve});
  env.OAUTH_SESSION_VERIFIER={fetch:async request=>{
   arrivals++;
   if(arrivals===2)release();
   await barrier;
   return original.fetch(request);
  }};
  const outcomes=await Promise.all([
   submit(env,flow,cookie,{auth_mode:'verified_session'}),
   submit(env,flow,cookie,{auth_mode:'verified_session'})
  ]);
  assert.equal(arrivals,2,'both requests must have passed flow validation before issuing code');
  assert.equal(outcomes.filter(x=>x.status===302).length,1,'only one authorization code may be returned');
  assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM oauth_authorization_codes').get().n,1);
 }finally{db.close();}
});

test('valid legacy key can be used only once for the same consent flow',async()=>{
 const {db,env}=fixture();
 try{
  db._sqlite.prepare('INSERT INTO api_keys(id,customer_id,key_hash,status) VALUES(?,?,?,?)')
   .run('old-key-once','5328af0f-8545-48b5-96ed-196627a2c334',sha('owner-existing-key-test'),'active');
  const {flow,cookie}=await begin({...env,OAUTH_KEYLESS_QUALIFIED:'disabled'});
  const first=await submit(env,flow,cookie,{musitu_account_key:'owner-existing-key-test'});
  const replay=await submit(env,flow,cookie,{musitu_account_key:'owner-existing-key-test'});
  assert.equal(first.status,302);
  assert.notEqual(replay.status,302);
  assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM oauth_authorization_codes').get().n,1);
 }finally{db.close();}
});

test('failed verified-session mode cannot downgrade into legacy-key authorization',async()=>{
 const {db,env}=fixture();
 try{
  db._sqlite.prepare('INSERT INTO api_keys(id,customer_id,key_hash,status) VALUES(?,?,?,?)')
   .run('old-key-nodowngrade','5328af0f-8545-48b5-96ed-196627a2c334',sha('owner-valid-key-test'),'active');
  const {flow,cookie}=await begin(env);
  const badEnv={...env,OAUTH_SESSION_VERIFIER:undefined};
  const res=await submit(badEnv,flow,cookie,{auth_mode:'verified_session',musitu_account_key:'owner-valid-key-test'});
  assert.notEqual(res.status,302);
  assert.notEqual((await submit(env,flow,cookie,{auth_mode:'invalid',musitu_account_key:'owner-valid-key-test'})).status,302);
  assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM oauth_authorization_codes').get().n,0);
 }finally{db.close();}
});
