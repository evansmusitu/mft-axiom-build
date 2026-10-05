import assert from 'node:assert/strict';
import test from 'node:test';
import {buildQuantitativeDisputePackage, createVerifiedPublicIncidentUpdate} from '../evidence_packages.js';
import {SUPPORT_READINESS_GATES, evaluateSupportReadiness} from '../readiness.js';

test('quantitative dispute package binds the actual operation and hashes without raw inputs', async () => {
  const packet = await buildQuantitativeDisputePackage({
    caseId: 'AX-0123456789AB', operation: 'finance.npv', sanitizedInputSha256: 'a'.repeat(64),
    axiomResult: 117570.2344, axiomResultSha256: 'b'.repeat(64), runtimeVersion: 'axiom-runtime-2026.10',
    evidenceHashes: ['d'.repeat(64), 'c'.repeat(64)],
    independentReproduction: {status: 'MATCH', artifact_sha256: 'e'.repeat(64), verifier_ref: 'verifier_independent_1'},
    at: '2026-10-05T13:00:00Z',
  });
  assert.equal(packet.operation, 'finance.npv');
  assert.equal(packet.axiom_result, 117570.2344);
  assert.equal(packet.raw_inputs_included, false);
  assert.equal(packet.credential_material_included, false);
  assert.deepEqual(packet.evidence_hashes, ['c'.repeat(64), 'd'.repeat(64)]);
  assert.match(packet.package_sha256, /^[a-f0-9]{64}$/);
});

test('public incident update is blocked without evidence or an independent verifier', async () => {
  const base = {incidentId: 'INC-0123456789', state: 'INVESTIGATING', summary: 'A subset of API calls is failing.', affectedSurfaces: ['api_runtime'], incidentCommander: 'incident_commander_1', at: '2026-10-05T13:00:00Z'};
  await assert.rejects(() => createVerifiedPublicIncidentUpdate(base), /verified incident evidence required/);
  await assert.rejects(() => createVerifiedPublicIncidentUpdate({...base, evidenceHashes: ['a'.repeat(64)], independentVerifier: 'incident_commander_1'}), /independent incident verifier required/);
  const update = await createVerifiedPublicIncidentUpdate({...base, evidenceHashes: ['a'.repeat(64)], independentVerifier: 'verifier_independent_1'});
  assert.equal(update.evidence_verified, true);
  assert.equal(update.superiority_claim, false);
  assert.match(update.update_sha256, /^[a-f0-9]{64}$/);
});

test('public operational claim remains blocked until every fresh deployment and human gate passes', () => {
  const none = evaluateSupportReadiness([], {now: '2026-10-05T14:00:00Z'});
  assert.equal(none.status, 'NOT_READY');
  assert.equal(none.public_operational_claim_authorized, false);
  assert.deepEqual(none.missing_gates, SUPPORT_READINESS_GATES);

  const evidence = SUPPORT_READINESS_GATES.map((gate, index) => ({gate, status: 'PASS', artifact_sha256: index.toString(16).padStart(64, 'a'), verifier_ref: `verifier_${index}`, verified_at: '2026-10-05T13:00:00Z'}));
  const ready = evaluateSupportReadiness(evidence, {now: '2026-10-05T14:00:00Z'});
  assert.equal(ready.status, 'READY');
  assert.equal(ready.public_operational_claim_authorized, true);
});

test('stale evidence fails closed', () => {
  const evidence = SUPPORT_READINESS_GATES.map((gate, index) => ({gate, status: 'PASS', artifact_sha256: index.toString(16).padStart(64, 'b'), verifier_ref: `verifier_${index}`, verified_at: '2026-01-01T00:00:00Z'}));
  const result = evaluateSupportReadiness(evidence, {now: '2026-10-05T14:00:00Z'});
  assert.equal(result.status, 'NOT_READY');
  assert.equal(result.invalid_or_stale_gates.length, SUPPORT_READINESS_GATES.length);
});
