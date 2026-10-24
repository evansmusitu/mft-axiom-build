import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {PrivateStageStore} from '../src/private-stage/store.mjs';
import {createPrivateWebhookServer} from '../src/private-stage/webhook-server.mjs';

const secret='STAGE_NOT_META_SECRET';
const key=Buffer.alloc(32,67);
function signed(payload){const rawBody=Buffer.from(JSON.stringify(payload));return {rawBody,signature:'sha256='+createHmac('sha256',secret).update(rawBody).digest('hex'),appSecret:secret};}
function batch({tenant='A',id='wamid.synthetic-inbound',sender='263771111111',question='When are you open?'}={}){return {object:'whatsapp_business_account',entry:[{id:`WABA_${tenant}`,changes:[{field:'messages',value:{metadata:{phone_number_id:`PHONE_${tenant}`},messages:[{id,from:sender,type:'text',text:{body:question}}]}}]}]};}
function statusBatch({tenant='A',id='stage.wamid.test-1',status='sent',timestamp='1792059000'}={}){return {object:'whatsapp_business_account',entry:[{id:`WABA_${tenant}`,changes:[{field:'messages',value:{metadata:{phone_number_id:`PHONE_${tenant}`},statuses:[{id,status,timestamp,recipient_id:'263771111111'}]}}]}]};}
function env(t){ const dir=mkdtempSync(join(tmpdir(),'musitu-next-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const db=join(dir,'test.sqlite');const store=new PrivateStageStore(db,{identityKey:key});t.after(()=>store.close());for(const x of ['A','B'])store.seedTenant({tenantId:`tenant-${x}`,legalName:`Tenant ${x}`,ownerId:`owner-${x}`,wabaId:`WABA_${x}`,phoneNumberId:`PHONE_${x}`});return {store,db}; }

test('FAQ reply drafts are durable, source-linked, tenant isolated and never dispatched',t=>{
 const {store,db}=env(t);
 store.putFaq('tenant-A','owner-A','hours','When are you open?','We open at 9am.');
 store.putFaq('tenant-B','owner-B','hours','When are you open?','We open at 11am.');
 const [receipt]=store.ingestSignedWebhook(signed(batch()));
 const request={tenantId:'tenant-A',actorId:'owner-A',conversationId:receipt.conversationId,question:'When are you open?',effectKey:'faq-reply-001'};
 const draft=store.draftApprovedFaqReply(request);
 assert.equal(draft.status,'DRAFT');assert.equal(draft.sourceId,'hours');assert.equal(draft.body,'We open at 9am.');
 assert.equal(draft.providerDelivery,'NEVER_SUBMITTED');
 assert.deepEqual(store.draftApprovedFaqReply(request),draft);
 assert.throws(()=>store.draftApprovedFaqReply({...request,question:'How much?'}),/IDEMPOTENCY_CONFLICT/);
 assert.throws(()=>store.draftApprovedFaqReply({...request,actorId:'owner-B',effectKey:'X'}),/ACCESS_DENIED/);
 assert.throws(()=>store.draftApprovedFaqReply({...request,tenantId:'tenant-B',actorId:'owner-B',effectKey:'X'}),/CONVERSATION_NOT_FOUND/);
 assert.equal(store.listReplyDrafts('tenant-B','owner-B').length,0);
 assert.equal(store.listReplyDrafts('tenant-A','owner-A').length,1);
 const reopened=new PrivateStageStore(db,{identityKey:key});t.after(()=>reopened.close());
 assert.deepEqual(reopened.draftApprovedFaqReply(request),draft);
});

test('unknown FAQ never fabricates a response; handover disables drafts and remains durable',t=>{
 const {store,db}=env(t);const [r]=store.ingestSignedWebhook(signed(batch()));
 const args={tenantId:'tenant-A',actorId:'owner-A',conversationId:r.conversationId,question:'Can I get a refund?',effectKey:'draft-none'};
 assert.deepEqual(store.draftApprovedFaqReply(args),{status:'HANDOVER_REQUIRED',reason:'NO_APPROVED_SOURCE'});
 assert.equal(store.canBotReply('tenant-A',r.conversationId),false);
 store.putFaq('tenant-A','owner-A','refund','Can I get a refund?','Please contact staff.');
 assert.deepEqual(store.draftApprovedFaqReply({...args,effectKey:'later'}),{status:'HANDOVER_REQUIRED',reason:'HUMAN_HANDOVER'});
 assert.equal(store.listReplyDrafts('tenant-A','owner-A').length,0);
 const reopened=new PrivateStageStore(db,{identityKey:key});t.after(()=>reopened.close());
 assert.equal(reopened.canBotReply('tenant-A',r.conversationId),false);
});

test('handover prevents first-time FAQ draft; direct API cannot create a draft for missing conversation',t=>{
 const {store}=env(t);const [r]=store.ingestSignedWebhook(signed(batch()));
 store.putFaq('tenant-A','owner-A','hours','When are you open?','At nine');
 store.handover('tenant-A','owner-A',r.conversationId);
 assert.deepEqual(store.draftApprovedFaqReply({tenantId:'tenant-A',actorId:'owner-A',conversationId:r.conversationId,question:'When are you open?',effectKey:'x'}),{status:'HANDOVER_REQUIRED',reason:'HUMAN_HANDOVER'});
 assert.throws(()=>store.draftApprovedFaqReply({tenantId:'tenant-A',actorId:'owner-A',conversationId:'unknown',question:'When are you open?',effectKey:'y'}),/CONVERSATION_NOT_FOUND/);
});

test('signed Meta delivery statuses are scoped to prior synthetic attempted messages, replay safe and durable',t=>{
 const {store,db}=env(t);
 store.recordSyntheticOutboundAttempt({tenantId:'tenant-A',actorId:'owner-A',phoneNumberId:'PHONE_A',providerMessageId:'stage.wamid.test-1',effectKey:'outbound-test-1'});
 assert.deepEqual(store.ingestSignedWebhook(signed(statusBatch())).map(x=>x.status),['SENT']);
 assert.deepEqual(store.ingestSignedWebhook(signed(statusBatch())).map(x=>x.status),['DUPLICATE_STATUS']);
 assert.deepEqual(store.ingestSignedWebhook(signed(statusBatch({status:'delivered',timestamp:'1792059002'}))).map(x=>x.status),['DELIVERED']);
 assert.deepEqual(store.ingestSignedWebhook(signed(statusBatch({status:'sent',timestamp:'1792059003'}))).map(x=>x.status),['SENT']);
 assert.equal(store.getSyntheticDeliveryState('tenant-A','owner-A','stage.wamid.test-1'),'DELIVERED');
 assert.equal(store.listSyntheticDeliveryEvents('tenant-A','owner-A').length,3);
 assert.equal(store.listSyntheticDeliveryEvents('tenant-B','owner-B').length,0);
 const reopened=new PrivateStageStore(db,{identityKey:key});t.after(()=>reopened.close());
 assert.equal(reopened.getSyntheticDeliveryState('tenant-A','owner-A','stage.wamid.test-1'),'DELIVERED');
});

test('unknown or cross-tenant status and mixed invalid batch roll back completely',t=>{
 const {store}=env(t);
 store.recordSyntheticOutboundAttempt({tenantId:'tenant-A',actorId:'owner-A',phoneNumberId:'PHONE_A',providerMessageId:'stage.wamid.known',effectKey:'outbound-test-2'});
 const invalid=statusBatch({id:'stage.wamid.unknown'});
 assert.throws(()=>store.ingestSignedWebhook(signed(invalid)),/UNKNOWN_OUTBOUND_ATTEMPT/);
 const cross=statusBatch({tenant:'B',id:'stage.wamid.known'});
 assert.throws(()=>store.ingestSignedWebhook(signed(cross)),/UNKNOWN_OUTBOUND_ATTEMPT/);
 const mixed=statusBatch({id:'stage.wamid.known'});
 mixed.entry[0].changes[0].value.statuses.push({id:'stage.wamid.missing',status:'delivered',timestamp:'1792059000'});
 assert.throws(()=>store.ingestSignedWebhook(signed(mixed)),/UNKNOWN_OUTBOUND_ATTEMPT/);
 assert.equal(store.listSyntheticDeliveryEvents('tenant-A','owner-A').length,0);
 assert.throws(()=>store.ingestSignedWebhook(signed(statusBatch({id:'stage.wamid.known',status:'bogus'}))),/INVALID_META_STATUS/);
 assert.equal(store.listSyntheticDeliveryEvents('tenant-A','owner-A').length,0);
});

test('same synthetic provider identifier cannot be claimed by another attempt or altered effect key',t=>{
 const {store}=env(t);
 const x={tenantId:'tenant-A',actorId:'owner-A',phoneNumberId:'PHONE_A',providerMessageId:'stage.wamid.test-1',effectKey:'e-1'};
 assert.equal(store.recordSyntheticOutboundAttempt(x).status,'REGISTERED_SYNTHETIC');
 assert.equal(store.recordSyntheticOutboundAttempt(x).status,'REGISTERED_SYNTHETIC');
 assert.throws(()=>store.recordSyntheticOutboundAttempt({...x,effectKey:'e-2'}),/OUTBOUND_PROVIDER_CONFLICT/);
 assert.throws(()=>store.recordSyntheticOutboundAttempt({...x,providerMessageId:'wamid.real-looking'}),/SYNTHETIC_ONLY/);
 assert.throws(()=>store.recordSyntheticOutboundAttempt({...x,tenantId:'tenant-B',actorId:'owner-B',phoneNumberId:'PHONE_A'}),/UNAUTHORIZED_CHANNEL/);
});

test('status-bearing HTTP webhook acknowledges only validated, fully persisted batch',async t=>{
 const {store}=env(t);
 store.recordSyntheticOutboundAttempt({tenantId:'tenant-A',actorId:'owner-A',phoneNumberId:'PHONE_A',providerMessageId:'stage.wamid.test-1',effectKey:'e-1'});
 const server=createPrivateWebhookServer({store,appSecret:secret,verifyToken:'FAKE_TOKEN'});
 const url=await server.start();t.after(()=>server.stop());
 const data=signed(statusBatch());
 const res=await fetch(url+'/webhook',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':data.signature},body:data.rawBody});
 assert.equal(res.status,200);assert.deepEqual((await res.json()).statuses,['SENT']);
 const bad=signed(statusBatch({id:'stage.wamid.unknown'}));
 const denied=await fetch(url+'/webhook',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':bad.signature},body:bad.rawBody});
 assert.equal(denied.status,422);
 assert.equal(store.listSyntheticDeliveryEvents('tenant-A','owner-A').length,1);
});
