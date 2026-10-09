import {createCaseRecord, inspectSecretMaterial, SecretMaterialError} from './control_plane.js';
import {searchKnowledge} from './knowledge.js';
import {importSupportDataKey} from './crypto_envelope.js';
import {D1CaseStore} from './d1_case_store.js';
import {verifyTurnstile} from './turnstile.js';
import {handleInboundSupportEmail} from './email_worker.js';
import {validateWebhookEndpoint} from './global_ops.js';

const JSON_HEADERS = Object.freeze({'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
const CASE_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)$/;
const CASE_MESSAGE_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)\/messages$/;
const CASE_DIAGNOSTICS_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)\/diagnostics$/;
const CASE_CSAT_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)\/csat$/;
const CASE_ESCALATIONS_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)\/escalations$/;
const CASE_ATTACHMENTS_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)\/attachments$/;
const CASE_ATTACHMENT_CONTENT_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)\/attachments\/(AXF-[0-9A-HJKMNP-TV-Z]{16})\/content$/;
const CASE_REOPEN_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)\/reopen$/;
const CASE_EMAIL_THREAD_PATH = /^\/api\/v1\/cases\/([A-Z0-9-]+)\/email-thread$/;
const RECOVERY_BIND_PATH = /^\/recovery\/api\/v1\/cases\/([A-Z0-9-]+)\/bind$/;
const RECOVERY_ROTATE_PATH = /^\/recovery\/api\/v1\/cases\/([A-Z0-9-]+)\/rotate$/;
const ENTERPRISE_ORG_CASES_PATH = /^\/enterprise\/api\/v1\/orgs\/([^/]+)\/cases$/;
const ENTERPRISE_ORG_CASE_PATH = /^\/enterprise\/api\/v1\/orgs\/([^/]+)\/cases\/([A-Z0-9-]+)$/;
const ENTERPRISE_ORG_MESSAGE_PATH = /^\/enterprise\/api\/v1\/orgs\/([^/]+)\/cases\/([A-Z0-9-]+)\/messages$/;
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
const OPERATOR_INCIDENT_STATUS_PATH = /^\/api\/v1\/operator\/incidents\/(AXI-[0-9A-HJKMNP-TV-Z]{16})\/status$/;
const OPERATOR_ORG_ENTITLEMENTS_PATH = /^\/api\/v1\/operator\/organizations\/([^/]+)\/entitlements$/;
const OPERATOR_ORG_INVITES_PATH = /^\/api\/v1\/operator\/organizations\/([^/]+)\/invites$/;
const OPERATOR_WEBHOOK_DELIVERY_PATH = /^\/api\/v1\/operator\/webhooks\/([^/]+)\/delivery$/;
const OPERATOR_QA_PATH = /^\/api\/v1\/operator\/cases\/([A-Z0-9-]+)\/qa$/;
const OPERATOR_TRIAGE_PATH = /^\/api\/v1\/operator\/cases\/([A-Z0-9-]+)\/triage$/;
const OPERATOR_ATTACHMENT_SCAN_PATH = /^\/api\/v1\/operator\/attachments\/(AXF-[0-9A-HJKMNP-TV-Z]{16})\/scan$/;
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

