/**
 * MUSITU AXIOM Final Product — FA-06 governed application foundation contracts.
 *
 * Change-control record
 * objective: Establish the typed, fail-closed final-product foundation without
 *            changing sealed production/review surfaces or granting execution authority.
 * branch: build/axiom-final-fa06-20260917
 * affected_components: application contracts, surface registry, identity/session boundary
 * actor: ChatGPT implementation direction under explicit START BUILDING authorization
 * security_scope: S0/S1 contract validation only; no external network/action execution
 * acceptance: deterministic schema validation; unknown object/risk/qualification values fail closed
 * rollback: revert/delete this additive module from the isolated build branch
 * evidence: authoritative 2026-09-15 final-product handoff + live GitHub pre-write checks
 *
 * This module is additive and development-only. It is NOT production promotion
 * authority and does not certify Phase 13, Phase 14, Phase 15, Wolfram parity,
 * superiority, or any external comparative claim.
 */

import { clean, rejectSecretLike } from './agent_security.js';

export const FOUNDATION_SCHEMA_VERSION = 'musitu.axiom.final-product.foundation.v1';
export const HOME_PRIMARY_PROMPT = 'What do you want accomplished?';

export const PERMANENT_OBJECT_TYPES = Object.freeze([
  'Project',
  'Work',
  'Agent',
  'Artifact',
  'Evidence',
]);

export const OBJECT_FIELDS = Object.freeze({
  Project: Object.freeze([
    'goal', 'objects', 'work', 'agents', 'artifacts', 'sources', 'memory',
    'evidence', 'decisions', 'deployments', 'evaluations', 'failures',
  ]),
  Work: Object.freeze([
    'objective', 'acceptance_criteria', 'plan', 'tasks', 'agents', 'capabilities',
    'approvals', 'budget', 'deadline', 'checkpoints', 'outputs', 'verification',
  ]),
  Agent: Object.freeze([
    'identity', 'role', 'purpose', 'tool_scopes', 'data_scopes', 'network_scope',
    'autonomy', 'budget', 'policies', 'model_route', 'status', 'history',
    'kill_switch', 'evidence',
  ]),
  Artifact: Object.freeze([
    'type', 'versions', 'provenance', 'dependencies', 'diff', 'comments',
    'permissions', 'export', 'rollback',
  ]),
  Evidence: Object.freeze([
    'inputs', 'sources', 'capability_chain', 'calculations', 'actions', 'policies',
    'approvals', 'hashes', 'receipts', 'verification', 'failures', 'timestamps',
    'versions',
  ]),
});

export const FINAL_PRODUCT_SURFACES = Object.freeze([
  Object.freeze({ id: 'home', label: 'Home', primary: true }),
  Object.freeze({ id: 'projects', label: 'Projects' }),
  Object.freeze({ id: 'work', label: 'Work' }),
  Object.freeze({ id: 'agents', label: 'Agents' }),
  Object.freeze({ id: 'research', label: 'Research' }),
  Object.freeze({ id: 'knowledge-memory', label: 'Knowledge / Memory' }),
  Object.freeze({ id: 'analyze', label: 'Analyze' }),
  Object.freeze({ id: 'twin-scenario-lab', label: 'Twin / Scenario Lab' }),
  Object.freeze({ id: 'artifacts-create', label: 'Artifacts / Create' }),
  Object.freeze({ id: 'build-engineering-command-center', label: 'Build / Engineering Command Center' }),
  Object.freeze({ id: 'computer', label: 'Computer' }),
  Object.freeze({ id: 'live', label: 'Live' }),
  Object.freeze({ id: 'automations', label: 'Automations' }),
  Object.freeze({ id: 'evidence-observatory', label: 'Evidence Observatory' }),
  Object.freeze({ id: 'trust', label: 'Trust' }),
  Object.freeze({ id: 'developer', label: 'Developer' }),
  Object.freeze({ id: 'marketplace', label: 'Marketplace' }),
  Object.freeze({ id: 'enterprise-control-plane', label: 'Enterprise Control Plane' }),
  Object.freeze({ id: 'search-command', label: 'Search / Command' }),
  Object.freeze({ id: 'inbox', label: 'Inbox' }),
]);

