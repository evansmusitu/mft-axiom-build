import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {decrypt} from '../existing-d1-recovery/customer_frontier/recovery/decrypt_restore_existing_d1.mjs';
import {encryptBackup,sha,DATABASE,CATALOG_SHA,RECIPIENT_SHA} from '../existing-d1-recovery/customer_frontier/recovery/export_existing_d1_backup.mjs';
const pair=generateKeyPairSync('rsa',{modulusLength:4096,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const sql=Buffer.from("CREATE TABLE synthetic(v TEXT); INSERT INTO synthetic VALUES('PRIVATE_VALUE_SENTINEL');");
const header={schema:'musitu.axiom.d1_logical_export.v1',database_id:DATABASE,catalog_sha256:CATALOG_SHA,recipient_public_sha256:sha(pair.publicKey),source_sha:'a'.repeat(40),created_at:'2026-11-06T00:00:00.000Z',sql_bytes:sql.length,sql_sha256:sha(sql)};
const fixture=(h=header)=>{const envelope=encryptBackup(sql,pair.publicKey,h);return {envelope,options:{expectedEnvelopeSha:sha(envelope),expectedSourceSha:header.source_sha,expectedRecipientSha:header.recipient_public_sha256}};};
test('trusted outer hash and source are mandatory independently of valid authenticated envelope',()=>{
 const {envelope,options}=fixture();for(const override of [{expectedEnvelopeSha:undefined},{expectedEnvelopeSha:'A'.repeat(64)},{expectedSourceSha:undefined},{expectedSourceSha:'g'.repeat(40)}])assert.throws(()=>decrypt(envelope,pair.privateKey,{...options,...override}));
});
test('outer schema algorithm unknownfields and noncanonical base64 are rejected with matching outer hash',()=>{
 for(const mutate of [o=>o.schema='other',o=>o.algorithm='AES',o=>o.extra='PRIVATE_FIELD',o=>o.nonce_b64+='=',o=>o.tag_b64='!!!!',o=>o.wrapped_key_b64='']){
  const {envelope,options}=fixture();const o=JSON.parse(envelope);mutate(o);const changed=Buffer.from(JSON.stringify(o));assert.throws(()=>decrypt(changed,pair.privateKey,{...options,expectedEnvelopeSha:sha(changed)}));
 }
});
test('every authenticated envelope field rejects bit alteration even when outer hash is supplied',()=>{
 for(const field of ['aad_b64','nonce_b64','tag_b64','wrapped_key_b64','ciphertext_b64']){
  const {envelope,options}=fixture();const o=JSON.parse(envelope);const b=Buffer.from(o[field],'base64');b[0]^=1;o[field]=b.toString('base64');const changed=Buffer.from(JSON.stringify(o));assert.throws(()=>decrypt(changed,pair.privateKey,{...options,expectedEnvelopeSha:sha(changed)}));
 }
});
test('header provenance exactkeys and SQL hash are enforced before plaintext is returned',()=>{
 for(const patch of [{schema:'other'},{database_id:'other'},{catalog_sha256:'b'.repeat(64)},{recipient_public_sha256:'b'.repeat(64)},{source_sha:'b'.repeat(40)},{created_at:'bad'},{sql_bytes:true},{sql_bytes:sql.length+1},{sql_sha256:'b'.repeat(64)},{extra:'PRIVATE_FIELD'}]){
  const {envelope,options}=fixture({...header,...patch});assert.throws(()=>decrypt(envelope,pair.privateKey,options));
 }
});
test('synthetic complete private CLI pipeline produces fresh0600 db and receipt without plaintext SQL file',async()=>{
 const dir=await mkdtemp(resolve(import.meta.dirname,'intake-tmp/intake-cli-'));
 try{
  const sourceDir=resolve(import.meta.dirname,'../existing-d1-recovery/customer_frontier/recovery');
  const exportSource=(await readFile(join(sourceDir,'export_existing_d1_backup.mjs'),'utf8')).replace(RECIPIENT_SHA,sha(pair.publicKey));
  const intakeSource=await readFile(join(sourceDir,'decrypt_restore_existing_d1.mjs'),'utf8');
  const definitions=[['table','parent','CREATE TABLE parent(id INTEGER PRIMARY KEY)'],['table','child','CREATE TABLE child(id INTEGER PRIMARY KEY,pid INTEGER REFERENCES parent(id),payload BLOB)'],['table','third','CREATE TABLE third(v TEXT)'],['index','child_parent','CREATE INDEX child_parent ON child(pid)']];
  const expected='EXPECTED={\n'+definitions.map(([kind,name,ddl])=>' '+JSON.stringify(sha(name))+':('+JSON.stringify(kind)+','+JSON.stringify(sha(ddl))+'),').join('\n')+'\n}';
  const pythonSource=(await readFile(join(sourceDir,'restore_sql_private.py'),'utf8')).replace(/EXPECTED=\{[\s\S]*?\n\}/,expected);
  const sample=Buffer.from(definitions.map(v=>v[2]+';').join('\n')+"\nINSERT INTO parent VALUES(1); INSERT INTO child VALUES(1,1,X'00FF'); INSERT INTO third VALUES('PRIVATE_VALUE_SENTINEL_é');");
  const envelope=encryptBackup(sample,pair.publicKey,{...header,sql_bytes:sample.length,sql_sha256:sha(sample)});
  for(const [name,value]of [['export_existing_d1_backup.mjs',exportSource],['decrypt_restore_existing_d1.mjs',intakeSource],['restore_sql_private.py',pythonSource],['synthetic-private.pem',pair.privateKey],['envelope.enc',envelope]])await writeFile(join(dir,name),value,{mode:0o600});
  const args=[join(dir,'envelope.enc'),join(dir,'synthetic-private.pem'),sha(envelope),header.source_sha,join(dir,'restore.sqlite'),join(dir,'receipt.json')];
  const run=more=>spawnSync(process.execPath,['--import',resolve(import.meta.dirname,'backup-network-deny.mjs'),join(dir,'decrypt_restore_existing_d1.mjs'),...more],{timeout:30000,maxBuffer:1_000_000,env:{PATH:process.env.PATH}});
  const result=run(args);assert.equal(result.status,0,result.stdout.toString());const proof=JSON.parse(result.stdout);assert.equal(proof.status,'LOCAL_USER_SQL_RESTORE_VERIFIED');assert.equal(proof.user_objects,4);assert(!result.stdout.toString().includes('PRIVATE_VALUE_SENTINEL'));
  for(const key of ['independent_custody_qualified','hosted_restore_qualified','target_admitted','release_authority'])assert.equal(proof[key],false);
  assert.equal((await stat(join(dir,'restore.sqlite'))).mode&0o777,0o600);assert.equal((await stat(join(dir,'receipt.json'))).mode&0o777,0o600);
  const before=sha(await readFile(join(dir,'restore.sqlite')));const second=run([...args.slice(0,5),join(dir,'second-receipt.json')]);assert.equal(second.status,1);assert.equal(sha(await readFile(join(dir,'restore.sqlite'))),before);
  const badArgs=[...args];badArgs[2]='b'.repeat(64);badArgs[4]=join(dir,'untrusted.sqlite');badArgs[5]=join(dir,'untrusted-receipt.json');const bad=run(badArgs);assert.equal(bad.status,1);await assert.rejects(stat(badArgs[4]));
 }finally{await rm(dir,{recursive:true,force:true});}
});
