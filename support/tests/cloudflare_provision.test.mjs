import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUPPORT_ACCOUNT_ID,
  SUPPORT_DATABASE_NAME,
  buildPublicProvisionEvidence,
  cloudflareCredentialCandidates,
  cloudflareRequest,
  ensureSupportD1,
  selectCloudflareCredential,
} from '../scripts/provision_cloudflare_d1.mjs';

function response(status, payload) {
  return {ok: status >= 200 && status < 300, status, async json() { return payload; }};
}

test('credential selection supports the established email and global-key path without emitting values', async () => {
  const env = {CLOUDFLARE_EMAIL: 'publisher@example.test', CLOUDFLARE_GLOBAL_API_KEY: 'sensitive-global-key'};
  const candidates = cloudflareCredentialCandidates(env);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].mode, 'global_api_key');
  assert.equal(candidates[0].headers['x-auth-email'], env.CLOUDFLARE_EMAIL);
  assert.equal(candidates[0].headers['x-auth-key'], env.CLOUDFLARE_GLOBAL_API_KEY);
  const selected = await selectCloudflareCredential({env, fetchImpl: async () => response(200, {success: true, result: {subdomain: 'redacted'}})});
  assert.equal(selected.mode, 'global_api_key');
  assert.doesNotMatch(JSON.stringify({mode: selected.mode}), /sensitive-global-key|publisher@example/);
});

test('Cloudflare errors expose only status and numeric codes, never response text', async () => {
  await assert.rejects(
    () => cloudflareRequest({headers: {}, path: '/test', fetchImpl: async () => response(403, {success: false, errors: [{code: 9109, message: 'echo sensitive-global-key'}]})}),
    error => error.message.includes('HTTP 403') && error.message.includes('9109') && !error.message.includes('sensitive-global-key'),
  );
});

test('D1 provisioning is exact-name idempotent', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    return response(200, {success: true, result: [{name: SUPPORT_DATABASE_NAME, uuid: '123e4567-e89b-12d3-a456-426614174000'}], result_info: {total_count: 1}});
  };
  const result = await ensureSupportD1({headers: {}, fetchImpl});
  assert.deepEqual(result, {name: SUPPORT_DATABASE_NAME, uuid: '123e4567-e89b-12d3-a456-426614174000', created: false});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
});

test('D1 provisioning creates only the dedicated support database when absent', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    if (options.method === 'GET') return response(200, {success: true, result: [], result_info: {total_count: 0}});
    return response(200, {success: true, result: {name: SUPPORT_DATABASE_NAME, uuid: '123e4567-e89b-12d3-a456-426614174000'}});
  };
  const result = await ensureSupportD1({headers: {}, fetchImpl});
  assert.equal(result.created, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, `https://api.cloudflare.com/client/v4/accounts/${SUPPORT_ACCOUNT_ID}/d1/database`);
  assert.deepEqual(JSON.parse(calls[1].options.body), {name: SUPPORT_DATABASE_NAME});
});

test('D1 provisioning fails closed on duplicate exact-name resources', async () => {
  const duplicate = {name: SUPPORT_DATABASE_NAME, uuid: '123e4567-e89b-12d3-a456-426614174000'};
  await assert.rejects(
    () => ensureSupportD1({headers: {}, fetchImpl: async () => response(200, {success: true, result: [duplicate, {...duplicate, uuid: '223e4567-e89b-12d3-a456-426614174000'}], result_info: {total_count: 2}})}),
    /refusing ambiguous selection/,
  );
});

test('public provisioning evidence contains no credential or generated secret material', () => {
  const evidence = buildPublicProvisionEvidence({
    authMode: 'global_api_key',
    database: {name: SUPPORT_DATABASE_NAME, uuid: '123e4567-e89b-12d3-a456-426614174000', created: true},
    env: {GITHUB_REPOSITORY: 'evansmusitu/mft-axiom-build', GITHUB_REF_NAME: 'support/axiom-official-support-20261005', GITHUB_SHA: 'a'.repeat(40)},
    now: '2026-10-05T20:00:00Z',
  });
  assert.equal(evidence.secrets_exposed, false);
  assert.equal(evidence.turnstile_secret_created, false);
  assert.equal(evidence.encryption_key_created, false);
  assert.equal(evidence.public_support_deployed, false);
  assert.doesNotMatch(JSON.stringify(evidence), /authorization|x-auth-key|sensitive/i);
});
