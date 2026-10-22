import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileStudioLedgers,normalizeStudioLedgerSnapshot,attestStudioLedgerSnapshot} from '../ledger_reconcile.mjs';
const key=Uint8Array.from({length:32},(_,i)=>i+1);
const job='b2222222-2222-4222-8222-222222222222';const project='a1111111-1111-4111-8111-111111111111';
function fixture(){return {complete:true,freeze_id:'synthetic-atomic-freeze-1',
 projects:[{id:project,title:'synthetic',owner_sub:'staff-1',created_at:'2026-10-21T00:00:00Z'}],
 memberships:[{project_id:project,member_sub:'staff-1',role:'owner',created_at:'2026-10-21T00:00:00Z'}],
 jobs:[{id:job,project_id:project,submission_key:'synthetic-key-2026',payload_json:'{"scene":"synthetic","objects":["cube"]}',payload_sha256:'a'.repeat(64),render_device:'CPU',state:'APPROVED',created_by_sub:'staff-1',approved_by_sub:'staff-1',dispatched_by_sub:null,call_id:null,error_code:null,created_at:'2026-10-21T00:00:00Z',approved_at:'2026-10-21T00:00:01Z',dispatched_at:null,finished_at:null}],
 assets:[],
 audit_events:[{id:'c3333333-3333-4333-8333-333333333333',project_id:project,job_id:job,action:'JOB_APPROVED_SINGLE_ADMIN',actor_sub:'staff-1',at:'2026-10-21T00:00:01Z',details:'{"single_admin":true}'}]
}}
const clone=x=>structuredClone(x);
function reconcile(a,b){return reconcileStudioLedgers(a,b,{integrityKey:key})}
function rejects(change,message){const a=fixture(),b=clone(a);change(b);assert.throws(()=>reconcile(a,b),message)}
test('fully frozen row-level transfer returns keyed digests without exposing source payload',()=>{
 const a=fixture(),b=clone(a);b.audit_events.reverse();
 const r=reconcile(a,b);
 assert.equal(r.verified,true);assert.equal(r.counts.jobs,1);
 assert.equal(r.table_hmac.jobs.length,64);
 assert.equal(JSON.stringify(r).includes('staff-1'),false);
 assert.equal(JSON.stringify(r).includes('synthetic-key'),false);
});
test('row-order changes do not alter integrity proof',()=>{
 const a=fixture(),b=clone(a);
 const second=clone(b.projects[0]);second.id='z1111111-1111-4111-8111-111111111111';
 second.owner_sub='staff-2';b.projects.push(second);a.projects.push(clone(second));
 const m=clone(b.memberships[0]);m.project_id=second.id;m.member_sub='staff-2';a.memberships.push(clone(m));b.memberships.push(m);
 b.projects.reverse();b.memberships.reverse();
 assert.equal(reconcile(a,b).verified,true);
});
test('one modified audit record fails even with identical row counts',()=>rejects(
 b=>{b.audit_events[0].details='{"single_admin":false}'},/LEDGER_CONTENT_MISMATCH_AUDIT_EVENTS/));
test('one modified project owner cannot sneak through intact row totals',()=>rejects(
 b=>{b.projects[0].owner_sub='staff-2'},/LEDGER_OWNER_MEMBERSHIP_MISSING/));
test('dropped asset, job or membership fails closed',()=>{
 rejects(b=>{b.jobs=[]},/LEDGER_AUDIT_JOB_ORPHAN/);
 rejects(b=>{b.memberships=[]},/LEDGER_OWNER_MEMBERSHIP_MISSING/);
 rejects(b=>{b.audit_events=[]},/LEDGER_APPROVAL_AUDIT_MISSING_OR_DUPLICATED/);
});
test('incomplete export cannot be reconciled',()=>rejects(
 b=>{b.complete=false},/LEDGER_PARTIAL_EXPORT/));
test('different freeze identifiers forbid cutover',()=>rejects(
 b=>{b.freeze_id='next-minute'},/LEDGER_FREEZE_ID_MISMATCH/));
