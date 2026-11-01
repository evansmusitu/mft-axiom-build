import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interruptedCreationFetch,acceptanceResult} from './live-hosted-acceptance.mjs';
import {sha256Json,verifyTaskCommitments} from '../../axiom_interface/vnext/execution_integrity.mjs';

test('actual creation observer closes after first root turn frame, without resending or cancelling a turn',async()=>{
  const events=[
    {type:'agent.session.created',session:{id:'session_one'}},
    {type:'agent.session.turn.created',session_id:'session_one',turn:{id:'turn_one',subagent_id:null}},
    {type:'agent.session.turn.completed',session_id:'session_one',turn:{id:'turn_one',status:'completed'}},
  ];
  let calls=0,transportCancelled=false;
  const transport=interruptedCreationFetch(async()=>{calls++;return new Response(new ReadableStream({
    start(controller){controller.enqueue(new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')));},
    cancel(){transportCancelled=true;},
  }),{headers:{'content-type':'text/event-stream'}});});
  const response=await transport.fetch('https://api.openai.com/v1/agents/sessions',{method:'POST'}),reader=response.body.getReader();
  const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/agent.session.created/);
  const second=await reader.read();assert.match(new TextDecoder().decode(second.value),/turn.created/);
  assert.equal((await reader.read()).done,true);assert.equal(transport.dropped,true);assert.equal(transportCancelled,true);
  assert.equal(calls,1);assert.equal(transport.creates,1);
  await assert.rejects(()=>transport.fetch('https://api.openai.com/v1/agents/sessions',{method:'POST'}),/single hosted session/);
  assert.equal(calls,1,'second inference dispatch is rejected locally');
});

test('split SSE framing and subagent events cannot hide a missing root checkpoint',async()=>{
  const frames=[{type:'agent.session.turn.created',turn:{id:'subagent_turn',subagent_id:'child'}},{type:'agent.session.turn.created',turn:{id:'root_turn',subagent_id:null}}].map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join('');
  let offset=0;
  const transport=interruptedCreationFetch(async()=>new Response(new ReadableStream({pull(controller){if(offset===frames.length){controller.close();return;}controller.enqueue(new TextEncoder().encode(frames.slice(offset,offset+=3)));}}),{headers:{'content-type':'text/event-stream'}}));
  const response=await transport.fetch('https://api.openai.com/v1/agents/sessions',{method:'POST'});
  const text=await response.text();assert.match(text,/subagent_turn/);assert.match(text,/root_turn/);assert.equal(transport.dropped,true);
});

test('acceptance receipt commits actual output, primary proof and observed cancellation without claiming kernel execution',async()=>{
  const contract={project_id:'project',work_id:'work',agent_id:'agent',contract_sha256:'a'.repeat(64)};
  const base={task_id:'task',request_id:'request',customer_id:'tenant',objective:'Verify hosted protocol.',status:'RUNNING',started_at:'2026-11-01T00:00:00.000Z',execution_contract:contract};
  const output={operation:null,needs_research:false,operation_args:{nonce:'chosen',product:391}};
  const result=await acceptanceResult({base,contract,output,providerEvidence:[{output_sha256:await sha256Json(output),turn_id:'turn_primary'}],control:{cancellation_turn_id:'turn_cancel',cancellation_status:'cancelled'}});
  assert.equal(await verifyTaskCommitments(result),true);assert.equal(result.execution,null);assert.equal(result.receipt.runtime_result_sha256,null);assert.equal(result.runtime.fully_connected,false);
  assert.equal(result.artifact.actual_output.operation_args.product,391);assert.equal(result.provider_evidence.length,1);
  result.artifact.actual_output.operation_args.product=392;assert.equal(await verifyTaskCommitments(result),false);
});
