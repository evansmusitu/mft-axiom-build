/** B27 separate-runner proof must verify content semantics, not only signer bytes.
 * Synthetic only: this cannot certify an independent real-world custodian.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyEnvelope,makeEvidence,digest,canon} from './b27-crosshost-checkpoint.mjs';

const previousRun=process.env.GITHUB_RUN_ID, previousSha=process.env.GITHUB_SHA;
if(!previousRun)process.env.GITHUB_RUN_ID='123456789';
if(!previousSha)process.env.GITHUB_SHA='a'.repeat(40);
const original=makeEvidence();
const trusted=verifyEnvelope(original,digest(original.public_key_jwk));

function validlyResignedWrongPayload(changes){
  const keys=generateKeyPairSync('ed25519');
  const jwk=keys.publicKey.export({format:'jwk'});
  const payload={...trusted,...changes};
  const signature=sign(null,Buffer.from(canon(payload)),keys.privateKey).toString('base64url');
  return {obj:{payload,signature,public_key_jwk:jwk},expectedPin:digest(jwk)};
}
test('authentic synthetic fixture verifies before hostile modifications',()=>{
  assert.equal(verifyEnvelope(original,digest(original.public_key_jwk)).schema,
    'musitu.axiom.b27.crosshost.synthetic.v1');
});
test('a validly signed but incorrect chain head is rejected independently of key trust',()=>{
  const {obj,expectedPin}=validlyResignedWrongPayload({
    record1:{...trusted.record1,head:'f'.repeat(64)}
  });
  assert.throws(()=>verifyEnvelope(obj,expectedPin),
    /B27_CROSSHOST_CHAIN_HEAD_MISMATCH/);
});
test('validly signed but disconnected action digest and event binding are rejected',()=>{
  const {obj,expectedPin}=validlyResignedWrongPayload({
    event:{...trusted.event,action:'arbitrary-replacement'}
  });
  assert.throws(()=>verifyEnvelope(obj,expectedPin),
    /B27_CROSSHOST_EVENT_DIGEST_MISMATCH/);
});
test('validly signed but forged record0 checkpoint cannot be accepted',()=>{
  const {obj,expectedPin}=validlyResignedWrongPayload({
    record0:{...trusted.record0,head:'f'.repeat(64)}
  });
  assert.throws(()=>verifyEnvelope(obj,expectedPin),
    /B27_CROSSHOST_PREDECESSOR_MISMATCH/);
});
test('validly signed but mismatched action commitment is refused',()=>{
  const {obj,expectedPin}=validlyResignedWrongPayload({
    record1:{...trusted.record1,action_sha256:'f'.repeat(64)}
  });
  assert.throws(()=>verifyEnvelope(obj,expectedPin),
    /B27_CROSSHOST_ACTION_COMMITMENT_MISMATCH/);
});
