import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBenchmarkReport,
  fingerprintRun,
  validateRun,
} from './benchmark.mjs';

const scenario = {
  id: 'musitu-last-mile-standard-v1',
  version: 1,
  metrics: {
    assignment_decision_ms: 'lower',
    route_total_distance_m: 'lower',
    on_time_completion_rate: 'higher',
    operator_interventions: 'lower',
    proof_completeness_rate: 'higher',
  },
};

function run(provider, evidenceKind = 'live_external') {
  return {
    schema: 'musitu-delivery-benchmark-run.v1',
    provider,
    scenario,
    evidence: {
      kind: evidenceKind,
      source: evidenceKind === 'live_external' ? 'sandbox_api' : 'internal_controlled',
      captured_at: '2026-10-06T00:00:00Z',
    },
    metrics: {
      assignment_decision_ms: 120,
      route_total_distance_m: 42000,
      on_time_completion_rate: 0.96,
      operator_interventions: 2,
      proof_completeness_rate: 1,
    },
  };
}

test('internal controlled evidence can never certify external superiority', () => {
  const report = buildBenchmarkReport({
    musitu: run('musitu', 'internal_controlled'),
    competitors: [],
  });
  assert.equal(report.claim_status, 'NOT_CERTIFIED');
  assert.equal(report.comparison_ready, false);
  assert.match(report.reasons.join(' '), /live external competitor evidence/i);
});

test('comparison becomes review-ready only with matching live external evidence', () => {
  const report = buildBenchmarkReport({
    musitu: run('musitu'),
    competitors: [run('onfleet')],
  });
  assert.equal(report.claim_status, 'EVIDENCE_READY_FOR_REVIEW');
  assert.equal(report.comparison_ready, true);
  assert.equal(report.comparisons.length, 1);
  assert.equal(report.comparisons[0].provider, 'onfleet');
  assert.equal(report.comparisons[0].metrics.on_time_completion_rate.direction, 'higher');
});

test('scenario mismatch fails closed', () => {
  const competitor = run('bringg');
  competitor.scenario = { ...scenario, version: 2 };
  const report = buildBenchmarkReport({ musitu: run('musitu'), competitors: [competitor] });
  assert.equal(report.claim_status, 'NOT_CERTIFIED');
  assert.equal(report.comparison_ready, false);
  assert.match(report.reasons.join(' '), /scenario contract mismatch/i);
});

test('run validation rejects unsupported evidence kinds and incomplete metrics', () => {
  const bad = run('onfleet');
  bad.evidence.kind = 'marketing_claim';
  delete bad.metrics.operator_interventions;
  assert.throws(() => validateRun(bad), /evidence kind/i);
});

test('run fingerprint is deterministic across object key order', () => {
  const a = run('musitu');
  const b = {
    metrics: { ...a.metrics },
    evidence: { ...a.evidence },
    scenario: { metrics: { ...a.scenario.metrics }, version: 1, id: a.scenario.id },
    provider: a.provider,
    schema: a.schema,
  };
  assert.equal(fingerprintRun(a), fingerprintRun(b));
});
