import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {createEncryptedBackup,restoreEncryptedBackup} from '../src/ops/backup.mjs';
import {DurableMailFabric} from '../src/durable/fabric.mjs';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {createSimulatedProvider} from '../src/providers.mjs';
import {verifyProof} from '../src/evidence.mjs';
const fixture=()=>{
 const d=new DatabaseSync(':memory:');d.exec('PRAGMA foreign_keys=ON;');d.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));return d;
};
const msg={tenantId:'client1',from:'alerts@example.org',to:'recipient@example.net',subject:'Recovery proof',text:'Encrypted queued payload',kind:'SERVICE_ALERT',idempotencyKey:'disaster-recovery-001'};
function ctx(){
 const sign=generateKeyPairSync('ed25519');
 return {sign,backupKey:randomBytes(32),encryptionKey:randomBytes(32),privacyKey:randomBytes(32)};
}
function fabric(db,c,provider){
 return new DurableMailFabric({tenantId:'client1',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider,dailySendLimit:100},
  {db:createD1Compat(db),encryptionKey:c.encryptionKey,privacyKey:c.privacyKey,keys:{privateKey:c.sign.privateKey,publicKey:c.sign.publicKey}});
}
function exportArchive(db,c){
 return createEncryptedBackup(db,{tenantId:'client1',backupKey:c.backupKey,envelopeKey:c.encryptionKey,
 privacyKey:c.privacyKey,privateKey:c.sign.privateKey,publicKey:c.sign.publicKey});
}
function restore(db,archive,c){
 return restoreEncryptedBackup(db,archive,{expectedTenantId:'client1',backupKey:c.backupKey,
  envelopeKey:c.encryptionKey,privacyKey:c.privacyKey,trustedPublicKey:c.sign.publicKey});
}
test('real encrypted queued outbox survives offline backup and recovers with authentic evidence and one provider attempt',async()=>{
 const source=fixture(),target=fixture(),c=ctx(),provider=createSimulatedProvider();
 try{
  const prior=fabric(source,c,provider),pending=await prior.enqueue(msg);
  assert.equal(pending.state,'QUEUED');
  const archive=exportArchive(source,c);
  assert.equal(JSON.stringify(archive).includes(msg.text),false);
  const summary=restore(target,archive,c);
  assert.equal(summary.messages,1);
  const after=fabric(target,c,provider),duplicate=await after.enqueue(msg);
  assert.equal(duplicate.messageId,pending.messageId);
  const result=await after.processById(pending.messageId);
  assert.equal(result.state,'ACCEPTED_BY_PROVIDER');
  assert.equal(provider.attempts,1);
  assert.equal(verifyProof(result.proof,{trustedPublicKey:c.sign.publicKey.export({format:'pem',type:'spki'}).toString()}),true);
  const row=target.prepare('SELECT sealed_envelope FROM mail_messages WHERE message_id=?').get(pending.messageId);
  assert.equal(row.sealed_envelope,null);
 }finally{source.close();target.close()}
});
test('provider bounce and recipient suppression remain authoritative after isolated recovery',async()=>{
 const source=fixture(),target=fixture(),c=ctx(),provider=createSimulatedProvider();
 try{
  const mail=fabric(source,c,provider),m=await mail.enqueue(msg),sent=await mail.processById(m.messageId);
  const providerId=sent.proof.events.at(-1).detail.providerId;
  const recorded=await mail.recordProviderEvent({svixId:'valid-feedback-20261010',rawSha256:'a'.repeat(64),type:'email.bounced',providerId});
  assert.equal(recorded.recorded,true);
  const summary=restore(target,exportArchive(source,c),c);
  assert.equal(summary.events,1);assert.equal(summary.suppressions,1);
  const recovered=fabric(target,c,createSimulatedProvider());
  const evidence=await recovered.getProviderEvidence(m.messageId,'client1');
  assert.equal(evidence.providerStatus,'BOUNCED_REPORTED');
  await assert.rejects(()=>recovered.enqueue({...msg,idempotencyKey:'recovered-other-002'}),{code:'RECIPIENT_SUPPRESSED'});
 }finally{source.close();target.close()}
});