import type { Pool, PoolClient } from "pg";
import type { DistributedExecutionRepository } from "./repositories.ts";
import type {
  AuthenticatedDistributedExecutionLease, AuthenticatedWorkerContext, ControlPlaneResult,
  DistributedExecutionIntent, DistributedExecutionIntentCore, DistributedExecutionJob,
  DistributedExecutionLease, TenantScope, WorkerAction, WorkerLeaseCapability, WorkerLeaseCapabilityCore
} from "./types.ts";
import {
  distributedCloneJob, distributedEpoch, distributedIso, distributedMakeIntent,
  distributedMakeState, distributedPositiveLease, distributedRequired,
  distributedResultShape, distributedRowState, distributedTenantId,
  distributedVerifyIntent, distributedVerifyState, distributedWorkerOperationBodyHash
} from "./distributed_execution_store.ts";
import type { WorkerTrustStore } from "./worker_authentication.ts";
import {
  workerLeaseCapabilityCoreHash, type WorkerLeaseCapabilitySigner
} from "./worker_lease_capability.ts";
import { hashJson } from "../../phase1/src/canonical.ts";

function jsonValue<T>(value:unknown):T{return (typeof value==="string"?JSON.parse(value):value) as T;}

interface AuthenticatedPostgresOptions {
  workerTrustStore:WorkerTrustStore;
  leaseSigner:WorkerLeaseCapabilitySigner;
}
type StoredWorkerOutcome=
  | {kind:"NONE"}
  | {kind:"LEASE";job:DistributedExecutionJob;workerId:string;workerKeyId:string;poolId:string;leaseEpoch:number;leaseExpiresAt:string;capabilityCore:WorkerLeaseCapabilityCore}
  | {kind:"JOB";job:DistributedExecutionJob};

export class PostgresDistributedExecutionRepository implements DistributedExecutionRepository {
  private readonly pool:Pool;
  private readonly workerTrustStore?:WorkerTrustStore;
  private readonly leaseSigner?:WorkerLeaseCapabilitySigner;
  constructor(pool:Pool,options?:AuthenticatedPostgresOptions){
    this.pool=pool;this.workerTrustStore=options?.workerTrustStore;this.leaseSigner=options?.leaseSigner;
  }

  private async row(client:PoolClient,scope:TenantScope,jobId:string,lock=false):Promise<any>{
    const tenant=distributedTenantId(scope),id=distributedRequired(jobId,"jobId");
    const result=await client.query(
      `SELECT * FROM axiom_distributed_execution_jobs WHERE tenant_id=$1 AND job_id=$2${lock?" FOR UPDATE":""}`,
      [tenant,id]
    );
    if(result.rowCount!==1)throw new Error(`Distributed execution job not found for tenant ${tenant}: ${id}`);
    return result.rows[0];
  }

  private verified(scope:TenantScope,row:any):DistributedExecutionJob {
    const intent=distributedVerifyIntent(
      scope,jsonValue<DistributedExecutionIntent>(row.intent_json),String(row.intent_hash)
    );
    if(
      intent.jobId!==String(row.job_id)||
      intent.tenantId!==String(row.tenant_id)||
      intent.createdAt!==String(row.created_at)
    )throw new Error("Stored distributed execution intent integrity mismatch");
    const state=distributedVerifyState(intent,distributedRowState(row),String(row.state_hash));
    return {intent,state};
  }

  private async update(client:PoolClient,scope:TenantScope,job:DistributedExecutionJob):Promise<void>{
    const tenant=distributedTenantId(scope),s=job.state;
    const result=await client.query(
      `UPDATE axiom_distributed_execution_jobs SET
        status=$1,lease_epoch=$2,attempt_count=$3,lease_owner=$4,lease_expires_at=$5,
        lease_worker_key_id=$6,lease_pool_id=$7,lease_capability_core_hash=$8,terminal_at=$9,
        result_json=$10::jsonb,result_hash=$11,failure_code=$12,state_hash=$13
       WHERE tenant_id=$14 AND job_id=$15`,
      [
        s.status,s.leaseEpoch,s.attemptCount,s.leaseOwner??null,s.leaseExpiresAt??null,
        s.leaseWorkerKeyId??null,s.leasePoolId??null,s.leaseCapabilityCoreHash??null,s.terminalAt??null,
        s.result===undefined?null:JSON.stringify(s.result),s.resultHash??null,s.failureCode??null,s.stateHash,
        tenant,job.intent.jobId
      ]
    );
    if(result.rowCount!==1)throw new Error("Distributed execution job update lost");
  }

