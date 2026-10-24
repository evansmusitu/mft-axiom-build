import test from 'node:test';import assert from 'node:assert/strict';import{randomBytes}from'node:crypto';
import{sealPostgresBackup,openPostgresBackup}from'../src/postgres/encrypted-backup.mjs';
const key=randomBytes(32),data={version:1,source:{project:'jolly-scene-02112141',branch:'br-jolly-fire-b4klddds',database:'musitu_whatsapp_phase1'},migrations:Array.from({length:14},(_,i)=>({name:String(i+1),sql:'synthetic-only'})),data:Object.fromEntries(Array.from({length:22},(_,i)=>['musitu.synthetic_'+String.fromCharCode(97+i),[{synthetic:'private recovery fact'}]])),applicationKeys:{contentEncryptionKey:Buffer.alloc(32,1).toString('base64'),sessionEncryptionKey:Buffer.alloc(32,2).toString('base64')}};
test('PostgreSQL operator envelope preserves data and keyring without plaintext disclosure and uses fresh nonces',()=>{
 const a=sealPostgresBackup({data,backupKey:key}),b=sealPostgresBackup({data,backupKey:key});assert.notDeepEqual(a,b);assert.deepEqual(openPostgresBackup({encrypted:a,backupKey:key}),data);assert.equal(a.includes(Buffer.from('private recovery fact')),false);assert.equal(a.includes(Buffer.from(data.applicationKeys.contentEncryptionKey)),false);
});
test('PostgreSQL operator envelope rejects changed header, nonce, tag, ciphertext, truncation and wrong key',()=>{
 const a=sealPostgresBackup({data,backupKey:key});for(const index of [0,20,32,45,a.length-1]){const b=Buffer.from(a);b[index]^=1;assert.throws(()=>openPostgresBackup({encrypted:b,backupKey:key}),/BACKUP_OPEN_REJECTED/);}
 for(const encrypted of [Buffer.alloc(0),a.subarray(0,a.length-1),Buffer.alloc(8*1024*1024+1)])assert.throws(()=>openPostgresBackup({encrypted,backupKey:key}),/BACKUP_OPEN_REJECTED/);
 assert.throws(()=>openPostgresBackup({encrypted:a,backupKey:randomBytes(32)}),/BACKUP_OPEN_REJECTED/);
});
test('PostgreSQL operator envelope rejects other projects, incomplete keyrings, invalid keys and oversized plaintext',()=>{
 for(const invalid of [{...data,source:{...data.source,project:'production'}},{...data,applicationKeys:{}},{...data,data:{}},{...data,migrations:[]}])assert.throws(()=>sealPostgresBackup({data:invalid,backupKey:key}),/BACKUP_PAYLOAD_REJECTED/);
 assert.throws(()=>sealPostgresBackup({data,backupKey:Buffer.alloc(31)}),/BACKUP_KEY_REQUIRED/);
 assert.throws(()=>sealPostgresBackup({data:{...data,extra:'x'.repeat(8*1024*1024)},backupKey:key}),/BACKUP_TOO_LARGE/);
});
