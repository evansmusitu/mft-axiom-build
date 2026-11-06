import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {DATABASE,CATALOG_SHA,sha,encryptBackup} from '../recovery/export_existing_d1_backup.mjs';
import {decrypt} from '../recovery/decrypt_restore_existing_d1.mjs';
const pair=generateKeyPairSync('rsa',{modulusLength:4096,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const sql=Buffer.from('CREATE TABLE example(value TEXT);');
const h={schema:'musitu.axiom.d1_logical_export.v1',database_id:DATABASE,catalog_sha256:CATALOG_SHA,source_sha:'a'.repeat(40),created_at:new Date().toISOString(),recipient_public_sha256:sha(pair.publicKey),sql_bytes:sql.length,sql_sha256:sha(sql)};
function fixture(header=h){const envelope=encryptBackup(sql,pair.publicKey,header);return {envelope,options:{expectedEnvelopeSha:sha(envelope),expectedSourceSha:h.source_sha,expectedRecipientSha:h.recipient_public_sha256}};}
test('private intake validates actual origin hash, source and recipient',()=>{const {envelope,options}=fixture();assert.deepEqual(decrypt(envelope,pair.privateKey,options).sql,sql);for(const patch of [{expectedEnvelopeSha:'b'.repeat(64)},{expectedSourceSha:'b'.repeat(40)},{expectedRecipientSha:'b'.repeat(64)}])assert.throws(()=>decrypt(envelope,pair.privateKey,{...options,...patch}));});
test('authenticated but inconsistent backup metadata is rejected',()=>{for(const patch of [{sql_sha256:'b'.repeat(64)},{database_id:'different'},{catalog_sha256:'b'.repeat(64)},{sql_bytes:sql.length+1},{created_at:'invalid'}]){const {envelope,options}=fixture({...h,...patch});assert.throws(()=>decrypt(envelope,pair.privateKey,options));}});
test('tampered ciphertext fails even if caller supplied its new outer hash',()=>{const {envelope,options}=fixture();const object=JSON.parse(envelope),bytes=Buffer.from(object.ciphertext_b64,'base64');bytes[0]^=1;object.ciphertext_b64=bytes.toString('base64');const corrupted=Buffer.from(JSON.stringify(object));assert.throws(()=>decrypt(corrupted,pair.privateKey,{...options,expectedEnvelopeSha:sha(corrupted)}));});
