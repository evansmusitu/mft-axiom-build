import {canonical,sha256} from './execution_security.js';

export const FA20_SOURCE_COMMIT='9de2da15d9e532eff9f992354d25995ff9a76c7a';
export const FA20_RELEASE_POLICY_SHA256='d606db7b63576a275619ece77ad26f087919bede32f0025934ed6c2dc7598cff';

const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const clean=(value,max=240)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const copy=value=>structuredClone(value);
const validSha=value=>/^[0-9a-f]{64}$/.test(String(value||''));
const validCommit=value=>/^[0-9a-f]{40}$/.test(String(value||''));
const validDate=value=>Number.isFinite(Date.parse(String(value||'')));
const without=(value,...keys)=>Object.fromEntries(Object.entries(value||{}).filter(([key])=>!keys.includes(key)));

export const FA20_CURRENT_PRODUCTION=freeze({
  schema:'musitu.axiom.fa20.rollback-origin.v1',
  production_hostname:'axiom.mftintelligence.com',
  production_service:'musitu-axiom-fa13-production-ui-edge',
  runtime_binding_service:'mft-axiom-modal-edge-stage',
  runtime_operation_count:74,
  source_candidate:'4c99c4ccbc4a9e34f4e446f30c31f4d428359818',
  release_branch_head:'ce84dca45b9822eed04fad855f93b8dde5344080',
  release_run_id:35052550238,
  release_run_attempt:2,
  release_status:'PASS_PRODUCTION_PROMOTED_AND_MONITORED',
  rollback_proof:'PASS',
  production_evidence_sha256:'d82dae88d967a5c466c03dd5698ec575f05c5434230494d2fa39fb7bfba4afa8',
  github_artifact_sha256:'d0905ffc31c3ba91c89e243cdffee00595690b6858f0ef9282dfb2b2de5cac83',
  immutable_rollback_origin:true,
});

export const FA20_RELEASE_STAGES=freeze([
  'DEVELOPMENT',
  'TESTS',
  'ADVERSARIAL',
  'STAGING',
  'SMOKE',
  'CANARY',
  'ROLLBACK_REHEARSAL',
  'STAGING_RESTORED',
  'PRODUCTION',
  'MONITORING',
  'ROLLBACK_PROOF',
  'PRODUCTION_RESTORED',
  'EVIDENCE_SEALED',
]);

export const FA20_INCIDENT_STEPS=freeze([
  'CONTAIN',
  'REPRODUCE',
  'ROOT_CAUSE',
  'REPAIR',
  'TEST',
  'ATTACK',
  'INDEPENDENT_VERIFY',
  'NEW_RELEASE_CANDIDATE',
]);

export const FA20_FROZEN_RELEASE_POLICY=freeze({
  schema:'musitu.axiom.fa20.release-policy.v1',
  phase:'FA-20',
  name:'Staging→Canary→Production→Continuous Repair',
  source_commit:FA20_SOURCE_COMMIT,
  stage_sequence:FA20_RELEASE_STAGES,
  incident_sequence:FA20_INCIDENT_STEPS,
  rollback_origin:FA20_CURRENT_PRODUCTION,
  preproduction:{
    isolated_workers_only:true,
    custom_domain_mutation:false,
    production_secret_copy:false,
    staging_human_authority_required:true,
    exact_staging_confirmation:'START FA20 STAGING AND CANARY',
    rollback_rehearsal_required:true,
    cleanup_required:true,
  },
  production:{
    exact_target:'axiom.mftintelligence.com',
    exact_confirmation:'APPROVE FA20 S4 PRODUCTION PROMOTION',
    required_distinct_roles:['HUMAN_RELEASE_APPROVER','INDEPENDENT_VERIFIER'],
    live_approval_binding_status:'PENDING_FUTURE_EXACT_S4_GATE',
    production_execution_allowed:false,
    monitoring_samples_required:5,
    rollback_proof_required:true,
  },
  disclosed_deferred_evidence:{
    tablet:'DEFERRED_PENDING_FUTURE_CUSTOMER',
    external_comparison:'DEFERRED_NO_PAID_PROVIDER_ACCESS',
    phase_progression_authorized:true,
    claims_must_remain_disabled:['TABLET_COMPLETE','EXTERNAL_COMPARATIVE_LEVEL_5','WORLD_BEST','GENERAL_SUPERIORITY'],
  },
  continuous_repair:{
    incident_work_contract_required:true,
    silent_production_patch:false,
    new_candidate_requalification_required:true,
    failure_evidence_preserved:true,
  },
  production_authority:false,
  wolfram_parity:'NOT_CERTIFIED',
  superiority:'NOT_CERTIFIED',
});

