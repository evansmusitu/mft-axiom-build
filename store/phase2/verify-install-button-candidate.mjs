import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';

const root=process.env.CANDIDATE_MODULE_ROOT;
if(!root) throw new Error('CANDIDATE_MODULE_ROOT is required');
const worker=(await import(pathToFileURL(join(root,'worker.mjs')).href+'?verify='+Date.now())).default;
const env={STORE_RUNTIME_PUBLICATION_STATE:'production',STORE_RELEASES:{get:async()=>null}};
const ORIGIN='https://payments.mftintelligence.com';
const APP='https://payments.mftintelligence.com/chemistry/app/';
const PWA='https://payments.mftintelligence.com/chemistry/install';
const UA={
  android:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
  ios:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',
  web:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36'
};

async function request(path,{platform='web',accept='text/html'}={}){
  return worker.fetch(new Request(ORIGIN+path,{headers:{'user-agent':UA[platform],accept}}),env,{});
}
async function text(path,platform='web',accept='text/html'){
  const r=await request(path,{platform,accept});
  assert.equal(r.status,200,`${platform} ${path} should be 200`);
  return [r,await r.text()];
}
function assertInstallSurface(html,platform,action){
  assert.match(html,/<link rel="manifest" href="\/chemistry\/app\/manifest\.webmanifest">/,`${platform} ${action} must use Chemistry manifest`);
  assert.doesNotMatch(html,/href="intent:\/\/app\/chemistry/i,`${platform} ${action} exposed Android intent as href`);
  assert.doesNotMatch(html,/href="sidestore:\/\/install\?/i,`${platform} ${action} exposed SideStore install as href`);
  assert.doesNotMatch(html,new RegExp(`href="${PWA.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"`),`${platform} ${action} exposed PWA install as href`);
  assert.match(html,/href="\/store\/open"/,`${platform} ${action} lost browser Open fallback`);
  if(platform==='android') assert.match(html,new RegExp(`data-musitu-install-target="intent://app/chemistry\\?action=${action}[^\"]*package=com\\.musitu\\.store`));
  if(platform==='ios') assert.match(html,/data-musitu-install-target="sidestore:\/\/install\?url=/);
  if(platform==='web') assert.match(html,/data-musitu-install-target="https:\/\/payments\.mftintelligence\.com\/chemistry\/install"/);
}

for(const action of ['install','update','repair','reinstall']){
  const path=action==='install'?'/store/install':`/store/${action}`;
  for(const platform of ['android','ios','web']){
    const [,html]=await text(path,platform);
    assertInstallSurface(html,platform,action);
  }
}

{
  const [,home]=await text('/store','web');
  assert.match(home,/<link rel="manifest" href="\/store\/manifest\.webmanifest">/,'normal Store pages must keep Store manifest');
}
{
  const r=await request('/store/open');
  assert.equal(r.status,302);
  assert.equal(r.headers.get('location'),APP);
  assert.equal(r.headers.get('content-disposition'),null);
}
{
  const [,js]=await text('/store/assets/store.js','web','application/javascript');
  assert.match(js,/beforeinstallprompt/);
  assert.match(js,/data-musitu-install-target/);
  assert.match(js,/chemistry\/app\/manifest\.webmanifest/);
  assert.match(js,/window\.location\.assign\(target\)/);
  assert.doesNotMatch(js,/\.apk(?:['"?]|$)/i,'install controller must not contain an APK target');
  assert.doesNotMatch(js,/\.ipa(?:['"?]|$)/i,'install controller must not contain an IPA target');
}

console.log('MUSITU_STORE_INSTALL_BUTTON_LOCAL_CANDIDATE=PASS');
