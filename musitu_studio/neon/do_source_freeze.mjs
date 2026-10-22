/** MUSITU V0.3 SQLite Durable Object — INTERNAL CANDIDATE, NOT DEPLOYED.
 * This fail-closed write fence must be reviewed, backed up and explicitly
 * installed by a signed internal operator before a live export can run.
 * No HTTP route, automatic install, scheduled task, D1, R2, or network use.
 */
const TABLES=Object.freeze(['projects','memberships','jobs','assets','audit_events']);
const OPS=Object.freeze(['INSERT','UPDATE','DELETE']);
const HEX64=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=code=>{throw Error(code)};
const normalizeSQL=s=>typeof s==='string'?s.replace(/\bIF NOT EXISTS\b/ig,'').replace(/\s+/g,' ').trim().replace(/;+$/,'').trim():'';
const triggerName=(table,op)=>`studio_v03_export_freeze_${table}_${op.toLowerCase()}`;
const lockCondition=`EXISTS (SELECT 1 FROM _studio_export_freeze WHERE lock_id=1 AND status='active' AND expires_epoch>CAST(strftime('%s','now') AS INTEGER))`;
export const STUDIO_SOURCE_FREEZE_TRIGGER_SQL=Object.freeze(Object.fromEntries(
  TABLES.flatMap(table=>OPS.map(op=>{
    const name=triggerName(table,op);
    return [name,`CREATE TRIGGER IF NOT EXISTS ${name} BEFORE ${op} ON ${table} WHEN ${lockCondition} BEGIN SELECT RAISE(ABORT,'STUDIO_MIGRATION_WRITES_FROZEN'); END;`];
  }))));
export const STUDIO_SOURCE_FREEZE_SETUP_SQL=`-- STAGING ONLY: never auto-apply to a production Durable Object.\n`+
`CREATE TABLE IF NOT EXISTS _studio_export_freeze (\n`+
` lock_id INTEGER PRIMARY KEY CHECK(lock_id=1),\n`+
` freeze_id TEXT NOT NULL, owner_sha256 TEXT NOT NULL,\n`+
` issued_epoch INTEGER NOT NULL, expires_epoch INTEGER NOT NULL,\n`+
` status TEXT NOT NULL CHECK(status IN ('active','released'))\n);\n`+
Object.values(STUDIO_SOURCE_FREEZE_TRIGGER_SQL).join('\n')+'\n';
const sqlExec=(storage,s,...params)=>{
  if(typeof storage?.sql?.exec!=='function')fail('STUDIO_FREEZE_SQLITE_DO_REQUIRED');
  return storage.sql.exec(s,...params);
};
function assertTriggerTopology(storage){
  const rows=Array.from(sqlExec(storage,
    "SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'studio_v03_export_freeze_%'"));
  const expected=STUDIO_SOURCE_FREEZE_TRIGGER_SQL;
  if(rows.length!==Object.keys(expected).length)fail('STUDIO_FREEZE_TRIGGERS_UNQUALIFIED');
  const seen=new Set();
  for(const row of rows){
    if(!Object.hasOwn(expected,row.name)||seen.has(row.name)||
       normalizeSQL(row.sql)!==normalizeSQL(expected[row.name]))
      fail('STUDIO_FREEZE_TRIGGERS_UNQUALIFIED');
    seen.add(row.name);
  }
}
function schemaCheck(storage){
  const version=Number(sqlExec(storage,
    'SELECT COALESCE(MAX(version),0) AS n FROM _studio_schema_versions').one()?.n);
  if(version!==2)fail('STUDIO_FREEZE_SCHEMA_VERSION_UNQUALIFIED');
  assertTriggerTopology(storage);
}
function clock(storage){
  const epoch=Number(sqlExec(storage,"SELECT CAST(strftime('%s','now') AS INTEGER) AS epoch").one()?.epoch);
  if(!Number.isSafeInteger(epoch)||epoch<=0)fail('STUDIO_FREEZE_CLOCK_UNAVAILABLE');
  return epoch;
}
function allowedCredentials(freezeId,ownerSubjectSha256){
  if(!UUID.test(freezeId||'')||typeof ownerSubjectSha256!=='string'||
     !HEX64.test(ownerSubjectSha256))fail('STUDIO_FREEZE_ATTESTATION_REQUIRED');
}
/** Call ONLY INSIDE a real SQLite DO transactionSync, not as an HTTP API.
 * Checks both the persisted live lease and every installed trigger BODY;
 * boolean caller claims are insufficient to authorize a snapshot.
 */
