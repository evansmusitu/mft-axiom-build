const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
});

const SESSION_TTL_SECONDS = 600;
const APP_ASSERTION_TTL_SECONDS = 180;
const MAX_AUDIT_EVENTS = 64;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function b64url(bytes) {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function unb64url(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(value).length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

async function sha256(value) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(String(value)))));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

async function safeSecretEqual(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([sha256(left), sha256(right)]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signToken(secret, payload) {
  const header = b64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'axiom-enterprise-sso-v1' })));
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  return `${header}.${body}.${await hmac(secret, `${header}.${body}`)}`;
}

async function verifyToken(secret, token, expectedType) {
  const pieces = String(token || '').split('.');
  if (pieces.length !== 3) throw new Error('malformed_token');
  const expected = await hmac(secret, `${pieces[0]}.${pieces[1]}`);
  if (!(await safeSecretEqual(expected, pieces[2]))) throw new Error('invalid_signature');
  let payload;
  try { payload = JSON.parse(decoder.decode(unb64url(pieces[1]))); } catch { throw new Error('invalid_payload'); }
  const now = Math.floor(Date.now() / 1000);
  if (payload.typ !== expectedType || !Number.isFinite(payload.exp) || payload.exp <= now) throw new Error('expired_or_wrong_type');
  return payload;
}

function credential(request, scheme) {
  const header = String(request.headers.get('authorization') || '');
  const prefix = `${scheme} `;
  return header.startsWith(prefix) ? header.slice(prefix.length).trim() : '';
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function cleanStrings(value, max = 32) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(x => String(x || '').trim()).filter(Boolean))].slice(0, max);
}

function validIdentifier(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(String(value || ''));
}

async function requireAdmin(request, env) {
  return safeSecretEqual(String(request.headers.get('x-axiom-admin-key') || ''), String(env.ENTERPRISE_ADMIN_KEY || ''));
}

async function appendAudit(env, session, type, details = {}) {
  const events = Array.isArray(session.audit_events) ? session.audit_events : [];
  const previous = events.length ? events[events.length - 1].event_hash : null;
  const eventBody = {
    seq: events.length + 1,
    sid: session.sid,
    type,
    at: new Date().toISOString(),
    previous_event_hash: previous,
    details,
  };
  const event = { ...eventBody, event_hash: await sha256(canonical(eventBody)) };
  session.audit_events = [...events, event].slice(-MAX_AUDIT_EVENTS);
  session.audit_head = event.event_hash;
  await env.ENTERPRISE_STATE.put(`session:${session.sid}`, JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS + 300 });
  return event;
}

