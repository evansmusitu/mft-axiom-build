import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseDevelopmentReply} from '../scripts/diagnose-development-reply.mjs';
const env={META_DEVELOPMENT_SEND_ENABLED:'YES',CONTENT_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('base64'),META_DEVELOPMENT_RECIPIENT_SHA256:'a'.repeat(64),META_ACCESS_TOKEN:'EAA'+'B'.repeat(40)};
test('sender preflight reaches a hard database boundary with GETs only and no credential disclosure',async()=>{
 const calls=[];const result=await diagnoseDevelopmentReply({env,request:async(url,o)=>{calls.push(o.method);return Response.json(url.endsWith('app?fields=id')?{id:'1096094346481018'}:{data:[{id:'1292923853915392'}]});}});
 assert.deepEqual(calls,['GET','GET']);assert.equal(result.preflightPassed,true);assert.equal(result.noSendAttempted,true);assert.equal(result.consentRecorded,false);assert.equal(result.identityQualified,false);assert.equal(result.databaseQualified,false);
 for(const secret of Object.values(env).filter(x=>x.length>30))assert.equal(JSON.stringify(result).includes(secret),false);
});
test('sender preflight identifies missing configuration and wrong app without reaching writes',async()=>{
 const missing=await diagnoseDevelopmentReply({env:{...env,META_DEVELOPMENT_SEND_ENABLED:'NO'},request:()=>assert.fail('Disabled sender must not contact Meta')});
 assert.equal(missing.result,'DEVELOPMENT_SENDING_DISABLED');assert.equal(missing.configuration.enabled,false);
 const wrong=await diagnoseDevelopmentReply({env,request:async()=>Response.json({id:'different'})});
 assert.equal(wrong.result,'META_APP_ID_REJECTED');assert.equal(wrong.operations.length,1);assert.equal(wrong.noSendAttempted,true);
});
test('sender preflight reports only bounded numeric provider error metadata',async()=>{
 const calls=[];const result=await diagnoseDevelopmentReply({env,request:async(url,o)=>{
  calls.push(o.method);return url.endsWith('app?fields=id')?Response.json({id:'1096094346481018'}):Response.json({error:{code:100,error_subcode:33,is_transient:false,message:env.META_ACCESS_TOKEN,type:env.META_ACCESS_TOKEN,fbtrace_id:env.META_ACCESS_TOKEN,error_data:{secret:env.CONTENT_ENCRYPTION_KEY}}},{status:400});
 }});
 assert.deepEqual(calls,['GET','GET']);assert.equal(result.result,'META_TEST_PHONE_REJECTED');
 assert.deepEqual(result.operations[1],{operation:'TEST_PHONE',httpStatus:400,providerErrorCode:100,providerErrorSubcode:33,providerErrorTransient:false});
 for(const secret of Object.values(env).filter(x=>x.length>30))assert.equal(JSON.stringify(result).includes(secret),false);
 assert.equal(result.noSendAttempted,true);assert.equal(result.consentRecorded,false);
});
test('sender preflight omits malformed or oversized provider error metadata',async()=>{
 for(const error of [{code:env.META_ACCESS_TOKEN,error_subcode:-1,is_transient:env.CONTENT_ENCRYPTION_KEY},{code:2147483648,error_subcode:1.5,message:'x'.repeat(17000)}]){
  const result=await diagnoseDevelopmentReply({env,request:async url=>url.endsWith('app?fields=id')?Response.json({id:'1096094346481018'}):Response.json({error},{status:400,headers:{'content-type':'application/json; charset=UTF-8'}})});
  assert.deepEqual(result.operations[1],{operation:'TEST_PHONE',httpStatus:400});assert.equal(result.preflightPassed,false);assert.equal(result.noSendAttempted,true);
  for(const secret of Object.values(env).filter(x=>x.length>30))assert.equal(JSON.stringify(result).includes(secret),false);
 }
});
test('sender preflight bounds a stalled error stream without writing or disclosing its body',async()=>{
 const result=await diagnoseDevelopmentReply({env,request:async url=>url.endsWith('app?fields=id')?Response.json({id:'1096094346481018'}):new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"error":'));},cancel(){}}),{status:400,headers:{'content-type':'application/json'}})});
 assert.deepEqual(result.operations[1],{operation:'TEST_PHONE',httpStatus:400});assert.equal(result.preflightPassed,false);assert.equal(result.noSendAttempted,true);assert.equal(result.consentRecorded,false);
});
