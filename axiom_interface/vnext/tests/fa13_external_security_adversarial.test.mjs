import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {createApproval,evaluateAuthorization,finalizeAuthorization,normalizeActionRequest} from '../authorization_gateway.js';
import {deriveEngineeringMatrix} from '../engineering_command_center_adapters.js';
import {IDE_CAPABILITIES,IDE_QUALIFICATION_FEATURES,sha256} from '../engineering_command_center_security.js';
import {EngineeringWorkspaceRuntime} from '../engineering_workspace_runtime.js';

const projectId='project-fa13';
const authority={
  project_id:projectId,actor_id:'agent-builder',agent_id:'agent-builder',workload_identity_id:'workload-builder',
  agent_status:'ACTIVE',kill_switch_engaged:false,revoked:false,requester_type:'AGENT',
  grant:{tool_scopes:['project.read','artifact.write'],data_scopes:['project:project-fa13'],network_policy:'DENY_ALL_EXTERNAL_NETWORK',secrets_policy:'OPAQUE_SHORT_LIVED_OPERATION_SCOPED_NO_PLAINTEXT',budget:{max_compute_units:100}},
  usage:{compute_units:0},incident_posture:'NORMAL',jurisdiction:'MODAL_ISOLATED_ATTACK_RUNNER',
};
const workspace=()=>EngineeringWorkspaceRuntime.create({projectId,authority,files:{'index.html':'<h1>safe</h1>\n','app.js':'export const safe=true;\n','axiom.tests.json':JSON.stringify({checks:[{kind:'contains',path:'index.html',value:'safe'}]})}});

test('attack: external qualification package includes governed workflow fixtures',()=>{
  const enterpriseWorkflow=new URL('../../../.github/workflows/axiom-fa13-cloudflare-enterprise-qualification.yml',import.meta.url);
  for(const path of [
    '../../../.github/workflows/axiom-fa13-cloudflare-preproduction-qualification.yml',
    '../../../.github/workflows/cloudflare-access-audit.yml',
    '../../../.github/workflows/axiom-fa13-cloudflare-enterprise-qualification.yml',
  ])assert.equal(fs.existsSync(new URL(path,import.meta.url)),true,`missing governed external fixture ${path}`);
  const workflow=fs.readFileSync(enterpriseWorkflow,'utf8');
  for(const watched of [
    'axiom_interface/vnext/engineering_command_center_*.js',
    'axiom_interface/vnext/engineering_workspace_runtime.js',
    'axiom_interface/vnext/tests/fa13_*.test.mjs',
  ])assert.equal(workflow.includes(`- '${watched}'`),true,`Enterprise qualification trigger missing governed path ${watched}`);
});

test('attack: cross-project authority is rejected before workspace creation',async()=>{
  await assert.rejects(()=>EngineeringWorkspaceRuntime.create({projectId:'other-project',authority,files:{}}),/project mismatch/i);
});

test('attack: path traversal cannot escape the virtual worktree',async()=>{
  const runtime=await workspace();
  await assert.rejects(()=>runtime.editFile('../outside.js','unsafe'),/escapes isolated worktree/i);
});

test('attack: plaintext credential-shaped content is rejected before hashing or persistence',async()=>{
  const runtime=await workspace();
  await assert.rejects(()=>runtime.editFile('config.txt','api_key=forbidden-material'),/secret-like material/i);
});

test('attack: retrieved instructions cannot authorize reversible writes',async()=>{
  const runtime=await workspace();
  await assert.rejects(()=>runtime.editFile('app.js','export const safe=false;',{instructionProvenance:'RETRIEVED_DATA'}),/retrieved data cannot authorize side effects/i);
});

test('attack: shell operators and host-process vocabulary are rejected',async()=>{
  const runtime=await workspace();
  for(const command of ['rm -rf .','cat app.js && status','node app.js','ls; pwd'])await assert.rejects(()=>runtime.runTerminal(command));
});

