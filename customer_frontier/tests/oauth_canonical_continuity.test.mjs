import test from 'node:test';
import assert from 'node:assert/strict';
import {setupContinuity,startFlow,consent,exchange,userinfo,refresh,customer,sha} from './oauth_continuity_fixture.mjs';
import {handle} from '../customer_control_plane/worker.mjs';
import {resolveVerifiedOAuthCustomer} from '../../auth/keyless_customer_link_candidate.mjs';
const code=r=>new URL(r.headers.get('location')).searchParams.get('code');
test('website and actual candidate consent/code/token/UserInfo use the same preapproved customer UUID',async()=>{
 const t=setupContinuity();try{
  const web=await handle(new Request('https://portal.example.test/v1/customer/identity',{headers:{cookie:'idp_session=qualified'}}),t.env);
  assert.equal(web.status,200);assert.equal((await web.json()).customer_id,customer);
  const authorization=await consent(t.env,await startFlow(t.env));assert.equal(authorization.status,302);
  const minted=await exchange(t.env,code(authorization));assert.equal(minted.status,200);
  assert.equal((await (await userinfo(t.env,minted.body.access_token)).json()).sub,sha('https://auth.mftintelligence.com\n'+customer));
  assert.equal(t.portal._sqlite.prepare('SELECT role FROM memberships').get().role,'viewer');
 }finally{t.close();}
});
test('OAuth consent cannot bypass missing, mismatched, revoked or unavailable website canonical mapping',async()=>{
 for(const mode of ['missing','mismatch','revoked','unavailable']){
  const t=setupContinuity(mode==='mismatch'?{portalCustomer:'ee7e91e7-7283-49f8-b086-d677f2dfe563'}:{});try{
   if(mode==='missing')t.env.CUSTOMER_DB=undefined;
   if(mode==='revoked')t.portal._sqlite.exec("UPDATE canonical_customer_links SET status='revoked'");
   if(mode==='unavailable')t.env.CUSTOMER_DB={prepare(){throw Error('db_private_detail');}};
   const res=await consent(t.env,await startFlow(t.env));assert.equal(res.status,401,mode);
   assert.equal(t.db._sqlite.prepare('SELECT count(*) n FROM oauth_authorization_codes').get().n,0);
  }finally{t.close();}
 }
});
test('canonical revocation after code issuance blocks code exchange without issuing credentials',async()=>{
 const t=setupContinuity();try{
  const r=await consent(t.env,await startFlow(t.env));assert.equal(r.status,302);
  t.portal._sqlite.exec("UPDATE canonical_customer_links SET status='revoked'");
  assert.equal((await exchange(t.env,code(r))).status,400);
  assert.equal(t.db._sqlite.prepare('SELECT count(*) n FROM api_keys').get().n,0);
 }finally{t.close();}
});
test('canonical membership revocation blocks existing UserInfo and refresh without deleting evidence',async()=>{
 const t=setupContinuity();try{
  const r=await consent(t.env,await startFlow(t.env)),minted=await exchange(t.env,code(r));assert.equal(minted.status,200);
  t.portal._sqlite.exec("UPDATE memberships SET status='revoked'");
  assert.equal((await userinfo(t.env,minted.body.access_token)).status,401);
  assert.equal((await refresh(t.env,minted.body.refresh_token)).status,400);
  assert.equal(t.db._sqlite.prepare('SELECT count(*) n FROM oauth_identity_token_links').get().n,1);
 }finally{t.close();}
});
test('REPLACE cannot reactivate a revoked OAuth identity mapping',async()=>{
 const t=setupContinuity();try{
  t.db._sqlite.exec("UPDATE oauth_identity_links SET state='revoked',revoked_at=CURRENT_TIMESTAMP");
  assert.throws(()=>t.db._sqlite.exec(`INSERT OR REPLACE INTO oauth_identity_links(issuer,subject_sha256,tenant_id,customer_id,witness_sha256)
   SELECT issuer,subject_sha256,tenant_id,customer_id,witness_sha256 FROM oauth_identity_links`),/identity_link_insert_conflict/);
 }finally{t.close();}
});
test('copied OAuth verifier assertion cannot be reused for another request, even on the same flow',async()=>{
 const t=setupContinuity();try{
  const {flow}=await startFlow(t.env),real=t.env.OAUTH_SESSION_VERIFIER;let saved;
  t.env.OAUTH_SESSION_VERIFIER={fetch:async req=>{saved??=await (await real.fetch(req)).json();return Response.json(saved);}};
  const req=()=>new Request('https://auth.mftintelligence.com/oauth/authorize',{method:'POST',headers:{cookie:'idp_session=qualified'}});
  assert.equal((await resolveVerifiedOAuthCustomer({request:req(),env:t.env,db:t.db,flowId:flow.id})).customer_id,customer);
  await assert.rejects(resolveVerifiedOAuthCustomer({request:req(),env:t.env,db:t.db,flowId:flow.id}),/identity_session_binding_mismatch/);
 }finally{t.close();}
});
test('canonical revocation during token persistence never returns or leaves active unexposed credentials',async()=>{
 const t=setupContinuity();try{
  const r=await consent(t.env,await startFlow(t.env));assert.equal(r.status,302);
  const prepare=t.db.prepare;let injected=false;
  t.db.prepare=sql=>{if(sql.startsWith('INSERT INTO api_keys')&&!injected){injected=true;t.portal._sqlite.exec("UPDATE memberships SET status='revoked'");}return prepare(sql);};
  const token=await exchange(t.env,code(r));assert.equal(token.status,400);
  assert.equal(token.body.access_token,undefined);assert.equal(token.body.refresh_token,undefined);
  assert.equal(t.db._sqlite.prepare("SELECT count(*) n FROM api_keys WHERE status='active'").get().n,0);
  assert.equal(t.db._sqlite.prepare('SELECT count(*) n FROM oauth_identity_token_links').get().n,1);
 }finally{t.close();}
});
