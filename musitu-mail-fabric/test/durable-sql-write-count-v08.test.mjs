import test from 'node:test';
import assert from 'node:assert/strict';
import {MmfStagingSqliteDO,createDurableSqlAdapter} from '../src/edge/sqlite-do.mjs';
const SECRET='isolated-only-very-long-storage-secret-0123456789';

test('Cloudflare index-billed rowsWritten must not be mistaken for SQLite affected-row count',async()=>{
 let changed=0;
 const sql={exec(query){
   if(query.startsWith('SELECT changes()'))return {toArray:()=>[{n:changed}],rowsWritten:0};
   if(/^UPDATE /i.test(query)){changed=1;return {toArray:()=>[],rowsWritten:7};}
   return {toArray:()=>[],rowsWritten:0};
 }};
 const storage=new MmfStagingSqliteDO({storage:{sql}},{MMF_STORAGE_RPC_SECRET:SECRET});
 const namespace={idFromName:()=> 'isolated-id',get:()=>({fetch:req=>storage.fetch(req)})};
 const client=createDurableSqlAdapter(namespace,SECRET);
 const r=await client.prepare('UPDATE mail_messages SET state=? WHERE message_id=?').bind('SENDING','synthetic-id').run();
 assert.equal(r.meta.changes,1,'one affected message despite seven billed index writes');
});

test('ignored insert returns zero affected rows',async()=>{
 let changed=0;
 const sql={exec(query){
   if(query.startsWith('SELECT changes()'))return {toArray:()=>[{n:changed}],rowsWritten:0};
   if(/^INSERT /i.test(query)){changed=0;return {toArray:()=>[],rowsWritten:0};}
   return {toArray:()=>[],rowsWritten:0};
 }};
 const storage=new MmfStagingSqliteDO({storage:{sql}},{MMF_STORAGE_RPC_SECRET:SECRET});
 const namespace={idFromName:()=> 'isolated-id',get:()=>({fetch:req=>storage.fetch(req)})};
 const client=createDurableSqlAdapter(namespace,SECRET);
 const r=await client.prepare('INSERT OR IGNORE INTO mail_messages(message_id) VALUES(?)').bind('synthetic-id').run();
 assert.equal(r.meta.changes,0);
});
