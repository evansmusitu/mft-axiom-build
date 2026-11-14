import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTarget, permitted, nativeAdmission, OAuthTargetStop, NAME, PREFIX, PRODUCTION_DATABASE } from '../recovery/step2_create_oauth_restore_target_20261114.mjs';
import { TARGET } from '../recovery/step2_hosted_restore_20261114.mjs';
const native = JSON.parse(readFileSync(new URL('../evidence/hosted_recovery_20261114/native_batch_qualified_20261114.json', import.meta.url)));
const fresh = '11111111-2222-4333-8444-555555555555';
const ok = result => ({ success: true, result });
function simulation(change = {}) {
  const calls = [];
  const api = async (method, path, body) => {
    assert.equal(permitted(method, path, body), true); calls.push({ method, path, body });
    if (path === PREFIX) return ok({ id: PREFIX.split('/').at(-1) });
    if (path.endsWith('/subscriptions')) return ok(change.paid ? [{ state: 'Paid', price: 5, rate_plan: { id: 'workers_paid' } }] : []);
    if (path.endsWith('/d1/database?page=1&per_page=100')) return {
      ...ok(change.catalogDrift ? [] : [{ uuid: TARGET, name: 'axiom-idp-step1-disposable-restore-20261114-704a7351' }]),
      result_info: { total_count: change.catalogDrift ? 0 : 1 } };
    if (path.endsWith('/workers/scripts')) return ok(change.consumer ? [{ id: 'unrelated-worker' }] : []);
    if (path.includes('/pages/projects')) return { ...ok([]), result_info: { total_count: 0 } };
    if (path.endsWith('/d1/database') && method === 'POST') {
      if (change.ackLost) throw new OAuthTargetStop('PROVIDER_OUTCOME_UNKNOWN');
      return ok({ uuid: fresh, name: NAME });
    }
    if (path.endsWith('/' + fresh)) return ok({ uuid: fresh, name: NAME });
    if (path.endsWith('/' + fresh + '/query')) return ok([{ success: true,
      results: change.nonempty ? [{ name: 'unexpected' }] : [], meta: { changed_db: false, rows_written: 0 } }]);
    assert.fail('Unexpected request');
  };
  return { calls, run: receipt => createTarget({ nativeReceipt: receipt ?? native, api }) };
}
test('a new OAuth target is distinct, empty and admitted only after the actual native witness', async () => {
  assert.equal(nativeAdmission(native), true);
  const s = simulation(), r = await s.run();
  assert.equal(r.status, 'OAUTH_TARGET_CREATED_EMPTY_CONFIRMED'); assert.equal(r.target_uuid, fresh);
  assert.equal(r.existing_idp_recovery_preserved, true); assert.equal(r.production_mutation_routes_available, false);
  assert.equal(s.calls.filter(c => c.method === 'POST' && c.path.endsWith('/d1/database')).length, 1);
});
test('unqualified native cleanup refuses every provider request', async () => {
  const s = simulation(), r = await s.run({ ...native, cleanup_parity_verified: false });
  assert.equal(r.error, 'NATIVE_BATCH_WITNESS_NOT_QUALIFIED'); assert.equal(s.calls.length, 0);
});
for (const change of ['catalogDrift', 'consumer', 'paid']) test(change + ' refuses target creation', async () => {
  const s = simulation({ [change]: true }), r = await s.run();
  assert.equal(r.creation_attempted, false); assert.equal(s.calls.some(c => c.method === 'POST'), false);
});
test('a lost create acknowledgement remains unknown and is never retried', async () => {
  const s = simulation({ ackLost: true }), r = await s.run();
  assert.equal(r.creation_outcome, 'UNKNOWN'); assert.equal(r.target_uuid, null);
  assert.equal(s.calls.filter(c => c.method === 'POST').length, 1);
});
test('nonempty schema after create is not accepted as an empty restore target', async () => {
  const r = await simulation({ nonempty: true }).run();
  assert.equal(r.target_empty_schema_verified, false); assert.equal(r.status, 'OAUTH_TARGET_CREATION_REQUIRES_RECONCILIATION');
});
test('the API capability cannot import, mutate existing databases, rename resources or reach production', () => {
  assert.equal(permitted('POST', PREFIX + '/d1/database', { name: NAME }), true);
  assert.equal(permitted('POST', PREFIX + '/d1/database', { name: 'different' }), false);
  for (const id of [TARGET, PRODUCTION_DATABASE, 'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'])
    assert.equal(permitted('POST', PREFIX + '/d1/database/' + id + '/query', { sql: 'DELETE FROM customers' }), false);
  assert.equal(permitted('POST', PREFIX + '/d1/database/' + fresh + '/import', { action: 'init' }), false);
  assert.equal(permitted('DELETE', PREFIX + '/d1/database/' + fresh), false);
  assert.equal(permitted('POST', '/accounts/93f395f5121954671f92fffa453d6b61/d1/database', { name: NAME }), false);
});
