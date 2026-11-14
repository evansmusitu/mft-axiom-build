import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { memoryProbe, preflight, allowed } from '../recovery/step2_prod_oauth_migration_preflight_20261114.mjs';
import { TARGET, TARGET_BASE, ACCOUNT_BASE } from '../recovery/step2_prod_oauth_hosted_restore_20261114.mjs';
import { NAME } from '../recovery/step2_create_oauth_restore_target_20261114.mjs';
const receipt = JSON.parse(readFileSync(new URL('../evidence/hosted_recovery_20261114/prod_oauth_hosted_restore_parity_rollback_passed_20261114.json', import.meta.url)));
const root = fileURLToPath(new URL('../../', import.meta.url));
function fixtureSql(dirty = false) {
  const script = "import importlib.util,sys,pathlib\np=pathlib.Path(sys.argv[1])/'customer_frontier/tests/test_oauth_identity_upgrade.py'\ns=importlib.util.spec_from_file_location('fixture_source',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ndb=m.fixture()\nif sys.argv[2]=='dirty':m.link(db,parent='key-b')\nprint(m.snapshot(db))\ndb.close()";
  const r = spawnSync('python3', ['-c', script, root, dirty ? 'dirty' : 'clean'], { maxBuffer: 200000 });
  assert.equal(r.status, 0); return r.stdout;
}
test('the exact reviewed plan upgrades a real SQLite fixture in memory while preserving original table data', () => {
  const r = memoryProbe(fixtureSql());
  assert.equal(r.status, 'REAL_RECOVERED_SNAPSHOT_LOCAL_UPGRADE_PREFLIGHT_PASSED');
  assert.equal(r.plan_sha256, '6946e796539e6787033e20f1d0afdcb5259a130ca77be6e3c5afb60b5dc9888a');
  assert.equal(r.statement_count, 89); assert.equal(r.hosted_migration_qualified, false);
  for (const before of r.baseline.tables) {
    assert.deepEqual(r.expected_after_upgrade.tables.find(x => x.table_name_sha256 === before.table_name_sha256), before);
  }
});
test('dirty cross-customer linkage rejects the reviewed plan, restores local data and reveals no SQL values', () => {
  const r = memoryProbe(fixtureSql(true));
  assert.equal(r.status, 'REAL_RECOVERED_SNAPSHOT_LOCAL_UPGRADE_PREFLIGHT_REJECTED');
  assert.equal(r.local_rollback_matches_baseline, true); assert.ok(Number.isSafeInteger(r.failed_statement_index));
  for (const value of ['private@example.test', 'customer-a', 'key-b']) assert.equal(JSON.stringify(r).includes(value), false);
});
test('untrusted SQL cannot attach files and malformed private values never enter diagnostics', () => {
  const r = memoryProbe(Buffer.from("ATTACH DATABASE ':memory:' AS forbidden; SELECT 'SYNTHETIC_PRIVATE_SENTINEL';"));
  assert.equal(r.status, 'REAL_RECOVERED_SNAPSHOT_LOCAL_UPGRADE_PREFLIGHT_REJECTED');
  assert.equal(JSON.stringify(r).includes('SYNTHETIC_PRIVATE_SENTINEL'), false); assert.equal(r.plaintext_written, false);
});
function simulation(change = {}) {
  const calls = []; let buffer;
  const ok = result => ({ success: true, result });
  const api = async (method, path, body) => {
    assert.equal(allowed(method, path, body), true); calls.push({ method, path, body });
    if (path === ACCOUNT_BASE) return ok({ id: ACCOUNT_BASE.split('/').at(-1) });
    if (path.endsWith('/subscriptions')) return ok([]);
    if (path === TARGET_BASE) return ok({ uuid: TARGET, name: NAME });
    return ok({ status: 'complete', at_bookmark: '00000001-00000002-00000003-0123456789abcdef',
      result: { signed_url: 'https://synthetic.r2.cloudflarestorage.com/export' } });
  };
  return { calls, buffer: () => buffer, run: baseline => preflight({ baselineReceipt: baseline ?? receipt, api,
    transfer: async () => (buffer = Buffer.from('SYNTHETIC_PRIVATE_SQL')),
    inspect: () => ({ schema: 'musitu.axiom.production-oauth-memory-upgrade.v1',
      plan_sha256: '6946e796539e6787033e20f1d0afdcb5259a130ca77be6e3c5afb60b5dc9888a', statement_count: 89,
      baseline: change.drift ? { ...receipt.baseline, user_data_sha256: 'f'.repeat(64) } : receipt.baseline,
      status: change.reject ? 'REAL_RECOVERED_SNAPSHOT_LOCAL_UPGRADE_PREFLIGHT_REJECTED' : 'REAL_RECOVERED_SNAPSHOT_LOCAL_UPGRADE_PREFLIGHT_PASSED' }),
    save: () => {}, pause: async () => {} }) };
}
test('the cloud preflight only exports the exact recovered copy and clears the SQL buffer', async () => {
  const s = simulation(), r = await s.run();
  assert.equal(r.status, 'PRODUCTION_OAUTH_COPY_LOCAL_UPGRADE_PREFLIGHT_PASSED');
  assert.equal(r.database_mutation_routes_available, false); assert.equal(r.hosted_migration_qualified, false);
  assert.ok(s.buffer().every(byte => byte === 0));
});
test('missing hosted recovery evidence, recovered data drift or local plan rejection cannot pass', async () => {
  const s = simulation(), invalid = await s.run({ ...receipt, source_data_unchanged: false });
  assert.equal(invalid.error, 'QUALIFIED_PRODUCTION_RESTORE_REQUIRED'); assert.equal(s.calls.length, 0);
  assert.equal((await simulation({ drift: true }).run()).error, 'RECOVERED_SNAPSHOT_DRIFT');
  assert.equal((await simulation({ reject: true }).run()).error, 'REVIEWED_UPGRADE_REJECTED_REAL_RECOVERED_DATA');
});
test('preflight capability excludes every SQL query, restore/import route and production database', () => {
  for (const suffix of ['/query', '/import', '/time_travel/restore?bookmark=00000001-00000002'])
    assert.equal(allowed('POST', TARGET_BASE + suffix, { sql: 'DELETE FROM customers' }), false);
  assert.equal(allowed('POST', TARGET_BASE + '/export', { output_format: 'polling', dump_options: { no_data: true } }), false);
  assert.equal(allowed('GET', '/accounts/93f395f5121954671f92fffa453d6b61/d1/database/504029cc-f9a5-495e-818f-63c6144b4ea4'), false);
});
