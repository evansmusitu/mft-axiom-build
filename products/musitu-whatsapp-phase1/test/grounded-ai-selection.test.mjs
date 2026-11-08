import test from 'node:test';
import assert from 'node:assert/strict';
import {selectEvidenceBoundReply} from '../src/ai/evidence-bound-selector.mjs';

const TA='00000000-0000-4000-8000-00000000000a';
const TB='00000000-0000-4000-8000-00000000000b';
const faq=[{tenantId:TA,faqId:'hours',question:'What hours?',answer:'We open at 8.',approved:true},
 {tenantId:TA,faqId:'place',question:'Where?',answer:'12 Main Street.',approved:true}];
const mock=(choice)=>({propose:async()=>choice});
const call=(question,provider,faqs=faq)=>selectEvidenceBoundReply({tenantId:TA,question,approvedFaqs:faqs,provider});

test('exact approved FAQ is a provenance-linked draft, model text never becomes the answer',async()=>{
 const result=await call(' WHAT   hours? ',mock({action:'ANSWER',faqId:'hours',content:'We open at 5!'}));
 assert.deepEqual(result,{status:'DRAFT',sourceFaqId:'hours',body:'We open at 8.',requiresHumanReview:false});
});

test('non-exact AI-selected FAQ is always human review only, never auto-send',async()=>{
 const seen=[];const provider={propose:async p=>{seen.push(p);return {action:'ANSWER',faqId:'hours',content:'Invented'}}};
 const result=await call('Can I visit early?',provider);
 assert.equal(result.status,'HUMAN_REVIEW_REQUIRED');
 assert.equal(result.body,'We open at 8.');
 assert.equal(result.requiresHumanReview,true);
 assert.equal(seen[0].candidates.some(x=>x.answer==='We open at 8.'),true);
 assert.equal(JSON.stringify(result).includes('Invented'),false);
});

test('unknown, hallucinated or revoked source never returns an answer',async()=>{
 for(const [selected,faqs] of [
  [{action:'ANSWER',faqId:'invented'},faq],
  [{action:'HANDOVER'},faq],
  [{action:'ACTION',tool:'transferMoney'},faq],
  [{action:'ANSWER',faqId:'place'},[{...faq[1],approved:false}]]
 ]){
  const result=await call('Please do something',mock(selected),faqs);
  assert.deepEqual(result,{status:'HANDOVER_REQUIRED',sourceFaqId:null,body:null,requiresHumanReview:true});
 }
});

test('provider failure and invalid structured results fail closed without drafting invented text',async()=>{
 const failed={propose:async()=>{throw new Error('OUTSIDE_PROVIDER_FAILURE')}};
 assert.equal((await call('Where?',failed)).status,'HANDOVER_REQUIRED');
 assert.equal((await call('Where?',mock('unparseable'))).status,'HANDOVER_REQUIRED');
 assert.equal((await call('Where?',mock({action:'ANSWER',faqId:'place',execute:'http://example.com'}))).status,'HANDOVER_REQUIRED');
});

test('invalid tenant-scoped inputs and oversized sensitive prompts are rejected before model call',async()=>{
 let called=0;const provider={propose:async()=>{called++;return {action:'ANSWER',faqId:'hours'}}};
 await assert.rejects(call('A'.repeat(4001),provider),/INPUT_BOUNDARY/);
 await assert.rejects(call('Hi',provider,[{tenantId:TB,faqId:'other',question:'?',answer:'Other shop.'},...faq]),/TENANT_SOURCE_MISMATCH/);
 await assert.rejects(selectEvidenceBoundReply({tenantId:'',question:'hi',approvedFaqs:faq,provider}),/INPUT_BOUNDARY/);
 assert.equal(called,0);
});
