import test from 'node:test';import assert from 'node:assert/strict';
import {qualifyPrivateSyntheticRestart} from '../src/staging/mmf-private-control-remote-restart.mjs';
const id=(x)=>x.toString(16).padStart(2,'0').repeat(32);
function boundary({preserveEpoch=false,timeoutOnSeed=false}={}){
 let epoch='11111111-1111-4111-8111-111111111111',run=null,records=null,revoked=new Set(),usage=new Set(),calls=[];
 const reply=(value,status=200)=>({status,json:async()=>value});
 const transport=async(url,options)=>{
  const {pathname}=new URL(url);calls.push({path:pathname,method:options.method});
  if(!url.startsWith('http://127.0.0.1:8796/'))throw Error('no remote calls');
  const v=options.body?JSON.parse(options.body):{};
  if(pathname==='/control/inspect')return reply({schema:'mmf-private-synthetic-control-occupancy-v1',state:run?'OCCUPIED':'EMPTY',tenantCount:run?2:0,usageCount:usage.size});
  if(pathname==='/control/epoch')return reply({epoch});
  if(pathname==='/control/seed'){
   run=v.run;records=v.records;if(timeoutOnSeed){timeoutOnSeed=false;throw Error('simulated uncertain ACK')}return reply({stored:true,tenantCount:2});
  }
  if(pathname==='/control/read')return reply(run?{present:true,tenantCount:2,domainPendingCount:2,subscriptionPendingCount:2,usageCount:usage.size,revokedCount:revoked.size,entitlementsActive:0}:{present:false});
  if(pathname==='/control/access')return reply({active:!!run&&v.run===run&&records.some(r=>r.tenantDigest===v.record.tenantDigest&&r.subjectDigest===v.record.subjectDigest&&r.keyDigest===v.record.keyDigest)&&!revoked.has(v.record.tenantDigest)});
  if(pathname==='/control/meter'){const key=v.record.tenantDigest+v.idem;const had=usage.has(key);usage.add(key);return reply({metered:!had})}
  if(pathname==='/control/revoke'){revoked.add(v.record.tenantDigest);return reply({revoked:true})}
  if(pathname==='/restart'){if(!preserveEpoch)epoch='22222222-2222-4222-8222-222222222222';return reply({error:'reset'},503)}
  if(pathname==='/control/clear'){run=null;records=null;usage.clear();revoked.clear();return reply({cleared:true})}
  throw Error('unexpected path '+pathname);
 };
 return {transport,calls,occupancy:()=>!!run};
}
test('remote instance epoch changes only after private DO abort; tenant revoke, idempotent meter and cleanup remain durable',async()=>{
 const b=boundary();let seq=1;const result=await qualifyPrivateSyntheticRestart({fetchImpl:b.transport,makeDigest:()=>id(seq++),retryDelayMs:0});
 assert.equal(result.gate,'MMF_PRIVATE_REMOTE_CONTROL_RESTART_PERSISTENCE_PROVEN');
 assert.equal(result.verifiedNewInstanceEpoch,true);
 assert.equal(result.syntheticTenantCount,2);assert.equal(result.cleanupConfirmed,true);
 assert.equal(b.occupancy(),false);
 assert.deepEqual(b.calls.filter(x=>x.path==='/restart').map(x=>x.method),['POST']);
 assert.deepEqual(b.calls.filter(x=>x.path==='/control/inspect').map(x=>x.method),['GET','GET']);
 assert.equal(b.calls.filter(x=>x.path==='/control/meter').length,3);
 assert.equal(b.calls.some(x=>/mail|paynow|checkout|payment/.test(x.path)),false);
});
test('unchanged epoch is denied and attempted seed is cleaned, even if acknowledgment failed',async()=>{
 const b=boundary({preserveEpoch:true});let seq=1;
 await assert.rejects(()=>qualifyPrivateSyntheticRestart({fetchImpl:b.transport,makeDigest:()=>id(seq++),retryDelayMs:0}),/MMF_REMOTE_RESTART_/);
 assert.equal(b.occupancy(),false);
 const c=boundary({timeoutOnSeed:true});seq=1;
 await assert.rejects(()=>qualifyPrivateSyntheticRestart({fetchImpl:c.transport,makeDigest:()=>id(seq++),retryDelayMs:0}),/MMF_REMOTE_RESTART_/);
 assert.equal(c.occupancy(),false,'cleanup after uncertain seeded-then-timeout');
});
