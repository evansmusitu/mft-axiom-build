/** Owner-authorized current export, isolated restore, parity and target rollback.
 * Plaintext SQL and signed URLs are never written to disk or logged.
 */
import { createHash, createPublicKey } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ACCOUNT, SOURCE_ACCOUNT, SOURCE_DATABASE, NAME, RECIPIENT_BASE64,
  RECIPIENT_SHA256, CATALOG_SQL, targetD1Plan, RecoveryStop } from './step2_create_restore_target_20261114.mjs';
import { sealSqlExport } from './step1_encrypted_sql_export_transport.mjs';

export const TARGET = 'be760b23-2ed1-47aa-92aa-9042ce917bb9';
export const SOURCE_BASE = `/accounts/${SOURCE_ACCOUNT}/d1/database/${SOURCE_DATABASE}`;
export const TARGET_BASE = `/accounts/${ACCOUNT}/d1/database/${TARGET}`;
export const ACCOUNT_BASE = '/accounts/' + ACCOUNT;
export const MARKER_SQL = "CREATE TABLE axiom_recovery_probe_20261114 (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO axiom_recovery_probe_20261114(id,value) VALUES(1,'rollback-704a7351');";
export const MARKER_COUNT_SQL = "SELECT count(*) AS marker_count FROM sqlite_schema WHERE name='axiom_recovery_probe_20261114'";
export const RECEIPT_FILE = 'hosted_restore_parity_20261114.json';
export const ENVELOPE_FILE = 'owner_encrypted_current_d1_20261114.json';
const MAX_SQL = 8_000_000;
const BOOKMARK = /^[A-Za-z0-9-]{16,256}$/;
const HEX = /^[0-9a-f]{64}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
export class RestoreStop extends Error {
  constructor(code) { super(code); this.code = code; }
}
const check = (condition, code) => { if (!condition) throw new RestoreStop(code); };
function result(doc) {
  check(doc && !Array.isArray(doc) && doc.success === true, 'PROVIDER_ENVELOPE_INVALID');
  return doc.result;
}
function marker(value) { check(typeof value === 'string' && BOOKMARK.test(value), 'BOOKMARK_FORMAT_INVALID'); return value; }
function exactKeys(object, keys) { return object && Object.keys(object).sort().join('|') === keys.slice().sort().join('|'); }
function exportBody(body) {
  return body?.output_format === 'polling' &&
    (exactKeys(body, ['output_format']) || exactKeys(body, ['output_format', 'current_bookmark']) && BOOKMARK.test(body.current_bookmark));
}
function importBody(body) {
  if (body?.action === 'init') return exactKeys(body, ['action', 'etag']) && /^[0-9a-f]{32}$/.test(body.etag);
  if (body?.action === 'ingest') return exactKeys(body, ['action', 'etag', 'filename']) &&
    /^[0-9a-f]{32}$/.test(body.etag) && typeof body.filename === 'string' &&
    /^[A-Za-z0-9_./-]{1,256}$/.test(body.filename) && !body.filename.includes('..');
  return body?.action === 'poll' && exactKeys(body, ['action', 'current_bookmark']) && BOOKMARK.test(body.current_bookmark);
}

/** Account-role separation is enforced before any HTTP request. */
export function permitted(role, method, path, body) {
  if (role === 'source') {
    if (method === 'GET') return body === undefined && [SOURCE_BASE, SOURCE_BASE + '/time_travel/bookmark'].includes(path);
    if (method !== 'POST') return false;
    if (path === SOURCE_BASE + '/query') return exactKeys(body, ['sql']) && body.sql === CATALOG_SQL;
    return path === SOURCE_BASE + '/export' && exportBody(body);
  }
  if (role !== 'target') return false;
  if (method === 'GET') return body === undefined && [ACCOUNT_BASE, ACCOUNT_BASE + '/subscriptions',
    ACCOUNT_BASE + '/d1/database?page=1&per_page=100', ACCOUNT_BASE + '/workers/scripts',
    ACCOUNT_BASE + '/pages/projects?page=1&per_page=10', TARGET_BASE, TARGET_BASE + '/time_travel/bookmark'].includes(path);
  if (method !== 'POST') return false;
  if (path === TARGET_BASE + '/query') return exactKeys(body, ['sql']) && [CATALOG_SQL, MARKER_SQL, MARKER_COUNT_SQL].includes(body.sql);
  if (path === TARGET_BASE + '/export') return exportBody(body);
  if (path === TARGET_BASE + '/import') return importBody(body);
  const prefix = TARGET_BASE + '/time_travel/restore?bookmark=';
  return body === undefined && path.startsWith(prefix) && BOOKMARK.test(path.slice(prefix.length));
}

