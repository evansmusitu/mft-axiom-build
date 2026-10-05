import {assertAdapterDescriptor} from '../infrastructure_contracts.js';

export const OPENTOFU_DEPLOYMENT_DESCRIPTOR=Object.freeze({
  kind:'DeploymentBackend',adapter_version:'1.0.0',provider:'opentofu',provider_baseline:'1.13.1',
  semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',
  capabilities:Object.freeze(['validate-config','plan','show-plan-json','export-plan-evidence','health']),
  unsupported_operations:Object.freeze(['apply','destroy','import','state-push','state-rm','workspace-delete','production-promotion','grant-release-authority','self-certify']),
  timeout_ms:120000,retry:Object.freeze({max_attempts:1,backoff:'CALLER_GOVERNED'}),
  idempotency:Object.freeze({mode:'PROJECT_WORK_CONFIG_LOCK_REQUEST_DIGEST'}),
  data_classification:Object.freeze(['project-private','infrastructure-plan']),
  egress:Object.freeze({required:false,allowed_origins:Object.freeze([])}),
  identity_binding:Object.freeze({required:true,mode:'AXIOM_WORKLOAD_ID'}),
  evidence_envelope:Object.freeze({schema:'musitu.axiom.evidence.v1',required:true}),
  health:Object.freeze({mode:'EXPLICIT'}),
  migration_export:Object.freeze({supported:true,format:'PLAN_JSON_DIGESTS_AND_NORMALIZED_CHANGESET'}),
  fail_closed:true,apply_authority:false,external_execution_authority:false,release_authority:false,production_authority:false,certification_authority:false,
  live_runtime_qualification:'NOT_PROVEN',
});
assertAdapterDescriptor(OPENTOFU_DEPLOYMENT_DESCRIPTOR,{expectedKind:'DeploymentBackend'});

const HASH=/^[a-f0-9]{64}$/i;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,299}$/;
const ACTIONS=new Set(['no-op','create','read','update','delete']);
const FORBIDDEN_KEY=/^(?:access|refresh|id)?_?token$|authorization|api_?key|password|private_?key|client_?secret|secret$/i;
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const clean=(value,max=2000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
function id(name,value){const v=clean(value,300);if(!ID.test(v))throw new TypeError(name+' invalid');return v;}
function digest(name,value){const v=clean(value,64).toLowerCase();if(!HASH.test(v))throw new TypeError(name+' required');return v;}
function rejectCredentials(value,path='context'){
  if(!value||typeof value!=='object') return;
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_KEY.test(key)) throw new DOMException(path+'.'+key+' contains forbidden credential material','SecurityError');
    rejectCredentials(child,path+'.'+key);
  }
}
const FORBIDDEN_PLAN_PAYLOAD_FIELDS=new Set(['plan_json','planned_values','prior_state','configuration','variables','values','sensitive_values','raw_plan','state']);
function rejectAuthorityClaims(raw){
  if(!raw||typeof raw!=='object') return;
  for(const key of ['apply_executed','state_mutated','release_authority','production_authority','allow_deploy','certified']){
    if(raw[key]===true){
      const label=key==='apply_executed'||key==='state_mutated'?'forbidden execution':'forbidden authority';
      throw new DOMException('OpenTofu attempted '+label+': '+key,'SecurityError');
    }
  }
}
function normalizeDiagnostics(value){
  if(value===undefined) return Object.freeze([]);
  if(!Array.isArray(value)) throw new TypeError('diagnostics must be an array');
  return Object.freeze(value.map((item,index)=>{
    if(typeof item==='string') return clean(item,2000);
    if(!isPlainObject(item)) throw new TypeError('diagnostics['+index+'] invalid');
    return Object.freeze({severity:clean(item.severity||'INFO',20).toUpperCase(),summary:clean(item.summary||item.message,1000),detail:clean(item.detail,4000)});
  }));
}
function normalizeChanges(value){
  if(!Array.isArray(value)) throw new TypeError('resource_changes must be an array');
  const addresses=new Set(),summary={create:0,update:0,delete:0,replace:0,total:0};
  const changes=value.map((row,index)=>{
    if(!isPlainObject(row)) throw new TypeError('resource_changes['+index+'] must be a plain object');
    const extra=Object.keys(row).filter(key=>!['address','actions'].includes(key));if(extra.length)throw new DOMException('resource_changes['+index+'] contains forbidden raw plan fields: '+extra.join(','),'SecurityError');
    const address=clean(row.address,1000);if(!address||addresses.has(address)) throw new TypeError('resource_changes['+index+'] address invalid or duplicate');addresses.add(address);
    if(!Array.isArray(row.actions)||!row.actions.length||row.actions.some(action=>!ACTIONS.has(clean(action,20)))) throw new TypeError('resource_changes['+index+'] actions invalid');
    const actions=row.actions.map(action=>clean(action,20));
    const unique=[...new Set(actions)];
    if(unique.length!==actions.length) throw new TypeError('resource_changes['+index+'] actions invalid');
    let category='no-op';
    if(actions.includes('delete')&&actions.includes('create')) category='replace';
    else if(actions.includes('create')) category='create';
    else if(actions.includes('update')) category='update';
    else if(actions.includes('delete')) category='delete';
    else if(actions.some(action=>!['no-op','read'].includes(action))) throw new TypeError('resource_changes['+index+'] actions invalid');
    if(category!=='no-op') summary[category]++;
    summary.total++;
    return Object.freeze({address,actions:Object.freeze(actions),category});
  }).sort((a,b)=>a.address.localeCompare(b.address));
  return {changes:Object.freeze(changes),addresses:Object.freeze(changes.map(change=>change.address)),summary:Object.freeze(summary)};
}
function assertClient(client){if(!client||typeof client.plan!=='function'||typeof client.health!=='function')throw new TypeError('OpenTofu client plan and health required');}

