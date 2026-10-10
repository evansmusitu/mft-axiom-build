import { ModelExecutionError, ModelExecutionService } from "./model_execution_service.ts";
import type {
  DistributedExecutionRepository, ExecutionRepository, WorldStateRepository
} from "./repositories.ts";
import type {
  AuthorizedTenantContext, ControlPlaneResult, ModelDispatchResult, ModelExecuteRequest,
  PreparedModelExecution, TenantScope, WorkerAction
} from "./types.ts";
import type { DistributedWorkerControl, DistributedWorkerCredential } from "./distributed_worker_control.ts";
import { distributedWorkerOperationBodyHash } from "./distributed_execution_store.ts";

function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function iso(value:string,label:string):string {
  const ms=Date.parse(required(value,label));
  if(!Number.isFinite(ms))throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  return new Date(ms).toISOString();
}
function preparedFromIntent(intent:any):PreparedModelExecution {
  return {
    compilationId:intent.compilationId,
    compilationRecordHash:intent.compilationRecordHash,
    profileId:intent.profileId,
    profileVersion:intent.profileVersion,
    profileHash:intent.profileHash,
    compilerManifest:structuredClone(intent.compilerManifest),
    operationRegistryManifestHash:intent.operationRegistryManifestHash,
    executionRequest:structuredClone(intent.executionRequest)
  };
}
function integrityFailure(error:unknown):boolean {
  const message=error instanceof Error?error.message:String(error);
  return /integrity|mismatch|not found for tenant|reserved platform context|no executable template|input contract|placeholder|template input|bound world snapshot|world snapshot/i.test(message);
}
function staleLeaseFailure(error:unknown):boolean {
  return /stale lease/i.test(error instanceof Error?error.message:String(error));
}
function workerAuthorityFailure(error:unknown):boolean {
  return /stale lease|lease capability|worker credential|worker key is revoked|not active|not currently trusted|worker identity|worker operation|action mismatch|target job mismatch/i
    .test(error instanceof Error?error.message:String(error));
}

export class ModelDispatchService {
  private readonly modelExecutor:Pick<ModelExecutionService,"prepareDispatch">;
  private readonly world:Pick<WorldStateRepository,"snapshot">;
  private readonly jobs:DistributedExecutionRepository;
  constructor(options:{
    modelExecutor:Pick<ModelExecutionService,"prepareDispatch">;
    world:Pick<WorldStateRepository,"snapshot">;
    jobs:DistributedExecutionRepository;
  }){
    if(!options?.modelExecutor||typeof options.modelExecutor.prepareDispatch!=="function")throw new TypeError("model dispatch executor is required");
    if(!options?.world||typeof options.world.snapshot!=="function")throw new TypeError("world-state repository is required");
    if(!options?.jobs||typeof options.jobs.create!=="function")throw new TypeError("distributed execution repository is required");
    this.modelExecutor=options.modelExecutor;this.world=options.world;this.jobs=options.jobs;
  }

  async dispatch(
    context:AuthorizedTenantContext,compilationId:string,timing:ModelExecuteRequest,requestHash:string,now:string
  ):Promise<ModelDispatchResult> {
    const canonicalRequestHash=required(requestHash,"requestHash");
    const createdAt=iso(now,"now");
    const prepared=await this.modelExecutor.prepareDispatch(context,compilationId,timing);
    const snapshot=await this.world.snapshot(context.tenant,prepared.executionRequest.asOf);
    if(snapshot.tenantId!==context.tenant.tenantId)throw new Error("Distributed dispatch snapshot tenant integrity mismatch");
    if(snapshot.asOf!==prepared.executionRequest.asOf)throw new Error("Distributed dispatch snapshot timing integrity mismatch");
    const job=await this.jobs.create(context.tenant,{
      tenantId:context.tenant.tenantId,
      principalId:required(context.principal.principalId,"principalId"),
      authorizationDecisionHash:required(context.authorization.decisionHash,"authorization decision hash"),
      requestHash:canonicalRequestHash,
      compilationId:prepared.compilationId,
      compilationRecordHash:prepared.compilationRecordHash,
      profileId:prepared.profileId,
      profileVersion:prepared.profileVersion,
      profileHash:prepared.profileHash,
      compilerManifest:structuredClone(prepared.compilerManifest),
      operationRegistryManifestHash:prepared.operationRegistryManifestHash,
      executionRequest:structuredClone(prepared.executionRequest),
      snapshotId:snapshot.snapshotId,
      snapshotHash:snapshot.snapshotHash,
      createdAt
    });
    return {status:"QUEUED",jobId:job.intent.jobId,snapshotId:job.intent.snapshotId};
  }
}

