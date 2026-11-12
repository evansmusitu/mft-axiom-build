import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {
 sealSqlExport,openSqlExport,encryptionScope,BackupNoGo
} from '../recovery/step1_encrypted_sql_export_transport.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const fakeSql=Buffer.from("CREATE TABLE private_test(a TEXT); INSERT INTO private_test VALUES('NO_REAL_CUSTOMER_DATA');");
const recipient=generateKeyPairSync('x25519');
const publicDer=recipient.publicKey.export({format:'der',type:'spki'});
const pin=sha(publicDer);
const bookmark='b'.repeat(64),catalog='c'.repeat(64);
const sealed=()=>sealSqlExport({sql:fakeSql,custodianPublicSpkiDer:publicDer,
 trustedCustodianSpkiSha256:pin,bookmarkSha256:bookmark,catalogSha256:catalog,
 capturedAt:'2026-11-12T06:00:00.000Z'});
const opened=(envelope=sealed(),key=recipient.privateKey,pins={})=>openSqlExport({
 envelope,custodianPrivateKey:key,expectedCustodianSpkiSha256:pin,
 expectedBookmarkSha256:bookmark,expectedCatalogSha256:catalog,...pins});
const rejects=fn=>assert.throws(fn,e=>e instanceof BackupNoGo || e instanceof Error);
test('X25519/HKDF/AES-GCM synthetic SQL encrypt/decrypt roundtrips',()=>{
 const envelope=sealed();
 assert.equal(opened(envelope).toString(),fakeSql.toString());
 assert.equal(envelope.schema,'musitu.axiom.step1.encrypted-sql-export-envelope.v1');
});
test('fresh ephemeral key, nonce and ciphertext per export',()=>{
 const a=sealed(),b=sealed();
 for(const k of ['ephemeral_spki_der_b64','salt_b64','iv_b64','ciphertext_b64','tag_b64'])assert.notEqual(a[k],b[k]);
});
test('SQL and private key never occur in serialized envelope',()=>{
 const raw=JSON.stringify(sealed());
 assert.ok(!raw.includes('NO_REAL_CUSTOMER_DATA'));
 assert.ok(!raw.includes('CREATE TABLE'));
 assert.ok(!raw.includes('BEGIN PRIVATE KEY'));
});
test('untrusted public-key pin denies encryption',()=>rejects(()=>sealSqlExport({
 sql:fakeSql,custodianPublicSpkiDer:publicDer,trustedCustodianSpkiSha256:'e'.repeat(64),
 bookmarkSha256:bookmark,catalogSha256:catalog,capturedAt:'2026-11-12T06:00:00.000Z'})));
test('missing bookmark pin denies encryption',()=>rejects(()=>sealSqlExport({
 sql:fakeSql,custodianPublicSpkiDer:publicDer,trustedCustodianSpkiSha256:pin,
 bookmarkSha256:'',catalogSha256:catalog,capturedAt:'2026-11-12T06:00:00.000Z'})));
test('recipient must use X25519, not Ed25519',()=>{
 const bad=generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'});
 rejects(()=>sealSqlExport({sql:fakeSql,custodianPublicSpkiDer:bad,
  trustedCustodianSpkiSha256:sha(bad),bookmarkSha256:bookmark,
  catalogSha256:catalog,capturedAt:'2026-11-12T06:00:00.000Z'}));
});
test('wrong private key cannot decrypt',()=>rejects(()=>opened(sealed(),generateKeyPairSync('x25519').privateKey)));
test('independently trusted recipient pin required at restore time',()=>
 rejects(()=>opened(sealed(),recipient.privateKey,{expectedCustodianSpkiSha256:'0'.repeat(64)})));
test('bookmark substitution denies decrypt',()=>rejects(()=>opened(sealed(),recipient.privateKey,{expectedBookmarkSha256:'2'.repeat(64)})));
test('catalog substitution denies decrypt',()=>rejects(()=>opened(sealed(),recipient.privateKey,{expectedCatalogSha256:'3'.repeat(64)})));
test('tampered authenticated source account denies',()=>{
 const envelope={...sealed(),source_account:'other'};
 rejects(()=>opened(envelope));
});
test('tampered creation time fails AEAD authentication',()=>{
 const envelope={...sealed(),captured_at:'2026-11-12T07:00:00.000Z'};
 rejects(()=>opened(envelope));
});
test('tampered ciphertext fails AEAD authentication',()=>{
 const envelope=sealed(),raw=Buffer.from(envelope.ciphertext_b64,'base64');
 raw[3]^=1;
 rejects(()=>opened({...envelope,ciphertext_b64:raw.toString('base64')}));
});
test('tampered auth tag fails AEAD authentication',()=>{
 const envelope=sealed(),raw=Buffer.from(envelope.tag_b64,'base64');
 raw[0]^=1;
 rejects(()=>opened({...envelope,tag_b64:raw.toString('base64')}));
});
test('additional plaintext or dangerous fields denied',()=>
 rejects(()=>opened({...sealed(),plaintext_sql:fakeSql.toString()})));
test('deletion of one evidence field denied',()=>{
 const envelope={...sealed()};delete envelope.bookmark_sha256;rejects(()=>opened(envelope));
});
test('oversized and empty private SQL denied',()=>{
 for(const sql of [Buffer.alloc(0),Buffer.alloc(8_000_001)])rejects(()=>sealSqlExport({
  sql,custodianPublicSpkiDer:publicDer,trustedCustodianSpkiSha256:pin,
  bookmarkSha256:bookmark,catalogSha256:catalog,capturedAt:'2026-11-12T06:00:00.000Z'}));
});
test('encryption helper cannot issue a release or restore approval',()=>{
 const scope=encryptionScope();
 for(const k of ['source_sql_export_performed','encrypted_backup_custody_qualified',
  'independent_human_custody_qualified','target_restore_qualified','source_reuse_authorized',
  'step_2_authorized','release_authority'])assert.equal(scope[k],false);
});
