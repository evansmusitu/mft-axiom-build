import test from 'node:test';
import assert from 'node:assert/strict';
import {executeRuntimeTask} from '../runtime_task_service.mjs';

function dependencies(overrides={}) {
  const writes=[];
  return {writes,objective:'Research a source and calculate 40+2.',customer:{customer_id:'tenant-a'},
    runtime:{inspect:async()=>({ok:true,build_id:'fixture',operation_count:74,tools:['arithmetic.evaluate',...Array.from({length:73},(_,i)=>`fixture.${i}`)]}),execute:async()=>({operation:'arithmetic.evaluate',http_status:200,result:{value:42},receipt:{result_sha256:'a'.repeat(64),compute_units:1}})},
    research:async()=>[{source_id:'source-a',title:'Source',url:'https://example.org/a',excerpt:'Bound source content.'}],
    model:async()=>({summary:'Evidence-bound calculation.',findings:['42'],citations:['source-a']}),
    store:{create:async r=>writes.push(['create',r]),complete:async r=>writes.push(['complete',r]),fail:async r=>writes.push(['fail',r])},
    now:()=>new Date('2026-10-29T12:00:00Z'),idFactory:()=> 'task_integrity',...overrides};
}

test('citation URL and source content are committed into artifact and receipt hashes',async()=>{
  const a=await executeRuntimeTask(dependencies());
  const b=await executeRuntimeTask(dependencies({research:async()=>[{source_id:'source-a',title:'Source',url:'https://example.org/b',excerpt:'Changed source content.'}]}));
  assert.notEqual(a.receipt.artifact_sha256,b.receipt.artifact_sha256);
  assert.notEqual(a.receipt.receipt_sha256,b.receipt.receipt_sha256);
});

test('observer failures never change a durably completed execution',async()=>{
  const args=dependencies({emit:event=>{if(event.phase==='COMPLETED')throw new Error('subscriber disconnected');}});
  const result=await executeRuntimeTask(args);
  assert.equal(result.status,'COMPLETED');
  assert.deepEqual(args.writes.map(x=>x[0]),['create','complete']);
});

test('look-up/citation requirements survive the arithmetic shortcut',async()=>{
  let calls=0;
  const args=dependencies({objective:'Look up the context and calculate 40+2 with citations.',research:async()=>{calls++;return [{source_id:'source-a',title:'Source',url:'https://example.org/a',excerpt:'Observed source.'}];}});
  const result=await executeRuntimeTask(args);
  assert.equal(calls,1);
  assert.equal(result.artifact.citations.length,1);
  assert.doesNotMatch(result.artifact.limitations.join(' '),/No external research was requested/);
});

test('required research cannot complete from an empty or invalid source set',async()=>{
  for(const sources of [[],[{source_id:'bad',url:'file:///not-permitted'}]]){
    let compute=0;
    const args=dependencies({research:async()=>sources});
    args.runtime.execute=async()=>{compute++;return {http_status:200};};
    await assert.rejects(()=>executeRuntimeTask(args),/research.*(source|evidence)/i);
    assert.equal(compute,0);
    assert.equal(args.writes.at(-1)[0],'fail');
  }
});
