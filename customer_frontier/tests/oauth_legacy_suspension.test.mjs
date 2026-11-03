import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../auth/axiom_keyless_oauth_worker_candidate.mjs';
import {setupContinuity,startFlow,exchange,customer,sha,userinfo,refresh} from './oauth_continuity_fixture.mjs';
async function legacyCode(t){
 const key='offline-existing-account-key';
 t.db._sqlite.prepare("INSERT INTO api_keys(id,customer_id,key_hash,status) VALUES('legacy-key',?,?,'active')").run(customer,sha(key));
 const f=await startFlow(t.env);
 const r=await worker.fetch(new Request('https://auth.mftintelligence.com/oauth/authorize',{method:'POST',
  headers:{cookie:f.cookie,origin:'https://auth.mftintelligence.com'},body:new URLSearchParams({
   flow_id:f.flow.id,auth_mode:'legacy_key',musitu_account_key:key})}),t.env);
 assert.equal(r.status,302);return new URL(r.headers.get('location')).searchParams.get('code');
}
test('legacy code retained across customer suspension cannot mint new credentials',async()=>{
 const t=setupContinuity();try{
  const code=await legacyCode(t);t.db._sqlite.exec("UPDATE customers SET status='disabled'");
  assert.equal((await exchange(t.env,code)).status,400);
  assert.equal(t.db._sqlite.prepare("SELECT count(*) n FROM api_keys WHERE status='active'").get().n,0);
 }finally{t.close();}
});
test('suspension during legacy mint is rejected by the database transaction',async()=>{
 const t=setupContinuity();try{
  const code=await legacyCode(t),prepare=t.db.prepare;let injected=false;
  t.db.prepare=sql=>{if(sql.startsWith('INSERT INTO api_keys')&&!injected){injected=true;t.db._sqlite.exec("UPDATE customers SET status='disabled'");}return prepare(sql);};
  const r=await exchange(t.env,code);assert.equal(r.status,400);assert.equal(r.body.access_token,undefined);
  assert.equal(t.db._sqlite.prepare("SELECT count(*) n FROM api_keys WHERE status='active'").get().n,0);
  assert.equal(t.db._sqlite.prepare('SELECT count(*) n FROM oauth_access_tokens').get().n,0);
 }finally{t.close();}
});
test('active legacy account still mints, then suspension denies access and refresh',async()=>{
 const t=setupContinuity();try{
  const r=await exchange(t.env,await legacyCode(t));assert.equal(r.status,200);
  assert.equal((await userinfo(t.env,r.body.access_token)).status,200);
  t.db._sqlite.exec("UPDATE customers SET status='disabled'");
  assert.equal((await userinfo(t.env,r.body.access_token)).status,401);
  assert.equal((await refresh(t.env,r.body.refresh_token)).status,400);
 }finally{t.close();}
});
