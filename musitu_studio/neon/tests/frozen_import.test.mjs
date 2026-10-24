import test from 'node:test';
import assert from 'node:assert/strict';
import {importFrozenStudioLedger} from '../frozen_import.mjs';
import {readFileSync} from 'node:fs';

const owner='synthetic-owner',pid='a1111111-1111-4111-8111-111111111111';
const jid='b2222222-2222-4222-8222-222222222222';
const key=new Uint8Array(32).fill(27);
const tables=['projects','memberships','jobs','assets','audit_events'];
const sqlcopy=x=>structuredClone(x);
function snapshot(){
  return {complete:true,freeze_id:'synthetic-frozen-proof-20261021',
    projects:[{id:pid,title:'Synthetic staged project',owner_sub:owner,created_at:'2026-10-21T00:00:00Z'}],
    memberships:[{project_id:pid,member_sub:owner,role:'owner',created_at:'2026-10-21T00:00:00Z'}],
    jobs:[{id:jid,project_id:pid,submission_key:'synthetic-one-job',
      payload_json:'{"scene":"synthetic_cube","objects":["unit_cube"]}',
      payload_sha256:'a'.repeat(64),render_device:'CPU',state:'COMPLETED',
      created_by_sub:owner,approved_by_sub:owner,dispatched_by_sub:owner,
      call_id:'fc-synthetic1234',error_code:null,
      created_at:'2026-10-21T00:00:00Z',approved_at:'2026-10-21T00:00:01Z',
      dispatched_at:'2026-10-21T00:00:02Z',finished_at:'2026-10-21T00:00:03Z'}],
    assets:['scene.blend','scene.glb','preview.png'].map((filename,i)=>({
      job_id:jid,filename,object_key:'studio-v03/jobs/'+jid+'/'+filename,
      sha256:String(i+1).repeat(64),bytes:1024})),
    audit_events:[{id:'c3333333-3333-4333-8333-333333333333',project_id:pid,
      job_id:jid,action:'JOB_APPROVED_SINGLE_ADMIN',actor_sub:owner,
      at:'2026-10-21T00:00:01Z',details:'{"source":"synthetic","single_admin":true}'}]
  };
}
// Fake catalog rows reflect the canonical migrations; altered function bodies
// must be rejected even if the trigger's name, event and table appear valid.
const canonicalFunctions={};
for(const path of ['../0001_enterprise_postgres_schema.sql',
                   '../0002_harden_terminal_asset_integrity.sql']){
  const sql=readFileSync(new URL(path,import.meta.url),'utf8');
  for(const match of sql.matchAll(/CREATE OR REPLACE FUNCTION studio_v03\.([a-z_]+)\(\) RETURNS trigger\s+LANGUAGE plpgsql AS \$body\$([\s\S]*?)\$body\$;/g))
    canonicalFunctions[match[1]]=match[2].replace(/\r\n/g,'\n').trim();
}
assert.deepEqual(Object.keys(canonicalFunctions).sort(),
  ['deny_audit_mutation','enforce_asset_integrity','enforce_job_asset_integrity']);
