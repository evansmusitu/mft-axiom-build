import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {sealHostedCheckpoint,HOSTED_CHECKPOINT_TABLES} from '../src/postgres/hosted-checkpoint.mjs';
import {openPostgresBackup} from '../src/postgres/encrypted-backup.mjs';

const tenant='986eb904-7296-46a9-9e9b-94074db9b547';
const migrations=readdirSync(new URL('../db/',import.meta.url)).filter(n=>/^\d{3}_.*\.sql$/.test(n)).sort().map(name=>{const sql=readFileSync(new URL('../db/'+name,import.meta.url),'utf8');return{name,sql,sha256:createHash('sha256').update(sql).digest('hex')};});
const fixture=()=>({schemaVersion:16,source:{project:'jolly-scene-02112141',branch:'br-jolly-fire-b4klddds',database:'musitu_whatsapp_phase1'},capturedAt:new Date().toISOString(),postgresVersion:'17.11',relationInventory:HOSTED_CHECKPOINT_TABLES.map(name=>({name})),data:Object.fromEntries(HOSTED_CHECKPOINT_TABLES.map(n=>[n,n==='musitu.tenants'?[{id:tenant,legal_name:'Synthetic checkpoint',status:'ACTIVE'}]:[]])),catalog:[[],[],[],[],[],[]],dependencies:[],roles:[]});
const keys=()=>({backupKey:randomBytes(32),contentEncryptionKey:randomBytes(32),sessionEncryptionKey:randomBytes(32)});

test('hosted checkpoint seals current schema and recovery metadata without exposing keys in its receipt',()=>{
 const snapshot=fixture(),keyring=keys();
 const out=sealHostedCheckpoint({snapshot,migrations,...keyring});
 const opened=openPostgresBackup({encrypted:out.encrypted,backupKey:keyring.backupKey});
 assert.deepEqual(opened.data,snapshot.data);assert.equal(opened.schemaVersion,16);assert.equal(opened.qualificationOnly,false);
 assert.equal(opened.applicationKeys.contentEncryptionKey,keyring.contentEncryptionKey.toString('base64'));
 assert.equal(out.receipt.rows,1);assert.equal(out.receipt.tables,22);assert.equal(out.receipt.sourceCapturedAt,snapshot.capturedAt);
 for(const k of Object.values(keyring))assert.equal(JSON.stringify(out.receipt).includes(k.toString('base64')),false);
 assert.equal(out.encrypted.includes(Buffer.from('Synthetic checkpoint')),false);
});

test('operator export and restore commands deny accidental execution before input or credentials are used',()=>{
 for(const name of ['export-hosted-checkpoint.mjs','run-hosted-recovery-build.mjs']){
  const env={PATH:process.env.PATH,BACKUP_KEY_20261018:'MUST_NEVER_BE_PRINTED'};
  const result=spawnSync(process.execPath,[new URL('../scripts/'+name,import.meta.url).pathname],{env,encoding:'utf8',timeout:5000});
  assert.equal(result.status,78);assert.equal(result.stdout,'');assert.equal(result.stderr.includes(env.BACKUP_KEY_20261018),false);
 }
});

test('restore child rejects remote or ambiguous targets before opening pg or archived data',()=>{
 for(const url of ['postgresql://fixture:private@remote.invalid:5432/postgres','postgresql://fixture:private@localhost:5432/postgres','postgresql://fixture:private@127.0.0.1:5432/not-postgres']){
  const r=spawnSync(process.execPath,[new URL('../scripts/restore-hosted-checkpoint-child.mjs',import.meta.url).pathname],{env:{PATH:process.env.PATH,PG_HOSTED_RECOVERY_CHILD:'YES',PG_ADMIN_URL:url},encoding:'utf8',timeout:5000});
  assert.equal(r.status,78);assert.equal(r.stderr.includes('fixture:private'),false);
 }
});

test('omitted active-session counts remain explicit in the authenticated backup and safe receipt',()=>{
 const snapshot=fixture();snapshot.excludedActiveSessionRows=2;const keyring=keys();
 const out=sealHostedCheckpoint({snapshot,migrations,...keyring});
 assert.equal(openPostgresBackup({encrypted:out.encrypted,backupKey:keyring.backupKey}).excludedActiveSessionRows,2);
 assert.equal(out.receipt.excludedActiveSessionRows,2);assert.equal(out.receipt.activeSessionsCopied,false);
});

test('hosted checkpoint refuses wrong identity, missing inventory and active copied sessions',()=>{
 const keyring=keys();
 for(const change of [
 s=>{s.source.branch='br-other';},
 s=>{s.relationInventory.pop();},
 s=>{delete s.data['musitu.messages'];},
 s=>{s.data['musitu_identity.sessions']=[{revoked:false,expires_at:new Date(Date.now()+60000).toISOString()}];},
 s=>{s.capturedAt='not-a-date';}
 ]){
  const snapshot=fixture();change(snapshot);
  assert.throws(()=>sealHostedCheckpoint({snapshot,migrations,...keyring}),{message:'HOSTED_CHECKPOINT_REJECTED'});
 }
 const snapshot=fixture();snapshot.data['musitu_identity.sessions']=[{revoked:false,expires_at:new Date(Date.now()-60000).toISOString()}];
 assert.ok(sealHostedCheckpoint({snapshot,migrations,...keyring}).encrypted.length>0);
});

test('hosted checkpoint rejects malformed keys and substituted source migrations before producing output',()=>{
 const snapshot=fixture(),keyring=keys();
 for(const name of ['backupKey','contentEncryptionKey','sessionEncryptionKey'])assert.throws(()=>sealHostedCheckpoint({snapshot,migrations,...keyring,[name]:Buffer.alloc(1)}));
 assert.throws(()=>sealHostedCheckpoint({snapshot,migrations:migrations.slice(0,14),...keyring}));
 const altered=migrations.map((m,i)=>i?m:{...m,sql:m.sql+' -- substituted'});
 assert.throws(()=>sealHostedCheckpoint({snapshot,migrations:altered,...keyring}));
});

test('checkpoint schema must match observed function version; legacy schema-15 snapshots retain their source prefix',()=>{
 const snapshot=fixture(),keyring=keys();
 snapshot.schemaVersion=15;
 assert.throws(()=>sealHostedCheckpoint({snapshot,migrations,...keyring}),/HOSTED_CHECKPOINT_SCHEMA_MISMATCH/);
 delete snapshot.schemaVersion;
 const out=sealHostedCheckpoint({snapshot,migrations:migrations.slice(0,15),...keyring});
 assert.equal(openPostgresBackup({encrypted:out.encrypted,backupKey:keyring.backupKey}).schemaVersion,15);
});
