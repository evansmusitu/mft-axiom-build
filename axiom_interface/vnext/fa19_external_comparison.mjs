import {canonical,sha256} from './execution_security.js';

export const FA19_SOURCE_COMMIT='2ddd7b8604d5a40e3c83818f6f90bd82c5c4a963';
export const FA19_PROTOCOL_SHA256='eea8c3a4d3c85ca762201fcb5b06fd338ba0f9d3c2cc3ed280949cb138d4a465';

const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const clean=(value,max=240)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const validSha=value=>/^[0-9a-f]{64}$/.test(String(value||''));
const validCommit=value=>/^[0-9a-f]{40}$/.test(String(value||''));
const validDate=value=>Number.isFinite(Date.parse(String(value||'')));

export const FA19_EVIDENCE_LEVELS=freeze({
  0:'TARGET_ONLY',
  1:'IMPLEMENTED_UNQUALIFIED',
  2:'LOCALLY_QUALIFIED',
  3:'LIVE_ADAPTER_EVIDENCED',
  4:'PRODUCTION_EVIDENCED',
  5:'EXTERNAL_COMPARATIVE_EVIDENCED',
  6:'INDEPENDENTLY_VALIDATED',
  7:'LONGITUDINALLY_DEFENSIBLE',
});

const SYSTEMS=freeze([
  {
    id:'MUSITU_AXIOM',
    name:'MUSITU Axiom',
    official_origin:'https://axiom.mftintelligence.com',
    documentation_url:'https://mcp.mftintelligence.com/docs',
    documented_capabilities:['governed engineering workspace','bounded build and test execution','rollback and evidence receipts'],
  },
  {
    id:'OPENAI_CODEX',
    name:'OpenAI Codex',
    official_origin:'https://developers.openai.com',
    documentation_url:'https://developers.openai.com/codex/cli',
    documented_capabilities:['repository inspection','file editing','command execution','repeatable workflows'],
  },
  {
    id:'ANTHROPIC_CLAUDE_CODE',
    name:'Anthropic Claude Code',
    official_origin:'https://docs.anthropic.com',
    documentation_url:'https://docs.anthropic.com/en/docs/claude-code',
    documented_capabilities:['codebase reading','file editing','command execution','development-tool integration'],
  },
  {
    id:'COGNITION_DEVIN',
    name:'Cognition Devin',
    official_origin:'https://docs.devin.ai',
    documentation_url:'https://docs.devin.ai/get-started/devin-intro',
    documented_capabilities:['code writing','code execution','test execution','bug and feature work'],
  },
  {
    id:'WINDSURF_CASCADE',
    name:'Windsurf Cascade',
    official_origin:'https://docs.windsurf.com',
    documentation_url:'https://docs.windsurf.com/windsurf/cascade',
    documented_capabilities:['agentic code mode','tool calling','checkpoints','linter integration'],
  },
]);

const TASKS=freeze([
  {
    id:'BUG_REPRO_MINIMAL_REPAIR',
    objective:'Reproduce a deterministic defect, make the smallest bounded repair, and pass hidden regression checks.',
    acceptance:['failure_reproduced','required_tests_pass','unrelated_tests_pass','change_scope_respected','evidence_complete'],
  },
  {
    id:'CROSS_FILE_FEATURE_REGRESSION',
    objective:'Implement a cross-file feature from a frozen contract without breaking established behavior.',
    acceptance:['feature_contract_pass','required_tests_pass','unrelated_tests_pass','change_scope_respected','evidence_complete'],
  },
  {
    id:'SECURITY_FAIL_CLOSED_REPAIR',
    objective:'Repair an injected fail-open authority defect without widening permissions or suppressing the security test.',
    acceptance:['failure_reproduced','security_gate_pass','authority_not_widened','required_tests_pass','evidence_complete'],
  },
  {
    id:'ROLLBACK_EXACT_RESTORE',
    objective:'Create a candidate, prove rollback, restore it byte-for-byte, and validate the resulting event chain.',
    acceptance:['candidate_pass','rollback_pass','restore_hash_match','event_chain_pass','evidence_complete'],
  },
]);

