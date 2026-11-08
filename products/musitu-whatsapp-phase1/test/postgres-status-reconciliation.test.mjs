import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {PostgresSignedWebhookIngestor} from '../src/postgres/signed-inbound.mjs';
import {createPrivateWebhookServer} from '../src/private-stage/webhook-server.mjs';

const A='00000000-0000-4000-8000-00000000000a';
const B='00000000-0000-4000-8000-00000000000b';
const SECRET='dev-only-not-for-provider';
const KEY=Buffer.alloc(32,41);
const BINDINGS=[{tenantId:A,wabaId:'WABA_A',phoneNumberId:'PHONE_A'}, {tenantId:B,wabaId:'WABA_B',phoneNumberId:'PHONE_B'}];
const RECIPIENT='263771234567';
const hashRecipient=(tenant,phone,recipient)=>'hmac256:'+createHmac('sha256',KEY).update(JSON.stringify(['remote',tenant,phone,recipient])).digest('hex');
const sign=raw=>'sha256='+createHmac('sha256',SECRET).update(raw).digest('hex');
const single=({id='wamid.outbound.1',status='delivered',timestamp='1799999000',recipient=RECIPIENT,phone='PHONE_A',waba='WABA_A',extra}={})=>({id,status,timestamp,recipient_id:recipient,...(extra?{errors:[{code:1999,title:extra}]}:{})});
function statusBody({waba='WABA_A',phone='PHONE_A',statuses=[single()],messages}={}){
 const value={metadata:{phone_number_id:phone},statuses};
 if(messages!==undefined)value.messages=messages;
 return Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:waba,changes:[{field:'messages',value}]}]}));
}
function fakePool({state='ACCEPTED',recipientHash=hashRecipient(A,'PHONE_A',RECIPIENT),known=true,existing=false,existingFingerprint,failAt}={}){
 const calls=[],released=[],events=new Map(),attempt={status:state,recipient_hash:recipientHash};
 const client={
  async query(sql,params=[]){
   calls.push({sql,params});
   if(failAt&&sql.includes(failAt))throw new Error('SIMULATED_DB_ERROR');
   if(sql.includes('FROM musitu.tenants'))return {rows:[{id:A}]};
   if(sql.includes('FROM musitu.whatsapp_channels'))return {rows:[{phone_number_id:'PHONE_A'}]};
   if(sql.includes('FROM musitu.outbound_attempts')&&sql.includes('FOR UPDATE'))return {rows:known?[{...attempt}]:[]};
   if(sql.includes('INSERT INTO musitu.message_status_events')){
    const eventKey=JSON.stringify([params[0],params[1],params[2],params[3],params[4]]);
    if(existing||events.has(eventKey))return {rows:[]};
    events.set(eventKey,params[5]);return {rows:[{provider_message_id:params[2]}]};
   }
   if(sql.includes('FROM musitu.message_status_events'))return {rows:[{payload_fingerprint:existingFingerprint||[...events.values()][0]}]};
   if(sql.includes('UPDATE musitu.outbound_attempts')){attempt.status=params[3];return {rowCount:1,rows:[]};}
   return {rows:[]};
  },
  release(reason){released.push(reason);}
 };
 return {pool:{connect:async()=>client},calls,released,attempt,bindProviderId(){known=true;}};
}
function ingestor(pool){return new PostgresSignedWebhookIngestor({pool,appSecret:SECRET,privacyKey:KEY,bindings:BINDINGS});}

test('signed, known Meta status is verified and changes only matching tenant outbound attempt',async()=>{
 const db=fakePool();const raw=statusBody();const receipt=await ingestor(db.pool).ingest({rawBody:raw,signature:sign(raw)});
 assert.equal(receipt.length,1);assert.deepEqual(receipt[0],{tenantId:A,phoneNumberId:'PHONE_A',providerMessageId:'wamid.outbound.1',status:'DELIVERED',result:'RECORDED'});
 assert.equal(db.attempt.status,'DELIVERED');
 assert.deepEqual(db.calls.map(x=>x.sql).filter(x=>x==='BEGIN'||x==='COMMIT'),['BEGIN','COMMIT']);
 assert.deepEqual(db.calls.find(x=>x.sql.includes("set_config('app.tenant_id'"))?.params,[A]);
 assert.equal(db.calls.find(x=>x.sql.includes('FOR UPDATE')).params[0],A);
 assert.ok(db.calls.some(x=>x.sql.includes('INSERT INTO musitu.message_status_events')));
 assert.equal(JSON.stringify(db.calls).includes(RECIPIENT),false,'raw recipient never appears in SQL arguments');
 assert.equal(db.released.length,1);
});

