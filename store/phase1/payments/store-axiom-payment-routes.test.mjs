import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createStoreBillingWorker} from './store-axiom-checkout.mjs';

const merchantKey='ci-only-store-merchant-key-this-is-not-live';
const checkoutReference='STORE-ABCDEF0123456789';
const pollurl='https://www.paynow.co.zw/Interface/CheckPayment/?guid=00000000-1111-2222-3333-444444444444';
const providerRef='PAYNOW-STORE-CI-ONE';
const token='store-fixture-bearer-token-must-be-long-67890';
function signedStatus(opts={}){
  const data={reference:checkoutReference,paynowreference:providerRef,amount:'4.25',
    status:'Paid',pollurl,...opts};
  const entries=Object.entries(data);
  const hash=createHash('sha512').update(entries.map(([,v])=>v).join('')+merchantKey).digest('hex').toUpperCase();
  return new URLSearchParams([...entries,['hash',hash]]).toString();
}
function fakeDb(){
  const log=[];
  const intent={reference:checkoutReference,customer_id:'customer_fixture',sku:'MUSITU_OWNED_APP',
    amount_cents:425,currency:'USD',status:'pending',poll_url:pollurl,
    expires_at:'2099-10-19T00:00:00.000Z'};
  const data={review:null,observation:null,intent,authToken:{customer_id:'customer_fixture',status:'active',expires_at:'2099-01-01T00:00:00.000Z'}};
  return {log,data,prepare(sql){
    const entry={sql,values:[]};
    return {bind(...values){entry.values=values;return {
      sql,
      async first(){
        log.push({...entry,method:'first'});
        if(sql.includes('store_customer_tokens'))return data.authToken;
        if(sql.includes('store_checkout_reviews'))return data.review;
        if(sql.includes('store_paynow_status_observations'))return data.observation;
        if(sql.includes('store_checkout_intents'))return (
          entry.values[0]===checkoutReference && (!sql.includes('customer_id=?2')||entry.values[1]==='customer_fixture')?data.intent:null);
        return null;
      },
      async run(){
        log.push({...entry,method:'run'});
        if(sql.includes('INSERT INTO store_checkout_reviews')){
          data.review={reference:entry.values[0],paynow_reference:entry.values[1],
            review_status:entry.values[2],callback_digest:entry.values[3],poll_digest:entry.values[4]};
        }
        if(sql.includes('INSERT INTO store_paynow_status_observations')){
          data.observation={event_id:entry.values[0],reference:entry.values[1],
            paynow_reference:entry.values[2],provider_status:entry.values[3],
            callback_digest:entry.values[6],poll_digest:entry.values[7]};
        }
        if(sql.includes('UPDATE store_checkout_intents SET status=')){
          data.intent.status=entry.values[1];
        }
        return {success:true,meta:{changes:1}};
      },
    }}};
  },
  async batch(statements){const all=[];for(const x of statements)all.push(await x.run());return all;}
  };
}
function fixture(pollBody=signedStatus(),opts={}){
  const calls=[];
  const app=createStoreBillingWorker({paynowFetch:async(url,init)=>{
    calls.push({url,init});
    return new Response(pollBody,{status:200,headers:{'content-type':'application/x-www-form-urlencoded'}});
  },newReference:()=>checkoutReference});
  const env={STORE_CALLBACKS_CERTIFIED:'true',STORE_CHECKOUT_ENABLED:'false',STORE_FIRST_PARTY_ONLY:'true',
    STORE_PAYNOW_ID:'27721',STORE_PAYNOW_MODE:'testing',STORE_PAYNOW_INTEGRATION_KEY:merchantKey,STORE_DB:fakeDb(),...opts};
  return {app,env,calls};
}
const webhook=(body=signedStatus())=>new Request('https://payments.mftintelligence.com/store/billing/webhooks/paynow',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
const status=(reference=checkoutReference,bearer=token)=>new Request(
  'https://payments.mftintelligence.com/store/billing/checkout/'+reference,
  {headers:{authorization:'Bearer '+bearer}});
test('signed callback plus independently signed Paynow poll persists Store-only review, never entitlement',async()=>{
  const {app,env,calls}=fixture();
  const response=await app.fetch(webhook(),env),result=await response.json();
  assert.equal(response.status,202);
  assert.equal(result.payment_status,'review_required');
  assert.equal(result.entitlement_granted,false);
  assert.equal(result.publisher_payout_authorized,false);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,pollurl);
  assert.equal(calls[0].init.method,'POST');
  assert.equal(calls[0].init.redirect,'error');
  assert.equal(env.STORE_DB.data.intent.status,'review_required');
  assert.equal(env.STORE_DB.data.review.paynow_reference,providerRef);
  assert.ok(env.STORE_DB.log.some(x=>x.sql.includes('INSERT INTO store_checkout_reviews')));
  assert.equal(env.STORE_DB.log.some(x=>/billing_subscriptions|usage_buckets/.test(x.sql)),false);
});
test('callbacks are disabled until Store callbacks are certified; no DB or payment provider calls',async()=>{
  const {app,env,calls}=fixture(signedStatus(),{STORE_CALLBACKS_CERTIFIED:'false'});
  const response=await app.fetch(webhook(),env);
  assert.equal(response.status,503);
  assert.equal(calls.length,0);assert.equal(env.STORE_DB.log.length,0);
});
test('invalid signed Paynow callback is rejected before any Store DB access or provider poll',async()=>{
  const {app,env,calls}=fixture();
  const response=await app.fetch(webhook(signedStatus().replace('Paid','Refunded')),env);
  assert.equal(response.status,400);
  assert.equal(calls.length,0);assert.equal(env.STORE_DB.log.length,0);
});
test('independent provider poll with wrong transaction identity cannot record paid review',async()=>{
  const {app,env,calls}=fixture(signedStatus({paynowreference:'PAYNOW-OTHER-CI'}));
  const response=await app.fetch(webhook(),env),body=await response.json();
  assert.equal(response.status,409);assert.equal(body.entitlement_granted,false);
  assert.equal(calls.length,1);assert.equal(env.STORE_DB.data.review,null);
  assert.equal(env.STORE_DB.data.intent.status,'pending');
});
test('refund status produces manual refund review, never an automatic refund or download',async()=>{
  const {app,env}=fixture(signedStatus({status:'Refunded'}));
  const response=await app.fetch(webhook(signedStatus({status:'Refunded'})),env);
  const body=await response.json();
  assert.equal(response.status,202);
  assert.equal(body.payment_status,'refund_review_required');
  assert.equal(body.entitlement_granted,false);
  assert.equal(env.STORE_DB.data.review.review_status,'refund_review_required');
});
test('customer status endpoint enforces bearer token and order ownership, without polling Paynow',async()=>{
  const {app,env,calls}=fixture();
  const noBearer=await app.fetch(status(checkoutReference,''),env);
  const wrongOrder=await app.fetch(status('STORE-OTHER01234567890'),env);
  assert.equal(noBearer.status,401);assert.equal(wrongOrder.status,404);
  const response=await app.fetch(status(),env),out=await response.json();
  assert.equal(response.status,200);
  assert.equal(out.payment_status,'pending');assert.equal(out.entitlement_granted,false);
  assert.equal(calls.length,0);
});
test('a second callback replay cannot insert twice or modify an existing review',async()=>{
  const {app,env,calls}=fixture();
  const first=await app.fetch(webhook(),env);
  const second=await app.fetch(webhook(),env);
  assert.equal(first.status,202);assert.equal(second.status,202);
  assert.equal(env.STORE_DB.log.filter(x=>x.sql.includes('INSERT INTO store_checkout_reviews')).length,1);
  assert.equal(env.STORE_DB.data.review.review_status,'review_required');
  assert.ok(calls.length<=2);
});
test('customer browser return page is only advisory and cannot confirm payment',async()=>{
  const {app,env,calls}=fixture();
  const res=await app.fetch(new Request('https://payments.mftintelligence.com/store/billing/return?reference='+checkoutReference),env);
  const body=await res.json();
  assert.equal(res.status,200);
  assert.equal(body.entitlement_granted,false);
  assert.equal(body.payment_status,'unverified');
  assert.equal(calls.length,0);assert.equal(env.STORE_DB.log.length,0);
});