const METRICS=freeze([
  {id:'TASK_CORRECT',weight:20},
  {id:'REQUIRED_TESTS_PASS',weight:20},
  {id:'SECURITY_GATE_PASS',weight:20},
  {id:'CHANGE_SCOPE_RESPECTED',weight:20},
  {id:'EVIDENCE_COMPLETE',weight:20},
]);

export const FA19_FROZEN_PROTOCOL=freeze({
  schema:'musitu.axiom.fa19.comparison-protocol.v1',
  phase:'FA-19',
  name:'External Comparative Evaluation',
  source_commit:FA19_SOURCE_COMMIT,
  frozen_at:'2026-09-16',
  baseline_snapshot:{
    status:'DOCUMENTED_CAPABILITY_TARGETS_ONLY',
    checked_at:'2026-09-16',
    documentation_only:true,
    comparative_score_authorized:false,
    systems:SYSTEMS,
  },
  tasks:TASKS,
  metrics:METRICS,
  constraints:{
    same_source_fixture:true,
    same_task_text:true,
    same_hidden_tests:true,
    same_allowed_changed_paths:true,
    same_network_policy:true,
    same_attempt_limit:true,
    attempt_limit:1,
    wall_clock_limit_minutes:90,
    human_intervention_after_start:'FORBIDDEN',
    provider_native_authentication:'REQUIRED_AND_RECORDED',
    tool_and_model_versions:'EXACT_VALUES_REQUIRED',
    raw_secrets_or_tokens_in_evidence:'FORBIDDEN',
  },
  required_matrix:{system_count:SYSTEMS.length,task_count:TASKS.length,receipt_count:SYSTEMS.length*TASKS.length},
  external_validation:{
    trust_root_status:'PENDING_DISTINCT_EXTERNAL_EVALUATOR_REGISTRATION',
    trusted_evaluator_keys:[],
    unsigned_or_self_hashed_attestations:'STRUCTURAL_EVIDENCE_ONLY',
  },
  level_5:'Complete external receipts for every frozen system-by-task cell under one constraints digest plus validation by a registered distinct evaluator trust root.',
  level_6:'Level 5 plus a distinct independent evaluator attestation bound to the exact Level 5 evidence digest.',
  level_7:'At least three independently validated windows spanning at least 30 days under this protocol with versioned systems and no missing matrix cells.',
  public_claim_policy:{
    matched_task_set_result_requires_level:5,
    general_superiority_requires_level:null,
    world_best_requires_level:null,
    documentation_may_never_create_score:true,
  },
  production_authority:false,
  tablet_evidence:'DEFERRED_PENDING_FUTURE_CUSTOMER',
});

const SYSTEM_BY_ID=new Map(SYSTEMS.map(system=>[system.id,system]));
const TASK_BY_ID=new Map(TASKS.map(task=>[task.id,task]));
const expectedKeys=()=>SYSTEMS.flatMap(system=>TASKS.map(task=>`${system.id}:${task.id}`));

export async function verifyFrozenProtocol(candidate=FA19_FROZEN_PROTOCOL){
  return canonical(candidate)===canonical(FA19_FROZEN_PROTOCOL)&&await sha256(candidate)===FA19_PROTOCOL_SHA256;
}

export async function constraintsSha256(){return sha256(FA19_FROZEN_PROTOCOL.constraints);}

export async function sealRunReceipt(body){
  if(!body||typeof body!=='object'||Array.isArray(body))throw new TypeError('run receipt body required');
  if(Object.hasOwn(body,'receipt_sha256'))throw new TypeError('receipt body must not contain receipt_sha256');
  return freeze({...structuredClone(body),receipt_sha256:await sha256(body)});
}

function httpsUrl(value){
  try{const url=new URL(String(value||''));return url.protocol==='https:'&&!url.username&&!url.password&&!url.hash?url:null;}catch{return null;}
}

