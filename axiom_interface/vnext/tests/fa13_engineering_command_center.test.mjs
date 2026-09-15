import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BREADTH_SURFACES,DEPLOYMENT_STAGES,MATRIX_ROWS,SYSTEM_GRAPH_LAYERS,
  normalizeRowEvidence,routeModel,sealCheckpoint,sha256,validateDeploymentHistory,verifyCheckpoint
} from '../engineering_command_center_security.js';
import {deriveEngineeringMatrix,makeEngineeringSnapshot} from '../engineering_command_center_adapters.js';
import {verifyEngineeringCommandCenter} from '../engineering_command_center_verifier.js';

const projectId='project-fa13';
const digest=async value=>sha256(value);
const independent=async(verifier='external-verifier')=>({status:'VERIFIED',verifier_id:verifier,source_id:'external:qualified-evidence',evidence_sha256:await digest({source:'external',verifier}),captured_at:new Date().toISOString()});
async function checkpoint(){const d=await digest('component');return sealCheckpoint({project_id:projectId,checkpoint_id:'cp-1',worktree_id:'main',components:{git_tree:d,dependencies:{state:'NOT_PROVEN'},migration_state:{state:'NOT_PROVEN'},environment:d,plan:d,acceptance:d,tests:d,browser_snapshot:{state:'NOT_PROVEN'},security:d,artifacts:d,evidence:d}});}
function localBase(cp){return {
  project_id:projectId,builder_id:'local-builder',
  workspace:{project_id:projectId,mode:'GOVERNED_ENGINEERING_WORKSPACE',capabilities:{file_tree:true,editor:true,diff:true,diagnostics:true,search:true,tests:true,preview:true},windsurf_class_claim_authorized:false},
  agent_fleet:{project_id:projectId,mission_control_integrity:'PASS',separate_workload_identities:true,least_privilege:true,budgets_enforced:true,kill_controls:true,independent_verifier:true,cloud_execution_receipt_sha256:null},
  engineering_space:{project_id:projectId,project_graph_integrity:'PASS',full_project_graph:true,sessions:true,files:true,context:true},
  deep_context:{project_id:projectId,status:'PASS',authority_unchanged:true,domains:['code','runtime','data','infra','trace','requirement','evidence']},
  system_graph:{project_id:projectId,status:'PASS',authority_effect:'NONE',authority_unchanged:true,layers:[...SYSTEM_GRAPH_LAYERS],relations:['depends-on','verified-by']},
  execution:{project_id:projectId,integrity:'PASS',independent_gateway:true,network_default_deny:true,host_shell_enabled:false,plaintext_secrets:false,risk_classes:['S0','S1','S2','S3','S4','S5']},
  checkpoints:[cp],
  product_reality:{project_id:projectId,integration:true,contract:'NO_FAKE_VISUAL_COMPLETION',fake_visual_completion_allowed:false},
  cloud_handoff:{project_id:projectId,status:'BLOCKED_EXTERNAL',governed_package:true,isolated_agent_required:true,self_grant_allowed:false,external_execution_receipt_sha256:null},
  model_routing:{project_id:projectId,multi_model:true,qualification_aware:true,cost_aware:true,privacy_aware:true,unqualified_execution_allowed:false,selected_qualification:'QUALIFIED'},
  deployment:{project_id:projectId,history:[{stage:'BUILD'}],control_plane_only:true,stage_skip_allowed:false,production_authority:false,release_receipt_sha256:null},
  enterprise:{project_id:projectId,policy_graph:true,rbac_model:true,agent_policy:true,data_policy:true,network_policy:true,action_policy:true,sso_status:'NOT_PROVEN'},
  security:{project_id:projectId,independent_security_authority:true,builder_self_certifies:false,independent_verifier:true,fail_closed:true,red_team_status:'NOT_PROVEN'},
  breadth:{routes:[...BREADTH_SURFACES],home_outcome_first:true,engineering_redefines_product:false},
};}
async function blockedSnapshot(){const base=localBase(await checkpoint());return makeEngineeringSnapshot(base);}
async function fullSnapshot({verifier='external-verifier'}={}){const cp=await checkpoint(),ext=await independent(verifier),receipt=await digest('cloud receipt'),release=await digest('release receipt'),history=[];for(const stage of DEPLOYMENT_STAGES)history.push({stage,evidence_sha256:await digest({stage})});const base=localBase(cp);base.workspace.windsurf_class_claim_authorized=true;base.agent_fleet.cloud_qualification=ext;base.agent_fleet.cloud_execution_receipt_sha256=receipt;base.cloud_handoff={...base.cloud_handoff,status:'VERIFIED',external_qualification:ext,external_execution_receipt_sha256:receipt};base.deployment={...base.deployment,history,release_receipt_sha256:release,external_qualification:ext};base.enterprise={...base.enterprise,sso_status:'VERIFIED',external_qualification:ext};base.security={...base.security,red_team_status:'VERIFIED',external_qualification:ext};return makeEngineeringSnapshot(base);}

