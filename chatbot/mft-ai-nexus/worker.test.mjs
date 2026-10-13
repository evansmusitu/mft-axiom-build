import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{answer,signed,smartAnswer} from './worker.mjs';
const request=(path,init)=>worker.fetch(new Request('https://mft.example'+path,init));
test('welcome menu contains MFT watermark and WhatsApp',()=>{assert.match(answer('Hi'),/MFT EDUCATION NEXUS/);assert.match(answer('Hi'),/0781572008/);});
test('prediction contains no guarantee',()=>assert.match(answer('2'),/not guaranteed/));
test('price response does not invent amounts',()=>assert.match(answer('price'),/does not collect payments or invent prices/));
test('notes enquiry supported',()=>assert.match(answer('1'),/A-Level subject/));
test('landing page works',async()=>{const r=await request('/');assert.equal(r.status,200);assert.match(await r.text(),/MFT EDUCATION NEXUS/);});
test('web chat works',async()=>{const r=await request('/api/chat',{method:'POST',body:JSON.stringify({message:'Hi'})});assert.equal(r.status,200);assert.match((await r.json()).reply,/A-Level Study Notes/);});
test('tutoring is disabled',async()=>{const r=await request('/api/chat',{method:'POST',body:JSON.stringify({message:'physics',mode:'tutor'})});assert.match((await r.json()).reply,/not publicly enabled/);});
test('health hides credentials',async()=>{const r=await worker.fetch(new Request('https://mft.example/health'),{WHATSAPP_ACCESS_TOKEN:'test_sensitive'});assert.doesNotMatch(await r.text(),/test_sensitive/);});
test('webhook rejects unsigned request',async()=>{const r=await request('/webhook',{method:'POST',body:'{}'});assert.equal(r.status,401);});
test('verification secret required',async()=>{const r=await request('/webhook?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=123');assert.equal(r.status,403);});
test('HMAC verifies exact payload',async()=>{const raw='{"test":true}';const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw)));const digest=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');assert.equal(await signed(raw,'sha256='+digest,'secret'),true);assert.equal(await signed(raw+'x','sha256='+digest,'secret'),false);});
test('broken JSON returns 400',async()=>{const r=await request('/api/chat',{method:'POST',body:'{'});assert.equal(r.status,400);});

test('AI uses a one-call budget grant for MFT business enquiry',async()=>{
  let calls=0;
  const env={ENABLE_BUSINESS_AI:'true',AI:{run:async()=>{calls++;return {choices:[{message:{content:'Please tell us your subject and class level, then contact our staff.'}}]};}},AI_BUDGET:{idFromName:()=>({id:'x'}),get:()=>({fetch:async()=>new Response(JSON.stringify({allowed:true}),{status:200})})}};
  const out=await smartAnswer('I am Upper Six and I need Chemistry notes',env);
  assert.equal(calls,1);
  assert.match(out,/0781572008/);
});
test('AI quota exhaustion falls back to deterministic support',async()=>{
  let calls=0;
  const env={ENABLE_BUSINESS_AI:'true',AI:{run:async()=>{calls++;return {}; }},AI_BUDGET:{idFromName:()=>({id:'x'}),get:()=>({fetch:async()=>new Response(JSON.stringify({allowed:false}),{status:200})})}};
  const out=await smartAnswer('I am Upper Six and I need Chemistry notes',env);
  assert.equal(calls,0);
  assert.match(out,/MFT EDUCATION NEXUS/);
});
test('payments never consume free AI quota',async()=>{
  let calls=0;
  const env={ENABLE_BUSINESS_AI:'true',AI:{run:async()=>{calls++;return {}; }},AI_BUDGET:{idFromName:()=>({id:'x'}),get:()=>({fetch:async()=>{calls++;return new Response(JSON.stringify({allowed:true}),{status:200});}})}};
  const out=await smartAnswer('What is the price of your notes?',env);
  assert.equal(calls,0);
  assert.match(out,/does not collect payments/);
});
