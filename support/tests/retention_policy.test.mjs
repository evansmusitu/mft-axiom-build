import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RETENTION_DAYS, LEGAL_HOLD_REVIEW_DAYS, retentionExpiry,
  createLegalHold, evaluatePurgeEligibility, buildDeletionReceipt,
} from '../retention_policy.js';

test('approved retention periods are exact and closure-based', () => {
  assert.deepEqual(RETENTION_DAYS, {
    SUPPORT_STANDARD: 180,
    PRIVACY_RESTRICTED: 90,
    SECURITY_RESTRICTED: 365,
  });
  assert.equal(LEGAL_HOLD_REVIEW_DAYS, 90);
  assert.equal(retentionExpiry('SUPPORT_STANDARD','2026-10-06T00:00:00Z'),'2027-04-04T00:00:00.000Z');
  assert.equal(retentionExpiry('PRIVACY_RESTRICTED','2026-10-06T00:00:00Z'),'2027-01-04T00:00:00.000Z');
  assert.equal(retentionExpiry('SECURITY_RESTRICTED','2026-10-06T00:00:00Z'),'2027-10-06T00:00:00.000Z');
});

test('legal hold requires owner plus different independent approver and a hashed reason', async () => {
  const reasonHash='a'.repeat(64);
  const hold=await createLegalHold({
    ownerRef:'github:evansmusitu',
    independentApproverRef:'person:elvis-musitu',
    reasonHash,
    at:'2026-10-06T00:00:00Z',
  });
  assert.equal(hold.status,'ACTIVE');
  assert.equal(hold.review_due_at,'2027-01-04T00:00:00.000Z');
  assert.equal(hold.reason_sha256,reasonHash);
  assert.equal('reason' in hold,false);
  await assert.rejects(()=>createLegalHold({
    ownerRef:'same-person',independentApproverRef:'same-person',reasonHash,at:'2026-10-06T00:00:00Z'
  }),/different independent approver/);
});

test('purge eligibility fails closed until case is closed, retention expired and legal hold inactive', () => {
  const base={state:'CLOSED',retention_class:'PRIVACY_RESTRICTED',closed_at:'2026-01-01T00:00:00Z'};
  assert.equal(evaluatePurgeEligibility({...base,now:'2026-03-01T00:00:00Z'}).eligible,false);
  assert.equal(evaluatePurgeEligibility({...base,now:'2026-04-02T00:00:00Z'}).eligible,true);
  assert.equal(evaluatePurgeEligibility({...base,state:'RESOLVED',now:'2026-04-02T00:00:00Z'}).eligible,false);
  assert.equal(evaluatePurgeEligibility({...base,now:'2026-04-02T00:00:00Z',legal_hold_until:'2026-05-01T00:00:00Z'}).eligible,false);
});

test('deletion receipt contains only hashes and lifecycle timestamps, never case content', async () => {
  const receipt=await buildDeletionReceipt({
    caseId:'AX-0123456789AB',
    retentionClass:'SUPPORT_STANDARD',
    closedAt:'2026-01-01T00:00:00Z',
    purgedAt:'2026-07-01T00:00:00Z',
    lastEventHash:'b'.repeat(64),
    approvalEvidenceHashes:['c'.repeat(64),'d'.repeat(64)],
  });
  assert.match(receipt.receipt_sha256,/^[a-f0-9]{64}$/);
  assert.match(receipt.case_reference_sha256,/^[a-f0-9]{64}$/);
  assert.equal('case_id' in receipt,false);
  assert.equal('narrative' in receipt,false);
  assert.equal(receipt.approval_evidence_hashes.length,2);
  assert.equal(receipt.processor_backup_expiry_note,'D1 Time Travel history expires under the active Cloudflare plan window; deletion is not represented as instantaneous backup erasure.');
});