async function loadSession(env, sid) {
  if (!validIdentifier(sid)) return null;
  const raw = await env.ENTERPRISE_STATE.get(`session:${sid}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function validateExternalIdentity(request, env) {
  const accessToken = credential(request, 'Bearer');
  if (!accessToken) return { ok: false, status: 401, error: 'missing_identity_token' };
  const endpoint = String(env.OIDC_USERINFO_URL || '');
  if (!endpoint.startsWith('https://')) return { ok: false, status: 503, error: 'identity_provider_not_configured' };
  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', 'user-agent': 'MUSITU-Axiom-Enterprise-SSO/1.0' },
    });
  } catch {
    return { ok: false, status: 503, error: 'identity_provider_unreachable' };
  }
  if (upstream.status !== 200) return { ok: false, status: 401, error: 'identity_rejected' };
  let identity;
  try { identity = await upstream.json(); } catch { return { ok: false, status: 502, error: 'identity_response_invalid' }; }
  const subject = String(identity.sub || '');
  if (!validIdentifier(subject)) return { ok: false, status: 401, error: 'identity_subject_invalid' };
  return { ok: true, subject, email: String(identity.email || ''), email_verified: identity.email_verified === true };
}

async function configureMembership(request, env) {
  if (!(await requireAdmin(request, env))) return response(403, { error: 'admin_denied' });
  const body = await readJson(request);
  if (!body || !validIdentifier(body.subject) || !validIdentifier(body.organization_id)) return response(400, { error: 'invalid_membership' });
  const roles = cleanStrings(body.roles);
  const projectScopes = cleanStrings(body.project_scopes);
  const apps = cleanStrings(body.apps);
  if (!roles.length || !projectScopes.length || apps.length < 2 || ![...roles, ...projectScopes, ...apps].every(validIdentifier)) {
    return response(400, { error: 'membership_scope_invalid' });
  }
  const policyBody = {
    subject: String(body.subject),
    organization_id: String(body.organization_id),
    roles,
    project_scopes: projectScopes,
    apps,
    enabled: body.enabled !== false,
    policy_version: String(body.policy_version || 'enterprise-v1'),
  };
  const membership = { ...policyBody, policy_hash: await sha256(canonical(policyBody)), updated_at: new Date().toISOString() };
  await env.ENTERPRISE_STATE.put(`member:${membership.subject}`, JSON.stringify(membership));
  return response(200, { configured: true, subject: membership.subject, organization_id: membership.organization_id, policy_hash: membership.policy_hash });
}

async function removeMembership(request, env, subject) {
  if (!(await requireAdmin(request, env))) return response(403, { error: 'admin_denied' });
  if (!validIdentifier(subject)) return response(400, { error: 'invalid_subject' });
  await env.ENTERPRISE_STATE.delete(`member:${subject}`);
  return response(200, { removed: true, subject });
}

async function createSession(request, env) {
  const identity = await validateExternalIdentity(request, env);
  if (!identity.ok) return response(identity.status, { error: identity.error });
  const raw = await env.ENTERPRISE_STATE.get(`member:${identity.subject}`);
  if (!raw) return response(403, { error: 'enterprise_membership_required' });
  let membership;
  try { membership = JSON.parse(raw); } catch { return response(503, { error: 'enterprise_policy_invalid' }); }
  if (membership.enabled !== true) return response(403, { error: 'enterprise_membership_disabled' });
  const now = Math.floor(Date.now() / 1000);
  const sid = crypto.randomUUID();
  const session = {
    sid,
    subject: identity.subject,
    email: identity.email,
    organization_id: membership.organization_id,
    roles: membership.roles,
    project_scopes: membership.project_scopes,
    apps: membership.apps,
    policy_hash: membership.policy_hash,
    auth_time: now,
    created_at: new Date().toISOString(),
    expires_at: now + SESSION_TTL_SECONDS,
    revoked_at: null,
    primary_auth_events: 1,
    audit_events: [],
    audit_head: null,
  };
  const event = await appendAudit(env, session, 'PRIMARY_IDENTITY_AUTHENTICATED', { provider: String(env.OIDC_ISSUER || 'external-oidc'), primary_auth_events: 1 });
  const sessionToken = await signToken(String(env.SSO_SIGNING_KEY || ''), {
    typ: 'axiom_enterprise_sso_session', sid, sub: session.subject, org: session.organization_id,
    auth_time: now, iat: now, exp: session.expires_at, policy_hash: session.policy_hash,
  });
  return response(201, {
    sso_status: 'AUTHENTICATED',
    sid,
    session_token: sessionToken,
    organization_id: session.organization_id,
    roles: session.roles,
    project_scopes: session.project_scopes,
    auth_time: session.auth_time,
    primary_auth_events: 1,
    audit_event_hash: event.event_hash,
  });
}

async function activeSessionFromToken(request, env) {
  const token = credential(request, 'Axiom-SSO');
  if (!token) return { ok: false, status: 401, error: 'missing_sso_session' };
  let claims;
  try { claims = await verifyToken(String(env.SSO_SIGNING_KEY || ''), token, 'axiom_enterprise_sso_session'); }
  catch { return { ok: false, status: 401, error: 'invalid_sso_session' }; }
  const session = await loadSession(env, claims.sid);
  const now = Math.floor(Date.now() / 1000);
  if (!session || session.subject !== claims.sub || session.organization_id !== claims.org || session.policy_hash !== claims.policy_hash) return { ok: false, status: 401, error: 'session_state_mismatch' };
  if (session.revoked_at || Number(session.expires_at || 0) <= now) return { ok: false, status: 401, error: 'session_revoked_or_expired' };
  return { ok: true, token, claims, session };
}

async function exchangeSession(request, env) {
  const current = await activeSessionFromToken(request, env);
  if (!current.ok) return response(current.status, { error: current.error });
  const body = await readJson(request);
  const appId = String(body?.app_id || '');
  if (!validIdentifier(appId) || !current.session.apps.includes(appId)) return response(403, { error: 'relying_app_denied' });
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signToken(String(env.SSO_SIGNING_KEY || ''), {
    typ: 'axiom_enterprise_app_assertion', sid: current.session.sid, sub: current.session.subject,
    org: current.session.organization_id, roles: current.session.roles, projects: current.session.project_scopes,
    aud: appId, auth_time: current.session.auth_time, iat: now, exp: now + APP_ASSERTION_TTL_SECONDS,
    policy_hash: current.session.policy_hash,
  });
  const event = await appendAudit(env, current.session, 'SSO_APP_EXCHANGE', { app_id: appId, reauthentication_required: false });
  return response(200, {
    sso_status: 'VERIFIED', app_id: appId, app_assertion: assertion,
    reauthentication_required: false, primary_auth_events: current.session.primary_auth_events,
    auth_time: current.session.auth_time, audit_event_hash: event.event_hash,
  });
}

async function authorizeAssertion(request, env) {
  const token = credential(request, 'Bearer');
  if (!token) return response(401, { error: 'missing_app_assertion' });
  let claims;
  try { claims = await verifyToken(String(env.SSO_SIGNING_KEY || ''), token, 'axiom_enterprise_app_assertion'); }
  catch { return response(401, { error: 'invalid_app_assertion' }); }
  const session = await loadSession(env, claims.sid);
  if (!session || session.revoked_at || session.policy_hash !== claims.policy_hash) return response(401, { error: 'session_not_active' });
  const body = await readJson(request);
  const requirement = body?.require || {};
  const role = String(requirement.role || '');
  const project = String(requirement.project || '');
  const organization = String(requirement.organization || '');
  const appId = String(body?.app_id || '');
  const allowed = Boolean(
    validIdentifier(appId) && claims.aud === appId && session.apps.includes(appId) &&
    (!role || claims.roles.includes(role)) && (!project || claims.projects.includes(project)) &&
    (!organization || claims.org === organization)
  );
  const event = await appendAudit(env, session, allowed ? 'AUTHORIZATION_ALLOWED' : 'AUTHORIZATION_DENIED', { app_id: appId, role, project, organization });
  if (!allowed) return response(403, { authorized: false, error: 'policy_denied', audit_event_hash: event.event_hash });
  return response(200, { authorized: true, subject: claims.sub, organization_id: claims.org, app_id: appId, audit_event_hash: event.event_hash });
}

async function revokeSession(request, env) {
  const current = await activeSessionFromToken(request, env);
  if (!current.ok) return response(current.status, { error: current.error });
  current.session.revoked_at = new Date().toISOString();
  const event = await appendAudit(env, current.session, 'SESSION_REVOKED', { self_revocation: true });
  return response(200, { revoked: true, sid: current.session.sid, audit_event_hash: event.event_hash });
}

async function readAudit(request, env, sid) {
  if (!(await requireAdmin(request, env))) return response(403, { error: 'admin_denied' });
  const session = await loadSession(env, sid);
  if (!session) return response(404, { error: 'session_not_found' });
  let previous = null;
  for (const event of session.audit_events || []) {
    const body = { seq: event.seq, sid: event.sid, type: event.type, at: event.at, previous_event_hash: event.previous_event_hash, details: event.details };
    if (event.previous_event_hash !== previous || await sha256(canonical(body)) !== event.event_hash) return response(500, { error: 'audit_chain_invalid' });
    previous = event.event_hash;
  }
  return response(200, {
    sid: session.sid, subject: session.subject, organization_id: session.organization_id,
    policy_hash: session.policy_hash, auth_time: session.auth_time, primary_auth_events: session.primary_auth_events,
    revoked: Boolean(session.revoked_at), audit_head: session.audit_head, audit_events: session.audit_events || [],
  });
}

export async function handleEnterpriseSsoRequest(request, env) {
  if (!env?.ENTERPRISE_STATE || !env?.SSO_SIGNING_KEY || !env?.ENTERPRISE_ADMIN_KEY) return response(503, { error: 'enterprise_sso_not_configured' });
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') {
    return response(200, {
      ok: true, service: 'MUSITU Axiom Enterprise SSO Gateway', sso: true, rbac: true,
      project_scope: true, revocation: true, audit_chain: true,
      oidc_userinfo: String(env.OIDC_USERINFO_URL || ''),
      source_commit: String(env.SOURCE_COMMIT || ''), matrix_sha256: String(env.FA13_MATRIX_SHA256 || ''),
      production_authority: false,
    });
  }
  if (request.method === 'POST' && url.pathname === '/v1/admin/memberships') return configureMembership(request, env);
  if (request.method === 'DELETE' && url.pathname.startsWith('/v1/admin/memberships/')) return removeMembership(request, env, decodeURIComponent(url.pathname.slice('/v1/admin/memberships/'.length)));
  if (request.method === 'POST' && url.pathname === '/v1/sso/session') return createSession(request, env);
  if (request.method === 'POST' && url.pathname === '/v1/sso/exchange') return exchangeSession(request, env);
  if (request.method === 'POST' && url.pathname === '/v1/authorize') return authorizeAssertion(request, env);
  if (request.method === 'POST' && url.pathname === '/v1/sso/revoke') return revokeSession(request, env);
  if (request.method === 'GET' && url.pathname.startsWith('/v1/admin/audit/')) return readAudit(request, env, decodeURIComponent(url.pathname.slice('/v1/admin/audit/'.length)));
  return response(404, { error: 'not_found' });
}

export default { fetch: handleEnterpriseSsoRequest };
