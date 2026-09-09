import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../index.storefront-v3.mjs';

const base='https://payments.mftintelligence.com';
const NEW_SHA='4ba442122d9c86a0c3cef660334fe337c6ea9ae6fe853c964b5e94961245babd';
const NEW_APK='/chemistry/download/MUSITU_Chemistry_Mastery_1.3.0.apk';
const UA={androidChrome:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',iphoneSafari:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'};
async function get(path,headers={}){const r=await handleRequest(new Request(base+path,{headers}),{});return {r,text:await r.text()}}
function strict(r){
  const csp=r.headers.get('content-security-policy')||'';
  assert.match(csp,/style-src 'self'/);assert.match(csp,/script-src 'self'/);assert.match(csp,/connect-src 'self'/);assert.match(csp,/manifest-src 'self'/);
  assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval|https?:\/\//);
  assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.equal(r.headers.get('x-frame-options'),'DENY');assert.equal(r.headers.get('x-content-type-options'),'nosniff');
}

test('generated Worker routes Rescue through device-aware install and Android to signed stable 1.3.0',async()=>{
  const rescue=await get('/chemistry/rescue?src=direct');
  assert.equal(rescue.r.status,200);strict(rescue.r);assert.match(rescue.text,/href="\/chemistry\/install">Install \/ Start Free</);

  const install=await get('/chemistry/install',{'user-agent':UA.androidChrome});
  assert.equal(install.r.status,302);
  assert.equal(install.r.headers.get('location'),NEW_APK);
  assert.equal(install.r.headers.get('cache-control'),'no-store');
  assert.equal(install.r.headers.get('x-musitu-release-version'),'1.3.0');
  assert.equal(install.r.headers.get('x-musitu-release-sha256'),NEW_SHA);
  assert.equal(install.text,'');

  const ios=await get('/chemistry/install',{'user-agent':UA.iphoneSafari});
  assert.equal(ios.r.status,200);strict(ios.r);
  assert.equal(ios.r.headers.get('cache-control'),'no-store');
  assert.match(ios.text,/data-install-mode="ios-safari"/);
  assert.match(ios.text,/data-install-panel="ios-safari"/);
  assert.match(ios.text,/\/chemistry\/manifest\.webmanifest\?v=2/);
  assert.match(ios.text,/\/chemistry\/install\/diagnostics/);
  assert.doesNotMatch(ios.text,/MUSITU_Chemistry_Mastery_1\.2\.0\.apk|055b63f271c18faab540985faefb970f472ea55ba9cb3495db459797902b790d/);
});

test('install diagnostics is hidden from indexing and exposes local health checks only',async()=>{
  const diag=await get('/chemistry/install/diagnostics');
  assert.equal(diag.r.status,200);strict(diag.r);assert.match(diag.text,/noindex,nofollow/);assert.match(diag.text,/MUSITU installation check/);assert.equal(diag.r.headers.get('cache-control'),'no-store');
  const js=await get('/chemistry/assets/install-diagnostics.js');
  assert.equal(js.r.status,200);assert.match(js.r.headers.get('content-type')||'',/^application\/javascript/);assert.match(js.text,/\/chemistry\/manifest\.webmanifest\?v=2/);assert.match(js.text,/\/chemistry\/sw\.js/);assert.match(js.text,/\?v=4/);assert.doesNotMatch(js.text,/(sendBeacon|document\.cookie|localStorage|sessionStorage)/);
});

test('service worker v9 preserves installed web-app Prove while excluding Android install from cache authority',async()=>{
  const sw=await get('/chemistry/sw.js');
  assert.equal(sw.r.status,200);
  assert.match(sw.r.headers.get('content-type')||'',/^application\/javascript/);
  assert.match(sw.r.headers.get('cache-control')||'',/no-cache/);
  assert.equal(sw.r.headers.get('service-worker-allowed'),'/chemistry/');
  assert.match(sw.text,/musitu-chemistry-install-v9/);
  assert.doesNotMatch(sw.text,/musitu-chemistry-install-v8/);
  assert.match(sw.text,/const APP='\/chemistry\/app'/);
  assert.match(sw.text,/\/chemistry\/app\?view=rescue/);
  assert.match(sw.text,/\/chemistry\/app\?view=exam/);
  assert.match(sw.text,/\/chemistry\/app\?view=premium/);
  assert.match(sw.text,/\/chemistry\/app\?view=help/);
  assert.match(sw.text,/\/chemistry\/assets\/app-shell\.css\?v=5/);
  assert.match(sw.text,/\/chemistry\/assets\/app-shell\.js\?v=5/);
  assert.match(sw.text,/\/chemistry\/assets\/app-bridge\.js\?v=1/);
  assert.match(sw.text,/\/chemistry\/manifest\.webmanifest\?v=2/);
  assert.match(sw.text,/if\(u\.pathname==='\/chemistry\/app'\)/);
  assert.match(sw.text,/networkFirst\(req,APP\)/);
  assert.match(sw.text,/checkout\|return\|claim\|telemetry\|plans\|install/);
  assert.doesNotMatch(sw.text,/const INSTALL='\/chemistry\/install'/);
  assert.doesNotMatch(sw.text,/networkFirst\(req,INSTALL\)/);
  assert.match(sw.text,/!res\.redirected/);
  assert.doesNotMatch(sw.text,/caches\.match\('\/chemistry\/rescue\?src=direct'\)\)\);return;/);
});

test('install assets remain stale-cache resistant',async()=>{
  const js=await get('/chemistry/assets/install-handoff.js');
  assert.equal(js.r.status,200);assert.match(js.text,/beforeinstallprompt/);assert.match(js.text,/appinstalled/);assert.match(js.text,/musitu:field-event/);assert.match(js.text,/serviceWorker\.register/);assert.match(js.text,/immediateMode/);
  const css=await get('/chemistry/assets/install-concierge.css');
  assert.equal(css.r.status,200);assert.match(css.r.headers.get('content-type')||'',/^text\/css/);assert.match(css.text,/color:#f7f9fc/);assert.match(css.text,/ios-coach/);assert.match(css.text,/install-onboarding/);
});

test('install route is in sitemap while diagnostics remains intentionally hidden',async()=>{
  const sitemap=await get('/chemistry/sitemap.xml');
  assert.equal(sitemap.r.status,200);assert.match(sitemap.text,/\/chemistry\/install/);assert.doesNotMatch(sitemap.text,/\/chemistry\/install\/diagnostics/);
});
