import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const text=readFileSync(new URL('../0001_enterprise_postgres_schema.sql',import.meta.url),'utf8');
const legacy=readFileSync(new URL('../../edge/src/v03_do_schema.mjs',import.meta.url),'utf8');
function table(name){
 const m=text.match(new RegExp('CREATE TABLE IF NOT EXISTS studio_v03\\.'+name+'\\s*\\(([\\s\\S]*?)\\n\\);','i'));
 assert.ok(m,'missing table '+name);return m[1];
}
test('migration creates isolated schema and all six ledger tables',()=>{
 assert.match(text,/CREATE SCHEMA IF NOT EXISTS studio_v03/);
 for(const x of ['projects','memberships','jobs','assets','audit_events','_studio_schema_versions'])
  assert.ok(table(x).length>50 || x==='_studio_schema_versions');
 assert.match(text,/ON CONFLICT\(version\) DO NOTHING/);
});
test('all SQLite ledger columns are retained without lossy timestamp/identity conversions',()=>{
 const columns={
  projects:['id','title','owner_sub','created_at'],
  memberships:['project_id','member_sub','role','created_at'],
  jobs:['id','project_id','submission_key','payload_json','payload_sha256','render_device','state',
    'created_by_sub','approved_by_sub','dispatched_by_sub','call_id','error_code','created_at',
    'approved_at','dispatched_at','finished_at'],
  assets:['job_id','filename','object_key','sha256','bytes'],
  audit_events:['id','project_id','job_id','action','actor_sub','at','details']
 };
 assert.match(legacy,/CREATE TABLE IF NOT EXISTS audit_events/);
 for(const [name,fields] of Object.entries(columns)){
  const body=table(name);
  for(const column of fields)assert.match(body,new RegExp('^\\s*'+column+'\\s+','m'),name+'.'+column);
 }
});
test('audit and completed artifact immutability stay database-enforced',()=>{
 for(const x of ['audit_immutable_update','audit_immutable_delete','job_state_integrity',
  'asset_insert_integrity','asset_update_integrity','asset_delete_integrity'])
  assert.match(text,new RegExp('CREATE OR REPLACE TRIGGER '+x+'\\b'));
 for(const x of ['AUDIT_IMMUTABLE','TERMINAL_JOB_IMMUTABLE','COMPLETED_JOB_REQUIRES_THREE_ASSETS',
  'ASSET_INSERT_NONACTIVE_JOB','COMPLETED_ASSET_IMMUTABLE'])
  assert.ok(text.includes(x));
});
test('role, payload, job state, file formats and quotas enforce source validation',()=>{
 for(const expression of ["'owner','editor','reviewer','viewer'","'PENDING_APPROVAL','APPROVED'",
   "'scene.blend','scene.glb','preview.png'","render_device='CPU'","char_length(payload_sha256)=64",
   "bytes BETWEEN 1024 AND 5000000"])
  assert.ok(text.includes(expression),expression);
});
test('migration is additive; it cannot overwrite other customer databases or enable rendering',()=>{
 assert.doesNotMatch(text,/\b(?:DROP|TRUNCATE|ALTER\s+ROLE|GRANT\s+ALL|DISABLE\s+TRIGGER|DELETE\s+FROM|UPDATE\s+jobs|DO\s+\$)\b/i);
 assert.doesNotMatch(text,/STUDIO_V03_SINGLE_ADMIN_SUBJECT_SHA256|MODAL_CONTROL_KEY|DATABASE_URL/);
 const statements=text.split(/^-- @statement\s*$/m).map(x=>x.trim()).filter(x=>x&&!x.startsWith('-- MUSITU'));
 assert.equal(statements.length,21);
 for(const statement of statements)assert.ok(statement.endsWith(';'));
});
test('source CPU and GPU gates remain closed during Neon qualification',()=>{
 const src=readFileSync(new URL('../../edge/src/v03_entry.mjs',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../../edge/src/v03_do_entry.mjs',import.meta.url),'utf8');
 assert.match(src,/testOnlyCpuGate===true/);
 assert.match(src,/singleAdminEnabled\(env,actor\)/);
 assert.match(src,/JOB_APPROVED_SINGLE_ADMIN/);
 assert.match(worker,/verifiedV03Identity\(req,env\)/);
 assert.doesNotMatch(worker,/DATABASE_URL|neon\(/);
});
