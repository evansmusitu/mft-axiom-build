import {createCaseRecord, SecretMaterialError} from './control_plane.js';
import {importSupportDataKey} from './crypto_envelope.js';
import {D1CaseStore} from './d1_case_store.js';
import {verifyTurnstile} from './turnstile.js';

const JSON_HEADERS = Object.freeze({'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
const CASE_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)$/;
const CASE_MESSAGE_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)\/messages$/;
const CASE_DIAGNOSTICS_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)\/diagnostics$/;
const CASE_CSAT_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)\/csat$/;
const CASE_ESCALATIONS_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)\/escalations$/;
const CASE_ATTACHMENTS_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)\/attachments$/;
const RECOVERY_BIND_PATH = /^\/recovery\/api\/v1\/cases\/([A-Z0-9-]+)\/bind$/;
const RECOVERY_ROTATE_PATH = /^\/recovery\/api\/v1\/cases\/([A-Z0-9-]+)\/rotate$/;
const OPERATOR_CASE_PATH = /^\/api\/v1\/operator\/cases\/([A-Z0-9-]+)$/;
const OPERATOR_MESSAGE_PATH = /^\/api\/v1\/operator\/cases\/([A-Z0-9-]+)\/messages$/;
const OPERATOR_STATE_PATH = /^\/api\/v1\/operator\/cases\/([A-Z0-9-]+)\/state$/;
const OPERATOR_ASSIGNMENT_PATH = /^\/api\/v1\/operator\/cases\/([A-Z0-9-]+)\/assignment$/;
const OPERATOR_APPROVALS_PATH = /^\/api\/v1\/operator\/cases\/([A-Z0-9-]+)\/approvals$/;
const OPERATOR_APPROVE_PATH = /^\/api\/v1\/operator\/cases\/([A-Z0-9-]+)\/approvals\/(AXA-[0-9A-HJKMNP-TV-Z]{16})\/approve$/;
const OPERATOR_LEASE_PATH = /^\/api\/v1\/operator\/cases\/([A-Z0-9-]+)\/lease$/;
const OPERATOR_HANDOFF_PATH = /^\/api\/v1\/operator\/cases\/([A-Z0-9-]+)\/handoff$/;
const OPERATOR_ESCALATIONS_PATH = /^\/api\/v1\/operator\/cases\/([A-Z0-9-]+)\/escalations$/;
const OPERATOR_INCIDENT_CASES_PATH = /^\/api\/v1\/operator\/incidents\/(AXI-[0-9A-HJKMNP-TV-Z]{16})\/cases$/;
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

function base64UrlBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

function base64UrlJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}

function normalizedIssuer(value) {
  return String(value || '').replace(/\/+$/, '');
}


export async function verifyCustomerRecoveryAccess(request, env = {}) {
  try {
    if (env.ENVIRONMENT !== 'production' && typeof env.SUPPORT_RECOVERY_IDENTITY_VERIFY === 'function') {
      const injected = await env.SUPPORT_RECOVERY_IDENTITY_VERIFY(request, env);
      const issuer = normalizedIssuer(injected?.issuer);
      const subject = String(injected?.subject || '').trim();
      if (!/^https:\/\/[a-z0-9.-]+$/i.test(issuer) || subject.length < 3 || subject.length > 512) return null;
      return Object.freeze({issuer, subject});
    }

    const token = String(request.headers.get('cf-access-jwt-assertion') || '').trim();
    const team = normalizedIssuer(env.SUPPORT_RECOVERY_ACCESS_TEAM_DOMAIN);
    const expectedAud = String(env.SUPPORT_RECOVERY_ACCESS_AUD || '').trim();
    if (!token || token.length > 16_000 || !team || !expectedAud) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = base64UrlJson(parts[0]);
    const payload = base64UrlJson(parts[1]);
    if (header?.alg !== 'RS256' || !header?.kid) return null;
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(payload?.exp) || payload.exp <= now) return null;
    if (payload?.nbf != null && (!Number.isFinite(payload.nbf) || payload.nbf > now + 30)) return null;
    if (normalizedIssuer(payload?.iss) !== team) return null;
    const audiences = Array.isArray(payload?.aud) ? payload.aud.map(String) : [String(payload?.aud || '')];
    if (!audiences.includes(expectedAud)) return null;
    const subject = String(payload?.sub || '').trim();
    if (subject.length < 3 || subject.length > 512) return null;

    const fetchImpl = env.SUPPORT_RECOVERY_ACCESS_CERTS_FETCH || fetch;
    const response = await fetchImpl(team + '/cdn-cgi/access/certs', {headers:{accept:'application/json'}});
    if (!response?.ok) return null;
    const certs = await response.json();
    const jwk = (Array.isArray(certs?.keys) ? certs.keys : []).find(key => String(key?.kid || '') === String(header.kid));
    if (!jwk || jwk.kty !== 'RSA') return null;
    const publicKey = await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    const signatureOk = await crypto.subtle.verify(
      {name:'RSASSA-PKCS1-v1_5'},publicKey,base64UrlBytes(parts[2]),
      new TextEncoder().encode(parts[0]+'.'+parts[1]),
    );
    if (!signatureOk) return null;
    return Object.freeze({issuer:team,subject});
  } catch {
    return null;
  }
}

