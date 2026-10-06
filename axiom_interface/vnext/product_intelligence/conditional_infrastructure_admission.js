import {clean,rejectSecretLike,sha256} from '../execution_security.js';

const component=(name,target_seam,trigger_keys)=>Object.freeze({component:name,target_seam,trigger_keys:Object.freeze(trigger_keys),semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',mandatory:false,provider_selected:false});
export const CONDITIONAL_INFRASTRUCTURE_COMPONENTS=Object.freeze({
  spire:component('spire','WorkloadIdentityProvider',['distributed_workload_identity_required','existing_axiom_identity_insufficient','cryptographic_workload_attestation_required']),
  nats_jetstream:component('nats_jetstream','EventBusBackend',['durable_pubsub_required','multi_consumer_fanout_required','temporal_workflow_semantics_insufficient']),
  valkey:component('valkey','TRANSIENT_COORDINATION_MECHANISM',['shared_ephemeral_state_required','durable_database_semantics_inappropriate','bounded_low_latency_coordination_required']),
  clickhouse:component('clickhouse','AnalyticsWarehouseBackend',['columnar_analytics_required','postgres_otel_analytics_insufficient','high_volume_scan_or_retention_required']),
  object_storage:component('object_storage','ObjectStoreBackend',['large_binary_or_immutable_blob_store_required','postgres_storage_inappropriate','artifact_or_evidence_blob_volume_requires_object_store']),
});
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}$/;
const HASH=/^[a-f0-9]{64}$/i;
const REQUEST_KEYS=new Set(['projectId','workId','requestId','evidence']);
const EVIDENCE_KEYS=new Set(['component','projectId','workId','evidenceId','evidenceArtifactSha256','verificationArtifactSha256','builderId','verifierId','verificationStatus','triggers']);
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function id(name,value){const v=clean(value,300);if(!ID.test(v))throw new TypeError(name+' invalid');return v;}
function digest(name,value){const v=clean(value,64).toLowerCase();if(!HASH.test(v))throw new TypeError(name+' required');return v;}
function rejectUnknown(value,allowed,label){if(!isPlainObject(value))throw new TypeError(label+' must be a plain object');const extra=Object.keys(value).filter(k=>!allowed.has(k));if(extra.length)throw new DOMException(label+' contains unsupported fields: '+extra.join(','),'SecurityError');}
function normalizeEvidence(raw,index,expectedProjectId,expectedWorkId){
  rejectUnknown(raw,EVIDENCE_KEYS,`evidence[${index}]`);rejectSecretLike(raw,`evidence[${index}]`);
  const componentName=clean(raw.component,80).toLowerCase(),contract=CONDITIONAL_INFRASTRUCTURE_COMPONENTS[componentName];
  const project_id=id(`evidence[${index}].projectId`,raw.projectId),work_id=id(`evidence[${index}].workId`,raw.workId);
  if(project_id!==expectedProjectId||work_id!==expectedWorkId)throw new DOMException('conditional infrastructure evidence identity mismatch','SecurityError');
  if(!contract)throw new TypeError(`evidence[${index}].component invalid`);
  const evidence_id=id(`evidence[${index}].evidenceId`,raw.evidenceId),evidence_artifact_sha256=digest('evidenceArtifactSha256',raw.evidenceArtifactSha256),verification_artifact_sha256=digest('verificationArtifactSha256',raw.verificationArtifactSha256);
  if(evidence_artifact_sha256===verification_artifact_sha256)throw new DOMException('verification artifact must be distinct from trigger evidence artifact','SecurityError');
  const builder_id=id(`evidence[${index}].builderId`,raw.builderId),verifier_id=id(`evidence[${index}].verifierId`,raw.verifierId);
  if(builder_id===verifier_id)throw new DOMException('builder cannot independently verify conditional infrastructure trigger','SecurityError');
  const verification_status=clean(raw.verificationStatus,20).toUpperCase();if(!['PASS','FAIL','NOT_PROVEN'].includes(verification_status))throw new TypeError('verificationStatus invalid');
  if(!isPlainObject(raw.triggers))throw new TypeError('triggers must be a plain object');
  const expected=new Set(contract.trigger_keys),actual=Object.keys(raw.triggers),extra=actual.filter(k=>!expected.has(k)),missing=contract.trigger_keys.filter(k=>!(k in raw.triggers));
  if(extra.length||missing.length)throw new DOMException(`trigger schema mismatch for ${componentName}`,'SecurityError');
  for(const key of contract.trigger_keys)if(typeof raw.triggers[key]!=='boolean')throw new TypeError(`trigger ${key} must be boolean`);
  const all_satisfied=verification_status==='PASS'&&contract.trigger_keys.every(key=>raw.triggers[key]===true);
  return Object.freeze({component:componentName,evidence_id,evidence_artifact_sha256,verification_artifact_sha256,builder_id,verifier_id,verification_status,triggers:Object.freeze({...raw.triggers}),all_satisfied});
}

export async function evaluateConditionalInfrastructure(request={}){
  rejectUnknown(request,REQUEST_KEYS,'request');
  const {projectId,workId,requestId,evidence=[]}=request;
  const project_id=id('projectId',projectId),work_id=id('workId',workId),request_id=id('requestId',requestId);
  if(!Array.isArray(evidence))throw new TypeError('evidence must be an array');
  const byComponent=new Map();
  for(const [index,raw] of evidence.entries()){
    const row=normalizeEvidence(raw,index,project_id,work_id);if(byComponent.has(row.component))throw new DOMException('duplicate component trigger evidence: '+row.component,'ConstraintError');byComponent.set(row.component,row);
  }
  const triggered=[],rejected=[],notTriggered=[];
  const components=Object.keys(CONDITIONAL_INFRASTRUCTURE_COMPONENTS).sort().map(name=>{
    const contract=CONDITIONAL_INFRASTRUCTURE_COMPONENTS[name],ev=byComponent.get(name),triggeredNow=ev?.all_satisfied===true,rejectedNow=ev?.verification_status==='FAIL',notTriggeredNow=ev?.verification_status==='PASS'&&!triggeredNow;if(triggeredNow)triggered.push(name);if(rejectedNow)rejected.push(name);if(notTriggeredNow)notTriggered.push(name);
    const activation_state=triggeredNow?'TRIGGERED_CANDIDATE':rejectedNow?'REJECTED':notTriggeredNow?'NOT_TRIGGERED':'NOT_PROVEN';
    return Object.freeze({component:name,target_seam:contract.target_seam,activation_state,implementation_required_now:triggeredNow,provider_selected:false,evidence_id:ev?.evidence_id??null,evidence_artifact_sha256:ev?.evidence_artifact_sha256??null,verification_artifact_sha256:ev?.verification_artifact_sha256??null,verification_status:ev?.verification_status??'NOT_PROVEN',authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false});
  });
  const admitted=triggered.length>0;
  const body={schema:'musitu.axiom.conditional-infrastructure-admission.v1',project_id,work_id,request_id,components:Object.freeze(components),triggered_components:Object.freeze(triggered.sort()),rejected_components:Object.freeze(rejected.sort()),not_triggered_components:Object.freeze(notTriggered.sort()),conditional_implementation_admitted:admitted,activation_authorized:false,required_next_gate:admitted?'IMPLEMENT_TRIGGERED_COMPONENTS_IN_ISOLATION':'TRIGGER_EVIDENCE_REQUIRED_OR_CONTINUE_WITHOUT_CONDITIONAL_COMPONENTS',authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false};
  return Object.freeze({...body,admission_sha256:await sha256(body)});
}
