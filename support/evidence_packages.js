import {inspectSecretMaterial, sha256} from './control_plane.js';

const HASH = /^[a-f0-9]{64}$/i;
const CASE_ID = /^AX-[0-9A-HJKMNP-TV-Z]{12}$/;
const OPERATION = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const clean = (value, limit = 500) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);

function assertHash(value, field) {
  if (!HASH.test(String(value ?? ''))) throw new TypeError(`${field} must be a SHA-256 digest`);
  return String(value).toLowerCase();
}

function at(value) {
  const parsed = Date.parse(value ?? '');
  if (!Number.isFinite(parsed)) throw new TypeError('at must be an ISO instant');
  return new Date(parsed).toISOString();
}

export async function buildQuantitativeDisputePackage({
  caseId, operation, sanitizedInputSha256, axiomResult, axiomResultSha256,
  runtimeVersion, evidenceHashes = [], independentReproduction = null,
  at: createdAt = new Date().toISOString(),
} = {}) {
  if (!CASE_ID.test(String(caseId ?? ''))) throw new TypeError('valid caseId required');
  if (!OPERATION.test(String(operation ?? ''))) throw new TypeError('qualified operation identifier required');
  if (!['string', 'number', 'boolean'].includes(typeof axiomResult) || (typeof axiomResult === 'number' && !Number.isFinite(axiomResult))) throw new TypeError('axiomResult must be a finite scalar');
  if (!clean(runtimeVersion, 200)) throw new TypeError('runtimeVersion required');
  if (!Array.isArray(evidenceHashes) || evidenceHashes.some(hash => !HASH.test(String(hash)))) throw new TypeError('evidenceHashes must contain SHA-256 digests');
  if (independentReproduction != null) {
    if (typeof independentReproduction !== 'object' || !['MATCH', 'DIFFERS', 'INCONCLUSIVE'].includes(independentReproduction.status)) throw new TypeError('independent reproduction status is invalid');
    assertHash(independentReproduction.artifact_sha256, 'independentReproduction.artifact_sha256');
  }
  const secretCheck = inspectSecretMaterial({runtimeVersion, independentReproduction});
  if (!secretCheck.safe) throw new TypeError('evidence package contains forbidden secret material');
  const body = {
    schema: 'musitu.axiom.support-quantitative-dispute-evidence.v1', case_id: caseId,
    operation, sanitized_input_sha256: assertHash(sanitizedInputSha256, 'sanitizedInputSha256'),
    axiom_result: axiomResult, axiom_result_sha256: assertHash(axiomResultSha256, 'axiomResultSha256'),
    runtime_version: clean(runtimeVersion, 200), evidence_hashes: [...new Set(evidenceHashes.map(hash => hash.toLowerCase()))].sort(),
    independent_reproduction: independentReproduction ? {
      status: independentReproduction.status,
      artifact_sha256: independentReproduction.artifact_sha256.toLowerCase(),
      verifier_ref: clean(independentReproduction.verifier_ref, 192) || null,
    } : null,
    raw_inputs_included: false, credential_material_included: false, created_at: at(createdAt),
  };
  return Object.freeze({...body, package_sha256: await sha256(body)});
}

export async function createVerifiedPublicIncidentUpdate({
  incidentId, state, summary, affectedSurfaces = [], evidenceHashes = [],
  incidentCommander, independentVerifier, at: createdAt = new Date().toISOString(),
} = {}) {
  if (!/^INC-[0-9A-HJKMNP-TV-Z]{10}$/.test(String(incidentId ?? ''))) throw new TypeError('valid incidentId required');
  if (!['INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED'].includes(state)) throw new TypeError('incident state is invalid');
  const publicSummary = clean(summary, 1000);
  if (!publicSummary) throw new TypeError('public incident summary required');
  if (!Array.isArray(affectedSurfaces) || affectedSurfaces.length === 0) throw new TypeError('affectedSurfaces required');
  if (!Array.isArray(evidenceHashes) || evidenceHashes.length === 0 || evidenceHashes.some(hash => !HASH.test(String(hash)))) throw new TypeError('verified incident evidence required');
  const commander = clean(incidentCommander, 192); const verifier = clean(independentVerifier, 192);
  if (!commander || !verifier || commander === verifier) throw new DOMException('independent incident verifier required', 'NotAllowedError');
  if (!inspectSecretMaterial({summary: publicSummary}).safe) throw new TypeError('public summary contains forbidden secret material');
  const body = {
    schema: 'musitu.axiom.support-public-incident-update.v1', incident_id: incidentId, state,
    summary: publicSummary, affected_surfaces: [...new Set(affectedSurfaces.map(value => clean(value, 100)))].sort(),
    evidence_hashes: [...new Set(evidenceHashes.map(hash => hash.toLowerCase()))].sort(),
    incident_commander: commander, independent_verifier: verifier,
    evidence_verified: true, superiority_claim: false, published_at: at(createdAt),
  };
  return Object.freeze({...body, update_sha256: await sha256(body)});
}
