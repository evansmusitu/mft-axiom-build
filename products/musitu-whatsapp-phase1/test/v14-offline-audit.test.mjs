import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {PrivateStageStore} from '../src/private-stage/store.mjs';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'v14-stage-audit-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'stage.sqlite'),identityKey=Buffer.alloc(32,123);
 const store=new PrivateStageStore(path,{identityKey});t.after(()=>store.close());
 for(const c of ['A','B'])store.seedTenant({tenantId:'tenant-'+c,legalName:'Test '+c,ownerId:'owner-'+c,wabaId:'WABA_'+c,phoneNumberId:'PHONE_'+c});
 store.addResource('tenant-A','owner-A','room','Consultation');
 return {store,path,identityKey};
}
test('booking is audited exactly once and per-tenant audit is durable across restart',t=>{
 const {store,path,identityKey}=fixture(t);
 const args={tenantId:'tenant-A',actorId:'owner-A',resourceId:'room',startAt:'2026-11-20T08:00:00.000Z',endAt:'2026-11-20T08:30:00.000Z',effectKey:'audit-booking-1'};
 const booking=store.reserveBooking(args);store.reserveBooking(args);
 const events=store.listActionAudit('tenant-A','owner-A');
 assert.equal(events.length,1);
 assert.equal(events[0].action,'BOOKING_CREATED');assert.equal(events[0].actorId,'owner-A');assert.equal(events[0].referenceId,booking.bookingId);
 assert.deepEqual(store.listActionAudit('tenant-B','owner-B'),[]);
 assert.throws(()=>store.listActionAudit('tenant-A','owner-B'),/ACCESS_DENIED/);
 const reopened=new PrivateStageStore(path,{identityKey});t.after(()=>reopened.close());
 assert.deepEqual(reopened.listActionAudit('tenant-A','owner-A'),events);
});
test('independent SQLite write cannot silently change logged business action',t=>{
 const {store,path}=fixture(t);
 store.reserveBooking({tenantId:'tenant-A',actorId:'owner-A',resourceId:'room',startAt:'2026-11-21T08:00:00.000Z',endAt:'2026-11-21T08:30:00.000Z',effectKey:'audit-booking-2'});
 const direct=new DatabaseSync(path);t.after(()=>direct.close());
 assert.throws(()=>direct.exec("UPDATE stage_action_audit SET action='BOOKING_CANCELLED'"),/AUDIT_APPEND_ONLY/);
 assert.throws(()=>direct.exec('DELETE FROM stage_action_audit'),/AUDIT_APPEND_ONLY/);
 assert.equal(store.listActionAudit('tenant-A','owner-A')[0].action,'BOOKING_CREATED');
});
test('approved-source updates and channel revocation are audited without storing answer contents',t=>{
 const {store}=fixture(t);
 store.putFaq('tenant-A','owner-A','hours','When do you open?','Private commercial opening schedule');
 store.revokeChannel('tenant-A','owner-A','PHONE_A');
 store.revokeChannel('tenant-A','owner-A','PHONE_A');
 const events=store.listActionAudit('tenant-A','owner-A');
 assert.deepEqual(events.map(x=>x.action),['FAQ_SOURCE_UPDATED','CHANNEL_REVOKED']);
 assert.equal(events.map(x=>JSON.stringify(x)).some(x=>x.includes('Private commercial opening schedule')),false);
 assert.deepEqual(store.listActionAudit('tenant-B','owner-B'),[]);
});
test('HMAC chain detects a forged log record even if local SQLite DDL privileges bypass triggers',t=>{
 const {store,path}=fixture(t);
 store.reserveBooking({tenantId:'tenant-A',actorId:'owner-A',resourceId:'room',startAt:'2026-11-22T08:00:00.000Z',endAt:'2026-11-22T08:30:00.000Z',effectKey:'audit-booking-3'});
 const direct=new DatabaseSync(path);t.after(()=>direct.close());
 direct.exec('DROP TRIGGER prevent_audit_update');
 direct.exec("UPDATE stage_action_audit SET action='BOOKING_CANCELLED'");
 assert.throws(()=>store.listActionAudit('tenant-A','owner-A'),/STAGE_AUDIT_INTEGRITY_FAILURE/);
});