test('concurrent order transition cannot create a positive review from a stale pending snapshot',async()=>{
  const {app,env}=fixture();
  const oldBatch=env.STORE_DB.batch.bind(env.STORE_DB);
  env.STORE_DB.batch=async(statements)=>{
    // The database's atomic conditional INSERT and UPDATE must both target
    // pending orders. A concurrent cancellation makes neither match.
    assert.ok(statements[0].sql.includes("status='pending'"));
    return [{success:true,meta:{changes:0}},{success:true,meta:{changes:0}}];
  };
  const response=await app.fetch(webhook(),env);
  assert.equal(response.status,409);
  assert.equal(env.STORE_DB.data.review,null);
  assert.equal(env.STORE_DB.data.intent.status,'pending');
  assert.equal(typeof oldBatch,'function');
});
test('unconfirmed or absent transactional batch metadata cannot be treated as persisted review',async()=>{
  const {app,env}=fixture();
  env.STORE_DB.batch=async()=>[{success:true},{success:true}];
  const response=await app.fetch(webhook(),env);
  assert.notEqual(response.status,202);
});


test('HTML masquerading as a signed Paynow poll response cannot create payment review',async()=>{
  const {app,env}=fixture();
  const external=await app.fetch; // route is still the real Store worker.
  assert.equal(typeof external,'function');
  const blocker=createStoreBillingWorker({paynowFetch:async()=>new Response(signedStatus(),
    {status:200,headers:{'content-type':'text/html'}})});
  const result=await blocker.fetch(webhook(),env);
  assert.equal(result.status,502);
  assert.equal(env.STORE_DB.data.review,null);
  assert.equal(env.STORE_DB.data.intent.status,'pending');
});
test('expired Store checkout cannot be promoted by a late signed provider callback',async()=>{
  const {app,env,calls}=fixture();
  env.STORE_DB.data.intent.expires_at='2000-01-01T00:00:00.000Z';
  const response=await app.fetch(webhook(),env);
  assert.equal(response.status,409);
  assert.equal(calls.length,0);
  assert.equal(env.STORE_DB.data.review,null);
});

