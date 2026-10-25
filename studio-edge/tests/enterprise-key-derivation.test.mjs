import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createEnterpriseKeyDescriptor,deriveEnterpriseKey} from '../enterprise-key-derivation.mjs';
import {encryptTenantText,decryptTenantText} from '../client-encrypted-artifact.mjs';
const TENANT='tenant_alpha001',OTHER='tenant_bravo002',ID='artifact_entry_001';
const PASS='strong randomized family safe passphrase P9_xB!v2 ♦️';
test('new independent randomized key descriptors contain only public derivation metadata',()=>{
 const a=createEnterpriseKeyDescriptor(TENANT),b=createEnterpriseKeyDescriptor(TENANT);
 for(const descriptor of [a,b]){
  assert.deepEqual(Object.keys(descriptor).sort(),
    ['cipher','iterations','kdf','kind','salt','tenantId','version']);
  assert.equal(descriptor.kind,'musitu-enterprise-key-derivation');
  assert.equal(descriptor.version,1);
  assert.equal(descriptor.kdf,'PBKDF2-SHA-256');
  assert.equal(descriptor.cipher,'AES-256-GCM');
  assert.ok(descriptor.iterations>=600000);
  assert.equal(Buffer.from(descriptor.salt,'base64url').length,16);
  assert.equal(descriptor.tenantId,TENANT);
  assert.ok(!JSON.stringify(descriptor).includes(PASS));
 }
 assert.notEqual(a.salt,b.salt,'salt must be randomly generated');
});
test('same tenant/passphrase/descriptor recovers a non-extractable key on another instance',async()=>{
 const descriptor=createEnterpriseKeyDescriptor(TENANT);
 const first=await deriveEnterpriseKey(PASS,descriptor,TENANT);
 const recreated=await deriveEnterpriseKey(PASS,structuredClone(descriptor),TENANT);
 assert.equal(first.extractable,false);assert.equal(recreated.extractable,false);
 assert.equal(first.algorithm.name,'AES-GCM');assert.equal(first.algorithm.length,256);
 assert.deepEqual(first.usages,['encrypt','decrypt']);
 const sealed=await encryptTenantText('private recovery evidence',first,TENANT,ID);
 assert.equal(await decryptTenantText(sealed,recreated,TENANT,ID),'private recovery evidence');
 const different=await deriveEnterpriseKey(PASS,createEnterpriseKeyDescriptor(TENANT),TENANT);
 await assert.rejects(decryptTenantText(sealed,different,TENANT,ID));
});
test('incorrect passphrase and different tenant cannot decrypt a valid artifact',async()=>{
 const d=createEnterpriseKeyDescriptor(TENANT);
 const key=await deriveEnterpriseKey(PASS,d,TENANT);
 const sealed=await encryptTenantText('never guess plaintext',key,TENANT,ID);
 const impostor=await deriveEnterpriseKey('Not the right secret passphrase 0123456789',d,TENANT);
 await assert.rejects(decryptTenantText(sealed,impostor,TENANT,ID));
 await assert.rejects(deriveEnterpriseKey(PASS,d,OTHER),/INVALID_KEY_DESCRIPTOR/);
});
test('refuses malformed descriptors, weak passphrases and noncanonical salts',async()=>{
 const d=createEnterpriseKeyDescriptor(TENANT);
 const mutated=[
  {...d,version:2},{...d,kdf:'PBKDF2-SHA-1'},{...d,iterations:1000},
  {...d,cipher:'AES-128-GCM'},{...d,salt:'a'},
  {...d,salt:d.salt+'='},{...d,extra:'bad'},{...d,tenantId:OTHER},
  {...d,salt:d.salt.slice(0,-1)+'!'}
 ];
 for(const invalid of mutated)
  await assert.rejects(deriveEnterpriseKey(PASS,invalid,TENANT),/INVALID_KEY_DESCRIPTOR/);
 for(const pass of ['weak','a'.repeat(300),'',' '.repeat(18)])
  await assert.rejects(deriveEnterpriseKey(pass,d,TENANT),/WEAK_PASSPHRASE/);
});
test('key generation remains completely offline, with no fetch or browser storage',async()=>{
 const oldFetch=globalThis.fetch;
 let called=0;
 globalThis.fetch=async()=>{called++;throw Error('unexpected fetch');};
 try{
  const descriptor=createEnterpriseKeyDescriptor(TENANT);
  const k=await deriveEnterpriseKey(PASS,descriptor,TENANT);
  assert.equal(k.extractable,false);
  assert.equal(called,0);
 }finally{globalThis.fetch=oldFetch;}
});
