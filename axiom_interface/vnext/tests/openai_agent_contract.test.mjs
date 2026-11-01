import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1,applyExecutionSchema} from '../../tests/execution_test_helpers.mjs';
import {createD1ExecutionGovernance} from '../../../ops/axiom_execution_contract.mjs';
import {createGovernedAgentModel,inspectAgentInvocations,verifyAgentModelEvidence,reconcileAgentInvocation} from '../../../ops/axiom_agent_model_store.mjs';
import {createConfiguredOpenAIAgentModel} from '../../../ops/axiom_openai_agent_model.mjs';
import {executeRuntimeTask} from '../runtime_task_service.mjs';
import {ATOMIC_OPERATIONS} from '../capability_registry.js';
import {sha256Json} from '../execution_integrity.mjs';
import {handleRuntimeTaskApi} from '../../../ops/axiom_runtime_task_api.mjs';

const customer={customer_id:'tenant-agent'},objective='Prepare a short planning brief.',taskId='task_agent_fixture';
const planning={title:'Declared planning brief',needs_research:false,search_query:'',operation:null,operation_args:{}};
const synthesis={title:'Brief',summary:'A bounded model proposal.',findings:['Declared assumption'],limitations:['No independent factual validation'],citations:[]};

async function fixture(t,{privacy='Project',admitted=true,create,objective:chosenObjective=objective,execute,clock}={}){
  const db=applyExecutionSchema(sqliteD1());t.after(()=>db.connection.close());
  const now=clock?()=>new Date(clock.ms):()=>new Date();
  const gate=createD1ExecutionGovernance({db,customer,now}),binding=await gate.admit({objective:chosenObjective,context:{project_id:'project-agent',work_id:'work-agent',controls:{privacy,budget:1}}});
  const calls=[];
  const client={async create(args){calls.push(args);if(create)return create(args,calls.length);
    const stage=JSON.parse(args.input).stage,session_id='session_'+calls.length,turn_id='turn_'+calls.length;
    await args.onCheckpoint({session_id,turn_id:null});await args.onCheckpoint({session_id,turn_id});
    return {session_id,turn_id,status:'completed',output_text:JSON.stringify(stage==='planning'?planning:synthesis)};
  }};
  const model=createGovernedAgentModel({db,customer,taskId,governance:binding,client,model:'fixture-model',admitted,now});
  const runtime={inspect:async()=>({ok:true,build_id:'fixture',operation_count:74,tools:ATOMIC_OPERATIONS}),execute:execute??(async()=>{throw new Error('no quantitative execution expected');})};
  const run=()=>executeRuntimeTask({objective:chosenObjective,customer,governance:binding,store:binding,model,runtime,idFactory:()=>taskId,now});
  const start=()=>binding.create({task_id:taskId,request_id:'request-agent',customer_id:customer.customer_id,objective:chosenObjective,status:'RUNNING',execution_contract:binding.contract});
  return {db,binding,gate,model,calls,run,start};
}

test('hosted planning and synthesis commit provider evidence through the five-object contract',async t=>{
  const f=await fixture(t),result=await f.run();assert.equal(result.status,'COMPLETED');assert.equal(f.calls.length,2);
  assert.equal(result.provider_evidence.length,2);assert.equal(result.artifact.synthesis_mode,'OPENAI_AGENTS_GROUNDED');
  const saved=await f.gate.get(taskId);assert.equal(saved.receipt.receipt_sha256,result.receipt.receipt_sha256);
  assert.equal(saved.object_refs.evidence.filter(x=>x.kind==='PROVIDER_MODEL_EXECUTION').length,2);
  assert.equal(f.db.connection.prepare('SELECT provider_calls FROM axiom_ec_works').get().provider_calls,2);
  assert.ok(f.calls.every(x=>x.invocationId.startsWith('agent_')));
  assert.ok(f.db.connection.prepare('SELECT session_id,turn_id FROM axiom_ec_agent_invocations').all().every(x=>x.session_id&&x.turn_id));
});

