import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyTurnstile} from '../turnstile.js';

const base = {
  token: 'proof-token', secret: 'server-secret', expectedHostname: 'support.mftintelligence.com',
  expectedAction: 'support_case_create', uuid: () => '8ea2cdee-b216-4e26-92bf-0278ea2dbe64',
};

test('Turnstile accepts only a successful matching hostname and action', async () => {
  let request;
  const result = await verifyTurnstile({...base, fetchImpl: async (url, options) => {
    request = {url, options};
    return new Response(JSON.stringify({success: true, hostname: base.expectedHostname, action: base.expectedAction}), {headers: {'content-type': 'application/json'}});
  }});
  assert.deepEqual(result, {ok: true, code: 'TURNSTILE_VERIFIED'});
  assert.equal(request.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.match(String(request.options.body), /secret=server-secret/);
  assert.match(String(request.options.body), /response=proof-token/);
  assert.match(String(request.options.body), /idempotency_key=8ea2cdee-b216-4e26-92bf-0278ea2dbe64/);
});

test('Turnstile fails closed for mismatched hostname, action, duplicate and network errors', async () => {
  const cases = [
    {success: true, hostname: 'attacker.example', action: base.expectedAction},
    {success: true, hostname: base.expectedHostname, action: 'different_action'},
    {success: false, hostname: base.expectedHostname, action: base.expectedAction, 'error-codes': ['timeout-or-duplicate']},
  ];
  for (const body of cases) {
    const result = await verifyTurnstile({...base, fetchImpl: async () => new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}})});
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /proof-token|server-secret/);
  }
  const failed = await verifyTurnstile({...base, fetchImpl: async () => { throw new Error('network unavailable'); }});
  assert.deepEqual(failed, {ok: false, code: 'TURNSTILE_UNAVAILABLE'});
});

test('Turnstile rejects absent or oversized proofs without sending a request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response('{}'); };
  assert.deepEqual(await verifyTurnstile({...base, token: '', fetchImpl}), {ok: false, code: 'TURNSTILE_PROOF_REQUIRED'});
  assert.deepEqual(await verifyTurnstile({...base, token: 'x'.repeat(2049), fetchImpl}), {ok: false, code: 'TURNSTILE_PROOF_INVALID'});
  assert.equal(calls, 0);
});

test('Turnstile aborts a slow verification and fails closed', async () => {
  const fetchImpl = async (_url, {signal}) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {once: true});
  });
  const value = await verifyTurnstile({...base, fetchImpl, timeoutMs: 5});
  assert.deepEqual(value, {ok: false, code: 'TURNSTILE_UNAVAILABLE'});
});
