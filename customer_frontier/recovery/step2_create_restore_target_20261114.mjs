/** Create one isolated recovery target under the owner's 14-Nov instruction. */
import { audit } from '../qualification/step1_gate1_free_isolated_account_readonly_20261114.mjs';
import { createHash, createPublicKey } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ACCOUNT = '67469478aa9349fa0a57fe3a72da200a';
export const SOURCE_ACCOUNT = '93f395f5121954671f92fffa453d6b61';
export const SOURCE_DATABASE = 'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f';
export const RETIRED_DATABASE = 'c023a0a0-472a-4178-ad07-02f1d6b2e122';
export const NAME = 'axiom-idp-step1-disposable-restore-20261114-704a7351';
export const RECIPIENT_SHA256 = '704a7351da66a21e0b35df4880df194f1cf0e17b161246671288141beae7262c';
export const RECIPIENT_BASE64 = 'MCowBQYDK2VuAyEAwm0CzbVMIFxd6jNjMzNb0dM7cq/d67e/z865DzRMKVo=';
export const CATALOG_SQL = "SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV' ORDER BY type,name";
export const PREFIX = '/accounts/' + ACCOUNT;
export const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const FILE = 'hosted_restore_target_20261114.json';
const sha = data => createHash('sha256').update(data).digest('hex');

export class RecoveryStop extends Error {
  constructor(code) { super(code); this.code = code; }
}
function requireCheck(condition, code) {
  if (!condition) throw new RecoveryStop(code);
}
function envelope(document) {
  requireCheck(document && !Array.isArray(document) && document.success === true, 'PROVIDER_ENVELOPE_INVALID');
  return document.result;
}
function safeUuid(id) {
  return UUID.test(id ?? '') && ![SOURCE_DATABASE, RETIRED_DATABASE].includes(id);
}

/** Only target account metadata, one CREATE, and an empty-schema query are reachable. */
export function permitted(method, path, body) {
  const getPaths = [
    PREFIX,
    PREFIX + '/subscriptions',
    PREFIX + '/d1/database?page=1&per_page=100',
    PREFIX + '/workers/scripts',
    PREFIX + '/pages/projects?page=1&per_page=10',
  ];
  if (method === 'GET' && getPaths.includes(path) && body === undefined) return true;
  if (method === 'POST' && path === PREFIX + '/d1/database') {
    return body && Object.keys(body).join() === 'name' && body.name === NAME;
  }
  const match = path.match(new RegExp('^' + PREFIX + '/d1/database/([^/]+)(/query)?$'));
  if (!match || !safeUuid(match[1])) return false;
  if (method === 'GET' && !match[2] && body === undefined) return true;
  return method === 'POST' && match[2] === '/query' &&
    body && Object.keys(body).join() === 'sql' && body.sql === CATALOG_SQL;
}

