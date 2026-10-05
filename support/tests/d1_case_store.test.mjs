import assert from 'node:assert/strict';
import test from 'node:test';
import {createCaseRecord} from '../control_plane.js';
import {importSupportDataKey} from '../crypto_envelope.js';
import {D1CaseStore} from '../d1_case_store.js';

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() { return this.db.row; }
}

class FakeD1 {
  constructor() { this.statements = []; this.row = null; }
  prepare(sql) { const statement = new Statement(this, sql); this.statements.push(statement); return statement; }
  async batch(statements) {
    const insert = statements.find(statement => /INSERT INTO support_cases/.test(statement.sql));
    this.row = {public_json: insert.args[9], encrypted_payload: insert.args[10], recovery_hash: insert.args[8]};
    return statements.map(() => ({success: true}));
  }
}

test('D1 adapter persists encrypted narrative and authorizes with hash-only recovery lookup', async () => {
  const description = 'private narrative that must not appear in a D1 bind outside ciphertext';
  const bundle = await createCaseRecord({
    surface: 'api_runtime', category: 'bug', affected_scope: 'self', summary: 'Runtime returned a bounded error',
    description, reproduction: 'Send the sanitized request.', impact: 'One workflow is blocked.', evidence_refs: [], consent_to_process: true,
  }, {at: '2026-10-05T12:00:00Z', caseId: 'AX-0123456789AB', recoveryCode: '01234567-89ABCDEF-GHJKMNPQ'});
  const key = await importSupportDataKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'));
  const db = new FakeD1();
  const store = new D1CaseStore({database: db, encryptionKey: key});
  const publicView = await store.create(bundle);
  assert.equal(publicView.case_id, bundle.case_record.case_id);
  assert.doesNotMatch(JSON.stringify(db.statements.map(item => item.args)), new RegExp(description));
  const wrong = await store.getAuthorized(bundle.case_record.case_id, 'ABCDEFGH-JKLMNPQR-STUVWXYZ');
  assert.equal(wrong, null);
  const authorized = await store.getAuthorized(bundle.case_record.case_id, bundle.recovery_code);
  assert.equal(authorized.details.description, description);
  assert.equal('recovery_hash' in authorized.case, false);
});
