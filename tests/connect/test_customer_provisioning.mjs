import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {provisionOfflineTenant,issueOfflineCredential,revokeOfflineCredential,suspendOfflineTenant}
  from '../../connect/customer_provisioning.mjs';
import {reserveConnectCustomerRequest} from '../../connect/customer_admission.mjs';

const SCHEMA=readFileSync(new URL('../../infra/connect_customer_registry.sql',import.meta.url),'utf8');
const NOW=Date.parse('2026-10-22T12:00:00Z');
const EXPIRY='2026-11-01T12:00:00Z';
const UUID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(SCHEMA);
  const db={prepare(sql){return {bind(...args){return {async first(){
    return sqlite.prepare(sql).get(...args)??null;
  }}}}}};
  const env={
    CONNECT_CUSTOMER_PROVISIONING_MODE:'isolated-synthetic-only',
    CONNECT_CUSTOMER_RUNTIME_ENABLED:'true',
    CONNECT_CUSTOMER_DB:db,
  };
  return {sqlite,db,env};
}
const tenant=(env,tenantId='tenant_alpha',dailyLimit=4,minuteLimit=2)=>
  provisionOfflineTenant({env,tenantId,dailyLimit,minuteLimit});
const issue=(env,tenantId='tenant_alpha',scopes=['mining.plan'],expiresAt=EXPIRY)=>
  issueOfflineCredential({env,tenantId,scopes,expiresAt,nowMs:NOW});

test('off by default, even with live customer DB binding, cannot mutate a tenant',async()=>{
  const f=fixture();
  assert.deepEqual(await tenant({...f.env,CONNECT_CUSTOMER_PROVISIONING_MODE:'disabled'}),
    {ok:false,status:503,error:'PROVISIONING_DISABLED'});
  assert.deepEqual(await issue({...f.env,CONNECT_CUSTOMER_PROVISIONING_MODE:'true'}),
    {ok:false,status:503,error:'PROVISIONING_DISABLED'});
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM connect_customer_tenants').get().n,0);
  f.sqlite.close();
});

test('explicit synthetic-mode provisioning persists only validated active tenant and quotas',async()=>{
  const f=fixture();
  const result=await tenant(f.env);
  assert.deepEqual(result,{ok:true,tenant_id:'tenant_alpha'});
  const saved=f.sqlite.prepare('SELECT status,daily_limit,minute_limit FROM connect_customer_tenants WHERE tenant_id=?')
    .get('tenant_alpha');
  assert.equal(saved.status,'active');
  assert.equal(saved.daily_limit,4);
  assert.equal(saved.minute_limit,2);
  f.sqlite.close();
});

test('invalid IDs or quota bounds are rejected before creating any account',async()=>{
  const f=fixture();
  for (const opts of [
    {tenantId:'aa',dailyLimit:4,minuteLimit:2},
    {tenantId:' Tenant',dailyLimit:4,minuteLimit:2},
    {tenantId:'tenant_alpha',dailyLimit:0,minuteLimit:2},
    {tenantId:'tenant_alpha',dailyLimit:4,minuteLimit:1000001},
    {tenantId:'tenant_alpha',dailyLimit:4.5,minuteLimit:2},
  ]){
    assert.deepEqual(await provisionOfflineTenant({env:f.env,...opts}),
      {ok:false,status:400,error:'INVALID_PROVISIONING_INPUT'});
  }
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM connect_customer_tenants').get().n,0);
  f.sqlite.close();
});

test('credential issuance requires a known active tenant and constrained scopes/expiry',async()=>{
  const f=fixture();
  assert.deepEqual(await issue(f.env),
    {ok:false,status:403,error:'TENANT_NOT_ELIGIBLE'});
  await tenant(f.env);
  for(const options of [
    {scopes:['admin.all'],expiresAt:EXPIRY},
    {scopes:['mining.plan','mining.plan'],expiresAt:EXPIRY},
    {scopes:[],expiresAt:EXPIRY},
    {scopes:['mining.plan'],expiresAt:'not-a-date'},
    {scopes:['mining.plan'],expiresAt:'2026-10-22T12:00:00Z'},
    {scopes:['mining.plan'],expiresAt:'2027-10-22T12:00:00Z'},
  ]){
    assert.deepEqual(await issueOfflineCredential({env:f.env,tenantId:'tenant_alpha',nowMs:NOW,...options}),
      {ok:false,status:400,error:'INVALID_PROVISIONING_INPUT'});
  }
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM connect_customer_credentials').get().n,0);
  f.sqlite.close();
});