  private async currentLease(
    client:PoolClient,scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string
  ):Promise<DistributedExecutionJob>{
    const job=this.verified(scope,await this.row(client,scope,jobId,true));
    const at=distributedIso(now,"now"),worker=distributedRequired(workerId,"workerId"),wanted=distributedEpoch(leaseEpoch);
    if(
      job.state.status!=="LEASED"||
      job.state.leaseOwner!==worker||
      job.state.leaseEpoch!==wanted||
      !job.state.leaseExpiresAt||
      Date.parse(job.state.leaseExpiresAt)<=Date.parse(at)
    )throw new Error("Stale lease");
    return job;
  }

  async create(scope:TenantScope,input:DistributedExecutionIntentCore):Promise<DistributedExecutionJob>{
    const intent=distributedMakeIntent(scope,input);
    const initial=distributedMakeState(intent.intentHash,{status:"PENDING",leaseEpoch:0,attemptCount:0});
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const existing=await client.query(
        "SELECT * FROM axiom_distributed_execution_jobs WHERE tenant_id=$1 AND job_id=$2 FOR UPDATE",
        [intent.tenantId,intent.jobId]
      );
      if(existing.rowCount===1){
        const job=this.verified(scope,existing.rows[0]);
        if(hashJson(intent as any)!==hashJson(job.intent as any))throw new Error("Distributed execution job ID collision");
        await client.query("COMMIT");
        return distributedCloneJob(job);
      }
      await client.query(
        `INSERT INTO axiom_distributed_execution_jobs(
          tenant_id,job_id,intent_hash,intent_json,status,lease_epoch,attempt_count,state_hash,created_at
        ) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)`,
        [intent.tenantId,intent.jobId,intent.intentHash,JSON.stringify(intent),initial.status,0,0,initial.stateHash,intent.createdAt]
      );
      await client.query("COMMIT");
      return distributedCloneJob({intent,state:initial});
    }catch(error){
      try{await client.query("ROLLBACK");}catch{}
      throw error;
    }finally{client.release();}
  }

  async get(scope:TenantScope,jobId:string):Promise<DistributedExecutionJob>{
    const client=await this.pool.connect();
    try{return distributedCloneJob(this.verified(scope,await this.row(client,scope,jobId)));}
    finally{client.release();}
  }

  async claimNext(workerId:string,now:string,leaseMs:number):Promise<DistributedExecutionLease|undefined>{
    const worker=distributedRequired(workerId,"workerId"),at=distributedIso(now,"now");
    const duration=distributedPositiveLease(leaseMs),expires=new Date(Date.parse(at)+duration).toISOString();
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const selected=await client.query(
        `SELECT * FROM axiom_distributed_execution_jobs
         WHERE status='PENDING' OR (status='LEASED' AND lease_expires_at<=$1)
         ORDER BY created_at ASC,job_id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [at]
      );
      if(selected.rowCount===0){await client.query("COMMIT");return undefined;}
      const row=selected.rows[0],scope={tenantId:String(row.tenant_id)},job=this.verified(scope,row);
      const nextState=distributedMakeState(job.intent.intentHash,{
        status:"LEASED",leaseEpoch:job.state.leaseEpoch+1,attemptCount:job.state.attemptCount+1,
        leaseOwner:worker,leaseExpiresAt:expires
      });
      const next={intent:job.intent,state:nextState};
      await this.update(client,scope,next);
      await client.query("COMMIT");
      return {job:distributedCloneJob(next),workerId:worker,leaseEpoch:nextState.leaseEpoch,leaseExpiresAt:expires};
    }catch(error){
      try{await client.query("ROLLBACK");}catch{}
      throw error;
    }finally{client.release();}
  }

  async heartbeat(
    scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string,leaseMs:number
  ):Promise<DistributedExecutionLease>{
    const at=distributedIso(now,"now"),duration=distributedPositiveLease(leaseMs);
    const expires=new Date(Date.parse(at)+duration).toISOString(),client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const job=await this.currentLease(client,scope,jobId,workerId,leaseEpoch,at);
      const nextState=distributedMakeState(job.intent.intentHash,{
        status:"LEASED",leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount,
        leaseOwner:job.state.leaseOwner,leaseExpiresAt:expires
      });
      const next={intent:job.intent,state:nextState};await this.update(client,scope,next);await client.query("COMMIT");
      return {job:distributedCloneJob(next),workerId:distributedRequired(workerId,"workerId"),leaseEpoch:nextState.leaseEpoch,leaseExpiresAt:expires};
    }catch(error){try{await client.query("ROLLBACK");}catch{}throw error;}
    finally{client.release();}
  }

  async releaseForRetry(
    scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string
  ):Promise<DistributedExecutionJob>{
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const job=await this.currentLease(client,scope,jobId,workerId,leaseEpoch,now);
      const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
        status:"PENDING",leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount
      })};
      await this.update(client,scope,next);await client.query("COMMIT");return distributedCloneJob(next);
    }catch(error){try{await client.query("ROLLBACK");}catch{}throw error;}
    finally{client.release();}
  }

  async complete(
    scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string,result:ControlPlaneResult
  ):Promise<DistributedExecutionJob>{
    const at=distributedIso(now,"now"),client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const job=await this.currentLease(client,scope,jobId,workerId,leaseEpoch,at);
      distributedResultShape(job.intent,result);
      const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
        status:result.status==="APPROVED"?"SUCCEEDED":"DENIED",
        leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount,terminalAt:at,
        result:structuredClone(result),resultHash:hashJson(result as any)
      })};
      await this.update(client,scope,next);await client.query("COMMIT");return distributedCloneJob(next);
    }catch(error){try{await client.query("ROLLBACK");}catch{}throw error;}
    finally{client.release();}
  }

  async failTerminal(
    scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string,code:"STALE"|"FAILED_INTEGRITY"
  ):Promise<DistributedExecutionJob>{
    if(code!=="STALE"&&code!=="FAILED_INTEGRITY")throw new TypeError("Unsupported distributed execution terminal failure");
    const at=distributedIso(now,"now"),client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const job=await this.currentLease(client,scope,jobId,workerId,leaseEpoch,at);
      const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
        status:code,leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount,terminalAt:at,failureCode:code
      })};
      await this.update(client,scope,next);await client.query("COMMIT");return distributedCloneJob(next);
    }catch(error){try{await client.query("ROLLBACK");}catch{}throw error;}
    finally{client.release();}
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
      record.identity.workerId!==worker.identity.workerId||record.identity.keyId!==worker.identity.keyId||
      record.identity.poolId!==worker.identity.poolId||record.identity.publicKeySha256!==worker.identity.publicKeySha256
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
  private async replayReceipt(
    client:PoolClient,worker:AuthenticatedWorkerContext
  ):Promise<{found:boolean;value:AuthenticatedDistributedExecutionLease|DistributedExecutionJob|undefined}>{
    const result=await client.query(
      "SELECT * FROM axiom_worker_operation_receipts WHERE worker_id=$1 AND request_id=$2",
      [worker.identity.workerId,worker.requestId]
    );
    if(result.rowCount===0)return {found:false,value:undefined};
    const row=result.rows[0],outcome=jsonValue<StoredWorkerOutcome>(row.outcome_json),outcomeHash=hashJson(outcome as any);
    const core={workerId:String(row.worker_id),workerKeyId:String(row.worker_key_id),requestId:String(row.request_id),
      action:String(row.action),requestHash:String(row.request_hash),outcomeHash:String(row.outcome_hash),createdAt:String(row.created_at)};
    if(
      core.workerKeyId!==worker.identity.keyId||core.action!==worker.action||core.requestHash!==worker.requestHash||
      core.outcomeHash!==outcomeHash||String(row.receipt_hash)!==this.receiptHashCore(core)
    )throw new Error("Worker request receipt conflict or integrity mismatch");
    if(outcome.kind==="NONE")return {found:true,value:undefined};
    if(outcome.kind==="JOB")return {found:true,value:distributedCloneJob(outcome.job)};
    return {found:true,value:this.leaseFromOutcome(outcome)};
  }
  private async putReceipt(client:PoolClient,worker:AuthenticatedWorkerContext,createdAt:string,outcome:StoredWorkerOutcome):Promise<void>{
    const outcomeHash=hashJson(outcome as any);
    const core={workerId:worker.identity.workerId,workerKeyId:worker.identity.keyId,requestId:worker.requestId,
      action:worker.action,requestHash:worker.requestHash,outcomeHash,createdAt};
    await client.query(
      `INSERT INTO axiom_worker_operation_receipts(
        worker_id,request_id,worker_key_id,action,request_hash,outcome_json,outcome_hash,created_at,receipt_hash
      ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
      [core.workerId,core.requestId,core.workerKeyId,core.action,core.requestHash,JSON.stringify(outcome),outcomeHash,createdAt,this.receiptHashCore(core)]
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
      protocolVersion:"axiom.worker-lease/v1",workerId:worker.identity.workerId,workerKeyId:worker.identity.keyId,
      poolId:worker.identity.poolId,tenantId:job.intent.tenantId,jobId:job.intent.jobId,intentHash:job.intent.intentHash,
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
    return {job:distributedCloneJob(outcome.job),workerId:outcome.workerId,workerKeyId:outcome.workerKeyId,poolId:outcome.poolId,
      leaseEpoch:outcome.leaseEpoch,leaseExpiresAt:outcome.leaseExpiresAt,capability:this.issueCore(outcome.capabilityCore)};
  }
  private async currentAuthenticatedLease(
    client:PoolClient,scope:TenantScope,jobId:string,worker:AuthenticatedWorkerContext,
    capability:WorkerLeaseCapability,now:string,action:WorkerAction
  ):Promise<DistributedExecutionJob>{
    const record=this.activeWorker(worker,action,jobId),job=this.verified(scope,await this.row(client,scope,jobId,true)),at=distributedIso(now,"now");
    const {signer}=this.authenticatedDeps();
    if(!signer.verify(capability))throw new Error("Invalid lease capability signature");
    const core=capability.core;
    if(
      job.state.status!=="LEASED"||!job.state.leaseWorkerKeyId||!job.state.leasePoolId||!job.state.leaseCapabilityCoreHash||
      job.state.leaseOwner!==worker.identity.workerId||job.state.leaseWorkerKeyId!==worker.identity.keyId||
      job.state.leasePoolId!==worker.identity.poolId||core.workerId!==worker.identity.workerId||
      core.workerKeyId!==worker.identity.keyId||core.poolId!==worker.identity.poolId||
      core.tenantId!==job.intent.tenantId||core.jobId!==job.intent.jobId||core.intentHash!==job.intent.intentHash||
      core.leaseEpoch!==job.state.leaseEpoch||core.leaseExpiresAt!==job.state.leaseExpiresAt||
      workerLeaseCapabilityCoreHash(core)!==job.state.leaseCapabilityCoreHash||!core.allowedActions.includes(action as any)||
      !job.state.leaseExpiresAt||Date.parse(job.state.leaseExpiresAt)<=Date.parse(at)
    )throw new Error("Lease capability is stale or does not match current lease");
    if(record.identity.poolId!==core.poolId)throw new Error("Lease capability worker pool mismatch");
    return job;
  }

  async claimNextAuthenticated(worker:AuthenticatedWorkerContext,now:string,leaseMs:number):Promise<AuthenticatedDistributedExecutionLease|undefined>{
    const at=distributedIso(now,"now"),record=this.activeWorker(worker,"CLAIM"),duration=distributedPositiveLease(leaseMs);
    if(duration>record.maxLeaseMs)throw new RangeError("Requested lease exceeds worker maximum lease");
    this.assertBody(worker,"CLAIM",{leaseMs:duration});
    const expires=new Date(Date.parse(at)+duration).toISOString(),client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const replay=await this.replayReceipt(client,worker);if(replay.found){await client.query("COMMIT");return replay.value as any;}
      const selected=await client.query(
        `SELECT * FROM axiom_distributed_execution_jobs
         WHERE status='PENDING' OR (status='LEASED' AND lease_expires_at<=$1)
         ORDER BY created_at ASC,job_id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,[at]
      );
      if(selected.rowCount===0){await this.putReceipt(client,worker,at,{kind:"NONE"});await client.query("COMMIT");return undefined;}
      const row=selected.rows[0],scope={tenantId:String(row.tenant_id)},job=this.verified(scope,row);
      const nextEpoch=job.state.leaseEpoch+1,core=this.capabilityCore(job,worker,nextEpoch,expires,record);
      const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
        status:"LEASED",leaseEpoch:nextEpoch,attemptCount:job.state.attemptCount+1,leaseOwner:worker.identity.workerId,
        leaseExpiresAt:expires,leaseWorkerKeyId:worker.identity.keyId,leasePoolId:worker.identity.poolId,
        leaseCapabilityCoreHash:workerLeaseCapabilityCoreHash(core)
      })};
      await this.update(client,scope,next);
      const outcome:StoredWorkerOutcome={kind:"LEASE",job:distributedCloneJob(next),workerId:worker.identity.workerId,
        workerKeyId:worker.identity.keyId,poolId:worker.identity.poolId,leaseEpoch:nextEpoch,leaseExpiresAt:expires,capabilityCore:core};
      await this.putReceipt(client,worker,at,outcome);await client.query("COMMIT");return this.leaseFromOutcome(outcome as any);
    }catch(error){
      try{await client.query("ROLLBACK");}catch{}
      if((error as any)?.code==="23505"){
        const retry=await this.pool.connect();try{const replay=await this.replayReceipt(retry,worker);if(replay.found)return replay.value as any;}finally{retry.release();}
      }
      throw error;
    }finally{client.release();}
  }

  async heartbeatAuthenticated(
    scope:TenantScope,jobId:string,worker:AuthenticatedWorkerContext,capability:WorkerLeaseCapability,now:string,leaseMs:number
  ):Promise<AuthenticatedDistributedExecutionLease>{
    const at=distributedIso(now,"now"),record=this.activeWorker(worker,"HEARTBEAT",jobId),duration=distributedPositiveLease(leaseMs);
    if(duration>record.maxLeaseMs)throw new RangeError("Requested lease exceeds worker maximum lease");
    this.assertBody(worker,"HEARTBEAT",{leaseMs:duration,capabilityId:capability.capabilityId});
    const expires=new Date(Date.parse(at)+duration).toISOString(),client=await this.pool.connect();
    try{
      await client.query("BEGIN");const replay=await this.replayReceipt(client,worker);
      if(replay.found){await client.query("COMMIT");return replay.value as AuthenticatedDistributedExecutionLease;}
      const job=await this.currentAuthenticatedLease(client,scope,jobId,worker,capability,at,"HEARTBEAT");
      const core=this.capabilityCore(job,worker,job.state.leaseEpoch,expires,record);
      const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
        status:"LEASED",leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount,
        leaseOwner:worker.identity.workerId,leaseExpiresAt:expires,leaseWorkerKeyId:worker.identity.keyId,
        leasePoolId:worker.identity.poolId,leaseCapabilityCoreHash:workerLeaseCapabilityCoreHash(core)
      })};
      await this.update(client,scope,next);
      const outcome:StoredWorkerOutcome={kind:"LEASE",job:distributedCloneJob(next),workerId:worker.identity.workerId,
        workerKeyId:worker.identity.keyId,poolId:worker.identity.poolId,leaseEpoch:next.state.leaseEpoch,leaseExpiresAt:expires,capabilityCore:core};
      await this.putReceipt(client,worker,at,outcome);await client.query("COMMIT");return this.leaseFromOutcome(outcome as any);
    }catch(error){try{await client.query("ROLLBACK");}catch{}throw error;}finally{client.release();}
  }

  async releaseForRetryAuthenticated(
    scope:TenantScope,jobId:string,worker:AuthenticatedWorkerContext,capability:WorkerLeaseCapability,now:string
  ):Promise<DistributedExecutionJob>{
    const at=distributedIso(now,"now");this.activeWorker(worker,"RELEASE",jobId);
    this.assertBody(worker,"RELEASE",{capabilityId:capability.capabilityId});const client=await this.pool.connect();
    try{
      await client.query("BEGIN");const replay=await this.replayReceipt(client,worker);
      if(replay.found){await client.query("COMMIT");return replay.value as DistributedExecutionJob;}
      const job=await this.currentAuthenticatedLease(client,scope,jobId,worker,capability,at,"RELEASE");
      const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
        status:"PENDING",leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount
      })};
      await this.update(client,scope,next);await this.putReceipt(client,worker,at,{kind:"JOB",job:distributedCloneJob(next)});
      await client.query("COMMIT");return distributedCloneJob(next);
    }catch(error){try{await client.query("ROLLBACK");}catch{}throw error;}finally{client.release();}
  }

  async completeAuthenticated(
    scope:TenantScope,jobId:string,worker:AuthenticatedWorkerContext,capability:WorkerLeaseCapability,now:string,result:ControlPlaneResult
  ):Promise<DistributedExecutionJob>{
    const at=distributedIso(now,"now");this.activeWorker(worker,"COMPLETE",jobId);
    this.assertBody(worker,"COMPLETE",{capabilityId:capability.capabilityId,result});const client=await this.pool.connect();
    try{
      await client.query("BEGIN");const replay=await this.replayReceipt(client,worker);
      if(replay.found){await client.query("COMMIT");return replay.value as DistributedExecutionJob;}
      const job=await this.currentAuthenticatedLease(client,scope,jobId,worker,capability,at,"COMPLETE");
      distributedResultShape(job.intent,result);
      const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
        status:result.status==="APPROVED"?"SUCCEEDED":"DENIED",leaseEpoch:job.state.leaseEpoch,
        attemptCount:job.state.attemptCount,terminalAt:at,result:structuredClone(result),resultHash:hashJson(result as any)
      })};
      await this.update(client,scope,next);await this.putReceipt(client,worker,at,{kind:"JOB",job:distributedCloneJob(next)});
      await client.query("COMMIT");return distributedCloneJob(next);
    }catch(error){try{await client.query("ROLLBACK");}catch{}throw error;}finally{client.release();}
  }

  async failTerminalAuthenticated(
    scope:TenantScope,jobId:string,worker:AuthenticatedWorkerContext,capability:WorkerLeaseCapability,now:string,code:"STALE"|"FAILED_INTEGRITY"
  ):Promise<DistributedExecutionJob>{
    if(code!=="STALE"&&code!=="FAILED_INTEGRITY")throw new TypeError("Unsupported distributed execution terminal failure");
    const at=distributedIso(now,"now");this.activeWorker(worker,"FAIL_TERMINAL",jobId);
    this.assertBody(worker,"FAIL_TERMINAL",{capabilityId:capability.capabilityId,code});const client=await this.pool.connect();
    try{
      await client.query("BEGIN");const replay=await this.replayReceipt(client,worker);
      if(replay.found){await client.query("COMMIT");return replay.value as DistributedExecutionJob;}
      const job=await this.currentAuthenticatedLease(client,scope,jobId,worker,capability,at,"FAIL_TERMINAL");
      const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
        status:code,leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount,terminalAt:at,failureCode:code
      })};
      await this.update(client,scope,next);await this.putReceipt(client,worker,at,{kind:"JOB",job:distributedCloneJob(next)});
      await client.query("COMMIT");return distributedCloneJob(next);
    }catch(error){try{await client.query("ROLLBACK");}catch{}throw error;}finally{client.release();}
  }

}
