import { ModelExecutionError, ModelExecutionService } from "./model_execution_service.ts";
import type {
  DistributedExecutionRepository, ExecutionRepository, WorldStateRepository
} from "./repositories.ts";
import type {
  AuthorizedTenantContext, ControlPlaneResult, ModelDispatchResult, ModelExecuteRequest,
  PreparedModelExecution, TenantScope
} from "./types.ts";

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
  private readonly jobs:DistributedExecutionRepository;
  private readonly runtimes:DistributedModelWorkerRuntimeFactory;
  private readonly leaseMs:number;
  private readonly clock:()=>string;
  constructor(options:{
    jobs:DistributedExecutionRepository;
    runtimes:DistributedModelWorkerRuntimeFactory;
    leaseMs:number;
    clock:()=>string;
  }){
    if(!options?.jobs||typeof options.jobs.claimNext!=="function")throw new TypeError("distributed execution repository is required");
    if(!options?.runtimes||typeof options.runtimes.create!=="function")throw new TypeError("tenant runtime factory is required");
    if(!Number.isInteger(options.leaseMs)||options.leaseMs<=0||options.leaseMs>24*60*60*1000)throw new RangeError("leaseMs must be an integer between 1 and 86400000");
    if(typeof options.clock!=="function")throw new TypeError("trusted worker clock is required");
    this.jobs=options.jobs;this.runtimes=options.runtimes;this.leaseMs=options.leaseMs;this.clock=options.clock;
  }
  private now():string{return iso(this.clock(),"worker clock");}

  async runOnce(workerId:string):Promise<DistributedWorkerOutcome> {
    const worker=required(workerId,"workerId");
    const lease=await this.jobs.claimNext(worker,this.now(),this.leaseMs);
    if(!lease)return {status:"IDLE"};
    const intent=lease.job.intent,scope={tenantId:intent.tenantId};
    try{
      const runtime=this.runtimes.create(scope);
      if(!runtime?.modelExecutor||typeof runtime.modelExecutor.validatePrepared!=="function")throw new Error("Worker runtime model executor is invalid");
      if(!runtime?.executions||typeof runtime.executions.getByIntent!=="function")throw new Error("Worker runtime execution repository is invalid");
      if(!runtime?.plane||typeof runtime.plane.executeBound!=="function")throw new Error("Worker runtime control plane is invalid");

      const existing=await runtime.executions.getByIntent(scope,intent.jobId);
      if(!existing){
        await runtime.modelExecutor.validatePrepared(scope,preparedFromIntent(intent));
      }
      const result=await runtime.plane.executeBound(
        structuredClone(intent.executionRequest),intent.snapshotId,intent.jobId
      );
      const completed=await this.jobs.complete(scope,intent.jobId,worker,lease.leaseEpoch,this.now(),result);
      return {
        status:"COMPLETED",jobId:intent.jobId,
        jobStatus:completed.state.status as "SUCCEEDED"|"DENIED"
      };
    }catch(error){
      if(staleLeaseFailure(error))return {status:"LEASE_LOST",jobId:intent.jobId};
      if(error instanceof ModelExecutionError&&error.code==="COMPILATION_STALE"){
        try{
          const failed=await this.jobs.failTerminal(scope,intent.jobId,worker,lease.leaseEpoch,this.now(),"STALE");
          return {status:"TERMINAL",jobId:intent.jobId,jobStatus:failed.state.status as "STALE"};
        }catch(transitionError){
          if(staleLeaseFailure(transitionError))return {status:"LEASE_LOST",jobId:intent.jobId};
          throw transitionError;
        }
      }
      if(integrityFailure(error)){
        try{
          const failed=await this.jobs.failTerminal(scope,intent.jobId,worker,lease.leaseEpoch,this.now(),"FAILED_INTEGRITY");
          return {status:"TERMINAL",jobId:intent.jobId,jobStatus:failed.state.status as "FAILED_INTEGRITY"};
        }catch(transitionError){
          if(staleLeaseFailure(transitionError))return {status:"LEASE_LOST",jobId:intent.jobId};
          throw transitionError;
        }
      }
      try{
        await this.jobs.releaseForRetry(scope,intent.jobId,worker,lease.leaseEpoch,this.now());
        return {status:"RETRY",jobId:intent.jobId};
      }catch(transitionError){
        if(staleLeaseFailure(transitionError))return {status:"LEASE_LOST",jobId:intent.jobId};
        throw transitionError;
      }
    }
  }
}
