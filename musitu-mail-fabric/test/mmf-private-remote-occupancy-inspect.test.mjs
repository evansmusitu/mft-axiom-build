import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPrivateControlOccupancy} from '../src/staging/mmf-private-remote-occupancy-inspect.mjs';
const digest=n=>n.toString(16).padStart(2,'0').repeat(32);
function response(status,data){return {status,async json(){return data}};}
function mockSequence(sequence){const seen=[];return {seen,fetchImpl:async(url,init)=>{
 seen.push({url,method:init.method,payload:init.body?JSON.parse(init.body):null});
 const x=sequence.shift();if(x instanceof Error)throw x;
 return response(x.status??200,x.data);
}};}
test('stage proof caller checks closed local health, remote SQLite, and zero synthetic control rows without writing records',async()=>{
 const mock=mockSequence([{data:{ok:true,localOnly:true}},{data:{digest:null}},{data:{present:false}}]);
 let next=9;
 const out=await inspectPrivateControlOccupancy({fetchImpl:mock.fetchImpl,base:'http://127.0.0.1:8796',makeDigest:()=>digest(++next)});
 assert.deepEqual(out,{gate:'MMF_PRIVATE_REMOTE_READBACK_EMPTY_PROVEN',loopbackOnly:true,existingRemoteRpcReachable:true,syntheticControlRowsAbsent:true,syntheticMutationPerformed:false,customerDataRead:false});
 assert.deepEqual(mock.seen.map(x=>[new URL(x.url).pathname,x.method]),[['/health','GET'],['/read','POST'],['/control/read','POST']]);
 assert.equal(mock.seen[2].payload.records.length,2);
 assert.equal(mock.seen[2].payload.records[0].subjectDigest,digest(12));
});
test('preexisting or ambiguous synthetic data fails closed rather than being auto-deleted',async()=>{
 for(const result of [{status:503,data:{category:'CLOSED_STAGE_VALIDATION_FAILED'}},{status:200,data:{present:true}},{status:200,data:{present:false,extra:1}}]){
  const mock=mockSequence([{data:{ok:true,localOnly:true}},{data:{digest:null}},result]);
  await assert.rejects(()=>inspectPrivateControlOccupancy({fetchImpl:mock.fetchImpl}),/MMF_PRIVATE_REMOTE_(?:RESIDUE_NOT_EXCLUDED|MALFORMED_REPLY)/);
  assert.equal(mock.seen.length,3);
 }
});
test('stale stage binding or timed out read cannot return success, disclose raw remote error or attempt cleanup',async()=>{
 const rawSecret='VERY_PRIVATE_VALUE_DO_NOT_PRINT';
 for(const x of [{status:503,data:{category:'REMOTE_BINDING_UNAVAILABLE'}},new Error('timeout '+rawSecret)]){
  const mock=mockSequence([{data:{ok:true,localOnly:true}},x]);
  try {await inspectPrivateControlOccupancy({fetchImpl:mock.fetchImpl});assert.fail('expected denial');}
  catch(e){assert.match(e.message,/^MMF_PRIVATE_REMOTE_/);assert.ok(!e.message.includes(rawSecret));}
  assert.equal(mock.seen.length,2);
 }
});
test('disallow any non-localhost host and all unexpected proxy responses',async()=>{
 const mock=mockSequence([]);
 await assert.rejects(()=>inspectPrivateControlOccupancy({base:'https://example.com',fetchImpl:mock.fetchImpl}),/MMF_PRIVATE_REMOTE_NONLOCAL_DENIED/);
 assert.equal(mock.seen.length,0);
});
