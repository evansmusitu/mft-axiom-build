import assert from 'node:assert/strict';
import test from 'node:test';
import {CONDITIONAL_INFRASTRUCTURE_COMPONENTS,evaluateConditionalInfrastructure} from '../product_intelligence/conditional_infrastructure_admission.js';

test('conditional distributed infrastructure is frozen as five non-mandatory AXIOM-governed components',()=>{
  assert.deepEqual(Object.keys(CONDITIONAL_INFRASTRUCTURE_COMPONENTS).sort(),['clickhouse','nats_jetstream','object_storage','spire','valkey']);
  for(const row of Object.values(CONDITIONAL_INFRASTRUCTURE_COMPONENTS)){
    assert.equal(row.mandatory,false);
    assert.equal(row.semantic_owner,'AXIOM');
    assert.equal(row.authority,'MECHANISM_ONLY');
    assert.equal(row.provider_selected,false);
  }
  assert.equal(typeof evaluateConditionalInfrastructure,'function');
});

const base={projectId:'project_12345678',workId:'work_12345678',requestId:'request_12345678'};

test('missing trigger evidence stays NOT_PROVEN and authorizes no component activation',async()=>{
  const out=await evaluateConditionalInfrastructure({...base,evidence:[]});
  assert.equal(out.schema,'musitu.axiom.conditional-infrastructure-admission.v1');
  assert.equal(out.project_id,base.projectId);
  assert.equal(out.work_id,base.workId);
  assert.equal(out.request_id,base.requestId);
  assert.equal(out.activation_authorized,false);
  assert.deepEqual(out.triggered_components,[]);
  assert.equal(out.required_next_gate,'TRIGGER_EVIDENCE_REQUIRED_OR_CONTINUE_WITHOUT_CONDITIONAL_COMPONENTS');
  for(const row of out.components){
    assert.equal(row.activation_state,'NOT_PROVEN');
    assert.equal(row.implementation_required_now,false);
    assert.equal(row.provider_selected,false);
    assert.equal(row.release_authority,false);
    assert.equal(row.production_authority,false);
    assert.equal(row.certification_authority,false);
  }
  assert.match(out.admission_sha256,/^[a-f0-9]{64}$/);
});

test('each conditional component has an explicit frozen trigger contract and target seam',()=>{
  const expected={
    spire:{seam:'WorkloadIdentityProvider',triggers:['distributed_workload_identity_required','existing_axiom_identity_insufficient','cryptographic_workload_attestation_required']},
    nats_jetstream:{seam:'EventBusBackend',triggers:['durable_pubsub_required','multi_consumer_fanout_required','temporal_workflow_semantics_insufficient']},
    valkey:{seam:'TRANSIENT_COORDINATION_MECHANISM',triggers:['shared_ephemeral_state_required','durable_database_semantics_inappropriate','bounded_low_latency_coordination_required']},
    clickhouse:{seam:'AnalyticsWarehouseBackend',triggers:['columnar_analytics_required','postgres_otel_analytics_insufficient','high_volume_scan_or_retention_required']},
    object_storage:{seam:'ObjectStoreBackend',triggers:['large_binary_or_immutable_blob_store_required','postgres_storage_inappropriate','artifact_or_evidence_blob_volume_requires_object_store']},
  };
  for(const [name,row] of Object.entries(expected)){
    assert.equal(CONDITIONAL_INFRASTRUCTURE_COMPONENTS[name].target_seam,row.seam);
    assert.deepEqual(CONDITIONAL_INFRASTRUCTURE_COMPONENTS[name].trigger_keys,row.triggers);
  }
});

function verifiedEvidence(component,triggers){return {
  component,projectId:base.projectId,workId:base.workId,evidenceId:`evidence_${component}`,evidenceArtifactSha256:'a'.repeat(64),verificationArtifactSha256:'b'.repeat(64),
  builderId:'builder_agent_12345678',verifierId:'independent_verifier_12345678',verificationStatus:'PASS',triggers,
};}

