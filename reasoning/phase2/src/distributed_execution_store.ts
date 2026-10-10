import { DatabaseSync } from "node:sqlite";
import { hashJson } from "../../phase1/src/canonical.ts";
import type { DistributedExecutionRepository } from "./repositories.ts";
import type {
  ControlPlaneResult, DistributedExecutionIntent, DistributedExecutionIntentCore,
  DistributedExecutionJob, DistributedExecutionLease, DistributedExecutionState, TenantScope
} from "./types.ts";

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
  if(state.status==="PENDING"){
    if(state.leaseOwner||state.leaseExpiresAt||state.terminalAt||state.result||state.failureCode)throw new Error("Stored distributed execution state integrity mismatch");
  }else if(state.status==="LEASED"){
    if(!state.leaseOwner||!state.leaseExpiresAt||state.terminalAt||state.result||state.failureCode)throw new Error("Stored distributed execution state integrity mismatch");
  }else{
    if(!state.terminalAt||state.leaseOwner||state.leaseExpiresAt)throw new Error("Stored distributed execution state integrity mismatch");
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

export class DistributedExecutionStore implements DistributedExecutionRepository {
  private readonly db:DatabaseSync;
  constructor(databasePath:string){
    this.db=new DatabaseSync(databasePath);
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
    `);
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
        status=?,lease_epoch=?,attempt_count=?,lease_owner=?,lease_expires_at=?,terminal_at=?,
        result_json=?,result_hash=?,failure_code=?,state_hash=?
      WHERE tenant_id=? AND job_id=?
    `).run(
      s.status,s.leaseEpoch,s.attemptCount,s.leaseOwner??null,s.leaseExpiresAt??null,s.terminalAt??null,
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
