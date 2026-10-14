import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {DatabaseSync as SQLiteDatabaseSync} from 'node:sqlite';
import {PrivateStageStore} from '../src/private-stage/store.mjs';
import {createPrivateWebhookServer} from '../src/private-stage/webhook-server.mjs';

const metaSecret='private-stage-test-only-Meta-secret';
const internalKey=Buffer.alloc(32,17); // synthetic and NOT a deployable key
const WABA_A='WABA_A';
function signed(payload){ const rawBody=Buffer.from(JSON.stringify(payload));return {rawBody, signature:'sha256='+createHmac('sha256',metaSecret).update(rawBody).digest('hex')}; }
function inbound({waba='WABA_A',phone='PHONE_A',id='wamid.001',from='263771111111',text='Can I book?' }={}){
 return {object:'whatsapp_business_account',entry:[{id:waba,changes:[{field:'messages',value:{metadata:{phone_number_id:phone},messages:[{id,from,type:'text',text:{body:text}}]}}]}]};
}
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'musitu-phase1-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const db=join(dir,'private-stage.sqlite');
 const store=new PrivateStageStore(db,{identityKey:internalKey});t.after(()=>store.close());
 store.seedTenant({tenantId:'tenant-A',legalName:'Salon A',ownerId:'owner-A',wabaId:'WABA_A',phoneNumberId:'PHONE_A'});
 store.seedTenant({tenantId:'tenant-B',legalName:'Salon B',ownerId:'owner-B',wabaId:'WABA_B',phoneNumberId:'PHONE_B'});
 return {store,db};
}

test('signed Meta webhook is durable through restart and inbound retry does not duplicate',t=>{
 const {store,db}=fixture(t);
 const event=signed(inbound());
 assert.deepEqual(store.ingestSignedWebhook({...event,appSecret:metaSecret}).map(x=>x.status),['ACCEPTED']);
 assert.deepEqual(store.ingestSignedWebhook({...event,appSecret:metaSecret}).map(x=>x.status),['DUPLICATE']);
 assert.equal(store.snapshot('tenant-A','owner-A').inquiries,1);
 assert.equal(store.snapshot('tenant-B','owner-B').inquiries,0);
 const reopened=new PrivateStageStore(db,{identityKey:internalKey});t.after(()=>reopened.close());
 assert.equal(reopened.snapshot('tenant-A','owner-A').inquiries,1);
 assert.deepEqual(reopened.ingestSignedWebhook({...event,appSecret:metaSecret}).map(x=>x.status),['DUPLICATE']);
});

test('tamper, unknown binding and invalid second message fail without partial ingestion',t=>{
 const {store}=fixture(t);const good=signed(inbound());
 assert.throws(()=>store.ingestSignedWebhook({...good,signature:'sha256='+('a'.repeat(64)),appSecret:metaSecret}),/INVALID_META_SIGNATURE/);
 assert.throws(()=>store.ingestSignedWebhook({...signed(inbound({waba:'WABA_B',phone:'PHONE_A'})),appSecret:metaSecret}),/UNAUTHORIZED_CHANNEL/);
 const mixed=inbound();mixed.entry[0].changes[0].value.messages.push({id:'wamid.002',type:'text',text:{body:'missing from'}});
 assert.throws(()=>store.ingestSignedWebhook({...signed(mixed),appSecret:metaSecret}),/INVALID_CUSTOMER_ID/);
 assert.equal(store.snapshot('tenant-A','owner-A').inquiries,0);
});

test('duplicate batch message is idempotent, and revoked phone cannot ingest',t=>{
 const {store}=fixture(t);
 const payload=inbound();payload.entry[0].changes[0].value.messages.push({...payload.entry[0].changes[0].value.messages[0]});
 assert.deepEqual(store.ingestSignedWebhook({...signed(payload),appSecret:metaSecret}).map(x=>x.status),['ACCEPTED','DUPLICATE']);
 store.revokeChannel('tenant-A','owner-A','PHONE_A');
 assert.throws(()=>store.ingestSignedWebhook({...signed(inbound({id:'wamid.003'})),appSecret:metaSecret}),/UNAUTHORIZED_CHANNEL/);
 assert.equal(store.snapshot('tenant-A','owner-A').inquiries,1);
});

test('bookings are tenant-scoped, overlapping requests conflict, exact retry is idempotent',t=>{
 const {store}=fixture(t);
 store.addResource('tenant-A','owner-A','chair-1','Chair 1');
 store.addResource('tenant-B','owner-B','chair-1','Chair 1');
 const base={tenantId:'tenant-A',actorId:'owner-A',resourceId:'chair-1',startAt:'2026-10-15T10:00:00.000Z',endAt:'2026-10-15T10:30:00.000Z',effectKey:'book-001'};
 const b=store.reserveBooking(base);
 assert.equal(b.status,'CONFIRMED');
 assert.deepEqual(store.reserveBooking(base),b);
 assert.throws(()=>store.reserveBooking({...base,endAt:'2026-10-15T11:00:00.000Z'}),/IDEMPOTENCY_CONFLICT/);
 assert.throws(()=>store.reserveBooking({...base,startAt:'2026-10-15T10:15:00.000Z',endAt:'2026-10-15T11:00:00.000Z',effectKey:'book-002'}),/SLOT_UNAVAILABLE/);
 assert.equal(store.reserveBooking({...base,startAt:'2026-10-15T10:30:00.000Z',endAt:'2026-10-15T11:00:00.000Z',effectKey:'book-003'}).status,'CONFIRMED');
 assert.throws(()=>store.reserveBooking({...base,actorId:'owner-B',effectKey:'book-004'}),/ACCESS_DENIED/);
 assert.equal(store.reserveBooking({...base,tenantId:'tenant-B',actorId:'owner-B',effectKey:'book-B'}).status,'CONFIRMED');
 assert.equal(store.snapshot('tenant-A','owner-A').bookings,2);
 assert.equal(store.snapshot('tenant-B','owner-B').bookings,1);
});

