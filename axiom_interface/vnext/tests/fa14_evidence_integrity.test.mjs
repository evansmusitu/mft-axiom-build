import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  createAnalysisResult,verifyAnalysis,createArtifactRecord,addArtifactVersion,
  verifyArtifact,buildArtifactOutcomePackage,
} from '../fa14_evidence_native_engine.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scope=Object.freeze({tenant_id:'tenant:one',project_id:'project:one',work_id:'work:one'});

function analysisFixture(){
  const hash=digest([1,2,3]);
  const result=createAnalysisResult({
    analysisId:'analysis:one',tenantId:scope.tenant_id,projectId:scope.project_id,workId:scope.work_id,
    title:'Mean of three supplied values',sourceLineage:[{source_id:'evidence:one',locator:'dataset://one',sha256:hash}],
    transformations:[{operation:'statistics.describe',formula:'sum(x)/n'}],
    capability:{id:'statistics.describe',qualification:'CERTIFIED_ATOMIC'},outputs:{mean:2},executionId:'execution:one',
    reproducibility:{environment:'independent test fixture',input_hashes:[hash],code_or_formula_version:'mean-v1'},
  });
  const evidence={...scope,evidence_id:'evidence:one',locator:'dataset://one',content_sha256:hash,verification_status:'VERIFIED'};
  const capability={id:'statistics.describe',qualification:'CERTIFIED_ATOMIC',status:'ACTIVE',code_or_formula_version:'mean-v1'};
  const execution={...scope,execution_id:'execution:one',status:'SUCCEEDED',verification_status:'VERIFIED',replay_status:'MATCH',capability_id:'statistics.describe',code_or_formula_version:'mean-v1',input_hashes:[hash],outputs:{mean:2}};
  const context={scope,resolveEvidence:id=>id===evidence.evidence_id?evidence:null,resolveCapability:id=>id===capability.id?capability:null,resolveExecution:id=>id===execution.execution_id?execution:null};
  return {result,context,evidence,capability,execution};
}

function artifactFixture(){
  const evidenceHash=digest([1,2,3]),contentHash=digest('Mean is 2.');
  const artifact=createArtifactRecord({artifactId:'artifact:one',tenantId:scope.tenant_id,projectId:scope.project_id,workId:scope.work_id,title:'Observed dataset summary',kind:'report',evidenceRefs:['evidence:one'],provenance:[{type:'source',ref:'evidence:one',sha256:evidenceHash}]});
  addArtifactVersion(artifact,{contentSha256:contentHash,summary:'v1'});
  const evidence={...scope,evidence_id:'evidence:one',content_sha256:evidenceHash,verification_status:'VERIFIED'};
  const artifact_commitment=Object.fromEntries(['artifact_id','tenant_id','project_id','work_id','title','kind','evidence_refs','provenance'].map(key=>[key,structuredClone(artifact[key])]));
  const version={...scope,artifact_id:artifact.artifact_id,version:1,content_sha256:contentHash,verification_status:'VERIFIED',artifact_commitment};
  const context={scope,resolveEvidence:id=>id===evidence.evidence_id?evidence:null,resolveArtifactVersion:(id,number)=>id===artifact.artifact_id&&number===1?version:null};
  return {artifact,context,evidence,version};
}

test('complete analysis metadata alone does not establish execution or reproducibility',()=>{
  const {result}=analysisFixture();
  const verdict=verifyAnalysis(result);
  assert.equal(verdict.metadata_complete,true);
  assert.equal(verdict.status,'BLOCKED');
  assert.equal(verdict.reproducible,false);
  assert.ok(verdict.findings.some(row=>row.type==='TRUSTED_CONTEXT_REQUIRED'));
});

test('resolved qualified analysis binds exact inputs, outputs, execution and replay',()=>{
  const {result,context}=analysisFixture();
  const verdict=verifyAnalysis(result,context);
  assert.equal(verdict.status,'PASS_LINEAGE_GATE');
  assert.equal(verdict.reproducible,true);
  assert.equal(verdict.fresh_cryptographic_verification,false);
});

test('analysis rejects output, scope, capability, lineage and proof substitutions',()=>{
  const changes=[
    ({result})=>{result.outputs.mean=999;},
    ({result})=>{result.tenant_id='tenant:other';},
    ({result})=>{result.work_id='work:other';},
    ({result})=>{result.capability.id='unregistered.capability';},
    ({result})=>{result.source_lineage[0].sha256='f'.repeat(64);},
    ({result})=>{result.reproducibility.input_hashes=[];},
    ({result})=>{result.execution_id='execution:missing';},
    ({result})=>{result.outputs={};},
    ({result})=>{result.outputs.mean=NaN;},
    ({execution})=>{execution.replay_status='NOT_RUN';},
    ({evidence})=>{evidence.verification_status='UNVERIFIED';},
    ({capability})=>{capability.status='REVOKED';},
    ({execution})=>{execution.code_or_formula_version='other-version';},
  ];
  for(const change of changes){
    const fixture=analysisFixture();change(fixture);
    const verdict=verifyAnalysis(fixture.result,fixture.context);
    assert.equal(verdict.status,'BLOCKED',change.toString());
    assert.equal(verdict.reproducible,false);
  }
});

test('a missing or asynchronous trusted evidence resolver cannot produce a pass',()=>{
  const {result,context,evidence}=analysisFixture();
  assert.equal(verifyAnalysis(result,{...context,resolveEvidence:undefined}).status,'BLOCKED');
  assert.equal(verifyAnalysis(result,{...context,resolveEvidence:async()=>evidence}).status,'BLOCKED');
});

test('artifact metadata and a declared hash require resolved evidence and stored content version',()=>{
  const {artifact}=artifactFixture();
  const verdict=verifyArtifact(artifact);
  assert.equal(verdict.metadata_complete,true);
  assert.equal(verdict.status,'BLOCKED');
  assert.throws(()=>buildArtifactOutcomePackage(artifact),/artifact package blocked/i);
});

test('resolved artifact package preserves publication denial',()=>{
  const {artifact,context}=artifactFixture();
  const verdict=verifyArtifact(artifact,context);
  assert.equal(verdict.status,'PASS_ARTIFACT_LINEAGE_GATE');
  const pkg=buildArtifactOutcomePackage(artifact,context);
  assert.equal(pkg.publication_execution_allowed,false);
});

test('artifact verification rejects dangling evidence, changed metadata and invalid digest',()=>{
  const changes=[
    ({artifact})=>{artifact.evidence_refs.push('evidence:missing');},
    ({artifact})=>{artifact.title='Different uncommitted artifact';},
    ({artifact})=>{artifact.provenance[0].sha256='not-a-sha256';},
    ({artifact})=>{artifact.versions[0].content_sha256='a'.repeat(32);},
    ({version})=>{version.content_sha256='f'.repeat(64);},
    ({version})=>{version.tenant_id='tenant:other';},
    ({evidence})=>{evidence.verification_status='UNVERIFIED';},
    ({artifact})=>{artifact.versions[0].version=3;},
  ];
  for(const change of changes){
    const fixture=artifactFixture();change(fixture);
    assert.equal(verifyArtifact(fixture.artifact,fixture.context).status,'BLOCKED',change.toString());
    assert.throws(()=>buildArtifactOutcomePackage(fixture.artifact,fixture.context));
  }
});
