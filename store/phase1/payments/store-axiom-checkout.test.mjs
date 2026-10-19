import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createStoreBillingWorker} from './store-axiom-checkout.mjs';

const key='ci-only-mft-key-not-production';
const userToken='store-ci-test-long-lived-token-123456789';
function hash(values){return createHash('sha512').update(values.join('')+key).digest('hex').toUpperCase();}
function fakeDb(){
 const log=[], products=new Map([['MUSITU_OWNED_APP',{sku:'MUSITU_OWNED_APP',amount_cents:425,currency:'USD',status:'approved',publisher_type:'first_party'}],['THIRD_PARTY_APP',{sku:'THIRD_PARTY_APP',amount_cents:425,currency:'USD',status:'approved',publisher_type:'third_party'}]]);
 return {log,prepare(sql){
   return {bind(...values){const entry={sql,values};return {async first(){log.push(entry);if(sql.includes('store_customer_tokens'))return {customer_id:'customer_fixture',status:'active'};if(sql.includes('store_products'))return products.get(values[0])??null;return null},async run(){log.push(entry);return {success:true,meta:{changes:1}}}}}};
 }};
}
function fakeEnv(overrides={}){return {STORE_CHECKOUT_ENABLED:'true',STORE_FIRST_PARTY_ONLY:'true',STORE_CALLBACKS_CERTIFIED:'true',STORE_PAYNOW_ID:'12345',STORE_PAYNOW_INTEGRATION_KEY:key,STORE_DB:fakeDb(),...overrides};}
const statusUrl='https://www.paynow.co.zw/Interface/CheckPayment/?guid=00000000-1111-2222-3333-444444444444';
const browser='https://www.paynow.co.zw/Payment/ConfirmPayment/1234';
function responseBody({status='Ok',browserurl=browser,pollurl=statusUrl,invalidHash=false}={}){
 const fields=[['status',status],['browserurl',browserurl],['pollurl',pollurl]];
 const h=invalidHash?'0'.repeat(128):hash(fields.map(x=>x[1]));
 return new URLSearchParams([...fields,['hash',h]]).toString();
}
function worker(response=responseBody()){
 const calls=[];
 const app=createStoreBillingWorker({paynowFetch:async(url,init)=>{calls.push({url,init});return new Response(response,{status:200,headers:{'content-type':'application/x-www-form-urlencoded'}})},newReference:()=> 'STORE-ABCDEF0123456789'});
 return {app,calls};
}
function req(body={sku:'MUSITU_OWNED_APP'},token=userToken){return new Request('https://payments.mftintelligence.com/store/billing/checkout',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});}

