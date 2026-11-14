import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, permitted, ACCOUNT, SOURCE_ACCOUNT, SOURCE_DATABASE, RETIRED_DATABASE,
  NAME, PREFIX, CATALOG_SQL, RecoveryStop } from '../recovery/step2_create_restore_target_20261114.mjs';

const ID = '12345678-1234-4234-8234-123456789abc';
const token = 'synthetic-target-token';
const reply = result => ({ success: true, result });
function scenario(overrides = {}) {
  const calls = [], saves = [];
  const responses = {
    [PREFIX]: reply({ id: ACCOUNT }),
    [PREFIX + '/subscriptions']: reply([]),
    [PREFIX + '/d1/database?page=1&per_page=100']: {
      ...reply([]), result_info: { page: 1, per_page: 100, count: 0, total_count: 0 },
    },
    [PREFIX + '/workers/scripts']: reply([]),
    [PREFIX + '/pages/projects?page=1&per_page=10']: {
      ...reply([]), result_info: { page: 1, per_page: 10, count: 0, total_count: 0 },
    },
    [PREFIX + '/d1/database']: reply({ name: NAME, uuid: ID }),
    [PREFIX + '/d1/database/' + ID]: reply({ name: NAME, uuid: ID }),
    [PREFIX + '/d1/database/' + ID + '/query']: reply([
      { success: true, results: [], meta: { rows_written: 0, changed_db: false } },
    ]),
    ...overrides,
  };
  const request = async (credential, method, path, body) => {
    assert.equal(credential, token);
    assert.ok(permitted(method, path, body));
    assert.ok(!path.includes(SOURCE_ACCOUNT));
    calls.push({ method, path, body });
    assert.ok(Object.hasOwn(responses, path), path);
    const value = responses[path];
    if (value instanceof Error) throw value;
    return structuredClone(value);
  };
  const save = value => saves.push(structuredClone(value));
  return { calls, saves, run: () => bootstrap({ token, request, save }) };
}
const creates = state => state.calls.filter(x => x.method === 'POST' && x.path.endsWith('/d1/database'));

test('creates once only after complete target preflight and verifies actual empty schema', async () => {
  const s = scenario(), r = await s.run();
  assert.equal(r.status, 'TARGET_CREATED_EMPTY_CONFIRMED');
  assert.equal(r.target_uuid, ID);
  assert.equal(creates(s).length, 1);
  assert.equal(r.hosted_restore_completed, false);
  assert.equal(r.backup_export_completed, false);
  assert.equal(r.release_status, 'NOT_RELEASE');
  assert.ok(s.saves.some(r => r.creation_attempted && r.creation_outcome === 'UNKNOWN' && !r.target_uuid));
});
for (const [name, path, value] of [
  ['wrong account identity', PREFIX, reply({ id: SOURCE_ACCOUNT })],
  ['paid subscription', PREFIX + '/subscriptions', reply([{ state: 'Paid' }])],
  ['incomplete D1 pagination', PREFIX + '/d1/database?page=1&per_page=100', {
    ...reply([]), result_info: { page: 1, per_page: 100, count: 0, total_count: 1 },
  }],
  ['existing D1', PREFIX + '/d1/database?page=1&per_page=100', {
    ...reply([{ name: NAME, uuid: ID }]), result_info: { page: 1, per_page: 100, count: 1, total_count: 1 },
  }],
  ['existing Worker', PREFIX + '/workers/scripts', reply([{ id: 'existing' }])],
  ['contradictory Pages pagination', PREFIX + '/pages/projects?page=1&per_page=10', {
    ...reply([]), result_info: { page: 1, per_page: 10, count: 0, total_count: 1 },
  }],
  ['missing Pages pagination', PREFIX + '/pages/projects?page=1&per_page=10', reply([])],
]) {
  test(name + ' blocks all creation', async () => {
    const s = scenario({ [path]: value }), r = await s.run();
    assert.equal(r.creation_attempted, false);
    assert.equal(creates(s).length, 0);
    assert.equal(r.status, 'TARGET_PREFLIGHT_STOPPED');
  });
}
test('missing token fails without sending a request', async () => {
  let calls = 0;
  const r = await bootstrap({ token: '', request: () => { calls++; } });
  assert.equal(calls, 0);
  assert.equal(r.error, 'RECOVERY_TOKEN_MISSING');
});
test('lost CREATE acknowledgement remains UNKNOWN with no retry', async () => {
  const s = scenario({ [PREFIX + '/d1/database']: new RecoveryStop('PROVIDER_REPLY_UNAVAILABLE') });
  const r = await s.run();
  assert.equal(creates(s).length, 1);
  assert.equal(r.creation_outcome, 'UNKNOWN');
  assert.equal(r.target_uuid, null);
  assert.equal(r.hosted_restore_completed, false);
});
for (const invalid of [SOURCE_DATABASE, RETIRED_DATABASE, 'broken']) {
  test('refuses returned unsafe UUID ' + invalid, async () => {
    const s = scenario({ [PREFIX + '/d1/database']: reply({ name: NAME, uuid: invalid }) });
    const r = await s.run();
    assert.equal(r.creation_outcome, 'UNKNOWN');
    assert.equal(r.target_uuid, null);
    assert.ok(!s.calls.some(x => x.path.endsWith('/query')));
  });
}
test('lost metadata readback preserves the created UUID and stops', async () => {
  const s = scenario({ [PREFIX + '/d1/database/' + ID]: new RecoveryStop('PROVIDER_REPLY_UNAVAILABLE') });
  const r = await s.run();
  assert.equal(r.creation_outcome, 'CREATED');
  assert.equal(r.target_uuid, ID);
  assert.equal(r.target_empty_schema_verified, false);
});
test('a preexisting user schema is never relabelled empty', async () => {
  const s = scenario({ [PREFIX + '/d1/database/' + ID + '/query']: reply([
    { success: true, results: [{ type: 'table', name: 'customer' }], meta: { rows_written: 0, changed_db: false } },
  ]) });
  assert.equal((await s.run()).target_empty_schema_verified, false);
});
test('provider mutation flag prevents empty-schema acceptance', async () => {
  const s = scenario({ [PREFIX + '/d1/database/' + ID + '/query']: reply([
    { success: true, results: [], meta: { rows_written: 0, changed_db: true } },
  ]) });
  assert.equal((await s.run()).target_empty_schema_verified, false);
});
test('unexpected exception text is redacted', async () => {
  const s = scenario({ [PREFIX + '/workers/scripts']: new Error('PRIVATE_TOKEN_OR_CUSTOMER_TEXT') });
  const r = await s.run();
  assert.ok(!JSON.stringify(r).includes('PRIVATE_TOKEN'));
  assert.equal(r.error, 'UNEXPECTED_LOCAL_FAILURE');
});
test('request allowlist rejects source, deletion, import and alternate SQL', () => {
  for (const [method,path,body] of [
    ['DELETE', PREFIX + '/d1/database/' + ID],
    ['POST', PREFIX + '/d1/database/' + ID + '/import', {}],
    ['POST', PREFIX + '/d1/database/' + ID + '/query', { sql: 'DROP TABLE customer' }],
    ['GET', '/accounts/' + SOURCE_ACCOUNT + '/d1/database/' + SOURCE_DATABASE],
    ['GET', PREFIX + '/d1/database/' + SOURCE_DATABASE],
    ['POST', PREFIX + '/d1/database', { name: 'wrong' }],
  ]) assert.equal(permitted(method,path,body), false);
  assert.equal(permitted('POST', PREFIX + '/d1/database/' + ID + '/query', { sql: CATALOG_SQL }), true);
});
