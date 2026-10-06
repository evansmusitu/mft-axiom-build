import {createHash, randomBytes} from 'node:crypto';
import {readFile, stat, unlink, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {
  CLOUDFLARE_API,
  SUPPORT_ACCOUNT_ID,
  SUPPORT_BRANCH,
  cloudflareRequest,
  ensureSupportD1,
  selectCloudflareCredential,
} from './provision_cloudflare_d1.mjs';

export const SUPPORT_DOMAIN = 'support.mftintelligence.com';
export const SUPPORT_WORKER_NAME = 'musitu-axiom-support';
export const TURNSTILE_WIDGET_NAME = 'MUSITU Axiom Official Support';
const SITEKEY = /^[A-Za-z0-9_-]{20,100}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const VERIFIED_SEARCH_CRAWLER_RULE_REF = 'musitu_axiom_support_verified_search_crawlers';
const SEARCH_PUBLIC_PATHS = Object.freeze(['/', '/index.html', '/robots.txt', '/sitemap.xml', '/styles.css', '/app.js']);

export function buildVerifiedSearchCrawlerConfigRule() {
  const quotedPaths = SEARCH_PUBLIC_PATHS.map(path => JSON.stringify(path)).join(' ');
  return {
    ref: VERIFIED_SEARCH_CRAWLER_RULE_REF,
    description: 'Allow only verified search-engine crawlers to read the public MUSITU Axiom Support surface without zone-wide human challenges',
    expression: `(http.host eq "${SUPPORT_DOMAIN}" and cf.client.bot and cf.verified_bot_category eq "Search Engine Crawler" and http.request.method in {"GET" "HEAD"} and http.request.uri.path in {${quotedPaths}})`,
    action: 'set_config',
    action_parameters: {security_level: 'off', bic: false},
    enabled: true,
  };
}

export function mergeVerifiedSearchCrawlerConfigRule(existingRules = []) {
  if (!Array.isArray(existingRules)) throw new TypeError('configuration rules must be an array');
  const retained = existingRules.filter(rule => String(rule?.ref || '') !== VERIFIED_SEARCH_CRAWLER_RULE_REF);
  return [...retained, buildVerifiedSearchCrawlerConfigRule()];
}

export function buildVerifiedSearchCrawlerSkipRule() {
  const quotedPaths = SEARCH_PUBLIC_PATHS.map(path => JSON.stringify(path)).join(' ');
  return {
    ref: VERIFIED_SEARCH_CRAWLER_RULE_REF,
    description: 'Allow only Cloudflare-verified traditional search-engine crawlers to public MUSITU Axiom Official Support assets without human challenges',
    expression: `(http.host eq "${SUPPORT_DOMAIN}" and cf.client.bot and (cf.verified_bot_category eq "Search Engine Crawler" or http.user_agent contains "Google-InspectionTool") and http.request.method in {"GET" "HEAD"} and http.request.uri.path in {${quotedPaths}})`,
    action: 'skip',
    action_parameters: {products: ['bic', 'securityLevel']},
    enabled: true,
  };
}

export function mergeVerifiedSearchCrawlerSkipRule(existingRules = []) {
  if (!Array.isArray(existingRules)) throw new TypeError('custom WAF rules must be an array');
  const retained = existingRules.filter(rule => String(rule?.ref || '') !== VERIFIED_SEARCH_CRAWLER_RULE_REF);
  return [...retained, buildVerifiedSearchCrawlerSkipRule()];
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function safeErrorCodes(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.errors)) return [];
  return payload.errors.map(item => Number(item?.code)).filter(Number.isFinite).slice(0, 8);
}

