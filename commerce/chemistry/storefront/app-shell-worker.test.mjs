import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../index.storefront-v3.mjs';

const base='https://payments.mftintelligence.com';
const androidUA='Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
async function get(path,headers={}){const r=await handleRequest(new Request(base+path,{headers}),{});return {r,text:await r.text()}}

test('Android app entry is server-routed to native install before web preview can render',async()=>{
  for(const path of ['/chemistry/app','/chemistry/app?view=exam','/chemistry/app?view=premium']){
    const x=await get(path,{'user-agent':androidUA});
    assert.equal(x.r.status,302);
    assert.equal(x.r.headers.get('location'),'/chemistry/install');
    assert.equal(x.r.headers.get('cache-control'),'no-store');
    assert.equal(x.r.headers.get('x-musitu-platform-route'),'android-native');
    assert.equal(x.text,'');
  }
});

test('non-Android generated Worker serves a no-store native-feel app shell, Prove and current local assets',async()=>{
  const app=await get('/chemistry/app');
  assert.equal(app.r.status,200);
  assert.equal(app.r.headers.get('cache-control'),'no-store');
  assert.match(app.text,/class="app-topbar"/);
  assert.match(app.text,/class="app-nav"/);
  assert.match(app.text,/Your Chemistry workspace/);
  assert.match(app.text,/\/chemistry\/manifest\.webmanifest\?v=2/);
  assert.match(app.text,/\/chemistry\/assets\/app-shell\.css\?v=5/);
  assert.match(app.text,/\/chemistry\/assets\/app-shell\.js\?v=5/);
  assert.doesNotMatch(app.text,/app-shell\.(?:css|js)\?v=4/);
  assert.match(app.text,/\/chemistry\/app\?view=exam/);
  assert.match(app.text,/\/chemistry\/app\?view=premium/);
  assert.match(app.text,/\/chemistry\/app\?view=help/);
  assert.doesNotMatch(app.text,/class="site-footer"/);

  const exam=await get('/chemistry/app?view=exam');
  assert.equal(exam.r.status,200);
  assert.equal(exam.r.headers.get('cache-control'),'no-store');
  assert.match(exam.text,/data-scientific-response-os/);
  assert.match(exam.text,/Answer Chemistry as Chemistry/);
  assert.match(exam.text,/aria-current="page"><b>∿<\/b><span>Prove<\/span>/);
  assert.doesNotMatch(exam.text,/class="site-header"|class="site-footer"/);

  const premium=await get('/chemistry/app?view=premium');
  assert.equal(premium.r.status,200);
  assert.equal(premium.r.headers.get('cache-control'),'no-store');
  assert.match(premium.text,/Unlock full mastery/);
  assert.match(premium.text,/aria-current="page"><b>◇<\/b><span>Premium<\/span>/);
  assert.doesNotMatch(premium.text,/class="site-header"|class="site-footer"/);

  const help=await get('/chemistry/app?view=help');
  assert.equal(help.r.status,200);
  assert.equal(help.r.headers.get('cache-control'),'no-store');
  assert.match(help.text,/Help without leaving MUSITU/);
  assert.match(help.text,/Contact MUSITU support/);
  assert.doesNotMatch(help.text,/class="site-header"|class="site-footer"/);

  const js=await get('/chemistry/assets/app-shell.js');
  assert.equal(js.r.status,200);
  assert.match(js.r.headers.get('content-type')||'',/^application\/javascript/);
  assert.match(js.text,/musitu_chem_onboarding_v1/);
  assert.match(js.text,/musitu-chemistry-app-shell-v5/);
  assert.doesNotMatch(js.text,/musitu-chemistry-app-shell-v4/);
  assert.match(js.text,/const android=\/Android\/i\.test\(navigator\.userAgent\|\|''\)/);
  assert.match(js.text,/if\(android&&!installed\(\)\)\{location\.replace\('\/chemistry\/install'\);return;\}/);
  assert.match(js.text,/\/chemistry\/manifest\.webmanifest\?v=2/);
  assert.match(js.text,/\/chemistry\/app\?view=exam/);
  assert.match(js.text,/\/chemistry\/app\?view=premium/);
  assert.match(js.text,/\/chemistry\/app\?view=help/);
  assert.match(js.text,/primeOfflineShell/);
  assert.match(js.text,/Offline ready/);
  assert.match(js.text,/musitu\.scientific_response_graph\.v1/);
  assert.doesNotMatch(js.text,/\/chemistry\/(checkout|return|claim|telemetry|plans)/);

  const css=await get('/chemistry/assets/app-shell.css');
  assert.equal(css.r.status,200);
  assert.match(css.r.headers.get('content-type')||'',/^text\/css/);
  assert.match(css.text,/safe-area-inset-bottom/);
  assert.match(css.text,/sr-board/);

  const bridge=await get('/chemistry/assets/app-bridge.js');
  assert.equal(bridge.r.status,200);
  assert.match(bridge.text,/location\.replace\('\/chemistry\/app'\)/);
});

test('versioned manifest has a dedicated MUSITU Chemistry app identity and launches the app shell',async()=>{
  const manifest=await get('/chemistry/manifest.webmanifest?v=2');
  assert.equal(manifest.r.status,200);
  const m=JSON.parse(manifest.text);
  assert.equal(m.id,'/chemistry/app');
  assert.equal(m.name,'MUSITU Chemistry');
  assert.equal(m.short_name,'MUSITU Chemistry');
  assert.equal(m.start_url,'/chemistry/app');
  assert.equal(m.scope,'/chemistry/');
  assert.equal(m.display,'standalone');
  assert.doesNotMatch(m.description,/Rescue/i);
  assert.notEqual(m.id,'/chemistry/rescue?src=direct');
});

test('public Rescue stays crawlable but discovers the same versioned Chemistry app manifest',async()=>{
  const rescue=await get('/chemistry/rescue?src=direct');
  assert.equal(rescue.r.status,200);
  assert.match(rescue.text,/\/chemistry\/manifest\.webmanifest\?v=2/);
  assert.match(rescue.text,/\/chemistry\/assets\/app-bridge\.js\?v=1/);
  assert.match(rescue.text,/index,follow,max-image-preview:large/);
  const bridgeAt=rescue.text.indexOf('/chemistry/assets/app-bridge.js?v=1');
  const bodyAt=rescue.text.indexOf('<body>');
  assert.ok(bridgeAt>0&&bodyAt>bridgeAt,'standalone bridge must execute before public body is parsed');
});
