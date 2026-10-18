import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {makeDurableSqlAdapter} from '../src/v03_do_adapter.mjs';
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE counters(id TEXT PRIMARY KEY,count INTEGER NOT NULL)');
 const storage={sql:{exec(query,...params){
   const stmt=db.prepare(query);
   const result=stmt.columns().length?stmt.all(...params):(stmt.run(...params),[]);
   return {toArray:()=>result,one:()=>result[0],
     [Symbol.iterator]:()=>result[Symbol.iterator]()};
 }},transactionSync(fn){
   db.exec('BEGIN IMMEDIATE');
   try{const x=fn();db.exec('COMMIT');return x}
   catch(e){db.exec('ROLLBACK');throw e}
 }};
 return {db,adapter:makeDurableSqlAdapter(storage)};
}
test('SQLite Durable Object adapter preserves D1 async first/all/run semantics',async()=>{
 const {adapter}=fixture();
 assert.equal((await adapter.prepare('INSERT INTO counters(id,count) VALUES(?,?)').bind('a',2).run()).meta.changes,1);
 assert.equal((await adapter.prepare('UPDATE counters SET count=count+1 WHERE id=?').bind('missing').run()).meta.changes,0);
 assert.deepEqual(await adapter.prepare('SELECT count FROM counters WHERE id=?').bind('a').first(),{count:2});
 assert.deepEqual((await adapter.prepare('SELECT id,count FROM counters ORDER BY id').bind().all()).results,
   [{id:'a',count:2}]);
});
test('SQLite Durable Object adapter executes multi-statement batch atomically',async()=>{
 const {adapter,db}=fixture();
 const a=adapter.prepare('INSERT INTO counters(id,count) VALUES(?,?)').bind('a',1);
 const clash=adapter.prepare('INSERT INTO counters(id,count) VALUES(?,?)').bind('a',99);
 await assert.rejects(()=>adapter.batch([a,clash]));
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM counters').get().n,0);
 const good=await adapter.batch([a,adapter.prepare('INSERT INTO counters(id,count) VALUES(?,?)').bind('b',3)]);
 assert.equal(good.length,2);
 assert.equal(good[0].meta.changes,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM counters').get().n,2);
});
