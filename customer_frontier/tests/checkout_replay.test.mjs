import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openTestDB} from '../customer_control_plane/sqlite_d1_test_adapter.mjs';
import {createOrder,execute,one,reconcileSettlement} from '../customer_control_plane/ledger.mjs';
import {handle} from '../customer_control_plane/worker.mjs';
const schema=resolve(dirname(fileURLToPath(import.meta.url)),'../customer_control_plane/schema.sql');
const post=(key='order-attempt-idempotency')=>new Request('https://localhost/v1/customer/orders',{method:'POST',headers:{'content-type':'application/json','origin':'https://localhost','x-axiom-intent':'customer-action','idempotency-key':key},body:JSON.stringify({price_id:'p'})});
async function setup(){
 const db=openTestDB(schema);
 await execute(db,"INSERT INTO tenants(id,name) VALUES('t','Customer')");
 await execute(db,"INSERT INTO identities(id,issuer,external_sub) VALUES('u','https://id.local','user')");
 await execute(db,"INSERT INTO memberships(tenant_id,identity_id,role) VALUES('t','u','owner')");
 await execute(db,"INSERT INTO price_catalog(id,name,currency,amount_minor,grant_units,enabled) VALUES('p','Compute units','USD',2000,100,1)");
 let calls=0;
 const env={CUSTOMER_DB:db,PAYMENT_CHECKOUT_QUALIFIED:'true',IDENTITY_VERIFIER:{fetch:async()=>new Response(JSON.stringify({authenticated:true,issuer:'https://id.local',subject:'user',tenant_id:'t',audience:'customer-control-plane'}),{status:200})},CHECKOUT_SERVICE:{fetch:async()=>{calls++;return new Response(JSON.stringify({checkout_url:'https://payments.mftintelligence.com/session/qualified-test'}),{status:201});}}};
 return {db,env,calls:()=>calls};
}

test('completed payment is never presented as a fresh checkout on customer retry',async()=>{
 const {db,env,calls}=await setup();
 try{
  const o=await createOrder(db,'t','u','p','settled-idempotency-key');
  await reconcileSettlement(db,{eventId:'settlement-1',provider:'verified-psp',transactionId:'capture-1',orderId:o.id,amountMinor:2000,currency:'USD'});
  const r=await handle(post('settled-idempotency-key'),env);
  const data=await r.json();
  assert.equal(r.status,200);
  assert.equal(data.order.state,'settled');
  assert.equal(data.checkout.available,false);
  assert.equal(calls(),0,'payment provider must not be asked to create checkout for a settled order');
  assert.equal((await one(db,'SELECT COUNT(*) AS n FROM orders')).n,1);
 }finally{db.close()}
});

test('void order replay cannot trigger checkout',async()=>{
 const {db,env,calls}=await setup();
 try{
  const o=await createOrder(db,'t','u','p','void-idempotency-key');
  await execute(db,"UPDATE orders SET state='void' WHERE id=?",o.id);
  const r=await handle(post('void-idempotency-key'),env);
  assert.equal(r.status,409);
  assert.equal((await r.json()).error,'order_not_payable');
  assert.equal(calls(),0);
 }finally{db.close()}
});

test('pending checkout can be requested through qualified standalone provider',async()=>{
 const {db,env,calls}=await setup();
 try{
  const r=await handle(post('pending-idempotency-key'),env);
  assert.equal(r.status,202);
  const data=await r.json();
  assert.equal(data.order.state,'pending');
  assert.equal(data.checkout.available,true);
  assert.equal(calls(),1);
  assert.equal((await one(db,'SELECT COUNT(*) AS n FROM credit_ledger')).n,0);
 }finally{db.close()}
});
