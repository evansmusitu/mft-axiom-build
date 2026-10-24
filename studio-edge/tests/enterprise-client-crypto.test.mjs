import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {encryptTenantText, decryptTenantText} from '../client-encrypted-artifact.mjs';

const A='tenant_alpha001', B='tenant_bravo002', ID='artifact_entry_001';
const key=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
const other=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
const smallKey=await webcrypto.subtle.generateKey({name:'AES-GCM',length:128},false,['encrypt','decrypt']);

test('client encrypts/decrypts UTF-8 with new random 96-bit nonce each time, no plaintext in envelope',async()=>{
 const plain='Private workspace text: 𝄞 ✓ 🍃';
 const one=await encryptTenantText(plain,key,A,ID);
 const two=await encryptTenantText(plain,key,A,ID);
 for(const result of [one,two]){
  assert.deepEqual(Object.keys(result).sort(),['ciphertext','iv','version']);
  assert.equal(result.version,1);
  assert.match(result.iv,/^[A-Za-z0-9_-]{16}$/);
  assert.equal(Buffer.from(result.iv,'base64url').length,12);
  assert.ok(!JSON.stringify(result).includes(plain));
  assert.equal(await decryptTenantText(result,key,A,ID),plain);
 }
 assert.notEqual(one.iv,two.iv);
 assert.notEqual(one.ciphertext,two.ciphertext);
});
test('tenant and object identities are cryptographic authenticated-data boundaries',async()=>{
 const value=await encryptTenantText('top secret',key,A,ID);
 await assert.rejects(decryptTenantText(value,key,B,ID));
 await assert.rejects(decryptTenantText(value,key,A,'artifact_other_001'));
 await assert.rejects(decryptTenantText(value,other,A,ID));
});
test('tampering and invalid encodings fail closed',async()=>{
 const original=await encryptTenantText('confidential',key,A,ID);
 for(const corrupted of [
  {...original,version:2},
  {...original,iv:'evil'},
  {...original,ciphertext:original.ciphertext.slice(0,-1)+'!'},
  {...original,ciphertext:''},
  {...original,iv:original.iv.replace(/.$/,'-')},
  {...original,other:'secret'},
  {ciphertext:original.ciphertext,version:1}
 ]){
   await assert.rejects(decryptTenantText(corrupted,key,A,ID));
 }
});
test('enforce signed-off size, identifier and AES-256 encryption prerequisites',async()=>{
 await assert.rejects(encryptTenantText('too big'.repeat(2500),key,A,ID));
 await assert.rejects(encryptTenantText('secret',smallKey,A,ID));
 await assert.rejects(encryptTenantText('secret',key,'../tenant',ID));
 await assert.rejects(encryptTenantText('secret',key,A,'!'));
});
