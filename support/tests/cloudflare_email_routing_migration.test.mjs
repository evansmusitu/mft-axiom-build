import assert from 'node:assert/strict';
import test from 'node:test';
import {migrateEmailRouting} from '../scripts/migrate_cloudflare_email_routing.mjs';

function response(status, payload) {
  return {ok: status >= 200 && status < 300, status, async json() { return payload; }};
}

const destination = 'approved-destination@example.test';
const zone = 'mftintelligence.com';
const supportAlias = 'support@mftintelligence.com';
const zoho = [
  {id: 'zoho-1', type: 'MX', name: zone, content: 'mx.zoho.com', priority: 10, ttl: 3600},
  {id: 'zoho-2', type: 'MX', name: zone, content: 'mx2.zoho.com', priority: 20, ttl: 3600},
  {id: 'zoho-3', type: 'MX', name: zone, content: 'mx3.zoho.com', priority: 50, ttl: 3600},
];
const dkimName = `cf2024-1._domainkey.${zone}`;
const required = [
  {type: 'MX', name: zone, content: 'route1.mx.cloudflare.net.', priority: 7, ttl: 1},
  {type: 'MX', name: zone, content: 'route2.mx.cloudflare.net.', priority: 32, ttl: 1},
  {type: 'MX', name: zone, content: 'route3.mx.cloudflare.net.', priority: 94, ttl: 1},
  {type: 'TXT', name: dkimName, content: '"v=DKIM1; h=sha256; k=rsa; p=TESTPUBLICKEY"', ttl: 1},
  {type: 'TXT', name: zone, content: '"v=spf1 include:_spf.mx.cloudflare.net ~all"', ttl: 1},
];
const protectedHosts = new Map([
  ['auth.mftintelligence.com', [{id: 'a', type: 'A', name: 'auth.mftintelligence.com', content: '192.0.2.10'}]],
  ['mcp.mftintelligence.com', [{id: 'b', type: 'A', name: 'mcp.mftintelligence.com', content: '192.0.2.11'}]],
  ['claude-auth.mftintelligence.com', [{id: 'c', type: 'A', name: 'claude-auth.mftintelligence.com', content: '192.0.2.12'}]],
  ['claude-mcp.mftintelligence.com', [{id: 'd', type: 'A', name: 'claude-mcp.mftintelligence.com', content: '192.0.2.13'}]],
]);

function env() {
  return {
    GITHUB_REPOSITORY: 'evansmusitu/mft-axiom-build',
    GITHUB_REF_NAME: 'support/axiom-official-support-20261005',
    GITHUB_SHA: '9'.repeat(40),
    SUPPORT_EMAIL_ROUTING_MIGRATION_CONFIRM: 'MIGRATE_MUSITU_AXIOM_EMAIL_ROUTING',
    SUPPORT_ZOHO_RETIREMENT_CONFIRM: 'RETIRE_UNUSED_ZOHO_TEST_MAILBOXES',
    SUPPORT_MAILBOX_DESTINATION: destination,
    CLOUDFLARE_API_TOKEN: 'masked-token',
  };
}

