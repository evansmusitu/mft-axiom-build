export const PHASE2_INFRASTRUCTURE_CONTRACT_VERSION='musitu.axiom.product-intelligence.infrastructure-contracts.v1';

export const REQUIRED_INFRASTRUCTURE_ADAPTERS=Object.freeze([
  'PersistenceBackend','VectorIndexBackend','DurableWorkBackend','TelemetryBackend','PolicyDecisionPoint',
  'SecretBroker','WorkloadIdentityProvider','SandboxBackend','ObjectStoreBackend','EventBusBackend',
  'AnalyticsWarehouseBackend','ExperimentEngineBackend','EngineeringWorkerBackend','DesignInteropBackend',
  'DeploymentBackend','RuntimeSecurityBackend','AccessibilityScannerBackend','RealityBrowserBackend',
]);

const REQUIRED_FIELDS=Object.freeze([
  'kind','adapter_version','provider','semantic_owner','authority','capabilities','unsupported_operations','timeout_ms',
  'retry','idempotency','data_classification','egress','identity_binding','evidence_envelope','health','migration_export','fail_closed',
]);
const FORBIDDEN_KEY=/^(?:access|refresh|id)?_?token$|authorization|api_?key|password|private_?key|client_?secret|secret$/i;
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);

function inspectCredentialMaterial(value,path='descriptor',errors=[]){
  if(!value||typeof value!=='object') return errors;
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_KEY.test(key)) errors.push(`${path}.${key} contains forbidden credential material`);
    inspectCredentialMaterial(child,`${path}.${key}`,errors);
  }
  return errors;
}

export function validateAdapterDescriptor(candidate,{expectedKind=null}={}){
  const errors=[];
  if(!isPlainObject(candidate)) return Object.freeze({ok:false,errors:Object.freeze(['descriptor must be a plain object']),kind:null});
  inspectCredentialMaterial(candidate,'descriptor',errors);
  for(const field of REQUIRED_FIELDS) if(!(field in candidate)) errors.push(`${field} is required`);

  if(!REQUIRED_INFRASTRUCTURE_ADAPTERS.includes(candidate.kind)) errors.push('kind must be a frozen Phase-2 infrastructure adapter');
  if(expectedKind&&candidate.kind!==expectedKind) errors.push(`expected ${expectedKind} but received ${candidate.kind??'unknown'}`);
  if(typeof candidate.adapter_version!=='string'||!candidate.adapter_version.trim()) errors.push('adapter_version must be a non-empty string');
  if(typeof candidate.provider!=='string'||!candidate.provider.trim()) errors.push('provider must be a non-empty string');
  if(candidate.semantic_owner!=='AXIOM') errors.push('semantic_owner must equal AXIOM');
  if(candidate.authority!=='MECHANISM_ONLY') errors.push('authority must equal MECHANISM_ONLY');
  if(!Array.isArray(candidate.capabilities)) errors.push('capabilities must be an array');
  if(!Array.isArray(candidate.unsupported_operations)) errors.push('unsupported_operations must be an array');
  if(!Number.isInteger(candidate.timeout_ms)||candidate.timeout_ms<1) errors.push('timeout_ms must be a positive integer');
  if(!isPlainObject(candidate.retry)) errors.push('retry must be a plain object');
  if(!isPlainObject(candidate.idempotency)) errors.push('idempotency must be a plain object');
  if(!Array.isArray(candidate.data_classification)) errors.push('data_classification must be an array');
  if(!isPlainObject(candidate.egress)||typeof candidate.egress.required!=='boolean'||!Array.isArray(candidate.egress.allowed_origins)) errors.push('egress must declare required and allowed_origins');
  if(!isPlainObject(candidate.identity_binding)||typeof candidate.identity_binding.required!=='boolean'||typeof candidate.identity_binding.mode!=='string') errors.push('identity_binding must declare required and mode');
  if(!isPlainObject(candidate.evidence_envelope)||candidate.evidence_envelope.required!==true||typeof candidate.evidence_envelope.schema!=='string') errors.push('evidence_envelope must be required and schema-bound');
  if(!isPlainObject(candidate.health)||typeof candidate.health.mode!=='string') errors.push('health must declare mode');
  if(!isPlainObject(candidate.migration_export)||typeof candidate.migration_export.supported!=='boolean') errors.push('migration_export must declare supported');
  if(candidate.fail_closed!==true) errors.push('fail_closed must be true');

  return Object.freeze({ok:errors.length===0,errors:Object.freeze([...new Set(errors)]),kind:typeof candidate.kind==='string'?candidate.kind:null});
}

export function assertAdapterDescriptor(candidate,options={}){
  const result=validateAdapterDescriptor(candidate,options);
  if(!result.ok) throw new TypeError(`AXIOM infrastructure adapter contract violation: ${result.errors.join('; ')}`);
  return candidate;
}

export function unavailableAdapterState(kind,{reason='unavailable'}={}){
  if(!REQUIRED_INFRASTRUCTURE_ADAPTERS.includes(kind)) throw new TypeError('unknown Phase-2 infrastructure adapter kind');
  return Object.freeze({kind,status:'UNAVAILABLE',evidence_state:'NOT_PROVEN',silent_fallback:false,authority_effect:'NONE',reason:String(reason)});
}
