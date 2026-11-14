import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sealSqlExport } from '../recovery/step1_encrypted_sql_export_transport.mjs';
import { verifyCurrentBackup } from '../recovery/step2_owner_verify_current_backup_20261114.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const key = generateKeyPairSync('x25519');
  const pub = key.publicKey.export({ type: 'spki', format: 'der' });
  const pin = sha(pub), sql = Buffer.from("CREATE TABLE test(v); INSERT INTO test VALUES('SYNTHETIC_ONLY');");
  const env = sealSqlExport({ sql, custodianPublicSpkiDer: pub, trustedCustodianSpkiSha256: pin,
    bookmarkSha256: 'a'.repeat(64), catalogSha256: 'b'.repeat(64), capturedAt: new Date().toISOString() });
  const bytes = Buffer.from(JSON.stringify(env, null, 2) + '\n');
  const receipt = { encrypted_backup_persisted: true, source_sql_sha256: sha(sql), source_sql_bytes: sql.length,
    source_catalog_sha256: env.catalog_sha256, source_export_bookmark_sha256: env.bookmark_sha256,
    recipient_spki_sha256: pin, encrypted_backup_sha256: sha(bytes),
    source_account: env.source_account, source_database: env.source_database };
  const pem = key.privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'synthetic-test-only' });
  return { encryptedBytes: bytes, providerReceipt: receipt, privateKey: { key: pem, passphrase: 'synthetic-test-only' }, expectedOwnerPin: pin };
}
test('actual backup verification decrypts synthetic encrypted PEM and emits hashes only', () => {
  const r = verifyCurrentBackup(fixture());
  assert.equal(r.status, 'OWNER_CURRENT_BACKUP_DECRYPTION_VERIFIED');
  assert.equal(r.decrypted_plaintext_written, false);
  assert.ok(!JSON.stringify(r).includes('SYNTHETIC_ONLY'));
});
test('wrong password and substituted private keys are refused', () => {
  const f = fixture();
  assert.throws(() => verifyCurrentBackup({ ...f, privateKey: { ...f.privateKey, passphrase: 'wrong' } }));
  assert.throws(() => verifyCurrentBackup({ ...f, privateKey: generateKeyPairSync('x25519').privateKey }));
});
test('ciphertext tampering, wrong plaintext hash and missing proof pins are refused', () => {
  const f = fixture();
  assert.throws(() => verifyCurrentBackup({ ...f, encryptedBytes: Buffer.from('{}') }));
  for (const field of ['source_sql_sha256', 'source_catalog_sha256', 'source_export_bookmark_sha256'])
    assert.throws(() => verifyCurrentBackup({ ...f, providerReceipt: { ...f.providerReceipt, [field]: 'c'.repeat(64) } }));
});
test('synthetic key cannot replace the real pinned owner key in the default verification', () => {
  const f = fixture(); delete f.expectedOwnerPin;
  assert.throws(() => verifyCurrentBackup(f));
});
test('cloud invocation refuses without reading a real owner key', () => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../recovery/step2_owner_verify_current_backup_20261114.mjs', import.meta.url))],
    { encoding: 'utf8', input: '{"key_file":"must-never-open","passphrase":"SENTINEL_PASSWORD"}', env: { CI: 'true' } });
  assert.equal(run.status, 2);
  assert.equal(JSON.parse(run.stdout).status, 'OWNER_CURRENT_BACKUP_DECRYPTION_FAILED');
  assert.ok(!run.stdout.includes('SENTINEL_PASSWORD'));
  assert.equal(run.stderr, '');
});
