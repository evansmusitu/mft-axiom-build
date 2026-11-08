import test from 'node:test';
import assert from 'node:assert/strict';
import {selectEvidenceBoundReply} from '../src/ai/evidence-bound-selector.mjs';
const tenantId='6e6e6ed2-3846-435a-989f-4b2071244cd0';
const provider={propose:async()=>({action:'ANSWER',faqId:'price'})};
const base={tenantId,faqId:'price',question:'How much?',answer:'$10'};
const select=(approvedFaqs)=>selectEvidenceBoundReply({tenantId,question:'How much?',approvedFaqs,provider});
test('implicit, null and truthy approval are never usable as customer-facing evidence',async()=>{
 for(const record of [base,{...base,approved:null},{...base,approved:'true'},{...base,approved:1}]){
  const result=await select([record]);
  assert.equal(result.status,'HANDOVER_REQUIRED');
  assert.equal(result.body,null);
 }
});
test('explicit boolean true approval remains an owner-sourced draft',async()=>{
 const result=await select([{...base,approved:true}]);
 assert.equal(result.status,'DRAFT');assert.equal(result.body,'$10');
});
