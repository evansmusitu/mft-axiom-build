import test from 'node:test';
import assert from 'node:assert/strict';

import {sha256} from '../execution_security.js';
import {
  FA19_EVIDENCE_LEVELS,
  FA19_FROZEN_PROTOCOL,
  FA19_METRICS,
  FA19_PROTOCOL_SHA256,
  FA19_SOURCE_COMMIT,
  FA19_SYSTEMS,
  FA19_TASKS,
  authorizeComparativeClaim,
  constraintsSha256,
  evaluateMatchedComparison,
  runHarnessQualification,
  runIndependentHarnessVerification,
  sealRunReceipt,
  validateRunReceipt,
  verifyFrozenProtocol,
  verifyHarnessEvidence,
  verifyIndependentHarnessAttestation,
} from '../fa19_external_comparison.mjs';

const candidateCommit='c'.repeat(40);

async function completeReceipts({failingKey=null}={}){
  const receipts=[];
  for(const [systemIndex,system] of FA19_SYSTEMS.entries()){
    for(const [taskIndex,task] of FA19_TASKS.entries()){
      const key=`${system.id}:${task.id}`;
      const results=Object.fromEntries(FA19_METRICS.map(metric=>[metric.id,key!==failingKey]));
      const score=FA19_METRICS.reduce((sum,metric)=>sum+(results[metric.id]?metric.weight:0),0);
      const minute=systemIndex*FA19_TASKS.length+taskIndex;
      const body={
        schema:'musitu.axiom.fa19.external-run-receipt.v1',
        source_commit:FA19_SOURCE_COMMIT,
        candidate_commit:candidateCommit,
        protocol_sha256:FA19_PROTOCOL_SHA256,
        constraints_sha256:await constraintsSha256(),
        system_id:system.id,
        task_id:task.id,
        provider_origin:system.official_origin,
        provider_session_authenticated:true,
        external_evaluator_attested:true,
        self_reported:false,
        provider_run_id:`external-${systemIndex}-${taskIndex}`,
        system_version:`${system.id.toLowerCase()}-frozen-version`,
        model_version:`${system.id.toLowerCase()}-frozen-model`,
        evaluator_identity:'independent-comparison-lab',
        evidence_url:`https://evidence.invalid/fa19/${system.id}/${task.id}`,
        started_at:new Date(Date.UTC(2026,8,16,10,minute,0)).toISOString(),
        ended_at:new Date(Date.UTC(2026,8,16,10,minute+1,0)).toISOString(),
        results,
        score,
        artifacts:[{name:'run-evidence.json',sha256:(systemIndex+1).toString(16).repeat(64).slice(0,64)}],
        production_authority:false,
      };
      receipts.push(await sealRunReceipt(body));
    }
  }
  return receipts;
}

async function level6Attestation(evaluation){
  const body={
    schema:'musitu.axiom.fa19.level6-attestation.v1',
    protocol_sha256:FA19_PROTOCOL_SHA256,
    candidate_commit:candidateCommit,
    level5_evaluation_sha256:evaluation.evaluation_sha256,
    builder_identity:'comparison-builder',
    evaluator_identity:'independent-level6-evaluator',
    all_matrix_cells_replayed:true,
    independent:true,
    repository_write_authority_present:false,
    production_authority:false,
  };
  return {...body,attestation_sha256:await sha256(body)};
}

test('FA-19 protocol and Level 0-7 vocabulary are immutable',async()=>{
  assert.equal(FA19_SOURCE_COMMIT,'2ddd7b8604d5a40e3c83818f6f90bd82c5c4a963');
  assert.match(FA19_PROTOCOL_SHA256,/^[0-9a-f]{64}$/);
  assert.equal(await verifyFrozenProtocol(),true);
  assert.deepEqual(Object.values(FA19_EVIDENCE_LEVELS),[
    'TARGET_ONLY','IMPLEMENTED_UNQUALIFIED','LOCALLY_QUALIFIED','LIVE_ADAPTER_EVIDENCED',
    'PRODUCTION_EVIDENCED','EXTERNAL_COMPARATIVE_EVIDENCED','INDEPENDENTLY_VALIDATED','LONGITUDINALLY_DEFENSIBLE',
  ]);
  assert.equal(FA19_FROZEN_PROTOCOL.required_matrix.receipt_count,20);
});