export function buildBootstrapWorkerMetadata({databaseUuid, turnstileSitekey, ownerRef, approverRef}) {
  if (!/^[a-f0-9-]{36}$/i.test(String(databaseUuid || '')) || !SITEKEY.test(String(turnstileSitekey || ''))) throw new Error('invalid support bootstrap resource binding');
  if (ownerRef !== 'github:evansmusitu' || approverRef !== 'person:elvis-musitu') throw new Error('invalid approved support role binding');
  return {
    main_module: 'index.mjs',
    compatibility_date: '2026-10-05',
    bindings: [
      {type: 'd1', name: 'SUPPORT_DB', id: databaseUuid},
      {type: 'plain_text', name: 'ENVIRONMENT', text: 'bootstrap'},
      {type: 'plain_text', name: 'SUPPORT_DOMAIN', text: SUPPORT_DOMAIN},
      {type: 'plain_text', name: 'TURNSTILE_SITE_KEY', text: turnstileSitekey},
      {type: 'plain_text', name: 'SUPPORT_HUMAN_OWNER_REF', text: ownerRef},
      {type: 'plain_text', name: 'SUPPORT_INDEPENDENT_APPROVER_REF', text: approverRef},
      {type: 'plain_text', name: 'SUPPORT_READINESS_SHA256', text: ''},
    ],
  };
}

export function buildWorkerMultipart(source, metadata, boundary = `----MUSITUSupport${randomBytes(18).toString('hex')}`) {
  const chunks = [
    `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n`,
    source,
    `\r\n--${boundary}--\r\n`,
  ];
  return {boundary, body: Buffer.concat(chunks.map(value => Buffer.isBuffer(value) ? value : Buffer.from(value)))};
}

export async function uploadSupportBootstrapWorker({fetchImpl = fetch, headers, source, metadata}) {
  const {boundary, body} = buildWorkerMultipart(source, metadata);
  const response = await fetchImpl(`${CLOUDFLARE_API}/accounts/${SUPPORT_ACCOUNT_ID}/workers/scripts/${SUPPORT_WORKER_NAME}`, {
    method: 'PUT',
    headers: {...headers, 'content-type': `multipart/form-data; boundary=${boundary}`},
    body,
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok || payload?.success === false || payload?.result?.id !== SUPPORT_WORKER_NAME) {
    const error = new Error(`Cloudflare support Worker upload failed with HTTP ${response.status}; error_codes=${safeErrorCodes(payload).join(',') || 'none'}`);
    error.status = response.status;
    throw error;
  }
  await cloudflareRequest({
    fetchImpl,
    headers,
    path: `/accounts/${SUPPORT_ACCOUNT_ID}/workers/scripts/${SUPPORT_WORKER_NAME}/subdomain`,
    method: 'POST',
    body: {enabled: false, previews_enabled: false},
  });
}

function exactTurnstile(value) {
  const domains = Array.isArray(value?.domains) ? [...value.domains].sort() : [];
  const sitekey = String(value?.sitekey || '');
  const secret = String(value?.secret || '');
  if (value?.name !== TURNSTILE_WIDGET_NAME || value?.mode !== 'managed' || domains.length !== 1 || domains[0] !== SUPPORT_DOMAIN || !SITEKEY.test(sitekey) || secret.length < 20) {
    throw new Error('Turnstile support widget does not match the exact isolated configuration');
  }
  return {sitekey, secret};
}

export async function ensureSupportTurnstile({fetchImpl = fetch, headers}) {
  const list = await cloudflareRequest({fetchImpl, headers, path: `/accounts/${SUPPORT_ACCOUNT_ID}/challenges/widgets?page=1&per_page=1000`});
  const named = (Array.isArray(list.result) ? list.result : []).filter(row => row?.name === TURNSTILE_WIDGET_NAME);
  if (named.length > 1) throw new Error('multiple exact-name support Turnstile widgets exist; refusing ambiguous selection');
  let created = false;
  let sitekey;
  if (!named.length) {
    const result = await cloudflareRequest({
      fetchImpl,
      headers,
      path: `/accounts/${SUPPORT_ACCOUNT_ID}/challenges/widgets`,
      method: 'POST',
      body: {name: TURNSTILE_WIDGET_NAME, domains: [SUPPORT_DOMAIN], mode: 'managed', clearance_level: 'no_clearance'},
    });
    sitekey = exactTurnstile(result.result).sitekey;
    created = true;
  } else {
    sitekey = String(named[0]?.sitekey || '');
    if (!SITEKEY.test(sitekey)) throw new Error('existing support Turnstile widget has an invalid site key');
  }
  const detail = await cloudflareRequest({fetchImpl, headers, path: `/accounts/${SUPPORT_ACCOUNT_ID}/challenges/widgets/${encodeURIComponent(sitekey)}`});
  return {...exactTurnstile(detail.result), created};
}

function validateDestination(value, expectedEmail) {
  if (String(value?.email || '').toLowerCase() !== expectedEmail.toLowerCase() || !String(value?.id || '').trim()) {
    throw new Error('Cloudflare returned an invalid support destination address');
  }
  return {id: String(value.id), verified: Boolean(value.verified)};
}

export async function ensureSupportEmailDestination({fetchImpl = fetch, headers, email}) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!EMAIL.test(normalized)) throw new Error('approved support mailbox destination is invalid');
  const list = await cloudflareRequest({fetchImpl, headers, path: `/accounts/${SUPPORT_ACCOUNT_ID}/email/routing/addresses?page=1&per_page=100`});
  const matches = (Array.isArray(list.result) ? list.result : []).filter(row => String(row?.email || '').toLowerCase() === normalized);
  if (matches.length > 1) throw new Error('multiple exact support destination addresses exist; refusing ambiguous selection');
  if (matches.length === 1) return {...validateDestination(matches[0], normalized), created: false, fingerprint: sha256(normalized)};
  const result = await cloudflareRequest({
    fetchImpl,
    headers,
    path: `/accounts/${SUPPORT_ACCOUNT_ID}/email/routing/addresses`,
    method: 'POST',
    body: {email: normalized},
  });
  return {...validateDestination(result.result, normalized), created: true, fingerprint: sha256(normalized)};
}

