import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUPPORT_EMAIL_ALIAS,
  buildEmailRoutingEvidence,
  inspectEmailRouting,
} from '../scripts/verify_cloudflare_email_routing.mjs';

function response(status, payload) {
  return {ok: status >= 200 && status < 300, status, async json() { return payload; }};
}

const destination = 'approved-destination@example.test';

function mockCloudflare({verified = '2026-10-05T18:00:00Z', routingEnabled = true, routingStatus = 'ready', rules = []} = {}) {
  return async url => {
    if (url.includes('/email/routing/addresses')) return response(200, {success: true, result: [{id: 'destination-1', email: destination, verified}]});
    if (url.endsWith('/email/routing')) return response(200, {success: true, result: {enabled: routingEnabled, status: routingStatus}});
    if (url.includes('/email/routing/rules')) return response(200, {success: true, result: rules});
    if (url.includes('/workers/domains')) return response(200, {success: true, result: []});
    if (url.includes('/dns_records')) return response(200, {success: true, result: []});
    if (url.includes('/workers/subdomain')) return response(200, {success: true, result: {subdomain: 'example'}});
    throw new Error(`unexpected URL ${url}`);
  };
}

test('verified destination and ready routing permit only the exact support-rule next step', async () => {
  const evidence = await inspectEmailRouting({
    fetchImpl: mockCloudflare(),
    env: {
      GITHUB_REPOSITORY: 'evansmusitu/mft-axiom-build',
      GITHUB_REF_NAME: 'support/axiom-official-support-20261005',
      GITHUB_SHA: 'a'.repeat(40),
      SUPPORT_EMAIL_ROUTING_CONFIRM: 'VERIFY_MUSITU_AXIOM_SUPPORT_EMAIL_ROUTING',
      SUPPORT_MAILBOX_DESTINATION: destination,
      CLOUDFLARE_API_TOKEN: 'masked-token',
    },
    now: '2026-10-05T18:00:00Z',
  });
  assert.equal(evidence.destination.verified, true);
  assert.equal(evidence.email_routing.enabled, true);
  assert.equal(evidence.email_routing.status, 'ready');
  assert.equal(evidence.support_rule.exact_present, false);
  assert.equal(evidence.support_rule.safe_to_create, true);
  assert.equal(evidence.write_performed, false);
  assert.equal(evidence.openai_surface_modified, false);
  assert.doesNotMatch(JSON.stringify(evidence), /approved-destination@example\.test/);
});

test('an exact existing support rule is recognized without requesting a duplicate', async () => {
  const rules = [{
    id: 'rule-1', enabled: true,
    matchers: [{type: 'literal', field: 'to', value: SUPPORT_EMAIL_ALIAS}],
    actions: [{type: 'forward', value: [destination]}],
  }];
  const evidence = await inspectEmailRouting({
    fetchImpl: mockCloudflare({rules}),
    env: {
      GITHUB_REPOSITORY: 'evansmusitu/mft-axiom-build',
      GITHUB_REF_NAME: 'support/axiom-official-support-20261005',
      GITHUB_SHA: 'b'.repeat(40),
      SUPPORT_EMAIL_ROUTING_CONFIRM: 'VERIFY_MUSITU_AXIOM_SUPPORT_EMAIL_ROUTING',
      SUPPORT_MAILBOX_DESTINATION: destination,
      CLOUDFLARE_API_TOKEN: 'masked-token',
    },
  });
  assert.equal(evidence.support_rule.exact_present, true);
  assert.equal(evidence.support_rule.conflict_present, false);
  assert.equal(evidence.support_rule.safe_to_create, false);
});

test('unverified destination and a conflicting support rule fail closed', async () => {
  const rules = [{
    id: 'rule-2', enabled: true,
    matchers: [{type: 'literal', field: 'to', value: SUPPORT_EMAIL_ALIAS}],
    actions: [{type: 'forward', value: ['different-destination@example.test']}],
  }];
  const evidence = await inspectEmailRouting({
    fetchImpl: mockCloudflare({verified: false, rules}),
    env: {
      GITHUB_REPOSITORY: 'evansmusitu/mft-axiom-build',
      GITHUB_REF_NAME: 'support/axiom-official-support-20261005',
      GITHUB_SHA: 'c'.repeat(40),
      SUPPORT_EMAIL_ROUTING_CONFIRM: 'VERIFY_MUSITU_AXIOM_SUPPORT_EMAIL_ROUTING',
      SUPPORT_MAILBOX_DESTINATION: destination,
      CLOUDFLARE_API_TOKEN: 'masked-token',
    },
  });
  assert.equal(evidence.destination.verified, false);
  assert.equal(evidence.support_rule.conflict_present, true);
  assert.equal(evidence.support_rule.safe_to_create, false);
});

test('public evidence rejects raw private destination material', () => {
  assert.throws(() => buildEmailRoutingEvidence({
    destinationEmail: destination,
    destination: {verified: true, fingerprint: 'd'.repeat(64)},
    routing: {ok: true, result: {enabled: true, status: 'ready'}},
    rules: {ok: true, result: []},
    customDomains: {ok: true, result: []},
    dnsByName: new Map(),
    env: {GITHUB_REPOSITORY: 'x/y', GITHUB_REF_NAME: 'support/axiom-official-support-20261005', GITHUB_SHA: 'e'.repeat(40)},
    now: '2026-10-05T18:00:00Z',
    unsafeDebugValue: destination,
  }), /unexpected evidence input/);
});
