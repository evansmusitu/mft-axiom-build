import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {PostgresSignedWebhookIngestor} from '../src/postgres/signed-inbound.mjs';
const TA='00000000-0000-4000-8000-00000000000a',TB='00000000-0000-4000-8000-00000000000b';
const CB='00000000-0000-4000-8000-000000000010';
const FAQ='00000000-0000-4000-8000-000000000017';
const APP_SECRET='not-a-production-secret';const KEY=Buffer.alloc(32,41);
const BINDINGS=[{tenantId:TA,wabaId:'WABA_A',phoneNumberId:'PHONE_A'},{tenantId:TB,wabaId:'WABA_B',phoneNumberId:'PHONE_B'}];
function body({waba='WABA_A',phone='PHONE_A',sender='263771234567',messageId='wamid.test.01',type='text',text='What hours?',statuses}={}) {
 const value={metadata:{phone_number_id:phone}};
 if(statuses)value.statuses=[{id:'wamid.status',status:'delivered',timestamp:'1799999000'}];
 else value.messages=[{id:messageId,from:sender,type,...(type==='text'?{text:{body:text}}:{image:{id:'media-1'}})}];
 return Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:waba,changes:[{field:'messages',value}]}]}));
}
const sig=raw=>'sha256='+createHmac('sha256',APP_SECRET).update(raw).digest('hex');
function fakePool({failAt='',duplicate=false,storedFingerprint=null,handover=false,suppressed=false}={}){
 const calls=[],releases=[],status={};
 const client={query:async(sql,params=[])=>{
  calls.push({sql,params});
  if(failAt&&sql.includes(failAt))throw new Error('SIMULATED_STORAGE_FAULT');
  if(sql.includes('FROM musitu.tenants'))return {rows:[{id:TA}]};
  if(sql.includes('FROM musitu.whatsapp_channels'))return {rows:[{phone_number_id:'PHONE_A'}]};
  if(sql.includes('INSERT INTO musitu.conversations'))return {rows:[]};
  if(sql.includes('SELECT conversation_id, handling_mode FROM musitu.conversations'))return {rows:[{conversation_id:CB,handling_mode:handover?'HUMAN':'BOT'}]};
  if(sql.includes('INSERT INTO musitu.inbound_events'))return {rows:duplicate?[]:[{provider_message_id:'wamid.test.01'}]};
  if(sql.includes('SELECT conversation_id,payload_fingerprint FROM musitu.inbound_events'))return {rows:[{conversation_id:CB,payload_fingerprint:storedFingerprint}]};
  if(sql.includes('FROM musitu.faqs'))return {rows:[{faq_id:FAQ,answer:'Open at 8.'}]};
  if(sql.includes('INSERT INTO musitu.reply_drafts'))return {rows:[{draft_id:'00000000-0000-4000-8000-000000000018'}]};
  if(sql.includes('INSERT INTO musitu.customer_suppressions'))return {rows:[{conversation_id:CB}]};
  if(sql.includes('FROM musitu.customer_suppressions'))return {rows:suppressed?[{conversation_id:CB}]:[]};
  return {rows:[]};
 },release:reason=>releases.push(reason)};
 return {pool:{connect:async()=>client},calls,releases};
}
function ingestor(pool){return new PostgresSignedWebhookIngestor({pool,appSecret:APP_SECRET,bindings:BINDINGS,privacyKey:KEY});}
test('authentic Meta text is scoped by bound WABA+phone and committed as one tenant-local Postgres transaction',async()=>{
 const {pool,calls,releases}=fakePool();const raw=body();const result=await ingestor(pool).ingest({rawBody:raw,signature:sig(raw)});
 assert.equal(result.length,1);assert.equal(result[0].status,'ACCEPTED');assert.equal(result[0].draftStatus,'DRAFT');
 assert.equal(calls[0].sql,'BEGIN');assert.equal(calls.at(-1).sql,'COMMIT');
 assert.deepEqual(calls.find(c=>c.sql.includes("set_config('app.tenant_id'"))?.params,[TA]);
 assert.equal(calls.find(c=>c.sql.includes('INSERT INTO musitu.inbound_events'))?.params[0],TA);
 const insertConversation=calls.find(c=>c.sql.includes('INSERT INTO musitu.conversations'));
 assert.equal(insertConversation.params[0],TA);assert.match(insertConversation.params[3],/^hmac256:[0-9a-f]{64}$/);
 assert.equal(JSON.stringify(calls).includes('263771234567'),false,'raw customer phone not retained in SQL parameters');
 assert.deepEqual(calls.find(c=>c.sql.includes('FROM musitu.faqs'))?.params,[TA,'what hours?'],'approved FAQ lookup uses normalized question');
 assert.equal(releases.length,1);
});

