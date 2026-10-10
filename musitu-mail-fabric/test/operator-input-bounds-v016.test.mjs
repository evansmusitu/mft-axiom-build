import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../src/edge/worker.mjs';
const token='private-operator-parsing-token-0123456789abcdef';
const common={MMF_OPERATOR_TOKEN:token,MMF_AUTH_TOKEN:'other-customer-token-0123456789abcdef',
 MMF_API_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false',MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',
 MMF_SUPPRESSION_API_ENABLED:'true',MMF_SENDER_REVOKE_API_ENABLED:'true'};
function post(path,body,headers={}){
 return new Request('https://private.invalid'+path,{method:'POST',
  headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},body});
}
const paths=['/v1/operator/suppressions','/v1/operator/senders/revoke'];
test('operator endpoints reject invalid declared lengths before parsing or any database access',async()=>{
 const worker=createWorker();
 for(const path of paths){
  const request=post(path,'{}',{'content-length':'not-a-number'});
  const r=await worker.fetch(request,common);
  assert.equal(r.status,400,path);
  assert.equal((await r.json()).error,'INVALID_CONTENT_LENGTH');
 }
});
test('operator endpoints reject malformed UTF8 before treating replacement characters as request data',async()=>{
 const worker=createWorker();
 for(const path of paths){
  const request=post(path,new Uint8Array([0xff,0xfe,0x7b,0x7d]));
  const r=await worker.fetch(request,common);
  assert.equal(r.status,400,path);
  assert.equal((await r.json()).error,'INVALID_UTF8');
 }
});
test('operator endpoints accept no over-limit streamed body even when content length omitted',async()=>{
 const worker=createWorker();
 for(const [path,limit] of [[paths[0],1024],[paths[1],300]]){
  let pulls=0;
  const stream=new ReadableStream({pull(controller){
   pulls++;controller.enqueue(new Uint8Array(200).fill(65));
   if(pulls>=25)controller.close();
  }},{highWaterMark:0});
  const request=new Request('https://private.invalid'+path,{method:'POST',
   headers:{authorization:'Bearer '+token,'content-type':'application/json'},
   body:stream,duplex:'half'});
  const result=await worker.fetch(request,common);
  assert.equal(result.status,413,path);
  assert.equal((await result.json()).error,'PAYLOAD_TOO_LARGE');
  assert.ok(pulls<=Math.ceil(limit/200)+1,'stream aborted at configured cap for '+path);
 }
});
