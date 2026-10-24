import test from 'node:test';import assert from 'node:assert/strict';
import {qualifyMetaDevelopmentToken} from '../scripts/qualify-meta-development.mjs';
const token='EAA'+'x'.repeat(50);
const replies=[{data:[{id:'1292923853915392'}]},{data:[{permission:'whatsapp_business_management',status:'granted'},{permission:'whatsapp_business_messaging',status:'granted'}]},{error:{code:200,message:'denied'}}];
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status});

test('Meta qualification permits only three pinned GET calls and sanitized results',async()=>{
 const calls=[];const result=await qualifyMetaDevelopmentToken({token,request:async(url,options)=>{calls.push({url,options});return respond(replies[calls.length-1],calls.length===3?400:200);}});
 assert.equal(result.pass,3);assert.equal(calls.length,3);
 for(const {url,options} of calls){assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer '+token);assert.equal(url.startsWith('https://graph.facebook.com/v25.0/'),true);assert.equal(url.includes(token),false);assert.ok(options.signal);}
 assert.equal(JSON.stringify(result).includes(token),false);assert.equal(JSON.stringify(result).includes('denied'),false);
});
test('Meta qualification stops when the expected test phone is not exclusively bound',async()=>{
 let calls=0;await assert.rejects(qualifyMetaDevelopmentToken({token,request:async()=>{calls++;return respond({data:[{id:'unexpected'}]});}}),/META_TEST_PHONE_BINDING_NOT_QUALIFIED/);assert.equal(calls,1);
});
test('Meta qualification rejects access to an excluded account and never logs its response',async()=>{
 let calls=0;await assert.rejects(qualifyMetaDevelopmentToken({token,request:async()=>{calls++;return respond(calls===3?{data:[{id:'private-id-not-to-log'}]}:replies[calls-1]);}}),/META_EXCLUDED_ACCOUNT_DENIAL_NOT_QUALIFIED/);assert.equal(calls,3);
});
test('Meta qualification refuses missing scopes, oversized payloads and transport errors without retries',async()=>{
 let calls=0;await assert.rejects(qualifyMetaDevelopmentToken({token,request:async()=>{calls++;return respond(calls===1?replies[0]:{data:[]});}}),/META_REQUIRED_SCOPES_NOT_QUALIFIED/);assert.equal(calls,2);
 calls=0;await assert.rejects(qualifyMetaDevelopmentToken({token,request:async()=>{calls++;return new Response('x'.repeat(16385));}}),/META_READ_BODY_TOO_LARGE/);assert.equal(calls,1);
 calls=0;await assert.rejects(qualifyMetaDevelopmentToken({token,request:async()=>{calls++;throw Error('unexpected secret '+token);}}),/META_READ_TRANSPORT_FAILED/);assert.equal(calls,1);
});
