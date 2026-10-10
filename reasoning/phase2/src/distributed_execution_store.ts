import { DatabaseSync } from "node:sqlite";
import { hashJson } from "../../phase1/src/canonical.ts";
import type { DistributedExecutionRepository } from "./repositories.ts";
import type {
  AuthenticatedDistributedExecutionLease, AuthenticatedWorkerContext, ControlPlaneResult,
  DistributedExecutionIntent, DistributedExecutionIntentCore, DistributedExecutionJob,
  DistributedExecutionLease, DistributedExecutionState, TenantScope, WorkerAction,
  WorkerLeaseCapability, WorkerLeaseCapabilityCore
} from "./types.ts";
import type { WorkerTrustStore } from "./worker_authentication.ts";
import {
  workerLeaseCapabilityCoreHash, type WorkerLeaseCapabilitySigner
} from "./worker_lease_capability.ts";

function required(value:string,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function tenantId(scope:TenantScope):string{return required(scope?.tenantId,"tenantId");}
function iso(value:string,label:string):string {
  const ms=Date.parse(required(value,label));
  if(!Number.isFinite(ms))throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  return new Date(ms).toISOString();
}
function positiveLease(value:number):number {
  if(!Number.isInteger(value)||value<=0||value>24*60*60*1000)throw new RangeError("leaseMs must be an integer between 1 and 86400000");
  return value;
}
function epoch(value:number):number {
  if(!Number.isInteger(value)||value<1)throw new RangeError("leaseEpoch must be a positive integer");
  return value;
}
function intentCore(intent:DistributedExecutionIntent):DistributedExecutionIntentCore {
  const {jobId:_,intentHash:__,...core}=intent;
  return core;
}
function canonicalIntentCore(scope:TenantScope,input:DistributedExecutionIntentCore):DistributedExecutionIntentCore {
  const tenant=tenantId(scope);
  if(!input||typeof input!=="object")throw new TypeError("distributed execution intent is required");
  if(input.tenantId!==tenant)throw new Error("Distributed execution intent tenant mismatch");
  const core:DistributedExecutionIntentCore={
    tenantId:tenant,
    principalId:required(input.principalId,"principalId"),
    authorizationDecisionHash:required(input.authorizationDecisionHash,"authorizationDecisionHash"),
    requestHash:required(input.requestHash,"requestHash"),
    compilationId:required(input.compilationId,"compilationId"),
    compilationRecordHash:required(input.compilationRecordHash,"compilationRecordHash"),
    profileId:required(input.profileId,"profileId"),
    profileVersion:required(input.profileVersion,"profileVersion"),
    profileHash:required(input.profileHash,"profileHash"),
    compilerManifest:structuredClone(input.compilerManifest),
    operationRegistryManifestHash:required(input.operationRegistryManifestHash,"operationRegistryManifestHash"),
    executionRequest:structuredClone(input.executionRequest),
    snapshotId:required(input.snapshotId,"snapshotId"),
    snapshotHash:required(input.snapshotHash,"snapshotHash"),
    createdAt:iso(input.createdAt,"createdAt")
  };
  if(!core.compilerManifest||typeof core.compilerManifest!=="object")throw new TypeError("compilerManifest is required");
  if(!core.executionRequest||typeof core.executionRequest!=="object")throw new TypeError("executionRequest is required");
  return core;
}
function makeIntent(scope:TenantScope,input:DistributedExecutionIntentCore):DistributedExecutionIntent {
  const core=canonicalIntentCore(scope,input),intentHash=hashJson(core as any);
  return {jobId:`execution-job:${intentHash}`,...core,intentHash};
}
function verifyIntent(scope:TenantScope,intent:DistributedExecutionIntent,storedHash:string):DistributedExecutionIntent {
  const tenant=tenantId(scope),core=intentCore(intent),expected=hashJson(core as any);
  if(
    intent.tenantId!==tenant||
    intent.intentHash!==expected||
    storedHash!==expected||
    intent.jobId!==`execution-job:${expected}`
  )throw new Error("Stored distributed execution intent integrity mismatch");
  canonicalIntentCore(scope,core);
  return intent;
}
function stateHash(intentHash:string,state:Omit<DistributedExecutionState,"stateHash">):string {
  return hashJson({
    intentHash,
    status:state.status,
    leaseEpoch:state.leaseEpoch,
    attemptCount:state.attemptCount,
    leaseOwner:state.leaseOwner??null,
    leaseExpiresAt:state.leaseExpiresAt??null,
    leaseWorkerKeyId:state.leaseWorkerKeyId??null,
    leasePoolId:state.leasePoolId??null,
    leaseCapabilityCoreHash:state.leaseCapabilityCoreHash??null,
    terminalAt:state.terminalAt??null,
    result:state.result??null,
    resultHash:state.resultHash??null,
    failureCode:state.failureCode??null
  } as any);
}
function makeState(intentHash:string,state:Omit<DistributedExecutionState,"stateHash">):DistributedExecutionState {
  return {...state,stateHash:stateHash(intentHash,state)};
}
function decodedJson<T>(value:unknown):T {
  return (typeof value==="string"?JSON.parse(value):structuredClone(value)) as T;
}
function rowState(row:any):DistributedExecutionState {
  const state:Omit<DistributedExecutionState,"stateHash">={
    status:String(row.status) as DistributedExecutionState["status"],
    leaseEpoch:Number(row.lease_epoch),
    attemptCount:Number(row.attempt_count)
  };
  if(row.lease_owner!==null)state.leaseOwner=String(row.lease_owner);
  if(row.lease_expires_at!==null)state.leaseExpiresAt=String(row.lease_expires_at);
  if(row.lease_worker_key_id!==null&&row.lease_worker_key_id!==undefined)state.leaseWorkerKeyId=String(row.lease_worker_key_id);
  if(row.lease_pool_id!==null&&row.lease_pool_id!==undefined)state.leasePoolId=String(row.lease_pool_id);
  if(row.lease_capability_core_hash!==null&&row.lease_capability_core_hash!==undefined)state.leaseCapabilityCoreHash=String(row.lease_capability_core_hash);
  if(row.terminal_at!==null)state.terminalAt=String(row.terminal_at);
  if(row.result_json!==null)state.result=decodedJson<ControlPlaneResult>(row.result_json);
  if(row.result_hash!==null)state.resultHash=String(row.result_hash);
  if(row.failure_code!==null)state.failureCode=String(row.failure_code) as any;
  return {...state,stateHash:String(row.state_hash)};
}
function verifyState(intent:DistributedExecutionIntent,state:DistributedExecutionState,storedHash:string):DistributedExecutionState {
  const {stateHash:_,...core}=state,expected=stateHash(intent.intentHash,core);
  if(state.stateHash!==expected||storedHash!==expected)throw new Error("Stored distributed execution state integrity mismatch");
  if(!Number.isInteger(state.leaseEpoch)||state.leaseEpoch<0||!Number.isInteger(state.attemptCount)||state.attemptCount<0)throw new Error("Stored distributed execution state integrity mismatch");
  const authLeaseFields=[state.leaseWorkerKeyId,state.leasePoolId,state.leaseCapabilityCoreHash];
  const hasAnyAuthLease=authLeaseFields.some(Boolean),hasAllAuthLease=authLeaseFields.every(Boolean);
  if(hasAnyAuthLease&&!hasAllAuthLease)throw new Error("Stored distributed execution state integrity mismatch");
  if(state.status==="PENDING"){
    if(state.leaseOwner||state.leaseExpiresAt||hasAnyAuthLease||state.terminalAt||state.result||state.failureCode)throw new Error("Stored distributed execution state integrity mismatch");
  }else if(state.status==="LEASED"){
    if(!state.leaseOwner||!state.leaseExpiresAt||state.terminalAt||state.result||state.failureCode)throw new Error("Stored distributed execution state integrity mismatch");
  }else{
    if(!state.terminalAt||state.leaseOwner||state.leaseExpiresAt||hasAnyAuthLease)throw new Error("Stored distributed execution state integrity mismatch");
    if((state.status==="SUCCEEDED"||state.status==="DENIED")&&(!state.result||!state.resultHash||state.resultHash!==hashJson(state.result as any)))throw new Error("Stored distributed execution state integrity mismatch");
    if((state.status==="STALE"||state.status==="FAILED_INTEGRITY")&&state.failureCode!==state.status)throw new Error("Stored distributed execution state integrity mismatch");
  }
  return state;
}
function cloneJob(job:DistributedExecutionJob):DistributedExecutionJob{return structuredClone(job);}
function resultShape(intent:DistributedExecutionIntent,result:ControlPlaneResult):void {
  if(result.status!=="APPROVED"&&result.status!=="DENIED")throw new TypeError("distributed execution result must be APPROVED or DENIED");
  if(result.snapshotId!==intent.snapshotId||result.policyDecision?.snapshotId!==intent.snapshotId)throw new Error("Distributed execution result snapshot mismatch");
  const hasCertificate=typeof result.certificateId==="string"&&Boolean(result.certificateId.trim());
  const hasExecution=typeof result.executionRecordId==="string"&&Boolean(result.executionRecordId.trim());
  if(hasCertificate!==hasExecution)throw new Error("Distributed execution result certificate and execution record references must be paired");
  if(result.status==="APPROVED"){
    if(result.policyDecision.status!=="ALLOW"||!hasCertificate)throw new Error("Approved distributed execution result must contain an ALLOW policy decision and durable execution proof");
    return;
  }
  if(result.policyDecision.status==="ALLOW"){
    if(!hasCertificate)throw new Error("Signed runtime DENIED result must contain durable execution proof");
    return;
  }
  if(hasCertificate)throw new Error("Policy-denied distributed execution result cannot reference an execution certificate");
}
function terminal(status:DistributedExecutionState["status"]):boolean {
  return status==="SUCCEEDED"||status==="DENIED"||status==="STALE"||status==="FAILED_INTEGRITY";
}

export function distributedWorkerOperationBodyHash(action:WorkerAction,body:unknown):string {
  return hashJson({domain:"AXIOM_DISTRIBUTED_WORKER_OPERATION_BODY_V1",action,body} as any);
}

interface AuthenticatedStoreOptions {
  workerTrustStore:WorkerTrustStore;
  leaseSigner:WorkerLeaseCapabilitySigner;
}
type StoredWorkerOutcome=
  | {kind:"NONE"}
  | {kind:"LEASE";job:DistributedExecutionJob;workerId:string;workerKeyId:string;poolId:string;leaseEpoch:number;leaseExpiresAt:string;capabilityCore:WorkerLeaseCapabilityCore}
  | {kind:"JOB";job:DistributedExecutionJob};

export class DistributedExecutionStore implements DistributedExecutionRepository {
  private readonly db:DatabaseSync;
  private readonly workerTrustStore?:WorkerTrustStore;
  private readonly leaseSigner?:WorkerLeaseCapabilitySigner;
  constructor(databasePath:string,options?:AuthenticatedStoreOptions){
    this.db=new DatabaseSync(databasePath);
    this.workerTrustStore=options?.workerTrustStore;
    this.leaseSigner=options?.leaseSigner;
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS distributed_execution_jobs(
        tenant_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        intent_hash TEXT NOT NULL,
        intent_json TEXT NOT NULL,
        status TEXT NOT NULL,
        lease_epoch INTEGER NOT NULL,
        attempt_count INTEGER NOT NULL,
        lease_owner TEXT,
        lease_expires_at TEXT,
        lease_worker_key_id TEXT,
        lease_pool_id TEXT,
        lease_capability_core_hash TEXT,
        terminal_at TEXT,
        result_json TEXT,
        result_hash TEXT,
        failure_code TEXT,
        state_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(tenant_id,job_id),
        UNIQUE(job_id),
        CHECK(status IN ('PENDING','LEASED','SUCCEEDED','DENIED','STALE','FAILED_INTEGRITY'))
      );
      CREATE INDEX IF NOT EXISTS distributed_execution_claim
        ON distributed_execution_jobs(status,lease_expires_at,created_at,job_id);
      CREATE TABLE IF NOT EXISTS worker_operation_receipts(
        worker_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        worker_key_id TEXT NOT NULL,
        action TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        outcome_json TEXT NOT NULL,
        outcome_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        receipt_hash TEXT NOT NULL,
        PRIMARY KEY(worker_id,request_id)
      );
    `);
    const existing=new Set((this.db.prepare("PRAGMA table_info(distributed_execution_jobs)").all() as any[]).map(row=>String(row.name)));
    for(const [name,type] of [
      ["lease_worker_key_id","TEXT"],["lease_pool_id","TEXT"],["lease_capability_core_hash","TEXT"]
    ] as const){
      if(!existing.has(name))this.db.exec(`ALTER TABLE distributed_execution_jobs ADD COLUMN ${name} ${type}`);
    }
  }
  close():void{this.db.close();}

  private row(scope:TenantScope,jobId:string):any {
    const tenant=tenantId(scope),id=required(jobId,"jobId");
    const row=this.db.prepare("SELECT * FROM distributed_execution_jobs WHERE tenant_id=? AND job_id=?").get(tenant,id) as any;
    if(!row)throw new Error(`Distributed execution job not found for tenant ${tenant}: ${id}`);
    return row;
  }
  private verified(scope:TenantScope,row:any):DistributedExecutionJob {
    const intent=verifyIntent(scope,JSON.parse(String(row.intent_json)) as DistributedExecutionIntent,String(row.intent_hash));
    if(intent.jobId!==String(row.job_id)||intent.tenantId!==String(row.tenant_id)||intent.createdAt!==String(row.created_at))throw new Error("Stored distributed execution intent integrity mismatch");
    const state=verifyState(intent,rowState(row),String(row.state_hash));
    return {intent,state};
  }
  private update(scope:TenantScope,job:DistributedExecutionJob):void {
    const tenant=tenantId(scope),s=job.state;
    const result=this.db.prepare(`
      UPDATE distributed_execution_jobs SET
        status=?,lease_epoch=?,attempt_count=?,lease_owner=?,lease_expires_at=?,
        lease_worker_key_id=?,lease_pool_id=?,lease_capability_core_hash=?,terminal_at=?,
        result_json=?,result_hash=?,failure_code=?,state_hash=?
      WHERE tenant_id=? AND job_id=?
    `).run(
      s.status,s.leaseEpoch,s.attemptCount,s.leaseOwner??null,s.leaseExpiresAt??null,
      s.leaseWorkerKeyId??null,s.leasePoolId??null,s.leaseCapabilityCoreHash??null,s.terminalAt??null,
      s.result===undefined?null:JSON.stringify(s.result),s.resultHash??null,s.failureCode??null,s.stateHash,
      tenant,job.intent.jobId
    );
    if(Number(result.changes)!==1)throw new Error("Distributed execution job update lost");
  }
  private currentLease(scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string):DistributedExecutionJob {
    const job=this.verified(scope,this.row(scope,jobId)),at=iso(now,"now"),worker=required(workerId,"workerId"),wanted=epoch(leaseEpoch);
    if(
      job.state.status!=="LEASED"||
      job.state.leaseOwner!==worker||
      job.state.leaseEpoch!==wanted||
      !job.state.leaseExpiresAt||
      Date.parse(job.state.leaseExpiresAt)<=Date.parse(at)
    )throw new Error("Stale lease");
    return job;
  }

  async create(scope:TenantScope,input:DistributedExecutionIntentCore):Promise<DistributedExecutionJob> {
    const intent=makeIntent(scope,input);
    const initial=makeState(intent.intentHash,{status:"PENDING",leaseEpoch:0,attemptCount:0});
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const existing=this.db.prepare("SELECT * FROM distributed_execution_jobs WHERE tenant_id=? AND job_id=?").get(intent.tenantId,intent.jobId) as any;
      if(existing){
        const job=this.verified(scope,existing);
        if(hashJson(intent as any)!==hashJson(job.intent as any))throw new Error("Distributed execution job ID collision");
        this.db.exec("COMMIT");
        return cloneJob(job);
      }
      this.db.prepare(`
        INSERT INTO distributed_execution_jobs(
          tenant_id,job_id,intent_hash,intent_json,status,lease_epoch,attempt_count,state_hash,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
      `).run(intent.tenantId,intent.jobId,intent.intentHash,JSON.stringify(intent),initial.status,0,0,initial.stateHash,intent.createdAt);
      this.db.exec("COMMIT");
      return cloneJob({intent,state:initial});
    }catch(error){
      try{this.db.exec("ROLLBACK");}catch{}
      throw error;
    }
  }

  async get(scope:TenantScope,jobId:string):Promise<DistributedExecutionJob> {
    return cloneJob(this.verified(scope,this.row(scope,jobId)));
  }

  async claimNext(workerId:string,now:string,leaseMs:number):Promise<DistributedExecutionLease|undefined> {
    const worker=required(workerId,"workerId"),at=iso(now,"now"),duration=positiveLease(leaseMs),expires=new Date(Date.parse(at)+duration).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const row=this.db.prepare(`
        SELECT * FROM distributed_execution_jobs
        WHERE status='PENDING' OR (status='LEASED' AND lease_expires_at<=?)
        ORDER BY created_at ASC,job_id ASC
        LIMIT 1
      `).get(at) as any;
      if(!row){this.db.exec("COMMIT");return undefined;}
      const scope={tenantId:String(row.tenant_id)},job=this.verified(scope,row);
      if(terminal(job.state.status))throw new Error("Terminal distributed execution job is not claimable");
      const nextState=makeState(job.intent.intentHash,{
        status:"LEASED",
        leaseEpoch:job.state.leaseEpoch+1,
        attemptCount:job.state.attemptCount+1,
        leaseOwner:worker,
        leaseExpiresAt:expires
      });
      const next={intent:job.intent,state:nextState};
      this.update(scope,next);
      this.db.exec("COMMIT");
      return {job:cloneJob(next),workerId:worker,leaseEpoch:nextState.leaseEpoch,leaseExpiresAt:expires};
    }catch(error){
      try{this.db.exec("ROLLBACK");}catch{}
      throw error;
    }
  }

  async heartbeat(scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string,leaseMs:number):Promise<DistributedExecutionLease> {
    const at=iso(now,"now"),duration=positiveLease(leaseMs),expires=new Date(Date.parse(at)+duration).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const job=this.currentLease(scope,jobId,workerId,leaseEpoch,at);
      const nextState=makeState(job.intent.intentHash,{
        status:"LEASED",leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount,
        leaseOwner:job.state.leaseOwner,leaseExpiresAt:expires
      });
      const next={intent:job.intent,state:nextState};this.update(scope,next);this.db.exec("COMMIT");
      return {job:cloneJob(next),workerId:required(workerId,"workerId"),leaseEpoch:nextState.leaseEpoch,leaseExpiresAt:expires};
    }catch(error){try{this.db.exec("ROLLBACK");}catch{}throw error;}
  }

  async releaseForRetry(scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string):Promise<DistributedExecutionJob> {
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const job=this.currentLease(scope,jobId,workerId,leaseEpoch,now);
      const next={intent:job.intent,state:makeState(job.intent.intentHash,{
        status:"PENDING",leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount
      })};
      this.update(scope,next);this.db.exec("COMMIT");return cloneJob(next);
    }catch(error){try{this.db.exec("ROLLBACK");}catch{}throw error;}
  }

  async complete(scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string,result:ControlPlaneResult):Promise<DistributedExecutionJob> {
    const at=iso(now,"now");
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const job=this.currentLease(scope,jobId,workerId,leaseEpoch,at);resultShape(job.intent,result);
      const next={intent:job.intent,state:makeState(job.intent.intentHash,{
        status:result.status==="APPROVED"?"SUCCEEDED":"DENIED",
        leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount,terminalAt:at,
        result:structuredClone(result),resultHash:hashJson(result as any)
      })};
      this.update(scope,next);this.db.exec("COMMIT");return cloneJob(next);
    }catch(error){try{this.db.exec("ROLLBACK");}catch{}throw error;}
  }

  async failTerminal(scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string,code:"STALE"|"FAILED_INTEGRITY"):Promise<DistributedExecutionJob> {
    if(code!=="STALE"&&code!=="FAILED_INTEGRITY")throw new TypeError("Unsupported distributed execution terminal failure");
    const at=iso(now,"now");
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const job=this.currentLease(scope,jobId,workerId,leaseEpoch,at);
      const next={intent:job.intent,state:makeState(job.intent.intentHash,{
        status:code,leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount,terminalAt:at,failureCode:code
      })};
      this.update(scope,next);this.db.exec("COMMIT");return cloneJob(next);
    }catch(error){try{this.db.exec("ROLLBACK");}catch{}throw error;}
  }

  private authenticatedDeps():{trust:WorkerTrustStore;signer:WorkerLeaseCapabilitySigner}{
    if(!this.workerTrustStore||!this.leaseSigner)throw new Error("Authenticated distributed worker dependencies are not configured");
    return {trust:this.workerTrustStore,signer:this.leaseSigner};
  }
  private activeWorker(worker:AuthenticatedWorkerContext,expectedAction:WorkerAction,targetJobId?:string):any {
    const {trust}=this.authenticatedDeps();
    if(!worker||worker.action!==expectedAction)throw new Error("Worker operation action mismatch");
    if((worker.targetJobId??undefined)!==(targetJobId??undefined))throw new Error("Worker operation target job mismatch");
    const record=trust.get(worker.identity?.workerId,worker.identity?.keyId);
    if(!record)throw new Error("Worker is not currently trusted");
    if(record.status!=="ACTIVE")throw new Error("Worker key is revoked or not active");
    if(
      record.identity.workerId!==worker.identity.workerId||
      record.identity.keyId!==worker.identity.keyId||
      record.identity.poolId!==worker.identity.poolId||
      record.identity.publicKeySha256!==worker.identity.publicKeySha256
    )throw new Error("Worker identity no longer matches trust record");
    if(!record.allowedActions.includes(expectedAction))throw new Error("Worker action is forbidden");
    return record;
  }
  private assertBody(worker:AuthenticatedWorkerContext,action:WorkerAction,body:unknown):void {
    if(worker.bodyHash!==distributedWorkerOperationBodyHash(action,body))throw new Error("Worker operation body hash mismatch");
  }
  private receiptHashCore(row:{workerId:string;workerKeyId:string;requestId:string;action:string;requestHash:string;outcomeHash:string;createdAt:string}):string {
    return hashJson({domain:"AXIOM_WORKER_OPERATION_RECEIPT_V1",...row} as any);
  }
  private replayReceipt(worker:AuthenticatedWorkerContext):{found:boolean;value:AuthenticatedDistributedExecutionLease|DistributedExecutionJob|undefined}{
    const row=this.db.prepare("SELECT * FROM worker_operation_receipts WHERE worker_id=? AND request_id=?").get(worker.identity.workerId,worker.requestId) as any;
    if(!row)return {found:false,value:undefined};
    const outcome=JSON.parse(String(row.outcome_json)) as StoredWorkerOutcome;
    const outcomeHash=hashJson(outcome as any);
    const core={
      workerId:String(row.worker_id),workerKeyId:String(row.worker_key_id),requestId:String(row.request_id),
      action:String(row.action),requestHash:String(row.request_hash),outcomeHash:String(row.outcome_hash),createdAt:String(row.created_at)
    };
    if(
      core.workerKeyId!==worker.identity.keyId||core.action!==worker.action||
      core.requestHash!==worker.requestHash||core.outcomeHash!==outcomeHash||
      String(row.receipt_hash)!==this.receiptHashCore(core)
    )throw new Error("Worker request receipt conflict or integrity mismatch");
    if(outcome.kind==="NONE")return {found:true,value:undefined};
    if(outcome.kind==="JOB")return {found:true,value:cloneJob(outcome.job)};
    return {found:true,value:this.leaseFromOutcome(outcome)};
  }
  private putReceipt(worker:AuthenticatedWorkerContext,createdAt:string,outcome:StoredWorkerOutcome):void {
    const outcomeJson=JSON.stringify(outcome),outcomeHash=hashJson(outcome as any);
    const core={
      workerId:worker.identity.workerId,workerKeyId:worker.identity.keyId,requestId:worker.requestId,
      action:worker.action,requestHash:worker.requestHash,outcomeHash,createdAt
    };
    this.db.prepare(`
      INSERT INTO worker_operation_receipts(
        worker_id,request_id,worker_key_id,action,request_hash,outcome_json,outcome_hash,created_at,receipt_hash
      ) VALUES(?,?,?,?,?,?,?,?,?)
    `).run(
      core.workerId,core.requestId,core.workerKeyId,core.action,core.requestHash,outcomeJson,outcomeHash,createdAt,this.receiptHashCore(core)
    );
  }
  private capabilityCore(
    job:DistributedExecutionJob,worker:AuthenticatedWorkerContext,leaseEpoch:number,leaseExpiresAt:string,record:any
  ):WorkerLeaseCapabilityCore {
    const {signer}=this.authenticatedDeps();
    const allowedActions=(["HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"] as WorkerAction[])
      .filter(action=>record.allowedActions.includes(action)) as any;
    if(allowedActions.length===0)throw new Error("Worker has no allowed lease mutation actions");
    return {
      protocolVersion:"axiom.worker-lease/v1",
      workerId:worker.identity.workerId,workerKeyId:worker.identity.keyId,poolId:worker.identity.poolId,
      tenantId:job.intent.tenantId,jobId:job.intent.jobId,intentHash:job.intent.intentHash,
      leaseEpoch,leaseExpiresAt,allowedActions,signerKeyId:signer.keyId
    };
  }
  private issueCore(core:WorkerLeaseCapabilityCore):WorkerLeaseCapability {
    const {signer}=this.authenticatedDeps();
    if(core.signerKeyId!==signer.keyId)throw new Error("Historical lease signer cannot issue active capability");
    const {protocolVersion:_,signerKeyId:__,...input}=core;
    const capability=signer.issue(input);
    if(workerLeaseCapabilityCoreHash(capability.core)!==workerLeaseCapabilityCoreHash(core))throw new Error("Lease signer changed committed capability core");
    return capability;
  }
  private leaseFromOutcome(outcome:Extract<StoredWorkerOutcome,{kind:"LEASE"}>):AuthenticatedDistributedExecutionLease {
    const capability=this.issueCore(outcome.capabilityCore);
    return {
      job:cloneJob(outcome.job),workerId:outcome.workerId,workerKeyId:outcome.workerKeyId,poolId:outcome.poolId,
      leaseEpoch:outcome.leaseEpoch,leaseExpiresAt:outcome.leaseExpiresAt,capability
    };
  }
  private currentAuthenticatedLease(
    scope:TenantScope,jobId:string,worker:AuthenticatedWorkerContext,capability:WorkerLeaseCapability,now:string,action:WorkerAction
  ):DistributedExecutionJob {
    const record=this.activeWorker(worker,action,jobId),job=this.verified(scope,this.row(scope,jobId)),at=iso(now,"now");
    const {signer}=this.authenticatedDeps();
    if(!signer.verify(capability))throw new Error("Invalid lease capability signature");
    const core=capability.core;
    if(
      job.state.status!=="LEASED"||!job.state.leaseWorkerKeyId||!job.state.leasePoolId||!job.state.leaseCapabilityCoreHash||
      job.state.leaseOwner!==worker.identity.workerId||
      job.state.leaseWorkerKeyId!==worker.identity.keyId||
      job.state.leasePoolId!==worker.identity.poolId||
      core.workerId!==worker.identity.workerId||core.workerKeyId!==worker.identity.keyId||core.poolId!==worker.identity.poolId||
      core.tenantId!==job.intent.tenantId||core.jobId!==job.intent.jobId||core.intentHash!==job.intent.intentHash||
      core.leaseEpoch!==job.state.leaseEpoch||core.leaseExpiresAt!==job.state.leaseExpiresAt||
      workerLeaseCapabilityCoreHash(core)!==job.state.leaseCapabilityCoreHash||
      !core.allowedActions.includes(action as any)||
      !job.state.leaseExpiresAt||Date.parse(job.state.leaseExpiresAt)<=Date.parse(at)
    )throw new Error("Lease capability is stale or does not match current lease");
    if(record.identity.poolId!==core.poolId)throw new Error("Lease capability worker pool mismatch");
    return job;
  }

  async claimNextAuthenticated(worker:AuthenticatedWorkerContext,now:string,leaseMs:number):Promise<AuthenticatedDistributedExecutionLease|undefined> {
    const at=iso(now,"now"),record=this.activeWorker(worker,"CLAIM");
    const duration=positiveLease(leaseMs);
    if(duration>record.maxLeaseMs)throw new RangeError("Requested lease exceeds worker maximum lease");
    this.assertBody(worker,"CLAIM",{leaseMs:duration});
    const replay=this.replayReceipt(worker);if(replay.found)return replay.value as AuthenticatedDistributedExecutionLease|undefined;
    const expires=new Date(Date.parse(at)+duration).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const row=this.db.prepare(`
        SELECT * FROM distributed_execution_jobs
        WHERE status='PENDING' OR (status='LEASED' AND lease_expires_at<=?)
        ORDER BY created_at ASC,job_id ASC LIMIT 1
      `).get(at) as any;
      if(!row){
        this.putReceipt(worker,at,{kind:"NONE"});this.db.exec("COMMIT");return undefined;
      }
      const scope={tenantId:String(row.tenant_id)},job=this.verified(scope,row);
      if(terminal(job.state.status))throw new Error("Terminal distributed execution job is not claimable");
      const nextEpoch=job.state.leaseEpoch+1,core=this.capabilityCore(job,worker,nextEpoch,expires,record);
      const next={intent:job.intent,state:makeState(job.intent.intentHash,{
        status:"LEASED",leaseEpoch:nextEpoch,attemptCount:job.state.attemptCount+1,
        leaseOwner:worker.identity.workerId,leaseExpiresAt:expires,
        leaseWorkerKeyId:worker.identity.keyId,leasePoolId:worker.identity.poolId,
        leaseCapabilityCoreHash:workerLeaseCapabilityCoreHash(core)
      })};
      this.update(scope,next);
      const outcome:StoredWorkerOutcome={kind:"LEASE",job:cloneJob(next),workerId:worker.identity.workerId,
        workerKeyId:worker.identity.keyId,poolId:worker.identity.poolId,leaseEpoch:nextEpoch,leaseExpiresAt:expires,capabilityCore:core};
      this.putReceipt(worker,at,outcome);this.db.exec("COMMIT");
      return this.leaseFromOutcome(outcome as any);
    }catch(error){try{this.db.exec("ROLLBACK");}catch{}throw error;}
  }

  async heartbeatAuthenticated(
    scope:TenantScope,jobId:string,worker:AuthenticatedWorkerContext,capability:WorkerLeaseCapability,now:string,leaseMs:number
  ):Promise<AuthenticatedDistributedExecutionLease>{
    const at=iso(now,"now"),record=this.activeWorker(worker,"HEARTBEAT",jobId),duration=positiveLease(leaseMs);
    if(duration>record.maxLeaseMs)throw new RangeError("Requested lease exceeds worker maximum lease");
    this.assertBody(worker,"HEARTBEAT",{leaseMs:duration,capabilityId:capability.capabilityId});
    const replay=this.replayReceipt(worker);if(replay.found)return replay.value as AuthenticatedDistributedExecutionLease;
    const expires=new Date(Date.parse(at)+duration).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const job=this.currentAuthenticatedLease(scope,jobId,worker,capability,at,"HEARTBEAT");
      const core=this.capabilityCore(job,worker,job.state.leaseEpoch,expires,record);
      const next={intent:job.intent,state:makeState(job.intent.intentHash,{
        status:"LEASED",leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount,
        leaseOwner:worker.identity.workerId,leaseExpiresAt:expires,
        leaseWorkerKeyId:worker.identity.keyId,leasePoolId:worker.identity.poolId,
        leaseCapabilityCoreHash:workerLeaseCapabilityCoreHash(core)
      })};
      this.update(scope,next);
      const outcome:StoredWorkerOutcome={kind:"LEASE",job:cloneJob(next),workerId:worker.identity.workerId,
        workerKeyId:worker.identity.keyId,poolId:worker.identity.poolId,leaseEpoch:next.state.leaseEpoch,leaseExpiresAt:expires,capabilityCore:core};
      this.putReceipt(worker,at,outcome);this.db.exec("COMMIT");return this.leaseFromOutcome(outcome as any);
    }catch(error){try{this.db.exec("ROLLBACK");}catch{}throw error;}
  }

  async releaseForRetryAuthenticated(
    scope:TenantScope,jobId:string,worker:AuthenticatedWorkerContext,capability:WorkerLeaseCapability,now:string
  ):Promise<DistributedExecutionJob>{
    const at=iso(now,"now");this.activeWorker(worker,"RELEASE",jobId);
    this.assertBody(worker,"RELEASE",{capabilityId:capability.capabilityId});
    const replay=this.replayReceipt(worker);if(replay.found)return replay.value as DistributedExecutionJob;
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const job=this.currentAuthenticatedLease(scope,jobId,worker,capability,at,"RELEASE");
      const next={intent:job.intent,state:makeState(job.intent.intentHash,{
        status:"PENDING",leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount
      })};
      this.update(scope,next);this.putReceipt(worker,at,{kind:"JOB",job:cloneJob(next)});this.db.exec("COMMIT");return cloneJob(next);
    }catch(error){try{this.db.exec("ROLLBACK");}catch{}throw error;}
  }

  async completeAuthenticated(
    scope:TenantScope,jobId:string,worker:AuthenticatedWorkerContext,capability:WorkerLeaseCapability,now:string,result:ControlPlaneResult
  ):Promise<DistributedExecutionJob>{
    const at=iso(now,"now");this.activeWorker(worker,"COMPLETE",jobId);
    this.assertBody(worker,"COMPLETE",{capabilityId:capability.capabilityId,result});
    const replay=this.replayReceipt(worker);if(replay.found)return replay.value as DistributedExecutionJob;
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const job=this.currentAuthenticatedLease(scope,jobId,worker,capability,at,"COMPLETE");resultShape(job.intent,result);
      const next={intent:job.intent,state:makeState(job.intent.intentHash,{
        status:result.status==="APPROVED"?"SUCCEEDED":"DENIED",leaseEpoch:job.state.leaseEpoch,
        attemptCount:job.state.attemptCount,terminalAt:at,result:structuredClone(result),resultHash:hashJson(result as any)
      })};
      this.update(scope,next);this.putReceipt(worker,at,{kind:"JOB",job:cloneJob(next)});this.db.exec("COMMIT");return cloneJob(next);
    }catch(error){try{this.db.exec("ROLLBACK");}catch{}throw error;}
  }

  async failTerminalAuthenticated(
    scope:TenantScope,jobId:string,worker:AuthenticatedWorkerContext,capability:WorkerLeaseCapability,now:string,code:"STALE"|"FAILED_INTEGRITY"
  ):Promise<DistributedExecutionJob>{
    if(code!=="STALE"&&code!=="FAILED_INTEGRITY")throw new TypeError("Unsupported distributed execution terminal failure");
    const at=iso(now,"now");this.activeWorker(worker,"FAIL_TERMINAL",jobId);
    this.assertBody(worker,"FAIL_TERMINAL",{capabilityId:capability.capabilityId,code});
    const replay=this.replayReceipt(worker);if(replay.found)return replay.value as DistributedExecutionJob;
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const job=this.currentAuthenticatedLease(scope,jobId,worker,capability,at,"FAIL_TERMINAL");
      const next={intent:job.intent,state:makeState(job.intent.intentHash,{
        status:code,leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount,terminalAt:at,failureCode:code
      })};
      this.update(scope,next);this.putReceipt(worker,at,{kind:"JOB",job:cloneJob(next)});this.db.exec("COMMIT");return cloneJob(next);
    }catch(error){try{this.db.exec("ROLLBACK");}catch{}throw error;}
  }
}


export {
  required as distributedRequired,
  tenantId as distributedTenantId,
  iso as distributedIso,
  positiveLease as distributedPositiveLease,
  epoch as distributedEpoch,
  makeIntent as distributedMakeIntent,
  verifyIntent as distributedVerifyIntent,
  makeState as distributedMakeState,
  rowState as distributedRowState,
  verifyState as distributedVerifyState,
  cloneJob as distributedCloneJob,
  resultShape as distributedResultShape
};
