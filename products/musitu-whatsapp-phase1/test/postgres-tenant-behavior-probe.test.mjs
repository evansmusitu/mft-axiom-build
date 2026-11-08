import test from 'node:test';
import assert from 'node:assert/strict';
import * as guard from '../src/postgres/runtime-role-guard.mjs';
const {qualifyPostgresTenantReadIsolation,createQualifiedPostgresRepository}=guard;

const A='00000000-0000-4000-8000-00000000000a';
const B='00000000-0000-4000-8000-00000000000b';

function harness({leak=false,role='musitu_runtime',bypass=false,interruptAt=null,rollbackFails=false}={}){
 const calls=[], released=[];let scope=null, started=false;
 const rowsByScope={'':[],[A]:[A],[B]:[B]};
 const client={
  async query(sql,args){calls.push([sql,args]);
   if(interruptAt&&sql.includes(interruptAt))throw Error('PROBE_DATABASE_LOST');
   if(sql.includes('FROM pg_roles'))return {rows:[{role_name:role,rolsuper:false,rolbypassrls:bypass}]};
   if(sql==='BEGIN READ ONLY'){started=true;scope=null;return {rows:[]};}
   if(sql==="SELECT set_config('app.tenant_id', $1, true)"){
    if(!started)throw Error('NOT_IN_TX');scope=args[0];return {rows:[{set_config:scope}]};
   }
   if(sql.includes('FROM musitu.tenants ORDER BY id')){
    if(!started)throw Error('NOT_IN_TX');
    return {rows:(leak?[A,B]:rowsByScope[scope]).map(id=>({id}))};
   }
   if(sql==='ROLLBACK'){
    if(rollbackFails)throw Error('ROLLBACK_FAILED');
    started=false;scope=null;return {rows:[]};
   }
   throw Error('UNKNOWN_QUERY '+sql);
  },
  release(error){released.push(error||null);}
 };
 return {pool:{async connect(){return client;}},calls,released};
}

test('read-only three-scope probe verifies A, B, and empty context without leaving session tenant state',async()=>{
 const h=harness();
 const result=await qualifyPostgresTenantReadIsolation({pool:h.pool,expectedRole:'musitu_runtime',tenantProbes:[A,B]});
 assert.deepEqual(result,{qualified:true,role:'musitu_runtime',tenantCount:2,scopesChecked:3,mode:'READ_ONLY_FIXTURE'});
 assert.equal(h.calls.filter(x=>x[0]==='BEGIN READ ONLY').length,3);
 assert.equal(h.calls.filter(x=>x[0]==='ROLLBACK').length,3);
 assert.deepEqual(h.calls.filter(x=>x[0]==="SELECT set_config('app.tenant_id', $1, true)").map(x=>x[1][0]),['',A,B]);
 assert.equal(h.released.length,1);assert.equal(h.released[0],null);
 assert.equal(h.calls.some(x=>/INSERT|UPDATE|DELETE|COMMIT/.test(x[0])),false);
});

test('probe blocks data visibility leakage under permissive policy',async()=>{
 const h=harness({leak:true});
 await assert.rejects(qualifyPostgresTenantReadIsolation({pool:h.pool,expectedRole:'musitu_runtime',tenantProbes:[A,B]}),/TENANT_BEHAVIOR_UNQUALIFIED/);
 assert.equal(h.released.length,1);
 assert.equal(h.calls.filter(x=>x[0]==='ROLLBACK').length,1);
});

test('probe fails closed on non-distinct fixtures, invalid UUID, unexpected role, bypass role',async()=>{
 for(const tenantProbes of [undefined,[],[A,A],[A,'not-a-uuid']]){
  await assert.rejects(qualifyPostgresTenantReadIsolation({pool:harness().pool,expectedRole:'musitu_runtime',tenantProbes}),/TWO_TENANT_FIXTURES_REQUIRED/);
 }
 for(const opts of [{role:'other'},{bypass:true}]){
  const h=harness(opts);
  await assert.rejects(qualifyPostgresTenantReadIsolation({pool:h.pool,expectedRole:'musitu_runtime',tenantProbes:[A,B]}),/ROLE_/);
  assert.equal(h.released.length,1);
 }
});

test('query failure rolls back and failed rollback discards connection',async()=>{
 const h=harness({interruptAt:'FROM musitu.tenants ORDER BY id'});
 await assert.rejects(qualifyPostgresTenantReadIsolation({pool:h.pool,expectedRole:'musitu_runtime',tenantProbes:[A,B]}),/PROBE_DATABASE_LOST/);
 assert.equal(h.calls.filter(x=>x[0]==='ROLLBACK').length,1);
 assert.equal(h.released.length,1);
 const bad=harness({interruptAt:'FROM musitu.tenants ORDER BY id',rollbackFails:true});
 await assert.rejects(qualifyPostgresTenantReadIsolation({pool:bad.pool,expectedRole:'musitu_runtime',tenantProbes:[A,B]}),/PROBE_DATABASE_LOST/);
 assert.equal(bad.released.length,1);assert.match(bad.released[0]?.message,/ROLLBACK_FAILED/);
});

test('repository factory refuses to qualify from policy metadata alone',async()=>{
 await assert.rejects(createQualifiedPostgresRepository({pool:harness().pool,expectedRole:'musitu_runtime'}),/TWO_TENANT_FIXTURES_REQUIRED/);
});
