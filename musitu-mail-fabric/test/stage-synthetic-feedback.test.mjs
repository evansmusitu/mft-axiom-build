import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {runSyntheticSignedFeedbackProbe,runSyntheticEarlyFeedbackProbe} from '../src/edge/synthetic-feedback.mjs';
import {runSyntheticTransactionProbe,syntheticStageRecipient} from '../src/edge/synthetic-transaction.mjs';
function fixture(t){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 t.after(()=>db.close());
 const {privateKey}=generateKeyPairSync('ed25519');
 const env={MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_API_ENABLED:'false',
  MMF_WEBHOOK_ENABLED:'false',MMF_STAGE_CRYPTO_READY:'true',
  MMF_STAGE_DATA_KEY_B64:randomBytes(32).toString('base64'),
  MMF_STAGE_SIGNING_PRIVATE_KEY_PEM:privateKey.export({format:'pem',type:'pkcs8'}).toString()};
 return {db,adapter:createD1Compat(db),env};
}
test('synthetic Resend-format feedback exercises encrypted real outbox, signed recipient match, replay, durable suppression and signed evidence',async t=>{
 const f=fixture(t);
 const result=await runSyntheticSignedFeedbackProbe(f.adapter,f.env,'probe-stage-feedback-20261010');
 assert.equal(result.status,'PASS');
 for(const flag of ['providerWasSimulation','syntheticallySigned','recipientMismatchRejected',
  'invalidFeedbackNotPersisted','exactReplayIdempotent','singleProviderEventPersisted',
  'bounceSuppressionDurable','laterMessageBlocked','originalReceiptSigned'])assert.equal(result[flag],true,flag);
 assert.equal(result.customerMailSent,false);assert.equal(result.networkProviderCalls,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_messages').get().n,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_suppressions').get().n,1);
});
test('synthetic provider feedback cannot run with public route, real mail, or webhook enabled',async t=>{
 const f=fixture(t);
 for(const flags of [{MMF_REAL_SEND_ENABLED:'true'},{MMF_API_ENABLED:'true'},{MMF_WEBHOOK_ENABLED:'true'}])
  await assert.rejects(()=>runSyntheticSignedFeedbackProbe(f.adapter,{...f.env,...flags},'probe-fb-denied-20261010'),/STAGING_ONLY/);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_messages').get().n,0);
});

test('signed early delivery feedback is retryable until durable provider acceptance, then idempotently reconciled',async t=>{
 const f=fixture(t);
 const result=await runSyntheticEarlyFeedbackProbe(f.adapter,f.env,'probe-early-signed-20261010');
 assert.equal(result.status,'PASS');
 for(const flag of ['earlyWebhookRetryable','unmatchedEventNeverAcknowledged','sameSignatureReplayed',
  'eventRecordedAfterAcceptance','exactReplayIdempotent','signatureEvidenceVerified'])
   assert.equal(result[flag],true,flag);
 assert.equal(result.providerWasSimulation,true);
 assert.equal(result.customerMailSent,false);
 assert.equal(result.realResendWebhookReceived,false);
 assert.equal(result.networkProviderCalls,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_messages').get().n,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,1);
});

test('a synthetic bounce cannot suppress another independent test probe on shared durable storage',async t=>{
 const f=fixture(t);
 const first='probe-bounce-isolation-one-20261010',second='probe-bounce-isolation-two-20261010';
 assert.notEqual(syntheticStageRecipient(first),syntheticStageRecipient(second));
 const a=await runSyntheticSignedFeedbackProbe(f.adapter,f.env,first);
 assert.equal(a.bounceSuppressionDurable,true);
 const b=await runSyntheticTransactionProbe(f.adapter,f.env,second);
 assert.equal(b.state,'ACCEPTED_BY_PROVIDER');
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_messages').get().n,2);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_suppressions').get().n,1);
});
test('a later signed early-event race still passes after a different probe has produced a bounce',async t=>{
 const f=fixture(t);
 await runSyntheticSignedFeedbackProbe(f.adapter,f.env,'probe-previous-bounce-20261010');
 const result=await runSyntheticEarlyFeedbackProbe(f.adapter,f.env,'probe-new-early-after-20261010');
 assert.equal(result.status,'PASS');
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_messages').get().n,2);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,2);
});