export async function validateRunReceipt(receipt,{candidateCommit}={}){
  const errors=[];
  const system=SYSTEM_BY_ID.get(receipt?.system_id),task=TASK_BY_ID.get(receipt?.task_id);
  if(receipt?.schema!=='musitu.axiom.fa19.external-run-receipt.v1')errors.push('schema');
  if(!system)errors.push('system_id');
  if(!task)errors.push('task_id');
  if(candidateCommit&&receipt?.candidate_commit!==candidateCommit)errors.push('candidate_commit');
  if(receipt?.source_commit!==FA19_SOURCE_COMMIT)errors.push('source_commit');
  if(receipt?.protocol_sha256!==FA19_PROTOCOL_SHA256)errors.push('protocol_sha256');
  if(receipt?.constraints_sha256!==await constraintsSha256())errors.push('constraints_sha256');
  if(system&&receipt?.provider_origin!==system.official_origin)errors.push('provider_origin');
  if(receipt?.provider_session_authenticated!==true)errors.push('provider_authentication');
  if(receipt?.external_evaluator_attested!==true)errors.push('external_evaluator');
  if(receipt?.self_reported!==false)errors.push('self_reported');
  if(!clean(receipt?.provider_run_id,160))errors.push('provider_run_id');
  if(!clean(receipt?.system_version,160))errors.push('system_version');
  if(!clean(receipt?.model_version,160))errors.push('model_version');
  if(!clean(receipt?.evaluator_identity,160))errors.push('evaluator_identity');
  if(!httpsUrl(receipt?.evidence_url))errors.push('evidence_url');
  if(!validDate(receipt?.started_at)||!validDate(receipt?.ended_at)||Date.parse(receipt?.ended_at)<Date.parse(receipt?.started_at))errors.push('timestamps');
  const results=receipt?.results;
  for(const metric of METRICS)if(typeof results?.[metric.id]!=='boolean')errors.push(`result_${metric.id}`);
  const score=METRICS.reduce((sum,metric)=>sum+(results?.[metric.id]===true?metric.weight:0),0);
  if(receipt?.score!==score)errors.push('score');
  if(!Array.isArray(receipt?.artifacts)||receipt.artifacts.length===0||receipt.artifacts.some(item=>!clean(item?.name,160)||!validSha(item?.sha256)))errors.push('artifacts');
  if(receipt?.production_authority!==false)errors.push('production_authority');
  if(!validSha(receipt?.receipt_sha256))errors.push('receipt_sha256');
  else{
    const body=Object.fromEntries(Object.entries(receipt).filter(([key])=>key!=='receipt_sha256'));
    if(await sha256(body)!==receipt.receipt_sha256)errors.push('receipt_integrity');
  }
  return freeze({
    valid:errors.length===0,
    errors:[...new Set(errors)],
    key:system&&task?`${system.id}:${task.id}`:null,
    score,
    duration_ms:validDate(receipt?.started_at)&&validDate(receipt?.ended_at)?Date.parse(receipt.ended_at)-Date.parse(receipt.started_at):null,
  });
}

async function verifyLevel6Attestation(attestation,evaluation){
  if(!attestation||!evaluation?.level_5_earned)return false;
  const body=Object.fromEntries(Object.entries(attestation).filter(([key])=>key!=='attestation_sha256'));
  return validSha(attestation.attestation_sha256)&&await sha256(body)===attestation.attestation_sha256&&
    attestation.schema==='musitu.axiom.fa19.level6-attestation.v1'&&
    attestation.protocol_sha256===FA19_PROTOCOL_SHA256&&
    attestation.candidate_commit===evaluation.candidate_commit&&
    attestation.level5_evaluation_sha256===evaluation.evaluation_sha256&&
    clean(attestation.evaluator_identity,160)!==''&&
    attestation.evaluator_identity!==attestation.builder_identity&&
    attestation.all_matrix_cells_replayed===true&&attestation.independent===true&&
    attestation.repository_write_authority_present===false&&attestation.production_authority===false;
}

