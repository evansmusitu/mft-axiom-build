import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync,readdirSync,linkSync,symlinkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runRestoredOwnerKeys,OwnerRecoveryNoGo,MARKER} from '../qualification/step1_owner_windows_restored_keys.mjs';
const P1='SYNTHETIC_OWNER_KEY_TEST_SIGN_PASS_1234',P2='SYNTHETIC_OWNER_KEY_TEST_REC_PASS_5678';
const sha=b=>createHash('sha256').update(b).digest('hex');
const denied=(fn,code)=>assert.throws(fn,e=>e instanceof OwnerRecoveryNoGo&&(!code||e.code===code));
function scoped(fn){const root=mkdtempSync(join(tmpdir(),'axiom-win-recovery-synthetic-'));try{return fn(root);}finally{rmSync(root,{recursive:true,force:true});}}
function fixture(root){
 const original=join(root,'original'),restored=join(root,'restored'),output=join(root,'out');
 for(const d of [original,restored]){mkdirSync(d);mkdirSync(join(d,'private'));}
 mkdirSync(join(original,'public'));mkdirSync(output);
 writeFileSync(join(output,MARKER),'AXIOM_WINDOWS_OWNER_ACL_REVIEW_ONLY_NO_RELEASE\n');
 const info={};
 for(const [name,alg,pass] of [['ed25519','ed25519',P1],['x25519','x25519',P2]]){
  const {privateKey,publicKey}=generateKeyPairSync(alg);
  const pem=privateKey.export({type:'pkcs8',format:'pem',cipher:'aes-256-cbc',passphrase:pass});
  const der=publicKey.export({type:'spki',format:'der'});
  const priv=`owner_${name}_pkcs8_encrypted.pem`;
  writeFileSync(join(original,'private',priv),pem);
  copyFileSync(join(original,'private',priv),join(restored,'private',priv));
  writeFileSync(join(original,'public',`owner_${name}_spki.der`),der);
  info[name]=sha(der);
 }
 return {original,restored,output,params:{original,restored,output,signPassword:Buffer.from(P1),recipientPassword:Buffer.from(P2),trustedSignPin:info.ed25519,trustedRecipientPin:info.x25519}};
}
test('synthetic encrypted restored Ed25519 challenge and X25519 agreement pass; all release controls false',()=>scoped(root=>{
 const f=fixture(root),r=runRestoredOwnerKeys(f.params);
 assert.equal(r.status,'WINDOWS_OWNER_RESTORED_ENCRYPTED_KEYS_LOCAL_REHEARSAL_ONLY_NO_GO');
 assert.equal(r.restored_ed25519_challenge_verified_locally,true);
 assert.equal(r.restored_x25519_synthetic_agreement_verified_locally,true);
 for(const k of ['real_owner_identity_and_mfa_qualified','independently_verified_device_loss_recovery',
 'separate_physical_backup_media_independently_verified','production_trust_pins_activated',
 'hosted_d1_restore_parity_qualified','provider_zero_additional_spend_qualified',
 'global_anti_rollback_and_nonce_qualified','step1_closed','step2_authorized','release_authorized'])assert.equal(r[k],false,k);
 assert.equal(r.release_status,'NOT_RELEASE');
 const saved=readFileSync(join(f.output,'OWNER_WINDOWS_RESTORED_KEY_REHEARSAL_NOT_AUTHORITY.json'),'utf8');
 assert.equal(JSON.parse(saved).release_authorized,false);
 assert.equal(saved.includes('ENCRYPTED PRIVATE KEY'),false);
 assert.equal(saved.includes(P1),false);assert.equal(saved.includes(P2),false);
}));
test('missing public trust pin denied before any decryption/output',()=>scoped(root=>{
 const f=fixture(root);denied(()=>runRestoredOwnerKeys({...f.params,trustedSignPin:undefined}),'EXTERNAL_REVIEWED_PUBLIC_PINS_REQUIRED');
 assert.deepEqual(readdirSync(f.output),[MARKER]);
}));
test('substituted trusted signing or recipient pin denied',()=>scoped(root=>{
 const f=fixture(root);
 denied(()=>runRestoredOwnerKeys({...f.params,trustedSignPin:'0'.repeat(64)}),'PUBLIC_KEYS_NOT_INDEPENDENTLY_TRUSTED');
 denied(()=>runRestoredOwnerKeys({...f.params,trustedRecipientPin:'f'.repeat(64)}),'PUBLIC_KEYS_NOT_INDEPENDENTLY_TRUSTED');
}));
test('restored path same as original denied',()=>scoped(root=>{
 const f=fixture(root);denied(()=>runRestoredOwnerKeys({...f.params,restored:f.original}),'A_SEPARATE_RESTORED_COPY_IS_REQUIRED');
}));
test('hardlinked restored private PEM to original is denied',()=>scoped(root=>{
 const f=fixture(root),src=join(f.original,'private','owner_ed25519_pkcs8_encrypted.pem'),dst=join(f.restored,'private','owner_ed25519_pkcs8_encrypted.pem');
 unlinkSync(dst);linkSync(src,dst);
 denied(()=>runRestoredOwnerKeys(f.params),'RESTORED_PRIVATE_KEY_HARDLINKS_ORIGINAL');
}));
test('restored ciphertext wrong passphrase denied, without fake success receipt',()=>scoped(root=>{
 const f=fixture(root);
 denied(()=>runRestoredOwnerKeys({...f.params,signPassword:Buffer.from(P2)}),'ENCRYPTED_PEM_WRONG_PASSWORD_OR_CORRUPTION');
 assert.deepEqual(readdirSync(f.output),[MARKER]);
}));
test('swapping two encrypted PEM files with matching respective passphrases still fails public pin check',()=>scoped(root=>{
 const f=fixture(root),a=join(f.restored,'private','owner_ed25519_pkcs8_encrypted.pem'),b=join(f.restored,'private','owner_x25519_pkcs8_encrypted.pem');
 const aa=readFileSync(a),bb=readFileSync(b);writeFileSync(a,bb);writeFileSync(b,aa);
 denied(()=>runRestoredOwnerKeys({...f.params,signPassword:Buffer.from(P2),recipientPassword:Buffer.from(P1)}),'RESTORED_KEY_DOES_NOT_MATCH_REVIEWED_PUBLIC_PIN');
}));
test('public key substitution denied, no authority',()=>scoped(root=>{
 const f=fixture(root);const p=join(f.original,'public','owner_ed25519_spki.der');
 writeFileSync(p,readFileSync(join(f.original,'public','owner_x25519_spki.der')));
 denied(()=>runRestoredOwnerKeys(f.params));
}));
test('public key symlinks denied',()=>scoped(root=>{
 const f=fixture(root);const p=join(f.original,'public','owner_ed25519_spki.der');
 const dst=join(f.original,'public','moved.der');copyFileSync(p,dst);unlinkSync(p);symlinkSync(dst,p);
 denied(()=>runRestoredOwnerKeys(f.params),'PUBLIC_SPKI_INVALID');
}));
test('restored private PEM symlink denied',()=>scoped(root=>{
 const f=fixture(root),p=join(f.restored,'private','owner_ed25519_pkcs8_encrypted.pem');
 unlinkSync(p);symlinkSync(join(f.original,'private','owner_ed25519_pkcs8_encrypted.pem'),p);
 denied(()=>runRestoredOwnerKeys(f.params),'ENCRYPTED_PEM_INVALID');
}));
test('unencrypted private PEM rejected',()=>scoped(root=>{
 const f=fixture(root);writeFileSync(join(f.restored,'private','owner_x25519_pkcs8_encrypted.pem'),'-----BEGIN PRIVATE KEY-----\n'+'.'.repeat(200));
 denied(()=>runRestoredOwnerKeys(f.params),'UNENCRYPTED_PEM_REFUSED');
}));
test('missing owner ACL marker denied, before success receipt',()=>scoped(root=>{
 const f=fixture(root);unlinkSync(join(f.output,MARKER));
 denied(()=>runRestoredOwnerKeys(f.params),'OWNER_ACL_WRAPPER_MARKER_REQUIRED');
}));
test('existing output file cannot be overwritten',()=>scoped(root=>{
 const f=fixture(root);writeFileSync(join(f.output,'previous'),'do not touch');
 denied(()=>runRestoredOwnerKeys(f.params),'OUTPUT_DIRECTORY_NOT_NEW_OR_EMPTY');
 assert.equal(readFileSync(join(f.output,'previous'),'utf8'),'do not touch');
}));
test('receipt never contains signed D1 creation or authorized spend',()=>scoped(root=>{
 const f=fixture(root);const r=runRestoredOwnerKeys(f.params);
 assert.equal(r.current_encrypted_customer_backup_qualified,false);
 assert.equal(r.provider_zero_additional_spend_qualified,false);
 assert.equal(r.hosted_d1_restore_parity_qualified,false);
}));
test('real owner CLI denies CI noninteractive synthetic invocation',()=>{
 const file=fileURLToPath(new URL('../qualification/step1_owner_windows_restored_keys.mjs',import.meta.url));
 const r=spawnSync(process.execPath,[file,'x','y','z'],{encoding:'utf8',env:{...process.env,CI:'true'}});
 assert.equal(r.status,2);assert.match(r.stderr,/OWNER_WINDOWS_RESTORE_NO_GO/);
});
