import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import stage from '../src/edge/worker-do-staging.mjs';
import {MmfStagingSqliteDO} from '../src/edge/sqlite-do.mjs';
const secret='never-used-outside-local-mock-0123456789abcdef';
function stageFixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const sql={exec(query,...args){const st=db.prepare(query);const r=/^\s*(SELECT|WITH|PRAGMA)/i.test(query)?st.all(...args):(st.run(...args),[]);
  return{toArray(){return r},rowsWritten:db.prepare('SELECT changes() n').get().n};}};
 const ledger=new MmfStagingSqliteDO({storage:{sql}},{MMF_STORAGE_RPC_SECRET:secret});
 const stub={fetch:req=>ledger.fetch(req)};
 const env={MMF_LEDGER:{idFromName:()=> 'id',get:()=>stub},MMF_STORAGE_RPC_SECRET:secret,MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_API_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false'};
 return{env,db};
}
test('private stage-only Worker never exposes messaging APIs even if invoked directly',async t=>{
 const {env}=stageFixture(t);const r=await stage.fetch(new Request('https://stage.invalid/v1/messages',{method:'POST',body:'{}'}),env);
 assert.equal(r.status,404);
});
test('staging queue can persist synthetic probes exactly once inside SQLite Durable Object',async t=>{
 const {env,db}=stageFixture(t);let ack=0,retry=0;
 const msg=()=>({body:{type:'MMF_STAGE_PROBE',probeId:'probe-test-20261010'},ack(){ack++},retry(){retry++}});
 await stage.queue({messages:[msg(),msg()]},env);
 assert.equal(ack,2);assert.equal(retry,0);
 assert.equal(db.prepare('SELECT COUNT(*) c FROM mmf_staging_probes WHERE probe_id=?').get('probe-test-20261010').c,1);
});
test('invalid probe rejected without mutation; misconfigured stage retries closed',async t=>{
 const {env,db}=stageFixture(t);let ack=0,retry=0;
 await stage.queue({messages:[{body:{type:'CUSTOMER_SEND',probeId:'probe-invalid'},ack(){ack++},retry(){retry++}}]},env);
 assert.equal(ack,1);assert.equal(retry,0);
 assert.equal(db.prepare('SELECT COUNT(*) c FROM mmf_staging_probes').get().c,0);
 await stage.queue({messages:[{body:{type:'MMF_STAGE_PROBE',probeId:'probe-test-20261010'},ack(){ack++},retry(){retry++}}]},{...env,MMF_REAL_SEND_ENABLED:'true'});
 assert.equal(retry,1);
 assert.equal(db.prepare('SELECT COUNT(*) c FROM mmf_staging_probes').get().c,0);
});
test('staging queue config has no external hostname, disabled real sending and SQLite-only class migration',()=>{
 const raw=readFileSync(new URL('../wrangler.mmf.do-staging.jsonc',import.meta.url),'utf8');
 const cfg=JSON.parse(raw);
 assert.equal(cfg.workers_dev,false);assert.deepEqual(cfg.routes,[]);
 assert.equal(cfg.vars.MMF_REAL_SEND_ENABLED,'false');assert.equal(cfg.vars.MMF_API_ENABLED,'false');
 assert.equal(cfg.vars.MMF_STAGE_ONLY,'true');
 assert.deepEqual(cfg.migrations?.[0]?.new_sqlite_classes,['MmfStagingSqliteDO']);
 assert.equal(cfg.queues.consumers[0].queue,'musitu-mail-fabric-staging-20261010');
});
test('stage crypto gate retries rather than acknowledge when managed keys are missing',async t=>{
 const {env}=stageFixture(t);let ack=0,retry=0;
 await stage.queue({messages:[{body:{type:'MMF_STAGE_PROBE',probeId:'probe-stage-cryptogate'},ack(){ack++},retry(){retry++}}]},
  {...env,MMF_STAGE_CRYPTO_READY:'true'});
 assert.equal(ack,0);assert.equal(retry,1);
});
test('stage signs and encrypts synthetic probes only when secret-backed crypto flag is enabled',async t=>{
 const {generateKeyPairSync,randomBytes}=await import('node:crypto');
 const {privateKey}=generateKeyPairSync('ed25519');
 const key=privateKey.export({format:'pem',type:'pkcs8'}).toString();
 const dataKey=randomBytes(32).toString('base64');
 const {env,db}=stageFixture(t);let ack=0,retry=0;const events=[];
 const original=console.log;
 console.log=(v)=>events.push(JSON.parse(v));
 try {
  await stage.queue({messages:[{body:{type:'MMF_STAGE_PROBE',probeId:'probe-stage-encrypted-001'},ack(){ack++},retry(){retry++}}]},
   {...env,MMF_STAGE_CRYPTO_READY:'true',MMF_STAGE_SIGNING_PRIVATE_KEY_PEM:key,MMF_STAGE_DATA_KEY_B64:dataKey});
 } finally {console.log=original}
 assert.equal(ack,1);assert.equal(retry,0);
 assert.equal(db.prepare('SELECT COUNT(*) AS c FROM mmf_staging_probes').get().c,1);
 assert.equal(events[0]?.cryptoVerified,true);
 assert.match(events[0]?.publicKeySha256,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(events).includes(key),false);
 assert.equal(JSON.stringify(events).includes(dataKey),false);
});

test('synthetic retry drill persists first attempt then completes once on queue redelivery',async t=>{
 const {env,db}=stageFixture(t);
 let ack=0,retry=0;
 const probeId='probe-retry-cloud-test-20261010';
 const m=()=>({body:{type:'MMF_STAGE_RETRY_PROBE',probeId},ack(){ack++},retry(){retry++}});
 await stage.queue({messages:[m()]},env);
 assert.equal(ack,0,'first attempt must not acknowledge');
 assert.equal(retry,1,'first attempt must request actual queue retry');
 const initial=db.prepare('SELECT recovery_count,completed_ms FROM mmf_staging_recovery WHERE probe_id=?').get(probeId);
 assert.equal(initial.recovery_count,1);
 assert.equal(initial.completed_ms,null);
 await stage.queue({messages:[m()]},env);
 assert.equal(ack,1);assert.equal(retry,1);
 const finished=db.prepare('SELECT recovery_count,completed_ms FROM mmf_staging_recovery WHERE probe_id=?').get(probeId);
 assert.equal(finished.recovery_count,1);
 assert.ok(Number.isInteger(finished.completed_ms)&&finished.completed_ms>0);
 await stage.queue({messages:[m()]},env);
 assert.equal(ack,2,'duplicate delivery should be idempotently acknowledged');
 assert.equal(retry,1,'completed probe must not be retried');
 assert.deepEqual(db.prepare('SELECT recovery_count,completed_ms FROM mmf_staging_recovery WHERE probe_id=?').get(probeId),finished);
});

test('synthetic retry probe must fail closed if cloud stage gates are disabled',async t=>{
 const {env,db}=stageFixture(t);let ack=0,retry=0;
 await stage.queue({messages:[{body:{type:'MMF_STAGE_RETRY_PROBE',probeId:'probe-retry-disabled-20261010'},ack(){ack++},retry(){retry++}}]},
   {...env,MMF_API_ENABLED:'true'});
 assert.equal(ack,0);assert.equal(retry,1);
 assert.equal(db.prepare("SELECT COUNT(*) as n FROM sqlite_master WHERE name='mmf_staging_recovery'").get().n,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mmf_staging_recovery').get().n,0);
});
