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

const worker=(await import(pathToFileURL(workerPath).href+'?native-install='+Date.now())).default;

async function androidInstallPage(){
  return worker.fetch(new Request('https://payments.mftintelligence.com/store/install',{
    headers:{'user-agent':'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36'}
  }),{},{});
}

test('Android Install routes into native MUSITU Store instead of making the primary action an APK download',async()=>{
  const r=await androidInstallPage();
  assert.equal(r.status,200);
  const html=await r.text();
  assert.match(html,/href="musitustore:\/\/app\/chemistry"[^>]*>Install in MUSITU Store<\/a>/);
  assert.match(html,/Install MUSITU Store first/);
  assert.match(html,/bootstrap APK is only for the one-time installation of MUSITU Store itself/i);
  assert.doesNotMatch(html,/<a class="button" href="\/store\/bootstrap\/[^"]+">Install in MUSITU Store<\/a>/);
});

test('native MUSITU Store declares a browsable handler for the web handoff URI',()=>{
  const manifest=readFileSync(manifestPath,'utf8');
  assert.match(manifest,/android\.intent\.action\.VIEW/);
  assert.match(manifest,/android\.intent\.category\.BROWSABLE/);
  assert.match(manifest,/android:scheme="musitustore"/);
  assert.match(manifest,/android:host="app"/);
});
