/** Execute only against an ephemeral Wrangler --local server, never a public hostname. */
import assert from 'node:assert/strict';
const base='http://127.0.0.1:8787';
const auth={authorization:'Bearer local-only-test-token-012345678901234567890'};
const timeout=ms=>new Promise(r=>setTimeout(r,ms));
let ready=false;
for(let i=0;i<60;i++){
 try{const r=await fetch(base+'/health');if(r.status===200){ready=true;break;}}catch{}
 await timeout(500);
}
assert.equal(ready,true,'Local isolated Worker did not start');
const unauthorized=await fetch(base+'/v1/messages',{method:'POST',body:'{}'});
assert.equal(unauthorized.status,401);
const message={tenantId:'local-test',from:'alerts@example.org',to:'recipient@example.net',subject:'Local safe test',text:'No network delivery',kind:'SECURITY',idempotencyKey:'worker-local-0001'};
const result=await fetch(base+'/v1/messages',{method:'POST',headers:auth,body:JSON.stringify(message)});
if(result.status!==202)throw Error('POST returned '+result.status+': '+await result.text());
const accepted=await result.json();assert.equal(accepted.state,'QUEUED');assert.equal(accepted.queueNotificationAccepted,true);
const repeat=await fetch(base+'/v1/messages',{method:'POST',headers:auth,body:JSON.stringify(message)});
assert.equal(repeat.status,202);assert.equal((await repeat.json()).messageId,accepted.messageId);
let final;
for(let i=0;i<35;i++){
 const get=await fetch(base+'/v1/messages/'+accepted.messageId,{headers:auth});
 assert.equal(get.status,200);
 final=await get.json();if(final.state==='ACCEPTED_BY_PROVIDER')break;
 await timeout(200);
}
assert.equal(final.state,'ACCEPTED_BY_PROVIDER', 'Local queue did not deliver');
const verified=await fetch(base+'/v1/messages/'+accepted.messageId+'/evidence',{headers:auth});
assert.equal(verified.status,200);
const evidence=await verified.json();assert.ok(evidence.proof.signature);
assert.equal((await fetch(base+'/v1/messages/'+accepted.messageId+'/evidence')).status,401);
console.log(JSON.stringify({gate:'MMF_LOCAL_WORKER_D1_QUEUE_E2E',status:'PASS',actual_worker_runtime:true,local_d1:true,local_queues:true,network_delivery:false,external_credentials_used:false}));
