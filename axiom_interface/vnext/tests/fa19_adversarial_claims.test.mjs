import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  FA19_METRICS,
  FA19_PROTOCOL_SHA256,
  FA19_SOURCE_COMMIT,
  FA19_SYSTEMS,
  FA19_TASKS,
  constraintsSha256,
  evaluateMatchedComparison,
  runHarnessQualification,
  runIndependentHarnessVerification,
  sealRunReceipt,
  validateRunReceipt,
  verifyHarnessEvidence,
  verifyIndependentHarnessAttestation,
} from '../fa19_external_comparison.mjs';

const candidateCommit='d'.repeat(40);

async function receipt(overrides={}){
  const system=FA19_SYSTEMS[0],task=FA19_TASKS[0];
  const results=Object.fromEntries(FA19_METRICS.map(metric=>[metric.id,true]));
  const body={
    schema:'musitu.axiom.fa19.external-run-receipt.v1',source_commit:FA19_SOURCE_COMMIT,candidate_commit:candidateCommit,
    protocol_sha256:FA19_PROTOCOL_SHA256,constraints_sha256:await constraintsSha256(),system_id:system.id,task_id:task.id,
    provider_origin:system.official_origin,provider_session_authenticated:true,external_evaluator_attested:true,self_reported:false,
    provider_run_id:'external-run-1',system_version:'frozen-system',model_version:'frozen-model',evaluator_identity:'independent-lab',
    evidence_url:'https://evidence.invalid/run-1',started_at:'2026-09-16T10:00:00Z',ended_at:'2026-09-16T10:01:00Z',
    results,score:100,artifacts:[{name:'evidence.json',sha256:'a'.repeat(64)}],production_authority:false,...overrides,
  };
  return sealRunReceipt(body);
}

test('documentation-shaped and unauthenticated records are rejected',async()=>{
  const fake=await receipt({provider_session_authenticated:false,self_reported:true});
  const validation=await validateRunReceipt(fake,{candidateCommit});
  assert.equal(validation.valid,false);
  assert.ok(validation.errors.includes('provider_authentication'));
  assert.ok(validation.errors.includes('self_reported'));
});

test('official-origin substitution and constraints drift fail closed',async()=>{
  const fake=await receipt({provider_origin:'https://example.invalid',constraints_sha256:'b'.repeat(64)});
  const validation=await validateRunReceipt(fake,{candidateCommit});
  assert.equal(validation.valid,false);
  assert.ok(validation.errors.includes('provider_origin'));
  assert.ok(validation.errors.includes('constraints_sha256'));
});

test('supplied score cannot disagree with the deterministic metric score',async()=>{
  const results=Object.fromEntries(FA19_METRICS.map(metric=>[metric.id,false]));
  const fake=await receipt({results,score:100});
  const validation=await validateRunReceipt(fake,{candidateCommit});
  assert.equal(validation.valid,false);
  assert.ok(validation.errors.includes('score'));
  assert.equal(validation.score,0);
});

test('duplicate matrix cells do not satisfy missing cells',async()=>{
  const one=await receipt(),two=await receipt({provider_run_id:'external-run-2'});
  const evaluation=await evaluateMatchedComparison({candidateCommit,runs:[one,two]});
  assert.equal(evaluation.level_5_earned,false);
  assert.equal(evaluation.missing_receipts.length,19);
  assert.ok(evaluation.invalid_receipts.some(item=>item.errors.includes('duplicate_matrix_cell')));
});

test('builder evidence tampering and verifier self-approval fail',async()=>{
  const evidence=await runHarnessQualification({candidateCommit,builderIdentity:'fa19-builder'});
  assert.equal(await verifyHarnessEvidence({...evidence,level_5_earned:true}),false);
  await assert.rejects(
    ()=>runIndependentHarnessVerification({builderEvidence:evidence,verifierIdentity:'fa19-builder'}),
    /distinct independent verifier/i,
  );
});

test('independent attestation tampering fails integrity verification',async()=>{
  const evidence=await runHarnessQualification({candidateCommit,builderIdentity:'fa19-builder'});
  const attestation=await runIndependentHarnessVerification({builderEvidence:evidence,verifierIdentity:'fa19-verifier'});
  assert.equal(await verifyIndependentHarnessAttestation({...attestation,external_comparison_earned:true}),false);
  assert.equal(await verifyIndependentHarnessAttestation({...attestation,production_authority:true}),false);
});

test('FA-19 evaluator has no transport host executor deploy command or certified superiority claim',()=>{
  const source=fs.readFileSync(new URL('../fa19_external_comparison.mjs',import.meta.url),'utf8');
  for(const pattern of [/\bfetch\s*\(/,/WebSocket\s*\(/,/XMLHttpRequest/,/child_process/,/\bspawn\s*\(/,/\bexec\s*\(/,/wrangler\s+deploy/,/kubectl\s+apply/,/terraform\s+apply/])assert.equal(pattern.test(source),false,String(pattern));
  for(const text of ["world_best_authorized:false","documentation_created_score:false","production_authority:false","tablet_evidence:'DEFERRED_PENDING_FUTURE_CUSTOMER'","superiority:'NOT_CERTIFIED'"])assert.ok(source.includes(text),text);
});

test('FA-19 workflows retain portable internal checksum paths',()=>{
  const root=new URL('../../../',import.meta.url);
  const builder=fs.readFileSync(new URL('.github/workflows/axiom-fa19-comparison-harness.yml',root),'utf8');
  const verifier=fs.readFileSync(new URL('.github/workflows/axiom-fa19-independent-verifier.yml',root),'utf8');
  assert.ok(builder.includes('(cd fa19-harness-evidence && sha256sum fa19-harness-evidence.json > fa19-harness-evidence.sha256)'));
  assert.ok(verifier.includes('(cd fa19-independent-evidence && sha256sum fa19-independent-verifier.json > fa19-independent-verifier.sha256)'));
  assert.equal(builder.includes('  fa19-harness-evidence/fa19-harness-evidence.json'),false);
  assert.equal(verifier.includes('  fa19-independent-evidence/fa19-independent-verifier.json'),false);
});

