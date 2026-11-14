import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { recover, permitted, signedStorageUrl, fingerprint, SOURCE_BASE, TARGET_BASE,
  ACCOUNT_BASE, TARGET, MARKER_SQL, MARKER_COUNT_SQL, catalogHash, ENVELOPE_FILE } from '../recovery/step2_hosted_restore_20261114.mjs';
import { ACCOUNT, SOURCE_DATABASE, NAME, CATALOG_SQL, RECIPIENT_SHA256 } from '../recovery/step2_create_restore_target_20261114.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const BOOKMARK = '00000001-00000002-00000003-0123456789abcdef0123456789abcdef';
const ddl = 'CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)';
const SQL = ddl + "; INSERT INTO sample VALUES(9007199254740993,'Zimbabwe ✓');";
const rows = [{ type: 'table', name: 'sample', sql: ddl }];
const ok = value => ({ success: true, result: value });
const query = rows => ok([{ success: true, results: rows, meta: { rows_written: 0, changed_db: false } }]);

function simulation(change = {}) {
  const calls = [], files = new Map(); let imported = false, probe = false, rolled = false, sourceExports = 0;
  const call = async (role, method, path, body) => {
    assert.equal(permitted(role, method, path, body), true);
    calls.push({ role, method, path, body });
    if (change.fail?.(role, method, path, body)) throw new Error('SENSITIVE_SENTINEL_TOKEN_OR_SQL');
    if (path === ACCOUNT_BASE) return ok({ id: change.account ?? ACCOUNT });
    if (path.endsWith('/subscriptions')) return ok(change.subscriptions ?? [{ state: 'Paid', price: 0, rate_plan: { id: 'r2_paid', currency: 'USD' } }]);
    if (path.endsWith('/d1/database?page=1&per_page=100')) return { ...ok([{ uuid: TARGET, name: NAME }]), result_info: { page: 1, per_page: 100, count: 1, total_count: 1 } };
    if (path.endsWith('/workers/scripts')) return ok(change.workers ?? []);
    if (path.includes('/pages/projects')) return { ...ok([]), result_info: { count: 0, total_count: 0 } };
    if (path === TARGET_BASE) return ok({ uuid: TARGET, name: NAME });
    if (path === SOURCE_BASE) return ok({ uuid: SOURCE_DATABASE, file_size: 356352 });
    if (path.endsWith('/time_travel/bookmark')) return ok({ bookmark: BOOKMARK });
    if (path.includes('/time_travel/restore?')) { rolled = true; probe = false; return ok({ bookmark: BOOKMARK }); }
    if (path.endsWith('/query')) {
      if (body.sql === MARKER_SQL) { probe = true; return ok([{ success: true }]); }
      if (body.sql === MARKER_COUNT_SQL) return query([{ marker_count: probe ? 1 : 0 }]);
      if (body.sql === CATALOG_SQL) return query(role === 'source' || imported || change.nonempty ? rows : []);
    }
    if (path.endsWith('/import')) {
      if (body.action === 'init') return ok({ filename: 'restore.sql', upload_url: 'https://example.r2.cloudflarestorage.com/upload' });
      if (body.action === 'ingest') {
        imported = true;
        if (change.importPending) return ok({ at_bookmark: BOOKMARK });
        return ok({ status: 'complete', success: true, result: { final_bookmark: BOOKMARK } });
      }
      if (body.action === 'poll') return ok({ status: 'complete', success: true, result: { final_bookmark: BOOKMARK } });
    }
    if (path.endsWith('/export')) {
      if (change.exportPending && !body.current_bookmark) return ok({ at_bookmark: BOOKMARK });
      if (role === 'source') sourceExports++;
      return ok({ at_bookmark: BOOKMARK, status: 'complete', success: true,
        result: { signed_url: 'https://example.r2.cloudflarestorage.com/' + role } });
    }
    assert.fail('Unexpected simulation request');
  };
  const transfer = async (method, url) => {
    if (method === 'PUT') return Buffer.alloc(0);
    if (change.corruptTarget && url.endsWith('/target')) return Buffer.from(ddl + "; INSERT INTO sample VALUES(1,'altered');");
    if (change.corruptRollback && rolled && url.endsWith('/target')) return Buffer.from(SQL + ' CREATE TABLE residual(v);');
    if (change.sourceDrift && sourceExports > 1 && url.endsWith('/source')) return Buffer.from(ddl + ';');
    return Buffer.from(SQL);
  };
  const persist = (file, object) => { const json = JSON.stringify(object); files.set(file, JSON.parse(json)); return sha(json); };
  return { calls, files, run: () => recover({ call, transfer, persist, pause: async () => {} }) };
}

