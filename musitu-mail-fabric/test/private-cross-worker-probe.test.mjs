import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {MmfStagingSqliteDO} from '../src/edge/sqlite-do.mjs';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {createSyntheticStageFabric,syntheticStageRecipient} from '../src/edge/synthetic-transaction.mjs';
import bridge from '../src/edge/webhook-private-probe.mjs';
const token='private-probe-separate-capability-0123456789abcdef';
const rpc='scoped-private-feedback-0123456789abcdef-000';
const storage='general-sqlite-rpc-0123456789abcdef-0000000';
const probe='probe-linked-remote-test-20261010';
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const schema=readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8');sqlite.exec(schema);
 const ownerSql={exec(stmt,...params){
  const x=sqlite.prepare(stmt);
  const rows=/^(SELECT|PRAGMA|WITH)/i.test(stmt.trim())?x.all(...params):(x.run(...params),[]);
  return {toArray:()=>rows};
 }};
 const pair=generateKeyPairSync('ed25519'),key=randomBytes(32);
 const ownerEnv={MMF_STORAGE_RPC_SECRET:storage,MMF_FEEDBACK_RPC_ENABLED:'true',
  MMF_FEEDBACK_RPC_SECRET:rpc,MMF_TENANT_ID:'stage-tenant',MMF_STAGE_ONLY:'true',
  MMF_STAGE_DATA_KEY_B64:key.toString('base64'),
  MMF_API_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false'};
 const obj=new MmfStagingSqliteDO({storage:{sql:ownerSql}},ownerEnv);
 const ns={idFromName:n=>n,get:()=>({fetch:req=>obj.fetch(req)})};
 const senderEnv={...ownerEnv,MMF_STAGE_CRYPTO_READY:'true',
  MMF_STAGE_SIGNING_PRIVATE_KEY_PEM:pair.privateKey.export({format:'pem',type:'pkcs8'}).toString()};
 const ingressEnv={MMF_OUTBOX:ns,MMF_TENANT_ID:'stage-tenant',MMF_OUTBOX_FEEDBACK_SECRET:rpc,
  MMF_PRIVATE_BRIDGE_TEST_SECRET:token,MMF_PRIVATE_BRIDGE_TEST_ENABLED:'true',
  MMF_OUTBOX_LINK_ENABLED:'true',MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',
  MMF_API_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false'};
 return{sqlite,ns,ingressEnv,senderEnv};
}
test('a private service-bound webhook Worker reconciles signed synthetic bounce without sender crypto keys',async t=>{
 const f=fixture(t);
 const stage=createSyntheticStageFabric(createD1Compat(f.sqlite),f.senderEnv,probe);
 const msg=await stage.fabric.enqueue({tenantId:'stage-tenant',from:'synthetic@example.org',
  to:syntheticStageRecipient(probe),subject:'Private',text:'No customer sending',
  kind:'SERVICE_ALERT',idempotencyKey:probe});
 assert.equal((await stage.fabric.processById(msg.messageId)).state,'ACCEPTED_BY_PROVIDER');
 assert.equal(f.ingressEnv.MMF_PRIVACY_KEY_B64,undefined);
 assert.equal(f.ingressEnv.MMF_SIGNING_PRIVATE_KEY_PEM,undefined);
 const body=JSON.stringify({probeId:probe});
 const req=(auth=token)=>new Request('https://private.invalid/__mmf_stage/signed-feedback',{
  method:'POST',headers:{'content-type':'application/json','x-mmf-stage-probe':auth},body});
 const response=await bridge.fetch(req(),f.ingressEnv);
 assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
 const data=await response.json();
 assert.equal(data.status,'PASS');assert.equal(data.wrongRecipientRejected,true);
 assert.equal(data.signedEventRecorded,true);assert.equal(data.duplicateIdempotent,true);
 assert.equal(data.customerMailSent,false);assert.equal(data.realProviderEventReceived,false);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,1);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM mail_suppressions').get().n,1);
});
test('service-only proof denies unsigned calls and drifted production flags before any SQL',async t=>{
 const f=fixture(t);
 const request=(key)=>new Request('https://private.invalid/__mmf_stage/signed-feedback',{
  method:'POST',headers:{'content-type':'application/json',...(key?{'x-mmf-stage-probe':key}:{})},
  body:JSON.stringify({probeId:probe})});
 assert.equal((await bridge.fetch(request(),f.ingressEnv)).status,401);
 assert.equal((await bridge.fetch(request('wrong'),f.ingressEnv)).status,401);
 for(const flags of [{MMF_REAL_SEND_ENABLED:'true'},{MMF_WEBHOOK_ENABLED:'true'},
  {MMF_OUTBOX_LINK_ENABLED:'false'},{MMF_PRIVATE_BRIDGE_TEST_ENABLED:'false'}])
  assert.notEqual((await bridge.fetch(request(token),{...f.ingressEnv,...flags})).status,200);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,0);
});
test('a private probe cannot spoof a production ID or choose another tenant',async t=>{
 const f=fixture(t);
 for(const probeId of ['client1','../../other','',null]){
  const response=await bridge.fetch(new Request('https://private.invalid/__mmf_stage/signed-feedback',{
    method:'POST',headers:{'content-type':'application/json','x-mmf-stage-probe':token},
    body:JSON.stringify({probeId})}),f.ingressEnv);
  assert.notEqual(response.status,200);
 }
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,0);
});
