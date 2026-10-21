import test from 'node:test';
import assert from 'node:assert/strict';
import {importFrozenStudioLedger} from '../frozen_import.mjs';

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
      job_id:jid,filename,object_key:'synthetic/job/'+filename,
      sha256:String(i+1).repeat(64),bytes:1024})),
    audit_events:[{id:'c3333333-3333-4333-8333-333333333333',project_id:pid,
      job_id:jid,action:'JOB_APPROVED_SINGLE_ADMIN',actor_sub:owner,
      at:'2026-10-21T00:00:01Z',details:'{"source":"synthetic","single_admin":true}'}]
  };
}
const triggerNames=[
 'job_state_integrity','asset_insert_integrity','asset_update_integrity',
 'asset_delete_integrity','audit_immutable_update','audit_immutable_delete'
];
function fake({existing=false,tamper=false,auditError=false,schemaVersion=2,
  omitTrigger=false,connectError=false}={}){
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
      if(sql.includes('FROM studio_v03._studio_schema_versions'))
        return {rows:[{n:schemaVersion===2?'1':'0'}]};
      if(sql.includes('FROM pg_trigger'))
        return {rows:triggerNames.filter((_,i)=>!omitTrigger||i!==2).map(tgname=>({tgname}))};
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
        if(tamper&&read[2]==='assets'&&rows.length)rows[0].object_key='forged-destination-object';
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