export interface DistributedModelWorkerRuntime {
  modelExecutor:Pick<ModelExecutionService,"validatePrepared">;
  executions:Pick<ExecutionRepository,"getByIntent">;
  plane:{executeBound(request:any,snapshotId:string,executionIntentId:string):Promise<ControlPlaneResult>};
}
export interface DistributedModelWorkerRuntimeFactory {
  create(scope:TenantScope):DistributedModelWorkerRuntime;
}
export type DistributedWorkerOutcome=
  | {status:"IDLE"}
  | {status:"COMPLETED";jobId:string;jobStatus:"SUCCEEDED"|"DENIED"}
  | {status:"TERMINAL";jobId:string;jobStatus:"STALE"|"FAILED_INTEGRITY"}
  | {status:"RETRY";jobId:string}
  | {status:"LEASE_LOST";jobId:string};

export class DistributedModelExecutionWorker {
  private readonly jobs?:DistributedExecutionRepository;
  private readonly control?:DistributedWorkerControl;
  private readonly credential?:DistributedWorkerCredential;
  private readonly runtimes:DistributedModelWorkerRuntimeFactory;
  private readonly leaseMs:number;
  private readonly clock:()=>string;
  private readonly requestId?:()=>string;

  constructor(options:{
    jobs?:DistributedExecutionRepository;
    control?:DistributedWorkerControl;
    credential?:DistributedWorkerCredential;
    runtimes:DistributedModelWorkerRuntimeFactory;
    leaseMs:number;
    clock:()=>string;
    requestId?:()=>string;
  }){
    const authenticated=Boolean(options?.control||options?.credential||options?.requestId);
    if(authenticated){
      if(!options.control||typeof options.control.claim!=="function")throw new TypeError("authenticated worker control is required");
      if(!options.credential||typeof options.credential.sign!=="function")throw new TypeError("worker credential is required");
      if(typeof options.requestId!=="function")throw new TypeError("worker requestId generator is required");
      this.control=options.control;this.credential=options.credential;this.requestId=options.requestId;
    }else{
      if(!options?.jobs||typeof options.jobs.claimNext!=="function")throw new TypeError("distributed execution repository is required");
      this.jobs=options.jobs;
    }
    if(!options?.runtimes||typeof options.runtimes.create!=="function")throw new TypeError("tenant runtime factory is required");
    if(!Number.isInteger(options.leaseMs)||options.leaseMs<=0||options.leaseMs>24*60*60*1000)throw new RangeError("leaseMs must be an integer between 1 and 86400000");
    if(typeof options.clock!=="function")throw new TypeError("trusted worker clock is required");
    this.runtimes=options.runtimes;this.leaseMs=options.leaseMs;this.clock=options.clock;
  }
  private now():string{return iso(this.clock(),"worker clock");}
  private proof(action:WorkerAction,now:string,body:unknown,targetJobId?:string){
    if(!this.credential||!this.requestId)throw new Error("Authenticated worker credential is not configured");
    return this.credential.sign({
      requestId:required(this.requestId(),"worker requestId"),action,
      ...(targetJobId===undefined?{}:{targetJobId}),
      bodyHash:distributedWorkerOperationBodyHash(action,body),issuedAt:now
    });
  }

  async runOnce(workerId?:string):Promise<DistributedWorkerOutcome> {
    if(this.control&&this.credential)return this.runAuthenticated();
    return this.runLegacy(required(workerId,"workerId"));
  }

