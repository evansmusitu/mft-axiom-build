import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiResumptionService,publicAiResumptionFailure} from '../src/staging/ai-resumption.mjs';

const tenantId='00000000-0000-4000-8000-000000000001';
const conversationId='00000000-0000-4000-8000-000000000002';
const result={conversationId,mode:'BOT',changed:true,reviewOnly:true,providerDelivery:'NEVER_SUBMITTED'};
const input={tenantId,actorId:'synthetic-owner',conversationId,confirmReviewOnly:true};

test('returning to AI draft assistance requires exact owner confirmation before admission',async()=>{
 let calls=0;
 const service=createAiResumptionService({scoped:async()=>{calls++;}});
 for(const confirmReviewOnly of [false,null,undefined,'true',1])await assert.rejects(service({...input,confirmReviewOnly,recheckSession:async()=>{calls++;}}),/AI_RESUMPTION_CONFIRMATION_REQUIRED/);
 assert.equal(calls,0);
});

test('AI resumption rejects malformed scope, actor and conversation without database work',async()=>{
 let calls=0;
 const service=createAiResumptionService({scoped:async()=>{calls++;}});
 for(const change of [{tenantId:'other'},{conversationId:'bad'},{actorId:''},{actorId:'owner\n'},{tenantId:tenantId+'\n'},{conversationId:conversationId+'\n'},{actorId:'a'.repeat(193)},{recheckSession:null}])await assert.rejects(service({...input,recheckSession:async()=>{},...change}),/AI_RESUMPTION_INPUT_REJECTED/);
 assert.equal(calls,0);
});

test('owner resumption checks the real session before admission and before commit',async()=>{
 const events=[];
 const service=createAiResumptionService({scoped:async(tenant,actor,roles,work)=>{
  assert.equal(tenant,tenantId);assert.equal(actor,input.actorId);assert.deepEqual(roles,['OWNER']);events.push('begin');
  const value=await work({query:async(sql,args)=>{assert.match(sql,/musitu\.resume_ai_assistance/);assert.deepEqual(args,[input.actorId,conversationId,true]);events.push('command');return{rows:[{result}]};}});
  events.push('commit');return value;
 }});
 assert.deepEqual(await service({...input,recheckSession:async()=>{events.push('session');}}),result);
 assert.deepEqual(events,['session','begin','command','session','commit']);
});

test('a revoked session cannot reach the AI resumption command',async()=>{
 let called=false;
 const service=createAiResumptionService({scoped:async()=>{called=true;}});
 await assert.rejects(service({...input,recheckSession:async()=>{throw Error('SESSION_REVOKED');}}),/SESSION_REVOKED/);
 assert.equal(called,false);
});

test('unexpected resumption results abort instead of reporting a successful return',async()=>{
 const service=createAiResumptionService({scoped:async(t,a,r,work)=>work({query:async()=>({rows:[{result:{...result,providerDelivery:'SUBMITTED'}}]})})});
 await assert.rejects(service({...input,recheckSession:async()=>{}}),/AI_RESUMPTION_RESULT_REJECTED/);
});

test('resumption failures expose bounded guidance and never expose provider or SQL details',()=>{
 assert.equal(publicAiResumptionFailure(Error('CUSTOMER_OPT_OUT')).status,409);
 assert.equal(publicAiResumptionFailure(Error('AI_UNCERTAIN_REQUEST')).status,409);
 assert.equal(publicAiResumptionFailure(Error('SESSION_REVOKED')).status,403);
 assert.equal(publicAiResumptionFailure(Error('AI_RESUMPTION_CONFIRMATION_REQUIRED')).status,400);
 const safe=publicAiResumptionFailure(Error('private sql and credential material'));
 assert.equal(safe.status,503);assert.ok(!JSON.stringify(safe).includes('credential'));
});
