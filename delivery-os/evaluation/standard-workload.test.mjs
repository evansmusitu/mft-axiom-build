import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateStandardWorkload, workloadFingerprint } from './standard-workload.mjs';

const scenarioV1 = JSON.parse(fs.readFileSync(new URL('./scenario.standard-v1.json', import.meta.url), 'utf8'));
const scenarioV2 = JSON.parse(fs.readFileSync(new URL('./scenario.standard-v2.json', import.meta.url), 'utf8'));

function totals(workload) {
  return {
    demand: workload.orders.reduce((sum, order) => sum + order.demand, 0),
    capacity: workload.drivers.reduce((sum, driver) => sum + driver.capacity, 0),
  };
}

test('standard-v1 remains byte-reproducible as the superseded infeasible workload', () => {
  const workload = generateStandardWorkload(scenarioV1);
  assert.equal(workloadFingerprint(workload), 'bb64c1d425bf5e8245a0daad8acffa01f849da79f3b9a9d83fbdd86aec012554');
  assert.deepEqual(totals(workload), { demand: 250, capacity: 200 });
});

test('standard-v2 is deterministic, feasible by aggregate capacity and has a stable fingerprint', () => {
  const a = generateStandardWorkload(scenarioV2);
  const b = generateStandardWorkload(scenarioV2);
  assert.deepEqual(a, b);
  assert.equal(a.scenario_id, scenarioV2.id);
  assert.equal(a.scenario_version, 2);
  assert.equal(a.drivers.length, 10);
  assert.equal(a.orders.length, 100);
  assert.equal(a.disruptions.length, 10);
  assert.deepEqual(totals(a), { demand: 250, capacity: 300 });
  assert.equal(workloadFingerprint(a), 'fb80db552b55efb60c5372629c606cdd6879f796950ec44e1d854f46e8dfabdc');
});

test('standard-v2 order IDs, coordinates, time windows and proof requirements are valid', () => {
  const workload = generateStandardWorkload(scenarioV2);
  assert.equal(new Set(workload.orders.map((x) => x.id)).size, 100);
  for (const order of workload.orders) {
    assert.match(order.id, /^bench-order-\d{3}$/);
    assert.ok(order.lat >= -90 && order.lat <= 90);
    assert.ok(order.lon >= -180 && order.lon <= 180);
    assert.ok(order.window.start < order.window.end);
    assert.ok(order.demand >= 1 && order.demand <= 4);
    assert.deepEqual(order.proof_required, ['photo', 'signature']);
  }
});

test('standard-v2 driver IDs are unique and capacity/skills are explicit', () => {
  const workload = generateStandardWorkload(scenarioV2);
  assert.equal(new Set(workload.drivers.map((x) => x.id)).size, 10);
  for (const driver of workload.drivers) {
    assert.equal(driver.capacity, 30);
    assert.ok(driver.skills.includes('standard'));
  }
});

test('standard-v2 disruptions are deterministic, bounded and vendor-neutral', () => {
  const workload = generateStandardWorkload(scenarioV2);
  for (const event of workload.disruptions) {
    assert.match(event.id, /^disruption-\d{2}$/);
    assert.ok(['DRIVER_OFFLINE', 'TRAFFIC_DELAY'].includes(event.type));
    assert.ok(event.after_order >= 1 && event.after_order <= 100);
    assert.equal('onfleet' in event, false);
    assert.equal('bringg' in event, false);
  }
});