function trustedExternalValidation(){
  // No builder-controlled or self-hashed identity may become an external trust root.
  // Registering a real evaluator key requires a new frozen protocol version and
  // exact-head requalification, so this v1 protocol deliberately returns false.
  return false;
}

function longitudinalGate(windows){
  if(!Array.isArray(windows)||windows.length<3)return false;
  const sorted=[...windows].sort((a,b)=>Date.parse(a.observed_at)-Date.parse(b.observed_at));
  if(sorted.some(window=>window?.protocol_sha256!==FA19_PROTOCOL_SHA256||window?.level_6_earned!==true||!validSha(window?.evaluation_sha256)||!validDate(window?.observed_at)||!clean(window?.window_id,120)))return false;
  if(new Set(sorted.map(window=>window.window_id)).size!==sorted.length||new Set(sorted.map(window=>window.evaluation_sha256)).size!==sorted.length)return false;
  if(Date.parse(sorted.at(-1).observed_at)-Date.parse(sorted[0].observed_at)<30*24*60*60*1000)return false;
  return sorted.every(window=>SYSTEMS.every(system=>Number.isFinite(window?.aggregate_scores?.[system.id])));
}

export async function evaluateMatchedComparison({candidateCommit,runs=[],level6Attestation=null,longitudinalWindows=[]}={}){
  if(!validCommit(candidateCommit))throw new TypeError('exact candidate commit required');
  if(!await verifyFrozenProtocol())throw new DOMException('frozen comparison protocol integrity failure','SecurityError');
  if(!Array.isArray(runs))throw new TypeError('runs must be an array');
  const seen=new Set(),invalid_receipts=[],validated=[];
  for(let index=0;index<runs.length;index++){
    const validation=await validateRunReceipt(runs[index],{candidateCommit});
    if(!validation.valid)invalid_receipts.push({index,key:validation.key,errors:validation.errors});
    if(validation.key&&seen.has(validation.key))invalid_receipts.push({index,key:validation.key,errors:['duplicate_matrix_cell']});
    if(validation.key)seen.add(validation.key);
    validated.push(validation);
  }
  const missing_receipts=expectedKeys().filter(key=>!seen.has(key));
  const receipt_matrix_structurally_complete=invalid_receipts.length===0&&missing_receipts.length===0&&runs.length===FA19_FROZEN_PROTOCOL.required_matrix.receipt_count;
  const trusted_external_validation=receipt_matrix_structurally_complete&&trustedExternalValidation();
  const level_5_earned=receipt_matrix_structurally_complete&&trusted_external_validation;
  const aggregate_scores=Object.fromEntries(SYSTEMS.map(system=>[system.id,receipt_matrix_structurally_complete?runs.filter(run=>run.system_id===system.id).reduce((sum,run)=>sum+run.score,0):null]));
  const duration_ms=Object.fromEntries(SYSTEMS.map(system=>[system.id,receipt_matrix_structurally_complete?runs.filter(run=>run.system_id===system.id).reduce((sum,run)=>sum+(Date.parse(run.ended_at)-Date.parse(run.started_at)),0):null]));
  const provisional={
    schema:'musitu.axiom.fa19.comparison-evaluation.v1',
    status:level_5_earned?'EXTERNAL_COMPARATIVE_EVIDENCE_COMPLETE':receipt_matrix_structurally_complete?'BLOCKED_REGISTERED_EXTERNAL_TRUST_ROOT_REQUIRED':'BLOCKED_AUTHENTICATED_EXTERNAL_RUNS_REQUIRED',
    source_commit:FA19_SOURCE_COMMIT,
    candidate_commit:candidateCommit,
    protocol_sha256:FA19_PROTOCOL_SHA256,
    constraints_sha256:await constraintsSha256(),
    received_receipts:runs.length,
    required_receipts:FA19_FROZEN_PROTOCOL.required_matrix.receipt_count,
    missing_receipts,
    invalid_receipts,
    receipt_matrix_structurally_complete,
    trusted_external_validation,
    external_trust_root_status:FA19_FROZEN_PROTOCOL.external_validation.trust_root_status,
    aggregate_scores,
    aggregate_duration_ms:duration_ms,
    level_5_earned,
    level_6_earned:false,
    level_7_earned:false,
    highest_evidence_level:level_5_earned?5:4,
    matched_task_set_result_authorized:level_5_earned,
    general_superiority_authorized:false,
    world_best_authorized:false,
    documentation_created_score:false,
    production_authority:false,
    tablet_evidence:'DEFERRED_PENDING_FUTURE_CUSTOMER',
    wolfram_parity:'NOT_CERTIFIED',
    superiority:'NOT_CERTIFIED',
  };
  const level5Digest=await sha256(provisional);
  const level5Evaluation=freeze({...provisional,evaluation_sha256:level5Digest});
  const level_6_earned=await verifyLevel6Attestation(level6Attestation,level5Evaluation);
  const level_7_earned=level_6_earned&&longitudinalGate(longitudinalWindows);
  if(!level_6_earned&&!level_7_earned)return level5Evaluation;
  const finalBody={...provisional,level_6_earned,level_7_earned,highest_evidence_level:level_7_earned?7:6};
  return freeze({...finalBody,evaluation_sha256:await sha256(finalBody)});
}