test('uncertain creation persists checkpoints and never automatically resends the input',async t=>{
  const f=await fixture(t,{create:async args=>{await args.onCheckpoint({session_id:'session_uncertain',turn_id:'turn_uncertain'});throw new Error('provider-sensitive-text-must-not-be-saved');}});
  await f.start();await f.binding.reserve({kind:'model'});
  const input={stage:'planning',objective};await assert.rejects(()=>f.model(input),/reconciliation/);
  await assert.rejects(()=>f.model(input),/reconciliation/);assert.equal(f.calls.length,1);
  const rows=await inspectAgentInvocations({db:f.db,customer,taskId});assert.equal(rows[0].status,'UNCERTAIN');assert.equal(rows[0].session_id,'session_uncertain');
  assert.equal(rows[0].error_code,'HOSTED_RECONCILIATION_REQUIRED');assert.ok(!JSON.stringify(rows).includes('provider-sensitive'));
  assert.deepEqual(await inspectAgentInvocations({db:f.db,customer:{customer_id:'another-tenant'},taskId}),[]);
});

test('no admitted model reservation means no hosted dispatch',async t=>{
  const f=await fixture(t);await f.start();await assert.rejects(()=>f.model({stage:'planning',objective}),/reservation/);assert.equal(f.calls.length,0);
});

test('private, unadmitted and altered-objective work cannot dispatch hosted calls',async t=>{
  for(const options of [{privacy:'Private'},{admitted:false},{}])await t.test(JSON.stringify(options),async child=>{
    const f=await fixture(child,options);await f.start();
    await assert.rejects(()=>f.model({stage:'planning',objective:Object.keys(options).length?objective:'A replaced objective'}));assert.equal(f.calls.length,0);
  });
});

test('idle or malformed provider results cannot produce a successful model proof',async t=>{
  for(const response of [{status:'idle',session_id:'s',turn_id:'t',output_text:'{}'},{status:'completed',session_id:'s',turn_id:'t',output_text:'not-json'}])await t.test(response.status+response.output_text,async child=>{
    const f=await fixture(child,{create:async()=>response});await f.start();await f.binding.reserve({kind:'model'});
    await assert.rejects(()=>f.model({stage:'planning',objective}));assert.equal(f.db.connection.prepare('SELECT status FROM axiom_ec_agent_invocations').get().status,'UNCERTAIN');
  });
});

test('provider checkpoints reject replacement session/turn identities',async t=>{
  const f=await fixture(t,{create:async args=>{await args.onCheckpoint({session_id:'session_first',turn_id:'turn_first'});await args.onCheckpoint({session_id:'session_replaced',turn_id:'turn_first'});}});
  await f.start();await f.binding.reserve({kind:'model'});await assert.rejects(()=>f.model({stage:'planning',objective}));
  const row=f.db.connection.prepare('SELECT session_id,status FROM axiom_ec_agent_invocations').get();assert.equal(row.session_id,'session_first');assert.equal(row.status,'UNCERTAIN');
});

test('revocation during hosted work records the provider outcome and prevents task completion',async t=>{
  let f;
  f=await fixture(t,{create:async args=>{await args.onCheckpoint({session_id:'session_revoked',turn_id:'turn_revoked'});await f.binding.revoke();return {status:'completed',session_id:'session_revoked',turn_id:'turn_revoked',output_text:JSON.stringify(planning)};}});
  await assert.rejects(()=>f.run());assert.equal(f.db.connection.prepare('SELECT status FROM axiom_ec_agent_invocations').get().status,'SUCCEEDED');
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_artifacts').get().n,0);assert.equal(f.calls.length,1);
});

test('provider proof readback rejects output corruption and forged identity claims',async t=>{
  const f=await fixture(t),result=await f.run();
  const forged=structuredClone(result.provider_evidence);forged[0].session_id='session_forged';
  await assert.rejects(()=>verifyAgentModelEvidence({db:f.db,tenant:customer.customer_id,taskId,evidence:forged}));
  f.db.connection.prepare('UPDATE axiom_ec_agent_invocations SET output_json=? WHERE stage=?').run('{"title":"forged"}','planning');
  await assert.rejects(()=>f.gate.get(taskId),/commitment/);
});

