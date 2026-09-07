import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../index.storefront-v3.mjs';

const base='https://payments.mftintelligence.com';
async function get(path){const r=await handleRequest(new Request(base+path),{});return {r,text:await r.text()}}
function strict(r){
  const csp=r.headers.get('content-security-policy')||'';
  assert.match(csp,/style-src 'self'/);assert.match(csp,/script-src 'self'/);assert.match(csp,/connect-src 'self'/);assert.match(csp,/manifest-src 'self'/);
  assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval|https?:\/\//);
  assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  assert.equal(r.headers.get('x-frame-options'),'DENY');
  assert.equal(r.headers.get('x-content-type-options'),'nosniff');
}

test('generated Worker routes Rescue through the universal adaptive install concierge',async()=>{
  const rescue=await get('/chemistry/rescue?src=direct');
  assert.equal(rescue.r.status,200);strict(rescue.r);
  assert.match(rescue.text,/href="\/chemistry\/install">Install \/ Start Free</);

  const install=await get('/chemistry/install');
  assert.equal(install.r.status,200);strict(install.r);
  assert.match(install.text,/Get MUSITU on this device/);
  assert.match(install.text,/data-install-panel="ios-safari"/);
  assert.match(install.text,/data-install-panel="installed"/);
  assert.match(install.text,/\/chemistry\/install\/diagnostics/);
  assert.match(install.text,/\/chemistry\/assets\/install-concierge\.css/);
});

test('install diagnostics is hidden from indexing and exposes local health checks only',async()=>{
  const diag=await get('/chemistry/install/diagnostics');
  assert.equal(diag.r.status,200);strict(diag.r);
  assert.match(diag.text,/noindex,nofollow/);
  assert.match(diag.text,/MUSITU installation check/);
  assert.equal(diag.r.headers.get('cache-control'),'no-store');

  const js=await get('/chemistry/assets/install-diagnostics.js');
  assert.equal(js.r.status,200);
  assert.match(js.r.headers.get('content-type')||'',/^application\/javascript/);
  assert.match(js.text,/\/chemistry\/manifest\.webmanifest/);
  assert.match(js.text,/\/chemistry\/sw\.js/);
  assert.doesNotMatch(js.text,/(sendBeacon|document\.cookie|localStorage|sessionStorage)/);
});

test('install assets and bounded service worker are same-origin with safe cache policy',async()=>{
  const js=await get('/chemistry/assets/install-handoff.js');
  assert.equal(js.r.status,200);
  assert.match(js.text,/beforeinstallprompt/);
  assert.match(js.text,/appinstalled/);
  assert.match(js.text,/musitu:field-event/);
  assert.match(js.text,/serviceWorker\.register/);

  const css=await get('/chemistry/assets/install-concierge.css');
  assert.equal(css.r.status,200);
  assert.match(css.r.headers.get('content-type')||'',/^text\/css/);
  assert.match(css.text,/ios-coach/);
  assert.match(css.text,/install-onboarding/);

  const sw=await get('/chemistry/sw.js');
  assert.equal(sw.r.status,200);
  assert.match(sw.r.headers.get('content-type')||'',/^application\/javascript/);
  assert.match(sw.r.headers.get('cache-control')||'',/no-cache/);
  assert.equal(sw.r.headers.get('service-worker-allowed'),'/chemistry/');
  assert.match(sw.text,/checkout\|return\|claim\|telemetry\|plans/);
  assert.match(sw.text,/musitu-chemistry-install-v2/);
});

test('install route is in sitemap while diagnostics remains intentionally hidden',async()=>{
  const sitemap=await get('/chemistry/sitemap.xml');
  assert.equal(sitemap.r.status,200);
  assert.match(sitemap.text,/\/chemistry\/install/);
  assert.doesNotMatch(sitemap.text,/\/chemistry\/install\/diagnostics/);
});
