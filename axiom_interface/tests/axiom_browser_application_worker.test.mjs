import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../../ops/axiom_browser_application_worker.mjs';

const encoder = new TextEncoder();
const APP_ORIGIN = 'https://app.mftintelligence.com';
const ACCOUNT_KEY = 'musitu_test_account_key_for_browser_application_000000000001';

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function database(validHash) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes('FROM api_keys')) {
                return values[0] === validHash
                  ? {customer_id:'customer-test', email:'axiom.test@mftintelligence.com'}
                  : null;
              }
              if (sql.includes('FROM customers')) {
                return values[0] === 'customer-test'
                  ? {id:'customer-test', email:'axiom.test@mftintelligence.com'}
                  : null;
              }
              throw new Error(`unexpected query: ${sql}`);
            },
          };
        },
      };
    },
  };
}

async function environment() {
  return {
    ASSETS:{
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/' || path === '/index.html') {
          return new Response('<!doctype html><title>MUSITU Axiom Workspace</title>', {
            status:200,
            headers:{'content-type':'text/html; charset=utf-8'},
          });
        }
        return new Response('not found', {status:404});
      },
    },
    AXIOM_DB:database(await sha256Hex(ACCOUNT_KEY)),
    AUTH_RATE_LIMITER:{async limit() { return {success:true}; }},
    AXIOM_BROWSER_SESSION_SECRET:'test-only-browser-session-secret-with-more-than-thirty-two-bytes',
    BUILD_SHA:'0123456789abcdef0123456789abcdef01234567',
  };
}

function cookieValue(setCookie, name) {
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  assert.ok(match, `missing ${name} cookie`);
  return match[1];
}

test('apex integration entry redirects to the dedicated application origin only', async () => {
  const env = await environment();
  const response = await worker.fetch(new Request('https://mftintelligence.com/axiom?campaign=launch'), env);
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), `${APP_ORIGIN}/?campaign=launch`);
  const doubleSlash = await worker.fetch(new Request('https://mftintelligence.com/axiom//example.net/phish'), env);
  assert.equal(doubleSlash.status, 308);
  assert.equal(doubleSlash.headers.get('location'), `${APP_ORIGIN}//example.net/phish`);
  const unrelated = await worker.fetch(new Request('https://mftintelligence.com/axiomatic'), env);
  assert.equal(unrelated.status, 404);
});

test('guest session advertises a same-origin sign-in path without credential material', async () => {
  const env = await environment();
  const response = await worker.fetch(new Request(`${APP_ORIGIN}/.well-known/axiom-session`), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(body, {
    schema:'musitu.axiom.browser-session.v1',
    authenticated:false,
    sign_in_path:'/auth/start',
  });
});

test('account authentication creates and restores only a signed HttpOnly session', async () => {
  const env = await environment();
  const start = await worker.fetch(new Request(`${APP_ORIGIN}/auth/start`), env);
  assert.equal(start.status, 200);
  const csrfCookie = cookieValue(start.headers.get('set-cookie'), '__Host-axiom_login_csrf');
  const page = await start.text();
  const csrf = page.match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrf);

  const form = new URLSearchParams({csrf, musitu_account_key:ACCOUNT_KEY});
  const login = await worker.fetch(new Request(`${APP_ORIGIN}/auth/session`, {
    method:'POST',
    headers:{
      'content-type':'application/x-www-form-urlencoded',
      cookie:`__Host-axiom_login_csrf=${csrfCookie}`,
      origin:APP_ORIGIN,
    },
    body:form,
    redirect:'manual',
  }), env);
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), '/#/home');
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /__Host-axiom_session=[^;]+; Path=\/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax/);
  assert.doesNotMatch(setCookie, new RegExp(ACCOUNT_KEY));
  const sessionCookie = cookieValue(setCookie, '__Host-axiom_session');

  const restored = await worker.fetch(new Request(`${APP_ORIGIN}/.well-known/axiom-session`, {
    headers:{cookie:`__Host-axiom_session=${sessionCookie}`},
  }), env);
  assert.equal(restored.status, 200);
  const body = await restored.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.display_name, 'axiom.test@mftintelligence.com');
  assert.equal(body.assurance, 'MUSITU_ACCOUNT_KEY_SERVER_SESSION');
  assert.equal(body.sign_out_path, '/auth/sign-out');
  assert.equal(Object.keys(body).some(key => /token|password|api_key|secret/i.test(key)), false);

  const signOut = await worker.fetch(new Request(`${APP_ORIGIN}/auth/sign-out`, {
    method:'POST',
    headers:{cookie:`__Host-axiom_session=${sessionCookie}`, origin:APP_ORIGIN},
  }), env);
  assert.equal(signOut.status, 204);
  assert.match(signOut.headers.get('set-cookie'), /__Host-axiom_session=; Path=\/; Max-Age=0/);
});

test('account authentication fails closed when the abuse-control budget is exhausted', async () => {
  const env = await environment();
  env.AUTH_RATE_LIMITER = {async limit() { return {success:false}; }};
  const response = await worker.fetch(new Request(`${APP_ORIGIN}/auth/session`, {
    method:'POST',
    headers:{origin:APP_ORIGIN},
    body:new URLSearchParams(),
  }), env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.deepEqual(await response.json(), {error:'authentication_rate_limited'});
});

test('account authentication rejects overlong keys instead of accepting a truncated prefix', async () => {
  const env = await environment();
  const start = await worker.fetch(new Request(`${APP_ORIGIN}/auth/start`), env);
  const csrfCookie = cookieValue(start.headers.get('set-cookie'), '__Host-axiom_login_csrf');
  const csrf = (await start.text()).match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrf);
  const response = await worker.fetch(new Request(`${APP_ORIGIN}/auth/session`, {
    method:'POST',
    headers:{
      'content-type':'application/x-www-form-urlencoded',
      cookie:`__Host-axiom_login_csrf=${csrfCookie}`,
      origin:APP_ORIGIN,
    },
    body:new URLSearchParams({csrf, musitu_account_key:`${ACCOUNT_KEY}${'x'.repeat(520)}`}),
  }), env);
  assert.equal(response.status, 401);
  assert.match(await response.text(), /Account authentication failed/);
});

test('static application responses remain inline and hardened', async () => {
  const env = await environment();
  const response = await worker.fetch(new Request(`${APP_ORIGIN}/`), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-disposition'), 'inline');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.match(await response.text(), /MUSITU Axiom Workspace/);
});
