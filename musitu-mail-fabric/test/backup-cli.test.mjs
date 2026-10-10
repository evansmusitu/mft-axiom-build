import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
const CLI=new URL('../src/ops/backup-cli.mjs',import.meta.url).pathname;
function stage(t){
 const dir=mkdtempSync(join(tmpdir(),'mmf-dr-cli-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const db=join(dir,'source.sqlite'),d=new DatabaseSync(db);
 d.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 d.prepare('INSERT INTO mail_suppressions(tenant_id,recipient_hmac,created_ms) VALUES(?,?,?)').run('client1','opaque-recipient',12345);
 d.close();
 const pair=generateKeyPairSync('ed25519');
 const privatePem=join(dir,'private.pem'),publicPem=join(dir,'trusted.pem');
 writeFileSync(privatePem,pair.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
 writeFileSync(publicPem,pair.publicKey.export({format:'pem',type:'spki'}),{mode:0o600});
 const env={...process.env,MMF_BACKUP_OFFLINE_ACK:'I_ACKNOWLEDGE_OFFLINE_RECOVERY',
 MMF_BACKUP_KEY_B64:randomBytes(32).toString('base64'),
 MMF_ENCRYPTION_KEY_B64:randomBytes(32).toString('base64'),
 MMF_PRIVACY_KEY_B64:randomBytes(32).toString('base64')};
 return {dir,db,privatePem,publicPem,env,archive:join(dir,'encrypted.mmf.json'),restored:join(dir,'restored.sqlite')};
}
function exec(args,env){return execFileSync(process.execPath,[CLI,...args],{env,encoding:'utf8',timeout:10000});}
test('offline backup CLI safely exports, independently verifies and restores new SQLite database',t=>{
 const s=stage(t);
 const exported=JSON.parse(exec(['export',s.db,'client1',s.archive,s.privatePem,s.publicPem],s.env));
 assert.equal(exported.status,'ENCRYPTED_BACKUP_WRITTEN');
 assert.equal(existsSync(s.archive),true);
 assert.equal(statSync(s.archive).mode&0o077,0);
 assert.equal(readFileSync(s.archive,'utf8').includes('opaque-recipient'),false);
 const verified=JSON.parse(exec(['verify',s.archive,s.publicPem],s.env));
 assert.equal(verified.status,'BACKUP_VERIFIED');
 const restored=JSON.parse(exec(['restore',s.archive,'client1',s.restored,s.publicPem],s.env));
 assert.equal(restored.status,'OFFLINE_RESTORE_VERIFIED');
 const d=new DatabaseSync(s.restored);
 assert.equal(d.prepare('SELECT recipient_hmac FROM mail_suppressions').get().recipient_hmac,'opaque-recipient');
 d.close();
});
test('offline CLI refuses missing explicit operator acknowledgement',t=>{
 const s=stage(t),env={...s.env};delete env.MMF_BACKUP_OFFLINE_ACK;
 const fail=spawnSync(process.execPath,[CLI,'export',s.db,'client1',s.archive,s.privatePem,s.publicPem],{env,encoding:'utf8'});
 assert.notEqual(fail.status,0);assert.equal(existsSync(s.archive),false);
 assert.equal((fail.stderr||'').includes(s.env.MMF_BACKUP_KEY_B64),false);
});
test('offline CLI refuses overwriting an existing backup or recovery target',t=>{
 const s=stage(t);
 exec(['export',s.db,'client1',s.archive,s.privatePem,s.publicPem],s.env);
 assert.throws(()=>exec(['export',s.db,'client1',s.archive,s.privatePem,s.publicPem],s.env));
 writeFileSync(s.restored,'keep-existing');
 assert.throws(()=>exec(['restore',s.archive,'client1',s.restored,s.publicPem],s.env));
 assert.equal(readFileSync(s.restored,'utf8'),'keep-existing');
});
test('verification requires an externally trusted key and matching backup secret',t=>{
 const s=stage(t);
 exec(['export',s.db,'client1',s.archive,s.privatePem,s.publicPem],s.env);
 const wrong={...s.env,MMF_BACKUP_KEY_B64:randomBytes(32).toString('base64')};
 const result=spawnSync(process.execPath,[CLI,'verify',s.archive,s.publicPem],{env:wrong,encoding:'utf8'});
 assert.notEqual(result.status,0);
 const noack=spawnSync(process.execPath,[CLI,'verify',s.archive,s.publicPem],{env:{},encoding:'utf8'});
 assert.notEqual(noack.status,0);
});