export async function verifyOperatorAccess(request, env = {}) {
  try {
    const token = String(request.headers.get('cf-access-jwt-assertion') || '').trim();
    const team = normalizedIssuer(env.SUPPORT_ACCESS_TEAM_DOMAIN);
    const expectedAud = String(env.SUPPORT_ACCESS_AUD || '').trim();
    const bindingsRaw = String(env.SUPPORT_OPERATOR_BINDINGS_JSON || '').trim();
    if (!token || token.length > 16_000 || !team || !expectedAud || !bindingsRaw) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = base64UrlJson(parts[0]);
    const payload = base64UrlJson(parts[1]);
    if (header?.alg !== 'RS256' || !header?.kid) return null;

    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(payload?.exp) || payload.exp <= now) return null;
    if (payload?.nbf != null && (!Number.isFinite(payload.nbf) || payload.nbf > now + 30)) return null;
    if (normalizedIssuer(payload?.iss) !== team) return null;
    const audiences = Array.isArray(payload?.aud) ? payload.aud.map(String) : [String(payload?.aud || '')];
    if (!audiences.includes(expectedAud)) return null;
    const email = String(payload?.email || '').trim().toLowerCase();
    if (!email || email.length > 320) return null;

    const fetchImpl = env.SUPPORT_ACCESS_CERTS_FETCH || fetch;
    const response = await fetchImpl(team + '/cdn-cgi/access/certs', {headers: {'accept': 'application/json'}});
    if (!response?.ok) return null;
    const certs = await response.json();
    const jwk = (Array.isArray(certs?.keys) ? certs.keys : []).find(key => String(key?.kid || '') === String(header.kid));
    if (!jwk || jwk.kty !== 'RSA') return null;
    const publicKey = await crypto.subtle.importKey(
      'jwk', jwk, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify'],
    );
    const signatureOk = await crypto.subtle.verify(
      {name: 'RSASSA-PKCS1-v1_5'}, publicKey, base64UrlBytes(parts[2]),
      new TextEncoder().encode(parts[0] + '.' + parts[1]),
    );
    if (!signatureOk) return null;

    const bindings = JSON.parse(bindingsRaw);
    const binding = bindings && typeof bindings === 'object' && !Array.isArray(bindings) ? bindings[email] : null;
    const actorRef = String(binding?.actor_ref || '');
    const role = String(binding?.role || '');
    if (!/^support_agent:[a-z0-9._:-]{3,160}$/i.test(actorRef)) return null;
    if (!['support_agent','privacy_officer','security_responder','billing_operator','incident_commander'].includes(role)) return null;
    return Object.freeze({actor_ref: actorRef, role});
  } catch {
    return null;
  }
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
  const recoveryBindMatch = url.pathname.match(RECOVERY_BIND_PATH);
  if (request.method === 'POST' && recoveryBindMatch) {
    const identity = await verifyCustomerRecoveryAccess(request, env);
    if (!identity) return json({error:'RECOVERY_IDENTITY_REQUIRED',message:'Sign in with a verified identity to manage case recovery.'},401,{'www-authenticate':'Cloudflare-Access'});
    const code = recoveryCode(request);
    if (!code) return json({error:'CASE_AUTH_REQUIRED',message:'The current recovery code is required to protect this case.'},401,{'www-authenticate':'Support'});
    const store = await storeFor(env);
    const value = await store.bindRecoveryIdentity(recoveryBindMatch[1], code, identity);
    if (!value) return json({error:'RECOVERY_NOT_AVAILABLE',message:'Case recovery could not be configured with the supplied credentials.'},404);
    return json(value);
  }

  const recoveryRotateMatch = url.pathname.match(RECOVERY_ROTATE_PATH);
  if (request.method === 'POST' && recoveryRotateMatch) {
    const identity = await verifyCustomerRecoveryAccess(request, env);
    if (!identity) return json({error:'RECOVERY_IDENTITY_REQUIRED',message:'Sign in with the identity previously bound to this case.'},401,{'www-authenticate':'Cloudflare-Access'});
    const store = await storeFor(env);
    const value = await store.rotateRecoveryCredential(recoveryRotateMatch[1], identity);
    if (!value) return json({error:'RECOVERY_NOT_AVAILABLE',message:'Recovery is not available for this case.'},404);
    if (value.status === 'APPROVAL_REQUIRED') return json({error:'RECOVERY_APPROVAL_REQUIRED',message:'Identity was verified. This sensitive case requires independent approval before a new recovery code can be issued.'},409);
    return json(value);
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/status') {
    const store = await storeFor(env);
    const incidents = await store.listPublicIncidents();
    return json({schema:'musitu.axiom.support-public-status.v1',incidents});
  }

  const diagnosticsMatch = url.pathname.match(CASE_DIAGNOSTICS_PATH);
  if (request.method === 'POST' && diagnosticsMatch) {
    const code = recoveryCode(request);
    if (!code) return json({error:'CASE_AUTH_REQUIRED'},401,{'www-authenticate':'Support'});
    const body = await readJson(request);
    const store = await storeFor(env);
    const value = await store.recordDiagnostics(diagnosticsMatch[1],code,body);
    if (!value) return json({error:'CASE_NOT_FOUND'},404);
    return json(value,201);
  }

  const csatMatch = url.pathname.match(CASE_CSAT_PATH);
  if (request.method === 'POST' && csatMatch) {
    const code = recoveryCode(request);
    if (!code) return json({error:'CASE_AUTH_REQUIRED'},401,{'www-authenticate':'Support'});
    const body = await readJson(request);
    const store = await storeFor(env);
    const value = await store.recordCsat(csatMatch[1],code,body);
    if (!value) return json({error:'CASE_NOT_FOUND'},404);
    return json(value,201);
  }

  const customerEscalationMatch = url.pathname.match(CASE_ESCALATIONS_PATH);
  if (request.method === 'POST' && customerEscalationMatch) {
    const code = recoveryCode(request);
    if (!code) return json({error:'CASE_AUTH_REQUIRED'},401,{'www-authenticate':'Support'});
    const body = await readJson(request);
    const store = await storeFor(env);
    const value = await store.requestCustomerEscalation(customerEscalationMatch[1],code,body);
    if (!value) return json({error:'CASE_NOT_FOUND'},404);
    return json(value,201);
  }

  const attachmentMatch = url.pathname.match(CASE_ATTACHMENTS_PATH);
  if (request.method === 'POST' && attachmentMatch) {
    const code = recoveryCode(request);
    if (!code) return json({error:'CASE_AUTH_REQUIRED'},401,{'www-authenticate':'Support'});
    if (typeof env.SUPPORT_ATTACHMENT_INIT !== 'function') return json({error:'ATTACHMENT_PROVIDER_UNAVAILABLE'},503);
    const body = await readJson(request);
    const store = await storeFor(env);
    const meta = await store.prepareAttachment(attachmentMatch[1],code,body);
    if (!meta) return json({error:'CASE_NOT_FOUND'},404);
    const upload = await env.SUPPORT_ATTACHMENT_INIT(meta);
    if (!upload?.upload_url) return json({error:'ATTACHMENT_PROVIDER_UNAVAILABLE'},503);
    return json({...meta,upload_url:String(upload.upload_url),expires_in:Number(upload.expires_in||300)},201);
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
    const value = await store.getAuthorizedThread(caseMatch[1], code);
    if (!value) return json({error: 'CASE_NOT_FOUND'}, 404);
    return json(value);
  }
  return json({error: 'NOT_FOUND'}, 404);
}


