/** Cloudflare SQLite DO migration extraction candidate — INTERNAL, NOT DEPLOYED.
 * No network transport, no public endpoint, no R2 writes, no logging.
 * The only valid caller is the trusted Access-verified Worker during an
 * independently enforced write-freeze/maintenance window. The freeze guard
 * is deliberately absent from today's production Worker; this module
 * cannot be activated simply by setting an environment variable.
 */
const COLUMNS=Object.freeze({
  projects:['id','title','owner_sub','created_at'],
  memberships:['project_id','member_sub','role','created_at'],
  jobs:['id','project_id','submission_key','payload_json','payload_sha256','render_device',
    'state','created_by_sub','approved_by_sub','dispatched_by_sub','call_id','error_code',
    'created_at','approved_at','dispatched_at','finished_at'],
  assets:['job_id','filename','object_key','sha256','bytes'],
  audit_events:['id','project_id','job_id','action','actor_sub','at','details']
});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HEX64=/^[a-f0-9]{64}$/;
const deny=(code)=>{throw Error(code)};
async function sha256Utf8(text){
  if(typeof crypto?.subtle?.digest!=='function')deny('EXPORT_CRYPTO_REQUIRED');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
/**
 * An explicit, independently attested maintenance freeze is REQUIRED.
 * The caller must take actor from verifiedV03Identity(), NOT headers.
 * The caller must enforce all writes frozen BEFORE calling this function.
 */
export async function readFrozenStudioDoLedger({storage,actor,ownerSubjectSha256,
  freezeId,writesFrozen=false,staffJwtVerified=false}={}){
  if(staffJwtVerified!==true||typeof actor?.sub!=='string'||actor.sub.length<8)
    deny('EXPORT_SIGNED_STAFF_REQUIRED');
  if(typeof ownerSubjectSha256!=='string'||!HEX64.test(ownerSubjectSha256))
    deny('EXPORT_OWNER_FINGERPRINT_REQUIRED');
  if((await sha256Utf8(actor.sub))!==ownerSubjectSha256)
    deny('EXPORT_OWNER_SUBJECT_MISMATCH');
  if(writesFrozen!==true)deny('EXPORT_MAINTENANCE_FREEZE_REQUIRED');
  if(typeof freezeId!=='string'||!UUID.test(freezeId))
    deny('EXPORT_FREEZE_ID_INVALID');
  if(!storage||typeof storage.transactionSync!=='function'||
     typeof storage.sql?.exec!=='function')deny('EXPORT_SQLITE_DO_REQUIRED');

  // One SQLite transactional snapshot. Never fall back to multiple
  // independent reads that could mix project/job/audit epochs.
  return storage.transactionSync(()=>{
    const version=Number(storage.sql.exec(
      'SELECT COALESCE(MAX(version),0) AS n FROM _studio_schema_versions').one()?.n);
    if(version!==2)deny('EXPORT_SCHEMA_VERSION_UNQUALIFIED');
    const ledger={complete:true,freeze_id:freezeId};
    let total=0;
    for(const [table,columns] of Object.entries(COLUMNS)){
      // Table and column names are compile-time allowlisted constants.
      const statement='SELECT '+columns.join(',')+' FROM '+table;
      const rows=Array.from(storage.sql.exec(statement),entry=>{
        if(!entry||typeof entry!=='object')deny('EXPORT_ROW_INVALID');
        return Object.fromEntries(columns.map(col=>{
          if(!Object.hasOwn(entry,col))deny('EXPORT_COLUMN_MISSING');
          return [col,entry[col]];
        }));
      });
      if(rows.length>25000||(total+=rows.length)>25000)
        deny('EXPORT_ROW_CAP_REQUIRES_PAGINATED_PLAN');
      ledger[table]=rows;
    }
    const bytes=new TextEncoder().encode(JSON.stringify(ledger)).byteLength;
    if(bytes>12500000)deny('EXPORT_BYTE_CAP_REQUIRES_PAGINATED_PLAN');
    return ledger;
  });
}
