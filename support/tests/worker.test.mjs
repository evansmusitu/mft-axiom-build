import assert from 'node:assert/strict';
import test from 'node:test';
import worker, {handleSupportRequest} from '../worker.js';

const payload = {
  surface: 'web_app', category: 'bug', affected_scope: 'self', summary: 'A reproducible interface failure',
  description: 'The application returned an unexpected validation state.', reproduction: 'Open the app and submit the bounded input.',
  impact: 'One task is blocked.', evidence_refs: [], consent_to_process: true,
};

const turnstile = {turnstile_token: 'valid-browser-proof'};

test('production health fails closed until storage, key and Turnstile configuration exist', async () => {
  const response = await handleSupportRequest(new Request('https://support.example/health'), {ENVIRONMENT: 'production'});
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, 'NOT_READY');
  assert.equal(body.secure_storage, false);
  assert.equal(body.independent_approver, false);
});

test('production health rejects the same person as owner and approver', async () => {
  const env = {
    ENVIRONMENT: 'production', SUPPORT_DB: {}, SUPPORT_DATA_KEY_B64: 'present', SUPPORT_DOMAIN: 'support.example',
    TURNSTILE_SITE_KEY: '0x4AAAAAAAAAAAAAAAAAAAAAA', TURNSTILE_SECRET_KEY: 'present',
    SUPPORT_HUMAN_OWNER_REF: 'person_one_12345678', SUPPORT_INDEPENDENT_APPROVER_REF: 'person_one_12345678',
    SUPPORT_READINESS_SHA256: 'a'.repeat(64),
  };
  const response = await handleSupportRequest(new Request('https://support.example/health'), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).independent_approver, false);
});

test('production case creation rejects missing Turnstile proof before touching storage', async () => {
  const response = await worker.fetch(new Request('https://support.example/api/v1/cases', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)}), {
    ENVIRONMENT: 'production',
    SUPPORT_INTAKE_RATE_LIMITER: {limit: async () => ({success: true})},
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'TURNSTILE_PROOF_REQUIRED');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(response.headers.get('content-security-policy'), /object-src 'none'/);
});

test('Turnstile verification receives only the proof token, never the customer narrative', async () => {
  let received = '';
  const env = {
    ENVIRONMENT: 'production', SUPPORT_DOMAIN: 'support.example', TURNSTILE_SECRET_KEY: 'server-only-secret',
    SUPPORT_INTAKE_RATE_LIMITER: {limit: async () => ({success: true})},
    TURNSTILE_VERIFY: async (_url, options) => { received = String(options.body); return new Response(JSON.stringify({success: false, hostname: 'support.example', action: 'support_case_create'}), {headers: {'content-type': 'application/json'}}); },
  };
  const response = await worker.fetch(new Request('https://support.example/api/v1/cases', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({...payload, ...turnstile})}), env);
  assert.equal(response.status, 403);
  assert.match(received, /response=valid-browser-proof/);
  assert.match(received, /secret=server-only-secret/);
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

test('browser config exposes only the public Turnstile site key', async () => {
  const response = await handleSupportRequest(new Request('https://support.example/api/v1/config'), {
    TURNSTILE_SITE_KEY: '0x4AAAAAAAAAAAAAAAAAAAAAA', TURNSTILE_SECRET_KEY: 'never-public',
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /0x4AAAAAAAAAAAAAAAAAAAAAA/);
  assert.match(text, /support_case_create/);
  assert.doesNotMatch(text, /never-public/);
});


test('production health requires both Turnstile and intake rate limiter', async () => {
  const base = {
    ENVIRONMENT: 'production', SUPPORT_DB: {}, SUPPORT_DATA_KEY_B64: 'present',
    SUPPORT_DOMAIN: 'support.mftintelligence.com',
    TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: 'present-secret-value',
    SUPPORT_HUMAN_OWNER_REF: 'github:evansmusitu',
    SUPPORT_INDEPENDENT_APPROVER_REF: 'person:elvis-musitu',
    SUPPORT_READINESS_SHA256: 'a'.repeat(64),
  };
  const missing = await handleSupportRequest(new Request('https://support.example/health'), base);
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).rate_limiter, false);

  const ready = await handleSupportRequest(new Request('https://support.example/health'), {
    ...base,
    SUPPORT_INTAKE_RATE_LIMITER: {limit: async () => ({success: true})},
  });
  assert.equal(ready.status, 200);
  const body = await ready.json();
  assert.equal(body.rate_limiter, true);
  assert.equal(body.abuse_gate, true);
});

test('case intake returns 429 before Turnstile or storage work when the edge limiter is exhausted', async () => {
  let turnstileCalls = 0;
  const response = await worker.fetch(new Request('https://support.mftintelligence.com/api/v1/cases', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({...payload, ...turnstile}),
  }), {
    ENVIRONMENT: 'production',
    SUPPORT_INTAKE_RATE_LIMITER: {limit: async ({key}) => {
      assert.equal(key, 'support-case-create');
      return {success: false};
    }},
    TURNSTILE_VERIFY: async () => {
      turnstileCalls += 1;
      return new Response(JSON.stringify({success: true}), {headers:{'content-type':'application/json'}});
    },
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(turnstileCalls, 0);
  assert.equal((await response.json()).error, 'RATE_LIMITED');
});
