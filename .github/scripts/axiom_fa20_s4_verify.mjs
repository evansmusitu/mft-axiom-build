import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256 } from '../../axiom_interface/vnext/execution_security.js';

export const EXPECTED = Object.freeze({
  candidateCommit: '3de5cfd39e66577f70ccf0bc47af157525d44537',
  candidateArtifactSha256: '7ea8273c4028102e00a427148cf52d13ebb2191d12bfec4b0235601e5d0d9a89',
  releasePlanSha256: '537c5fe20e32f28beccf5f20157e3dbb7d30d95089acb1b6ac8bd64fd529dd6b',
  releasePolicySha256: 'd606db7b63576a275619ece77ad26f087919bede32f0025934ed6c2dc7598cff',
  authorityCommit: '21d087f0fdebffd4cfb4065286aa16696fcec9c0',
  evaluatorCommit: 'e5940a2ca92b3669f912f402c20a83af113fd026',
  rollbackOriginCommit: '4c99c4ccbc4a9e34f4e446f30c31f4d428359818',
  rollbackEvidenceSha256: 'd82dae88d967a5c466c03dd5698ec575f05c5434230494d2fa39fb7bfba4afa8',
  preproductionEvidenceSha256: 'd256dc115b4638f90861ddcfeba91cb1dee2b65419f8fd8f7749b7ba2ca3e24f',
  approvalRequestSha256: 'ca3cad148121cc12e2ce141dec062cb2604c0c4134b741c9e78688c7d0b4a7cd',
  artifactZipSha256: '637485c03b50a3b8eea54adaa3e3eaa62814b629d0dd8220a95ffefbf3d810e6',
  preproductionRunId: 35083289098,
  preproductionArtifactId: 10441201458,
  productionTarget: 'axiom.mftintelligence.com',
  exactConfirmation: 'APPROVE FA20 S4 PRODUCTION PROMOTION',
  verifierIdentity: 'github-actions-independent-fa20-s4-verifier',
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exact(value, expected, label) {
  invariant(Object.is(value, expected), `${label} drift`);
}

function exactArray(value, expected, label) {
  invariant(Array.isArray(value), `${label} must be an array`);
  invariant(value.length === expected.length && value.every((item, index) => Object.is(item, expected[index])), `${label} drift`);
}

function without(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

export async function verifyS4Release({
  evidence,
  request,
  artifactBytes,
  verifierCommit,
  verifierIdentity = EXPECTED.verifierIdentity,
  preproductionRunId = EXPECTED.preproductionRunId,
  preproductionArtifactId = EXPECTED.preproductionArtifactId,
  artifactZipSha256 = EXPECTED.artifactZipSha256,
} = {}) {
  invariant(evidence && typeof evidence === 'object' && !Array.isArray(evidence), 'preproduction evidence object required');
  invariant(request && typeof request === 'object' && !Array.isArray(request), 'S4 approval request object required');
  invariant(artifactBytes instanceof Uint8Array, 'candidate artifact bytes required');
  invariant(/^[0-9a-f]{40}$/.test(String(verifierCommit || '')), 'exact verifier commit required');
  exact(verifierIdentity, EXPECTED.verifierIdentity, 'verifier identity');
  invariant(verifierIdentity !== 'github-actions-fa20-staging-v2-runner', 'builder and verifier identities must be distinct');
  invariant(verifierCommit !== EXPECTED.evaluatorCommit && verifierCommit !== EXPECTED.authorityCommit && verifierCommit !== EXPECTED.candidateCommit, 'verifier commit must be distinct from builder commits');
  exact(Number(preproductionRunId), EXPECTED.preproductionRunId, 'preproduction run');
  exact(Number(preproductionArtifactId), EXPECTED.preproductionArtifactId, 'preproduction artifact');
  exact(artifactZipSha256, EXPECTED.artifactZipSha256, 'preproduction artifact ZIP digest');

  exact(evidence.schema, 'musitu.axiom.fa20.preproduction-evidence.v3', 'evidence schema');
  exact(evidence.status, 'PASS_READY_FOR_EXACT_S4_APPROVAL', 'evidence status');
  exact(evidence.candidate_commit, EXPECTED.candidateCommit, 'evidence candidate');
  exact(evidence.candidate_artifact_sha256, EXPECTED.candidateArtifactSha256, 'evidence artifact');
  exact(evidence.release_plan_sha256, EXPECTED.releasePlanSha256, 'evidence release plan');
  exact(evidence.authority_commit, EXPECTED.authorityCommit, 'evidence authority');
  exact(evidence.evaluator_commit, EXPECTED.evaluatorCommit, 'evidence evaluator');
  exactArray(evidence.failed_attempts_preserved, [35082342750, 35082972066], 'preserved failed attempts');
  exactArray(evidence.failed_attempt_causes, ['ISOLATED_WORKERS_DEV_SUBDOMAIN_NOT_EXPLICITLY_ENABLED', 'ASSET_PROBE_DID_NOT_RETRY_PROPAGATION_404'], 'preserved failure causes');
  exact(evidence.rollback_origin_commit, EXPECTED.rollbackOriginCommit, 'rollback origin');
  for (const key of ['staging_executed', 'canary_executed', 'browser_desktop_mobile_pass', 'rollback_rehearsal_passed', 'candidate_restored_before_cleanup', 'isolated_workers_cleaned', 'old_app_retained']) exact(evidence[key], true, `evidence ${key}`);
  for (const key of ['production_executed', 'production_authority']) exact(evidence[key], false, `evidence ${key}`);
  exact(evidence.tablet_evidence, 'DEFERRED_PENDING_FUTURE_CUSTOMER', 'tablet evidence truth boundary');
  exact(evidence.external_comparison, 'DEFERRED_NO_PAID_PROVIDER_ACCESS', 'paid-provider truth boundary');
  exact(evidence.evidence_sha256, EXPECTED.preproductionEvidenceSha256, 'evidence seal');
  exact(await sha256(without(evidence, 'evidence_sha256')), EXPECTED.preproductionEvidenceSha256, 'recomputed evidence seal');

  exact(request.schema, 'musitu.axiom.fa20.s4-production-approval-request.v1', 'request schema');
  exact(request.status, 'AWAITING_S4_APPROVAL', 'request status');
  exact(request.release_id, 'fa20-3de5cfd39e66577f', 'release id');
  exact(request.candidate_commit, EXPECTED.candidateCommit, 'request candidate');
  exact(request.candidate_artifact_sha256, EXPECTED.candidateArtifactSha256, 'request artifact');
  exact(request.release_plan_sha256, EXPECTED.releasePlanSha256, 'request release plan');
  exact(request.release_policy_sha256, EXPECTED.releasePolicySha256, 'request release policy');
  exact(request.production_target, EXPECTED.productionTarget, 'production target');
  exact(request.rollback_origin_evidence_sha256, EXPECTED.rollbackEvidenceSha256, 'rollback evidence');
  exactArray(request.required_distinct_roles, ['HUMAN_RELEASE_APPROVER', 'INDEPENDENT_VERIFIER'], 'required roles');
  exact(request.exact_confirmation, EXPECTED.exactConfirmation, 'exact human confirmation');
  exact(request.production_execution_allowed, false, 'request production execution authority');
  exact(request.tablet_evidence, 'DEFERRED_PENDING_FUTURE_CUSTOMER', 'request tablet evidence truth boundary');
  exact(request.external_comparison, 'DEFERRED_NO_PAID_PROVIDER_ACCESS', 'request paid-provider truth boundary');
  exact(request.superiority, 'NOT_CERTIFIED', 'superiority claim');
  exact(request.approval_request_sha256, EXPECTED.approvalRequestSha256, 'request seal');
  exact(await sha256(without(request, 'approval_request_sha256')), EXPECTED.approvalRequestSha256, 'recomputed request seal');

  const candidateArtifactSha256 = createHash('sha256').update(artifactBytes).digest('hex');
  exact(candidateArtifactSha256, EXPECTED.candidateArtifactSha256, 'candidate artifact bytes');

  const body = {
    schema: 'musitu.axiom.fa20.independent-s4-release-verifier.v1',
    status: 'INDEPENDENT_VERIFIER_APPROVED_FOR_FA20_S4_HUMAN_GATE',
    release_role: 'INDEPENDENT_VERIFIER',
    release_role_approval: true,
    scope: 'EXACT_FA20_S4_REQUEST_ONLY',
    candidate_commit: EXPECTED.candidateCommit,
    candidate_artifact_sha256: EXPECTED.candidateArtifactSha256,
    release_plan_sha256: EXPECTED.releasePlanSha256,
    release_policy_sha256: EXPECTED.releasePolicySha256,
    approval_request_sha256: EXPECTED.approvalRequestSha256,
    preproduction_evidence_sha256: EXPECTED.preproductionEvidenceSha256,
    preproduction_run_id: EXPECTED.preproductionRunId,
    preproduction_artifact_id: EXPECTED.preproductionArtifactId,
    preproduction_artifact_zip_sha256: EXPECTED.artifactZipSha256,
    authority_commit: EXPECTED.authorityCommit,
    evaluator_commit: EXPECTED.evaluatorCommit,
    verifier_commit: String(verifierCommit),
    verifier_identity: verifierIdentity,
    builder_and_verifier_distinct: true,
    exact_artifact_replay_verified: true,
    failure_history_preserved: true,
    rollback_rehearsal_verified: true,
    isolated_cleanup_verified: true,
    production_target: EXPECTED.productionTarget,
    exact_human_confirmation_required: EXPECTED.exactConfirmation,
    human_release_approval_present: false,
    production_execution_authorized: false,
    repository_write_authority_present: false,
    production_credentials_present: false,
    production_authority: false,
    tablet_evidence: 'DEFERRED_PENDING_FUTURE_CUSTOMER',
    external_comparison: 'DEFERRED_NO_PAID_PROVIDER_ACCESS',
    superiority: 'NOT_CERTIFIED',
  };
  return { ...body, attestation_sha256: await sha256(body) };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    invariant(/^--[a-z0-9-]+$/.test(key || '') && value !== undefined, 'arguments must be --key value pairs');
    result[key.slice(2)] = value;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of ['evidence', 'request', 'artifact', 'verifier-commit', 'output']) invariant(args[key], `--${key} required`);
  const [evidence, request, artifactBytes] = await Promise.all([
    readFile(args.evidence, 'utf8').then(JSON.parse),
    readFile(args.request, 'utf8').then(JSON.parse),
    readFile(args.artifact),
  ]);
  const attestation = await verifyS4Release({
    evidence,
    request,
    artifactBytes,
    verifierCommit: args['verifier-commit'],
    verifierIdentity: args['verifier-identity'] || EXPECTED.verifierIdentity,
    preproductionRunId: args['preproduction-run-id'] || EXPECTED.preproductionRunId,
    preproductionArtifactId: args['preproduction-artifact-id'] || EXPECTED.preproductionArtifactId,
    artifactZipSha256: args['artifact-zip-sha256'] || EXPECTED.artifactZipSha256,
  });
  await writeFile(args.output, `${JSON.stringify(attestation, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`fa20_independent_s4_attestation_sha256=${attestation.attestation_sha256}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