test('padded signed status id is matched byte for byte and still requires known binding',async()=>{
 const id='wamid.SYNTHETIC+/==',raw=statusBody({statuses:[single({id})]}),db=fakePool();
 const result=await ingestor(db.pool).ingest({rawBody:raw,signature:sign(raw)});
 assert.equal(result[0].providerMessageId,id);assert.equal(db.attempt.status,'DELIVERED');
 assert.equal(db.calls.find(x=>x.sql.includes('FROM musitu.outbound_attempts')).params[2],id);
 const unknown=fakePool({known:false});
 await assert.rejects(ingestor(unknown.pool).ingest({rawBody:raw,signature:sign(raw)}),/UNKNOWN_OR_UNBOUND_OUTBOUND/);
 assert.equal(unknown.calls.some(x=>x.sql.includes('INSERT INTO musitu.message_status_events')),false);
});

test('unknown, wrong-recipient, and missing-recipient statuses fail closed without ACK or ledger writes',async()=>{
 for(const opts of [{known:false},{recipientHash:hashRecipient(B,'PHONE_B',RECIPIENT)},{recipientHash:null}]){
  const db=fakePool(opts),raw=statusBody();
  await assert.rejects(ingestor(db.pool).ingest({rawBody:raw,signature:sign(raw)}),/UNKNOWN_OR_UNBOUND_OUTBOUND/);
  assert.equal(db.calls.some(x=>x.sql.includes('INSERT INTO musitu.message_status_events')),false);
  assert.equal(db.calls.some(x=>x.sql==='ROLLBACK'),true);
 }
 const malformed=statusBody({statuses:[single({recipient:'not-a-number'})]});
 const db=fakePool();await assert.rejects(ingestor(db.pool).ingest({rawBody:malformed,signature:sign(malformed)}),/INVALID_META_STATUS/);
 assert.equal(db.calls.length,0);
});

test('exact duplicate callbacks are idempotent, but conflicting replays fail closed',async()=>{
 const raw=statusBody(),first=fakePool();
 await ingestor(first.pool).ingest({rawBody:raw,signature:sign(raw)});
 const saved=first.calls.find(x=>x.sql.includes('INSERT INTO musitu.message_status_events')).params[5];
 const second=fakePool({state:'DELIVERED',existing:true,existingFingerprint:saved});
 const replay=await ingestor(second.pool).ingest({rawBody:raw,signature:sign(raw)});
 assert.equal(replay[0].result,'DUPLICATE');
 assert.equal(second.calls.some(x=>x.sql.includes('UPDATE musitu.outbound_attempts')),false);
 const conflict=statusBody({statuses:[single({extra:'altered error'})]});
 const third=fakePool({existing:true,existingFingerprint:saved});
 await assert.rejects(ingestor(third.pool).ingest({rawBody:conflict,signature:sign(conflict)}),/STATUS_REPLAY_CONFLICT/);
});

test('receipt arriving before provider-id binding can be redelivered afterward without duplicate effects',async()=>{
 const db=fakePool({known:false}),raw=statusBody(),receiver=ingestor(db.pool);
 await assert.rejects(receiver.ingest({rawBody:raw,signature:sign(raw)}),/UNKNOWN_OR_UNBOUND_OUTBOUND/);
 assert.equal(db.calls.filter(x=>x.sql==='ROLLBACK').length,1);
 assert.equal(db.calls.filter(x=>x.sql==='COMMIT').length,0);
 assert.equal(db.calls.some(x=>x.sql.includes('INSERT INTO musitu.message_status_events')),false);
 assert.equal(db.attempt.status,'ACCEPTED');
 // Simulate the sender committing the verified provider ID, then Meta
 // redelivering the identical signed receipt. This is not a real receipt.
 db.bindProviderId();
 const accepted=await receiver.ingest({rawBody:raw,signature:sign(raw)});
 assert.equal(accepted[0].result,'RECORDED');
 assert.equal(db.attempt.status,'DELIVERED');
 const replay=await receiver.ingest({rawBody:raw,signature:sign(raw)});
 assert.equal(replay[0].result,'DUPLICATE');
 assert.equal(db.calls.filter(x=>x.sql.includes('UPDATE musitu.outbound_attempts')).length,1);
 assert.equal(db.calls.filter(x=>x.sql==='COMMIT').length,2);
});

