import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const workerPath=join(here,'worker.mjs');
const manifestPath=join(here,'..','android-client','app','src','main','AndroidManifest.xml');

assert.equal(existsSync(workerPath),true,'worker.mjs is required');
assert.equal(existsSync(manifestPath),true,'AndroidManifest.xml is required');

const worker=(await import(pathToFileURL(workerPath).href+'?platform-install='+Date.now())).default;
const UA={
  android:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
  ios:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',
  web:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36'
};
const actionPaths=['/store','/store/apps/chemistry','/store/install','/store/update','/store/repair','/store/reinstall','/store/search?q=chemistry'];

async function page(path,platform){
  const response=await worker.fetch(new Request('https://payments.mftintelligence.com'+path,{headers:{'user-agent':UA[platform]}}),{},{});
  assert.equal(response.status,200,`${platform} ${path} should be 200`);
  return response.text();
}

function hrefs(html){return [...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1])}
function primaryCarrierLinks(html){return hrefs(html).filter(h=>h.startsWith('intent://')||h.startsWith('sidestore://')||h==='https://payments.mftintelligence.com/chemistry/install')}

for(const path of actionPaths){
  test(`Android ${path} routes install-like action directly to com.musitu.store`,async()=>{
    const html=await page(path,'android');
    const links=primaryCarrierLinks(html);
    assert.ok(links.some(h=>h.startsWith('intent://app/chemistry?')&&h.includes('scheme=musitustore')&&h.includes('package=com.musitu.store')),
      `missing explicit MUSITU Store package handoff on ${path}`);
    assert.doesNotMatch(html,/href="[^"]*MUSITU_Chemistry[^\"]*\.apk/i,'Chemistry APK must never be a browser install action');
  });
}

test('Android Install page keeps only the one-time MUSITU Store bootstrap as a browser APK path',async()=>{
  const html=await page('/store/install','android');
  assert.match(html,/Install MUSITU Store first/);
  assert.match(html,/href="\/store\/bootstrap\/[^"]+\.apk"/);
  assert.match(html,/bootstrap APK is only for the one-time installation of MUSITU Store itself/i);
  assert.match(html,/>Open in browser<\/a>/);
  assert.match(html,/>Install Web App instead<\/a>/);
  assert.doesNotMatch(html,/href="[^"]*chemistry[^"]*\.apk/i);
});

for(const [path,action] of [['/store/install','install'],['/store/update','update'],['/store/repair','repair'],['/store/reinstall','reinstall']]){
  test(`Android ${action} encodes the lifecycle action in the native Store intent`,async()=>{
    const html=await page(path,'android');
    assert.ok(hrefs(html).some(h=>h.startsWith(`intent://app/chemistry?action=${action}`)&&h.includes('package=com.musitu.store')));
  });
}

for(const path of actionPaths){
  test(`iOS ${path} uses SideStore as the native carrier and never a raw IPA browser action`,async()=>{
    const html=await page(path,'ios');
    const links=primaryCarrierLinks(html);
    assert.ok(links.some(h=>h.startsWith('sidestore://install?url=')),`missing SideStore install handoff on ${path}`);
    assert.doesNotMatch(html,/href="https?:[^"]+\.ipa/i,'IPA must not be a browser-download primary action');
  });
}

test('iOS Install page exposes SideStore source and Web/PWA/browser fallbacks as separately labelled actions',async()=>{
  const html=await page('/store/install','ios');
  assert.ok(hrefs(html).some(h=>h.startsWith('sidestore://source?url=')),'SideStore source deep link missing');
  assert.match(html,/>Add MUSITU source to SideStore<\/a>/);
  assert.match(html,/>Install Web App instead<\/a>/);
  assert.match(html,/>Open in browser<\/a>/);
  assert.doesNotMatch(html,/href="\/store\/ios\/source\.json"[^>]*>Open SideStore source<\/a>/);
});

for(const path of actionPaths){
  test(`Web/PWA ${path} routes install-like action to the dedicated Chemistry install surface`,async()=>{
    const html=await page(path,'web');
    assert.ok(primaryCarrierLinks(html).includes('https://payments.mftintelligence.com/chemistry/install'),`PWA install surface missing on ${path}`);
    assert.doesNotMatch(html,/href="[^"]+\.(?:apk|ipa)"/i,'Web/PWA install actions must not download package files');
  });
}

test('Web/PWA Install page keeps Open in browser separate from Install Web App',async()=>{
  const html=await page('/store/install','web');
  assert.match(html,/href="https:\/\/payments\.mftintelligence\.com\/chemistry\/install"[^>]*>Install Web App<\/a>/);
  assert.match(html,/>Open in browser<\/a>/);
});

test('low-bandwidth Android home uses the same explicit native Store handoff',async()=>{
  const html=await page('/store?lite=1','android');
  assert.ok(hrefs(html).some(h=>h.startsWith('intent://app/chemistry?')&&h.includes('package=com.musitu.store')));
  assert.doesNotMatch(html,/href="[^"]*chemistry[^"]*\.apk/i);
});

test('native MUSITU Store declares a browsable handler for the Android handoff URI',()=>{
  const manifest=readFileSync(manifestPath,'utf8');
  assert.match(manifest,/android\.intent\.action\.VIEW/);
  assert.match(manifest,/android\.intent\.category\.BROWSABLE/);
  assert.match(manifest,/android:scheme="musitustore"/);
  assert.match(manifest,/android:host="app"/);
});
