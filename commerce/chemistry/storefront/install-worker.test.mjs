import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../index.storefront-v3.mjs';

const base='https://payments.mftintelligence.com';
async function get(path){const r=await handleRequest(new Request(base+path),{});return {r,text:await r.text()}}
function strict(r){const csp=r.headers.get('content-security-policy')||'';assert.match(csp,/style-src 'self'/);assert.match(csp,/script-src 'self'/);assert.match(csp,/connect-src 'self'/);assert.match(csp,/manifest-src 'self'/);assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval|https?:\/\//);assert.equal(r.headers.get('referrer-policy'),'no-referrer')}

test('generated Worker routes Rescue through the zero-cost install handoff',async()=>{
  const rescue=await get('/chemistry/rescue?src=direct');
  assert.equal(rescue.r.status,200);
  strict(rescue.r);
  assert.match(rescue.text,/href="\/chemistry\/install">Install \/ Start Free</);
  assert.doesNotMatch(rescue.text,/href="\/chemistry\/download\/MUSITU_Chemistry_Mastery_1\.2\.0\.apk">Start Free Rescue Check</);

  const install=await get('/chemistry/install');
  assert.equal(install.r.status,200);
  strict(install.r);
  assert.match(install.text,/Install MUSITU Chemistry/);
  assert.match(install.text,/id="install-musitu"/);
  assert.match(install.text,/Download verified Android APK/);
  assert.match(install.text,/\/chemistry\/assets\/install-handoff\.js/);

  const js=await get('/chemistry/assets/install-handoff.js');
  assert.equal(js.r.status,200);
  assert.match(js.r.headers.get('content-type')||'',/^application\/javascript/);
  assert.match(js.text,/beforeinstallprompt/);
  assert.match(js.text,/appinstalled/);
  assert.doesNotMatch(js.text,/(document\.cookie|localStorage|sessionStorage|pushManager)/);

  const sitemap=await get('/chemistry/sitemap.xml');
  assert.equal(sitemap.r.status,200);
  assert.match(sitemap.text,/\/chemistry\/install/);
});
