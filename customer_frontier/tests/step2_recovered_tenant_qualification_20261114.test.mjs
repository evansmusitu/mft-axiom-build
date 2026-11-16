import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { qualify, F, SQL, fixtureQueryAllowed, credentialedRequest, ownerResultMatches, ConstraintDenied } from '../recovery/step2_recovered_tenant_qualification_20261114.mjs';
import { ACCOUNT, NAME } from '../recovery/step2_create_restore_target_20261114.mjs';
import { TARGET, TARGET_BASE, ACCOUNT_BASE, fingerprint } from '../recovery/step2_hosted_restore_20261114.mjs';
const schema = readFileSync(new URL('../customer_control_plane/schema.sql', import.meta.url), 'utf8');
const realReceipt = JSON.parse(readFileSync(new URL('../evidence/hosted_recovery_20261114/hosted_restore_parity_rollback_passed.json', import.meta.url)));
const ownerProof = JSON.parse(readFileSync(new URL('../evidence/hosted_recovery_20261114/owner_submitted_decryption_proof_20261114.json', import.meta.url)));
const mark = '00000001-00000002-00000003-0123456789abcdef0123456789abcdef';
const ok = result => ({ success: true, result });

function simulation(change = {}) {
  let db, rolled = false; const calls = [], receipts = [];
  function reset() {
    if (db) db.close();
    db = new DatabaseSync(':memory:'); db.exec(schema);
    db.exec("INSERT INTO tenants(id,name,status) VALUES('historical-tenant','preserved historical row','suspended');");
  }
  reset();
  const quoteName = text => '"' + text.replaceAll('"', '""') + '"';
  function dump() {
    const objects = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const tables = objects.filter(row => row.type === 'table');
    const lines = ['PRAGMA foreign_keys=OFF;', ...tables.map(row => row.sql + ';')];
    for (const table of tables) {
      for (const row of db.prepare('SELECT * FROM ' + quoteName(table.name)).all()) {
        const values = Object.values(row).map(value => db.prepare('SELECT quote(?) AS value').get(value).value);
        lines.push('INSERT INTO ' + quoteName(table.name) + ' VALUES(' + values.join(',') + ');');
      }
    }
    lines.push(...objects.filter(row => row.type !== 'table').map(row => row.sql + ';'), 'PRAGMA foreign_keys=ON;');
    if (change.corruptCleanup && rolled) lines.push("INSERT INTO tenants(id,name) VALUES('residual-fixture','bad cleanup');");
    return Buffer.from(lines.join('\n'));
  }
  const baseline = fingerprint(dump());
  const receipt = { ...realReceipt, baseline };
  const query = async body => {
    if (change.failQuery && body.sql === change.failQuery) throw new Error('SENSITIVE_TRANSPORT_SENTINEL');
    try {
      const rows = db.prepare(body.sql).all(...body.params);
      const read = body.sql.trim().startsWith('SELECT');
      return ok([{ success: true, results: rows, meta: { rows_written: read ? 0 : db.prepare('SELECT changes() AS n').get().n, changed_db: !read } }]);
    } catch (error) {
      for (const code of ['FOREIGN KEY constraint failed', 'canonical_link_immutable', 'canonical_link_revocation_terminal'])
        if (error.message.includes(code)) throw new ConstraintDenied(code);
      throw error;
    }
  };
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === ACCOUNT_BASE) return ok({ id: change.account ?? ACCOUNT });
    if (path.endsWith('/subscriptions')) return ok([{ state: 'Paid', price: 0, rate_plan: { id: 'r2_paid', currency: 'USD' } }]);
    if (path.endsWith('/d1/database?page=1&per_page=100')) return { ...ok([{ uuid: TARGET, name: NAME }]), result_info: { total_count: 1, count: 1 } };
    if (path.endsWith('/workers/scripts')) return ok(change.workers ?? []);
    if (path.includes('/pages/projects')) return { ...ok([]), result_info: { total_count: 0 } };
    if (path === TARGET_BASE) return ok({ uuid: TARGET, name: NAME });
    if (path.endsWith('/time_travel/bookmark')) return ok({ bookmark: mark });
    if (path.endsWith('/export')) return ok({ at_bookmark: mark, status: 'complete', result: { signed_url: 'https://synthetic.r2.cloudflarestorage.com/export' } });
    if (path.endsWith('/query')) {
      assert.equal(fixtureQueryAllowed(body), true);
      return query(body);
    }
    if (path.includes('/time_travel/restore?')) {
      reset(); rolled = true;
      if (change.lostRollbackAck) throw new Error('lost provider acknowledgement');
      return ok({ bookmark: mark });
    }
    assert.fail('Unexpected simulated path');
  };
  return { calls, receipts, async run(options = {}) {
    try { return await qualify({ call, transfer: async () => dump(), inspect: fingerprint,
      baselineReceipt: receipt, ownerProof, pause: async () => {}, save: row => receipts.push(JSON.parse(JSON.stringify(row))), ...options }); }
    finally { db.close(); }
  } };
}

