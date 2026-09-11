import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const baselineRoot=process.env.BASELINE_MODULE_ROOT;
const candidateRoot=process.env.CANDIDATE_MODULE_ROOT;
if(!baselineRoot||!candidateRoot) throw new Error('BASELINE_MODULE_ROOT and CANDIDATE_MODULE_ROOT are required');

const sha=b=>createHash('sha256').update(b).digest('hex');
const baselineWorker=(await import(pathToFileURL(join(baselineRoot,'worker.mjs')).href+'?baseline='+Date.now())).default;
const candidateWorker=(await import(pathToFileURL(join(candidateRoot,'worker.mjs')).href+'?candidate='+Date.now())).default;

async function body(worker,path,headers={}){
  const r=await worker.fetch(new Request('https://payments.mftintelligence.com'+path,{headers}),{},{});
  assert.equal(r.status,200,`${path} status`);
  return {headers:r.headers,bytes:Buffer.from(await r.arrayBuffer())};
}

for(const name of ['worker.mjs','assets.mjs','generated-data.mjs']){
  const a=readFileSync(join(baselineRoot,name));
  const b=readFileSync(join(candidateRoot,name));
  assert.equal(sha(a),sha(b),`${name} must be byte-identical`);
}
assert.notEqual(sha(readFileSync(join(baselineRoot,'render.mjs'))),sha(readFileSync(join(candidateRoot,'render.mjs'))),'render.mjs must be the only changed module');

const unchangedRoutes=['/store','/store/apps/chemistry','/store/developer','/store/releases','/store/status','/store/offline','/store/healthz','/store/update','/store/repair','/store/reinstall','/store/rollback','/store/transfer-device'];
for(const path of unchangedRoutes){
  const accept=path.endsWith('/healthz')?'application/json':'text/html';
  const a=await body(baselineWorker,path,{accept});
  const b=await body(candidateWorker,path,{accept});
  assert.equal(sha(a.bytes),sha(b.bytes),`${path} response body changed unexpectedly`);
}

const ua='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';
const oldInstall=await body(baselineWorker,'/store/install',{'user-agent':ua,accept:'text/html'});
const newInstall=await body(candidateWorker,'/store/install',{'user-agent':ua,accept:'text/html'});
assert.notEqual(sha(oldInstall.bytes),sha(newInstall.bytes),'Android install response must change');
const html=newInstall.bytes.toString('utf8');
assert.match(html,/href="musitustore:\/\/app\/chemistry"[^>]*>Install in MUSITU Store<\/a>/);
assert.match(html,/Install MUSITU Store first/);
assert.match(html,/bootstrap APK is only for the one-time installation of MUSITU Store itself/i);
assert.doesNotMatch(html,/<a class="button" href="\/store\/bootstrap\/[^"]+">Install in MUSITU Store<\/a>/);

const machine=['/store/catalog.json','/store/catalog.sig','/store/ios/source.json','/store/web/adapter.json','/store/android/repo/index-v1.json','/store/apps/chemistry/sbom.json','/store/apps/chemistry/dependencies.json','/store/release/channels.json','/store/release/rollback-control.json','/store/bootstrap/release.json','/store/locales.json'];
for(const path of machine){
  const accept=path.endsWith('.sig')?'text/plain':'application/json';
  const a=await body(baselineWorker,path,{accept});
  const b=await body(candidateWorker,path,{accept});
  assert.equal(sha(a.bytes),sha(b.bytes),`${path} machine bytes changed`);
}

console.log(JSON.stringify({result:'PASS',gate:'MUSITU_STORE_NATIVE_INSTALL_HANDOFF_PREDEPLOY_PASS',unchanged_routes:unchangedRoutes.length,machine_endpoints:machine.length},null,2));
