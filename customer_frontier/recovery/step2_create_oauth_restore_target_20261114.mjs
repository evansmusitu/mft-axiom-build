/** Create a second, empty D1 for the production OAuth recovery rehearsal only. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ACCOUNT, CATALOG_SQL, RECIPIENT_SHA256, RecoveryStop, targetD1Plan } from './step2_create_restore_target_20261114.mjs';
import { TARGET as IDP_RECOVERY_DATABASE } from './step2_hosted_restore_20261114.mjs';
export { ACCOUNT, CATALOG_SQL };
export const NAME = 'axiom-oauth-step2-disposable-restore-20261114-704a7351';
export const PRODUCTION_DATABASE = '504029cc-f9a5-495e-818f-63c6144b4ea4';
export const PREFIX = '/accounts/' + ACCOUNT;
export const FILE = 'oauth_restore_target_20261114.json';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const blocked = [PRODUCTION_DATABASE, IDP_RECOVERY_DATABASE, 'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f', 'c023a0a0-472a-4178-ad07-02f1d6b2e122'];
const sha = value => createHash('sha256').update(value).digest('hex');
export class OAuthTargetStop extends Error { constructor(code) { super(code); this.code = code; } }
const check = (ok, code) => { if (!ok) throw new OAuthTargetStop(code); };
const result = doc => { check(doc?.success === true, 'API_ENVELOPE_INVALID'); return doc.result; };
export const safeUuid = value => typeof value === 'string' && UUID.test(value) && !blocked.includes(value);
export function permitted(method, path, body) {
  if (method === 'GET' && body === undefined && [PREFIX, PREFIX + '/subscriptions',
    PREFIX + '/d1/database?page=1&per_page=100', PREFIX + '/workers/scripts',
    PREFIX + '/pages/projects?page=1&per_page=10'].includes(path)) return true;
  if (method === 'POST' && path === PREFIX + '/d1/database')
    return body?.name === NAME && Object.keys(body).join('|') === 'name';
  const match = path.match(new RegExp('^' + PREFIX + '/d1/database/([^/]+)(/query)?$'));
  if (!match || !safeUuid(match[1])) return false;
  return method === 'GET' && !match[2] && body === undefined ||
    method === 'POST' && match[2] === '/query' && body?.sql === CATALOG_SQL && Object.keys(body).join('|') === 'sql';
}
export function client(token) {
  return async (method, path, body) => {
    check(typeof token === 'string' && token.length > 5 && !/[\r\n]/.test(token), 'RECOVERY_TOKEN_MISSING');
    check(permitted(method, path, body), 'REQUEST_OUTSIDE_OAUTH_TARGET_CREATE_SCOPE');
    try {
      const response = await fetch('https://api.cloudflare.com/client/v4' + path, {
        method, redirect: 'manual', signal: AbortSignal.timeout(20000),
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      check(response.ok, 'PROVIDER_HTTP_' + response.status);
      const parts = []; let n = 0;
      for await (const part of response.body) { n += part.length; check(n <= 400000, 'PROVIDER_RESPONSE_OVER_BUDGET'); parts.push(part); }
      let doc; try { doc = JSON.parse(Buffer.concat(parts)); } catch { throw new OAuthTargetStop('PROVIDER_JSON_INVALID'); }
      result(doc); return doc;
    } catch (error) { if (error instanceof OAuthTargetStop) throw error; throw new OAuthTargetStop('PROVIDER_OUTCOME_UNKNOWN'); }
  };
}
export function nativeAdmission(r) {
  const cases = ['reviewed_migration_pragma_guards_supported', 'native_batch_sequential_ddl_and_insert',
    'late_batch_constraint_failure_restores_prior_data', 'late_batch_constraint_failure_restores_create_and_drop_ddl',
    'competing_batches_admit_exactly_one_writer', 'rejected_competing_batch_has_no_partial_audit_write'];
  return r?.schema === 'musitu.axiom.native-batch-and-production-oauth-preflight.v1' &&
    r.status === 'NATIVE_BATCH_AND_FRESH_PREVIEW_PERSISTENCE_QUALIFIED' && r.recovery_account === ACCOUNT &&
    r.recovery_database === IDP_RECOVERY_DATABASE && r.production_database === PRODUCTION_DATABASE &&
    r.production_required_tables_present === true && r.cleanup_parity_verified === true &&
    r.preview_workers_absent_after_cleanup === true && r.production_oauth_migrated === false &&
    r.release_status === 'NOT_RELEASE' && r.native_batch_result?.status === 'NATIVE_D1_BATCH_BEHAVIOR_VERIFIED' &&
    Array.isArray(r.native_batch_result.tests) && r.native_batch_result.tests.length === cases.length && cases.every(name =>
      r.native_batch_result.tests.some(row => row.name === name && row.result === 'PASS')) &&
    r.fresh_preview_result?.status === 'NATIVE_D1_STATE_SURVIVES_FRESH_PREVIEW_SESSION';
}
export async function createTarget({ token, nativeReceipt, api = client(token), save = () => {} } = {}) {
  const r = { schema: 'musitu.axiom.production-oauth-restore-target.v1', observed_at_utc: new Date().toISOString(),
    recovery_account: ACCOUNT, production_database: PRODUCTION_DATABASE, target_name: NAME,
    owner_recipient_spki_sha256: RECIPIENT_SHA256, existing_idp_recovery_preserved: true,
    creation_attempted: false, creation_outcome: 'UNATTEMPTED', target_uuid: null,
    target_creation_readback_verified: false, target_empty_schema_verified: false,
    production_mutation_routes_available: false, production_oauth_migrated: false,
    gate2_closed: false, release_status: 'NOT_RELEASE', status: 'PREFLIGHT_PENDING' };
  const record = () => save(r); record();
  try {
    check(nativeAdmission(nativeReceipt), 'NATIVE_BATCH_WITNESS_NOT_QUALIFIED');
    check(result(await api('GET', PREFIX))?.id === ACCOUNT, 'RECOVERY_ACCOUNT_DRIFT');
    Object.assign(r, targetD1Plan(await api('GET', PREFIX + '/subscriptions')));
    const catalogDoc = await api('GET', PREFIX + '/d1/database?page=1&per_page=100');
    const databases = result(catalogDoc);
    check(Array.isArray(databases) && databases.length === 1 &&
      catalogDoc.result_info?.total_count === 1 && databases[0].uuid === IDP_RECOVERY_DATABASE &&
      databases[0].name === 'axiom-idp-step1-disposable-restore-20261114-704a7351', 'EXISTING_RECOVERY_CATALOG_DRIFT');
    const workers = result(await api('GET', PREFIX + '/workers/scripts'));
    const pagesDoc = await api('GET', PREFIX + '/pages/projects?page=1&per_page=10');
    check(Array.isArray(workers) && workers.length === 0 && Array.isArray(result(pagesDoc)) &&
      pagesDoc.result.length === 0 && pagesDoc.result_info?.total_count === 0, 'RECOVERY_ACCOUNT_HAS_CONSUMERS');
    r.creation_attempted = true; r.creation_outcome = 'UNKNOWN'; r.status = 'SINGLE_CREATE_STARTING'; record();
    const created = result(await api('POST', PREFIX + '/d1/database', { name: NAME }));
    check(created?.name === NAME && safeUuid(created.uuid), 'CREATED_TARGET_IDENTITY_INVALID');
    r.target_uuid = created.uuid; r.creation_outcome = 'CREATED'; record();
    const detail = result(await api('GET', PREFIX + '/d1/database/' + created.uuid));
    check(detail?.uuid === created.uuid && detail.name === NAME, 'CREATED_TARGET_READBACK_DRIFT');
    r.target_creation_readback_verified = true; record();
    const schema = result(await api('POST', PREFIX + '/d1/database/' + created.uuid + '/query', { sql: CATALOG_SQL }));
    check(schema?.length === 1 && schema[0].success === true && schema[0].results?.length === 0 &&
      schema[0].meta?.rows_written === 0 && schema[0].meta?.changed_db === false, 'NEW_OAUTH_TARGET_SCHEMA_NOT_EMPTY');
    r.target_empty_schema_verified = true; r.status = 'OAUTH_TARGET_CREATED_EMPTY_CONFIRMED';
  } catch (error) {
    r.status = r.creation_attempted ? 'OAUTH_TARGET_CREATION_REQUIRES_RECONCILIATION' : 'OAUTH_TARGET_PREFLIGHT_STOPPED';
    r.error = error instanceof OAuthTargetStop || error instanceof RecoveryStop ? error.code : 'UNEXPECTED_LOCAL_FAILURE';
  }
  record(); return r;
}
function persist(r) {
  const bytes = Buffer.from(JSON.stringify(r, null, 2) + '\n'); writeFileSync(FILE, bytes, { mode: 0o600 });
  writeFileSync(FILE + '.sha256', sha(bytes) + '  ' + FILE + '\n', { mode: 0o600 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = readFileSync(new URL('../evidence/hosted_recovery_20261114/native_batch_qualified_20261114.json', import.meta.url));
  check(sha(raw) === 'fb355b6ef86e2b582d4a30e9b4d070823be7fbca0344e69d3919ae2938a36edf', 'NATIVE_WITNESS_PIN_MISMATCH');
  const r = await createTarget({ token: process.env.AXIOM_D1_RECOVERY_CF_API_TOKEN, nativeReceipt: JSON.parse(raw), save: persist });
  console.log(r.status); console.log('target_uuid=' + (r.target_uuid ?? 'UNQUALIFIED'));
  if (r.error) console.log('error=' + r.error);
  process.exitCode = r.status === 'OAUTH_TARGET_CREATED_EMPTY_CONFIRMED' ? 0 : 2;
}
