import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyOwnerPublicPins, OwnerPinNoGo, SCHEMA, SOURCE_D1 } from '../qualification/step1_owner_public_pin_preflight.mjs';
const sha = x => createHash('sha256').update(x).digest('hex');
const ownerSigning = generateKeyPairSync('ed25519').publicKey.export({ format:'der', type:'spki' });
const ownerRecipient = generateKeyPairSync('x25519').publicKey.export({ format:'der', type:'spki' });
const signerPin = sha(ownerSigning), recipientPin = sha(ownerRecipient);
const pathToCli = resolve(fileURLToPath(new URL('../qualification/step1_owner_public_pin_preflight.mjs', import.meta.url)));
function receipt(extra = {}) {
  const r = {
    schema:SCHEMA, owner_signing_algorithm:'Ed25519', owner_encryption_recipient_algorithm:'X25519',
    owner_ed25519_spki_sha256:signerPin, owner_x25519_spki_sha256:recipientPin,
    keys_created_on_owner_device_reported_only:true,
    owner_identity_and_mfa_independently_qualified:false,
    public_key_pins_approved_for_runtime:false,
    current_encrypted_backup_qualified:false,
    provider_zero_spend_qualified:false,
    step1_closed:false, step2_authorized:false, release:'NOT_RELEASE', ...extra,
  };
  return JSON.stringify(Object.fromEntries(Object.keys(r).sort().map(k=>[k,r[k]])), null, 2) + '\n';
}
const args = (extra = {}) => ({ signingDer:ownerSigning, recipientDer:ownerRecipient,
  ceremonyReceiptRaw:receipt(), trustedSigningSpkiSha256:signerPin,
  trustedRecipientSpkiSha256:recipientPin, ...extra });
const denied = a => assert.throws(() => verifyOwnerPublicPins(a), e => e instanceof OwnerPinNoGo);

