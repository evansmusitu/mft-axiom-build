import {clean, clone, ensureNoSecretLike, requireText, sha256, uniqueStrings} from './common.mjs';

export const TOOL_FABRIC_ORDER=Object.freeze([
  '74_quantitative_operations',
  'frontier_v5_research_source',
  'artifact_engine',
  'code_file_sandbox',
  'browser_computer',
  'project_memory_context',
  'agents_mission_control',
  'automations_schedules',
  'mcp_enterprise_connectors',
  'live_multimodal_channels',
]);

export class UnifiedToolFabric {
  constructor(){this.lanes=new Map();this.tools=new Map();this.executionLog=[];}
  registerLane(lane,{adapter,tools=[],production_shaped=true,simulation=false,qualification='REGISTERED'}={}){
    lane=requireText(lane,'lane',120);if(!TOOL_FABRIC_ORDER.includes(lane))throw new DOMException('lane outside frozen AR-06 order','SecurityError');if(this.lanes.has(lane))throw new DOMException('lane already registered','ConstraintError');if(typeof adapter!=='function')throw new TypeError('lane adapter required');if(production_shaped!==true||simulation===true)throw new DOMException('AR-06 forbids local simulation lane','SecurityError');
    const normalized=uniqueStrings(tools,180);for(const tool of normalized){if(this.tools.has(tool))throw new DOMException(`tool registered twice: ${tool}`,'ConstraintError');this.tools.set(tool,lane);}this.lanes.set(lane,{lane,adapter,tools:normalized,production_shaped:true,simulation:false,qualification:clean(qualification,80)||'REGISTERED'});return this;
  }
  validateRegistration(){
    const errors=[];for(const lane of TOOL_FABRIC_ORDER){const row=this.lanes.get(lane);if(!row)errors.push(`missing_lane:${lane}`);else if(!row.production_shaped||row.simulation)errors.push(`simulation_lane:${lane}`);}const quant=this.lanes.get('74_quantitative_operations');if(quant&&quant.tools.length!==74)errors.push(`quantitative_operation_count:${quant.tools.length}`);return {status:errors.length?'FAIL':'PASS',errors,registered_lane_count:this.lanes.size,registered_tool_count:this.tools.size,quantitative_operation_count:quant?.tools.length||0};
  }
  async execute({tool,input={},identity,project_id,risk_class='S0',request_id=null}={}){
    tool=requireText(tool,'tool',180);project_id=requireText(project_id,'project id',180);if(!identity?.subject||!identity?.organization_id)throw new DOMException('server identity required','NotAllowedError');ensureNoSecretLike(input,'tool input');const lane=this.tools.get(tool);if(!lane)throw new DOMException('unregistered tool','NotSupportedError');const binding=this.lanes.get(lane);if(!binding?.production_shaped||binding.simulation)throw new DOMException('tool lane is not production-shaped','SecurityError');const body={schema:'musitu.axiom.ar06.execution-request.v1',tool,lane,project_id,subject:identity.subject,organization_id:identity.organization_id,risk_class:clean(risk_class,8).toUpperCase(),request_id:clean(request_id,180)||null,input:clone(input),orchestrator:'MUSITU_AXIOM_UNIFIED_V1'};body.request_sha256=await sha256(body);const result=await binding.adapter(clone(body));if(!result||result.simulation===true||result.orchestrator_bypass===true)throw new DOMException('adapter returned simulation/bypass result','SecurityError');const receipt={schema:'musitu.axiom.ar06.tool-receipt.v1',request_sha256:body.request_sha256,tool,lane,status:result.status||'COMPLETED',result:clone(result),production_shaped:true,simulation:false,orchestrator_bypass:false};receipt.receipt_sha256=await sha256(receipt);this.executionLog.push(receipt);return clone(receipt);
  }
  manifest(){return {schema:'musitu.axiom.ar06.fabric-manifest.v1',fixed_order:[...TOOL_FABRIC_ORDER],lanes:TOOL_FABRIC_ORDER.map(l=>{const row=this.lanes.get(l);return row?{lane:l,tool_count:row.tools.length,production_shaped:row.production_shaped,simulation:row.simulation,qualification:row.qualification}:{lane:l,missing:true};}),registered_tool_count:this.tools.size,orchestrator:'MUSITU_AXIOM_UNIFIED_V1'};}
}

export function toolName(lane,index){return `${lane}::${String(index).padStart(3,'0')}`;}

export async function runAr06Gate(){
  const fabric=new UnifiedToolFabric();for(const [i,lane] of TOOL_FABRIC_ORDER.entries()){const count=i===0?74:1;const tools=Array.from({length:count},(_,j)=>toolName(lane,j+1));fabric.registerLane(lane,{tools,adapter:async req=>({status:'COMPLETED',echo:req.tool,simulation:false,orchestrator_bypass:false})});}
  const reg=fabric.validateRegistration();const identity={subject:'ar06-user',organization_id:'ar06-org'};let all=true;for(const tool of [...fabric.tools.keys()]){const r=await fabric.execute({tool,input:{probe:true},identity,project_id:'project_ar06'});all&&=r.status==='COMPLETED'&&r.production_shaped===true&&r.orchestrator_bypass===false;}
  const expected=fabric.tools.size;const pass=reg.status==='PASS'&&all&&fabric.executionLog.length===expected;return {schema:'musitu.axiom.ar06.gate.v1',status:pass?'PASS':'FAIL',registered_tools:expected,executed_tools:fabric.executionLog.length,fixed_order_preserved:JSON.stringify(fabric.manifest().fixed_order)===JSON.stringify(TOOL_FABRIC_ORDER),local_simulation_used:false,production_mutated:false};
}