function mockCloudflare({unverified = false, mutateProtectedAfterCutover = false, unsafeCatchAll = false, unrelatedRule = false, disabledDropAll = false, enableDnsFailure = false, readyAfterReads = 0} = {}) {
  const calls = [];
  let routing = {enabled: false, status: 'unconfigured'};
  let root = structuredClone(zoho);
  let dkim = [];
  let rules = unrelatedRule ? [{id: 'unexpected-rule', enabled: true, matchers: [{type: 'literal', field: 'to', value: 'legacy@mftintelligence.com'}], actions: [{type: 'forward', value: [destination]}]}] : disabledDropAll ? [{id: 'default-drop', enabled: false, matchers: [{type: 'all'}], actions: [{type: 'drop'}]}] : [];
  let nextDnsId = 100;
  let cutover = false;
  let postCutoverRoutingReads = 0;
  const protectedState = new Map([...protectedHosts].map(([k, v]) => [k, structuredClone(v)]));

  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    const u = new URL(url);
    const path = `${u.pathname}${u.search}`;
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({method, path, body, authMode: options.headers?.['x-auth-key'] ? 'global_api_key' : (options.headers?.authorization ? 'api_token' : 'none')});

    if (u.pathname.endsWith('/workers/subdomain')) return response(200, {success: true, result: {subdomain: 'example'}});
    if (u.pathname.includes('/email/routing/addresses')) {
      return response(200, {success: true, result: [{id: 'destination-1', email: destination, verified: unverified ? null : '2026-10-05T18:00:00Z'}]});
    }
    if (u.pathname.endsWith('/email/routing/dns') && method === 'GET') return response(200, {success: true, result: required});
    if (u.pathname.endsWith('/email/routing/dns') && method === 'POST') {
      if (enableDnsFailure) return response(409, {success: false, errors: [{code: 2008, message: 'conflict'}]});
      cutover = true;
      routing = {enabled: true, status: 'misconfigured/locked'};
      root = required.filter(r => r.type === 'MX').map((r, i) => ({id: `cf-${i}`, ...r}));
      dkim = [];
      return response(200, {success: true, result: {...routing, name: zone}});
    }
    if (u.pathname.endsWith('/email/routing/dns') && method === 'DELETE') {
      cutover = false;
      routing = {enabled: false, status: 'unconfigured'};
      root = [];
      dkim = [];
      return response(200, {success: true, result: {...routing, name: zone}});
    }
    if (u.pathname.endsWith('/email/routing') && method === 'GET') {
      const hasSpf = root.some(r => r.type === 'TXT' && String(r.content || '').includes('v=spf1 include:_spf.mx.cloudflare.net'));
      const hasDkim = dkim.some(r => r.type === 'TXT' && String(r.content || '').includes('v=DKIM1'));
      const hasMx = root.filter(r => r.type === 'MX').length === 3;
      if (cutover && hasMx && hasSpf && hasDkim) {
        postCutoverRoutingReads += 1;
        if (readyAfterReads === 0 || postCutoverRoutingReads >= readyAfterReads) routing = {enabled: true, status: 'ready'};
      }
      return response(200, {success: true, result: routing});
    }
    if (u.pathname.endsWith('/email/routing/rules/catch_all') && method === 'GET') {
      return response(200, {success: true, result: unsafeCatchAll
        ? {enabled: true, matchers: [{type: 'all'}], actions: [{type: 'forward', value: [destination]}]}
        : {enabled: false, matchers: [{type: 'all'}], actions: [{type: 'drop'}]}});
    }
    if (u.pathname.includes('/email/routing/rules') && method === 'GET') return response(200, {success: true, result: rules});
    if (u.pathname.endsWith('/email/routing/rules') && method === 'POST') {
      const row = {id: 'support-rule', ...body};
      rules.push(row);
      return response(200, {success: true, result: row});
    }
    if (u.pathname.includes('/email/routing/rules/') && method === 'DELETE') {
      const id = u.pathname.split('/').at(-1);
      rules = rules.filter(r => r.id !== id);
      return response(200, {success: true, result: null});
    }
    if (u.pathname.includes('/dns_records') && method === 'GET') {
      const name = u.searchParams.get('name');
      if (name === zone) return response(200, {success: true, result: root});
      if (name === dkimName) return response(200, {success: true, result: dkim});
      const rows = structuredClone(protectedState.get(name) || []);
      if (cutover && mutateProtectedAfterCutover && name === 'claude-mcp.mftintelligence.com') rows[0].content = '198.51.100.77';
      return response(200, {success: true, result: rows});
    }
    if (u.pathname.endsWith('/dns_records') && method === 'POST') {
      const row = {id: `restored-${nextDnsId++}`, ...body};
      if (body.name === dkimName) dkim.push(row);
      else root.push(row);
      return response(200, {success: true, result: row});
    }
    if (u.pathname.includes('/dns_records/') && method === 'DELETE') {
      const id = u.pathname.split('/').at(-1);
      root = root.filter(r => r.id !== id);
      dkim = dkim.filter(r => r.id !== id);
      return response(200, {success: true, result: null});
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return {fetchImpl, calls, state: () => ({routing, root, dkim, rules})};
}

test('migration accepts the live MX-only Cloudflare required DNS shape and creates support routing before cutover', async () => {
  const mock = mockCloudflare();
  const evidence = await migrateEmailRouting({fetchImpl: mock.fetchImpl, env: env(), now: '2026-10-05T21:00:00Z'});
  assert.equal(evidence.gate, 'MUSITU_AXIOM_SUPPORT_EMAIL_ROUTING_MIGRATION_PASS');
  assert.equal(evidence.routing.ready, true);
  assert.equal(evidence.support_rule.exact_present, true);
  assert.equal(evidence.retired_zoho_test_mailboxes.count, 2);
  assert.equal(evidence.rollback.performed, false);
  assert.equal(evidence.protected_provider_dns.unchanged, true);
  assert.equal(evidence.delivery_verified, false);
  assert.doesNotMatch(JSON.stringify(evidence), /approved-destination@example\.test/);
  assert.doesNotMatch(JSON.stringify(evidence), /evans(?:\.musitu)?@mftintelligence\.com/);

  const createRule = mock.calls.findIndex(c => c.method === 'POST' && c.path.endsWith('/email/routing/rules'));
  const enableDns = mock.calls.findIndex(c => c.method === 'POST' && c.path.endsWith('/email/routing/dns'));
  const deleteMx = mock.calls.filter(c => c.method === 'DELETE' && c.path.includes('/dns_records/'));
  assert.ok(createRule >= 0 && enableDns > createRule, 'support route must be created before root MX cutover when API permits');
  assert.equal(deleteMx.length, 3, 'all three conflicting Zoho MX records must be removed before Cloudflare root activation');
  assert.ok(mock.calls.findIndex(c => c.method === 'DELETE' && c.path.includes('/dns_records/')) < enableDns);
  assert.equal(mock.calls[enableDns].body, undefined, 'root-domain Email Routing enable must omit the subdomain name payload');
  const txtCreates = mock.calls.filter(c => c.method === 'POST' && c.path.endsWith('/dns_records') && c.body?.type === 'TXT');
  assert.equal(txtCreates.length, 2, 'missing routing SPF and DKIM must be created from Cloudflare exact required DNS');
  assert.ok(txtCreates.some(c => c.body.name === zone && String(c.body.content).startsWith('v=spf1')));
  assert.ok(txtCreates.some(c => c.body.name === dkimName && String(c.body.content).startsWith('v=DKIM1')));
  assert.equal(mock.state().routing.status, 'ready');
  assert.equal(mock.state().root.filter(r => r.type === 'MX').length, 3);
  assert.equal(mock.state().root.filter(r => r.type === 'TXT' && String(r.content).startsWith('v=spf1')).length, 1);
  assert.equal(mock.state().dkim.length, 1);
});

test('unverified support destination fails closed before any write', async () => {
  const mock = mockCloudflare({unverified: true});
  await assert.rejects(() => migrateEmailRouting({fetchImpl: mock.fetchImpl, env: env()}), /destination is not verified/);
  assert.equal(mock.calls.some(c => c.method !== 'GET'), false);
  assert.deepEqual(mock.state().root.map(r => r.content), zoho.map(r => r.content));
});

test('migration waits for asynchronous Cloudflare routing readiness before declaring failure', async () => {
  const mock = mockCloudflare({readyAfterReads: 3});
  let sleeps = 0;
  const evidence = await migrateEmailRouting({
    fetchImpl: mock.fetchImpl,
    env: env(),
    sleepImpl: async () => { sleeps += 1; },
    now: '2026-10-06T04:10:00Z',
  });
  assert.equal(evidence.gate, 'MUSITU_AXIOM_SUPPORT_EMAIL_ROUTING_MIGRATION_PASS');
  assert.equal(evidence.routing.ready, true);
  assert.equal(sleeps, 2);
  assert.equal(mock.state().root.filter(r => r.type === 'MX').length, 3);
  assert.equal(mock.state().root.filter(r => r.type === 'TXT' && String(r.content).startsWith('v=spf1')).length, 1);
  assert.equal(mock.state().dkim.length, 1);
});

test('Cloudflare activation conflict after MX removal rolls back exact Zoho MX and removes the new support rule', async () => {
  const mock = mockCloudflare({enableDnsFailure: true});
  await assert.rejects(() => migrateEmailRouting({fetchImpl: mock.fetchImpl, env: env()}), /CLOUDFLARE_POST__ZONES_.*ROLLED_BACK|ROLLED_BACK/);
  assert.equal(mock.state().routing.enabled, false);
  assert.deepEqual(mock.state().root.map(r => r.content).sort(), zoho.map(r => r.content).sort());
  assert.equal(mock.state().rules.length, 0);
  assert.equal(mock.state().dkim.length, 0);
  assert.ok(mock.calls.some(c => c.method === 'DELETE' && c.path.includes('/dns_records/')));
});

test('post-cutover protected-provider drift triggers rollback to the exact prior Zoho MX contents and removes a newly created support rule', async () => {
  const mock = mockCloudflare({mutateProtectedAfterCutover: true});
  await assert.rejects(() => migrateEmailRouting({fetchImpl: mock.fetchImpl, env: env()}), /PROTECTED_PROVIDER_DNS_DRIFT_ROLLED_BACK/);
  assert.equal(mock.state().routing.enabled, false);
  assert.deepEqual(mock.state().root.map(r => r.content).sort(), zoho.map(r => r.content).sort());
  assert.equal(mock.state().rules.length, 0);
  assert.equal(mock.state().dkim.length, 0);
  assert.ok(mock.calls.some(c => c.method === 'DELETE' && c.path.endsWith('/email/routing/dns')));
});

test('enabled forwarding catch-all fails closed before any migration write', async () => {
  const mock = mockCloudflare({unsafeCatchAll: true});
  await assert.rejects(() => migrateEmailRouting({fetchImpl: mock.fetchImpl, env: env()}), /catch-all routing must be disabled or dropping mail/);
  assert.equal(mock.calls.some(c => c.method !== 'GET'), false);
  assert.deepEqual(mock.state().root.map(r => r.content), zoho.map(r => r.content));
});

test('migration prefers the scoped Cloudflare API token when both credentials exist', async () => {
  const mock = mockCloudflare();
  const both = env();
  both.CLOUDFLARE_EMAIL = destination;
  both.CLOUDFLARE_GLOBAL_API_KEY = 'masked-global-key';
  const evidence = await migrateEmailRouting({fetchImpl: mock.fetchImpl, env: both, now: '2026-10-06T03:12:00Z'});
  assert.equal(evidence.gate, 'MUSITU_AXIOM_SUPPORT_EMAIL_ROUTING_MIGRATION_PASS');
  const write = mock.calls.find(c => c.method === 'POST' && c.path.endsWith('/email/routing/rules'));
  assert.equal(write?.authMode, 'api_token');
});

test('disabled all-drop baseline rule is preserved and does not block exact support routing', async () => {
  const mock = mockCloudflare({disabledDropAll: true});
  const evidence = await migrateEmailRouting({fetchImpl: mock.fetchImpl, env: env(), now: '2026-10-06T03:10:00Z'});
  assert.equal(evidence.gate, 'MUSITU_AXIOM_SUPPORT_EMAIL_ROUTING_MIGRATION_PASS');
  assert.equal(evidence.support_rule.exact_present, true);
  assert.equal(mock.state().rules.some(r => r.id === 'default-drop' && r.enabled === false), true);
  assert.equal(mock.state().rules.some(r => r.id === 'support-rule' && r.enabled === true), true);
});

test('unexpected non-support forwarding rule fails closed before any migration write', async () => {
  const mock = mockCloudflare({unrelatedRule: true});
  await assert.rejects(() => migrateEmailRouting({fetchImpl: mock.fetchImpl, env: env()}), /unexpected non-support Email Routing rule exists/);
  assert.equal(mock.calls.some(c => c.method !== 'GET'), false);
  assert.deepEqual(mock.state().root.map(r => r.content), zoho.map(r => r.content));
});
