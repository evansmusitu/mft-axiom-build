import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TEMPORAL_DURABLE_WORK_DESCRIPTOR,
  createTemporalDurableWorkBackend,
} from '../product_intelligence/backends/temporal_durable_work_backend.js';

function fakeTransport({failStart=false}={}){
  const calls=[];
  return {
    calls,
    async start(input){calls.push({op:'start',input:structuredClone(input)});if(failStart)throw new Error('temporal unavailable');return {workflow_id:input.workflow_id,run_id:'run_12345678',status:'RUNNING'};},
    async describe(input){calls.push({op:'describe',input:structuredClone(input)});return {status:'RUNNING',history_length:3};},
    async signal(input){calls.push({op:'signal',input:structuredClone(input)});return {accepted:true};},
    async cancel(input){calls.push({op:'cancel',input:structuredClone(input)});return {accepted:true,status:'CANCEL_REQUESTED'};},
    async result(input){calls.push({op:'result',input:structuredClone(input)});return {status:'COMPLETED',output:{artifact_id:'artifact_12345678'}};},
  };
}

const startInput={
  projectId:'project_12345678',workId:'work_12345678',workflowType:'axiomProductWork',
  workloadIdentityId:'agent_workload_12345678',idempotencyKey:'idem_12345678',
  input:{objective:'Build verified candidate'},
};

test('Temporal adapter is a mechanism-only DurableWorkBackend pinned to frozen baseline',()=>{
  assert.equal(TEMPORAL_DURABLE_WORK_DESCRIPTOR.kind,'DurableWorkBackend');
  assert.equal(TEMPORAL_DURABLE_WORK_DESCRIPTOR.provider,'temporal');
  assert.equal(TEMPORAL_DURABLE_WORK_DESCRIPTOR.provider_baseline,'1.32.0');
  assert.equal(TEMPORAL_DURABLE_WORK_DESCRIPTOR.semantic_owner,'AXIOM');
  assert.equal(TEMPORAL_DURABLE_WORK_DESCRIPTOR.authority,'MECHANISM_ONLY');
  assert.equal(TEMPORAL_DURABLE_WORK_DESCRIPTOR.live_runtime_qualification,'NOT_PROVEN');
  assert.equal(TEMPORAL_DURABLE_WORK_DESCRIPTOR.fail_closed,true);
});

test('startWork creates deterministic AXIOM-bound provider identity without granting authority',async()=>{
  const transport=fakeTransport();
  const backend=createTemporalDurableWorkBackend({transport,namespace:'axiom-dev',taskQueue:'axiom-product-intelligence'});
  const receipt=await backend.startWork(startInput);
  assert.equal(receipt.schema,'musitu.axiom.temporal-work-receipt.v1');
  assert.equal(receipt.project_id,'project_12345678');
  assert.equal(receipt.work_id,'work_12345678');
  assert.equal(receipt.workflow_id,'axiom:project_12345678:work_12345678');
  assert.equal(receipt.run_id,'run_12345678');
  assert.equal(receipt.authority_effect,'NONE');
  assert.equal(receipt.external_action_executed,false);
  assert.equal(receipt.production_authority,false);
  assert.equal(receipt.live_runtime_qualification,'NOT_PROVEN');
  assert.match(receipt.receipt_sha256,/^[a-f0-9]{64}$/);

  const call=transport.calls[0];
  assert.equal(call.op,'start');
  assert.equal(call.input.namespace,'axiom-dev');
  assert.equal(call.input.task_queue,'axiom-product-intelligence');
  assert.equal(call.input.idempotency_key,'idem_12345678');
  assert.equal(call.input.memo.project_id,'project_12345678');
  assert.equal(call.input.memo.workload_identity_id,'agent_workload_12345678');
});

test('mutating provider calls fail closed on missing identity/idempotency and authority-like signals',async()=>{
  const backend=createTemporalDurableWorkBackend({transport:fakeTransport()});
  await assert.rejects(()=>backend.startWork({...startInput,idempotencyKey:''}),/idempotencyKey required/);
  await assert.rejects(()=>backend.startWork({...startInput,workloadIdentityId:''}),/workloadIdentityId required/);
  const handle=await backend.startWork(startInput);
  await assert.rejects(()=>backend.signalWork(handle,{signal:'grant-production-authority',payload:{allow:true},idempotencyKey:'signal_12345678'}),/authority-like workflow signal blocked/);
});

test('Temporal provider outage is explicit and never silently replaced by local success',async()=>{
  const backend=createTemporalDurableWorkBackend({transport:fakeTransport({failStart:true})});
  await assert.rejects(()=>backend.startWork(startInput),/temporal unavailable/);
});

test('describe signal cancel and result preserve the original Project/Work binding',async()=>{
  const transport=fakeTransport();
  const backend=createTemporalDurableWorkBackend({transport});
  const handle=await backend.startWork(startInput);
  const described=await backend.describeWork(handle);
  assert.equal(described.project_id,'project_12345678');
  assert.equal(described.work_id,'work_12345678');
  assert.equal(described.provider_status,'RUNNING');
  assert.equal(described.authority_effect,'NONE');

  const signaled=await backend.signalWork(handle,{signal:'checkpoint-ready',payload:{checkpoint_sha256:'a'.repeat(64)},idempotencyKey:'signal_12345678'});
  assert.equal(signaled.accepted,true);
  assert.equal(signaled.authority_effect,'NONE');

  const cancelled=await backend.cancelWork(handle,{reason:'operator requested stop',idempotencyKey:'cancel_12345678'});
  assert.equal(cancelled.provider_status,'CANCEL_REQUESTED');
  assert.equal(cancelled.production_authority,false);

  const result=await backend.result(handle);
  assert.equal(result.provider_status,'COMPLETED');
  assert.deepEqual(result.output,{artifact_id:'artifact_12345678'});
  assert.equal(result.live_runtime_qualification,'NOT_PROVEN');
});