test('FA-13 acceptance matrix is exactly the frozen 14 rows',()=>{assert.equal(MATRIX_ROWS.length,14);assert.deepEqual(MATRIX_ROWS.map(r=>r.id),['IDE','agent_fleet','spaces','context','maps','terminal','checkpoints','preview','cloud_handoff','models','deployment','enterprise','security','breadth']);});
test('FA-13 local implementation stays integrity-valid while external acceptance remains BLOCKED',async()=>{const snap=await blockedSnapshot(),v=await verifyEngineeringCommandCenter(snap);assert.equal(v.status,'PASS');assert.equal(v.matrix_status,'BLOCKED');assert.deepEqual(v.unsatisfied_rows.sort(),['IDE','agent_fleet','cloud_handoff','deployment','enterprise','security'].sort());});
test('FA-13 synthetic fully independently qualified matrix can PASS evaluator without proving real world evidence',async()=>{const snap=await fullSnapshot(),v=await verifyEngineeringCommandCenter(snap);assert.equal(v.status,'PASS');assert.equal(v.matrix_status,'PASS');assert.deepEqual(v.unsatisfied_rows,[]);});
test('FA-13 whole snapshot is hash-bound and tampering fails closed',async()=>{const snap=await blockedSnapshot();snap.workspace.mode='TAMPERED';const v=await verifyEngineeringCommandCenter(snap);assert.equal(v.status,'FAIL');assert.ok(v.errors.includes('snapshot_hash'));});
test('FA-13 external rows cannot self-promote without independent qualification',async()=>{await assert.rejects(()=>normalizeRowEvidence({row_id:'cloud_handoff',project_id:projectId,state:'IMPLEMENTED_VERIFIED',evidence_refs:['ui-present']},{projectId}),/cannot self-promote/);});
test('FA-13 external builder self-verification is rejected even with syntactically valid evidence',async()=>{const snap=await fullSnapshot({verifier:'local-builder'}),v=await verifyEngineeringCommandCenter(snap);assert.equal(v.status,'FAIL');assert.ok(v.errors.some(x=>x.startsWith('matrix_external_builder_self_verification:')));});
test('FA-13 cross-project matrix evidence reuse fails closed',async()=>{await assert.rejects(()=>normalizeRowEvidence({row_id:'IDE',project_id:'other',state:'PARTIAL',evidence_refs:[]},{projectId}),/cross-project/);});
test('FA-13 checkpoint hash and authority boundaries are fail closed',async()=>{const cp=await checkpoint();assert.equal((await verifyCheckpoint(cp)).status,'PASS');cp.production_state_mutated=true;assert.equal((await verifyCheckpoint(cp)).status,'FAIL');});
test('FA-13 deployment state machine rejects stage skipping',()=>{const result=validateDeploymentHistory([{stage:'BUILD'},{stage:'SECURITY'}]);assert.equal(result.status,'FAIL');assert.ok(result.errors.some(x=>x.includes('deployment_skip')));});
test('FA-13 model router never selects unqualified candidates',()=>{const metrics={quality:.9,reliability:.9,latency:.1,cost:.1,privacy:.9,context:.9,tool_support:.9,historical_success:.9};const blocked=routeModel([{id:'candidate',qualification:'UNQUALIFIED',...metrics}]);assert.equal(blocked.status,'BLOCKED');assert.equal(blocked.selected,null);const routed=routeModel([{id:'qualified',qualification:'QUALIFIED',...metrics},{id:'unqualified',qualification:'UNQUALIFIED',quality:1,reliability:1,latency:0,cost:0,privacy:1,context:1,tool_support:1,historical_success:1}]);assert.equal(routed.selected.id,'qualified');assert.equal(routed.unqualified_execution_allowed,false);});
test('FA-13 authority-delegating System Graph relations fail verification',async()=>{const snap=await blockedSnapshot();snap.system_graph.relations=['depends-on','delegate-authority'];snap.snapshot_sha256=await sha256(Object.fromEntries(Object.entries(snap).filter(([k])=>k!=='snapshot_sha256')));const v=await verifyEngineeringCommandCenter(snap);assert.equal(v.status,'FAIL');assert.ok(v.errors.includes('maps_authority_relation'));});
test('FA-13 breadth cannot pass when a permanent AXIOM surface disappears',async()=>{const snap=await blockedSnapshot();snap.breadth.routes=snap.breadth.routes.filter(x=>x!=='research');snap.snapshot_sha256=await sha256(Object.fromEntries(Object.entries(snap).filter(([k])=>k!=='snapshot_sha256')));const v=await verifyEngineeringCommandCenter(snap);assert.equal(v.status,'FAIL');assert.ok(v.errors.includes('breadth_missing:research'));});
test('FA-13 default derivation keeps cloud deploy enterprise and security external truth blocked',async()=>{const snap=await blockedSnapshot(),states=Object.fromEntries(snap.matrix_evidence.map(row=>[row.row_id,row.state]));for(const id of ['agent_fleet','cloud_handoff','deployment','enterprise','security'])assert.equal(states[id],'IMPLEMENTED_BLOCKED_EXTERNAL');});