export function signedStorageUrl(value) {
  check(typeof value === 'string' && value.length <= 8192, 'SIGNED_STORAGE_URL_INVALID');
  let url;
  try { url = new URL(value); } catch { throw new RestoreStop('SIGNED_STORAGE_URL_INVALID'); }
  check(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
    /^[a-z0-9.-]+\.r2\.cloudflarestorage\.com$/.test(url.hostname), 'SIGNED_STORAGE_HOST_UNQUALIFIED');
  return url;
}
async function boundedBytes(response, limit) {
  check(response.ok, 'PROVIDER_HTTP_' + response.status);
  const chunks = []; let count = 0;
  for await (const value of response.body) {
    count += value.length;
    check(count <= limit, 'PROVIDER_RESPONSE_OVER_BUDGET');
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export function provider(tokens) {
  return async (role, method, path, body) => {
    check(permitted(role, method, path, body), 'REQUEST_OUTSIDE_REVIEWED_SCOPE');
    const token = tokens[role];
    check(typeof token === 'string' && token.length > 5 && !/[\r\n]/.test(token), 'CREDENTIAL_UNAVAILABLE');
    try {
      const raw = await boundedBytes(await fetch('https://api.cloudflare.com/client/v4' + path, {
        method, redirect: 'manual', signal: AbortSignal.timeout(25_000),
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }), 500_000);
      let doc;
      try { doc = JSON.parse(raw); } catch { throw new RestoreStop('PROVIDER_JSON_INVALID'); }
      result(doc);
      return doc;
    } catch (error) {
      if (error instanceof RestoreStop) throw error;
      throw new RestoreStop('PROVIDER_TRANSPORT_OUTCOME_UNKNOWN');
    }
  };
}
export async function storage(method, url, bytes) {
  const checked = signedStorageUrl(url);
  check(method === 'GET' && bytes === undefined || method === 'PUT' && Buffer.isBuffer(bytes) && bytes.length <= MAX_SQL,
    'SIGNED_STORAGE_OPERATION_UNQUALIFIED');
  try {
    // A presigned URL authenticates itself. API bearer tokens never reach storage.
    const response = await fetch(checked, { method, redirect: 'manual', signal: AbortSignal.timeout(30_000),
      ...(bytes ? { body: bytes } : {}) });
    return await boundedBytes(response, method === 'GET' ? MAX_SQL : 1000);
  } catch (error) {
    if (error instanceof RestoreStop) throw error;
    throw new RestoreStop('STORAGE_TRANSPORT_OUTCOME_UNKNOWN');
  }
}

export function fingerprint(sql) {
  check(Buffer.isBuffer(sql) && sql.length > 0 && sql.length <= MAX_SQL, 'SQL_SIZE_UNQUALIFIED');
  const run = spawnSync('python3', [fileURLToPath(new URL('./step2_sql_memory_fingerprint_20261114.py', import.meta.url))],
    { input: sql, encoding: 'utf8', maxBuffer: 200_000, timeout: 16_000, env: {} });
  let doc;
  try { doc = JSON.parse(run.stdout); } catch { throw new RestoreStop('SQL_MEMORY_REPLAY_FAILED'); }
  if (run.status !== 0) {
    const errors = ['AUTHORIZER_DENIAL', 'MISSING_FUNCTION', 'MISSING_TABLE', 'FOREIGN_KEY', 'SYNTAX',
      'DUPLICATE_OBJECT', 'TRANSACTION', 'CONSTRAINT', 'INTEGRITY', 'DEADLINE', 'OTHER'];
    throw new RestoreStop(errors.some(value => doc.error === 'SQL_MEMORY_REPLAY_FAILED_' + value) ? doc.error : 'SQL_MEMORY_REPLAY_FAILED');
  }
  check(HEX.test(doc.catalog_sha256) && HEX.test(doc.user_data_sha256) && Array.isArray(doc.tables) &&
    doc.integrity_check === true && doc.foreign_key_check === true, 'SQL_FINGERPRINT_INVALID');
  return doc;
}
function catalogRows(doc) {
  const rows = result(doc);
  check(Array.isArray(rows) && rows.length === 1 && rows[0].success === true && rows[0].meta?.changed_db === false &&
    rows[0].meta?.rows_written === 0 && Array.isArray(rows[0].results) && rows[0].results.length <= 500,
  'READONLY_CATALOG_QUERY_UNQUALIFIED');
  for (const row of rows[0].results) check(['table', 'index', 'trigger', 'view'].includes(row.type) &&
    typeof row.name === 'string' && typeof row.sql === 'string', 'CATALOG_ROW_UNQUALIFIED');
  return rows[0].results;
}
export const catalogHash = rows => sha(JSON.stringify(rows.map(row => [row.type, sha(row.name), sha(row.sql)])));
const same = (a, b) => a.catalog_sha256 === b.catalog_sha256 && a.user_data_sha256 === b.user_data_sha256 &&
  JSON.stringify(a.tables) === JSON.stringify(b.tables);

async function exportCurrent(call, role, base, transfer, pause) {
  let body = { output_format: 'polling' }; let exportBookmark;
  for (let i = 0; i < 45; i++) {
    const job = result(await call(role, 'POST', base + '/export', body));
    check(job && job.success !== false && job.status !== 'error', 'EXPORT_PROVIDER_FAILED');
    if (job.at_bookmark) {
      const current = marker(job.at_bookmark);
      check(!exportBookmark || current === exportBookmark, 'EXPORT_BOOKMARK_DRIFT');
      exportBookmark = current;
    }
    if (job.status === 'complete') {
      check(exportBookmark && typeof job.result?.signed_url === 'string', 'EXPORT_RESULT_INCOMPLETE');
      const sql = await transfer('GET', job.result.signed_url);
      check(Buffer.isBuffer(sql) && sql.length > 0 && sql.length <= MAX_SQL, 'EXPORT_SQL_SIZE_INVALID');
      return { sql, bookmark: exportBookmark };
    }
    check(exportBookmark, 'EXPORT_POLL_BOOKMARK_UNAVAILABLE');
    body = { output_format: 'polling', current_bookmark: exportBookmark };
    await pause(1000);
  }
  throw new RestoreStop('EXPORT_POLL_LIMIT');
}
function saveFile(file, object) {
  const bytes = Buffer.from(JSON.stringify(object, null, 2) + '\n');
  writeFileSync(file, bytes, { mode: 0o600 });
  writeFileSync(file + '.sha256', sha(bytes) + '  ' + file + '\n', { mode: 0o600 });
  return sha(bytes);
}

export async function recover({ sourceToken, targetToken, call, transfer = storage, inspect = fingerprint,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), persist = saveFile } = {}) {
  const r = { schema: 'musitu.axiom.hosted-restore-parity.v1', observed_at_utc: new Date().toISOString(),
    source_account: SOURCE_ACCOUNT, source_database: SOURCE_DATABASE, target_account: ACCOUNT,
    target_database: TARGET, target_name: NAME, recipient_spki_sha256: RECIPIENT_SHA256,
    source_mutation_routes_available: false, production_oauth_migrated: false,
    encrypted_backup_persisted: false, encrypted_backup_owner_decryption_verified: false,
    target_import_attempted: false, target_import_outcome: 'UNATTEMPTED',
    hosted_schema_and_data_parity: false, rollback_attempted: false, rollback_outcome: 'UNATTEMPTED',
    source_data_unchanged: false, release_status: 'NOT_RELEASE', status: 'PREFLIGHT_PENDING' };
  const save = () => persist(RECEIPT_FILE, r);
  const request = call ?? provider({ source: sourceToken, target: targetToken });
  const query = (role, base, sql) => request(role, 'POST', base + '/query', { sql });
  const exportedBuffers = [];
  save();
  try {
    check(call || [sourceToken, targetToken].every(token => typeof token === 'string' && token.length > 5 && !/[\r\n]/.test(token)),
      'RECOVERY_CREDENTIALS_MISSING');
    const key = Buffer.from(RECIPIENT_BASE64, 'base64');
    check(sha(key) === RECIPIENT_SHA256 && createPublicKey({ key, type: 'spki', format: 'der' }).asymmetricKeyType === 'x25519',
      'OWNER_PUBLIC_KEY_PIN_MISMATCH');
    const account = result(await request('target', 'GET', ACCOUNT_BASE));
    check(account?.id === ACCOUNT, 'TARGET_ACCOUNT_DRIFT');
    Object.assign(r, targetD1Plan(await request('target', 'GET', ACCOUNT_BASE + '/subscriptions')));
    const catalogReply = await request('target', 'GET', ACCOUNT_BASE + '/d1/database?page=1&per_page=100');
    const databases = result(catalogReply), info = catalogReply.result_info;
    check(Array.isArray(databases) && databases.length === 1 && databases[0].uuid === TARGET && databases[0].name === NAME &&
      info?.page === 1 && info.per_page === 100 && info.total_count === 1 && info.count === 1, 'TARGET_DATABASE_CATALOG_DRIFT');
    const workers = result(await request('target', 'GET', ACCOUNT_BASE + '/workers/scripts'));
    check(Array.isArray(workers) && workers.length === 0, 'TARGET_HAS_WORKER_BINDINGS');
    const pagesReply = await request('target', 'GET', ACCOUNT_BASE + '/pages/projects?page=1&per_page=10');
    check(Array.isArray(result(pagesReply)) && pagesReply.result.length === 0 && pagesReply.result_info?.total_count === 0 &&
      pagesReply.result_info.count === 0, 'TARGET_HAS_PAGE_BINDINGS');
    const detail = result(await request('target', 'GET', TARGET_BASE));
    check(detail?.uuid === TARGET && detail.name === NAME, 'TARGET_IDENTITY_DRIFT');
    check(catalogRows(await query('target', TARGET_BASE, CATALOG_SQL)).length === 0, 'TARGET_IS_NOT_EMPTY');
    const sourceDetail = result(await request('source', 'GET', SOURCE_BASE));
    check(sourceDetail?.uuid === SOURCE_DATABASE && Number.isSafeInteger(sourceDetail.file_size) &&
      sourceDetail.file_size > 0 && sourceDetail.file_size <= MAX_SQL, 'SOURCE_IDENTITY_OR_SIZE_UNQUALIFIED');
    r.source_database_bytes = sourceDetail.file_size;
    const sourceCatalog = catalogRows(await query('source', SOURCE_BASE, CATALOG_SQL));
    check(sourceCatalog.length > 0, 'SOURCE_CATALOG_EMPTY');
    r.source_catalog_sha256 = catalogHash(sourceCatalog);
    r.preflight_verified = true; r.status = 'EXPORTING_CURRENT_SOURCE'; save();
    const original = await exportCurrent(request, 'source', SOURCE_BASE, transfer, pause);
    exportedBuffers.push(original.sql);
    r.source_export_bookmark_sha256 = sha(original.bookmark);
    r.source_sql_sha256 = sha(original.sql);
    r.source_sql_bytes = original.sql.length;
    const sealed = sealSqlExport({ sql: original.sql, custodianPublicSpkiDer: key,
      trustedCustodianSpkiSha256: RECIPIENT_SHA256, bookmarkSha256: r.source_export_bookmark_sha256,
      catalogSha256: r.source_catalog_sha256, capturedAt: new Date().toISOString() });
    r.encrypted_backup_sha256 = persist(ENVELOPE_FILE, sealed);
    check(HEX.test(r.encrypted_backup_sha256), 'ENCRYPTED_BACKUP_PERSISTENCE_UNCONFIRMED');
    r.encrypted_backup_persisted = true; save();
    const baseline = inspect(original.sql);
    check(baseline.catalog_sha256 === r.source_catalog_sha256, 'CURRENT_SQL_CATALOG_PARITY_FAILED');
    r.baseline = baseline;
    // Recheck immediately before admission. The driver never appends to an existing target.
    check(catalogRows(await query('target', TARGET_BASE, CATALOG_SQL)).length === 0, 'TARGET_CHANGED_BEFORE_IMPORT');
    const etag = createHash('md5').update(original.sql).digest('hex');
    const init = result(await request('target', 'POST', TARGET_BASE + '/import', { action: 'init', etag }));
    check(typeof init?.filename === 'string' && importBody({ action: 'ingest', etag, filename: init.filename }), 'IMPORT_INIT_INVALID');
    if (init.upload_url) await transfer('PUT', init.upload_url, original.sql);
    r.target_import_attempted = true; r.target_import_outcome = 'UNKNOWN'; r.status = 'TARGET_IMPORTING'; save();
    let job = result(await request('target', 'POST', TARGET_BASE + '/import', { action: 'ingest', etag, filename: init.filename }));
    for (let i = 0; i < 45 && job?.status !== 'complete'; i++) {
      check(job && job.success !== false && job.status !== 'error', 'TARGET_IMPORT_PROVIDER_FAILED');
      await pause(1000);
      job = result(await request('target', 'POST', TARGET_BASE + '/import', { action: 'poll', current_bookmark: marker(job.at_bookmark) }));
    }
    check(job?.status === 'complete' && job.success !== false && !job.error, 'TARGET_IMPORT_UNCONFIRMED');
    r.target_import_outcome = 'COMPLETE'; save();
    const restored = await exportCurrent(request, 'target', TARGET_BASE, transfer, pause);
    exportedBuffers.push(restored.sql);
    const replay = inspect(restored.sql);
    check(same(baseline, replay) && catalogHash(catalogRows(await query('target', TARGET_BASE, CATALOG_SQL))) === baseline.catalog_sha256,
      'HOSTED_RESTORE_SCHEMA_OR_DATA_MISMATCH');
    r.restored = replay; r.hosted_schema_and_data_parity = true; r.status = 'HOSTED_PARITY_VERIFIED'; save();
    const rollbackBookmark = marker(result(await request('target', 'GET', TARGET_BASE + '/time_travel/bookmark'))?.bookmark);
    r.rollback_bookmark_sha256 = sha(rollbackBookmark);
    r.target_probe_attempted = true; r.target_probe_outcome = 'UNKNOWN'; save();
    const probe = result(await query('target', TARGET_BASE, MARKER_SQL));
    check(Array.isArray(probe) && probe.length >= 1 && probe.every(row => row.success === true), 'TARGET_PROBE_UNCONFIRMED');
    const count = result(await query('target', TARGET_BASE, MARKER_COUNT_SQL));
    check(count?.[0]?.success === true && count[0].results?.[0]?.marker_count === 1, 'TARGET_PROBE_READBACK_FAILED');
    r.target_probe_outcome = 'MARKER_CONFIRMED';
    r.rollback_attempted = true; r.rollback_outcome = 'UNKNOWN'; r.status = 'TARGET_ROLLBACK_REQUESTED'; save();
    const rolled = result(await request('target', 'POST', TARGET_BASE + '/time_travel/restore?bookmark=' + rollbackBookmark));
    if (rolled?.bookmark) r.rollback_result_bookmark_sha256 = sha(marker(rolled.bookmark));
    const after = await exportCurrent(request, 'target', TARGET_BASE, transfer, pause);
    exportedBuffers.push(after.sql);
    const rolledBack = inspect(after.sql);
    check(same(baseline, rolledBack), 'ROLLBACK_SCHEMA_OR_DATA_MISMATCH');
    check(catalogHash(catalogRows(await query('target', TARGET_BASE, CATALOG_SQL))) === baseline.catalog_sha256,
      'ROLLBACK_LIVE_CATALOG_MISMATCH');
    r.after_rollback = rolledBack; r.rollback_outcome = 'SCHEMA_AND_ALL_TABLE_DATA_RESTORED'; save();
    const finalSource = await exportCurrent(request, 'source', SOURCE_BASE, transfer, pause);
    exportedBuffers.push(finalSource.sql);
    check(same(baseline, inspect(finalSource.sql)), 'SOURCE_CHANGED_DURING_TEST_WINDOW');
    check(catalogHash(catalogRows(await query('source', SOURCE_BASE, CATALOG_SQL))) === baseline.catalog_sha256,
      'SOURCE_FINAL_CATALOG_CHANGED');
    r.source_data_unchanged = true;
    r.status = 'HOSTED_LOGICAL_RESTORE_PARITY_AND_ROLLBACK_VERIFIED';
  } catch (error) {
    r.status = r.target_import_attempted || r.target_probe_attempted ? 'HOSTED_RECOVERY_REQUIRES_RECONCILIATION' : 'HOSTED_RECOVERY_STOPPED';
    r.error = error instanceof RestoreStop || error instanceof RecoveryStop ? error.code : 'UNEXPECTED_LOCAL_FAILURE';
  } finally {
    for (const bytes of exportedBuffers) bytes.fill(0);
    save();
  }
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await recover({ sourceToken: process.env.CLOUDFLARE_API_TOKEN, targetToken: process.env.AXIOM_D1_RECOVERY_CF_API_TOKEN });
  console.log(r.status);
  if (r.error) console.log('error=' + r.error);
  process.exitCode = r.status === 'HOSTED_LOGICAL_RESTORE_PARITY_AND_ROLLBACK_VERIFIED' ? 0 : 2;
}
