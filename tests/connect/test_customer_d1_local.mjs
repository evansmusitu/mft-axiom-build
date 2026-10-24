/** Nonproduction Cloudflare D1 simulation; no Cloudflare account or remote database. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { reserveConnectCustomerRequest, readConnectCustomerUsage } from '../../connect/customer_admission.mjs';
import { provisionOfflineTenant, issueOfflineCredential, revokeOfflineCredential, suspendOfflineTenant, deactivateOfflineTenant } from '../../connect/customer_provisioning.mjs';

const SCHEMA = readFileSync(new URL('../../infra/connect_customer_registry.sql', import.meta.url), 'utf8');
const TIME = Date.parse('2026-10-22T12:34:00Z');
const DAY = '2026-10-22';
const TOKEN_A = 'mct_' + 'A'.repeat(43);
const TOKEN_B = 'mct_' + 'B'.repeat(43);
const sha = value => createHash('sha256').update(value).digest('hex');
const uid = i => '11111111-1111-4111-8111-' + String(i).padStart(12, '0');
let mf;

async function createIsolatedD1() {
  mf = new Miniflare({
    modules: true,
    compatibilityDate: '2026-07-01',
    cf: false,
    script: 'export default { async fetch() { return new Response("isolated-local"); } }',
    d1Databases: { CONNECT_CUSTOMER_DB: '00000000-0000-4000-8000-000000000001' },
  });
  const db = await mf.getD1Database('CONNECT_CUSTOMER_DB');
  // D1's exec() treats each newline as a separate complete SQL statement.
  // Preserve CREATE TRIGGER BEGIN/END blocks by combining each DDL statement
  // into one line; do not break on the semicolons inside SQL triggers.
  const ddl = SCHEMA.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n').trim();
  const statements = ddl.split(/\n(?=CREATE (?:TABLE|TRIGGER)\b)/g);
  assert.equal(statements.length, 7, 'expected five tables and two triggers');
  await db.exec(statements.map(sql => sql.replace(/\s+/g, ' ').trim()).join('\n'));
  await db.prepare('INSERT INTO connect_customer_tenants(tenant_id,status,daily_limit,minute_limit) VALUES(?,?,?,?)')
    .bind('tenant_alpha','active',3,2).run();
  await db.prepare('INSERT INTO connect_customer_tenants(tenant_id,status,daily_limit,minute_limit) VALUES(?,?,?,?)')
    .bind('tenant_beta','active',2,1).run();
  const insert = db.prepare('INSERT INTO connect_customer_credentials(credential_id,tenant_id,token_sha256,status,expires_at,can_plan,can_risk) VALUES(?,?,?,?,?,?,?)');
  await insert.bind('cred_alpha','tenant_alpha',sha(TOKEN_A),'active','2030-01-01T00:00:00Z',1,0).run();
  await insert.bind('cred_beta','tenant_beta',sha(TOKEN_B),'active','2030-01-01T00:00:00Z',0,1).run();
  return db;
}
const reserve = (db, token, scope, i, nowMs=TIME) => reserveConnectCustomerRequest({
  authorization:'Bearer ' + token, scope,
  env:{CONNECT_CUSTOMER_RUNTIME_ENABLED:'true',CONNECT_CUSTOMER_DB:db},
  nowMs, requestIdFactory:()=>uid(i),
});
const count = (db, tenant) => db.prepare('SELECT COUNT(*) AS n FROM connect_customer_usage_events WHERE tenant_id=?').bind(tenant).first();

test('Cloudflare local workerd D1: schema, atomic quota, principals and revoked reads', {timeout:30000}, async () => {
  let db;
  try {
    db = await createIsolatedD1();
    const a = await reserve(db,TOKEN_A,'mining.plan',1);
    const b = await reserve(db,TOKEN_B,'mining.risk',2);
    assert.equal(a.ok,true,JSON.stringify(a));
    assert.equal(b.ok,true,JSON.stringify(b));
    assert.equal(a.principal.tenant_id,'tenant_alpha');
    assert.equal(b.principal.tenant_id,'tenant_beta');
    assert.equal((await reserve(db,TOKEN_B,'mining.plan',3)).ok,false);
    const ua = await readConnectCustomerUsage({db,principal:a.principal,utcDay:DAY,nowMs:TIME});
    assert.deepEqual(ua,{ok:true,tenant_id:'tenant_alpha',utc_day:DAY,used:1,daily_limit:3});
    assert.deepEqual(await readConnectCustomerUsage({db,principal:{...a.principal,tenant_id:'tenant_beta'},utcDay:DAY,nowMs:TIME}),
      {ok:false,status:401,error:'UNAUTHORIZED'});
    const second = await reserve(db,TOKEN_A,'mining.plan',4);
    assert.equal(second.ok,true,JSON.stringify(second));
    const third = await reserve(db,TOKEN_A,'mining.plan',5);
    assert.deepEqual(third,{ok:false,status:429,error:'CUSTOMER_MINUTE_QUOTA_EXCEEDED'});
    assert.equal((await count(db,'tenant_alpha')).n,2);
    assert.equal((await count(db,'tenant_beta')).n,1);
    assert.equal((await reserve(db,TOKEN_A,'mining.plan',6,TIME+60000)).ok,true);
    const daily = await reserve(db,TOKEN_A,'mining.plan',7,TIME+120000);
    assert.deepEqual(daily,{ok:false,status:429,error:'CUSTOMER_QUOTA_EXCEEDED'});
    assert.equal((await count(db,'tenant_alpha')).n,3);
    await db.prepare('UPDATE connect_customer_credentials SET status=? WHERE credential_id=?').bind('revoked','cred_alpha').run();
    assert.deepEqual(await readConnectCustomerUsage({db,principal:a.principal,utcDay:DAY,nowMs:TIME}),
      {ok:false,status:401,error:'UNAUTHORIZED'});
    const invalid = await reserve(db,TOKEN_A,'mining.plan',8,TIME+180000);
    assert.equal(invalid.ok,false);
    assert.equal((await count(db,'tenant_alpha')).n,3);
  } finally {
    if (mf) await mf.dispose();
  }
});

test('Cloudflare local workerd D1: concurrent admissions do not exceed a single-tenant cap', {timeout:30000}, async () => {
  let db;
  try {
    db = await createIsolatedD1();
    const results = await Promise.all(Array.from({length:8},(_,index)=>
      reserve(db,TOKEN_B,'mining.risk',index+100)));
    assert.equal(results.filter(v=>v.ok).length,1);
    assert.equal(results.filter(v=>v.status===429).length,7);
    assert.equal((await count(db,'tenant_beta')).n,1);
    assert.equal((await db.prepare('SELECT used FROM connect_customer_minute_usage WHERE tenant_id=?').bind('tenant_beta').first()).used,1);
  } finally {
    if (mf) await mf.dispose();
  }
});

test('Cloudflare local D1: synthetic-only issued credentials admit, revoke and suspend correctly',
  {timeout:30000}, async () => {
    let db;
    try {
      db = await createIsolatedD1();
      const env = {
        CONNECT_CUSTOMER_DB:db,
        CONNECT_CUSTOMER_RUNTIME_ENABLED:'true',
        CONNECT_CUSTOMER_PROVISIONING_MODE:'isolated-synthetic-only',
      };
      const created = await provisionOfflineTenant({
        env,tenantId:'tenant_gamma',dailyLimit:2,minuteLimit:1,
      });
      assert.deepEqual(created,{ok:true,tenant_id:'tenant_gamma'});
      const issued = await issueOfflineCredential({
        env,tenantId:'tenant_gamma',scopes:['mining.plan'],
        expiresAt:'2026-11-01T12:34:00Z',nowMs:TIME,
      });
      assert.equal(issued.ok,true,JSON.stringify({ok:issued.ok,error:issued.error}));
      assert.match(issued.bearer_token,/^mct_[A-Za-z0-9_-]{43}$/);
      const persisted = await db.prepare(
        'SELECT token_sha256,can_plan,can_risk FROM connect_customer_credentials WHERE credential_id=?'
      ).bind(issued.credential_id).first();
      assert.match(persisted.token_sha256,/^[0-9a-f]{64}$/);
      assert.equal(persisted.can_plan,1);
      assert.equal(persisted.can_risk,0);
      assert.equal(JSON.stringify(persisted).includes(issued.bearer_token),false);
      const result=await reserve(db,issued.bearer_token,'mining.plan',180,TIME);
      assert.equal(result.ok,true,JSON.stringify(result));
      assert.equal(result.principal.tenant_id,'tenant_gamma');
      const revoked=await revokeOfflineCredential({env,tenantId:'tenant_gamma',
        credentialId:issued.credential_id});
      assert.equal(revoked.ok,true,JSON.stringify(revoked));
      assert.deepEqual(await reserve(db,issued.bearer_token,'mining.plan',181,TIME),
        {ok:false,status:401,error:'UNAUTHORIZED'});
      const suspended=await suspendOfflineTenant({env,tenantId:'tenant_gamma'});
      assert.deepEqual(suspended,{ok:true,tenant_id:'tenant_gamma',status:'suspended'});
      assert.deepEqual(await issueOfflineCredential({
        env,tenantId:'tenant_gamma',scopes:['mining.plan'],
        expiresAt:'2026-11-01T12:34:00Z',nowMs:TIME,
      }),{ok:false,status:403,error:'TENANT_NOT_ELIGIBLE'});
      assert.equal((await count(db,'tenant_gamma')).n,1);
    } finally {
      if (mf) await mf.dispose();
    }
  });


test('Cloudflare local D1: synthetic atomic tenant deactivation revokes all keys but keeps audit', {timeout:30000}, async () => {
  let db;
  try {
    db = await createIsolatedD1();
    const env = {
      CONNECT_CUSTOMER_DB:db, CONNECT_CUSTOMER_RUNTIME_ENABLED:'true',
      CONNECT_CUSTOMER_PROVISIONING_MODE:'isolated-synthetic-only',
    };
    assert.equal((await provisionOfflineTenant({env,tenantId:'tenant_gamma',dailyLimit:5,minuteLimit:5})).ok,true);
    const first=await issueOfflineCredential({
      env,tenantId:'tenant_gamma',scopes:['mining.plan'],
      expiresAt:'2026-11-01T12:34:00Z',nowMs:TIME,
    });
    const second=await issueOfflineCredential({
      env,tenantId:'tenant_gamma',scopes:['mining.risk'],
      expiresAt:'2026-11-01T12:34:00Z',nowMs:TIME,
    });
    assert.equal(first.ok,true);
    assert.equal(second.ok,true);
    const attempt=await reserve(db,first.bearer_token,'mining.plan',301,TIME);
    assert.equal(attempt.ok,true);
    assert.equal((await count(db,'tenant_gamma')).n,1);

    const result=await deactivateOfflineTenant({env,tenantId:'tenant_gamma'});
    assert.deepEqual(result,{ok:true,tenant_id:'tenant_gamma',status:'suspended',revoked_credentials:2});
    const statuses=await db.prepare(
      'SELECT status FROM connect_customer_credentials WHERE tenant_id=? ORDER BY credential_id'
    ).bind('tenant_gamma').all();
    assert.deepEqual(statuses.results.map(r=>r.status),['revoked','revoked']);
    assert.equal((await db.prepare('SELECT status FROM connect_customer_tenants WHERE tenant_id=?').bind('tenant_gamma').first()).status,'suspended');

    assert.deepEqual(await reserve(db,first.bearer_token,'mining.plan',302,TIME),
      {ok:false,status:401,error:'UNAUTHORIZED'});
    assert.deepEqual(await reserve(db,second.bearer_token,'mining.risk',303,TIME),
      {ok:false,status:401,error:'UNAUTHORIZED'});
    const cannotIssue=await issueOfflineCredential({
      env,tenantId:'tenant_gamma',scopes:['mining.plan'],
      expiresAt:'2026-11-01T12:34:00Z',nowMs:TIME,
    });
    assert.deepEqual(cannotIssue,{ok:false,status:403,error:'TENANT_NOT_ELIGIBLE'});
    assert.equal((await count(db,'tenant_gamma')).n,1,'audit reservation intentionally retained');
    assert.equal((await reserve(db,TOKEN_A,'mining.plan',304,TIME)).ok,true,
      'unrelated tenant remains active');
    assert.deepEqual(await deactivateOfflineTenant({env,tenantId:'tenant_gamma'}),
      {ok:true,tenant_id:'tenant_gamma',status:'suspended',revoked_credentials:0});
  } finally { if(mf) await mf.dispose(); }
});

test('Cloudflare local D1: deactivation denies wrong tenants, disabled flags and missing batch', {timeout:30000}, async () => {
  let db;
  try {
    db=await createIsolatedD1();
    const env={CONNECT_CUSTOMER_DB:db,CONNECT_CUSTOMER_PROVISIONING_MODE:'isolated-synthetic-only'};
    assert.deepEqual(await deactivateOfflineTenant({env:{...env,CONNECT_CUSTOMER_PROVISIONING_MODE:'false'},tenantId:'tenant_alpha'}),
      {ok:false,status:503,error:'PROVISIONING_DISABLED'});
    assert.deepEqual(await deactivateOfflineTenant({env,tenantId:'tenant_absent'}),
      {ok:false,status:404,error:'TENANT_NOT_FOUND'});
    assert.deepEqual(await deactivateOfflineTenant({env:{...env,CONNECT_CUSTOMER_DB:{prepare:db.prepare.bind(db)}},tenantId:'tenant_alpha'}),
      {ok:false,status:503,error:'PROVISIONING_UNAVAILABLE'});
    assert.equal((await db.prepare('SELECT status FROM connect_customer_tenants WHERE tenant_id=?').bind('tenant_alpha').first()).status,'active');
    assert.equal((await db.prepare('SELECT status FROM connect_customer_credentials WHERE credential_id=?').bind('cred_alpha').first()).status,'active');
  } finally { if(mf) await mf.dispose(); }
});


test('Cloudflare local D1: failed credential revocation rolls back account suspension atomically', {timeout:30000}, async () => {
  let db;
  try {
    db=await createIsolatedD1();
    const env={CONNECT_CUSTOMER_DB:db,CONNECT_CUSTOMER_PROVISIONING_MODE:'isolated-synthetic-only'};
    const created=await provisionOfflineTenant({env,tenantId:'tenant_gamma',dailyLimit:2,minuteLimit:2});
    assert.equal(created.ok,true);
    const issued=await issueOfflineCredential({
      env,tenantId:'tenant_gamma',scopes:['mining.plan'],
      expiresAt:'2026-11-01T12:34:00Z',nowMs:TIME,
    });
    assert.equal(issued.ok,true);

    // Deliberately reject the second batched write. The first write must
    // roll back as well or the runtime would leave an inconsistent account.
    await db.exec(
      "CREATE TRIGGER connect_abort_revocation BEFORE UPDATE ON connect_customer_credentials WHEN OLD.tenant_id='tenant_gamma' AND NEW.status='revoked' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_REVOCATION_ABORT'); END;"
    );
    assert.deepEqual(await deactivateOfflineTenant({env,tenantId:'tenant_gamma'}),
      {ok:false,status:503,error:'PROVISIONING_UNAVAILABLE'});
    assert.equal((await db.prepare('SELECT status FROM connect_customer_tenants WHERE tenant_id=?')
      .bind('tenant_gamma').first()).status,'active');
    assert.equal((await db.prepare('SELECT status FROM connect_customer_credentials WHERE credential_id=?')
      .bind(issued.credential_id).first()).status,'active');
    assert.equal((await db.prepare('SELECT status FROM connect_customer_tenants WHERE tenant_id=?')
      .bind('tenant_alpha').first()).status,'active');
  } finally {if(mf) await mf.dispose();}
});