export function createOpenTofuDeploymentBackend({client}={}){
  assertClient(client);
  return Object.freeze({
    descriptor:OPENTOFU_DEPLOYMENT_DESCRIPTOR,
    async plan({projectId,workId,workloadIdentityId,requestId,configurationRef,configurationDigestSha256,providerLockDigestSha256,context={}}={}){
      const project_id=id('projectId',projectId),work_id=id('workId',workId),workload_identity_id=id('workloadIdentityId',workloadIdentityId),request_id=id('requestId',requestId);
      const configuration_ref=clean(configurationRef,2000);if(!configuration_ref)throw new TypeError('configurationRef required');
      const expected_configuration_digest_sha256=digest('configurationDigestSha256',configurationDigestSha256);
      const expected_provider_lock_digest_sha256=digest('providerLockDigestSha256',providerLockDigestSha256);
      if(!isPlainObject(context))throw new TypeError('context must be a plain object');rejectCredentials(context,'context');
      const raw=await client.plan({project_id,work_id,workload_identity_id,request_id,configuration_ref,expected_configuration_digest_sha256,expected_provider_lock_digest_sha256,mode:'PLAN_ONLY',refresh:false,lock_state:false,input:false,context:structuredClone(context)});
      if(!isPlainObject(raw))throw new TypeError('OpenTofu plan result required');
      rejectAuthorityClaims(raw);
      for(const key of FORBIDDEN_PLAN_PAYLOAD_FIELDS) if(key in raw) throw new DOMException('OpenTofu result contains forbidden raw plan payload: '+key,'SecurityError');
      if(clean(raw.tool_version,40)!==OPENTOFU_DEPLOYMENT_DESCRIPTOR.provider_baseline)throw new TypeError('OpenTofu version mismatch');
      if(clean(raw.project_id,300)!==project_id||clean(raw.work_id,300)!==work_id||clean(raw.workload_identity_id,300)!==workload_identity_id||clean(raw.request_id,300)!==request_id)throw new DOMException('OpenTofu plan identity mismatch','DataError');
      const configuration_digest_sha256=digest('provider configuration_digest_sha256',raw.configuration_digest_sha256);
      const provider_lock_digest_sha256=digest('provider provider_lock_digest_sha256',raw.provider_lock_digest_sha256);
      if(configuration_digest_sha256!==expected_configuration_digest_sha256)throw new DOMException('OpenTofu configuration digest mismatch','DataError');
      if(provider_lock_digest_sha256!==expected_provider_lock_digest_sha256)throw new DOMException('OpenTofu provider lock digest mismatch','DataError');
      const planfile_sha256=digest('planfile_sha256',raw.planfile_sha256),plan_json_sha256=digest('plan_json_sha256',raw.plan_json_sha256);
      const plannedMs=Date.parse(raw.planned_at??'');if(!Number.isFinite(plannedMs))throw new TypeError('planned_at must be an ISO instant');
      const normalized=normalizeChanges(raw.resource_changes),diagnostics=normalizeDiagnostics(raw.diagnostics);
      return Object.freeze({
        schema:'musitu.axiom.opentofu-plan.v1',project_id,work_id,workload_identity_id,request_id,configuration_ref,
        configuration_digest_sha256,provider_lock_digest_sha256,planfile_sha256,plan_json_sha256,planned_at:new Date(plannedMs).toISOString(),
        tool:'OPENTOFU',tool_version:OPENTOFU_DEPLOYMENT_DESCRIPTOR.provider_baseline,resource_changes:normalized.changes,
        resource_change_addresses:normalized.addresses,change_summary:normalized.summary,diagnostics,
        plan_state:'PLANNED',admission_state:'NOT_EVALUATED',apply_allowed:false,external_action_executed:false,state_mutated:false,
        canonical_evidence:false,authority_effect:'NONE',external_execution_authority:false,release_authority:false,production_authority:false,certification_authority:false,
        required_next_gate:'CHANGE_ADMISSION',live_runtime_qualification:'NOT_PROVEN',
      });
    },
    async health(){
      const raw=await client.health();
      rejectAuthorityClaims(raw);
      const version=clean(raw?.version,40);if(version&&version!==OPENTOFU_DEPLOYMENT_DESCRIPTOR.provider_baseline)throw new TypeError('OpenTofu health version mismatch');
      return Object.freeze({provider_status:clean(raw?.status??'UNKNOWN',40),tool:'OPENTOFU',tool_version:OPENTOFU_DEPLOYMENT_DESCRIPTOR.provider_baseline,axiom_authority:'NONE',axiom_certification:'NOT_PROVEN',live_runtime_qualification:'NOT_PROVEN'});
    },
  });
}