export async function verifyFrozenReleasePolicy(candidate=FA20_FROZEN_RELEASE_POLICY){
  return canonical(candidate)===canonical(FA20_FROZEN_RELEASE_POLICY)&&await sha256(candidate)===FA20_RELEASE_POLICY_SHA256;
}

function planBody(plan){return without(plan,'plan_sha256');}
function receiptBody(receipt){return without(receipt,'receipt_sha256');}
function workBody(work){return without(work,'work_sha256');}

export async function createReleasePlan({candidateCommit,artifactSha256,createdAt='2026-09-16T00:00:00.000Z'}={}){
  if(!validCommit(candidateCommit))throw new TypeError('exact release candidate commit required');
  if(!validSha(artifactSha256))throw new TypeError('candidate artifact sha256 required');
  if(!validDate(createdAt))throw new TypeError('valid creation timestamp required');
  if(!await verifyFrozenReleasePolicy())throw new DOMException('frozen FA-20 release policy integrity failure','SecurityError');
  const body={
    schema:'musitu.axiom.fa20.release-plan.v1',
    release_id:`fa20-${candidateCommit.slice(0,16)}`,
    source_commit:FA20_SOURCE_COMMIT,
    candidate_commit:candidateCommit,
    candidate_artifact_sha256:artifactSha256,
    release_policy_sha256:FA20_RELEASE_POLICY_SHA256,
    rollback_origin:copy(FA20_CURRENT_PRODUCTION),
    completed_stages:['DEVELOPMENT'],
    stage_receipts:[],
    status:'DEVELOPMENT_COMPLETE_TESTS_REQUIRED',
    old_app_retained:true,
    staging_executed:false,
    canary_executed:false,
    production_executed:false,
    monitoring_active:false,
    rollback_proven:false,
    candidate_restored_after_rollback:false,
    production_execution_allowed:false,
    phase_exit_earned:false,
    created_at:new Date(createdAt).toISOString(),
  };
  return freeze({...body,plan_sha256:await sha256(body)});
}

export async function verifyReleasePlan(plan){
  if(!plan||plan.schema!=='musitu.axiom.fa20.release-plan.v1'||plan.source_commit!==FA20_SOURCE_COMMIT||plan.release_policy_sha256!==FA20_RELEASE_POLICY_SHA256)return false;
  if(!validCommit(plan.candidate_commit)||!validSha(plan.candidate_artifact_sha256)||!validSha(plan.plan_sha256))return false;
  if(await sha256(planBody(plan))!==plan.plan_sha256)return false;
  const completed=plan.completed_stages||[];
  if(canonical(completed)!==canonical(FA20_RELEASE_STAGES.slice(0,completed.length)))return false;
  if(plan.old_app_retained!==true&&plan.phase_exit_earned!==true)return false;
  if(plan.production_executed!==true&&plan.production_execution_allowed!==false)return false;
  return true;
}

export async function sealStageReceipt(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.hasOwn(body,'receipt_sha256'))throw new TypeError('stage receipt body required without receipt_sha256');
  return freeze({...copy(body),receipt_sha256:await sha256(body)});
}

