import assert from 'node:assert/strict';
import test from 'node:test';
import {compileProductIR,diffProductIR} from '../product_intelligence/product_compiler_ir.js';
import {createCompilerCheckpoint} from '../product_intelligence/compiler_checkpoint.js';
import {
  CHANGE_RISK_MODEL,
  createChangeAdmissionRequest,
  evaluateChangeAdmission,
} from '../product_intelligence/change_admission.js';

const at='2026-10-04T17:20:00Z';
const checkpointLookalike={
  schema:'musitu.axiom.product-compiler-checkpoint.v1',
  checkpoint_id:'checkpoint_1234567890abcdef',
  checkpoint_sha256:'a'.repeat(64),
  project_id:'project_12345678',
  next_ir_sha256:'b'.repeat(64),
  prior_ir_sha256:'c'.repeat(64),
  authority_effect:'NONE',
  rollback_mode:'PREPARE_ONLY',
  external_execution_authority:false,
  production_authority:false,
};

const projectId='project_12345678';
const checkpointAt='2026-10-04T17:00:00Z';
const checkpointArtifactApi={
  createArtifactRecord(input={}){return {schema:'musitu.axiom.fa14.artifact.v1',artifact_id:input.artifactId,project_id:input.projectId,work_id:input.workId??'',title:input.title,kind:input.kind,evidence_refs:[...(input.evidenceRefs??[])],provenance:structuredClone(input.provenance??[]),versions:[],approval_state:'DRAFT',publication_intent:null,created_at:checkpointAt};},
  addArtifactVersion(artifact,input={}){const row={version:artifact.versions.length+1,content_sha256:input.contentSha256,summary:input.summary??'',created_at:checkpointAt};artifact.versions.push(row);return structuredClone(row);},
  verifyArtifact(artifact){const ok=artifact.evidence_refs.length>0&&artifact.provenance.length>0&&artifact.versions.length>0;return {schema:'musitu.axiom.fa14.artifact-verification.v1',status:ok?'PASS_ARTIFACT_LINEAGE_GATE':'BLOCKED',findings:[]};},
  buildArtifactOutcomePackage(artifact){if(this.verifyArtifact(artifact).status!=='PASS_ARTIFACT_LINEAGE_GATE')throw new Error('artifact lineage gate');return {schema:'musitu.axiom.fa14.artifact-outcome-package.v1',artifact:structuredClone(artifact),verification:this.verifyArtifact(artifact),publication_execution_allowed:false,required_next_gate:'AUTHORIZATION_APPROVAL'};},
};
const checkpointEvidenceApi={
  assertAxiomObject(candidate,{expectedType}={}){
    assert.equal(candidate.schema,'musitu.axiom.evidence.v1');
    assert.equal(candidate.type,expectedType??'Evidence');
    assert.equal(candidate.data.verification.independent_verification,'NOT_PROVEN');
    return candidate;
  },
};
const checkpointServices={artifactApi:checkpointArtifactApi,evidenceApi:checkpointEvidenceApi};
const checkpointMetadata=generation=>({
  project_id:projectId,version:1,generation,valid_from:checkpointAt,valid_to:null,
  provenance:{source:'change-admission-checkpoint-fixture'},evidence_refs:['evidence_source_12345678'],confidence:1,
  uncertainty:{kind:'NONE'},actor_id:'agent_builder_1',risk_class:'S1',content_hash:'a'.repeat(64),
  freshness:{as_of:checkpointAt},supersession:{state:'CURRENT',supersedes:[]},
});
function checkpointGraph(title,generation){
  return {
    schema:'musitu.axiom.living-product-graph.v1',project_id:projectId,generation,impact_state:'NOT_PROVEN',
    nodes:[
      {node_id:'lpg_requirement_1',type:'Requirement',metadata:checkpointMetadata(generation),data:{title}},
      {node_id:'lpg_test_1',type:'Test',metadata:checkpointMetadata(generation),data:{title:'Verification'}},
    ],
    edges:[
      {edge_id:'lpg_edge_1',from_id:'lpg_requirement_1',to_id:'lpg_test_1',relation:'VERIFIED_BY',causal_semantics:'NONE',metadata:checkpointMetadata(generation)},
    ],
  };
}
let verifiedCheckpointPromise;
async function verifiedCheckpoint(){
  if(!verifiedCheckpointPromise){
    verifiedCheckpointPromise=(async()=>{
      const prior=await compileProductIR(checkpointGraph('Initial requirement',1),{compilerVersion:'1.0.0'});
      const next=await compileProductIR(checkpointGraph('Updated requirement',2),{compilerVersion:'1.0.0'});
      const diff=await diffProductIR(prior,next);
      return createCompilerCheckpoint({
        projectId,workId:'work_12345678',priorIR:prior,nextIR:next,diff,
        actorId:'agent_builder_1',riskClass:'S1',evidenceRefs:['evidence_source_12345678'],at:checkpointAt,
      },checkpointServices);
    })();
  }
  return verifiedCheckpointPromise;
}

