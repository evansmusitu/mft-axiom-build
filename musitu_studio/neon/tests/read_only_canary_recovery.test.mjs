import test from 'node:test';
import assert from 'node:assert/strict';
import {guardedStudioCanaryEmergencyReturn} from '../read_only_canary_recovery.mjs';
const head='a'.repeat(40),freeze='freeze-20261025-synthetic',run='test-readonly-canary-run-20261025';
const inTime=(ms=0)=>new Date(Date.now()+ms).toISOString();
function adapter(flags={}){
 let route=flags.initialRoute??'NEON_CANARY_READONLY',flips=0,released=0,held=false;
 const epoch={schema:'musitu.studio.v03.neon-readonly-canary-incident.v1',
   source_head:head,freeze_id:freeze,run_id:run,read_only:true,started_at:inTime(-120000)};
 const opts={expectedHead:head,
  async readIncident(){return flags.incident??epoch},
  async exclusiveRecoveryLease(){
   if(flags.leaseBusy)return {acquired:false};
   held=true;return {acquired:true,fencing_token:'fence-synthetic-20261025',
    async assertHeld(){return flags.fencingLost!==true},
    async release(){released++;held=false;if(flags.releaseFails)throw Error('lease lost')}};
  },
  async readRoute(){if(flags.unreadableRoute)throw Error('source-unknown');return route},
  async compareAndSwapRoute(from,to,lease){
   assert.equal(from,'NEON_CANARY_READONLY');assert.equal(to,'SQLITE_DO');
   assert.equal(lease.run_id,run);assert.equal(lease.fencing_token,'fence-synthetic-20261025');
   if(flags.casDenied)return false;
   route=to;flips++;if(flags.casAckLost)throw Error('ack-lost');return true;
  },
  async verifyOwnerRecoveryApproval(){return flags.owner??{
   verified:true,provider_signature_verified:true,owner_authenticated:true,
   owner_role:'owner',scope:'studio-v03-neon-readonly-emergency-return',
   source_head:head,freeze_id:freeze,run_id:run,
   receipt_id:'owner-incident-acceptance-20261025',
   checked_at:inTime(-120000),expires_at:inTime(120000)}},
  async verifySQLiteAuthority(){return flags.authority??{
   verified:true,provider_receipt_verified:true,database_of_record:'SQLITE_DO',
   access_unchanged:true,r2_untouched:true,customer_writes_to_neon:false,
   source_head:head,freeze_id:freeze,expires_at:inTime(120000)}}};
 return{opts,state:()=>({route,flips,released,held})};
}
test('readonly canary emergency recovery performs only fenced Neon-to-SQLite CAS',async()=>{
 const f=adapter();const r=await guardedStudioCanaryEmergencyReturn(f.opts);
 assert.equal(r.route,'SQLITE_DO');assert.equal(r.recovered,true);
 assert.equal(r.production_migration_authorized,false);
 assert.deepEqual(f.state(),{route:'SQLITE_DO',flips:1,released:1,held:false});
});
test('SQLite already authoritative returns without mutating route',async()=>{
 const f=adapter({initialRoute:'SQLITE_DO'});
 const r=await guardedStudioCanaryEmergencyReturn(f.opts);
 assert.equal(r.recovered,false);assert.equal(f.state().flips,0);
});
test('missing or forged owner signature never reaches routing',async()=>{
 for(const r of [true,{verified:true},{...adapter().opts,provider_signature_verified:false}]){
  const f=adapter({owner:r});
  await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),/STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
  assert.equal(f.state().flips,0);assert.equal(f.state().route,'NEON_CANARY_READONLY');
  assert.equal(f.state().released,0);
 }
});
test('unqualified live SQLite source never reaches routing',async()=>{
 const f=adapter({authority:{verified:true}});
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),/STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
 assert.equal(f.state().flips,0);assert.equal(f.state().released,0);
});
test('wrong incident HEAD or impossible future timestamp fails closed',async()=>{
 const a=adapter();a.opts.expectedHead='f'.repeat(40);
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(a.opts),/STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
 const f=adapter({incident:{schema:'musitu.studio.v03.neon-readonly-canary-incident.v1',
 source_head:head,freeze_id:freeze,run_id:run,read_only:true,started_at:inTime(60000)}});
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),/STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
});
test('fencing lease loss blocks compare-and-swap',async()=>{
 const f=adapter({fencingLost:true});await assert.rejects(
 ()=>guardedStudioCanaryEmergencyReturn(f.opts),/STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
 assert.equal(f.state().flips,0);assert.equal(f.state().released,0);
});
test('CAS denial or unknown route retains durable recovery lease for manual incident',async()=>{
 for(const opts of [{casDenied:true},{initialRoute:'UNVERIFIED_ROUTE'}]){
  const f=adapter(opts);await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),
  /STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
  assert.equal(f.state().released,0);
 }
});
test('lost CAS acknowledgement safely readbacks SQLite, then reports incident',async()=>{
 const f=adapter({casAckLost:true});
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),/ack-lost/);
 assert.equal(f.state().route,'SQLITE_DO');assert.equal(f.state().released,1);
});
test('SQLite safe but lease release failed is not reported as recovery success',async()=>{
 const f=adapter({releaseFails:true,initialRoute:'SQLITE_DO'});
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),/STUDIO_RECOVERY_LEASE_RELEASE_FAILED_SQLITE_SAFE/);
});
test('readback unknown and invalid fencing never report success',async()=>{
 const a=adapter({unreadableRoute:true});await assert.rejects(
 ()=>guardedStudioCanaryEmergencyReturn(a.opts),/STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
 const f=adapter({leaseBusy:true});await assert.rejects(
 ()=>guardedStudioCanaryEmergencyReturn(f.opts),/STUDIO_RECOVERY_EXCLUSIVE_FENCED_LEASE_REQUIRED/);
});
test('long-running abandoned readonly canary remains recoverable with FRESH owner/source proofs',async()=>{
 const f=adapter({incident:{schema:'musitu.studio.v03.neon-readonly-canary-incident.v1',
  source_head:head,freeze_id:freeze,run_id:run,read_only:true,
  started_at:inTime(-10*24*3600_000)}});
 const result=await guardedStudioCanaryEmergencyReturn(f.opts);
 assert.equal(result.route,'SQLITE_DO');assert.equal(f.state().flips,1);
});
test('owner approval timestamp after its own expiry is rejected',async()=>{
 const receipt={verified:true,provider_signature_verified:true,owner_authenticated:true,
   owner_role:'owner',scope:'studio-v03-neon-readonly-emergency-return',
   source_head:head,freeze_id:freeze,run_id:run,
   receipt_id:'owner-incident-acceptance-20261025',
   checked_at:inTime(25000),expires_at:inTime(18000)};
 const f=adapter({owner:receipt,initialRoute:'SQLITE_DO'});
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),/STUDIO_RECOVERY_OWNER_APPROVAL_EXPIRED/);
 assert.equal(f.state().flips,0);
});

