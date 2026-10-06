import {assertAdapterDescriptor} from '../infrastructure_contracts.js';
import {MAX_COMPUTE_UNITS,MAX_FILE_BYTES,MAX_FILES,NETWORK_DENY,SANDBOX_MODE,SECRET_POLICY,TERMINAL_MODE,WORKTREE_MODE,boundedCost,clean,computeRisk,ensureContentSize,normalizeProjectPath,normalizeProvenance,parseTerminalRead,rejectSecretLike,sha256} from '../../execution_security.js';

export const GOVERNED_SANDBOX_DESCRIPTOR=Object.freeze({
  kind:'SandboxBackend',adapter_version:'1.0.0',provider:'axiom-fa11-governed-sandbox',provider_baseline:'FA11_S0_S5_V1',
  semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',
  capabilities:Object.freeze(['create-disposable-sandbox','execute-bounded-local-s0-s1','verify-boundaries','dispose','health']),
  unsupported_operations:Object.freeze(['host-shell','external-network','repo-mutation','public-deployment','plaintext-secret','identity-change','security-policy-change','destructive-action','grant-release-authority','self-certify']),
  timeout_ms:30000,retry:Object.freeze({max_attempts:1,backoff:'CALLER_GOVERNED'}),
  idempotency:Object.freeze({mode:'PROJECT_WORK_AGENT_WORKLOAD_REQUEST'}),
  data_classification:Object.freeze(['project-private','sandbox-metadata','execution-receipts']),
  egress:Object.freeze({required:false,allowed_origins:Object.freeze([])}),
  identity_binding:Object.freeze({required:true,mode:'AXIOM_PROJECT_WORK_AGENT_WORKLOAD_ID'}),
  evidence_envelope:Object.freeze({schema:'musitu.axiom.evidence.v1',required:true}),
  health:Object.freeze({mode:'EXPLICIT'}),migration_export:Object.freeze({supported:true,format:'SANDBOX_METADATA_RECEIPTS_AND_DIGESTS'}),
  fail_closed:true,default_network_policy:NETWORK_DENY,secrets_policy:SECRET_POLICY,sandbox_mode:SANDBOX_MODE,terminal_mode:TERMINAL_MODE,worktree_mode:WORKTREE_MODE,
  resource_limits:Object.freeze({max_file_bytes:MAX_FILE_BYTES,max_files:MAX_FILES,max_compute_units:MAX_COMPUTE_UNITS}),
  host_shell_authority:false,external_network_authority:false,plaintext_secret_access:false,release_authority:false,production_authority:false,certification_authority:false,
  external_process_runtime_qualification:'NOT_PROVEN',live_runtime_qualification:'NOT_PROVEN',
});
assertAdapterDescriptor(GOVERNED_SANDBOX_DESCRIPTOR,{expectedKind:'SandboxBackend'});


