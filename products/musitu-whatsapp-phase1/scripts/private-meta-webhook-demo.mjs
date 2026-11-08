/** Local-only protocol smoke; never accepts real Meta callbacks. */
import {createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
import {createMetaWebhookBridge} from '../src/adapters/meta-webhook-bridge.mjs';
const secret='simulated-app-secret-not-for-production';
const token='simulated-verify-token-not-for-production';
let stored=0;
const ingestor={ingest:async({rawBody})=>{const p=JSON.parse(rawBody.toString('utf8'));
 if(p.object!=='whatsapp_business_account')throw Error('INVALID_META_WEBHOOK');stored++;
 return [{status:'SIMULATED_ONLY'}];
}};
const bridge=createMetaWebhookBridge({appSecret:secret,verifyToken:token,ingestor});
const base=await bridge.start();
try{
 const q=new URLSearchParams({'hub.mode':'subscribe','hub.verify_token':token,'hub.challenge':'564394'});
 const get=await fetch(`${base}/webhook?${q}`);
 assert.equal(get.status,200);assert.equal(await get.text(),'564394');
 const raw=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[]}));
 const sig='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
 const post=await fetch(`${base}/webhook`,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':sig},body:raw});
 assert.equal(post.status,200);assert.equal(stored,1);
 const reject=await fetch(`${base}/webhook`,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+('0'.repeat(64))},body:raw});
 assert.equal(reject.status,401);assert.equal(stored,1);
 console.log(JSON.stringify({environment:'LOCAL_SIMULATION_ONLY',metaChallenge:get.status,signedPost:post.status,forgedPost:reject.status,simulatedStored:stored,providerSends:0,payments:0}));
}finally{await bridge.stop();}