export async function putWorkerSecret({fetchImpl = fetch, headers, name, value}) {
  if (!['SUPPORT_DATA_KEY_B64', 'TURNSTILE_SECRET_KEY'].includes(name) || String(value || '').length < 20) throw new Error('invalid isolated support secret binding request');
  const result = await cloudflareRequest({
    fetchImpl,
    headers,
    path: `/accounts/${SUPPORT_ACCOUNT_ID}/workers/scripts/${SUPPORT_WORKER_NAME}/secrets`,
    method: 'PUT',
    body: {name, text: value, type: 'secret_text'},
  });
  if (result?.result?.name !== name || result?.result?.type !== 'secret_text') throw new Error(`Cloudflare did not confirm support secret binding ${name}`);
}

export function buildPublicControlPlaneEvidence({database, turnstile, destination, authMode, env = process.env, now = new Date().toISOString()}) {
  return {
    schema: 'musitu.axiom.official-support-control-plane-provision.v1',
    recorded_at: now,
    repository: String(env.GITHUB_REPOSITORY || ''),
    branch: String(env.GITHUB_REF_NAME || ''),
    source_commit: String(env.GITHUB_SHA || ''),
    cloudflare_account_id: SUPPORT_ACCOUNT_ID,
    authentication_mode: authMode,
    d1: {name: database.name, uuid: database.uuid, created: database.created},
    turnstile: {sitekey: turnstile.sitekey, created: turnstile.created, exact_domain: SUPPORT_DOMAIN, mode: 'managed', secret_exposed: false, secret_stored: false},
    email_destination: {fingerprint_sha256: destination.fingerprint, created: destination.created, verified: destination.verified, status: destination.status || (destination.verified ? 'verified' : 'verification_required'), raw_address_recorded: false},
    owner_ref: String(env.SUPPORT_HUMAN_OWNER_REF || ''),
    independent_approver_ref: String(env.SUPPORT_INDEPENDENT_APPROVER_REF || ''),
    worker: {name: SUPPORT_WORKER_NAME, bootstrap_deployed: false, custom_domain_attached: false, workers_dev_enabled: false},
    support_data_key: {generated: false, exposed: false, stored: false},
    public_support_deployed: false,
    openai_surface_modified: false,
  };
}