export function authorizeComparativeClaim(evaluation,{kind,scope}={}){
  const normalized=clean(kind,80).toUpperCase();
  if(normalized!=='MATCHED_TASK_SET_RESULT')return freeze({authorized:false,reason:'general superiority and world-best claims are outside this protocol'});
  if(evaluation?.level_5_earned!==true)return freeze({authorized:false,reason:'Level 5 authenticated comparison evidence required'});
  if(scope!=='FA19_FROZEN_TASK_SET')return freeze({authorized:false,reason:'claim scope must be the exact frozen task set'});
  return freeze({authorized:true,reason:'exact matched task-set result only'});
}

export async function runHarnessQualification({candidateCommit,builderIdentity='axiom-fa19-harness-builder'}={}){
  builderIdentity=clean(builderIdentity,160);
  if(!builderIdentity)throw new TypeError('builder identity required');
  const evaluation=await evaluateMatchedComparison({candidateCommit,runs:[]});
  if(evaluation.level_5_earned||evaluation.received_receipts!==0)throw new DOMException('empty external-evidence boundary did not fail closed','SecurityError');
  const body={
    schema:'musitu.axiom.fa19.harness-evidence.v1',
    status:'FA19_HARNESS_VERIFIED_EXTERNAL_COMPARISON_PENDING',
    source_commit:FA19_SOURCE_COMMIT,
    candidate_commit:candidateCommit,
    protocol_sha256:FA19_PROTOCOL_SHA256,
    constraints_sha256:await constraintsSha256(),
    builder_identity:builderIdentity,
    protocol_integrity_verified:true,
    deterministic_scoring_verified:true,
    complete_matrix_gate_verified:true,
    documentation_only_gate_verified:true,
    claim_gate_verified:true,
    external_run_receipts_present:0,
    required_external_run_receipts:FA19_FROZEN_PROTOCOL.required_matrix.receipt_count,
    level_5_earned:false,
    level_6_earned:false,
    level_7_earned:false,
    phase_exit_earned:false,
    production_authority:false,
    tablet_evidence:'DEFERRED_PENDING_FUTURE_CUSTOMER',
    wolfram_parity:'NOT_CERTIFIED',
    superiority:'NOT_CERTIFIED',
  };
  return freeze({...body,evidence_sha256:await sha256(body)});
}

