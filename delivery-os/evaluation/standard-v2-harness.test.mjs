import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateStandardWorkload } from './standard-workload.mjs';
import { runStandardV2Harness } from './standard-v2-harness.mjs';

const scenario = JSON.parse(fs.readFileSync(new URL('./scenario.standard-v2.json', import.meta.url), 'utf8'));
const workload = generateStandardWorkload(scenario);

class FakeVroom {
  constructor() { this.calls = 0; }
  async optimize(input) {
    this.calls += 1;
    const routes = input.vehicles.map((vehicle) => ({
      vehicle: vehicle.id,
      distance: 0,
      duration: 0,
      steps: [{ type: 'start', arrival: Math.min(...input.jobs.map((job) => job.time_windows[0][0])), distance: 0, duration: 0 }],
    }));
    for (const job of input.jobs) {
      const route = routes.find((candidate) => {
        const vehicle = input.vehicles.find((item) => item.id === candidate.vehicle);
        return job.skills.every((skill) => vehicle.skills.includes(skill));
      });
      if (!route) throw new Error(`no compatible fake vehicle for job ${job.id}`);
      route.distance += 1000 + job.id;
      route.duration += 60;
      route.steps.push({
        type: 'job',
        job: job.id,
        arrival: job.time_windows[0][0] + 60,
        distance: route.distance,
        duration: route.duration,
      });
    }
    for (const route of routes) {
      route.distance += 500;
      route.steps.push({ type: 'end', arrival: 1, distance: route.distance, duration: route.duration + 60 });
    }
    return {
      provider: 'vroom',
      summary: {
        cost: 1,
        routes: routes.length,
        unassigned: 0,
        distance: routes.reduce((sum, route) => sum + route.distance, 0),
        duration: routes.reduce((sum, route) => sum + route.duration, 0),
        computing_times: { loading: 0, solving: input.jobs.length, routing: 0 },
      },
      routes,
      unassigned: [],
    };
  }
}

test('standard-v2 harness executes through canonical DeliveryStore with all disruptions and proof evidence', async () => {
  const optimizer = new FakeVroom();
  const artifact = await runStandardV2Harness({
    scenario,
    workload,
    optimizer,
    productHead: 'test-product-head',
    capturedAt: '2026-10-07T18:00:00.000Z',
  });
  assert.equal(optimizer.calls, 11);
  assert.equal(artifact.schema, 'musitu-delivery-standard-v2-internal-evidence.v1');
  assert.equal(artifact.workload_sha256, 'fb80db552b55efb60c5372629c606cdd6879f796950ec44e1d854f46e8dfabdc');
  assert.equal(artifact.evidence.kind, 'internal_controlled');
  assert.equal(artifact.claim_status, 'NOT_CERTIFIED');
  assert.equal(artifact.comparison_ready, false);
  assert.equal(artifact.planner.provider, 'vroom');
  assert.equal(artifact.planner.plan_count, 11);
  assert.equal(artifact.execution.orders_total, 100);
  assert.equal(artifact.execution.orders_delivered, 100);
  assert.equal(artifact.execution.disruptions_applied, 10);
  assert.equal(artifact.execution.driver_offline_events, 5);
  assert.equal(artifact.execution.traffic_delay_events, 5);
  assert.equal(artifact.metrics.proof_completeness_rate, 1);
  assert.ok(artifact.metrics.on_time_completion_rate >= 0 && artifact.metrics.on_time_completion_rate <= 1);
  assert.ok(artifact.metrics.route_total_distance_m > 0);
  assert.ok(artifact.metrics.assignment_decision_ms >= 0);
  assert.equal(artifact.metrics.operator_interventions, 0);
  assert.equal(artifact.chain.valid, true);
  assert.match(artifact.chain.head_sha256, /^[a-f0-9]{64}$/);
});

test('standard-v2 harness artifact is deterministic for identical solver output and fixed capture metadata', async () => {
  const options = {
    scenario,
    workload,
    productHead: 'test-product-head',
    capturedAt: '2026-10-07T18:00:00.000Z',
  };
  const a = await runStandardV2Harness({ ...options, optimizer: new FakeVroom() });
  const b = await runStandardV2Harness({ ...options, optimizer: new FakeVroom() });
  assert.deepEqual(a, b);
});

test('standard-v2 harness consumes current VROOM job-step id fields', async () => {
  class CurrentVroom extends FakeVroom {
    async optimize(input) {
      const result = await super.optimize(input);
      for (const route of result.routes) {
        for (const step of route.steps) {
          if (step.type === 'job') {
            step.id = step.job;
            delete step.job;
          }
        }
      }
      return result;
    }
  }
  const artifact = await runStandardV2Harness({
    scenario,
    workload,
    optimizer: new CurrentVroom(),
    productHead: 'test-product-head',
    capturedAt: '2026-10-07T18:00:00.000Z',
  });
  assert.equal(artifact.execution.orders_delivered, 100);
  assert.equal(artifact.planner.provider, 'vroom');
});

test('standard-v2 harness fails closed when optimizer is not real VROOM', async () => {
  await assert.rejects(
    () => runStandardV2Harness({
      scenario,
      workload,
      optimizer: { async optimize() { return { provider: 'heuristic-fallback', routes: [] }; } },
      productHead: 'test-product-head',
      capturedAt: '2026-10-07T18:00:00.000Z',
    }),
    (error) => error?.code === 'BENCHMARK_VROOM_REQUIRED',
  );
});

test('standard-v2 replans preserve route continuity from canonical driver locations', async () => {
  class CapturingVroom extends FakeVroom {
    constructor() { super(); this.inputs = []; }
    async optimize(input) { this.inputs.push(structuredClone(input)); return super.optimize(input); }
  }
  const optimizer = new CapturingVroom();
  await runStandardV2Harness({
    scenario,
    workload,
    optimizer,
    productHead: 'test-product-head',
    capturedAt: '2026-10-07T18:00:00.000Z',
  });
  const restoredPlan = optimizer.inputs[2];
  const driver = restoredPlan.vehicles.find((vehicle) => vehicle.description === 'bench-driver-01');
  assert.ok(driver, 'driver 01 must be restored by the second replan');
  const firstDelivered = workload.orders[8];
  assert.deepEqual(driver.start, [firstDelivered.lon, firstDelivered.lat]);
  assert.equal(driver.start_index, 0);
});
