import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import * as controls from '../src/staging/mmf-private-cloud-control-proof.mjs';
import proxy from '../src/staging/mmf-private-cloud-proof-client.mjs';

function store(db){
 return {
  sql:{exec(query,...args){const stmt=db.prepare(query);const result=/^\s*(SELECT|PRAGMA)\b/i.test(query)?stmt.all(...args):(stmt.run(...args),[]);return {toArray:()=>result}}},
  transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}
 };
}
const h=n=>n.toString(16).padStart(2,'0').repeat(32);
const synthetic=[
 {tenantDigest:h(2),subjectDigest:h(3),domainDigest:h(4),keyDigest:h(5),plan:'LAUNCH'},
 {tenantDigest:h(6),subjectDigest:h(7),domainDigest:h(8),keyDigest:h(9),plan:'GROWTH'}
];
test('read-only control occupancy detects absent tables and occupied synthetic-only tables without mutation or revealing digests',()=>{
 assert.equal(typeof controls.inspectMmfSyntheticControlOccupancy,'function','missing read-only control inspection');
 const db=new DatabaseSync(':memory:');const s=store(db);
 try{
  const before=db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE type=\'table\'').get().n;
  assert.deepEqual(controls.inspectMmfSyntheticControlOccupancy(s),{schema:'mmf-private-synthetic-control-occupancy-v1',state:'ABSENT',tenantCount:0,usageCount:0});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE type=\'table\'').get().n,before,'inspection must not initialize schema');
  controls.seedMmfSyntheticControl(s,h(1),synthetic);
  const totalBefore=db.prepare('SELECT total_changes() AS n').get().n;
  assert.deepEqual(controls.inspectMmfSyntheticControlOccupancy(s),{schema:'mmf-private-synthetic-control-occupancy-v1',state:'OCCUPIED',tenantCount:2,usageCount:0});
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n,totalBefore,'inspection must never modify storage');
  controls.recordMmfSyntheticControlUsage(s,h(1),synthetic[0],h(10));
  assert.deepEqual(controls.inspectMmfSyntheticControlOccupancy(s),{schema:'mmf-private-synthetic-control-occupancy-v1',state:'OCCUPIED',tenantCount:2,usageCount:1});
  controls.clearMmfSyntheticControl(s,h(1));
  assert.deepEqual(controls.inspectMmfSyntheticControlOccupancy(s),{schema:'mmf-private-synthetic-control-occupancy-v1',state:'EMPTY',tenantCount:0,usageCount:0});
 }finally{db.close()}
});
test('read-only inspection rejects partially initialized schema and malformed storage',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE mmf_private_control_tenants_20261013 (tenant_digest TEXT)');
  assert.throws(()=>controls.inspectMmfSyntheticControlOccupancy(store(db)),/DENIED/);
  assert.throws(()=>controls.inspectMmfSyntheticControlOccupancy({sql:{}}),/DENIED/);
 }finally{db.close()}
});
test('only localhost GET private proxy can call read-only control inspection; denial discloses no payload',async()=>{
 let count=0;const env={MMF_PROOF_STAGE:{async inspectControl(){count++;return {schema:'mmf-private-synthetic-control-occupancy-v1',state:'ABSENT',tenantCount:0,usageCount:0}}}};
 const ok=await proxy.fetch(new Request('http://127.0.0.1/control/inspect',{method:'GET'}),env);
 assert.equal(ok.status,200);assert.equal((await ok.json()).state,'ABSENT');assert.equal(count,1);
 for(const req of [new Request('https://public.example/control/inspect'),new Request('http://127.0.0.1/control/inspect',{method:'POST'}),new Request('http://127.0.0.1/control/inspect',{method:'GET'})]){
  const e=req===null?env:(req.method==='GET'&&req.url==='http://127.0.0.1/control/inspect'?{}:env);
  const response=await proxy.fetch(req,e);
  assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/tenantDigest|run_digest|token/i);
 }
 assert.equal(count,1);
});
