const APP_HOST = 'app.mftintelligence.com';
const APP_ORIGIN = `https://${APP_HOST}`;
const SESSION_SCHEMA = 'musitu.axiom.browser-session.v1';
const SESSION_COOKIE = '__Host-axiom_session';
const CSRF_COOKIE = '__Host-axiom_login_csrf';
const SESSION_SECONDS = 3600;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const COMMON_HEADERS = Object.freeze({
  'cross-origin-opener-policy':'same-origin',
  'cross-origin-resource-policy':'same-origin',
  'referrer-policy':'strict-origin-when-cross-origin',
  'x-axiom-browser-application':'production',
  'x-content-type-options':'nosniff',
  'x-frame-options':'DENY',
});

const APPLICATION_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";
const AUTH_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{
      ...COMMON_HEADERS,
      'cache-control':'no-store',
      'content-type':'application/json; charset=utf-8',
      'pragma':'no-cache',
      ...extra,
    },
  });
}

function html(status, body, extra = {}) {
  return new Response(body, {
    status,
    headers:{
      ...COMMON_HEADERS,
      'cache-control':'no-store',
      'content-security-policy':AUTH_CSP,
      'content-type':'text/html; charset=utf-8',
      'pragma':'no-cache',
      ...extra,
    },
  });
}

function escaped(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  })[character]);
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function randomValue(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64url(value);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function signingKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('browser_session_secret_unavailable');
  return crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign', 'verify']);
}

async function sealSession(payload, secret) {
  const encoded = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(encoded));
  return `${encoded}.${base64url(new Uint8Array(signature))}`;
}

