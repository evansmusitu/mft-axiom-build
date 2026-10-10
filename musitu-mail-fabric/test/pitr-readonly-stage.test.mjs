import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {MmfStagingSqliteDO,inspectPrivateStagingPitr} from '../src/edge/sqlite-do.mjs';
import worker from '../src/edge/worker-do-staging.mjs';
const secret='isolated-test-only-strong-rpc-secret-0123456789';
const stage={MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_API_ENABLED:'false',
 MMF_WEBHOOK_ENABLED:'false',MMF_STORAGE_RPC_SECRET:secret};
const bookmark='0000007b-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b';
function fixture(t,{supported=true,overrides={},value=bookmark}={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const sql={exec(s,...args){const statement=db.prepare(s),rows=/^(SELECT|WITH|PRAGMA)/i.test(s.trim())?statement.all(...args):(statement.run(...args),[]);return{toArray(){return rows;}};},get databaseSize(){return 8192;}};
 const storage={sql,...(supported?{getCurrentBookmark:async()=>value}:{})};
 const doStub=new MmfStagingSqliteDO({storage},{...stage,...overrides});
 const namespace={idFromName:n=>n,get:()=>({fetch:r=>doStub.fetch(r)})};
 return {doStub,namespace,env:{...stage,...overrides,MMF_LEDGER:namespace},db};
}
test('private staging can obtain only the cryptographic digest of the actual PITR bookmark',async t=>{
 const {namespace}=fixture(t),result=await inspectPrivateStagingPitr(namespace,secret);
 assert.equal(result.supported,true);assert.equal(result.restoreAttempted,false);
 assert.equal(result.bookmarkSha256,createHash('sha256').update(bookmark).digest('hex'));
 assert.equal(result.databaseSizeBytes,8192);
 assert.equal(JSON.stringify(result).includes(bookmark),false);
});
test('PITR read-only route rejects public access and untrusted internal tokens',async t=>{
 const {doStub}=fixture(t);
 const request=(path,method='POST',key)=>doStub.fetch(new Request('https://example.invalid'+path,{method,headers:key?{'x-mmf-internal':key}:{}}));
 assert.equal((await request('/stage-pitr-capability','GET',secret)).status,404);
 assert.equal((await request('/stage-pitr-capability','POST')).status,401);
 assert.equal((await request('/stage-pitr-capability','POST','wrong-secret')).status,401);
 assert.equal((await request('/stage-pitr-restore','POST',secret)).status,404);
});
test('PITR probe rejects unsafe staging flag changes and unsupported runtime',async t=>{
 const a=fixture(t,{overrides:{MMF_API_ENABLED:'true'}}),b=fixture(t,{supported:false});
 await assert.rejects(()=>inspectPrivateStagingPitr(a.namespace,secret),/PITR_PROBE_UNAVAILABLE/);
 await assert.rejects(()=>inspectPrivateStagingPitr(b.namespace,secret),/PITR_PROBE_UNAVAILABLE/);
});
test('PITR probe rejects malformed bookmarks and never reports false success',async t=>{
 const a=fixture(t,{value:'invalid bookmark with private data'});
 await assert.rejects(()=>inspectPrivateStagingPitr(a.namespace,secret),/PITR_PROBE_UNAVAILABLE/);
});
test('private stage queue correlates an authenticated PITR checkpoint without restoring data',async t=>{
 const {env,db}=fixture(t),logs=[],original=console.log;
 let ack=0,retry=0;console.log=s=>logs.push(JSON.parse(s));
 try{
  await worker.queue({messages:[{body:{type:'MMF_STAGE_PITR_PROBE',probeId:'probe-pitr-test-20261010'},ack(){ack++},retry(){retry++}}]},env);
 }finally{console.log=original}
 assert.equal(ack,1);assert.equal(retry,0);assert.equal(logs[0].status,'PASS');
 assert.equal(logs[0].restoreAttempted,false);assert.equal(logs[0].customerMailSent,false);
 assert.equal(logs[0].bookmarkSha256,createHash('sha256').update(bookmark).digest('hex'));
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mmf_staging_probes').get().n,0);
});
test('stage Queue must retry when private PITR feature is unavailable',async t=>{
 const {env}=fixture(t,{supported:false});let ack=0,retry=0;
 await worker.queue({messages:[{body:{type:'MMF_STAGE_PITR_PROBE',probeId:'probe-pitr-test-20261010'},ack(){ack++},retry(){retry++}}]},env);
 assert.equal(ack,0);assert.equal(retry,1);
});
