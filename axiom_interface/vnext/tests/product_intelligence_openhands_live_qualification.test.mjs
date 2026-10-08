import assert from 'node:assert/strict';
import test from 'node:test';

async function loadQualificationModule(){
  try{
    return await import('../product_intelligence/openhands_live_qualification.js');
  }catch(error){
    if(error?.code==='ERR_MODULE_NOT_FOUND') return {};
    throw error;
  }
}

const base={
  schema:'musitu.axiom.openhands-live-qualification-request.v1',
  project_id:'project_axiom_phase2_openhands_20261008',
  work_id:'work_axiom_phase2_openhands_20261008',
  provider:'OpenHands',
  target_seam:'EngineeringWorkerBackend',
  risk_class:'S3',
  reversible:true,
  repository:'evansmusitu/mft-axiom-build',
  branch:'frontier/axiom-phase2-openhands-live-qualification-20261008',
  source_phase2_sha:'2a96a59e3337f4801328750b45ab2ebad7fdcd0e',
  authorization:{
    confirmation:'AUTHORIZE PHASE-2 ISOLATED OPENHANDS ADMISSION AND S3 LIVE QUALIFICATION ON A FRESH NON-PROTECTED BRANCH. NO MAIN, PR #1, PRODUCTION, OR FROZEN OPENAI MUTATION.',
    authority:'USER_FINAL_PRODUCT_APPROVAL_AUTHORITY',
    main_mutation_allowed:false,
    pr1_mutation_allowed:false,
    production_mutation_allowed:false,
    frozen_openai_mutation_allowed:false,
  },
  need_evidence:{
    verification_status:'PASS',
    need_evidence_sha256:'a'.repeat(64),
    verification_artifact_sha256:'b'.repeat(64),
    builder_id:'axiom-builder',
    verifier_id:'independent-verifier',
    triggers:{
      external_engineering_worker_required:true,
      native_axiom_engineering_worker_insufficient:true,
      external_code_execution_adapter_permitted:true,
    },
  },
};

test('OpenHands live qualification admission contract exists at a dedicated fail-closed seam',async()=>{
  const mod=await loadQualificationModule();
  assert.equal(typeof mod.evaluateOpenHandsLiveQualification,'function',
    'evaluateOpenHandsLiveQualification must exist before OpenHands can be selected or activated');
});

test('verified bounded authority may select OpenHands but cannot activate an unavailable credentialed runtime',async()=>{
  const mod=await loadQualificationModule();
  assert.equal(typeof mod.evaluateOpenHandsLiveQualification,'function');
  const out=await mod.evaluateOpenHandsLiveQualification({
    ...base,
    runtime_probe:{credential_reference:'OPENHANDS_API_KEY',credential_available:false,api_probe_status:'NOT_RUN'},
  });
  assert.equal(out.provider_selected,true);
  assert.equal(out.admission_state,'CANDIDATE_ADMITTED');
  assert.equal(out.runtime_activation_authorized,false);
  assert.equal(out.runtime_activation_state,'BLOCKED_CREDENTIAL_UNAVAILABLE');
  assert.equal(out.external_action_executed,false);
  assert.equal(out.live_runtime_qualification,'NOT_PROVEN');
  assert.equal(out.release_authority,false);
  assert.equal(out.production_authority,false);
  assert.equal(out.certification_authority,false);
});

test('credentialed OpenHands Cloud probe may authorize only isolated S3 runtime activation, not execution truth',async()=>{
  const mod=await loadQualificationModule();
  assert.equal(typeof mod.evaluateOpenHandsLiveQualification,'function');
  const out=await mod.evaluateOpenHandsLiveQualification({
    ...base,
    runtime_probe:{credential_reference:'OPENHANDS_API_KEY',credential_available:true,api_probe_status:'PASS'},
  });
  assert.equal(out.provider_selected,true);
  assert.equal(out.runtime_activation_authorized,true);
  assert.equal(out.runtime_activation_state,'AUTHORIZED_ISOLATED_QUALIFICATION_ONLY');
  assert.equal(out.external_action_executed,false);
  assert.equal(out.live_runtime_qualification,'NOT_PROVEN');
  assert.equal(out.authority_effect,'RUNTIME_QUALIFICATION_ONLY');
  assert.equal(out.production_authority,false);
});

test('OpenHands admission fails closed on authority expansion, protected destinations, unverified need, or identity collapse',async()=>{
  const mod=await loadQualificationModule();
  assert.equal(typeof mod.evaluateOpenHandsLiveQualification,'function');
  const cases=[
    {...base,branch:'main'},
    {...base,branch:'frontier/axiom-product-intelligence-phase2-20261004'},
    {...base,risk_class:'S4'},
    {...base,reversible:false},
    {...base,provider:'Other'},
    {...base,authorization:{...base.authorization,production_mutation_allowed:true}},
    {...base,authorization:{...base.authorization,pr1_mutation_allowed:true}},
    {...base,authorization:{...base.authorization,frozen_openai_mutation_allowed:true}},
    {...base,need_evidence:{...base.need_evidence,verification_status:'FAIL'}},
    {...base,need_evidence:{...base.need_evidence,verifier_id:base.need_evidence.builder_id}},
    {...base,need_evidence:{...base.need_evidence,triggers:{...base.need_evidence.triggers,native_axiom_engineering_worker_insufficient:false}}},
  ];
  for(const request of cases){
    await assert.rejects(
      ()=>mod.evaluateOpenHandsLiveQualification({...request,runtime_probe:{credential_reference:'OPENHANDS_API_KEY',credential_available:false,api_probe_status:'NOT_RUN'}}),
      /OpenHands|authority|branch|S3|reversible|verified need|verifier|trigger|production|PR #1|OpenAI/i
    );
  }
});
