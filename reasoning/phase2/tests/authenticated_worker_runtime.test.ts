import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {generateKeyPairSync} from "node:crypto";
import {hashJson} from "../../phase1/src/canonical.ts";
import {
 AuthenticatedDistributedExecutionStore,DistributedExecutionStore,createWorkerTrustRecord,
 StaticWorkerTrustStore,WorkerRequestAuthenticator,createStaticWorkerLeaseSigner,
 AuthenticatedDistributedModelExecutionWorker
} from "../src/index.ts";
const scope={tenantId:"tenant:worker-runtime"};
const H=(x:string)=>x.repeat(64);
const at="2026-10-09T16:00:03.000Z";
function intent(){
 return {tenantId:scope.tenantId,principalId:"p",authorizationDecisionHash:H("a"),requestHash:H("b"),
 compilationId:"model-compilation:"+H("c"),compilationRecordHash:H("d"),profileId:"profile",
 profileVersion:"1",profileHash:H("e"),compilerManifest:{id:"axiom.phase1-compiler",version:"1",implementationHash:H("f")},
 operationRegistryManifestHash:H("1"),executionRequest:{asOf:"2026-10-09T16:00:00.000Z",
 issuedAt:"2026-10-09T16:00:01.000Z",program:{irVersion:"0.1",objective:"test",assumptions:[],
 inputs:{},nodes:[],constraints:[],decisionNodeId:"decision"},requirements:[],bindings:[]},
 snapshotId:"snapshot:"+H("2"),snapshotHash:H("3"),createdAt:"2026-10-09T16:00:02.000Z"};
}
test("signed authenticated worker performs trusted bound execution without raw-ID authority",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"axiom-auth-runtime-")),path=join(dir,"jobs.db");
 const legacy=new DistributedExecutionStore(path);
 const wk=generateKeyPairSync("ed25519"),lk=generateKeyPairSync("ed25519");
 const auth=new WorkerRequestAuthenticator(new StaticWorkerTrustStore([
  createWorkerTrustRecord({workerId:"worker:approved",keyId:"wk:approved",poolId:"trusted",
   publicKeyPem:wk.publicKey.export({type:"spki",format:"pem"}).toString(),status:"ACTIVE",
   maxLeaseMs:5000,allowedActions:["CLAIM","HEARTBEAT","COMPLETE","RELEASE","FAIL_TERMINAL"]})
 ]),{maxAgeMs:30000,futureSkewMs:5000});
 const secure=new AuthenticatedDistributedExecutionStore(path,auth,createStaticWorkerLeaseSigner("lease:runtime",lk));
 try{
  const created=await legacy.create(scope,intent());
  let validations=0,executions=0,createdRuntimes=0;
  const worker=new AuthenticatedDistributedModelExecutionWorker({
   jobs:secure,worker:{workerId:"worker:approved",keyId:"wk:approved",privateKey:wk.privateKey},
   leaseMs:5000,clock:()=>at,
   runtimes:{create(tenant:any){
    createdRuntimes++;assert.deepEqual(tenant,scope);
    return {
     modelExecutor:{async validatePrepared(){validations++;return {};}},
     executions:{async getByIntent(){return undefined;}},
     plane:{async executeBound(request:any,snapshotId:string,executionId:string){
      executions++;assert.equal(snapshotId,created.intent.snapshotId);
      assert.equal(executionId,created.intent.jobId);
      return {status:"APPROVED",snapshotId,policyDecision:{status:"ALLOW",snapshotId,checks:[]},
        certificateId:"cert:runtime",executionRecordId:"platform:runtime"};
     }}
    };
   }}
  });
  const result=await worker.runOnce();
  assert.deepEqual(result,{status:"COMPLETED",jobId:created.intent.jobId,jobStatus:"SUCCEEDED"});
  assert.equal((await legacy.get(scope,created.intent.jobId)).state.status,"SUCCEEDED");
  assert.equal(validations,1);assert.equal(executions,1);assert.equal(createdRuntimes,1);
  await assert.rejects(()=>legacy.claimNext("raw-worker",at,1000),/WORKER_AUTH_REQUIRED/);
 }finally{secure.close();legacy.close();rmSync(dir,{recursive:true,force:true});}
});

test("revocation during in-flight reasoning prevents authenticated completion and leaves lease recoverable",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"axiom-revoked-runtime-")),path=join(dir,"jobs.db");
 const legacy=new DistributedExecutionStore(path);
 const wk=generateKeyPairSync("ed25519"),lk=generateKeyPairSync("ed25519");
 const common={workerId:"worker:revocation",keyId:"wk:revocation",poolId:"trusted",
  publicKeyPem:wk.publicKey.export({type:"spki",format:"pem"}).toString(),
  maxLeaseMs:5000,allowedActions:["CLAIM","HEARTBEAT","COMPLETE","RELEASE","FAIL_TERMINAL"] as
   ("CLAIM"|"HEARTBEAT"|"COMPLETE"|"RELEASE"|"FAIL_TERMINAL")[]};
 const active=createWorkerTrustRecord({...common,status:"ACTIVE"});
 const revokedRecord=createWorkerTrustRecord({...common,status:"REVOKED"});
 let revoked=false;
 const auth=new WorkerRequestAuthenticator({get(workerId:string,keyId:string){
  return workerId===common.workerId&&keyId===common.keyId?(revoked?revokedRecord:active):undefined;
 }},{maxAgeMs:30000,futureSkewMs:5000});
 const secure=new AuthenticatedDistributedExecutionStore(path,auth,createStaticWorkerLeaseSigner("lease:revoked",lk));
 try{
  const job=await legacy.create(scope,intent());
  const worker=new AuthenticatedDistributedModelExecutionWorker({
   jobs:secure,worker:{workerId:common.workerId,keyId:common.keyId,privateKey:wk.privateKey},
   leaseMs:5000,clock:()=>at,runtimes:{create(){
    return {
     modelExecutor:{async validatePrepared(){return {};}},
     executions:{async getByIntent(){return undefined;}},
     plane:{async executeBound(){
      revoked=true;
      return {status:"APPROVED",snapshotId:job.intent.snapshotId,
       policyDecision:{status:"ALLOW",snapshotId:job.intent.snapshotId,checks:[]},
       certificateId:"cert:revoked",executionRecordId:"platform:revoked"};
     }}
    };
   }}
  });
  const outcome=await worker.runOnce();
  assert.deepEqual(outcome,{status:"LEASE_LOST",jobId:job.intent.jobId});
  const current=await legacy.get(scope,job.intent.jobId);
  assert.equal(current.state.status,"LEASED");
  assert.equal(current.state.leaseEpoch,1);
 }finally{secure.close();legacy.close();rmSync(dir,{recursive:true,force:true});}
});
