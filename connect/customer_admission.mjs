/**
 * Isolated, non-deployed MUSITU Connect tenant admission for SQLite/D1.
 * This module is not imported by the live production Worker. It is a technical
 * prototype; no customer provisioning, pricing, or launch is authorized.
 */
const TOKEN = /^mct_[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SCOPES = new Set(['mining.plan', 'mining.risk']);
const capabilities = new WeakSet();
const failure = (status,error) => ({ok:false,status,error});
const unavailable = () => failure(503,'CUSTOMER_RUNTIME_UNAVAILABLE');
const unauthorized = () => failure(401,'UNAUTHORIZED');
const validClock = n => Number.isSafeInteger(n) && Math.abs(n) <= 8640000000000000;

const ADMIT_SQL = `
INSERT INTO connect_customer_usage_events
  (tenant_id, credential_id, request_id, scope, utc_day, observed_at)
SELECT c.tenant_id, c.credential_id, ?, ?, ?, ?
FROM connect_customer_credentials c
JOIN connect_customer_tenants t ON t.tenant_id=c.tenant_id
WHERE c.token_sha256=? AND c.status='active' AND t.status='active'
  AND (CASE ? WHEN 'mining.plan' THEN c.can_plan ELSE c.can_risk END)=1
  AND unixepoch(c.expires_at)>?
RETURNING tenant_id, credential_id, request_id, scope`;

const READ_SQL = `
SELECT t.tenant_id AS tenant_id, ? AS utc_day, COALESCE(d.used,0) AS used,
       t.daily_limit AS daily_limit
FROM connect_customer_tenants t
JOIN connect_customer_credentials c ON c.tenant_id=t.tenant_id
LEFT JOIN connect_customer_daily_usage d ON d.tenant_id=t.tenant_id AND d.utc_day=?
WHERE t.tenant_id=? AND c.credential_id=? AND t.status='active'
  AND c.status='active'
  AND (CASE ? WHEN 'mining.plan' THEN c.can_plan ELSE c.can_risk END)=1
  AND unixepoch(c.expires_at)>?`;

async function tokenDigest(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Called only with route-selected scope, never a client-supplied tenant ID.
 * Quota/event updates occur in one DB statement with atomic SQL triggers.
 * Admission reserves one quota unit even if downstream computation later fails;
 * customer billing and refund policy are deliberately outside this prototype.
 * requestIdFactory exists for offline collision tests; do not bind it to HTTP.
 */
export async function reserveConnectCustomerRequest({authorization, scope, env,
  nowMs=Date.now(), requestIdFactory=()=>crypto.randomUUID()} = {}) {
  if (env?.CONNECT_CUSTOMER_RUNTIME_ENABLED !== 'true') {
    return failure(503,'CUSTOMER_RUNTIME_DISABLED');
  }
  const db = env?.CONNECT_CUSTOMER_DB;
  if (!db || typeof db.prepare !== 'function' || !validClock(nowMs)) return unavailable();
  if (!SCOPES.has(scope)) return failure(403,'INSUFFICIENT_SCOPE');
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return unauthorized();
  const token = authorization.slice(7);
  if (!TOKEN.test(token)) return unauthorized();
  let requestId;
  try { requestId = requestIdFactory(); }
  catch { return unavailable(); }
  if (typeof requestId !== 'string' || !UUID.test(requestId)) return unavailable();

  const date = new Date(nowMs);
  const utcDay = date.toISOString().slice(0,10);
  try {
    const digest = await tokenDigest(token);
    const row = await db.prepare(ADMIT_SQL).bind(
      requestId,scope,utcDay,date.toISOString(),digest,scope,Math.floor(nowMs/1000),
    ).first();
    if (!row) return unauthorized();
    if (typeof row.tenant_id !== 'string' || typeof row.credential_id !== 'string'
        || row.request_id !== requestId || row.scope !== scope) return unavailable();
    const principal = Object.freeze({tenant_id:row.tenant_id,
      credential_id:row.credential_id, scope:row.scope});
    capabilities.add(principal);
    return {ok:true,request_id:requestId,principal};
  } catch (e) {
    const detail = String(e?.message || '');
    if (detail.includes('CUSTOMER_MINUTE_QUOTA_EXCEEDED')) return failure(429,'CUSTOMER_MINUTE_QUOTA_EXCEEDED');
    if (detail.includes('CUSTOMER_QUOTA_EXCEEDED')) return failure(429,'CUSTOMER_QUOTA_EXCEEDED');
    if (detail.includes('CUSTOMER_AUTH_REVOKED')) return unauthorized();
    if (detail.includes('UNIQUE constraint failed: connect_customer_usage_events.tenant_id, connect_customer_usage_events.request_id')) {
      return failure(409,'REQUEST_ID_CONFLICT');
    }
    return unavailable();
  }
}

/** Read only an authenticated capability's tenant usage; never accept a client tenant_id. */
export async function readConnectCustomerUsage({db, principal, utcDay, nowMs=Date.now()}={}) {
  if (!principal || typeof principal !== 'object' || !capabilities.has(principal)) return unauthorized();
  if (!db || typeof db.prepare !== 'function' || !validClock(nowMs)
      || typeof utcDay !== 'string' || !UTC_DAY.test(utcDay)) return unavailable();
  const dayEpoch = Date.parse(utcDay + 'T00:00:00Z');
  if (!Number.isFinite(dayEpoch) || new Date(dayEpoch).toISOString().slice(0,10) !== utcDay) return unavailable();
  try {
    const row = await db.prepare(READ_SQL).bind(
      utcDay,utcDay,principal.tenant_id,principal.credential_id,
      principal.scope,Math.floor(nowMs/1000),
    ).first();
    if (!row) return unauthorized();
    return {ok:true,tenant_id:row.tenant_id,utc_day:utcDay,
      used:row.used,daily_limit:row.daily_limit};
  } catch { return unavailable(); }
}
