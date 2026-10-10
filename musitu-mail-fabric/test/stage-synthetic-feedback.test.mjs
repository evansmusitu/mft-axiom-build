import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {runSyntheticSignedFeedbackProbe} from '../src/edge/synthetic-feedback.mjs';
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
