import test from 'node:test';
import assert from 'node:assert/strict';
import {openTestDB} from '../customer_control_plane/sqlite_d1_test_adapter.mjs';
import {reserve,finishHold,balance} from '../customer_control_plane/ledger.mjs';
const schema=new URL('../customer_control_plane/schema.sql',import.meta.url);
for(const modes of [['released','committed'],['committed','released'],['committed','committed'],['released','released']]){
 test('atomic hold finalization '+modes.join(' vs '),async()=>{
  const db=openTestDB(schema);try{
   db._sqlite.exec("INSERT INTO tenants(id,name) VALUES('fixture','controlled fixture'); INSERT INTO credit_ledger(id,tenant_id,delta,source_key) VALUES('grant','fixture',10,'fixture-not-payment');");
   const h=await reserve(db,'fixture','fixture-reservation',7);
   const real=db.prepare;let readers=0,release;
   const barrier=new Promise(r=>release=r);
   db.prepare=sql=>{const p=real(sql);if(sql==='SELECT * FROM holds WHERE id=? AND tenant_id=?'){const first=p.first;p.first=async()=>{const row=await first();if(++readers===2)release();await barrier;return row;};}return p;};
   const result=await Promise.allSettled(modes.map(mode=>finishHold(db,'fixture',h.id,mode)));
   const state=db._sqlite.prepare('SELECT state FROM holds WHERE id=?').get(h.id).state;
   const charges=db._sqlite.prepare('SELECT delta FROM credit_ledger WHERE source_key=?').all('usage:'+h.id);
   assert.equal(state,modes[0]);assert.equal((await balance(db,'fixture')).booked,state==='committed'?3:10);
   assert.equal(charges.length,state==='committed'?1:0);
   assert.equal(result[0].status,'fulfilled');
   if(modes[0]===modes[1]){assert.equal(result[1].status,'fulfilled');assert.equal(result[1].value.idempotent,true);}else assert.equal(result[1].status,'rejected');
  }finally{db.close();}
 });
}
test('failed debit rolls back the hold transition',async()=>{
 const db=openTestDB(schema);try{
  db._sqlite.exec("INSERT INTO tenants(id,name) VALUES('fixture','controlled fixture'); INSERT INTO credit_ledger(id,tenant_id,delta,source_key) VALUES('grant','fixture',10,'fixture-not-payment'); CREATE TRIGGER fail_debit BEFORE INSERT ON credit_ledger WHEN NEW.delta<0 BEGIN SELECT RAISE(ABORT,'forced_debit_failure'); END;");
  const h=await reserve(db,'fixture','fixture-reservation',7);
  await assert.rejects(finishHold(db,'fixture',h.id,'committed'),/forced_debit_failure/);
  assert.equal(db._sqlite.prepare('SELECT state FROM holds WHERE id=?').get(h.id).state,'open');
  assert.deepEqual(await balance(db,'fixture'),{booked:10,reserved:7,available:3,debt:0});
 }finally{db.close();}
});
