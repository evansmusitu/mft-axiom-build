import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
 seedMmfSyntheticControl,readMmfSyntheticControl,recordMmfSyntheticControlUsage,
 revokeMmfSyntheticControlKey,checkMmfSyntheticControlAccess,clearMmfSyntheticControl
} from '../src/staging/mmf-private-cloud-control-proof.mjs';
const h=n=>n.toString(16).padStart(2,'0').repeat(32);
const run=h(1);
const records=[
 {tenantDigest:h(2),subjectDigest:h(3),domainDigest:h(4),keyDigest:h(5),plan:'LAUNCH'},
 {tenantDigest:h(6),subjectDigest:h(7),domainDigest:h(8),keyDigest:h(9),plan:'GROWTH'}
];
const storage=db=>({
 sql:{exec(query,...args){const stmt=db.prepare(query);const data=/^(?:SELECT|PRAGMA)\b/i.test(query.trim())?stmt.all(...args):(stmt.run(...args),[]);return {toArray:()=>data}}},
 transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value}catch(e){db.exec('ROLLBACK');throw e}}
});
test('synthetic tenant identities/domains/pending plans and usage survive restart, remain isolated, and are purged',()=>{
 const d=mkdtempSync(join(tmpdir(),'mmf-control-'));
 let db=new DatabaseSync(join(d,'test.sqlite'));let s=storage(db);
 try{
  assert.deepEqual(readMmfSyntheticControl(s,run,records),{present:false});
  assert.deepEqual(seedMmfSyntheticControl(s,run,records),{stored:true,tenantCount:2});
  assert.deepEqual(checkMmfSyntheticControlAccess(s,run,records[0]),{active:true});
  assert.deepEqual(checkMmfSyntheticControlAccess(s,run,{...records[0],keyDigest:records[1].keyDigest}),{active:false});
  assert.deepEqual(checkMmfSyntheticControlAccess(s,run,{...records[0],subjectDigest:records[1].subjectDigest}),{active:false});
  assert.deepEqual(recordMmfSyntheticControlUsage(s,run,records[0],h(10)),{metered:true});
  assert.deepEqual(recordMmfSyntheticControlUsage(s,run,records[0],h(10)),{metered:false});
  assert.deepEqual(revokeMmfSyntheticControlKey(s,run,records[0]),{revoked:true});
  assert.deepEqual(checkMmfSyntheticControlAccess(s,run,records[0]),{active:false});
  db.close();db=new DatabaseSync(join(d,'test.sqlite'));s=storage(db);
  assert.deepEqual(readMmfSyntheticControl(s,run,records),{present:true,tenantCount:2,domainPendingCount:2,subscriptionPendingCount:2,usageCount:1,revokedCount:1,entitlementsActive:0});
  assert.deepEqual(checkMmfSyntheticControlAccess(s,run,records[1]),{active:true});
  assert.deepEqual(recordMmfSyntheticControlUsage(s,run,records[1],h(10)),{metered:true}); // same key, different tenant
  assert.deepEqual(readMmfSyntheticControl(s,run,records),{present:true,tenantCount:2,domainPendingCount:2,subscriptionPendingCount:2,usageCount:2,revokedCount:1,entitlementsActive:0});
  assert.deepEqual(clearMmfSyntheticControl(s,run),{cleared:true});
  assert.deepEqual(readMmfSyntheticControl(s,run,records),{present:false});
 }finally{db.close();rmSync(d,{recursive:true,force:true})}
});
test('synthetic proof fails closed on malformed input, concurrent runs and cross-tenant access',()=>{
 const db=new DatabaseSync(':memory:');const s=storage(db);
 try{
  assert.throws(()=>seedMmfSyntheticControl(s,run,[records[0],records[0]]),/DENIED/);
  assert.throws(()=>seedMmfSyntheticControl(s,run,[{...records[0],ownerEmail:'customer@example.com'},records[1]]),/DENIED/);
  assert.throws(()=>seedMmfSyntheticControl(s,run,[{...records[0],subjectDigest:'personal-data'},records[1]]),/DENIED/);
  seedMmfSyntheticControl(s,run,records);
  assert.throws(()=>seedMmfSyntheticControl(s,h(12),records),/DENIED/);
  assert.throws(()=>recordMmfSyntheticControlUsage(s,run,{...records[0],keyDigest:records[1].keyDigest},h(10)),/DENIED/);
  assert.throws(()=>revokeMmfSyntheticControlKey(s,run,{...records[0],subjectDigest:records[1].subjectDigest}),/DENIED/);
  assert.throws(()=>clearMmfSyntheticControl(s,h(12)),/DENIED/);
  assert.deepEqual(readMmfSyntheticControl(s,run,records),{present:true,tenantCount:2,domainPendingCount:2,subscriptionPendingCount:2,usageCount:0,revokedCount:0,entitlementsActive:0});
  clearMmfSyntheticControl(s,run);
 }finally{db.close()}
});