async function destroyPrivateFile(path) {
  try {
    const info = await stat(path);
    if (info.isFile()) await writeFile(path, '', {encoding: 'utf8', mode: 0o600});
    await unlink(path);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function requireExecutionBoundary(env) {
  if (env.GITHUB_REF_NAME !== SUPPORT_BRANCH) throw new Error('control-plane provisioning may run only from the isolated support branch');
  if (env.SUPPORT_CONTROL_PLANE_CONFIRM !== 'PROVISION_MUSITU_AXIOM_SUPPORT_CONTROL_PLANE') throw new Error('support control-plane confirmation sentinel is missing');
  if (env.SUPPORT_HUMAN_OWNER_REF !== 'github:evansmusitu' || env.SUPPORT_INDEPENDENT_APPROVER_REF !== 'person:elvis-musitu') throw new Error('approved support owner and independent approver references are missing');
}

export async function prepare(env = process.env, fetchImpl = fetch) {
  requireExecutionBoundary(env);
  const sentinel = await readFile(new URL('../PROVISION_CLOUDFLARE_CONTROL_PLANE.authorized', import.meta.url), 'utf8');
  if (sentinel !== 'PROVISION_MUSITU_AXIOM_SUPPORT_CONTROL_PLANE\n') throw new Error('support control-plane authorization file is invalid');
  const credential = await selectCloudflareCredential({fetchImpl, env, preferGlobal: true});
  const database = await ensureSupportD1({fetchImpl, headers: credential.headers});
  const turnstile = await ensureSupportTurnstile({fetchImpl, headers: credential.headers});
  let destination;
  try {
    destination = await ensureSupportEmailDestination({fetchImpl, headers: credential.headers, email: env.SUPPORT_MAILBOX_DESTINATION});
  } catch (error) {
    if (error?.status !== 403) throw error;
    const normalized = String(env.SUPPORT_MAILBOX_DESTINATION || '').trim().toLowerCase();
    if (!EMAIL.test(normalized)) throw new Error('approved support mailbox destination is invalid');
    destination = {fingerprint: sha256(normalized), created: false, verified: false, status: 'api_permission_blocked'};
  }
  const publicEvidence = buildPublicControlPlaneEvidence({database, turnstile, destination, authMode: credential.mode, env});
  const privatePath = env.SUPPORT_PRIVATE_STATE || 'support-control-plane.private.json';
  const publicPath = env.SUPPORT_PUBLIC_EVIDENCE || 'support-control-plane.public.json';
  await writeFile(privatePath, `${JSON.stringify({database_uuid: database.uuid, turnstile_sitekey: turnstile.sitekey, turnstile_secret: turnstile.secret})}\n`, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  await writeFile(publicPath, `${JSON.stringify(publicEvidence, null, 2)}\n`, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  process.stdout.write(`${JSON.stringify({gate: 'MUSITU_AXIOM_SUPPORT_CONTROL_PLANE_PREPARED', d1_created: database.created, turnstile_created: turnstile.created, destination_created: destination.created, destination_verified: destination.verified, secrets_exposed: false, public_deployment: false})}\n`);
  return publicEvidence;
}

export async function finalize(env = process.env, fetchImpl = fetch) {
  requireExecutionBoundary(env);
  const privatePath = env.SUPPORT_PRIVATE_STATE || 'support-control-plane.private.json';
  const publicPath = env.SUPPORT_PUBLIC_EVIDENCE || 'support-control-plane.public.json';
  let state;
  let evidence;
  try {
    const info = await stat(privatePath);
    if ((info.mode & 0o077) !== 0) throw new Error('private support provisioning state permissions are unsafe');
    state = JSON.parse(await readFile(privatePath, 'utf8'));
    const credential = await selectCloudflareCredential({fetchImpl, env, preferGlobal: true});
    await cloudflareRequest({fetchImpl, headers: credential.headers, path: `/accounts/${SUPPORT_ACCOUNT_ID}/workers/scripts/${SUPPORT_WORKER_NAME}/settings`});
    await putWorkerSecret({fetchImpl, headers: credential.headers, name: 'TURNSTILE_SECRET_KEY', value: state.turnstile_secret});
    const dataKey = randomBytes(32).toString('base64');
    await putWorkerSecret({fetchImpl, headers: credential.headers, name: 'SUPPORT_DATA_KEY_B64', value: dataKey});
    const listed = await cloudflareRequest({fetchImpl, headers: credential.headers, path: `/accounts/${SUPPORT_ACCOUNT_ID}/workers/scripts/${SUPPORT_WORKER_NAME}/secrets`});
    const names = new Set((Array.isArray(listed.result) ? listed.result : []).map(row => row?.name));
    for (const name of ['SUPPORT_DATA_KEY_B64', 'TURNSTILE_SECRET_KEY']) if (!names.has(name)) throw new Error(`support secret binding readback failed for ${name}`);
    evidence = JSON.parse(await readFile(publicPath, 'utf8'));
    evidence.turnstile.secret_stored = true;
    evidence.support_data_key = {generated: true, exposed: false, stored: true};
    evidence.worker.bootstrap_deployed = true;
  } finally {
    await destroyPrivateFile(privatePath);
  }
  evidence.private_state_destroyed = true;
  await writeFile(publicPath, `${JSON.stringify(evidence, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  process.stdout.write(`${JSON.stringify({gate: 'MUSITU_AXIOM_SUPPORT_SECRETS_STORED', secret_names: ['SUPPORT_DATA_KEY_B64', 'TURNSTILE_SECRET_KEY'], secret_values_exposed: false})}\n`);
}

export async function uploadBootstrap(env = process.env, fetchImpl = fetch) {
  requireExecutionBoundary(env);
  const privatePath = env.SUPPORT_PRIVATE_STATE || 'support-control-plane.private.json';
  const publicPath = env.SUPPORT_PUBLIC_EVIDENCE || 'support-control-plane.public.json';
  const bundlePath = env.SUPPORT_WORKER_BUNDLE || 'support-worker.bootstrap.mjs';
  const state = JSON.parse(await readFile(privatePath, 'utf8'));
  const source = await readFile(bundlePath);
  const credential = await selectCloudflareCredential({fetchImpl, env, preferGlobal: true});
  const metadata = buildBootstrapWorkerMetadata({
    databaseUuid: state.database_uuid,
    turnstileSitekey: state.turnstile_sitekey,
    ownerRef: env.SUPPORT_HUMAN_OWNER_REF,
    approverRef: env.SUPPORT_INDEPENDENT_APPROVER_REF,
  });
  await uploadSupportBootstrapWorker({fetchImpl, headers: credential.headers, source, metadata});
  const evidence = JSON.parse(await readFile(publicPath, 'utf8'));
  evidence.worker.bootstrap_deployed = true;
  evidence.worker.upload_authentication_mode = credential.mode;
  evidence.worker.assets_attached = false;
  await writeFile(publicPath, `${JSON.stringify(evidence, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  process.stdout.write(`${JSON.stringify({gate: 'MUSITU_AXIOM_SUPPORT_BOOTSTRAP_WORKER_UPLOADED', worker: SUPPORT_WORKER_NAME, assets_attached: false, custom_domain_attached: false, workers_dev_enabled: false})}\n`);
}

export async function applySchema(env = process.env, fetchImpl = fetch) {
  requireExecutionBoundary(env);
  const publicPath = env.SUPPORT_PUBLIC_EVIDENCE || 'support-control-plane.public.json';
  const evidence = JSON.parse(await readFile(publicPath, 'utf8'));
  const databaseUuid = String(evidence?.d1?.uuid || '');
  const sql = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  const credential = await selectCloudflareCredential({fetchImpl, env, preferGlobal: true});
  const applied = await cloudflareRequest({
    fetchImpl,
    headers: credential.headers,
    path: `/accounts/${SUPPORT_ACCOUNT_ID}/d1/database/${databaseUuid}/query`,
    method: 'POST',
    body: {sql},
  });
  const results = Array.isArray(applied.result) ? applied.result : [];
  if (!results.length || results.some(row => row?.success === false)) throw new Error('support D1 schema application failed');
  const verification = await cloudflareRequest({
    fetchImpl,
    headers: credential.headers,
    path: `/accounts/${SUPPORT_ACCOUNT_ID}/d1/database/${databaseUuid}/query`,
    method: 'POST',
    body: {sql: "SELECT type,name FROM sqlite_schema WHERE name IN ('support_cases','support_case_events','support_case_event_no_update','support_case_event_no_delete') ORDER BY name"},
  });
  const objects = new Set(((Array.isArray(verification.result) ? verification.result[0]?.results : []) || []).map(row => row?.name));
  for (const name of ['support_cases', 'support_case_events', 'support_case_event_no_update', 'support_case_event_no_delete']) if (!objects.has(name)) throw new Error(`support D1 schema readback failed for ${name}`);
  evidence.d1.schema_applied = true;
  evidence.d1.schema_objects_verified = 4;
  evidence.d1.schema_authentication_mode = credential.mode;
  await writeFile(publicPath, `${JSON.stringify(evidence, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  process.stdout.write(`${JSON.stringify({gate: 'MUSITU_AXIOM_SUPPORT_D1_SCHEMA_PASS', schema_objects_verified: 4})}\n`);
}

export async function verifyIsolation(env = process.env, fetchImpl = fetch) {
  requireExecutionBoundary(env);
  const credential = await selectCloudflareCredential({fetchImpl, env, preferGlobal: true});
  const domains = await cloudflareRequest({fetchImpl, headers: credential.headers, path: `/accounts/${SUPPORT_ACCOUNT_ID}/workers/domains`});
  if ((Array.isArray(domains.result) ? domains.result : []).some(row => row?.hostname === SUPPORT_DOMAIN)) throw new Error('support custom domain was attached during non-public bootstrap');
  const subdomain = await cloudflareRequest({fetchImpl, headers: credential.headers, path: `/accounts/${SUPPORT_ACCOUNT_ID}/workers/scripts/${SUPPORT_WORKER_NAME}/subdomain`});
  if (subdomain?.result?.enabled !== false) throw new Error('support workers.dev exposure is enabled during non-public bootstrap');
  const publicPath = env.SUPPORT_PUBLIC_EVIDENCE || 'support-control-plane.public.json';
  const evidence = JSON.parse(await readFile(publicPath, 'utf8'));
  evidence.worker.bootstrap_isolation_verified = true;
  evidence.worker.custom_domain_attached = false;
  evidence.worker.workers_dev_enabled = false;
  evidence.public_support_deployed = false;
  evidence.verification_completed_at = new Date().toISOString();
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  const digest = sha256(serialized);
  await writeFile(publicPath, serialized, {encoding: 'utf8', mode: 0o600});
  await writeFile(`${publicPath}.sha256`, `${digest}  ${publicPath}\n`, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  process.stdout.write(`${JSON.stringify({gate: 'MUSITU_AXIOM_SUPPORT_CONTROL_PLANE_BOOTSTRAP_PASS', evidence_sha256: digest, destination_verified: evidence.email_destination.verified, secret_values_exposed: false, public_deployment: false})}\n`);
  return evidence;
}

export async function main(env = process.env, fetchImpl = fetch) {
  const action = process.argv[2];
  if (action === 'prepare') return prepare(env, fetchImpl);
  if (action === 'upload-bootstrap') return uploadBootstrap(env, fetchImpl);
  if (action === 'finalize') return finalize(env, fetchImpl);
  if (action === 'apply-schema') return applySchema(env, fetchImpl);
  if (action === 'verify-isolation') return verifyIsolation(env, fetchImpl);
  throw new Error('expected prepare, upload-bootstrap, finalize, apply-schema, or verify-isolation action');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