const pass=(kind,actor='agent_verifier_1')=>({kind,status:'PASS',actor_id:actor,artifact_sha256:'d'.repeat(64)});

async function request(riskClass='S3'){
  const checkpoint=await verifiedCheckpoint();
  return createChangeAdmissionRequest({
    projectId:'project_12345678',workId:'work_12345678',checkpoint,
    builderActorId:'agent_builder_1',requestedAction:CHANGE_RISK_MODEL[riskClass].action,
    riskClass,at,
  });
}

test('change admission freezes AXIOM S0-S5 meanings and escalating verification requirements',()=>{
  assert.deepEqual(Object.keys(CHANGE_RISK_MODEL),['S0','S1','S2','S3','S4','S5']);
  assert.equal(CHANGE_RISK_MODEL.S0.action,'READ_COMPUTE');
  assert.equal(CHANGE_RISK_MODEL.S1.action,'PRIVATE_REVERSIBLE_WRITE');
  assert.equal(CHANGE_RISK_MODEL.S2.action,'EXTERNAL_READ');
  assert.equal(CHANGE_RISK_MODEL.S3.action,'EXTERNAL_REVERSIBLE_WRITE');
  assert.equal(CHANGE_RISK_MODEL.S4.action,'PUBLICATION_OR_PRODUCTION_DEPLOYMENT');
  assert.equal(CHANGE_RISK_MODEL.S5.action,'SECRETS_IDENTITY_SECURITY_OR_DESTRUCTIVE');
  assert.deepEqual(CHANGE_RISK_MODEL.S3.required_verifications,['TESTS','SECURITY','INDEPENDENT_VERIFIER']);
  assert.equal(CHANGE_RISK_MODEL.S4.human_approval_required,true);
  assert.equal(CHANGE_RISK_MODEL.S5.human_approval_required,true);
});

test('admission request binds one compiler checkpoint and keeps policy engine mechanism-only',async()=>{
  const r=await request('S3');
  assert.equal(r.schema,'musitu.axiom.product-change-admission-request.v1');
  assert.equal(r.project_id,'project_12345678');
  assert.equal(r.checkpoint_sha256,(await verifiedCheckpoint()).checkpoint_sha256);
  assert.equal(r.builder_actor_id,'agent_builder_1');
  assert.deepEqual(r.required_verifications,['TESTS','SECURITY','INDEPENDENT_VERIFIER']);
  assert.equal(r.policy_engine_authority,'MECHANISM_ONLY');
  assert.equal(r.builder_may_approve,false);
  assert.equal(r.external_execution_authority,false);
  assert.match(r.request_sha256,/^[a-f0-9]{64}$/);
});

test('policy ALLOW cannot bypass missing or builder-self-issued independent verification',async()=>{
  const r=await request('S3');
  const policy={decision:'ALLOW',request_sha256:r.request_sha256,policy_sha256:'e'.repeat(64),reasons:['bounded Phase-2 write']};
  const incomplete=await evaluateChangeAdmission({request:r,policyDecision:policy,verificationEvidence:[pass('TESTS'),pass('SECURITY')],at});
  assert.equal(incomplete.status,'BLOCKED_VERIFICATION');
  assert.equal(incomplete.admitted_to_executor,false);

  await assert.rejects(()=>evaluateChangeAdmission({request:r,policyDecision:policy,verificationEvidence:[pass('TESTS'),pass('SECURITY'),pass('INDEPENDENT_VERIFIER','agent_builder_1')],at}),/independent verifier must differ from builder/);
});

test('S3 admission requires tests security and independent verifier and still does not execute',async()=>{
  const r=await request('S3');
  const policy={decision:'ALLOW',request_sha256:r.request_sha256,policy_sha256:'e'.repeat(64),reasons:['bounded external reversible write']};
  const result=await evaluateChangeAdmission({request:r,policyDecision:policy,verificationEvidence:[pass('TESTS'),pass('SECURITY'),pass('INDEPENDENT_VERIFIER')],at});
  assert.equal(result.status,'ADMITTED_TO_EXECUTOR');
  assert.equal(result.admitted_to_executor,true);
  assert.equal(result.authority_effect,'ADMISSION_ONLY');
  assert.equal(result.external_execution_authority,false);
  assert.equal(result.required_next_gate,'OPERATION_SCOPED_EXECUTOR');
  assert.equal(result.independent_verification,'PASS');
});

