import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {PrivateStageStore} from '../src/private-stage/store.mjs';
import {simulateOfflineFaqProcessing} from '../src/private-stage/faq-pipeline.mjs';

const IDENTITY_KEY=Buffer.alloc(32,147), SECRET='fake-stage-meta-secret-v15';
function fixture(t){
 const path=join(mkdtempSync(join(tmpdir(),'wa-v15-optout-')),'stage.sqlite');
 t.after(()=>rmSync(join(path,'..'),{recursive:true,force:true}));
 const store=new PrivateStageStore(path,{identityKey:IDENTITY_KEY});t.after(()=>store.close());
 store.seedTenant({tenantId:'tenant-A',legalName:'Example A',ownerId:'owner-A',wabaId:'WABA_A',phoneNumberId:'PHONE_A'});
 store.seedTenant({tenantId:'tenant-B',legalName:'Example B',ownerId:'owner-B',wabaId:'WABA_B',phoneNumberId:'PHONE_B'});
 return {store,path};
}
function envelope({waba='WABA_A',phone='PHONE_A',messageId='wamid.v15.1',from='263771111111',text='STOP',messages}={}){
 return {object:'whatsapp_business_account',entry:[{id:waba,changes:[{field:'messages',value:{metadata:{phone_number_id:phone},messages:messages??[{id:messageId,from,type:'text',text:{body:text}}]}}]}]};
}
function signed(payload){const rawBody=Buffer.from(JSON.stringify(payload));return {rawBody,signature:`sha256=${createHmac('sha256',SECRET).update(rawBody).digest('hex')}`,appSecret:SECRET};}
function process(store,payload){return simulateOfflineFaqProcessing({store,...signed(payload),actorForTenant:{'tenant-A':'owner-A','tenant-B':'owner-B'}});}

test('signed STOP persists a privacy-preserving suppression, blocks FAQ drafts and is replay-safe',t=>{
 const {store,path}=fixture(t);
 store.putFaq('tenant-A','owner-A','stop-faq','STOP','Do not send this!');
 const payload=envelope();
 const first=process(store,payload);
 assert.equal(first.receipts[0].status,'ACCEPTED');
 assert.deepEqual(first.drafts,[{status:'SUPPRESSED',reason:'CUSTOMER_OPT_OUT'}]);
 const id=first.receipts[0].conversationId;
 assert.equal(store.canBotReply('tenant-A',id),false);
 assert.deepEqual(store.listConversations('tenant-A','owner-A').map(c=>c.suppressed),[true]);
 const repeat=process(store,payload);
 assert.equal(repeat.receipts[0].status,'DUPLICATE');
 assert.deepEqual(repeat.drafts,[{status:'SUPPRESSED',reason:'CUSTOMER_OPT_OUT'}]);
 assert.equal(store.listActionAudit('tenant-A','owner-A').filter(e=>e.action==='CUSTOMER_OPT_OUT').length,1);
 const later=process(store,envelope({messageId:'wamid.v15.2',text:'When are you open?'}));
 assert.deepEqual(later.drafts,[{status:'SUPPRESSED',reason:'CUSTOMER_OPT_OUT'}]);
 const reopened=new PrivateStageStore(path,{identityKey:IDENTITY_KEY});t.after(()=>reopened.close());
 assert.equal(reopened.canBotReply('tenant-A',id),false);
});

test('signed unsubscribe is per tenant and per contact, never permits implicit resubscribe',t=>{
 const {store}=fixture(t);
 store.putFaq('tenant-A','owner-A','hours','Hours?','A is open');
 store.putFaq('tenant-B','owner-B','hours','Hours?','B is open');
 const a=process(store,envelope({text:'   uNsUbScRiBe  '}));
 assert.equal(a.drafts[0].status,'SUPPRESSED');
 assert.deepEqual(process(store,envelope({messageId:'wamid.v15.start',text:'START'})).drafts,[{status:'SUPPRESSED',reason:'CUSTOMER_OPT_OUT'}]);
 const another=process(store,envelope({messageId:'wamid.v15.other',from:'263772222222',text:'Hours?'}));
 assert.equal(another.drafts[0].status,'DRAFT');
 const b=process(store,envelope({waba:'WABA_B',phone:'PHONE_B',messageId:'wamid.v15.B',text:'Hours?'}));
 assert.equal(b.drafts[0].body,'B is open');
 assert.equal(store.listConversations('tenant-B','owner-B').every(c=>!c.suppressed),true);
 assert.throws(()=>store.listConversations('tenant-A','owner-B'),/ACCESS_DENIED/);
 assert.equal(store.listConversations('tenant-A','owner-A').find(c=>c.conversationId===a.receipts[0].conversationId).suppressed,true);
});

