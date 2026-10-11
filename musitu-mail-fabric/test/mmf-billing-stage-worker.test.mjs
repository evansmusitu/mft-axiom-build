import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/commercial/billing-stage-worker.mjs';

const TOKEN='stage-private-mmf-billing-access-operator-token-20261011';
const root='https://stage-billing.internal';
const order='MMF-AAAABBBBCCCDD';
function database(){
 const sqlite=new DatabaseSync(':memory:');
 const db={prepare(sql){return {bind(...args){const s=sqlite.prepare(sql);return {
  async run(){const o=s.run(...args);return {success:true,meta:{changes:Number(o.changes)}};},
  async first(){return s.get(...args)||null;}
 }},async run(){const o=sqlite.prepare(sql).run();return {success:true,meta:{changes:Number(o.changes)}};}}}};
 return {db,close:()=>sqlite.close()};
}
function stage(d,tenant='mmf_tenant_a'){
 return {MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_BILLING_API_ENABLED:'true',
  MMF_MAIL_SENDING_ENABLED:'false',MMF_PAYMENT_DB:d,MMF_TENANT_ID:tenant,MMF_BILLING_OPERATOR_TOKEN:TOKEN};
}
const input={customerReference:'customer:allowed:001',contractReference:'contract:approved:123',orderReference:order};
function request(path,method='GET',body,auth=TOKEN){
 return new Request(root+path,{method,headers:{...(auth?{authorization:'Bearer '+auth}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},
  ...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
}
async function call(req,env){const r=await worker.fetch(req,env);let data={};try{data=await r.json()}catch{}return {status:r.status,headers:r.headers,data};}

test('closed billing stage refuses all operations unless explicit stage lock and isolated db exist',async()=>{
 const {db,close}=database();try{
  for(const overrides of [
   {MMF_STAGE_ONLY:'false'},{MMF_REAL_SEND_ENABLED:'true'},{MMF_COMMERCE_ENABLED:'true'},
   {MMF_MAIL_SENDING_ENABLED:'true'},{MMF_BILLING_API_ENABLED:'false'},
   {MMF_BILLING_OPERATOR_TOKEN:'short'},{MMF_PAYMENT_DB:undefined}
  ]){
   const res=await call(request('/v1/billing/stage/orders','POST',input),{...stage(db),...overrides});
   assert.equal(res.status,503,JSON.stringify(overrides));
  }
 }finally{close()}
});
test('requires separate operator credential and never accepts customer token or exposed event',async()=>{
 const {db,close}=database();try{
  for(const auth of [null,'wrong-token','customer-active-bearer']){
   const r=await call(request('/v1/billing/stage/orders','POST',input,auth),stage(db));
   assert.equal(r.status,401);assert.equal(r.headers.get('cache-control'),'no-store');
  }
  assert.equal((await call(request('/v1/billing/checkout','POST',input),stage(db))).status,404);
  assert.equal((await call(request('/v1/billing/stage/paid','POST',input),stage(db))).status,404);
  assert.equal((await call(request('/v1/billing/webhooks/paynow','POST',input),stage(db))).status,404);
  assert.equal((await call(request('/v1/billing/stage/orders','GET'),stage(db))).status,404);
 }finally{close()}
});
test('opens only isolated pending order with immutable server-priced quote; retries idempotently',async()=>{
 const {db,close}=database();try{
  const env=stage(db);
  const a=await call(request('/v1/billing/stage/orders','POST',input),env);
  assert.equal(a.status,201);assert.equal(a.data.orderReference,order);assert.equal(a.data.status,'PENDING');
  assert.equal(a.data.externalCheckoutCreated,false);assert.equal(a.data.grantsMailSending,false);
  assert.equal(a.data.realProviderSettlementVerified,false);
  const repeat=await call(request('/v1/billing/stage/orders','POST',input),env);
  assert.equal(repeat.status,200);assert.equal(repeat.data.idempotent,true);
  const read=await call(request('/v1/billing/stage/orders/'+order),env);
  assert.equal(read.status,200);assert.equal(read.data.orderReference,order);assert.equal(read.data.status,'PENDING');
  assert.equal(read.headers.get('cache-control'),'no-store');
  const no=await call(request('/v1/billing/stage/orders/MMF-XYZXYZXYZX'),env);
  assert.equal(no.status,404);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM mmf_prep_orders').bind().first().then(r=>r.n),1);
 }finally{close()}
});
test('never accepts client-controlled tenant, payment price, status, checkout URL or receipt',async()=>{
 const {db,close}=database();try{
  const env=stage(db);
  for(const extra of [{tenantId:'attacker'},{amountCents:1},{status:'paid'},{provider:'paynow'},{receipt:'signed'},{plan:'FMI-PRO'},
   {currency:'EUR'},{checkoutUrl:'https://paynow.co.zw/Payment/ConfirmPayment/1234'}]){
   const r=await call(request('/v1/billing/stage/orders','POST',{...input,...extra}),env);
   assert.equal(r.status,422,JSON.stringify(extra));
  }
  assert.equal((await call(request('/v1/billing/stage/orders','POST','{oops'),env)).status,400);
  assert.equal((await call(new Request(root+'/v1/billing/stage/orders',{method:'POST',headers:{authorization:'Bearer '+TOKEN,'content-type':'text/plain'},body:JSON.stringify(input)}),env)).status,415);
  assert.equal((await call(request('/v1/billing/stage/orders','POST',JSON.stringify(input)+' '.repeat(4000)),env)).status,413);
  assert.equal((await call(request('/v1/billing/stage/orders','POST',{...input,orderReference:'FMI-AAAAA'}),env)).status,422);
 }finally{close()}
});
test('same order reference with a different contract is rejected, not overwritten or silently reused',async()=>{
 const {db,close}=database();try{
  const env=stage(db);
  assert.equal((await call(request('/v1/billing/stage/orders','POST',input),env)).status,201);
  const changed=await call(request('/v1/billing/stage/orders','POST',
    {...input,contractReference:'contract:approved:DIFFERENT'}),env);
  assert.equal(changed.status,503); // Existing reference is locked to first immutable quote.
  const still=await call(request('/v1/billing/stage/orders/'+order),env);
  assert.equal(still.status,200);assert.equal(still.data.status,'PENDING');
 }finally{close()}
});
test('read-only stage returns generic 503 on failed persistence without leaking data',async()=>{
 const env=stage({prepare(){throw new Error('SECRET_DATABASE_FAILED')}});
 const result=await call(request('/v1/billing/stage/orders','POST',input),env);
 assert.equal(result.status,503);
 assert.equal(JSON.stringify(result.data).includes('SECRET_DATABASE_FAILED'),false);
});
test('tenant read cannot access or overwrite another tenant order with identical reference',async()=>{
 const {db,close}=database();try{
  assert.equal((await call(request('/v1/billing/stage/orders','POST',input),stage(db,'mmf_tenant_a'))).status,201);
  assert.equal((await call(request('/v1/billing/stage/orders/'+order),stage(db,'mmf_tenant_b'))).status,404);
  assert.equal((await call(request('/v1/billing/stage/orders','POST',input),stage(db,'mmf_tenant_b'))).status,503);
  assert.equal((await call(request('/v1/billing/stage/orders/'+order),stage(db,'mmf_tenant_a'))).status,200);
 }finally{close()}
});
