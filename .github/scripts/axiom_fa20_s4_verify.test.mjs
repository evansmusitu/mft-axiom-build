import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { EXPECTED, verifyS4Release } from './axiom_fa20_s4_verify.mjs';

const evidenceRoot = process.env.FA20_PREPRODUCTION_DIR || '/tmp/fa20-preproduction-v3';
const verifierCommit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

async function inputs() {
  const [evidence, request, artifactBytes] = await Promise.all([
    readFile(join(evidenceRoot, 'fa20-preproduction-evidence.json'), 'utf8').then(JSON.parse),
    readFile(join(evidenceRoot, 'fa20-s4-approval-request.json'), 'utf8').then(JSON.parse),
    readFile(join(evidenceRoot, 'fa20-static-candidate.tgz')),
  ]);
  return { evidence, request, artifactBytes, verifierCommit };
}

test('approves only the exact sealed FA20 S4 artifact for the human gate', async () => {
  const attestation = await verifyS4Release(await inputs());
  assert.equal(attestation.status, 'INDEPENDENT_VERIFIER_APPROVED_FOR_FA20_S4_HUMAN_GATE');
  assert.equal(attestation.release_role_approval, true);
  assert.equal(attestation.human_release_approval_present, false);
  assert.equal(attestation.production_execution_authorized, false);
  assert.equal(attestation.production_credentials_present, false);
  assert.match(attestation.attestation_sha256, /^[0-9a-f]{64}$/);
});

test('rejects a rewritten preproduction result even if it claims production success', async () => {
  const value = await inputs();
  value.evidence.production_executed = true;
  await assert.rejects(verifyS4Release(value), /production_executed drift/);
});

test('rejects a request that silently grants production execution', async () => {
  const value = await inputs();
  value.request.production_execution_allowed = true;
  await assert.rejects(verifyS4Release(value), /production execution authority drift/);
});

test('rejects builder self-certification and a changed candidate artifact', async () => {
  const identityAttack = await inputs();
  identityAttack.verifierIdentity = 'github-actions-fa20-staging-v2-runner';
  await assert.rejects(verifyS4Release(identityAttack), /verifier identity drift/);

  const artifactAttack = await inputs();
  artifactAttack.artifactBytes = Buffer.concat([artifactAttack.artifactBytes, Buffer.from('tamper')]);
  await assert.rejects(verifyS4Release(artifactAttack), /candidate artifact bytes drift/);
});

test('keeps unfunded and future-customer evidence explicitly deferred', async () => {
  const value = await inputs();
  const attestation = await verifyS4Release(value);
  assert.equal(attestation.tablet_evidence, 'DEFERRED_PENDING_FUTURE_CUSTOMER');
  assert.equal(attestation.external_comparison, 'DEFERRED_NO_PAID_PROVIDER_ACCESS');
  assert.equal(attestation.superiority, 'NOT_CERTIFIED');
  assert.equal(EXPECTED.exactConfirmation, 'APPROVE FA20 S4 PRODUCTION PROMOTION');
});