const OPERATOR_ROLES = Object.freeze(['support_agent', 'privacy_officer', 'security_responder', 'billing_operator', 'incident_commander']);

async function operatorPrincipal(request, env) {
  const verifier = env.ENVIRONMENT !== 'production' && typeof env.SUPPORT_OPERATOR_VERIFY === 'function'
    ? env.SUPPORT_OPERATOR_VERIFY
    : verifyOperatorAccess;
  const value = await verifier(request, env);
  if (!value || typeof value !== 'object') return null;
  const actorRef = String(value.actor_ref || '');
  const role = String(value.role || '');
  if (!/^support_agent:[a-z0-9._:-]{3,160}$/i.test(actorRef) || !OPERATOR_ROLES.includes(role)) return null;
  return Object.freeze({actor_ref: actorRef, role});
}

export async function deliverSupportNotification(notification, env = {}) {
  const value = notification && typeof notification === 'object' ? notification : {};
  const notificationId = String(value.notification_id || '');
  const caseId = String(value.case_id || '');
  const kind = String(value.kind || '');
  if (!/^AXN-[0-9A-HJKMNP-TV-Z]{16}$/.test(notificationId)) throw new TypeError('notification id is invalid');
  if (!/^AX-[0-9A-HJKMNP-TV-Z]{12}$/.test(caseId)) throw new TypeError('notification case id is invalid');
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(kind)) throw new TypeError('notification kind is invalid');
  if (typeof env.SUPPORT_NOTIFICATION_SEND !== 'function') return Object.freeze({delivered:false,reason:'PROVIDER_UNAVAILABLE'});
  const payload=Object.freeze({notification_id:notificationId,case_id:caseId,kind});
  const receipt=await env.SUPPORT_NOTIFICATION_SEND(payload);
  return Object.freeze({delivered:true,receipt_id:String(receipt?.id||'')||null});
}

