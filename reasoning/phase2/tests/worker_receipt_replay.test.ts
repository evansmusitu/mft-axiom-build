import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const A={tenantId:"tenant:p25c:receipt-replay"};
const H=(c:string)=>c.repeat(64);
function intent(overrides:Record<string,unknown>={}){
  return {
    tenantId:A.tenantId,principalId:"principal:dispatch",authorizationDecisionHash:H("a"),requestHash:H("b"),
    compilationId:"model-compilation:"+H("c"),compilationRecordHash:H("d"),profileId:"profile:p25c-receipt",
    profileVersion:"1.0.0",profileHash:H("e"),compilerManifest:{id:"axiom.phase1-compiler",version:"1.0.0",implementationHash:H("f")},
    operationRegistryManifestHash:H("1"),
    executionRequest:{asOf:"2026-10-10T00:00:00.000Z",issuedAt:"2026-10-10T00:00:01.000Z",
      program:{irVersion:"0.1",objective:"receipt replay",assumptions:[],inputs:{},nodes:[{id:"decision",kind:"Decision",operation:"boolean.and",inputs:{values:{literal:{type:{kind:"array",items:{kind:"boolean"}},value:[true]}}}}],constraints:[],decisionNodeId:"decision"},
      requirements:[],bindings:[]},
    snapshotId:"snapshot:"+H("2"),snapshotHash:H("2"),createdAt:"2026-10-10T00:00:02.000Z",...overrides
  };
}

test("exact receipted worker retry may replay after freshness expiry but a new stale request cannot mutate",async()=>{
  const phase2:any=await import("../src/index.ts");
  const workerKeys=generateKeyPairSync("ed25519"),leaseKeys=generateKeyPairSync("ed25519");
  const record=phase2.createWorkerTrustRecord({
    workerId:"worker:receipt",keyId:"worker-key:receipt:v1",poolId:"pool:receipt",publicKey:workerKeys.publicKey,
    status:"ACTIVE",maxLeaseMs:5000,allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]
  });
  const trustStore=phase2.createWorkerTrustStore([record]);
  const authenticator=new phase2.WorkerRequestAuthenticator({trustStore,maxRequestAgeMs:1000,maxFutureSkewMs:0});
  const leaseSigner=phase2.createStaticWorkerLeaseSigner("lease:receipt:v1",leaseKeys);
  const credential=phase2.createStaticWorkerCredential("worker:receipt","worker-key:receipt:v1",workerKeys.privateKey);
  const dir=mkdtempSync(join(tmpdir(),"axiom-p25c-receipt-replay-")),db=join(dir,"jobs.db");
  const jobs:any=new phase2.DistributedExecutionStore(db,{workerTrustStore:trustStore,leaseSigner});
  try{
    const first=await jobs.create(A,intent());
    const second=await jobs.create(A,intent({requestHash:H("3"),compilationId:"model-compilation:"+H("3")}));
    const control=new phase2.AuthenticatedDistributedWorkerControl({jobs,authenticator});
    const issuedAt="2026-10-10T00:00:03.000Z";
    const bodyHash=phase2.distributedWorkerOperationBodyHash("CLAIM",{leaseMs:1000});
    const proof=credential.sign({requestId:"request:receipt:1",action:"CLAIM",bodyHash,issuedAt});

    const firstLease=await control.claim(proof,"2026-10-10T00:00:03.100Z",1000);
    assert.equal(firstLease.job.intent.jobId,first.intent.jobId);

    const replay=await control.claim(proof,"2026-10-10T00:00:05.000Z",1000);
    assert.deepEqual(replay,firstLease);
    assert.equal((await jobs.get(A,second.intent.jobId)).state.status,"PENDING");

    const staleNew=credential.sign({requestId:"request:receipt:new",action:"CLAIM",bodyHash,issuedAt});
    await assert.rejects(
      ()=>control.claim(staleNew,"2026-10-10T00:00:05.000Z",1000),
      /old|age|expired|fresh|worker/i
    );
    assert.equal((await jobs.get(A,second.intent.jobId)).state.status,"PENDING");
  }finally{
    jobs.close();rmSync(dir,{recursive:true,force:true});
  }
});
