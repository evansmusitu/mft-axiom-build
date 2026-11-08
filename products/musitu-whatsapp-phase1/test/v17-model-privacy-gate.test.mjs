import test from 'node:test';
import assert from 'node:assert/strict';
import {createEvidenceBoundModelGateway} from '../src/ai/provider-gateway.mjs';

const tenantId='00000000-0000-4000-8000-00000000000a';
const faq={tenantId,faqId:'faq-hours',question:'When are you open?',answer:'9 AM to 5 PM.',approved:true};
const gateway=fetchImpl=>createEvidenceBoundModelGateway({qualified:true,url:'https://test-provider.example.invalid/v1/chat/completions',model:'test-model',token:'stage-only-token',allowedOrigins:['https://test-provider.example.invalid'],fetchImpl});
const success=()=>({ok:true,headers:{get:()=>null},json:async()=>({choices:[{message:{content:JSON.stringify({action:'ANSWER',faqId:'faq-hours'})}}]})});

test('the external AI provider never receives phone numbers, emails, URLs or credential-like content',async()=>{
 const calls=[];const model=gateway(async(_url,req)=>{calls.push(req);return success();});
 for(const question of [
  'My number is +263 77 123 4567. When are you open?',
  'Contact me at user@example.org. When are you open?',
  'Please use https://private.example.org/secret?id=123. When are you open?',
  'My API key is sk-proj-abcdefgh12345, when are you open?'
 ]){
  const result=await model.select({tenantId,question,approvedFaqs:[faq]});
  assert.equal(result.status,'HANDOVER_REQUIRED',question);
  assert.equal(result.body,null);
 }
 assert.equal(calls.length,0);
});

test('owner-approved FAQ candidates with contact data are not transmitted to model either',async()=>{
 const calls=[];const model=gateway(async(_url,req)=>{calls.push(req);return success();});
 const result=await model.select({tenantId,question:'When are you open?',approvedFaqs:[
  {...faq,question:'When are you open? Contact 0771234567'}
 ]});
 assert.equal(result.status,'HANDOVER_REQUIRED');
 assert.equal(calls.length,0);
});

test('ordinary low-risk exact FAQ questions retain an AI-selection path without revealing approved answer',async()=>{
 const calls=[];const model=gateway(async(_url,req)=>{calls.push(req);return success();});
 const result=await model.select({tenantId,question:'When are you open?',approvedFaqs:[faq]});
 assert.equal(result.status,'DRAFT');
 assert.equal(result.body,faq.answer);
 assert.equal(calls.length,1);
 assert.equal(calls[0].body.includes(faq.answer),false);
});
