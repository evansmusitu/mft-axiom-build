import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMetaTextSubmission,classifyMetaSendOutcome} from '../src/adapters/meta-send-protocol.mjs';
const opt={graphVersion:'v23.0',phoneNumberId:'123456789012345',recipientWaId:'263771234567',body:'Approved answer'};

test('builds exact official Graph text-message contract without credentials or side effects',()=>{
 const r=buildMetaTextSubmission(opt);
 assert.equal(r.url,'https://graph.facebook.com/v23.0/123456789012345/messages');
 assert.deepEqual(r.body,{messaging_product:'whatsapp',to:'263771234567',type:'text',text:{body:'Approved answer',preview_url:false}});
 assert.equal(JSON.stringify(r).includes('Bearer'),false);
});

test('rejects invalid Graph versions, phones, raw recipients, unapproved extensions and long bodies',()=>{
 for(const change of [
  {graphVersion:'v23.0/evil'},{phoneNumberId:'1234/foo'},{recipientWaId:'+263771234567'},
  {body:' '},{body:'x'.repeat(4097)},{preview_url:true},{authority:'UNSAFE'},
 ]) assert.throws(()=>buildMetaTextSubmission({...opt,...change}),/INVALID_META_SEND_REQUEST/);
});

test('accepted Graph response is only ACCEPTED, never DELIVERED; validates recipient correlation',()=>{
 const receipt={messaging_product:'whatsapp',contacts:[{wa_id:'263771234567',input:'263771234567'}],messages:[{id:'wamid.HBgLPASSED'}]};
 const result=classifyMetaSendOutcome({httpStatus:200,response:receipt,expectedRecipient:'263771234567'});
 assert.deepEqual(result,{status:'ACCEPTED',providerMessageId:'wamid.HBgLPASSED',automaticRetry:false});
 assert.equal(classifyMetaSendOutcome({httpStatus:200,response:{...receipt,contacts:[{wa_id:'263779999999'}]},expectedRecipient:'263771234567'}).status,'UNKNOWN');
});

test('4xx and transport uncertainty are not treated as delivery; no blind retry',()=>{
 assert.deepEqual(classifyMetaSendOutcome({httpStatus:400,response:{error:{code:131047}},expectedRecipient:'263771234567'}),
  {status:'REJECTED',providerMessageId:null,automaticRetry:false,providerCode:131047});
 assert.deepEqual(classifyMetaSendOutcome({httpStatus:200,response:{messages:[]},expectedRecipient:'263771234567'}),
  {status:'UNKNOWN',providerMessageId:null,automaticRetry:false});
 assert.deepEqual(classifyMetaSendOutcome({httpStatus:500,response:{},expectedRecipient:'263771234567'}),
  {status:'UNKNOWN',providerMessageId:null,automaticRetry:false});
 assert.deepEqual(classifyMetaSendOutcome({httpStatus:null,response:null,expectedRecipient:'263771234567'}),
  {status:'UNKNOWN',providerMessageId:null,automaticRetry:false});
});

test('invalid receipt context cannot be classified as accepted',()=>{
 assert.throws(()=>classifyMetaSendOutcome({httpStatus:200,response:{},expectedRecipient:'+'}),/INVALID_META_RECEIPT_CONTEXT/);
});

test('Meta padded and base64 message ids survive acceptance without normalization',()=>{
 // Meta webhook reference, retrieved 24 October 2026, contains trailing '='.
 for(const id of ['wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=','wamid.SYNTHETIC+/==']){
  const response={messaging_product:'whatsapp',contacts:[{wa_id:opt.recipientWaId}],messages:[{id}]};
  assert.deepEqual(classifyMetaSendOutcome({httpStatus:200,response,expectedRecipient:opt.recipientWaId}),{status:'ACCEPTED',providerMessageId:id,automaticRetry:false});
 }
});

test('malformed, oversized and uncorrelated padded receipts remain UNKNOWN',()=>{
 for(const id of ['wamid.','wamid.BAD=INNER','wamid.BAD===','wamid.BAD\n','wamid.'+'a'.repeat(181),'wamid.<script>']){
  const response={messaging_product:'whatsapp',contacts:[{wa_id:opt.recipientWaId}],messages:[{id}]};
  assert.equal(classifyMetaSendOutcome({httpStatus:200,response,expectedRecipient:opt.recipientWaId}).status,'UNKNOWN');
 }
 const response={messaging_product:'whatsapp',contacts:[{wa_id:'263779999999'}],messages:[{id:'wamid.SYNTHETIC='}]};
 assert.equal(classifyMetaSendOutcome({httpStatus:200,response,expectedRecipient:opt.recipientWaId}).status,'UNKNOWN');
});
