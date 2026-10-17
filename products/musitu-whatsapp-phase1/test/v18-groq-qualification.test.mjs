import test from 'node:test';import assert from 'node:assert/strict';
import {qualifyGroqDevelopment} from '../scripts/qualify-groq-development.mjs';
const token='gsk_'+'synthetic'.repeat(5);
test('Groq qualification does not invoke the provider without explicit Free-plan admission',async()=>{
 let calls=0;await assert.rejects(qualifyGroqDevelopment({token,request:async()=>{calls++;}}),/GROQ_FREE_PLAN_NOT_VERIFIED/);assert.equal(calls,0);
});
test('Groq qualification distinguishes five synthetic contract cases and exact token accounting',async()=>{
 let calls=0;const report=await qualifyGroqDevelopment({token,freePlanVerified:true,request:async(url,options)=>{
  calls++;const proposal=[{action:'ANSWER',faqId:'synthetic-hours'},{action:'ANSWER',faqId:'synthetic-hours'},{action:'HANDOVER',faqId:''},{action:'HANDOVER',faqId:''},{action:'ANSWER',faqId:'synthetic-hours'}][calls-1];
  assert.equal(JSON.parse(options.body).tools,undefined);
  return new Response(JSON.stringify({model:'openai/gpt-oss-20b',choices:[{finish_reason:'stop',message:{content:JSON.stringify(proposal)}}],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}}),{headers:{'content-type':'application/json'}});
 }});
 assert.equal(calls,5);assert.equal(report.pass,5);assert.equal(report.complete,true);assert.equal(report.usage.tokens.total,650);assert.equal(report.accountBillingVerifiedByThisScript,false);assert.equal(JSON.stringify(report).includes(token),false);
});
test('Groq qualification stops after an actual HTTP failure instead of retrying or reporting a quality pass',async()=>{
 let calls=0;const report=await qualifyGroqDevelopment({token,freePlanVerified:true,request:async()=>{calls++;return new Response('{}',{status:429});}});
 assert.equal(calls,1);assert.equal(report.complete,false);assert.equal(report.fail,1);assert.equal(report.notRun,4);assert.equal(report.usage.events[0].outcome,'RATE_LIMIT');assert.equal(report.usage.unknownUsageAttempts,1);
});
