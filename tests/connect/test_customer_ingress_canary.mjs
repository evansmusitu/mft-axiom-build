import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {inspectIsolatedCustomerIngress} from '../../connect/customer_ingress_canary.mjs';

const SCHEMA=readFileSync(new URL('../../infra/connect_customer_registry.sql',import.meta.url),'utf8');
const nowMs=Date.parse('2026-10-22T12:00:00Z');
const tokenA='mct_'+'A'.repeat(43);
const tokenB='mct_'+'B'.repeat(43);
const sha=value=>createHash('sha256').update(value).digest('hex');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
let index=0;

function fixture({alphaDaily=2,alphaMinute=2}={}){
  const sql=new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(SCHEMA);
  for(const tenant of ['tenant_alpha','tenant_beta']){
    sql.prepare('INSERT INTO connect_customer_tenants(tenant_id,status,daily_limit,minute_limit) VALUES(?,?,?,?)')
      .run(tenant,'active',tenant==='tenant_alpha'?alphaDaily:2,tenant==='tenant_alpha'?alphaMinute:2);
  }
  const insert=sql.prepare('INSERT INTO connect_customer_credentials(credential_id,tenant_id,token_sha256,status,expires_at,can_plan,can_risk) VALUES(?,?,?,?,?,?,?)');
  insert.run('cred_alpha','tenant_alpha',sha(tokenA),'active','2030-01-01T00:00:00Z',1,0);
  insert.run('cred_beta','tenant_beta',sha(tokenB),'active','2030-01-01T00:00:00Z',0,1);
  const db={prepare(statement){return {bind(...args){return {async first(){
    return sql.prepare(statement).get(...args)??null;
  }}}}}};
  return {sql,env:{
    CONNECT_CUSTOMER_CANARY_ENABLED:'true',
    CONNECT_CUSTOMER_RUNTIME_ENABLED:'true',
    CONNECT_CUSTOMER_DB:db,
  }};
}
const req=({path='/__offline_connect/plan',token=tokenA,payload='{"rows":[]}',
  headers={},method='POST'}={})=>new Request('https://offline.invalid'+path,{
    method,headers:{'content-type':'application/json',...(token?{'authorization':'Bearer '+token}:{}),...headers},
    ...(method==='POST'?{body:payload}:{}),
  });
async function inspect(request,env){
  const number=++index;
  const response=await inspectIsolatedCustomerIngress(request,env,{
    nowMs,requestIdFactory:()=>uuid(number),
  });
  return {status:response.status, body:await response.json()};
}
function events(sql,tenant){
  return sql.prepare('SELECT COUNT(*) AS n FROM connect_customer_usage_events WHERE tenant_id=?').get(tenant).n;
}

test('no canary flag fails closed without using a valid customer credential',async()=>{
  const f=fixture();
  const result=await inspect(req(),{...f.env,CONNECT_CUSTOMER_CANARY_ENABLED:'false'});
  assert.deepEqual(result,{status:503,body:{ok:false,error:'CUSTOMER_CANARY_DISABLED'}});
  assert.equal(events(f.sql,'tenant_alpha'),0);
  f.sql.close();
});

test('valid authenticated ingress checks payload, records quota, but never executes a mining calculation',async()=>{
  const f=fixture();
  const out=await inspect(req(),f.env);
  assert.equal(out.status,200);
  assert.equal(out.body.ok,true);
  assert.equal(out.body.mode,'NONPRODUCTION_INGRESS_CHECK_ONLY');
  assert.equal(out.body.executed,false);
  assert.match(out.body.request_id,/^[0-9a-f-]{36}$/);
  assert.equal('tenant_id' in out.body,false);
  assert.equal('body' in out.body,false);
  assert.equal(events(f.sql,'tenant_alpha'),1);
  f.sql.close();
});

test('route-selected scopes admit distinct tenants, deny forged scope and unknown routes',async()=>{
  const f=fixture();
  assert.equal((await inspect(req({path:'/__offline_connect/risk',token:tokenB}),f.env)).status,200);
  assert.deepEqual(await inspect(req({path:'/__offline_connect/risk',token:tokenA}),f.env),
    {status:401,body:{ok:false,error:'UNAUTHORIZED'}});
  assert.deepEqual(await inspect(req({path:'/not-a-customer-endpoint'}),f.env),
    {status:404,body:{ok:false,error:'NOT_FOUND'}});
  assert.equal(events(f.sql,'tenant_alpha'),0);
  assert.equal(events(f.sql,'tenant_beta'),1);
  f.sql.close();
});

test('missing customer auth is denied before parsing an oversized body or reserving quota',async()=>{
  const f=fixture();
  const result=await inspect(req({token:null,payload:'{"x":"'+ 'x'.repeat(70000)+'"}'}),f.env);
  assert.deepEqual(result,{status:401,body:{ok:false,error:'UNAUTHORIZED'}});
  assert.equal(events(f.sql,'tenant_alpha'),0);
  f.sql.close();
});

test('after authentication, duplicate JSON keys and oversized body fail without executing upstream',async()=>{
  // Keep the daily limit above the minute limit so this case tests the
  // minute-specific denial instead of the earlier daily-quota trigger.
  const f=fixture({alphaDaily:5});
  const forged=await inspect(req({payload:'{"tenant_id":"alpha","tenant_id":"beta"}'}),f.env);
  assert.deepEqual(forged,{status:400,body:{ok:false,error:'DUPLICATE_JSON_KEY'}});
  const huge=await inspect(req({payload:'{"x":"'+ 'x'.repeat(70000)+'"}'}),f.env);
  assert.deepEqual(huge,{status:413,body:{ok:false,error:'PAYLOAD_TOO_LARGE'}});
  assert.equal(events(f.sql,'tenant_alpha'),2);
  const blocked=await inspect(req(),f.env);
  assert.deepEqual(blocked,{status:429,body:{ok:false,error:'CUSTOMER_MINUTE_QUOTA_EXCEEDED'}});
  assert.equal(events(f.sql,'tenant_alpha'),2);
  f.sql.close();
});

test('revoking the credential prevents further ingestion and does not consume tenant quota',async()=>{
  const f=fixture();
  f.sql.prepare('UPDATE connect_customer_credentials SET status=? WHERE credential_id=?')
    .run('revoked','cred_alpha');
  assert.deepEqual(await inspect(req(),f.env),{status:401,body:{ok:false,error:'UNAUTHORIZED'}});
  assert.equal(events(f.sql,'tenant_alpha'),0);
  f.sql.close();
});
