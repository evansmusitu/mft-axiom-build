import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorkersAIModel} from '../../../ops/axiom_runtime_task_api.mjs';

const plan={title:'Acknowledgement',needs_research:false,search_query:'',operation:null,operation_args:{}};
const synthesis={title:'Acknowledgement',summary:'Marker accepted.',findings:['Marker accepted.'],limitations:['No external verification.'],citations:[]};
const binding=(privacy='Project')=>({contract:{policy:{privacy}},assertBound:async()=>true});
const env=result=>({AI:{run:async()=>result}});
test('Workers AI accepts actual Gemma chat output and legacy response text',async()=>{
  for(const result of [{choices:[{finish_reason:'stop',message:{content:JSON.stringify(plan)}}]},{response:JSON.stringify(plan)}]){
    const model=createWorkersAIModel(env(result),{governance:binding()});
    assert.deepEqual(await model({stage:'planning'}),plan);
  }
});
test('Workers AI rejects empty, truncated or tool-only output rather than completing a fallback brief',async()=>{
  for(const result of [{choices:[{finish_reason:'length',message:{content:JSON.stringify(plan)}}]},{choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{}]}}]},{choices:[]},{}, {response:'{}'}]){
    await assert.rejects(()=>createWorkersAIModel(env(result),{governance:binding()})({stage:'planning'}));
  }
});
test('Workers AI requires structured synthesis with nonempty actual summary',async()=>{
  assert.deepEqual(await createWorkersAIModel(env({response:JSON.stringify(synthesis)}),{governance:binding()})({stage:'synthesis'}),synthesis);
  for(const result of [{...synthesis,summary:''},{...synthesis,citations:['not supplied']},{...synthesis,findings:'not an array'}])await assert.rejects(()=>createWorkersAIModel(env({response:JSON.stringify(result)}),{governance:binding()})({stage:'synthesis',sources:[]}));
});
test('Workers AI does not dispatch Private, unbound or oversized input',async()=>{
  let calls=0;
  const e={AI:{run:async()=>{calls++;return {response:JSON.stringify(plan)};}}};
  assert.throws(()=>createWorkersAIModel(e),/governance/);
  await assert.rejects(()=>createWorkersAIModel(e,{governance:binding('Private')})({stage:'planning'}),/Private/);
  await assert.rejects(()=>createWorkersAIModel(e,{governance:binding()})({stage:'planning',objective:'x'.repeat(30000)}),/bound/);
  assert.equal(calls,0);
});
test('Workers AI rechecks Work authority after an in-flight model response',async()=>{
  let revoked=false;
  const governance={contract:{policy:{privacy:'Project'}},assertBound:async()=>{if(revoked)throw new DOMException('revoked','NotAllowedError');}};
  const model=createWorkersAIModel({AI:{run:async()=>{revoked=true;return {response:JSON.stringify(plan)};}}},{governance});
  await assert.rejects(()=>model({stage:'planning'}),/revoked/);
});
