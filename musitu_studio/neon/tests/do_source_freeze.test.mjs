import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ENTERPRISE_SCHEMA_1,ENTERPRISE_SCHEMA_2} from '../../edge/src/v03_do_schema.mjs';
import {readFrozenStudioDoLedger} from '../do_readonly_export.mjs';
import {attestStudioLedgerSnapshot} from '../ledger_reconcile.mjs';
import {STUDIO_SOURCE_FREEZE_SETUP_SQL,STUDIO_SOURCE_FREEZE_TRIGGER_SQL,
  assertStudioSourceWriteFreeze,acquireStudioSourceWriteFreeze,
  releaseStudioSourceWriteFreeze} from '../do_source_freeze.mjs';
const actor={sub:'synthetic-signed-owner-probe-0001'};
const fingerprint=createHash('sha256').update(actor.sub).digest('hex');
function fakeSqlStorage(db){
 const storage={sql:{exec(statement,...params){
   const st=db.prepare(statement);
   if(/^\s*SELECT\b/i.test(statement)){
     const rows=st.all(...params);
     return {one(){return rows[0]},[Symbol.iterator](){return rows[Symbol.iterator]()}};
   }
   st.run(...params);
   return {one(){return undefined},[Symbol.iterator](){return [][Symbol.iterator]()}};
 }},transactionSync(fn){
   db.exec('BEGIN IMMEDIATE');
   try{const result=fn();db.exec('COMMIT');return result}
   catch(e){db.exec('ROLLBACK');throw e}
 }};
 return storage;
}
function fixture({installed=true,withOwner=true}={}){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 db.exec('CREATE TABLE _studio_schema_versions(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)');
 db.exec(ENTERPRISE_SCHEMA_1);db.exec(ENTERPRISE_SCHEMA_2);
 db.exec("INSERT INTO _studio_schema_versions VALUES(2,'2026-10-22')");
 db.prepare('INSERT INTO projects(id,title,owner_sub,created_at) VALUES(?,?,?,?)')
   .run('p','Synthetic Project',actor.sub,'2026-10-22');
 if(withOwner)db.prepare('INSERT INTO memberships(project_id,member_sub,role,created_at) VALUES(?,?,?,?)')
   .run('p',actor.sub,'owner','2026-10-22');
 db.prepare('INSERT INTO jobs(id,project_id,submission_key,payload_json,payload_sha256,render_device,state,created_by_sub,approved_by_sub,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run('b2222222-2222-4222-8222-222222222222','p','job-frozen-synthetic','{\"scene\":\"synthetic\",\"objects\":[\"cube\"]}', 'a'.repeat(64),'CPU','RUNNING',actor.sub,actor.sub,'2026-10-22');
 db.prepare('INSERT INTO assets(job_id,filename,object_key,sha256,bytes) VALUES(?,?,?,?,?)')
   .run('b2222222-2222-4222-8222-222222222222','scene.blend','studio-v03/jobs/b2222222-2222-4222-8222-222222222222/scene.blend','b'.repeat(64),2048);
 db.prepare('INSERT INTO audit_events(id,project_id,job_id,action,actor_sub,at,details) VALUES(?,?,?,?,?,?,?)')
   .run('audit-synthetic','p','b2222222-2222-4222-8222-222222222222','JOB_APPROVED_SINGLE_ADMIN',actor.sub,'2026-10-22','{}');
 if(installed)db.exec(STUDIO_SOURCE_FREEZE_SETUP_SQL);
 return {db,storage:fakeSqlStorage(db)};
}
async function acquire(storage,override={}){return acquireStudioSourceWriteFreeze({
 storage,actor,ownerSubjectSha256:fingerprint,staffJwtVerified:true,...override});}
async function release(storage,freeze,override={}){return releaseStudioSourceWriteFreeze({
 storage,actor,ownerSubjectSha256:fingerprint,staffJwtVerified:true,freezeId:freeze.freeze_id,...override});}
async function read(storage,freeze,override={}){return readFrozenStudioDoLedger({
 storage,actor,ownerSubjectSha256:fingerprint,staffJwtVerified:true,
 freezeId:freeze.freeze_id,writesFrozen:true,...override});}
test('real SQLite: installed write fence blocks ALL five tables during active lease',async()=>{
 const f=fixture();try{
  const freeze=await acquire(f.storage);
  assert.equal(freeze.triggers_verified,15);
  for(const table of ['projects','memberships','jobs','assets','audit_events']){
    assert.throws(()=>f.db.exec(`DELETE FROM ${table}`),/STUDIO_MIGRATION_WRITES_FROZEN/,table);
    const col={projects:'title',memberships:'role',jobs:'state',assets:'bytes',audit_events:'details'}[table];
    assert.throws(()=>f.db.exec(`UPDATE ${table} SET ${col}=${col}`),/STUDIO_MIGRATION_WRITES_FROZEN|AUDIT_IMMUTABLE/,table);
  }
  assert.throws(()=>f.db.exec("INSERT INTO audit_events(id,project_id,action,at) VALUES('evt','p','TEST','2026-10-22')"),/STUDIO_MIGRATION_WRITES_FROZEN/);
  assert.throws(()=>f.db.exec("INSERT INTO projects(id,title,owner_sub,created_at) VALUES('new','Test','signed','2026-10-22')"),/STUDIO_MIGRATION_WRITES_FROZEN/);
  const l=await read(f.storage,freeze);
  assert.equal(l.complete,true);assert.equal(l.freeze_id,freeze.freeze_id);
  assert.equal(l.projects.length,1);assert.equal(l.memberships.length,1);assert.equal(l.jobs.length,1);assert.equal(l.assets.length,1);
  const r=attestStudioLedgerSnapshot(l,{integrityKey:new Uint8Array(32).fill(6)});
  assert.equal(r.counts.projects,1);assert.equal(r.table_hmac.projects.length,64);
 }finally{f.db.close()}
});
test('real SQLite: malformed or absent installed freeze denies export before data read',async()=>{
 for(const installed of [false,true]){
  const f=fixture({installed});try{
   if(!installed){await assert.rejects(()=>acquire(f.storage),/STUDIO_FREEZE_TRIGGERS_UNQUALIFIED|no such table/)}
   else {const lease=await acquire(f.storage);
     await assert.rejects(()=>read(f.storage,lease,{freezeId:crypto.randomUUID()}),/STUDIO_FREEZE_NOT_ACTIVE/)}
  }finally{f.db.close()}
 }
});
test('real SQLite: concurrent lease denied; owner can explicitly release; replay rejected',async()=>{
 const f=fixture();try{
  const a=await acquire(f.storage);
  await assert.rejects(()=>acquire(f.storage),/STUDIO_FREEZE_ALREADY_HELD/);
  assert.equal((await release(f.storage,a)).released,true);
  f.db.prepare('INSERT INTO projects(id,title,owner_sub,created_at) VALUES(?,?,?,?)')
    .run('after','Test',actor.sub,'2026-10-22');
  f.db.prepare('INSERT INTO memberships(project_id,member_sub,role,created_at) VALUES(?,?,?,?)')
    .run('after',actor.sub,'owner','2026-10-22');
  await assert.rejects(()=>read(f.storage,a),/STUDIO_FREEZE_NOT_ACTIVE/);
  const b=await acquire(f.storage);
  await assert.rejects(()=>release(f.storage,a),/STUDIO_FREEZE_RELEASE_EPOCH_MISMATCH/);
  assert.equal(assertStudioSourceWriteFreeze(f.storage,{freezeId:b.freeze_id,ownerSubjectSha256:fingerprint}).writable,false);
 }finally{f.db.close()}
});
test('real SQLite: expired freeze allows writes but cannot authorize a frozen export',async()=>{
 const f=fixture();try{
  const a=await acquire(f.storage);
  f.db.exec('UPDATE _studio_export_freeze SET expires_epoch=0 WHERE lock_id=1');
  f.db.exec("INSERT INTO projects(id,title,owner_sub,created_at) VALUES('later','Unfrozen','actor','2026-10-22')");
  await assert.rejects(()=>read(f.storage,a),/STUDIO_FREEZE_NOT_ACTIVE/);
 }finally{f.db.close()}
});
test('real SQLite: altered trigger body is detected before export, even if named correctly',async()=>{
 const f=fixture();try{
  const a=await acquire(f.storage);
  const name='studio_v03_export_freeze_projects_insert';
  assert.ok(Object.hasOwn(STUDIO_SOURCE_FREEZE_TRIGGER_SQL,name));
  f.db.exec(`DROP TRIGGER ${name}`);
  f.db.exec(`CREATE TRIGGER ${name} BEFORE INSERT ON projects BEGIN SELECT 1; END;`);
  await assert.rejects(()=>read(f.storage,a),/STUDIO_FREEZE_TRIGGERS_UNQUALIFIED/);
 }finally{f.db.close()}
});
test('real SQLite: owner membership, JWT claim, short TTL and wrong actor fail closed',async()=>{
 const f=fixture({withOwner:false});try{
  await assert.rejects(()=>acquire(f.storage),/STUDIO_FREEZE_OWNER_MEMBERSHIP_REQUIRED/);
  await assert.rejects(()=>acquire(f.storage,{staffJwtVerified:false}),/STUDIO_FREEZE_SIGNED_OWNER_REQUIRED/);
  await assert.rejects(()=>acquire(f.storage,{ttlSeconds:500}),/STUDIO_FREEZE_TTL_DENIED/);
  await assert.rejects(()=>acquire(f.storage,{ownerSubjectSha256:'a'.repeat(64)}),/STUDIO_FREEZE_OWNER_MISMATCH/);
 }finally{f.db.close()}
});

// The write fence is global to the entire single Durable Object, not per project.
// A co-owner or owner of only some projects must NOT freeze all other tenants.
test('real SQLite: partial owner of multi-project DO cannot lock another project',async()=>{
 const f=fixture();try{
  f.db.prepare('INSERT INTO projects(id,title,owner_sub,created_at) VALUES(?,?,?,?)')
    .run('p-other','Other owner data','independent-owner-sub','2026-10-22');
  f.db.prepare('INSERT INTO memberships(project_id,member_sub,role,created_at) VALUES(?,?,?,?)')
    .run('p-other','independent-owner-sub','owner','2026-10-22');
  await assert.rejects(()=>acquire(f.storage),/STUDIO_FREEZE_SINGLE_OWNER_SCOPE_REQUIRED/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM _studio_export_freeze').get().n,0);
 }finally{f.db.close()}
});
test('real SQLite: presence of an additional co-owner forbids global freeze',async()=>{
 const f=fixture();try{
  f.db.prepare('INSERT INTO memberships(project_id,member_sub,role,created_at) VALUES(?,?,?,?)')
    .run('p','co-owner-subject','owner','2026-10-22');
  await assert.rejects(()=>acquire(f.storage),/STUDIO_FREEZE_SINGLE_OWNER_SCOPE_REQUIRED/);
 }finally{f.db.close()}
});
test('real SQLite: same sole owner across several projects can freeze full DO',async()=>{
 const f=fixture();try{
  f.db.prepare('INSERT INTO projects(id,title,owner_sub,created_at) VALUES(?,?,?,?)')
    .run('p-two','Second controlled project',actor.sub,'2026-10-22');
  f.db.prepare('INSERT INTO memberships(project_id,member_sub,role,created_at) VALUES(?,?,?,?)')
    .run('p-two',actor.sub,'owner','2026-10-22');
  const lease=await acquire(f.storage);
  assert.equal(lease.triggers_verified,15);
  assert.throws(()=>f.db.exec("UPDATE projects SET title='changed' WHERE id='p-two'"),
    /STUDIO_MIGRATION_WRITES_FROZEN/);
 }finally{f.db.close()}
});
