import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createMetaWebhookBridge} from '../src/adapters/meta-webhook-bridge.mjs';
test('provider receives a retryable 503 when authorized persistence never returns',async t=>{
 const secret='private-qualification-persistence-deadline',token='verify-deadline-private';
 const app=createMetaWebhookBridge({appSecret:secret,verifyToken:token,maxPersistenceMs:150,ingestor:{ingest:async()=>new Promise(()=>{})}});
 const base=await app.start();t.after(()=>app.stop());
 const raw=Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
 const sig='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
 const response=await fetch(base+'/webhook',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':sig},body:raw,signal:AbortSignal.timeout(1000)});
 assert.equal(response.status,503);assert.equal(await response.text(),'PERSISTENCE_UNAVAILABLE');
});
