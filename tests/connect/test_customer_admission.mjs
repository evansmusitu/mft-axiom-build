import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {reserveConnectCustomerRequest, readConnectCustomerUsage} from '../../connect/customer_admission.mjs';

const SQL = readFileSync(new URL('../../infra/connect_customer_registry.sql', import.meta.url), 'utf8');
const t1 = 'mct_' + 'A'.repeat(43);
const t2 = 'mct_' + 'B'.repeat(43);
const sha = s => createHash('sha256').update(s).digest('hex');
const TIME = Date.parse('2026-10-22T12:00:00Z');
const DAY = '2026-10-22';
const uuid = '33333333-3333-4333-8333-333333333333';

function fixture({alphaLimit=2, betaLimit=3}={}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(SQL);
  const seedTenant = sql.prepare('INSERT INTO connect_customer_tenants (tenant_id,status,daily_limit) VALUES(?,?,?)');
  seedTenant.run('tenant_alpha','active',alphaLimit);
  seedTenant.run('tenant_beta','active',betaLimit);
  const seedCred = sql.prepare('INSERT INTO connect_customer_credentials (credential_id,tenant_id,token_sha256,status,expires_at,can_plan,can_risk) VALUES(?,?,?,?,?,?,?)');
  seedCred.run('cred_alpha','tenant_alpha',sha(t1),'active','2030-01-01T00:00:00Z',1,0);
  seedCred.run('cred_beta','tenant_beta',sha(t2),'active','2030-01-01T00:00:00Z',0,1);
  const db = {prepare(statement) {return {bind(...values) {return {async first() {
    return sql.prepare(statement).get(...values) ?? null;
  }}}}}};
  return {sql, db, env:{CONNECT_CUSTOMER_RUNTIME_ENABLED:'true',CONNECT_CUSTOMER_DB:db}};
}
function admit(env,token=t1,scope='mining.plan',requestId=uuid,nowMs=TIME) {
  return reserveConnectCustomerRequest({authorization:'Bearer '+token,scope,env,nowMs,requestIdFactory:()=>requestId});
}
function rows(sql,tenant) {return sql.prepare('SELECT * FROM connect_customer_usage_events WHERE tenant_id = ? ORDER BY request_id').all(tenant);}

test('disabled or missing DB returns fail-closed with zero access',async()=>{
  const f=fixture();
  assert.deepEqual(await admit({...f.env,CONNECT_CUSTOMER_RUNTIME_ENABLED:'false'}),{ok:false,status:503,error:'CUSTOMER_RUNTIME_DISABLED'});
  assert.deepEqual(await admit({CONNECT_CUSTOMER_RUNTIME_ENABLED:'true'}),{ok:false,status:503,error:'CUSTOMER_RUNTIME_UNAVAILABLE'});
  assert.equal(rows(f.sql,'tenant_alpha').length,0);
});

test('two tenants are server-derived from hashed credentials; request evidence is separate',async()=>{
  const f=fixture();
  const a=await admit(f.env,t1,'mining.plan');
  const b=await admit(f.env,t2,'mining.risk',uuid);
  assert.equal(a.ok,true);assert.equal(b.ok,true);
  assert.equal(a.principal.tenant_id,'tenant_alpha');
  assert.equal(b.principal.tenant_id,'tenant_beta');
  assert.equal(a.principal.scope,'mining.plan');
  assert.equal(b.principal.scope,'mining.risk');
  assert.equal(rows(f.sql,'tenant_alpha').length,1);
  assert.equal(rows(f.sql,'tenant_beta').length,1);
  assert.equal(rows(f.sql,'tenant_alpha')[0].request_id,uuid);
  for(const result of [a,b]) {
    assert.doesNotMatch(JSON.stringify(result),/token_sha256|mct_|Bearer|axiom_key/i);
  }
  assert.equal(f.sql.prepare('SELECT token_sha256 FROM connect_customer_credentials WHERE credential_id=?').get('cred_alpha').token_sha256,sha(t1));
});

test('cross-tenant, forged principal, unknown token and insufficient scope cannot reveal usage',async()=>{
  const f=fixture();
  const a=await admit(f.env,t1,'mining.plan');
  assert.equal(a.ok,true);
  const readA=await readConnectCustomerUsage({db:f.db,principal:a.principal,utcDay:DAY});
  assert.deepEqual(readA,{ok:true,tenant_id:'tenant_alpha',utc_day:DAY,used:1,daily_limit:2});
  const forged={tenant_id:'tenant_beta',credential_id:'cred_beta',scope:'mining.risk'};
  assert.deepEqual(await readConnectCustomerUsage({db:f.db,principal:forged,utcDay:DAY}),{ok:false,status:401,error:'UNAUTHORIZED'});
  assert.deepEqual(await admit(f.env,t2,'mining.plan','44444444-4444-4444-8444-444444444444'),{ok:false,status:401,error:'UNAUTHORIZED'});
  assert.deepEqual(await admit(f.env,'mct_'+'C'.repeat(43)),{ok:false,status:401,error:'UNAUTHORIZED'});
  assert.equal(rows(f.sql,'tenant_beta').length,0);
});

