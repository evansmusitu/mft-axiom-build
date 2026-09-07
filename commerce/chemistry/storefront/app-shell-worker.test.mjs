import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../index.storefront-v3.mjs';

const base='https://payments.mftintelligence.com';
async function get(path,headers={}){const r=await handleRequest(new Request(base+path,{headers}),{});return {r,text:await r.text()}}

test('generated Worker serves a no-store native-feel app shell and local assets',async()=>{
  const app=await get('/chemistry/app');
  assert.equal(app.r.status,200);
  assert.equal(app.r.headers.get('cache-control'),'no-store');
  assert.match(app.text,/class="app-topbar"/);
  assert.match(app.text,/class="app-nav"/);
  assert.match(app.text,/Your Chemistry workspace/);
  assert.doesNotMatch(app.text,/class="site-footer"/);

  const js=await get('/chemistry/assets/app-shell.js');
  assert.equal(js.r.status,200);
  assert.match(js.r.headers.get('content-type')||'',/^application\/javascript/);
  assert.match(js.text,/musitu_chem_onboarding_v1/);

  const css=await get('/chemistry/assets/app-shell.css');
  assert.equal(css.r.status,200);
  assert.match(css.r.headers.get('content-type')||'',/^text\/css/);
  assert.match(css.text,/safe-area-inset-bottom/);

  const bridge=await get('/chemistry/assets/app-bridge.js');
  assert.equal(bridge.r.status,200);
  assert.match(bridge.text,/location\.replace\('\/chemistry\/app'\)/);
});

test('manifest preserves previous app identity while changing launch destination to app shell',async()=>{
  const manifest=await get('/chemistry/manifest.webmanifest');
  assert.equal(manifest.r.status,200);
  const m=JSON.parse(manifest.text);
  assert.equal(m.id,'/chemistry/rescue?src=direct');
  assert.equal(m.start_url,'/chemistry/app');
  assert.equal(m.scope,'/chemistry/');
  assert.equal(m.display,'standalone');
});

test('public Rescue loads blocking standalone bridge before body content and remains crawlable',async()=>{
  const rescue=await get('/chemistry/rescue?src=direct');
  assert.equal(rescue.r.status,200);
  assert.match(rescue.text,/\/chemistry\/assets\/app-bridge\.js\?v=1/);
  assert.match(rescue.text,/index,follow,max-image-preview:large/);
  const bridgeAt=rescue.text.indexOf('/chemistry/assets/app-bridge.js?v=1');
  const bodyAt=rescue.text.indexOf('<body>');
  assert.ok(bridgeAt>0&&bodyAt>bridgeAt,'standalone bridge must execute before public body is parsed');
});
