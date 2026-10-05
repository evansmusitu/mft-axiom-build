import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const workerPath = new URL('../../connect/production_worker.mjs', import.meta.url);
const accountKey = 'test-account-key';
const internalToken = createHmac('sha256', accountKey)
  .update('MUSITU-CONNECT-RUNTIME-INTERNAL-V1')
  .digest('hex');
const env = {
  AXIOM_ACCOUNT_KEY: accountKey,
  PRODUCTION: 'false',
  RELEASE: 'test-release',
};
const scenario = [
  { hazard: 'Ground collapse', exposure: 0.54, severity: 10, likelihood: 0.62, cost: 18000, benefit: 0.34 },
  { hazard: 'Explosives / gases', exposure: 0.25, severity: 8, likelihood: 0.48, cost: 12000, benefit: 0.28 },
  { hazard: 'Shaft falls', exposure: 0.15, severity: 9, likelihood: 0.4, cost: 14000, benefit: 0.24 },
  { hazard: 'Electrocution / equipment', exposure: 0.06, severity: 7, likelihood: 0.36, cost: 9000, benefit: 0.18 },
];

async function worker() {
  assert.equal(
    fs.existsSync(workerPath),
    true,
    'production worker module must exist before the runtime can be enabled',
  );
  return import(pathToFileURL(workerPath.pathname).href);
}

function authHeaders() {
  return {
    authorization: 'Bearer ' + internalToken,
    'content-type': 'application/json',
  };
}

test('production worker exposes healthy pre-production canary surface', async () => {
  const mod = await worker();
  const response = await mod.default.fetch(
    new Request('https://canary.example/health'),
    env,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    ok: true,
    service: 'MUSITU Connect',
    release: 'test-release',
    production: false,
    axiomIntegrationAllowed: true,
  });
});

test('production worker denies unauthenticated planning fail closed', async () => {
  const mod = await worker();
  const response = await mod.default.fetch(
    new Request('https://canary.example/api/mining/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows: scenario, budget: 50000 }),
    }),
    env,
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: 'UNAUTHORIZED' });
});

test('production worker computes the exact constrained Mining plan when authenticated', async () => {
  const mod = await worker();
  const response = await mod.default.fetch(
    new Request('https://canary.example/api/mining/plan', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ rows: scenario, budget: 50000 }),
    }),
    env,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.gate, 'LOCKED');
  assert.equal(body.spend, 44000);
  assert.deepEqual(body.selected, ['Ground collapse', 'Explosives / gases', 'Shaft falls']);
  assert.equal(body.baselineRisk, 4.9992);
  assert.ok(Math.abs(body.residualRisk - 0.699888) < 1e-12);
});

test('production worker sends provenance-bound risk execution to Axiom and sanitizes the response', async () => {
  const mod = await worker();
  const previousFetch = globalThis.fetch;
  let observedRequestId = '';
  let observedBody = null;
  let observedAuthorization = '';
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(url, 'https://axiom.mftintelligence.com/v1/compute');
    observedAuthorization = String(init.headers?.authorization || init.headers?.Authorization || '');
    observedRequestId = String(init.headers?.['x-musitu-request-id'] || '');
    observedBody = JSON.parse(String(init.body || '{}'));
    return new Response(JSON.stringify({
      ok: true,
      request_id: observedRequestId,
      result: { ok: true, result: '3.348' },
      receipt: 'must-not-leak',
      customer_id: 'must-not-leak',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const response = await mod.default.fetch(
      new Request('https://canary.example/api/mining/risk', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          run_id: 'mining-prod-q1',
          rows: [scenario[0]],
        }),
      }),
      env,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(observedAuthorization, 'Bearer ' + accountKey);
    assert.deepEqual(observedBody, {
      operation: 'arithmetic.evaluate',
      args: { expression: '0.54*10*0.62' },
    });
    assert.match(observedRequestId, /^MUSITU-CONNECT-mining-prod-q1-[a-f0-9]{16}$/);
    assert.equal(body.ok, true);
    assert.equal(body.gate, 'OPEN');
    assert.equal(body.operation, 'arithmetic.evaluate');
    assert.equal(body.result, '3.348');
    assert.equal(body.request_id, observedRequestId);
    assert.equal(body.canonical_sha256.length, 64);
    assert.equal('receipt' in body, false);
    assert.equal('customer_id' in body, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
