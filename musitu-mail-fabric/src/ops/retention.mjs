/** Offline-only, narrowly scoped cleanup of terminal-state encrypted payload
 * residue after a separately approved retention window. Does not delete
 * messages, evidence, suppressions, provider events or idempotency records.
 * Does not implement legal compliance or full data erasure.
 */
const TENANT=/^[a-z][a-z0-9_-]{2,63}$/;
const ACK='ERASE_ONLY_TERMINAL_ENVELOPE_RESIDUE';
const CANDIDATES=`tenant_id=? AND state IN
 ('ACCEPTED_BY_PROVIDER','REJECTED_BY_PROVIDER','OUTCOME_UNKNOWN','BLOCKED_BY_POLICY')
 AND sealed_envelope IS NOT NULL AND created_ms<=?`;
const deny=()=>{throw Error('RETENTION_DENIED');};
export async function sweepTerminalEnvelopeResidue(db,{tenantId,now=Date.now,minAgeDays=30,dryRun=true,
 legalHold,backupVerified,retentionApproved,acknowledgement}={}){
 if(!db||typeof db.prepare!=='function'||typeof tenantId!=='string'||!TENANT.test(tenantId)||
    typeof now!=='function'||!Number.isSafeInteger(minAgeDays)||minAgeDays<7||minAgeDays>3650||
    typeof dryRun!=='boolean')deny();
 const ms=now();
 if(!Number.isSafeInteger(ms)||ms<=minAgeDays*86400000)deny();
 // Unknown hold state, uncertain backup verification or missing explicit
 // policy authority always prevent a destructive operation.
 if(!dryRun&&(legalHold!==false||backupVerified!==true||retentionApproved!==true||acknowledgement!==ACK))deny();
 try{
  const cutoff=ms-minAgeDays*86400000;
  const row=await db.prepare(`SELECT COUNT(*) AS n FROM mail_messages WHERE ${CANDIDATES}`)
   .bind(tenantId,cutoff).first();
  if(!Number.isSafeInteger(row?.n)||row.n<0)throw Error('INVALID_RETENTION_COUNTER');
  if(dryRun)return Object.freeze({mode:'DRY_RUN',eligibleEnvelopes:row.n,erasedEnvelopes:0,
   note:'Only terminal encrypted payload residue is eligible. Legal deletion of other records remains unimplemented.'});
  const mutation=await db.prepare(`UPDATE mail_messages SET sealed_envelope=NULL WHERE ${CANDIDATES}`)
   .bind(tenantId,cutoff).run();
  if(mutation?.success!==true||!Number.isSafeInteger(mutation?.meta?.changes)||mutation.meta.changes<0)
   throw Error('RETENTION_WRITE_UNVERIFIED');
  return Object.freeze({mode:'ERASED',erasedEnvelopes:mutation.meta.changes,
   note:'Message records, idempotency, event evidence and suppressions preserved.'});
 }catch{throw Error('RETENTION_STORE_UNAVAILABLE');}
}