const triggerNames=[
 'job_state_integrity','asset_insert_integrity','asset_update_integrity',
 'asset_delete_integrity','audit_immutable_update','audit_immutable_delete'
];
const triggerMeta=[
 ['jobs',19,'enforce_job_asset_integrity'],
 ['assets',7,'enforce_asset_integrity'],
 ['assets',19,'enforce_asset_integrity'],
 ['assets',11,'enforce_asset_integrity'],
 ['audit_events',19,'deny_audit_mutation'],
 ['audit_events',11,'deny_audit_mutation']
];
function fake({existing=false,tamper=false,auditError=false,schemaVersion=2,
  omitTrigger=false,connectError=false,spoofTrigger=false,disabledTrigger=false,
  partialColumnTrigger=false,conditionalTrigger=false,tamperFunctionBody=false,
  privilegedFunction=false,replicationRole='origin'}={}){
  const trace=[],state=Object.fromEntries(tables.map(t=>[t,[]]));
  if(existing)state.projects.push(sqlcopy(snapshot().projects[0]));
  let checkpoint=null,connected=false,ended=false;
  const client={
    async connect(){trace.push('CONNECT');if(connectError)throw Error('CONNECTION_DENIED');connected=true},
    async end(){trace.push('END');ended=true},
    async query(sql,values=[]){
      trace.push(sql);
      if(sql==='BEGIN ISOLATION LEVEL SERIALIZABLE'){checkpoint=sqlcopy(state);return {rowCount:0,rows:[]}}
      if(sql==='SET LOCAL search_path TO studio_v03, pg_catalog')return {rowCount:0,rows:[]};
      if(sql==='COMMIT')return {rowCount:0,rows:[]};
      if(sql==='ROLLBACK'){for(const t of tables)state[t]=sqlcopy(checkpoint[t]);return {rowCount:0,rows:[]}};
      if(sql==="SELECT current_setting('session_replication_role') AS replication_role")
        return {rows:[{replication_role:replicationRole}]};
      if(sql.includes('FROM studio_v03._studio_schema_versions'))
        return {rows:[{n:schemaVersion===2?'1':'0'}]};
      if(sql.includes('FROM pg_trigger'))
        return {rows:triggerNames.map((tgname,i)=>({
          tgname,table_schema:'studio_v03',table_name:triggerMeta[i][0],
          tgtype:triggerMeta[i][1],tgenabled:disabledTrigger&&i===2?'D':'O',
          update_columns:partialColumnTrigger&&i===0?'7':'',
          has_when_clause:!!(conditionalTrigger&&i===2),
          function_schema:'studio_v03',function_name:triggerMeta[i][2],
          function_body:tamperFunctionBody&&i===0?'BEGIN RETURN NEW; END;':
            canonicalFunctions[triggerMeta[i][2]],
          function_language:'plpgsql',function_args:0,
          security_definer:!!(privilegedFunction&&i===0),returns_trigger:true,
          // A same-named but wrongly wired trigger must never authorize import.
          ...(spoofTrigger&&i===0?{tgtype:23,function_name:'permissive_noop'}:{})
        })).filter((_,i)=>!omitTrigger||i!==2)};
      const count=sql.match(/^SELECT COUNT\(\*\) AS n FROM studio_v03\.(\w+)$/);
      if(count)return {rows:[{n:String(state[count[1]].length)}]};
      const insertion=sql.match(/^INSERT INTO studio_v03\.(\w+)\(([^)]+)\) VALUES\(([^)]+)\)$/);
      if(insertion){
        if(auditError&&insertion[1]==='audit_events')throw Error('AUDIT_INSERT_FAILED');
        const col=insertion[2].split(','),record=Object.fromEntries(col.map((k,i)=>[k,values[i]]));
        if(insertion[1]==='assets'){
          const job=state.jobs.find(x=>x.id===record.job_id);
          assert.ok(job&&['RUNNING','DISPATCHING'].includes(job.state),'asset must be written while active');
        }
        state[insertion[1]].push(record);
        return {rowCount:1,rows:[]};
      }
      const up=sql.match(/^UPDATE studio_v03\.jobs SET state=\$1 WHERE id=\$2 AND state=\$3$/);
      if(up){
        const job=state.jobs.find(x=>x.id===values[1]&&x.state===values[2]);
        if(job){job.state=values[0];return {rowCount:1,rows:[]}}
        return {rowCount:0,rows:[]};
      }
      const read=sql.match(/^SELECT (.+) FROM studio_v03\.(\w+)$/);
      if(read){
        let rows=sqlcopy(state[read[2]]);
        if(tamper&&read[2]==='assets'&&rows.length)rows[0].sha256='f'.repeat(64);
        return {rows};
      }
      throw Error('UNKNOWN_SQL');
    }
  };
  return {makeClient:()=>client,trace,state,connection:()=>({connected,ended})};
}
const invoke=(mock,original=snapshot(),secret=key)=>
 importFrozenStudioLedger({makeClient:mock.makeClient,sourceSnapshot:original,integrityKey:secret});

