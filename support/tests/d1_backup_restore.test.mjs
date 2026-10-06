import assert from 'node:assert/strict';
import test from 'node:test';
import {runBackupRestoreDrill} from '../scripts/verify_d1_backup_restore.mjs';

function response(status, payload) {
  return {ok: status >= 200 && status < 300, status, async json() { return payload; }};
}

test('backup/restore drill restores synthetic support data from a D1 Time Travel bookmark and cleans up', async () => {
  const calls = [];
  let marker = 'seed';
  let deleted = false;
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({method, path: u.pathname + u.search, body});

    if (u.pathname.endsWith('/d1/database') && method === 'POST') {
      return response(200, {success: true, result: {uuid: 'db-test-1', name: body.name, version: 'production'}});
    }
    if (u.pathname.endsWith('/d1/database/db-test-1/query') && method === 'POST') {
      const sql = String(body.sql || '');
      if (sql.includes('INSERT INTO support_backup_probe')) marker = 'seed';
      if (sql.includes("UPDATE support_backup_probe SET marker='mutated'")) marker = 'mutated';
      if (sql.startsWith('SELECT ')) return response(200, {success: true, result: [{results: [{marker, payload_sha256: 'a'.repeat(64)}]}]});
      return response(200, {success: true, result: [{success: true}]});
    }
    if (u.pathname.endsWith('/time_travel/bookmark') && method === 'GET') {
      return response(200, {success: true, result: {bookmark: 'bookmark-seed'}});
    }
    if (u.pathname.endsWith('/time_travel/restore') && method === 'POST') {
      assert.equal(u.searchParams.get('bookmark'), 'bookmark-seed');
      marker = 'seed';
      return response(200, {success: true, result: {bookmark: 'bookmark-restored', previous_bookmark: 'bookmark-mutated'}});
    }
    if (u.pathname.endsWith('/d1/database/db-test-1') && method === 'DELETE') {
      deleted = true;
      return response(200, {success: true, result: null});
    }
    throw new Error(`unexpected ${method} ${u.pathname}`);
  };

  const evidence = await runBackupRestoreDrill({
    fetchImpl,
    env: {
      GITHUB_REPOSITORY: 'evansmusitu/mft-axiom-build',
      GITHUB_REF_NAME: 'support/axiom-official-support-20261005',
      GITHUB_RUN_ID: '12345',
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      CLOUDFLARE_API_TOKEN: 'masked-token',
      SUPPORT_BACKUP_RESTORE_CONFIRM: 'VERIFY_MUSITU_AXIOM_SUPPORT_BACKUP_RESTORE',
    },
  });

  assert.equal(evidence.gate, 'BACKUP_RESTORE');
  assert.equal(evidence.status, 'PASS');
  assert.equal(evidence.synthetic_seed_restored, true);
  assert.equal(evidence.temporary_database_deleted, true);
  assert.equal(evidence.production_support_database_modified, false);
  assert.equal(deleted, true);
  assert.ok(calls.some(c => c.path.includes('/time_travel/restore?bookmark=')));
});