test('official documentation snapshot defines targets but cannot create a score',async()=>{
  assert.equal(FA19_FROZEN_PROTOCOL.baseline_snapshot.documentation_only,true);
  assert.equal(FA19_FROZEN_PROTOCOL.baseline_snapshot.comparative_score_authorized,false);
  assert.equal(FA19_FROZEN_PROTOCOL.baseline_snapshot.systems.length,5);
  const evaluation=await evaluateMatchedComparison({candidateCommit,runs:[]});
  assert.equal(evaluation.status,'BLOCKED_AUTHENTICATED_EXTERNAL_RUNS_REQUIRED');
  assert.equal(evaluation.received_receipts,0);
  assert.equal(evaluation.missing_receipts.length,20);
  assert.equal(evaluation.highest_evidence_level,4);
  assert.equal(evaluation.documentation_created_score,false);
  assert.equal(evaluation.level_5_earned,false);
});

test('complete receipt matrix remains blocked until a distinct evaluator trust root is registered',async()=>{
  const runs=await completeReceipts();
  const evaluation=await evaluateMatchedComparison({candidateCommit,runs});
  assert.equal(evaluation.status,'BLOCKED_REGISTERED_EXTERNAL_TRUST_ROOT_REQUIRED');
  assert.equal(evaluation.missing_receipts.length,0);
  assert.equal(evaluation.invalid_receipts.length,0);
  assert.equal(evaluation.receipt_matrix_structurally_complete,true);
  assert.equal(evaluation.trusted_external_validation,false);
  assert.equal(evaluation.external_trust_root_status,'PENDING_DISTINCT_EXTERNAL_EVALUATOR_REGISTRATION');
  assert.equal(evaluation.level_5_earned,false);
  assert.equal(evaluation.level_6_earned,false);
  assert.equal(evaluation.level_7_earned,false);
  assert.equal(evaluation.highest_evidence_level,4);
  assert.equal(evaluation.aggregate_scores.MUSITU_AXIOM,400);
  assert.equal(evaluation.world_best_authorized,false);
  assert.equal(evaluation.superiority,'NOT_CERTIFIED');
});

test('a legitimate failing result is scored deterministically and does not get hidden',async()=>{
  const runs=await completeReceipts({failingKey:'OPENAI_CODEX:BUG_REPRO_MINIMAL_REPAIR'});
  const evaluation=await evaluateMatchedComparison({candidateCommit,runs});
  assert.equal(evaluation.receipt_matrix_structurally_complete,true);
  assert.equal(evaluation.level_5_earned,false);
  assert.equal(evaluation.aggregate_scores.OPENAI_CODEX,300);
  assert.equal(evaluation.aggregate_scores.MUSITU_AXIOM,400);
  const failed=runs.find(run=>run.system_id==='OPENAI_CODEX'&&run.task_id==='BUG_REPRO_MINIMAL_REPAIR');
  assert.equal((await validateRunReceipt(failed,{candidateCommit})).score,0);
});

test('self-hashed Level 6 attestation cannot bypass the absent external trust root',async()=>{
  const runs=await completeReceipts();
  const level5=await evaluateMatchedComparison({candidateCommit,runs});
  const attestation=await level6Attestation(level5);
  const evaluation=await evaluateMatchedComparison({candidateCommit,runs,level6Attestation:attestation});
  assert.equal(evaluation.level_5_earned,false);
  assert.equal(evaluation.level_6_earned,false);
  assert.equal(evaluation.level_7_earned,false);
  assert.equal(evaluation.highest_evidence_level,4);
});