test('slow unbounded client webhook upload is rejected by absolute deadline without database or Paynow calls',async()=>{
  const {env,calls}=fixture();
  let upload;
  const requestBody=new ReadableStream({start(controller){
    upload=controller;
    controller.enqueue(new TextEncoder().encode('reference=STORE-ABCDEF0123456789'));
  }});
  const request=new Request('https://payments.mftintelligence.com/store/billing/webhooks/paynow',{
    method:'POST',duplex:'half',headers:{'content-type':'application/x-www-form-urlencoded'},body:requestBody
  });
  const {createStorePaymentRoutes}=await import('./store-axiom-payment-routes.mjs');
  const routes=createStorePaymentRoutes({providerFetch:async()=>{throw Error('provider must never be called')},
    callbackReadTimeoutMs:40});
  let watch;
  try{
    const action=routes.handle(request,env);
    const bound=new Promise((_,reject)=>{watch=setTimeout(()=>reject(Error('TEST_WEBHOOK_UPLOAD_NOT_TIME_BOUNDED')),350);});
    const response=await Promise.race([action,bound]);
    assert.equal(response.status,408,'incomplete untrusted upload must have a deterministic timeout');
    assert.equal((await response.json()).entitlement_granted,false);
    assert.equal(env.STORE_DB.log.length,0,'unverified callback must never access Store DB');
    assert.equal(calls.length,0);
  }finally{
    if(watch)clearTimeout(watch);
    try{upload.close();}catch{}
  }
});

test('authenticated status rejects expired, missing, malformed and revoked customer tokens',async()=>{
  for(const value of ['2000-01-01T00:00:00.000Z','not-a-date',null,'']){
    const {app,env,calls}=fixture();
    env.STORE_DB.data.authToken.expires_at=value;
    const response=await app.fetch(status(),env);
    assert.equal(response.status,401,'expired bearer cannot read customer order: '+value);
    assert.equal(calls.length,0);
    assert.equal(env.STORE_DB.log.filter(x=>x.sql.includes('store_checkout_intents')).length,0);
  }
  const {app,env,calls}=fixture();
  env.STORE_DB.data.authToken.status='revoked';
  assert.equal((await app.fetch(status(),env)).status,401);
  assert.equal(calls.length,0);
});

