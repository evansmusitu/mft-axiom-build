/** Authenticated Connect intake must reject ambiguous, lossy or oversized JSON.
 * Offline-only: no live Axiom or customer credentials are used.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import worker from '../../connect/production_worker.mjs';

const token = createHmac('sha256', 'offline-test-key')
  .update('MUSITU-CONNECT-RUNTIME-INTERNAL-V1').digest('hex');
const env = { AXIOM_ACCOUNT_KEY: 'offline-test-key', PRODUCTION: 'false' };
const row = '{"hazard":"Roof fall","exposure":0.5,"severity":5,"likelihood":0.5,"cost":10,"benefit":0.5}';

async function submit(path, raw) {
  const response = await worker.fetch(new Request('https://offline.example/api/mining/' + path, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: raw,
  }), env);
  return { status: response.status, body: await response.json() };
}

test('authenticated plan rejects duplicate top-level and nested JSON keys', async () => {
  for (const raw of [
    '{"rows":[' + row + '],"budget":0,"budget":10}',
    '{"rows":[{"hazard":"Roof fall","exposure":0,"exposure":0.5,"severity":5,"likelihood":0.5,"cost":10,"benefit":0.5}],"budget":10}',
  ]) {
    const result = await submit('plan', raw);
    assert.equal(result.status, 400, 'ambiguous JSON must not reach planner');
    assert.deepEqual(result.body, { ok: false, error: 'INVALID_REQUEST' });
  }
});

test('authenticated plan rejects unsafe or non-finite numeric JSON tokens', async () => {
  for (const raw of [
    '{"rows":[' + row.replace('"cost":10', '"cost":9007199254740993') + '],"budget":10}',
    '{"rows":[' + row + '],"budget":1e400}',
    '{"rows":[' + row + '],"budget":-0}',
  ]) {
    const result = await submit('plan', raw);
    assert.equal(result.status, 400, 'lossy numeric input must not be attributed to signed compute');
    assert.deepEqual(result.body, { ok: false, error: 'INVALID_REQUEST' });
  }
});

test('authenticated request ingestion rejects oversized JSON before risk execution', async () => {
  const raw = '{"run_id":"offline-1","rows":[' + row + '],"ignored":"' + 'a'.repeat(66_000) + '"}';
  const previousFetch = globalThis.fetch;
  let outboundCalls = 0;
  globalThis.fetch = async () => { outboundCalls++; throw Error('must not call Axiom'); };
  try {
    const result = await submit('risk', raw);
    assert.equal(result.status, 400, 'body above the bounded intake ceiling must be rejected');
    assert.deepEqual(result.body, { ok: false, error: 'INVALID_REQUEST' });
    assert.equal(outboundCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('authenticated risk still routes unambiguous arithmetic to existing Axiom path', async () => {
  const previousFetch = globalThis.fetch;
  let outboundCalls = 0;
  globalThis.fetch = async (_url, init) => {
    outboundCalls++;
    return new Response(JSON.stringify({ok:true, request_id:init.headers['x-musitu-request-id'],
      operation:'arithmetic.evaluate', result:{ok:true,result:'1.25'}}),
      { status:200, headers:{'content-type':'application/json'} });
  };
  try {
    const result = await submit('risk', '{"run_id":"offline-1","rows":[' + row + ']}');
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.result, '1.25');
    assert.equal(outboundCalls, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
