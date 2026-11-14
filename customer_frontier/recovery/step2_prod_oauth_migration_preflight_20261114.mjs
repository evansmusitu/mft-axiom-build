/** Read the qualified recovery copy; rehearse the pinned plan only in private memory. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { provider, storage, TARGET, TARGET_BASE, ACCOUNT_BASE } from './step2_prod_oauth_hosted_restore_20261114.mjs';
import { ACCOUNT, targetD1Plan } from './step2_create_restore_target_20261114.mjs';
import { NAME, PRODUCTION_DATABASE } from './step2_create_oauth_restore_target_20261114.mjs';
export const FILE = 'prod_oauth_migration_preflight_20261114.json';
const sha = value => createHash('sha256').update(value).digest('hex');
const BOOKMARK = /^[A-Za-z0-9-]{16,256}$/;
export class PreflightStop extends Error { constructor(code) { super(code); this.code = code; } }
const check = (ok, code) => { if (!ok) throw new PreflightStop(code); };
const result = doc => { check(doc?.success === true, 'PROVIDER_ENVELOPE_INVALID'); return doc.result; };
export function allowed(method, path, body) {
  if (method === 'GET' && body === undefined) return [ACCOUNT_BASE, ACCOUNT_BASE + '/subscriptions', TARGET_BASE].includes(path);
  return method === 'POST' && path === TARGET_BASE + '/export' && body?.output_format === 'polling' &&
    Object.keys(body).every(key => ['output_format', 'current_bookmark'].includes(key)) &&
    (body.current_bookmark === undefined || BOOKMARK.test(body.current_bookmark));
}
export function readOnlyClient(token) {
  const base = provider({ target: token });
  return async (method, path, body) => {
    check(allowed(method, path, body), 'REQUEST_OUTSIDE_RECOVERED_COPY_READONLY_SCOPE');
    return base('target', method, path, body);
  };
}
export function memoryProbe(sql) {
  const run = spawnSync('python3', [fileURLToPath(new URL('./step2_prod_oauth_memory_upgrade_20261114.py', import.meta.url))],
    { input: sql, encoding: 'utf8', maxBuffer: 250000, timeout: 35000, env: {} });
  let doc; try { doc = JSON.parse(run.stdout); } catch { throw new PreflightStop('PRIVATE_MEMORY_PROBE_UNAVAILABLE'); }
  check([0, 2].includes(run.status) && doc?.schema === 'musitu.axiom.production-oauth-memory-upgrade.v1' &&
    doc.hosted_migration_qualified === false && doc.plaintext_written === false, 'PRIVATE_MEMORY_PROBE_INVALID');
  return doc;
}
export async function preflight({ token, baselineReceipt, api = readOnlyClient(token), transfer = storage,
  inspect = memoryProbe, save = () => {}, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const r = { schema: 'musitu.axiom.production-oauth-migration-preflight.v1', observed_at_utc: new Date().toISOString(),
    recovery_account: ACCOUNT, recovery_database: TARGET, database_mutation_routes_available: false,
    production_credentials_present: false, plaintext_written: false, hosted_migration_qualified: false,
    gate2_closed: false, release_status: 'NOT_RELEASE', status: 'PREFLIGHT_PENDING' };
  const record = () => save(r); record();
  try {
    check(baselineReceipt?.target_database === TARGET && baselineReceipt.target_name === NAME &&
      baselineReceipt.target_account === ACCOUNT && baselineReceipt.source_database === PRODUCTION_DATABASE &&
      baselineReceipt.hosted_schema_and_data_parity === true &&
      baselineReceipt.rollback_outcome === 'SCHEMA_AND_ALL_TABLE_DATA_RESTORED' && baselineReceipt.source_data_unchanged === true &&
      baselineReceipt.status === 'HOSTED_LOGICAL_RESTORE_PARITY_AND_ROLLBACK_VERIFIED', 'QUALIFIED_PRODUCTION_RESTORE_REQUIRED');
    check(result(await api('GET', ACCOUNT_BASE))?.id === ACCOUNT, 'RECOVERY_ACCOUNT_DRIFT');
    Object.assign(r, targetD1Plan(await api('GET', ACCOUNT_BASE + '/subscriptions')));
    const detail = result(await api('GET', TARGET_BASE));
    check(detail?.uuid === TARGET && detail.name === NAME, 'RECOVERY_DATABASE_DRIFT');
    let body = { output_format: 'polling' }, bookmark, completed = false;
    for (let i = 0; i < 40; i++) {
      const job = result(await api('POST', TARGET_BASE + '/export', body));
      check(job && job.status !== 'error' && job.success !== false, 'RECOVERY_EXPORT_FAILED');
      if (job.at_bookmark) {
        check(BOOKMARK.test(job.at_bookmark) && (!bookmark || bookmark === job.at_bookmark), 'RECOVERY_EXPORT_BOOKMARK_DRIFT');
        bookmark = job.at_bookmark;
      }
      if (job.status === 'complete') {
        check(bookmark && typeof job.result?.signed_url === 'string', 'RECOVERY_EXPORT_INCOMPLETE');
        const sql = await transfer('GET', job.result.signed_url);
        try { r.memory_preflight = inspect(sql); } finally { sql.fill(0); }
        completed = true; break;
      }
      check(bookmark, 'RECOVERY_EXPORT_BOOKMARK_MISSING'); body = { output_format: 'polling', current_bookmark: bookmark }; await pause(500);
    }
    check(completed, 'RECOVERY_EXPORT_POLL_LIMIT');
    const current = r.memory_preflight.baseline;
    check(current?.catalog_sha256 === baselineReceipt.baseline.catalog_sha256 &&
      current.user_data_sha256 === baselineReceipt.baseline.user_data_sha256 &&
      JSON.stringify(current.tables) === JSON.stringify(baselineReceipt.baseline.tables), 'RECOVERED_SNAPSHOT_DRIFT');
    r.recovered_snapshot_matches_verified_backup = true;
    check(r.memory_preflight.status === 'REAL_RECOVERED_SNAPSHOT_LOCAL_UPGRADE_PREFLIGHT_PASSED', 'REVIEWED_UPGRADE_REJECTED_REAL_RECOVERED_DATA');
    check(r.memory_preflight.plan_sha256 === '6946e796539e6787033e20f1d0afdcb5259a130ca77be6e3c5afb60b5dc9888a' &&
      r.memory_preflight.statement_count === 89, 'REVIEWED_UPGRADE_PLAN_DRIFT');
    r.status = 'PRODUCTION_OAUTH_COPY_LOCAL_UPGRADE_PREFLIGHT_PASSED';
  } catch (error) {
    r.status = 'PRODUCTION_OAUTH_COPY_LOCAL_UPGRADE_PREFLIGHT_STOPPED';
    r.error = error instanceof PreflightStop ? error.code : 'SANITIZED_PREFLIGHT_FAILURE';
  }
  record(); return r;
}
function persist(r) {
  const bytes = Buffer.from(JSON.stringify(r, null, 2) + '\n'); writeFileSync(FILE, bytes, { mode: 0o600 });
  writeFileSync(FILE + '.sha256', sha(bytes) + '  ' + FILE + '\n', { mode: 0o600 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = readFileSync(new URL('../evidence/hosted_recovery_20261114/prod_oauth_hosted_restore_parity_rollback_passed_20261114.json', import.meta.url));
  check(sha(raw) === '7c4bb77d2b717bd7126543dafc4ac4cd44d68d2b530d7c111b58448efa4463ae', 'PRODUCTION_RESTORE_PIN_MISMATCH');
  const r = await preflight({ token: process.env.AXIOM_D1_RECOVERY_CF_API_TOKEN, baselineReceipt: JSON.parse(raw), save: persist });
  console.log(r.status); if (r.error) console.log('error=' + r.error);
  process.exitCode = r.status === 'PRODUCTION_OAUTH_COPY_LOCAL_UPGRADE_PREFLIGHT_PASSED' ? 0 : 2;
}
