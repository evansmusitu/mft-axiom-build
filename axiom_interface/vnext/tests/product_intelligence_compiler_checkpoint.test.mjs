import assert from 'node:assert/strict';
import test from 'node:test';
import {compileProductIR,diffProductIR} from '../product_intelligence/product_compiler_ir.js';
import {
  createCompilerCheckpoint,
  verifyCompilerCheckpoint,
  prepareCompilerRollback,
} from '../product_intelligence/compiler_checkpoint.js';

const at='2026-10-04T17:00:00Z';
const projectId='project_12345678';

const artifactApi={
  createArtifactRecord(input={}){return {schema:'musitu.axiom.fa14.artifact.v1',artifact_id:input.artifactId,project_id:input.projectId,work_id:input.workId??'',title:input.title,kind:input.kind,evidence_refs:[...(input.evidenceRefs??[])],provenance:structuredClone(input.provenance??[]),versions:[],approval_state:'DRAFT',publication_intent:null,created_at:at};},
  addArtifactVersion(artifact,input={}){const row={version:artifact.versions.length+1,content_sha256:input.contentSha256,summary:input.summary??'',created_at:at};artifact.versions.push(row);return structuredClone(row);},
  verifyArtifact(artifact){const ok=artifact.evidence_refs.length>0&&artifact.provenance.length>0&&artifact.versions.length>0;return {schema:'musitu.axiom.fa14.artifact-verification.v1',status:ok?'PASS_ARTIFACT_LINEAGE_GATE':'BLOCKED',findings:[]};},
  buildArtifactOutcomePackage(artifact){if(this.verifyArtifact(artifact).status!=='PASS_ARTIFACT_LINEAGE_GATE')throw new Error('artifact lineage gate');return {schema:'musitu.axiom.fa14.artifact-outcome-package.v1',artifact:structuredClone(artifact),verification:this.verifyArtifact(artifact),publication_execution_allowed:false,required_next_gate:'AUTHORIZATION_APPROVAL'};},
};
const evidenceApi={
  assertAxiomObject(candidate,{expectedType}={}){
    assert.equal(candidate.schema,'musitu.axiom.evidence.v1');assert.equal(candidate.type,expectedType??'Evidence');assert.ok(candidate.id.startsWith('evidence_'));assert.equal(candidate.data.verification.independent_verification,'NOT_PROVEN');return candidate;
  },
};
const services={artifactApi,evidenceApi};

const metadata=(generation=1)=>({
  project_id:projectId,
  version:1,
  generation,
  valid_from:at,
  valid_to:null,
  provenance:{source:'checkpoint-test'},
  evidence_refs:['evidence_source_12345678'],
  confidence:1,
  uncertainty:{kind:'NONE'},
  actor_id:'agent_builder_1',
  risk_class:'S1',
  content_hash:'a'.repeat(64),
  freshness:{as_of:at},
  supersession:{state:'CURRENT',supersedes:[]},
});

function graph(title='Initial requirement',generation=1){
  return {
    schema:'musitu.axiom.living-product-graph.v1',
    project_id:projectId,
    generation,
    impact_state:'NOT_PROVEN',
    nodes:[
      {node_id:'lpg_requirement_1',type:'Requirement',metadata:metadata(generation),data:{title}},
      {node_id:'lpg_test_1',type:'Test',metadata:metadata(generation),data:{title:'Verification'}},
    ],
    edges:[
      {edge_id:'lpg_edge_1',from_id:'lpg_requirement_1',to_id:'lpg_test_1',relation:'VERIFIED_BY',causal_semantics:'NONE',metadata:metadata(generation)},
    ],
  };
}

async function fixture(){
  const prior=await compileProductIR(graph('Initial requirement',1),{compilerVersion:'1.0.0'});
  const next=await compileProductIR(graph('Updated requirement',2),{compilerVersion:'1.0.0'});
  const diff=diffProductIR(prior,next);
  return {prior,next,diff};
}

