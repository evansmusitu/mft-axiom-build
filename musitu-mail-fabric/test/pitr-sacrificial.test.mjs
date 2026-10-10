import test from 'node:test';
import assert from 'node:assert/strict';
import {MmfPitrSacrificialDO,runSacrificialPitrDrill} from '../src/edge/pitr-sacrificial.mjs';
const secret='synthetic-test-only-private-rpc-secret-000000000000';
const flags={MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_API_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false',
 MMF_STAGE_PITR_RESTORE_ENABLED:'true',MMF_STORAGE_RPC_SECRET:secret};
const probe='probe-pitr-drill-abcdef012345';
function harness({deny=false,flagOverrides={},failRestore=false}={}){
 let phase=null,snapshot=null,pitr=0,resets=0,sqlCalls=0;
 const storage={
  sql:{exec(sql,...args){
    sqlCalls++;
    if(sql.startsWith('CREATE TABLE'))return {toArray:()=>[]};
    if(sql.startsWith('INSERT')){if(phase!==null)throw Error('EXISTS');phase='baseline';return{toArray:()=>[]};}
    if(sql.startsWith('UPDATE')){if(phase!=='baseline')throw Error('WRONG_PHASE');phase='altered';return{toArray:()=>[]};}
    if(sql.startsWith('SELECT COUNT(*)'))return{toArray:()=>[{n:phase===null?0:1}]};
    if(sql.startsWith('SELECT'))return{toArray:()=>phase?[{probe_id:probe,phase}]:[]};
    throw Error('UNEXPECTED_SQL');
  }},
  async getCurrentBookmark(){pitr++;snapshot=phase;return '0000007b-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b';},
  async onNextSessionRestoreBookmark(){if(failRestore)throw Error('FAULT_INJECTION');pitr++;return '0000008a-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b';}
 };
 const ctx={storage,abort(){resets++;phase=snapshot;throw Error('SESSION_ABORT') }};
 const obj=new MmfPitrSacrificialDO(ctx,{...flags,...flagOverrides});
 const names=[],ns={idFromName(name){names.push(name);return name;},get(){return{fetch:req=>obj.fetch(req)}}};
 return{obj,ns,names,inspect:()=>({phase,pitr,resets,sqlCalls})};
}
test('dedicated sacrificial namespace proves mutated data rolled back to baseline without touching tenant object',async()=>{
 const f=harness();
 const outcome=await runSacrificialPitrDrill(f.ns,flags,probe);
 assert.equal(outcome.status,'PASS');assert.equal(outcome.wasRestored,true);
 assert.equal(outcome.afterPhase,'baseline');assert.equal(outcome.customerMailSent,false);
 assert.equal(outcome.targetDedicatedSandbox,true);
 assert.equal(f.inspect().phase,'baseline');
 assert.ok(f.inspect().resets>=1);
 assert.equal(f.names.length,1);
 assert.ok(f.names[0].startsWith('mmf-pitr-only-'));
 assert.ok(!f.names.includes('mmf-stage-tenant'));
});
test('sacrificial restore requires explicit private feature gate and rejects a misconfigured live flag',async()=>{
 for(const changes of [{MMF_REAL_SEND_ENABLED:'true'},{MMF_API_ENABLED:'true'},{MMF_STAGE_ONLY:'false'},{MMF_STAGE_PITR_RESTORE_ENABLED:'false'}]){
  const f=harness();
  await assert.rejects(()=>runSacrificialPitrDrill(f.ns,{...flags,...changes},probe),/STAGING_PITR_GATE/);
  assert.equal(f.names.length,0);
 }
});
test('sacrificial endpoint rejects direct unauthenticated and incorrect-token requests',async()=>{
 const f=harness();
 for(const provided of ['', 'wrong-token']){
  const response=await f.obj.fetch(new Request('https://internal.invalid/checkpoint',{method:'POST',
   headers:provided?{'x-mmf-internal':provided}:{},body:JSON.stringify({probeId:probe})}));
  assert.equal(response.status,401);
 }
 assert.equal(f.inspect().phase,null);
 const response=await f.obj.fetch(new Request('https://internal.invalid/restore',{method:'GET'}));
 assert.equal(response.status,404);
});
test('sacrificial PITR refuses inconsistent post-restore data rather than falsely reporting success',async()=>{
 const f=harness({failRestore:true});
 await assert.rejects(()=>runSacrificialPitrDrill(f.ns,flags,probe),/SACRIFICIAL_RESTORE_REFUSED_PITR_UNAVAILABLE/);
 assert.equal(f.inspect().phase,'altered');
});
test('invalid or arbitrary customer probe identity cannot select sacrificial object',async()=>{
 const f=harness();
 await assert.rejects(()=>runSacrificialPitrDrill(f.ns,flags,'real-customer-tenant'),/INVALID_SACRIFICIAL_PROBE/);
 assert.equal(f.names.length,0);
});
