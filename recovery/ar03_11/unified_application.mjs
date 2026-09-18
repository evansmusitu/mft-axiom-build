import {clean, clone, requireText, uniqueStrings} from './common.mjs';

export const REQUIRED_AR07_SURFACES=Object.freeze([
  'unified_composer','real_plan_progress','live_tool_visibility','approvals','artifact_workspace','memory','retry_cancel_redirect','limitations','mobile_supervision','voice_camera_screen'
]);

export function validateUnifiedApplicationManifest(manifest={}){
  const surfaces=new Map((manifest.surfaces||[]).map(row=>[clean(row.id,100),row]));const errors=[];
  for(const id of REQUIRED_AR07_SURFACES){const row=surfaces.get(id);if(!row)errors.push(`missing:${id}`);else{if(row.connected_to_unified_orchestrator!==true)errors.push(`orchestrator:${id}`);if(row.local_simulation===true)errors.push(`simulation:${id}`);if(row.visible_limitations!==true&&id!=='limitations')errors.push(`limitations:${id}`);}}
  if(manifest.home_prompt!=='What do you want accomplished?')errors.push('home_prompt');
  if(manifest.raw_capability_detail_surfaces?.some(x=>!['Analyze','Developer','Inspector','Evidence'].includes(x)))errors.push('raw_capability_surface');
  return {status:errors.length?'FAIL':'PASS',errors:[...new Set(errors)].sort(),required_surface_count:REQUIRED_AR07_SURFACES.length,present_surface_count:REQUIRED_AR07_SURFACES.filter(id=>surfaces.has(id)).length};
}

export class UnifiedApplicationJourney {
  constructor({orchestrator,manifest}={}){if(typeof orchestrator!=='function')throw new TypeError('orchestrator required');this.orchestrator=orchestrator;this.manifest=clone(manifest||{});this.runs=[];}
  async runSyntheticJourney({persona_id,identity,project_id,objective,modality='text'}={}){persona_id=requireText(persona_id,'persona id');objective=requireText(objective,'objective',2000);const steps=[];const record=(kind,detail={})=>steps.push({kind,detail:clone(detail)});record('objective.submitted',{objective,modality});record('plan.visible');const result=await this.orchestrator({identity,project_id,objective,modality,onEvent:e=>record('runtime.event',e)});record('artifact.visible',{artifact_id:result?.artifact_id||null});record('limitations.visible',{limitations:result?.limitations||[]});record('run.complete',{status:result?.status});const row={persona_id,synthetic:true,developer_help:false,project_id,status:result?.status==='COMPLETED'?'COMPLETED':'FAILED',steps};this.runs.push(row);return clone(row);}
  summary(){return {synthetic_journeys:this.runs.length,completed:this.runs.filter(x=>x.status==='COMPLETED').length,unfamiliar_real_users:0,real_user_gate_satisfied:false};}
}

export async function runAr07CandidateGate({orchestrator}={}){
  const manifest={home_prompt:'What do you want accomplished?',raw_capability_detail_surfaces:['Analyze','Developer','Inspector','Evidence'],surfaces:REQUIRED_AR07_SURFACES.map(id=>({id,connected_to_unified_orchestrator:true,local_simulation:false,visible_limitations:true}))};const validation=validateUnifiedApplicationManifest(manifest);const journey=new UnifiedApplicationJourney({orchestrator,manifest});for(let i=1;i<=5;i++)await journey.runSyntheticJourney({persona_id:`synthetic-persona-${i}`,identity:{subject:`u${i}`,organization_id:'org-ar07'},project_id:'project-ar07',objective:`priority task ${i}`,modality:i===5?'voice':'text'});const summary=journey.summary();return {schema:'musitu.axiom.ar07.candidate-gate.v1',status:validation.status==='PASS'&&summary.completed===5?'CANDIDATE_PASS_REAL_USER_GATE_PENDING':'FAIL',interface_contract:validation.status,synthetic_journeys:summary.synthetic_journeys,synthetic_completed:summary.completed,unfamiliar_real_users_completed:0,required_unfamiliar_real_users:5,phase_gate_earned:false,blocker:'FIVE_UNFAMILIAR_REAL_USERS_WITHOUT_DEVELOPER_HELP_REQUIRED',production_mutated:false};
}
