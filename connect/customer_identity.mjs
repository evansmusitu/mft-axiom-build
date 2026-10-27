/**
 * MUSITU Connect — isolated customer-authentication contract (not enabled).
 *
 * Not imported by production_worker.mjs: this module is a future tenant
 * identity seam ONLY. Do not interpret a passing test as customer admission.
 *
 * Cloudflare secret binding CONNECT_CUSTOMER_CREDENTIALS_JSON must contain a
 * canonical JSON array of records with opaque-token SHA-256 fingerprints, not
 * bearer tokens. The bearer is mct_ plus 43 base64url characters generated
 * from 32 bytes of cryptographically secure randomness by an approved issuer.
 * This module neither generates nor distributes customer credentials.
 */
const ID = /^[a-z][a-z0-9_-]{2,63}$/;
const TOKEN = /^mct_[A-Za-z0-9_-]{43}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const EXPECTED_KEYS = ['credential_id', 'expires_at', 'scopes', 'status', 'tenant_id', 'token_sha256'];
const SCOPES = new Set(['mining.plan', 'mining.risk']);
const STATUSES = new Set(['active', 'revoked', 'suspended']);
const disabled = () => ({ok:false, status:503, error:'CUSTOMER_AUTH_DISABLED'});
const invalidConfig = () => ({ok:false, status:503, error:'CUSTOMER_AUTH_INVALID_CONFIGURATION'});
const unauthorized = () => ({ok:false, status:401, error:'UNAUTHORIZED'});

function validTime(value) {
  if (typeof value !== 'string' || !ISO_TIME.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().replace('.000Z', 'Z') === value;
}

function validateConfig(input) {
  if (typeof input !== 'string' || input.length < 2 || input.length > 100_000) return null;
  let records;
  try {
    records = JSON.parse(input);
    // Disallow duplicate JSON object keys and ambiguous encodings. Provisioners
    // must use JSON.stringify to construct canonical secret configuration.
    if (JSON.stringify(records) !== input) return null;
  } catch {
    return null;
  }
  if (!Array.isArray(records) || records.length < 1 || records.length > 64) return null;
  const seenHashes = new Set();
  const seenIds = new Set();
  for (const rec of records) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
    if (Object.keys(rec).sort().join(',') !== EXPECTED_KEYS.join(',')) return null;
    if (typeof rec.credential_id !== 'string' || !ID.test(rec.credential_id)
        || typeof rec.tenant_id !== 'string' || !ID.test(rec.tenant_id)) return null;
    if (typeof rec.token_sha256 !== 'string' || !SHA256.test(rec.token_sha256)) return null;
    if (!Array.isArray(rec.scopes) || rec.scopes.length < 1 || rec.scopes.length > SCOPES.size
        || new Set(rec.scopes).size !== rec.scopes.length
        || !rec.scopes.every(scope => SCOPES.has(scope))) return null;
    if (!STATUSES.has(rec.status) || !validTime(rec.expires_at)) return null;
    if (seenHashes.has(rec.token_sha256) || seenIds.has(rec.credential_id)) return null;
    seenHashes.add(rec.token_sha256);
    seenIds.add(rec.credential_id);
  }
  return records;
}

function equalHexDigest(left, right) {
  if (!SHA256.test(left) || !SHA256.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < 64; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function digestToken(token) {
  const bytes = new TextEncoder().encode(token);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Resolve an independently issued customer credential into a server-derived
 * principal, without exposing token, hash or upstream Axiom account identity.
 *
 * This does not perform rate limiting, persistence, billing or tenant-specific
 * resource access; those remain separate BLOCKED release requirements.
 */
export async function verifyConnectCustomerBearer({authorization, requiredScope, env, nowMs=Date.now()} = {}) {
  if (env?.CONNECT_CUSTOMER_AUTH_ENABLED !== 'true') return disabled();
  const records = validateConfig(env?.CONNECT_CUSTOMER_CREDENTIALS_JSON);
  if (!records || !Number.isSafeInteger(nowMs)) return invalidConfig();
  if (!SCOPES.has(requiredScope)) {
    return {ok:false, status:403, error:'INSUFFICIENT_SCOPE'};
  }
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return unauthorized();
  const token = authorization.slice(7);
  if (!TOKEN.test(token)) return unauthorized();
  let digest;
  try { digest = await digestToken(token); }
  catch { return invalidConfig(); }
  let selected = null;
  // Always scan all records. Do not shortcut on a hash match or status.
  for (const rec of records) {
    if (equalHexDigest(digest, rec.token_sha256)) selected = rec;
  }
  if (!selected || selected.status !== 'active' || Date.parse(selected.expires_at) <= nowMs) {
    return unauthorized();
  }
  if (!selected.scopes.includes(requiredScope)) {
    return {ok:false, status:403, error:'INSUFFICIENT_SCOPE'};
  }
  return {ok:true, principal:{
    tenant_id:selected.tenant_id, credential_id:selected.credential_id, scope:requiredScope,
  }};
}
