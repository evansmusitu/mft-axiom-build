import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeFeedbackCapability,feedbackCapabilityConfigValid,handleFeedbackRpc} from '../src/edge/feedback-rpc.mjs';

const now=Date.parse('2026-10-10T17:00:00Z');
const original='scoped-secret-old-0000000000000000000000000';
const next='scoped-secret-next-000000000000000000000000';
const storage='general-storage-secret-0000000000000000000';
const env=()=>({
 MMF_TENANT_ID:'stage-tenant',MMF_FEEDBACK_RPC_ENABLED:'true',
 MMF_FEEDBACK_RPC_SECRET:next,MMF_STORAGE_RPC_SECRET:storage,
 MMF_FEEDBACK_RPC_PREVIOUS_SECRET:original,
 MMF_FEEDBACK_RPC_PREVIOUS_EXPIRES_MS:String(now+5*60_000)
});
test('a scope-limited primary key remains usable during and after migration',()=>{
 const e=env();
 assert.equal(feedbackCapabilityConfigValid(e,{nowMs:now}),true);
 assert.equal(authorizeFeedbackCapability(next,e,{nowMs:now}),true);
 assert.equal(authorizeFeedbackCapability(next,e,{nowMs:now+8*60_000}),true);
});
test('a previous feedback-only capability is accepted solely for the short bounded overlap',()=>{
 const e=env();
 assert.equal(authorizeFeedbackCapability(original,e,{nowMs:now}),true);
 assert.equal(authorizeFeedbackCapability(original,e,{nowMs:now+5*60_000}),false);
 assert.equal(authorizeFeedbackCapability(original,e,{nowMs:now+8*60_000}),false);
});
test('revocation is immediate: deleting previous key rejects old while new works',()=>{
 const e=env();
 delete e.MMF_FEEDBACK_RPC_PREVIOUS_SECRET;delete e.MMF_FEEDBACK_RPC_PREVIOUS_EXPIRES_MS;
 assert.equal(feedbackCapabilityConfigValid(e,{nowMs:now}),true);
 assert.equal(authorizeFeedbackCapability(original,e,{nowMs:now}),false);
 assert.equal(authorizeFeedbackCapability(next,e,{nowMs:now}),true);
});
test('equal, weak, malformed, or unbounded previous secrets fail the entire bridge closed',()=>{
 const cases=[
 {MMF_FEEDBACK_RPC_PREVIOUS_SECRET:next},
 {MMF_FEEDBACK_RPC_PREVIOUS_SECRET:storage},
 {MMF_FEEDBACK_RPC_PREVIOUS_SECRET:'short'},
 {MMF_FEEDBACK_RPC_PREVIOUS_EXPIRES_MS:''},
 {MMF_FEEDBACK_RPC_PREVIOUS_EXPIRES_MS:String(now+17*60_000)},
 {MMF_FEEDBACK_RPC_PREVIOUS_EXPIRES_MS:'invalid-date'},
 {MMF_FEEDBACK_RPC_PREVIOUS_EXPIRES_MS:'0'}
 ];
 for(const change of cases){
  const cfg={...env(),...change};
  assert.equal(feedbackCapabilityConfigValid(cfg,{nowMs:now}),false,JSON.stringify(change));
  assert.equal(authorizeFeedbackCapability(next,cfg,{nowMs:now}),false);
 }
});
test('previous expiry without corresponding secret and a primary matching broad SQL key are rejected',()=>{
 const cfg=env();delete cfg.MMF_FEEDBACK_RPC_PREVIOUS_SECRET;
 assert.equal(feedbackCapabilityConfigValid(cfg,{nowMs:now}),false);
 const broad={...env(),MMF_FEEDBACK_RPC_SECRET:storage};
 assert.equal(feedbackCapabilityConfigValid(broad,{nowMs:now}),false);
});
test('authorization cannot be used on wrong tenants or disabled feedback bridge',()=>{
 const cfg=env();
 for(const changes of [{MMF_TENANT_ID:'../other'},{MMF_FEEDBACK_RPC_ENABLED:'false'}]){
  const e={...cfg,...changes};
  assert.equal(authorizeFeedbackCapability(next,e,{nowMs:now}),false);
 }
 assert.equal(authorizeFeedbackCapability('bad-secret',cfg,{nowMs:now}),false);
});

test('private SQL RPC accepts a previous capability only within grace, then rejects without reading storage',async()=>{
 const e=env();
 e.MMF_FEEDBACK_RPC_PREVIOUS_EXPIRES_MS=String(Date.now()+5*60_000);
 let reads=0;
 const sql={exec(){reads++;return {toArray(){return [{message_id:'stage-message'}]}}}};
 const request=secret=>new Request('https://internal.invalid/feedback-rpc',{method:'POST',
  headers:{'content-type':'application/json','x-mmf-feedback':secret},
  body:JSON.stringify({sql:"SELECT message_id FROM mail_messages WHERE tenant_id=? AND provider_id=? AND state='ACCEPTED_BY_PROVIDER'",
    params:['stage-tenant','provider-one']})});
 const valid=await handleFeedbackRpc(request(original),sql,e);
 assert.equal(valid.status,200);
 assert.ok(reads>0);
 const before=reads;
 e.MMF_FEEDBACK_RPC_PREVIOUS_EXPIRES_MS=String(Date.now()-1);
 const expired=await handleFeedbackRpc(request(original),sql,e);
 assert.equal(expired.status,401);
 assert.equal(reads,before);
 assert.equal((await handleFeedbackRpc(request(next),sql,e)).status,200);
});
test('malformed overlap disables the entire internal RPC before consuming SQL',async()=>{
 let reads=0;
 const e={...env(),MMF_FEEDBACK_RPC_PREVIOUS_SECRET:next,
  MMF_FEEDBACK_RPC_PREVIOUS_EXPIRES_MS:String(Date.now()+5*60_000)};
 const request=new Request('https://internal.invalid/feedback-rpc/recipient-match',{method:'POST',
  headers:{'content-type':'application/json','x-mmf-feedback':next},
  body:JSON.stringify({tenantId:'stage-tenant',providerId:'provider-one',recipient:'test@example.net'})});
 const response=await handleFeedbackRpc(request,{exec(){reads++;throw Error('MUST_NOT_RUN')}},e);
 assert.equal(response.status,503);
 assert.equal((await response.json()).error,'FEEDBACK_BRIDGE_DISABLED');
 assert.equal(reads,0);
});