async function openSession(value, secret) {
  const parts = String(value || '').split('.');
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  let signature;
  try { signature = decodeBase64url(parts[1]); } catch { return null; }
  const valid = await crypto.subtle.verify('HMAC', await signingKey(secret), signature, encoder.encode(parts[0]));
  if (!valid) return null;
  let payload;
  try { payload = JSON.parse(decoder.decode(decodeBase64url(parts[0]))); } catch { return null; }
  if (payload?.v !== 1 || !/^[A-Za-z0-9._:@+-]{1,180}$/.test(String(payload.cid || ''))) return null;
  if (!/^[A-Za-z0-9_-]{16,120}$/.test(String(payload.sid || ''))) return null;
  if (!Number.isSafeInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function cookie(request, name) {
  for (const segment of (request.headers.get('cookie') || '').split(';')) {
    const separator = segment.indexOf('=');
    if (separator > 0 && segment.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(segment.slice(separator + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}

function setCookie(name, value, maxAge, sameSite) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${sameSite}`;
}

function accountKey(value) {
  return String(value ?? '')
    .replace(/^[\s\u200E\u200F\u202A-\u202E\u2066-\u2069]+|[\s\u200E\u200F\u202A-\u202E\u2066-\u2069]+$/g, '');
}

function loginPage(csrf, error = '') {
  const notice = error ? `<div class="error" role="alert">${escaped(error)}</div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to MUSITU Axiom</title><style>body{box-sizing:border-box;margin:0;min-height:100vh;padding:7vh 20px;background:#08101f;color:#edf3ff;font:16px/1.5 system-ui,sans-serif}.card{box-sizing:border-box;max-width:560px;margin:auto;padding:32px;border:1px solid #29415f;border-radius:20px;background:#111c2e;box-shadow:0 24px 80px #0007}h1{margin-top:0}label{display:block;margin:24px 0 8px;font-weight:700}input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #55708f;border-radius:10px;background:#07101d;color:#fff;font:inherit}button,.back{display:block;box-sizing:border-box;width:100%;margin-top:18px;padding:13px;border:0;border-radius:10px;background:#83b8ff;color:#06101d;text-align:center;text-decoration:none;font:inherit;font-weight:800}.back{background:#26364d;color:#edf3ff}.note{color:#aebed3}.error{padding:12px;border:1px solid #e49191;border-radius:10px;background:#421d28;color:#ffe8ec}</style></head><body><main class="card"><h1>Sign in to MUSITU Axiom</h1><p>Use your existing MUSITU Axiom account key. It is verified over HTTPS and is never stored in the browser session.</p>${notice}<form method="post" action="/auth/session"><input type="hidden" name="csrf" value="${escaped(csrf)}"><label for="account-key">MUSITU Axiom account key</label><input id="account-key" name="musitu_account_key" type="password" autocomplete="current-password" minlength="48" maxlength="512" required><button type="submit">Continue to Axiom</button></form><p class="note">The application receives only a signed, HttpOnly session cookie. No account key is returned to JavaScript.</p><a class="back" href="/#/home">Continue as guest</a></main></body></html>`;
}

function guestSession(extraHeaders = {}) {
  return json(200, {
    schema:SESSION_SCHEMA,
    authenticated:false,
    sign_in_path:'/auth/start',
  }, extraHeaders);
}

async function sessionResponse(request, env) {
  let session = null;
  try { session = await openSession(cookie(request, SESSION_COOKIE), env.AXIOM_BROWSER_SESSION_SECRET); } catch {}
  if (!session || !env.AXIOM_DB) return guestSession();
  const row = await env.AXIOM_DB
    .prepare("SELECT id,email FROM customers WHERE id=?1 AND status='active' LIMIT 1")
    .bind(session.cid)
    .first();
  if (!row?.id || !row.email) return guestSession({'set-cookie':setCookie(SESSION_COOKIE, '', 0, 'Lax')});
  return json(200, {
    schema:SESSION_SCHEMA,
    authenticated:true,
    subject:await sha256Hex(`https://auth.mftintelligence.com\n${row.id}`),
    display_name:String(row.email).slice(0, 120),
    session_id:session.sid,
    assurance:'MUSITU_ACCOUNT_KEY_SERVER_SESSION',
    expires_at:new Date(session.exp * 1000).toISOString(),
    sign_out_path:'/auth/sign-out',
  });
}

async function startLogin(env) {
  if (!env.AXIOM_DB || typeof env.AXIOM_BROWSER_SESSION_SECRET !== 'string') {
    return html(503, loginPage('', 'Account sign-in is temporarily unavailable. Continue as guest and retry later.'));
  }
  const csrf = randomValue();
  return html(200, loginPage(csrf), {
    'set-cookie':setCookie(CSRF_COOKIE, csrf, 600, 'Strict'),
  });
}

async function createSession(request, env) {
  if (request.headers.get('origin') !== APP_ORIGIN) return json(403, {error:'origin_rejected'});
  if (!env.AUTH_RATE_LIMITER?.limit) return json(503, {error:'authentication_rate_limit_unavailable'});
  const source = request.headers.get('cf-connecting-ip') || 'unknown';
  const limited = await env.AUTH_RATE_LIMITER.limit({key:`axiom-browser-login:${await sha256Hex(source)}`});
  if (!limited?.success) return json(429, {error:'authentication_rate_limited'}, {'retry-after':'60'});
  const length = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > 4096) return json(413, {error:'request_too_large'});
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/x-www-form-urlencoded')) return json(415, {error:'unsupported_media_type'});
  let raw;
  try { raw = await request.text(); } catch { return json(400, {error:'invalid_form'}); }
  if (raw.length > 4096) return json(413, {error:'request_too_large'});
  const form = new URLSearchParams(raw);
  const submittedCsrf = String(form.get('csrf') || '');
  const cookieCsrf = cookie(request, CSRF_COOKIE);
  if (submittedCsrf.length > 128 || cookieCsrf.length > 128) return json(403, {error:'csrf_rejected'});
  if (!submittedCsrf || !cookieCsrf || !safeEqual(submittedCsrf, cookieCsrf)) return json(403, {error:'csrf_rejected'});
  const key = accountKey(form.get('musitu_account_key'));
  if (key.length < 48 || key.length > 512 || !env.AXIOM_DB || typeof env.AXIOM_BROWSER_SESSION_SECRET !== 'string') {
    return html(401, loginPage(submittedCsrf, 'Account authentication failed.'));
  }
  const now = new Date().toISOString();
  const row = await env.AXIOM_DB
    .prepare("SELECT k.customer_id,c.email FROM api_keys k JOIN customers c ON c.id=k.customer_id WHERE k.key_hash=?1 AND k.status='active' AND c.status='active' AND (k.expires_at IS NULL OR k.expires_at>?2) LIMIT 1")
    .bind(await sha256Hex(key), now)
    .first();
  if (!row?.customer_id || !row.email) return html(401, loginPage(submittedCsrf, 'Account authentication failed.'));
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const sealed = await sealSession({v:1, cid:String(row.customer_id), sid:randomValue(24), exp:expires}, env.AXIOM_BROWSER_SESSION_SECRET);
  const headers = new Headers({
    ...COMMON_HEADERS,
    'cache-control':'no-store',
    'location':'/#/home',
    'pragma':'no-cache',
  });
  headers.append('set-cookie', setCookie(SESSION_COOKIE, sealed, SESSION_SECONDS, 'Lax'));
  headers.append('set-cookie', setCookie(CSRF_COOKIE, '', 0, 'Strict'));
  return new Response(null, {status:303, headers});
}

function signOut(request) {
  if (request.headers.get('origin') !== APP_ORIGIN) return json(403, {error:'origin_rejected'});
  return new Response(null, {
    status:204,
    headers:{
      ...COMMON_HEADERS,
      'cache-control':'no-store',
      'set-cookie':setCookie(SESSION_COOKIE, '', 0, 'Lax'),
    },
  });
}

function hardenedAsset(response, path) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(COMMON_HEADERS)) headers.set(name, value);
  headers.set('content-disposition', 'inline');
  headers.set('content-security-policy', APPLICATION_CSP);
  if (path === '/sw.js') headers.set('service-worker-allowed', '/');
  if (path === '/' || path === '/index.html' || path === '/sw.js' || path === '/manifest.webmanifest' || path === '/browser-app.json') {
    headers.set('cache-control', 'no-cache');
  }
  return new Response(response.body, {status:response.status, statusText:response.statusText, headers});
}

async function staticApplication(request, env, url) {
  if (!['GET', 'HEAD'].includes(request.method)) return json(405, {error:'method_not_allowed'}, {allow:'GET, HEAD'});
  if (!env.ASSETS?.fetch) return json(503, {error:'application_assets_unavailable'});
  let response = await env.ASSETS.fetch(request);
  const acceptsHtml = (request.headers.get('accept') || '').toLowerCase().includes('text/html');
  if (response.status === 404 && (request.mode === 'navigate' || acceptsHtml)) {
    response = await env.ASSETS.fetch(new Request(`${APP_ORIGIN}/index.html`, request));
  }
  return hardenedAsset(response, url.pathname);
}

async function application(request, env, url) {
  if (url.pathname === '/health' && ['GET', 'HEAD'].includes(request.method)) {
    const configured = Boolean(env.ASSETS?.fetch && env.AXIOM_DB && env.AUTH_RATE_LIMITER?.limit && typeof env.AXIOM_BROWSER_SESSION_SECRET === 'string');
    return json(configured ? 200 : 503, {
      schema:'musitu.axiom.browser-application.production-health.v1',
      ok:configured,
      service:'MUSITU Axiom browser application',
      build_sha:String(env.BUILD_SHA || ''),
      app_origin:APP_ORIGIN,
      integration_entry:`${APP_ORIGIN}/`,
      reserved_api_origin_preserved:true,
      normal_launch_download:false,
      account_session_integration:configured,
    });
  }
  if (url.pathname === '/.well-known/axiom-session' && request.method === 'GET') return sessionResponse(request, env);
  if (url.pathname === '/auth/start' && request.method === 'GET') return startLogin(env);
  if (url.pathname === '/auth/session' && request.method === 'POST') return createSession(request, env);
  if (url.pathname === '/auth/sign-out' && request.method === 'POST') return signOut(request);
  if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/.well-known/')) return json(404, {error:'not_found'});
  return staticApplication(request, env, url);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== APP_HOST) return json(404, {error:'not_found'});
    return application(request, env, url);
  },
};
