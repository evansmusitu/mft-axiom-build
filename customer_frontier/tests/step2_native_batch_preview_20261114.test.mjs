import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { qualifyNativeBatch, readNativePersistence } from '../recovery/step2_native_batch_preview_worker_20261114.mjs';
import { qualifyPreview, allowed, trustedPreviewUrl, PreviewStop, PRODUCTION_BASE, PRODUCTION_DATABASE, PREVIEW_A, PREVIEW_B } from '../recovery/step2_native_batch_preview_20261114.mjs';
import { ACCOUNT, NAME, CATALOG_SQL } from '../recovery/step2_create_restore_target_20261114.mjs';
import { TARGET, TARGET_BASE, ACCOUNT_BASE } from '../recovery/step2_hosted_restore_20261114.mjs';
const receipt = JSON.parse(readFileSync(new URL('../evidence/hosted_recovery_20261114/hosted_restore_parity_rollback_passed.json', import.meta.url)));
const ownerProof = JSON.parse(readFileSync(new URL('../evidence/hosted_recovery_20261114/owner_submitted_decryption_proof_20261114.json', import.meta.url)));
const source = readFileSync(new URL('../recovery/step2_native_batch_preview_worker_20261114.mjs', import.meta.url), 'utf8');

function sqliteD1({ atomic = true } = {}) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON;');
  const prepare = sql => {
    let params = [];
    const ps = { sql, bind(...values) { params = values; return ps; }, args: () => params,
      async first() { return db.prepare(sql).get(...params) ?? null; } };
    return ps;
  };
  return { prepare, async batch(items) {
    if (atomic) db.exec('BEGIN IMMEDIATE');
    try {
      const rows = items.map(item => ({ results: db.prepare(item.sql).all(...item.args()) }));
      if (atomic) db.exec('COMMIT'); return rows;
    } catch (error) { if (atomic) db.exec('ROLLBACK'); throw error; }
  }, db, close: () => db.close() };
}
test('native worker contract exercises sequential DDL, destructive rollback and competing writers', async () => {
  const db = sqliteD1(); try {
    const result = await qualifyNativeBatch(db);
    assert.equal(result.status, 'NATIVE_D1_BATCH_BEHAVIOR_VERIFIED');
    assert.equal(result.tests.length, 6);
    assert.equal((await readNativePersistence(db)).status, 'NATIVE_D1_STATE_SURVIVES_FRESH_PREVIEW_SESSION');
  } finally { db.close(); }
});
test('the same tests reject a nontransactional batch adapter', async () => {
  const db = sqliteD1({ atomic: false }); try {
    assert.equal((await qualifyNativeBatch(db)).status, 'NATIVE_D1_BATCH_BEHAVIOR_NOT_QUALIFIED');
  } finally { db.close(); }
});
test('disabled FK enforcement refuses all native writes', async () => {
  const db = sqliteD1(); try {
    db.db.exec('PRAGMA foreign_keys=OFF;'); const r = await qualifyNativeBatch(db);
    assert.equal(r.status, 'NATIVE_D1_BATCH_BEHAVIOR_NOT_QUALIFIED'); assert.equal(r.writes_attempted, false);
  } finally { db.close(); }
});
test('preview requires authorization and never accepts caller SQL', async () => {
  const env = { GATE2_PROBE_KEY: 'a'.repeat(64), RECOVERY_DB: { prepare() { assert.fail('Binding must not be reached'); } } };
  assert.equal((await worker.fetch(new Request('https://unit.test/gate2/native-batch', { method: 'POST' }), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://unit.test/gate2/native-batch', { method: 'POST',
    headers: { authorization: 'Bearer ' + env.GATE2_PROBE_KEY }, body: JSON.stringify({ operation: 'qualify-native-batch', sql: 'DELETE FROM customers' }) }), env)).status, 400);
});

