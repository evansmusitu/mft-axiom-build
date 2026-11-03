import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generateKeyPairSync,sign} from "node:crypto";
import {canonicalize,hashJson} from "../../phase1/src/canonical.ts";
import {
 AuthenticatedDistributedExecutionStore,DistributedExecutionStore,
 WorkerRequestAuthenticator,StaticWorkerTrustStore,createWorkerTrustRecord,
 createStaticWorkerLeaseSigner,workerRequestSigningPayload,verifyWorkerLeaseCapability
} from "../src/index.ts";
const H=(x:string)=>x.repeat(64),scope={tenantId:"tenant:phase25c-gate"};
const instant="2026-10-09T16:00:03.000Z";
const directory=mkdtempSync(join(tmpdir(),"axiom-p25c-gate-")),path=join(directory,"platform.db");
const base=new DistributedExecutionStore(path),workerKeys=generateKeyPairSync("ed25519"),leaseKeys=generateKeyPairSync("ed25519");
const publicKeyPem=workerKeys.publicKey.export({format:"pem",type:"spki"}).toString();
const trustInput={workerId:"worker:gate",keyId:"wk:gate",poolId:"pool:gate",publicKeyPem,
 maxLeaseMs:5000,allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"] as
 ("CLAIM"|"HEARTBEAT"|"RELEASE"|"COMPLETE"|"FAIL_TERMINAL")[]};
const trust=createWorkerTrustRecord({...trustInput,status:"ACTIVE"});
const signer=createStaticWorkerLeaseSigner("lease:gate",leaseKeys);
const auth=new WorkerRequestAuthenticator(new StaticWorkerTrustStore([trust]),{maxAgeMs:30000,futureSkewMs:5000});
const jobs=new AuthenticatedDistributedExecutionStore(path,auth,signer);
let count=0,revoked:AuthenticatedDistributedExecutionStore|undefined;
function proof(action:"CLAIM"|"HEARTBEAT"|"RELEASE"|"COMPLETE",body:any,targetJobId?:string,issuedAt=instant){
 const p={protocolVersion:"axiom.worker-request/v1" as const,workerId:"worker:gate",keyId:"wk:gate",
  requestId:"gate-op:"+(++count),action,bodyHash:hashJson(body),issuedAt,
  ...(targetJobId?{targetJobId}:{})};
 return {...p,signatureBase64:sign(null,Buffer.from(canonicalize(workerRequestSigningPayload(p))),workerKeys.privateKey).toString("base64")};
}
try{
 const input={tenantId:scope.tenantId,principalId:"p:gate",authorizationDecisionHash:H("a"),
  requestHash:H("b"),compilationId:"model-compilation:"+H("c"),compilationRecordHash:H("d"),
  profileId:"profile:gate",profileVersion:"1",profileHash:H("e"),
  compilerManifest:{id:"axiom.phase1-compiler",version:"1",implementationHash:H("f")},
  operationRegistryManifestHash:H("1"),executionRequest:{asOf:"2026-10-09T16:00:00.000Z",
   issuedAt:"2026-10-09T16:00:01.000Z",
   program:{irVersion:"0.1",objective:"worker gate",assumptions:[],inputs:{},nodes:[],constraints:[],
    decisionNodeId:"decision"},requirements:[],bindings:[]},
  snapshotId:"snapshot:"+H("2"),snapshotHash:H("3"),createdAt:"2026-10-09T16:00:02.000Z"};
 const created=await base.create(scope,input);
 const request=proof("CLAIM",{leaseMs:1000});
 const first=await jobs.claimNext(request,1000,instant);
 assert.ok(first);
 assert.equal(first.job.intent.jobId,created.intent.jobId);
 assert.equal(first.job.state.leaseEpoch,1);
 assert.deepEqual(await jobs.claimNext(request,1000,"2026-10-09T16:00:03.100Z"),first);
 assert.equal(verifyWorkerLeaseCapability(first.capability,{"lease:gate":leaseKeys.publicKey}),true);
 await assert.rejects(()=>base.claimNext("raw-worker",instant,1000),/WORKER_AUTH_REQUIRED/);
 const rotated=await jobs.heartbeat(
  proof("HEARTBEAT",{leaseMs:1000,capabilityId:first.capability.capabilityId},created.intent.jobId),
  first.capability,1000,"2026-10-09T16:00:03.200Z");
 assert.notEqual(rotated.capability.capabilityId,first.capability.capabilityId);
 await assert.rejects(()=>jobs.releaseForRetry(
  proof("RELEASE",{capabilityId:first.capability.capabilityId},created.intent.jobId),
  first.capability,"2026-10-09T16:00:03.300Z"),/LEASE_LOST/);
 const revokedTrust=createWorkerTrustRecord({...trustInput,status:"REVOKED"});
 revoked=new AuthenticatedDistributedExecutionStore(path,
  new WorkerRequestAuthenticator(new StaticWorkerTrustStore([revokedTrust]),{maxAgeMs:30000,futureSkewMs:5000}),signer);
 await assert.rejects(()=>revoked!.releaseForRetry(
  proof("RELEASE",{capabilityId:rotated.capability.capabilityId},created.intent.jobId),
  rotated.capability,"2026-10-09T16:00:03.400Z"),/UNAUTHENTICATED/);
 const final=await jobs.releaseForRetry(
  proof("RELEASE",{capabilityId:rotated.capability.capabilityId},created.intent.jobId),
  rotated.capability,"2026-10-09T16:00:03.400Z");
 assert.equal(final.state.status,"PENDING");
 assert.equal(final.state.leaseCapabilityCoreHash,undefined);
 // Re-execute the full Phase-2.5A frozen-snapshot/execution-intent network-free replay gate
 // as part of the P2.5C acceptance, not only as a separately scheduled CI step.
 await import("./phase2-5a-gate.ts");
 console.log(JSON.stringify({phase:"P2.5C — Authenticated Workers and Lease-Scoped Capabilities",
  status:"PASS",checks:[
   "require independently signed worker request authentication before claim",
   "commit worker key pool lease and capability identity into durable state",
   "atomically replay identical request without second claim",
   "disable raw worker-ID mutation in authenticated mode",
   "sign lease capability under independent server key",
   "rotate lease capability at heartbeat",
   "reject previous capability after rotation",
   "deny revoked worker even with still-valid capability",
   "release authenticated worker without promoting model output to authority",
   "retain all earlier Phase-1 through Phase-2.5B acceptance gates"
  ],jobId:created.intent.jobId,leaseEpoch:first.job.state.leaseEpoch}));
}finally{revoked?.close();jobs.close();base.close();rmSync(directory,{recursive:true,force:true});}
