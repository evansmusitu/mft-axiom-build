import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {MmfStagingSqliteDO} from '../src/edge/sqlite-do.mjs';
import ingress from '../src/edge/webhook-private-probe.mjs';
import {runPrivateCrossWorkerFeedbackProbe} from '../src/edge/synthetic-cross-worker.mjs';
const scope='stage-test-scoped-only-capability-0123456789abcd';
const bridge='stage-private-bridge-test-token-0123456789abcde';
const storage='stage-internal-storage-secret-0123456789abcdef';
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 t.after(()=>sqlite.close());
 const sql={exec(s,...p){
  const stmt=sqlite.prepare(s);
  const rows=/^(SELECT|PRAGMA|WITH)/i.test(s.trim())?stmt.all(...p):(stmt.run(...p),[]);
  return{toArray(){return rows}};
 }};
 const key=randomBytes(32),pair=generateKeyPairSync('ed25519');
 const ownerEnv={MMF_TENANT_ID:'stage-tenant',MMF_STAGE_ONLY:'true',MMF_API_ENABLED:'false',
  MMF_REAL_SEND_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false',MMF_STORAGE_RPC_SECRET:storage,
  MMF_FEEDBACK_RPC_SECRET:scope,MMF_FEEDBACK_RPC_ENABLED:'true',
  MMF_STAGE_DATA_KEY_B64:key.toString('base64'),
  MMF_STAGE_CRYPTO_READY:'true',
  MMF_STAGE_SIGNING_PRIVATE_KEY_PEM:pair.privateKey.export({format:'pem',type:'pkcs8'}).toString(),
  MMF_PRIVATE_BRIDGE_TEST_SECRET:bridge};
 const durable=new MmfStagingSqliteDO({storage:{sql}},ownerEnv);
 const ns={idFromName:id=>id,get:()=>({fetch:r=>durable.fetch(r)})};
 const linkedEnv={MMF_STAGE_ONLY:'true',MMF_API_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false',
  MMF_WEBHOOK_ENABLED:'false',MMF_PRIVATE_BRIDGE_TEST_ENABLED:'true',
  MMF_OUTBOX_LINK_ENABLED:'true',MMF_PRIVATE_BRIDGE_TEST_SECRET:bridge,
  MMF_TENANT_ID:'stage-tenant',MMF_OUTBOX_FEEDBACK_SECRET:scope,MMF_OUTBOX:ns,
  MMF_RECEIPTS:{different:'true'}};
 ownerEnv.MMF_PRIVATE_FEEDBACK_INGRESS={fetch:r=>ingress.fetch(r,linkedEnv)};
 return{sqlite,adapter:createD1Compat(sqlite),ownerEnv,linkedEnv};
}
test('two independently bound private Workers correlate and suppress synthetic delivery through owner SQLite',async t=>{
 const f=fixture(t);
 const r=await runPrivateCrossWorkerFeedbackProbe(f.adapter,f.ownerEnv,'probe-linked-feedback-orchestrator-001');
 assert.equal(r.status,'PASS');
 assert.equal(r.crossWorkerServiceBinding,true);
 assert.equal(r.signedEventRecorded,true);
 assert.equal(r.proofSignerIsOwner,true);
 assert.equal(r.recipientSuppressed,true);
 assert.equal(r.providerWasSimulation,true);
 assert.equal(r.realResendWebhookReceived,false);
 assert.equal(r.customerMailSent,false);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_provider_events').get().n,1);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_suppressions').get().n,1);
});
test('fake downstream PASS without actual durable feedback cannot qualify',async t=>{
 const f=fixture(t);
 f.ownerEnv.MMF_PRIVATE_FEEDBACK_INGRESS={fetch:async()=>Response.json({status:'PASS',
  wrongRecipientRejected:true,signedEventRecorded:true,duplicateIdempotent:true})};
 await assert.rejects(()=>runPrivateCrossWorkerFeedbackProbe(f.adapter,f.ownerEnv,
  'probe-linked-feedback-orchestrator-002'),/STAGE_CROSS_WORKER/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_provider_events').get().n,0);
});
test('live-send flag, public API, or absent service capability block the probe before sender stage transaction',async t=>{
 const f=fixture(t);
 for(const overrides of [{MMF_REAL_SEND_ENABLED:'true'},{MMF_API_ENABLED:'true'},
  {MMF_PRIVATE_FEEDBACK_INGRESS:undefined},{MMF_PRIVATE_BRIDGE_TEST_SECRET:'short'}]){
  await assert.rejects(()=>runPrivateCrossWorkerFeedbackProbe(f.adapter,{...f.ownerEnv,...overrides},
    'probe-linked-feedback-orchestrator-003'),/STAGE_CROSS_WORKER/);
 }
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_messages').get().n,0);
});
