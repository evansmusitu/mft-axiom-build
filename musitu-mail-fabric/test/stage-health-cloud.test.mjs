import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MmfStagingSqliteDO} from '../src/edge/sqlite-do.mjs';
import worker from '../src/edge/worker-do-staging.mjs';
const secret='isolated-staging-test-rpc-secret-0123456789abcdef';
function fixture(t){
 const sqlDb=new DatabaseSync(':memory:');t.after(()=>sqlDb.close());
 const sql={exec(stmt,...args){
  const s=sqlDb.prepare(stmt);
  const rows=/^(SELECT|WITH|PRAGMA)/i.test(stmt.trim())?s.all(...args):(s.run(...args),[]);
  return{toArray(){return rows}};
 }};
 const env={MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_API_ENABLED:'false',
   MMF_WEBHOOK_ENABLED:'false',MMF_STORAGE_RPC_SECRET:secret};
 const rpc=new MmfStagingSqliteDO({storage:{sql}},{...env});
 env.MMF_LEDGER={idFromName:()=> 'id',get:()=>({fetch:req=>rpc.fetch(req)})};
 return{env,db:sqlDb};
}
test('stage-only Queue health drill observes actual SQL records without releasing customer data',async t=>{
 const {env,db}=fixture(t);
 db.prepare('INSERT INTO mail_suppressions(tenant_id,recipient_hmac,created_ms) VALUES(?,?,?)')
  .run('stage-tenant','opaque-suppression-sample',Date.now());
 const original=console.log,logs=[];let ack=0,retry=0;
 console.log=x=>logs.push(JSON.parse(x));
 try{await worker.queue({messages:[{body:{type:'MMF_STAGE_HEALTH_PROBE',probeId:'probe-stage-observability-20261010'},ack(){ack++},retry(){retry++}}]},env);}
 finally{console.log=original;}
 assert.equal(ack,1);assert.equal(retry,0);
 assert.equal(logs[0].gate,'MMF_STAGE_REAL_SQLITE_OPERATIONAL_HEALTH');assert.equal(logs[0].status,'PASS');
 assert.equal(logs[0].publicAccess,false);assert.equal(logs[0].observationOnly,true);
 assert.ok(!JSON.stringify(logs).includes('opaque-suppression-sample'));
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_suppressions').get().n,1);
});
test('stage-only Queue health monitoring never runs if real mail flag is enabled',async t=>{
 const {env}=fixture(t);let ack=0,retry=0;
 await worker.queue({messages:[{body:{type:'MMF_STAGE_HEALTH_PROBE',probeId:'probe-stage-observability-20261010'},ack(){ack++},retry(){retry++}}]}, {...env,MMF_REAL_SEND_ENABLED:'true'});
 assert.equal(ack,0);assert.equal(retry,1);
});