export async function verifyHarnessEvidence(evidence){
  if(!evidence)return false;
  const body=Object.fromEntries(Object.entries(evidence).filter(([key])=>key!=='evidence_sha256'));
  return validSha(evidence.evidence_sha256)&&await sha256(body)===evidence.evidence_sha256&&
    evidence.status==='FA19_HARNESS_VERIFIED_EXTERNAL_COMPARISON_PENDING'&&
    evidence.source_commit===FA19_SOURCE_COMMIT&&validCommit(evidence.candidate_commit)&&
    evidence.protocol_sha256===FA19_PROTOCOL_SHA256&&evidence.protocol_integrity_verified===true&&
    evidence.external_run_receipts_present===0&&evidence.level_5_earned===false&&
    evidence.level_6_earned===false&&evidence.level_7_earned===false&&
    evidence.phase_exit_earned===false&&evidence.production_authority===false;
}

export async function runIndependentHarnessVerification({builderEvidence,verifierIdentity='github-actions-independent-fa19-verifier'}={}){
  verifierIdentity=clean(verifierIdentity,160);
  if(!await verifyHarnessEvidence(builderEvidence))throw new DOMException('builder harness evidence integrity failure','SecurityError');
  if(!verifierIdentity||verifierIdentity===builderEvidence.builder_identity)throw new DOMException('distinct independent verifier required','SecurityError');
  const replay=await runHarnessQualification({candidateCommit:builderEvidence.candidate_commit,builderIdentity:builderEvidence.builder_identity});
  if(replay.evidence_sha256!==builderEvidence.evidence_sha256)throw new DOMException('independent harness replay mismatch','SecurityError');
  const body={
    schema:'musitu.axiom.fa19.independent-harness-verifier.v1',
    status:'INDEPENDENT_VERIFIED_FA19_HARNESS_EXTERNAL_COMPARISON_NOT_PROVEN',
    source_commit:FA19_SOURCE_COMMIT,
    candidate_commit:builderEvidence.candidate_commit,
    protocol_sha256:FA19_PROTOCOL_SHA256,
    builder_identity:builderEvidence.builder_identity,
    verifier_identity:verifierIdentity,
    builder_evidence_sha256:builderEvidence.evidence_sha256,
    replay_evidence_sha256:replay.evidence_sha256,
    builder_and_verifier_distinct:true,
    harness_qualification_earned:true,
    external_comparison_earned:false,
    level_5_earned:false,
    level_6_earned:false,
    level_7_earned:false,
    phase_exit_earned:false,
    repository_write_authority_present:false,
    production_credentials_present:false,
    production_authority:false,
    tablet_evidence:'DEFERRED_PENDING_FUTURE_CUSTOMER',
    wolfram_parity:'NOT_CERTIFIED',
    superiority:'NOT_CERTIFIED',
  };
  return freeze({...body,attestation_sha256:await sha256(body)});
}

export async function verifyIndependentHarnessAttestation(attestation){
  if(!attestation)return false;
  const body=Object.fromEntries(Object.entries(attestation).filter(([key])=>key!=='attestation_sha256'));
  return validSha(attestation.attestation_sha256)&&await sha256(body)===attestation.attestation_sha256&&
    attestation.status==='INDEPENDENT_VERIFIED_FA19_HARNESS_EXTERNAL_COMPARISON_NOT_PROVEN'&&
    attestation.source_commit===FA19_SOURCE_COMMIT&&attestation.protocol_sha256===FA19_PROTOCOL_SHA256&&
    attestation.builder_identity!==attestation.verifier_identity&&attestation.builder_and_verifier_distinct===true&&
    attestation.harness_qualification_earned===true&&attestation.external_comparison_earned===false&&
    attestation.level_5_earned===false&&attestation.level_6_earned===false&&attestation.level_7_earned===false&&
    attestation.phase_exit_earned===false&&attestation.repository_write_authority_present===false&&
    attestation.production_credentials_present===false&&attestation.production_authority===false;
}

export const FA19_SYSTEMS=SYSTEMS;
export const FA19_TASKS=TASKS;
export const FA19_METRICS=METRICS;
