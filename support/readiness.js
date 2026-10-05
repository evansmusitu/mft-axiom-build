export const SUPPORT_READINESS_GATES = Object.freeze([
  'PUBLIC_ORIGIN', 'SECURE_STORAGE', 'ENCRYPTION_KEY_MANAGEMENT', 'ANTI_ABUSE',
  'HUMAN_SUPPORT_OWNER', 'ESCALATION_ROSTER', 'PRIVACY_RETENTION',
  'ACCESSIBILITY_REALITY', 'SECURITY_REVIEW', 'BACKUP_RESTORE', 'NOTIFICATION_DELIVERY',
]);

const HASH = /^[a-f0-9]{64}$/i;

export function evaluateSupportReadiness(evidence = [], {now = new Date().toISOString(), maximumAgeDays = 90} = {}) {
  if (!Array.isArray(evidence)) throw new TypeError('evidence must be an array');
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new TypeError('now must be an ISO instant');
  const byGate = new Map();
  const invalid = [];
  for (const item of evidence) {
    if (!item || !SUPPORT_READINESS_GATES.includes(item.gate) || item.status !== 'PASS' || !HASH.test(String(item.artifact_sha256 ?? '')) || !item.verifier_ref) {
      invalid.push(item?.gate || 'UNKNOWN'); continue;
    }
    const verifiedMs = Date.parse(item.verified_at ?? '');
    if (!Number.isFinite(verifiedMs) || verifiedMs > nowMs || nowMs - verifiedMs > maximumAgeDays * 86_400_000) {
      invalid.push(item.gate); continue;
    }
    if (!byGate.has(item.gate)) byGate.set(item.gate, item);
  }
  const missing = SUPPORT_READINESS_GATES.filter(gate => !byGate.has(gate));
  return Object.freeze({
    schema: 'musitu.axiom.support-readiness.v1',
    status: missing.length === 0 && invalid.length === 0 ? 'READY' : 'NOT_READY',
    required_gates: SUPPORT_READINESS_GATES.length,
    passed_gates: byGate.size,
    missing_gates: Object.freeze(missing),
    invalid_or_stale_gates: Object.freeze([...new Set(invalid)]),
    public_operational_claim_authorized: missing.length === 0 && invalid.length === 0,
  });
}
