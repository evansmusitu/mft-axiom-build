import test from 'node:test';
import assert from 'node:assert/strict';
import { probeOnfleetAccess, probeBringgAccess } from './external-access.mjs';

test('Onfleet preflight fails closed without a test API key and does not call fetch', async () => {
  let called = false;
  const report = await probeOnfleetAccess({
    apiKey: '',
    fetchImpl: async () => { called = true; throw new Error('must not fetch'); },
  });
  assert.equal(called, false);
  assert.equal(report.ready, false);
  assert.deepEqual(report.blocked_by, ['ONFLEET_TEST_API_KEY_REQUIRED']);
});

test('Onfleet preflight uses auth/test with Basic API-key auth and never returns the secret', async () => {
  const apiKey = 'test-key-secret';
  let seen;
  const report = await probeOnfleetAccess({
    apiKey,
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return { ok: true, status: 200 };
    },
  });
  assert.equal(seen.url, 'https://onfleet.com/api/v2/auth/test');
  assert.equal(seen.options.method, 'GET');
  assert.equal(seen.options.headers.Authorization, `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`);
  assert.equal(report.ready, true);
  assert.equal(JSON.stringify(report).includes(apiKey), false);
});

test('Bringg preflight fails closed without exact sandbox token URL and client credentials', async () => {
  let called = false;
  const report = await probeBringgAccess({
    tokenUrl: '',
    clientId: '',
    clientSecret: '',
    fetchImpl: async () => { called = true; throw new Error('must not fetch'); },
  });
  assert.equal(called, false);
  assert.equal(report.ready, false);
  assert.deepEqual(report.blocked_by, [
    'BRINGG_SANDBOX_TOKEN_URL_REQUIRED',
    'BRINGG_SANDBOX_CLIENT_ID_REQUIRED',
    'BRINGG_SANDBOX_CLIENT_SECRET_REQUIRED',
  ]);
});

test('Bringg preflight requests a client-credentials token from only the supplied sandbox URL and never returns secrets', async () => {
  const tokenUrl = 'https://sandbox.example.test/oauth/token';
  const clientId = 'client-id-secret';
  const clientSecret = 'client-secret-secret';
  const accessToken = 'access-token-secret';
  let seen;
  const report = await probeBringgAccess({
    tokenUrl,
    clientId,
    clientSecret,
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return {
        ok: true,
        status: 200,
        async json() { return { access_token: accessToken, token_type: 'Bearer', expires_in: 1800 }; },
      };
    },
  });
  assert.equal(seen.url, tokenUrl);
  assert.equal(seen.options.method, 'POST');
  assert.equal(seen.options.body.get('grant_type'), 'client_credentials');
  assert.equal(seen.options.body.get('client_id'), clientId);
  assert.equal(seen.options.body.get('client_secret'), clientSecret);
  assert.equal(report.ready, true);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(clientId), false);
  assert.equal(serialized.includes(clientSecret), false);
  assert.equal(serialized.includes(accessToken), false);
});

test('Bringg preflight rejects an HTTP success without an access token', async () => {
  const report = await probeBringgAccess({
    tokenUrl: 'https://sandbox.example.test/oauth/token',
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() { return { token_type: 'Bearer' }; },
    }),
  });
  assert.equal(report.ready, false);
  assert.deepEqual(report.blocked_by, ['BRINGG_ACCESS_TOKEN_NOT_RETURNED']);
});