// Crash recovery can span multiple provider round trips. Old good receipts
// cannot authorize a later CAS after their source of authority has changed.
test('revoked owner approval during recovery fails before route CAS',async()=>{
 const f=adapter();const original=f.opts.verifyOwnerRecoveryApproval;let checks=0;
 f.opts.verifyOwnerRecoveryApproval=async(...args)=>{
  const result=await original(...args);return ++checks===1?result:{...result,verified:false};
 };
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),/STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
 assert.equal(checks,2);assert.equal(f.state().flips,0);assert.equal(f.state().released,0);
});
test('lost SQLite authority while preparing rescue blocks route CAS',async()=>{
 const f=adapter();const original=f.opts.verifySQLiteAuthority;let checks=0;
 f.opts.verifySQLiteAuthority=async(...args)=>{
  const result=await original(...args);return ++checks===1?result:{...result,customer_writes_to_neon:true};
 };
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),/STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
 assert.equal(checks,2);assert.equal(f.state().flips,0);
});
test('incident epoch changing under recovery lease blocks stale route CAS',async()=>{
 const f=adapter();const original=f.opts.readIncident;let checks=0;
 f.opts.readIncident=async()=>{
  const epoch=await original();return ++checks===1?epoch:{...epoch,run_id:'replacement-canary-run-20261025'};
 };
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),/STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
 assert.equal(checks,2);assert.equal(f.state().flips,0);
});
test('route changing between initial read and guarded CAS cannot reuse stale state',async()=>{
 const f=adapter();const original=f.opts.readRoute;let n=0;
 f.opts.readRoute=async()=>{if(++n===2)return 'SQLITE_DO';return original();};
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),/STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
 assert.equal(f.state().flips,0);assert.equal(f.state().released,0);
});
