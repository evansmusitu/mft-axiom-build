/** Studio V0.3 — isolated, provider-injected emergency return to SQLite.
 * A narrow rescue path for a crashed read-only Neon canary. Never promotes,
 * writes customer rows, accesses R2, or changes Cloudflare Access itself.
 * Production adapters MUST implement durable fencing and authenticated reads.
 */
const HEAD=/^[0-9a-f]{40}$/i, ID=/^[a-zA-Z0-9-]{16,128}$/;
const CANON=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const fail=code=>{throw Error(code)};
const stamp=value=>{
 if(typeof value!=='string'||!CANON.test(value))return NaN;
 const ms=Date.parse(value);
 return Number.isFinite(ms)&&new Date(ms).toISOString()===value?ms:NaN;
};
const freshUntil=(expires,now)=>{
 const ms=stamp(expires);return Number.isFinite(ms)&&ms-now>=15000&&ms-now<=300000;
};
function incident(e,head,now){
 if(!e||Object.keys(e).sort().join('|')!==[
  'freeze_id','read_only','run_id','schema','source_head','started_at'].sort().join('|')||
  e.schema!=='musitu.studio.v03.neon-readonly-canary-incident.v1'||
  e.read_only!==true||e.source_head!==head||
  !ID.test(e.run_id||'')||typeof e.freeze_id!=='string'||
  e.freeze_id.length<8||e.freeze_id.length>128)fail('STUDIO_RECOVERY_INCIDENT_INVALID');
 // A crashed canary may be stranded for days: a fresh authenticated
 // source-authority receipt and a NEW owner approval (below) are what
 // authorize rescue. Never reject recovery solely for incident age.
 const t=stamp(e.started_at);
 if(!Number.isFinite(t)||t>now+30000)
  fail('STUDIO_RECOVERY_INCIDENT_STALE');
 return e;
}
function signedApproval(r,epoch,now){
 if(!r||r.verified!==true||r.provider_signature_verified!==true||
    r.owner_authenticated!==true||r.owner_role!=='owner'||
    r.scope!=='studio-v03-neon-readonly-emergency-return'||
    r.source_head!==epoch.source_head||r.freeze_id!==epoch.freeze_id||
    r.run_id!==epoch.run_id||!ID.test(r.receipt_id||''))
   fail('STUDIO_RECOVERY_OWNER_APPROVAL_INVALID');
 const checked=stamp(r.checked_at);
 if(!Number.isFinite(checked)||checked>now+30000||now-checked>300000||
    !freshUntil(r.expires_at,now)||checked>stamp(r.expires_at))
   fail('STUDIO_RECOVERY_OWNER_APPROVAL_EXPIRED');
}
function authority(r,epoch,now){
 if(!r||r.verified!==true||r.provider_receipt_verified!==true||
    r.database_of_record!=='SQLITE_DO'||r.access_unchanged!==true||
    r.r2_untouched!==true||r.customer_writes_to_neon!==false||
    r.freeze_id!==epoch.freeze_id||r.source_head!==epoch.source_head||
    !freshUntil(r.expires_at,now))fail('STUDIO_RECOVERY_SOURCE_AUTHORITY_UNVERIFIED');
}
/** The only possible route write is NEON_CANARY_READONLY -> SQLITE_DO.
 * Failing to prove SQLite routing retains the recovery lease for manual action.
 * The supplied callbacks are interfaces; their flags are never themselves
 * independent provider proof.
 */
export async function guardedStudioCanaryEmergencyReturn({expectedHead,
 readIncident,exclusiveRecoveryLease,readRoute,compareAndSwapRoute,
 verifyOwnerRecoveryApproval,verifySQLiteAuthority}={}){
 if(!HEAD.test(expectedHead||''))fail('STUDIO_RECOVERY_EXPECTED_HEAD_REQUIRED');
 for(const [name,cb] of Object.entries({readIncident,exclusiveRecoveryLease,
   readRoute,compareAndSwapRoute,verifyOwnerRecoveryApproval,verifySQLiteAuthority}))
   if(typeof cb!=='function')fail('STUDIO_RECOVERY_CALLBACK_REQUIRED_'+name);
 const lease=await exclusiveRecoveryLease();
 if(lease?.acquired!==true||typeof lease.release!=='function'||
    typeof lease.assertHeld!=='function'||!ID.test(lease.fencing_token||''))
    fail('STUDIO_RECOVERY_EXCLUSIVE_FENCED_LEASE_REQUIRED');
 try{
  const epoch=incident(await readIncident(),expectedHead,Date.now());
  const route=await readRoute();
  if(route!=='SQLITE_DO'&&route!=='NEON_CANARY_READONLY')
   fail('STUDIO_RECOVERY_ROUTE_UNKNOWN');
  signedApproval(await verifyOwnerRecoveryApproval(epoch),epoch,Date.now());
  authority(await verifySQLiteAuthority(epoch),epoch,Date.now());
  if(await lease.assertHeld(lease.fencing_token)!==true)
   fail('STUDIO_RECOVERY_LEASE_FENCING_LOST');
  if(route==='NEON_CANARY_READONLY'){
   // No connection to Neon or SQLite customer data is required. A durable
   // operator-supplied CAS must check the lease token and exact route epoch.
   if(await compareAndSwapRoute('NEON_CANARY_READONLY','SQLITE_DO',
       {fencing_token:lease.fencing_token,run_id:epoch.run_id,
        source_head:epoch.source_head,freeze_id:epoch.freeze_id})!==true)
    fail('STUDIO_RECOVERY_RETURN_CAS_FAILED');
  }
  if(await readRoute()!=='SQLITE_DO')fail('STUDIO_RECOVERY_ROUTE_READBACK_FAILED');
  return Object.freeze({route:'SQLITE_DO',readonly_canary_active:false,
   customer_writes_to_neon:false,production_migration_authorized:false,
   recovered:route==='NEON_CANARY_READONLY',run_id:epoch.run_id});
 }finally{
  let safe=false;
  try{safe=await readRoute()==='SQLITE_DO'}catch{}
  if(!safe)fail('STUDIO_CRITICAL_RECOVERY_ROUTE_UNVERIFIED_LEASE_HELD');
  try{await lease.release()}catch{
   fail('STUDIO_RECOVERY_LEASE_RELEASE_FAILED_SQLITE_SAFE');
  }
 }
}
