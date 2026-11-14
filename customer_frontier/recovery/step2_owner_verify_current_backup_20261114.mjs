/** Offline owner-PC verification of the actual sealed backup. No network or SQL writes. */
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openSqlExport } from './step1_encrypted_sql_export_transport.mjs';

export const OWNER_PIN = '704a7351da66a21e0b35df4880df194f1cf0e17b161246671288141beae7262c';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const HEX = /^[0-9a-f]{64}$/;

export function verifyCurrentBackup({ encryptedBytes, providerReceipt, privateKey, expectedOwnerPin = OWNER_PIN }) {
  const r = providerReceipt;
  if (!Buffer.isBuffer(encryptedBytes) || encryptedBytes.length > 11_000_000 || !r || r.encrypted_backup_persisted !== true ||
      r.source_account !== '93f395f5121954671f92fffa453d6b61' || r.source_database !== 'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f' ||
      !Number.isSafeInteger(r.source_sql_bytes) || r.source_sql_bytes <= 0 || r.source_sql_bytes > 8_000_000 ||
      !HEX.test(r.source_sql_sha256) || !HEX.test(r.source_catalog_sha256) ||
      !HEX.test(r.source_export_bookmark_sha256) || r.recipient_spki_sha256 !== expectedOwnerPin ||
      sha(encryptedBytes) !== r.encrypted_backup_sha256) throw new Error('BACKUP_OR_RECEIPT_PIN_MISMATCH');
  const envelope = JSON.parse(encryptedBytes);
  const sql = openSqlExport({ envelope, custodianPrivateKey: privateKey,
    expectedCustodianSpkiSha256: expectedOwnerPin,
    expectedBookmarkSha256: r.source_export_bookmark_sha256,
    expectedCatalogSha256: r.source_catalog_sha256 });
  try {
    if (sha(sql) !== r.source_sql_sha256 || sql.length !== r.source_sql_bytes) throw new Error('DECRYPTED_SQL_MISMATCH');
    return { schema: 'musitu.axiom.owner-current-backup-decryption-proof.v1',
      observed_at_utc: new Date().toISOString(), source_account: r.source_account,
      source_database: r.source_database, recipient_spki_sha256: expectedOwnerPin,
      encrypted_backup_sha256: r.encrypted_backup_sha256, source_sql_sha256: sha(sql),
      sql_bytes: sql.length, authenticated_decryption_verified: true,
      decrypted_plaintext_written: false, provider_operations: 0,
      hosted_parity_is_separate_evidence: true, release_status: 'NOT_RELEASE',
      status: 'OWNER_CURRENT_BACKUP_DECRYPTION_VERIFIED' };
  } finally { sql.fill(0); }
}

async function main() {
  if (process.platform !== 'win32' || process.env.CI || process.env.GITHUB_ACTIONS)
    throw new Error('INTERACTIVE_OWNER_WINDOWS_PC_REQUIRED');
  let raw = ''; for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > 16000) throw new Error('INPUT_OVER_BUDGET');
  }
  const input = JSON.parse(raw);
  if (!input || typeof input.key_file !== 'string' || typeof input.passphrase !== 'string' || !input.passphrase)
    throw new Error('OWNER_KEY_INPUT_UNAVAILABLE');
  const info = lstatSync(input.key_file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 12000 || info.size < 100)
    throw new Error('ENCRYPTED_OWNER_KEY_FILE_REQUIRED');
  const pem = readFileSync(input.key_file);
  try {
    if (!pem.subarray(0, 50).toString('ascii').startsWith('-----BEGIN ENCRYPTED PRIVATE KEY-----'))
      throw new Error('ENCRYPTED_PKCS8_REQUIRED');
    const receipt = JSON.parse(readFileSync(new URL('./hosted_restore_parity_20261114.json', import.meta.url)));
    const encryptedBytes = readFileSync(new URL('./owner_encrypted_current_d1_20261114.json', import.meta.url));
    const proof = verifyCurrentBackup({ encryptedBytes, providerReceipt: receipt,
      privateKey: { key: pem, format: 'pem', passphrase: input.passphrase } });
    delete input.passphrase;
    console.log(JSON.stringify(proof, null, 2));
  } finally { pem.fill(0); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch { console.log('{"status":"OWNER_CURRENT_BACKUP_DECRYPTION_FAILED","release_status":"NOT_RELEASE"}'); process.exitCode = 2; }
}