const ok = result => ({ success: true, result });
function simulation(change = {}) {
  const calls = [], forms = new Map(); let invoked = false, rolled = false;
  const mark = '00000001-00000002-00000003-0123456789abcdef0123456789abcdef';
  const api = async (role, method, path, body, sessionToken) => {
    assert.equal(allowed(role, method, path, body), true); calls.push({ role, method, path });
    if (path === PRODUCTION_BASE) return ok({ uuid: PRODUCTION_DATABASE, file_size: 2453521 });
    if (path === PRODUCTION_BASE + '/query') return ok([{ success: true, meta: { changed_db: false, rows_written: 0 },
      results: ['customers', 'api_keys', 'oauth_clients', 'oauth_authorization_flows', 'oauth_authorization_codes', 'oauth_access_tokens', 'oauth_refresh_tokens']
        .filter(name => !(change.missingProductionTable && name === 'customers')).map(name => ({ name, type: 'table', sql: 'CREATE TABLE ' + name + '(id TEXT)' })) }]);
    if (path === ACCOUNT_BASE) return ok({ id: ACCOUNT });
    if (path.endsWith('/subscriptions')) return ok([{ state: 'Paid', price: 0, rate_plan: { id: 'r2_paid', currency: 'USD' } }]);
    if (path.endsWith('/workers/scripts')) return ok([]);
    if (path.includes('/pages/projects')) return { ...ok([]), result_info: { total_count: 0 } };
    if (path === TARGET_BASE) return ok({ uuid: TARGET, name: NAME });
    if (path.endsWith('/export')) return ok({ at_bookmark: mark, status: 'complete', result: { signed_url: 'https://synthetic.r2.cloudflarestorage.com/export' } });
    if (path.endsWith('/time_travel/bookmark')) return ok({ bookmark: mark });
    if (path.includes('/time_travel/restore?')) { rolled = true; return ok({ bookmark: mark }); }
    if (path.endsWith('/subdomain/edge-preview')) {
      if (change.permissionDenied) throw new PreviewStop('RECOVERY_API_HTTP_403');
      return ok({ token: 'SYNTHETIC_PREVIEW_SECRET', exchange_url: 'https://exchange.synthetic.workers.dev/auth' });
    }
    if (path.endsWith('/edge-preview') && method === 'POST') {
      assert.equal(sessionToken, 'SYNTHETIC_EXPANDED_SECRET');
      const metadata = JSON.parse(await body.get('metadata').text());
      assert.equal(metadata.bindings.find(b => b.type === 'd1').id, TARGET);
      forms.set(path.includes(PREVIEW_B) ? PREVIEW_B : PREVIEW_A, metadata);
      return ok({ preview_token: 'SYNTHETIC_UPLOADED_PREVIEW_SECRET' });
    }
    assert.fail('Unexpected synthetic API call');
  };
  const edge = async (url, init) => {
    if (!init) return { token: 'SYNTHETIC_EXPANDED_SECRET' };
    assert.equal(init.headers['cf-workers-preview-token'], 'SYNTHETIC_UPLOADED_PREVIEW_SECRET');
    const name = new URL(url).hostname.startsWith(PREVIEW_B) ? PREVIEW_B : PREVIEW_A;
    const metadata = forms.get(name), binding = key => metadata.bindings.find(row => row.name === key).text;
    assert.equal(init.headers.Authorization, 'Bearer ' + binding('GATE2_PROBE_KEY'));
    invoked = true;
    return { status: name === PREVIEW_A ? 'NATIVE_D1_BATCH_BEHAVIOR_VERIFIED' : 'NATIVE_D1_STATE_SURVIVES_FRESH_PREVIEW_SESSION',
      preview_instance_tag: binding('GATE2_INSTANCE_TAG'), tests: [] };
  };
  return { calls, forms, run: options => qualifyPreview({ baselineReceipt: receipt, ownerProof, workerSource: source,
    api, edge, transfer: async () => Buffer.from('SYNTHETIC SQL'), inspect: () => change.corruptCleanup && rolled ? { ...receipt.baseline, user_data_sha256: '0'.repeat(64) } : receipt.baseline,
    pause: async () => {}, save: () => {}, ...options }), state: () => ({ invoked, rolled }) };
}
test('controller binds only the recovery copy, qualifies fresh preview persistence and restores all tables', async () => {
  const s = simulation(), r = await s.run();
  assert.equal(r.status, 'NATIVE_BATCH_AND_FRESH_PREVIEW_PERSISTENCE_QUALIFIED');
  assert.equal(r.cleanup_parity_verified, true); assert.equal(r.preview_workers_absent_after_cleanup, true);
  assert.equal(r.production_sql_export_performed, false); assert.equal(r.production_mutation_routes_available, false);
  assert.ok(!JSON.stringify(r).includes('SYNTHETIC_PREVIEW_SECRET'));
  assert.ok(!s.calls.some(c => c.role === 'production' && ![PRODUCTION_BASE, PRODUCTION_BASE + '/query'].includes(c.path)));
});
test('a real preview permission refusal stops before invocation or rollback and does not retry', async () => {
  const s = simulation({ permissionDenied: true }), r = await s.run();
  assert.equal(r.error, 'RECOVERY_API_HTTP_403'); assert.equal(r.native_invocation_attempted, false);
  assert.equal(s.state().rolled, false);
  assert.equal(s.calls.filter(c => c.path.endsWith('/subdomain/edge-preview')).length, 1);
});
test('a missing production table cannot be substituted with staging identity data', async () => {
  const s = simulation({ missingProductionTable: true }), r = await s.run();
  assert.equal(r.error, 'PRODUCTION_OAUTH_TABLES_NOT_QUALIFIED'); assert.equal(s.forms.size, 0);
});
test('full cleanup parity is mandatory even when both previews passed', async () => {
  const r = await simulation({ corruptCleanup: true }).run();
  assert.equal(r.status, 'NATIVE_PROBE_CLEANUP_REQUIRES_RECONCILIATION'); assert.equal(r.cleanup_parity_verified, false);
});
test('role and host policies reject production writes, arbitrary account routes and attacker suffixes', () => {
  assert.equal(allowed('production', 'POST', PRODUCTION_BASE + '/query', { sql: CATALOG_SQL }), true);
  for (const path of ['/import', '/export', '/time_travel/restore?bookmark=00000000-1111111111111111'])
    assert.equal(allowed('production', 'POST', PRODUCTION_BASE + path), false);
  assert.equal(allowed('production', 'POST', PRODUCTION_BASE + '/query', { sql: 'DELETE FROM customers' }), false);
  assert.equal(allowed('recovery', 'POST', PRODUCTION_BASE + '/query', { sql: CATALOG_SQL }), false);
  for (const url of ['http://x.workers.dev/a', 'https://x.workers.dev.attacker.test/a', 'https://user:pass@x.workers.dev/a', 'https://127.0.0.1/a'])
    assert.throws(() => trustedPreviewUrl(url));
});
