import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  FA18_HUMAN_AUTHORITY,
  FA18_INJECTED_POLICY,
  FA18_REPAIRED_POLICY,
  evaluateChallengeCandidate,
  runAxiomBuilderChallenge,
  runIndependentChallengeVerification,
  verifyBuilderEvidence,
  verifyHumanAuthority,
  verifyIndependentAttestation,
} from '../fa18_axiom_build_challenge.mjs';

const candidateCommit='b'.repeat(40);
const policyText=policy=>`${JSON.stringify(policy,null,2)}\n`;
const base=()=>({'axiom/policy/authority-gate.json':policyText(FA18_INJECTED_POLICY)});

test('tampered or self-issued human authority cannot start the challenge',async()=>{
  const tampered={...FA18_HUMAN_AUTHORITY,production_authority:true};
  assert.equal(await verifyHumanAuthority(tampered),false);
  await assert.rejects(()=>runAxiomBuilderChallenge({candidateCommit,humanAuthority:tampered}),/human challenge authority/i);
});

test('builder cannot occupy the human authority role',async()=>{
  await assert.rejects(
    ()=>runAxiomBuilderChallenge({builderId:FA18_HUMAN_AUTHORITY.authority_id,candidateCommit}),
    /builder must be distinct/i,
  );
});

test('builder cannot weaken self approval retrieved-data or production boundaries',async()=>{
  for(const repairPolicy of [
    {...FA18_REPAIRED_POLICY,self_approval:'ALLOW'},
    {...FA18_REPAIRED_POLICY,retrieved_instructions:'AUTHORITY'},
    {...FA18_REPAIRED_POLICY,production_authority:true},
  ])await assert.rejects(()=>runAxiomBuilderChallenge({candidateCommit,repairPolicy}),/frozen contract/i);
});

test('extra policy fields and fail-open repair attempts are rejected',()=>{
  for(const policy of [
    {...FA18_REPAIRED_POLICY,unreviewed_override:true},
    {...FA18_REPAIRED_POLICY,missing_evidence:'ALLOW'},
  ]){
    const result=evaluateChallengeCandidate(base(),{'axiom/policy/authority-gate.json':policyText(policy)});
    assert.equal(result.status,'FAIL');
  }
});

test('builder evidence tamper cannot be promoted by the verifier',async()=>{
  const evidence=await runAxiomBuilderChallenge({candidateCommit});
  const tampered={...evidence,candidate_tests:'FAIL'};
  assert.equal(await verifyBuilderEvidence(tampered),false);
  await assert.rejects(()=>runIndependentChallengeVerification({builderEvidence:tampered}),/evidence integrity/i);
});

test('builder cannot self-verify and verifier cannot impersonate human authority',async()=>{
  const evidence=await runAxiomBuilderChallenge({builderId:'axiom-builder',candidateCommit});
  await assert.rejects(()=>runIndependentChallengeVerification({builderEvidence:evidence,verifierId:'axiom-builder'}),/independent verifier/i);
  await assert.rejects(()=>runIndependentChallengeVerification({builderEvidence:evidence,verifierId:FA18_HUMAN_AUTHORITY.authority_id}),/independent verifier/i);
});

test('independent attestation tamper fails verification',async()=>{
  const evidence=await runAxiomBuilderChallenge({candidateCommit});
  const attestation=await runIndependentChallengeVerification({builderEvidence:evidence});
  assert.equal(await verifyIndependentAttestation({...attestation,production_authority:true}),false);
  assert.equal(await verifyIndependentAttestation({...attestation,qualification_earned:false}),false);
});

test('FA-18 implementation has no network transport host executor deployment or superiority claim',()=>{
  const source=fs.readFileSync(new URL('../fa18_axiom_build_challenge.mjs',import.meta.url),'utf8');
  for(const pattern of [/\bfetch\s*\(/,/WebSocket\s*\(/,/XMLHttpRequest/,/child_process/,/\bspawn\s*\(/,/\bexec\s*\(/,/wrangler\s+deploy/,/kubectl\s+apply/,/terraform\s+apply/])assert.equal(pattern.test(source),false,String(pattern));
  for(const text of ["benchmark_only:true","sole_builder:false","production_authority:false","superiority:'NOT_CERTIFIED'","tablet_evidence:'DEFERRED_PENDING_FUTURE_CUSTOMER'"])assert.ok(source.includes(text),text);
});
