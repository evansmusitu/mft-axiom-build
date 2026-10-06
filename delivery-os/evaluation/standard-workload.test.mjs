import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateStandardWorkload, workloadFingerprint } from './standard-workload.mjs';

const scenario = JSON.parse(fs.readFileSync(new URL('./scenario.standard-v1.json', import.meta.url), 'utf8'));

test('standard-v1 produces the exact declared workload cardinalities', () => {
  const workload = generateStandardWorkload(scenario);
  assert.equal(workload.scenario_id, scenario.id);
  assert.equal(workload.scenario_version, scenario.version);
  assert.equal(workload.drivers.length, 10);
  assert.equal(workload.orders.length, 100);
  assert.equal(workload.disruptions.length, 10);
});

test('standard-v1 workload is deterministic and has a stable SHA-256 fingerprint', () => {
  const a = generateStandardWorkload(scenario);
  const b = generateStandardWorkload(scenario);
  assert.deepEqual(a, b);
  assert.match(workloadFingerprint(a), /^[a-f0-9]{64}$/);
  assert.equal(workloadFingerprint(a), workloadFingerprint(b));
  assert.equal(workloadFingerprint(a), 'bb64c1d425bf5e8245a0daad8acffa01f849da79f3b9a9d83fbdd86aec012554');
});

test('standard-v1 order IDs, coordinates, time windows and proof requirements are valid', () => {
  const workload = generateStandardWorkload(scenario);
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

test('standard-v1 driver IDs are unique and capacity/skills are explicit', () => {
  const workload = generateStandardWorkload(scenario);
  assert.equal(new Set(workload.drivers.map((x) => x.id)).size, 10);
  for (const driver of workload.drivers) {
    assert.equal(driver.capacity, 20);
    assert.ok(Array.isArray(driver.skills));
    assert.ok(driver.skills.includes('standard'));
  }
});

test('standard-v1 disruptions are deterministic, bounded and vendor-neutral', () => {
  const workload = generateStandardWorkload(scenario);
  for (const event of workload.disruptions) {
    assert.match(event.id, /^disruption-\d{2}$/);
    assert.ok(['DRIVER_OFFLINE', 'TRAFFIC_DELAY'].includes(event.type));
    assert.ok(event.after_order >= 1 && event.after_order <= 100);
    assert.equal('onfleet' in event, false);
    assert.equal('bringg' in event, false);
  }
});
