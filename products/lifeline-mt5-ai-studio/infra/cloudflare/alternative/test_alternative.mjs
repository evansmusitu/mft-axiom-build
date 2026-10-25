import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {forwardAlternative,signInternalRequest} from './gateway.mjs';
import privateWorker from './private_worker.mjs';

const TENANT='lifeline_alt_test';
const KEY='THIS_IS_OFFLINE_ONLY_32_BYTE_LONG_HMAC_KEY_FOR_TESTS';
const url='https://owner.example/owner/alternative/status';
function d1(){
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(join(dirname(fileURLToPath(import.meta.url)),'schema.sql'),'utf8'));
  return {db,handle:{prepare(sql){
    const statement=db.prepare(sql);
    return {bind(...params){return {
      async run(){const r=statement.run(...params);return {meta:{changes:Number(r.changes)},success:true};},
      async all(){return {results:statement.all(...params),success:true};}
    };}};
  }}};
}
const statusJson=async r=>({status:r.status,json:await r.json()});
function stage(){
  const {db,handle}=d1();
  const env={STAGE_TENANT:TENANT,SERVICE_HMAC_KEY:KEY,DB:handle};
  let calls=0;
  const service={fetch(req){calls++;return privateWorker.fetch(req,env);}};
  const gateway={LIFELINE_ALT_CUTOVER:'OFFLINE_STAGE_AUTHORIZED',AGENT_TENANT:TENANT,
    LIFELINE_ALT_KEY:KEY,LIFELINE_ALT_SERVICE:service};
  return {db,env,gateway,getCalls:()=>calls};
}

test('no private binding or explicit cutover denies without any upstream call',async()=>{
  const s=stage();
  const disabled={...s.gateway};delete disabled.LIFELINE_ALT_CUTOVER;
  assert.equal((await forwardAlternative(new Request(url),disabled,TENANT)).status,503);
  const missing={...s.gateway};delete missing.LIFELINE_ALT_SERVICE;
  assert.equal((await forwardAlternative(new Request(url),missing,TENANT)).status,503);
  assert.equal(s.getCalls(),0);
});

test('owner-only service binding signs a request to actual SQLite-backed private Worker',async()=>{
  const s=stage();
  const out=await statusJson(await forwardAlternative(new Request(url),s.gateway,TENANT));
  assert.equal(out.status,200);
  assert.equal(out.json.schema,'lifeline.cloudflare_alt_status.v1');
  assert.deepEqual(out.json.jobs,{PENDING:0,CLAIMED:0,COMPLETED:0});
  assert.equal(out.json.trading_enabled,false);
  assert.equal(out.json.native_windows_connected,false);
  assert.equal(out.json.modal_connected,false);
  assert.equal(out.json.neon_connected,false);
  assert.equal(s.getCalls(),1);
});

