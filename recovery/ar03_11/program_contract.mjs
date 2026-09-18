import {deepFreeze, PHASE_ORDER} from './common.mjs';

export const RECOVERY_PROGRAM = deepFreeze({
  schema:'musitu.axiom.recovery.program.ar03-ar11.v1',
  authority:{
    programme:'AXIOM Recovery & Frontier Blueprint v1.0',
    unified_product:'MUSITU_AXIOM_UNIFIED_V1',
    ar02_dependency:'EXTERNAL_GATES_OPEN',
    production_authority:false,
    superiority:'NOT_CERTIFIED',
    wolfram_parity:'NOT_CERTIFIED',
  },
  phases:{
    'AR-03':{
      name:'Identity and onboarding',
      deliverables:['signup/login','organization/role model','entitlements','key management','OAuth/MCP linkage','account recovery','audit history'],
      gate:'NEW_CUSTOMER_SELF_SERVICE_SAFE_TASK',
      acceptance:'A new customer registers, enters AXIOM, creates a project, and runs an entitled safe task without manual database provisioning.',
    },
    'AR-04':{
      name:'Cloud Project/Work Graph',
      deliverables:['server-backed Project','Work','Artifact','Agent','Memory','Source','Approval','offline reconciliation','local-store import','provenance','tenant isolation'],
      gate:'TWO_DEVICE_PROJECT_CONTINUITY',
      acceptance:'The same project works on two devices without provenance loss or cross-tenant exposure.',
    },
    'AR-05':{
      name:'Durable execution kernel',
      deliverables:['persistent state machine','planner','queue/workflow executor','cancel/retry/resume','idempotency','budgets','approval pauses','complete event stream'],
      gate:'DURABLE_FAILURE_RECOVERY',
      acceptance:'A task survives client closure, runtime restart, timeout, and transient tool failure without duplicate side effects.',
    },
    'AR-06':{
      name:'Full tool-fabric connection',
      fixed_order:['74_quantitative_operations','frontier_v5_research_source','artifact_engine','code_file_sandbox','browser_computer','project_memory_context','agents_mission_control','automations_schedules','mcp_enterprise_connectors','live_multimodal_channels'],
      gate:'ONE_PRODUCTION_SHAPED_ORCHESTRATOR',
      acceptance:'Every registered tool executes through the same production-shaped orchestrator; no UI surface uses a separate local simulation.',
    },
    'AR-07':{
      name:'Unified application',
      deliverables:['unified composer','real plan/progress','live tool visibility','approvals','artifact workspace','memory','retry/cancel/redirect','limitations','mobile supervision','voice/camera/screen'],
      gate:'FIVE_UNFAMILIAR_USERS_UNAIDED',
      acceptance:'Five unfamiliar users complete priority tasks without developer help.',
    },
    'AR-08':{
      name:'Adversarial qualification',
      attack_domains:['prompt injection','cross-tenant access','scope escalation','approval bypass','secret extraction','SSRF','sandbox escape','evidence tampering','replay','dependency compromise','evaluator manipulation'],
      gate:'ZERO_CRITICAL_HIGH_INDEPENDENT_REPRODUCTION',
      acceptance:'Zero open critical/high findings; no consequential action lacks exact authorization; an independent verifier reproduces the verdict.',
    },
    'AR-09':{
      name:'Reliability and scale',
      targets:{gateway_availability_pct:99.9,transient_failure_recovery_pct:95,duplicate_consequential_actions:0,reconciliation_and_provenance_pct:100,cross_tenant_leakage:0},
      gate:'RELIABILITY_TARGETS_MET',
      acceptance:'All reliability, recovery, idempotency, provenance, and tenant-isolation targets are met under fault injection and representative load.',
    },
    'AR-10':{
      name:'Frontier benchmark programme',
      domains:['Astra/Gemini Live','Gemini','Claude Code','Anthropic computer use','Copilot Studio','quantitative finance','AXIOM governance'],
      metrics:['task_success','verified_correctness','completion_time','cost','human_interventions','injected_failure_recovery','citation_provenance_quality','unauthorized_action_rate','artifact_quality','user_preference'],
      gate:'SEALED_INDEPENDENTLY_EVALUABLE_BENCHMARKS',
      acceptance:'Benchmarks and baselines are sealed before tuning, failures are retained, and independent reproduction is possible.',
      superiority_requirements:['frozen baselines','equivalent tasks and access','unseen contamination-resistant tasks','predefined scoring','retained failures','independent reproduction','statistically significant win','no worse safety or authorization','disclosed cost and latency'],
    },
    'AR-11':{
      name:'Governed production rollout',
      fixed_order:['ISOLATED_STAGING','INTERNAL_SHADOW_TRAFFIC','INDEPENDENT_VERIFICATION','CANARY_COHORT','ROLLBACK_REHEARSAL','HUMAN_PRODUCTION_APPROVAL','GRADUAL_PRODUCTION_CUTOVER','MONITORING_HOLD','CANDIDATE_RESTORATION_TEST','CONTINUOUS_REGRESSION'],
      gate:'GOVERNED_RELEASE_COMPLETE',
      acceptance:'Current production remains available until every release gate passes, rollback is proven, human production approval is bound, and monitoring remains clean.',
    },
  },
});

export function phaseSpec(phase){return RECOVERY_PROGRAM.phases[phase] || null;}
export function phaseOrder(){return [...PHASE_ORDER];}
export function phaseCanBeEarned(phase,{previousEarned=false,gatePassed=false,externalBlockers=[]}={}){
  const index=PHASE_ORDER.indexOf(phase);
  if(index<0)return {earned:false,reason:'UNKNOWN_PHASE'};
  if(index===0 && RECOVERY_PROGRAM.authority.ar02_dependency!=='EARNED')return {earned:false,reason:'AR02_NOT_EARNED'};
  if(index>0 && !previousEarned)return {earned:false,reason:'PREVIOUS_PHASE_NOT_EARNED'};
  if(externalBlockers.length)return {earned:false,reason:'EXTERNAL_BLOCKERS',blockers:[...externalBlockers]};
  if(!gatePassed)return {earned:false,reason:'PHASE_GATE_NOT_PASSED'};
  return {earned:true,reason:'GATE_PASSED'};
}
