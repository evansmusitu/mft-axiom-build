import test from 'node:test';
import assert from 'node:assert/strict';
import {openTestDB} from '../customer-hosted-acceptance-20261107/customer_frontier/customer_control_plane/sqlite_d1_test_adapter.mjs';
import {reserve,finishHold,balance} from './pr95-ledger-original.mjs';
const schema=new URL('../customer-hosted-acceptance-20261107/customer_frontier/customer_control_plane/schema.sql',import.meta.url);
test('REPRO: released hold can still be charged by losing concurrent commit',async()=>{
 const db=openTestDB(schema);try{
  db._sqlite.exec("INSERT INTO tenants(id,name,status) VALUES('fixture-tenant','controlled fixture','active'); INSERT INTO credit_ledger(id,tenant_id,delta,source_key) VALUES('fixture-credit','fixture-tenant',10,'controlled-fixture-credit');");
  const h=await reserve(db,'fixture-tenant','fixture-reservation',7);
  const realPrepare=db.prepare;let readers=0,release;
  const barrier=new Promise(r=>release=r);
  db.prepare=sql=>{const p=realPrepare(sql);if(sql==='SELECT * FROM holds WHERE id=? AND tenant_id=?'){
   const first=p.first;p.first=async()=>{const row=await first();readers++;if(readers===2)release();await barrier;return row;};
  }return p;};
  const outcomes=await Promise.allSettled([finishHold(db,'fixture-tenant',h.id,'released'),finishHold(db,'fixture-tenant',h.id,'committed')]);
  const hold=db._sqlite.prepare('SELECT state FROM holds WHERE id=?').get(h.id),credit=await balance(db,'fixture-tenant');
  const charges=db._sqlite.prepare('SELECT delta FROM credit_ledger WHERE source_key=?').all('usage:'+h.id);
  console.log(JSON.stringify({hold_state:hold.state,booked:credit.booked,available:credit.available,charges:charges.map(x=>x.delta),outcomes:outcomes.map(x=>({status:x.status,error:x.reason?.message}))}));
  assert.equal(hold.state,'released');assert.equal(credit.booked,3);assert.deepEqual(charges.map(x=>x.delta),[-7]);assert.equal(outcomes[1].status,'rejected');
 }finally{db.close();}
});