const ID=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}$/;
const HASH=/^[a-f0-9]{64}$/i;
const CREATE_KEYS=new Set(['projectId','workId','agentId','workloadIdentityId','requestId','baseTreeSha256','context']);
const EXECUTE_KEYS=new Set(['requestId','operation','target','payload','computeUnits','instructionProvenance']);
const VERIFY_KEYS=new Set(['requestId']);
const DISPOSE_KEYS=new Set(['requestId']);
const LOCAL_OPERATIONS=new Set(['file.read','terminal.read','build.plan','file.write','worktree.create','build.run','test.run']);
const PROVIDER_AUTHORITY_KEYS=new Set(['release_authority','production_authority','certification_authority','policy_authority','identity_authority','canonical_evidence','allow_release','allow_production','allow_deploy','certified']);
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function rejectUnknownKeys(value,allowed,label){if(!isPlainObject(value))throw new TypeError(label+' must be a plain object');const extra=Object.keys(value).filter(key=>!allowed.has(key));if(extra.length)throw new DOMException(label+' contains unsupported fields: '+extra.join(','),'SecurityError');}
function id(name,value){const v=clean(value,300);if(!ID.test(v))throw new TypeError(name+' invalid');return v;}
function digest(name,value,{nullable=false}={}){if(nullable&&(value===null||value===undefined||value===''))return null;const v=clean(value,64).toLowerCase();if(!HASH.test(v))throw new TypeError(name+' required');return v;}
function iso(name,value){const ms=Date.parse(value??'');if(!Number.isFinite(ms))throw new TypeError(name+' must be an ISO instant');return new Date(ms).toISOString();}
function assertClientIdentity(client){const metadata=client?.metadata;if(!isPlainObject(metadata))throw new TypeError('Sandbox client metadata required');if(metadata.name!==GOVERNED_SANDBOX_DESCRIPTOR.provider||metadata.baseline!==GOVERNED_SANDBOX_DESCRIPTOR.provider_baseline)throw new DOMException('Sandbox provider identity mismatch','SecurityError');}
function assertClient(client){if(!client||typeof client!=='object')throw new TypeError('Sandbox client required');for(const method of ['create','execute','verify','dispose','health'])if(typeof client[method]!=='function')throw new TypeError('Sandbox client.'+method+' required');assertClientIdentity(client);}
function rejectProviderClaims(value,path='provider',depth=0){
  if(depth>10)throw new RangeError(path+' exceeds provider-result nesting limit');
  if(!value||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){
    if(key==='authority'&&child!==undefined&&child!==null&&child!==false&&child!=='NONE'&&child!=='MECHANISM_ONLY')throw new DOMException(path+'.authority attempted forbidden authority','SecurityError');
    if(PROVIDER_AUTHORITY_KEYS.has(key)&&child!==undefined&&child!==null&&child!==false&&child!=='NONE'&&child!=='NOT_PROVEN')throw new DOMException(path+'.'+key+' attempted forbidden authority','SecurityError');
    rejectProviderClaims(child,path+'.'+key,depth+1);
  }
}
function assertFixedBoundaries(raw){
  if(raw.sandbox_mode!==SANDBOX_MODE)throw new DOMException('sandbox mode mismatch','SecurityError');
  if(raw.terminal_mode!==TERMINAL_MODE)throw new DOMException('terminal mode mismatch','SecurityError');
  if(raw.worktree_mode!==WORKTREE_MODE)throw new DOMException('worktree mode mismatch','SecurityError');
  if(raw.network_policy!==NETWORK_DENY)throw new DOMException('sandbox network policy must remain deny-all','SecurityError');
  if(raw.secrets_policy!==SECRET_POLICY)throw new DOMException('sandbox secrets policy mismatch','SecurityError');
  if(raw.external_network_enabled!==false||raw.host_shell_enabled!==false||raw.plaintext_secret_access!==false)throw new DOMException('sandbox boundary escalation rejected','SecurityError');
  const limits=raw.resource_limits;if(!isPlainObject(limits)||limits.max_file_bytes!==MAX_FILE_BYTES||limits.max_files!==MAX_FILES||limits.max_compute_units!==MAX_COMPUTE_UNITS)throw new DOMException('sandbox resource limits mismatch','SecurityError');
}
function assertIdentity(raw,expected){
  for(const [key,value] of Object.entries(expected))if(raw[key]!==value)throw new DOMException('sandbox identity binding mismatch: '+key,'SecurityError');
}
function normalizeLocalRequest(operation,target,payload,risk_class,instruction_provenance){
  if(risk_class==='S1'&&instruction_provenance==='RETRIEVED_DATA')throw new DOMException('retrieved data cannot authorize side effects','SecurityError');
  if(operation==='file.read'){
    if(payload!==null&&payload!==undefined)throw new TypeError('file.read payload unsupported');
    return {target:normalizeProjectPath(target),payload:null};
  }
  if(operation==='terminal.read'){
    if(payload!==null&&payload!==undefined)throw new TypeError('terminal.read payload unsupported');
    const command=clean(target,1000);parseTerminalRead(command);return {target:command,payload:null};
  }
  if(operation==='file.write'){
    const path=normalizeProjectPath(target);
    if(!isPlainObject(payload))throw new TypeError('file.write payload required');
    rejectUnknownKeys(payload,new Set(['content']),'file.write payload');
    const content=ensureContentSize(payload.content??'');rejectSecretLike(content,'file content');
    return {target:path,payload:{content}};
  }
  if(operation==='worktree.create'){
    if(payload!==null&&payload!==undefined)throw new TypeError('worktree.create payload unsupported');
    return {target:id('worktree target',target),payload:null};
  }
  if(payload!==null&&payload!==undefined)throw new TypeError(operation+' payload unsupported');
  return {target:clean(target,500),payload:null};
}
async function assertHandle(handle){
  if(!isPlainObject(handle)||handle.schema!=='musitu.axiom.sandbox-handle.v1')throw new TypeError('AXIOM sandbox handle required');
  const sandbox_id=id('sandbox_id',handle.sandbox_id),project_id=id('project_id',handle.project_id),work_id=id('work_id',handle.work_id),agent_id=id('agent_id',handle.agent_id),workload_identity_id=id('workload_identity_id',handle.workload_identity_id);
  if(handle.network_policy!==NETWORK_DENY||handle.sandbox_mode!==SANDBOX_MODE||handle.terminal_mode!==TERMINAL_MODE||handle.worktree_mode!==WORKTREE_MODE)throw new DOMException('sandbox handle boundary mismatch','SecurityError');
  if(handle.external_network_authority!==false||handle.host_shell_authority!==false||handle.plaintext_secret_access!==false||handle.authority_effect!=='NONE'||handle.release_authority!==false||handle.production_authority!==false||handle.certification_authority!==false)throw new DOMException('sandbox handle authority boundary invalid','SecurityError');
  const sandbox_sha256=digest('sandbox_sha256',handle.sandbox_sha256);
  const body=Object.fromEntries(Object.entries(handle).filter(([key])=>key!=='sandbox_sha256'));
  if(await sha256(body)!==sandbox_sha256)throw new DOMException('sandbox handle integrity digest mismatch','SecurityError');
  return {sandbox_id,project_id,work_id,agent_id,workload_identity_id};
}

