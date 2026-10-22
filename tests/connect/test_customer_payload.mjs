import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MAX_CUSTOMER_JSON_BYTES, readBoundedCustomerJson} from '../../connect/customer_payload.mjs';

const makeRequest=(body,headers={},method='POST')=>new Request(
  'https://isolated.example/api/mining/plan',
  {method,headers:{'content-type':'application/json',...headers},...(body===null?{}:{body})},
);
test('strict intake accepts ordinary UTF-8 JSON objects',async()=>{
  const result=await readBoundedCustomerJson(makeRequest('{"rows":[],"budget":4}'));
  assert.deepEqual(result,{ok:true,body:{rows:[],budget:4}});
});

test('accepts JSON object exactly at the 64-KiB encoded-byte cap',async()=>{
  const base='{"value":""}';
  const text='{"value":"'+ 'x'.repeat(MAX_CUSTOMER_JSON_BYTES-base.length) +'"}';
  assert.equal(Buffer.byteLength(text),MAX_CUSTOMER_JSON_BYTES);
  const result=await readBoundedCustomerJson(makeRequest(text));
  assert.equal(result.ok,true);
  assert.equal(result.body.value.length,MAX_CUSTOMER_JSON_BYTES-base.length);
});

test('enforces raw bytes, not JavaScript UTF-16 string length',async()=>{
  const text='{"value":"'+ '🚀'.repeat(17000) +'"}';
  assert.ok(text.length<MAX_CUSTOMER_JSON_BYTES);
  assert.ok(Buffer.byteLength(text)>MAX_CUSTOMER_JSON_BYTES);
  assert.deepEqual(await readBoundedCustomerJson(makeRequest(text)),
    {ok:false,status:413,error:'PAYLOAD_TOO_LARGE'});
});

test('rejects oversized declared content length before consuming body',async()=>{
  const text='{"value":2}';
  const response=await readBoundedCustomerJson(makeRequest(text,{'content-length':String(MAX_CUSTOMER_JSON_BYTES+1)}));
  assert.deepEqual(response,{ok:false,status:413,error:'PAYLOAD_TOO_LARGE'});
});

test('rejects declared size mismatch instead of trusting unverified headers',async()=>{
  assert.deepEqual(await readBoundedCustomerJson(makeRequest('{}',{'content-length':'3'})),
    {ok:false,status:400,error:'INVALID_CONTENT_LENGTH'});
  assert.deepEqual(await readBoundedCustomerJson(makeRequest('{}',{'content-length':'2, 2'})),
    {ok:false,status:400,error:'INVALID_CONTENT_LENGTH'});
});

test('enforces size on unannounced streamed chunks without buffering entire body',async()=>{
  const stream=new ReadableStream({start(controller){
    controller.enqueue(new TextEncoder().encode('{"a":"'));
    controller.enqueue(new Uint8Array(MAX_CUSTOMER_JSON_BYTES));
  }});
  const request=new Request('https://isolated.example/api/mining/plan',{
    method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half',
  });
  const output=await readBoundedCustomerJson(request);
  assert.deepEqual(output,{ok:false,status:413,error:'PAYLOAD_TOO_LARGE'});
  assert.equal('body' in output,false);
});

test('combines valid unannounced streamed chunks',async()=>{
  const stream=new ReadableStream({start(controller){
    controller.enqueue(new TextEncoder().encode('{"a":'));
    controller.enqueue(new TextEncoder().encode('3}'));
    controller.close();
  }});
  const request=new Request('https://isolated.example/api/mining/risk',{
    method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half',
  });
  assert.deepEqual(await readBoundedCustomerJson(request),{ok:true,body:{a:3}});
});

test('refuses unsupported content types and compressed transport encodings',async()=>{
  assert.deepEqual(await readBoundedCustomerJson(makeRequest('{}',{'content-type':'text/plain'})),
    {ok:false,status:415,error:'UNSUPPORTED_MEDIA_TYPE'});
  assert.deepEqual(await readBoundedCustomerJson(makeRequest('{}',{'content-encoding':'gzip'})),
    {ok:false,status:415,error:'UNSUPPORTED_CONTENT_ENCODING'});
  assert.deepEqual(await readBoundedCustomerJson(makeRequest('{}',{'content-type':'application/json, text/plain'})),
    {ok:false,status:415,error:'UNSUPPORTED_MEDIA_TYPE'});
});

test('refuses non-POST, malformed JSON, invalid UTF-8, arrays, and empty bodies',async()=>{
  assert.deepEqual(await readBoundedCustomerJson(makeRequest(null,{},'GET')),
    {ok:false,status:405,error:'METHOD_NOT_ALLOWED'});
  for (const body of ['{"x":','[]','null','23']) {
    assert.deepEqual(await readBoundedCustomerJson(makeRequest(body)),
      {ok:false,status:400,error:'INVALID_JSON'});
  }
  assert.deepEqual(await readBoundedCustomerJson(makeRequest(null)),
    {ok:false,status:400,error:'INVALID_JSON'});
  const invalidBytes=new Uint8Array([123,34,97,34,58,255,125]);
  assert.deepEqual(await readBoundedCustomerJson(makeRequest(invalidBytes)),
    {ok:false,status:400,error:'INVALID_JSON'});
});

test('accepts declared ordinary UTF-8 JSON content type with charset',async()=>{
  const body='{"valid":true}';
  assert.deepEqual(await readBoundedCustomerJson(makeRequest(body,{
    'content-type':'application/json; charset=utf-8',
    'content-length':String(Buffer.byteLength(body)),
  })),{ok:true,body:{valid:true}});
});

test('rejects ambiguous repeated keys at the top level, even with identical values',async()=>{
  for (const raw of ['{"tenant_id":"alpha","tenant_id":"beta"}',
                    '{"budget":4,"budget":4}']) {
    assert.deepEqual(await readBoundedCustomerJson(makeRequest(raw)),
      {ok:false,status:400,error:'DUPLICATE_JSON_KEY'});
  }
});

test('rejects duplicate keys nested inside Mining arrays and metadata',async()=>{
  for (const raw of ['{"rows":[{"hazard":"one","hazard":"two"}]}',
                    '{"details":{"flag":false,"nested":{"flag":1,"flag":2}}}']) {
    assert.deepEqual(await readBoundedCustomerJson(makeRequest(raw)),
      {ok:false,status:400,error:'DUPLICATE_JSON_KEY'});
  }
});

test('rejects semantically identical escaped JSON property names',async()=>{
  const raw=String.raw`{"\u0074enant_id":"alpha","tenant_id":"beta"}`;
  assert.deepEqual(await readBoundedCustomerJson(makeRequest(raw)),
    {ok:false,status:400,error:'DUPLICATE_JSON_KEY'});
});

test('allows same property names in distinct objects and JSON syntax within strings',async()=>{
  const raw=JSON.stringify({rows:[{hazard:'A',note:'{"x":1,"x":2}'},
                                 {hazard:'B',note:'escaped " braces {, } and [ ]'}]});
  const result=await readBoundedCustomerJson(makeRequest(raw));
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.body.rows[0].hazard,'A');
  assert.equal(result.body.rows[1].hazard,'B');
});
