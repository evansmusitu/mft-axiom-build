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
const sampleRow={hazard:'Synthetic rockfall',exposure:0.54,severity:8,likelihood:0.4,cost:100,benefit:0.25};
const req=({path='/__offline_connect/plan',token=tokenA,payload,
  headers={},method='POST'}={})=>new Request('https://offline.invalid'+path,{
    method,headers:{'content-type':'application/json',...(token?{'authorization':'Bearer '+token}:{}),...headers},
    ...(method==='POST'?{body:payload ?? JSON.stringify(path.endsWith('/risk') ?
      {run_id:'synthetic-run',rows:[sampleRow]} : {rows:[sampleRow],budget:100})}:{}),
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


test('canary refuses empty Mining rows, unknown body fields, and forged tenant metadata',async()=>{
  const f=fixture({alphaDaily:10,alphaMinute:10});
  try{
    for(const payload of [
      '{"rows":[],"budget":100}',
      JSON.stringify({rows:[sampleRow],budget:100,tenant_id:'tenant_beta'}),
      JSON.stringify({rows:[{...sampleRow,admin:true}],budget:100}),
    ]){
      const result=await inspect(req({payload}),f.env);
      assert.deepEqual(result,{status:400,body:{ok:false,error:'INVALID_MINING_REQUEST'}});
    }
    assert.equal(events(f.sql,'tenant_alpha'),3,'denied valid-identity attempts still reserve quota');
    assert.equal(events(f.sql,'tenant_beta'),0);
  }finally{f.sql.close();}
});

test('canary refuses numeric coercion and invalid paired geospatial metadata',async()=>{
  const f=fixture({alphaDaily:10,alphaMinute:10});
  try{
    for(const invalidRow of [
      {...sampleRow,exposure:'0.54'},
      {...sampleRow,benefit:1.1},
      {...sampleRow,hazard:'  '},
      {...sampleRow,latitude:-17.83},
    ]){
      const output=await inspect(req({payload:JSON.stringify({rows:[invalidRow],budget:100})}),f.env);
      assert.deepEqual(output,{status:400,body:{ok:false,error:'INVALID_MINING_REQUEST'}});
    }
    assert.equal(events(f.sql,'tenant_alpha'),4);
  }finally{f.sql.close();}
});

test('canary enforces one risk row and safe run IDs before accepting customer risk transport',async()=>{
  const f=fixture({alphaDaily:10,alphaMinute:10});
  try{
    const multiple=await inspect(req({path:'/__offline_connect/risk',token:tokenB,payload:JSON.stringify({
      run_id:'synthetic-run',rows:[sampleRow,{...sampleRow,hazard:'Synthetic second'}],
    })}),f.env);
    assert.deepEqual(multiple,{status:400,body:{ok:false,error:'RISK_SINGLE_ROW_REQUIRED'}});
    const forged=await inspect(req({path:'/__offline_connect/risk',token:tokenB,payload:JSON.stringify({
      run_id:'a\nb',rows:[sampleRow],
    })}),f.env);
    assert.deepEqual(forged,{status:400,body:{ok:false,error:'INVALID_MINING_REQUEST'}});
    assert.equal(events(f.sql,'tenant_beta'),2);
  }finally{f.sql.close();}
});

test('offline customer canary rejects impossible calendar timestamps',async()=>{
  const f=fixture({alphaDaily:10,alphaMinute:10});
  try {
    for(const event_time of ['2026-02-29T09:00:00Z','2026-02-30T09:00:00Z','2026-10-22T10:00:00+15:00']){
      const payload=JSON.stringify({rows:[{...sampleRow,event_time}],budget:100});
      assert.equal((await inspect(req({payload}),f.env)).status,400);
    }
    const payload=JSON.stringify({rows:[{...sampleRow,event_time:'2028-02-29T09:00:00+02:00'}],budget:100});
    assert.equal((await inspect(req({payload}),f.env)).status,200);
    assert.equal(events(f.sql,'tenant_alpha'),4);
  } finally { f.sql.close(); }
});

test('valid spatial metadata with timezone and scoped Mining semantics remains accepted',async()=>{
  const f=fixture({alphaDaily:10,alphaMinute:10});
  try{
    const row={...sampleRow,record_id:'synthetic-01',site:'Synth Site',
      latitude:-17.83,longitude:31.05,event_time:'2026-10-22T10:00:00Z'};
    const plan=await inspect(req({payload:JSON.stringify({rows:[row],budget:100})}),f.env);
    assert.equal(plan.status,200,JSON.stringify(plan));
    assert.equal(plan.body.executed,false);
    const risk=await inspect(req({path:'/__offline_connect/risk',token:tokenB,payload:JSON.stringify({
      rows:[row],run_id:'synthetic-qualified-run',
    })}),f.env);
    assert.equal(risk.status,200,JSON.stringify(risk));
    assert.equal(risk.body.executed,false);
    assert.equal(events(f.sql,'tenant_alpha'),1);
    assert.equal(events(f.sql,'tenant_beta'),1);
  }finally{f.sql.close();}
});
