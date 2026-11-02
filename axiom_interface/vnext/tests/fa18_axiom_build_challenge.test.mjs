import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FA18_CHALLENGE_ID,
  FA18_CHALLENGE_SHA256,
  FA18_FROZEN_CHALLENGE,
  FA18_HUMAN_AUTHORITY,
  FA18_HUMAN_AUTHORITY_SHA256,
  FA18_INJECTED_POLICY,
  FA18_REPAIRED_POLICY,
  FA18_SOURCE_COMMIT,
  detectInjectedFailure,
  evaluateChallengeCandidate,
  runAxiomBuilderChallenge,
  runIndependentChallengeVerification,
  verifyBuilderEvidence,
  verifyFrozenChallenge,
  verifyHumanAuthority,
  verifyIndependentAttestation,
} from '../fa18_axiom_build_challenge.mjs';

const candidateCommit='a'.repeat(40);
const policyText=policy=>`${JSON.stringify(policy,null,2)}\n`;
const baseFiles=()=>({'axiom/policy/authority-gate.json':policyText(FA18_INJECTED_POLICY),'README.md':'fixture'});

test('FA-18 challenge and current human continuation authority are hash frozen',async()=>{
  assert.equal(FA18_SOURCE_COMMIT,'410bb43063a9bb8fd3ab3f44ca28dd7192d4508f');
  assert.match(FA18_CHALLENGE_SHA256,/^[0-9a-f]{64}$/);
  assert.match(FA18_HUMAN_AUTHORITY_SHA256,/^[0-9a-f]{64}$/);
  assert.equal(await verifyFrozenChallenge(),true);
  assert.equal(await verifyHumanAuthority(),true);
  assert.equal(FA18_HUMAN_AUTHORITY.decision,'AUTHORIZE_NON_PRODUCTION_FA18_QUALIFICATION');
  assert.equal(FA18_HUMAN_AUTHORITY.production_authority,false);
});

test('AXIOM builder reproduces the injected failure then repairs builds tests rolls back and restores',async()=>{
  const evidence=await runAxiomBuilderChallenge({builderId:'axiom-build-studio',candidateCommit});
  assert.equal(evidence.status,'AXIOM_BUILDER_CANDIDATE_PASS_PENDING_INDEPENDENT_VERIFICATION');
  assert.equal(evidence.challenge_id,FA18_CHALLENGE_ID);
  assert.equal(evidence.injected_failure_observed,true);
  assert.equal(evidence.baseline_tests,'FAIL');
  assert.equal(evidence.candidate_build,'PASS');
  assert.equal(evidence.candidate_tests,'PASS');
  assert.equal(evidence.rollback_failure_observed,true);
  assert.equal(evidence.restored_tree_sha256,evidence.candidate_tree_sha256);
  assert.deepEqual(evidence.changed_paths,FA18_FROZEN_CHALLENGE.allowed_changed_paths);
  assert.equal(evidence.qualification_earned,false);
  assert.equal(evidence.production_authority,false);
  assert.equal(await verifyBuilderEvidence(evidence),true);
});

test('distinct independent verifier replays exact builder evidence before qualification',async()=>{
  const builderEvidence=await runAxiomBuilderChallenge({builderId:'axiom-build-studio',candidateCommit});
  const attestation=await runIndependentChallengeVerification({builderEvidence,verifierId:'independent-fa18-verifier'});
  assert.equal(attestation.status,'INDEPENDENT_VERIFIED_FA18_BUILD_CHALLENGE_PASS');
  assert.equal(attestation.builder_evidence_sha256,builderEvidence.evidence_sha256);
  assert.equal(attestation.replay_evidence_sha256,builderEvidence.evidence_sha256);
  assert.equal(attestation.builder_verifier_human_distinct,true);
  assert.equal(attestation.qualification_earned,true);
  assert.equal(attestation.benchmark_only,true);
  assert.equal(attestation.sole_builder,false);
  assert.equal(attestation.production_authority,false);
  assert.equal(await verifyIndependentAttestation(attestation),true);
});

test('candidate evaluation accepts only the exact fail-closed policy repair',()=>{
  const base=baseFiles(),candidate={...base,'axiom/policy/authority-gate.json':policyText(FA18_REPAIRED_POLICY)};
  assert.equal(detectInjectedFailure(base),true);
  assert.equal(detectInjectedFailure(candidate),false);
  assert.deepEqual(evaluateChallengeCandidate(base,candidate),{
    status:'PASS',errors:[],changed_paths:['axiom/policy/authority-gate.json'],production_authority:false,
  });
});

test('scope escape is rejected even when the authority policy itself is repaired',()=>{
  const base=baseFiles(),candidate={...base,'axiom/policy/authority-gate.json':policyText(FA18_REPAIRED_POLICY),'new-unreviewed.js':'export default true;\n'};
  const result=evaluateChallengeCandidate(base,candidate);
  assert.equal(result.status,'FAIL');
  assert.ok(result.errors.includes('change_scope'));
});
