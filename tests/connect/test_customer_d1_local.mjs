/** Nonproduction Cloudflare D1 simulation; no Cloudflare account or remote database. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { reserveConnectCustomerRequest, readConnectCustomerUsage } from '../../connect/customer_admission.mjs';

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
    compatibilityDate: '2026-10-01',
    cf: false,
    script: 'export default { async fetch() { return new Response("isolated-local"); } }',
    d1Databases: { CONNECT_CUSTOMER_DB: '00000000-0000-4000-8000-000000000001' },
  });
  const db = await mf.getD1Database('CONNECT_CUSTOMER_DB');
  await db.exec(SCHEMA);
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

test('Cloudflare local workerd D1: schema, atomic quota, principals and revoked reads', async () => {
  const db = await createIsolatedD1();
  try {
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
    await mf.dispose();
  }
});

test('Cloudflare local workerd D1: concurrent admissions do not exceed a single-tenant cap', async () => {
  const db = await createIsolatedD1();
  try {
    const results = await Promise.all(Array.from({length:8},(_,index)=>
      reserve(db,TOKEN_B,'mining.risk',index+100)));
    assert.equal(results.filter(v=>v.ok).length,1);
    assert.equal(results.filter(v=>v.status===429).length,7);
    assert.equal((await count(db,'tenant_beta')).n,1);
    assert.equal((await db.prepare('SELECT used FROM connect_customer_minute_usage WHERE tenant_id=?').bind('tenant_beta').first()).used,1);
  } finally {
    await mf.dispose();
  }
});
