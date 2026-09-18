import test from 'node:test';
import assert from 'node:assert/strict';
import {RECOVERY_PROGRAM,phaseCanBeEarned,phaseOrder} from '../program_contract.mjs';
import {IdentityOnboardingKernel,runAr03Gate} from '../identity_onboarding.mjs';
import {ProjectWorkGraphKernel,runAr04Gate} from '../project_work_graph.mjs';
import {runAr05Gate} from '../durable_kernel.mjs';
import {UnifiedToolFabric,TOOL_FABRIC_ORDER,runAr06Gate} from '../tool_fabric.mjs';
import {UnifiedRecoveryOrchestrator,makeDeterministicRecoveryFabric} from '../unified_orchestrator.mjs';
import {runAr07CandidateGate,validateUnifiedApplicationManifest,REQUIRED_AR07_SURFACES} from '../unified_application.mjs';
import {AR08_ATTACK_DOMAINS,buildDefaultAttackFixtures,runAr08CandidateGate} from '../adversarial_qualification.mjs';
import {AR09_TARGETS,runAr09CandidateGate} from '../reliability_qualification.mjs';
import {runAr10CandidateGate} from '../benchmark_program.mjs';
import {AR11_STAGES,runAr11CandidateGate} from '../rollout_control.mjs';

const quantitative=Array.from({length:74},(_,i)=>i===0?'arithmetic.evaluate':`quant.op.${String(i+1).padStart(2,'0')}`);

function fullFabric(){
  const f=makeDeterministicRecoveryFabric(new UnifiedToolFabric(),quantitative);
  for(const lane of TOOL_FABRIC_ORDER.slice(2))f.registerLane(lane,{tools:[`${lane}.probe`],adapter:async req=>({status:'COMPLETED',tool:req.tool,simulation:false,orchestrator_bypass:false})});
  return f;
}

async function identityFixture(){
  const identity=new IdentityOnboardingKernel();await identity.createOrganization({organization_id:'org-a',name:'Axiom Org',owner_subject:'owner-a'});await identity.register({subject:'user-a',display_name:'User A',organization_id:'org-a',roles:['owner'],entitlements:['axiom.safe.execute']});return identity;
}

test('program contract preserves AR-03 through AR-11 order and fail-closed dependency',()=>{
  assert.deepEqual(phaseOrder(),['AR-03','AR-04','AR-05','AR-06','AR-07','AR-08','AR-09','AR-10','AR-11']);
  assert.equal(RECOVERY_PROGRAM.phases['AR-06'].fixed_order.length,10);
  assert.equal(RECOVERY_PROGRAM.phases['AR-09'].targets.gateway_availability_pct,99.9);
  assert.equal(RECOVERY_PROGRAM.phases['AR-10'].superiority_requirements.length,9);
  assert.deepEqual(RECOVERY_PROGRAM.phases['AR-11'].fixed_order,AR11_STAGES);
  assert.deepEqual(phaseCanBeEarned('AR-03',{gatePassed:true}),{earned:false,reason:'AR02_NOT_EARNED'});
});

test('AR-03 identity is server-authoritative, auditable, entitlement-bound, and recovery revokes key metadata',async()=>{
  const identity=await identityFixture();const ctx=identity.context('user-a');assert.equal(ctx.browser_may_grant,false);assert.equal(identity.entitled('user-a','axiom.safe.execute'),true);await identity.linkOAuth({subject:'user-a',provider:'openai-mcp',provider_subject:'mcp-user',scopes:['axiom.execute']});await identity.registerKeyMetadata({subject:'user-a',key_id:'key-meta-1',key_prefix:'axiom_abc',scopes:['axiom.execute']});const before=await identity.verify();assert.equal(before.status,'PASS');await identity.recover({subject:'user-a',recovery_actor:'owner-a',reason:'lost device'});assert.equal(identity.keys.get('key-meta-1').status,'REVOKED_BY_RECOVERY');assert.equal((await identity.verify()).status,'PASS');
});

test('AR-03 integrated self-service safe task candidate passes without manual DB provisioning',async()=>{
  const identity=await identityFixture();const graph=new ProjectWorkGraphKernel();const fabric=fullFabric();const orchestrator=new UnifiedRecoveryOrchestrator({fabric});const gate=await runAr03Gate({identity,graph,orchestrator,subject:'user-a',objective:'calculate 40+2'});assert.equal(gate.status,'PASS');assert.equal(gate.manual_provisioning_required,false);
});