export async function deliverSupportWebhook(delivery, env = {}) {
  if (!delivery || typeof delivery !== 'object') throw new TypeError('webhook delivery required');
  if (typeof env.SUPPORT_WEBHOOK_SEND !== 'function') return Object.freeze({delivered:false,reason:'PROVIDER_UNAVAILABLE'});
  const receipt = await env.SUPPORT_WEBHOOK_SEND(Object.freeze({...delivery}));
  const status = Number(receipt?.status || 0);
  return Object.freeze({delivered:status >= 200 && status < 300,receipt_id:String(receipt?.id||'')||null,status});
}

export async function processSupportQueues(env = {}) {
  const store = await storeFor(env);
  const summary = {notifications:{delivered:0,failed:0,provider_unavailable:0},webhooks:{delivered:0,failed:0,provider_unavailable:0}};
  const notifications = typeof store.listPendingNotifications === 'function' ? await store.listPendingNotifications({limit:50}) : [];
  for (const item of notifications || []) {
    let result;
    try { result = await deliverSupportNotification(item, env); }
    catch (error) { result = {delivered:false,reason:'DELIVERY_FAILED',error_class:String(error?.name||'Error')}; }
    if (result.delivered) summary.notifications.delivered += 1;
    else if (result.reason === 'PROVIDER_UNAVAILABLE') summary.notifications.provider_unavailable += 1;
    else summary.notifications.failed += 1;
    if (typeof store.recordNotificationAttempt === 'function') await store.recordNotificationAttempt(item,result);
  }
  const webhooks = typeof store.listPendingWebhookDeliveries === 'function' ? await store.listPendingWebhookDeliveries({limit:50}) : [];
  for (const item of webhooks || []) {
    let result;
    try { result = await deliverSupportWebhook(item, env); }
    catch (error) { result = {delivered:false,reason:'DELIVERY_FAILED',error_class:String(error?.name||'Error')}; }
    if (result.delivered) summary.webhooks.delivered += 1;
    else if (result.reason === 'PROVIDER_UNAVAILABLE') summary.webhooks.provider_unavailable += 1;
    else summary.webhooks.failed += 1;
    if (typeof store.recordWebhookAttempt === 'function') await store.recordWebhookAttempt(item,result);
  }
  return Object.freeze({notifications:Object.freeze(summary.notifications),webhooks:Object.freeze(summary.webhooks)});
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

  if (request.method === 'GET' && url.pathname === '/api/v1/operator/analytics') {
    return json(await store.globalOpsAnalytics());
  }

  if (url.pathname === '/api/v1/operator/incidents') {
    if (request.method === 'GET') return json({incidents:await store.listOperatorIncidents()});
    if (request.method === 'POST') {
      const body=await readJson(request);
      const value=await store.createIncident(body,principal);
      return json(value,201);
    }
  }

  const incidentCasesMatch=url.pathname.match(OPERATOR_INCIDENT_CASES_PATH);
  if(request.method==='POST'&&incidentCasesMatch){
    const body=await readJson(request);
    const value=await store.linkIncidentCase(incidentCasesMatch[1],body.case_id,principal);
    if(!value)return json({error:'INCIDENT_OR_CASE_NOT_FOUND'},404);
    return json(value,201);
  }

  const leaseMatch=url.pathname.match(OPERATOR_LEASE_PATH);
  if(request.method==='POST'&&leaseMatch){
    const body=await readJson(request);
    const value=await store.leaseOperatorCase(leaseMatch[1],principal,{minutes:body.minutes});
    if(!value)return json({error:'CASE_NOT_FOUND'},404);
    return json(value);
  }

  const handoffMatch=url.pathname.match(OPERATOR_HANDOFF_PATH);
  if(request.method==='POST'&&handoffMatch){
    const body=await readJson(request);
    const value=await store.handoffOperatorCase(handoffMatch[1],body,principal);
    if(!value)return json({error:'CASE_NOT_FOUND'},404);
    return json(value,201);
  }

  const escalationMatch=url.pathname.match(OPERATOR_ESCALATIONS_PATH);
  if(request.method==='POST'&&escalationMatch){
    const body=await readJson(request);
    const value=await store.escalateOperatorCase(escalationMatch[1],body,principal);
    if(!value)return json({error:'CASE_NOT_FOUND'},404);
    return json(value,201);
  }

  const assignmentMatch = url.pathname.match(OPERATOR_ASSIGNMENT_PATH);
  if (request.method === 'POST' && assignmentMatch) {
    const value = await store.assignOperatorCase(assignmentMatch[1], principal);
    if (!value) return json({error: 'CASE_NOT_FOUND'}, 404);
    return json(value);
  }

  const approvalsMatch = url.pathname.match(OPERATOR_APPROVALS_PATH);
  if (request.method === 'POST' && approvalsMatch) {
    const body = await readJson(request);
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new TypeError('approval proposal must be an object');
    const value = await store.proposeSensitiveAction(approvalsMatch[1], {
      action: body.action,
      evidence_hashes: body.evidence_hashes,
    }, principal);
    if (!value) return json({error: 'CASE_NOT_FOUND'}, 404);
    return json(value, 201);
  }

  const approveMatch = url.pathname.match(OPERATOR_APPROVE_PATH);
  if (request.method === 'POST' && approveMatch) {
    const body = await readJson(request);
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new TypeError('approval decision must be an object');
    const value = await store.approveSensitiveAction(approveMatch[1], approveMatch[2], {
      decision: body.decision || 'APPROVED',
    }, principal);
    if (!value) return json({error: 'APPROVAL_NOT_FOUND'}, 404);
    return json(value);
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
  async scheduled(controller, env) {
    return processSupportQueues(env);
  },
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
