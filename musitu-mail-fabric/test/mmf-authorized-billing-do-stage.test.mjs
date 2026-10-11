import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker,{MmfBillingPrivateStageSqliteDO} from '../src/edge/billing-private-do-stage.mjs';
const token='mmf-private-durable-stage-operator-token-for-test';
const vars={MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_MAIL_SENDING_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_BILLING_API_ENABLED:'true',MMF_STAGE_RECEIPTS_ENABLED:'false',MMF_API_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false',MMF_TENANT_ID:'mmf_stage_20261011',MMF_BILLING_OPERATOR_TOKEN:token};
function sqlStorage(){
 const db=new DatabaseSync(':memory:');
 const sql={exec(query,...params){const stmt=db.prepare(query),isSelect=/^\s*(?:SELECT|WITH|PRAGMA)/i.test(query),rows=isSelect?stmt.all(...params):(stmt.run(...params),[]);return {toArray(){return rows}}}};
 return {ctx:{storage:{sql}},close(){db.close()}};
}
const input={customerReference:'customer:allowed:001',contractReference:'contract:approved:123',orderReference:'MMF-AAAABBBBCCCDD'};
const request=(path,method='GET',body,auth=token)=>new Request('https://mmf-internal.invalid'+path,{method,headers:{authorization:'Bearer '+auth,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
test('a separate SQLite Durable Object handles a private pending order through the real billing Worker without real Paynow',async()=>{
 const {ctx,close}=sqlStorage();try{
  const actor=new MmfBillingPrivateStageSqliteDO(ctx,vars);
  const stageEnv={...vars,MMF_BILLING_LEDGER:{idFromName(name){assert.equal(name,'mmf-stage-tenant');return {name}},get(){return {fetch:req=>actor.fetch(req)}}}};
  const a=await worker.fetch(request('/v1/billing/stage/orders','POST',input),stageEnv),created=await a.json();
  assert.equal(a.status,201);assert.equal(created.status,'PENDING');assert.equal(created.canAcceptCustomerFunds,false);
  const read=await worker.fetch(request('/v1/billing/stage/orders/MMF-AAAABBBBCCCDD'),stageEnv);
  assert.equal(read.status,200);assert.equal((await read.json()).status,'PENDING');
  const repeat=await worker.fetch(request('/v1/billing/stage/orders','POST',input),stageEnv);
  assert.equal(repeat.status,200);assert.equal((await repeat.json()).idempotent,true);
  assert.equal((await worker.fetch(request('/v1/billing/checkout','POST',input),stageEnv)).status,404);
 }finally{close()}
});
test('private Durable Object denies wrong operator, live sending and commerce flags',async()=>{
 const {ctx,close}=sqlStorage();try{
 const actor=new MmfBillingPrivateStageSqliteDO(ctx,vars);
 const make=(overrides={})=>({...vars,MMF_BILLING_LEDGER:{idFromName:()=>({}),get:()=>({fetch:req=>actor.fetch(req)})},...overrides});
 assert.equal((await worker.fetch(request('/v1/billing/stage/orders','POST',input,'not-authorized'),make())).status,401);
 for(const over of [{MMF_REAL_SEND_ENABLED:'true'},{MMF_COMMERCE_ENABLED:'true'},{MMF_BILLING_API_ENABLED:'false'},{MMF_STAGE_RECEIPTS_ENABLED:'true'}, {MMF_BILLING_LEDGER:null}]){
  const r=await worker.fetch(request('/v1/billing/stage/orders','POST',input),make(over));assert.equal(r.status,503,JSON.stringify(over));
 }
 }finally{close()}
});
