import assert from 'node:assert/strict';
import test from 'node:test';
import {handleSupportRequest} from '../worker.js';

const caseId='AX-0123456789AB',code='01234567-89ABCDEF-GHJKMNPQ';

test('customer can bind an inbound email thread without storing raw email in route arguments',async()=>{
 const calls=[];const store={
  async bindCustomerEmailThread(id,recovery,input){calls.push([id,recovery,input]);return {case_id:id,thread_ref:input.thread_ref};}
 };
 const env={ENVIRONMENT:'test',SUPPORT_STORE:store};
 const r=await handleSupportRequest(new Request('https://support.example/api/v1/cases/'+caseId+'/email-thread',{method:'POST',headers:{authorization:'Support '+code,'content-type':'application/json'},body:JSON.stringify({email:'Customer@Example.Test'})}),env);
 assert.equal(r.status,201);const b=await r.json();
 assert.match(b.reply_address,/^reply\+[a-z0-9]{16}@mftintelligence\.com$/);
 assert.equal(calls.length,1);assert.match(calls[0][2].address_hash,/^[a-f0-9]{64}$/);assert.match(calls[0][2].provider_thread_hash,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(calls[0]).includes('Customer@Example.Test'),false);assert.equal(JSON.stringify(calls[0]).includes('customer@example.test'),false);
});

test('email binding validates address and requires recovery authorization',async()=>{
 const store={async bindCustomerEmailThread(){throw new Error('must not be called')}};
 const noAuth=await handleSupportRequest(new Request('https://support.example/api/v1/cases/'+caseId+'/email-thread',{method:'POST',headers:{'content-type':'application/json'},body:'{"email":"a@example.test"}'}),{ENVIRONMENT:'test',SUPPORT_STORE:store});
 assert.equal(noAuth.status,401);
 const bad=await handleSupportRequest(new Request('https://support.example/api/v1/cases/'+caseId+'/email-thread',{method:'POST',headers:{authorization:'Support '+code,'content-type':'application/json'},body:'{"email":"not-an-email"}'}),{ENVIRONMENT:'test',SUPPORT_STORE:store});
 assert.equal(bad.status,400);
});

test('production Worker email handler hashes sender, appends authorized thread, and rejects unmatched recipients',async()=>{
 const calls=[];const store={async appendInboundEmailByThread(thread,input){calls.push([thread,input]);return {case_id:caseId};}};
 const env={ENVIRONMENT:'test',SUPPORT_STORE:store};
 const good={to:'reply+abc12345def67890@mftintelligence.com',from:'customer@example.test',raw:new Blob(['Subject: Re\r\n\r\nhello']).stream(),reject(){throw new Error('must not reject')}};
 const result=await (await import('../worker.js')).default.email(good,env);
 assert.equal(result.accepted,true);assert.equal(calls.length,1);assert.equal(calls[0][0],'thread:abc12345def67890');assert.match(calls[0][1].sender_hash,/^[a-f0-9]{64}$/);assert.equal('sender_email' in calls[0][1],false);
 let rejected='';const bad={to:'unknown@mftintelligence.com',from:'customer@example.test',raw:new Blob(['x']).stream(),reject(reason){rejected=String(reason||'')}};
 const denied=await (await import('../worker.js')).default.email(bad,env);assert.equal(denied.accepted,false);assert.match(rejected,/not recognized/i);
});

test('D1 store exposes recovery-authenticated email-thread binding',async()=>{
 const {D1CaseStore}=await import('../d1_case_store.js');assert.equal(typeof D1CaseStore.prototype.bindCustomerEmailThread,'function');
});
