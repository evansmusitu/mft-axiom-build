import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join,resolve} from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const phase1=resolve(here,'..');
const workerPath=join(here,'worker.mjs');
assert.equal(existsSync(workerPath),true,'web-surface worker.mjs is required');
const worker=(await import(pathToFileURL(workerPath).href+'?t='+Date.now())).default;
const canonicalCatalog=readFileSync(join(phase1,'catalog.json'),'utf8');
const canonicalSig=readFileSync(join(phase1,'catalog.sig'),'utf8');

async function get(path,headers={},env={}){
  return worker.fetch(new Request('https://payments.mftintelligence.com'+path,{headers}),env,{});
}

function csp(res){return res.headers.get('content-security-policy')||'';}

for (const path of ['/store','/store/','/store/apps/chemistry','/store/install','/store/developer','/store/releases','/store/status']) {
  test(`${path} is a strict, accessible Phase-1 HTML surface`,async()=>{
    const r=await get(path);
    assert.equal(r.status,200);
    assert.match(r.headers.get('content-type')||'',/^text\/html/);
    assert.equal(r.headers.get('referrer-policy'),'no-referrer');
    assert.equal(r.headers.get('x-content-type-options'),'nosniff');
    assert.equal(r.headers.get('x-frame-options'),'DENY');
    assert.match(csp(r),/default-src 'none'/);
    assert.match(csp(r),/style-src 'self'/);
    assert.match(csp(r),/frame-ancestors 'none'/);
    assert.doesNotMatch(csp(r),/unsafe-inline|unsafe-eval/);
    const t=await r.text();
    assert.match(t,/<a class="skip-link" href="#main">Skip to main content<\/a>/);
    assert.match(t,/<main id="main"/);
    assert.match(t,/MUSITU Store/);
  });
}

test('home is catalog-driven and separates distribution from entitlement',async()=>{
  const r=await get('/store'); const t=await r.text();
  assert.match(t,/MUSITU Chemistry/);
  assert.match(t,/1\.3\.0/);
  assert.match(t,/Verified release/);
  assert.match(t,/Installing does not buy Premium/i);
  assert.match(t,/Install/);
  assert.match(t,/Open/);
  assert.match(t,/Update/);
  assert.match(t,/Repair/);
  assert.match(t,/Reinstall/);
  assert.match(t,/Roll Back/);
  assert.match(t,/Transfer Device/);
});

test('catalog and detached signature routes preserve exact committed bytes',async()=>{
  const c=await get('/store/catalog.json');
  assert.equal(c.status,200);
  assert.equal(await c.text(),canonicalCatalog);
  const s=await get('/store/catalog.sig');
  assert.equal(s.status,200);
  assert.equal(await s.text(),canonicalSig);
  assert.equal(c.headers.get('cache-control'),'public, max-age=300');
});

test('Android gets the signed Store bootstrap and verified Android metadata',async()=>{
  const r=await get('/store/install',{ 'user-agent':'Mozilla/5.0 (Linux; Android 14; Pixel 8)' });
  const t=await r.text();
  assert.match(t,/Recommended for Android/);
  assert.match(t,/MUSITU_Store_1\.0\.0\.apk/);
  assert.match(t,/71391bf614cc1186cbe1fda17e9e626aad71d96dbf26807228b73bd2ea99b2f8/);
  assert.match(t,/43695b6103d7ab57e89166c9a537f1810b7e33053e20332b1d4e7e2e1c612671/);
});

test('iPhone and iPad get SideStore source plus PWA fallback without false direct native-install claim',async()=>{
  for(const ua of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)','Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)']){
    const r=await get('/store/install',{'user-agent':ua}); const t=await r.text();
    assert.match(t,/Recommended for iOS/i);
    assert.match(t,/SideStore/i);
    assert.match(t,/\/store\/ios\/source\.json/);
    assert.match(t,/Open the PWA/i);
    assert.match(t,/Native install requires SideStore/i);
    assert.doesNotMatch(t,/direct native install available/i);
  }
});

test('desktop/browser route recommends the PWA and does not claim a native desktop package',async()=>{
  const r=await get('/store/install',{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}); const t=await r.text();
  assert.match(t,/Recommended for this browser/);
  assert.match(t,/Open MUSITU Chemistry/);
  assert.match(t,/Installable PWA/);
  assert.doesNotMatch(t,/Windows installer|\.exe|\.msi/);
});

test('search spans title, subjects, features and audience using catalog fields',async()=>{
  for (const q of ['Chemistry','exam','Scientific Response','schools']) {
    const r=await get('/store/search?q='+encodeURIComponent(q)); const t=await r.text();
    assert.equal(r.status,200);
    assert.match(t,/MUSITU Chemistry/);
  }
  const none=await get('/store/search?q=astronomy');
  assert.match(await none.text(),/No matching apps/);
});

test('developer console is read-only and exposes public trust/release state only',async()=>{
  const r=await get('/store/developer'); const t=await r.text();
  assert.match(t,/Developer Console/);
  assert.match(t,/Read-only Phase 1/);
  assert.match(t,/Signed manifest required/);
  assert.match(t,/phase2Authorized.*false/is);
  assert.match(t,/4cf17f70dbab900237d8b82b4e989978c667e6ec841de6df79469aa6c5ebd5c0/);
  assert.match(t,/d4455ac3ec74a6d7cd7993ca640f554a83bba95dfd01ef508f7637b6bc72c0d8/);
  assert.match(t,/disabled/);
  assert.doesNotMatch(t,/BEGIN (?:EC |RSA )?PRIVATE KEY|password|store-signer\.pass/i);
});

