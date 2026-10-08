import {createCaseRecord, SecretMaterialError} from './control_plane.js';
import {importSupportDataKey} from './crypto_envelope.js';
import {D1CaseStore} from './d1_case_store.js';
import {verifyTurnstile} from './turnstile.js';

const JSON_HEADERS = Object.freeze({'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
const CASE_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)$/;
const CASE_MESSAGE_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)\/messages$/;
const OPERATOR_CASE_PATH = /^\/api\/v1\/operator\/cases\/([A-Z0-9-]+)$/;
const OPERATOR_MESSAGE_PATH = /^\/api\/v1\/operator\/cases\/([A-Z0-9-]+)\/messages$/;
const OPERATOR_STATE_PATH = /^\/api\/v1\/operator\/cases\/([A-Z0-9-]+)\/state$/;
const HASH = /^[a-f0-9]{64}$/i;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {status, headers: {...JSON_HEADERS, ...extra}});
}

function securityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  headers.set('content-security-policy', "default-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

async function readJson(request) {
  if (!String(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw new DOMException('content-type must be application/json', 'NotSupportedError');
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 24_000) throw new DOMException('request is too large', 'QuotaExceededError');
  const text = await request.text();
  if (text.length > 24_000) throw new DOMException('request is too large', 'QuotaExceededError');
  return JSON.parse(text);
}

async function abuseAllowed(token, env) {
  if (env.ENVIRONMENT !== 'production' && !token) return true;
  return verifyTurnstile({
    token,
    secret: env.TURNSTILE_SECRET_KEY,
    expectedHostname: env.SUPPORT_DOMAIN,
    expectedAction: 'support_case_create',
    fetchImpl: env.TURNSTILE_VERIFY || fetch,
  });
}

async function intakeRateState(env) {
  const limiter = env.SUPPORT_INTAKE_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== 'function') return env.ENVIRONMENT === 'production' ? 'UNAVAILABLE' : 'ALLOW';
  try {
    const result = await limiter.limit({key: 'support-case-create'});
    return result?.success === true ? 'ALLOW' : 'LIMIT';
  } catch {
    return env.ENVIRONMENT === 'production' ? 'UNAVAILABLE' : 'ALLOW';
  }
}

async function storeFor(env) {
  if (env.ENVIRONMENT !== 'production' && env.SUPPORT_STORE) return env.SUPPORT_STORE;
  if (!env.SUPPORT_DB || !env.SUPPORT_DATA_KEY_B64) throw new DOMException('secure support storage is not configured', 'InvalidStateError');
  if (env.ENVIRONMENT === 'production' && (!env.SUPPORT_HUMAN_OWNER_REF || !env.SUPPORT_INDEPENDENT_APPROVER_REF || env.SUPPORT_HUMAN_OWNER_REF === env.SUPPORT_INDEPENDENT_APPROVER_REF || !HASH.test(String(env.SUPPORT_READINESS_SHA256 || '')))) {
    throw new DOMException('distinct human ownership, approval and readiness evidence are not configured', 'InvalidStateError');
  }
  const key = await importSupportDataKey(env.SUPPORT_DATA_KEY_B64);
  return new D1CaseStore({database: env.SUPPORT_DB, encryptionKey: key});
}

function recoveryCode(request) {
  const value = request.headers.get('authorization') || '';
  const match = value.match(/^Support\s+([0-9A-HJKMNP-TV-Z-]{26})$/);
  return match?.[1] || null;
}

export async function handleSupportRequest(request, env = {}) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') {
    const production = env.ENVIRONMENT === 'production';
    const turnstile = Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && env.SUPPORT_DOMAIN);
    const rateLimiter = Boolean(env.SUPPORT_INTAKE_RATE_LIMITER && typeof env.SUPPORT_INTAKE_RATE_LIMITER.limit === 'function');
    const humanOwner = Boolean(env.SUPPORT_HUMAN_OWNER_REF);
    const independentApprover = Boolean(env.SUPPORT_INDEPENDENT_APPROVER_REF && env.SUPPORT_INDEPENDENT_APPROVER_REF !== env.SUPPORT_HUMAN_OWNER_REF);
    const abuseGate = turnstile && rateLimiter;
    const ready = Boolean(env.SUPPORT_DB && env.SUPPORT_DATA_KEY_B64 && (abuseGate || !production) && (!production || (humanOwner && independentApprover && HASH.test(String(env.SUPPORT_READINESS_SHA256 || '')))));
    return json({schema: 'musitu.axiom.support-health.v1', status: ready ? 'READY' : 'NOT_READY', secure_storage: Boolean(env.SUPPORT_DB && env.SUPPORT_DATA_KEY_B64), abuse_gate: abuseGate, turnstile, rate_limiter: rateLimiter, human_owner: humanOwner, independent_approver: independentApprover, readiness_evidence: HASH.test(String(env.SUPPORT_READINESS_SHA256 || '')), production}, ready ? 200 : 503);
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/config') {
    return json({schema: 'musitu.axiom.support-browser-config.v1', turnstile_sitekey: String(env.TURNSTILE_SITE_KEY || ''), turnstile_action: 'support_case_create'});
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/catalog') {
    return json({schema: 'musitu.axiom.support-catalog.v1', case_creation: '/api/v1/cases', authentication: 'one-time recovery code shown only at creation; send as Authorization: Support <code>', secrets_policy: 'credentials, tokens, passwords, cookies and payment card numbers are rejected before storage'});
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/cases') {
    const rateState = await intakeRateState(env);
    if (rateState === 'UNAVAILABLE') return json({error: 'SERVICE_NOT_READY', message: 'Support intake protection is temporarily unavailable. No case was stored.'}, 503);
    if (rateState === 'LIMIT') return json({error: 'RATE_LIMITED', message: 'Too many support intake attempts. Try again later.'}, 429, {'retry-after': '60'});
    const body = await readJson(request);
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new TypeError('intake must be an object');
    const {turnstile_token: token, ...intake} = body;
    const proof = await abuseAllowed(token, env);
    if (proof !== true && !proof.ok) return json({error: proof.code || 'ABUSE_PROOF_REQUIRED', message: 'Complete the anti-abuse check and try again.'}, 403);
    const bundle = await createCaseRecord(intake);
    const store = await storeFor(env);
    const publicCase = await store.create(bundle);
    return json({case: publicCase, recovery_code: bundle.recovery_code, recovery_code_notice: 'Save this code now. It is shown once and cannot be recovered by MUSITU.'}, 201);
  }
  const caseMessageMatch = url.pathname.match(CASE_MESSAGE_PATH);
  if (request.method === 'POST' && caseMessageMatch) {
    const code = recoveryCode(request);
    if (!code) return json({error: 'CASE_AUTH_REQUIRED'}, 401, {'www-authenticate': 'Support'});
    const body = await readJson(request);
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new TypeError('message must be an object');
    const store = await storeFor(env);
    const value = await store.appendCustomerMessage(caseMessageMatch[1], code, {body: body.body});
    if (!value) return json({error: 'CASE_NOT_FOUND'}, 404);
    return json(value, 201);
  }

  const caseMatch = url.pathname.match(CASE_PATH);
  if (request.method === 'GET' && caseMatch) {
    const code = recoveryCode(request);
    if (!code) return json({error: 'CASE_AUTH_REQUIRED'}, 401, {'www-authenticate': 'Support'});
    const store = await storeFor(env);
    const value = await store.getAuthorized(caseMatch[1], code);
    if (!value) return json({error: 'CASE_NOT_FOUND'}, 404);
    return json(value);
  }
  return json({error: 'NOT_FOUND'}, 404);
}


