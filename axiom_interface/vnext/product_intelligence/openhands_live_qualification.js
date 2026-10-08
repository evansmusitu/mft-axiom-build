const EXPECTED_CONFIRMATION='AUTHORIZE PHASE-2 ISOLATED OPENHANDS ADMISSION AND S3 LIVE QUALIFICATION ON A FRESH NON-PROTECTED BRANCH. NO MAIN, PR #1, PRODUCTION, OR FROZEN OPENAI MUTATION.';
const EXPECTED_REPOSITORY='evansmusitu/mft-axiom-build';
const EXPECTED_BRANCH='frontier/axiom-phase2-openhands-live-qualification-20261008';
const EXPECTED_SOURCE_SHA='2a96a59e3337f4801328750b45ab2ebad7fdcd0e';
const HASH=/^[a-f0-9]{64}$/i;
const TRIGGERS=[
  'external_engineering_worker_required',
  'native_axiom_engineering_worker_insufficient',
  'external_code_execution_adapter_permitted',
];

function plain(value,label){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(label+' required');
  return value;
}
function text(value,label,max=300){
  const out=String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
  if(!out)throw new TypeError(label+' required');
  return out;
}
function digest(value,label){
  const out=text(value,label,64).toLowerCase();
  if(!HASH.test(out))throw new TypeError(label+' must be sha256');
  return out;
}
function assertExactKeys(value,allowed,label){
  for(const key of Object.keys(value))if(!allowed.has(key))throw new DOMException(label+' contains unsupported field: '+key,'SecurityError');
}
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
async function sha256(value){
  const bytes=new TextEncoder().encode(JSON.stringify(canonical(value)));
  const digestBytes=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digestBytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

export async function evaluateOpenHandsLiveQualification(request={}){
  plain(request,'OpenHands qualification request');
  assertExactKeys(request,new Set([
    'schema','project_id','work_id','provider','target_seam','risk_class','reversible','repository','branch',
    'source_phase2_sha','authorization','need_evidence','runtime_probe',
  ]),'OpenHands qualification request');

  if(request.schema!=='musitu.axiom.openhands-live-qualification-request.v1')throw new TypeError('OpenHands qualification schema invalid');
  const project_id=text(request.project_id,'project_id');
  const work_id=text(request.work_id,'work_id');
  if(text(request.provider,'provider',80)!=='OpenHands')throw new DOMException('OpenHands is the only authorized provider for this qualification','SecurityError');
  if(text(request.target_seam,'target_seam',80)!=='EngineeringWorkerBackend')throw new DOMException('OpenHands target seam invalid','SecurityError');
  if(text(request.risk_class,'risk_class',8)!=='S3')throw new DOMException('OpenHands live qualification is restricted to S3','SecurityError');
  if(request.reversible!==true)throw new DOMException('OpenHands S3 qualification must be reversible','SecurityError');
  if(text(request.repository,'repository')!==EXPECTED_REPOSITORY)throw new DOMException('OpenHands repository scope invalid','SecurityError');
  if(text(request.branch,'branch')!==EXPECTED_BRANCH)throw new DOMException('OpenHands qualification branch is not the authorized isolated branch','SecurityError');
  if(text(request.source_phase2_sha,'source_phase2_sha',64)!==EXPECTED_SOURCE_SHA)throw new DOMException('OpenHands source Phase-2 authority drifted','SecurityError');

  const authorization=plain(request.authorization,'OpenHands authorization');
  assertExactKeys(authorization,new Set([
    'confirmation','authority','main_mutation_allowed','pr1_mutation_allowed','production_mutation_allowed','frozen_openai_mutation_allowed',
  ]),'OpenHands authorization');
  if(text(authorization.confirmation,'authorization confirmation',500)!==EXPECTED_CONFIRMATION)throw new DOMException('OpenHands user authority confirmation mismatch','SecurityError');
  if(text(authorization.authority,'authorization authority',100)!=='USER_FINAL_PRODUCT_APPROVAL_AUTHORITY')throw new DOMException('OpenHands authority source invalid','SecurityError');
  if(authorization.main_mutation_allowed!==false)throw new DOMException('OpenHands main mutation is not authorized','SecurityError');
  if(authorization.pr1_mutation_allowed!==false)throw new DOMException('OpenHands PR #1 mutation is not authorized','SecurityError');
  if(authorization.production_mutation_allowed!==false)throw new DOMException('OpenHands production mutation is not authorized','SecurityError');
  if(authorization.frozen_openai_mutation_allowed!==false)throw new DOMException('OpenHands frozen OpenAI mutation is not authorized','SecurityError');

  const need=plain(request.need_evidence,'OpenHands verified need evidence');
  assertExactKeys(need,new Set([
    'verification_status','need_evidence_sha256','verification_artifact_sha256','builder_id','verifier_id','triggers',
  ]),'OpenHands verified need evidence');
  if(text(need.verification_status,'verified need status',20)!=='PASS')throw new DOMException('OpenHands verified need evidence must PASS','SecurityError');
  const need_evidence_sha256=digest(need.need_evidence_sha256,'need_evidence_sha256');
  const verification_artifact_sha256=digest(need.verification_artifact_sha256,'verification_artifact_sha256');
  if(need_evidence_sha256===verification_artifact_sha256)throw new DOMException('OpenHands verified need and verification artifact must be distinct','SecurityError');
  const builder_id=text(need.builder_id,'builder_id');
  const verifier_id=text(need.verifier_id,'verifier_id');
  if(builder_id===verifier_id)throw new DOMException('OpenHands builder and verifier must be distinct','SecurityError');
  const triggers=plain(need.triggers,'OpenHands verified need triggers');
  assertExactKeys(triggers,new Set(TRIGGERS),'OpenHands verified need triggers');
  for(const key of TRIGGERS)if(triggers[key]!==true)throw new DOMException('OpenHands verified need trigger not satisfied: '+key,'SecurityError');

  const runtime=plain(request.runtime_probe,'OpenHands runtime probe');
  assertExactKeys(runtime,new Set(['credential_reference','credential_available','api_probe_status']),'OpenHands runtime probe');
  if(text(runtime.credential_reference,'credential_reference',100)!=='OPENHANDS_API_KEY')throw new DOMException('OpenHands runtime credential reference invalid','SecurityError');
  if(typeof runtime.credential_available!=='boolean')throw new TypeError('OpenHands credential_available must be boolean');
  const api_probe_status=text(runtime.api_probe_status,'api_probe_status',40);
  if(!['NOT_RUN','PASS','FAIL'].includes(api_probe_status))throw new TypeError('OpenHands api_probe_status invalid');

  let runtime_activation_authorized=false;
  let runtime_activation_state='BLOCKED_CREDENTIAL_UNAVAILABLE';
  if(runtime.credential_available===true){
    if(api_probe_status==='PASS'){
      runtime_activation_authorized=true;
      runtime_activation_state='AUTHORIZED_ISOLATED_QUALIFICATION_ONLY';
    }else{
      runtime_activation_state='BLOCKED_API_PROBE_NOT_PASS';
    }
  }

  const payload={
    schema:'musitu.axiom.openhands-live-qualification-admission.v1',
    project_id,work_id,
    provider:'OpenHands',
    target_seam:'EngineeringWorkerBackend',
    provider_selected:true,
    admission_state:'CANDIDATE_ADMITTED',
    risk_class:'S3',
    reversible:true,
    repository:EXPECTED_REPOSITORY,
    branch:EXPECTED_BRANCH,
    source_phase2_sha:EXPECTED_SOURCE_SHA,
    need_evidence_sha256,
    verification_artifact_sha256,
    runtime_credential_reference:'OPENHANDS_API_KEY',
    runtime_credential_available:runtime.credential_available,
    runtime_api_probe_status:api_probe_status,
    runtime_activation_authorized,
    runtime_activation_state,
    authority_effect:runtime_activation_authorized?'RUNTIME_QUALIFICATION_ONLY':'ADMISSION_ONLY',
    external_action_executed:false,
    live_runtime_qualification:'NOT_PROVEN',
    release_authority:false,
    production_authority:false,
    certification_authority:false,
    main_mutation_allowed:false,
    pr1_mutation_allowed:false,
    production_mutation_allowed:false,
    frozen_openai_mutation_allowed:false,
  };
  return Object.freeze({...payload,admission_sha256:await sha256(payload)});
}
