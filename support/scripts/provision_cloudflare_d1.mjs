import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const SUPPORT_ACCOUNT_ID = '93f395f5121954671f92fffa453d6b61';
export const SUPPORT_BRANCH = 'support/axiom-official-support-20261005';
export const SUPPORT_DATABASE_NAME = 'musitu-axiom-support';
export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function cloudflareCredentialCandidates(env = process.env) {
  const candidates = [];
  const token = String(env.CLOUDFLARE_API_TOKEN || '').trim();
  const email = String(env.CLOUDFLARE_EMAIL || '').trim();
  const globalKey = String(env.CLOUDFLARE_GLOBAL_API_KEY || '').trim();
  const common = {'accept': 'application/json', 'user-agent': 'MUSITU-Axiom-Official-Support-Provision/1.0'};
  if (token) candidates.push({mode: 'api_token', headers: {...common, authorization: `Bearer ${token}`}});
  if (email && globalKey) candidates.push({mode: 'global_api_key', headers: {...common, 'x-auth-email': email, 'x-auth-key': globalKey}});
  return candidates;
}

function safeErrorCodes(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.errors)) return [];
  return payload.errors.map(item => Number(item?.code)).filter(Number.isFinite).slice(0, 8);
}

async function decode(response) {
  try { return await response.json(); }
  catch { return {}; }
}

export async function cloudflareRequest({fetchImpl = fetch, headers, path, method = 'GET', body}) {
  const response = await fetchImpl(`${CLOUDFLARE_API}${path}`, {
    method,
    headers: {...headers, ...(body === undefined ? {} : {'content-type': 'application/json'})},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await decode(response);
  if (!response.ok || payload?.success === false) {
    const error = new Error(`Cloudflare ${method} ${path} failed with HTTP ${response.status}; error_codes=${safeErrorCodes(payload).join(',') || 'none'}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function selectCloudflareCredential({fetchImpl = fetch, env = process.env} = {}) {
  const candidates = cloudflareCredentialCandidates(env);
  if (!candidates.length) throw new Error('no configured Cloudflare credential candidate');
  const failures = [];
  for (const candidate of candidates) {
    try {
      await cloudflareRequest({
        fetchImpl,
        headers: candidate.headers,
        path: `/accounts/${SUPPORT_ACCOUNT_ID}/workers/subdomain`,
      });
      return candidate;
    } catch (error) {
      failures.push(`${candidate.mode}:HTTP_${Number(error?.status) || 0}`);
    }
  }
  throw new Error(`no usable Cloudflare credential; attempts=${failures.join(',')}`);
}

export async function listD1Databases({fetchImpl = fetch, headers}) {
  const rows = [];
  const perPage = 100;
  for (let page = 1; page <= 100; page += 1) {
    const payload = await cloudflareRequest({
      fetchImpl,
      headers,
      path: `/accounts/${SUPPORT_ACCOUNT_ID}/d1/database?page=${page}&per_page=${perPage}`,
    });
    const batch = Array.isArray(payload.result) ? payload.result : [];
    rows.push(...batch);
    const total = Number(payload?.result_info?.total_count);
    if (batch.length < perPage || (Number.isFinite(total) && rows.length >= total)) return rows;
  }
  throw new Error('Cloudflare D1 listing exceeded the bounded pagination limit');
}

function validateDatabase(value) {
  const uuid = String(value?.uuid || '').trim();
  const name = String(value?.name || '').trim();
  if (name !== SUPPORT_DATABASE_NAME || !UUID.test(uuid)) throw new Error('Cloudflare returned an invalid support D1 resource');
  return {name, uuid};
}

export async function ensureSupportD1({fetchImpl = fetch, headers}) {
  const rows = await listD1Databases({fetchImpl, headers});
  const matches = rows.filter(row => row?.name === SUPPORT_DATABASE_NAME);
  if (matches.length > 1) throw new Error('multiple exact-name support D1 databases exist; refusing ambiguous selection');
  if (matches.length === 1) return {...validateDatabase(matches[0]), created: false};
  const payload = await cloudflareRequest({
    fetchImpl,
    headers,
    path: `/accounts/${SUPPORT_ACCOUNT_ID}/d1/database`,
    method: 'POST',
    body: {name: SUPPORT_DATABASE_NAME},
  });
  return {...validateDatabase(payload.result), created: true};
}

export function buildPublicProvisionEvidence({authMode, database, env = process.env, now = new Date().toISOString()}) {
  return {
    schema: 'musitu.axiom.official-support-cloudflare-provision.v1',
    recorded_at: now,
    repository: String(env.GITHUB_REPOSITORY || ''),
    branch: String(env.GITHUB_REF_NAME || ''),
    source_commit: String(env.GITHUB_SHA || ''),
    cloudflare_account_id: SUPPORT_ACCOUNT_ID,
    authentication_mode: authMode,
    d1: {name: database.name, uuid: database.uuid, created: database.created},
    secrets_exposed: false,
    turnstile_secret_created: false,
    encryption_key_created: false,
    public_support_deployed: false,
    openai_surface_modified: false,
  };
}

export async function main(env = process.env, fetchImpl = fetch) {
  if (env.GITHUB_REF_NAME !== SUPPORT_BRANCH) throw new Error('support provisioning may run only from the isolated support branch');
  if (env.SUPPORT_CLOUDFLARE_CONFIRM !== 'PROVISION_MUSITU_AXIOM_SUPPORT_D1') throw new Error('support D1 provisioning confirmation sentinel is missing');
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCOUNT_ID !== SUPPORT_ACCOUNT_ID) throw new Error('configured Cloudflare account does not match the isolated support account');
  const sentinel = await readFile(new URL('../PROVISION_CLOUDFLARE_D1.authorized', import.meta.url), 'utf8');
  if (sentinel !== 'PROVISION_MUSITU_AXIOM_SUPPORT_D1\n') throw new Error('support D1 authorization file is invalid');
  const credential = await selectCloudflareCredential({fetchImpl, env});
  const database = await ensureSupportD1({fetchImpl, headers: credential.headers});
  const evidence = buildPublicProvisionEvidence({authMode: credential.mode, database, env});
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  const digest = createHash('sha256').update(serialized).digest('hex');
  const output = env.SUPPORT_PROVISION_OUTPUT || 'musitu-axiom-support-cloudflare-provision.json';
  await writeFile(output, serialized, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  await writeFile(`${output}.sha256`, `${digest}  ${output}\n`, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  process.stdout.write(`${JSON.stringify({gate: 'MUSITU_AXIOM_SUPPORT_D1_PROVISIONED', d1: evidence.d1, authentication_mode: evidence.authentication_mode, evidence_sha256: digest, secrets_exposed: false})}\n`);
  return evidence;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