test('padded signed inbound id is persisted unchanged without relaxing HMAC checks',async()=>{
 const messageId='wamid.SYNTHETIC+/==',raw=body({messageId}),db=fakePool();
 const result=await ingestor(db.pool).ingest({rawBody:raw,signature:sig(raw)});
 assert.equal(result[0].providerMessageId,messageId);
 assert.equal(db.calls.find(x=>x.sql.includes('INSERT INTO musitu.inbound_events')).params[2],messageId);
 const forged=fakePool();
 await assert.rejects(ingestor(forged.pool).ingest({rawBody:raw,signature:'sha256='+'0'.repeat(64)}),/INVALID_META_SIGNATURE/);
 assert.equal(forged.calls.length,0);
});
test('invalid HMAC, unauthorized WABA mapping, status-only callback, and cross-tenant batch fail before DB',async()=>{
 const f=fakePool(),reader=ingestor(f.pool),raw=body();
 await assert.rejects(reader.ingest({rawBody:raw,signature:'sha256='+'0'.repeat(64)}),/INVALID_META_SIGNATURE/);
 const rogue=body({waba:'WABA_OTHER'});await assert.rejects(reader.ingest({rawBody:rogue,signature:sig(rogue)}),/UNAUTHORIZED_CHANNEL/);
 const status=body({statuses:true});await assert.rejects(reader.ingest({rawBody:status,signature:sig(status)}),/INVALID_META_STATUS/);
 const multi=JSON.parse(raw.toString('utf8'));multi.entry.push(JSON.parse(body({waba:'WABA_B',phone:'PHONE_B'})).entry[0]);
 const invalid=Buffer.from(JSON.stringify(multi));
 await assert.rejects(reader.ingest({rawBody:invalid,signature:sig(invalid)}),/MULTI_TENANT_BATCH_DENIED/);
 assert.equal(f.calls.length,0);
});
test('idempotent replay returns DUPLICATE; sender/payload change rejects even for same message id',async()=>{
 const raw=body();const first=fakePool();await ingestor(first.pool).ingest({rawBody:raw,signature:sig(raw)});
 const insert=first.calls.find(x=>x.sql.includes('INSERT INTO musitu.inbound_events'));
 const fingerprint=insert.params.find(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x));
 assert.ok(fingerprint,'fingerprint persisted for conflicting replay detection');
 const existing=fakePool({duplicate:true,storedFingerprint:fingerprint});
 const replay=await ingestor(existing.pool).ingest({rawBody:raw,signature:sig(raw)});
 assert.equal(replay[0].status,'DUPLICATE');assert.equal(existing.calls.some(c=>c.sql.includes('INSERT INTO musitu.reply_drafts')),false);
 const changed=body({sender:'263779999999'});
 await assert.rejects(ingestor(fakePool({duplicate:true,storedFingerprint:fingerprint}).pool).ingest({rawBody:changed,signature:sig(changed)}),/MESSAGE_SENDER_OR_CONTENT_CONFLICT/);
});
test('unsupported message type and existing human handover must not create bot drafts',async()=>{
 const raw=body({type:'image'}),f=fakePool();const result=await ingestor(f.pool).ingest({rawBody:raw,signature:sig(raw)});
 assert.equal(result[0].draftStatus,'HANDOVER_REQUIRED');assert.equal(f.calls.some(c=>c.sql.includes('UPDATE musitu.conversations')),true);
 assert.equal(f.calls.some(c=>c.sql.includes('INSERT INTO musitu.reply_drafts')),false);
 const text=body(),other=fakePool({handover:true});const receipt=await ingestor(other.pool).ingest({rawBody:text,signature:sig(text)});
 assert.equal(receipt[0].draftStatus,'HANDOVER_REQUIRED');assert.equal(other.calls.some(c=>c.sql.includes('FROM musitu.faqs')),false);
});
test('database failures roll back and release; no partial inbound commit or provider sends',async()=>{
 const {pool,calls,releases}=fakePool({failAt:'INSERT INTO musitu.reply_drafts'});
 const raw=body();await assert.rejects(ingestor(pool).ingest({rawBody:raw,signature:sig(raw)}),/SIMULATED_STORAGE_FAULT/);
 assert.equal(calls.some(c=>c.sql==='ROLLBACK'),true);
 assert.equal(calls.some(c=>c.sql==='COMMIT'),false);assert.equal(releases.length,1);
});