export async function validateStageReceipt(receipt,{plan,expectedStage}={}){
  const errors=[];
  if(receipt?.schema!=='musitu.axiom.fa20.stage-receipt.v1')errors.push('schema');
  if(!await verifyReleasePlan(plan))errors.push('release_plan');
  if(receipt?.release_id!==plan?.release_id)errors.push('release_id');
  if(receipt?.candidate_commit!==plan?.candidate_commit)errors.push('candidate_commit');
  if(receipt?.candidate_artifact_sha256!==plan?.candidate_artifact_sha256)errors.push('candidate_artifact_sha256');
  if(receipt?.release_policy_sha256!==FA20_RELEASE_POLICY_SHA256)errors.push('release_policy_sha256');
  if(receipt?.stage!==expectedStage)errors.push('stage');
  if(receipt?.status!=='PASS')errors.push('status');
  if(!clean(receipt?.actor_identity,160)||!clean(receipt?.verifier_identity,160)||receipt?.actor_identity===receipt?.verifier_identity)errors.push('actor_verifier_separation');
  if(!validSha(receipt?.evidence_sha256))errors.push('evidence_sha256');
  if(!validDate(receipt?.observed_at))errors.push('observed_at');
  if(receipt?.secrets_recorded!==false)errors.push('secrets_recorded');
  const external=['STAGING','SMOKE','CANARY','ROLLBACK_REHEARSAL','STAGING_RESTORED','PRODUCTION','MONITORING','ROLLBACK_PROOF','PRODUCTION_RESTORED'];
  if(external.includes(expectedStage)!==Boolean(receipt?.external_execution))errors.push('external_execution');
  if(expectedStage==='STAGING'&&receipt?.environment!=='ISOLATED_STAGING')errors.push('environment');
  if(expectedStage==='SMOKE'&&receipt?.all_required_checks_passed!==true)errors.push('smoke_checks');
  if(expectedStage==='CANARY'&&receipt?.environment!=='ISOLATED_CANARY')errors.push('environment');
  if(expectedStage==='ROLLBACK_REHEARSAL'&&(receipt?.rollback_succeeded!==true||receipt?.rollback_source_commit!==FA20_CURRENT_PRODUCTION.source_candidate))errors.push('rollback_rehearsal');
  if(expectedStage==='STAGING_RESTORED'&&receipt?.candidate_restored!==true)errors.push('candidate_restore');
  if(expectedStage==='MONITORING'&&(!(Number.isInteger(receipt?.monitoring_samples)&&receipt.monitoring_samples>=FA20_FROZEN_RELEASE_POLICY.production.monitoring_samples_required)||receipt?.all_required_checks_passed!==true))errors.push('monitoring');
  if(expectedStage==='ROLLBACK_PROOF'&&(receipt?.rollback_succeeded!==true||receipt?.rollback_source_commit!==FA20_CURRENT_PRODUCTION.source_candidate))errors.push('rollback_proof');
  if(expectedStage==='PRODUCTION_RESTORED'&&receipt?.candidate_restored!==true)errors.push('candidate_restore');
  if(expectedStage==='EVIDENCE_SEALED'&&(receipt?.external_execution!==false||receipt?.all_required_checks_passed!==true||receipt?.unsupported_claims_published!==false))errors.push('evidence_seal');
  if(expectedStage!=='PRODUCTION'&&receipt?.production_authority_proven!==false)errors.push('production_authority');
  if(expectedStage==='PRODUCTION'&&receipt?.production_authority_proven!==true)errors.push('production_authority');
  if(!validSha(receipt?.receipt_sha256))errors.push('receipt_sha256');
  else if(await sha256(receiptBody(receipt))!==receipt.receipt_sha256)errors.push('receipt_integrity');
  return freeze({valid:errors.length===0,errors:[...new Set(errors)]});
}

function productionApprovalBound(){
  // v1 deliberately has no live S4 approval binding. A post-canary v2 contract must
  // bind the exact human confirmation and independent release-verifier attestation.
  return false;
}

export async function advanceRelease(plan,receipt){
  if(!await verifyReleasePlan(plan))throw new DOMException('release plan integrity failure','SecurityError');
  const expectedStage=FA20_RELEASE_STAGES[plan.completed_stages.length];
  if(!expectedStage)throw new DOMException('release plan already terminal','InvalidStateError');
  const validation=await validateStageReceipt(receipt,{plan,expectedStage});
  if(!validation.valid)throw new DOMException(`invalid ${expectedStage} receipt: ${validation.errors.join(',')}`,'SecurityError');
  if(expectedStage==='PRODUCTION'&&!productionApprovalBound())throw new DOMException('exact live S4 production approval not bound in FA-20 v1','NotAllowedError');
  const next=copy(plan);
  next.completed_stages.push(expectedStage);
  next.stage_receipts.push(receipt.receipt_sha256);
  next.status=`${expectedStage}_PASS`;
  if(expectedStage==='STAGING')next.staging_executed=true;
  if(expectedStage==='CANARY')next.canary_executed=true;
  if(expectedStage==='STAGING_RESTORED')next.candidate_restored_after_rollback=true;
  if(expectedStage==='PRODUCTION'){next.production_executed=true;next.production_execution_allowed=true;next.old_app_retained=false;}
  if(expectedStage==='MONITORING')next.monitoring_active=true;
  if(expectedStage==='ROLLBACK_PROOF')next.rollback_proven=true;
  if(expectedStage==='PRODUCTION_RESTORED')next.candidate_restored_after_rollback=true;
  if(expectedStage==='EVIDENCE_SEALED')next.phase_exit_earned=true;
  delete next.plan_sha256;
  return freeze({...next,plan_sha256:await sha256(next)});
}

