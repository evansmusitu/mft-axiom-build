import {assertAdapterDescriptor} from '../infrastructure_contracts.js';

export const OPENBAO_SECRET_BROKER_DESCRIPTOR=Object.freeze({
  kind:'SecretBroker',adapter_version:'1.0.0',provider:'openbao',provider_baseline:'2.7.1',
  semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',
  capabilities:Object.freeze(['issue-operation-lease','revoke-lease','health']),
  unsupported_operations:Object.freeze(['return-plaintext-secret','grant-identity-authority','grant-authorization','long-lived-unscoped-credential']),
  timeout_ms:5000,retry:Object.freeze({max_attempts:1,backoff:'CALLER_GOVERNED'}),
  idempotency:Object.freeze({mode:'OPERATION_SCOPE_AND_REQUEST_ID'}),data_classification:Object.freeze(['secret-reference','lease-metadata']),
  egress:Object.freeze({required:false,allowed_origins:Object.freeze([])}),
  identity_binding:Object.freeze({required:true,mode:'AXIOM_WORKLOAD_ID'}),
  evidence_envelope:Object.freeze({schema:'musitu.axiom.evidence.v1',required:true}),
  health:Object.freeze({mode:'EXPLICIT'}),migration_export:Object.freeze({supported:true,format:'LEASE_METADATA_ONLY'}),
  fail_closed:true,max_lease_seconds:300,plaintext_secret_release:false,live_runtime_qualification:'NOT_PROVEN',
});
assertAdapterDescriptor(OPENBAO_SECRET_BROKER_DESCRIPTOR,{expectedKind:'SecretBroker'});

const ID=/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,239}$/;
const FORBIDDEN_RETURN_KEY=/^(?:secret|secret_value|value|token|access_token|refresh_token|api_key|password|private_key|client_secret|authorization)$/i;
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const clean=(value,max=240)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
function assertId(name,value){const v=clean(value,240);if(!ID.test(v))throw new TypeError(`${name} invalid`);return v;}
function rejectPlaintextSecretMaterial(value,path='provider_result'){
  if(!value||typeof value!=='object') return;
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_RETURN_KEY.test(key)) throw new DOMException(`${path}.${key} contains forbidden plaintext credential material`,'SecurityError');
    rejectPlaintextSecretMaterial(child,`${path}.${key}`);
  }
}
function assertLeaseRow(row,{nowMs,ttlSeconds}){
  if(!isPlainObject(row)) throw new TypeError('OpenBao lease result required');
  rejectPlaintextSecretMaterial(row);
  const lease_id=assertId('lease_id',row.lease_id);
  const credential_handle=assertId('credential_handle',row.credential_handle);
  const expires=Date.parse(row.expires_at??'');
  if(!Number.isFinite(expires)) throw new TypeError('expires_at must be an ISO instant');
  if(expires<=nowMs||expires>nowMs+(ttlSeconds*1000)+5000) throw new DOMException('lease expiry exceeds operation scope','SecurityError');
  return {lease_id,credential_handle,expires_at:new Date(expires).toISOString(),renewable:row.renewable===true};
}

export function createOpenBaoSecretBroker({client,clock=()=>Date.now()}={}){
  if(!client||typeof client.issueLease!=='function'||typeof client.revokeLease!=='function'||typeof client.health!=='function') throw new TypeError('OpenBao client issueLease, revokeLease and health required');
  return Object.freeze({
    descriptor:OPENBAO_SECRET_BROKER_DESCRIPTOR,
    async issue({projectId,workloadIdentityId,operation,secretRef,purpose='operation-scoped secret use',ttlSeconds=120,requestId}={}){
      const project_id=assertId('projectId',projectId),workload_identity_id=assertId('workloadIdentityId',workloadIdentityId),operation_id=assertId('operation',operation),secret_ref=assertId('secretRef',secretRef),request_id=assertId('requestId',requestId);
      if(!Number.isInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>OPENBAO_SECRET_BROKER_DESCRIPTOR.max_lease_seconds) throw new TypeError('ttlSeconds must be 1..300');
      const nowMs=Number(clock()); if(!Number.isFinite(nowMs)) throw new TypeError('clock must return epoch milliseconds');
      const raw=await client.issueLease({project_id,workload_identity_id,operation:operation_id,secret_ref,purpose:clean(purpose,500),ttl_seconds:ttlSeconds,request_id});
      const lease=assertLeaseRow(raw,{nowMs,ttlSeconds});
      return Object.freeze({schema:'musitu.axiom.secret-lease.v1',project_id,workload_identity_id,operation:operation_id,secret_ref,request_id,...lease,plaintext_secret_released:false,authority_effect:'NONE',identity_authority:false,authorization_authority:false,production_authority:false});
    },
    async revoke({projectId,workloadIdentityId,leaseId,requestId}={}){
      const project_id=assertId('projectId',projectId),workload_identity_id=assertId('workloadIdentityId',workloadIdentityId),lease_id=assertId('leaseId',leaseId),request_id=assertId('requestId',requestId);
      const raw=await client.revokeLease({project_id,workload_identity_id,lease_id,request_id});
      rejectPlaintextSecretMaterial(raw);
      if(raw?.status!=='REVOKED') throw new Error('OpenBao lease revocation not confirmed');
      return Object.freeze({schema:'musitu.axiom.secret-lease-revocation.v1',project_id,workload_identity_id,lease_id,request_id,status:'REVOKED',authority_effect:'NONE'});
    },
    async health(){const provider=await client.health();return Object.freeze({provider_status:clean(provider?.status??'UNKNOWN',40),provider:'openbao',provider_version:OPENBAO_SECRET_BROKER_DESCRIPTOR.provider_baseline,axiom_authority:'NONE',axiom_certification:'NOT_PROVEN',live_runtime_qualification:'NOT_PROVEN'});},
  });
}
