import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync, createHash} from 'node:crypto';
import {buildReceipt,writeReceipt} from '../qualification/step1_owner_windows_public_receipt.mjs';
const verifier = await import('../qualification/step1_owner_public_pin_preflight.mjs').catch(e => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  return null;
});
const verifyOwnerPublicPins = verifier?.verifyOwnerPublicPins;
const sha = b => createHash('sha256').update(b).digest('hex');
const keys=()=>{
  const s=generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'});
  const x=generateKeyPairSync('x25519').publicKey.export({format:'der',type:'spki'});
  return {s,x};
};
function setup(fn){const p=mkdtempSync(join(tmpdir(),'axiom-win-public-synthetic-'));
 try{mkdirSync(join(p,'public'));const {s,x}=keys();
  writeFileSync(join(p,'public','owner_ed25519_spki.der'),s);
  writeFileSync(join(p,'public','owner_x25519_spki.der'),x);
  return fn({p,dir:join(p,'public'),s,x});
 }finally{rmSync(p,{recursive:true,force:true})}}

test('public Windows receipt is canonical and accepted by unchanged PR241 verifier with external pins',(t)=>{
  if (!verifyOwnerPublicPins) return t.skip('existing verifier not available in local isolated test fixture');
  return setup(({dir,s,x})=>{
  const raw=buildReceipt(dir);
  const keys=Object.keys(JSON.parse(raw));
  assert.deepEqual(keys,keys.slice().sort());
  assert.equal(raw.endsWith('\n'),true);
  const verified=verifyOwnerPublicPins({signingDer:s,recipientDer:x,ceremonyReceiptRaw:raw,
    trustedSigningSpkiSha256:sha(s),trustedRecipientSpkiSha256:sha(x)});
  assert.equal(verified.public_spki_formats_and_pins_qualified,true);
  assert.equal(verified.release_authorized,false);
  assert.equal(verified.actual_owner_key_possession_and_recovery_qualified,false);
  assert.equal(verified.step1_closed,false);
  });
});

test('receipt publication is create-only and never overwrites an earlier receipt',()=>setup(({dir})=>{
  assert.match(writeReceipt(dir),/NO_GO_NOT_RELEASE/);
  assert.equal(JSON.parse(readFileSync(join(dir,'OWNER_PUBLIC_PINS_NOT_ATTESTATION.json'),'utf8')).release,'NOT_RELEASE');
  assert.throws(()=>writeReceipt(dir),/EEXIST/);
}));

test('wrong algorithm in signature public DER is denied',()=>setup(({dir,x})=>{
  writeFileSync(join(dir,'owner_ed25519_spki.der'),x);
  assert.throws(()=>buildReceipt(dir),/WRONG_OR_NONCANONICAL_PUBLIC_KEY/);
}));

test('non-DER inputs and missing keys fail before receipt creation',()=>setup(({dir})=>{
  writeFileSync(join(dir,'owner_x25519_spki.der'),Buffer.from('bad public data'));
  assert.throws(()=>writeReceipt(dir),/INVALID_PUBLIC_FILE/);
}));

test('preflight does not permit self-asserted pins as trusted anchors',(t)=>{
  if (!verifyOwnerPublicPins) return t.skip('existing verifier not available in local isolated test fixture');
  return setup(({dir,s,x})=>{
  const raw=buildReceipt(dir);
  assert.throws(()=>verifyOwnerPublicPins({signingDer:s,recipientDer:x,ceremonyReceiptRaw:raw,
    trustedSigningSpkiSha256:undefined,trustedRecipientSpkiSha256:undefined}),/EXTERNAL_TRUST_ROOTS_REQUIRED/);
  });
});

test('unapproved policy fields remain false',()=>setup(({dir})=>{
  const p=JSON.parse(buildReceipt(dir));
  for(const k of ['owner_identity_and_mfa_independently_qualified','public_key_pins_approved_for_runtime',
    'current_encrypted_backup_qualified','provider_zero_spend_qualified','step1_closed','step2_authorized'])
      assert.equal(p[k],false,k);
  assert.equal(p.release,'NOT_RELEASE');
}));
