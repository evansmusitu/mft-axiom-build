/**
 * MUSITU Connect synthetic-only provisioning prototype.
 *
 * NO HTTP entrypoint, NO customer self-service, NO production Worker import,
 * NO actual customer accounts and NO Cloudflare credentials. This module is
 * disabled unless its explicit isolated-synthetic-only mode is configured.
 * Raw opaque tokens are returned once for an approved future secure delivery
 * flow; they are never persisted or emitted in error messages.
 */
const TENANT_ID = /^[a-z][a-z0-9_-]{2,63}$/;
const CREDENTIAL_ID = /^[a-z][a-z0-9_-]{2,63}$/;
const STRICT_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const SCOPES = new Set(['mining.plan', 'mining.risk']);
const failure = (status,error) => ({ok:false,status,error});
const disabled = () => failure(503,'PROVISIONING_DISABLED');
const unavailable = () => failure(503,'PROVISIONING_UNAVAILABLE');
const invalid = () => failure(400,'INVALID_PROVISIONING_INPUT');
const ready = env => env?.CONNECT_CUSTOMER_PROVISIONING_MODE === 'isolated-synthetic-only';
const database = env => env?.CONNECT_CUSTOMER_DB?.prepare;
const validLimit = n => Number.isSafeInteger(n) && n >= 1 && n <= 1_000_000;
const validTime = text => {
  if (typeof text !== 'string' || !STRICT_UTC.test(text)) return false;
  const ms = Date.parse(text);
  return Number.isFinite(ms) && new Date(ms).toISOString() === text.replace('Z','.000Z');
};
const validClock = n => Number.isSafeInteger(n) && Math.abs(n) <= 8640000000000000;
const digest = async token => {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
  return Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
};

export async function provisionOfflineTenant({env,tenantId,dailyLimit,minuteLimit}={}) {
  if (!ready(env)) return disabled();
  if (!database(env)) return unavailable();
  if (typeof tenantId !== 'string' || !TENANT_ID.test(tenantId) ||
      !validLimit(dailyLimit) || !validLimit(minuteLimit)) return invalid();
  try {
    const row = await env.CONNECT_CUSTOMER_DB.prepare(
      'INSERT INTO connect_customer_tenants (tenant_id,status,daily_limit,minute_limit) ' +
      "VALUES (?,'active',?,?) RETURNING tenant_id"
    ).bind(tenantId,dailyLimit,minuteLimit).first();
    if (!row || row.tenant_id !== tenantId) return unavailable();
    return {ok:true,tenant_id:tenantId};
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE constraint failed')) {
      return failure(409,'TENANT_ALREADY_EXISTS');
    }
    return unavailable();
  }
}

export async function issueOfflineCredential({env,tenantId,scopes,expiresAt,nowMs=Date.now()}={}) {
  if (!ready(env)) return disabled();
  if (!database(env)) return unavailable();
  if (typeof tenantId !== 'string' || !TENANT_ID.test(tenantId) ||
      !Array.isArray(scopes) || scopes.length < 1 || scopes.length > 2 ||
      new Set(scopes).size !== scopes.length || !scopes.every(s=>SCOPES.has(s)) ||
      !validTime(expiresAt) || !validClock(nowMs)) return invalid();
  const duration = Date.parse(expiresAt)-nowMs;
  if (duration < 60_000 || duration > 90*24*60*60*1000) return invalid();
  try {
    // This entropy comes directly from Web Crypto, never Math.random(), a
    // tenant identifier, the Axiom account key or a deterministic seed.
    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    const bearer_token = 'mct_' + btoa(String.fromCharCode(...secretBytes))
      .replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
    const tokenHash = await digest(bearer_token);
    const credential_id = 'cred_' + crypto.randomUUID().replaceAll('-','');
    const row = await env.CONNECT_CUSTOMER_DB.prepare(
      'INSERT INTO connect_customer_credentials ' +
      '(credential_id,tenant_id,token_sha256,status,expires_at,can_plan,can_risk) ' +
      "SELECT ?,tenant_id,?,'active',?,?,? FROM connect_customer_tenants " +
      "WHERE tenant_id=? AND status='active' RETURNING credential_id,tenant_id"
    ).bind(credential_id,tokenHash,expiresAt,
      scopes.includes('mining.plan')?1:0,scopes.includes('mining.risk')?1:0,
      tenantId).first();
    if (!row || row.credential_id !== credential_id || row.tenant_id !== tenantId) {
      return failure(403,'TENANT_NOT_ELIGIBLE');
    }
    return {ok:true,tenant_id:tenantId,credential_id,bearer_token};
  } catch {
    return unavailable();
  }
}

export async function revokeOfflineCredential({env,tenantId,credentialId}={}) {
  if (!ready(env)) return disabled();
  if (!database(env)) return unavailable();
  if (typeof tenantId !== 'string' || !TENANT_ID.test(tenantId) ||
      typeof credentialId !== 'string' || !CREDENTIAL_ID.test(credentialId)) return invalid();
  try {
    const row = await env.CONNECT_CUSTOMER_DB.prepare(
      "UPDATE connect_customer_credentials SET status='revoked' " +
      "WHERE tenant_id=? AND credential_id=? AND status!='revoked' RETURNING credential_id"
    ).bind(tenantId,credentialId).first();
    if (!row) return failure(404,'CREDENTIAL_NOT_FOUND');
    return {ok:true,credential_id:credentialId,status:'revoked'};
  } catch {return unavailable();}
}

export async function suspendOfflineTenant({env,tenantId}={}) {
  if (!ready(env)) return disabled();
  if (!database(env)) return unavailable();
  if (typeof tenantId !== 'string' || !TENANT_ID.test(tenantId)) return invalid();
  try {
    const row = await env.CONNECT_CUSTOMER_DB.prepare(
      "UPDATE connect_customer_tenants SET status='suspended' " +
      "WHERE tenant_id=? AND status='active' RETURNING tenant_id"
    ).bind(tenantId).first();
    if (!row) return failure(404,'TENANT_NOT_FOUND');
    return {ok:true,tenant_id:tenantId,status:'suspended'};
  } catch {return unavailable();}
}
