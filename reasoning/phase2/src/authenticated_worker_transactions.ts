import {DatabaseSync} from "node:sqlite";
import {hashJson} from "../../phase1/src/canonical.ts";
import type {AuthenticatedWorkerContext} from "./worker_authentication.ts";
import {verifyWorkerReceiptSignature,type WorkerLeaseCapability,type WorkerLeaseCapabilitySigner} from "./worker_lease_capability.ts";
import type {DistributedExecutionIntent,DistributedExecutionJob} from "./types.ts";
import {distributedVerifyIntent,distributedRowState,distributedVerifyState} from "./distributed_execution_store.ts";
export interface WorkerReceiptOutcome {kind:"IDLE"|"LEASE"|"JOB";job?:DistributedExecutionJob;core?:any;signedLease?:WorkerLeaseCapability}
function identity(row:any){
 return {domain:"AXIOM_WORKER_OPERATION_RECEIPT_V1",workerId:row.worker_id,
 workerKeyId:row.worker_key_id,requestId:row.request_id,action:row.action,
 requestHash:row.request_hash,outcomeHash:row.outcome_hash,createdAt:row.created_at};
}
export class AuthenticatedJobTransactions {
 readonly db:DatabaseSync;
 private readonly signer:WorkerLeaseCapabilitySigner;
 constructor(path:string,signer:WorkerLeaseCapabilitySigner){
  this.signer=signer;
  this.db=new DatabaseSync(path);
  this.db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS axiom_worker_operation_receipts(
   worker_id TEXT NOT NULL,worker_key_id TEXT NOT NULL,request_id TEXT NOT NULL,
   action TEXT NOT NULL,request_hash TEXT NOT NULL,outcome_json TEXT NOT NULL,
   outcome_hash TEXT NOT NULL,created_at TEXT NOT NULL,receipt_hash TEXT NOT NULL,
   receipt_signer_key_id TEXT NOT NULL,receipt_signature_base64 TEXT NOT NULL,
   PRIMARY KEY(worker_id,request_id));`);
  const receiptColumns=new Set((this.db.prepare("PRAGMA table_info(axiom_worker_operation_receipts)").all() as any[]).map(x=>String(x.name)));
  for(const col of ["receipt_signer_key_id","receipt_signature_base64"]){
   if(!receiptColumns.has(col))this.db.exec(`ALTER TABLE axiom_worker_operation_receipts ADD COLUMN ${col} TEXT`);
  }
  const cols=new Set((this.db.prepare("PRAGMA table_info(distributed_execution_jobs)").all() as any[]).map(x=>String(x.name)));
  if(["lease_worker_key_id","lease_pool_id","lease_capability_hash"].some(x=>!cols.has(x)))
   throw new Error("Authenticated worker schema migration is missing");
 }
 close(){this.db.close();}
 transaction<T>(op:()=>T):T{
  this.db.exec("BEGIN IMMEDIATE");
  try{const r=op();this.db.exec("COMMIT");return r;}
  catch(e){try{this.db.exec("ROLLBACK");}catch{}throw e;}
 }
 verify(row:any):DistributedExecutionJob{
  const scope={tenantId:String(row.tenant_id)};
  const intent=distributedVerifyIntent(scope,JSON.parse(String(row.intent_json)) as DistributedExecutionIntent,String(row.intent_hash));
  if(intent.jobId!==String(row.job_id)||intent.createdAt!==String(row.created_at))throw new Error("Worker job intent integrity mismatch");
  const state=distributedVerifyState(intent,distributedRowState(row),String(row.state_hash));
  return {intent,state};
 }
 row(tenantId:string,jobId:string):any{
  const row=this.db.prepare("SELECT * FROM distributed_execution_jobs WHERE tenant_id=? AND job_id=?").get(tenantId,jobId);
  if(!row)throw new Error("Worker job absent");return row;
 }
 update(job:DistributedExecutionJob){
  const s=job.state;
  const r=this.db.prepare(`UPDATE distributed_execution_jobs SET status=?,lease_epoch=?,attempt_count=?,
   lease_owner=?,lease_expires_at=?,lease_worker_key_id=?,lease_pool_id=?,lease_capability_hash=?,
   terminal_at=?,result_json=?,result_hash=?,failure_code=?,state_hash=? WHERE tenant_id=? AND job_id=?`)
  .run(s.status,s.leaseEpoch,s.attemptCount,s.leaseOwner??null,s.leaseExpiresAt??null,
   s.leaseWorkerKeyId??null,s.leasePoolId??null,s.leaseCapabilityCoreHash??null,
   s.terminalAt??null,s.result===undefined?null:JSON.stringify(s.result),
   s.resultHash??null,s.failureCode??null,s.stateHash,job.intent.tenantId,job.intent.jobId);
  if(Number(r.changes)!==1)throw new Error("Worker state transition lost");
 }
 receipt(worker:AuthenticatedWorkerContext):WorkerReceiptOutcome|undefined{
  const row=this.db.prepare("SELECT * FROM axiom_worker_operation_receipts WHERE worker_id=? AND request_id=?")
   .get(worker.identity.workerId,worker.requestId) as any;
  if(!row)return undefined;
  if(row.worker_key_id!==worker.identity.keyId||row.action!==worker.action||row.request_hash!==worker.requestHash)
   throw new Error("WORKER_REQUEST_CONFLICT");
  const outcome=JSON.parse(String(row.outcome_json));
  if(row.outcome_hash!==hashJson(outcome)||row.receipt_hash!==hashJson(identity(row) as any))
   throw new Error("Worker operation receipt integrity mismatch");
  const trusted=this.signer.trustedPublicKeyPem(row.receipt_signer_key_id);
  if(!trusted||!verifyWorkerReceiptSignature(row.receipt_hash,row.receipt_signer_key_id,
     row.receipt_signature_base64,trusted))
   throw new Error("Worker operation receipt signature integrity mismatch");
  return structuredClone(outcome);
 }
 save(worker:AuthenticatedWorkerContext,outcome:WorkerReceiptOutcome,at:string){
  const row={worker_id:worker.identity.workerId,worker_key_id:worker.identity.keyId,
   request_id:worker.requestId,action:worker.action,request_hash:worker.requestHash,
   outcome_json:JSON.stringify(outcome),outcome_hash:hashJson(outcome as any),created_at:at};
  const receiptHash=hashJson(identity(row) as any);
  const signerKeyId=this.signer.identity.keyId;
  const signature=this.signer.signReceipt(receiptHash);
  this.db.prepare(`INSERT INTO axiom_worker_operation_receipts
  (worker_id,worker_key_id,request_id,action,request_hash,outcome_json,outcome_hash,created_at,receipt_hash,receipt_signer_key_id,receipt_signature_base64)
  VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(row.worker_id,row.worker_key_id,row.request_id,row.action,
  row.request_hash,row.outcome_json,row.outcome_hash,row.created_at,receiptHash,signerKeyId,signature);
 }
}