export async function createProductionApprovalRequest(plan){
  if(!await verifyReleasePlan(plan))throw new DOMException('release plan integrity failure','SecurityError');
  if(plan.completed_stages.at(-1)!=='STAGING_RESTORED')throw new DOMException('staging smoke canary rollback rehearsal and restoration required','NotAllowedError');
  const body={
    schema:'musitu.axiom.fa20.s4-production-approval-request.v1',
    status:'AWAITING_S4_APPROVAL',
    release_id:plan.release_id,
    candidate_commit:plan.candidate_commit,
    candidate_artifact_sha256:plan.candidate_artifact_sha256,
    release_plan_sha256:plan.plan_sha256,
    release_policy_sha256:FA20_RELEASE_POLICY_SHA256,
    production_target:FA20_CURRENT_PRODUCTION.production_hostname,
    rollback_origin_evidence_sha256:FA20_CURRENT_PRODUCTION.production_evidence_sha256,
    required_distinct_roles:copy(FA20_FROZEN_RELEASE_POLICY.production.required_distinct_roles),
    exact_confirmation:FA20_FROZEN_RELEASE_POLICY.production.exact_confirmation,
    production_execution_allowed:false,
    tablet_evidence:'DEFERRED_PENDING_FUTURE_CUSTOMER',
    external_comparison:'DEFERRED_NO_PAID_PROVIDER_ACCESS',
    superiority:'NOT_CERTIFIED',
  };
  return freeze({...body,approval_request_sha256:await sha256(body)});
}

export async function createIncidentWorkContract({plan,title,severity='HIGH',triggerEvidenceSha256,observedAt='2026-09-16T00:00:00.000Z'}={}){
  if(!await verifyReleasePlan(plan))throw new DOMException('release plan integrity failure','SecurityError');
  severity=clean(severity,20).toUpperCase();
  if(!['LOW','MEDIUM','HIGH','CRITICAL'].includes(severity))throw new TypeError('valid incident severity required');
  if(!validSha(triggerEvidenceSha256))throw new TypeError('incident trigger evidence sha256 required');
  if(!validDate(observedAt)||!clean(title,180))throw new TypeError('incident title and timestamp required');
  const body={
    schema:'musitu.axiom.fa20.incident-work-contract.v1',
    contract_id:`fa20-incident-${triggerEvidenceSha256.slice(0,16)}`,
    project_id:plan.release_id,
    release_id:plan.release_id,
    candidate_commit:plan.candidate_commit,
    title:clean(title,180),
    outcome:'Contain, reproduce, repair and independently verify the incident through a new qualified release candidate.',
    success_criteria:copy(FA20_INCIDENT_STEPS),
    severity,
    trigger_evidence_sha256:triggerEvidenceSha256,
    completed_steps:[],
    step_receipts:[],
    status:'OPEN_CONTAINMENT_REQUIRED',
    production_promotion_frozen:true,
    rollback_required:['HIGH','CRITICAL'].includes(severity),
    silent_production_patch:false,
    new_candidate_requalification_required:true,
    production_patch_executed:false,
    observed_at:new Date(observedAt).toISOString(),
  };
  return freeze({...body,work_sha256:await sha256(body)});
}

export async function verifyIncidentWorkContract(work){
  if(!work||work.schema!=='musitu.axiom.fa20.incident-work-contract.v1'||!validSha(work.work_sha256)||!validCommit(work.candidate_commit)||!validSha(work.trigger_evidence_sha256))return false;
  if(await sha256(workBody(work))!==work.work_sha256)return false;
  if(canonical(work.completed_steps)!==canonical(FA20_INCIDENT_STEPS.slice(0,work.completed_steps.length)))return false;
  return work.production_promotion_frozen===true&&work.silent_production_patch===false&&work.new_candidate_requalification_required===true&&work.production_patch_executed===false;
}

