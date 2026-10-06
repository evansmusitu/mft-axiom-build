import assert from 'node:assert/strict';
import test from 'node:test';
import {OPTIONAL_ADAPTER_CATALOG,evaluateOptionalAdapterAdmission} from '../product_intelligence/optional_adapter_admission.js';

test('frozen optional adapter catalog preserves AXIOM authority and never makes providers mandatory',()=>{
  assert.deepEqual(Object.keys(OPTIONAL_ADAPTER_CATALOG).sort(),['e2b','grapesjs','growthbook','langfuse','openhands','penpot']);
  for(const row of Object.values(OPTIONAL_ADAPTER_CATALOG)){
    assert.equal(row.semantic_owner,'AXIOM');
    assert.equal(row.authority,'MECHANISM_ONLY');
    assert.equal(row.mandatory,false);
    assert.equal(row.provider_selected,false);
    assert.equal(row.runtime_activation_authorized,false);
    assert.equal(row.release_authority,false);
    assert.equal(row.production_authority,false);
    assert.equal(row.certification_authority,false);
  }
  assert.equal(typeof evaluateOptionalAdapterAdmission,'function');
});

const base={projectId:'project_12345678',workId:'work_12345678',requestId:'request_12345678'};

test('absence of verified need evidence keeps every optional adapter NOT_PROVEN and proceeds to MUSITU layers without activation',async()=>{
  const out=await evaluateOptionalAdapterAdmission({...base,evidence:[]});
  assert.equal(out.schema,'musitu.axiom.optional-adapter-admission.v1');
  assert.equal(out.project_id,base.projectId);
  assert.equal(out.work_id,base.workId);
  assert.equal(out.request_id,base.requestId);
  assert.deepEqual(out.admitted_candidates,[]);
  assert.deepEqual(out.rejected_candidates,[]);
  assert.deepEqual(out.not_triggered_candidates,[]);
  assert.equal(out.optional_adapter_implementation_admitted,false);
  assert.equal(out.runtime_activation_authorized,false);
  assert.equal(out.required_next_gate,'MUSITU_LAYERS_WITHOUT_OPTIONAL_ADAPTERS');
  for(const row of out.adapters){
    assert.equal(row.admission_state,'NOT_PROVEN');
    assert.equal(row.implementation_required_now,false);
    assert.equal(row.provider_selected,false);
    assert.equal(row.runtime_activation_authorized,false);
  }
});

function verifiedEvidence(adapter,triggers){return {
  adapter,projectId:base.projectId,workId:base.workId,evidenceId:`evidence_${adapter}`,
  needEvidenceSha256:'a'.repeat(64),verificationArtifactSha256:'b'.repeat(64),
  builderId:'builder_agent_12345678',verifierId:'independent_verifier_12345678',verificationStatus:'PASS',triggers,
};}

test('fully verified adapter-specific need evidence admits isolated candidate work only, never provider selection or runtime activation',async()=>{
  const ev=verifiedEvidence('growthbook',{
    product_experimentation_required:true,openfeature_evaluation_alone_insufficient:true,external_experiment_adapter_permitted:true,
  });
  const out=await evaluateOptionalAdapterAdmission({...base,evidence:[ev]});
  assert.deepEqual(out.admitted_candidates,['growthbook']);
  assert.equal(out.optional_adapter_implementation_admitted,true);
  assert.equal(out.runtime_activation_authorized,false);
  assert.equal(out.required_next_gate,'ISOLATED_OPTIONAL_ADAPTER_QUALIFICATION');
  const row=out.adapters.find(x=>x.adapter==='growthbook');
  assert.equal(row.admission_state,'CANDIDATE_ADMITTED');
  assert.equal(row.implementation_required_now,true);
  assert.equal(row.target_seam,'ExperimentEngineBackend');
  assert.equal(row.provider,'GrowthBook');
  assert.equal(row.provider_selected,false);
  assert.equal(row.need_evidence_sha256,'a'.repeat(64));
  assert.equal(row.verification_artifact_sha256,'b'.repeat(64));
  assert.equal(row.release_authority,false);
  assert.equal(row.production_authority,false);
  assert.equal(row.certification_authority,false);
});

test('optional adapter evidence is bound to exact Project Work identity and builders cannot verify themselves',async()=>{
  const triggers={remote_sandbox_required:true,governed_namespace_sandbox_insufficient:true,external_compute_adapter_permitted:true};
  const good=verifiedEvidence('e2b',triggers);
  for(const ev of [
    {...good,projectId:'project_other_12345678'},
    {...good,workId:'work_other_12345678'},
    {...good,verifierId:good.builderId},
    {...good,verificationArtifactSha256:good.needEvidenceSha256},
  ]){
    await assert.rejects(()=>evaluateOptionalAdapterAdmission({...base,evidence:[ev]}),/identity|verifier|builder|distinct/i);
  }
});