test('atomic quota reservation blocks requests beyond daily limit without leaked or partial usage',async()=>{
  const f=fixture({alphaLimit:1});
  const result=await Promise.all([
    admit(f.env,t1,'mining.plan','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    admit(f.env,t1,'mining.plan','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ]);
  assert.equal(result.filter(x=>x.ok).length,1);
  assert.equal(result.filter(x=>x.status===429).length,1);
  assert.equal(rows(f.sql,'tenant_alpha').length,1);
  assert.equal(f.sql.prepare('SELECT used FROM connect_customer_daily_usage WHERE tenant_id=? AND utc_day=?').get('tenant_alpha',DAY).used,1);
  assert.deepEqual(await admit(f.env,t1,'mining.plan','cccccccc-cccc-4ccc-8ccc-cccccccccccc',Date.parse('2026-10-23T00:00:00Z')) .then(x=>({ok:x.ok})),{ok:true});
  assert.equal(f.sql.prepare('SELECT used FROM connect_customer_daily_usage WHERE tenant_id=? AND utc_day=?').get('tenant_alpha','2026-10-23').used,1);
});

test('revocation, suspension and expiry cannot reserve usage even across a prior authorization',async()=>{
  const f=fixture();
  let r=await admit(f.env);assert.equal(r.ok,true);
  f.sql.prepare('UPDATE connect_customer_credentials SET status=? WHERE credential_id=?').run('revoked','cred_alpha');
  assert.equal((await admit(f.env,t1,'mining.plan','44444444-4444-4444-8444-444444444444')).status,401);
  f.sql.prepare('UPDATE connect_customer_credentials SET status=? WHERE credential_id=?').run('active','cred_alpha');
  f.sql.prepare('UPDATE connect_customer_tenants SET status=? WHERE tenant_id=?').run('suspended','tenant_alpha');
  assert.equal((await admit(f.env,t1,'mining.plan','55555555-5555-4555-8555-555555555555')).status,401);
  f.sql.prepare('UPDATE connect_customer_tenants SET status=? WHERE tenant_id=?').run('active','tenant_alpha');
  f.sql.prepare('UPDATE connect_customer_credentials SET expires_at=? WHERE credential_id=?').run('2026-10-22T12:00:00Z','cred_alpha');
  assert.equal((await admit(f.env,t1,'mining.plan','66666666-6666-4666-8666-666666666666')).status,401);
  assert.equal(rows(f.sql,'tenant_alpha').length,1);
});

test('invalid bearer and invalid server-controlled request IDs do not write events',async()=>{
  const f=fixture();
  assert.equal((await reserveConnectCustomerRequest({authorization:'Bearer '+sha('guess'),scope:'mining.plan',env:f.env,nowMs:TIME})).status,401);
  assert.equal((await admit(f.env,t1,'mining.plan','not-uuid')).status,503);
  assert.equal((await admit(f.env,t1,'mining.admin')).status,403);
  assert.equal(rows(f.sql,'tenant_alpha').length,0);
});

test('duplicate request ID is rejected for same tenant but never affects other tenant',async()=>{
  const f=fixture();
  assert.equal((await admit(f.env,t1,'mining.plan',uuid)).ok,true);
  assert.equal((await admit(f.env,t1,'mining.plan',uuid)).status,409);
  assert.equal((await admit(f.env,t2,'mining.risk',uuid)).ok,true);
  assert.equal(rows(f.sql,'tenant_alpha').length,1);
  assert.equal(rows(f.sql,'tenant_beta').length,1);
});

test('unexpected database errors do not publish raw diagnostics',async()=>{
  const f=fixture();
  const env={...f.env, CONNECT_CUSTOMER_DB:{prepare(){throw Error('private SQL and source secret');}}};
  const result=await admit(env);
  assert.deepEqual(result,{ok:false,status:503,error:'CUSTOMER_RUNTIME_UNAVAILABLE'});
});

test('malformed calendar day and out-of-range trusted clock fail closed without throwing',async()=>{
  const f=fixture();
  const a=await admit(f.env);
  assert.equal(a.ok,true);
  assert.deepEqual(await readConnectCustomerUsage({db:f.db,principal:a.principal,utcDay:'2026-99-99'}),
    {ok:false,status:503,error:'CUSTOMER_RUNTIME_UNAVAILABLE'});
  assert.deepEqual(await reserveConnectCustomerRequest({authorization:'Bearer '+t1,scope:'mining.plan',env:f.env,nowMs:Number.MAX_SAFE_INTEGER}),
    {ok:false,status:503,error:'CUSTOMER_RUNTIME_UNAVAILABLE'});
});

test('previously verified capabilities are frozen and cannot read usage after revocation',async()=>{
  const f=fixture();
  const a=await admit(f.env);
  assert.equal(Object.isFrozen(a.principal),true);
  assert.equal((await readConnectCustomerUsage({db:f.db,principal:a.principal,utcDay:DAY,nowMs:TIME})).ok,true);
  f.sql.prepare('UPDATE connect_customer_credentials SET status=? WHERE credential_id=?').run('revoked','cred_alpha');
  assert.deepEqual(await readConnectCustomerUsage({db:f.db,principal:a.principal,utcDay:DAY,nowMs:TIME}),
    {ok:false,status:401,error:'UNAUTHORIZED'});
});
