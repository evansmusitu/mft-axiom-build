import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateStandardWorkload, workloadFingerprint } from './standard-workload.mjs';
import { buildStandardVroomInput, runStandardVroomPlanning } from './vroom-standard.mjs';

const scenario = JSON.parse(fs.readFileSync(new URL('./scenario.standard-v1.json', import.meta.url), 'utf8'));
const workload = generateStandardWorkload(scenario);

test('standard workload maps all capacity, skill, service and time-window constraints into VROOM', () => {
  const input = buildStandardVroomInput(workload);
  assert.equal(input.vehicles.length, 10);
  assert.equal(input.jobs.length, 100);
  assert.deepEqual(input.vehicles[0].capacity, [20]);
  assert.ok(input.vehicles[0].skills.length >= 1);
  assert.deepEqual(input.jobs[0].delivery, [workload.orders[0].demand]);
  assert.equal(input.jobs[0].service, workload.orders[0].service_minutes * 60);
  assert.deepEqual(input.jobs[0].time_windows, [[
    Math.floor(Date.parse(workload.orders[0].window.start) / 1000),
    Math.floor(Date.parse(workload.orders[0].window.end) / 1000),
  ]]);
  assert.ok(input.jobs[0].skills.length > input.jobs[1].skills.length);
});

test('standard VROOM input is deterministic and tied to exact workload fingerprint', () => {
  const a = buildStandardVroomInput(workload);
  const b = buildStandardVroomInput(workload);
  assert.deepEqual(a, b);
  assert.equal(a.metadata.workload_sha256, workloadFingerprint(workload));
  assert.equal(a.metadata.scenario_id, workload.scenario_id);
});

test('benchmark planning fails closed if optimizer degrades to heuristic fallback', async () => {
  await assert.rejects(
    () => runStandardVroomPlanning({
      workload,
      optimizer: { async optimize() { return { provider: 'heuristic-fallback', routes: [] }; } },
    }),
    (error) => error?.code === 'BENCHMARK_VROOM_REQUIRED',
  );
});

test('benchmark planning rejects a VROOM result that leaves standard-v1 jobs unassigned', async () => {
  await assert.rejects(
    () => runStandardVroomPlanning({
      workload,
      optimizer: { async optimize() { return { provider: 'vroom', routes: [], unassigned: [{ id: 1 }] }; } },
    }),
    (error) => error?.code === 'BENCHMARK_WORKLOAD_UNASSIGNED',
  );
});

test('successful VROOM planning emits internal planning evidence without upgrading claim status', async () => {
  const result = await runStandardVroomPlanning({
    workload,
    optimizer: {
      async optimize(input) {
        return {
          provider: 'vroom',
          summary: { cost: 123, routes: input.vehicles.length, unassigned: 0, delivery: [100], distance: 42000, duration: 7200 },
          routes: input.vehicles.map((vehicle) => ({ vehicle: vehicle.id, steps: [] })),
          unassigned: [],
        };
      },
    },
  });
  assert.equal(result.schema, 'musitu-delivery-vroom-planning.v1');
  assert.equal(result.evidence_kind, 'internal_controlled');
  assert.equal(result.claim_status, 'NOT_CERTIFIED');
  assert.equal(result.workload_sha256, workloadFingerprint(workload));
  assert.equal(result.provider, 'vroom');
});
