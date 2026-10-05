import assert from 'node:assert/strict';
import test from 'node:test';
import worker, {handleSupportRequest} from '../worker.js';

const payload = {
  surface: 'web_app', category: 'bug', affected_scope: 'self', summary: 'A reproducible interface failure',
  description: 'The application returned an unexpected validation state.', reproduction: 'Open the app and submit the bounded input.',
  impact: 'One task is blocked.', evidence_refs: [], consent_to_process: true,
};

test('production health fails closed until storage, key and abuse gate exist', async () => {
  const response = await handleSupportRequest(new Request('https://support.example/health'), {ENVIRONMENT: 'production'});
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, 'NOT_READY');
  assert.equal(body.secure_storage, false);
});

test('production case creation rejects missing abuse proof before touching storage', async () => {
  const response = await worker.fetch(new Request('https://support.example/api/v1/cases', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)}), {ENVIRONMENT: 'production'});
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'ABUSE_PROOF_REQUIRED');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('abuse service receives only bounded edge signals, never the customer narrative', async () => {
  let received = '';
  const env = {ENVIRONMENT: 'production', SUPPORT_ABUSE_GATE: {async fetch(_url, options) { received = options.body; return new Response(null, {status: 403}); }}};
  const response = await worker.fetch(new Request('https://support.example/api/v1/cases', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)}), env);
  assert.equal(response.status, 403);
  assert.match(received, /support-abuse-signal/);
  assert.doesNotMatch(received, new RegExp(payload.description));
});

test('secret-bearing case is rejected without reflecting the secret', async () => {
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
  const response = await worker.fetch(new Request('https://support.example/api/v1/cases', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({...payload, description: secret})}), {ENVIRONMENT: 'test'});
  assert.equal(response.status, 422);
  const text = await response.text();
  assert.match(text, /SECRET_MATERIAL_REJECTED/);
  assert.doesNotMatch(text, new RegExp(secret));
});

test('non-production intake still refuses to store without encrypted persistence', async () => {
  const response = await worker.fetch(new Request('https://support.example/api/v1/cases', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)}), {ENVIRONMENT: 'test'});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'SERVICE_NOT_READY');
});

test('catalog documents recovery authentication and secrets boundary', async () => {
  const response = await worker.fetch(new Request('https://support.example/api/v1/catalog'), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.authentication, /shown only at creation/);
  assert.match(body.secrets_policy, /rejected before storage/);
});
