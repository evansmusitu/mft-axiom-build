import test from 'node:test';
import assert from 'node:assert/strict';
import {compileStudioPgSql,createStudioNeonPgAdapter} from '../neon_pg_adapter.mjs';
function fixture({updatedRows=1,auditFails=false,noRowCount=false}={}){
 const logs=[],connections=[];
 const makeClient=()=>{
  const log=[],client={
   async connect(){log.push({action:'CONNECT'})},
   async end(){log.push({action:'END'})},
   async query(sql,params=[]){
    log.push({action:'QUERY',sql,params});
    if(auditFails&&sql.startsWith('INSERT INTO audit_events'))throw Error('AUDIT_WRITE_FAILED');
    if(sql.startsWith('UPDATE jobs'))return noRowCount?{rows:[]}:{rowCount:updatedRows,rows:[]};
    if(sql.startsWith('INSERT INTO audit_events'))return {rowCount:1,rows:[]};
    if(sql.startsWith('SELECT'))return {rowCount:1,rows:[{id:'synthetic',n:'1'}]};
    return {rowCount:0,rows:[]};
   }
  };connections.push(log);return client;
 };
 return {db:createStudioNeonPgAdapter({makeClient}),logs,connections};
}
const updateSql="UPDATE jobs SET state='APPROVED',approved_by_sub=?,approved_at=? WHERE id=? AND state='PENDING_APPROVAL'";
const auditSql="INSERT INTO audit_events(id,project_id,job_id,action,actor_sub,at,details) SELECT ?,?,?,?,?,?,? WHERE changes()=1";
function updates(db){return [
 db.prepare(updateSql).bind('person-a','2026-10-21T00:00:00Z','test-job'),
 db.prepare(auditSql).bind('audit-id','project-id','test-job','JOB_APPROVED_SINGLE_ADMIN',
  'person-a','2026-10-21T00:00:00Z','{"independent_reviewer":false}')
]}
test('question markers compile only outside SQL string literals',()=>{
 const compiled=compileStudioPgSql("SELECT '?' AS literal, column FROM jobs WHERE id=? AND owner_sub='it''s?'");
 assert.equal(compiled.text,"SELECT '?' AS literal, column FROM jobs WHERE id=$1 AND owner_sub='it''s?'");
 assert.equal(compiled.parameters,1);
});
test('cannot execute unreviewed DDL, SQLite date operations or stacked SQL',()=>{
 for(const sql of ['DELETE FROM audit_events','DROP TABLE jobs','SELECT 1; UPDATE jobs SET state=?',
  "UPDATE jobs SET dispatched_at=date(substr(?,1,10),'+1 day')"])
  assert.throws(()=>compileStudioPgSql(sql));
});
test('atomic approved state inserts audit iff exactly one row updated',async()=>{
 const {db,connections}=fixture({updatedRows:1});
 const result=await db.batch(updates(db));
 assert.equal(result[0].meta.changes,1);
 assert.equal(result[1].meta.changes,1);
 const events=connections[0];
 assert.equal(events.filter(x=>x.sql?.startsWith('INSERT INTO audit_events')).length,1);
 assert.equal(events.filter(x=>x.sql==='BEGIN ISOLATION LEVEL SERIALIZABLE').length,1);
 assert.equal(events.filter(x=>x.sql==='COMMIT').length,1);
 assert.equal(events.filter(x=>x.sql==='ROLLBACK').length,0);
 assert.equal(events[0].action,'CONNECT');
 assert.equal(events.at(-1).action,'END');
});
test('stale approval compare-and-set never creates a false audit',async()=>{
 const {db,connections}=fixture({updatedRows:0});
 const r=await db.batch(updates(db));
 assert.equal(r[0].meta.changes,0);
 assert.equal(r[1].meta.changes,0);
 assert.equal(connections[0].filter(x=>x.sql?.startsWith('INSERT INTO audit_events')).length,0);
 assert.equal(connections[0].filter(x=>x.sql==='COMMIT').length,1);
});
test('audit insert failure rolls back the prior approval update',async()=>{
 const {db,connections}=fixture({updatedRows:1,auditFails:true});
 await assert.rejects(()=>db.batch(updates(db)),/AUDIT_WRITE_FAILED/);
 assert.equal(connections[0].filter(x=>x.sql==='ROLLBACK').length,1);
 assert.equal(connections[0].filter(x=>x.sql==='COMMIT').length,0);
 assert.equal(connections[0].at(-1).action,'END');
});
test('missing provider row count fails closed and rolls back',async()=>{
 const {db,connections}=fixture({updatedRows:1,noRowCount:true});
 await assert.rejects(()=>db.batch(updates(db)),/NEON_ROWCOUNT_MISSING_FAIL_CLOSED/);
 assert.equal(connections[0].filter(x=>x.sql==='ROLLBACK').length,1);
});
test('standalone parameterized read is scoped to the studio_v03 database schema',async()=>{
 const {db,connections}=fixture();
 const result=await db.prepare('SELECT id FROM jobs WHERE id=?').bind('job').first();
 assert.equal(result.id,'synthetic');
 assert.equal(connections[0][1].sql,'SET search_path TO studio_v03, pg_catalog');
 assert.equal(connections[0][2].sql,'SELECT id FROM jobs WHERE id=$1');
 assert.deepEqual(connections[0][2].params,['job']);
});
test('batch cannot disguise conditional state changes as unrelated audit operations',async()=>{
 const {db}=fixture();
 await assert.rejects(()=>db.batch([
  db.prepare('UPDATE jobs SET state=? WHERE id=?').bind('APPROVED','job'),
  db.prepare("INSERT INTO jobs(id) SELECT ? WHERE changes()=1").bind('fake')
 ]),/NEON_CONDITIONAL_AUDIT_MISUSED/);
});
test('batch limits and parameter count are fail closed',async()=>{
 const {db}=fixture();
 await assert.rejects(()=>db.batch([]),/NEON_BATCH_LIMIT/);
 await assert.rejects(()=>db.batch(Array.from({length:17},()=>db.prepare('SELECT 1').bind())),/NEON_BATCH_LIMIT/);
 await assert.rejects(()=>db.prepare('SELECT id FROM jobs WHERE id=?').bind().first(),/NEON_PARAMETER_MISMATCH/);
});

