import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const baselineRoot=resolve(process.env.BASELINE_MODULE_ROOT||'');
const candidateRoot=resolve(process.env.CANDIDATE_MODULE_ROOT||'');
assert.ok(baselineRoot&&candidateRoot,'module roots are required');

const baseline=(await import(pathToFileURL(join(baselineRoot,'worker.mjs')).href+'?baseline='+Date.now())).default;
const candidate=(await import(pathToFileURL(join(candidateRoot,'worker.mjs')).href+'?candidate='+Date.now())).default;
const ENV={STORE_RUNTIME_PUBLICATION_STATE:'production'};
const UA={
  android:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
  ios:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',
  web:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36'
};
const actionPaths=['/store','/store/apps/chemistry','/store/install','/store/update','/store/repair','/store/reinstall','/store/search?q=chemistry','/store?lite=1'];
const machine=[
  '/store/catalog.json','/store/catalog.sig','/store/ios/source.json','/store/web/adapter.json','/store/android/repo/index-v1.json',
  '/store/apps/chemistry/sbom.json','/store/apps/chemistry/dependencies.json','/store/release/channels.json',
  '/store/release/rollback-control.json','/store/bootstrap/release.json','/store/locales.json'
];

async function fetchResult(worker,path,{ua=UA.web,accept='text/html'}={}){
  const r=await worker.fetch(new Request('https://payments.mftintelligence.com'+path,{headers:{'user-agent':ua,'accept':accept}}),ENV,{});
  return {status:r.status,contentType:r.headers.get('content-type')||'',location:r.headers.get('location')||'',body:Buffer.from(await r.arrayBuffer())};
}
function text(result){return result.body.toString('utf8')}
function hrefs(html){return [...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1])}

for(const path of ['/store/developer','/store/releases','/store/status','/store/offline','/store/healthz','/store/rollback','/store/transfer-device','/store/open']){
  const a=await fetchResult(baseline,path,{accept:path.endsWith('healthz')?'application/json':'text/html'});
  const b=await fetchResult(candidate,path,{accept:path.endsWith('healthz')?'application/json':'text/html'});
  assert.equal(b.status,a.status,`status changed on ${path}`);
  assert.equal(b.contentType,a.contentType,`content-type changed on ${path}`);
  assert.equal(b.location,a.location,`location changed on ${path}`);
  assert.deepEqual(b.body,a.body,`body changed on intentionally unchanged route ${path}`);
}

for(const path of machine){
  const a=await fetchResult(baseline,path,{accept:'application/json'});
  const b=await fetchResult(candidate,path,{accept:'application/json'});
  assert.equal(b.status,a.status,`machine status changed ${path}`);
  assert.equal(b.contentType,a.contentType,`machine content-type changed ${path}`);
  assert.deepEqual(b.body,a.body,`machine bytes changed ${path}`);
}

for(const path of actionPaths){
  const android=text(await fetchResult(candidate,path,{ua:UA.android}));
  const androidLinks=hrefs(android);
  assert.ok(androidLinks.some(h=>h.startsWith('intent://app/chemistry?')&&h.includes('scheme=musitustore')&&h.includes('package=com.musitu.store')),`Android carrier missing ${path}`);
  assert.equal(androidLinks.some(h=>/^https?:.*chemistry.*\.apk$/i.test(h)||/\/store\/android\/repo\/.*\.apk$/i.test(h)),false,`Android browser Chemistry APK leak ${path}`);

  const ios=text(await fetchResult(candidate,path,{ua:UA.ios}));
  const iosLinks=hrefs(ios);
  assert.ok(iosLinks.some(h=>h.startsWith('sidestore://install?url=')),`iOS SideStore carrier missing ${path}`);
  assert.equal(iosLinks.some(h=>/^https?:.*\.ipa$/i.test(h)),false,`iOS raw IPA browser action ${path}`);

  const web=text(await fetchResult(candidate,path,{ua:UA.web}));
  const webLinks=hrefs(web);
  assert.ok(webLinks.includes('https://payments.mftintelligence.com/chemistry/install'),`Web/PWA install surface missing ${path}`);
  assert.equal(webLinks.some(h=>/\.(apk|ipa)$/i.test(h)),false,`Web/PWA package download leak ${path}`);
}

for(const [path,action] of [['/store/install','install'],['/store/update','update'],['/store/repair','repair'],['/store/reinstall','reinstall']]){
  const html=text(await fetchResult(candidate,path,{ua:UA.android}));
  assert.ok(hrefs(html).some(h=>h.startsWith(`intent://app/chemistry?action=${action}`)&&h.includes('package=com.musitu.store')),`Android ${action} action lost`);
}

const androidInstall=text(await fetchResult(candidate,'/store/install',{ua:UA.android}));
assert.match(androidInstall,/Install MUSITU Store first/);
assert.match(androidInstall,/MUSITU_Store_1\.0\.2\.apk/);
assert.match(androidInstall,/>Install Web App instead<\/a>/);
assert.match(androidInstall,/>Open in browser<\/a>/);
assert.doesNotMatch(androidInstall,/href="[^"]*chemistry[^"]*\.apk/i);

const iosInstall=text(await fetchResult(candidate,'/store/install',{ua:UA.ios}));
assert.match(iosInstall,/sidestore:\/\/source\?url=/);
assert.match(iosInstall,/>Add MUSITU source to SideStore<\/a>/);
assert.match(iosInstall,/>Install Web App instead<\/a>/);
assert.match(iosInstall,/>Open in browser<\/a>/);

const webInstall=text(await fetchResult(candidate,'/store/install',{ua:UA.web}));
assert.match(webInstall,/href="https:\/\/payments\.mftintelligence\.com\/chemistry\/install"[^>]*>Install Web App<\/a>/);
assert.match(webInstall,/>Open in browser<\/a>/);

for(const name of ['assets.mjs','generated-data.mjs']){
  assert.deepEqual(readFileSync(join(candidateRoot,name)),readFileSync(join(baselineRoot,name)),`${name} must be byte-identical`);
}
assert.notDeepEqual(readFileSync(join(candidateRoot,'render.mjs')),readFileSync(join(baselineRoot,'render.mjs')),'render must change');
assert.notDeepEqual(readFileSync(join(candidateRoot,'worker.mjs')),readFileSync(join(baselineRoot,'worker.mjs')),'worker must change');

console.log(JSON.stringify({gate:'MUSITU_STORE_PLATFORM_INSTALL_CARRIERS_PREDEPLOY_PASS',platforms:['android','ios','web_pwa'],action_routes:actionPaths.length,machine_endpoints:machine.length,unchanged_routes:8},null,2));