test('fully verified component-specific trigger evidence admits implementation only, never runtime activation',async()=>{
  const ev=verifiedEvidence('nats_jetstream',{
    durable_pubsub_required:true,multi_consumer_fanout_required:true,temporal_workflow_semantics_insufficient:true,
  });
  const out=await evaluateConditionalInfrastructure({...base,evidence:[ev]});
  assert.deepEqual(out.triggered_components,['nats_jetstream']);
  assert.equal(out.conditional_implementation_admitted,true);
  assert.equal(out.activation_authorized,false);
  assert.equal(out.required_next_gate,'IMPLEMENT_TRIGGERED_COMPONENTS_IN_ISOLATION');
  const row=out.components.find(x=>x.component==='nats_jetstream');
  assert.equal(row.activation_state,'TRIGGERED_CANDIDATE');
  assert.equal(row.implementation_required_now,true);
  assert.equal(row.target_seam,'EventBusBackend');
  assert.equal(row.evidence_artifact_sha256,'a'.repeat(64));
  assert.equal(row.verification_artifact_sha256,'b'.repeat(64));
  assert.equal(row.release_authority,false);
  assert.equal(row.production_authority,false);
  assert.equal(row.certification_authority,false);
});

test('trigger evidence is bound to the exact Project and Work identities',async()=>{
  const triggers={durable_pubsub_required:true,multi_consumer_fanout_required:true,temporal_workflow_semantics_insufficient:true};
  for(const patch of [{projectId:'project_other_12345678'},{workId:'work_other_12345678'}]){
    const ev={...verifiedEvidence('nats_jetstream',triggers),...patch};
    await assert.rejects(()=>evaluateConditionalInfrastructure({...base,evidence:[ev]}),/identity|project|work/i);
  }
});

test('malformed, self-verified, credential-bearing or architecture-escalating trigger evidence fails closed',async()=>{
  const triggers={durable_pubsub_required:true,multi_consumer_fanout_required:true,temporal_workflow_semantics_insufficient:true};
  const good=verifiedEvidence('nats_jetstream',triggers);
  const cases=[
    {...good,component:'unknown_bus'},
    {...good,evidenceArtifactSha256:'bad'},
    {...good,verifierId:good.builderId},
    {...good,provider:'nats'},
    {...good,mandatory:true},
    {...good,release_authority:true},
    {...good,triggers:{durable_pubsub_required:true,multi_consumer_fanout_required:true}},
    {...good,triggers:{...triggers,unexpected:true}},
    {...good,triggers:{...triggers,durable_pubsub_required:'yes'}},
    {...good,triggers:{...triggers,password:'hunter2'}},
  ];
  for(const ev of cases) await assert.rejects(()=>evaluateConditionalInfrastructure({...base,evidence:[ev]}));
});

test('independent verification artifact must be distinct from the trigger evidence artifact',async()=>{
  const triggers={durable_pubsub_required:true,multi_consumer_fanout_required:true,temporal_workflow_semantics_insufficient:true};
  const ev=verifiedEvidence('nats_jetstream',triggers);
  ev.verificationArtifactSha256=ev.evidenceArtifactSha256;
  await assert.rejects(()=>evaluateConditionalInfrastructure({...base,evidence:[ev]}),/verification artifact.*distinct|distinct.*verification artifact/i);
});

test('explicit verifier failure is REJECTED rather than mislabeled NOT_PROVEN',async()=>{
  const ev=verifiedEvidence('nats_jetstream',{durable_pubsub_required:true,multi_consumer_fanout_required:true,temporal_workflow_semantics_insufficient:true});
  ev.verificationStatus='FAIL';
  const out=await evaluateConditionalInfrastructure({...base,evidence:[ev]});
  const row=out.components.find(x=>x.component==='nats_jetstream');
  assert.equal(row.activation_state,'REJECTED');
  assert.equal(row.implementation_required_now,false);
  assert.deepEqual(out.rejected_components,['nats_jetstream']);
  assert.deepEqual(out.triggered_components,[]);
});

test('verified negative trigger evidence is NOT_TRIGGERED, distinct from missing evidence',async()=>{
  const ev=verifiedEvidence('nats_jetstream',{durable_pubsub_required:true,multi_consumer_fanout_required:false,temporal_workflow_semantics_insufficient:true});
  const out=await evaluateConditionalInfrastructure({...base,evidence:[ev]});
  const row=out.components.find(x=>x.component==='nats_jetstream');
  assert.equal(row.activation_state,'NOT_TRIGGERED');
  assert.equal(row.implementation_required_now,false);
  assert.deepEqual(out.not_triggered_components,['nats_jetstream']);
  assert.equal(out.activation_authorized,false);
});

test('unknown top-level admission fields fail closed instead of being ignored',async()=>{
  for(const patch of [{mandatory:true},{provider:'nats'},{release_authority:true},{runtimeActivationAuthorized:true}]){
    await assert.rejects(()=>evaluateConditionalInfrastructure({...base,evidence:[],...patch}),/unsupported fields|request/i);
  }
});