export async function sealIncidentStepReceipt(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.hasOwn(body,'receipt_sha256'))throw new TypeError('incident step receipt body required');
  return freeze({...copy(body),receipt_sha256:await sha256(body)});
}

export async function advanceIncidentWork(work,receipt){
  if(!await verifyIncidentWorkContract(work))throw new DOMException('incident Work Contract integrity failure','SecurityError');
  const expected=FA20_INCIDENT_STEPS[work.completed_steps.length];
  if(!expected)throw new DOMException('incident Work Contract already terminal','InvalidStateError');
  const body=receiptBody(receipt);
  if(receipt?.schema!=='musitu.axiom.fa20.incident-step-receipt.v1'||receipt?.contract_id!==work.contract_id||receipt?.step!==expected||receipt?.status!=='PASS'||!validSha(receipt?.evidence_sha256)||!validDate(receipt?.observed_at)||!validSha(receipt?.receipt_sha256)||await sha256(body)!==receipt.receipt_sha256)throw new DOMException('invalid incident step receipt','SecurityError');
  if(expected==='INDEPENDENT_VERIFY'&&(!clean(receipt?.verifier_identity,160)||receipt?.verifier_identity===receipt?.repair_actor_identity))throw new DOMException('distinct independent incident verifier required','SecurityError');
  if(expected==='NEW_RELEASE_CANDIDATE'&&!validCommit(receipt?.new_candidate_commit))throw new DOMException('new exact release candidate required','SecurityError');
  if(receipt?.production_patch_executed!==false)throw new DOMException('continuous repair cannot silently patch production','SecurityError');
  const next=copy(work);
  next.completed_steps.push(expected);
  next.step_receipts.push(receipt.receipt_sha256);
  next.status=expected==='NEW_RELEASE_CANDIDATE'?'READY_FOR_NEW_RELEASE_REQUALIFICATION':`${expected}_PASS`;
  delete next.work_sha256;
  return freeze({...next,work_sha256:await sha256(next)});
}

export async function runReleaseControlQualification({candidateCommit,builderIdentity='axiom-fa20-release-builder'}={}){
  builderIdentity=clean(builderIdentity,160);
  if(!builderIdentity||!validCommit(candidateCommit))throw new TypeError('builder identity and candidate commit required');
  const artifactSha256=await sha256({candidate_commit:candidateCommit,scope:'FA20_RELEASE_CONTROL'});
  const plan=await createReleasePlan({candidateCommit,artifactSha256});
  let prematureApprovalBlocked=false;
  try{await createProductionApprovalRequest(plan);}catch{prematureApprovalBlocked=true;}
  if(!prematureApprovalBlocked)throw new DOMException('premature S4 request did not fail closed','SecurityError');
  const incident=await createIncidentWorkContract({plan,title:'Qualification incident fixture',triggerEvidenceSha256:'a'.repeat(64)});
  if(!await verifyIncidentWorkContract(incident)||incident.production_patch_executed)throw new DOMException('incident Work Contract boundary failed','SecurityError');
  const body={
    schema:'musitu.axiom.fa20.release-control-evidence.v1',
    status:'FA20_RELEASE_CONTROL_VERIFIED_STAGING_AUTHORITY_PENDING',
    source_commit:FA20_SOURCE_COMMIT,
    candidate_commit:candidateCommit,
    candidate_artifact_sha256:artifactSha256,
    release_policy_sha256:FA20_RELEASE_POLICY_SHA256,
    builder_identity:builderIdentity,
    rollback_origin_evidence_sha256:FA20_CURRENT_PRODUCTION.production_evidence_sha256,
    rollback_origin_status:FA20_CURRENT_PRODUCTION.release_status,
    stage_order_gate_verified:true,
    rollback_origin_gate_verified:true,
    production_approval_gate_verified:true,
    monitoring_gate_verified:true,
    incident_work_contract_gate_verified:true,
    silent_production_patch_blocked:true,
    release_control_qualification_earned:true,
    staging_authority_present:false,
    staging_executed:false,
    canary_executed:false,
    production_executed:false,
    old_app_retained:true,
    phase_exit_earned:false,
    tablet_evidence:'DEFERRED_PENDING_FUTURE_CUSTOMER',
    external_comparison:'DEFERRED_NO_PAID_PROVIDER_ACCESS',
    production_authority:false,
    wolfram_parity:'NOT_CERTIFIED',
    superiority:'NOT_CERTIFIED',
  };
  return freeze({...body,evidence_sha256:await sha256(body)});
}

