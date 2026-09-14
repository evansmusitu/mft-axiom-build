import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';

const root=process.env.CANDIDATE_MODULE_ROOT;
if(!root) throw new Error('CANDIDATE_MODULE_ROOT is required');
const worker=(await import(pathToFileURL(join(root,'worker.mjs')).href+'?verify='+Date.now())).default;
const env={STORE_RUNTIME_PUBLICATION_STATE:'production',STORE_RELEASES:{get:async()=>null}};
const ORIGIN='https://payments.mftintelligence.com';
const UA={
  android:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
  web:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36'
};

async function request(path,{platform='web',accept='text/html'}={}){
  return worker.fetch(new Request(ORIGIN+path,{headers:{'user-agent':UA[platform],accept}}),env,{});
}
async function html(path,platform='web'){
  const r=await request(path,{platform});
  assert.equal(r.status,200,`${path} should be 200`);
  assert.match(r.headers.get('content-type')||'',/^text\/html/i);
  return r.text();
}

for(const platform of ['android','web']){
  const page=await html('/store/self-install',platform);
  assert.match(page,/data-musitu-store-pwa-install/,'Store PWA install control missing');
  assert.match(page,/data-musitu-store-bootstrap-target="\/store\/bootstrap\/MUSITU_Store_[^"]+\.apk"/,'native Store bootstrap control missing');
  assert.doesNotMatch(page,/href="\/store\/bootstrap\/MUSITU_Store_[^"]+\.apk"/,'self-install page exposes raw bootstrap href');
  assert.match(page,/<link rel="manifest" href="\/store\/manifest\.webmanifest">/,'Store self-install page must use Store manifest');
}

const androidInstall=await html('/store/install','android');
assert.match(androidInstall,/data-musitu-store-bootstrap-target="\/store\/bootstrap\/MUSITU_Store_[^"]+\.apk"/,'Android install page must convert Store bootstrap to controlled button');
assert.doesNotMatch(androidInstall,/href="\/store\/bootstrap\/MUSITU_Store_[^"]+\.apk"/,'Android install page still exposes raw Store bootstrap href');
assert.match(androidInstall,/data-musitu-install-target="intent:\/\/app\/chemistry\?action=install[^\"]*package=com\.musitu\.store/,'existing Chemistry native Store handoff must remain intact');
assert.match(androidInstall,/<link rel="manifest" href="\/chemistry\/app\/manifest\.webmanifest">/,'Chemistry PWA manifest behavior must remain intact');

const js=await request('/store/assets/store.js',{accept:'application/javascript'});
assert.equal(js.status,200);
const script=await js.text();
for(const token of ['data-musitu-store-pwa-install','data-musitu-store-bootstrap-target','function musituInstallStorePwa()','function musituActivateStoreBootstrap(target)','MUSITU_STORE_MANIFEST','beforeinstallprompt']){
  assert.ok(script.includes(token),`Store controller missing ${token}`);
}

const open=await request('/store/open');
assert.equal(open.status,302);
assert.equal(open.headers.get('location'),'https://payments.mftintelligence.com/chemistry/app/');

for(const name of ['render.mjs','assets.mjs','generated-data.mjs']){
  const fs=await import('node:fs/promises');
  const a=await fs.readFile(join(process.env.BASELINE_MODULE_ROOT,name));
  const b=await fs.readFile(join(root,name));
  assert.deepEqual(b,a,`${name} must remain byte-identical`);
}

console.log('MUSITU_STORE_SELF_INSTALL_LOCAL_CANDIDATE=PASS');
