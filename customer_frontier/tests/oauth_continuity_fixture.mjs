// OFFLINE ONLY: two independent SQLite databases and a simulated private IdP.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {openTestDB} from '../customer_control_plane/sqlite_d1_test_adapter.mjs';
import worker from '../../auth/axiom_keyless_oauth_worker_candidate.mjs';
import {sessionFixture} from './identity_fixture.mjs';
export const identity={issuer:'https://identity.example.test',subject:'customer-subject',tenant_id:'tenant-canonical'};
export const customer='5328af0f-8545-48b5-96ed-196627a2c334';
export const sha=s=>createHash('sha256').update(s).digest('hex');
const host='https://auth.mftintelligence.com',resource='https://mcp.mftintelligence.com',redirect='https://chatgpt.com/connector/oauth/axiom';
const verifier='V'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url');
export function setupContinuity({portalCustomer=customer}={}){
 const schema=new URL('../customer_control_plane/schema.sql',import.meta.url);
 const portal=openTestDB(schema),db=openTestDB(schema);
 db._sqlite.exec(`CREATE TABLE customers(id TEXT PRIMARY KEY,status TEXT NOT NULL,email TEXT,plan TEXT);
 CREATE TABLE api_keys(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,key_hash TEXT NOT NULL,key_prefix TEXT,label TEXT,status TEXT NOT NULL,created_at TEXT,last_used_at TEXT,expires_at TEXT,revoked_at TEXT);
 CREATE TABLE oauth_clients(client_id TEXT PRIMARY KEY,redirect_uris_json TEXT NOT NULL,client_name TEXT,created_at TEXT);
 CREATE TABLE oauth_authorization_flows(id TEXT PRIMARY KEY,client_id TEXT,redirect_uri TEXT,state TEXT,resource TEXT,scope TEXT,code_challenge TEXT,nonce_hash TEXT,created_at TEXT,expires_at TEXT,used_at TEXT);
 CREATE TABLE oauth_authorization_codes(code_hash TEXT PRIMARY KEY,client_id TEXT,customer_id TEXT,redirect_uri TEXT,resource TEXT,scope TEXT,code_challenge TEXT,created_at TEXT,expires_at TEXT,used_at TEXT);
 CREATE TABLE oauth_access_tokens(token_hash TEXT PRIMARY KEY,api_key_id TEXT,client_id TEXT,customer_id TEXT,issuer TEXT,resource TEXT,scope TEXT,created_at TEXT,expires_at TEXT,revoked_at TEXT);
 CREATE TABLE oauth_refresh_tokens(token_hash TEXT PRIMARY KEY,api_key_id TEXT,client_id TEXT,customer_id TEXT,resource TEXT,scope TEXT,created_at TEXT,expires_at TEXT,revoked_at TEXT);
 CREATE TABLE oauth_identity_claims(customer_id TEXT PRIMARY KEY,email_verified_at TEXT);`);
 for(const name of ['keyless_customer_link_candidate.sql','keyless_token_revocation_candidate.sql'])
  db._sqlite.exec(readFileSync(new URL('../../auth/'+name,import.meta.url),'utf8'));
 db._sqlite.prepare('INSERT INTO customers(id,status,email,plan) VALUES(?,?,?,?)').run(customer,'active','verified@example.test','developer');
 db._sqlite.prepare('INSERT INTO oauth_clients(client_id,redirect_uris_json) VALUES(?,?)').run('chatgpt-client',JSON.stringify([redirect]));
 db._sqlite.prepare('INSERT INTO oauth_identity_claims(customer_id,email_verified_at) VALUES(?,?)').run(customer,new Date().toISOString());
 db._sqlite.prepare('INSERT INTO oauth_identity_links(issuer,subject_sha256,tenant_id,customer_id,witness_sha256) VALUES(?,?,?,?,?)')
  .run(identity.issuer,sha(identity.issuer+'\n'+identity.subject),identity.tenant_id,customer,'a'.repeat(64));
 portal._sqlite.prepare('INSERT INTO tenants(id,name) VALUES(?,?)').run(identity.tenant_id,'Customer');
 portal._sqlite.prepare('INSERT INTO identities(id,issuer,external_sub) VALUES(?,?,?)').run('identity-canonical',identity.issuer,identity.subject);
 portal._sqlite.prepare('INSERT INTO memberships(tenant_id,identity_id,role) VALUES(?,?,?)').run(identity.tenant_id,'identity-canonical','viewer');
 portal._sqlite.prepare("INSERT INTO canonical_customer_links(identity_id,tenant_id,customer_id,link_kind,proof_id,proof_sha256,consent_id,authority_subject) VALUES(?,?,?,'legacy','proof-offline-0001',?,'consent-offline-0001','authority-offline-0001')")
  .run('identity-canonical',identity.tenant_id,portalCustomer,'a'.repeat(64));
 const service={fetch:async req=>{
  const sent=await req.clone().json(),now=Date.now();
  return Response.json({...await sessionFixture(req,{authenticated:true,...identity,audience:sent.audience}),
   production_qualified:true,flow_id:sent.flow_id,auth_at_ms:now-1000});
 }};
 const env={AXIOM_DB:db,CUSTOMER_DB:portal,OAUTH_KEYLESS_QUALIFIED:'qualified_private_binding',
  OAUTH_IDENTITY_ISSUER:identity.issuer,OAUTH_SESSION_VERIFIER:service,
  CUSTOMER_IDENTITY_ISSUER:identity.issuer,IDENTITY_VERIFIER_QUALIFIED:'qualified_private_binding',IDENTITY_VERIFIER:service};
 return {db,portal,env,close(){db.close();portal.close();}};
}
export async function startFlow(env){
 const query=new URLSearchParams({response_type:'code',client_id:'chatgpt-client',redirect_uri:redirect,resource,
  scope:'openid email axiom.execute',state:'S'.repeat(32),code_challenge:challenge,code_challenge_method:'S256'});
 const response=await worker.fetch(new Request(host+'/oauth/authorize?'+query),env);
 if(response.status!==200)throw Error('flow_start_failed');
 const flow=env.AXIOM_DB._sqlite.prepare('SELECT * FROM oauth_authorization_flows ORDER BY rowid DESC LIMIT 1').get();
 return {flow,cookie:(response.headers.get('set-cookie')||'').split(';')[0]+'; idp_session=qualified'};
}
export const consent=(env,f)=>worker.fetch(new Request(host+'/oauth/authorize',{method:'POST',
 headers:{cookie:f.cookie,origin:host,'content-type':'application/x-www-form-urlencoded'},
 body:new URLSearchParams({flow_id:f.flow.id,auth_mode:'verified_session'})}),env);
export async function exchange(env,code){
 const r=await worker.fetch(new Request(host+'/oauth/token',{method:'POST',body:new URLSearchParams({
  grant_type:'authorization_code',client_id:'chatgpt-client',resource,code,redirect_uri:redirect,code_verifier:verifier})}),env);
 return {status:r.status,body:await r.json()};
}
export const userinfo=(env,token)=>worker.fetch(new Request(host+'/oauth/userinfo',{headers:{authorization:'Bearer '+token}}),env);
export const refresh=(env,token)=>worker.fetch(new Request(host+'/oauth/token',{method:'POST',body:new URLSearchParams({
 grant_type:'refresh_token',client_id:'chatgpt-client',resource,refresh_token:token})}),env);
