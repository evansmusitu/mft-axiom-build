/** Gate2 native D1 preview probe. Production OAuth access is metadata/catalog only.
 * Transient previews bind solely to the previously qualified recovery D1.
 * No production Worker deployment, route, domain, DB mutation or SQL export.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ACCOUNT, NAME, CATALOG_SQL, targetD1Plan } from './step2_create_restore_target_20261114.mjs';
import { TARGET, TARGET_BASE, ACCOUNT_BASE, fingerprint, storage, catalogHash } from './step2_hosted_restore_20261114.mjs';
import { ownerResultMatches } from './step2_recovered_tenant_qualification_20261114.mjs';

export const PRODUCTION_DATABASE = '504029cc-f9a5-495e-818f-63c6144b4ea4';
export const PRODUCTION_BASE = '/accounts/93f395f5121954671f92fffa453d6b61/d1/database/' + PRODUCTION_DATABASE;
export const PREVIEW_A = 'axiom-gate2-native-batch-20261114-704a7351';
export const PREVIEW_B = PREVIEW_A + '-fresh';
export const FILE = 'native_batch_and_oauth_preflight_20261114.json';
const sha = value => createHash('sha256').update(value).digest('hex');
const BOOKMARK = /^[A-Za-z0-9-]{16,256}$/;
export class PreviewStop extends Error { constructor(code) { super(code); this.code = code; } }
const check = (ok, code) => { if (!ok) throw new PreviewStop(code); };
const result = doc => { check(doc?.success === true, 'API_ENVELOPE_INVALID'); return doc.result; };

export function allowed(role, method, path, body) {
  if (role === 'production') return method === 'GET' && path === PRODUCTION_BASE && body === undefined ||
    method === 'POST' && path === PRODUCTION_BASE + '/query' && body?.sql === CATALOG_SQL && Object.keys(body).join('|') === 'sql';
  if (role !== 'recovery') return false;
  const bases = [ACCOUNT_BASE, ACCOUNT_BASE + '/subscriptions', ACCOUNT_BASE + '/workers/scripts',
    ACCOUNT_BASE + '/pages/projects?page=1&per_page=10', TARGET_BASE,
    TARGET_BASE + '/time_travel/bookmark', ACCOUNT_BASE + '/workers/subdomain'];
  if (method === 'GET' && body === undefined && bases.includes(path)) return true;
  for (const name of [PREVIEW_A, PREVIEW_B]) {
    const prefix = ACCOUNT_BASE + '/workers/scripts/' + name;
    if (method === 'GET' && path === prefix + '/subdomain/edge-preview' && body === undefined) return true;
    if (method === 'POST' && path === prefix + '/edge-preview' && body instanceof FormData) return true;
    if (method === 'DELETE' && path === prefix && body === undefined) return true;
  }
  if (method !== 'POST') return false;
  if (path === TARGET_BASE + '/export') return body?.output_format === 'polling' &&
    Object.keys(body).every(key => ['output_format', 'current_bookmark'].includes(key)) &&
    (body.current_bookmark === undefined || BOOKMARK.test(body.current_bookmark));
  const rollback = TARGET_BASE + '/time_travel/restore?bookmark=';
  return body === undefined && path.startsWith(rollback) && BOOKMARK.test(path.slice(rollback.length));
}
async function bounded(response, maximum) {
  let count = 0; const parts = [];
  for await (const part of response.body) { count += part.length; check(count <= maximum, 'RESPONSE_OVER_BUDGET'); parts.push(part); }
  return Buffer.concat(parts);
}
export function apiClient(tokens) {
  return async (role, method, path, body, previewSessionToken) => {
    check(allowed(role, method, path, body), 'REQUEST_OUTSIDE_PINNED_SCOPE');
    const token = tokens[role];
    check(typeof token === 'string' && token.length > 5 && !/[\r\n]/.test(token), 'SCOPED_CREDENTIAL_MISSING');
    const multipart = body instanceof FormData;
    if (previewSessionToken !== undefined) check(multipart && typeof previewSessionToken === 'string' &&
      previewSessionToken.length <= 16000 && !/[\r\n]/.test(previewSessionToken), 'PREVIEW_SESSION_INVALID');
    let response;
    try {
      response = await fetch('https://api.cloudflare.com/client/v4' + path, { method, redirect: 'manual',
        signal: AbortSignal.timeout(25000), headers: { Authorization: 'Bearer ' + token, Accept: 'application/json',
          ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}),
          ...(previewSessionToken ? { 'cf-preview-upload-config-token': previewSessionToken } : {}) },
        ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) });
      const bytes = await bounded(response, 500000);
      check(response.ok, role.toUpperCase() + '_API_HTTP_' + response.status);
      let doc; try { doc = JSON.parse(bytes); } catch { throw new PreviewStop('API_JSON_INVALID'); }
      result(doc); return doc;
    } catch (error) {
      if (error instanceof PreviewStop) throw error;
      throw new PreviewStop('API_TRANSPORT_OUTCOME_UNKNOWN');
    }
  };
}
export function trustedPreviewUrl(value) {
  let url; try { url = new URL(value); } catch { throw new PreviewStop('PREVIEW_URL_INVALID'); }
  check(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
    (/^[a-z0-9.-]+\.workers\.dev$/.test(url.hostname) || /^[a-z0-9.-]+\.cloudflareworkers\.com$/.test(url.hostname)),
  'PREVIEW_HOST_OUTSIDE_PROVIDER');
  return url;
}
export async function edgeFetch(url, init = {}) {
  const checked = trustedPreviewUrl(url);
  try {
    const response = await fetch(checked, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const bytes = await bounded(response, 100000);
    check(response.ok || response.status === 409, 'PREVIEW_EDGE_HTTP_' + response.status);
    try { return JSON.parse(bytes); } catch { throw new PreviewStop('PREVIEW_EDGE_JSON_INVALID'); }
  } catch (error) { if (error instanceof PreviewStop) throw error; throw new PreviewStop('PREVIEW_EDGE_TRANSPORT_UNKNOWN'); }
}

async function preview(api, edge, name, source, challenge, instanceTag) {
  const session = result(await api('recovery', 'GET', ACCOUNT_BASE + '/workers/scripts/' + name + '/subdomain/edge-preview'));
  check(typeof session?.token === 'string' && session.token.length > 5, 'PREVIEW_SESSION_TOKEN_UNAVAILABLE');
  let value = session.token, host;
  if (session.exchange_url) {
    const url = trustedPreviewUrl(session.exchange_url);
    const expanded = await edge(url.href);
    if (typeof expanded?.token === 'string') value = expanded.token;
    const dot = url.hostname.indexOf('.');
    check(dot > 0, 'PREVIEW_EXCHANGE_HOST_INVALID'); host = name + url.hostname.slice(dot);
  } else {
    const subdomain = result(await api('recovery', 'GET', ACCOUNT_BASE + '/workers/subdomain'))?.subdomain;
    check(typeof subdomain === 'string' && /^[a-z0-9-]+(?:\.workers\.dev)?$/.test(subdomain), 'ACCOUNT_PREVIEW_SUBDOMAIN_UNAVAILABLE');
    host = name + '.' + subdomain.replace(/\.workers\.dev$/, '') + '.workers.dev';
  }
  trustedPreviewUrl('https://' + host);
  const form = new FormData();
  form.set('metadata', new Blob([JSON.stringify({ main_module: 'worker.mjs', compatibility_date: '2026-11-14',
    bindings: [{ type: 'd1', name: 'RECOVERY_DB', id: TARGET },
      { type: 'plain_text', name: 'GATE2_PROBE_KEY', text: challenge },
      { type: 'plain_text', name: 'GATE2_INSTANCE_TAG', text: instanceTag }] })], { type: 'application/json' }));
  form.set('worker.mjs', new Blob([source], { type: 'application/javascript+module' }), 'worker.mjs');
  form.set('wrangler-session-config', JSON.stringify({ workers_dev: true, minimal_mode: false }));
  const uploaded = result(await api('recovery', 'POST', ACCOUNT_BASE + '/workers/scripts/' + name + '/edge-preview', form, value));
  check(typeof uploaded?.preview_token === 'string' && uploaded.preview_token.length > 5, 'PREVIEW_UPLOAD_TOKEN_UNAVAILABLE');
  return { host, token: uploaded.preview_token };
}
async function snapshot(api, transfer, inspect, pause) {
  let body = { output_format: 'polling' }, bookmark;
  for (let i = 0; i < 40; i++) {
    const job = result(await api('recovery', 'POST', TARGET_BASE + '/export', body));
    check(job && job.status !== 'error' && job.success !== false, 'RECOVERY_EXPORT_FAILED');
    if (job.at_bookmark) {
      check(BOOKMARK.test(job.at_bookmark) && (!bookmark || bookmark === job.at_bookmark), 'RECOVERY_EXPORT_BOOKMARK_DRIFT');
      bookmark = job.at_bookmark;
    }
    if (job.status === 'complete') {
      check(bookmark && typeof job.result?.signed_url === 'string', 'RECOVERY_EXPORT_RESULT_INVALID');
      const sql = await transfer('GET', job.result.signed_url);
      try { return inspect(sql); } finally { sql.fill(0); }
    }
    check(bookmark, 'RECOVERY_EXPORT_BOOKMARK_MISSING'); body = { output_format: 'polling', current_bookmark: bookmark }; await pause(500);
  }
  throw new PreviewStop('RECOVERY_EXPORT_POLL_LIMIT');
}
const same = (a, b) => a.catalog_sha256 === b.catalog_sha256 && a.user_data_sha256 === b.user_data_sha256 &&
  JSON.stringify(a.tables) === JSON.stringify(b.tables);
function persist(r) {
  const bytes = Buffer.from(JSON.stringify(r, null, 2) + '\n'); writeFileSync(FILE, bytes, { mode: 0o600 });
  writeFileSync(FILE + '.sha256', sha(bytes) + '  ' + FILE + '\n', { mode: 0o600 });
}

export async function qualifyPreview({ productionToken, recoveryToken, baselineReceipt, ownerProof, workerSource,
  api = apiClient({ production: productionToken, recovery: recoveryToken }), edge = edgeFetch,
  transfer = storage, inspect = fingerprint, save = persist,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const r = { schema: 'musitu.axiom.native-batch-and-production-oauth-preflight.v1', observed_at_utc: new Date().toISOString(),
    production_database: PRODUCTION_DATABASE, recovery_database: TARGET, recovery_account: ACCOUNT,
    production_row_values_collected: 0, production_sql_export_performed: false, production_mutation_routes_available: false,
    production_oauth_migrated: false, permanent_worker_deployment_performed: false,
    native_invocation_attempted: false, cleanup_parity_verified: false, preview_workers_absent_after_cleanup: false,
    gate2_closed: false, release_status: 'NOT_RELEASE', status: 'PREFLIGHT_PENDING' };
  const record = () => save(r);
  let origin, previewAttempted = false;
  record();
  try {
    check(ownerResultMatches(baselineReceipt, ownerProof), 'OWNER_RESULT_OR_RECOVERY_BASELINE_INVALID');
    check(typeof workerSource === 'string' && workerSource.length > 200 && workerSource.length < 20000, 'PREVIEW_SOURCE_INVALID');
    r.preview_source_sha256 = sha(workerSource);
    const prod = result(await api('production', 'GET', PRODUCTION_BASE));
    check(prod?.uuid === PRODUCTION_DATABASE && Number.isSafeInteger(prod.file_size) && prod.file_size > 0 && prod.file_size <= 8000000,
      'PRODUCTION_DATABASE_IDENTITY_OR_SIZE_INVALID');
    r.production_database_bytes = prod.file_size;
    const catalog = result(await api('production', 'POST', PRODUCTION_BASE + '/query', { sql: CATALOG_SQL }));
    check(catalog?.length === 1 && catalog[0].success === true && Array.isArray(catalog[0].results) &&
      catalog[0].meta?.changed_db === false && catalog[0].meta?.rows_written === 0, 'PRODUCTION_CATALOG_NOT_READONLY');
    r.production_catalog_sha256 = catalogHash(catalog[0].results);
    r.production_required_tables_present = ['customers', 'api_keys', 'oauth_clients', 'oauth_authorization_flows',
      'oauth_authorization_codes', 'oauth_access_tokens', 'oauth_refresh_tokens'].every(name =>
      catalog[0].results.some(row => row.type === 'table' && row.name === name));
    check(r.production_required_tables_present, 'PRODUCTION_OAUTH_TABLES_NOT_QUALIFIED'); record();
    const account = result(await api('recovery', 'GET', ACCOUNT_BASE));
    check(account?.id === ACCOUNT, 'RECOVERY_ACCOUNT_DRIFT');
    Object.assign(r, targetD1Plan(await api('recovery', 'GET', ACCOUNT_BASE + '/subscriptions')));
    const workers = result(await api('recovery', 'GET', ACCOUNT_BASE + '/workers/scripts'));
    const pages = await api('recovery', 'GET', ACCOUNT_BASE + '/pages/projects?page=1&per_page=10');
    check(Array.isArray(workers) && workers.length === 0 && Array.isArray(result(pages)) && pages.result.length === 0 &&
      pages.result_info?.total_count === 0, 'RECOVERY_ACCOUNT_HAS_CONSUMERS');
    const detail = result(await api('recovery', 'GET', TARGET_BASE));
    check(detail?.uuid === TARGET && detail.name === NAME, 'RECOVERY_TARGET_DRIFT');
    r.baseline = await snapshot(api, transfer, inspect, pause);
    check(same(r.baseline, baselineReceipt.baseline), 'RECOVERY_BASELINE_DRIFT');
    origin = result(await api('recovery', 'GET', TARGET_BASE + '/time_travel/bookmark'))?.bookmark;
    check(BOOKMARK.test(origin ?? ''), 'RECOVERY_ROLLBACK_BOOKMARK_INVALID'); r.rollback_bookmark_sha256 = sha(origin);
    const challenge = randomBytes(32).toString('hex'), instanceA = randomBytes(16).toString('hex'), instanceB = randomBytes(16).toString('hex');
    r.status = 'TRANSIENT_PREVIEW_SESSION_STARTING'; previewAttempted = true; record();
    const a = await preview(api, edge, PREVIEW_A, workerSource, challenge, instanceA);
    r.preview_upload_verified = true; r.native_invocation_attempted = true; record();
    r.native_batch_result = await edge('https://' + a.host + '/gate2/native-batch', { method: 'POST',
      headers: { 'cf-workers-preview-token': a.token, Authorization: 'Bearer ' + challenge, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'qualify-native-batch' }) });
    check(r.native_batch_result.status === 'NATIVE_D1_BATCH_BEHAVIOR_VERIFIED' && r.native_batch_result.preview_instance_tag === instanceA,
      'NATIVE_BATCH_RESULT_NOT_QUALIFIED'); record();
    const b = await preview(api, edge, PREVIEW_B, workerSource, challenge, instanceB);
    r.fresh_preview_result = await edge('https://' + b.host + '/gate2/native-batch', { method: 'POST',
      headers: { 'cf-workers-preview-token': b.token, Authorization: 'Bearer ' + challenge, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'fresh-preview-readback' }) });
    check(r.fresh_preview_result.status === 'NATIVE_D1_STATE_SURVIVES_FRESH_PREVIEW_SESSION' &&
      r.fresh_preview_result.preview_instance_tag === instanceB, 'FRESH_PREVIEW_READBACK_NOT_QUALIFIED');
    r.status = 'NATIVE_BATCH_CHECKS_PASSED_CLEANUP_REQUIRED';
  } catch (error) {
    r.status = 'NATIVE_BATCH_OR_PRODUCTION_PREFLIGHT_STOPPED';
    r.error = error instanceof PreviewStop ? error.code : 'UNEXPECTED_PREFLIGHT_FAILURE';
  } finally {
    if (r.native_invocation_attempted && origin) {
      r.rollback_attempted = true; record();
      try { await api('recovery', 'POST', TARGET_BASE + '/time_travel/restore?bookmark=' + origin); r.rollback_acknowledged = true; }
      catch { r.rollback_error = 'ROLLBACK_ACKNOWLEDGEMENT_UNCONFIRMED'; }
      try { r.after_cleanup = await snapshot(api, transfer, inspect, pause); check(same(r.after_cleanup, r.baseline), 'RECOVERY_CLEANUP_MISMATCH'); r.cleanup_parity_verified = true; }
      catch { r.cleanup_error = 'ALL_TABLE_CLEANUP_PARITY_UNCONFIRMED'; }
    }
    if (previewAttempted) {
      try {
        let workers = result(await api('recovery', 'GET', ACCOUNT_BASE + '/workers/scripts'));
        check(Array.isArray(workers) && workers.every(row => [PREVIEW_A, PREVIEW_B].includes(row.id)), 'UNEXPECTED_WORKER_CATALOG_CHANGE');
        for (const row of workers) {
          try { await api('recovery', 'DELETE', ACCOUNT_BASE + '/workers/scripts/' + row.id); }
          catch { r.preview_delete_acknowledgement_unknown = true; }
        }
        workers = result(await api('recovery', 'GET', ACCOUNT_BASE + '/workers/scripts'));
        check(Array.isArray(workers) && workers.length === 0, 'PREVIEW_WORKER_CLEANUP_UNCONFIRMED');
        r.preview_workers_absent_after_cleanup = true;
      } catch { r.preview_cleanup_error = 'PREVIEW_WORKER_CATALOG_REQUIRES_RECONCILIATION'; }
    }
    if (r.status === 'NATIVE_BATCH_CHECKS_PASSED_CLEANUP_REQUIRED' && r.cleanup_parity_verified && r.preview_workers_absent_after_cleanup)
      r.status = 'NATIVE_BATCH_AND_FRESH_PREVIEW_PERSISTENCE_QUALIFIED';
    else if (r.native_invocation_attempted && !r.cleanup_parity_verified || r.preview_cleanup_error)
      r.status = 'NATIVE_PROBE_CLEANUP_REQUIRES_RECONCILIATION';
    record();
  }
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const loadPinned = (name, expected) => { const b = readFileSync(new URL('../evidence/hosted_recovery_20261114/' + name, import.meta.url)); check(sha(b) === expected, 'EVIDENCE_PIN_MISMATCH'); return JSON.parse(b); };
  const baselineReceipt = loadPinned('hosted_restore_parity_rollback_passed.json', '82ab871ea31dc55eeabb79803bb03e4a2d8ee98d789bafb8a1d6c9e99480cf07');
  const ownerProof = loadPinned('owner_submitted_decryption_proof_20261114.json', '212546bab17be2c12f5dfa1084d640bdae105fd5c57604e58d6b30ea7f4de8e2');
  const workerSource = readFileSync(new URL('./step2_native_batch_preview_worker_20261114.mjs', import.meta.url), 'utf8');
  const r = await qualifyPreview({ productionToken: process.env.CLOUDFLARE_API_TOKEN,
    recoveryToken: process.env.AXIOM_D1_RECOVERY_CF_API_TOKEN, baselineReceipt, ownerProof, workerSource });
  console.log(r.status); if (r.error) console.log('error=' + r.error);
  process.exitCode = r.status === 'NATIVE_BATCH_AND_FRESH_PREVIEW_PERSISTENCE_QUALIFIED' ? 0 : 2;
}
