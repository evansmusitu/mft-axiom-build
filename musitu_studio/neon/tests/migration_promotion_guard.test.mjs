import test from 'node:test';
import assert from 'node:assert/strict';
import {attestStudioLedgerSnapshot} from '../ledger_reconcile.mjs';
import {assertStudioNeonPromotionEvidence,guardedStudioNeonPromotion,
  STUDIO_NEON_REQUIRED_GATES} from '../migration_promotion_guard.mjs';
const sha='a'.repeat(40),hex='b'.repeat(64),now=()=>new Date().toISOString();
const copy=x=>structuredClone(x);
function proof(){
 const counts={projects:1,memberships:1,jobs:1,assets:3,audit_events:1};
 const table_hmac=Object.fromEntries(Object.keys(counts).map(x=>[x,hex]));
 const r={schema:'musitu.studio.v03.neon.ledger-attestation.v2',verified:true,complete:true,freeze_id:'freeze-20261022-synthetic',counts,table_hmac};
 return {source_head:sha,run_id:'synthetic-proof-20261022',checked_at:now(),freeze_id:r.freeze_id,
 source_receipt:copy(r),target_receipt:copy(r),
 // These values are synthetic fixtures; production requires *independent*
 // signature/provider verification by verifyProviderReceipts before canary CAS.
 r2_content_receipt:{schema:'musitu.studio.v03.r2-content-receipt.v1',complete:true,
  verified:true,freeze_id:r.freeze_id,objects_verified:3,bytes_verified:3400,
  assets_table_hmac:hex,content_hmac:'c'.repeat(64),provider_verified:false,
  customer_bytes_logged:false,cutover_authorized:false},
 r2_provider_attestation:{schema:'musitu.studio.v03.r2-provider-attestation.v1',
  provider:'cloudflare-r2',receipt_id:'synthetic-r2-provider-proof-20261024',
  provider_receipt_verified:true,verified:true,read_only:true,
  versions_pinned:true,source_freeze_bound:true,source_head:sha,
  freeze_id:r.freeze_id,objects_verified:3,bytes_verified:3400,
  bucket_id_sha256:'e'.repeat(64),content_hmac:'c'.repeat(64),checked_at:now()},
 gates:STUDIO_NEON_REQUIRED_GATES.map(name=>({name,provider:'unit-fixture',
 receipt_id:'synthetic-'+name,checked_at:now(),verified:true,provider_receipt_verified:true})),
 cloudflare_database_of_record:'SQLITE_DO',neon_project_is_synthetic_proof:false,
 cpu_enabled:false,gpu_enabled:false,
 channel:{block_public_connections:true,least_privilege:true,private_path_independently_verified:true},
 billing:{neon_spend_control_kind:'provider-hard-stop',neon_alert_only:false,
 neon_organization_hard_spend_enforced:true,modal_zero_out_of_pocket_enforced:true,
 project_quotas_not_used_as_spend_proof:true},
 rollback:{cloudflare_sqlite_intact:true,restore_pretested:true,snapshot_of_imported_neon_restored:true}};
}
function adapter(p=proof(),flags={},nonceRegistry=new Set()){
 let route='SQLITE_DO',flips=0,release=0,reads=0,held=false,signedChecks=0;
 let nonceClaims=0,providerCalls=0;
 const f={expectedHead:sha,
 async exclusiveLease(){if(held||flags.leaseHeld)return {acquired:false};
 held=true;return {acquired:true,fencing_token:'canary-fence-20261025-00001',
  assertHeld:async()=>flags.fencingLost!==true,
  release:async()=>{held=false;release++;if(flags.releaseFails)throw Error('SIMULATED_RELEASE_LOST')}}},
 async readRoute(){return route},
 async readEvidence(){reads++;if(flags.changedDigestSameEpoch&&reads===2){let x=copy(p);x.target_receipt.table_hmac.jobs='d'.repeat(64);x.source_receipt.table_hmac.jobs='d'.repeat(64);return x}if(flags.changedEpoch&&reads===2){let x=copy(p);x.run_id='different-evidence-id-20261022';return x}return copy(p)},
 async verifyProviderReceipts(){providerCalls++;
  if(flags.delayProviderAfterNonceMs&&nonceClaims>0)
   await new Promise(done=>setTimeout(done,flags.delayProviderAfterNonceMs));
  return flags.unverified!==true&&!(flags.providerRevokedAfterNonce&&nonceClaims>0)},
 async verifySignedR2VersionEvidence(){signedChecks++;return flags.unsignedR2!==true&&
  !(flags.r2SignerRevokedOnSecondCheck&&signedChecks>=2)&&
  !(flags.r2SignerRevokedImmediatelyBeforeCanary&&signedChecks>=3)},
 async verifyTargetWriteBarrier(info){
  if(flags.targetWriteBarrierLost||flags.targetWriteBarrierLostAfterNonce&&nonceClaims>0||
     flags.targetLostDuringFinalProvider&&providerCalls>=3||
     (flags.targetBarrierLostAfterCanary&&route==='NEON_CANARY_READONLY'))
    return {verified:false};
  return {verified:true,provider_receipt_verified:true,read_only:true,
    writes_blocked:true,freeze_id:info.freeze_id,
    expires_at:new Date(Date.now()+120000).toISOString()};
 },
 async verifyCurrentSourceFreeze(info){
  if(flags.freezeGone||flags.freezeGoneAfterNonce&&nonceClaims>0||
   flags.freezeLostDuringFinalProvider&&providerCalls>=3)return {verified:false};
  if(flags.freezeGoesAwayAfterCutover&&route==='NEON_CANARY_READONLY')return {verified:false};
  return {verified:true,provider_receipt_verified:true,freeze_id:info.freeze_id,
   triggers_verified:15,expires_at:new Date(Date.now()+120000).toISOString()};
 },
 async compareAndSwapRoute(from,to){
  if((flags.rollbackFails||flags.canaryReturnFails)&&from==='NEON_CANARY_READONLY')return false;
  if(flags.casFails&&from==='SQLITE_DO')return false;
  if(route!==from)return false;
  route=to;flips++;
  if(flags.ackLost&&to==='NEON_CANARY_READONLY')throw Error('PROVIDER_ACK_LOST');
  return true;
 },
 async verifySignedBrowser(info){
  if(flags.browserReturnsBoolean)return true;
  if(flags.browserFails||flags.browserFailsAfterCanary&&route==='NEON_CANARY_READONLY')
    return {verified:false};
  const right={verified:true,provider_signature_verified:true,
   owner_authenticated:true,owner_role:'owner',scope:'studio-v03-neon-readonly-canary',
   source_head:info.source_head,freeze_id:info.freeze_id,run_id:info.run_id,
   receipt_id:'synthetic-owner-browser-acceptance-20261024',
   checked_at:new Date().toISOString(),expires_at:new Date(Date.now()+120000).toISOString()};
  if(flags.browserExpired)right.expires_at=new Date(Date.now()-1000).toISOString();
  if(flags.browserExpiresDuringNonce)right.expires_at=new Date(Date.now()+15100).toISOString();
  if(flags.browserBeyondMaximum)right.expires_at=new Date(Date.now()+600000).toISOString();
  if(flags.browserStale)right.checked_at=new Date(Date.now()-600000).toISOString();
  if(flags.browserAmbiguousTime)right.checked_at='2026-10-24 20:55:00';
  if(flags.browserInvertedValidity){right.checked_at=new Date(Date.now()+26000).toISOString();right.expires_at=new Date(Date.now()+16000).toISOString();}
  if(flags.browserWrongHead)right.source_head='f'.repeat(40);
  if(flags.browserWrongScope)right.scope='studio-v03-neon-write-cutover';
  if(flags.browserSignatureMissing)right.provider_signature_verified=false;
  if(flags.browserOwnerRoleMissing)right.owner_role='viewer';
  if(flags.browserReceiptChangedAfterCanary&&route==='NEON_CANARY_READONLY')
    right.receipt_id='synthetic-other-owner-browser-approval';
  return right;
 },
 async reserveCanaryNonce(info){
  nonceClaims++;
  if(flags.browserExpiresDuringNonce)await new Promise(done=>setTimeout(done,200));
  if(flags.delayNonceMs)await new Promise(done=>setTimeout(done,flags.delayNonceMs));
  if(flags.nonceServiceUnavailable)throw Error('provider-unavailable');
  if(flags.nonceInvalidAck)return {durable:true,unique:true};
  const nonce=info.r2_receipt_id+':'+info.run_id;
  if(nonceRegistry.has(nonce))return {durable:true,unique:false,nonce};
  nonceRegistry.add(nonce);
  return {durable:true,unique:true,nonce,source_head:info.source_head,
    freeze_id:info.freeze_id,run_id:info.run_id,
    r2_receipt_id:info.r2_receipt_id,
    owner_receipt_id:info.owner_receipt_id};
 },
 async verifyReconciledTarget(){return !flags.readbackFails}};
 return {f,state:()=>({route,flips,release,reads}),nonceClaims:()=>nonceClaims};
}
const bad=(e,regex)=>assert.throws(()=>assertStudioNeonPromotionEvidence(e,{expectedHead:sha}),regex);
test('sixteen required gates and five exact HMAC tables',()=>{
 const e=proof();assert.equal(assertStudioNeonPromotionEvidence(e,{expectedHead:sha}).gate_count,16);
 const m=proof();m.gates.pop();bad(m,/STUDIO_MISSING_PROVIDER_GATES/);
 const r=proof();r.target_receipt.counts.audit_events=0;bad(r,/STUDIO_SOURCE_TARGET_MISMATCH_AUDIT_EVENTS/);
 const h=proof();h.target_receipt.table_hmac.assets='c'.repeat(64);bad(h,/STUDIO_SOURCE_TARGET_MISMATCH_ASSETS/);
});
test('rejects synthetic flags, stale receipts, duplicate gates and head mismatch',()=>{
 const s=proof();s.gates[0].synthetic=true;bad(s,/STUDIO_UNVERIFIED_GATE/);
 const t=proof();t.checked_at='2026-01-01T00:00:00Z';bad(t,/STUDIO_EVIDENCE_STALE/);
 const d=proof();d.gates[1].name=d.gates[0].name;bad(d,/STUDIO_GATE_DUPLICATE_OR_UNKNOWN/);
 const h=proof();h.source_head='f'.repeat(40);bad(h,/STUDIO_SOURCE_HEAD_CHANGED/);
});
test('rejects no protected transport, unenforced spend, unproven recovery or render dispatch',()=>{
 const x=proof();x.channel.block_public_connections=false;bad(x,/STUDIO_PROTECTED_NEON_TRANSPORT/);
 const y=proof();y.billing.neon_organization_hard_spend_enforced=false;bad(y,/STUDIO_SPENDING_GATE/);
 const z=proof();z.rollback.snapshot_of_imported_neon_restored=false;bad(z,/STUDIO_RECOVERY_GATE/);
 const q=proof();q.cpu_enabled=true;bad(q,/STUDIO_LIVE_TOPOLOGY/);
});
test('qualified mock requires two independent fresh attestations and CAS',async()=>{
 const x=adapter(),r=await guardedStudioNeonPromotion(x.f);
 assert.equal(r.promoted,false);assert.equal(r.canary,true);assert.equal(r.write_activation,false);assert.equal(r.rendering_enabled,false);
 assert.deepEqual(x.state(),{route:'SQLITE_DO',flips:2,release:1,reads:2});
});
test('missing real provider receipts denies promotion before switching',async()=>{
 const x=adapter(proof(),{unverified:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_PROVIDER_RECEIPTS_NOT_INDEPENDENTLY_VERIFIED/);
 assert.equal(x.state().flips,0);
});
test('fresh evidence epoch mismatch aborts without switching',async()=>{
 const x=adapter(proof(),{changedEpoch:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_EVIDENCE_EPOCH_CHANGED/);
 assert.equal(x.state().flips,0);
});
test('signed browser failed after switch: restores the intact SQLite route',async()=>{
 const x=adapter(proof(),{browserFailsAfterCanary:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_POSTCUTOVER_PROOF_FAILED/);
 assert.deepEqual(x.state(),{route:'SQLITE_DO',flips:2,release:1,reads:2});
});
test('reconciled target postcheck failure also triggers rollback',async()=>{
 const x=adapter(proof(),{readbackFails:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_POSTCUTOVER_PROOF_FAILED/);
 assert.equal(x.state().route,'SQLITE_DO');
});
test('CAS applies but acknowledgement is lost: readback and rollback',async()=>{
 const x=adapter(proof(),{ackLost:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/PROVIDER_ACK_LOST/);
 assert.equal(x.state().route,'SQLITE_DO');assert.equal(x.state().flips,2);
});
test('failed rollback is critical, never falsely reported as safe',async()=>{
 const x=adapter(proof(),{browserFailsAfterCanary:true,rollbackFails:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_CRITICAL_ROUTE_UNVERIFIED_LEASE_HELD/);
 assert.equal(x.state().route,'NEON_CANARY_READONLY');assert.equal(x.state().release,0);
});
test('exclusive lease refuses another promotion attempt',async()=>{
 const x=adapter(proof(),{leaseHeld:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_EXCLUSIVE_LEASE_REQUIRED/);
 assert.equal(x.state().flips,0);assert.equal(x.state().release,0);
});
test('stale CAS cannot silently flip backend',async()=>{
 const x=adapter(proof(),{casFails:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_NEON_ROUTE_CAS_REJECTED/);
 assert.equal(x.state().route,'SQLITE_DO');
});

test('rejects evidence digest refresh under the same run ID',async()=>{
 const x=adapter(proof(),{changedDigestSameEpoch:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_EVIDENCE_CHANGED_DURING_PROMOTION/);
 assert.equal(x.state().route,'SQLITE_DO');
 assert.equal(x.state().flips,0);
});
test('rejects omitted synthetic-proof declaration and mismatched attestation schema',()=>{
 const e=proof();delete e.neon_project_is_synthetic_proof;
 bad(e,/STUDIO_LIVE_TOPOLOGY_NOT_QUALIFIED/);
 const x=proof();delete x.target_receipt.schema;
 bad(x,/STUDIO_ALL_TABLE_RECEIPTS_REQUIRED/);
});
test('alerts are not a hard Neon spend cap even if boolean was asserted',()=>{
 const e=proof();e.billing.neon_spend_control_kind='email-alert-only';
 bad(e,/STUDIO_SPENDING_GATE_NOT_ENFORCED/);
 const x=proof();x.billing.neon_alert_only=true;
 bad(x,/STUDIO_SPENDING_GATE_NOT_ENFORCED/);
});
test('real reconciliation receipt schema produces matching independent attestation receipts',()=>{
 const input={complete:true,freeze_id:'freeze-consistent-provider-bundle',
  projects:[{id:'project-fixture',title:'Fixture only',owner_sub:'synthetic-owner',created_at:'2026-10-22T00:00:00Z'}],
  memberships:[{project_id:'project-fixture',member_sub:'synthetic-owner',role:'owner',created_at:'2026-10-22T00:00:00Z'}],
  jobs:[],assets:[],audit_events:[]};
 const hmacKey=new Uint8Array(32).fill(44);
 const r=attestStudioLedgerSnapshot(input,{integrityKey:hmacKey});
 const e=proof();e.source_receipt=r;e.target_receipt=structuredClone(r);e.freeze_id=r.freeze_id;
 e.r2_content_receipt.freeze_id=r.freeze_id;
 e.r2_content_receipt.objects_verified=0;
 e.r2_content_receipt.bytes_verified=0;
 e.r2_content_receipt.assets_table_hmac=r.table_hmac.assets;
 e.r2_provider_attestation.freeze_id=r.freeze_id;
 e.r2_provider_attestation.objects_verified=0;
 e.r2_provider_attestation.bytes_verified=0;
 assert.equal(assertStudioNeonPromotionEvidence(e,{expectedHead:sha}).qualified,true);
 e.target_receipt.table_hmac.projects='c'.repeat(64);
 bad(e,/STUDIO_SOURCE_TARGET_MISMATCH_PROJECTS/);
});

test('expired or absent live write-fence aborts BEFORE switching',async()=>{
 const x=adapter(proof(),{freezeGone:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_SOURCE_FREEZE_LIVE_PROBE_FAILED/);
 assert.equal(x.state().flips,0);assert.equal(x.state().route,'SQLITE_DO');
});
test('source fence lost after switch triggers rollback even with good browser proof',async()=>{
 const x=adapter(proof(),{freezeGoesAwayAfterCutover:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_SOURCE_FREEZE_LIVE_PROBE_FAILED/);
 assert.equal(x.state().route,'SQLITE_DO');assert.equal(x.state().flips,2);
});
test('lease-release acknowledgement lost after successful CAS must rollback',async()=>{
 const x=adapter(proof(),{releaseFails:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_LEASE_RELEASE_FAILED_SQLITE_SAFE/);
 assert.equal(x.state().route,'SQLITE_DO');assert.equal(x.state().flips,2);
});
test('lease-release failure and impossible rollback raises critical',async()=>{
 const x=adapter(proof(),{releaseFails:true,rollbackFails:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_CRITICAL_ROUTE_UNVERIFIED_LEASE_HELD/);
 assert.equal(x.state().route,'NEON_CANARY_READONLY');
 assert.equal(x.state().release,0);
});

test('read-write traffic is never routed to a canary backend',async()=>{
 const x=adapter();const result=await guardedStudioNeonPromotion(x.f);
 assert.equal(result.write_activation,false);
 assert.equal(result.route,'SQLITE_DO');
 assert.equal(result.promoted,false);
 assert.equal(x.state().route,'SQLITE_DO');
});
test('unverified destination write-barrier fails before any route change',async()=>{
 const x=adapter(proof(),{targetWriteBarrierLost:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_TARGET_WRITE_BARRIER_REQUIRED/);
 assert.equal(x.state().route,'SQLITE_DO');assert.equal(x.state().flips,0);
});
test('target write-barrier removal during canary triggers rollback',async()=>{
 const x=adapter(proof(),{targetBarrierLostAfterCanary:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_TARGET_WRITE_BARRIER_REQUIRED/);
 assert.equal(x.state().route,'SQLITE_DO');assert.equal(x.state().flips,2);
});

test('short-lived target barrier never leaves permanent read-only Neon routing',async()=>{
 const x=adapter();const result=await guardedStudioNeonPromotion(x.f);
 assert.equal(result.route,'SQLITE_DO');assert.equal(result.canary,true);
 assert.equal(result.promoted,false);assert.equal(result.write_activation,false);
 assert.equal(x.state().flips,2);
});
test('unable to restore original SQLite route after canary is critical',async()=>{
 const x=adapter(proof(),{canaryReturnFails:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_CRITICAL_ROUTE_UNVERIFIED_LEASE_HELD/);
 assert.equal(x.state().route,'NEON_CANARY_READONLY');
 assert.equal(x.state().release,0);
});

// Inability to return from a read-only canary is a CRITICAL stuck-route state.
// Releasing the exclusive lease would allow a second promotion while Neon
// still serves traffic, and must be forbidden even if browser checks passed.
test('stuck canary return preserves the migration lease for manual recovery',async()=>{
 const x=adapter(proof(),{canaryReturnFails:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_CRITICAL_ROLLBACK_FAILED|STUDIO_CRITICAL_ROUTE_UNVERIFIED_LEASE_HELD/);
 assert.equal(x.state().route,'NEON_CANARY_READONLY');
 assert.equal(x.state().release,0);
});

// A metadata-only check that each object *reference* exists is insufficient:
// production canary must be bound to independently verified R2 content bytes.
test('metadata-only R2 references can never qualify a production read-only canary',()=>{
 const x=proof(); delete x.r2_content_receipt;
 bad(x,/STUDIO_R2_CONTENT_RECEIPT_REQUIRED/);
 const y=proof(); delete y.r2_provider_attestation;
 bad(y,/STUDIO_R2_PROVIDER_ATTESTATION_REQUIRED/);
});
test('R2 content proof must cover all frozen asset references and their HMAC',()=>{
 const less=proof();less.r2_content_receipt.objects_verified=2;
 bad(less,/STUDIO_R2_CONTENT_RECEIPT_INVALID/);
 const h=proof();h.r2_content_receipt.assets_table_hmac='d'.repeat(64);
 bad(h,/STUDIO_R2_CONTENT_RECEIPT_ASSETS_MISMATCH/);
 const freeze=proof();freeze.r2_content_receipt.freeze_id='another-freeze-id';
 bad(freeze,/STUDIO_R2_CONTENT_RECEIPT_FREEZE_MISMATCH/);
 const b=proof();b.r2_content_receipt.bytes_verified=0;
 bad(b,/STUDIO_R2_CONTENT_RECEIPT_INVALID/);
});
test('offline R2 proof never impersonates live provider receipt',()=>{
 const x=proof();x.r2_content_receipt.provider_verified=true;
 bad(x,/STUDIO_R2_CONTENT_RECEIPT_INVALID/);
 const y=proof();y.r2_provider_attestation.versions_pinned=false;
 bad(y,/STUDIO_R2_PROVIDER_ATTESTATION_INVALID/);
 const z=proof();z.r2_provider_attestation.source_freeze_bound=false;
 bad(z,/STUDIO_R2_PROVIDER_ATTESTATION_INVALID/);
});
test('provider attestation must pin content HMAC, freeze and exact source revision',()=>{
 const h=proof();h.r2_provider_attestation.content_hmac='f'.repeat(64);
 bad(h,/STUDIO_R2_PROVIDER_ATTESTATION_CONTENT_MISMATCH/);
 const f=proof();f.r2_provider_attestation.freeze_id='wrong-frozen-source';
 bad(f,/STUDIO_R2_PROVIDER_ATTESTATION_FREEZE_MISMATCH/);
 const x=proof();x.r2_provider_attestation.source_head='b'.repeat(40);
 bad(x,/STUDIO_R2_PROVIDER_ATTESTATION_SOURCE_HEAD_MISMATCH/);
 const stale=proof();stale.r2_provider_attestation.checked_at='2026-01-01T00:00:00Z';
 bad(stale,/STUDIO_R2_PROVIDER_ATTESTATION_STALE/);
});
test('missing actual R2 content fails before any CAS even if callback claims verified',async()=>{
 const p=proof();delete p.r2_content_receipt;
 const a=adapter(p);
 await assert.rejects(()=>guardedStudioNeonPromotion(a.f),/STUDIO_R2_CONTENT_RECEIPT_REQUIRED/);
 assert.equal(a.state().flips,0);
});

test('signed owner browser approval must exist BEFORE any canary routing',async()=>{
 const x=adapter(proof(),{browserFails:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_OWNER_BROWSER_APPROVAL_REQUIRED/);
 assert.deepEqual(x.state(),{route:'SQLITE_DO',flips:0,release:1,reads:2});
});

test('owner acceptance must be scoped, signature-verified, and bound to exact head before routing',async()=>{
 for(const flag of ['browserWrongHead','browserWrongScope','browserSignatureMissing','browserOwnerRoleMissing']){
  const x=adapter(proof(),{[flag]:true});
  await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_OWNER_BROWSER_APPROVAL_REQUIRED/);
  assert.equal(x.state().flips,0,flag);
 }
});
test('owner acceptance change during canary is a rollback incident',async()=>{
 const x=adapter(proof(),{browserReceiptChangedAfterCanary:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_POSTCUTOVER_PROOF_FAILED/);
 assert.equal(x.state().route,'SQLITE_DO');assert.equal(x.state().flips,2);
});

test('boolean claims, expired approvals and unverifiable browser clock never qualify',async()=>{
 for(const flag of ['browserReturnsBoolean','browserExpired','browserBeyondMaximum','browserStale','browserAmbiguousTime','browserInvertedValidity']){
  const x=adapter(proof(),{[flag]:true});
  await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_OWNER_BROWSER_APPROVAL_REQUIRED/,flag);
  assert.equal(x.state().flips,0,flag);
 }
});

test('dedicated signed R2 version proof must be verified before any canary route change',async()=>{
 const x=adapter(proof(),{unsignedR2:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_R2_SIGNED_VERSION_PROOF_REQUIRED/);
 assert.equal(x.state().flips,0);
});
test('missing cryptographic version-verifier callback is never silently optional',async()=>{
 const x=adapter();delete x.f.verifySignedR2VersionEvidence;
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_CONTROL_PLANE_INVALID_verifySignedR2VersionEvidence/);
 assert.equal(x.state().flips,0);
});

test('revoked signer between first and second signed proof denies route CAS',async()=>{
 const x=adapter(proof(),{r2SignerRevokedOnSecondCheck:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_R2_SIGNED_VERSION_PROOF_REQUIRED/);
 assert.equal(x.state().flips,0);
});

// A transiently valid provider receipt cannot be replayed by a second
// operator once a durable nonce has been consumed; the reservation is
// mandatory and occurs before the *first* canary route CAS.
test('missing durable nonce reservation callback fails closed before canary',async()=>{
 const x=adapter();delete x.f.reserveCanaryNonce;
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_CONTROL_PLANE_INVALID_reserveCanaryNonce/);
 assert.equal(x.state().flips,0);
});
test('nonce registry read failure and malformed acknowledgement block route CAS',async()=>{
 for(const flag of ['nonceServiceUnavailable','nonceInvalidAck']){
  const x=adapter(proof(),{[flag]:true});
  await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_ATTESTATION_NONCE_NOT_DURABLY_RESERVED|provider-unavailable/);
  assert.equal(x.state().flips,0,flag);
 }
});
test('same provider R2 receipt and run cannot authorize second canary operation',async()=>{
 const store=new Set();
 const one=adapter(proof(),{},store);
 assert.equal((await guardedStudioNeonPromotion(one.f)).route,'SQLITE_DO');
 const two=adapter(proof(),{},store);
 await assert.rejects(()=>guardedStudioNeonPromotion(two.f),/STUDIO_ATTESTATION_NONCE_NOT_DURABLY_RESERVED/);
 assert.equal(two.state().flips,0);
 assert.equal(two.state().release,1);
});
test('a wrong nonce or owner receipt binding fails before any route modification',async()=>{
 const x=adapter();x.f.reserveCanaryNonce=async()=>({durable:true,unique:true,
  nonce:'made-up',source_head:sha,freeze_id:'wrong',run_id:'wrong',
  r2_receipt_id:'wrong',owner_receipt_id:'wrong'});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_ATTESTATION_NONCE_NOT_DURABLY_RESERVED/);
 assert.equal(x.state().flips,0);
});

// Independent provider conditions can expire while Android owner approval or
// durable nonce reservation runs. The final proof must immediately precede CAS.
test('live SQLite freeze expiring during nonce reservation prevents route CAS',async()=>{
 const x=adapter(proof(),{freezeGoneAfterNonce:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_SOURCE_FREEZE_LIVE_PROBE_FAILED/);
 assert.equal(x.state().flips,0);
});
test('Neon read-only target barrier expiring during nonce reservation prevents route CAS',async()=>{
 const x=adapter(proof(),{targetWriteBarrierLostAfterNonce:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_TARGET_WRITE_BARRIER_REQUIRED/);
 assert.equal(x.state().flips,0);
});
test('signed R2 signer revoked immediately before route CAS denies switch',async()=>{
 const x=adapter(proof(),{r2SignerRevokedImmediatelyBeforeCanary:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_R2_SIGNED_VERSION_PROOF_REQUIRED/);
 assert.equal(x.state().flips,0);
});

test('owner browser receipt expiring during nonce reservation never reaches route CAS',async()=>{
 const x=adapter(proof(),{browserExpiresDuringNonce:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_OWNER_BROWSER_APPROVAL_REQUIRED/);
 assert.equal(x.state().flips,0);
});

test('strict UTC-millisecond timestamps required on outer migration evidence',()=>{
 for(const time of ['2026-10-24 23:00:00','2026-10-24T21:00:00+00:00',
                    new Date().toISOString().replace(/\.\d{3}Z$/,'Z')]){
  const e=proof();e.checked_at=time;
  bad(e,/STUDIO_EVIDENCE_STALE/);
 }
});
test('ambiguous provider gate times never qualify despite parsed time being fresh',()=>{
 const e=proof();e.gates[0].checked_at=new Date().toISOString().replace('Z','+00:00');
 bad(e,/STUDIO_STALE_GATE_/);
});
test('R2 provider timestamp must be canonical UTC with explicit milliseconds',()=>{
 const e=proof();e.r2_provider_attestation.checked_at=new Date().toISOString().replace('Z','+00:00');
 bad(e,/STUDIO_R2_PROVIDER_ATTESTATION_STALE/);
});

// Generic provider attestations may be revoked while the external nonce
// registry is contacted. A narrow signed-version callback does not cover all
// provider dependencies; reverify the complete provider proof before CAS.
test('revoked provider receipts during durable nonce reservation block route switch',async()=>{
 const x=adapter(proof(),{providerRevokedAfterNonce:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_PROVIDER_RECEIPTS_NOT_INDEPENDENTLY_VERIFIED/);
 assert.equal(x.state().flips,0);
 assert.equal(x.state().route,'SQLITE_DO');
});
// All canonical evidence timestamps must still be fresh immediately before
// the first route CAS, not just when the long asynchronous verification began.
test('evidence expiration while reserving a nonce blocks canary before CAS',async()=>{
 const p=proof();p.checked_at=new Date(Date.now()-299000).toISOString();
 const x=adapter(p,{delayNonceMs:1400});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_EVIDENCE_STALE/);
 assert.equal(x.state().flips,0);
});

test('evidence expiring during final provider revalidation cannot reach route CAS',async()=>{
 const p=proof();p.checked_at=new Date(Date.now()-299000).toISOString();
 const x=adapter(p,{delayProviderAfterNonceMs:1400});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_EVIDENCE_STALE/);
 assert.equal(x.state().flips,0);
});
test('freeze lost during final provider verification blocks route CAS',async()=>{
 const x=adapter(proof(),{freezeLostDuringFinalProvider:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_SOURCE_FREEZE_LIVE_PROBE_FAILED/);
 assert.equal(x.state().flips,0);
});
test('Neon target write barrier lost during final provider verification blocks route CAS',async()=>{
 const x=adapter(proof(),{targetLostDuringFinalProvider:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_TARGET_WRITE_BARRIER_REQUIRED/);
 assert.equal(x.state().flips,0);
});

test('read-only Neon canary requires a token-fenced lease, not a bare acquired boolean',async()=>{
 const x=adapter();const original=x.f.exclusiveLease;
 x.f.exclusiveLease=async()=>{const lease=await original();delete lease.assertHeld;return lease;};
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_FENCED_LEASE_REQUIRED/);
 assert.equal(x.state().flips,0);
});

test('stale canary lease fails closed before any SQLITE-to-Neon CAS',async()=>{
 const x=adapter(proof(),{fencingLost:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_CANARY_LEASE_FENCING_LOST/);
 assert.equal(x.state().flips,0);
});

test('both canary and rollback CAS bind the frozen run, owner receipt and durable lease token',async()=>{
 const x=adapter();let calls=0;
 const old=x.f.compareAndSwapRoute;
 x.f.compareAndSwapRoute=async(from,to,context)=>{
  assert.equal(context?.fencing_token,'canary-fence-20261025-00001');
  assert.equal(context?.source_head,sha);
  assert.equal(context?.run_id,'synthetic-proof-20261022');
  assert.equal(context?.freeze_id,'freeze-20261022-synthetic');
  assert.equal(context?.owner_receipt_id,'synthetic-owner-browser-acceptance-20261024');
  assert.equal(context?.r2_receipt_id,'synthetic-r2-provider-proof-20261024');
  assert.equal(context?.nonce,'synthetic-r2-provider-proof-20261024:synthetic-proof-20261022');
  calls++;
  return old(from,to,context);
 };
 const r=await guardedStudioNeonPromotion(x.f);
 assert.equal(r.canary,true);assert.equal(calls,2);
});

test('unowned canary appearing before authorization never receives a blind rollback CAS',async()=>{
 const x=adapter(proof(),{unverified:true});let reads=0,casCalls=0;
 x.f.readRoute=async()=>++reads===1?'SQLITE_DO':'NEON_CANARY_READONLY';
 x.f.compareAndSwapRoute=async()=>{casCalls++;return true;};
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),
  /STUDIO_CRITICAL_ROUTE_UNVERIFIED_LEASE_HELD/);
 assert.equal(casCalls,0,'no rollback without the owner-bound canary epoch');
 assert.equal(x.state().release,0);
});

test('owner consent expires during final async lease proof before routing',async()=>{
 const x=adapter();const actualNow=Date.now;
 const originalLease=x.f.exclusiveLease;
 x.f.exclusiveLease=async()=>{
  const lease=await originalLease();
  lease.assertHeld=async()=>{Date.now=()=>actualNow()+200000;return true;};
  return lease;
 };
 try{
  await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_OWNER_BROWSER_APPROVAL_REQUIRED/);
  assert.equal(x.state().flips,0);
 }finally{Date.now=actualNow;}
});

// A provider lease check can be delayed by the network. An otherwise valid
// fence receipt may expire while the final lease probe is outstanding.
for(const kind of ['source','target']){
 test(`${kind} fence expires during final lease assertion: never route to Neon`,async()=>{
  const x=adapter();
  const expires_at=new Date(Date.now()+15300).toISOString();
  const original=kind==='source'?'verifyCurrentSourceFreeze':'verifyTargetWriteBarrier';
  const probe=x.f[original];
  x.f[original]=async info=>({...await probe(info),expires_at});
  const originalLease=x.f.exclusiveLease;
  x.f.exclusiveLease=async()=>{
   const lease=await originalLease(); const verify=lease.assertHeld;
   lease.assertHeld=async token=>{
    await new Promise(resolve=>setTimeout(resolve,450));
    return verify(token);
   };
   return lease;
  };
  await assert.rejects(()=>guardedStudioNeonPromotion(x.f),
   /STUDIO_SOURCE_FREEZE_LIVE_PROBE_FAILED|STUDIO_TARGET_WRITE_BARRIER_REQUIRED/);
  assert.equal(x.state().flips,0);
  assert.equal(x.state().route,'SQLITE_DO');
 });
}

for(const kind of ['signed R2 key','independent provider receipt']){
 test(`${kind} revoked after route CAS: immediately return to SQLite`,async()=>{
  const x=adapter();
  if(kind==='signed R2 key'){
   const verified=x.f.verifySignedR2VersionEvidence;
   x.f.verifySignedR2VersionEvidence=async info=>
     x.state().route==='NEON_CANARY_READONLY'?false:verified(info);
  }else{
   const verified=x.f.verifyProviderReceipts;
   x.f.verifyProviderReceipts=async info=>
     x.state().route==='NEON_CANARY_READONLY'?false:verified(info);
  }
  await assert.rejects(()=>guardedStudioNeonPromotion(x.f),
    /STUDIO_R2_SIGNED_VERSION_PROOF_REQUIRED|STUDIO_PROVIDER_RECEIPTS_NOT_INDEPENDENTLY_VERIFIED/);
  assert.equal(x.state().route,'SQLITE_DO');
  assert.equal(x.state().flips,2,'revocation must trigger fenced rollback');
 });
}
