/** Read-only, tenant-scoped dependency inventory before OFFLINE key migration.
 * This is not a rotation, an authorization, proof of recoverable backups,
 * or an assertion that a remote KMS or privacy-key ledger is up to date.
 * Never retire key material just because a local database appears empty.
 */
const TENANT=/^[a-z][a-z0-9_-]{2,63}$/;
const DENIED=()=>{throw Error('ROTATION_AUDIT_DENIED');};
const SQL=`SELECT
 (SELECT COUNT(*) FROM mail_messages WHERE tenant_id=? AND sealed_envelope IS NOT NULL) AS encrypted_envelopes,
 (SELECT COUNT(*) FROM mail_messages WHERE tenant_id=? AND state IN ('QUEUED','SENDING','OUTCOME_UNKNOWN')) AS unreconciled_messages,
 (SELECT COUNT(*) FROM mail_messages WHERE tenant_id=? AND recipient_hmac IS NOT NULL) AS recipient_hmac_references,
 (SELECT COUNT(*) FROM mail_suppressions WHERE tenant_id=?) AS suppression_references,
 (SELECT COUNT(*) FROM mail_provider_events WHERE tenant_id=?) AS provider_events`;

export async function auditKeyRotationDependencies(db,{tenantId}={}){
 if(typeof tenantId!=='string'||!TENANT.test(tenantId)||!db||typeof db.prepare!=='function')DENIED();
 try{
  // One aggregate SELECT makes counts internally consistent on SQLite's
  // statement snapshot, but does not prevent subsequent concurrent writes.
  const row=await db.prepare(SQL).bind(tenantId,tenantId,tenantId,tenantId,tenantId).first();
  if(!row||typeof row!=='object')throw Error('MISSING_COUNTS');
  const columns=['encrypted_envelopes','unreconciled_messages','recipient_hmac_references',
   'suppression_references','provider_events'];
  if(columns.some(n=>!Number.isSafeInteger(row[n])||row[n]<0))throw Error('UNVERIFIED_COUNTS');
  const counts=Object.freeze({encryptedEnvelopes:row.encrypted_envelopes,
   unreconciledMessages:row.unreconciled_messages,
   recipientHmacReferences:row.recipient_hmac_references,
   suppressionReferences:row.suppression_references,providerEvents:row.provider_events});
  const encryptionKey=[...(counts.encryptedEnvelopes?['ENCRYPTED_ENVELOPES_REMAIN']:[]),
   ...(counts.unreconciledMessages?['UNRECONCILED_DELIVERY_REMAINS']:[]),
   'EXTERNAL_BACKUP_KEYS_UNKNOWN'];
  const privacyKey=[...(counts.recipientHmacReferences||counts.suppressionReferences?
   ['RECIPIENT_HMAC_REFERENCES_REMAIN']:[]),'EXTERNAL_BACKUP_KEYS_UNKNOWN'];
  return Object.freeze({tenantId,counts,
   blockers:Object.freeze({encryptionKey:Object.freeze(encryptionKey),
    privacyKey:Object.freeze(privacyKey),
    backupKey:Object.freeze(['EXTERNAL_BACKUP_KEYS_UNKNOWN']),
    signingPrivateKey:Object.freeze(['INDEPENDENTLY_PINNED_TRUST_TRANSITION_REQUIRED'])}),
   externalBackupInventoryVerified:false,rotationAuthorized:false,
   note:'Read-only bounded inventory; never proves safe key retirement. Requires external backup custody, migration, signed trust transition, and independent approval.'});
 }catch{throw Error('ROTATION_AUDIT_UNAVAILABLE');}
}
