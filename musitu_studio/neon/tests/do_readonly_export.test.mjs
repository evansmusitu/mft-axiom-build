import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFrozenStudioDoLedger} from '../do_readonly_export.mjs';
import {STUDIO_SOURCE_FREEZE_TRIGGER_SQL} from '../do_source_freeze.mjs';

const actor={sub:'synthetic-verified-access-staff-0001'};
const ownerSubjectSha256=createHash('sha256').update(actor.sub).digest('hex');
const freezeId='2cdab277-289e-43c0-a555-72910683690f';
const tables=['projects','memberships','jobs','assets','audit_events'];
function fixture({version=2,missingColumn=false,overflow=false}={}){
  let txCount=0,sqlCalls=[];
  const entries={
    projects:[{id:'synthetic-project',title:'Test',owner_sub:actor.sub,
      created_at:'2026-10-21T00:00:00Z'}],
    memberships:[{project_id:'synthetic-project',member_sub:actor.sub,
      role:'owner',created_at:'2026-10-21T00:00:00Z'}],
    jobs:[],assets:[],audit_events:[]
  };
  if(missingColumn)delete entries.projects[0].title;
  if(overflow)entries.projects=Array.from({length:25001},()=>({...entries.projects[0]}));
  const storage={
    transactionSync(fn){txCount++;return fn()},
    sql:{exec(s){
      sqlCalls.push(s);
      if(s.includes('MAX(version)'))return {one:()=>({n:version})};
      if(s.includes('sqlite_master'))return Object.entries(STUDIO_SOURCE_FREEZE_TRIGGER_SQL).map(([name,sql])=>({name,sql}));
      if(s.includes('issued_epoch'))return {one:()=>({freeze_id:freezeId,owner_sha256:ownerSubjectSha256,issued_epoch:1771470000,expires_epoch:1771470200,status:'active'})};
      if(s.includes('strftime('))return {one:()=>({epoch:1771470100})};
      const name=s.match(/ FROM (projects|memberships|jobs|assets|audit_events)$/)?.[1];
      if(!name)throw Error('SQL_NOT_ALLOWLISTED');
      return entries[name][Symbol.iterator]();
    }}
  };
  return {storage,calls:()=>({txCount,sqlCalls})};
}
const call=(f,opts={})=>readFrozenStudioDoLedger({
  storage:f.storage,actor,ownerSubjectSha256,freezeId,
  writesFrozen:true,staffJwtVerified:true,...opts
});
test('read-only source export is from one SQLite DO transaction, no external writes',async()=>{
 const f=fixture(),result=await call(f);
 assert.equal(result.complete,true);
 assert.equal(result.freeze_id,freezeId);
 assert.deepEqual(Object.keys(result).slice(2),tables);
 assert.equal(result.projects[0].owner_sub,actor.sub);
 assert.equal(f.calls().txCount,1);
 assert.equal(f.calls().sqlCalls.length,14);
 assert.ok(f.calls().sqlCalls.every(s=>/^\s*SELECT\s/i.test(s)));
 assert.equal(result.memberships[0].role,'owner');
});
test('without independently enforced freeze no database calls can occur',async()=>{
 const f=fixture();
 await assert.rejects(()=>call(f,{writesFrozen:false}),/EXPORT_MAINTENANCE_FREEZE_REQUIRED/);
 assert.equal(f.calls().txCount,0);
});
test('unverified staff or mismatched signed owner rejected before SQL',async()=>{
 for(const overrides of [
  {staffJwtVerified:false},
  {ownerSubjectSha256:'f'.repeat(64)},
  {actor:{sub:'other-attacker-actor-001'}},
  {actor:null}
 ]){
  const f=fixture();
  await assert.rejects(()=>call(f,overrides));
  assert.equal(f.calls().txCount,0);
 }
});
test('refuses malformed freeze IDs and missing cryptographic fingerprint',async()=>{
 for(const overrides of [{freezeId:'synthetic'},{freezeId:''},
  {ownerSubjectSha256:''},{ownerSubjectSha256:'0'.repeat(30)}]){
  const f=fixture();
  await assert.rejects(()=>call(f,overrides));
  assert.equal(f.calls().txCount,0);
 }
});
test('refuses out-of-date production SQLite schema rather than guessing columns',async()=>{
 const f=fixture({version:1});
 await assert.rejects(()=>call(f),/STUDIO_FREEZE_SCHEMA_VERSION_UNQUALIFIED/);
 assert.equal(f.calls().txCount,1);
 assert.equal(f.calls().sqlCalls.length,1);
});
test('unknown or missing source columns fail rather than output partial export',async()=>{
 const f=fixture({missingColumn:true});
 await assert.rejects(()=>call(f),/EXPORT_COLUMN_MISSING/);
 assert.equal(f.calls().txCount,1);
});
test('unbounded export must use a separate explicitly reviewed paging design',async()=>{
 const f=fixture({overflow:true});
 await assert.rejects(()=>call(f),/EXPORT_ROW_CAP_REQUIRES_PAGINATED_PLAN/);
 assert.equal(f.calls().txCount,1);
});
test('direct non-SQLite or missing DO transaction object fails closed',async()=>{
 const f=fixture();
 await assert.rejects(()=>call(f,{storage:{sql:f.storage.sql}}),/EXPORT_SQLITE_DO_REQUIRED/);
 assert.equal(f.calls().txCount,0);
});