test('longitudinal-looking windows cannot create Level 7 without trusted Level 5 and 6 evidence',async()=>{
  const runs=await completeReceipts();
  const level5=await evaluateMatchedComparison({candidateCommit,runs});
  const attestation=await level6Attestation(level5);
  const scores=level5.aggregate_scores;
  const windows=[
    {window_id:'w1',observed_at:'2026-09-16T00:00:00Z',protocol_sha256:FA19_PROTOCOL_SHA256,level_6_earned:true,evaluation_sha256:'1'.repeat(64),aggregate_scores:scores},
    {window_id:'w2',observed_at:'2026-10-01T00:00:00Z',protocol_sha256:FA19_PROTOCOL_SHA256,level_6_earned:true,evaluation_sha256:'2'.repeat(64),aggregate_scores:scores},
    {window_id:'w3',observed_at:'2026-10-17T00:00:00Z',protocol_sha256:FA19_PROTOCOL_SHA256,level_6_earned:true,evaluation_sha256:'3'.repeat(64),aggregate_scores:scores},
  ];
  const evaluation=await evaluateMatchedComparison({candidateCommit,runs,level6Attestation:attestation,longitudinalWindows:windows});
  assert.equal(evaluation.level_5_earned,false);
  assert.equal(evaluation.level_6_earned,false);
  assert.equal(evaluation.level_7_earned,false);
  assert.equal(evaluation.highest_evidence_level,4);
  assert.equal(evaluation.world_best_authorized,false);
});

test('claim gate stays closed without cryptographically trusted Level 5 evidence',async()=>{
  const pending=await evaluateMatchedComparison({candidateCommit,runs:[]});
  assert.equal(authorizeComparativeClaim(pending,{kind:'MATCHED_TASK_SET_RESULT',scope:'FA19_FROZEN_TASK_SET'}).authorized,false);
  const completeButUntrusted=await evaluateMatchedComparison({candidateCommit,runs:await completeReceipts()});
  assert.equal(authorizeComparativeClaim(completeButUntrusted,{kind:'MATCHED_TASK_SET_RESULT',scope:'FA19_FROZEN_TASK_SET'}).authorized,false);
  assert.equal(authorizeComparativeClaim(completeButUntrusted,{kind:'WORLD_BEST',scope:'FA19_FROZEN_TASK_SET'}).authorized,false);
  assert.equal(authorizeComparativeClaim(completeButUntrusted,{kind:'GENERAL_SUPERIORITY',scope:'FA19_FROZEN_TASK_SET'}).authorized,false);
});

test('builder qualifies the fail-closed harness without inventing external evidence',async()=>{
  const evidence=await runHarnessQualification({candidateCommit,builderIdentity:'fa19-builder'});
  assert.equal(evidence.status,'FA19_HARNESS_VERIFIED_EXTERNAL_COMPARISON_PENDING');
  assert.equal(evidence.harness_qualification_earned,undefined);
  assert.equal(evidence.external_run_receipts_present,0);
  assert.equal(evidence.required_external_run_receipts,20);
  assert.equal(evidence.level_5_earned,false);
  assert.equal(evidence.phase_exit_earned,false);
  assert.equal(evidence.production_authority,false);
  assert.equal(await verifyHarnessEvidence(evidence),true);
});

test('independent verifier replays harness truth while preserving the FA-19 blocker',async()=>{
  const builderEvidence=await runHarnessQualification({candidateCommit,builderIdentity:'fa19-builder'});
  const attestation=await runIndependentHarnessVerification({builderEvidence,verifierIdentity:'fa19-independent-verifier'});
  assert.equal(attestation.status,'INDEPENDENT_VERIFIED_FA19_HARNESS_EXTERNAL_COMPARISON_NOT_PROVEN');
  assert.equal(attestation.builder_and_verifier_distinct,true);
  assert.equal(attestation.harness_qualification_earned,true);
  assert.equal(attestation.external_comparison_earned,false);
  assert.equal(attestation.level_5_earned,false);
  assert.equal(attestation.phase_exit_earned,false);
  assert.equal(attestation.production_authority,false);
  assert.equal(await verifyIndependentHarnessAttestation(attestation),true);
});
