export const RETENTION_DAYS = Object.freeze({
  SUPPORT_STANDARD: 180,
  PRIVACY_RESTRICTED: 90,
  SECURITY_RESTRICTED: 365,
});

export const LEGAL_HOLD_REVIEW_DAYS = 90;

const HASH=/^[a-f0-9]{64}$/i;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function instant(value,label='instant'){
  const raw=String(value||'');
  if(!ISO.test(raw)||!Number.isFinite(Date.parse(raw))) throw new TypeError(`${label} must be a UTC ISO instant`);
  return new Date(raw);
}

function addDays(value,days){
  const d=instant(value);
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString();
}

async function hash(value){
  const bytes=new TextEncoder().encode(String(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

export function retentionExpiry(retentionClass,closedAt){
  const days=RETENTION_DAYS[retentionClass];
  if(!Number.isInteger(days)) throw new TypeError('unknown retention class');
  return addDays(closedAt,days);
}

export async function createLegalHold({
  ownerRef,
  independentApproverRef,
  reasonHash,
  at=new Date().toISOString(),
}={}){
  const owner=String(ownerRef||'').trim();
  const approver=String(independentApproverRef||'').trim();
  if(!owner||!approver||owner===approver) throw new Error('legal hold requires owner and a different independent approver');
  if(!HASH.test(String(reasonHash||''))) throw new TypeError('legal hold reason must be represented by a SHA-256 hash');
  const started=instant(at,'legal hold start').toISOString();
  return Object.freeze({
    schema:'musitu.axiom.support-legal-hold.v1',
    status:'ACTIVE',
    owner_ref:owner,
    independent_approver_ref:approver,
    reason_sha256:String(reasonHash).toLowerCase(),
    started_at:started,
    review_due_at:addDays(started,LEGAL_HOLD_REVIEW_DAYS),
  });
}

export function evaluatePurgeEligibility({
  state,
  retention_class:retentionClass,
  closed_at:closedAt,
  now=new Date().toISOString(),
  legal_hold_until:legalHoldUntil=null,
}={}){
  if(state!=='CLOSED') return Object.freeze({eligible:false,reason:'CASE_NOT_CLOSED'});
  let expiresAt;
  try { expiresAt=retentionExpiry(retentionClass,closedAt); }
  catch { return Object.freeze({eligible:false,reason:'RETENTION_METADATA_INVALID'}); }
  const nowMs=instant(now,'now').getTime();
  if(legalHoldUntil){
    const holdUntil=instant(legalHoldUntil,'legal_hold_until').getTime();
    if(holdUntil>nowMs) return Object.freeze({eligible:false,reason:'LEGAL_HOLD_ACTIVE',retention_expires_at:expiresAt});
  }
  if(nowMs<instant(expiresAt,'retention expiry').getTime()) {
    return Object.freeze({eligible:false,reason:'RETENTION_ACTIVE',retention_expires_at:expiresAt});
  }
  return Object.freeze({eligible:true,reason:'RETENTION_EXPIRED',retention_expires_at:expiresAt});
}

export async function buildDeletionReceipt({
  caseId,
  retentionClass,
  closedAt,
  purgedAt=new Date().toISOString(),
  lastEventHash,
  approvalEvidenceHashes=[],
}={}){
  if(!/^AX-[0-9A-HJKMNP-TV-Z]{12}$/.test(String(caseId||''))) throw new TypeError('valid case id required');
  if(!Number.isInteger(RETENTION_DAYS[retentionClass])) throw new TypeError('unknown retention class');
  const closed=instant(closedAt,'closed_at').toISOString();
  const purged=instant(purgedAt,'purged_at').toISOString();
  if(!HASH.test(String(lastEventHash||''))) throw new TypeError('last event hash required');
  if(!Array.isArray(approvalEvidenceHashes)||approvalEvidenceHashes.length===0||approvalEvidenceHashes.some(x=>!HASH.test(String(x)))) {
    throw new TypeError('approval evidence hashes are required');
  }
  const caseRef=await hash(String(caseId));
  const body={
    schema:'musitu.axiom.support-deletion-receipt.v1',
    case_reference_sha256:caseRef,
    retention_class:retentionClass,
    closed_at:closed,
    retention_expires_at:retentionExpiry(retentionClass,closed),
    purged_at:purged,
    last_event_hash:String(lastEventHash).toLowerCase(),
    approval_evidence_hashes:approvalEvidenceHashes.map(x=>String(x).toLowerCase()).sort(),
    live_customer_content_deleted:true,
    processor_backup_expiry_note:'D1 Time Travel history expires under the active Cloudflare plan window; deletion is not represented as instantaneous backup erasure.',
  };
  return Object.freeze({...body,receipt_sha256:await hash(JSON.stringify(body))});
}