export const RISK_CLASSES = Object.freeze({
  S0: Object.freeze({ label: 'harmless read/compute', consequential: false }),
  S1: Object.freeze({ label: 'private reversible write', consequential: false }),
  S2: Object.freeze({ label: 'external read', consequential: false }),
  S3: Object.freeze({ label: 'external reversible write/repo mutation', consequential: true }),
  S4: Object.freeze({ label: 'public publication/production deployment', consequential: true }),
  S5: Object.freeze({ label: 'secrets/identity/security policy/destructive or critical irreversible action', consequential: true }),
});

export const CAPABILITY_TRUTH_CLASSES = Object.freeze([
  'CERTIFIED_ATOMIC',
  'REGISTERED_DERIVED',
  'DISCOVERED_CANDIDATE',
  'FRONTIER_EXPERIMENTAL',
  'TARGET_ONLY',
]);

export const FRONTIER_EVIDENCE_CLASSES = Object.freeze([
  'TARGET_ONLY',
  'IMPLEMENTED_UNQUALIFIED',
  'LOCALLY_QUALIFIED',
  'LIVE_ADAPTER_EVIDENCED',
  'PRODUCTION_EVIDENCED',
  'EXTERNAL_COMPARATIVE_EVIDENCED',
  'INDEPENDENTLY_VALIDATED',
  'LONGITUDINALLY_DEFENSIBLE',
]);

export const CLAIM_BOUNDARY = Object.freeze({
  phase_12: 'HIGHEST_FULLY_EARNED_SEALED_INTERFACE_PHASE',
  phase_13: 'SKIPPED_UNEARNED',
  phase_14: 'INCOMPLETE_UNEARNED_PHYSICAL_TABLET_EVIDENCE_MISSING',
  phase_15: 'UNEARNED',
  wolfram_parity: 'NOT_CERTIFIED',
  superiority: 'NOT_CERTIFIED',
  final_product_qualification: 'NOT_YET_EARNED',
  production_promotion_authority: 'NONE_FROM_FA06_FOUNDATION',
});

export const RUNTIME_AUTHORITY_BOUNDARY = Object.freeze({
  external_action_authority: 'NONE_FROM_FA06_FOUNDATION',
  production_deployment_authority: 'NONE_FROM_FA06_FOUNDATION',
  secrets_authority: 'NONE_FROM_FA06_FOUNDATION',
  retrieved_content_authority: 'DATA_ONLY_NEVER_POLICY_AUTHORITY',
  builder_self_certification: 'FORBIDDEN',
});

const SESSION_MODES = Object.freeze(['guest', 'authenticated']);
const ID_RX = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SENSITIVE_OBJECT_KEY_RX = /^(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|private[_ -]?key|authorization|secret|client[_ -]?secret)$/i;

function invariant(condition, message, ErrorType = TypeError) {
  if (!condition) throw new ErrorType(message);
}

function plainRecord(value, label) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), `${label} must be a plain object`);
  const proto = Object.getPrototypeOf(value);
  invariant(proto === Object.prototype || proto === null, `${label} must be a plain object`);
  return value;
}

function rejectSensitiveObjectKeys(value, label = 'value', seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) {
    throw new DOMException(`${label} contains cyclic object data`, 'SecurityError');
  }

  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_OBJECT_KEY_RX.test(key.trim())) {
      throw new DOMException(`${label} contains forbidden secret-bearing key`, 'SecurityError');
    }
    rejectSensitiveObjectKeys(child, `${label}.${key}`, seen);
  }
  seen.delete(value);
}

function normalizeId(value, label) {
  const normalized = clean(value, 128);
  invariant(ID_RX.test(normalized), `${label} must be a bounded opaque identifier`);
  return normalized;
}