test('synthetic valid public keys & separately pinned SHA pass ONLY preflight', () => {
  const p = verifyOwnerPublicPins(args());
  assert.equal(p.status, 'PUBLIC_PINS_MATCH_EXTERNAL_TRUST_PRECHECK_ONLY_NO_GO');
  assert.equal(p.source_database, SOURCE_D1);
  assert.equal(p.public_spki_formats_and_pins_qualified,true);
  assert.equal(p.owner_ed25519_spki_sha256,signerPin);
  assert.equal(p.owner_x25519_spki_sha256,recipientPin);
  for(const k of ['independent_real_owner_identity_and_mfa_qualified',
     'actual_owner_key_possession_and_recovery_qualified','owner_signed_exact_recovery_plan_verified',
     'source_backup_encrypted_and_restorable','disposable_target_cost_and_creation_approved',
     'hosted_restore_parity_qualified','historical_independent_custody_passed',
     'step1_closed','step2_authorized','release_authorized'])assert.equal(p[k],false,k);
  assert.equal(p.release_status,'NOT_RELEASE');assert.equal(p.b27_synthetic_cas,'FAIL');
  assert.equal(p.pr83_fullstack,'FAIL');assert.ok(Object.isFrozen(p));
  assert.ok(!JSON.stringify(p).includes('PRIVATE KEY'));
});
test('no external trust pins: deny even with self-declared ceremony pins',()=> {
  denied(args({trustedSigningSpkiSha256:undefined}));
  denied(args({trustedRecipientSpkiSha256:undefined}));
  denied(args({trustedSigningSpkiSha256:'z'.repeat(64)}));
});
test('untrusted or wrong external signing and recipient pin deny',()=> {
  denied(args({trustedSigningSpkiSha256:'0'.repeat(64)}));
  denied(args({trustedRecipientSpkiSha256:'0'.repeat(64)}));
});
test('substituted key material rejected even when receipt unchanged',()=> {
  const b = generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'});
  denied(args({signingDer:b}));
  denied(args({recipientDer:generateKeyPairSync('x25519').publicKey.export({format:'der',type:'spki'})}));
});
test('key type swapped or wrong elliptic curve denies',()=> {
  denied(args({signingDer:ownerRecipient}));
  denied(args({recipientDer:ownerSigning}));
  denied(args({signingDer:generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'der',type:'spki'})}));
});
test('non-SPKI, private key, and corrupted DER must not parse',()=> {
  const privateDer=generateKeyPairSync('ed25519').privateKey.export({format:'der',type:'pkcs8'});
  denied(args({signingDer:privateDer}));
  denied(args({recipientDer:Buffer.from('not DER')}));
  denied(args({signingDer:Buffer.alloc(9000)}));
  denied(args({signingDer:ownerSigning.subarray(0, ownerSigning.length-1)}));
});
test('receipt algorithm and schema cannot be rewritten',()=> {
  denied(args({ceremonyReceiptRaw:receipt({schema:'unknown'})}));
  denied(args({ceremonyReceiptRaw:receipt({owner_encryption_recipient_algorithm:'RSA'})}));
  denied(args({ceremonyReceiptRaw:receipt({owner_signing_algorithm:'RSA'})}));
});
test('cannot self-promote runtime, MFA, backup, budget or release flags',()=> {
  for(const patch of [{step1_closed:true},{step2_authorized:true},{release:'RELEASE'},
    {public_key_pins_approved_for_runtime:true},{owner_identity_and_mfa_independently_qualified:true},
    {current_encrypted_backup_qualified:true},{provider_zero_spend_qualified:true},
    {keys_created_on_owner_device_reported_only:false}])
    denied(args({ceremonyReceiptRaw:receipt(patch)}));
});
test('extra or missing ceremony receipt fields deny',()=> {
  denied(args({ceremonyReceiptRaw:receipt({ignore_governance:true})}));
  const a=JSON.parse(receipt());delete a.release;
  denied(args({ceremonyReceiptRaw:JSON.stringify(Object.fromEntries(Object.keys(a).sort().map(k=>[k,a[k]])),null,2)+'\n'}));
});
test('recipients or signers cannot drift in receipt',()=> {
  denied(args({ceremonyReceiptRaw:receipt({owner_ed25519_spki_sha256:'0'.repeat(64)})}));
  denied(args({ceremonyReceiptRaw:receipt({owner_x25519_spki_sha256:'0'.repeat(64)})}));
});
test('duplicate JSON keys and noncanonical receipt encoding deny',()=> {
  const normal=receipt();
  denied(args({ceremonyReceiptRaw:normal.replace('"release": "NOT_RELEASE",', '"release": "RELEASE",\n  "release": "NOT_RELEASE",')}));
  denied(args({ceremonyReceiptRaw:normal.trim()}));
  denied(args({ceremonyReceiptRaw:' '+normal}));
  denied(args({ceremonyReceiptRaw:'{"release":"NOT_RELEASE"}\n'}));
});
test('oversized or malformed receipt denies',()=> {
  denied(args({ceremonyReceiptRaw:'x'.repeat(4100)}));
  denied(args({ceremonyReceiptRaw:'{'}));
  denied(args({ceremonyReceiptRaw:undefined}));
});
test('CLI missing trust inputs refuses without exposing supplied public bytes',()=> {
  const dir=mkdtempSync(join(tmpdir(),'axiom-owner-public-test-'));
  try {
    const fileA=join(dir,'owner-ed.der'),fileB=join(dir,'owner-x.der'),fileC=join(dir,'receipt.json');
    writeFileSync(fileA,ownerSigning);writeFileSync(fileB,ownerRecipient);writeFileSync(fileC,receipt());
    const r=spawnSync(process.execPath,[pathToCli,fileA,fileB,fileC],{encoding:'utf8',env:{PATH:process.env.PATH}});
    assert.equal(r.status,2);assert.match(r.stderr,/EXTERNAL_TRUST_ROOTS_REQUIRED/);
    assert.equal(r.stdout,'');
  } finally{ rmSync(dir,{recursive:true,force:true}); }
});
test('CLI with synthetic external pins reports only unqualified public SHA and NO_GO',()=> {
  const dir=mkdtempSync(join(tmpdir(),'axiom-owner-public-test-'));
  try {
    const fileA=join(dir,'owner-ed.der'),fileB=join(dir,'owner-x.der'),fileC=join(dir,'receipt.json');
    writeFileSync(fileA,ownerSigning);writeFileSync(fileB,ownerRecipient);writeFileSync(fileC,receipt());
    const r=spawnSync(process.execPath,[pathToCli,fileA,fileB,fileC],{encoding:'utf8',env:{
      PATH:process.env.PATH,
      AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256:signerPin,
      AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256:recipientPin,
    }});
    assert.equal(r.status,0,r.stderr);
    const data=JSON.parse(r.stdout);
    assert.equal(data.step1_closed,false);
    assert.equal(data.release_status,'NOT_RELEASE');
  } finally{rmSync(dir,{recursive:true,force:true});}
});
