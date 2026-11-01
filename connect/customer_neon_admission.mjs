/**
 * Non-deployed, synthetic-only PostgreSQL/Neon tenant admission seam.
 * The live Worker does not import this file. Requires separate auth, release,
 * connection lifecycle, role-grant and security reviews before any promotion.
 */
const TOKEN = /^mct_[A-Za-z0-9_-]{43}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SCOPES = new Set(['mining.plan', 'mining.risk']);
const SQL = 'SELECT accepted,code,authorized_tenant,daily_used FROM connect_qualification.admit($1::text,$2::text,$3::uuid)';
const error = (status,code) => ({ok:false,status,error:code});
const failClosed = () => error(503,'CUSTOMER_NEON_UNAVAILABLE');
const unauthorized = () => error(401,'UNAUTHORIZED');

export async function reserveNeonSyntheticCustomerRequest({authorization,scope,env,
  requestIdFactory=()=>crypto.randomUUID()}={}) {
  if (env?.CONNECT_NEON_MODE !== 'isolated-synthetic-only') return error(503,'CUSTOMER_NEON_DISABLED');
  const db = env?.CONNECT_NEON_DB;
  if (!db || typeof db.query !== 'function') return failClosed();
  if (!SCOPES.has(scope)) return error(403,'INSUFFICIENT_SCOPE');
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return unauthorized();
  const token = authorization.slice(7);
  if (!TOKEN.test(token)) return unauthorized();
  let requestId;
  try {requestId = requestIdFactory();} catch {return failClosed();}
  if (typeof requestId !== 'string' || !UUID_V4.test(requestId)) return failClosed();
  try {
    const digestBytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
    const digest = Array.from(new Uint8Array(digestBytes),b=>b.toString(16).padStart(2,'0')).join('');
    // Never interpolate a token, scope or UUID into SQL. Database time controls
    // window attribution; the DB function locks the tenant row before charging.
    const result=await db.query({text:SQL,values:[digest,scope,requestId]});
    if (!Array.isArray(result?.rows) || result.rows.length!==1) return failClosed();
    const row=result.rows[0];
    if (row?.accepted === false) {
      if (row.code==='UNAUTHORIZED' && row.authorized_tenant==null) return unauthorized();
      if (row.code==='CUSTOMER_QUOTA_EXCEEDED' || row.code==='CUSTOMER_MINUTE_QUOTA_EXCEEDED')
        return error(429,row.code);
      if (row.code==='REQUEST_ID_CONFLICT') return error(409,row.code);
      return failClosed();
    }
    if (row?.accepted!==true || row.code!=='ADMITTED' ||
        typeof row.authorized_tenant!=='string' ||
        !/^[a-z][a-z0-9_-]{2,63}$/.test(row.authorized_tenant) ||
        !/^(?:[1-9]\d*)$/.test(String(row.daily_used)) ||
        !Number.isSafeInteger(Number(row.daily_used))) return failClosed();
    const principal=Object.freeze({tenant_id:row.authorized_tenant,scope});
    return {ok:true,request_id:requestId,principal};
  } catch {return failClosed();}
}
