import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PrivateStageStore} from '../src/private-stage/store.mjs';
import {simulateOfflineFaqProcessing} from '../src/private-stage/faq-pipeline.mjs';
import {createPrivateWebhookServer} from '../src/private-stage/webhook-server.mjs';
const secret='PRIVATE_ONLY_META_FIXTURE';
function sign(payload){const rawBody=Buffer.from(JSON.stringify(payload));return {rawBody,signature:'sha256='+createHmac('sha256',secret).update(rawBody).digest('hex'),appSecret:secret};}
function payload(message={id:'wamid.one',from:'263771111111',type:'text',text:{body:'Hours?'}}){return {object:'whatsapp_business_account',entry:[{id:'WABA_A',changes:[{field:'messages',value:{metadata:{phone_number_id:'PHONE_A'},messages:[message]}}]}]};}
function setup(t){const dir=mkdtempSync(join(tmpdir(),'musitu-pipeline-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const store=new PrivateStageStore(join(dir,'db.sqlite'),{identityKey:Buffer.alloc(32,89)});t.after(()=>store.close());store.seedTenant({tenantId:'tenant-A',legalName:'Salon',ownerId:'owner-A',wabaId:'WABA_A',phoneNumberId:'PHONE_A'});return store;}

test('signed inbound FAQ creates an idempotent stage draft with no real outgoing call',t=>{
 const store=setup(t);store.putFaq('tenant-A','owner-A','hours','Hours?','9am–6pm');
 const opts={store,...sign(payload()),actorForTenant:{'tenant-A':'owner-A'}};
 const result=simulateOfflineFaqProcessing(opts);
 assert.deepEqual(result.receipts.map(x=>x.status),['ACCEPTED']);
 assert.equal(result.drafts[0].status,'DRAFT');assert.equal(result.drafts[0].body,'9am–6pm');
 assert.equal(result.drafts[0].providerDelivery,'NEVER_SUBMITTED');
 const replay=simulateOfflineFaqProcessing(opts);
 assert.deepEqual(replay.receipts.map(x=>x.status),['DUPLICATE']);
 assert.equal(replay.drafts[0].draftId,result.drafts[0].draftId);
 assert.equal(store.listReplyDrafts('tenant-A','owner-A').length,1);
});

test('unknown question and non-text inbound hand over without hallucinating responses',t=>{
 const store=setup(t);
 const unrecognized=simulateOfflineFaqProcessing({store,...sign(payload()),actorForTenant:{'tenant-A':'owner-A'}});
 assert.deepEqual(unrecognized.drafts,[{status:'HANDOVER_REQUIRED',reason:'NO_APPROVED_SOURCE'}]);
 const second=payload({id:'wamid.two',from:'263772222222',type:'image',image:{id:'opaque'}});
 const unsupported=simulateOfflineFaqProcessing({store,...sign(second),actorForTenant:{'tenant-A':'owner-A'}});
 assert.deepEqual(unsupported.drafts,[{status:'HANDOVER_REQUIRED',reason:'UNSUPPORTED_MESSAGE_TYPE'}]);
 assert.equal(store.listReplyDrafts('tenant-A','owner-A').length,0);
});

test('offline pipeline rejects missing authenticated stage actor without altering inbound ledger',t=>{
 const store=setup(t);
 assert.throws(()=>simulateOfflineFaqProcessing({store,...sign(payload()),actorForTenant:{'tenant-A':'owner-B'}}),/ACCESS_DENIED/);
 assert.equal(store.snapshot('tenant-A','owner-A').inquiries,0);
});

test('local webhook can stage the full signed inbound-to-draft flow, never Meta-send',async t=>{
 const store=setup(t);store.putFaq('tenant-A','owner-A','hours','Hours?','9am–6pm');
 const srv=createPrivateWebhookServer({store,appSecret:secret,verifyToken:'TEST-VERIFY',offlineFaqActorByTenant:{'tenant-A':'owner-A'}});
 const url=await srv.start();t.after(()=>srv.stop());
 const data=sign(payload());
 const res=await fetch(url+'/webhook',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':data.signature},body:data.rawBody});
 assert.equal(res.status,200);assert.deepEqual(await res.json(),{statuses:['ACCEPTED'],offlineDraftCount:1});
 assert.equal(store.listReplyDrafts('tenant-A','owner-A')[0].body,'9am–6pm');
});
