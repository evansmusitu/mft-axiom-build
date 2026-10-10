import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/edge/worker-do-staging.mjs';
const secret='synthetic-private-only-rpc-secret-0123456789abcdef';
const envBase={MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_API_ENABLED:'false',
 MMF_WEBHOOK_ENABLED:'false',MMF_STAGE_PITR_RESTORE_ENABLED:'true',MMF_STORAGE_RPC_SECRET:secret};
const id='probe-worker-rehearsal-20261010';
function fixture({restoreWorks=true}={}){
 let phase=null;
 const sandboxStub={async fetch(req){
  const path=new URL(req.url).pathname;
  if(req.headers.get('x-mmf-internal')!==secret)return new Response('UNAUTHORIZED',{status:401});
  if(path==='/inspect')return phase===null?new Response('NOT_FOUND',{status:404}):
    Response.json({phase,syntheticOnly:true});
  if(path==='/checkpoint'){
   if(phase!==null)return new Response('NONEMPTY',{status:409});
   phase='baseline';return Response.json({phase,bookmark:'0000007b-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b',tag:'a'.repeat(64)});
  }
  if(path==='/mutate'){phase='altered';return Response.json({phase,syntheticOnly:true});}
  if(path==='/restore'){
   if(restoreWorks)phase='baseline';
   throw Error('PRIVATE_DO_SESSION_RESET');
  }
  return new Response('NOT_FOUND',{status:404});
 }};
 const ledger={idFromName:n=>n,get:()=>({fetch:async()=>Response.json({error:'SHOULD_NOT_BE_USED'},{status:503})})};
 const names=[];
 const sandbox={idFromName:n=>{names.push(n);return n},get:()=>sandboxStub};
 const env={...envBase,MMF_LEDGER:ledger,MMF_PITR_SANDBOX:sandbox};
 return{env,names,phase:()=>phase};
}
test('first Queue delivery requests retry, second proves changed-and-restored private sandbox and acknowledges',async()=>{
 const f=fixture(),logs=[],original=console.log;let ack=0,retry=0;
 const message=()=>({body:{type:'MMF_STAGE_SACRIFICIAL_PITR_PROBE',probeId:id},
  ack(){ack++},retry(){retry++}});
 console.log=line=>logs.push(JSON.parse(line));
 try{
  await worker.queue({messages:[message()]},f.env);
  assert.equal(ack,0);assert.equal(retry,1);
  assert.equal(f.phase(),'baseline');
  await worker.queue({messages:[message()]},f.env);
  assert.equal(ack,1);assert.equal(retry,1);
 }finally{console.log=original}
 const stage=logs.find(x=>x.gate==='MMF_SACRIFICIAL_PITR_MUTATED_AND_RESTORE_INITIATED');
 const verified=logs.find(x=>x.gate==='MMF_REAL_CLOUDFLARE_SACRIFICIAL_PITR_ROLLBACK');
 assert.equal(stage?.status,'EXPECTED');
 assert.equal(stage?.mutationVerified,true);
 assert.equal(verified?.status,'PASS');
 assert.equal(verified?.verifiedOnSeparateQueueDelivery,true);
 assert.ok(!JSON.stringify(logs).includes('0000007b-0000b26e'));
 assert.equal(f.names.length,2);
 assert.ok(f.names.every(x=>x.startsWith('mmf-pitr-only-')));
});
test('sandbox that never recovers is retried and never acknowledged as a successful restore',async()=>{
 const f=fixture({restoreWorks:false}),logs=[],original=console.log;let ack=0,retry=0;
 const m=()=>({body:{type:'MMF_STAGE_SACRIFICIAL_PITR_PROBE',probeId:id},ack(){ack++},retry(){retry++}});
 console.log=x=>logs.push(JSON.parse(x));
 try{await worker.queue({messages:[m()]},f.env);await worker.queue({messages:[m()]},f.env);}
 finally{console.log=original}
 assert.equal(ack,0);assert.equal(retry,2);
 assert.equal(f.phase(),'altered');
 assert.equal(logs.some(x=>x.gate==='MMF_REAL_CLOUDFLARE_SACRIFICIAL_PITR_ROLLBACK'),false);
});
