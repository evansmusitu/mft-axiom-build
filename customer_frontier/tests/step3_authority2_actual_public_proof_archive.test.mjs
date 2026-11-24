// Actual returned public signature; archival reproducibility only, no signer/CI secret.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {verifyPossessionProof,canonical} from '../qualification/step3_authority2_signer_possession.mjs';
const base=new URL('../evidence/gate3_security_20261114/',import.meta.url);
const dir=new URL('authority2_owner_possession_20261124/',base);
const bytes=readFileSync(new URL('OWNER_A2_SIGNER_POSSESSION_PROOF.json',dir));
const proof=JSON.parse(bytes),challengeBytes=readFileSync(new URL('ISSUED_CHALLENGE.json',dir)),challenge=JSON.parse(challengeBytes);
const receipt=JSON.parse(readFileSync(new URL('VERIFICATION_RECEIPT.json',dir)));
const der=readFileSync(new URL('authority2_signer_possession_20261116/owner_ed25519_spki.der',base));
const sha=value=>createHash('sha256').update(value).digest('hex');
const context={challenge,expectedDer:der,nowMs:Date.parse(receipt.verified_at_utc)};
test('actual upload and independently issued challenge remain byte-exact',()=>{
 assert.equal(bytes.length,1166);assert.equal(sha(bytes),'aed75f46b6d207ab8cea730baa25718af9f3c5fed85bf37c515c035aae2302d7');
 assert.equal(sha(challengeBytes),'cb28ecbfb1ba9167737ee18c9933cc94c7e56df599139fc24bbeccffb2890ee4');
 assert.equal(sha(der),'6792c82b245cd45051052cc1b00eb5f99a99489829c3f0567c7c15f741389d8a');
 assert.equal(receipt.proof_sha256,sha(bytes));assert.equal(receipt.issued_challenge_sha256,sha(challengeBytes));
});
test('actual owner signature verifies at the recorded original fresh acceptance time',()=>{
 const r=verifyPossessionProof(proof,context);assert.equal(r.matching_private_key_possession_verified,true);
 assert.equal(r.hosted_custody_qualified,false);assert.equal(r.gate3_closed,false);assert.equal(r.release_status,'NOT_RELEASE');
 assert(Date.parse(proof.statement.signed_at_utc)<=context.nowMs);assert(context.nowMs<Date.parse(challenge.expires_at_utc));
});
test('altered challenge or signature cannot reuse this actual archived proof',()=>{
 const changed=structuredClone(proof);changed.statement.challenge.challenge_id='0'.repeat(64);
 assert.throws(()=>verifyPossessionProof(changed,context),/ISSUED_CHALLENGE_MISMATCH/);
 const bad=structuredClone(proof);bad.signature_base64url='A'.repeat(86);
 assert.throws(()=>verifyPossessionProof(bad,context),/SIGNATURE_INVALID|INVALID_SIGNATURE_ENCODING/);
});
test('a later expired verification cannot be promoted into a newly fresh proof',()=>{
 assert.throws(()=>verifyPossessionProof(proof,{...context,nowMs:Date.parse(challenge.expires_at_utc)+1}),/CHALLENGE_EXPIRED/);
});
test('actual possession signature does not verify without its dedicated domain',()=>{
 assert.equal(verify(null,Buffer.from(canonical(proof.statement)+'\n'),createPublicKey({key:der,format:'der',type:'spki'}),Buffer.from(proof.signature_base64url,'base64url')),false);
});
test('current records resolve possession while retaining every hosted/custody/release hold',()=>{
 const current=JSON.parse(readFileSync(new URL('GATE3_CURRENT_20261114_NOT_RELEASE.json',base)));
 const external=JSON.parse(readFileSync(new URL('gate3_remaining_external_acceptance_inputs_20261115.json',base)));
 assert.equal(current.authority2_offline_possession_check.actual_owner_proof_verified,true);
 assert.equal(external.next_owner_input.answer_received,true);assert.equal(external.offline_possession_challenge.possession_verified,true);
 for(const field of ['gate3_closed','b27_global_nonrollback_verified','hosted_authority_nonce_recovery_qualified','independent_administrator_separation_qualified',
  'builder_admin_credential_revocation_verified','authority2_signer_custody_qualified','authority2_once_only_genesis_qualified','authority2_real_destructive_recovery_qualified','independent_security_review_approved'])assert.equal(current[field],false,field);
 assert.equal(current.gate2_closed,true);assert.equal(current.release_status,'NOT_RELEASE');assert.equal(current.pr1_separate_draft_unmerged,true);
 assert.equal(receipt.B27,'FAILED_IN_SYNTHETIC_ATTACK');assert.equal(receipt.parity_superiority,'NOT_CERTIFIED');assert.equal(receipt.unavailable_final_usage,'UNKNOWN');
 assert.equal(receipt.private_key_or_passphrase_obtained,false);assert.equal(receipt.owner_pc_execution_independently_attested,false);
});