test('actual memory replay matches the catalog and preserves large integers', () => {
  const fp = fingerprint(Buffer.from(SQL));
  assert.equal(fp.catalog_sha256, catalogHash(rows));
  assert.equal(fp.total_rows, 1);
});
test('synthetic full restore and target rollback require complete parity', async () => {
  const s = simulation(), r = await s.run();
  assert.equal(r.status, 'HOSTED_LOGICAL_RESTORE_PARITY_AND_ROLLBACK_VERIFIED');
  assert.equal(r.source_data_unchanged, true);
  assert.equal(r.encrypted_backup_owner_decryption_verified, false);
  assert.equal(r.rollback_outcome, 'SCHEMA_AND_ALL_TABLE_DATA_RESTORED');
  assert.equal(s.files.get(ENVELOPE_FILE).recipient_spki_sha256, RECIPIENT_SHA256);
  assert.ok(!JSON.stringify([...s.files.values()]).includes('Zimbabwe'));
  assert.ok(!s.calls.some(c => c.role === 'source' && c.path.includes('/import')));
});
test('different target account stops before source export or target writes', async () => {
  const s = simulation({ account: 'different' }), r = await s.run();
  assert.equal(r.error, 'TARGET_ACCOUNT_DRIFT');
  assert.equal(s.calls.length, 1);
});
test('export and import polling use the same operation bookmark', async () => {
  const s = simulation({ exportPending: true, importPending: true }), r = await s.run();
  assert.equal(r.status, 'HOSTED_LOGICAL_RESTORE_PARITY_AND_ROLLBACK_VERIFIED');
  assert.equal(s.calls.filter(c => c.body?.action === 'ingest').length, 1);
  assert.equal(s.calls.filter(c => c.body?.action === 'poll').length, 1);
  assert.equal(s.calls.filter(c => c.path.endsWith('/export') && c.body?.current_bookmark === BOOKMARK).length, 4);
});
test('lost rollback acknowledgement stays unknown without repeating restore', async () => {
  const s = simulation({ fail: (_r, _m, path) => path.includes('/time_travel/restore?') }), r = await s.run();
  assert.equal(r.rollback_outcome, 'UNKNOWN');
  assert.equal(r.rollback_attempted, true);
  assert.equal(s.calls.filter(c => c.path.includes('/time_travel/restore?')).length, 1);
});
test('nonempty target cannot be overwritten', async () => {
  const s = simulation({ nonempty: true }), r = await s.run();
  assert.equal(r.error, 'TARGET_IS_NOT_EMPTY');
  assert.equal(r.target_import_attempted, false);
});
test('Workers paid and existing consumers deny admission', async () => {
  for (const change of [{ workers: [{}] }, { subscriptions: [{ state: 'Paid', price: 5, rate_plan: { id: 'workers_paid' } }] }]) {
    const s = simulation(change), r = await s.run();
    assert.equal(r.target_import_attempted, false);
    assert.equal(r.status, 'HOSTED_RECOVERY_STOPPED');
  }
});
test('lost ingest acknowledgement stays unknown with no retry', async () => {
  const s = simulation({ fail: (_r, _m, path, body) => path.endsWith('/import') && body.action === 'ingest' });
  const r = await s.run();
  assert.equal(r.target_import_outcome, 'UNKNOWN');
  assert.equal(s.calls.filter(c => c.body?.action === 'ingest').length, 1);
  assert.equal(r.error, 'UNEXPECTED_LOCAL_FAILURE');
  assert.ok(!JSON.stringify(r).includes('SENSITIVE_SENTINEL'));
});
test('data mismatch blocks rollback probe and cannot pass', async () => {
  const r = await simulation({ corruptTarget: true }).run();
  assert.equal(r.error, 'HOSTED_RESTORE_SCHEMA_OR_DATA_MISMATCH');
  assert.equal(r.rollback_attempted, false);
});
test('rollback must remove marker and retain all original data', async () => {
  const r = await simulation({ corruptRollback: true }).run();
  assert.equal(r.error, 'ROLLBACK_SCHEMA_OR_DATA_MISMATCH');
  assert.equal(r.rollback_outcome, 'UNKNOWN');
});
test('source drift cannot be called source preservation', async () => {
  const r = await simulation({ sourceDrift: true }).run();
  assert.equal(r.error, 'SOURCE_CHANGED_DURING_TEST_WINDOW');
  assert.equal(r.source_data_unchanged, false);
});
test('source credential has no data mutation or rollback routes', () => {
  for (const suffix of ['/import', '/time_travel/restore?bookmark=' + BOOKMARK, '/export?anything=1'])
    assert.equal(permitted('source', 'POST', SOURCE_BASE + suffix, { action: 'init', etag: 'a'.repeat(32) }), false);
  assert.equal(permitted('source', 'POST', SOURCE_BASE + '/query', { sql: MARKER_SQL }), false);
  assert.equal(permitted('source', 'GET', TARGET_BASE), false);
  assert.equal(permitted('target', 'GET', SOURCE_BASE), false);
  assert.equal(permitted('target', 'DELETE', TARGET_BASE), false);
});
test('export route cannot filter tables, omit data or change request shape', () => {
  for (const body of [{ output_format: 'polling', dump_options: { no_data: true } }, { output_format: 'polling', current_bookmark: 'bad' }])
    assert.equal(permitted('source', 'POST', SOURCE_BASE + '/export', body), false);
});
test('signed storage URLs exclude cleartext, attacker suffixes, credentials and redirects', () => {
  assert.equal(signedStorageUrl('https://abc.r2.cloudflarestorage.com/a?signature=opaque').hostname, 'abc.r2.cloudflarestorage.com');
  for (const value of ['http://abc.r2.cloudflarestorage.com/a', 'https://abc.r2.cloudflarestorage.com.evil.test/a',
    'https://user:pass@abc.r2.cloudflarestorage.com/a', 'https://abc.r2.cloudflarestorage.com:444/a', 'https://127.0.0.1/a'])
    assert.throws(() => signedStorageUrl(value));
});
test('malformed SQL is sanitized and never echoed', () => {
  assert.throws(() => fingerprint(Buffer.from('SECRET_CUSTOMER_SENTINEL invalid sql')), error => error.message === 'SQL_MEMORY_REPLAY_FAILED');
});
