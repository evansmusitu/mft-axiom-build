import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../src/edge/worker.mjs';
import ingress from '../src/edge/webhook-only.mjs';

const base={MMF_WEBHOOK_ENABLED:'true',MMF_API_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false',
 MMF_WEBHOOK_SECRET:'whsec_'+Buffer.alloc(32,42).toString('base64')};
const request=(body,headers={})=>new Request('https://isolated.invalid/v1/webhooks/resend',{
 method:'POST',headers:{'content-type':'application/json',...headers},body});

test('separated production ingress rejects unlinked receipt database instead of misattributing events',async()=>{
 const env={...base,MMF_RECEIPTS:{idFromName:n=>n,get:()=>({fetch:async()=>Response.json({success:true,rows:[],changes:0})})},
 MMF_STORAGE_RPC_SECRET:'private-stage-rpc-0123456789abcdef'};
 const r=await ingress.fetch(request('{}'),env);
 assert.equal(r.status,503);
 assert.deepEqual(await r.json(),{error:'SERVICE_UNAVAILABLE'});
});
test('ingress must not mistake its own receipts namespace for a linked outbox',async()=>{
 const ns={idFromName:n=>n,get:()=>({fetch:async()=>Response.json({success:true,rows:[],changes:0})})};
 const env={...base,MMF_RECEIPTS:ns,MMF_OUTBOX:ns,MMF_OUTBOX_LINK_ENABLED:'true',
 MMF_OUTBOX_RPC_SECRET:'test-only-long-outbox-secret-0123456789'};
 const response=await ingress.fetch(request('{}'),env);
 assert.equal(response.status,503);
});
test('refuses webhooks without JSON content-type before any parsing or storage',async()=>{
 const r=await createWorker().fetch(request('{}',{'content-type':'text/plain'}),base);
 assert.equal(r.status,415);assert.equal((await r.json()).error,'UNSUPPORTED_MEDIA_TYPE');
});
test('rejects declared oversized signed payload without reading input stream',async()=>{
 let pulls=0;
 const input=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(100));controller.close();}});
 const req=new Request('https://isolated.invalid/v1/webhooks/resend',{method:'POST',
  headers:{'content-type':'application/json','content-length':'70000'},body:input,duplex:'half'});
 const r=await createWorker().fetch(req,base);
 assert.equal(r.status,413);assert.equal(pulls<=1,true);
});
test('rejects chunked payload over 64KiB without persisting any provider feedback',async()=>{
 let parts=0;
 const stream=new ReadableStream({pull(controller){
  parts++;controller.enqueue(new Uint8Array(10240));
  if(parts>=7)controller.close();
 }});
 const req=new Request('https://isolated.invalid/v1/webhooks/resend',{method:'POST',
  headers:{'content-type':'application/json'},body:stream,duplex:'half'});
 const r=await createWorker().fetch(req,base);
 assert.equal(r.status,413);
 assert.equal((await r.json()).error,'PAYLOAD_TOO_LARGE');
});
test('invalid UTF8 in otherwise short signed webhook is rejected before JSON or signature operations',async()=>{
 const r=await createWorker().fetch(new Request('https://isolated.invalid/v1/webhooks/resend',{
  method:'POST',headers:{'content-type':'application/json'},
  body:new Uint8Array([0xff,0xfe])}),base);
 assert.equal(r.status,400);assert.equal((await r.json()).error,'INVALID_UTF8');
});
