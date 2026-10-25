import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {eraseTenantWorkspace} from '../enterprise-tenant-erasure.mjs';

const TA='tenant_alpha001',TB='tenant_bravo002', SUB='subject_account1', ITEM='artifact_entry_001';
class D1{
  constructor(){
    this.sql=new DatabaseSync(':memory:');this.sql.exec('PRAGMA foreign_keys=ON');
    for(const migration of ['0001_enterprise_workspace.sql','0002_enterprise_tenant_artifact_limit.sql',
      '0003_enterprise_artifact_revision.sql','0004_enterprise_mutation_budget.sql'])
      this.sql.exec(readFileSync(new URL('../migrations/'+migration,import.meta.url),'utf8'));
    for(const tenant of [TA,TB]){
      this.sql.prepare('INSERT INTO tenants VALUES(?)').run(tenant);
      this.sql.prepare('INSERT INTO tenant_memberships VALUES(?,?,?,?)').run(tenant,SUB,'owner','active');
      this.sql.prepare('INSERT INTO tenant_artifacts(tenant_id,artifact_id,iv,ciphertext,version,updated_at,revision) VALUES(?,?,?,?,?,?,?)')
        .run(tenant,ITEM,'safenonce','opaque_cyphertext',1,800000,
          '00000000-0000-4000-8000-000000000001');
      this.sql.prepare('INSERT INTO tenant_audit(tenant_id,artifact_id,subject,event,at) VALUES(?,?,?,?,?)')
        .run(tenant,ITEM,SUB,'put',800000);
    }
  }
  batchCalls=0;
  async batch(statements){
    this.batchCalls++;this.sql.exec('BEGIN IMMEDIATE');
    const results=[];
    try{
      for(const stmt of statements){
        const result=this.sql.prepare(stmt.query).run(...stmt.args);
        results.push({meta:{changes:result.changes}});
      }
      this.sql.exec('COMMIT');
      return results;
    }catch(error){this.sql.exec('ROLLBACK');throw error;}
  }
  prepare(query){return {bind:(...args)=>({query,args,first:async()=>this.sql.prepare(query).get(...args)??null})};}
  count(table,tenant){return this.sql.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE tenant_id=?').get(tenant).n;}
  snapshot(tenant){return ['tenants','tenant_memberships','tenant_artifacts','tenant_audit'].map(table=>this.count(table,tenant));}
  close(){this.sql.close();}
}
const acceptance={tenantId:TA,verifiedTenantId:TA,authorizationReference:'review_ticket_1234',legalHoldCleared:true,confirmationPhrase:'ERASE '+TA};
test('default preview never touches or enumerates tenant data, even with complete parameters',async()=>{
 const db=new D1();try{
   const before=db.snapshot(TA),b=db.snapshot(TB);
   const summary=await eraseTenantWorkspace(db,acceptance);
   assert.deepEqual(summary,{executed:false,tenantId:TA,deleted:{audit:0,tenant:0},scope:'dedicated-enterprise-d1-only'});
   assert.deepEqual(db.snapshot(TA),before);assert.deepEqual(db.snapshot(TB),b);
   assert.equal(db.batchCalls,0);
 }finally{db.close();}
});
test('erasure requires verified matching tenant, authorization reference, legal hold clearance and typed confirmation',async()=>{
 const db=new D1();try{
   const bad=[
      {tenantId:'../../customer_data'}, {tenantId:TA,verifiedTenantId:TB},
      {tenantId:TA,authorizationReference:''},{tenantId:TA,legalHoldCleared:false},
      {tenantId:TA,confirmationPhrase:'ERASE '+TB},{tenantId:TA,confirmationPhrase:'erase '+TA},
      {tenantId:TA,execute:'true'},{tenantId:TA,authorizationReference:'X'.repeat(500)},
      {tenantId:TA,verifiedTenantId:null}
   ];
   for(const alteration of bad){
     await assert.rejects(eraseTenantWorkspace(db,{...acceptance,...alteration,execute:true}),/ERASURE_NOT_AUTHORIZED/);
   }
   assert.deepEqual(db.snapshot(TA),[1,1,1,1]);
   assert.deepEqual(db.snapshot(TB),[1,1,1,1]);
   assert.equal(db.batchCalls,0);
 }finally{db.close();}
});
test('approved single-tenant erasure removes identity, ciphertext and audit atomically without touching tenant B',async()=>{
 const db=new D1();try{
   const result=await eraseTenantWorkspace(db,{...acceptance,execute:true});
   assert.deepEqual(result,{executed:true,tenantId:TA,deleted:{audit:1,tenant:1},scope:'dedicated-enterprise-d1-only'});
   assert.deepEqual(db.snapshot(TA),[0,0,0,0]);
   assert.deepEqual(db.snapshot(TB),[1,1,1,1]);
   assert.equal(db.batchCalls,1);
 }finally{db.close();}
});
test('missing tenant fails without deleting orphan audit rows',async()=>{
 const db=new D1();try{
   db.sql.prepare('DELETE FROM tenants WHERE tenant_id=?').run(TA);
   assert.equal(db.count('tenant_audit',TA),1);
   await assert.rejects(eraseTenantWorkspace(db,{...acceptance,execute:true}),/ERASURE_TARGET_NOT_FOUND/);
   assert.equal(db.count('tenant_audit',TA),1);
   assert.deepEqual(db.snapshot(TB),[1,1,1,1]);
 }finally{db.close();}
});
test('SQL failure during scoped cascade rolls back prior audit deletion',async()=>{
 const db=new D1();try{
   db.sql.exec("CREATE TRIGGER deny_a_test_erasure BEFORE DELETE ON tenants WHEN OLD.tenant_id = '"+TA+"' BEGIN SELECT RAISE(ABORT,'blocked_legal_hold'); END;");
   await assert.rejects(eraseTenantWorkspace(db,{...acceptance,execute:true}),/ERASURE_STORE_UNAVAILABLE/);
   assert.deepEqual(db.snapshot(TA),[1,1,1,1]);
   assert.deepEqual(db.snapshot(TB),[1,1,1,1]);
 }finally{db.close();}
});
test('unverified D1 object or non-atomic batch results fail closed',async()=>{
 const notDb={prepare:()=>({}),batch:async()=>[{meta:{changes:1}}]};
 await assert.rejects(eraseTenantWorkspace(notDb,{...acceptance,execute:true}),/ERASURE_STORE_UNAVAILABLE/);
});