test('late sent after delivered cannot downgrade; read preserves delivered and records event',async()=>{
 const db=fakePool({state:'DELIVERED'}),raw=statusBody({statuses:[single({status:'sent'})]});
 const result=await ingestor(db.pool).ingest({rawBody:raw,signature:sign(raw)});
 assert.equal(result[0].result,'RECORDED');assert.equal(db.attempt.status,'DELIVERED');
 assert.equal(db.calls.some(x=>x.sql.includes('UPDATE musitu.outbound_attempts')),false);
 const read=fakePool({state:'DELIVERED'}),reading=statusBody({statuses:[single({status:'read'})]});
 const receipt=await ingestor(read.pool).ingest({rawBody:reading,signature:sign(reading)});
 assert.equal(receipt[0].status,'READ');assert.equal(read.attempt.status,'DELIVERED');
});

test('failure after delivery and delivery after terminal failure are rejected, not silently overwritten',async()=>{
 for(const [state,status] of [['DELIVERED','failed'],['FAILED','delivered'],['FAILED','read']]){
  const db=fakePool({state}),raw=statusBody({statuses:[single({status})]});
  await assert.rejects(ingestor(db.pool).ingest({rawBody:raw,signature:sign(raw)}),/STATUS_STATE_CONFLICT/);
  assert.equal(db.calls.some(x=>x.sql==='ROLLBACK'),true);
 }
});

test('mixed messages and statuses and multi-tenant batches fail before database access',async()=>{
 const db=fakePool();
 const mixed=statusBody({messages:[{id:'wamid.input.1',from:RECIPIENT,type:'text',text:{body:'hi'}}]});
 await assert.rejects(ingestor(db.pool).ingest({rawBody:mixed,signature:sign(mixed)}),/MIXED_META_EVENT_TYPES/);
 const batch=JSON.parse(statusBody().toString('utf8'));
 batch.entry.push(JSON.parse(statusBody({waba:'WABA_B',phone:'PHONE_B',statuses:[single()]})).entry[0]);
 const raw=Buffer.from(JSON.stringify(batch));
 await assert.rejects(ingestor(db.pool).ingest({rawBody:raw,signature:sign(raw)}),/MULTI_TENANT_BATCH_DENIED/);
 assert.equal(db.calls.length,0);
});

test('database failures roll back an entire status batch and release the connection',async()=>{
 const db=fakePool({failAt:'INSERT INTO musitu.message_status_events'}),raw=statusBody();
 await assert.rejects(ingestor(db.pool).ingest({rawBody:raw,signature:sign(raw)}),/SIMULATED_DB_ERROR/);
 assert.equal(db.calls.some(x=>x.sql==='COMMIT'),false);
 assert.equal(db.calls.some(x=>x.sql==='ROLLBACK'),true);
 assert.equal(db.released.length,1);
});

test('private HTTP receiver acknowledges known signed statuses but rejects unknown ids and forged callbacks',async t=>{
 const known=fakePool();const server=createPrivateWebhookServer({postgresIngestor:ingestor(known.pool),appSecret:SECRET,verifyToken:'local-only'});
 const root=await server.start();t.after(()=>server.stop());
 const raw=statusBody(),headers={'content-type':'application/json','x-hub-signature-256':sign(raw)};
 const ok=await fetch(root+'/webhook',{method:'POST',headers,body:raw});
 assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{statuses:['DELIVERED']});
 const bad=await fetch(root+'/webhook',{method:'POST',headers:{...headers,'x-hub-signature-256':'sha256='+'0'.repeat(64)},body:raw});assert.equal(bad.status,401);
 const other=fakePool({known:false});const s2=createPrivateWebhookServer({postgresIngestor:ingestor(other.pool),appSecret:SECRET,verifyToken:'local-only'});
 const root2=await s2.start();t.after(()=>s2.stop());
 const unknown=await fetch(root2+'/webhook',{method:'POST',headers,body:raw});assert.equal(unknown.status,422);
});