function cloneAndFreeze(value) {
  const cloned = structuredClone(value);
  const visit = node => {
    if (!node || typeof node !== 'object' || Object.isFrozen(node)) return node;
    for (const child of Object.values(node)) visit(child);
    return Object.freeze(node);
  };
  return visit(cloned);
}

/**
 * @typedef {'Project'|'Work'|'Agent'|'Artifact'|'Evidence'} AxiomObjectType
 * @typedef {'S0'|'S1'|'S2'|'S3'|'S4'|'S5'} AxiomRiskClass
 * @typedef {'CERTIFIED_ATOMIC'|'REGISTERED_DERIVED'|'DISCOVERED_CANDIDATE'|'FRONTIER_EXPERIMENTAL'|'TARGET_ONLY'} CapabilityTruthClass
 */

/**
 * Validate and freeze one of AXIOM's five permanent product objects.
 * Unknown fields are permitted for additive versioning, but every canonical field
 * for the selected object type must be present. This keeps the core contract stable
 * while allowing future phases to extend objects without silently deleting required state.
 *
 * @param {AxiomObjectType} type
 * @param {Record<string, unknown>} payload
 * @param {{id?: string, version?: number}} metadata
 */
export function createPermanentObject(type, payload, metadata = {}) {
  invariant(PERMANENT_OBJECT_TYPES.includes(type), `unknown permanent object type: ${String(type)}`);
  plainRecord(payload, `${type} payload`);
  rejectSensitiveObjectKeys(payload, `${type} payload`);
  rejectSecretLike(payload, `${type} payload`);

  const missing = OBJECT_FIELDS[type].filter(field => !Object.prototype.hasOwnProperty.call(payload, field));
  invariant(missing.length === 0, `${type} missing canonical fields: ${missing.join(', ')}`);

  const id = metadata.id ? normalizeId(metadata.id, `${type} id`) : `${type.toLowerCase()}_${crypto.randomUUID()}`;
  const version = Number(metadata.version ?? 1);
  invariant(Number.isInteger(version) && version >= 1, `${type} version must be a positive integer`);

  return cloneAndFreeze({
    schema: FOUNDATION_SCHEMA_VERSION,
    object_type: type,
    object_id: id,
    version,
    data: payload,
  });
}

/**
 * Normalize a session identity without admitting secrets into JavaScript state.
 * Authentication proof remains server-side; browser code receives only opaque identity metadata.
 */
export function normalizeIdentitySession(raw = {}) {
  plainRecord(raw, 'session');
  rejectSensitiveObjectKeys(raw, 'session');
  rejectSecretLike(raw, 'session');

  const mode = clean(raw.mode ?? 'guest', 24).toLowerCase();
  invariant(SESSION_MODES.includes(mode), 'unsupported session mode');

  const session = {
    schema: 'musitu.axiom.identity-session.v1',
    mode,
    session_id: normalizeId(raw.session_id ?? raw.sessionId ?? `session_${crypto.randomUUID()}`, 'session id'),
    subject_id: null,
    organization_id: null,
    expires_at: null,
    credential_material: 'SERVER_SIDE_ONLY_NOT_PRESENT',
    authority_source: mode === 'authenticated' ? 'SAME_ORIGIN_VERIFIED_SESSION_ENDPOINT' : 'GUEST_LOCAL_WORKSPACE',
  };

  if (mode === 'authenticated') {
    session.subject_id = normalizeId(raw.subject_id ?? raw.subjectId, 'subject id');
    session.organization_id = normalizeId(raw.organization_id ?? raw.organizationId, 'organization id');
    const expiry = new Date(raw.expires_at ?? raw.expiresAt);
    invariant(Number.isFinite(expiry.getTime()), 'authenticated session expiry required');
    invariant(expiry.getTime() > Date.now(), 'authenticated session must not be expired', DOMException);
    session.expires_at = expiry.toISOString();
  } else {
    session.subject_id = 'guest';
    session.organization_id = 'browser-local-personal-workspace';
  }

  return cloneAndFreeze(session);
}

