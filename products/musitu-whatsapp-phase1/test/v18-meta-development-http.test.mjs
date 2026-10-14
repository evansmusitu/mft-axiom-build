import test from 'node:test';import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createDevelopmentMetaHandler} from '../src/adapters/meta-development-http.mjs';
import {verifyMetaSignature} from '../src/core/channel.mjs';
const secret='synthetic-development-app-secret',token='synthetic-verification-token-32-characters';
const sign=raw=>'sha256='+createHmac('sha256',secret).update(raw).digest('hex');
const post=(body,headers={})=>new Request('https://callback.example.invalid/api/meta/webhook',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':sign(body),...headers},body});
const handler=(ingest,options={})=>createDevelopmentMetaHandler({getIngress:()=>({ingest}),getVerifyToken:()=>token,...options});
test('development verification is exact and requires complete configuration and a strong token',async()=>{
 const h=handler(async()=>{}),query=new URLSearchParams({'hub.mode':'subscribe','hub.verify_token':token,'hub.challenge':'12345'});
 let r=await h(new Request('https://callback.example.invalid/?'+query));assert.equal(r.status,200);assert.equal(await r.text(),'12345');assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal((await h(new Request('https://callback.example.invalid/?'+query+'&hub.challenge=2'))).status,400);
 query.set('hub.verify_token','wrong');assert.equal((await h(new Request('https://callback.example.invalid/?'+query))).status,403);
 assert.equal((await handler(async()=>{},{getIngress:()=>{throw Error('NOT_CONFIGURED');}})(new Request('https://callback.example.invalid/?'+query))).status,503);
 assert.equal((await handler(async()=>{},{getVerifyToken:()=>''})(new Request('https://callback.example.invalid/?'+query))).status,503);
});
test('streamed oversize with a misleading Content-Length returns 413 before any ingestion',async()=>{
 let calls=0;const raw='x'.repeat(200),h=handler(async()=>{calls++;},{maxBytes:100});
 assert.equal((await h(post(raw,{'content-length':'10'}))).status,413);assert.equal(calls,0);
});
test('a stalled callback body returns 408 without contacting persistence',async()=>{
 let calls=0;const h=handler(async()=>{calls++;},{bodyTimeoutMs:20});
 const req=new Request('https://callback.example.invalid',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':sign('')},body:new ReadableStream({start(){}}),duplex:'half'});
 assert.equal((await h(req)).status,408);assert.equal(calls,0);
});
test('acknowledgement waits for admission and preserves exact signed bytes; forged signatures are denied',async()=>{
 const raw=Buffer.from('{ "synthetic" : true }');let release,called=0;
 const h=handler(async args=>{assert.deepEqual(args.rawBody,raw);if(!verifyMetaSignature(args.rawBody,args.signature,secret))throw Error('INVALID_META_SIGNATURE');called++;await new Promise(r=>{release=r;});});
 let finished=false;const pending=h(post(raw)).then(r=>{finished=true;return r;});
 for(let i=0;!release&&i<10;i++)await new Promise(r=>setImmediate(r));
 assert.equal(called,1);assert.equal(finished,false);release();assert.equal((await pending).status,200);
 assert.equal((await h(post(raw,{'x-hub-signature-256':'sha256='+'f'.repeat(64)}))).status,401);
});
test('uncertain persistence returns retryable 503 and does not report delivery or automatically retry',async()=>{
 let calls=0;const h=handler(async()=>{calls++;await new Promise(()=>{});},{persistenceTimeoutMs:20});
 const r=await h(post('{}'));assert.equal(r.status,503);assert.equal(calls,1);assert.match(await r.text(),/UNAVAILABLE/);
});
test('unsupported methods/media and disallowed development recipients are refused',async()=>{
 const h=handler(async()=>{throw Error('DEVELOPMENT_RECIPIENT_NOT_ALLOWED');});
 assert.equal((await h(new Request('https://callback.example.invalid',{method:'DELETE'}))).status,405);
 assert.equal((await h(post('{}',{'content-type':'text/plain'}))).status,415);
 assert.equal((await h(post('{}',{'x-hub-signature-256':''}))).status,401);
 assert.equal((await h(post('{}'))).status,422);
});