export async function providerRequest(token, method, path, body) {
  requireCheck(typeof token === 'string' && token.length > 5 && !/[\r\n]/.test(token), 'RECOVERY_TOKEN_MISSING');
  requireCheck(permitted(method, path, body), 'REQUEST_OUTSIDE_TARGET_SCOPE');
  let response;
  try {
    response = await fetch('https://api.cloudflare.com/client/v4' + path, {
      method, redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch { throw new RecoveryStop('PROVIDER_REPLY_UNAVAILABLE'); }
  requireCheck(response.status === 200, 'PROVIDER_HTTP_' + response.status);
  const reader = response.body?.getReader();
  requireCheck(reader, 'PROVIDER_BODY_MISSING');
  const parts = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      requireCheck(length <= 400000, 'PROVIDER_RESPONSE_OVERSIZED');
      parts.push(Buffer.from(next.value));
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof RecoveryStop) throw error;
    throw new RecoveryStop('PROVIDER_BODY_INVALID');
  }
}

/** D1 inherits the Workers plan. A preexisting R2 subscription is a separate product. */
export function targetD1Plan(document) {
  const rows = envelope(document);
  requireCheck(Array.isArray(rows) && rows.length <= 1000, 'SUBSCRIPTIONS_INCOMPLETE');
  if (document.result_info?.total_count !== undefined) {
    requireCheck(document.result_info.total_count === rows.length, 'SUBSCRIPTIONS_TRUNCATED');
  }
  let unrelatedR2 = 0;
  for (const row of rows) {
    requireCheck(row && typeof row.state === 'string', 'SUBSCRIPTION_STATE_UNKNOWN');
    if (['Cancelled', 'Expired', 'Failed', 'Inactive', 'Free'].includes(row.state)) continue;
    const plan = row.rate_plan;
    requireCheck(row.state === 'Paid' && row.price === 0 && plan?.id === 'r2_paid' &&
      plan.currency === 'USD', 'WORKERS_OR_UNRECOGNIZED_ACTIVE_SUBSCRIPTION');
    unrelatedR2++;
  }
  return { workers_paid_subscription_absent: true, preexisting_r2_subscription_count: unrelatedR2 };
}

export async function bootstrap({ token, request = providerRequest, save = () => {} } = {}) {
  const receipt = {
    schema: 'musitu.axiom.hosted-restore-target.v1',
    observed_at_utc: new Date().toISOString(),
    source_account: SOURCE_ACCOUNT, source_database: SOURCE_DATABASE,
    target_account: ACCOUNT, target_name: NAME, owner_recipient_spki_sha256: RECIPIENT_SHA256,
    owner_gate1_confirmation_recorded: true,
    target_identity_verified: false, target_catalog_initially_empty: false,
    active_paid_subscriptions_absent: false, workers_paid_subscription_absent: false,
    preexisting_r2_subscription_count: 0, worker_and_pages_catalogs_empty: false,
    creation_attempted: false, target_uuid: null, target_creation_readback_verified: false,
    target_empty_schema_verified: false, creation_outcome: 'UNATTEMPTED',
    backup_export_completed: false, hosted_restore_completed: false,
    release_status: 'NOT_RELEASE', status: 'TARGET_PREFLIGHT_PENDING',
  };
  const call = (method, path, body) => request(token, method, path, body);
  save(receipt);
  try {
    requireCheck(typeof token === 'string' && token.length > 5 && !/[\r\n]/.test(token), 'RECOVERY_TOKEN_MISSING');
    const key = Buffer.from(RECIPIENT_BASE64, 'base64');
    requireCheck(sha(key) === RECIPIENT_SHA256 &&
      createPublicKey({ key, type: 'spki', format: 'der' }).asymmetricKeyType === 'x25519',
    'OWNER_PUBLIC_KEY_MISMATCH');
    let subscriptionReply;
    const observed = await audit({
      account: ACCOUNT, token,
      get: async path => {
        const response = await call('GET', path);
        if (path === PREFIX + '/subscriptions') subscriptionReply = response;
        return response;
      },
    });
    receipt.target_identity_verified = observed.account_identity_verified === true;
    receipt.target_catalog_initially_empty =
      observed.d1_catalog_complete === true && observed.d1_database_count === 0;
    receipt.active_paid_subscriptions_absent = observed.active_paid_subscriptions_absent === true;
    if (subscriptionReply) Object.assign(receipt, targetD1Plan(subscriptionReply));
    save(receipt);
    requireCheck(receipt.target_identity_verified && receipt.target_catalog_initially_empty &&
      receipt.workers_paid_subscription_absent, 'TARGET_ACCOUNT_PREFLIGHT_INCOMPLETE');

    const workers = envelope(await call('GET', PREFIX + '/workers/scripts'));
    requireCheck(Array.isArray(workers) && workers.length === 0, 'TARGET_HAS_WORKER_CONSUMERS');
    const pageReply = await call('GET', PREFIX + '/pages/projects?page=1&per_page=10');
    const pages = envelope(pageReply);
    const info = pageReply.result_info;
    requireCheck(Array.isArray(pages) && pages.length === 0 && info &&
      info.page === 1 && info.per_page === 10 && info.count === 0 && info.total_count === 0,
    'TARGET_PAGES_CATALOG_NOT_EMPTY_OR_COMPLETE');
    receipt.worker_and_pages_catalogs_empty = true;

    // Persist the attempt before the single POST. A lost reply earns UNKNOWN.
    receipt.creation_attempted = true;
    receipt.creation_outcome = 'UNKNOWN';
    receipt.status = 'SINGLE_CREATE_REQUEST_STARTING';
    save(receipt);
    const created = envelope(await call('POST', PREFIX + '/d1/database', { name: NAME }));
    requireCheck(created && created.name === NAME && safeUuid(created.uuid), 'CREATE_IDENTITY_UNQUALIFIED');
    receipt.target_uuid = created.uuid;
    receipt.creation_outcome = 'CREATED';
    save(receipt);
    const readback = envelope(await call('GET', PREFIX + '/d1/database/' + created.uuid));
    requireCheck(readback && readback.uuid === created.uuid && readback.name === NAME, 'TARGET_READBACK_DRIFT');
    receipt.target_creation_readback_verified = true;
    save(receipt);
    const schema = envelope(await call('POST', PREFIX + '/d1/database/' + created.uuid + '/query', { sql: CATALOG_SQL }));
    requireCheck(Array.isArray(schema) && schema.length === 1 && schema[0].success === true &&
      Array.isArray(schema[0].results) && schema[0].results.length === 0 &&
      schema[0].meta?.rows_written === 0 && schema[0].meta?.changed_db === false,
    'NEW_TARGET_EMPTY_SCHEMA_NOT_VERIFIED');
    receipt.target_empty_schema_verified = true;
    receipt.status = 'TARGET_CREATED_EMPTY_CONFIRMED';
  } catch (error) {
    receipt.status = receipt.creation_attempted ? 'TARGET_OPERATION_REQUIRES_RECONCILIATION' : 'TARGET_PREFLIGHT_STOPPED';
    receipt.error = error instanceof RecoveryStop ? error.code : 'UNEXPECTED_LOCAL_FAILURE';
  }
  save(receipt);
  return receipt;
}

function saveReceipt(receipt) {
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
  // Each save overwrites only this run's sanitized receipt in its disposable checkout.
  writeFileSync(FILE, bytes, { mode: 0o600 });
  writeFileSync(FILE + '.sha256', sha(bytes) + '  ' + FILE + '\n', { mode: 0o600 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await bootstrap({ token: process.env.AXIOM_D1_RECOVERY_CF_API_TOKEN, save: saveReceipt });
  console.log(result.status);
  console.log('creation_outcome=' + result.creation_outcome);
  console.log('target_uuid=' + (result.target_uuid ?? 'UNQUALIFIED'));
  if (result.error) console.log('error=' + result.error);
  process.exitCode = result.status === 'TARGET_CREATED_EMPTY_CONFIRMED' ? 0 : 2;
}