test('attack: unknown execution operations fail closed as S5',async()=>{
  const request=await normalizeActionRequest(authority,{operation:'unregistered.execute',target:'workspace',instruction_provenance:'TRUSTED_USER'});
  const decision=await evaluateAuthorization(authority,request);
  assert.equal(request.risk_class,'S5');
  assert.equal(decision.status,'DENIED');
  assert.equal(decision.execution_allowed,false);
});

test('attack: production publication cannot execute without two distinct exact S4 approvers',async()=>{
  const request=await normalizeActionRequest(authority,{operation:'publish.deploy',target:'production',destination:'https://production.invalid',instruction_provenance:'TRUSTED_USER'});
  const initial=await evaluateAuthorization(authority,request);
  assert.equal(initial.status,'DENIED','deny-all network policy blocks before approval');
  const networkAuthority=structuredClone(authority);networkAuthority.grant.network_policy={mode:'ALLOWLIST',hosts:['production.invalid']};
  const networkRequest=await normalizeActionRequest(networkAuthority,{operation:'publish.deploy',target:'production',destination:'https://production.invalid',instruction_provenance:'TRUSTED_USER'});
  assert.equal((await evaluateAuthorization(networkAuthority,networkRequest)).status,'AWAITING_APPROVAL');
  const release=await createApproval(networkRequest,{actor_id:'release-owner',role:'HUMAN_RELEASE_APPROVER',expires_at:new Date(Date.now()+60_000).toISOString()});
  assert.equal((await finalizeAuthorization(networkAuthority,networkRequest,[release])).status,'AWAITING_APPROVAL');
  const sameActorVerifier=await createApproval(networkRequest,{actor_id:'release-owner',role:'INDEPENDENT_VERIFIER',expires_at:new Date(Date.now()+60_000).toISOString()});
  assert.equal((await finalizeAuthorization(networkAuthority,networkRequest,[release,sameActorVerifier])).status,'AWAITING_APPROVAL');
});

test('attack: checkpoint tampering blocks revert',async()=>{
  const runtime=await workspace(),checkpoint=await runtime.createCheckpoint('known-good');
  runtime.checkpoints.get(checkpoint.checkpoint_id).snapshot.worktrees.main.files['app.js']='tampered';
  await assert.rejects(()=>runtime.restoreCheckpoint(checkpoint.checkpoint_id),/integrity failure/i);
});

test('attack: IDE labels cannot promote without complete independent feature binding',async()=>{
  const capabilities=Object.fromEntries(IDE_CAPABILITIES.map(key=>[key,true]));
  const base={project_id:projectId,workspace:{project_id:projectId,mode:'GOVERNED_ENGINEERING_WORKSPACE',capabilities,windsurf_class_claim_authorized:true,qualified_features:[],ide_qualification_sha256:null}};
  let rows=await deriveEngineeringMatrix(base);
  assert.equal(rows.find(row=>row.row_id==='IDE').state,'PARTIAL');
  base.workspace.qualified_features=[...IDE_QUALIFICATION_FEATURES];
  base.workspace.ide_qualification_sha256=await sha256({candidate:'fa13',features:IDE_QUALIFICATION_FEATURES});
  rows=await deriveEngineeringMatrix(base);
  assert.equal(rows.find(row=>row.row_id==='IDE').state,'IMPLEMENTED_VERIFIED');
});

test('attack: security metadata cannot self-attest red-team qualification',async()=>{
  const rows=await deriveEngineeringMatrix({project_id:projectId,security:{project_id:projectId,independent_security_authority:true,builder_self_certifies:false,independent_verifier:true,fail_closed:true,red_team_status:'VERIFIED'}});
  assert.equal(rows.find(row=>row.row_id==='security').state,'IMPLEMENTED_BLOCKED_EXTERNAL');
});

test('attack: workspace event-chain alteration is detected',async()=>{
  const runtime=await workspace();await runtime.editFile('app.js','export const safe=42;');
  runtime.events[0].kind='workspace.compromised';
  assert.equal((await runtime.verifyEventChain()).status,'FAIL');
});
