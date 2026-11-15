/** Actual private scheduled controller, local workerd SQLite/R2, synthetic GitHub.
 * No public initializer or state-deletion test endpoint is added to the source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {controllerFixture} from './authority2-private-genesis-fixture.mjs';
import {genesisBarrierKey} from '../../integrations/security-authority2/authority2-genesis-candidate.mjs';
import {externalHighwaterFence} from '../../integrations/security-authority2/external-highwater-fence.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cache=new Map();
async function bundled(entry){
  if(!cache.has(entry))cache.set(entry,build({entryPoints:[join(root,entry)],bundle:true,
    write:false,metafile:true,format:'esm',platform:'browser',target:'es2022'}));
  return cache.get(entry);
}
async function fixture(t){
  const f=await controllerFixture(),directory=await mkdtemp(join(tmpdir(),'axiom-private-genesis-'));
  const temporary=await bundled('integrations/security-authority2/authority2-private-genesis-controller.mjs');
  const serving=await bundled('integrations/security-authority2/authority2-highwater-worker.mjs');
  assert.ok(Object.keys(temporary.metafile.inputs).some(x=>x.endsWith('authority2-genesis-candidate.mjs')));
  assert.ok(Object.keys(serving.metafile.inputs).every(x=>!x.includes('genesis')),
    'restored serving code must not include either temporary initializer module');
  const originalSettings={name:'authority2-controller-qualification',modules:true,
    script:temporary.outputFiles[0].text,compatibilityDate:'2026-07-01',cf:false,
    durableObjects:{HIGHWATER_STATE:{className:'Authority2Highwater',useSQLite:true}},
    r2Buckets:['HIGHWATER_WORM'],durableObjectsPersist:join(directory,'do'),r2Persist:join(directory,'r2'),
    bindings:{...f.env},outboundService:async request=>{
      assert.equal(request.method,'GET');assert.equal(new URL(request.url).origin,'https://api.github.com');
      return f.github.fetchImpl(request);
    }};
  let mf=new Miniflare(originalSettings),settings=originalSettings;
  t.after(async()=>{await mf.dispose();await rm(directory,{recursive:true,force:true});});
  const publicRequest=(path,headers={})=>mf.dispatchFetch('https://private.invalid'+path,{method:'POST',headers});
  const schedule=async(cron=f.approved.approved_cron,time=Date.now())=>{
    const worker=await mf.getWorker();return worker.scheduled({cron,scheduledTime:new Date(time)});};
  return {...f,schedule,publicRequest,bucket:()=>mf.getR2Bucket('HIGHWATER_WORM'),
    changeControl:async change=>{
      settings={...settings,bindings:{...settings.bindings,HW_GENESIS_CONTROL_JSON:JSON.stringify({...f.approved,...change})}};
      await mf.setOptions(settings);
    },
    retire:async()=>{
      const bindings={HW_CONFIG_JSON:f.env.HW_CONFIG_JSON,
        HW_SIGNING_JWK:f.env.HW_SIGNING_JWK,HW_ROLE_TOKEN_SHA256_JSON:f.env.HW_ROLE_TOKEN_SHA256_JSON};
      assert.equal(Object.keys(bindings).length,3);
      settings={...originalSettings,script:serving.outputFiles[0].text,bindings};
      await mf.dispose();mf=new Miniflare(settings);
    },
    fence:()=>externalHighwaterFence({pin:{...f.pin,origin:'https://private.invalid'},
      event:{ledger_id:f.pin.ledger_id,namespace:f.pin.namespace,sequence:0,previous_sequence:-1,
        previous_head:'0'.repeat(64),head:'b'.repeat(64),event_digest:'c'.repeat(64),
        artifact_sha256:'d'.repeat(64),action_sha256:'e'.repeat(64)},
      write_token:'w'.repeat(40),read_token:'r'.repeat(40),fetchImpl:(url,init)=>mf.dispatchFetch(url,init)})};
}
test('actual private controller has no public ingress and initializes only through its approved scheduled event',{timeout:60000},async t=>{
  const f=await fixture(t);
  for(const p of ['/','/__private_operator/genesis-once','/v1/highwater/append']){
    const r=await f.publicRequest(p,{authorization:'Bearer '+f.env.HW_GENESIS_CONTROL_TOKEN});
    assert.equal(r.status,404);
  }
  assert.equal((await (await f.bucket()).list()).objects.length,0);
  const result=await f.schedule();assert.equal(result.outcome,'ok');assert.equal(result.noRetry,true);
  assert.ok(await (await f.bucket()).head(genesisBarrierKey(f.pin)));
});
test('actual private scheduled initializer is one-shot even when the same event is delivered again',{timeout:60000},async t=>{
  const f=await fixture(t);assert.equal((await f.schedule()).outcome,'ok');
  const second=await f.schedule();assert.equal(second.outcome,'exception');assert.equal(second.noRetry,true);
  assert.equal((await (await f.bucket()).list()).objects.length,1);
});
test('actual controller rejects expired or mismatched scheduled contexts without any R2 write',{timeout:60000},async t=>{
  const f=await fixture(t);assert.equal((await f.schedule('0 0 * * *')).outcome,'exception');
  assert.equal((await f.schedule(f.approved.approved_cron,1)).outcome,'exception');
  await f.changeControl({not_before_ms:1,not_after_ms:2});
  assert.equal((await f.schedule()).outcome,'exception');
  assert.equal((await (await f.bucket()).list()).objects.length,0);
});
test('actual controller retirement preserves SQLite/R2 state and enables first ordinary signed append',{timeout:60000},async t=>{
  const f=await fixture(t);assert.equal((await f.schedule()).outcome,'ok');
  await f.retire();
  assert.equal((await f.publicRequest('/__private_operator/genesis-once')).status,404);
  assert.equal((await f.fence()).sequence,0);
  await assert.rejects(f.fence(),/HIGHWATER_REMOTE_DENIAL_HOLD/);
  assert.ok(await (await f.bucket()).head(genesisBarrierKey(f.pin)));
});
test('actual immutable-checkpoint denial leaves the private authority empty and never signs after retirement',{timeout:60000},async t=>{
  const f=await fixture(t);f.github.simulateRepositoryResurrection();
  assert.equal((await f.schedule()).outcome,'exception');
  assert.equal((await (await f.bucket()).list()).objects.length,0);
  await f.retire();await assert.rejects(f.fence(),/HIGHWATER_REMOTE_DENIAL_HOLD/);
});
