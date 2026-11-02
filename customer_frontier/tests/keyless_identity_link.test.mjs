import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {openTestDB} from '../customer_control_plane/sqlite_d1_test_adapter.mjs';
import {resolveVerifiedOAuthCustomer} from '../../auth/keyless_customer_link_candidate.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const setup=()=>{
 const db=openTestDB(resolve(here,'../customer_control_plane/schema.sql'));
 db._sqlite.exec("CREATE TABLE customers(id TEXT PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('active','disabled')));");
 db._sqlite.exec(readFileSync(resolve(here,'../../auth/keyless_customer_link_candidate.sql'),'utf8'));
 db._sqlite.prepare("INSERT INTO customers(id,status) VALUES(?,?)").run('legacy-customer-1','active');
 const issuer='https://id.mftintelligence.com',subject='verified-person-1';
 const digest=createHash('sha256').update(issuer+'\n'+subject).digest('hex');
 db._sqlite.prepare("INSERT INTO oauth_identity_links(issuer,subject_sha256,tenant_id,customer_id,witness_sha256) VALUES(?,?,?,?,?)")
  .run(issuer,digest,'tenant-verified-1','legacy-customer-1','a'.repeat(64));
 return {db,issuer,subject,digest};
};
const now=Date.now(),flowId='flow_valid_identity_987654321';
const baseClaims={authenticated:true,production_qualified:true,audience:'chatgpt-oauth-keyless',issuer:'https://id.mftintelligence.com',
 subject:'verified-person-1',tenant_id:'tenant-verified-1',flow_id:flowId,email_verified:true,mfa_verified:true,auth_at_ms:now-3000,expires_at_ms:now+60000};
const candidate=(claims=baseClaims,hasBinding=true)=>{
 const verifier={fetch:async request=>{
   assert.equal(new URL(request.url).hostname,'axiom-internal');
   assert.equal(request.method,'POST');
   assert.ok((request.headers.get('cookie')||'').includes('idp_session='));
   const sent=await request.json();
   assert.equal(sent.flow_id,flowId);
   assert.equal(sent.audience,'chatgpt-oauth-keyless');
   assert.equal('subject' in sent,false);
   return Response.json(claims);
 }};
 return {OAUTH_KEYLESS_QUALIFIED:'qualified_private_binding',OAUTH_IDENTITY_ISSUER:baseClaims.issuer,
  ...(hasBinding?{OAUTH_SESSION_VERIFIER:verifier}:{})};
};
const req=()=>new Request('https://auth.mftintelligence.com/oauth/authorize',{method:'POST',
 headers:{cookie:'idp_session=provider-owned-session; musitu_oauth_flow=not-identity'},
 body:'flow_id='+flowId+'&subject=attacker&customer_id=attacker'});

test('fresh, independently verified OIDC subject resolves only pre-linked active legacy customer',async()=>{
 const {db}=setup();
 try{
  const out=await resolveVerifiedOAuthCustomer({request:req(),env:candidate(),db,flowId,now});
  assert.deepEqual(out,{customer_id:'legacy-customer-1',tenant_id:'tenant-verified-1'});
 }finally{db.close();}
});

test('unqualified or missing private identity broker cannot admit an OAuth customer',async()=>{
 const {db}=setup();
 try{
  await assert.rejects(resolveVerifiedOAuthCustomer({request:req(),env:candidate(baseClaims,false),db,flowId,now}),/keyless_not_qualified|identity_verifier_unavailable/);
  await assert.rejects(resolveVerifiedOAuthCustomer({request:req(),env:{...candidate(),OAUTH_KEYLESS_QUALIFIED:'false'},db,flowId,now}),/keyless_not_qualified/);
 }finally{db.close();}
});

test('forged issuer, tenant, audience, MFA, freshness, or flow binding cannot resolve a legacy customer',async()=>{
 const {db}=setup();
 try{
  for(const delta of [
   {issuer:'https://attacker.invalid'},{tenant_id:'another-tenant'},{audience:'other-audience'},
   {mfa_verified:false},{email_verified:false},{authenticated:false},{production_qualified:false},
   {flow_id:'flow_different_987654321'},{auth_at_ms:now-400000},{expires_at_ms:now-1}
  ]){
   await assert.rejects(resolveVerifiedOAuthCustomer({request:req(),env:candidate({...baseClaims,...delta}),db,flowId,now}));
  }
 }finally{db.close();}
});

test('unlinked, revoked, and disabled legacy accounts fail closed; link provenance cannot be rewritten',async()=>{
 const {db,issuer,digest}=setup();
 try{
  db._sqlite.prepare("UPDATE oauth_identity_links SET state='revoked',revoked_at=CURRENT_TIMESTAMP WHERE issuer=? AND subject_sha256=?").run(issuer,digest);
  await assert.rejects(resolveVerifiedOAuthCustomer({request:req(),env:candidate(),db,flowId,now}),/not_linked/);
  assert.throws(()=>db._sqlite.exec("DELETE FROM oauth_identity_links"),/identity_link_deletion_forbidden/);
  assert.throws(()=>db._sqlite.exec("UPDATE oauth_identity_links SET state='active',revoked_at=NULL"),/identity_link_reactivation_forbidden/);
 }finally{db.close();}
});
