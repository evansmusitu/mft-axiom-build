import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHmac} from 'node:crypto';
import {PrivateStageStore} from '../src/private-stage/store.mjs';
import {backupEncryptedPrivateStage,restoreEncryptedPrivateStage} from '../src/private-stage/encrypted-recovery.mjs';
const ID=Buffer.alloc(32,129),KEY=Buffer.alloc(32,46),META='stage-secret-v15';
function setup(t){const dir=mkdtempSync(join(tmpdir(),'v15-recovery-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const databasePath=join(dir,'private.sqlite'),encryptedPath=join(dir,'backup.enc'),restoredPath=join(dir,'restored.sqlite');
 const s=new PrivateStageStore(databasePath,{identityKey:ID});t.after(()=>s.close());
 s.seedTenant({tenantId:'tenant-A',legalName:'Example',ownerId:'owner-A',wabaId:'WABA_A',phoneNumberId:'PHONE_A'});
 const payload={object:'whatsapp_business_account',entry:[{id:'WABA_A',changes:[{field:'messages',value:{metadata:{phone_number_id:'PHONE_A'},messages:[{id:'wamid.backup.stop',type:'text',from:'263771112222',text:{body:'STOP'}}]}}]}]};
 const rawBody=Buffer.from(JSON.stringify(payload));
 const [r]=s.ingestSignedWebhook({rawBody,appSecret:META,signature:'sha256='+createHmac('sha256',META).update(rawBody).digest('hex')});
 return {dir,s,databasePath,encryptedPath,restoredPath,conversationId:r.conversationId};
}

test('online backup captures committed WAL rows; encrypted restore preserves opt-out and audit across reopening',async t=>{
 const x=setup(t);const report=await backupEncryptedPrivateStage({databasePath:x.databasePath,encryptedPath:x.encryptedPath,backupKey:KEY});
 assert.equal(report.encrypted,true);
 const blob=readFileSync(x.encryptedPath);
 assert.equal(blob.includes(Buffer.from('SQLite format 3')),false,'archive must not expose plaintext SQLite header');
 assert.equal(blob.includes(Buffer.from('tenant-A')),false,'archive must not contain searchable tenant ids');
 assert.equal(statSync(x.encryptedPath).mode & 0o077,0,'backup readable only by current user');
 const restored=await restoreEncryptedPrivateStage({encryptedPath:x.encryptedPath,databasePath:x.restoredPath,backupKey:KEY});
 assert.equal(restored.restored,true);
 const s=new PrivateStageStore(x.restoredPath,{identityKey:ID});t.after(()=>s.close());
 assert.equal(s.canBotReply('tenant-A',x.conversationId),false);
 assert.equal(s.snapshot('tenant-A','owner-A').inquiries,1);
 assert.equal(s.listActionAudit('tenant-A','owner-A').filter(e=>e.action==='CUSTOMER_OPT_OUT').length,1);
});

test('tampered and wrong-key backups are rejected without creating or overwriting destination',async t=>{
 const x=setup(t);await backupEncryptedPrivateStage({databasePath:x.databasePath,encryptedPath:x.encryptedPath,backupKey:KEY});
 await assert.rejects(restoreEncryptedPrivateStage({encryptedPath:x.encryptedPath,databasePath:x.restoredPath,backupKey:randomBytes(32)}),/BACKUP_INTEGRITY_FAILURE/);
 assert.equal(existsSync(x.restoredPath),false);
 const blob=readFileSync(x.encryptedPath);blob[blob.length-18]^=0xff;writeFileSync(x.encryptedPath,blob);
 await assert.rejects(restoreEncryptedPrivateStage({encryptedPath:x.encryptedPath,databasePath:x.restoredPath,backupKey:KEY}),/BACKUP_INTEGRITY_FAILURE/);
 assert.equal(existsSync(x.restoredPath),false);
});

test('existing target path is never overwritten and source identity remains a separate requirement',async t=>{
 const x=setup(t);await backupEncryptedPrivateStage({databasePath:x.databasePath,encryptedPath:x.encryptedPath,backupKey:KEY});
 await assert.rejects(restoreEncryptedPrivateStage({encryptedPath:x.encryptedPath,databasePath:x.databasePath,backupKey:KEY}),/RESTORE_TARGET_EXISTS/);
 assert.equal(x.s.snapshot('tenant-A','owner-A').inquiries,1);
 await restoreEncryptedPrivateStage({encryptedPath:x.encryptedPath,databasePath:x.restoredPath,backupKey:KEY});
 assert.throws(()=>new PrivateStageStore(x.restoredPath,{identityKey:randomBytes(32)}),/STAGE_IDENTITY_KEY_CHANGED/);
});

test('missing, malformed and truncated archive or key fail closed',async t=>{
 const x=setup(t);
 await assert.rejects(backupEncryptedPrivateStage({databasePath:x.databasePath,encryptedPath:x.encryptedPath,backupKey:Buffer.alloc(16)}),/BACKUP_KEY_REQUIRED/);
 writeFileSync(x.encryptedPath,Buffer.from('not-a-backup'));
 await assert.rejects(restoreEncryptedPrivateStage({encryptedPath:x.encryptedPath,databasePath:x.restoredPath,backupKey:KEY}),/INVALID_BACKUP_FORMAT/);
 assert.equal(existsSync(x.restoredPath),false);
});
