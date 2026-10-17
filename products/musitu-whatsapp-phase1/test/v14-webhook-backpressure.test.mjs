import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {createMetaWebhookBridge} from '../src/adapters/meta-webhook-bridge.mjs';
const SECRET='v14-not-production-very-private',TOKEN='v14-not-production-verification';
function pendingPost(base,headers,waitMs=700,payload=null){
 return new Promise((resolve,reject)=>{
  const endpoint=new URL(base+'/webhook');let settled=false;
  const req=request({hostname:endpoint.hostname,port:endpoint.port,path:endpoint.pathname,method:'POST',headers});
  const guard=setTimeout(()=>{if(settled)return;settled=true;req.destroy();reject(Error('WEBHOOK_BODY_READ_UNBOUNDED'));},waitMs);
  req.on('response',res=>{
   res.resume();res.on('end',()=>{if(settled)return;settled=true;clearTimeout(guard);resolve(res.statusCode);req.destroy();});
  });
  req.on('error',e=>{if(settled)return;settled=true;clearTimeout(guard);reject(e);});
  req.flushHeaders(); // Deliberately do not end: incomplete body attacker.
  if(payload!==null)req.write(payload);
 });
}
test('oversized declared Content-Length is rejected before waiting for attacker-supplied body',async t=>{
 let calls=0;
 const app=createMetaWebhookBridge({appSecret:SECRET,verifyToken:TOKEN,ingestor:{ingest:async()=>{calls++;}}});
 const base=await app.start();t.after(()=>app.stop());
 const status=await pendingPost(base,{'content-type':'application/json','x-hub-signature-256':'sha256='+'0'.repeat(64),'content-length':'9999999'});
 assert.equal(status,413);assert.equal(calls,0);
});
test('incomplete signed POST cannot hold a webhook handler indefinitely',async t=>{
 let calls=0;
 const app=createMetaWebhookBridge({appSecret:SECRET,verifyToken:TOKEN,maxBodyReadMs:150,ingestor:{ingest:async()=>{calls++;}}});
 const base=await app.start();t.after(()=>app.stop());
 const status=await pendingPost(base,{'content-type':'application/json','x-hub-signature-256':'sha256='+'0'.repeat(64),'content-length':'100'});
 assert.equal(status,408);assert.equal(calls,0);
});

test('oversized chunked stream is rejected without waiting for attacker EOF',async t=>{
 let calls=0;const app=createMetaWebhookBridge({appSecret:SECRET,verifyToken:TOKEN,ingestor:{ingest:async()=>{calls++;}}});
 const base=await app.start();t.after(()=>app.stop());
 const status=await pendingPost(base,{'content-type':'application/json','x-hub-signature-256':'sha256='+'0'.repeat(64),'transfer-encoding':'chunked'},1200,Buffer.alloc(270*1024,65));
 assert.equal(status,413);assert.equal(calls,0);
});