test('unchanged application code enforces recovered tenant boundaries against real synthetic SQLite', async () => {
  const s = simulation(), r = await s.run();
  assert.equal(r.status, 'RECOVERED_APPLICATION_TENANT_BOUNDARIES_AND_CLEANUP_VERIFIED');
  assert.equal(r.tests.length, 15);
  assert.equal(r.cleanup_all_table_parity_verified, true);
  assert.equal(r.real_customer_login_qualified, false);
  assert.deepEqual(r.baseline, r.after_cleanup);
  assert.ok(s.calls.every(call => call.path.startsWith(ACCOUNT_BASE)));
  assert.ok(!JSON.stringify(r).includes('preserved historical row'));
});
test('owner result pins must match before any provider request', async () => {
  const s = simulation(); const r = await s.run({ ownerProof: { ...ownerProof, encrypted_backup_sha256: '0'.repeat(64) } });
  assert.equal(r.error, 'OWNER_BACKUP_RESULT_OR_BASELINE_MISMATCH');
  assert.equal(s.calls.length, 0);
});
test('account drift and existing Worker consumers stop before fixture admission', async () => {
  for (const change of [{ account: 'other-account' }, { workers: [{}] }]) {
    const s = simulation(change), r = await s.run();
    assert.equal(r.fixtures_attempted, false);
    assert.equal(r.rollback_attempted, false);
  }
});
test('a provider error is never counted as an expected tenant denial; partial seed is rolled back', async () => {
  const s = simulation({ failQuery: SQL.seedMemberships }), r = await s.run();
  assert.equal(r.status, 'TENANT_QUALIFICATION_STOPPED');
  assert.equal(r.cleanup_all_table_parity_verified, true);
  assert.equal(r.tests.length, 0);
  assert.ok(!JSON.stringify(r).includes('SENSITIVE_TRANSPORT_SENTINEL'));
});
test('a failed final parity check blocks qualification despite passing all tenant checks', async () => {
  const r = await simulation({ corruptCleanup: true }).run();
  assert.equal(r.status, 'TENANT_TEST_CLEANUP_REQUIRES_RECONCILIATION');
  assert.equal(r.cleanup_all_table_parity_verified, false);
});
test('a lost rollback acknowledgement is not retried and cleanup is independently measured', async () => {
  const s = simulation({ lostRollbackAck: true }), r = await s.run();
  assert.equal(r.rollback_acknowledged, false);
  assert.equal(r.cleanup_all_table_parity_verified, true);
  assert.equal(s.calls.filter(call => call.path.includes('/time_travel/restore?')).length, 1);
});
test('fixture SQL scope rejects alternate commands, parameters and real customer identifiers', async () => {
  assert.equal(fixtureQueryAllowed({ sql: SQL.membership, params: [F.issuer, F.sa, F.ta] }), true);
  for (const body of [{ sql: 'DELETE FROM tenants', params: [] }, { sql: SQL.membership, params: [F.issuer, F.sa, 'unreviewed-real-customer-tenant'] },
    { sql: SQL.membership, params: [F.issuer] }, { sql: SQL.membership, params: [F.issuer, F.sa, F.ta], extra: true }])
    assert.equal(fixtureQueryAllowed(body), false);
  await assert.rejects(credentialedRequest('fake-token')('POST', '/accounts/93f395f5121954671f92fffa453d6b61/d1/database/504029cc-f9a5-495e-818f-63c6144b4ea4/query',
    { sql: SQL.seedTenants, params: [F.ta, F.tb] }));
});
test('the accepted owner result is metadata evidence and cannot confer production release', () => {
  assert.equal(ownerResultMatches(realReceipt, ownerProof), true);
  assert.equal(ownerResultMatches(realReceipt, { ...ownerProof, authenticated_decryption_verified: false }), false);
  assert.equal(ownerResultMatches({ ...realReceipt, source_data_unchanged: false }, ownerProof), false);
});
