// Proven transport copied from Git blob f7405bd139833111dcb8e574356a8573c2daed5d; only the qualified OAuth recovery D1 is bound.
/** Gate2 native D1 preview probe. Production OAuth access is metadata/catalog only.
 * Transient previews bind solely to the previously qualified recovery D1.
 * No production Worker deployment, route, domain, DB mutation or SQL export.
 */
import { createHash } from 'node:crypto';
import { TARGET, TARGET_BASE, ACCOUNT_BASE } from './step2_prod_oauth_hosted_restore_20261114.mjs';
export const PRODUCTION_DATABASE = '504029cc-f9a5-495e-818f-63c6144b4ea4';
export const PRODUCTION_BASE = '/accounts/93f395f5121954671f92fffa453d6b61/d1/database/' + PRODUCTION_DATABASE;
export const PREVIEW_A = 'axiom-gate2-prod-oauth-20261114-704a7351';
export const PREVIEW_B = PREVIEW_A + '-fresh';
export const RECOVERY_SUBDOMAIN = 'axiom-recovery-704a7351';
const sha = value => createHash('sha256').update(value).digest('hex');
const BOOKMARK = /^[A-Za-z0-9-]{16,256}$/;
const SAFE_OPERATIONS = ['PREVIEW_SESSION_INITIALIZE', 'PREVIEW_UPLOAD', 'WORKERS_SUBDOMAIN_READ', 'WORKERS_SUBDOMAIN_REGISTER', 'PINNED_API_OPERATION'];
const SAFE_EDGE_REASONS = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ERR_TLS_CERT_ALTNAME_INVALID', 'TIMEOUT', 'UNCLASSIFIED'];
export class PreviewStop extends Error {
  constructor(code, details = {}) {
    super(code); this.code = code;
    if (SAFE_OPERATIONS.includes(details.api_operation)) this.api_operation = details.api_operation;
    if (SAFE_EDGE_REASONS.includes(details.edge_transport_reason)) this.edge_transport_reason = details.edge_transport_reason;
    if (Array.isArray(details.provider_error_codes)) this.provider_error_codes = [...new Set(details.provider_error_codes
      .filter(value => Number.isSafeInteger(value) && value >= 0 && value <= 999999999))].slice(0, 10);
  }
}
const check = (ok, code) => { if (!ok) throw new PreviewStop(code); };
export const result = doc => { check(doc?.success === true, 'API_ENVELOPE_INVALID'); return doc.result; };

function exportBody(body) {
  return body?.output_format === 'polling' && Object.keys(body).every(key => ['output_format','current_bookmark'].includes(key)) &&
    (body.current_bookmark === undefined || BOOKMARK.test(body.current_bookmark));
}
export function allowed(role, method, path, body) {
  if (role === 'production') {
    if (method === 'GET') return path === PRODUCTION_BASE && body === undefined;
    return method === 'POST' && path === PRODUCTION_BASE + '/export' && exportBody(body);
  }
  if (role !== 'recovery') return false;
  if (method === 'POST' && path === TARGET_BASE + '/query') return ['PRAGMA foreign_keys','PRAGMA foreign_key_check'].includes(body?.sql) && Object.keys(body).join('|') === 'sql';
  if (method === 'PUT' && path === ACCOUNT_BASE + '/workers/subdomain')
    return body?.subdomain === RECOVERY_SUBDOMAIN && Object.keys(body).join('|') === 'subdomain';
  const bases = [ACCOUNT_BASE, ACCOUNT_BASE + '/subscriptions', ACCOUNT_BASE + '/workers/scripts',
    ACCOUNT_BASE + '/d1/database?page=1&per_page=100',
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
      if (!response.ok) {
        let codes = [];
        try { const refused = JSON.parse(bytes); if (Array.isArray(refused?.errors)) codes = refused.errors.map(row => row?.code); } catch {}
        const operation = method === 'GET' && path.endsWith('/subdomain/edge-preview') ? 'PREVIEW_SESSION_INITIALIZE' :
          method === 'POST' && path.endsWith('/edge-preview') ? 'PREVIEW_UPLOAD' :
          path === ACCOUNT_BASE + '/workers/subdomain' ?
            (method === 'PUT' ? 'WORKERS_SUBDOMAIN_REGISTER' : 'WORKERS_SUBDOMAIN_READ') : 'PINNED_API_OPERATION';
        throw new PreviewStop(role.toUpperCase() + '_API_HTTP_' + response.status,
          { api_operation: operation, provider_error_codes: codes });
      }
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
    check(response.body !== null, 'PREVIEW_EDGE_BODY_MISSING_HTTP_' + response.status);
    const bytes = await bounded(response, 100000);
    check(response.ok || response.status === 409, 'PREVIEW_EDGE_HTTP_' + response.status);
    try { return JSON.parse(bytes); } catch { throw new PreviewStop('PREVIEW_EDGE_JSON_INVALID'); }
  } catch (error) {
    if (error instanceof PreviewStop) throw error;
    const reason = SAFE_EDGE_REASONS.includes(error?.cause?.code) ? error.cause.code :
      ['TimeoutError', 'AbortError'].includes(error?.name) ? 'TIMEOUT' : 'UNCLASSIFIED';
    throw new PreviewStop('PREVIEW_EDGE_TRANSPORT_UNKNOWN', { edge_transport_reason: reason });
  }
}

