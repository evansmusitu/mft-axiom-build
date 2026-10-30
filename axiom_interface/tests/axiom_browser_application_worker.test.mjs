import assert from 'node:assert/strict';
import test from 'node:test';
import {sqliteD1,applyExecutionSchema} from './execution_test_helpers.mjs';
import {ATOMIC_OPERATIONS} from '../vnext/capability_registry.js';
import {sha256Json} from '../vnext/execution_integrity.mjs';

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

test('worker is fail-closed to the dedicated application hostname', async () => {
  const env = await environment();
  const apex = await worker.fetch(new Request('https://mftintelligence.com/axiom'), env);
  assert.equal(apex.status, 404);
  const www = await worker.fetch(new Request('https://www.mftintelligence.com/axiom'), env);
  assert.equal(www.status, 404);
  const reservedApi = await worker.fetch(new Request('https://axiom.mftintelligence.com/'), env);
  assert.equal(reservedApi.status, 404);
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

async function connectedEnvironment({operationCount=74}={}) {
  const calls=[],runtimeCalls=[],db=applyExecutionSchema(sqliteD1()),validHash=await sha256Hex(ACCOUNT_KEY);
  db.exec(`CREATE TABLE customers(id TEXT PRIMARY KEY,email TEXT,plan TEXT,status TEXT);
    CREATE TABLE api_keys(id TEXT PRIMARY KEY,customer_id TEXT,key_hash TEXT,key_prefix TEXT,label TEXT,status TEXT,created_at TEXT,last_used_at TEXT,expires_at TEXT,revoked_at TEXT);
    CREATE TABLE usage_events(request_id TEXT,customer_id TEXT,key_id TEXT,operation TEXT,compute_units INTEGER,http_status INTEGER,result_sha256 TEXT);`);
  db.connection.prepare('INSERT INTO customers VALUES(?,?,?,?)').run('customer-test','axiom.test@mftintelligence.com','developer','active');
  db.connection.prepare('INSERT INTO api_keys(id,customer_id,key_hash,status) VALUES(?,?,?,?)').run('key-owner','customer-test',validHash,'active');
  const prepare=db.prepare.bind(db);db.prepare=sql=>({bind(...values){calls.push({sql,values});return prepare(sql).bind(...values);}});
  const runtime={async fetch(input,init={}){
    const url=new URL(typeof input==='string'?input:input.url);runtimeCalls.push({url,init});
    if(url.pathname==='/health')return Response.json({ok:true,build_id:'protected-runtime-build',operation_count:operationCount});
    if(url.pathname==='/v1/tools')return Response.json({build_id:'protected-runtime-build',operation_count:operationCount,tools:ATOMIC_OPERATIONS.slice(0,operationCount)});
    if(url.pathname==='/v1/compute'){
      const keyHash=await sha256Hex(init.headers.authorization.slice(7)),key=db.connection.prepare('SELECT * FROM api_keys WHERE key_hash=?').get(keyHash);
      assert.ok(key,'delegated key must actually exist');
      const body={result:{value:42}},digest=await sha256Json(body),rid=init.headers['x-musitu-request-id'];
      db.connection.prepare('INSERT INTO usage_events VALUES(?,?,?,?,?,?,?)').run(rid,key.customer_id,key.id,'arithmetic.evaluate',1,200,digest);
      return Response.json({...body,receipt:{customer_id:key.customer_id,request_id:rid,operation:'arithmetic.evaluate',result_sha256:digest}});
    }
    return new Response('not found',{status:404});
  }};
  return {calls,runtimeCalls,env:{
    ASSETS:{async fetch(){return new Response('<!doctype html><title>MUSITU Axiom Workspace</title>',{headers:{'content-type':'text/html'}});}},
    AXIOM_DB:db,AXIOM_RUNTIME:runtime,AUTH_RATE_LIMITER:{async limit(){return {success:true};}},TASK_RATE_LIMITER:{async limit(){return {success:true};}},
    AXIOM_BROWSER_SESSION_SECRET:'connected-test-session-secret-with-more-than-thirty-two-bytes',APP_HOST:'connected.example',APP_ORIGIN:'https://connected.example',APP_ENTRY:'/vnext/index.html#/home',APP_ASSET_ENTRY:'/vnext/index.html',RUNTIME_CONNECTION_REQUIRED:'true',BUILD_SHA:'1'.repeat(40),
  }};
}

async function connectedSession(env){
  const origin='https://connected.example';
  const start=await worker.fetch(new Request(`${origin}/auth/start`),env),csrfCookie=cookieValue(start.headers.get('set-cookie'),'__Host-axiom_login_csrf');
  const csrf=(await start.text()).match(/name="csrf" value="([^"]+)"/)?.[1];
  const login=await worker.fetch(new Request(`${origin}/auth/session`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',cookie:`__Host-axiom_login_csrf=${csrfCookie}`,origin},body:new URLSearchParams({csrf,musitu_account_key:ACCOUNT_KEY})}),env);
  assert.equal(login.status,303);assert.equal(login.headers.get('location'),'/vnext/index.html#/home');
  return cookieValue(login.headers.get('set-cookie'),'__Host-axiom_session');
}

test('connected worker proves login through completed metered protected execution',async()=>{
  const fixture=await connectedEnvironment(),origin='https://connected.example',session=await connectedSession(fixture.env);
  const connection=await worker.fetch(new Request(`${origin}/vnext/api/runtime`),fixture.env);
  assert.equal(connection.status,200);assert.equal((await connection.json()).fully_connected,true);
  const response=await worker.fetch(new Request(`${origin}/vnext/api/tasks`,{method:'POST',headers:{origin,cookie:`__Host-axiom_session=${session}`,'content-type':'application/json',accept:'text/event-stream'},body:JSON.stringify({objective:'Calculate 40+2 and explain the verified result.',submission_id:'submission-fixture',execution_context:{project_id:'project-test',work_id:'work-test',controls:{privacy:'Private',budget:1}}})}),fixture.env);
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const stream=await response.text();
  for(const phase of ['ACCEPTED','RUNTIME_CONNECTED','EXECUTING','SYNTHESIZING','PERSISTING','COMPLETED'])assert.match(stream,new RegExp(`"phase":"${phase}"`));
  assert.match(stream,/"value":42/);assert.match(stream,/"customer_metered":true/);assert.match(stream,/"operation_count":74/);
  assert.ok(fixture.calls.some(call=>/INSERT INTO axiom_ec_runs/i.test(call.sql)));
  assert.ok(fixture.calls.some(call=>/INSERT INTO api_keys/i.test(call.sql)));
  assert.ok(fixture.calls.some(call=>/DELETE FROM api_keys/i.test(call.sql)));
  assert.ok(fixture.calls.some(call=>/UPDATE axiom_ec_runs SET status='COMPLETED'/i.test(call.sql)));
  assert.doesNotMatch(stream,/authorization|bearer|musitu_test_account_key/i);
});

test('connected worker rejects a partial protected-runtime catalog',async()=>{
  const fixture=await connectedEnvironment({operationCount:73}),origin='https://connected.example';
  const connection=await worker.fetch(new Request(`${origin}/vnext/api/runtime`),fixture.env);
  assert.equal(connection.status,503);const body=await connection.json();assert.equal(body.fully_connected,false);
  assert.match(body.error,/complete protected runtime contract unavailable/i);
});
