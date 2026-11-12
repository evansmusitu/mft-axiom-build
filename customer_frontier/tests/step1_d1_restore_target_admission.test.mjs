import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {verifyApproval,verifyEmptyTarget,SOURCE_ACCOUNT,SOURCE_D1,OAUTH_DR_RESERVED,NoGo} from '../qualification/step1_d1_restore_target_admission.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const key=()=>{
  const kp=generateKeyPairSync('ed25519');
  const der=kp.publicKey.export({format:'der',type:'spki'});
  return {privateKey:kp.privateKey,der,pin:sha(der)};
};
const owner=key(),custodian=key();
const issued='2026-11-12T00:00:00.000Z';
function makePlan(extra={}){
  return {schema:'musitu.axiom.step1.disposable-d1-creation-approval.v1',
    action:'CREATE_NEW_DISPOSABLE_D1_ONLY',source_account:SOURCE_ACCOUNT,source_database:SOURCE_D1,
    target_account:SOURCE_ACCOUNT,new_database_name:'axiom-idp-step1-disposable-restore-20261112-aabbccdd',
    issued_at:issued,expires_at:'2026-11-13T00:00:00.000Z',nonce:'a'.repeat(32),
    max_additional_spend_usd:0,existing_database_changes:false,production_changes:false,
    customer_data_restore_authorized:false,independent_restore_qualified:false,release_authority:false,...extra};
}
const signWith=(pair,payload)=>({public_key_spki_der_base64:pair.der.toString('base64'),
  signature_base64:sign(null,Buffer.from(payload),pair.privateKey).toString('base64')});
function approve(plan=makePlan(),both=[owner,custodian]){
  const payload=JSON.stringify(plan);
  return {payload,owner:signWith(both[0],payload),custodian:signWith(both[1],payload),
    ownerTrustedSpkiSha256:owner.pin,custodianTrustedSpkiSha256:custodian.pin,now:'2026-11-12T12:00:00.000Z'};
}
const check=fn=>assert.throws(fn,e=>e instanceof NoGo);
test('two distinct pinned Ed25519 signatures still never authorize creation/restore/release',()=>{
  const r=verifyApproval(approve());
  assert.equal(r.status,'PINNED_TWO_SIGNATURES_VALID_CUSTODY_NOT_ATTESTED_NO_GO');
  assert.equal(r.creation_authorized,false);
  assert.equal(r.human_custody_independence_verified,false);
  for(const f of ['backup_export_authorized','customer_data_restore_authorized','current_backup_qualified','independent_restore_qualified','step_1_closed','step_2_authorized','release_authority'])assert.equal(r[f],false);
});
test('no trusted pins: deny even with genuine signatures',()=>check(()=>verifyApproval({...approve(),ownerTrustedSpkiSha256:undefined})));
test('self-signed operator as custodian: no independent trusted key',()=>check(()=>verifyApproval({...approve(makePlan(),[owner,owner])})));
test('different unpinned key cannot impersonate custodian',()=>check(()=>verifyApproval(approve(makePlan(),[owner,key()]))));
test('tampered signed approval fails',()=>{const args=approve();args.payload=args.payload.replace('aabbccdd','deadbeef');check(()=>verifyApproval(args))});
test('approved name cannot point to existing source D1 or generic OAuth target',()=>{
  check(()=>verifyApproval(approve(makePlan({new_database_name:'production-oauth'}))));
  check(()=>verifyApproval(approve(makePlan({source_database:OAUTH_DR_RESERVED}))));
});
test('no paid changes, source writes or backfill permitted',()=>{
  for(const x of [{max_additional_spend_usd:0.01},{existing_database_changes:true},{customer_data_restore_authorized:true},{production_changes:true},{release_authority:true}])check(()=>verifyApproval(approve(makePlan(x))));
});
test('bad clock and expiry rejected',()=>{
  check(()=>verifyApproval({...approve(),now:'2026-11-14T00:00:00.000Z'}));
  check(()=>verifyApproval({...approve(),now:'2026-11-11T00:00:00.000Z'}));
  check(()=>verifyApproval(approve(makePlan({expires_at:'2026-11-30T00:00:00.000Z'}))));
});
test('unreviewed injected fields rejected',()=>check(()=>verifyApproval(approve(makePlan({override_security:true})))));
const safeTarget='11111111-2222-4333-8444-555555555555';
const sourceMetadata={uuid:SOURCE_D1,account:SOURCE_ACCOUNT};
const targetMetadata={uuid:safeTarget,account:SOURCE_ACCOUNT,
  name:'axiom-idp-step1-disposable-restore-20261112-aabbccdd',num_tables:0,file_size:12288};
const workers=[{id:'musitu-axiom-customer-staging'},{id:'other-worker'}];
const workerSettings={'musitu-axiom-customer-staging':{bindings:[]},'other-worker':{bindings:[]}};
const verify=(t=targetMetadata,w=workerSettings,s=sourceMetadata)=>verifyEmptyTarget({sourceMetadata:s,targetMetadata:t,workers,workerSettings:w});
test('empty, unbound metadata only is explicitly not a restore acceptance',()=>{
  const r=verify();assert.equal(r.worker_consumers,0);
  for(const f of ['source_data_backup_qualified','independent_owner_approval_verified','step_1_closed','step_2_authorized','release_authority'])assert.equal(r[f],false);
});
test('source database and OAuth-only DR database never accepted',()=>{
  for(const uuid of [SOURCE_D1,OAUTH_DR_RESERVED])check(()=>verify({...targetMetadata,uuid}));
});
test('untrustworthy listing zeros cannot override detail schema',()=>check(()=>verify({...targetMetadata,num_tables:25})));
test('target already bound to a Worker is not disposable',()=>check(()=>verify(targetMetadata,{...workerSettings,'other-worker':{bindings:[{type:'d1',id:safeTarget}]}})));
test('missing Worker settings fail closed',()=>check(()=>verify(targetMetadata,{'other-worker':{bindings:[]}})));
test('source account drift fails closed',()=>check(()=>verify(targetMetadata,workerSettings,{...sourceMetadata,account:'other'})));