test('AR-04 two-device continuity preserves provenance and blocks foreign tenant',async()=>{
  const graph=new ProjectWorkGraphKernel();const a={subject:'a',organization_id:'org-a'},b={subject:'b',organization_id:'org-a'},foreign={subject:'x',organization_id:'org-x'};const gate=await runAr04Gate({graph,identityA:a,sameTenantIdentity:b,foreignIdentity:foreign});assert.equal(gate.status,'PASS');assert.equal(gate.cross_tenant_blocked,true);assert.equal(gate.provenance_preserved,true);
});

test('AR-05 durable kernel survives transient failure and restart without duplicate effect',async()=>{const gate=await runAr05Gate();assert.equal(gate.status,'PASS');assert.equal(gate.duplicate_side_effects,false);assert.equal(gate.post_completion_reexecution_calls,0);});

test('AR-06 all registered lanes use one production-shaped orchestrator',async()=>{const gate=await runAr06Gate();assert.equal(gate.status,'PASS');assert.equal(gate.fixed_order_preserved,true);assert.equal(gate.local_simulation_used,false);assert.equal(gate.executed_tools,gate.registered_tools);});

test('AR-07 interface contract passes candidate checks but does not fake unfamiliar-human gate',async()=>{
  const fabric=fullFabric();const orchestrator=new UnifiedRecoveryOrchestrator({fabric});const gate=await runAr07CandidateGate({orchestrator:async args=>orchestrator.execute(args)});assert.equal(gate.status,'CANDIDATE_PASS_REAL_USER_GATE_PENDING');assert.equal(gate.synthetic_completed,5);assert.equal(gate.unfamiliar_real_users_completed,0);assert.equal(gate.phase_gate_earned,false);
});

test('AR-07 manifest rejects disconnected local simulation surface',()=>{const m={home_prompt:'What do you want accomplished?',raw_capability_detail_surfaces:['Analyze'],surfaces:REQUIRED_AR07_SURFACES.map(id=>({id,connected_to_unified_orchestrator:true,local_simulation:false,visible_limitations:true}))};m.surfaces[0].local_simulation=true;assert.equal(validateUnifiedApplicationManifest(m).status,'FAIL');});

test('AR-08 covers all attack domains and remains pending independent reproduction',async()=>{
  const deny=async()=>{const e=new DOMException('blocked','SecurityError');throw e;};const attacks=buildDefaultAttackFixtures({tenantRead:deny,authorize:deny,sandboxRead:deny,evidenceVerify:deny,replay:deny,dependencyCheck:deny,evaluatorCheck:deny,secretProbe:deny,networkProbe:deny});assert.equal(attacks.length,AR08_ATTACK_DOMAINS.length);const gate=await runAr08CandidateGate({attacks,authorizationProbe:async()=>({consequential_without_exact_authorization:false})});assert.equal(gate.status,'CANDIDATE_PASS_INDEPENDENT_REPRODUCTION_PENDING');assert.equal(gate.open_high_critical,0);assert.equal(gate.phase_gate_earned,false);
});

test('AR-09 synthetic fault injection meets frozen targets but cannot earn live SLO gate',async()=>{const gate=await runAr09CandidateGate();assert.equal(gate.status,'CANDIDATE_PASS_LIVE_SLO_EVIDENCE_PENDING');assert.equal(gate.synthetic_exercise.metrics.gateway_availability_pct>=AR09_TARGETS.gateway_availability_pct,true);assert.equal(gate.synthetic_exercise.metrics.transient_failure_recovery_pct>=AR09_TARGETS.transient_failure_recovery_pct,true);assert.equal(gate.phase_gate_earned,false);});

test('AR-10 seals benchmark programme and keeps superiority uncertified',async()=>{const gate=await runAr10CandidateGate();assert.equal(gate.status,'CANDIDATE_PASS_EXTERNAL_BENCHMARK_RUNS_PENDING');assert.equal(gate.tuning_after_seal_blocked,true);assert.equal(gate.superiority,'NOT_CERTIFIED');assert.equal(gate.phase_gate_earned,false);});

test('AR-11 proves rollback stage ordering and stops at exact S4 approval boundary',async()=>{const gate=await runAr11CandidateGate();assert.equal(gate.status,'CANDIDATE_PASS_STOPPED_AT_S4_APPROVAL_BOUNDARY');assert.deepEqual(gate.completed_stages,AR11_STAGES.slice(0,5));assert.equal(gate.production_cutover_executed,false);assert.equal(gate.current_production_retained,true);assert.equal(gate.phase_gate_earned,false);});