export async function verifyEnterpriseAccess(request, env = {}) {
  try {
    if (env.ENVIRONMENT !== 'production' && typeof env.SUPPORT_ENTERPRISE_IDENTITY_VERIFY === 'function') {
      const injected = await env.SUPPORT_ENTERPRISE_IDENTITY_VERIFY(request, env);
      const issuer = normalizedIssuer(injected?.issuer);
      const subject = String(injected?.subject || '').trim();
      if (!/^https:\/\/[a-z0-9.-]+$/i.test(issuer) || subject.length < 3 || subject.length > 512) return null;
      return Object.freeze({issuer, subject});
    }

    const token = String(request.headers.get('cf-access-jwt-assertion') || '').trim();
    const team = normalizedIssuer(env.SUPPORT_ENTERPRISE_ACCESS_TEAM_DOMAIN);
    const expectedAud = String(env.SUPPORT_ENTERPRISE_ACCESS_AUD || '').trim();
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

    const fetchImpl = env.SUPPORT_ENTERPRISE_ACCESS_CERTS_FETCH || fetch;
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

async function sha256Text(value){
  const bytes=new TextEncoder().encode(String(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

function emailThreadToken(){
  const bytes=crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
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
  if (request.method === 'GET' && url.pathname === '/api/v1/help') {
    const query=url.searchParams.get('q')||'';
    return json({schema:'musitu.axiom.support-knowledge.v1',articles:searchKnowledge(query)});
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/help/assist') {
    const body=await readJson(request);
    const question=String(body?.question||'').trim();
    if(!question||question.length>2000)throw new TypeError('support question is required');
    const secret=inspectSecretMaterial({question},'message');
    if(!secret.safe)throw new SecretMaterialError(secret.findings);
    const articles=searchKnowledge(question);
    if(typeof env.SUPPORT_AI_ASSIST!=='function')return json({schema:'musitu.axiom.support-assist.v1',advisory_only:true,human_escalation_available:true,provider_used:false,articles});
    const answer=await env.SUPPORT_AI_ASSIST({question,articles});
    return json({schema:'musitu.axiom.support-assist.v1',advisory_only:true,human_escalation_available:true,provider_used:true,answer:String(answer?.answer||''),articles});
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
  if (url.pathname.startsWith('/enterprise/api/v1/')) {
    const identity = await verifyEnterpriseAccess(request, env);
    if (!identity) return json({error:'ENTERPRISE_AUTH_REQUIRED',message:'Sign in with your verified organization identity.'},401,{'www-authenticate':'Cloudflare-Access'});
    const store = await storeFor(env);

    if (request.method === 'POST' && url.pathname === '/enterprise/api/v1/join') {
      const body=await readJson(request);
      const value=await store.consumeOrganizationInvite(String(body?.invite_code||''),identity);
      if(!value)return json({error:'INVITE_NOT_AVAILABLE',message:'The invitation is invalid, expired, already used, or the organization is unavailable.'},404);
      return json(value,201);
    }

    if (request.method === 'GET' && url.pathname === '/enterprise/api/v1/me') {
      return json({schema:'musitu.axiom.enterprise-support-memberships.v1',memberships:await store.getEnterpriseMemberships(identity)});
    }

    const messageMatch=url.pathname.match(ENTERPRISE_ORG_MESSAGE_PATH);
    if(request.method==='POST'&&messageMatch){
      const orgRef=decodeURIComponent(messageMatch[1]);
      const body=await readJson(request);
      const value=await store.appendEnterpriseCustomerMessage(orgRef,messageMatch[2],identity,{body:body?.body});
      if(!value)return json({error:'ENTERPRISE_CASE_NOT_FOUND'},404);
      return json(value,201);
    }

    const caseMatch=url.pathname.match(ENTERPRISE_ORG_CASE_PATH);
    if(request.method==='GET'&&caseMatch){
      const orgRef=decodeURIComponent(caseMatch[1]);
      const value=await store.getEnterpriseCase(orgRef,caseMatch[2],identity);
      if(!value)return json({error:'ENTERPRISE_CASE_NOT_FOUND'},404);
      return json(value);
    }

    const casesMatch=url.pathname.match(ENTERPRISE_ORG_CASES_PATH);
    if(casesMatch){
      const orgRef=decodeURIComponent(casesMatch[1]);
      const context=await store.getEnterpriseOrganizationContext(orgRef,identity);
      if(!context)return json({error:'ENTERPRISE_ORGANIZATION_NOT_FOUND'},404);
      if(request.method==='GET'){
        const cases=await store.listEnterpriseCases(orgRef,identity,{limit:100});
        return json({schema:'musitu.axiom.enterprise-support-cases.v1',organization:context,cases:cases||[]});
      }
      if(request.method==='POST'){
        const rateState=await intakeRateState(env);
        if(rateState==='UNAVAILABLE')return json({error:'SERVICE_NOT_READY'},503);
        if(rateState==='LIMIT')return json({error:'RATE_LIMITED'},429,{'retry-after':'60'});
        const body=await readJson(request);
        if(!body||Array.isArray(body)||typeof body!=='object')throw new TypeError('intake must be an object');
        const {support_plan:_ignoredPlan,requester_ref:_ignoredRequester,turnstile_token:_ignoredTurnstile,...customerIntake}=body;
        const bundle=await createCaseRecord({...customerIntake,requester_ref:orgRef});
        const publicCase=await store.create(bundle,{supportPlan:context.plan,language:customerIntake.language||'und'});
        return json({
          case:publicCase,
          organization:{org_ref:context.org_ref,plan:context.plan,role:context.role,entitlements:context.entitlements},
          recovery_code:bundle.recovery_code,
          recovery_code_notice:'Save this backup recovery code now. Organization membership remains the primary shared-case access path.'
        },201);
      }
    }
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

  const emailThreadMatch=url.pathname.match(CASE_EMAIL_THREAD_PATH);
  if(request.method==='POST'&&emailThreadMatch){
    const code=recoveryCode(request);
    if(!code)return json({error:'CASE_AUTH_REQUIRED'},401,{'www-authenticate':'Support'});
    const body=await readJson(request);
    const email=String(body?.email||'').trim().toLowerCase();
    if(email.length<3||email.length>254||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return json({error:'INVALID_EMAIL'},400);
    const token=emailThreadToken();
    const threadRef='thread:'+token;
    const replyAddress='reply+'+token+'@mftintelligence.com';
    const store=await storeFor(env);
    const value=await store.bindCustomerEmailThread(emailThreadMatch[1],code,{
      thread_ref:threadRef,
      address_hash:await sha256Text(email),
      provider_thread_hash:await sha256Text(replyAddress),
    });
    if(!value)return json({error:'CASE_NOT_FOUND'},404);
    return json({case_id:emailThreadMatch[1],thread_ref:threadRef,reply_address:replyAddress,raw_customer_email_stored:false},201);
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
    const nativeObjects = env.SUPPORT_ATTACHMENTS && typeof env.SUPPORT_ATTACHMENTS.put === 'function' && typeof env.SUPPORT_ATTACHMENTS.get === 'function';
    if (!nativeObjects && typeof env.SUPPORT_ATTACHMENT_INIT !== 'function') return json({error:'ATTACHMENT_PROVIDER_UNAVAILABLE'},503);
    const body = await readJson(request);
    const store = await storeFor(env);
    const meta = await store.prepareAttachment(attachmentMatch[1],code,body);
    if (!meta) return json({error:'CASE_NOT_FOUND'},404);
    if (nativeObjects) {
      return json({...meta,upload_url:`/api/v1/cases/${encodeURIComponent(meta.case_id)}/attachments/${encodeURIComponent(meta.attachment_id)}/content`,expires_in:300},201);
    }
    const upload = await env.SUPPORT_ATTACHMENT_INIT(meta);
    if (!upload?.upload_url) return json({error:'ATTACHMENT_PROVIDER_UNAVAILABLE'},503);
    return json({...meta,upload_url:String(upload.upload_url),expires_in:Number(upload.expires_in||300)},201);
  }

  const attachmentContentMatch=url.pathname.match(CASE_ATTACHMENT_CONTENT_PATH);
  if(attachmentContentMatch && (request.method==='PUT'||request.method==='GET')){
    const code=recoveryCode(request);
    if(!code)return json({error:'CASE_AUTH_REQUIRED'},401,{'www-authenticate':'Support'});
    const store=await storeFor(env);
    const caseId=attachmentContentMatch[1],attachmentId=attachmentContentMatch[2];
    if(request.method==='PUT'){
      if(!env.SUPPORT_ATTACHMENTS||typeof env.SUPPORT_ATTACHMENTS.put!=='function')return json({error:'ATTACHMENT_PROVIDER_UNAVAILABLE'},503);
      const meta=await store.authorizeAttachmentUpload(caseId,code,attachmentId);
      if(!meta)return json({error:'ATTACHMENT_NOT_AVAILABLE'},404);
      const declared=Number(request.headers.get('content-length')||0);
      if(declared&&declared!==Number(meta.bytes))return json({error:'ATTACHMENT_SIZE_MISMATCH'},422);
      if(declared>25*1024*1024)return json({error:'PAYLOAD_TOO_LARGE'},413);
      const type=String(request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      if(type!==String(meta.content_type).toLowerCase())return json({error:'ATTACHMENT_TYPE_MISMATCH'},422);
      const bytes=new Uint8Array(await request.arrayBuffer());
      if(bytes.byteLength!==Number(meta.bytes))return json({error:'ATTACHMENT_SIZE_MISMATCH'},422);
      const digest=await crypto.subtle.digest('SHA-256',bytes);
      const actual=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
      if(actual!==String(meta.sha256).toLowerCase())return json({error:'ATTACHMENT_HASH_MISMATCH'},422);
      await env.SUPPORT_ATTACHMENTS.put(meta.storage_key,bytes,{httpMetadata:{contentType:meta.content_type},customMetadata:{case_id:caseId,attachment_id:attachmentId,sha256:actual}});
      await store.markAttachmentUploaded(attachmentId,{actor_ref:'requester'});
      return json({attachment_id:attachmentId,case_id:caseId,scan_state:'PENDING',uploaded:true},201);
    }
    if(!env.SUPPORT_ATTACHMENTS||typeof env.SUPPORT_ATTACHMENTS.get!=='function')return json({error:'ATTACHMENT_PROVIDER_UNAVAILABLE'},503);
    const meta=await store.authorizeAttachmentDownload(caseId,code,attachmentId);
    if(!meta)return json({error:'ATTACHMENT_NOT_AVAILABLE'},404);
    const object=await env.SUPPORT_ATTACHMENTS.get(meta.storage_key);
    if(!object||!object.body)return json({error:'ATTACHMENT_OBJECT_MISSING'},404);
    const safeName=String(meta.filename||'attachment').replace(/["\\\r\n]/g,'_');
    const headers=new Headers({
      'content-type':meta.content_type,
      'content-disposition':`attachment; filename="${safeName}"`,
      'cache-control':'no-store',
      'x-content-type-options':'nosniff',
    });
    if(Number(meta.bytes)>0)headers.set('content-length',String(meta.bytes));
    if(object.httpEtag)headers.set('etag',String(object.httpEtag));
    return new Response(object.body,{status:200,headers});
  }

  const reopenMatch=url.pathname.match(CASE_REOPEN_PATH);
  if(request.method==='POST'&&reopenMatch){
    const code=recoveryCode(request);
    if(!code)return json({error:'CASE_AUTH_REQUIRED'},401,{'www-authenticate':'Support'});
    const store=await storeFor(env);
    const value=await store.reopenCustomerCase(reopenMatch[1],code);
    if(!value)return json({error:'CASE_NOT_FOUND'},404);
    return json(value);
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
  const audience = String(value.audience || '');
  if (!/^AXN-[0-9A-HJKMNP-TV-Z]{16}$/.test(notificationId)) throw new TypeError('notification id is invalid');
  if (!/^AX-[0-9A-HJKMNP-TV-Z]{12}$/.test(caseId)) throw new TypeError('notification case id is invalid');
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(kind)) throw new TypeError('notification kind is invalid');

  if (audience === 'operator' && String(env.SUPPORT_OPS_EMAIL_READY || '').toLowerCase() === 'true' && env.SUPPORT_OPS_EMAIL && typeof env.SUPPORT_OPS_EMAIL.send === 'function') {
    const sender = String(env.SUPPORT_OPS_FROM || 'support@mftintelligence.com').trim().toLowerCase();
    if (!/^[^@\s]+@mftintelligence\.com$/.test(sender)) throw new TypeError('operator notification sender is invalid');
    const label = kind.replace(/_/g, ' ');
    const receipt = await env.SUPPORT_OPS_EMAIL.send({
      to: null,
      from: {email: sender, name: 'MUSITU Axiom Support'},
      subject: `MUSITU Axiom Support · ${label}`,
      text: `Case ${caseId}\nEvent ${kind}\nOpen Support Operations: https://support-ops.mftintelligence.com/\n\nThis alert contains case metadata only.`,
    });
    return Object.freeze({delivered:true,receipt_id:String(receipt?.messageId||receipt?.id||'')||null});
  }

  if (typeof env.SUPPORT_NOTIFICATION_SEND !== 'function') return Object.freeze({delivered:false,reason:'PROVIDER_UNAVAILABLE'});
  const payload=Object.freeze({notification_id:notificationId,case_id:caseId,kind});
  const receipt=await env.SUPPORT_NOTIFICATION_SEND(payload);
  return Object.freeze({delivered:true,receipt_id:String(receipt?.id||'')||null});
}

function bytesToHex(bytes){return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}

export async function deliverSupportWebhook(delivery, env = {}) {
  if (!delivery || typeof delivery !== 'object') throw new TypeError('webhook delivery required');

  if (delivery.delivery_config && typeof delivery.delivery_config === 'object') {
    const deliveryId=String(delivery.delivery_id||'');
    const eventType=String(delivery.event_type||'');
    if(!/^AXW-[0-9A-HJKMNP-TV-Z]{16}$/.test(deliveryId)||!/^case\.[a-z_]+$/.test(eventType))throw new TypeError('webhook delivery metadata invalid');
    const endpoint=validateWebhookEndpoint(delivery.delivery_config.endpoint_url);
    const secret=String(delivery.delivery_config.signing_secret||'');
    if(!endpoint.ok||secret.length<32||secret.length>256)return Object.freeze({delivered:false,reason:'PROVIDER_UNAVAILABLE'});
    const timestamp=String(typeof env.SUPPORT_WEBHOOK_NOW==='function'?Number(env.SUPPORT_WEBHOOK_NOW()):Math.floor(Date.now()/1000));
    if(!/^\d{9,13}$/.test(timestamp))throw new TypeError('webhook timestamp invalid');
    const body=JSON.stringify(delivery.payload||{});
    const signingInput=timestamp+'.'+deliveryId+'.'+body;
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signature=bytesToHex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(signingInput)));
    const fetchImpl=typeof env.SUPPORT_WEBHOOK_FETCH==='function'?env.SUPPORT_WEBHOOK_FETCH:fetch;
    const response=await fetchImpl(endpoint.value,{
      method:'POST',
      redirect:'error',
      headers:{
        'content-type':'application/json',
        'user-agent':'MUSITU-Axiom-Support-Webhook/1',
        'x-musitu-timestamp':timestamp,
        'x-musitu-delivery':deliveryId,
        'x-musitu-event':eventType,
        'x-musitu-signature':'v1='+signature
      },
      body
    });
    const status=Number(response?.status||0);
    const receiptId=String(response?.headers?.get?.('x-request-id')||response?.headers?.get?.('cf-ray')||'')||null;
    return Object.freeze({delivered:status>=200&&status<300,receipt_id:receiptId,status});
  }

  if (typeof env.SUPPORT_WEBHOOK_SEND !== 'function') return Object.freeze({delivered:false,reason:'PROVIDER_UNAVAILABLE'});
  const receipt = await env.SUPPORT_WEBHOOK_SEND(Object.freeze({...delivery}));
  const status = Number(receipt?.status || 0);
  return Object.freeze({delivered:status >= 200 && status < 300,receipt_id:String(receipt?.id||'')||null,status});
}

export async function processSupportQueues(env = {}) {
  const store = await storeFor(env);
  const sla = typeof store.scanSlaBreaches === 'function' ? await store.scanSlaBreaches() : {new_breaches:0,scanned:0};
  const summary = {sla,notifications:{delivered:0,failed:0,provider_unavailable:0},webhooks:{delivered:0,failed:0,provider_unavailable:0},attachments:{deleted:0,failed:0,provider_unavailable:0}};
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
  const attachmentDeletions = typeof store.listPendingAttachmentDeletions === 'function' ? await store.listPendingAttachmentDeletions({limit:50}) : [];
  for (const item of attachmentDeletions || []) {
    let result;
    if (!env.SUPPORT_ATTACHMENTS || typeof env.SUPPORT_ATTACHMENTS.delete !== 'function') {
      result={deleted:false,reason:'PROVIDER_UNAVAILABLE'};
      summary.attachments.provider_unavailable += 1;
    } else {
      try {
        await env.SUPPORT_ATTACHMENTS.delete(String(item.storage_key));
        result={deleted:true};
        summary.attachments.deleted += 1;
      } catch (error) {
        result={deleted:false,reason:'DELETE_FAILED',error_class:String(error?.name||'Error')};
        summary.attachments.failed += 1;
      }
    }
    if (typeof store.recordAttachmentDeletionAttempt === 'function') await store.recordAttachmentDeletionAttempt(item,result);
  }
  return Object.freeze({sla:Object.freeze(summary.sla),notifications:Object.freeze(summary.notifications),webhooks:Object.freeze(summary.webhooks),attachments:Object.freeze(summary.attachments)});
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


  if (request.method === 'GET' && url.pathname === '/api/v1/operator/sla/breaches') {
    return json({breaches:await store.listSlaBreaches()});
  }

  if (url.pathname === '/api/v1/operator/organizations' && request.method === 'POST') {
    const body=await readJson(request);
    return json(await store.upsertOrganization(body,principal),201);
  }

  const entitlementsMatch=url.pathname.match(OPERATOR_ORG_ENTITLEMENTS_PATH);
  if(request.method==='POST'&&entitlementsMatch){
    const body=await readJson(request);
    const value=await store.setOrganizationEntitlement(decodeURIComponent(entitlementsMatch[1]),body,principal);
    if(!value)return json({error:'ORGANIZATION_NOT_FOUND'},404);
    return json(value,201);
  }

  const orgInviteMatch=url.pathname.match(OPERATOR_ORG_INVITES_PATH);
  if(request.method==='POST'&&orgInviteMatch){
    const body=await readJson(request);
    const orgRef=decodeURIComponent(orgInviteMatch[1]);
    const value=await store.createOrganizationInvite(orgRef,body,principal);
    if(!value)return json({error:'ORGANIZATION_NOT_FOUND'},404);
    return json(value,201);
  }

  if(url.pathname==='/api/v1/operator/webhooks'&&request.method==='POST'){
    const body=await readJson(request);
    const value=await store.createWebhookSubscription(body,principal);
    if(!value)return json({error:'ORGANIZATION_NOT_FOUND'},404);
    return json(value,201);
  }

  const webhookDeliveryMatch=url.pathname.match(OPERATOR_WEBHOOK_DELIVERY_PATH);
  if(request.method==='POST'&&webhookDeliveryMatch){
    const body=await readJson(request);
    const value=await store.configureWebhookDelivery(decodeURIComponent(webhookDeliveryMatch[1]),body,principal);
    if(!value)return json({error:'WEBHOOK_NOT_FOUND'},404);
    return json(value);
  }

  if(url.pathname==='/api/v1/operator/macros'){
    if(request.method==='GET')return json({macros:await store.listOperatorMacros(principal)});
    if(request.method==='POST'){const body=await readJson(request);return json(await store.createOperatorMacro(body,principal),201);}
  }

  const qaMatch=url.pathname.match(OPERATOR_QA_PATH);
  if(request.method==='POST'&&qaMatch){
    const body=await readJson(request);
    const value=await store.recordQaReview(qaMatch[1],body,principal);
    if(!value)return json({error:'CASE_NOT_FOUND'},404);
    return json(value,201);
  }

  const triageMatch=url.pathname.match(OPERATOR_TRIAGE_PATH);
  if(request.method==='POST'&&triageMatch){
    const body=await readJson(request);
    const value=await store.setCaseTriage(triageMatch[1],body,principal);
    if(!value)return json({error:'CASE_NOT_FOUND'},404);
    return json(value);
  }

  const incidentStatusMatch=url.pathname.match(OPERATOR_INCIDENT_STATUS_PATH);
  if(request.method==='POST'&&incidentStatusMatch){
    const body=await readJson(request);
    const value=await store.updateIncidentStatus(incidentStatusMatch[1],body,principal);
    if(!value)return json({error:'INCIDENT_NOT_FOUND'},404);
    return json(value);
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

  const attachmentScanMatch=url.pathname.match(OPERATOR_ATTACHMENT_SCAN_PATH);
  if(request.method==='POST'&&attachmentScanMatch){
    const body=await readJson(request);
    const value=await store.recordAttachmentScan(attachmentScanMatch[1],body,principal);
    if(!value)return json({error:'ATTACHMENT_NOT_FOUND'},404);
    return json(value);
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
  async email(message, env) {
    const store=await storeFor(env);
    let raw='';
    try{raw=await new Response(message.raw).text();}catch{}
    const parts=raw.split(/\r?\n\r?\n/);
    const result=await handleInboundSupportEmail({
      to:message.to,from:message.from,text:parts.slice(1).join('\n\n').slice(0,8000),
    },{
      ...env,
      SUPPORT_STORE:store,
      SUPPORT_EMAIL_INGRESS_VERIFY:async()=>true,
    });
    if(!result.accepted&&typeof message.reject==='function')message.reject('Support reply address not recognized');
    return result;
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