test('only exact opt-out text is accepted and malformed or forged STOP cannot suppress',t=>{
 const {store}=fixture(t);
 store.putFaq('tenant-A','owner-A','phrase','Please stop by at 5','Thanks');
 const x=process(store,envelope({text:'Please stop by at 5'}));
 assert.equal(x.drafts[0].status,'DRAFT');
 assert.equal(store.canBotReply('tenant-A',x.receipts[0].conversationId),true);
 const forged=signed(envelope({messageId:'wamid.v15.forged',text:'STOP'}));
 assert.throws(()=>store.ingestSignedWebhook({...forged,signature:'sha256='+'0'.repeat(64)}),/INVALID_META_SIGNATURE/);
 assert.equal(store.snapshot('tenant-A','owner-A').inquiries,1);
 assert.equal(store.canBotReply('tenant-A',x.receipts[0].conversationId),true);
});

test('a mixed batch with invalid synthetic delivery status rolls back suppression and inbound',t=>{
 const {store}=fixture(t);
 const message={id:'wamid.v15.1',from:'263771111111',type:'text',text:{body:'STOP'}};
 const payload=envelope({messages:[message]});
 payload.entry[0].changes[0].value.statuses=[{id:'stage.wamid.unknown',status:'read',timestamp:'1720000000'}];
 assert.throws(()=>store.ingestSignedWebhook(signed(payload)),/UNKNOWN_OUTBOUND_ATTEMPT/);
 assert.equal(store.snapshot('tenant-A','owner-A').inquiries,0);
 const valid=process(store,envelope({messageId:'wamid.v15.2',text:'Hours?'}));
 assert.notEqual(valid.drafts[0].status,'SUPPRESSED');
 assert.equal(store.listActionAudit('tenant-A','owner-A').filter(e=>e.action==='CUSTOMER_OPT_OUT').length,0);
});

test('cross-tenant replay and changed STOP body fail without new suppression records',t=>{
 const {store}=fixture(t);
 const original=envelope({messageId:'wamid.v15.x',text:'STOP'});
 const first=process(store,original);
 const modified=envelope({messageId:'wamid.v15.x',text:'Hours?'});
 assert.throws(()=>store.ingestSignedWebhook(signed(modified)),/MESSAGE_PAYLOAD_CONFLICT/);
 assert.equal(store.listActionAudit('tenant-A','owner-A').filter(e=>e.action==='CUSTOMER_OPT_OUT').length,1);
 assert.equal(store.canBotReply('tenant-A',first.receipts[0].conversationId),false);
 assert.equal(store.listConversations('tenant-B','owner-B').length,0);
});


test('an existing approved-source draft is visibly suppressed after later STOP, including across restart',t=>{
 const {store,path}=fixture(t);
 store.putFaq('tenant-A','owner-A','hours','Hours?','A is open');
 const earlier=process(store,envelope({text:'Hours?',messageId:'wamid.v15.pre'}));
 assert.equal(earlier.drafts[0].status,'DRAFT');
 assert.deepEqual(store.listReplyDrafts('tenant-A','owner-A').map(d=>d.status),['DRAFT']);
 process(store,envelope({text:'STOP',messageId:'wamid.v15.post'}));
 assert.deepEqual(store.listReplyDrafts('tenant-A','owner-A').map(d=>d.status),['SUPPRESSED']);
 const again=new PrivateStageStore(path,{identityKey:IDENTITY_KEY});t.after(()=>again.close());
 assert.deepEqual(again.listReplyDrafts('tenant-A','owner-A').map(d=>d.status),['SUPPRESSED']);
});