test('Store V2 webhook rejects borrowed FMI and unverified live-mode merchant IDs before DB access',async()=>{
 for(const override of [{STORE_PAYNOW_ID:'26343'},{STORE_PAYNOW_MODE:'live'},{STORE_PAYNOW_MODE:undefined}]){
  const {app,env,calls}=fixture(signedStatus(),override);
  const response=await app.fetch(webhook(),env);
  assert.equal(response.status,503);
  assert.equal(calls.length,0);
  assert.equal(env.STORE_DB.log.length,0);
 }
});


test('non-final provider states never create fabricated refund reviews',async()=>{
 for(const providerState of ['Created','Sent','Delivered','Awaiting Delivery','Cancelled','Disputed']){
  const {app,env,calls}=fixture(signedStatus({status:providerState}));
  const response=await app.fetch(webhook(signedStatus({status:providerState})),env);
  const out=await response.json();
  assert.equal(response.status,202,providerState);
  assert.equal(out.processed,false,providerState);
  assert.equal(out.payment_status,'pending',providerState);
  assert.equal(out.entitlement_granted,false);
  assert.equal(calls.length,1,'must independently poll Paynow');
  assert.equal(env.STORE_DB.data.intent.status,'pending',providerState);
  assert.equal(env.STORE_DB.data.review,null,providerState);
  assert.equal(env.STORE_DB.log.filter(x=>/INSERT INTO store_checkout_reviews/.test(x.sql)).length,0);
 }
});
test('contradictory paid and refunded provider states require manual resolution and never create reviews',async()=>{
 const {app,env,calls}=fixture(signedStatus({status:'Refunded'}));
 const response=await app.fetch(webhook(signedStatus({status:'Paid'})),env);
 const out=await response.json();
 assert.equal(response.status,409);
 assert.equal(out.entitlement_granted,false);
 assert.equal(env.STORE_DB.data.intent.status,'pending');
 assert.equal(env.STORE_DB.data.review,null);
 assert.equal(calls.length,1);
});


test('certified private observation ledger persists matching signed cancellation, preserves pending status and denies entitlements',async()=>{
 const {app,env,calls}=fixture(signedStatus({status:'Cancelled'}),{STORE_PAYNOW_OBSERVATIONS_ENABLED:'true'});
 const response=await app.fetch(webhook(signedStatus({status:'Cancelled'})),env);
 const out=await response.json();
 assert.equal(response.status,202);
 assert.equal(out.payment_status,'pending');
 assert.equal(out.observation_recorded,true);
 assert.equal(out.entitlement_granted,false);
 assert.equal(out.publisher_payout_authorized,false);
 assert.equal(calls.length,1);
 assert.equal(env.STORE_DB.data.intent.status,'pending');
 assert.equal(env.STORE_DB.data.review,null);
 assert.equal(env.STORE_DB.data.observation.provider_status,'Cancelled');
 assert.equal(env.STORE_DB.data.observation.reference,checkoutReference);
 assert.equal(env.STORE_DB.data.observation.paynow_reference,providerRef);
 assert.equal(env.STORE_DB.log.filter(x=>x.sql.includes('INSERT INTO store_paynow_status_observations')).length,1);
});

test('a repeated certified signed provider observation is idempotent without a second row',async()=>{
 const {app,env,calls}=fixture(signedStatus({status:'Disputed'}),{STORE_PAYNOW_OBSERVATIONS_ENABLED:'true'});
 const first=await app.fetch(webhook(signedStatus({status:'Disputed'})),env);
 const second=await app.fetch(webhook(signedStatus({status:'Disputed'})),env);
 assert.equal(first.status,202);assert.equal(second.status,202);
 assert.equal((await second.json()).idempotent,true);
 assert.equal(calls.length,2);
 assert.equal(env.STORE_DB.log.filter(x=>x.sql.includes('INSERT INTO store_paynow_status_observations')).length,1);
});

