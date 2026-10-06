import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateStandardWorkload, workloadFingerprint } from './standard-workload.mjs';
import { buildOnfleetTaskPlan, buildBringgOrderPlan } from './provider-adapters.mjs';

const scenario = JSON.parse(fs.readFileSync(new URL('./scenario.standard-v2.json', import.meta.url), 'utf8'));
const workload = generateStandardWorkload(scenario);

test('Onfleet plan deterministically maps all 100 benchmark orders without credentials', () => {
  const plan = buildOnfleetTaskPlan({ workload, city: 'Harare', country: 'Zimbabwe' });
  assert.equal(plan.provider, 'onfleet');
  assert.equal(plan.workload_sha256, workloadFingerprint(workload));
  assert.equal(plan.requests.length, 100);
  const first = plan.requests[0];
  assert.equal(first.method, 'POST');
  assert.equal(first.path, '/api/v2/tasks');
  assert.deepEqual(first.body.destination.location, [workload.orders[0].lon, workload.orders[0].lat]);
  assert.deepEqual(first.body.destination.address, { city: 'Harare', country: 'Zimbabwe' });
  assert.equal(first.body.completeAfter, Date.parse(workload.orders[0].window.start));
  assert.equal(first.body.completeBefore, Date.parse(workload.orders[0].window.end));
  assert.equal(first.body.quantity, workload.orders[0].demand);
  assert.equal(first.body.serviceTime, workload.orders[0].service_minutes);
  assert.deepEqual(first.body.requirements, { signature: true, photo: true });
});

test('Onfleet refrigerated orders carry the documented ROv3 capability metadata', () => {
  const plan = buildOnfleetTaskPlan({ workload, city: 'Harare', country: 'Zimbabwe' });
  const refrigerated = plan.requests.find((request) => request.benchmark_order_id === 'bench-order-001');
  const normal = plan.requests.find((request) => request.benchmark_order_id === 'bench-order-002');
  const compat = refrigerated.body.metadata.find((entry) => entry.name === 'opt_compat_attributes');
  assert.deepEqual(compat, {
    name: 'opt_compat_attributes', type: 'array', subtype: 'string', value: ['refrigeration'], visibility: ['api'],
  });
  assert.equal(normal.body.metadata.some((entry) => entry.name === 'opt_compat_attributes'), false);
});

test('Onfleet plan carries benchmark provenance but never authentication material', () => {
  const plan = buildOnfleetTaskPlan({ workload, city: 'Harare', country: 'Zimbabwe' });
  const serializedRequests = JSON.stringify(plan.requests);
  assert.match(serializedRequests, /benchmark_order_id/);
  assert.equal(/authorization|basic /i.test(serializedRequests), false);
  assert.equal(plan.requests.some((request) => request.headers != null), false);
});

test('Onfleet plan rejects coordinate context without city/country because Onfleet requires parsed location context', () => {
  assert.throws(() => buildOnfleetTaskPlan({ workload, city: '', country: 'Zimbabwe' }), /city/i);
  assert.throws(() => buildOnfleetTaskPlan({ workload, city: 'Harare', country: '' }), /country/i);
});

test('Bringg plan fails closed until exact sandbox Create Order URL is supplied', () => {
  const plan = buildBringgOrderPlan({ workload });
  assert.equal(plan.provider, 'bringg');
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.blocked_by, ['BRINGG_SANDBOX_CREATE_ORDER_URL_REQUIRED']);
  assert.equal(plan.requests.length, 0);
});

test('Bringg refuses to guess a service URL even when generic credentials exist', () => {
  const plan = buildBringgOrderPlan({
    workload,
    tokenUrl: 'https://example.test/token',
    clientId: 'id',
    clientSecret: 'secret',
  });
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.blocked_by, ['BRINGG_SANDBOX_CREATE_ORDER_URL_REQUIRED']);
  assert.equal(JSON.stringify(plan).includes('secret'), false);
});
