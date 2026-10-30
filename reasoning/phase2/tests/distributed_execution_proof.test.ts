import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import * as phase2 from "../src/index.ts";
import { compilerManifest, createDefaultRegistry, createSigner, hashJson } from "../../phase1/src/index.ts";

const scope={tenantId:"tenant:proof-regression"},at="2026-10-29T12:00:00.000Z",H="a".repeat(64);
function program():any{return {irVersion:"0.1",objective:"A bounded internal decision",assumptions:[],inputs:{},nodes:[{id:"decision",kind:"Decision",operation:"logic.not",inputs:{value:{literal:{type:{kind:"boolean"},value:false}}}}],constraints:[],decisionNodeId:"decision"};}
function request(){return {asOf:at,issuedAt:at,program:program(),requirements:[],bindings:[]};}
function intent(snapshot:any={snapshotId:"snapshot:fixture",snapshotHash:H}){return {
  tenantId:scope.tenantId,principalId:"principal",authorizationDecisionHash:H,requestHash:H,compilationId:"compilation",compilationRecordHash:H,profileId:"profile",profileVersion:"1",profileHash:H,compilerManifest:compilerManifest(),operationRegistryManifestHash:hashJson(createDefaultRegistry().manifest()),executionRequest:request(),snapshotId:snapshot.snapshotId,snapshotHash:snapshot.snapshotHash,createdAt:at
};}
function workerConfig(){
  const workerKeys=generateKeyPairSync("ed25519"),leaseKeys=generateKeyPairSync("ed25519");
  const record=phase2.createWorkerTrustRecord({workerId:"worker",keyId:"worker-key",poolId:"pool",publicKey:workerKeys.publicKey,status:"ACTIVE",maxLeaseMs:5000,allowedActions:["CLAIM","COMPLETE"]});
  const workerTrustStore={get:(workerId:string,keyId:string)=>workerId==="worker"&&keyId==="worker-key"?record:undefined};
  return {
    workerTrustStore,leaseSigner:phase2.createStaticWorkerLeaseSigner("lease-key",leaseKeys),
    authenticator:new phase2.WorkerRequestAuthenticator({trustStore:workerTrustStore,maxRequestAgeMs:60000,maxFutureSkewMs:0}),
    credential:phase2.createStaticWorkerCredential("worker","worker-key",workerKeys.privateKey)
  };
}
async function leased(store:any,config:any,body:any,leaseMs=5000){
  const created=await store.create(scope,body);
  const claim=config.credential.sign({requestId:"claim",action:"CLAIM",bodyHash:phase2.distributedWorkerOperationBodyHash("CLAIM",{leaseMs}),issuedAt:at});
  const context=config.authenticator.authenticate(claim,{action:"CLAIM",bodyHash:claim.bodyHash,now:at});
  const lease=await store.claimNextAuthenticated(context,at,leaseMs);
  return {created,lease};
}
function completion(config:any,lease:any,result:any,id="complete"){
  const proof=config.credential.sign({requestId:id,action:"COMPLETE",targetJobId:lease.job.intent.jobId,bodyHash:phase2.distributedWorkerOperationBodyHash("COMPLETE",{capabilityId:lease.capability.capabilityId,result}),issuedAt:at});
  return config.authenticator.authenticate(proof,{action:"COMPLETE",targetJobId:lease.job.intent.jobId,bodyHash:proof.bodyHash,now:at});
}