test('compiler checkpoint binds reversible IR state into existing AXIOM Artifact and Evidence contracts',async()=>{
  const {prior,next,diff}=await fixture();
  const checkpoint=await createCompilerCheckpoint({
    projectId,workId:'work_12345678',priorIR:prior,nextIR:next,diff,
    actorId:'agent_builder_1',riskClass:'S1',at,
    evidenceRefs:['evidence_source_12345678'],
  },services);

  assert.equal(checkpoint.schema,'musitu.axiom.product-compiler-checkpoint.v1');
  assert.equal(checkpoint.project_id,projectId);
  assert.equal(checkpoint.prior_ir_sha256,prior.ir_sha256);
  assert.equal(checkpoint.next_ir_sha256,next.ir_sha256);
  assert.match(checkpoint.checkpoint_sha256,/^[a-f0-9]{64}$/);
  assert.equal(checkpoint.authority_effect,'NONE');
  assert.equal(checkpoint.rollback_mode,'PREPARE_ONLY');
  assert.equal(checkpoint.external_execution_authority,false);
  assert.equal(checkpoint.production_authority,false);
  assert.equal(checkpoint.builder_attested,true);
  assert.equal(checkpoint.independent_verification,'NOT_PROVEN');

  assert.equal(evidenceApi.assertAxiomObject(checkpoint.evidence_object,{expectedType:'Evidence'}),checkpoint.evidence_object);
  assert.equal(artifactApi.verifyArtifact(checkpoint.artifact).status,'PASS_ARTIFACT_LINEAGE_GATE');
  const pkg=artifactApi.buildArtifactOutcomePackage(checkpoint.artifact);
  assert.equal(pkg.publication_execution_allowed,false);
  assert.equal(pkg.required_next_gate,'AUTHORIZATION_APPROVAL');
  assert.equal(checkpoint.artifact.versions.length,1);
  assert.equal(checkpoint.artifact.versions[0].content_sha256,checkpoint.checkpoint_sha256);
  assert.equal(await verifyCompilerCheckpoint(checkpoint),true);
});

test('checkpoint creation fails closed on cross-project IR or mismatched diff hashes',async()=>{
  const {prior,next,diff}=await fixture();
  const cross=structuredClone(next);
  cross.project_id='project_87654321';
  await assert.rejects(()=>createCompilerCheckpoint({projectId,priorIR:prior,nextIR:cross,diff,actorId:'agent_builder_1',evidenceRefs:['evidence_source_12345678'],at},services),/cross-project compiler checkpoint blocked/);

  const badDiff={...diff,next_ir_sha256:'f'.repeat(64)};
  await assert.rejects(()=>createCompilerCheckpoint({projectId,priorIR:prior,nextIR:next,diff:badDiff,actorId:'agent_builder_1',evidenceRefs:['evidence_source_12345678'],at},services),/diff hash binding mismatch/);
});

test('checkpoint requires evidence and cannot self-authorize S4/S5 consequential execution',async()=>{
  const {prior,next,diff}=await fixture();
  await assert.rejects(()=>createCompilerCheckpoint({projectId,priorIR:prior,nextIR:next,diff,actorId:'agent_builder_1',evidenceRefs:[],at},services),/at least one evidence reference required/);
  await assert.rejects(()=>createCompilerCheckpoint({
    projectId,priorIR:prior,nextIR:next,diff,actorId:'agent_builder_1',riskClass:'S4',
    evidenceRefs:['evidence_source_12345678'],authorization:{decision:'ALLOW',human_approval:true},at,
  },services),/checkpoint cannot self-authorize S4\/S5 execution/);
});

test('rollback preparation verifies current state and returns prior IR without mutating or granting authority',async()=>{
  const {prior,next,diff}=await fixture();
  const checkpoint=await createCompilerCheckpoint({projectId,priorIR:prior,nextIR:next,diff,actorId:'agent_builder_1',evidenceRefs:['evidence_source_12345678'],at},services);
  const proposal=await prepareCompilerRollback(checkpoint,{currentIR:next,actorId:'agent_verifier_1',at:'2026-10-04T17:05:00Z'});

  assert.equal(proposal.schema,'musitu.axiom.product-compiler-rollback-proposal.v1');
  assert.equal(proposal.project_id,projectId);
  assert.equal(proposal.expected_current_ir_sha256,next.ir_sha256);
  assert.equal(proposal.target_ir_sha256,prior.ir_sha256);
  assert.deepEqual(proposal.restore_ir,prior);
  assert.equal(proposal.execution_mode,'PREPARE_ONLY');
  assert.equal(proposal.external_execution_authority,false);
  assert.equal(proposal.production_authority,false);
  assert.equal(proposal.authority_effect,'NONE');
  assert.equal(proposal.required_next_gate,'GOVERNED_WRITE_AUTHORIZATION');
});

test('rollback preparation rejects stale current IR and tampered checkpoint receipt',async()=>{
  const {prior,next,diff}=await fixture();
  const checkpoint=await createCompilerCheckpoint({projectId,priorIR:prior,nextIR:next,diff,actorId:'agent_builder_1',evidenceRefs:['evidence_source_12345678'],at},services);
  await assert.rejects(()=>prepareCompilerRollback(checkpoint,{currentIR:prior,actorId:'agent_verifier_1'}),/current IR does not match checkpoint head/);

  const tampered={...checkpoint,impact_node_ids:['lpg_tampered']};
  assert.equal(await verifyCompilerCheckpoint(tampered),false);
  await assert.rejects(()=>prepareCompilerRollback(tampered,{currentIR:next,actorId:'agent_verifier_1'}),/checkpoint integrity failure/);
});