test('private Worker rejects unauthenticated requests and unsupported routes',async()=>{
  const s=stage();
  const unsigned=new Request('https://internal.invalid/stage/status',
    {method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal((await privateWorker.fetch(unsigned,s.env)).status,401);
  const bad=new Request('https://internal.invalid/stage/trade',
    {method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal((await privateWorker.fetch(bad,s.env)).status,404);
});

test('timestamp, tenant, HMAC and nonce are bound; replay fails closed',async()=>{
  const s=stage();
  const one=await signInternalRequest({path:'/stage/status',body:'{}',tenant:TENANT,key:KEY});
  assert.equal((await privateWorker.fetch(one.clone(),s.env)).status,200);
  assert.equal((await privateWorker.fetch(one.clone(),s.env)).status,401);
  const expired=await signInternalRequest({path:'/stage/status',body:'{}',tenant:TENANT,key:KEY,
    stamp:1,nonce:randomBytes(16).toString('hex')});
  assert.equal((await privateWorker.fetch(expired,s.env)).status,401);
  const cross=await signInternalRequest({path:'/stage/status',body:'{}',tenant:'other_tenant',key:KEY});
  assert.equal((await privateWorker.fetch(cross,s.env)).status,401);
  const wrong=await signInternalRequest({path:'/stage/status',body:'{}',tenant:TENANT,
    key:'DIFFERENT_OFFLINE_ONLY_TEST_SIGNING_KEY_LENGTH_40'});
  assert.equal((await privateWorker.fetch(wrong,s.env)).status,401);
});

test('service failure, missing database and spoofed read results never report connected',async()=>{
  const s=stage();
  const noDB={...s.env};delete noDB.DB;
  const proof=await signInternalRequest({path:'/stage/status',body:'{}',tenant:TENANT,key:KEY});
  assert.equal((await privateWorker.fetch(proof,noDB)).status,503);
  const upstream={...s.gateway,LIFELINE_ALT_SERVICE:{
    fetch:async()=>new Response(JSON.stringify({private_secret:'NEVER_DISCLOSE'}),{status:200,headers:{'content-type':'application/json'}})
  }};
  const out=await statusJson(await forwardAlternative(new Request(url),upstream,TENANT));
  assert.equal(out.status,502);
  assert.equal(JSON.stringify(out.json).includes('NEVER_DISCLOSE'),false);
});


test('D1-exhausted account can offer signed stateless nontrading status without fictitious queue counts',async()=>{
  const s=stage();
  const statelessEnv={STAGE_TENANT:TENANT,SERVICE_HMAC_KEY:KEY,
    LIFELINE_ALT_MODE:'STATELESS_READONLY'};
  let calls=0;
  const opts={...s.gateway,LIFELINE_ALT_MODE:'STATELESS_READONLY',
    LIFELINE_ALT_SERVICE:{fetch(req){calls++;return privateWorker.fetch(req,statelessEnv);}}};
  const response=await statusJson(await forwardAlternative(new Request(url),opts,TENANT));
  assert.equal(response.status,200);
  assert.deepEqual(response.json,{
    schema:'lifeline.cloudflare_alt_stateless.v1',
    status_origin:'static_source_only',
    jobs:null,job_counts_available:false,
    d1_connected:false,trading_enabled:false,
    native_windows_connected:false,modal_connected:false,neon_connected:false
  });
  assert.equal(calls,1);
  assert.equal(s.getCalls(),0,'never contact original D1-backed fixture');
});

test('stateless alternative rejects missing explicit mode, wrong HMAC and unauthenticated requests',async()=>{
  const env={STAGE_TENANT:TENANT,SERVICE_HMAC_KEY:KEY,LIFELINE_ALT_MODE:'STATELESS_READONLY'};
  const unsigned=new Request('https://lifeline-service.invalid/stage/status',{
    method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal((await privateWorker.fetch(unsigned,env)).status,401);
  const mismatched=await signInternalRequest({path:'/stage/status',body:'{}',tenant:TENANT,
    key:'WRONG_FAKE_OFFLINE_KEY_LONG_ENOUGH_TO_VALIDATE'});
  assert.equal((await privateWorker.fetch(mismatched,env)).status,401);
  const signed=await signInternalRequest({path:'/stage/status',body:'{}',tenant:TENANT,key:KEY});
  const missing={...env};delete missing.LIFELINE_ALT_MODE;
  assert.equal((await privateWorker.fetch(signed.clone(),missing)).status,503);
  const valid=await privateWorker.fetch(signed.clone(),env);
  assert.equal(valid.status,200);
  // An idempotent status-only response cannot claim durable nonce replay prevention.
  assert.equal((await privateWorker.fetch(signed.clone(),env)).status,200);
});

test('stateless gateway refuses downstream simulated DB or connected-asset claims',async()=>{
  const forged={
    schema:'lifeline.cloudflare_alt_stateless.v1',status_origin:'static_source_only',
    jobs:null,job_counts_available:false,d1_connected:true,trading_enabled:false,
    native_windows_connected:false,modal_connected:false,neon_connected:false,
    cloudflare_secret:'DO_NOT_DISCLOSE'
  };
  const s=stage();
  const gateway={...s.gateway,LIFELINE_ALT_MODE:'STATELESS_READONLY',
    LIFELINE_ALT_SERVICE:{fetch:async()=>new Response(JSON.stringify(forged),
      {status:200,headers:{'content-type':'application/json'}})}};
  const result=await forwardAlternative(new Request(url),gateway,TENANT);
  assert.equal(result.status,502);
  assert.equal((await result.text()).includes('DO_NOT_DISCLOSE'),false);
});