test('malformed, credential-bearing, provider-selecting or authority-escalating optional-adapter evidence fails closed',async()=>{
  const triggers={llm_specific_observability_required:true,opentelemetry_semantics_insufficient:true,external_observability_adapter_permitted:true};
  const good=verifiedEvidence('langfuse',triggers);
  const cases=[
    {...good,adapter:'unknown_adapter'},
    {...good,provider:'Langfuse'},
    {...good,mandatory:true},
    {...good,provider_selected:true},
    {...good,runtime_activation_authorized:true},
    {...good,release_authority:true},
    {...good,password:'must-not-cross'},
    {...good,verificationStatus:'MAYBE'},
    {...good,evidenceId:''},
    {...good,needEvidenceSha256:'bad'},
    {...good,triggers:{llm_specific_observability_required:true,opentelemetry_semantics_insufficient:true}},
    {...good,triggers:{...triggers,unexpected:true}},
    {...good,triggers:{...triggers,llm_specific_observability_required:'yes'}},
  ];
  for(const ev of cases) await assert.rejects(()=>evaluateOptionalAdapterAdmission({...base,evidence:[ev]}));
});

test('duplicate evidence for the same optional adapter is rejected rather than last-write-wins',async()=>{
  const triggers={collaborative_vector_design_required:true,native_axiom_design_surface_insufficient:true,external_design_adapter_permitted:true};
  const one=verifiedEvidence('penpot',triggers);
  const two={...verifiedEvidence('penpot',triggers),evidenceId:'evidence_penpot_second',needEvidenceSha256:'c'.repeat(64),verificationArtifactSha256:'d'.repeat(64)};
  await assert.rejects(()=>evaluateOptionalAdapterAdmission({...base,evidence:[one,two]}),/duplicate/i);
});

test('verifier FAIL is REJECTED while verified unmet need is NOT_TRIGGERED, both distinct from missing evidence',async()=>{
  const full={visual_web_composition_required:true,native_axiom_artifact_editor_insufficient:true,embedded_visual_builder_permitted:true};
  const failed={...verifiedEvidence('grapesjs',full),verificationStatus:'FAIL'};
  const unmet=verifiedEvidence('langfuse',{llm_specific_observability_required:true,opentelemetry_semantics_insufficient:false,external_observability_adapter_permitted:true});
  const out=await evaluateOptionalAdapterAdmission({...base,evidence:[failed,unmet]});
  assert.deepEqual(out.rejected_candidates,['grapesjs']);
  assert.deepEqual(out.not_triggered_candidates,['langfuse']);
  assert.equal(out.adapters.find(x=>x.adapter==='grapesjs').admission_state,'REJECTED');
  assert.equal(out.adapters.find(x=>x.adapter==='langfuse').admission_state,'NOT_TRIGGERED');
  assert.equal(out.adapters.find(x=>x.adapter==='e2b').admission_state,'NOT_PROVEN');
  assert.equal(out.optional_adapter_implementation_admitted,false);
  assert.equal(out.required_next_gate,'MUSITU_LAYERS_WITHOUT_OPTIONAL_ADAPTERS');
});

test('unknown top-level admission fields fail closed instead of being ignored',async()=>{
  for(const patch of [{mandatory:true},{provider:'E2B'},{release_authority:true},{runtimeActivationAuthorized:true}]){
    await assert.rejects(()=>evaluateOptionalAdapterAdmission({...base,evidence:[],...patch}),/unsupported fields|request/i);
  }
});

test('admission evidence is deterministic across verified-evidence input order',async()=>{
  const e2b=verifiedEvidence('e2b',{remote_sandbox_required:true,governed_namespace_sandbox_insufficient:true,external_compute_adapter_permitted:true});
  const openhands=verifiedEvidence('openhands',{external_engineering_worker_required:true,native_axiom_engineering_worker_insufficient:true,external_code_execution_adapter_permitted:true});
  const one=await evaluateOptionalAdapterAdmission({...base,evidence:[e2b,openhands]});
  const two=await evaluateOptionalAdapterAdmission({...base,evidence:[openhands,e2b]});
  assert.match(one.admission_sha256,/^[a-f0-9]{64}$/);
  assert.equal(one.admission_sha256,two.admission_sha256);
  assert.deepEqual(one.admitted_candidates,['e2b','openhands']);
  assert.deepEqual(two.admitted_candidates,['e2b','openhands']);
});

test('every admission row carries the frozen target seam and trigger contract without transferring semantic authority',async()=>{
  const out=await evaluateOptionalAdapterAdmission({...base,evidence:[]});
  const expected={
    e2b:{seam:'SandboxBackend',triggers:['remote_sandbox_required','governed_namespace_sandbox_insufficient','external_compute_adapter_permitted']},
    openhands:{seam:'EngineeringWorkerBackend',triggers:['external_engineering_worker_required','native_axiom_engineering_worker_insufficient','external_code_execution_adapter_permitted']},
    langfuse:{seam:'TelemetryBackend',triggers:['llm_specific_observability_required','opentelemetry_semantics_insufficient','external_observability_adapter_permitted']},
    growthbook:{seam:'ExperimentEngineBackend',triggers:['product_experimentation_required','openfeature_evaluation_alone_insufficient','external_experiment_adapter_permitted']},
    penpot:{seam:'DesignInteropBackend',triggers:['collaborative_vector_design_required','native_axiom_design_surface_insufficient','external_design_adapter_permitted']},
    grapesjs:{seam:'DesignInteropBackend',triggers:['visual_web_composition_required','native_axiom_artifact_editor_insufficient','embedded_visual_builder_permitted']},
  };
  for(const row of out.adapters){
    assert.equal(row.target_seam,expected[row.adapter].seam);
    assert.deepEqual(row.trigger_keys,expected[row.adapter].triggers);
    assert.equal(row.semantic_owner,'AXIOM');
    assert.equal(row.authority,'MECHANISM_ONLY');
  }
});