test('S4 policy ALLOW cannot replace human approval and valid human receipt only admits next gate',async()=>{
  const r=await request('S4');
  const policy={decision:'ALLOW',request_sha256:r.request_sha256,policy_sha256:'e'.repeat(64),reasons:['release policy passed']};
  const verification=[pass('TESTS'),pass('SECURITY'),pass('INDEPENDENT_VERIFIER')];
  const blocked=await evaluateChangeAdmission({request:r,policyDecision:policy,verificationEvidence:verification,at});
  assert.equal(blocked.status,'BLOCKED_HUMAN_APPROVAL');
  assert.equal(blocked.admitted_to_executor,false);

  const admitted=await evaluateChangeAdmission({
    request:r,policyDecision:policy,verificationEvidence:verification,
    humanApproval:{decision:'ALLOW',request_sha256:r.request_sha256,actor_id:'user_final_authority',receipt_id:'approval_12345678',at},at,
  });
  assert.equal(admitted.status,'ADMITTED_TO_EXECUTOR');
  assert.equal(admitted.human_approval,'PASS');
  assert.equal(admitted.external_execution_authority,false);
  assert.equal(admitted.required_next_gate,'OPERATION_SCOPED_EXECUTOR');
});

test('DENY and policy/request hash mismatch fail closed',async()=>{
  const r=await request('S1');
  const denied=await evaluateChangeAdmission({request:r,policyDecision:{decision:'DENY',request_sha256:r.request_sha256,policy_sha256:'e'.repeat(64),reasons:['policy denied']},verificationEvidence:[pass('TESTS')],at});
  assert.equal(denied.status,'DENIED');
  assert.equal(denied.admitted_to_executor,false);

  await assert.rejects(()=>evaluateChangeAdmission({request:r,policyDecision:{decision:'ALLOW',request_sha256:'f'.repeat(64),policy_sha256:'e'.repeat(64),reasons:[]},verificationEvidence:[pass('TESTS')],at}),/policy decision is not bound to admission request/);
});


test('admission request rejects an unverified checkpoint look-alike even when its surface fields appear valid',async()=>{
  await assert.rejects(
    ()=>createChangeAdmissionRequest({
      projectId:'project_12345678',workId:'work_12345678',checkpoint:checkpointLookalike,
      builderActorId:'agent_builder_1',requestedAction:CHANGE_RISK_MODEL.S3.action,riskClass:'S3',at,
    }),
    /checkpoint.*integrity|verified.*checkpoint|checkpoint.*verification/i,
  );
});


test('rehashed admission request cannot weaken frozen S0-S5 verification requirements',async()=>{
  const original=await request('S3');
  const forged={...structuredClone(original),required_verifications:[]};
  const canonical=value=>{
    if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  };
  const body={
    schema:forged.schema,project_id:forged.project_id,work_id:forged.work_id,checkpoint_id:forged.checkpoint_id,
    checkpoint_sha256:forged.checkpoint_sha256,builder_actor_id:forged.builder_actor_id,requested_action:forged.requested_action,
    risk_class:forged.risk_class,required_verifications:forged.required_verifications,human_approval_required:forged.human_approval_required,
    policy_engine_authority:forged.policy_engine_authority,builder_may_approve:forged.builder_may_approve,
    external_execution_authority:forged.external_execution_authority,production_authority:forged.production_authority,
    created_at:forged.created_at,
  };
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(body)));
  forged.request_sha256=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
  const policy={decision:'ALLOW',request_sha256:forged.request_sha256,policy_sha256:'e'.repeat(64),reasons:['attempted verification downgrade']};
  await assert.rejects(
    ()=>evaluateChangeAdmission({request:forged,policyDecision:policy,verificationEvidence:[],at}),
    /risk model|verification requirements|request.*invariant|required_verifications/i,
  );
});


test('request envelope rejects unsigned authority extensions that are excluded from the request hash',async()=>{
  const r=await request('S1');
  const tampered={...r,release_authority:true};
  const policy={decision:'ALLOW',request_sha256:r.request_sha256,policy_sha256:'e'.repeat(64),reasons:['attempted envelope extension']};
  await assert.rejects(
    ()=>evaluateChangeAdmission({request:tampered,policyDecision:policy,verificationEvidence:[pass('TESTS')],at}),
    /unsupported fields|request envelope|authority/i,
  );
});


test('policy decision envelope rejects authority extensions and non-string reasons',async()=>{
  const r=await request('S1');
  const base={decision:'ALLOW',request_sha256:r.request_sha256,policy_sha256:'e'.repeat(64),reasons:['bounded private write']};
  for(const policyDecision of [
    {...base,production_authority:true},
    {...base,reasons:[{text:'structured reason'}]},
  ]){
    await assert.rejects(
      ()=>evaluateChangeAdmission({request:r,policyDecision,verificationEvidence:[pass('TESTS')],at}),
      /unsupported fields|policy.*authority|reasons.*string|string.*reasons/i,
    );
  }
});