  private async runAuthenticated():Promise<DistributedWorkerOutcome> {
    const control=this.control!;
    const claimNow=this.now();
    const claimProof=this.proof("CLAIM",claimNow,{leaseMs:this.leaseMs});
    const lease=await control.claim(claimProof,claimNow,this.leaseMs);
    if(!lease)return {status:"IDLE"};
    const intent=lease.job.intent,scope={tenantId:intent.tenantId};
    try{
      const runtime=this.runtimes.create(scope);
      if(!runtime?.modelExecutor||typeof runtime.modelExecutor.validatePrepared!=="function")throw new Error("Worker runtime model executor is invalid");
      if(!runtime?.executions||typeof runtime.executions.getByIntent!=="function")throw new Error("Worker runtime execution repository is invalid");
      if(!runtime?.plane||typeof runtime.plane.executeBound!=="function")throw new Error("Worker runtime control plane is invalid");
      const existing=await runtime.executions.getByIntent(scope,intent.jobId);
      if(!existing)await runtime.modelExecutor.validatePrepared(scope,preparedFromIntent(intent));
      const result=await runtime.plane.executeBound(structuredClone(intent.executionRequest),intent.snapshotId,intent.jobId);
      const completeNow=this.now();
      const completeProof=this.proof("COMPLETE",completeNow,{capabilityId:lease.capability.capabilityId,result},intent.jobId);
      const completed=await control.complete(scope,intent.jobId,completeProof,lease.capability,completeNow,result);
      return {status:"COMPLETED",jobId:intent.jobId,jobStatus:completed.state.status as "SUCCEEDED"|"DENIED"};
    }catch(error){
      if(workerAuthorityFailure(error))return {status:"LEASE_LOST",jobId:intent.jobId};
      if(error instanceof ModelExecutionError&&error.code==="COMPILATION_STALE"){
        try{
          const now=this.now(),proof=this.proof("FAIL_TERMINAL",now,{capabilityId:lease.capability.capabilityId,code:"STALE"},intent.jobId);
          const failed=await control.fail(scope,intent.jobId,proof,lease.capability,now,"STALE");
          return {status:"TERMINAL",jobId:intent.jobId,jobStatus:failed.state.status as "STALE"};
        }catch(transitionError){
          if(workerAuthorityFailure(transitionError))return {status:"LEASE_LOST",jobId:intent.jobId};
          throw transitionError;
        }
      }
      if(integrityFailure(error)){
        try{
          const now=this.now(),proof=this.proof("FAIL_TERMINAL",now,{capabilityId:lease.capability.capabilityId,code:"FAILED_INTEGRITY"},intent.jobId);
          const failed=await control.fail(scope,intent.jobId,proof,lease.capability,now,"FAILED_INTEGRITY");
          return {status:"TERMINAL",jobId:intent.jobId,jobStatus:failed.state.status as "FAILED_INTEGRITY"};
        }catch(transitionError){
          if(workerAuthorityFailure(transitionError))return {status:"LEASE_LOST",jobId:intent.jobId};
          throw transitionError;
        }
      }
      try{
        const now=this.now(),proof=this.proof("RELEASE",now,{capabilityId:lease.capability.capabilityId},intent.jobId);
        await control.release(scope,intent.jobId,proof,lease.capability,now);
        return {status:"RETRY",jobId:intent.jobId};
      }catch(transitionError){
        if(workerAuthorityFailure(transitionError))return {status:"LEASE_LOST",jobId:intent.jobId};
        throw transitionError;
      }
    }
  }

  private async runLegacy(worker:string):Promise<DistributedWorkerOutcome> {
    const jobs=this.jobs!;
    const lease=await jobs.claimNext(worker,this.now(),this.leaseMs);
    if(!lease)return {status:"IDLE"};
    const intent=lease.job.intent,scope={tenantId:intent.tenantId};
    try{
      const runtime=this.runtimes.create(scope);
      if(!runtime?.modelExecutor||typeof runtime.modelExecutor.validatePrepared!=="function")throw new Error("Worker runtime model executor is invalid");
      if(!runtime?.executions||typeof runtime.executions.getByIntent!=="function")throw new Error("Worker runtime execution repository is invalid");
      if(!runtime?.plane||typeof runtime.plane.executeBound!=="function")throw new Error("Worker runtime control plane is invalid");
      const existing=await runtime.executions.getByIntent(scope,intent.jobId);
      if(!existing)await runtime.modelExecutor.validatePrepared(scope,preparedFromIntent(intent));
      const result=await runtime.plane.executeBound(structuredClone(intent.executionRequest),intent.snapshotId,intent.jobId);
      const completed=await jobs.complete(scope,intent.jobId,worker,lease.leaseEpoch,this.now(),result);
      return {status:"COMPLETED",jobId:intent.jobId,jobStatus:completed.state.status as "SUCCEEDED"|"DENIED"};
    }catch(error){
      if(staleLeaseFailure(error))return {status:"LEASE_LOST",jobId:intent.jobId};
      if(error instanceof ModelExecutionError&&error.code==="COMPILATION_STALE"){
        try{
          const failed=await jobs.failTerminal(scope,intent.jobId,worker,lease.leaseEpoch,this.now(),"STALE");
          return {status:"TERMINAL",jobId:intent.jobId,jobStatus:failed.state.status as "STALE"};
        }catch(transitionError){if(staleLeaseFailure(transitionError))return {status:"LEASE_LOST",jobId:intent.jobId};throw transitionError;}
      }
      if(integrityFailure(error)){
        try{
          const failed=await jobs.failTerminal(scope,intent.jobId,worker,lease.leaseEpoch,this.now(),"FAILED_INTEGRITY");
          return {status:"TERMINAL",jobId:intent.jobId,jobStatus:failed.state.status as "FAILED_INTEGRITY"};
        }catch(transitionError){if(staleLeaseFailure(transitionError))return {status:"LEASE_LOST",jobId:intent.jobId};throw transitionError;}
      }
      try{
        await jobs.releaseForRetry(scope,intent.jobId,worker,lease.leaseEpoch,this.now());
        return {status:"RETRY",jobId:intent.jobId};
      }catch(transitionError){if(staleLeaseFailure(transitionError))return {status:"LEASE_LOST",jobId:intent.jobId};throw transitionError;}
    }
  }
}