test('Store checkout copies Axiom server-priced authenticated D1 intent and signed Paynow initiation, not Axiom product',async()=>{
 const {app,calls}=worker();const env=fakeEnv();
 const res=await app.fetch(req(),env);const out=await res.json();
 assert.equal(res.status,201);assert.equal(out.payment_status,'pending');
 assert.equal(out.amount_cents,425);assert.equal(out.reference,'STORE-ABCDEF0123456789');
 assert.equal(out.browser_url,browser);assert.equal(out.entitlement_granted,false);
 assert.equal(out.publisher_payout_authorized,false);assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://www.paynow.co.zw/interface/initiatetransaction');
 const params=new URLSearchParams(calls[0].init.body);
 assert.equal(params.get('id'),'12345');assert.equal(params.get('amount'),'4.25');
 assert.equal(params.get('reference'),'STORE-ABCDEF0123456789');
 assert.equal(params.get('resulturl'),'https://payments.mftintelligence.com/store/billing/webhooks/paynow');
 assert.equal(params.get('returnurl'),'https://payments.mftintelligence.com/store/billing/return?reference=STORE-ABCDEF0123456789');
 assert.equal(params.get('hash'),hash(['12345','STORE-ABCDEF0123456789','4.25','MUSITU Store MUSITU_OWNED_APP','https://payments.mftintelligence.com/store/billing/return?reference=STORE-ABCDEF0123456789','https://payments.mftintelligence.com/store/billing/webhooks/paynow','Message']));
 assert.ok(env.STORE_DB.log.some(x=>x.sql.includes('INSERT INTO store_checkout_intents')));
 assert.ok(env.STORE_DB.log.every(x=>!x.sql.includes('billing_subscriptions')));
});
test('checkout disabled by default cannot create intents or call Paynow',async()=>{
 const {app,calls}=worker();const env=fakeEnv({STORE_CHECKOUT_ENABLED:'false'});
 const res=await app.fetch(req(),env);
 assert.equal(res.status,503);assert.equal(calls.length,0);assert.equal(env.STORE_DB.log.length,0);
});
test('store cannot reuse Axiom as catalog nor accept client-owned pricing',async()=>{
 const {app,calls}=worker();const env=fakeEnv();
 for(const body of [{sku:'THIRD_PARTY_APP'},{sku:'MUSITU_OWNED_APP',amount_cents:1},{sku:'MUSITU_OWNED_APP',price_id:'axiom-developer-monthly'},{sku:'MUSITU_OWNED_APP',publisher_id:'OTHER'},{sku:'not-existing'}]){
   const res=await app.fetch(req(body),env);assert.equal(res.status,400);
 }
 assert.equal(calls.length,0);assert.ok(env.STORE_DB.log.every(x=>!x.sql.includes('INSERT')));
});
test('missing or invalid bearer does not read products, write intents or hit provider',async()=>{
 const {app,calls}=worker();const env=fakeEnv();
 for(const token of ['short','']){
   const response=await app.fetch(req({},token),env);assert.equal(response.status,401);
 }
 assert.equal(env.STORE_DB.log.length,0);assert.equal(calls.length,0);
});
test('Paynow unsigned initiate reply never issues checkout URL or entitlement',async()=>{
 const {app,calls}=worker(responseBody({invalidHash:true}));const env=fakeEnv();
 const response=await app.fetch(req(),env);const out=await response.json();
 assert.equal(response.status,502);assert.equal(out.entitlement_granted,false);assert.equal(calls.length,1);
 assert.ok(env.STORE_DB.log.some(x=>x.sql.includes('UPDATE store_checkout_intents')));
});
test('Paynow response with attacker-controlled browser URL is rejected',async()=>{
 const {app,calls}=worker(responseBody({browserurl:'https://attacker.invalid/offer'}));const env=fakeEnv();
 const response=await app.fetch(req(),env);assert.equal(response.status,502);assert.equal(calls.length,1);
});
test('Paynow success does not grant paid content, subscriptions, refunds or marketplace payout',async()=>{
 const {app}=worker();const env=fakeEnv();const res=await app.fetch(req(),env);const out=await res.json();
 assert.equal(res.status,201);assert.equal(out.entitlement_granted,false);assert.equal(out.publisher_payout_authorized,false);
 assert.equal(out.live_money_certified,false);assert.equal(out.payment_status,'pending');
 assert.equal(env.STORE_DB.log.filter(x=>/INSERT|UPDATE/.test(x.sql)).length,2);
});
test('a streamed oversized Paynow reply is rejected before buffering the entire body',async()=>{
 let pulls=0;
 const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(2048));if(pulls>=150)controller.close();}});
 const app=createStoreBillingWorker({paynowFetch:async()=>new Response(stream,{status:200,headers:{'content-type':'application/x-www-form-urlencoded'}}),newReference:()=> 'STORE-ABCDEF0123456789'});
 const env=fakeEnv();const res=await app.fetch(req(),env);
 assert.equal(res.status,502);assert.ok(pulls<=8,`stream was unbounded: consumed ${pulls} chunks`);
 assert.ok(env.STORE_DB.log.some(x=>x.sql.includes('UPDATE store_checkout_intents')));
});
test('malformed duplicate Paynow response fields must fail-closed',async()=>{
 const malicious=responseBody()+'&status=Ok';const {app}=worker(malicious);
 const response=await app.fetch(req(),fakeEnv());assert.equal(response.status,502);
});

test('configured merchant key and checkout flag cannot charge until Store-owned callback endpoint is separately certified',async()=>{
 const {app,calls}=worker();const env=fakeEnv({STORE_CALLBACKS_CERTIFIED:'false'});
 const res=await app.fetch(req(),env);assert.equal(res.status,503);
 assert.equal(calls.length,0);assert.equal(env.STORE_DB.log.length,0);
});