export function assertStudioSourceWriteFreeze(storage,{freezeId,ownerSubjectSha256}={}){
  allowedCredentials(freezeId,ownerSubjectSha256);
  schemaCheck(storage);
  const r=sqlExec(storage,
    'SELECT freeze_id, owner_sha256, issued_epoch, expires_epoch, status FROM _studio_export_freeze WHERE lock_id=1').one();
  const now=clock(storage);
  if(!r||r.freeze_id!==freezeId||r.owner_sha256!==ownerSubjectSha256||
     r.status!=='active'||!Number.isSafeInteger(Number(r.issued_epoch))||
     !Number.isSafeInteger(Number(r.expires_epoch))||
     Number(r.issued_epoch)>now||Number(r.expires_epoch)<=now||
     Number(r.expires_epoch)-Number(r.issued_epoch)>300)
    fail('STUDIO_FREEZE_NOT_ACTIVE');
  return Object.freeze({freeze_id:freezeId,expires_epoch:Number(r.expires_epoch),
    writable:false,triggers_verified:Object.keys(STUDIO_SOURCE_FREEZE_TRIGGER_SQL).length});
}
async function ownerPreflight({actor,ownerSubjectSha256,staffJwtVerified}){
  if(staffJwtVerified!==true||typeof actor?.sub!=='string'||actor.sub.length<8)
    fail('STUDIO_FREEZE_SIGNED_OWNER_REQUIRED');
  if(typeof ownerSubjectSha256!=='string'||!HEX64.test(ownerSubjectSha256))
    fail('STUDIO_FREEZE_OWNER_FINGERPRINT_REQUIRED');
  const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(actor.sub));
  const actual=Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==ownerSubjectSha256)fail('STUDIO_FREEZE_OWNER_MISMATCH');
}
/** Acquire a short-lived, trigger-backed write fence on one SQLite DO only.
 * The caller must separately enforce signed owner Access identity and record
 * independent, durable provider evidence. This method itself is NOT deployed.
 */
export async function acquireStudioSourceWriteFreeze({storage,actor,ownerSubjectSha256,
  staffJwtVerified=false,ttlSeconds=120}={}){
  await ownerPreflight({actor,ownerSubjectSha256,staffJwtVerified});
  if(!Number.isSafeInteger(ttlSeconds)||ttlSeconds<10||ttlSeconds>300)
    fail('STUDIO_FREEZE_TTL_DENIED');
  if(typeof storage?.transactionSync!=='function')fail('STUDIO_FREEZE_SQLITE_DO_REQUIRED');
  const freezeId=crypto.randomUUID();
  return storage.transactionSync(()=>{
    schemaCheck(storage);
    const permitted=Number(sqlExec(storage,
      "SELECT COUNT(*) AS n FROM memberships WHERE member_sub=? AND role='owner'",
      actor.sub).one()?.n);
    if(permitted<1)fail('STUDIO_FREEZE_OWNER_MEMBERSHIP_REQUIRED');
    const now=clock(storage);
    const prior=sqlExec(storage,
      'SELECT status,expires_epoch FROM _studio_export_freeze WHERE lock_id=1').one();
    if(prior?.status==='active'&&Number(prior.expires_epoch)>now)
      fail('STUDIO_FREEZE_ALREADY_HELD');
    sqlExec(storage,'INSERT INTO _studio_export_freeze (lock_id,freeze_id,owner_sha256,issued_epoch,expires_epoch,status) VALUES (1,?,?,?,?,?) ON CONFLICT(lock_id) DO UPDATE SET freeze_id=excluded.freeze_id,owner_sha256=excluded.owner_sha256,issued_epoch=excluded.issued_epoch,expires_epoch=excluded.expires_epoch,status=excluded.status',
      freezeId,ownerSubjectSha256,now,now+ttlSeconds,'active');
    return assertStudioSourceWriteFreeze(storage,{freezeId,ownerSubjectSha256});
  });
}
/** A write fence is never silently removed: signed owner must release same
 * epoch; source writes may independently resume after the finite TTL.
 */
export async function releaseStudioSourceWriteFreeze({storage,actor,ownerSubjectSha256,
  staffJwtVerified=false,freezeId}={}){
  await ownerPreflight({actor,ownerSubjectSha256,staffJwtVerified});
  allowedCredentials(freezeId,ownerSubjectSha256);
  if(typeof storage?.transactionSync!=='function')fail('STUDIO_FREEZE_SQLITE_DO_REQUIRED');
  return storage.transactionSync(()=>{
    schemaCheck(storage);
    const permitted=Number(sqlExec(storage,
      "SELECT COUNT(*) AS n FROM memberships WHERE member_sub=? AND role='owner'",
      actor.sub).one()?.n);
    if(permitted<1)fail('STUDIO_FREEZE_OWNER_MEMBERSHIP_REQUIRED');
    sqlExec(storage,
      'UPDATE _studio_export_freeze SET status=? WHERE lock_id=1 AND freeze_id=? AND owner_sha256=? AND status=?',
      'released',freezeId,ownerSubjectSha256,'active');
    // Cloudflare SqlStorage.exec is iterable, not a SQLite changes() result.
    const changes=Number(sqlExec(storage,'SELECT changes() AS n').one()?.n);
    if(changes!==1)fail('STUDIO_FREEZE_RELEASE_EPOCH_MISMATCH');
    return Object.freeze({released:true,freeze_id:freezeId});
  });
}
