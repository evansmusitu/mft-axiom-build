import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUPPORT_DOMAIN,
  TURNSTILE_WIDGET_NAME,
  buildBootstrapWorkerMetadata,
  buildWorkerMultipart,
  buildPublicControlPlaneEvidence,
  ensureSupportEmailDestination,
  ensureSupportTurnstile,
  putWorkerSecret,
} from '../scripts/provision_cloudflare_control_plane.mjs';
import {SUPPORT_DATABASE_NAME, cloudflareCredentialCandidates} from '../scripts/provision_cloudflare_d1.mjs';
import * as controlPlane from '../scripts/provision_cloudflare_control_plane.mjs';

function response(status, payload) {
  return {ok: status >= 200 && status < 300, status, async json() { return payload; }};
}

const widget = {name: TURNSTILE_WIDGET_NAME, domains: [SUPPORT_DOMAIN], mode: 'managed', sitekey: '0x4AAAAAAAAAAAAAAAAAAAAAA', secret: '0x4BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'};

test('control-plane provisioning deliberately prefers the authorized global-key path', () => {
  const rows = cloudflareCredentialCandidates({CLOUDFLARE_API_TOKEN: 'token', CLOUDFLARE_EMAIL: 'owner@example.test', CLOUDFLARE_GLOBAL_API_KEY: 'global'}, {preferGlobal: true});
  assert.deepEqual(rows.map(row => row.mode), ['global_api_key', 'api_token']);
});

test('direct bootstrap Worker metadata is isolated, D1-bound and contains no route or secret', () => {
  const metadata = buildBootstrapWorkerMetadata({databaseUuid: '123e4567-e89b-12d3-a456-426614174000', turnstileSitekey: widget.sitekey, ownerRef: 'github:evansmusitu', approverRef: 'person:elvis-musitu'});
  assert.equal(metadata.main_module, 'index.mjs');
  assert.equal(metadata.bindings.find(row => row.name === 'SUPPORT_DB').id, '123e4567-e89b-12d3-a456-426614174000');
  assert.equal(metadata.bindings.find(row => row.name === 'ENVIRONMENT').text, 'bootstrap');
  assert.equal(metadata.routes, undefined);
  assert.doesNotMatch(JSON.stringify(metadata), /SUPPORT_DATA_KEY_B64|TURNSTILE_SECRET_KEY/);
  const multipart = buildWorkerMultipart('export default {fetch(){return new Response("ok")}}', metadata, 'test-boundary');
  assert.equal(multipart.boundary, 'test-boundary');
  assert.match(multipart.body.toString(), /name="metadata"/);
  assert.match(multipart.body.toString(), /name="index\.mjs"/);
  assert.doesNotMatch(multipart.body.toString(), /private-value/);
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
  assert.equal(evidence.email_destination.status, 'verification_required');
  assert.doesNotMatch(serialized, /private-value|@example|turnstile_secret/i);
});


test('verified search crawler edge rule is exact-host, exact-category, GET/HEAD-only and excludes control routes', () => {
  assert.equal(typeof controlPlane.buildVerifiedSearchCrawlerConfigRule, 'function');
  const rule = controlPlane.buildVerifiedSearchCrawlerConfigRule();
  assert.equal(rule.ref, 'musitu_axiom_support_verified_search_crawlers');
  assert.equal(rule.action, 'set_config');
  assert.deepEqual(rule.action_parameters, {security_level: 'off', bic: false});
  assert.match(rule.expression, /http\.host eq "support\.mftintelligence\.com"/);
  assert.match(rule.expression, /cf\.client\.bot/);
  assert.match(rule.expression, /cf\.verified_bot_category eq "Search Engine Crawler"/);
  assert.match(rule.expression, /http\.user_agent contains "Google-InspectionTool"/);
  assert.match(rule.expression, /cf\.client\.bot/);
  assert.match(rule.expression, /http\.request\.method in \{"GET" "HEAD"\}/);
  for (const path of ['/', '/index.html', '/robots.txt', '/sitemap.xml', '/styles.css', '/app.js']) assert.ok(rule.expression.includes(path), 'missing public path '+path);
  assert.doesNotMatch(rule.expression, /\/api\/|\/health|AI Search|AI Crawler|AI Assistant/);
  assert.ok(rule.expression.includes('(cf.verified_bot_category eq "Search Engine Crawler" or http.user_agent contains "Google-InspectionTool")'));
});

test('verified search crawler rule merge is idempotent and preserves unrelated configuration rules', () => {
  assert.equal(typeof controlPlane.mergeVerifiedSearchCrawlerConfigRule, 'function');
  const unrelated = {ref: 'existing_rule', expression: 'http.host eq "example.com"', action: 'set_config', action_parameters: {bic: true}};
  const first = controlPlane.mergeVerifiedSearchCrawlerConfigRule([unrelated]);
  assert.equal(first.length, 2);
  assert.deepEqual(first[0], unrelated);
  const second = controlPlane.mergeVerifiedSearchCrawlerConfigRule(first);
  assert.equal(second.length, 2);
  assert.equal(second.filter(rule => rule.ref === 'musitu_axiom_support_verified_search_crawlers').length, 1);
  assert.deepEqual(second[0], unrelated);
});


test('verified search crawler WAF skip rule matches only traditional search crawlers and skips only human-challenge products', () => {
  assert.equal(typeof controlPlane.buildVerifiedSearchCrawlerSkipRule, 'function');
  const rule = controlPlane.buildVerifiedSearchCrawlerSkipRule();
  assert.equal(rule.ref, 'musitu_axiom_support_verified_search_crawlers');
  assert.equal(rule.action, 'skip');
  assert.deepEqual(rule.action_parameters, {products: ['bic', 'securityLevel']});
  assert.match(rule.expression, /http\.host eq "support\.mftintelligence\.com"/);
  assert.match(rule.expression, /cf\.client\.bot/);
  assert.match(rule.expression, /cf\.verified_bot_category eq "Search Engine Crawler"/);
  assert.match(rule.expression, /http\.request\.method in \{"GET" "HEAD"\}/);
  for (const path of ['/', '/index.html', '/robots.txt', '/sitemap.xml', '/styles.css', '/app.js']) assert.ok(rule.expression.includes(path), 'missing public path '+path);
  assert.doesNotMatch(rule.expression, /\/api\/|\/health|AI Search|AI Crawler|AI Assistant/);
});

test('verified search crawler WAF skip merge is idempotent and preserves unrelated custom rules', () => {
  assert.equal(typeof controlPlane.mergeVerifiedSearchCrawlerSkipRule, 'function');
  const unrelated = {ref: 'existing_rule', expression: 'http.host eq "example.com"', action: 'block'};
  const first = controlPlane.mergeVerifiedSearchCrawlerSkipRule([unrelated]);
  assert.equal(first.length, 2);
  assert.deepEqual(first[0], unrelated);
  const second = controlPlane.mergeVerifiedSearchCrawlerSkipRule(first);
  assert.equal(second.length, 2);
  assert.equal(second.filter(rule => rule.ref === 'musitu_axiom_support_verified_search_crawlers').length, 1);
  assert.deepEqual(second[0], unrelated);
});
