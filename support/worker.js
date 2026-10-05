import {createCaseRecord, SecretMaterialError} from './control_plane.js';
import {importSupportDataKey} from './crypto_envelope.js';
import {D1CaseStore} from './d1_case_store.js';

const JSON_HEADERS = Object.freeze({'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
const CASE_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)$/;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {status, headers: {...JSON_HEADERS, ...extra}});
}

function securityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
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

async function abuseAllowed(request, env) {
  if (env.SUPPORT_ABUSE_GATE?.fetch) {
    const signal = {
      schema: 'musitu.axiom.support-abuse-signal.v1',
      method: request.method,
      path: new URL(request.url).pathname,
      country: request.cf?.country || null,
      bot_score: request.cf?.botManagement?.score ?? null,
      verified_bot: request.cf?.botManagement?.verifiedBot ?? null,
    };
    const response = await env.SUPPORT_ABUSE_GATE.fetch('https://support-abuse-gate.internal/verify', {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(signal),
    });
    return response.ok;
  }
  return env.ENVIRONMENT !== 'production';
}

async function storeFor(env) {
  if (!env.SUPPORT_DB || !env.SUPPORT_DATA_KEY_B64) throw new DOMException('secure support storage is not configured', 'InvalidStateError');
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
    const ready = Boolean(env.SUPPORT_DB && env.SUPPORT_DATA_KEY_B64 && (env.SUPPORT_ABUSE_GATE || env.ENVIRONMENT !== 'production'));
    return json({schema: 'musitu.axiom.support-health.v1', status: ready ? 'READY' : 'NOT_READY', secure_storage: Boolean(env.SUPPORT_DB && env.SUPPORT_DATA_KEY_B64), abuse_gate: Boolean(env.SUPPORT_ABUSE_GATE), production: env.ENVIRONMENT === 'production'}, ready ? 200 : 503);
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/catalog') {
    return json({schema: 'musitu.axiom.support-catalog.v1', case_creation: '/api/v1/cases', authentication: 'one-time recovery code shown only at creation; send as Authorization: Support <code>', secrets_policy: 'credentials, tokens, passwords, cookies and payment card numbers are rejected before storage'});
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/cases') {
    if (!await abuseAllowed(request, env)) return json({error: 'ABUSE_PROOF_REQUIRED', message: 'Complete the anti-abuse check and try again.'}, 403);
    const body = await readJson(request);
    const bundle = await createCaseRecord(body);
    const store = await storeFor(env);
    const publicCase = await store.create(bundle);
    return json({case: publicCase, recovery_code: bundle.recovery_code, recovery_code_notice: 'Save this code now. It is shown once and cannot be recovered by MUSITU.'}, 201);
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