test('issued tokens use random opaque format and persist only their SHA-256 digest',async()=>{
  const f=fixture();
  await tenant(f.env);
  const first=await issue(f.env);
  const second=await issue(f.env);
  assert.equal(first.ok,true,JSON.stringify({ok:first.ok,error:first.error}));
  assert.equal(second.ok,true);
  assert.match(first.bearer_token,/^mct_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.bearer_token,second.bearer_token);
  assert.notEqual(first.credential_id,second.credential_id);
  assert.equal(first.tenant_id,'tenant_alpha');
  const saved=f.sqlite.prepare('SELECT tenant_id,token_sha256,status,expires_at,can_plan,can_risk FROM connect_customer_credentials WHERE credential_id=?')
    .get(first.credential_id);
  assert.equal(saved.tenant_id,'tenant_alpha');
  assert.match(saved.token_sha256,/^[0-9a-f]{64}$/);
  assert.notEqual(saved.token_sha256,first.bearer_token);
  assert.equal(saved.status,'active');
  assert.equal(saved.expires_at,EXPIRY);
  assert.equal(saved.can_plan,1);assert.equal(saved.can_risk,0);
  assert.equal(JSON.stringify(saved).includes(first.bearer_token),false);
  f.sqlite.close();
});

test('new scoped secret interoperates with transactional admission, then revocation denies it',async()=>{
  const f=fixture();await tenant(f.env);
  const created=await issue(f.env);
  assert.equal(created.ok,true);
  const admitted=await reserveConnectCustomerRequest({
    env:f.env,authorization:'Bearer '+created.bearer_token,scope:'mining.plan',
    nowMs:NOW,requestIdFactory:()=>UUID,
  });
  assert.equal(admitted.ok,true,JSON.stringify(admitted));
  assert.equal(admitted.principal.tenant_id,'tenant_alpha');
  assert.equal(admitted.principal.credential_id,created.credential_id);
  const revoke=await revokeOfflineCredential({env:f.env,tenantId:'tenant_alpha',
    credentialId:created.credential_id});
  assert.deepEqual(revoke,{ok:true,credential_id:created.credential_id,status:'revoked'});
  const next=await reserveConnectCustomerRequest({
    env:f.env,authorization:'Bearer '+created.bearer_token,scope:'mining.plan',
    nowMs:NOW,requestIdFactory:()=> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  });
  assert.deepEqual(next,{ok:false,status:401,error:'UNAUTHORIZED'});
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM connect_customer_usage_events').get().n,1);
  f.sqlite.close();
});

test('separate tenants remain distinct and suspension stops even freshly issued credentials',async()=>{
  const f=fixture();await tenant(f.env,'tenant_alpha');await tenant(f.env,'tenant_beta');
  const alpha=await issue(f.env,'tenant_alpha',['mining.plan']);
  const beta=await issue(f.env,'tenant_beta',['mining.risk']);
  assert.equal(alpha.ok,true);assert.equal(beta.ok,true);
  assert.notEqual(alpha.bearer_token,beta.bearer_token);
  const denied=await reserveConnectCustomerRequest({env:f.env,authorization:'Bearer '+beta.bearer_token,
    scope:'mining.plan',nowMs:NOW,requestIdFactory:()=>UUID});
  assert.deepEqual(denied,{ok:false,status:401,error:'UNAUTHORIZED'});
  const suspended=await suspendOfflineTenant({env:f.env,tenantId:'tenant_beta'});
  assert.deepEqual(suspended,{ok:true,tenant_id:'tenant_beta',status:'suspended'});
  assert.deepEqual(await issue(f.env,'tenant_beta',['mining.risk']),
    {ok:false,status:403,error:'TENANT_NOT_ELIGIBLE'});
  const noAdmission=await reserveConnectCustomerRequest({env:f.env,authorization:'Bearer '+beta.bearer_token,
    scope:'mining.risk',nowMs:NOW,requestIdFactory:()=>UUID});
  assert.deepEqual(noAdmission,{ok:false,status:401,error:'UNAUTHORIZED'});
  f.sqlite.close();
});

test('duplicate tenant and nonexistent revocation fail without changing stored state',async()=>{
  const f=fixture();await tenant(f.env);
  assert.deepEqual(await tenant(f.env),{ok:false,status:409,error:'TENANT_ALREADY_EXISTS'});
  assert.deepEqual(await revokeOfflineCredential({env:f.env,tenantId:'tenant_alpha',
    credentialId:'cred_missing'}),{ok:false,status:404,error:'CREDENTIAL_NOT_FOUND'});
  assert.deepEqual(await suspendOfflineTenant({env:f.env,tenantId:'tenant_missing'}),
    {ok:false,status:404,error:'TENANT_NOT_FOUND'});
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM connect_customer_tenants').get().n,1);
  f.sqlite.close();
});

test('database faults do not leak token, SQL, or driver diagnostics',async()=>{
  const f=fixture();const badEnv={...f.env,CONNECT_CUSTOMER_DB:{prepare(){
    throw new Error('secret query source tenant_alpha SELECT private table');
  }}};
  assert.deepEqual(await tenant(badEnv),{ok:false,status:503,error:'PROVISIONING_UNAVAILABLE'});
  assert.deepEqual(await issue(badEnv),{ok:false,status:503,error:'PROVISIONING_UNAVAILABLE'});
  assert.deepEqual(await revokeOfflineCredential({env:badEnv,tenantId:'tenant_alpha',
    credentialId:'cred_test'}),{ok:false,status:503,error:'PROVISIONING_UNAVAILABLE'});
  f.sqlite.close();
});