test('unrecognized columns and missing tables fail before hashing',()=>{
 rejects(b=>{b.projects[0].unauthorized='secret'},/LEDGER_COLUMN_SET_MISMATCH/);
 rejects(b=>{delete b.audit_events},/LEDGER_TABLE_MISSING_OR_UNBOUNDED/);
});
test('duplicate primary key, dangling FK and malformed hash fail closed',()=>{
 rejects(b=>{b.projects.push(clone(b.projects[0]))},/LEDGER_DUPLICATE_PRIMARY_KEY/);
 rejects(b=>{b.jobs[0].project_id='orphan'},/LEDGER_JOB_ORPHAN/);
 rejects(b=>{b.jobs[0].payload_sha256='bad'},/LEDGER_JOB_HASH_INVALID/);
});
test('cannot reconcile a completed job without all artifact metadata',()=>rejects(
 b=>{b.jobs[0].state='COMPLETED'},/LEDGER_COMPLETED_ASSETS_MISSING/));
test('invalid approvals and missing audit attribution fail closed',()=>{
 rejects(b=>{b.jobs[0].approved_by_sub=null},/LEDGER_APPROVAL_MISSING/);
 rejects(b=>{b.audit_events[0].action='JOB_APPROVED'},/LEDGER_APPROVAL_AUDIT_MISSING_OR_DUPLICATED/);
});
test('never accept weak or missing HMAC key',()=>{
 const a=fixture();
 assert.throws(()=>reconcileStudioLedgers(a,clone(a)),/LEDGER_HMAC_KEY_REQUIRED/);
 assert.throws(()=>reconcileStudioLedgers(a,clone(a),{integrityKey:Buffer.alloc(12)}),/LEDGER_HMAC_KEY_TOO_SHORT/);
});
test('normalization is side-effect free',()=>{
 const a=fixture(),copy=clone(a);const normalized=normalizeStudioLedgerSnapshot(a);
 assert.equal(normalized.projects[0].id,project);
 assert.deepEqual(a,copy);
});

test('duplicate submission keys cannot pass even if both snapshots agree',()=>{
 const a=fixture();const j=clone(a.jobs[0]);j.id='b5555555-5555-4555-8555-555555555555';a.jobs.push(j);
 assert.throws(()=>reconcile(a,clone(a)),/LEDGER_DUPLICATE_SUBMISSION_KEY/);
});

test('separately attested snapshots expose freeze id and identical keyed digests',()=>{
 const a=fixture(),b=clone(a);
 const source=attestStudioLedgerSnapshot(a,{integrityKey:key});
 const target=attestStudioLedgerSnapshot(b,{integrityKey:key});
 assert.equal(source.schema,'musitu.studio.v03.neon.ledger-attestation.v2');
 assert.equal(source.freeze_id,a.freeze_id);
 assert.deepEqual(source.counts,target.counts);
 assert.deepEqual(source.table_hmac,target.table_hmac);
 assert.equal(reconcile(a,b).freeze_id,a.freeze_id);
 assert.doesNotMatch(JSON.stringify(source),/staff-1|synthetic-key|payload_json/);
});
test('snapshot attestation rejects even internally consistent orphaned audit and weak keys',()=>{
 const a=fixture();a.audit_events[0].job_id='unrelated';
 assert.throws(()=>attestStudioLedgerSnapshot(a,{integrityKey:key}),/LEDGER_AUDIT_JOB_ORPHAN/);
 assert.throws(()=>attestStudioLedgerSnapshot(fixture(),{integrityKey:Uint8Array.of(1)}),/LEDGER_HMAC_KEY_TOO_SHORT/);
});

test('HMAC domain binds each table digest to exact immutable freeze epoch',()=>{
 const a=fixture(),b=clone(a);b.freeze_id='synthetic-different-freeze-2';
 const left=attestStudioLedgerSnapshot(a,{integrityKey:key});
 const right=attestStudioLedgerSnapshot(b,{integrityKey:key});
 assert.notEqual(left.table_hmac.jobs,right.table_hmac.jobs);
 assert.notEqual(left.table_hmac.audit_events,right.table_hmac.audit_events);
 assert.equal(left.counts.jobs,right.counts.jobs);
});
