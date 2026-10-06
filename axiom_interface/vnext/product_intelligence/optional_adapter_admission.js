const entry=(provider,target_seam,trigger_keys)=>Object.freeze({provider,target_seam,trigger_keys:Object.freeze(trigger_keys),semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',mandatory:false,provider_selected:false,runtime_activation_authorized:false,release_authority:false,production_authority:false,certification_authority:false});
export const OPTIONAL_ADAPTER_CATALOG=Object.freeze({
  e2b:entry('E2B','SandboxBackend',['remote_sandbox_required','governed_namespace_sandbox_insufficient','external_compute_adapter_permitted']),
  openhands:entry('OpenHands','EngineeringWorkerBackend',['external_engineering_worker_required','native_axiom_engineering_worker_insufficient','external_code_execution_adapter_permitted']),
  langfuse:entry('Langfuse','TelemetryBackend',['llm_specific_observability_required','opentelemetry_semantics_insufficient','external_observability_adapter_permitted']),
  growthbook:entry('GrowthBook','ExperimentEngineBackend',['product_experimentation_required','openfeature_evaluation_alone_insufficient','external_experiment_adapter_permitted']),
  penpot:entry('Penpot','DesignInteropBackend',['collaborative_vector_design_required','native_axiom_design_surface_insufficient','external_design_adapter_permitted']),
  grapesjs:entry('GrapesJS','DesignInteropBackend',['visual_web_composition_required','native_axiom_artifact_editor_insufficient','embedded_visual_builder_permitted']),
});
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}$/;
const clean=(v,max=300)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
function id(name,value){const v=clean(value);if(!ID.test(v))throw new TypeError(name+' invalid');return v;}
const HASH=/^[a-f0-9]{64}$/i;
const REQUEST_KEYS=new Set(['projectId','workId','requestId','evidence']);
const EVIDENCE_KEYS=new Set(['adapter','projectId','workId','evidenceId','needEvidenceSha256','verificationArtifactSha256','builderId','verifierId','verificationStatus','triggers']);
function digest(name,value){const v=clean(value,64).toLowerCase();if(!HASH.test(v))throw new TypeError(name+' required');return v;}
function rejectUnknownKeys(value,allowed,label){const extra=Object.keys(value).filter(k=>!allowed.has(k));if(extra.length)throw new DOMException(label+' contains unsupported fields: '+extra.join(','),'SecurityError');}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
async function sha256(value){const bytes=new TextEncoder().encode(JSON.stringify(canonical(value)));const d=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function evaluateOptionalAdapterAdmission(request={}){
  if(!request||typeof request!=='object'||Array.isArray(request))throw new TypeError('request must be an object');
  rejectUnknownKeys(request,REQUEST_KEYS,'request');
  const {projectId,workId,requestId,evidence=[]}=request;
  const project_id=id('projectId',projectId),work_id=id('workId',workId),request_id=id('requestId',requestId);
  if(!Array.isArray(evidence))throw new TypeError('evidence must be an array');
  const byAdapter=new Map();
  for(const ev of evidence){
    if(!ev||typeof ev!=='object'||Array.isArray(ev))throw new TypeError('evidence item must be an object');
    rejectUnknownKeys(ev,EVIDENCE_KEYS,'evidence');
    id('evidence.evidenceId',ev.evidenceId);
    if(!['PASS','FAIL'].includes(ev.verificationStatus))throw new TypeError('verificationStatus must be PASS or FAIL');
    const adapter=clean(ev.adapter,80);const spec=OPTIONAL_ADAPTER_CATALOG[adapter];if(!spec)throw new TypeError('optional adapter unknown');
    if(byAdapter.has(adapter))throw new TypeError('duplicate optional adapter evidence');
    if(id('evidence.projectId',ev.projectId)!==project_id||id('evidence.workId',ev.workId)!==work_id)throw new DOMException('optional adapter evidence identity mismatch','SecurityError');
    const builder_id=id('evidence.builderId',ev.builderId),verifier_id=id('evidence.verifierId',ev.verifierId);
    if(builder_id===verifier_id)throw new DOMException('optional adapter builder and verifier must be distinct','SecurityError');
    const need=digest('needEvidenceSha256',ev.needEvidenceSha256),verify=digest('verificationArtifactSha256',ev.verificationArtifactSha256);
    if(need===verify)throw new DOMException('optional adapter verification artifact must be distinct from need evidence','SecurityError');
    const triggerKeys=Object.keys(ev.triggers||{}).sort(),expected=[...spec.trigger_keys].sort();
    if(triggerKeys.length!==expected.length||triggerKeys.some((k,i)=>k!==expected[i])||triggerKeys.some(k=>typeof ev.triggers[k]!=='boolean'))throw new TypeError('optional adapter trigger schema mismatch');
    const allTrue=expected.every(k=>ev.triggers[k]===true);
    byAdapter.set(adapter,{status:ev.verificationStatus,allTrue,need,verify,builder_id,verifier_id});
  }
  const admitted=[],rejected=[],notTriggered=[];
  const adapters=Object.entries(OPTIONAL_ADAPTER_CATALOG).map(([adapter,row])=>{
    const ev=byAdapter.get(adapter);let state='NOT_PROVEN',required=false;
    if(ev?.status==='PASS'&&ev.allTrue){state='CANDIDATE_ADMITTED';required=true;admitted.push(adapter);}
    else if(ev?.status==='FAIL'){state='REJECTED';rejected.push(adapter);}
    else if(ev?.status==='PASS'){state='NOT_TRIGGERED';notTriggered.push(adapter);}
    return Object.freeze({adapter,provider:row.provider,target_seam:row.target_seam,trigger_keys:row.trigger_keys,semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',admission_state:state,implementation_required_now:required,provider_selected:false,runtime_activation_authorized:false,need_evidence_sha256:ev?.need??null,verification_artifact_sha256:ev?.verify??null,release_authority:false,production_authority:false,certification_authority:false});
  });
  const payload={schema:'musitu.axiom.optional-adapter-admission.v1',project_id,work_id,request_id,adapters:Object.freeze(adapters),admitted_candidates:Object.freeze(admitted),rejected_candidates:Object.freeze(rejected),not_triggered_candidates:Object.freeze(notTriggered),optional_adapter_implementation_admitted:admitted.length>0,runtime_activation_authorized:false,required_next_gate:admitted.length?'ISOLATED_OPTIONAL_ADAPTER_QUALIFICATION':'MUSITU_LAYERS_WITHOUT_OPTIONAL_ADAPTERS',release_authority:false,production_authority:false,certification_authority:false};
  return Object.freeze({...payload,admission_sha256:await sha256(payload)});
}
