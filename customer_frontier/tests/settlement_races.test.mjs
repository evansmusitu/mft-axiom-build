import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openTestDB} from '../customer_control_plane/sqlite_d1_test_adapter.mjs';
import {balance,createOrder,execute,one,reconcileSettlement,requestRefund} from '../customer_control_plane/ledger.mjs';
const schema=resolve(dirname(fileURLToPath(import.meta.url)),'../customer_control_plane/schema.sql');
const setup=async()=>{
 const db=openTestDB(schema);
 await execute(db,"INSERT INTO tenants(id,name) VALUES('t1','Test customer')");
 await execute(db,"INSERT INTO identities(id,issuer,external_sub) VALUES('u1','https://id.local','user')");
 await execute(db,"INSERT INTO memberships(tenant_id,identity_id,role) VALUES('t1','u1','owner')");
 await execute(db,"INSERT INTO price_catalog(id,name,currency,amount_minor,grant_units,enabled) VALUES('p1','Compute','USD',2000,100,1)");
 const order=await createOrder(db,'t1','u1','p1','settle-unique-key');
 return {db,order};
};
const event=(order,provider='verified-psp',transactionId='receipt-original')=>({eventId:'settlement-proof-1',provider,transactionId,orderId:order.id,amountMinor:order.amount_minor,currency:order.currency});
test('conflicting provider event in a settlement race is NEVER accepted as an idempotent replay',async()=>{
 const {db,order}=await setup();
 const batch=db.batch.bind(db);
 let injected=false;
 db.batch=async statements=>{
  if(injected)return batch(statements);
  injected=true;db.batch=batch;
  await reconcileSettlement(db,event(order,'provider-A','transaction-A'));
  throw new Error('simulated_conflicting_proof_race');
 };
 try{
  await assert.rejects(reconcileSettlement(db,event(order,'provider-B','transaction-B')),/event_collision/);
  assert.equal((await balance(db,'t1')).booked,100);
  assert.equal((await one(db,'SELECT COUNT(*) AS n FROM provider_events')).n,1);
  assert.equal((await one(db,'SELECT provider FROM provider_events WHERE event_id=?','settlement-proof-1')).provider,'provider-A');
 }finally{db.close();}
});
test('identical verified settlement arriving during a race is a harmless replay',async()=>{
 const {db,order}=await setup();
 const batch=db.batch.bind(db);
 let injected=false;
 db.batch=async statements=>{
  if(injected)return batch(statements);
  injected=true;db.batch=batch;
  await reconcileSettlement(db,event(order));
  throw new Error('simulated_same_proof_race');
 };
 try{
  const result=await reconcileSettlement(db,event(order));
  assert.equal(result.idempotent,true);
  assert.equal((await balance(db,'t1')).booked,100);
  assert.equal((await one(db,'SELECT COUNT(*) AS n FROM invoices')).n,1);
 }finally{db.close();}
});
test('same refund idempotency key with different reason is a collision',async()=>{
 const {db,order}=await setup();
 try{
  await reconcileSettlement(db,event(order));
  await requestRefund(db,'t1','u1',order.id,1000,'Service unavailable','refund-request-key');
  await assert.rejects(requestRefund(db,'t1','u1',order.id,1000,'Service delivered OK','refund-request-key'),/refund_key_conflict/);
 }finally{db.close();}
});
