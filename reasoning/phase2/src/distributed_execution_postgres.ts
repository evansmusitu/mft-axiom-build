import type { Pool, PoolClient } from "pg";
import type { DistributedExecutionRepository } from "./repositories.ts";
import type {
  ControlPlaneResult, DistributedExecutionIntent, DistributedExecutionIntentCore,
  DistributedExecutionJob, DistributedExecutionLease, TenantScope
} from "./types.ts";
import {
  distributedCloneJob, distributedEpoch, distributedIso, distributedMakeIntent,
  distributedMakeState, distributedPositiveLease, distributedRequired,
  distributedResultShape, distributedRowState, distributedTenantId,
  distributedVerifyIntent, distributedVerifyState
} from "./distributed_execution_store.ts";
import { hashJson } from "../../phase1/src/canonical.ts";

function jsonValue<T>(value:unknown):T{return (typeof value==="string"?JSON.parse(value):value) as T;}

export class PostgresDistributedExecutionRepository implements DistributedExecutionRepository {
  private readonly pool:Pool;
  constructor(pool:Pool){this.pool=pool;}

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
        status=$1,lease_epoch=$2,attempt_count=$3,lease_owner=$4,lease_expires_at=$5,terminal_at=$6,
        result_json=$7::jsonb,result_hash=$8,failure_code=$9,state_hash=$10
       WHERE tenant_id=$11 AND job_id=$12`,
      [
        s.status,s.leaseEpoch,s.attemptCount,s.leaseOwner??null,s.leaseExpiresAt??null,s.terminalAt??null,
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
}
