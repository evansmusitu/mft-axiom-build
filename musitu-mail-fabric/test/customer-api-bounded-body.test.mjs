import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {createWorker} from '../src/edge/worker.mjs';
import {createSimulatedProvider} from '../src/providers.mjs';
import {generateDemonstrationKeys} from '../src/evidence.mjs';

const secret='synthetic-private-customer-api-token-0123456789abcdef';
function fixture(t){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 t.after(()=>db.close());
 const keys=generateDemonstrationKeys();
 const env={
  MMF_DB:createD1Compat(db),MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',
  MMF_API_ENABLED:'true',MMF_REAL_SEND_ENABLED:'false',MMF_AUTH_TOKEN:secret,
  MMF_ENCRYPTION_KEY_B64:randomBytes(32).toString('base64'),
  MMF_PRIVACY_KEY_B64:randomBytes(32).toString('base64'),
  MMF_SIGNING_PRIVATE_KEY_PEM:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
  MMF_SIGNING_PUBLIC_KEY_PEM:keys.publicKey.export({type:'spki',format:'pem'}).toString()
 };
 return {db,env,worker:createWorker({providerFactory:()=>createSimulatedProvider()})};
}
const post=(body,headers={},options={})=>new Request('https://private.invalid/v1/messages',{
 method:'POST',headers:{authorization:'Bearer '+secret,...headers},body,...options
});
test('authorized customer API rejects huge declared JSON length before streaming or storing any data',async t=>{
 const f=fixture(t);let pulls=0;
 const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(4096));controller.close();}},{highWaterMark:0});
 const response=await f.worker.fetch(post(stream,{'content-length':'12345678','content-type':'application/json'},{duplex:'half'}),f.env);
 assert.equal(response.status,413);assert.equal((await response.json()).error,'PAYLOAD_TOO_LARGE');
 assert.ok(pulls<=1,'must reject declared over-limit size before reading');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mail_messages').get().n,0);
});
test('authorized customer API stops reading long chunked request at 30KiB and preserves zero messages',async t=>{
 const f=fixture(t);let pulls=0;
 const stream=new ReadableStream({pull(controller){
  pulls++;controller.enqueue(new Uint8Array(8192).fill(65));
  if(pulls>=50)controller.close();
 }},{highWaterMark:0});
 const response=await f.worker.fetch(post(stream,{'content-type':'application/json'},{duplex:'half'}),f.env);
 assert.equal(response.status,413);assert.equal((await response.json()).error,'PAYLOAD_TOO_LARGE');
 assert.ok(pulls<=4,'30KiB cap should stop after four 8192-byte chunks; got '+pulls);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mail_messages').get().n,0);
});
test('invalid UTF8 is rejected on customer API rather than silently replaced',async t=>{
 const f=fixture(t);
 const res=await f.worker.fetch(post(new Uint8Array([0xff,0xfe,0x7b,0x7d]),{'content-type':'application/json'}),f.env);
 assert.equal(res.status,400);
 assert.equal((await res.json()).error,'INVALID_UTF8');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mail_messages').get().n,0);
});
test('legacy authenticated small JSON requests retain API behavior without requiring a new MIME header',async t=>{
 const f=fixture(t);
 const payload={from:'alerts@example.org',to:'recipient@example.net',subject:'Test',text:'Private synthetic notice',kind:'ACCOUNT',idempotencyKey:'bounded-post-compat-1234'};
 const response=await f.worker.fetch(post(JSON.stringify(payload)),f.env);
 assert.equal(response.status,202);
 assert.equal((await response.json()).state,'QUEUED');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mail_messages').get().n,1);
});
