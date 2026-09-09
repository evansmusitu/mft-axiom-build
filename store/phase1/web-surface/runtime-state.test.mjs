import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join} from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const workerPath=join(here,'worker.mjs');
assert.equal(existsSync(workerPath),true,'web-surface worker.mjs is required');
const worker=(await import(pathToFileURL(workerPath).href+'?runtime='+Date.now())).default;

async function get(path,env={}){
  return worker.fetch(new Request('https://payments.mftintelligence.com'+path),env,{});
}

test('production runtime state is distinct from the immutable signed catalog snapshot',async()=>{
  const env={STORE_RUNTIME_PUBLICATION_STATE:'production'};
  const r=await get('/store/healthz',env);
  assert.equal(r.status,200);
  const o=await r.json();
  assert.equal(o.catalog_publication_state,'private-predeployment');
  assert.equal(o.runtime_publication_state,'production');
  assert.equal(o.production_deployed,true);
  assert.equal(o.phase2_authorized,false);
  assert.equal(o.fresh_device_phase1_complete,false);
  assert.equal('publication_state' in o,false,'ambiguous publication_state must not be exposed');
});

test('developer and status pages label signed snapshot separately from live deployment',async()=>{
  const env={STORE_RUNTIME_PUBLICATION_STATE:'production'};
  const developer=await get('/store/developer',env);
  const d=await developer.text();
  assert.match(d,/Signed catalog snapshot/i);
  assert.match(d,/private-predeployment/);
  assert.match(d,/Runtime deployment/i);
  assert.match(d,/production/);
  assert.match(d,/phase2Authorized.*false/is);

  const status=await get('/store/status',env);
  const s=await status.text();
  assert.match(s,/Runtime deployment.*production/is);
  assert.match(s,/Signed catalog snapshot.*private-predeployment/is);
  assert.match(s,/Fresh-device Phase-1 completion is not yet claimed/i);
});

test('missing or unsupported runtime state fails closed to the signed predeployment snapshot',async()=>{
  for(const env of [{},{STORE_RUNTIME_PUBLICATION_STATE:'staging'},{STORE_RUNTIME_PUBLICATION_STATE:'PRODUCTION'}]){
    const r=await get('/store/healthz',env);
    const o=await r.json();
    assert.equal(o.catalog_publication_state,'private-predeployment');
    assert.equal(o.runtime_publication_state,'private-predeployment');
    assert.equal(o.production_deployed,false);
  }
});
