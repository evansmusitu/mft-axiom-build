import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {verifyOwnerProposal,OwnerPolicyNoGo,PROPOSAL_SCHEMA,SOURCE_D1,SOURCE_ACCOUNT,AMENDMENT_SHA256} from '../qualification/step1_owner_control_policy_candidate.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const owner=generateKeyPairSync('ed25519');
const ownerDer=owner.publicKey.export({format:'der',type:'spki'});
const ownerPin=sha(ownerDer);
const x25519Recipient=generateKeyPairSync('x25519');
const recipientPin=sha(x25519Recipient.publicKey.export({format:'der',type:'spki'}));
function makePlan(extra={}) {return {
 schema:PROPOSAL_SCHEMA,action:'PROPOSE_NEW_DISPOSABLE_D1_ONLY',
 governance_amendment_sha256:AMENDMENT_SHA256,source_account:SOURCE_ACCOUNT,source_database:SOURCE_D1,
 target_account:SOURCE_ACCOUNT,new_database_name:'axiom-idp-step1-disposable-restore-20261112-aabbccdd',
 owner_encryption_recipient_spki_sha256:recipientPin,
 issued_at:'2026-11-12T12:00:00.000Z',expires_at:'2026-11-13T12:00:00.000Z',nonce:'a'.repeat(32),
 max_additional_spend_usd:0,existing_database_changes:false,customer_data_export_authorized:false,
 customer_data_restore_authorized:false,production_changes:false,step_2_authorized:false,
 independent_custodian_mandatory:false,owner_accepts_sole_custody_risk:true,
 historical_independent_custody_result:'UNMET_POLICY_SUPERSEDED_NOT_PASS',b27_synthetic_cas_result:'FAIL',
 pr83_fullstack_result:'FAIL',release_status:'NOT_RELEASE',...extra};}
function args(p=makePlan()) {
 const payload=JSON.stringify(p);
 return {payload,owner:{public_key_spki_der_base64:ownerDer.toString('base64'),
  signature_base64:sign(null,Buffer.from(payload),owner.privateKey).toString('base64')},
  trustedOwnerSpkiSha256:ownerPin,trustedOwnerRecipientSpkiSha256:recipientPin,
  now:'2026-11-12T17:00:00.000Z'};
}
function denied(a) {assert.throws(()=>verifyOwnerProposal(a),e=>e instanceof OwnerPolicyNoGo);}
test('genuine owner signature is a policy PROPOSAL only; never live D1 authorization',()=>{
 const r=verifyOwnerProposal(args());
 assert.equal(r.owner_policy_proposal_signature_valid,true);
 assert.equal(r.historical_independence_test_passed,false);
 assert.equal(r.release_status,'NOT_RELEASE');
 for(const k of ['human_identity_mfa_qualified','current_cloudflare_credential_control_qualified',
 'owner_encryption_key_custody_qualified','independent_current_backup_qualified',
 'provider_zero_additional_spend_qualified','durable_nonce_consumption_qualified',
 'exact_target_absence_confirmed','disposable_target_creation_authorized','customer_sql_export_authorized',
 'customer_sql_restore_authorized','hosted_restore_parity_qualified','tenant_isolation_qualified',
 'step_1_closed','step_2_authorized','release_authorized']) assert.equal(r[k],false,k);
 assert.equal(r.b27_synthetic_cas,'FAIL'); assert.equal(r.pr83_fullstack,'FAIL');
});
test('unsigned and missing trusted pin deny',()=>{
 denied({...args(),owner:undefined}); denied({...args(),trustedOwnerSpkiSha256:undefined});
 denied({...args(),trustedOwnerRecipientSpkiSha256:undefined});
});
test('a forged owner public key cannot replace pinned identity',()=>{
 const other=generateKeyPairSync('ed25519');const a=args();const der=other.publicKey.export({format:'der',type:'spki'});
 denied({...a,owner:{public_key_spki_der_base64:der.toString('base64'),
  signature_base64:sign(null,Buffer.from(a.payload),other.privateKey).toString('base64')}});
});
test('signed plan mutation without re-signing denies',()=>{
 const a=args();denied({...a,payload:a.payload.replace('aabbccdd','deadbeef')});
});
test('owner cannot silently change previous security failure results',()=>{
 for(const delta of [{b27_synthetic_cas_result:'PASS'},{pr83_fullstack_result:'PASS'},
 {historical_independent_custody_result:'PASS'},{release_status:'RELEASE'},
 {independent_custodian_mandatory:true},{owner_accepts_sole_custody_risk:false}])denied(args(makePlan(delta)));
});
test('new policy cannot rewrite predecessor amendment SHA',()=>denied(args(makePlan({governance_amendment_sha256:'0'.repeat(64)}))));
test('source account, source D1, new target name cannot be changed',()=>{
 for(const delta of [{source_database:'deadbeef'},{source_account:'other'},{target_account:'other'},
 {new_database_name:'old-production-db'},{new_database_name:'production-oauth'}])denied(args(makePlan(delta)));
});
test('no nonzero spend, live data export or production effect',()=>{
 for(const delta of [{max_additional_spend_usd:0.001},{existing_database_changes:true},
 {customer_data_export_authorized:true},{customer_data_restore_authorized:true},
 {production_changes:true},{step_2_authorized:true}])denied(args(makePlan(delta)));
});
test('recipient encryption key must match external trusted pin',()=>{
 denied({...args(),trustedOwnerRecipientSpkiSha256:'0'.repeat(64)});
 denied(args(makePlan({owner_encryption_recipient_spki_sha256:'0'.repeat(64)})));
});
test('missing or extra policy fields deny',()=>{
 denied(args(makePlan({ignore_security:true})));
 const p=makePlan();delete p.release_status;denied(args(p));
});
test('duplicate or noncanonical plan JSON denies even if signed',()=>{
 const a=args();const payload=a.payload.replace('"action":','"action":"FAKE","action":');
 const dupe={...a,payload,owner:{...a.owner,signature_base64:sign(null,Buffer.from(payload),owner.privateKey).toString('base64')}};
 denied(dupe);
});
test('expired, future, and overlong authorization windows deny',()=>{
 denied({...args(),now:'2026-11-13T12:00:00.000Z'});
 denied({...args(),now:'2026-11-12T11:59:59.999Z'});
 denied(args(makePlan({expires_at:'2026-11-15T12:00:00.000Z'})));
});
test('invalid nonce and unknown action deny',()=>{
 denied(args(makePlan({nonce:'broken'})));
 denied(args(makePlan({action:'DELETE_SOURCE_DATABASE'})));
});
