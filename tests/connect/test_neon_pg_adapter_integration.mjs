/**
 * Ephemeral PostgreSQL integration with a real restricted CI login.
 * Must run after qualification/neon_pg_contract_test.py seeds its fixture.
 * No customer, hosted Neon or production resource is contacted.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {reserveNeonSyntheticCustomerRequest as reserve} from '../../connect/customer_neon_admission.mjs';

const DSN=process.env.NEON_TEST_PG_DSN ?? '';
const TOKEN='mct_'+'Q'.repeat(43);
const digest=createHash('sha256').update(TOKEN).digest('hex');
const UUIDS=[
  'abcd1111-1111-4111-8111-111111111111',
  'abcd2222-2222-4222-8222-222222222222',
  'abcd3333-3333-4333-8333-333333333333',
];
const submit=(env,uuid,scope='mining.plan')=>reserve({
  env,scope,authorization:'Bearer '+TOKEN,requestIdFactory:()=>uuid,
});

test('real PG login enforces adapter auth, quotas, replay and revocation',async()=>{
  assert.match(DSN,/127\.0\.0\.1:5432\/postgres/);
  const owner=new pg.Client({connectionString:DSN});
  const restricted=new pg.Client({
    host:'127.0.0.1',port:5432,database:'postgres',
    user:'musitu_ci_app',password:'ci-synthetic-disposable-only',ssl:false,
  });
  await owner.connect();
  try {
    await restricted.connect();
    try {
      const who=await restricted.query('SELECT current_user AS role_name');
      assert.equal(who.rows[0].role_name,'musitu_ci_app');
      await owner.query("INSERT INTO connect_qualification.tenants(tenant_id,status,daily_limit,minute_limit) VALUES('tenant_nodepg','active',1,1)");
      await owner.query("INSERT INTO connect_qualification.credentials(credential_id,tenant_id,token_sha256,status,expires_at,can_plan,can_risk) VALUES('cred_nodepg','tenant_nodepg',$1,'active',clock_timestamp()+INTERVAL '1 day',true,false)",[digest]);
      const env={
        CONNECT_NEON_MODE:'isolated-synthetic-only',
        CONNECT_NEON_DB:{query:({text,values})=>restricted.query(text,values)},
      };
      assert.deepEqual(await submit({...env,CONNECT_NEON_MODE:'disabled'},UUIDS[0]),
        {ok:false,status:503,error:'CUSTOMER_NEON_DISABLED'});
      await assert.rejects(restricted.query('SELECT token_sha256 FROM connect_qualification.credentials'),
        err=>err.code==='42501');
      assert.deepEqual(await submit(env,UUIDS[0],'mining.risk'),
        {ok:false,status:401,error:'UNAUTHORIZED'});
      const first=await submit(env,UUIDS[0]);
      assert.equal(first.ok,true);
      assert.equal(first.principal.tenant_id,'tenant_nodepg');
      assert.equal(first.request_id,UUIDS[0]);
      assert.equal(Object.isFrozen(first.principal),true);
      assert.doesNotMatch(JSON.stringify(first),/mct_|Bearer|token_sha256/);
      assert.deepEqual(await submit(env,UUIDS[0]),
        {ok:false,status:409,error:'REQUEST_ID_CONFLICT'});
      assert.deepEqual(await submit(env,UUIDS[1]),
        {ok:false,status:429,error:'CUSTOMER_QUOTA_EXCEEDED'});
      const counts=async()=>{
        const row=(await owner.query("SELECT (SELECT count(*)::integer FROM connect_qualification.events WHERE tenant_id='tenant_nodepg') AS events,(SELECT used FROM connect_qualification.daily_usage WHERE tenant_id='tenant_nodepg') AS daily,(SELECT used FROM connect_qualification.minute_usage WHERE tenant_id='tenant_nodepg') AS minute")).rows[0];
        return [Number(row.events),Number(row.daily),Number(row.minute)];
      };
      assert.deepEqual(await counts(),[1,1,1]);
      const revoked=await owner.query("UPDATE connect_qualification.credentials SET status='revoked' WHERE tenant_id='tenant_nodepg' AND credential_id='cred_nodepg' RETURNING credential_id");
      assert.equal(revoked.rowCount,1);
      assert.deepEqual(await submit(env,UUIDS[2]),
        {ok:false,status:401,error:'UNAUTHORIZED'});
      assert.deepEqual(await counts(),[1,1,1]);
      await assert.rejects(
        restricted.query("UPDATE connect_qualification.daily_usage SET used=0 WHERE tenant_id='tenant_nodepg'"),
        err=>err.code==='42501');
      console.log('NEON_JS_ADAPTER_TO_REAL_PG=PASS');
      console.log('NEON_REAL_LOGIN_DENIES_DIRECT_TABLE_ACCESS=PASS');
      console.log('NEON_JS_ADMISSION_QUOTA_REPLAY_REVOCATION=PASS');
      console.log('CUSTOMER_RELEASE_AUTHORIZED=false');
    }finally{await restricted.end();}
  }finally{await owner.end();}
});