export async function preview(api, edge, name, source, planSource, challenge, instanceTag) {
  const session = result(await api('recovery', 'GET', ACCOUNT_BASE + '/workers/scripts/' + name + '/subdomain/edge-preview'));
  check(typeof session?.token === 'string' && session.token.length > 5, 'PREVIEW_SESSION_TOKEN_UNAVAILABLE');
  let value = session.token, host, exchangeFallback = false;
  if (session.exchange_url) {
    const url = trustedPreviewUrl(session.exchange_url);
    // Like Wrangler, expansion is optional: a failed provider-edge exchange
    // retains the original session token. This never retries native SQL.
    try {
      const expanded = await edge(url.href);
      if (typeof expanded?.token === 'string' && expanded.token.length > 5) value = expanded.token;
      else exchangeFallback = true;
    } catch (error) {
      if (!(error instanceof PreviewStop) || !error.code.startsWith('PREVIEW_EDGE_')) throw error;
      exchangeFallback = true;
    }
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
  form.set('step2_reviewed_oauth_plan_20261114.mjs', new Blob([planSource], { type: 'application/javascript+module' }), 'step2_reviewed_oauth_plan_20261114.mjs');
  form.set('wrangler-session-config', JSON.stringify({ workers_dev: true, minimal_mode: false }));
  const uploaded = result(await api('recovery', 'POST', ACCOUNT_BASE + '/workers/scripts/' + name + '/edge-preview', form, value));
  check(typeof uploaded?.preview_token === 'string' && uploaded.preview_token.length > 5, 'PREVIEW_UPLOAD_TOKEN_UNAVAILABLE');
  return { host, token: uploaded.preview_token, exchangeFallback };
}
export async function ensurePreviewSubdomain(api, receipt, record) {
  const path = ACCOUNT_BASE + '/workers/subdomain';
  try {
    const existing = result(await api('recovery', 'GET', path))?.subdomain;
    check(typeof existing === 'string' && /^[a-z0-9-]{1,63}$/.test(existing), 'EXISTING_PREVIEW_SUBDOMAIN_INVALID');
    receipt.existing_recovery_subdomain_preserved = true; record(); return;
  } catch (error) {
    // Missing registration is distinct from authentication/permission failure.
    const missing = error instanceof PreviewStop &&
      ['RECOVERY_API_HTTP_404', 'RECOVERY_API_HTTP_403'].includes(error.code) &&
      error.provider_error_codes?.length === 1 && [10007, 10063].includes(error.provider_error_codes[0]);
    if (!missing) throw error;
  }
  receipt.recovery_subdomain_registration_attempted = true;
  receipt.recovery_subdomain_registration_acknowledged = false; record();
  try {
    const registered = result(await api('recovery', 'PUT', path, { subdomain: RECOVERY_SUBDOMAIN }));
    check(registered?.subdomain === RECOVERY_SUBDOMAIN, 'RECOVERY_SUBDOMAIN_REGISTRATION_RESULT_MISMATCH');
    receipt.recovery_subdomain_registration_acknowledged = true;
  } catch (error) {
    if (!(error instanceof PreviewStop) || error.code !== 'API_TRANSPORT_OUTCOME_UNKNOWN') throw error;
    receipt.recovery_subdomain_registration_outcome_unknown = true;
  }
  // A lost write acknowledgement is reconciled by GET; the PUT is never retried.
  const current = result(await api('recovery', 'GET', path))?.subdomain;
  check(current === RECOVERY_SUBDOMAIN, 'RECOVERY_SUBDOMAIN_REGISTRATION_READBACK_MISMATCH');
  receipt.recovery_subdomain_registration_verified = true;
  receipt.recovery_subdomain_registration_retained_for_recovery = true; record();
}
export async function snapshot(api, transfer, inspect, pause, { role='recovery', base=TARGET_BASE }={}) {
  let body = { output_format: 'polling' }, bookmark;
  for (let i = 0; i < 40; i++) {
    const job = result(await api(role, 'POST', base + '/export', body));
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
export const same = (a, b) => a.catalog_sha256 === b.catalog_sha256 && a.user_data_sha256 === b.user_data_sha256 &&
  JSON.stringify(a.tables) === JSON.stringify(b.tables);