test('imports all five tables, preserving completed asset state and approval audit',async()=>{
  const f=fake(),original=snapshot(),copy=sqlcopy(original);
  const receipt=await invoke(f,original);
  assert.equal(receipt.committed,true);
  assert.equal(receipt.reconciliation.verified,true);
  assert.equal(receipt.reconciliation.counts.assets,3);
  assert.equal(f.state.jobs[0].state,'COMPLETED');
  assert.deepEqual(f.state.assets.map(x=>x.filename).sort(),['preview.png','scene.blend','scene.glb']);
  assert.equal(f.state.audit_events[0].action,'JOB_APPROVED_SINGLE_ADMIN');
  assert.deepEqual(original,copy);
  assert.equal(f.trace.filter(x=>x==='COMMIT').length,1);
  assert.equal(f.trace.filter(x=>x==='ROLLBACK').length,0);
  assert.equal(f.trace.at(-1),'END');
  assert.doesNotMatch(JSON.stringify(receipt),/synthetic-owner|synthetic-one-job|synthetic_cube/);
  assert.equal(receipt.live_cutover_authorized,false);
  assert.equal(receipt.rendering_enabled,false);
});
test('checks the target is empty before any customer-like insertion',async()=>{
  const f=fake({existing:true});
  await assert.rejects(()=>invoke(f),/NEON_TARGET_NOT_EMPTY_PROJECTS/);
  assert.equal(f.trace.filter(x=>x.startsWith('INSERT INTO')).length,0);
  assert.ok(f.trace.includes('ROLLBACK'));
  assert.equal(f.trace.at(-1),'END');
});
test('rejects missing v2 protections before touching any ledger row',async()=>{
  const f=fake({schemaVersion:1});
  await assert.rejects(()=>invoke(f),/NEON_SCHEMA_V2_MISSING/);
  assert.equal(f.trace.filter(x=>x.startsWith('INSERT INTO')).length,0);
  assert.ok(f.trace.includes('ROLLBACK'));
});
test('rejects a disabled/missing asset integrity trigger',async()=>{
  const f=fake({omitTrigger:true});
  await assert.rejects(()=>invoke(f),/NEON_IMMUTABILITY_TRIGGER_MISSING/);
  assert.equal(f.trace.filter(x=>x.startsWith('INSERT INTO')).length,0);
});
test('rejects a same-named but incorrectly wired trigger before writing',async()=>{
  const f=fake({spoofTrigger:true});
  await assert.rejects(()=>invoke(f),/NEON_TRIGGER_TOPOLOGY_MISMATCH/);
  assert.equal(f.trace.filter(x=>x.startsWith('INSERT INTO')).length,0);
  assert.ok(f.trace.includes('ROLLBACK'));
});
test('rejects disabled integrity triggers rather than accepting trigger names',async()=>{
  const f=fake({disabledTrigger:true});
  await assert.rejects(()=>invoke(f),/NEON_TRIGGER_TOPOLOGY_MISMATCH/);
  assert.equal(f.trace.filter(x=>x.startsWith('INSERT INTO')).length,0);
});
test('refuses an UPDATE OF-only job guard whose tgtype matches broad UPDATE',async()=>{
  const f=fake({partialColumnTrigger:true});
  await assert.rejects(()=>invoke(f),/NEON_TRIGGER_TOPOLOGY_MISMATCH/);
  assert.equal(f.trace.filter(x=>x.startsWith('INSERT INTO')).length,0);
  assert.ok(f.trace.includes('ROLLBACK'));
});
test('refuses an integrity trigger limited by WHEN predicate',async()=>{
  const f=fake({conditionalTrigger:true});
  await assert.rejects(()=>invoke(f),/NEON_TRIGGER_TOPOLOGY_MISMATCH/);
  assert.equal(f.trace.filter(x=>x.startsWith('INSERT INTO')).length,0);
});
test('refuses a replacement no-op trigger function with matching catalog name',async()=>{
  const f=fake({tamperFunctionBody:true});
  await assert.rejects(()=>invoke(f),/NEON_TRIGGER_FUNCTION_BODY_MISMATCH/);
  assert.equal(f.trace.filter(x=>x.startsWith('INSERT INTO')).length,0);
});
test('refuses SECURITY DEFINER function privilege drift before data insert',async()=>{
  const f=fake({privilegedFunction:true});
  await assert.rejects(()=>invoke(f),/NEON_TRIGGER_FUNCTION_BODY_MISMATCH/);
  assert.equal(f.trace.filter(x=>x.startsWith('INSERT INTO')).length,0);
});
test('fails before commit if independently read-back asset differs from source',async()=>{
  const f=fake({tamper:true});
  await assert.rejects(()=>invoke(f),/LEDGER_CONTENT_MISMATCH_ASSETS/);
  assert.ok(f.trace.includes('ROLLBACK'));
  assert.equal(f.trace.filter(x=>x==='COMMIT').length,0);
  assert.equal(f.state.jobs.length,0,'transaction rollback clears all staged rows');
});
test('audit insert failure rolls back all previous project, job and asset inserts',async()=>{
  const f=fake({auditError:true});
  await assert.rejects(()=>invoke(f),/AUDIT_INSERT_FAILED/);
  assert.equal(f.state.assets.length,0);
  assert.equal(f.state.jobs.length,0);
  assert.ok(f.trace.includes('ROLLBACK'));
});
test('rejects partial/inconsistent source without opening a database session',async()=>{
  const f=fake(),src=snapshot();src.complete=false;
  await assert.rejects(()=>invoke(f,src),/LEDGER_PARTIAL_EXPORT/);
  assert.equal(f.trace.length,0);
});
test('requires a caller-held 256-bit key before any network work',async()=>{
  const f=fake();
  await assert.rejects(()=>invoke(f,snapshot(),new Uint8Array(7)),/NEON_IMPORT_INTEGRITY_KEY_REQUIRED/);
  assert.equal(f.trace.length,0);
});
test('closes client even when initial connect fails',async()=>{
  const f=fake({connectError:true});
  await assert.rejects(()=>invoke(f),/CONNECTION_DENIED/);
  assert.equal(f.trace.at(-1),'END');
  assert.equal(f.trace.filter(x=>x==='COMMIT').length,0);
});

// REPLICATION ROLE IS INDEPENDENT OF pg_trigger metadata; a user with elevated
// privileges can set replica and silently suppress ordinary origin triggers.
test('refuses replica or locally suppressed session triggers before any insert',async()=>{
 for(const role of ['replica','local',null]){
  const f=fake({replicationRole:role});
  await assert.rejects(()=>invoke(f),/NEON_REPLICATION_ROLE_UNSAFE/);
  assert.equal(f.trace.filter(x=>x.startsWith('INSERT INTO')).length,0);
  assert.equal(f.trace.filter(x=>x==='COMMIT').length,0);
  assert.ok(f.trace.includes('ROLLBACK'));
 }
});
