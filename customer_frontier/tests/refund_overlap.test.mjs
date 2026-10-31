import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openTestDB} from '../customer_control_plane/sqlite_d1_test_adapter.mjs';
import {balance,createOrder,execute,one,reconcileSettlement,requestRefund,reconcileRefund} from '../customer_control_plane/ledger.mjs';
const schema=resolve(dirname(fileURLToPath(import.meta.url)),'../customer_control_plane/schema.sql');
async function setup(amountA=40,amountB=60){
 const db=openTestDB(schema);
 await execute(db,"INSERT INTO tenants(id,name) VALUES('t','Example')");
 await execute(db,"INSERT INTO identities(id,issuer,external_sub) VALUES('u','https://id.local','user')");
 await execute(db,"INSERT INTO memberships(tenant_id,identity_id,role) VALUES('t','u','owner')");
 await execute(db,"INSERT INTO price_catalog(id,name,currency,amount_minor,grant_units,enabled) VALUES('p','Units','USD',100,3,1)");
 const o=await createOrder(db,'t','u','p','order-idempotency-01');
 await reconcileSettlement(db,{eventId:'settlement-1',provider:'psp',transactionId:'capture-1',orderId:o.id,amountMinor:100,currency:'USD'});
 const a=await requestRefund(db,'t','u',o.id,amountA,'Partial refund '+amountA,'refund-40-idempotency');
 const b=await requestRefund(db,'t','u',o.id,amountB,'Partial refund '+amountB,'refund-60-idempotency');
 await execute(db,"UPDATE refund_requests SET state='provider_pending' WHERE id IN (?,?)",a.id,b.id);
 return {db,o,a,b};
}
const proof=(r,o,seq)=>({eventId:'refund-event-'+seq,provider:'psp',transactionId:'refund-txn-'+seq,refundId:r.id,orderId:o.id,amountMinor:r.amount_minor,currency:'USD'});
test('interleaved partial refunds debit all units without stale-balance under-reversal',async()=>{
 const {db,o,a,b}=await setup(); const underlying=db.batch.bind(db);let injected=false;
 db.batch=async entries=>{
  if(injected)return underlying(entries);
  injected=true;db.batch=underlying;
  await reconcileRefund(db,proof(b,o,'b'));
  return underlying(entries);
 };
 try{
  await reconcileRefund(db,proof(a,o,'a'));
  assert.equal((await one(db,"SELECT COUNT(*) AS n FROM provider_events WHERE kind='refund'")).n,2);
  assert.equal((await one(db,"SELECT COUNT(*) AS n FROM refund_requests WHERE state='settled'")).n,2);
  assert.equal((await balance(db,'t')).booked,0,'full refunded order cannot retain credits');
  assert.equal((await one(db,"SELECT COALESCE(SUM(delta),0) AS n FROM credit_ledger WHERE source_key LIKE 'refund:%'")).n,-3);
 }finally{db.close();}
});
test('small verified partial refund can reverse zero integer units; later remainder still reverses all units',async()=>{
 const {db,o,a,b}=await setup(10,90);
 try{
  // Create authentic 10/90 requests up front: financial requests are immutable.
  const x=await reconcileRefund(db,{...proof(a,o,'small'),amountMinor:10});
  assert.equal(x.revokedUnits,0);
  assert.equal((await balance(db,'t')).booked,3);
  const y=await reconcileRefund(db,{...proof(b,o,'big'),amountMinor:90});
  assert.equal(y.revokedUnits,3);
  assert.equal((await balance(db,'t')).booked,0);
 }finally{db.close();}
});
test('database rejects forged provider transition that would refund more than captured amount',async()=>{
 const {db,a,b}=await setup();
 try{
  await reconcileRefund(db,proof(a,{id:(await one(db,'SELECT order_id FROM refund_requests WHERE id=?',a.id)).order_id},'safe'));
  // A hostile direct database writer injects an over-budget 70-cent request;
  // legitimate requestRefund would refuse it before this state.
  await execute(db,"INSERT INTO refund_requests(id,tenant_id,order_id,identity_id,amount_minor,reason,state,client_key) VALUES('forged-over','t',?,'u',70,'Forged direct SQL','provider_pending','forged-over-key')",(await one(db,'SELECT order_id FROM refund_requests WHERE id=?',b.id)).order_id);
  const orderId=(await one(db,'SELECT order_id FROM refund_requests WHERE id=?',b.id)).order_id;
  await assert.rejects(reconcileRefund(db,{...proof({id:'forged-over',amount_minor:70},{id:orderId},'over'),amountMinor:70}),/refund_exceeds_order_amount/);
  assert.equal((await balance(db,'t')).booked,2);
 }finally{db.close();}
});
