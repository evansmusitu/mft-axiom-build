import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,generateKeyPairSync,createHash,createPrivateKey,createPublicKey} from 'node:crypto';
import {sealRecoveryKeys,recoverRecoveryKeys,inspectRecoveryBundle} from '../src/security/offline-custody.mjs';

const keyA=generateKeyPairSync('rsa',{modulusLength:3072,publicExponent:65537});
const keyB=generateKeyPairSync('rsa',{modulusLength:3072,publicExponent:65537});
const unrelated=generateKeyPairSync('rsa',{modulusLength:3072,publicExponent:65537});
const signing=generateKeyPairSync('ed25519');
const material=()=>({encryptionKey:randomBytes(32),privacyKey:randomBytes(32),backupKey:randomBytes(32),signingPrivateKeyPem:signing.privateKey.export({format:'pem',type:'pkcs8'}).toString()});
const publicPem=k=>k.publicKey.export({format:'pem',type:'spki'}).toString();
const privatePem=k=>k.privateKey.export({format:'pem',type:'pkcs8'}).toString();
const custodians=()=>[{id:'custodian-owner',publicKeyPem:publicPem(keyA)},{id:'custodian-approver',publicKeyPem:publicPem(keyB)}];
const fixture=()=>{
 const keys=material();
 const bundle=sealRecoveryKeys({tenantId:'example-tenant',epoch:2,keys,custodians:custodians()});
 const digest=createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
 return {keys,bundle,digest};
};
const recover=(bundle,digest,extra={})=>recoverRecoveryKeys(bundle,{
 expectedTenantId:'example-tenant',expectedEpoch:2,trustedBundleSha256:digest,
 custodians:[{id:'custodian-owner',privateKeyPem:privatePem(keyA),publicKeyPem:publicPem(keyA)},
             {id:'custodian-approver',privateKeyPem:privatePem(keyB),publicKeyPem:publicPem(keyB)}],...extra});

test('recoverable, two-custodian offline escrow restores all operational keys without serializing plaintext',()=>{
 const {keys,bundle,digest}=fixture();
 const descriptor=inspectRecoveryBundle(bundle);
 assert.equal(descriptor.tenantId,'example-tenant');
 assert.equal(descriptor.epoch,2);
 assert.equal(descriptor.bundleSha256,digest);
 assert.equal(descriptor.custodians.length,2);
 const serialized=JSON.stringify(bundle);
 for(const value of Object.values(keys))assert.equal(serialized.includes(Buffer.isBuffer(value)?value.toString('base64'):value),false);
 const recovered=recover(bundle,digest);
 for(const kind of ['encryptionKey','privacyKey','backupKey'])assert.deepEqual(recovered[kind],keys[kind]);
 assert.equal(recovered.signingPrivateKeyPem,keys.signingPrivateKeyPem);
 assert.equal(createPrivateKey(recovered.signingPrivateKeyPem).asymmetricKeyType,'ed25519');
});

test('recovery fails closed when either independent custodian is missing, substituted or duplicated',()=>{
 const {bundle,digest}=fixture();
 assert.throws(()=>recover(bundle,digest,{custodians:[{id:'custodian-owner',privateKeyPem:privatePem(keyA),publicKeyPem:publicPem(keyA)}]}),/CUSTODY_REJECTED/);
 assert.throws(()=>recover(bundle,digest,{custodians:[{id:'custodian-owner',privateKeyPem:privatePem(keyA),publicKeyPem:publicPem(keyA)},{id:'custodian-approver',privateKeyPem:privatePem(unrelated),publicKeyPem:publicPem(unrelated)}]}),/CUSTODY_REJECTED/);
 assert.throws(()=>sealRecoveryKeys({tenantId:'example-tenant',epoch:2,keys:material(),custodians:[custodians()[0],custodians()[0]]}),/CUSTODY_REJECTED/);
});

test('tampering, wrong epoch, wrong independently pinned digest and malformed key size are rejected',()=>{
 const {bundle,digest}=fixture();
 assert.throws(()=>recover(bundle,digest,{expectedEpoch:1}),/CUSTODY_REJECTED/);
 assert.throws(()=>recover(bundle,'0'.repeat(64)),/CUSTODY_REJECTED/);
 const corrupt=structuredClone(bundle);corrupt.ciphertext=corrupt.ciphertext.slice(0,-2)+'AA';
 assert.throws(()=>recover(corrupt,digest),/CUSTODY_REJECTED/);
 assert.throws(()=>sealRecoveryKeys({tenantId:'example-tenant',epoch:2,keys:{...material(),privacyKey:randomBytes(31)},custodians:custodians()}),/CUSTODY_REJECTED/);
});

test('recovery bundle is bound to tenant, explicit epoch, independent custodian fingerprints',()=>{
 const {bundle,digest}=fixture();
 assert.throws(()=>recover(bundle,digest,{expectedTenantId:'another-tenant'}),/CUSTODY_REJECTED/);
 const exchanged=structuredClone(bundle);exchanged.custodians.reverse();
 assert.throws(()=>recover(exchanged,digest),/CUSTODY_REJECTED/);
 assert.throws(()=>sealRecoveryKeys({tenantId:'example-tenant',epoch:-1,keys:material(),custodians:custodians()}),/CUSTODY_REJECTED/);
});