test('zero-row intent insert must never call Paynow or issue an orphaned checkout',async()=>{
 const {app,calls}=worker();const env=fakeEnv();
 const original=env.STORE_DB.prepare.bind(env.STORE_DB);
 env.STORE_DB.prepare=sql=>{
   const statement=original(sql);
   if(!sql.includes('INSERT INTO store_checkout_intents'))return statement;
   return {bind:()=>({run:async()=>({success:true,meta:{changes:0}})})};
 };
 const response=await app.fetch(req(),env);const body=await response.json();
 assert.equal(response.status,503);
 assert.equal(body.entitlement_granted,false);
 assert.equal(body.publisher_payout_authorized,false);
 assert.equal(calls.length,0,'Paynow cannot see a Store order missing a durable intent');
});
test('signed Paynow checkout cannot return a payment link if D1 pending transition matched zero rows',async()=>{
 const {app,calls}=worker();const env=fakeEnv();
 const original=env.STORE_DB.prepare.bind(env.STORE_DB);
 env.STORE_DB.prepare=sql=>{
   const statement=original(sql);
   if(!sql.includes("UPDATE store_checkout_intents SET status='pending'"))return statement;
   return {bind:()=>({run:async()=>({success:true,meta:{changes:0}})})};
 };
 const response=await app.fetch(req(),env);const body=await response.json();
 assert.equal(calls.length,1);
 assert.equal(response.status,502);
 assert.equal(body.browser_url,undefined,'uncommitted provider link must never reach customer');
 assert.equal(body.payment_status,undefined);
 assert.equal(body.entitlement_granted,false);
});
test('D1 write without verifiable change metadata cannot authorize a new Store checkout',async()=>{
 const {app,calls}=worker();const env=fakeEnv();
 const original=env.STORE_DB.prepare.bind(env.STORE_DB);
 env.STORE_DB.prepare=sql=>{
   const statement=original(sql);
   if(!sql.includes('INSERT INTO store_checkout_intents'))return statement;
   return {bind:()=>({run:async()=>({success:true})})};
 };
 const response=await app.fetch(req(),env);
 assert.equal(response.status,503);
 assert.equal(calls.length,0);
});

test('slow-trickle Paynow initiation response has an absolute timeout and can never disclose payment URL',async()=>{
 let drip,deadline,abortSignal,streamController;
 const responseStream=new ReadableStream({
   start(controller){
     streamController=controller;
     controller.enqueue(new TextEncoder().encode('status='));
     drip=setInterval(()=>{try{controller.enqueue(new Uint8Array([65]));}catch{}},45);
   },
   cancel(){if(drip)clearInterval(drip);}
 });
 const app=createStoreBillingWorker({newReference:()=> 'STORE-ABCDEF0123456789',
   paynowFetch:async(url,init)=>{
     abortSignal=init.signal;
     init.signal.addEventListener('abort',()=>{
       try{streamController.error(new Error('simulated provider body stream aborted'));}catch{}
     },{once:true});
     return new Response(responseStream,{status:200,headers:{'content-type':'application/x-www-form-urlencoded'}});
   }});
 const env=fakeEnv();
 try{
   const result=app.fetch(req(),env);
   const refusal=new Promise((_,reject)=>{
     deadline=setTimeout(()=>reject(new Error('TEST_STORE_INITIATION_ABSOLUTE_TIMEOUT_MISSING')),9400);
   });
   const response=await Promise.race([result,refusal]);
   assert.equal(response.status,502);
   assert.equal((await response.json()).entitlement_granted,false);
   assert.equal(abortSignal.aborted,true);
 }finally{
   if(drip)clearInterval(drip);
   if(deadline)clearTimeout(deadline);
 }
});


test('checkout and browser return reject unrecognized host before DB access or Paynow initiation',async()=>{
 const {app,calls}=worker();
 const env=fakeEnv();
 const foreign=new Request('https://unapproved.example/store/billing/checkout',{
  method:'POST',headers:{authorization:'Bearer '+userToken,'content-type':'application/json'},
  body:JSON.stringify({sku:'MUSITU_OWNED_APP'})
 });
 const denied=await app.fetch(foreign,env);
 assert.equal(denied.status,404,'only the approved Store billing origin may initiate checkout');
 assert.equal(calls.length,0);
 assert.equal(env.STORE_DB.log.length,0);
 const returned=await app.fetch(new Request(
  'https://unapproved.example/store/billing/return?reference=STORE-ABCDEF0123456789'
 ),env);
 assert.equal(returned.status,404,'untrusted alternate origins must not impersonate approved billing return');
 assert.equal(calls.length,0);
 assert.equal(env.STORE_DB.log.length,0);
});


test('untrusted checkout upload enforces byte limit without buffering the entire request body',async()=>{
 const {app,calls}=worker();
 const env=fakeEnv();
 let pulls=0;
 const stream=new ReadableStream({pull(controller){
  pulls++;
  controller.enqueue(new Uint8Array(1024));
  if(pulls>=200)controller.close();
 }});
 const request=new Request('https://payments.mftintelligence.com/store/billing/checkout',{
  method:'POST',duplex:'half',headers:{authorization:'Bearer '+userToken,'content-type':'application/json'},body:stream
 });
 const response=await app.fetch(request,env);
 assert.equal(response.status,413,'oversized request must be rejected at the stream boundary');
 assert.ok(pulls<=6,'request body consumed too many client-provided chunks: '+pulls);
 assert.equal(calls.length,0);
 assert.equal(env.STORE_DB.log.filter(x=>/store_products|INSERT INTO store_checkout_intents/.test(x.sql)).length,0);
});
