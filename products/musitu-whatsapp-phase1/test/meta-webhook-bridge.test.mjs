import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createMetaWebhookBridge} from '../src/adapters/meta-webhook-bridge.mjs';

const SECRET='isolated-meta-app-secret-not-production';
const TOKEN='private-Meta-verify-token';
const sign=body=>'sha256='+createHmac('sha256',SECRET).update(body).digest('hex');
async function stage(ingestor={ingest:async()=>[{status:'STORED'}]}){
 const app=createMetaWebhookBridge({appSecret:SECRET,verifyToken:TOKEN,ingestor});
 const base=await app.start();
 return {base,app};
}
async function get(base,query){return fetch(base+'/webhook?'+query,{redirect:'manual'});}
const q=(challenge='12345',token=TOKEN)=>new URLSearchParams({'hub.mode':'subscribe','hub.verify_token':token,'hub.challenge':challenge});

test('Meta GET challenge returns exactly challenge for matching token and noncacheable text',async t=>{
 const {base,app}=await stage();t.after(()=>app.stop());
 const response=await get(base,q());
 assert.equal(response.status,200);assert.equal(await response.text(),'12345');
 assert.match(response.headers.get('content-type'),/^text\/plain/);assert.equal(response.headers.get('cache-control'),'no-store');
});

test('Meta GET verification rejects wrong token, repeated query keys and control-bearing challenge',async t=>{
 const {base,app}=await stage();t.after(()=>app.stop());
 assert.equal((await get(base,q('12345','wrong-token'))).status,403);
 assert.equal((await get(base,q().toString()+'&hub.challenge=54321')).status,400);
 assert.equal((await get(base,q('invalid%0Aheader'))).status,400);
 assert.equal((await get(base,new URLSearchParams({'hub.mode':'unsubscribe','hub.verify_token':TOKEN,'hub.challenge':'1'}))).status,403);
});

test('signed POST dispatches unmodified raw bytes once and acknowledges only after commit',async t=>{
 const calls=[];
 const {base,app}=await stage({ingest:async args=>{calls.push(args);return [{status:'STORED'}];}});
 t.after(()=>app.stop());
 const raw=Buffer.from('{ "object": "whatsapp_business_account", "entry": [] }');
 const response=await fetch(base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':sign(raw)},body:raw});
 assert.equal(response.status,200);assert.equal(await response.text(),'EVENT_RECEIVED');
 assert.equal(calls.length,1);assert.deepEqual(calls[0].rawBody,raw);assert.equal(calls[0].signature,sign(raw));
});

test('unsigned, forged, malformed content type and too-large POSTs are rejected before ingestion',async t=>{
 let called=0;const {base,app}=await stage({ingest:async()=>{called++;return[];}});t.after(()=>app.stop());
 const raw=Buffer.from('{}');const post=(headers,body)=>fetch(base+'/webhook',{method:'POST',headers,body});
 assert.equal((await post({'content-type':'application/json'},raw)).status,401);
 assert.equal((await post({'content-type':'application/json','x-hub-signature-256':'sha256='+'f'.repeat(64)},raw)).status,401);
 assert.equal((await post({'content-type':'text/plain','x-hub-signature-256':sign(raw)},raw)).status,415);
 const large=Buffer.alloc(260*1024,120);
 assert.equal((await post({'content-type':'application/json','x-hub-signature-256':sign(large)},large)).status,413);
 assert.equal(called,0);
});

test('upstream rejection and uncertain persistence are not acknowledged as success',async t=>{
 const raw=Buffer.from('{}');
 const invalid=await stage({ingest:async()=>{throw Error('INVALID_META_WEBHOOK');}});t.after(()=>invalid.app.stop());
 const response=await fetch(invalid.base+'/webhook',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':sign(raw)},body:raw});
 assert.equal(response.status,422);
 const failed=await stage({ingest:async()=>{throw Error('PG_CONNECTION_LOST');}});t.after(()=>failed.app.stop());
 const failedResponse=await fetch(failed.base+'/webhook',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':sign(raw)},body:raw});
 assert.equal(failedResponse.status,503);
});

test('webhook bridge refuses invalid configuration and binds only loopback',async()=>{
 assert.throws(()=>createMetaWebhookBridge({appSecret:SECRET,verifyToken:TOKEN,ingestor:{}}),/META_WEBHOOK_BRIDGE_CONFIG/);
 assert.throws(()=>createMetaWebhookBridge({appSecret:SECRET,verifyToken:'',ingestor:{ingest:async()=>[]}}),/META_WEBHOOK_BRIDGE_CONFIG/);
 const {base,app}=await stage();try{assert.match(base,/^http:\/\/127\.0\.0\.1:/);}finally{await app.stop();}
});
