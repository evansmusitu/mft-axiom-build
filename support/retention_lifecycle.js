import {appendCaseEvent, assertTransition, evaluateSensitiveAction} from './control_plane.js';
import {buildDeletionReceipt, createLegalHold, evaluatePurgeEligibility, LEGAL_HOLD_SENTINEL, retentionExpiry} from './retention_policy.js';

const CASE_ID=/^AX-[0-9A-HJKMNP-TV-Z]{12}$/;
const HASH=/^[a-f0-9]{64}$/i;

function requireDb(database){
  if(!database?.prepare||!database?.batch) throw new TypeError('D1-compatible database binding required');
}

function randomToken(length){
  const alphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes=crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map(byte=>alphabet[byte%alphabet.length]).join('');
}

function addMinutes(value,minutes){
  const d=new Date(value);
  if(!Number.isFinite(d.getTime())) throw new TypeError('purge instant is invalid');
  d.setUTCMinutes(d.getUTCMinutes()+minutes);
  return d.toISOString();
}



export async function closeSupportCase({
  database,caseId,at=new Date().toISOString(),actor,
}={}) {
  requireDb(database);
  if(!CASE_ID.test(String(caseId||''))) throw new TypeError('valid case id required');
  const actorRef=String(actor||'').trim();
  if(!actorRef) throw new TypeError('closure actor is required');
  const row=await database.prepare(`SELECT case_id,state,priority,surface,category,retention_class,closed_at,retention_expires_at,last_event_hash,created_at,updated_at,public_json
    FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
  if(!row) throw new Error('support case not found');
  assertTransition(String(row.state),'CLOSED');
  const closedAt=new Date(at).toISOString();
  const expiresAt=retentionExpiry(String(row.retention_class),closedAt);
  const event=await appendCaseEvent(row,{
    type:'CASE_CLOSED',actor:actorRef,visibility:'internal',
    payload:{from_state:String(row.state),retention_class:String(row.retention_class),retention_expires_at:expiresAt},
  },{at:closedAt});
  const publicView={...JSON.parse(String(row.public_json||'{}')),state:'CLOSED',updated_at:closedAt};
  await database.batch([
    database.prepare(`UPDATE support_cases SET state=?,closed_at=?,retention_expires_at=?,last_event_hash=?,updated_at=?,public_json=? WHERE case_id=?`)
      .bind('CLOSED',closedAt,expiresAt,event.event_hash,closedAt,JSON.stringify(publicView),caseId),
    database.prepare(`INSERT INTO support_case_events
      (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind(
        event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,
        JSON.stringify(event.payload),event.at,
      ),
  ]);
  return Object.freeze({
    case_id:caseId,state:'CLOSED',closed_at:closedAt,retention_class:String(row.retention_class),
    retention_expires_at:expiresAt,event_hash:event.event_hash,
  });
}

function authorizeRetentionAction({action,actorRole,ownerRef,independentApproverRef,approvalEvidenceHashes}) {
  const owner=String(ownerRef||'').trim();
  const approver=String(independentApproverRef||'').trim();
  if(!owner||!approver||owner===approver) throw new Error('legal hold requires owner and a different independent approver');
  if(!Array.isArray(approvalEvidenceHashes)||approvalEvidenceHashes.length===0||approvalEvidenceHashes.some(x=>!HASH.test(String(x)))) {
    throw new TypeError('legal hold approval evidence hashes are required');
  }
  const admission=evaluateSensitiveAction({
    action,actorRole,independentApprover:approver,customerVerified:true,evidenceHashes:approvalEvidenceHashes,
  });
  if(!admission.allowed) throw new Error(`legal hold authorization denied: ${admission.gate}`);
  return {owner,approver,admission};
}

async function getRetentionCase(database,caseId) {
  const row=await database.prepare(`SELECT case_id,state,retention_class,closed_at,retention_expires_at,legal_hold_until,legal_hold_review_at,last_event_hash,updated_at
    FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
  if(!row) throw new Error('support case not found');
  return row;
}

async function persistLegalHoldEvent({database,row,event,updateStatement}) {
  await database.batch([
    updateStatement,
    database.prepare(`INSERT INTO support_case_events
      (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind(
        event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,
        JSON.stringify(event.payload),event.at,
      ),
  ]);
}