test('conditional audit refuses success from a membership update even if one row changed',async()=>{
 const {db,connections}=fixture({updatedRows:1});
 await assert.rejects(()=>db.batch([
   db.prepare('UPDATE memberships SET role=? WHERE member_sub=?').bind('owner','person-a'),
   db.prepare(auditSql).bind('audit-id','project-id','test-job','JOB_APPROVED',
     'person-a','2026-10-21T00:00:00Z','{}')
 ]),/NEON_AUDIT_REQUIRES_PRECEDING_JOB_UPDATE/);
 assert.equal(connections[0].filter(x=>x.sql==='ROLLBACK').length,1);
});
test('conditional audit refuses mismatched job reference, rolls back update',async()=>{
 const {db,connections}=fixture({updatedRows:1});
 await assert.rejects(()=>db.batch([
   db.prepare(updateSql).bind('person-a','2026-10-21T00:00:00Z','test-job'),
   db.prepare(auditSql).bind('audit-id','project-id','DIFFERENT-JOB','JOB_APPROVED',
     'person-a','2026-10-21T00:00:00Z','{}')
 ]),/NEON_AUDIT_JOB_MISMATCH/);
 assert.equal(connections[0].filter(x=>x.sql==='COMMIT').length,0);
 assert.equal(connections[0].filter(x=>x.sql==='ROLLBACK').length,1);
});
test('connection cleanup runs even if PostgreSQL connect rejects',async()=>{
 let ended=0;
 const db=createStudioNeonPgAdapter({makeClient:()=>({
   connect:async()=>{throw Error('NO_CONNECT')},query:async()=>{},end:async()=>{ended++}
 })});
 await assert.rejects(()=>db.prepare('SELECT id FROM jobs WHERE id=?').bind('job').first(),/NO_CONNECT/);
 assert.equal(ended,1);
});

test('audit identity cannot be laundered via an unrelated UPDATE assignment value',async()=>{
 const {db,connections}=fixture({updatedRows:1});
 await assert.rejects(()=>db.batch([
  db.prepare("UPDATE jobs SET approved_by_sub=? WHERE id=?").bind('DIFFERENT-JOB','test-job'),
  db.prepare(auditSql).bind('audit-id','project-id','DIFFERENT-JOB','JOB_APPROVED',
    'person-a','2026-10-21T00:00:00Z','{}')
 ]),/NEON_AUDIT_JOB_MISMATCH/);
 assert.equal(connections[0].filter(x=>x.sql==='ROLLBACK').length,1);
});