const OPERATOR_ROLES = Object.freeze(['support_agent', 'privacy_officer', 'security_responder', 'billing_operator', 'incident_commander']);

async function operatorPrincipal(request, env) {
  if (typeof env.SUPPORT_OPERATOR_VERIFY !== 'function') return null;
  const value = await env.SUPPORT_OPERATOR_VERIFY(request, env);
  if (!value || typeof value !== 'object') return null;
  const actorRef = String(value.actor_ref || '');
  const role = String(value.role || '');
  if (!/^support_agent:[a-z0-9._:-]{3,160}$/i.test(actorRef) || !OPERATOR_ROLES.includes(role)) return null;
  return Object.freeze({actor_ref: actorRef, role});
}

export async function handleOperatorRequest(request, env = {}) {
  const principal = await operatorPrincipal(request, env);
  if (!principal) return json({error: 'OPERATOR_AUTH_REQUIRED'}, 401, {'www-authenticate': 'Cloudflare-Access'});
  const url = new URL(request.url);
  const store = await storeFor(env);

  if (request.method === 'GET' && url.pathname === '/api/v1/operator/cases') {
    const state = url.searchParams.get('state') || null;
    const cases = await store.listOperatorCases({state, limit: 100});
    return json({schema: 'musitu.axiom.support-operator-inbox.v1', cases});
  }

  const messageMatch = url.pathname.match(OPERATOR_MESSAGE_PATH);
  if (request.method === 'POST' && messageMatch) {
    const body = await readJson(request);
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new TypeError('operator message must be an object');
    if (!['AGENT_REPLY', 'INTERNAL_NOTE'].includes(body.type)) throw new TypeError('operator message type is invalid');
    const value = await store.appendOperatorMessage(messageMatch[1], {type: body.type, body: body.body}, principal);
    if (!value) return json({error: 'CASE_NOT_FOUND'}, 404);
    return json(value, 201);
  }

  const stateMatch = url.pathname.match(OPERATOR_STATE_PATH);
  if (request.method === 'POST' && stateMatch) {
    const body = await readJson(request);
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new TypeError('state change must be an object');
    const value = await store.transitionOperatorCase(stateMatch[1], body.label, principal);
    if (!value) return json({error: 'CASE_NOT_FOUND'}, 404);
    return json(value);
  }

  const caseMatch = url.pathname.match(OPERATOR_CASE_PATH);
  if (request.method === 'GET' && caseMatch) {
    const value = await store.getOperatorCase(caseMatch[1]);
    if (!value) return json({error: 'CASE_NOT_FOUND'}, 404);
    return json(value);
  }

  return json({error: 'NOT_FOUND'}, 404);
}

export default {
  async fetch(request, env) {
    try { return securityHeaders(await handleSupportRequest(request, env)); }
    catch (error) {
      if (error instanceof SecretMaterialError) return securityHeaders(json({error: error.code, message: error.message, findings: error.findings}, 422));
      if (error instanceof SyntaxError) return securityHeaders(json({error: 'INVALID_JSON'}, 400));
      if (error?.name === 'QuotaExceededError') return securityHeaders(json({error: 'PAYLOAD_TOO_LARGE'}, 413));
      if (error?.name === 'NotSupportedError') return securityHeaders(json({error: 'UNSUPPORTED_MEDIA_TYPE'}, 415));
      if (error?.name === 'InvalidStateError') return securityHeaders(json({error: 'SERVICE_NOT_READY', message: 'Secure support intake is temporarily unavailable. No case was stored.'}, 503));
      if (error instanceof TypeError) return securityHeaders(json({error: 'INVALID_INTAKE', message: error.message}, 422));
      return securityHeaders(json({error: 'INTERNAL_ERROR'}, 500));
    }
  },
};