export async function verifyReleaseControlEvidence(evidence){
  if(!evidence)return false;
  const body=without(evidence,'evidence_sha256');
  return validSha(evidence.evidence_sha256)&&await sha256(body)===evidence.evidence_sha256&&
    evidence.status==='FA20_RELEASE_CONTROL_VERIFIED_STAGING_AUTHORITY_PENDING'&&
    evidence.source_commit===FA20_SOURCE_COMMIT&&validCommit(evidence.candidate_commit)&&
    evidence.release_policy_sha256===FA20_RELEASE_POLICY_SHA256&&
    evidence.stage_order_gate_verified===true&&evidence.rollback_origin_gate_verified===true&&
    evidence.production_approval_gate_verified===true&&evidence.incident_work_contract_gate_verified===true&&
    evidence.silent_production_patch_blocked===true&&evidence.release_control_qualification_earned===true&&
    evidence.staging_authority_present===false&&evidence.staging_executed===false&&
    evidence.production_executed===false&&evidence.old_app_retained===true&&
    evidence.phase_exit_earned===false&&evidence.production_authority===false;
}

export async function runIndependentReleaseControlVerification({builderEvidence,verifierIdentity='github-actions-independent-fa20-verifier'}={}){
  verifierIdentity=clean(verifierIdentity,160);
  if(!await verifyReleaseControlEvidence(builderEvidence))throw new DOMException('FA-20 builder evidence integrity failure','SecurityError');
  if(!verifierIdentity||verifierIdentity===builderEvidence.builder_identity)throw new DOMException('distinct FA-20 verifier required','SecurityError');
  const replay=await runReleaseControlQualification({candidateCommit:builderEvidence.candidate_commit,builderIdentity:builderEvidence.builder_identity});
  if(replay.evidence_sha256!==builderEvidence.evidence_sha256)throw new DOMException('FA-20 independent replay mismatch','SecurityError');
  const body={
    schema:'musitu.axiom.fa20.independent-release-control-verifier.v1',
    status:'INDEPENDENT_VERIFIED_FA20_RELEASE_CONTROL_STAGING_NOT_EXECUTED',
    source_commit:FA20_SOURCE_COMMIT,
    candidate_commit:builderEvidence.candidate_commit,
    release_policy_sha256:FA20_RELEASE_POLICY_SHA256,
    builder_identity:builderEvidence.builder_identity,
    verifier_identity:verifierIdentity,
    builder_evidence_sha256:builderEvidence.evidence_sha256,
    replay_evidence_sha256:replay.evidence_sha256,
    builder_and_verifier_distinct:true,
    release_control_qualification_earned:true,
    staging_authority_present:false,
    staging_executed:false,
    production_executed:false,
    old_app_retained:true,
    phase_exit_earned:false,
    repository_write_authority_present:false,
    production_credentials_present:false,
    production_authority:false,
    tablet_evidence:'DEFERRED_PENDING_FUTURE_CUSTOMER',
    external_comparison:'DEFERRED_NO_PAID_PROVIDER_ACCESS',
    wolfram_parity:'NOT_CERTIFIED',
    superiority:'NOT_CERTIFIED',
  };
  return freeze({...body,attestation_sha256:await sha256(body)});
}

export async function verifyIndependentReleaseControlAttestation(attestation){
  if(!attestation)return false;
  const body=without(attestation,'attestation_sha256');
  return validSha(attestation.attestation_sha256)&&await sha256(body)===attestation.attestation_sha256&&
    attestation.status==='INDEPENDENT_VERIFIED_FA20_RELEASE_CONTROL_STAGING_NOT_EXECUTED'&&
    attestation.source_commit===FA20_SOURCE_COMMIT&&attestation.release_policy_sha256===FA20_RELEASE_POLICY_SHA256&&
    attestation.builder_identity!==attestation.verifier_identity&&attestation.builder_and_verifier_distinct===true&&
    attestation.release_control_qualification_earned===true&&attestation.staging_authority_present===false&&
    attestation.staging_executed===false&&attestation.production_executed===false&&attestation.old_app_retained===true&&
    attestation.phase_exit_earned===false&&attestation.repository_write_authority_present===false&&
    attestation.production_credentials_present===false&&attestation.production_authority===false;
}