export function createGovernedSandboxBackend({client}={}){
  assertClient(client);
  return Object.freeze({
    descriptor:GOVERNED_SANDBOX_DESCRIPTOR,
    async createSandbox(request={}){
      rejectUnknownKeys(request,CREATE_KEYS,'request');
      const {projectId,workId,agentId,workloadIdentityId,requestId,baseTreeSha256=null,context={}}=request;
      const project_id=id('projectId',projectId),work_id=id('workId',workId),agent_id=id('agentId',agentId),workload_identity_id=id('workloadIdentityId',workloadIdentityId),request_id=id('requestId',requestId);
      const base_tree_sha256=digest('baseTreeSha256',baseTreeSha256,{nullable:true});
      if(!isPlainObject(context))throw new TypeError('context must be a plain object');
      rejectSecretLike(context,'context');
      const input={project_id,work_id,agent_id,workload_identity_id,request_id,base_tree_sha256,context:structuredClone(context),sandbox_mode:SANDBOX_MODE,terminal_mode:TERMINAL_MODE,worktree_mode:WORKTREE_MODE,network_policy:NETWORK_DENY,secrets_policy:SECRET_POLICY,resource_limits:{max_file_bytes:MAX_FILE_BYTES,max_files:MAX_FILES,max_compute_units:MAX_COMPUTE_UNITS},external_network_allowed:false,host_shell_allowed:false,plaintext_secret_access:false};
      assertClientIdentity(client);
      const raw=await client.create(input);
      if(!isPlainObject(raw))throw new TypeError('Sandbox create result required');
      rejectProviderClaims(raw,'provider_create');
      assertIdentity(raw,{project_id,work_id,agent_id,workload_identity_id,request_id});
      assertFixedBoundaries(raw);
      const sandbox_id=id('provider sandbox_id',raw.sandbox_id),provider_base_tree_sha256=digest('provider base_tree_sha256',raw.base_tree_sha256,{nullable:true});
      if(provider_base_tree_sha256!==base_tree_sha256)throw new DOMException('sandbox base tree digest mismatch','DataError');
      const body={schema:'musitu.axiom.sandbox-handle.v1',sandbox_id,project_id,work_id,agent_id,workload_identity_id,request_id,base_tree_sha256,sandbox_mode:SANDBOX_MODE,terminal_mode:TERMINAL_MODE,worktree_mode:WORKTREE_MODE,network_policy:NETWORK_DENY,secrets_policy:SECRET_POLICY,resource_limits:Object.freeze({max_file_bytes:MAX_FILE_BYTES,max_files:MAX_FILES,max_compute_units:MAX_COMPUTE_UNITS}),created_at:iso('created_at',raw.created_at),provider:GOVERNED_SANDBOX_DESCRIPTOR.provider,provider_baseline:GOVERNED_SANDBOX_DESCRIPTOR.provider_baseline,external_network_authority:false,host_shell_authority:false,plaintext_secret_access:false,canonical_evidence:false,authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false,external_process_runtime_qualification:'NOT_PROVEN',live_runtime_qualification:'NOT_PROVEN'};
      return Object.freeze({...body,sandbox_sha256:await sha256(body)});
    },
    async execute(handle,request={}){
      const bound=await assertHandle(handle);
      rejectUnknownKeys(request,EXECUTE_KEYS,'execution request');
      const request_id=id('requestId',request.requestId),operation=clean(request.operation,80).toLowerCase();if(!operation)throw new TypeError('operation required');
      const risk_class=computeRisk(operation);
      if(!LOCAL_OPERATIONS.has(operation)||!['S0','S1'].includes(risk_class))throw new DOMException('QUALIFIED_EXTERNAL_EXECUTOR_REQUIRED: '+operation,'NotAllowedError');
      const compute_units=boundedCost(request.computeUnits??1),instruction_provenance=normalizeProvenance(request.instructionProvenance);
      const raw_target=clean(request.target,2048),raw_payload=request.payload==null?null:structuredClone(request.payload);
      rejectSecretLike({target:raw_target,payload:raw_payload},'sandbox execution request');
      const normalized=normalizeLocalRequest(operation,raw_target,raw_payload,risk_class,instruction_provenance),target=normalized.target,payload=normalized.payload;
      const input={...bound,request_id,operation,risk_class,target,payload,compute_units,instruction_provenance,sandbox_mode:SANDBOX_MODE,terminal_mode:TERMINAL_MODE,worktree_mode:WORKTREE_MODE,network_policy:NETWORK_DENY,secrets_policy:SECRET_POLICY,external_network_allowed:false,host_shell_allowed:false,plaintext_secret_access:false};
      assertClientIdentity(client);
      const raw=await client.execute(input);
      if(!isPlainObject(raw))throw new TypeError('Sandbox execution result required');
      rejectProviderClaims(raw,'provider_execute');
      assertIdentity(raw,{...bound,request_id,operation});
      if(raw.status!=='COMPLETED')throw new Error('Sandbox execution not completed');
      if(raw.external_action_executed!==false||raw.network_request_performed!==false||raw.host_shell_executed!==false||raw.plaintext_secret_access!==false)throw new DOMException('sandbox execution boundary escalation rejected','SecurityError');
      if(risk_class==='S1'&&raw.rollback_available!==true)throw new DOMException('S1 sandbox mutation requires rollback','SecurityError');
      rejectSecretLike(raw.result??null,'sandbox result');
      const result=structuredClone(raw.result??null),result_sha256=await sha256(result);
      const body={schema:'musitu.axiom.sandbox-execution-receipt.v1',...bound,request_id,operation,risk_class,target,result,result_sha256,status:'COMPLETED',rollback_available:raw.rollback_available===true,external_action_executed:false,network_request_performed:false,host_shell_executed:false,plaintext_secret_access:false,completed_at:iso('completed_at',raw.completed_at),canonical_evidence:false,authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false,external_process_runtime_qualification:'NOT_PROVEN',live_runtime_qualification:'NOT_PROVEN'};
      return Object.freeze({...body,execution_sha256:await sha256(body)});
    },
    async verifySandbox(handle,request={}){
      const bound=await assertHandle(handle);
      rejectUnknownKeys(request,VERIFY_KEYS,'verification request');
      const request_id=id('requestId',request.requestId);
      const input={...bound,request_id,expected_sandbox_sha256:handle.sandbox_sha256,network_policy:NETWORK_DENY,secrets_policy:SECRET_POLICY,sandbox_mode:SANDBOX_MODE,terminal_mode:TERMINAL_MODE,worktree_mode:WORKTREE_MODE};
      assertClientIdentity(client);
      const raw=await client.verify(input);
      if(!isPlainObject(raw))throw new TypeError('Sandbox verification result required');
      rejectProviderClaims(raw,'provider_verify');
      assertIdentity(raw,{...bound,request_id});
      assertFixedBoundaries(raw);
      if(raw.status!=='PASS')throw new Error('Sandbox integrity verification did not pass');
      const sandbox_integrity_sha256=digest('integrity_sha256',raw.integrity_sha256);
      const body={schema:'musitu.axiom.sandbox-integrity-verification.v1',...bound,request_id,sandbox_integrity_status:'PASS',sandbox_integrity_sha256,checked_at:iso('checked_at',raw.checked_at),qualification_effect:'SANDBOX_BOUNDARY_INTEGRITY_ONLY',certification:'NOT_CERTIFIED',independent_qualification:'NOT_PROVEN',external_process_containment:'NOT_PROVEN',live_runtime_qualification:'NOT_PROVEN',canonical_evidence:false,authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false};
      return Object.freeze({...body,verification_sha256:await sha256(body)});
    },
    async disposeSandbox(handle,request={}){
      const bound=await assertHandle(handle);
      rejectUnknownKeys(request,DISPOSE_KEYS,'disposal request');
      const request_id=id('requestId',request.requestId);
      assertClientIdentity(client);
      const raw=await client.dispose({...bound,request_id,expected_sandbox_sha256:handle.sandbox_sha256});
      if(!isPlainObject(raw))throw new TypeError('Sandbox disposal result required');
      rejectProviderClaims(raw,'provider_dispose');
      assertIdentity(raw,{...bound,request_id});
      if(raw.status!=='DISPOSED'||raw.destroyed!==true)throw new DOMException('sandbox destruction not verified','SecurityError');
      const body={schema:'musitu.axiom.sandbox-disposal-receipt.v1',...bound,request_id,status:'DISPOSED',destroyed:true,disposed_at:iso('disposed_at',raw.disposed_at),canonical_evidence:false,authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false,live_runtime_qualification:'NOT_PROVEN'};
      return Object.freeze({...body,disposal_sha256:await sha256(body)});
    },
    async health(){
      assertClientIdentity(client);
      const raw=await client.health();
      if(!isPlainObject(raw))throw new TypeError('Sandbox health result required');
      rejectProviderClaims(raw,'provider_health');
      return Object.freeze({provider_status:clean(raw.status??'UNKNOWN',40),provider:GOVERNED_SANDBOX_DESCRIPTOR.provider,provider_baseline:GOVERNED_SANDBOX_DESCRIPTOR.provider_baseline,axiom_authority:'NONE',axiom_certification:'NOT_PROVEN',external_process_runtime_qualification:'NOT_PROVEN',live_runtime_qualification:'NOT_PROVEN',release_authority:false,production_authority:false,certification_authority:false});
    },
  });
}
