import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateRateWindowPruner} from './postgres-rate-retention.mjs';

test('cleanup invokes only operator-owned DB time boundary with a parameterized bounded batch',async()=>{
 const calls=[];
 const prune=createPrivateRateWindowPruner({query:async(sql,params)=>{
  calls.push({sql,params});return {rowCount:1,rows:[{deleted:5}]};
 }});
 assert.equal(await prune({maxRows:5}),5);
 assert.deepEqual(calls.map(x=>x.params),[[5]]);
 assert.match(calls[0].sql,/^SELECT store_publisher_private\.prune_portal_rate_windows\(\$1\) AS deleted$/);
 assert.doesNotMatch(calls[0].sql,/\bDELETE\s+FROM\b|minute_bucket|clock_timestamp/i,
  'caller must never choose an unsafe cutoff or construct cleanup SQL');
});

test('unsafe sizes fail before SQL and nobody can disable batch protection',async()=>{
 let calls=0;const prune=createPrivateRateWindowPruner({query:async()=>{calls++;return {rowCount:1,rows:[{deleted:0}]};}});
 for(const maxRows of [null,0,-1,1.5,1001,Infinity,'100',{},Number.MAX_SAFE_INTEGER]){
  await assert.rejects(()=>prune({maxRows}),/batch|size|limit/i);
 }
 assert.equal(calls,0);
});

test('fail-closed on ambiguous or poisoned PostgreSQL results and outages',async()=>{
 for(const bad of [null,{rowCount:0,rows:[]},{rowCount:2,rows:[{deleted:0},{deleted:0}]},
  {rowCount:1,rows:[{deleted:'1'}]},{rowCount:1,rows:[{deleted:-1}]},
  {rowCount:1,rows:[{deleted:11}]},{rowCount:1,rows:[{deleted:1.5}]}]){
  const prune=createPrivateRateWindowPruner({query:async()=>bad});
  await assert.rejects(()=>prune({maxRows:10}),/database|retention|result/i);
 }
 const fail=createPrivateRateWindowPruner({query:async()=>{throw Error('storage unavailable');}});
 await assert.rejects(()=>fail(),/storage unavailable/);
 assert.throws(()=>createPrivateRateWindowPruner(),/database|query/i);
});

test('no web handler, endpoint or mutable clock parameters exist on maintenance interface',()=>{
 const prune=createPrivateRateWindowPruner({query:async()=>({rowCount:1,rows:[{deleted:0}]})});
 assert.equal(typeof prune,'function');
 assert.equal(Object.keys(prune).length,0);
});

test('operator-only retention function is inside the same atomic schema transaction',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('./postgres-rate-gate.candidate.sql',import.meta.url),'utf8');
 const commitPos=source.lastIndexOf('\nCOMMIT;');
 const retentionPos=source.indexOf('CREATE FUNCTION store_publisher_private.prune_portal_rate_windows(');
 assert.ok(retentionPos>0 && commitPos>retentionPos,
   'table and maintenance function must be installed atomically, not in separate transactions');
 assert.match(source.trimEnd(),/\bCOMMIT;$/,
   'no independent DDL may execute after the committing schema transaction');
 assert.equal((source.match(/^COMMIT;$/gm)||[]).length,1);
});