test('completed provider output can be read again without another upstream call',async t=>{
  const f=await fixture(t);await f.start();await f.binding.reserve({kind:'model'});
  const input={stage:'planning',objective};assert.deepEqual(await f.model(input),planning);assert.deepEqual(await f.model(input),planning);assert.equal(f.calls.length,1);
  await assert.rejects(()=>f.model({...input,extra:'changed'}));assert.equal(f.calls.length,1);
});

test('selected OpenAI provider fails closed without server admission or an existing key',async()=>{
  assert.equal(await createConfiguredOpenAIAgentModel({}),null);
  await assert.rejects(()=>createConfiguredOpenAIAgentModel({AXIOM_AGENT_PROVIDER:'openai_agents'}));
  await assert.rejects(()=>createConfiguredOpenAIAgentModel({AXIOM_AGENT_PROVIDER:'openai_agents',AXIOM_OPENAI_AGENTS_ADMITTED:'true'}));
});

test('a binding for another active task cannot consume this tasks model reservation',async t=>{
  const f=await fixture(t);await f.start();await f.binding.reserve({kind:'model'});
  const other=await f.gate.admit({objective,context:{project_id:'project-agent',work_id:'work-agent',controls:{privacy:'Project',budget:1}}});
  await other.create({task_id:'task_other_active',request_id:'request-other',customer_id:customer.customer_id,objective,status:'RUNNING',execution_contract:other.contract});
  await other.reserve({kind:'model'});
  let calls=0;
  const wrong=createGovernedAgentModel({db:f.db,customer,taskId,governance:other,model:'fixture-model',admitted:true,client:{async create(){calls++;return {session_id:'s',turn_id:'t',status:'completed',output_text:'{}'};}}});
  await assert.rejects(()=>wrong({stage:'planning',objective}));assert.equal(calls,0);
});

test('concurrent conflicting checkpoints cannot replace the first persisted identity',async t=>{
  const f=await fixture(t,{create:async args=>{
    await Promise.all([args.onCheckpoint({session_id:'session_first',turn_id:'turn_first'}),args.onCheckpoint({session_id:'session_second',turn_id:'turn_second'})]);
    return {session_id:'session_second',turn_id:'turn_second',status:'completed',output_text:JSON.stringify(planning)};
  }});
  await f.start();await f.binding.reserve({kind:'model'});await assert.rejects(()=>f.model({stage:'planning',objective}));
  const row=f.db.connection.prepare('SELECT session_id,turn_id,status FROM axiom_ec_agent_invocations').get();
  assert.equal(row.session_id,'session_first');assert.equal(row.turn_id,'turn_first');assert.equal(row.status,'UNCERTAIN');
});

test('persisted provider identity cannot drift under an unchanged task proof',async t=>{
  const f=await fixture(t);await f.run();
  f.db.connection.prepare("UPDATE axiom_ec_agent_invocations SET provider='different-provider' WHERE stage='planning'").run();
  await assert.rejects(()=>f.gate.get(taskId),/provider identity/);
});

test('explicit reconciliation reads the saved turn without resending input or completing the task',async t=>{
  const f=await fixture(t,{create:async args=>{await args.onCheckpoint({session_id:'session_lost',turn_id:'turn_lost'});throw new Error('observer lost');}});
  await f.start();await f.binding.reserve({kind:'model'});await assert.rejects(()=>f.model({stage:'planning',objective}));
  let reads=0;
  const args={db:f.db,customer,taskId,stage:'planning',client:{async reconcile(input){reads++;assert.deepEqual(input,{sessionId:'session_lost',turnId:'turn_lost'});return {session_id:'session_lost',turn_id:'turn_lost',status:'completed',output_text:JSON.stringify(planning)};}}};
  const reconciled=await reconcileAgentInvocation(args);assert.equal(reconciled.status,'completed');assert.equal(reconciled.input_resubmitted,false);assert.equal(reconciled.task_completion_authorized,false);
  assert.equal(f.calls.length,1);assert.equal(reads,1);assert.equal(f.db.connection.prepare('SELECT status FROM axiom_ec_runs').get().status,'RUNNING');
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_artifacts').get().n,0);assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_reservations').get().n,1);
  assert.equal((await reconcileAgentInvocation(args)).status,'completed');assert.equal(reads,1);
  assert.equal(await reconcileAgentInvocation({...args,customer:{customer_id:'foreign-tenant'}}),null);
});