test('certified nonfinal observation cannot report success when the ledger is unavailable',async()=>{
 const {app,env}=fixture(signedStatus({status:'Awaiting Delivery'}),{STORE_PAYNOW_OBSERVATIONS_ENABLED:'true'});
 const old=env.STORE_DB.prepare.bind(env.STORE_DB);
 env.STORE_DB.prepare=sql=>{
   if(sql.includes('store_paynow_status_observations'))throw Error('missing_candidate_migration');
   return old(sql);
 };
 const response=await app.fetch(webhook(signedStatus({status:'Awaiting Delivery'})),env);
 assert.equal(response.status,503);
 assert.equal(env.STORE_DB.data.review,null);
 assert.equal(env.STORE_DB.data.intent.status,'pending');
});

test('observations disabled by default cannot perform ledger writes even with valid signed provider states',async()=>{
 const {app,env}=fixture(signedStatus({status:'Delivered'}));
 const response=await app.fetch(webhook(signedStatus({status:'Delivered'})),env);
 assert.equal(response.status,202);
 assert.equal((await response.json()).payment_status,'pending');
 assert.equal(env.STORE_DB.data.observation,null);
 assert.equal(env.STORE_DB.log.filter(x=>x.sql.includes('store_paynow_status_observations')).length,0);
});

test('mismatched callback and provider poll can never enter observation ledger',async()=>{
 const {app,env}=fixture(signedStatus({status:'Disputed'}),{STORE_PAYNOW_OBSERVATIONS_ENABLED:'true'});
 const response=await app.fetch(webhook(signedStatus({status:'Cancelled'})),env);
 assert.equal(response.status,409);
 assert.equal(env.STORE_DB.data.observation,null);
 assert.equal(env.STORE_DB.log.filter(x=>x.sql.includes('store_paynow_status_observations')).length,0);
});


test('a concurrent identical signed observation is reconciled without duplicate writes',async()=>{
 const {app,env,calls}=fixture(signedStatus({status:'Disputed'}),{STORE_PAYNOW_OBSERVATIONS_ENABLED:'true'});
 const real=env.STORE_DB.prepare.bind(env.STORE_DB);
 let writes=0;
 env.STORE_DB.prepare=sql=>{
   const q=real(sql);
   if(!sql.includes('INSERT INTO store_paynow_status_observations'))return q;
   return {bind(...args){return {async run(){
     writes++;
     // Simulate a second worker committing the same verified event between
     // our initial SELECT and INSERT. The attempted insert then conflicts.
     env.STORE_DB.data.observation={event_id:args[0],reference:args[1],
       paynow_reference:args[2],provider_status:args[3],
       callback_digest:args[6],poll_digest:args[7]};
     throw Error('SQLITE_CONSTRAINT_PRIMARYKEY');
   }}}};
 };
 const response=await app.fetch(webhook(signedStatus({status:'Disputed'})),env);
 const out=await response.json();
 assert.equal(response.status,202);
 assert.equal(out.idempotent,true);
 assert.equal(out.observation_recorded,true);
 assert.equal(out.entitlement_granted,false);
 assert.equal(env.STORE_DB.data.intent.status,'pending');
 assert.equal(writes,1);
 assert.equal(calls.length,1);
});

test('a conflicting concurrent observation never becomes idempotent success',async()=>{
 const {app,env}=fixture(signedStatus({status:'Cancelled'}),{STORE_PAYNOW_OBSERVATIONS_ENABLED:'true'});
 const real=env.STORE_DB.prepare.bind(env.STORE_DB);
 env.STORE_DB.prepare=sql=>{
   const q=real(sql);
   if(!sql.includes('INSERT INTO store_paynow_status_observations'))return q;
   return {bind(...args){return {async run(){
     env.STORE_DB.data.observation={event_id:args[0],reference:args[1],
       paynow_reference:'OTHER-PAYNOW-REF',provider_status:args[3],
       callback_digest:args[6],poll_digest:args[7]};
     throw Error('SQLITE_CONSTRAINT');
   }}}};
 };
 const response=await app.fetch(webhook(signedStatus({status:'Cancelled'})),env);
 const out=await response.json();
 assert.notEqual(response.status,202);
 assert.equal(out.entitlement_granted,false);
 assert.equal(out.publisher_payout_authorized,false);
});
