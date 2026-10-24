import test from 'node:test';import assert from 'node:assert/strict';
import {readMetaWabaSubscription} from '../scripts/read-meta-waba-subscription.mjs';
const token='EAA'+'x'.repeat(50),PHONE='1292923853915392',APP='1096094346481018';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
function client(second){const calls=[];return {calls,request:async(url,options)=>{calls.push({url,options});return response(calls.length===1?{data:[{id:PHONE}]}:second);}};}
test('two fixed GET destinations detect missing app without exposing provider data',async()=>{
 const c=client({data:[{whatsapp_business_api_data:{id:'12345',name:token}}]});const r=await readMetaWabaSubscription({token,request:c.request});
 assert.equal(r.status,'APP_NOT_SUBSCRIBED');assert.equal(r.appSubscribed,false);assert.equal(r.otherAppsPresent,true);assert.equal(c.calls.length,2);
 assert.deepEqual(c.calls.map(c=>c.url),['https://graph.facebook.com/v25.0/1955690452095441/phone_numbers?fields=id','https://graph.facebook.com/v25.0/1955690452095441/subscribed_apps?limit=50']);
 for(const c0 of c.calls){assert.equal(c0.options.method,'GET');assert.equal(c0.options.redirect,'error');assert.equal(c0.options.headers.authorization,'Bearer '+token);assert.ok(c0.options.signal);}
 assert.equal(JSON.stringify(r).includes(token),false);assert.equal(JSON.stringify(r).includes('12345'),false);
});
test('positive result requires exact app ID',async()=>{const c=client({data:[{whatsapp_business_api_data:{id:APP}}]});assert.equal((await readMetaWabaSubscription({token,request:c.request})).status,'APP_SUBSCRIBED');});
test('incomplete pages and malformed rows cannot establish absence or follow pagination',async()=>{
 for(const [body,status]of[[{data:[],paging:{next:'https://untrusted.example/'+token}},'SUBSCRIPTION_INCOMPLETE_PAGE'],[{data:[{id:APP}]},'SUBSCRIPTION_SHAPE_UNQUALIFIED']]){const c=client(body);const r=await readMetaWabaSubscription({token,request:c.request});assert.equal(r.status,status);assert.equal(c.calls.length,2);assert.equal(JSON.stringify(r).includes(token),false);}
});
test('wrong phone or denied grant stops before subscription read without raw errors',async()=>{
 for(const [body,status]of[[{data:[{id:'wrong'}]},200],[{error:{code:190,error_subcode:463,message:token}},400]]){let calls=0;const r=await readMetaWabaSubscription({token,request:async()=>{calls++;return response(body,status);}});assert.equal(calls,1);assert.notEqual(r.status,'APP_SUBSCRIBED');assert.equal(JSON.stringify(r).includes(token),false);}
});
test('oversized, malformed and transport failures are sanitized without retries',async()=>{
 for(const [work,code]of[[()=>new Response('x'.repeat(16385)),'META_BODY_TOO_LARGE'],[()=>new Response('{'),'META_JSON_REQUIRED'],[()=>{throw Error(token)},'META_TRANSPORT_FAILED']]){let calls=0;await assert.rejects(readMetaWabaSubscription({token,request:async()=>{calls++;return work();}}),e=>e.message===code&&!e.message.includes(token));assert.equal(calls,1);}
});