test('reconciliation attempts remain bounded and unknown provider IDs never trigger a resend',async t=>{
  const f=await fixture(t,{create:async args=>{await args.onCheckpoint({session_id:'session_pending',turn_id:'turn_pending'});throw new Error('unknown outcome');}});
  await f.start();await f.binding.reserve({kind:'model'});await assert.rejects(()=>f.model({stage:'planning',objective}));
  let reads=0;const args={db:f.db,customer,taskId,stage:'planning',client:{async reconcile(){reads++;return {session_id:'session_pending',turn_id:'turn_pending',status:'running',output_text:''};}}};
  for(let i=0;i<3;i++)assert.equal((await reconcileAgentInvocation(args)).status,'pending');
  await assert.rejects(()=>reconcileAgentInvocation(args),/exhausted/);assert.equal(reads,3);assert.equal(f.calls.length,1);
});

test('reconciliation uses bounded provider waiting as one durable read operation and never redispatches the interrupted stage',async t=>{
  const f=await fixture(t,{create:async args=>{await args.onCheckpoint({session_id:'session_waited',turn_id:'turn_waited'});throw new Error('observer disconnected');}});
  await f.start();await f.binding.reserve({kind:'model'});await assert.rejects(()=>f.model({stage:'planning',objective}));
  let waits=0;
  const client={async reconcile(){throw new Error('single-read path must not burn attempts while provider is queued');},async waitForCompletion(input){waits++;assert.deepEqual(input,{sessionId:'session_waited',turnId:'turn_waited'});return {session_id:'session_waited',turn_id:'turn_waited',status:'completed',output_text:JSON.stringify(planning)};}};
  const recovered=await reconcileAgentInvocation({db:f.db,customer,taskId,stage:'planning',client});assert.equal(recovered.status,'completed');assert.equal(waits,1);assert.equal(f.calls.length,1);
  assert.equal(f.db.connection.prepare('SELECT reconcile_reads FROM axiom_ec_agent_invocations').get().reconcile_reads,1);
  assert.equal((await f.model({stage:'planning',objective})).operation,null);assert.equal(f.calls.length,1);
});

test('an invocation admitted after proof validation aborts the whole artifact transaction',async t=>{
  const chosen='Calculate 40+2.';let f;
  f=await fixture(t,{objective:chosen,execute:async input=>{
    await f.binding.reserve({kind:'model'});
    const envelope={result:{value:42}},digest=await sha256Json(envelope);
    return {operation:input.operation,request_id:input.request_id,http_status:200,result:envelope.result,committed_response:envelope,receipt:{result_sha256:digest,result_commitment_verified:true}};
  }});
  const original=f.db.batch.bind(f.db);let injected=false;
  f.db.batch=async statements=>{
    if(!injected&&statements.length>=4){injected=true;await f.model({stage:'planning',objective:chosen});}
    return original(statements);
  };
  await assert.rejects(()=>f.run(),/hosted invocation set changed/);assert.equal(injected,true);
  assert.equal(f.db.connection.prepare('SELECT status FROM axiom_ec_runs').get().status,'FAILED');
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_artifacts').get().n,0);
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_agent_completion_guards').get().n,0);
});

