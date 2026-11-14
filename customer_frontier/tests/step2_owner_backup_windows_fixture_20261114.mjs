/** Synthetic Windows pipe integration fixture. Never uses the owner's key. */
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sealSqlExport } from '../recovery/step1_encrypted_sql_export_transport.mjs';
import { verifyCurrentBackup, readOwnerInput, safeFailure } from '../recovery/step2_owner_verify_current_backup_20261114.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const [action, folder] = process.argv.slice(2);

if (action === 'prepare') {
  const key = generateKeyPairSync('x25519'), pub = key.publicKey.export({ format: 'der', type: 'spki' });
  const sql = Buffer.from("CREATE TABLE synthetic_only(v); INSERT INTO synthetic_only VALUES('SYNTHETIC_DATA_ONLY');");
  const pin = sha(pub), passphrase = 'Synthetic only \u00e9\u4e2d\u6587\ud83d\udd10';
  const envelope = sealSqlExport({ sql, custodianPublicSpkiDer: pub, trustedCustodianSpkiSha256: pin,
    bookmarkSha256: 'a'.repeat(64), catalogSha256: 'b'.repeat(64), capturedAt: new Date().toISOString() });
  const encrypted = Buffer.from(JSON.stringify(envelope, null, 2) + '\n');
  const receipt = { source_account: envelope.source_account, source_database: envelope.source_database,
    encrypted_backup_persisted: true, source_sql_sha256: sha(sql), source_sql_bytes: sql.length,
    source_catalog_sha256: envelope.catalog_sha256, source_export_bookmark_sha256: envelope.bookmark_sha256,
    recipient_spki_sha256: pin, encrypted_backup_sha256: sha(encrypted) };
  const keyFile = join(folder, 'synthetic encrypted owner key.pem');
  writeFileSync(keyFile, key.privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }), { flag: 'wx', mode: 0o600 });
  writeFileSync(join(folder, 'synthetic-envelope.json'), encrypted, { flag: 'wx' });
  writeFileSync(join(folder, 'synthetic-fixture.json'), JSON.stringify({ receipt, pin, key_file: keyFile, passphrase }), { flag: 'wx' });
  console.log('SYNTHETIC_FIXTURE_PREPARED');
} else if (action === 'verify') {
  try {
    const input = await readOwnerInput(process.stdin);
    const fixture = JSON.parse(readFileSync(new URL('./synthetic-fixture.json', import.meta.url)));
    const proof = verifyCurrentBackup({ encryptedBytes: readFileSync(new URL('./synthetic-envelope.json', import.meta.url)),
      providerReceipt: fixture.receipt, expectedOwnerPin: fixture.pin,
      privateKey: { key: readFileSync(input.key_file), passphrase: input.passphrase } });
    console.log(JSON.stringify(proof));
  } catch (error) { console.log(JSON.stringify(safeFailure(error, 'AUTHENTICATED_DECRYPTION'))); process.exitCode = 2; }
} else throw new Error('SYNTHETIC_TEST_MODE_REQUIRED');
