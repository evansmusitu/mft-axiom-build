import test from 'node:test';
import assert from 'node:assert/strict';
import {assertStudioNeonPromotionEvidence,guardedStudioNeonPromotion,
  STUDIO_NEON_REQUIRED_GATES} from '../migration_promotion_guard.mjs';
const sha='a'.repeat(40),hex='b'.repeat(64),now=()=>new Date().toISOString();
const copy=x=>structuredClone(x);
function proof(){
 const counts={projects:1,memberships:1,jobs:1,assets:3,audit_events:1};
 const table_hmac=Object.fromEntries(Object.keys(counts).map(x=>[x,hex]));
 const r={verified:true,freeze_id:'freeze-20261022-synthetic',counts,table_hmac};
 return {source_head:sha,run_id:'synthetic-proof-20261022',checked_at:now(),freeze_id:r.freeze_id,
 source_receipt:copy(r),target_receipt:copy(r),
 gates:STUDIO_NEON_REQUIRED_GATES.map(name=>({name,provider:'unit-fixture',
 receipt_id:'synthetic-'+name,checked_at:now(),verified:true,provider_receipt_verified:true})),
 cloudflare_database_of_record:'SQLITE_DO',neon_project_is_synthetic_proof:false,
 cpu_enabled:false,gpu_enabled:false,
 channel:{block_public_connections:true,least_privilege:true,private_path_independently_verified:true},
 billing:{neon_organization_hard_spend_enforced:true,modal_zero_out_of_pocket_enforced:true,
 project_quotas_not_used_as_spend_proof:true},
 rollback:{cloudflare_sqlite_intact:true,restore_pretested:true,snapshot_of_imported_neon_restored:true}};
}
function adapter(p=proof(),flags={}){
 let route='SQLITE_DO',flips=0,release=0,reads=0,held=false;
 const f={expectedHead:sha,
 async exclusiveLease(){if(held||flags.leaseHeld)return {acquired:false};
 held=true;return {acquired:true,release:async()=>{held=false;release++}}},
 async readRoute(){return route},
 async readEvidence(){reads++;if(flags.changedEpoch&&reads===2){let x=copy(p);x.run_id='different-evidence-id-20261022';return x}return copy(p)},
 async verifyProviderReceipts(){return flags.unverified!==true},
 async compareAndSwapRoute(from,to){
  if(flags.rollbackFails&&from==='NEON_PROTECTED')return false;
  if(flags.casFails&&from==='SQLITE_DO')return false;
  if(route!==from)return false;
  route=to;flips++;
  if(flags.ackLost&&to==='NEON_PROTECTED')throw Error('PROVIDER_ACK_LOST');
  return true;
 },
 async verifySignedBrowser(){return !flags.browserFails},
 async verifyReconciledTarget(){return !flags.readbackFails}};
 return {f,state:()=>({route,flips,release,reads})};
}
const bad=(e,regex)=>assert.throws(()=>assertStudioNeonPromotionEvidence(e,{expectedHead:sha}),regex);
test('fifteen required gates and five exact HMAC tables',()=>{
 const e=proof();assert.equal(assertStudioNeonPromotionEvidence(e,{expectedHead:sha}).gate_count,15);
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
 assert.equal(r.promoted,true);assert.equal(r.rendering_enabled,false);
 assert.deepEqual(x.state(),{route:'NEON_PROTECTED',flips:1,release:1,reads:2});
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
 const x=adapter(proof(),{browserFails:true});
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
 const x=adapter(proof(),{browserFails:true,rollbackFails:true});
 await assert.rejects(()=>guardedStudioNeonPromotion(x.f),/STUDIO_CRITICAL_ROLLBACK_FAILED/);
 assert.equal(x.state().route,'NEON_PROTECTED');assert.equal(x.state().release,1);
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
