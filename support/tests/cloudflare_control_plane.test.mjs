import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUPPORT_DOMAIN,
  TURNSTILE_WIDGET_NAME,
  buildPublicControlPlaneEvidence,
  ensureSupportEmailDestination,
  ensureSupportTurnstile,
  putWorkerSecret,
} from '../scripts/provision_cloudflare_control_plane.mjs';
import {SUPPORT_DATABASE_NAME, cloudflareCredentialCandidates} from '../scripts/provision_cloudflare_d1.mjs';

function response(status, payload) {
  return {ok: status >= 200 && status < 300, status, async json() { return payload; }};
}

const widget = {name: TURNSTILE_WIDGET_NAME, domains: [SUPPORT_DOMAIN], mode: 'managed', sitekey: '0x4AAAAAAAAAAAAAAAAAAAAAA', secret: '0x4BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'};

test('control-plane provisioning deliberately prefers the authorized global-key path', () => {
  const rows = cloudflareCredentialCandidates({CLOUDFLARE_API_TOKEN: 'token', CLOUDFLARE_EMAIL: 'owner@example.test', CLOUDFLARE_GLOBAL_API_KEY: 'global'}, {preferGlobal: true});
  assert.deepEqual(rows.map(row => row.mode), ['global_api_key', 'api_token']);
});

test('Turnstile creates only the exact managed support-domain widget and retrieves its secret privately', async () => {
  const calls = [];
  const result = await ensureSupportTurnstile({headers: {}, fetchImpl: async (url, options) => {
    calls.push({url, options});
    if (url.includes('?page=')) return response(200, {success: true, result: []});
    if (options.method === 'POST') return response(200, {success: true, result: widget});
    return response(200, {success: true, result: widget});
  }});
  assert.equal(result.created, true);
  assert.equal(result.secret, widget.secret);
  const create = calls.find(call => call.options.method === 'POST');
  assert.deepEqual(JSON.parse(create.options.body), {name: TURNSTILE_WIDGET_NAME, domains: [SUPPORT_DOMAIN], mode: 'managed', clearance_level: 'no_clearance'});
});

test('Turnstile fails closed when an exact-name widget is scoped to another domain', async () => {
  await assert.rejects(() => ensureSupportTurnstile({headers: {}, fetchImpl: async url => {
    if (url.includes('?page=')) return response(200, {success: true, result: [{...widget, domains: ['other.example']}]});
    return response(200, {success: true, result: {...widget, domains: ['other.example']}});
  }}), /does not match the exact isolated configuration/);
});

test('email destination creation returns only a fingerprint for public evidence', async () => {
  const email = 'approved@example.test';
  const result = await ensureSupportEmailDestination({headers: {}, email, fetchImpl: async (url, options) => {
    if (options.method === 'GET') return response(200, {success: true, result: []});
    return response(200, {success: true, result: {id: 'destination-id', email, verified: null}});
  }});
  assert.equal(result.created, true);
  assert.equal(result.verified, false);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify({fingerprint: result.fingerprint}), /approved@example/);
});

test('Worker secret API receives values but confirmations and errors do not expose them', async () => {
  const sensitive = 'private-value-that-must-never-be-logged';
  let body;
  await putWorkerSecret({headers: {}, name: 'TURNSTILE_SECRET_KEY', value: sensitive, fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body);
    return response(200, {success: true, result: {name: 'TURNSTILE_SECRET_KEY', type: 'secret_text'}});
  }});
  assert.equal(body.text, sensitive);
  assert.deepEqual(Object.keys(body).sort(), ['name', 'text', 'type']);
});

test('public control-plane evidence excludes email addresses and secret values', () => {
  const evidence = buildPublicControlPlaneEvidence({
    database: {name: SUPPORT_DATABASE_NAME, uuid: '123e4567-e89b-12d3-a456-426614174000', created: false},
    turnstile: {...widget, created: true},
    destination: {fingerprint: 'a'.repeat(64), created: true, verified: false},
    authMode: 'global_api_key',
    env: {GITHUB_REPOSITORY: 'evansmusitu/mft-axiom-build', GITHUB_REF_NAME: 'support/axiom-official-support-20261005', GITHUB_SHA: 'b'.repeat(40), SUPPORT_HUMAN_OWNER_REF: 'github:evansmusitu', SUPPORT_INDEPENDENT_APPROVER_REF: 'person:elvis-musitu'},
    now: '2026-10-05T16:00:00Z',
  });
  const serialized = JSON.stringify(evidence);
  assert.equal(evidence.turnstile.secret_exposed, false);
  assert.equal(evidence.email_destination.raw_address_recorded, false);
  assert.doesNotMatch(serialized, /private-value|@example|turnstile_secret/i);
});
