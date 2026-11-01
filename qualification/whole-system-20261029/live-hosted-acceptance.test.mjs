import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interruptedCreationFetch,acceptanceResult,runGovernedHostedTask,isActiveCancellationTurn} from './live-hosted-acceptance.mjs';
import {sha256Json,verifyTaskCommitments} from '../../axiom_interface/vnext/execution_integrity.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('active cancellation rejects queued, terminal, primary and subagent events',()=>{
  for(const status of ['queued','waiting','completed','failed','cancelled'])assert.equal(isActiveCancellationTurn({type:'agent.session.turn.created',turn:{id:'control',status}},'primary'),false);
  for(const turn of [{id:'primary',status:'in_progress'},{id:'child',status:'in_progress',subagent_id:'child'}])assert.equal(isActiveCancellationTurn({type:'agent.session.turn.in_progress',turn},'primary'),false);
  assert.equal(isActiveCancellationTurn({type:'agent.session.turn.in_progress',turn:{id:'control',status:'in_progress'}},'primary'),true);
});

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

test('complete live-runner collaboration uses real transactional SQLite, persisted IDs and actual SDK protocol without another create',{timeout:10000},async t=>{
  const connection=new DatabaseSync(':memory:');t.after(()=>connection.close());
  connection.exec(readFileSync(new URL('../../ops/axiom_execution_contract_schema.sql',import.meta.url),'utf8'));
  const db={exec:async sql=>connection.exec(sql),prepare(sql){const query=connection.prepare(sql);let args=[];const statement={bind(...values){args=values;return statement;},first:async()=>query.get(...args)??null,all:async()=>({results:query.all(...args)}),run:async()=>({meta:{changes:query.run(...args).changes}}),_run:()=>({meta:{changes:query.run(...args).changes}})};return statement;},async batch(statements){connection.exec('BEGIN IMMEDIATE');try{const out=statements.map(s=>s._run());connection.exec('COMMIT');return out;}catch(error){connection.exec('ROLLBACK');throw error;}}};
  const out=mkdtempSync(join(tmpdir(),'axiom-hosted-runner-'));t.after(()=>rmSync(out,{recursive:true,force:true}));
  const originalFetch=globalThis.fetch,originalKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='local-fixture-key';
  t.after(()=>{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;});
  let creates=0,output,controlStream,controlStatus='in_progress',cancelRequests=0;
  const json=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  const sse=event=>new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n');
  const turn=(id,status)=>({id,session_id:'session_real_protocol',object:'agent.session.turn',status,subagent_id:null});
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(String(url)).pathname,method=init.method||'GET';
    if(path==='/v1/agents/sessions'&&method==='POST'){
      creates++;const input=JSON.parse(JSON.parse(init.body).input);
      output={title:'Acceptance',needs_research:false,search_query:'',operation:null,operation_args:{nonce:input.acceptance_test.nonce,product:391}};
      return new Response(new ReadableStream({start(controller){controller.enqueue(sse({type:'agent.session.created',session:{id:'session_real_protocol',status:'in_progress',required_actions:[]}}));controller.enqueue(sse({type:'agent.session.turn.created',turn:turn('turn_primary','queued')}));controller.enqueue(sse({type:'agent.session.turn.completed',turn:turn('turn_primary','completed')}));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
    }
    if(path.endsWith('/turns/turn_primary'))return json(turn('turn_primary','completed'));
    if(path.endsWith('/turns/turn_cancel'))return json(turn('turn_cancel',controlStatus));
    if(path.endsWith('/items'))return json({object:'list',data:[{id:'message_primary',type:'message',role:'assistant',phase:'final_answer',status:'completed',turn_id:'turn_primary',content:[{type:'output_text',text:JSON.stringify(output)}]}],has_more:false});
    if(path.endsWith('/events')&&method==='GET')return new Response(new ReadableStream({start(controller){controlStream=controller;},cancel(){}}),{headers:{'content-type':'text/event-stream'}});
    if(path.endsWith('/events')&&method==='POST'){
      const body=JSON.parse(init.body);if(body.events[0].type==='agent.session.input.message'){
        controlStream.enqueue(sse({type:'agent.session.turn.created',turn:turn('turn_cancel','queued')}));
        controlStream.enqueue(sse({type:'agent.session.turn.in_progress',turn:turn('turn_cancel','in_progress')}));
      }
      else{cancelRequests++;controlStatus='cancelled';}return new Response(null,{status:204});
    }
    throw new Error('unexpected local provider fixture route');
  };
  const report={resources:{},source_sha:'a'.repeat(40)},checkpoints=[];
  const result=await runGovernedHostedTask({db,report,out,save(){},checkpoint:async update=>{const row=await db.prepare(update.stage==='cancellation_control'?'SELECT session_id,control_turn_id AS turn_id FROM axiom_acceptance_controls':'SELECT session_id,turn_id FROM axiom_ec_agent_invocations').first();assert.equal(row.session_id,update.session_id);assert.equal(row.turn_id,update.turn_id);checkpoints.push(update);}});
  assert.equal(creates,1);assert.equal(cancelRequests,1);assert.equal(checkpoints.length,3);assert.equal(checkpoints[1].turn_id,'turn_primary');assert.equal(checkpoints[2].turn_id,'turn_cancel');
  assert.equal(result.stream_interrupted,true);assert.equal(result.cancellation_status,'cancelled');assert.equal(result.inputs_resent,false);
  const saved=JSON.parse(connection.prepare('SELECT result_json FROM axiom_ec_runs').get().result_json);assert.equal(await verifyTaskCommitments(saved),true);assert.equal(saved.artifact.actual_output.operation_args.product,391);
});