test("authenticated completion without a configured persisted-proof verifier fails closed",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-unverified-result-")),config=workerConfig();
  const store=new phase2.DistributedExecutionStore(join(dir,"jobs.db"),config);
  try{
    const {lease}=await leased(store,config,intent());
    const result:any={status:"APPROVED",snapshotId:lease.job.intent.snapshotId,policyDecision:{status:"ALLOW",snapshotId:lease.job.intent.snapshotId,checks:[]},certificateId:"nonexistent-certificate",executionRecordId:"nonexistent-execution"};
    await assert.rejects(()=>store.completeAuthenticated(scope,lease.job.intent.jobId,completion(config,lease,result),lease.capability,at,result),/proof.*verif|verif.*proof/i);
    assert.equal((await store.get(scope,lease.job.intent.jobId)).state.status,"LEASED");
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

async function persistedFixture(){
  const dir=mkdtempSync(join(tmpdir(),"axiom-resolved-result-")),path=join(dir,"state.db"),config=workerConfig();
  const world=new phase2.WorldStateStore(path),executions=new phase2.ExecutionStore(path),registry=createDefaultRegistry(),signer=phase2.createStaticSignerProvider("proof-key",createSigner());
  const verifier=new phase2.PersistedDistributedCompletionVerifier({world,executions,registry,signer});
  const store=new phase2.DistributedExecutionStore(path,{...config,completionVerifier:verifier});
  const snapshot=await world.snapshot(scope,at),{lease}=await leased(store,config,intent(snapshot));
  const plane=new phase2.ReasoningControlPlane({tenant:scope,world,executions,registry,signer});
  const result=await plane.executeBound(request(),snapshot.snapshotId,lease.job.intent.jobId);
  return {dir,path,config,world,executions,registry,signer,verifier,store,snapshot,lease,result,
    close(){store.close();executions.close();world.close();rmSync(dir,{recursive:true,force:true});}};
}

test("authenticated success resolves durable proof, rejects missing references and replays the actual signature",async()=>{
  const f=await persistedFixture();
  try{
    const missing={...f.result,certificateId:"missing",executionRecordId:"missing"};
    await assert.rejects(()=>f.store.completeAuthenticated(scope,f.lease.job.intent.jobId,completion(f.config,f.lease,missing,"missing"),f.lease.capability,at,missing),/not found/i);
    assert.equal((await f.store.get(scope,f.lease.job.intent.jobId)).state.status,"LEASED");

    const original=await f.executions.get(scope,f.result.executionRecordId!);
    const changed=structuredClone(original);changed.certificate.signature=Buffer.alloc(64,9).toString("base64");
    const core:any={...changed};delete core.recordHash;changed.recordHash=hashJson(core);
    const raw=new DatabaseSync(f.path);
    raw.prepare("UPDATE platform_executions SET record_hash=?,record_json=? WHERE tenant_id=? AND id=?").run(changed.recordHash,JSON.stringify(changed),scope.tenantId,changed.id);
    raw.prepare("UPDATE execution_intents SET record_hash=? WHERE tenant_id=? AND execution_id=?").run(changed.recordHash,scope.tenantId,changed.id);
    const badSignature=completion(f.config,f.lease,f.result,"bad-signature");
    await assert.rejects(()=>f.store.completeAuthenticated(scope,f.lease.job.intent.jobId,badSignature,f.lease.capability,at,f.result),/replay verification failed.*signature/i);
    assert.equal((await f.store.get(scope,f.lease.job.intent.jobId)).state.status,"LEASED");

    raw.prepare("UPDATE platform_executions SET record_hash=?,record_json=? WHERE tenant_id=? AND id=?").run(original.recordHash,JSON.stringify(original),scope.tenantId,original.id);
    raw.prepare("UPDATE execution_intents SET record_hash=? WHERE tenant_id=? AND execution_id=?").run(original.recordHash,scope.tenantId,original.id);raw.close();
    const proof=completion(f.config,f.lease,f.result,"valid-completion");
    const done=await f.store.completeAuthenticated(scope,f.lease.job.intent.jobId,proof,f.lease.capability,at,f.result);
    assert.equal(done.state.status,"SUCCEEDED");
    assert.deepEqual((await f.store.completeAuthenticated(scope,f.lease.job.intent.jobId,proof,f.lease.capability,at,f.result)).state.result,f.result);
  }finally{f.close();}
});

test("persisted proof binds the exact tenant, job intent, request, snapshot and reported result",async()=>{
  const f=await persistedFixture();
  try{
    for(const change of [
      {jobId:"other-job"},
      {executionRequest:{...request(),program:{...program(),objective:"Different objective"}}},
      {snapshotHash:"b".repeat(64)},
      {compilerManifest:{...compilerManifest(),implementationHash:"b".repeat(64)}},
      {operationRegistryManifestHash:"b".repeat(64)},
    ])await assert.rejects(()=>f.verifier.verify(scope,{...f.lease.job.intent,...change} as any,f.result),/proof.*mismatch|binding mismatch/i);
    await assert.rejects(()=>f.verifier.verify({tenantId:"other-tenant"},f.lease.job.intent,f.result),/tenant mismatch/i);
    await assert.rejects(()=>f.verifier.verify(scope,f.lease.job.intent,{...f.result,status:"DENIED"}),/does not match/i);
  }finally{f.close();}
});

test("Postgres authenticated completion uses the same resolver before a transaction or terminal update",async()=>{
  const f=await persistedFixture();
  try{
    const raw=new DatabaseSync(f.path),row=raw.prepare("SELECT * FROM distributed_execution_jobs WHERE job_id=?").get(f.lease.job.intent.jobId);raw.close();
    const queries:string[]=[];let connections=0,proofCalls=0;
    const pool:any={async connect(){connections++;return {async query(sql:string){
      queries.push(sql);
      if(sql.startsWith("SELECT * FROM axiom_distributed_execution_jobs"))return {rowCount:1,rows:[row]};
      if(sql.includes("FROM axiom_worker_operation_receipts"))return {rowCount:0,rows:[]};
      return {rowCount:1,rows:[]};
    },release(){connections--;}};}};
    const repo=new phase2.PostgresDistributedExecutionRepository(pool,{...f.config,completionVerifier:{async verify(s:any,i:any,r:any){
      proofCalls++;assert.equal(connections,0,"proof must not hold a connection while resolving shared-pool records");
      return f.verifier.verify(s,i,r);
    }}});
    const missing={...f.result,certificateId:"missing",executionRecordId:"missing"};
    await assert.rejects(()=>repo.completeAuthenticated(scope,f.lease.job.intent.jobId,completion(f.config,f.lease,missing,"pg-missing"),f.lease.capability,at,missing),/not found/i);
    assert.equal(queries.some(sql=>sql==="BEGIN"||sql.startsWith("UPDATE")),false);
    queries.length=0;
    const done=await repo.completeAuthenticated(scope,f.lease.job.intent.jobId,completion(f.config,f.lease,f.result,"pg-valid"),f.lease.capability,at,f.result);
    assert.equal(done.state.status,"SUCCEEDED");assert.equal(proofCalls,2);
    assert.ok(queries.some(sql=>sql.includes("FOR UPDATE")),"lease must be rechecked under row lock after proof resolution");
    assert.ok(queries.some(sql=>sql.startsWith("UPDATE axiom_distributed_execution_jobs")));
    assert.equal(connections,0);
  }finally{f.close();}
});

test("authenticated repositories cannot be downgraded through legacy worker lifecycle methods",async()=>{
  const f=await persistedFixture();
  try{
    const pg=new phase2.PostgresDistributedExecutionRepository({connect:async()=>{throw new Error("must not access database");}} as any,f.config);
    for(const store of [f.store,pg]){
      await assert.rejects(()=>store.claimNext("worker",at,5000),/legacy.*disabled/i);
      await assert.rejects(()=>store.heartbeat(scope,f.lease.job.intent.jobId,"worker",1,at,5000),/legacy.*disabled/i);
      await assert.rejects(()=>store.releaseForRetry(scope,f.lease.job.intent.jobId,"worker",1,at),/legacy.*disabled/i);
      await assert.rejects(()=>store.complete(scope,f.lease.job.intent.jobId,"worker",1,at,f.result),/legacy.*disabled/i);
      await assert.rejects(()=>store.failTerminal(scope,f.lease.job.intent.jobId,"worker",1,at,"STALE"),/legacy.*disabled/i);
    }
  }finally{f.close();}
});

test("identical concurrent completion requests share one verified durable terminal result",async()=>{
  const f=await persistedFixture();
  try{
    const proof=completion(f.config,f.lease,f.result,"concurrent");
    const [a,b]=await Promise.all([
      f.store.completeAuthenticated(scope,f.lease.job.intent.jobId,proof,f.lease.capability,at,f.result),
      f.store.completeAuthenticated(scope,f.lease.job.intent.jobId,proof,f.lease.capability,at,f.result)
    ]);
    assert.deepEqual(a,b);assert.equal(a.state.status,"SUCCEEDED");
  }finally{f.close();}
});

test("a lease expiring during server proof resolution cannot complete",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-proof-expiry-")),config=workerConfig();
  const store=new phase2.DistributedExecutionStore(join(dir,"jobs.db"),{...config,completionVerifier:{async verify(){await new Promise(resolve=>setTimeout(resolve,40));}}});
  try{
    const {lease}=await leased(store,config,intent(),10);
    const result:any={status:"APPROVED",snapshotId:lease.job.intent.snapshotId,policyDecision:{status:"ALLOW",snapshotId:lease.job.intent.snapshotId,checks:[]},certificateId:"fixture",executionRecordId:"fixture"};
    await assert.rejects(()=>store.completeAuthenticated(scope,lease.job.intent.jobId,completion(config,lease,result),lease.capability,at,result),/lease.*stale|stale.*lease/i);
    assert.equal((await store.get(scope,lease.job.intent.jobId)).state.status,"LEASED");
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