test('private loopback HTTP accepts signed event into PostgreSQL adapter but never sends a reply',async t=>{
 const {createPrivateWebhookServer}=await import('../src/private-stage/webhook-server.mjs');
 const f=fakePool();const server=createPrivateWebhookServer({postgresIngestor:ingestor(f.pool),
  appSecret:APP_SECRET,verifyToken:'private-test-token'});
 const root=await server.start();t.after(()=>server.stop());
 const raw=body();const headers={'content-type':'application/json','x-hub-signature-256':sig(raw)};
 const result=await fetch(root+'/webhook',{method:'POST',headers,body:raw});
 assert.equal(result.status,200);assert.deepEqual(await result.json(),{statuses:['ACCEPTED']});
 const forged=await fetch(root+'/webhook',{method:'POST',headers:{...headers,'x-hub-signature-256':'sha256='+'0'.repeat(64)},body:raw});
 assert.equal(forged.status,401);
 const statuses=body({statuses:true});const ignored=await fetch(root+'/webhook',{method:'POST',headers:{...headers,'x-hub-signature-256':sig(statuses)},body:statuses});
 assert.equal(ignored.status,422,'status-only callbacks must not be falsely acknowledged');
});

test('provider message replay cannot silently change an image attachment reference',async()=>{
 const original=body({type:'image'});const initial=fakePool();
 await ingestor(initial.pool).ingest({rawBody:original,signature:sig(original)});
 const fp=initial.calls.find(x=>x.sql.includes('INSERT INTO musitu.inbound_events')).params.find(x=>/^[a-f0-9]{64}$/.test(String(x)));
 const tamperedObject=JSON.parse(original);tamperedObject.entry[0].changes[0].value.messages[0].image.id='DIFFERENT_MEDIA';
 const changed=Buffer.from(JSON.stringify(tamperedObject));
 await assert.rejects(ingestor(fakePool({duplicate:true,storedFingerprint:fp}).pool).ingest({rawBody:changed,signature:sig(changed)}),/MESSAGE_SENDER_OR_CONTENT_CONFLICT/);
});

test('signed provider timestamp is persisted as the only usable source for a customer-service session window',async()=>{
 const obj=JSON.parse(body());obj.entry[0].changes[0].value.messages[0].timestamp='1799999000';
 const raw=Buffer.from(JSON.stringify(obj)),f=fakePool();
 await ingestor(f.pool).ingest({rawBody:raw,signature:sig(raw)});
 const insert=f.calls.find(x=>x.sql.includes('INSERT INTO musitu.inbound_events'));
 assert.match(insert.sql,/provider_sent_at/);
 assert.equal(insert.params.at(-1),new Date(1799999000*1000).toISOString());
 const old=fakePool(),legacy=body();
 await ingestor(old.pool).ingest({rawBody:legacy,signature:sig(legacy)});
 assert.equal(old.calls.find(x=>x.sql.includes('INSERT INTO musitu.inbound_events')).params.at(-1),null);
 const bad=JSON.parse(raw);bad.entry[0].changes[0].value.messages[0].timestamp='invalid';
 const invalid=Buffer.from(JSON.stringify(bad)),rejected=fakePool();
 await assert.rejects(ingestor(rejected.pool).ingest({rawBody:invalid,signature:sig(invalid)}),/INVALID_META_TIMESTAMP/);
 assert.equal(rejected.calls.length,0);
});


test('authenticated STOP writes a durable Postgres opt-out instead of creating an FAQ draft',async()=>{
 const raw=body({text:' STOP '}),h=fakePool(),receipt=await ingestor(h.pool).ingest({rawBody:raw,signature:sig(raw)});
 assert.equal(receipt[0].draftStatus,'SUPPRESSED');
 const write=h.calls.find(c=>c.sql.includes('INSERT INTO musitu.customer_suppressions'));
 assert.ok(write,'must persist suppression in scoped database transaction');
 assert.equal(write.params[0],TA);
 assert.equal(h.calls.some(c=>c.sql.includes('INSERT INTO musitu.reply_drafts')),false);
 assert.equal(h.calls.at(-1).sql,'COMMIT');
 assert.match(h.calls.find(c=>c.sql.includes('SELECT conversation_id, handling_mode FROM musitu.conversations')).sql,/FOR UPDATE/);
});

test('persisted suppression blocks subsequent signed incoming FAQ even without STOP text',async()=>{
 const raw=body({text:'What hours?',messageId:'wamid.afterstop'}),h=fakePool({suppressed:true});
 const result=await ingestor(h.pool).ingest({rawBody:raw,signature:sig(raw)});
 assert.equal(result[0].draftStatus,'SUPPRESSED');
 assert.equal(h.calls.some(c=>c.sql.includes('FROM musitu.faqs')),false);
 assert.equal(h.calls.some(c=>c.sql.includes('INSERT INTO musitu.reply_drafts')),false);
});

test('a PostgreSQL STOP write failure rolls back all ingress rows',async()=>{
 const raw=body({text:'unsubscribe'}),h=fakePool({failAt:'INSERT INTO musitu.customer_suppressions'});
 await assert.rejects(ingestor(h.pool).ingest({rawBody:raw,signature:sig(raw)}),/SIMULATED_STORAGE_FAULT/);
 assert.equal(h.calls.some(c=>c.sql==='ROLLBACK'),true);
 assert.equal(h.calls.some(c=>c.sql==='COMMIT'),false);
});