test('a resumed lease cannot silently adopt a prior lease provider proof',async t=>{
  const clock={ms:Date.parse('2026-11-01T04:00:00.000Z')},f=await fixture(t,{clock});
  await f.start();await f.binding.reserve({kind:'model'});await f.model({stage:'planning',objective});
  const evidence=f.model.getEvidence();clock.ms+=120001;
  const fresh=await f.gate.admit({objective,context:{project_id:'project-agent',work_id:'work-agent',controls:{privacy:'Project',budget:1}}});
  await fresh.resume(taskId);await fresh.reserve({kind:'model'});
  await assert.rejects(()=>verifyAgentModelEvidence({db:f.db,tenant:customer.customer_id,taskId,evidence}),/resolve/);
});

test('configured HTTP route uses the actual SDK and persists both completed provider turns',async t=>{
  const f=await fixture(t),originalFetch=globalThis.fetch,jobs=[],origin='https://agent-route.example';let requests=0;
  globalThis.fetch=async(url,init)=>{
    assert.equal(new URL(url).origin,'https://api.openai.com');assert.equal(init.method,'POST');
    const request=JSON.parse(init.body);assert.equal(request.agent.model,'fixture-model');
    assert.deepEqual(request.environment,{type:'openai_hosted',network:{access:'disabled'}});assert.deepEqual(request.agent.tools,[]);
    requests++;const session='session_route_'+requests,turn='turn_route_'+requests;
    const output=JSON.stringify(requests===1?planning:synthesis);
    const turnRecord={id:turn,object:'agent.session.turn',session_id:session,subagent_id:null,status:'completed'};
    const events=[
      {type:'agent.session.created',event_id:'created_'+requests,session:{id:session,object:'agent.session',status:'in_progress',required_actions:[]}},
      {type:'agent.session.turn.created',event_id:'turn_'+requests,session_id:session,turn_id:turn,turn:{...turnRecord,status:'queued'}},
      {type:'agent.session.turn.item.done',event_id:'output_'+requests,session_id:session,turn_id:turn,output_index:0,item:{id:'message_'+requests,type:'message',role:'assistant',phase:'final_answer',status:'completed',turn_id:turn,content:[{type:'output_text',text:output}]}},
      {type:'agent.session.turn.completed',event_id:'done_'+requests,session_id:session,turn_id:turn,turn:turnRecord},
    ];
    return new Response(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
  };
  try{
    const env={AXIOM_DB:f.db,AXIOM_AGENT_PROVIDER:'openai_agents',AXIOM_OPENAI_AGENTS_ADMITTED:'true',OPENAI_API_KEY:'fixture-route-key',OPENAI_AGENTS_MODEL:'fixture-model',TASK_RATE_LIMITER:{limit:async()=>({success:true})},AXIOM_RUNTIME:{async fetch(url){return Response.json(new URL(url).pathname==='/health'?{ok:true,operation_count:74,build_id:'fixture'}:{operation_count:74,build_id:'fixture',tools:ATOMIC_OPERATIONS});}}};
    const payload={objective,submission_id:'sdk-route-submission',execution_context:{project_id:'project-agent',work_id:'work-agent',controls:{privacy:'Project',budget:1}}};
    const response=await handleRuntimeTaskApi(new Request(origin+'/vnext/api/tasks',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(payload)}),env,{customer,origin,executionCtx:{waitUntil(job){jobs.push(job);}},fetchImpl:async()=>{throw new Error('no research expected');}});
    assert.equal(response.status,200);assert.match(await response.text(),/event: complete/);await Promise.all(jobs);
    const read=await handleRuntimeTaskApi(new Request(origin+'/vnext/api/submissions/sdk-route-submission'),env,{customer,origin});assert.equal(read.status,200);
    const saved=await read.json();assert.equal(saved.status,'COMPLETED');assert.equal(saved.provider_evidence.length,2);assert.equal(requests,2);
    assert.ok(saved.provider_evidence.every(p=>p.session_id.startsWith('session_route_')));
  }finally{await Promise.allSettled(jobs);globalThis.fetch=originalFetch;}
});
