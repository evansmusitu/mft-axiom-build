import {evaluateSensitiveAction} from './control_plane.js';
import {buildDeletionReceipt, evaluatePurgeEligibility} from './retention_policy.js';

const CASE_ID=/^AX-[0-9A-HJKMNP-TV-Z]{12}$/;
const HASH=/^[a-f0-9]{64}$/i;

function requireDb(database){
  if(!database?.prepare||!database?.batch) throw new TypeError('D1-compatible database binding required');
}

function addMinutes(value,minutes){
  const d=new Date(value);
  if(!Number.isFinite(d.getTime())) throw new TypeError('purge instant is invalid');
  d.setUTCMinutes(d.getUTCMinutes()+minutes);
  return d.toISOString();
}

export async function purgeExpiredCase({
  database,
  caseId,
  now=new Date().toISOString(),
  actorRole,
  ownerRef,
  independentApproverRef,
  approvalEvidenceHashes=[],
}={}){
  requireDb(database);
  if(!CASE_ID.test(String(caseId||''))) throw new TypeError('valid case id required');
  const owner=String(ownerRef||'').trim();
  const approver=String(independentApproverRef||'').trim();
  if(!owner||!approver||owner===approver) throw new Error('case purge requires owner and a different independent approver');
  if(!Array.isArray(approvalEvidenceHashes)||approvalEvidenceHashes.length===0||approvalEvidenceHashes.some(x=>!HASH.test(String(x)))) {
    throw new TypeError('case purge approval evidence hashes are required');
  }

  const admission=evaluateSensitiveAction({
    action:'CASE_PURGE',
    actorRole,
    independentApprover:approver,
    customerVerified:true,
    evidenceHashes:approvalEvidenceHashes,
  });
  if(!admission.allowed) throw new Error(`case purge authorization denied: ${admission.gate}`);

  const row=await database.prepare(`SELECT case_id,state,retention_class,closed_at,retention_expires_at,legal_hold_until,last_event_hash
    FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
  if(!row) throw new Error('support case not found');

  const eligibility=evaluatePurgeEligibility({...row,now});
  if(!eligibility.eligible) throw new Error(`support case is not eligible for purge: ${eligibility.reason}`);
  if(row.retention_expires_at && String(row.retention_expires_at)!==eligibility.retention_expires_at) {
    throw new Error('stored retention expiry does not match approved retention policy');
  }

  const purgedAt=new Date(now).toISOString();
  const receipt=await buildDeletionReceipt({
    caseId,
    retentionClass:String(row.retention_class),
    closedAt:String(row.closed_at),
    purgedAt,
    lastEventHash:String(row.last_event_hash),
    approvalEvidenceHashes,
  });
  const authExpires=addMinutes(purgedAt,5);

  await database.batch([
    database.prepare(`INSERT INTO support_case_purge_authorizations
      (case_id,receipt_sha256,authorized_at,expires_at) VALUES (?,?,?,?)`)
      .bind(caseId,receipt.receipt_sha256,purgedAt,authExpires),
    database.prepare(`INSERT INTO support_deletion_receipts
      (receipt_sha256,case_reference_sha256,retention_class,closed_at,retention_expires_at,purged_at,last_event_hash,approval_evidence_hashes_json,processor_backup_expiry_note,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        receipt.receipt_sha256,receipt.case_reference_sha256,receipt.retention_class,receipt.closed_at,
        receipt.retention_expires_at,receipt.purged_at,receipt.last_event_hash,
        JSON.stringify(receipt.approval_evidence_hashes),receipt.processor_backup_expiry_note,purgedAt,
      ),
    database.prepare('DELETE FROM support_case_events WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_cases WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_case_purge_authorizations WHERE case_id=?').bind(caseId),
  ]);

  const [remainingCase,remainingEvents,storedReceipt]=await Promise.all([
    database.prepare('SELECT case_id FROM support_cases WHERE case_id=? LIMIT 1').bind(caseId).first(),
    database.prepare('SELECT COUNT(*) AS count FROM support_case_events WHERE case_id=?').bind(caseId).first(),
    database.prepare('SELECT receipt_sha256,case_reference_sha256,purged_at FROM support_deletion_receipts WHERE receipt_sha256=? LIMIT 1').bind(receipt.receipt_sha256).first(),
  ]);
  if(remainingCase||Number(remainingEvents?.count??-1)!==0||String(storedReceipt?.receipt_sha256||'')!==receipt.receipt_sha256) {
    throw new Error('support case purge verification failed');
  }

  return Object.freeze({
    status:'PURGED',
    receipt,
    live_customer_content_deleted:true,
    processor_backup_expiry_pending:true,
    authority_effect:admission.authority_effect,
  });
}
