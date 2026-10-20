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
