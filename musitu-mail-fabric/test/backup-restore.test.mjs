import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {createEncryptedBackup,restoreEncryptedBackup,verifyEncryptedBackup} from '../src/ops/backup.mjs';
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys = ON;');
 db.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 return db;
}
const keys=()=>generateKeyPairSync('ed25519');
function context(){
 const signing=keys(),backupKey=randomBytes(32),envelopeKey=randomBytes(32),privacyKey=randomBytes(32);
 return {signing,backupKey,envelopeKey,privacyKey,
  exportOpts:{tenantId:'client1',backupKey,envelopeKey,privacyKey,privateKey:signing.privateKey,publicKey:signing.publicKey},
  restoreOpts:{expectedTenantId:'client1',backupKey,envelopeKey,privacyKey,trustedPublicKey:signing.publicKey}};
}
function populate(db,tenant='client1',id='message-one',state='QUEUED'){
 const events=JSON.stringify([{event:'POLICY_APPROVED',messageId:id}]);
 db.prepare('INSERT INTO mail_messages(message_id,tenant_id,idempotency_key,request_hash,recipient_hmac,state,sealed_envelope,events_json,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run(id,tenant,'idempotency-'+id,'hash-'+id,'opaque-'+id,state,state==='QUEUED'?'v1.example.encrypted':null,events,1000,1000);
 db.prepare('INSERT INTO mail_suppressions(tenant_id,recipient_hmac,created_ms) VALUES(?,?,?)')
  .run(tenant,'opaque-suppression-'+id,1001);
 db.prepare('INSERT INTO mail_sender_domains(tenant_id,domain,challenge_sha256,challenge_expires_ms,verified_until_ms,status,updated_ms) VALUES(?,?,?,?,?,?,?)')
  .run(tenant,tenant+'.example.org','opaque-challenge',2000,2500,'VERIFIED',1100);
}
test('encrypted backup restores ONLY authorized tenant into an empty SQLite database',()=>{
 const source=fixture(),target=fixture(),ctx=context();
 try{
  populate(source);populate(source,'client2','message-two');
  const archive=createEncryptedBackup(source,ctx.exportOpts);
  assert.equal(verifyEncryptedBackup(archive,{backupKey:ctx.backupKey,trustedPublicKey:ctx.signing.publicKey}),true);
  const serialized=JSON.stringify(archive);
  assert.equal(serialized.includes('opaque-suppression-message-one'),false);
  assert.equal(serialized.includes('v1.example.encrypted'),false);
  assert.equal(serialized.includes('client2'),false);
  const out=restoreEncryptedBackup(target,archive,ctx.restoreOpts);
  assert.equal(out.messages,1);assert.equal(out.suppressions,1);assert.equal(out.domains,1);
  assert.equal(target.prepare('SELECT state FROM mail_messages WHERE tenant_id=?').get('client1').state,'QUEUED');
  assert.equal(target.prepare('SELECT COUNT(*) n FROM mail_messages WHERE tenant_id=?').get('client2').n,0);
 }finally{source.close();target.close()}
});
test('tampered backup and untrusted signing keys cannot be restored',()=>{
 const source=fixture(),ctx=context();try{
 populate(source);const backup=createEncryptedBackup(source,ctx.exportOpts);
 const tampered=structuredClone(backup);tampered.ciphertext=tampered.ciphertext.slice(0,-2)+'AA';
 assert.equal(verifyEncryptedBackup(tampered,{backupKey:ctx.backupKey,trustedPublicKey:ctx.signing.publicKey}),false);
 const target=fixture();try{
  assert.throws(()=>restoreEncryptedBackup(target,tampered,ctx.restoreOpts));
  assert.throws(()=>restoreEncryptedBackup(target,backup,{...ctx.restoreOpts,trustedPublicKey:keys().publicKey}));
  assert.equal(target.prepare('SELECT COUNT(*) n FROM mail_messages').get().n,0);
 }finally{target.close()}
 }finally{source.close()}
});
test('wrong recovery secrets, tenant, or nonempty destination fail closed',()=>{
 const source=fixture(),target=fixture(),ctx=context();try{
  populate(source);populate(target,'client1','existing');
  const archive=createEncryptedBackup(source,ctx.exportOpts);
  for(const overrides of [{backupKey:randomBytes(32)},{privacyKey:randomBytes(32)},{envelopeKey:randomBytes(32)},{expectedTenantId:'client2'}])
   assert.throws(()=>restoreEncryptedBackup(target,archive,{...ctx.restoreOpts,...overrides}));
  assert.throws(()=>restoreEncryptedBackup(target,archive,ctx.restoreOpts),/TARGET_NOT_EMPTY/);
  assert.equal(target.prepare('SELECT COUNT(*) n FROM mail_messages').get().n,1);
 }finally{source.close();target.close()}
});
test('failed restore insert rolls back every table',()=>{
 const source=fixture(),target=fixture(),ctx=context();try{
  populate(source);const archive=createEncryptedBackup(source,ctx.exportOpts);
  target.exec("CREATE TRIGGER reject_recovery BEFORE INSERT ON mail_sender_domains BEGIN SELECT RAISE(ABORT,'injected_restore_failure'); END");
  assert.throws(()=>restoreEncryptedBackup(target,archive,ctx.restoreOpts));
  for(const table of ['mail_messages','mail_suppressions','mail_sender_domains','mail_provider_events'])
   assert.equal(target.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table+' must roll back');
 }finally{source.close();target.close()}
});
test('backup rejects missing trust anchor or recovery credentials',()=>{
 const db=fixture(),ctx=context();try{
  populate(db);const archive=createEncryptedBackup(db,ctx.exportOpts);
  assert.equal(verifyEncryptedBackup(archive,{backupKey:ctx.backupKey}),false);
  const target=fixture();try{assert.throws(()=>restoreEncryptedBackup(target,archive,{...ctx.restoreOpts,privacyKey:undefined}));}finally{target.close()}
  assert.throws(()=>createEncryptedBackup(db,{...ctx.exportOpts,backupKey:randomBytes(8)}));
 }finally{db.close()}
});
test('in-flight SENDING transaction is not restored as freshly QUEUED',()=>{
 const source=fixture(),target=fixture(),ctx=context();
 try{
  populate(source,'client1','ambiguous-claimed','SENDING');
  const archive=createEncryptedBackup(source,ctx.exportOpts);
  restoreEncryptedBackup(target,archive,ctx.restoreOpts);
  assert.equal(target.prepare('SELECT state FROM mail_messages').get().state,'SENDING');
  assert.equal(target.prepare("SELECT COUNT(*) n FROM mail_messages WHERE state='QUEUED'").get().n,0);
 }finally{source.close();target.close()}
});