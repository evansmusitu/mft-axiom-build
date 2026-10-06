import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateStandardWorkload, workloadFingerprint } from './standard-workload.mjs';
import { buildStandardVroomInput, runStandardVroomPlanning } from './vroom-standard.mjs';

const scenarioV1 = JSON.parse(fs.readFileSync(new URL('./scenario.standard-v1.json', import.meta.url), 'utf8'));
const scenarioV2 = JSON.parse(fs.readFileSync(new URL('./scenario.standard-v2.json', import.meta.url), 'utf8'));
const workloadV1 = generateStandardWorkload(scenarioV1);
const workload = generateStandardWorkload(scenarioV2);

test('superseded standard-v1 fails closed before VROOM because aggregate capacity is insufficient', () => {
  assert.throws(
    () => buildStandardVroomInput(workloadV1),
    (error) => error?.code === 'BENCHMARK_FLEET_CAPACITY_INFEASIBLE' && error?.demand === 250 && error?.capacity === 200,
  );
});

test('standard-v2 maps all capacity, skill, service and time-window constraints into VROOM', () => {
  const input = buildStandardVroomInput(workload);
  assert.equal(input.vehicles.length, 10);
  assert.equal(input.jobs.length, 100);
  assert.deepEqual(input.vehicles[0].capacity, [30]);
  assert.deepEqual(input.jobs[0].delivery, [workload.orders[0].demand]);
  assert.equal(input.jobs[0].service, workload.orders[0].service_minutes * 60);
  assert.deepEqual(input.jobs[0].time_windows, [[
    Math.floor(Date.parse(workload.orders[0].window.start) / 1000),
    Math.floor(Date.parse(workload.orders[0].window.end) / 1000),
  ]]);
  assert.ok(input.jobs[0].skills.length > input.jobs[1].skills.length);
});

test('standard-v2 VROOM input is deterministic and tied to exact workload fingerprint', () => {
  const a = buildStandardVroomInput(workload);
  const b = buildStandardVroomInput(workload);
  assert.deepEqual(a, b);
  assert.equal(a.metadata.workload_sha256, workloadFingerprint(workload));
  assert.equal(a.metadata.workload_sha256, 'fb80db552b55efb60c5372629c606cdd6879f796950ec44e1d854f46e8dfabdc');
});

test('benchmark planning fails closed if optimizer degrades to heuristic fallback', async () => {
  await assert.rejects(
    () => runStandardVroomPlanning({ workload, optimizer: { async optimize() { return { provider: 'heuristic-fallback', routes: [] }; } } }),
    (error) => error?.code === 'BENCHMARK_VROOM_REQUIRED',
  );
});

test('benchmark planning rejects a VROOM result that leaves standard-v2 jobs unassigned', async () => {
  await assert.rejects(
    () => runStandardVroomPlanning({ workload, optimizer: { async optimize() { return { provider: 'vroom', routes: [], unassigned: [{ id: 1 }] }; } } }),
    (error) => error?.code === 'BENCHMARK_WORKLOAD_UNASSIGNED',
  );
});

test('successful VROOM planning emits internal planning evidence without upgrading claim status', async () => {
  const result = await runStandardVroomPlanning({
    workload,
    optimizer: { async optimize(input) {
      return {
        provider: 'vroom',
        summary: { cost: 123, routes: input.vehicles.length, unassigned: 0, delivery: [250], distance: 42000, duration: 7200 },
        routes: input.vehicles.map((vehicle) => ({ vehicle: vehicle.id, steps: [] })),
        unassigned: [],
      };
    } },
  });
  assert.equal(result.evidence_kind, 'internal_controlled');
  assert.equal(result.claim_status, 'NOT_CERTIFIED');
  assert.equal(result.workload_sha256, workloadFingerprint(workload));
  assert.equal(result.provider, 'vroom');
});
