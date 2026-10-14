import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresTenantRepository} from '../src/postgres/tenant-repository.mjs';
const A='11111111-1111-4111-8111-111111111111';
const C='22222222-2222-4222-8222-222222222222';
const B='33333333-3333-4333-8333-333333333333';
const calls=[];
function mock(role='OWNER'){
 calls.length=0;
 return new PostgresTenantRepository({pool:{connect:async()=>({
  query:async(sql,params)=>{
   calls.push({sql,params});
   if(sql.includes('FROM musitu.memberships'))return {rows:[{role}]};
   if(sql.includes('SELECT booking_id,resource_id,start_at'))return {rows:[{booking_id:B,resource_id:C,start_at:new Date('2026-11-01T10:00:00.000Z'),end_at:new Date('2026-11-01T11:00:00.000Z'),source_idempotency_key:'k',status:'CONFIRMED'}]};
   if(sql.includes('FROM musitu.conversations AS c'))return {rows:[{conversation_id:C,phone_number_id:'CHANNEL',handling_mode:'BOT',suppressed:true}]};
   if(sql.includes('SELECT booking_id FROM musitu.bookings'))return {rows:[{booking_id:B}]};
   if(sql.includes('SELECT musitu.handover'))return {rows:[{changed:true}]};
   return {rows:[]};
  },release:()=>{calls.push({sql:'RELEASE'})}
 })}});
}
test('PostgreSQL console read paths use transaction-local tenant and authorized member',async()=>{
 const repo=mock();
 assert.equal((await repo.listBookings(A,'owner-a'))[0].bookingId,B);
 const [convo]=await repo.listConversations(A,'owner-a');
 assert.equal(convo.mode,'BOT');
 assert.equal(convo.suppressed,true);
 assert.ok(calls.some(c=>c.sql.includes('FROM musitu.customer_suppressions')));
 assert.equal(await repo.lookupBookingByEffectKey(A,'owner-a','k'),B);
 assert.equal(calls.filter(c=>c.sql.includes("set_config('app.tenant_id'")).length,3);
 assert.equal(calls.filter(c=>c.sql==='COMMIT').length,3);
 assert.equal(calls.filter(c=>c.sql==='RELEASE').length,3);
});
test('PostgreSQL human handover locks conversation and is prohibited for viewer',async()=>{
 const repo=mock();const result=await repo.handoverConversation({tenantId:A,actorId:'owner-a',conversationId:C});
 assert.equal(result.mode,'HUMAN');
 assert.ok(calls.some(c=>c.sql==='SELECT musitu.handover($1,$2) AS changed'));
 assert.ok(!calls.some(c=>c.sql.startsWith('UPDATE musitu.conversations')));
 const viewer=mock('VIEWER');await assert.rejects(viewer.handoverConversation({tenantId:A,actorId:'viewer-a',conversationId:C}),/ACCESS_DENIED/);
 assert.ok(calls.some(c=>c.sql==='ROLLBACK'));
 assert.ok(!calls.some(c=>c.sql.includes("SET handling_mode='HUMAN'")));
});
