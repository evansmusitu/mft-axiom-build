import test from 'node:test';
import assert from 'node:assert/strict';
import {readBoundedUtf8} from './bounded_body.mjs';

function streamed(chunks,headers={}){
  let produced=0,cancelled=false;
  const body=new ReadableStream({
    pull(controller){
      const chunk=chunks[produced++];
      if(chunk===undefined)controller.close();
      else controller.enqueue(chunk);
    },
    cancel(){cancelled=true;}
  });
  const request=new Request('https://lifeline.invalid/agent/pull',{
    method:'POST',duplex:'half',headers,body
  });
  return {request,getProduced:()=>produced,getCancelled:()=>cancelled};
}

test('64 KiB boundary is accepted without reserialization',async()=>{
  const sample=new TextEncoder().encode('é'.repeat(32768));
  const input=streamed([sample]);
  const res=await readBoundedUtf8(input.request);
  assert.equal(res.status,'ok');
  assert.equal(res.text,'é'.repeat(32768));
});

test('stream exceeding 64 KiB is canceled before producer exhaustion',async()=>{
  const many=Array.from({length:500},()=>new Uint8Array(1024));
  const input=streamed(many);
  const res=await readBoundedUtf8(input.request);
  assert.equal(res.status,'oversized');
  assert.equal(input.getCancelled(),true);
  assert.ok(input.getProduced()<100,'should not consume 500 chunks');
});

test('single overlarge chunk fails without storing buffer',async()=>{
  const input=streamed([new Uint8Array(100000)]);
  assert.equal((await readBoundedUtf8(input.request)).status,'oversized');
  assert.equal(input.getCancelled(),true);
});

test('declared oversized or malformed Content-Length fails without reading',async()=>{
  for(const length of ['65537','-1','100e3','abc','9999999999999999999999999']){
    const input=streamed([new Uint8Array(1)],{'content-length':length});
    assert.equal((await readBoundedUtf8(input.request)).status,'oversized');
    assert.ok(input.getProduced()<=1);
  }
});

test('fatal UTF-8 decode rejects malformed request body',async()=>{
  const input=streamed([Uint8Array.from([0xc3,0x28])]);
  const result=await readBoundedUtf8(input.request);
  assert.equal(result.status,'invalid');
});
