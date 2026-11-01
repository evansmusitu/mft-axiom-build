import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {reserveNeonSyntheticCustomerRequest as reserve} from '../../connect/customer_neon_admission.mjs';

const token='mct_'+'A'.repeat(43);
const uuid='88888888-8888-4888-8888-888888888888';
const sha=createHash('sha256').update(token).digest('hex');
const invoke=(env,scope='mining.plan',authorization='Bearer '+token)=>
  reserve({env,scope,authorization,requestIdFactory:()=>uuid});
const envFor=(row)=>({CONNECT_NEON_MODE:'isolated-synthetic-only',
  CONNECT_NEON_DB:{async query(query){envFor.lastQuery=query;return {rows:[row]};}}});

test('Neon mode is disabled unless isolated-synthetic-only, no DB call',async()=>{
  let contacted=false;
  const env={CONNECT_NEON_DB:{query(){contacted=true;throw Error('should not execute');}}};
  assert.deepEqual(await invoke(env),{ok:false,status:503,error:'CUSTOMER_NEON_DISABLED'});
  assert.equal(contacted,false);
});

test('synthetic admission uses SQL parameters and authenticated DB-derived tenant',async()=>{
  const env=envFor({accepted:true,code:'ADMITTED',authorized_tenant:'tenant_alpha',daily_used:'1'});
  const result=await invoke(env);
  assert.equal(result.ok,true);
  assert.equal(result.principal.tenant_id,'tenant_alpha');
  assert.equal(result.principal.scope,'mining.plan');
  assert.equal(Object.isFrozen(result.principal),true);
  assert.match(envFor.lastQuery.text,/connect_qualification\.admit\(\$1::text,\$2::text,\$3::uuid\)/);
  assert.deepEqual(envFor.lastQuery.values,[sha,'mining.plan',uuid]);
  assert.doesNotMatch(JSON.stringify(result),/mct_|Bearer|token_sha256/i);
  assert.equal(envFor.lastQuery.text.includes(sha),false);
});

test('scope, token, UUID and missing DB are rejected before query',async()=>{
  let calls=0;
  const db={query(){calls++;throw Error('unexpected');}};
  const env={CONNECT_NEON_MODE:'isolated-synthetic-only',CONNECT_NEON_DB:db};
  assert.equal((await invoke(env,'not.a.scope')).status,403);
  assert.equal((await invoke(env,'mining.plan','Bearer BAD')).status,401);
  assert.equal((await reserve({env,scope:'mining.plan',authorization:'Bearer '+token,requestIdFactory:()=> 'not-uuid'})).status,503);
  assert.equal((await invoke({CONNECT_NEON_MODE:'isolated-synthetic-only'})).status,503);
  assert.equal(calls,0);
});

test('quota, collision and unauthorized outcomes fail closed',async()=>{
  for(const [code,status,tenant] of [
    ['CUSTOMER_QUOTA_EXCEEDED',429,'tenant_alpha'],
    ['CUSTOMER_MINUTE_QUOTA_EXCEEDED',429,'tenant_alpha'],
    ['REQUEST_ID_CONFLICT',409,'tenant_alpha'],
    ['UNAUTHORIZED',401,null],
  ]) {
    const result=await invoke(envFor({accepted:false,code,authorized_tenant:tenant,daily_used:null}));
    assert.equal(result.ok,false);
    assert.equal(result.status,status);
  }
  assert.deepEqual(await invoke(envFor({accepted:false,code:'UNAUTHORIZED',authorized_tenant:'tenant_alpha'})),
    {ok:false,status:503,error:'CUSTOMER_NEON_UNAVAILABLE'});
});

test('ambiguous or malformed server rows cannot mint capabilities',async()=>{
  for(const row of [{accepted:true,code:'OTHER',authorized_tenant:'tenant_alpha',daily_used:1},
    {accepted:true,code:'ADMITTED',authorized_tenant:'tenant_alpha',daily_used:'NaN'},
    {accepted:true,code:'ADMITTED',authorized_tenant:'tenant_alpha',daily_used:0},
    {accepted:true,code:'ADMITTED',authorized_tenant:'TENANT_OTHER',daily_used:1},
    {accepted:'true',code:'ADMITTED',authorized_tenant:'tenant_alpha',daily_used:1},
    {accepted:true,code:'ADMITTED',authorized_tenant:'tenant_alpha',daily_used:Number.MAX_SAFE_INTEGER+1}]) {
    assert.deepEqual(await invoke(envFor(row)),{ok:false,status:503,error:'CUSTOMER_NEON_UNAVAILABLE'});
  }
  assert.deepEqual(await invoke({CONNECT_NEON_MODE:'isolated-synthetic-only',CONNECT_NEON_DB:{query:async()=>({rows:[]})}}),
    {ok:false,status:503,error:'CUSTOMER_NEON_UNAVAILABLE'});
  assert.deepEqual(await invoke({CONNECT_NEON_MODE:'isolated-synthetic-only',CONNECT_NEON_DB:{query:async()=>{throw Error('connection down');}}}),
    {ok:false,status:503,error:'CUSTOMER_NEON_UNAVAILABLE'});
});
