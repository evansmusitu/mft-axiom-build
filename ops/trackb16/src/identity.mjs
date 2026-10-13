// S0 only. A SINGLE deterministic named Durable Object per configured account/day.
// The requester NEVER controls its bucket key. Day derives only from trusted UTC clock.
const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PREFIX = 'axiom.quota.b16.v1:';
export class ScopeDenied extends Error {
  constructor(code) { super(code); this.name='ScopeDenied'; this.code=code; }
}
export function utcDay(timeMillis=Date.now()) {
  if (!Number.isFinite(timeMillis) || timeMillis<0 || timeMillis>8.64e15)
    throw new ScopeDenied('INVALID_TRUSTED_CLOCK');
  return new Date(timeMillis).toISOString().slice(0,10);
}
export function canonicalName(accountId,day) {
  if (typeof accountId!=='string'||!ACCOUNT.test(accountId))
    throw new ScopeDenied('INVALID_CONFIGURED_ACCOUNT');
  if (typeof day!=='string'||!DAY.test(day) || !Number.isFinite(Date.parse(day+'T00:00:00Z')) ||
      new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)
    throw new ScopeDenied('INVALID_UTC_DAY');
  return PREFIX+accountId+':'+day;
}
export function requireCanonicalObject(objectName,configuredAccount,nowMillis=Date.now()) {
  const today=utcDay(nowMillis);
  if (typeof objectName!=='string' || objectName!==canonicalName(configuredAccount,today))
    throw new ScopeDenied('NONCANONICAL_DURABLE_OBJECT');
  return today;
}
// Trusted internal broker only. Never accept request-supplied object names or ids.
// This helper is deliberately not reachable from the disabled public fetch route.
export function routeQuota(trustedEnv, trustedMillis=Date.now()) {
  if (!trustedEnv || typeof trustedEnv !== 'object' ||
      typeof trustedEnv.AXIOM_QUOTA_S0?.getByName !== 'function')
    throw new ScopeDenied('TRUSTED_BINDING_UNAVAILABLE');
  const name=canonicalName(trustedEnv.AXIOM_ACCOUNT_ID,utcDay(trustedMillis));
  const stub=trustedEnv.AXIOM_QUOTA_S0.getByName(name);
  // Cloudflare guarantees stub.name for getByName(); reject a substituted or
  // name-less stub even if its RPC shape looks otherwise valid.
  if (stub && (stub.name !== name || (stub.id?.name !== undefined && stub.id.name !== name)))
    throw new ScopeDenied('NONCANONICAL_QUOTA_STUB');
  if (!stub || typeof stub.reserve !== 'function' || typeof stub.revoke !== 'function')
    throw new ScopeDenied('QUOTA_STUB_UNAVAILABLE');
  return stub;
}