export function requireRiskClass(riskClass) {
  const normalized = clean(riskClass, 2).toUpperCase();
  invariant(Object.prototype.hasOwnProperty.call(RISK_CLASSES, normalized), `unsupported risk class: ${normalized}`, DOMException);
  return Object.freeze({ id: normalized, ...RISK_CLASSES[normalized] });
}

export function requireCapabilityTruthClass(value) {
  const normalized = clean(value, 64).toUpperCase();
  invariant(CAPABILITY_TRUTH_CLASSES.includes(normalized), `unsupported capability truth class: ${normalized}`, DOMException);
  return normalized;
}

export function requireFrontierEvidenceClass(value) {
  const normalized = clean(value, 64).toUpperCase();
  invariant(FRONTIER_EVIDENCE_CLASSES.includes(normalized), `unsupported frontier evidence class: ${normalized}`, DOMException);
  return normalized;
}

export function surfaceById(id) {
  const normalized = clean(id, 96).toLowerCase();
  const surface = FINAL_PRODUCT_SURFACES.find(item => item.id === normalized);
  invariant(surface, `unregistered final-product surface: ${normalized}`, DOMException);
  return surface;
}

/**
 * Deterministic invariant check for CI/browser tests. It checks contract shape only;
 * it does not certify production readiness or any downstream phase.
 */
export function verifyFoundationContract() {
  invariant(PERMANENT_OBJECT_TYPES.length === 5, 'exactly five permanent object types required');
  for (const type of PERMANENT_OBJECT_TYPES) {
    invariant(Array.isArray(OBJECT_FIELDS[type]) && OBJECT_FIELDS[type].length > 0, `${type} fields required`);
    invariant(new Set(OBJECT_FIELDS[type]).size === OBJECT_FIELDS[type].length, `${type} fields must be unique`);
  }
  invariant(FINAL_PRODUCT_SURFACES.length === 20, 'final product surface registry must contain 20 surfaces');
  invariant(FINAL_PRODUCT_SURFACES.filter(surface => surface.primary).length === 1, 'exactly one primary surface required');
  invariant(surfaceById('home').primary === true, 'Home must remain the primary surface');
  invariant(HOME_PRIMARY_PROMPT === 'What do you want accomplished?', 'Home primary prompt drifted');
  invariant(Object.keys(RISK_CLASSES).join(',') === 'S0,S1,S2,S3,S4,S5', 'risk taxonomy drifted');
  invariant(CAPABILITY_TRUTH_CLASSES.length === 5, 'capability truth taxonomy drifted');
  invariant(CLAIM_BOUNDARY.wolfram_parity === 'NOT_CERTIFIED', 'Wolfram parity boundary drifted');
  invariant(CLAIM_BOUNDARY.superiority === 'NOT_CERTIFIED', 'superiority boundary drifted');
  invariant(RUNTIME_AUTHORITY_BOUNDARY.builder_self_certification === 'FORBIDDEN', 'builder/verifier separation drifted');
  return Object.freeze({
    schema: FOUNDATION_SCHEMA_VERSION,
    status: 'PASS_CONTRACT_INVARIANTS_ONLY',
    production_qualified: false,
    external_claim_authorized: false,
  });
}

export const FOUNDATION_CONTRACT = Object.freeze({
  schema: FOUNDATION_SCHEMA_VERSION,
  home_primary_prompt: HOME_PRIMARY_PROMPT,
  permanent_object_types: PERMANENT_OBJECT_TYPES,
  object_fields: OBJECT_FIELDS,
  surfaces: FINAL_PRODUCT_SURFACES,
  risk_classes: RISK_CLASSES,
  capability_truth_classes: CAPABILITY_TRUTH_CLASSES,
  frontier_evidence_classes: FRONTIER_EVIDENCE_CLASSES,
  claim_boundary: CLAIM_BOUNDARY,
  runtime_authority_boundary: RUNTIME_AUTHORITY_BOUNDARY,
});
