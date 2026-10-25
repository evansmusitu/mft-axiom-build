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
   source_head:head,freeze_id:freeze,run_id:run,
   receipt_id:'sqlite-authority-current-run-20261025',checked_at:inTime(-30000),
   expires_at:inTime(120000)}}};
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
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),/STUDIO_RECOVERY_RETURN_CAS_CALLBACK_FAILED/);
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

test('source authority proof for another run cannot authorize this recovery',async()=>{
 const f=adapter();const base=await f.opts.verifySQLiteAuthority();
 f.opts.verifySQLiteAuthority=async()=>({...base,run_id:'other-canary-run-20261025'});
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),
   /STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
 assert.equal(f.state().flips,0);
});
test('expired source authority readback cannot authorize this recovery',async()=>{
 const f=adapter();const base=await f.opts.verifySQLiteAuthority();
 f.opts.verifySQLiteAuthority=async()=>({...base,checked_at:inTime(-600000)});
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),
   /STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
 assert.equal(f.state().flips,0);
});
test('different owner receipt mid-flight cannot replace the previously approved consent',async()=>{
 const f=adapter();let checks=0;const orig=f.opts.verifyOwnerRecoveryApproval;
 f.opts.verifyOwnerRecoveryApproval=async()=>{
  const r=await orig();return ++checks===1?r:{...r,receipt_id:'different-owner-receipt-20261025'};
 };
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),
   /STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
 assert.equal(f.state().flips,0);
});

test('independent source authority receipt cannot be silently replaced before CAS',async()=>{
 const f=adapter();const original=f.opts.verifySQLiteAuthority;let checked=0;
 f.opts.verifySQLiteAuthority=async (...args)=>{
  const r=await original(...args);
  return ++checked===1?r:{...r,receipt_id:'different-sqlite-proof-20261025'};
 };
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),
  /STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
 assert.equal(checked,2);assert.equal(f.state().flips,0);
});

test('recovery CAS must bind both signed receipt identifiers',async()=>{
 const f=adapter();const original=f.opts.compareAndSwapRoute;
 f.opts.compareAndSwapRoute=async(from,to,claims)=>{
  assert.equal(claims.owner_approval_receipt_id,'owner-incident-acceptance-20261025');
  assert.equal(claims.sqlite_authority_receipt_id,'sqlite-authority-current-run-20261025');
  return original(from,to,claims);
 };
 const r=await guardedStudioCanaryEmergencyReturn(f.opts);
 assert.equal(r.recovered,true);
});

test('an approval expiring during async final fencing must not authorize the CAS',async()=>{
 const f=adapter();const original=f.opts.exclusiveRecoveryLease;let leaseChecks=0;
 const actualNow=Date.now;
 f.opts.exclusiveRecoveryLease=async()=>{
  const lease=await original();const check=lease.assertHeld;
  lease.assertHeld=async (...args)=>{
   const held=await check(...args);if(++leaseChecks===2)Date.now=()=>actualNow()+210000;
   return held;
  };
  return lease;
 };
 try {
  await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),
   /STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD/);
  assert.equal(leaseChecks,2);assert.equal(f.state().flips,0);
 } finally {Date.now=actualNow;}
});

// Red-first: an acknowledged CAS is not final evidence that the original
// SQLite authority and owner consent remain valid after route restoration.
test('postreturn source authority revocation refuses to report successful recovery',async()=>{
 const f=adapter();const orig=f.opts.verifySQLiteAuthority;let checks=0;
 f.opts.verifySQLiteAuthority=async(...args)=>{
  const r=await orig(...args);checks++;
  return f.state().route==='SQLITE_DO'?{...r,customer_writes_to_neon:true}:r;
 };
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),
   /STUDIO_RECOVERY_SOURCE_AUTHORITY_UNVERIFIED/);
 assert.equal(f.state().route,'SQLITE_DO');
 assert.equal(f.state().released,1);
 assert.ok(checks>=3);
});
test('postreturn owner approval revocation refuses success despite SQLite route',async()=>{
 const f=adapter();const orig=f.opts.verifyOwnerRecoveryApproval;let checks=0;
 f.opts.verifyOwnerRecoveryApproval=async(...args)=>{
  const r=await orig(...args);checks++;
  return f.state().route==='SQLITE_DO'?{...r,verified:false}:r;
 };
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),
   /STUDIO_RECOVERY_OWNER_APPROVAL_INVALID/);
 assert.equal(f.state().route,'SQLITE_DO');
 assert.equal(f.state().released,1);
 assert.ok(checks>=3);
});


// Provider exceptions are untrusted even if their message resembles internal
// recovery error codes. Do not disclose URLs, bearer tokens or customer IDs.
test('untrusted recovery callback messages never escape the safe SQLite route',async()=>{
 for(const callback of ['exclusiveRecoveryLease','readIncident','readRoute',
                         'verifyOwnerRecoveryApproval','verifySQLiteAuthority']){
  const f=adapter({initialRoute:'SQLITE_DO'});
  f.opts[callback]=async()=>{throw Error('SENSITIVE_LIVE_PROVIDER_TOKEN_20261025')};
  await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),e=>{
   assert.equal(e.message.includes('SENSITIVE_LIVE_PROVIDER_TOKEN'),false,callback);
   assert.match(e.message,/^STUDIO_/);
   return true;
  });
  assert.equal(f.state().flips,0,callback);
 }
});
test('lost CAS acknowledgment is sanitized while returning SQLite safely',async()=>{
 const f=adapter({casAckLost:true});
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),e=>{
  assert.equal(e.message,'STUDIO_RECOVERY_RETURN_CAS_CALLBACK_FAILED');
  assert.equal(e.message.includes('ack-lost'),false);
  return true;
 });
 assert.equal(f.state().route,'SQLITE_DO');
 assert.equal(f.state().released,1);
});
test('postreturn verifier exception never leaks provider details',async()=>{
 const f=adapter();const read=f.opts.verifySQLiteAuthority;
 f.opts.verifySQLiteAuthority=async(...args)=>{
  if(f.state().route==='SQLITE_DO')throw Error('SECRET_R2_EXTERNAL_CREDENTIAL');
  return read(...args);
 };
 await assert.rejects(()=>guardedStudioCanaryEmergencyReturn(f.opts),e=>{
  assert.equal(e.message,'STUDIO_RECOVERY_SOURCE_VERIFIER_FAILED');return true;
 });
 assert.equal(f.state().route,'SQLITE_DO');
 assert.equal(f.state().released,1);
});
