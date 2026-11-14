/** Offline owner-PC verification of the actual sealed backup. No network or SQL writes. */
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openSqlExport } from './step1_encrypted_sql_export_transport.mjs';

export const OWNER_PIN = '704a7351da66a21e0b35df4880df194f1cf0e17b161246671288141beae7262c';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const HEX = /^[0-9a-f]{64}$/;
let failureStage = 'DEVICE_CHECK';

export function safeFailure(error, stage = 'LOCAL_VERIFIER') {
  const known = new Set(['INTERACTIVE_OWNER_WINDOWS_PC_REQUIRED', 'INPUT_OVER_BUDGET', 'INPUT_JSON_INVALID',
    'OWNER_KEY_INPUT_UNAVAILABLE', 'ENCRYPTED_OWNER_KEY_FILE_REQUIRED', 'ENCRYPTED_PKCS8_REQUIRED',
    'BACKUP_OR_RECEIPT_PIN_MISMATCH', 'DECRYPTED_SQL_MISMATCH', 'INCORRECT_CUSTODIAN_PRIVATE_KEY',
    'CUSTODIAN_PRIVATE_KEY_NOT_X25519', 'CIPHERTEXT_OR_METADATA_NOT_AUTHENTIC']);
  let code = known.has(error?.message) ? error.message : 'LOCAL_VERIFIER_FAILED';
  if (['ERR_OSSL_BAD_DECRYPT', 'ERR_OSSL_EVP_BAD_DECRYPT', 'ERR_OSSL_UNSUPPORTED',
    'ERR_OSSL_PKCS12_CIPHERFINAL_ERROR'].includes(error?.code)) code = 'KEY_PASSPHRASE_OR_FORMAT_REJECTED';
  if (['ENOENT', 'EACCES', 'EPERM'].includes(error?.code))
    code = stage === 'KEY_FILE_CHECK' ? 'KEY_FILE_NOT_READABLE' : 'PACKET_FILE_NOT_READABLE';
  const safeStage = ['DEVICE_CHECK', 'INPUT', 'KEY_FILE_CHECK', 'PACKET_READ', 'AUTHENTICATED_DECRYPTION'].includes(stage)
    ? stage : 'LOCAL_VERIFIER';
  return { status: 'OWNER_CURRENT_BACKUP_DECRYPTION_FAILED', error_code: code, stage: safeStage, release_status: 'NOT_RELEASE' };
}

export async function readOwnerInput(stream) {
  const chunks = []; let count = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    count += bytes.length;
    if (count > 16000) throw new Error('INPUT_OVER_BUDGET');
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks);
  try {
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new Error('INPUT_JSON_INVALID'); }
  } finally { bytes.fill(0); }
}

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
  failureStage = 'INPUT';
  const input = await readOwnerInput(process.stdin);
  if (!input || typeof input.key_file !== 'string' || typeof input.passphrase !== 'string' || !input.passphrase)
    throw new Error('OWNER_KEY_INPUT_UNAVAILABLE');
  failureStage = 'KEY_FILE_CHECK';
  const info = lstatSync(input.key_file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 12000 || info.size < 100)
    throw new Error('ENCRYPTED_OWNER_KEY_FILE_REQUIRED');
  const pem = readFileSync(input.key_file);
  try {
    if (!pem.subarray(0, 50).toString('ascii').startsWith('-----BEGIN ENCRYPTED PRIVATE KEY-----'))
      throw new Error('ENCRYPTED_PKCS8_REQUIRED');
    failureStage = 'PACKET_READ';
    const receipt = JSON.parse(readFileSync(new URL('./hosted_restore_parity_20261114.json', import.meta.url)));
    const encryptedBytes = readFileSync(new URL('./owner_encrypted_current_d1_20261114.json', import.meta.url));
    failureStage = 'AUTHENTICATED_DECRYPTION';
    const proof = verifyCurrentBackup({ encryptedBytes, providerReceipt: receipt,
      privateKey: { key: pem, format: 'pem', passphrase: input.passphrase } });
    delete input.passphrase;
    console.log(JSON.stringify(proof, null, 2));
  } finally { pem.fill(0); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch (error) { console.log(JSON.stringify(safeFailure(error, failureStage))); process.exitCode = 2; }
}