test('public Store routes reject mutation methods',async()=>{
  for(const path of ['/store','/store/developer','/store/catalog.json','/store/releases']){
    const r=await worker.fetch(new Request('https://payments.mftintelligence.com'+path,{method:'POST',body:'x'}),{},{});
    assert.equal(r.status,405);
    assert.equal(r.headers.get('allow'),'GET, HEAD');
  }
});

test('health route is non-secret and truthfully keeps Phase 1 incomplete',async()=>{
  const r=await get('/store/healthz');
  assert.equal(r.status,200);
  assert.equal(r.headers.get('cache-control'),'no-store');
  const o=await r.json();
  assert.equal(o.ok,true);
  assert.equal(o.phase,'phase1');
  assert.equal(o.phase2_authorized,false);
  assert.equal(o.fresh_device_phase1_complete,false);
  assert.equal(o.catalog_revision,1);
  assert.equal(JSON.stringify(o).includes('PRIVATE KEY'),false);
});

test('installable Store web shell uses only self-hosted script and manifest resources',async()=>{
  const r=await get('/store'); const t=await r.text();
  assert.match(csp(r),/script-src 'self'/);
  assert.match(csp(r),/manifest-src 'self'/);
  assert.match(t,/<link rel="manifest" href="\/store\/manifest\.webmanifest">/);
  assert.match(t,/<script src="\/store\/assets\/store\.js" defer><\/script>/);
  assert.doesNotMatch(t,/<script(?![^>]+src=)/);
  const manifest=await get('/store/manifest.webmanifest');
  assert.equal(manifest.status,200);
  const m=await manifest.json();
  assert.equal(m.id,'/store/');
  assert.equal(m.scope,'/store/');
  assert.match(m.start_url,/^\/store/);
});

test('service worker provides an offline public shell but never caches installers or commerce',async()=>{
  const sw=await get('/store/sw.js');
  assert.equal(sw.status,200);
  assert.match(sw.headers.get('content-type')||'',/javascript/);
  const t=await sw.text();
  assert.match(t,/musitu-store-r1/);
  assert.match(t,/\/store\/catalog\.json/);
  assert.match(t,/\/store\/catalog\.sig/);
  assert.match(t,/\/store\/offline/);
  assert.match(t,/request\.method !== 'GET'/);
  assert.doesNotMatch(t,/MUSITU_Store_1\.0\.0\.apk|MUSITU_Chemistry_1\.3\.0\.ipa|\/chemistry\/checkout|\/chemistry\/catalog/);
  const client=await get('/store/assets/store.js');
  assert.match(await client.text(),/serviceWorker\.register\('\/store\/sw\.js'/);
});

test('offline route explains signed-cache and corruption recovery boundaries',async()=>{
  const r=await get('/store/offline'); const t=await r.text();
  assert.equal(r.status,200);
  assert.match(t,/Offline & recovery/);
  assert.match(t,/signature/i);
  assert.match(t,/SHA-256/i);
  assert.match(t,/resum/i);
  assert.match(t,/does not.*Premium/i);
  assert.match(t,/\/store\/catalog\.json/);
  assert.match(t,/\/store\/catalog\.sig/);
});

test('Save-Data or lite=1 selects a smaller low-bandwidth HTML response',async()=>{
  const full=await get('/store'); const fullText=await full.text();
  const lite=await get('/store?lite=1'); const liteText=await lite.text();
  const save=await get('/store',{'save-data':'on'}); const saveText=await save.text();
  assert.match(liteText,/Low-bandwidth mode/);
  assert.match(saveText,/Low-bandwidth mode/);
  assert.ok(Buffer.byteLength(liteText)<Buffer.byteLength(fullText));
  assert.ok(Buffer.byteLength(saveText)<Buffer.byteLength(fullText));
  assert.match(liteText,/MUSITU Chemistry/);
  assert.match(liteText,/Install/);
});

test('locale negotiation supports English, Shona and Ndebele with explicit fallback',async()=>{
  const cases=[
    ['/store?lang=en','en',/Install MUSITU/],
    ['/store?lang=sn','sn',/Isa MUSITU/],
    ['/store?lang=nd','nd',/Faka i-MUSITU/],
    ['/store?lang=fr','en',/Install MUSITU/]
  ];
  for(const [path,lang,needle] of cases){
    const r=await get(path); const t=await r.text();
    assert.equal(r.headers.get('content-language'),lang);
    assert.match(t,new RegExp(`<html lang="${lang}"`));
    assert.match(t,needle);
  }
  const locales=await get('/store/locales.json');
  assert.deepEqual(await locales.json(),{default:'en',supported:['en','sn','nd']});
});

test('release binary routes fail closed when required production bindings are absent',async()=>{
  for(const path of ['/store/bootstrap/MUSITU_Store_1.0.0.apk','/store/ios/MUSITU_Chemistry_1.3.0.ipa','/store/android/repo/MUSITU_Chemistry_Mastery_1.3.0.apk']){
    const r=await get(path);
    assert.equal(r.status,503);
    assert.equal(r.headers.get('cache-control'),'no-store');
    assert.match(await r.text(),/release asset unavailable/i);
  }
});