export async function applyLegalHold({
  database,caseId,reasonHash,at=new Date().toISOString(),actorRole,ownerRef,independentApproverRef,approvalEvidenceHashes=[],
}={}) {
  requireDb(database);
  if(!CASE_ID.test(String(caseId||''))) throw new TypeError('valid case id required');
  const {owner,approver,admission}=authorizeRetentionAction({
    action:'LEGAL_HOLD_APPLY',actorRole,ownerRef,independentApproverRef,approvalEvidenceHashes,
  });
  const row=await getRetentionCase(database,caseId);
  if(row.legal_hold_until) throw new Error('support case already has an active legal hold');
  const hold=await createLegalHold({ownerRef:owner,independentApproverRef:approver,reasonHash,at});
  const event=await appendCaseEvent(row,{
    type:'LEGAL_HOLD_APPLIED',actor:owner,visibility:'internal',
    payload:{reason_sha256:hold.reason_sha256,independent_approver_ref:approver,review_due_at:hold.review_due_at},
  },{at:hold.started_at});
  await persistLegalHoldEvent({
    database,row,event,
    updateStatement:database.prepare(`UPDATE support_cases SET legal_hold_until=?,legal_hold_review_at=?,last_event_hash=?,updated_at=? WHERE case_id=?`)
      .bind(hold.hold_until,hold.review_due_at,event.event_hash,event.at,caseId),
  });
  return Object.freeze({...hold,authority_effect:admission.authority_effect,event_hash:event.event_hash});
}

export async function reviewLegalHold({
  database,caseId,reasonHash,at=new Date().toISOString(),actorRole,ownerRef,independentApproverRef,approvalEvidenceHashes=[],
}={}) {
  requireDb(database);
  const {owner,approver,admission}=authorizeRetentionAction({
    action:'LEGAL_HOLD_REVIEW',actorRole,ownerRef,independentApproverRef,approvalEvidenceHashes,
  });
  const row=await getRetentionCase(database,caseId);
  if(String(row.legal_hold_until||'')!==LEGAL_HOLD_SENTINEL) throw new Error('support case has no active legal hold to review');
  const hold=await createLegalHold({ownerRef:owner,independentApproverRef:approver,reasonHash,at});
  const event=await appendCaseEvent(row,{
    type:'LEGAL_HOLD_REVIEWED',actor:owner,visibility:'internal',
    payload:{reason_sha256:hold.reason_sha256,independent_approver_ref:approver,review_due_at:hold.review_due_at},
  },{at:hold.started_at});
  await persistLegalHoldEvent({
    database,row,event,
    updateStatement:database.prepare(`UPDATE support_cases SET legal_hold_review_at=?,last_event_hash=?,updated_at=? WHERE case_id=?`)
      .bind(hold.review_due_at,event.event_hash,event.at,caseId),
  });
  return Object.freeze({...hold,authority_effect:admission.authority_effect,event_hash:event.event_hash});
}

export async function releaseLegalHold({
  database,caseId,at=new Date().toISOString(),actorRole,ownerRef,independentApproverRef,approvalEvidenceHashes=[],
}={}) {
  requireDb(database);
  const {owner,approver,admission}=authorizeRetentionAction({
    action:'LEGAL_HOLD_RELEASE',actorRole,ownerRef,independentApproverRef,approvalEvidenceHashes,
  });
  const row=await getRetentionCase(database,caseId);
  if(String(row.legal_hold_until||'')!==LEGAL_HOLD_SENTINEL) throw new Error('support case has no active legal hold to release');
  const releasedAt=new Date(at).toISOString();
  const event=await appendCaseEvent(row,{
    type:'LEGAL_HOLD_RELEASED',actor:owner,visibility:'internal',
    payload:{independent_approver_ref:approver},
  },{at:releasedAt});
  await persistLegalHoldEvent({
    database,row,event,
    updateStatement:database.prepare(`UPDATE support_cases SET legal_hold_until=NULL,legal_hold_review_at=NULL,last_event_hash=?,updated_at=? WHERE case_id=?`)
      .bind(event.event_hash,event.at,caseId),
  });
  return Object.freeze({status:'RELEASED',released_at:releasedAt,authority_effect:admission.authority_effect,event_hash:event.event_hash});
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
  const attachmentRows=await database.prepare('SELECT attachment_id,storage_key,sha256 FROM support_attachments WHERE case_id=? ORDER BY created_at ASC').bind(caseId).all();
  const attachmentDeletionStatements=(attachmentRows?.results||[]).map(item=>
    database.prepare(`INSERT INTO support_attachment_deletion_outbox
      (deletion_id,storage_key,sha256,state,attempts,next_attempt_at,created_at,deleted_at)
      VALUES (?,?,?,'PENDING',0,NULL,?,NULL)`)
      .bind('AXZ-'+randomToken(16),String(item.storage_key),String(item.sha256),purgedAt)
  );

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
    ...attachmentDeletionStatements,
    database.prepare(`DELETE FROM support_notification_attempts WHERE notification_id IN
      (SELECT notification_id FROM support_notification_outbox WHERE case_id=?)`).bind(caseId),
    database.prepare('DELETE FROM support_case_approval_decisions WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_case_messages WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_case_assignments WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_case_recovery_rotations WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_case_approvals WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_notification_outbox WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_case_recovery_requests WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_case_recovery_bindings WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_case_sla WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_case_escalations WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_incident_cases WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_attachments WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_diagnostics WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_webhook_outbox WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_operator_leases WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_case_handoffs WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_case_triage WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_case_languages WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_csat WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_qa_reviews WHERE case_id=?').bind(caseId),
    database.prepare('DELETE FROM support_email_threads WHERE case_id=?').bind(caseId),
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