test('human handover persists, fences offline bot drafts, and other tenant cannot control it',t=>{
 const {store,db}=fixture(t);
 const [receipt]=store.ingestSignedWebhook({...signed(inbound()),appSecret:metaSecret});
 assert.equal(store.canBotReply('tenant-A',receipt.conversationId),true);
 store.handover('tenant-A','owner-A',receipt.conversationId);
 assert.equal(store.canBotReply('tenant-A',receipt.conversationId),false);
 assert.throws(()=>store.handover('tenant-B','owner-B',receipt.conversationId),/CONVERSATION_NOT_FOUND/);
 assert.throws(()=>store.handover('tenant-A','owner-B',receipt.conversationId),/ACCESS_DENIED/);
 const reopened=new PrivateStageStore(db,{identityKey:internalKey});t.after(()=>reopened.close());
 assert.equal(reopened.canBotReply('tenant-A',receipt.conversationId),false);
});

test('approved FAQ lookup is tenant isolated and refuses guesses',t=>{
 const {store}=fixture(t);
 store.putFaq('tenant-A','owner-A','opening','When are you open?','Salon A opens at 9 AM.');
 store.putFaq('tenant-B','owner-B','opening','When are you open?','Salon B opens at 10 AM.');
 assert.deepEqual(store.answerFaq('tenant-A','When are you open?'),{status:'ANSWER',sourceId:'opening',answer:'Salon A opens at 9 AM.'});
 assert.deepEqual(store.answerFaq('tenant-B','When are you open?'),{status:'ANSWER',sourceId:'opening',answer:'Salon B opens at 10 AM.'});
 assert.deepEqual(store.answerFaq('tenant-A','Do you sell yachts?'),{status:'HANDOVER_REQUIRED',reason:'NO_APPROVED_SOURCE'});
 assert.throws(()=>store.putFaq('tenant-A','owner-B','x','A','B'),/ACCESS_DENIED/);
});

test('private localhost HTTP receiver validates challenge and HMAC, never sends outbound messages',async t=>{
 const {store}=fixture(t);
 const server=createPrivateWebhookServer({store,appSecret:metaSecret,verifyToken:'synthetic-test-verify-token'});
 const addr=await server.start();t.after(()=>server.stop());
 const good=await fetch(`${addr}/webhook?hub.mode=subscribe&hub.verify_token=synthetic-test-verify-token&hub.challenge=OK-123`);
 assert.equal(good.status,200);assert.equal(await good.text(),'OK-123');
 assert.equal((await fetch(`${addr}/webhook?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=OK-123`)).status,403);
 const data=signed(inbound());
 const forged=await fetch(`${addr}/webhook`,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+('0'.repeat(64))},body:data.rawBody});
 assert.equal(forged.status,401);
 const res=await fetch(`${addr}/webhook`,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':data.signature},body:data.rawBody});
 assert.equal(res.status,200);assert.deepEqual((await res.json()).statuses,['ACCEPTED']);
 assert.equal(store.snapshot('tenant-A','owner-A').inquiries,1);
 const health=await fetch(`${addr}/health`);assert.match(await health.text(),/PRIVATE_LOCAL_ONLY/);
});

test('same provider ID cannot be reassigned to a different sender; no hidden extra conversation',t=>{
 const {store}=fixture(t);
 const first=store.ingestSignedWebhook({...signed(inbound({id:'duplicate-1',from:'263771111111'})),appSecret:metaSecret})[0];
 assert.throws(()=>store.ingestSignedWebhook({...signed(inbound({id:'duplicate-1',from:'263779999999'})),appSecret:metaSecret}),/MESSAGE_SENDER_CONFLICT/);
 assert.equal(store.snapshot('tenant-A','owner-A').inquiries,1);
 assert.equal(store.canBotReply('tenant-A',first.conversationId),true);
});

test('a second SQLite connection observes booked slots and rejected overlap persists after restart',t=>{
 const {store,db}=fixture(t);
 store.addResource('tenant-A','owner-A','chair-1','Chair 1');
 const second=new PrivateStageStore(db,{identityKey:internalKey});t.after(()=>second.close());
 const startAt='2026-10-15T10:00:00.000Z',endAt='2026-10-15T10:30:00.000Z';
 const original=store.reserveBooking({tenantId:'tenant-A',actorId:'owner-A',resourceId:'chair-1',startAt,endAt,effectKey:'original'});
 assert.throws(()=>second.reserveBooking({tenantId:'tenant-A',actorId:'owner-A',resourceId:'chair-1',startAt:'2026-10-15T10:10:00.000Z',endAt:'2026-10-15T10:25:00.000Z',effectKey:'overlap'}),/SLOT_UNAVAILABLE/);
 const r=second.reserveBooking({tenantId:'tenant-A',actorId:'owner-A',resourceId:'chair-1',startAt,endAt,effectKey:'original'});
 assert.deepEqual(r,original);
 const {DatabaseSync}=requireSQLite();
 const direct=new DatabaseSync(db);t.after(()=>direct.close());
 assert.throws(()=>direct.prepare("INSERT INTO bookings VALUES('tenant-A','illicit-direct','chair-1',1792059000000,1792060800000,'illicit','CONFIRMED')").run(),/SLOT_UNAVAILABLE/);
});

function requireSQLite(){ return {DatabaseSync:SQLiteDatabaseSync}; }
