export const SUPPORT_CONTRACT_VERSION = 'musitu.axiom.support-control-plane.v1';

export const SUPPORT_SURFACES = Object.freeze([
  'web_app', 'mcp_openai', 'mcp_claude', 'mcp_other', 'oauth_account',
  'quantitative_result', 'evidence_reproducibility', 'api_runtime',
  'billing_commerce', 'privacy_data_rights', 'security', 'reviewer', 'status_incident',
]);

export const SUPPORT_CATEGORIES = Object.freeze([
  'access', 'bug', 'calculation_dispute', 'evidence_question', 'integration',
  'billing', 'privacy_request', 'security_report', 'incident', 'documentation',
  'accessibility', 'feedback',
]);

export const CASE_STATES = Object.freeze([
  'NEW', 'TRIAGED', 'WAITING_FOR_CUSTOMER', 'IN_PROGRESS', 'MITIGATED',
  'RESOLVED', 'CLOSED', 'DUPLICATE', 'REJECTED',
]);

export const STATE_TRANSITIONS = Object.freeze({
  NEW: Object.freeze(['TRIAGED', 'REJECTED', 'DUPLICATE']),
  TRIAGED: Object.freeze(['IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'DUPLICATE', 'REJECTED']),
  WAITING_FOR_CUSTOMER: Object.freeze(['IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  IN_PROGRESS: Object.freeze(['WAITING_FOR_CUSTOMER', 'MITIGATED', 'RESOLVED']),
  MITIGATED: Object.freeze(['IN_PROGRESS', 'RESOLVED']),
  RESOLVED: Object.freeze(['IN_PROGRESS', 'CLOSED']),
  CLOSED: Object.freeze([]),
  DUPLICATE: Object.freeze(['CLOSED']),
  REJECTED: Object.freeze(['CLOSED']),
});

export const PRIORITY_OBJECTIVES = Object.freeze({
  P0: Object.freeze({acknowledge_minutes: 15, update_minutes: 60, label: 'critical'}),
  P1: Object.freeze({acknowledge_minutes: 60, update_minutes: 240, label: 'high'}),
  P2: Object.freeze({acknowledge_minutes: 480, update_minutes: 1440, label: 'normal'}),
  P3: Object.freeze({acknowledge_minutes: 2880, update_minutes: 4320, label: 'low'}),
});

export const SENSITIVE_ACTIONS = Object.freeze([
  'ACCOUNT_RECOVERY', 'IDENTITY_CHANGE', 'ENTITLEMENT_CHANGE', 'REFUND',
  'DATA_EXPORT', 'DATA_DELETION', 'SECURITY_DISCLOSURE', 'PUBLIC_INCIDENT_UPDATE',
  'CASE_PURGE', 'LEGAL_HOLD_APPLY', 'LEGAL_HOLD_REVIEW', 'LEGAL_HOLD_RELEASE', 'PRODUCTION_CHANGE',
]);


export const CONVERSATION_MESSAGE_TYPES = Object.freeze([
  'CUSTOMER_MESSAGE', 'AGENT_REPLY', 'INTERNAL_NOTE', 'SYSTEM_EVENT',
]);

export const PUBLIC_CASE_LABELS = Object.freeze({
  NEW: 'NEW',
  IN_PROGRESS_MUSITU_SUPPORT: 'IN_PROGRESS',
  ACTION_REQUIRED: 'WAITING_FOR_CUSTOMER',
  SOLUTION_PROVIDED: 'RESOLVED',
  CLOSED: 'CLOSED',
  ESCALATED: 'TRIAGED',
});

const MAX = Object.freeze({summary: 160, description: 8000, reproduction: 6000, impact: 1000, evidenceRefs: 20});
const CASE_ID = /^AX-[0-9A-HJKMNP-TV-Z]{12}$/;
const REF_ID = /^[a-z][a-z0-9._:-]{7,191}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const SECRET_PATTERNS = Object.freeze([
  ['authorization_header', /\bauthorization\s*:\s*(?:bearer|basic)\s+\S+/i],
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ['oauth_code', /(?:^|[?&\s])(?:code|authorization_code)\s*[=:]\s*[A-Za-z0-9._~+\/-]{12,}/i],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['openai_key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['github_token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['credential_assignment', /\b(?:password|passwd|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|client[_ -]?secret|session[_ -]?cookie)\s*[=:]\s*[^\s,;]{8,}/i],
]);

const FORBIDDEN_KEYS = /^(?:password|passwd|authorization|access_?token|refresh_?token|id_?token|api_?key|client_?secret|private_?key|session_?cookie|secret)$/i;
const clean = (value, limit) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonical(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function luhn(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let total = 0; let parity = digits.length % 2;
  for (let i = 0; i < digits.length; i += 1) {
    let n = Number(digits[i]);
    if (i % 2 === parity && (n *= 2) > 9) n -= 9;
    total += n;
  }
  return total % 10 === 0;
}

export function inspectSecretMaterial(value, path = 'intake') {
  const findings = [];
  const walk = (candidate, location) => {
    if (Array.isArray(candidate)) return candidate.forEach((child, index) => walk(child, `${location}[${index}]`));
    if (plain(candidate)) {
      for (const [key, child] of Object.entries(candidate)) {
        if (FORBIDDEN_KEYS.test(key)) findings.push({path: `${location}.${key}`, type: 'forbidden_field'});
        else walk(child, `${location}.${key}`);
      }
      return;
    }
    if (typeof candidate !== 'string') return;
    for (const [type, pattern] of SECRET_PATTERNS) if (pattern.test(candidate)) findings.push({path: location, type});
    const numberCandidates = candidate.match(/(?:\d[ -]*?){13,19}/g) || [];
    if (numberCandidates.some(luhn)) findings.push({path: location, type: 'payment_card_number'});
  };
  walk(value, path);
  return Object.freeze({safe: findings.length === 0, findings: Object.freeze(findings.map(item => Object.freeze(item)))});
}

export class SecretMaterialError extends Error {
  constructor(findings) {
    super('Potential credential or payment secret detected. Remove it before submitting. Nothing was stored.');
    this.name = 'SecretMaterialError';
    this.code = 'SECRET_MATERIAL_REJECTED';
    this.findings = findings.map(({path, type}) => ({path, type}));
  }
}

export function derivePriority(candidate = {}) {
  const category = candidate.category;
  const affectedScope = candidate.affected_scope ?? candidate.affectedScope;
  const activeExploitation = candidate.active_exploitation ?? candidate.activeExploitation ?? false;
  const safetyImpact = candidate.safety_impact ?? candidate.safetyImpact ?? false;
  if ((category === 'security_report' && activeExploitation) || affectedScope === 'all_users' || safetyImpact) return 'P0';
  if (affectedScope === 'organization' || affectedScope === 'blocked' || category === 'incident') return 'P1';
  if (category === 'feedback' || category === 'documentation') return 'P3';
  return 'P2';
}

export function validateIntake(candidate) {
  const errors = [];
  if (!plain(candidate)) return Object.freeze({ok: false, errors: Object.freeze(['intake must be a plain object'])});
  const secretCheck = inspectSecretMaterial(candidate);
  if (!secretCheck.safe) throw new SecretMaterialError(secretCheck.findings);
  if (!SUPPORT_SURFACES.includes(candidate.surface)) errors.push('surface is not supported');
  if (!SUPPORT_CATEGORIES.includes(candidate.category)) errors.push('category is not supported');
  if (!['self', 'team', 'organization', 'all_users', 'blocked', 'unknown'].includes(candidate.affected_scope)) errors.push('affected_scope is invalid');
  if (!clean(candidate.summary, MAX.summary)) errors.push('summary is required');
  if (!clean(candidate.description, MAX.description)) errors.push('description is required');
  if (String(candidate.summary ?? '').length > MAX.summary) errors.push(`summary exceeds ${MAX.summary} characters`);
  if (String(candidate.description ?? '').length > MAX.description) errors.push(`description exceeds ${MAX.description} characters`);
  if (String(candidate.reproduction ?? '').length > MAX.reproduction) errors.push(`reproduction exceeds ${MAX.reproduction} characters`);
  if (String(candidate.impact ?? '').length > MAX.impact) errors.push(`impact exceeds ${MAX.impact} characters`);
  if (!Array.isArray(candidate.evidence_refs)) errors.push('evidence_refs must be an array');
  else {
    if (candidate.evidence_refs.length > MAX.evidenceRefs) errors.push(`evidence_refs exceeds ${MAX.evidenceRefs} entries`);
    candidate.evidence_refs.forEach((ref, index) => {
      if (!plain(ref) || !['request_id', 'trace_id', 'artifact_sha256', 'case_id', 'public_url'].includes(ref.kind)) errors.push(`evidence_refs[${index}] kind is invalid`);
      if (!clean(ref?.value, 500)) errors.push(`evidence_refs[${index}] value is required`);
    });
  }
  if (candidate.consent_to_process !== true) errors.push('consent_to_process must be true');
  if ('reply_to' in candidate || 'email' in candidate || 'phone' in candidate) errors.push('raw contact details are not accepted; use authenticated requester_ref or recovery access');
  if (candidate.requester_ref != null && !REF_ID.test(String(candidate.requester_ref))) errors.push('requester_ref must be an opaque identity reference');
  return Object.freeze({ok: errors.length === 0, errors: Object.freeze(errors)});
}

function nowIso(value = new Date().toISOString()) {
  if (!ISO.test(value) || !Number.isFinite(Date.parse(value))) throw new TypeError('at must be a UTC ISO instant');
  return new Date(value).toISOString();
}

export function normalizeIntake(candidate) {
  const validation = validateIntake(candidate);
  if (!validation.ok) throw new TypeError(`support intake violation: ${validation.errors.join('; ')}`);
  const priority = derivePriority(candidate);
  return Object.freeze({
    schema: SUPPORT_CONTRACT_VERSION,
    surface: candidate.surface,
    category: candidate.category,
    summary: clean(candidate.summary, MAX.summary),
    description: clean(candidate.description, MAX.description),
    reproduction: clean(candidate.reproduction, MAX.reproduction),
    impact: clean(candidate.impact, MAX.impact),
    affected_scope: candidate.affected_scope,
    active_exploitation: candidate.active_exploitation === true,
    safety_impact: candidate.safety_impact === true,
    evidence_refs: Object.freeze(candidate.evidence_refs.map(ref => Object.freeze({kind: ref.kind, value: clean(ref.value, 500)}))),
    requester_ref: candidate.requester_ref ? clean(candidate.requester_ref, 192) : null,
    priority,
    service_objective: PRIORITY_OBJECTIVES[priority],
    consent_to_process: true,
  });
}

function randomBase32(length) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map(byte => alphabet[byte % alphabet.length]).join('');
}

export function newCaseId() { return `AX-${randomBase32(12)}`; }
export function newRecoveryCode() { return `${randomBase32(8)}-${randomBase32(8)}-${randomBase32(8)}`; }


export async function recoveryIdentityHash({issuer, subject} = {}) {
  const normalizedIssuer = String(issuer || '').trim().replace(/\/+$/, '').toLowerCase();
  const normalizedSubject = String(subject || '').trim();
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(normalizedIssuer) || normalizedSubject.length < 3 || normalizedSubject.length > 512) {
    throw new TypeError('verified recovery identity issuer and subject are required');
  }
  return sha256({schema:'musitu.axiom.support-recovery-identity.v1',issuer:normalizedIssuer,subject:normalizedSubject});
}


export function storageStateForPublicLabel(label) {
  const value = PUBLIC_CASE_LABELS[String(label || '')];
  if (!value) throw new TypeError('unknown public support case label');
  return value;
}

export async function createConversationMessage({
  caseId,
  type,
  actor,
  visibility,
  body,
  at = new Date().toISOString(),
  messageId = `AXM-${randomBase32(16)}`,
} = {}) {
  if (!CASE_ID.test(String(caseId || ''))) throw new TypeError('valid case id required');
  if (!CONVERSATION_MESSAGE_TYPES.includes(type)) throw new TypeError('unknown support conversation message type');
  if (!/^AXM-[0-9A-HJKMNP-TV-Z]{16}$/.test(String(messageId || ''))) throw new TypeError('message id is invalid');
  if (!['customer', 'internal'].includes(visibility)) throw new TypeError('message visibility is invalid');
  const actorValue = clean(actor, 192);
  if (!actorValue) throw new TypeError('message actor is required');

  const actorOk = (
    (type === 'CUSTOMER_MESSAGE' && actorValue === 'requester' && visibility === 'customer') ||
    (type === 'AGENT_REPLY' && /^support_agent:[a-z0-9._:-]{3,160}$/i.test(actorValue) && visibility === 'customer') ||
    (type === 'INTERNAL_NOTE' && /^support_agent:[a-z0-9._:-]{3,160}$/i.test(actorValue) && visibility === 'internal') ||
    (type === 'SYSTEM_EVENT' && actorValue === 'system' && visibility === 'customer')
  );
  if (!actorOk) {
    if ((type === 'INTERNAL_NOTE' && visibility !== 'internal') || (type !== 'INTERNAL_NOTE' && visibility === 'internal')) {
      throw new TypeError('message visibility does not match message type');
    }
    throw new TypeError('message actor is not authorized for message type');
  }

  const value = clean(body, 8000);
  if (!value) throw new TypeError('message body is required');
  if (String(body ?? '').length > 8000) throw new TypeError('message body exceeds 8000 characters');
  const secretCheck = inspectSecretMaterial({body: value}, 'message');
  if (!secretCheck.safe) throw new SecretMaterialError(secretCheck.findings);

  const createdAt = nowIso(at);
  return Object.freeze({
    schema: 'musitu.axiom.support-conversation-message.v1',
    message_id: messageId,
    case_id: caseId,
    type,
    actor: actorValue,
    visibility,
    body: value,
    created_at: createdAt,
  });
}

export async function createCaseRecord(candidate, {at = new Date().toISOString(), caseId = newCaseId(), recoveryCode = newRecoveryCode()} = {}) {
  if (!CASE_ID.test(caseId)) throw new TypeError('caseId is invalid');
  const intake = normalizeIntake(candidate);
  const created_at = nowIso(at);
  const recovery_hash = await sha256(recoveryCode);
  const caseBody = {
    schema: SUPPORT_CONTRACT_VERSION,
    case_id: caseId,
    state: 'NEW',
    priority: intake.priority,
    surface: intake.surface,
    category: intake.category,
    requester_ref: intake.requester_ref,
    created_at,
    updated_at: created_at,
    last_event_hash: null,
    recovery_hash,
    retention_class: intake.category === 'security_report' ? 'SECURITY_RESTRICTED' : intake.category === 'privacy_request' ? 'PRIVACY_RESTRICTED' : 'SUPPORT_STANDARD',
    human_approval_required: ['access', 'billing', 'privacy_request', 'security_report'].includes(intake.category),
  };
  const event = await appendCaseEvent(caseBody, {
    type: 'CASE_CREATED', actor: 'requester', visibility: 'customer',
    payload: {priority: intake.priority, surface: intake.surface, category: intake.category},
  }, {at: created_at});
  return Object.freeze({
    case_record: Object.freeze({...caseBody, last_event_hash: event.event_hash}),
    intake,
    initial_event: event,
    recovery_code: recoveryCode,
  });
}

export async function appendCaseEvent(caseRecord, event, {at = new Date().toISOString()} = {}) {
  if (!plain(caseRecord) || !CASE_ID.test(String(caseRecord.case_id ?? ''))) throw new TypeError('valid case record required');
  if (!plain(event) || !clean(event.type, 80) || !clean(event.actor, 192)) throw new TypeError('event type and actor are required');
  if (!['customer', 'internal'].includes(event.visibility)) throw new TypeError('event visibility is invalid');
  const secretCheck = inspectSecretMaterial(event.payload);
  if (!secretCheck.safe) throw new SecretMaterialError(secretCheck.findings);
  const body = {
    schema: 'musitu.axiom.support-case-event.v1',
    case_id: caseRecord.case_id,
    type: clean(event.type, 80),
    actor: clean(event.actor, 192),
    visibility: event.visibility,
    payload: event.payload ?? {},
    prior_event_hash: caseRecord.last_event_hash,
    at: nowIso(at),
  };
  return Object.freeze({...body, event_hash: await sha256(body)});
}

export function assertTransition(from, to) {
  if (!CASE_STATES.includes(from) || !CASE_STATES.includes(to)) throw new TypeError('unknown support case state');
  if (!STATE_TRANSITIONS[from].includes(to)) throw new DOMException(`support case transition ${from} -> ${to} is not allowed`, 'InvalidStateError');
  return true;
}

export function evaluateSensitiveAction({action, actorRole, independentApprover = null, customerVerified = false, evidenceHashes = []} = {}) {
  if (!SENSITIVE_ACTIONS.includes(action)) throw new TypeError('unknown sensitive action');
  if (!['support_agent', 'privacy_officer', 'security_responder', 'billing_operator', 'incident_commander'].includes(actorRole)) throw new DOMException('actor role is not authorized', 'NotAllowedError');
  if (!customerVerified && ['ACCOUNT_RECOVERY', 'IDENTITY_CHANGE', 'ENTITLEMENT_CHANGE', 'REFUND', 'DATA_EXPORT', 'DATA_DELETION'].includes(action)) {
    return Object.freeze({allowed: false, gate: 'CUSTOMER_VERIFICATION', authority_effect: 'NONE'});
  }
  if (!independentApprover || independentApprover === actorRole) return Object.freeze({allowed: false, gate: 'INDEPENDENT_HUMAN_APPROVAL', authority_effect: 'NONE'});
  if (!Array.isArray(evidenceHashes) || evidenceHashes.length === 0 || evidenceHashes.some(hash => !HASH.test(hash))) {
    return Object.freeze({allowed: false, gate: 'EVIDENCE', authority_effect: 'NONE'});
  }
  return Object.freeze({allowed: true, gate: 'OPERATION_SCOPED_EXECUTOR', authority_effect: 'ADMISSION_ONLY'});
}

export async function verifyEventChain(events) {
  if (!Array.isArray(events)) return false;
  let prior = null;
  for (const event of events) {
    if (!plain(event) || event.prior_event_hash !== prior || !HASH.test(String(event.event_hash ?? ''))) return false;
    const {event_hash, ...body} = event;
    if (await sha256(body) !== event_hash) return false;
    prior = event_hash;
  }
  return true;
}

export function publicCaseView(caseRecord) {
  if (!plain(caseRecord) || !CASE_ID.test(String(caseRecord.case_id ?? ''))) throw new TypeError('valid case record required');
  return Object.freeze({
    schema: 'musitu.axiom.support-case-public.v1',
    case_id: caseRecord.case_id,
    state: caseRecord.state,
    priority: caseRecord.priority,
    surface: caseRecord.surface,
    category: caseRecord.category,
    created_at: caseRecord.created_at,
    updated_at: caseRecord.updated_at,
    service_objective: PRIORITY_OBJECTIVES[caseRecord.priority],
    service_objective_is_guarantee: false,
  });
}
