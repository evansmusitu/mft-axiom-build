import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,randomUUID} from "node:crypto";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {canonicalize,hashJson} from "../../phase1/src/canonical.ts";
import {
 AuthenticatedDistributedExecutionStore,DistributedExecutionStore,
 createWorkerTrustRecord,StaticWorkerTrustStore,WorkerRequestAuthenticator,
 createStaticWorkerLeaseSigner,workerRequestSigningPayload
} from "../src/index.ts";
import {VerifiedRemoteCompletionService} from "../src/verified_remote_completion.ts";
const H=(x:string)=>x.repeat(64);
const tenant={tenantId:"tenant:verified-completion"},at="2026-11-02T08:00:03.000Z",later="2026-11-02T08:00:04.000Z";
function intent(){
 return {tenantId:tenant.tenantId,principalId:"principal:verified",authorizationDecisionHash:H("a"),
  requestHash:H("b"),compilationId:"model-compilation:"+H("c"),compilationRecordHash:H("d"),
  profileId:"profile:verified",profileVersion:"1",profileHash:H("e"),
  compilerManifest:{id:"axiom.phase1-compiler",version:"1",implementationHash:H("f")},
  operationRegistryManifestHash:H("1"),executionRequest:{asOf:"2026-11-02T08:00:00.000Z",
   issuedAt:"2026-11-02T08:00:01.000Z",program:{irVersion:"0.1",objective:"verified",
   assumptions:[],inputs:{},nodes:[],constraints:[],decisionNodeId:"decision"},requirements:[],bindings:[]},
  snapshotId:"snapshot:"+H("2"),snapshotHash:H("3"),createdAt:"2026-11-02T08:00:02.000Z"};
}
function proof(key:any,action:"CLAIM"|"COMPLETE",body:any,targetJobId?:string,override:any={}){
 const core={protocolVersion:"axiom.worker-request/v1" as const,workerId:"worker:verified",
 keyId:"wk:verified",requestId:randomUUID(),action,bodyHash:hashJson(body),issuedAt:at,
 ...(targetJobId?{targetJobId}:{}),...override};
 return {...core,signatureBase64:sign(null,Buffer.from(canonicalize(workerRequestSigningPayload(core))),key.privateKey).toString("base64")};
}
async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),"axiom-completion-")),path=join(dir,"jobs.db");
 const raw=new DistributedExecutionStore(path),wk=generateKeyPairSync("ed25519"),lk=generateKeyPairSync("ed25519");
 const worker=createWorkerTrustRecord({workerId:"worker:verified",keyId:"wk:verified",poolId:"pool:verified",
  publicKeyPem:wk.publicKey.export({type:"spki",format:"pem"}).toString(),status:"ACTIVE",
  maxLeaseMs:5000,allowedActions:["CLAIM","COMPLETE","HEARTBEAT","RELEASE","FAIL_TERMINAL"]});
 const auth=new WorkerRequestAuthenticator(new StaticWorkerTrustStore([worker]),
  {maxAgeMs:30000,futureSkewMs:5000});
 const leaseSigner=createStaticWorkerLeaseSigner("lease:verified",lk);
 const secure=new AuthenticatedDistributedExecutionStore(path,auth,leaseSigner);
 const job=await raw.create(tenant,intent());
 const lease=(await secure.claimNext(proof(wk,"CLAIM",{leaseMs:5000}),5000,at))!;
 const policy={status:"ALLOW" as const,snapshotId:job.intent.snapshotId,checks:[]};
 const body={status:"APPROVED" as const,snapshotId:job.intent.snapshotId,policyDecision:policy,
  certificateId:"certificate:verified",executionRecordId:"execution:verified"};
 const recordCore={
  id:"execution:verified",tenantId:tenant.tenantId,snapshotId:job.intent.snapshotId,
  snapshotHash:job.intent.snapshotHash,policyDecision:policy,policyManifest:{
   id:"axiom.evidence-policy",version:"1",implementationHash:H("a")},
  requirements:[],bindings:[],platformContextHash:H("b"),
  certificate:{certificateId:"certificate:verified",core:{decisionStatus:"APPROVED"}},
  signerKeyId:"signer:verified",executionIntentId:job.intent.jobId,
  executionRequestHash:hashJson(job.intent.executionRequest)};
 let record:any={...recordCore,recordHash:hashJson(recordCore as any)};
 let replayStatus="MATCH",recordReads=0,jobReads=0,replayCount=0;
 const repo={
  async getByIntent(scope:any,id:string){recordReads++;assert.deepEqual(scope,tenant);
   assert.equal(id,job.intent.jobId);return record;}
 };
 const jobReader={async get(scope:any,id:string){jobReads++;return raw.get(scope,id);}};
 const replay={create(scope:any){assert.deepEqual(scope,tenant);
  return {async replayStored(id:string){replayCount++;assert.equal(id,record.id);
   return {status:replayStatus,diagnostics:replayStatus==="MATCH"?[]:["cert mismatch"]};}};}};
 const service=new VerifiedRemoteCompletionService({jobs:secure,auth,leaseSigner,
  jobReader,executions:repo,replayFactory:replay} as any);
 const candidate=()=>proof(wk,"COMPLETE",{capabilityId:lease.capability.capabilityId,result:body},
  job.intent.jobId);
 return {
  service,job,raw,secure,lease,body,wk,repo,replay,
  candidate,record:()=>record,setRecord:(v:any)=>{record=v;},
  setReplay:(v:string)=>{replayStatus=v;},
  readings:()=>({jobReads,recordReads,replayCount}),
  clean(){secure.close();raw.close();rmSync(dir,{recursive:true,force:true});}
 };
}
test("verified remote completion permits exact stored intent and replay-matching signed result, then replays receipt",async()=>{
 const f=await fixture();
 try{
  const p=f.candidate();
  const result=await f.service.complete(p,f.lease.capability,f.body,later);
  assert.equal(result.state.status,"SUCCEEDED");
  assert.equal((await f.raw.get(tenant,f.job.intent.jobId)).state.status,"SUCCEEDED");
  const repeated=await f.service.complete(p,f.lease.capability,f.body,later);
  assert.deepEqual(repeated,result);
  assert.equal((await f.raw.get(tenant,f.job.intent.jobId)).state.leaseEpoch,1);
  assert.ok(f.readings().replayCount>=1);
 }finally{f.clean();}
});
test("unknown or forged worker cannot read tenant job or signed execution records before authentication",async()=>{
 const f=await fixture();
 try{
  const fake=f.candidate();fake.workerId="worker:attacker";
  const before=f.readings();
  await assert.rejects(()=>f.service.complete(fake,f.lease.capability,f.body,later),/WORKER_UNAUTHENTICATED|REMOTE_COMPLETION/i);
  assert.deepEqual(f.readings(),before);
  assert.equal((await f.raw.get(tenant,f.job.intent.jobId)).state.status,"LEASED");
 }finally{f.clean();}
});
test("unpersisted, corrupted, cross-tenant, wrong-snapshot, changed-request and replay-mismatched remote claims fail closed",async()=>{
 const f=await fixture();
 try{
  const original=f.record(),mutate=(alter:(v:any)=>void)=>{const v=structuredClone(original);alter(v);
   const {recordHash:_,...core}=v;v.recordHash=hashJson(core);return v;};
  const failure=async()=>{await assert.rejects(()=>f.service.complete(f.candidate(),
   f.lease.capability,f.body,later),/REMOTE_COMPLETION_UNVERIFIED|integrity|mismatch/i);
   assert.equal((await f.raw.get(tenant,f.job.intent.jobId)).state.status,"LEASED");};
  f.setRecord(undefined);await failure();
  f.setRecord({...original,recordHash:H("0")});await failure();
  f.setRecord(mutate(v=>v.tenantId="tenant:other"));await failure();
  f.setRecord(mutate(v=>v.snapshotHash=H("9")));await failure();
  f.setRecord(mutate(v=>v.executionRequestHash=H("8")));await failure();
  f.setRecord(mutate(v=>v.executionIntentId="execution-job:forged"));await failure();
  f.setRecord(mutate(v=>{delete v.certificate;}));await failure();
  f.setRecord(original);f.setReplay("MISMATCH");await failure();
  f.setReplay("MATCH");
  await assert.rejects(()=>f.service.complete(f.candidate(),f.lease.capability,
   {...f.body,status:"DENIED"},later),/REMOTE_COMPLETION_UNVERIFIED|mismatch/i);
  assert.equal((await f.raw.get(tenant,f.job.intent.jobId)).state.status,"LEASED");
 }finally{f.clean();}
});

test("real Phase-1 signed certificate and frozen snapshot replay authorize remote completion exactly once",async()=>{
 const {createSigner,createDefaultRegistry}=await import("../../phase1/src/index.ts");
 const phase=await import("../src/index.ts");
 const dir=mkdtempSync(join(tmpdir(),"axiom-real-completion-"));
 const platformPath=join(dir,"platform.db"),jobsPath=join(dir,"jobs.db");
 const world=new phase.WorldStateStore(platformPath);
 const executions=new phase.ExecutionStore(platformPath);
 const raw=new DistributedExecutionStore(jobsPath);
 const wk=generateKeyPairSync("ed25519"),lk=generateKeyPairSync("ed25519");
 const worker=createWorkerTrustRecord({workerId:"worker:verified",keyId:"wk:verified",
  poolId:"pool:verified",publicKeyPem:wk.publicKey.export({type:"spki",format:"pem"}).toString(),
  status:"ACTIVE",maxLeaseMs:5000,allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]});
 const auth=new WorkerRequestAuthenticator(new StaticWorkerTrustStore([worker]),
  {maxAgeMs:30000,futureSkewMs:1000});
 const leaseSigner=createStaticWorkerLeaseSigner("lease:verified-real",lk);
 const secure=new AuthenticatedDistributedExecutionStore(jobsPath,auth,leaseSigner);
 try{
  await world.putFact(tenant,{id:"risk-limit:real",entity:"risk:alpha",attribute:"max_vol",
   value:{type:{kind:"number",unit:"ratio"},value:0.3},
   validFrom:"2026-11-02T07:00:00.000Z",observedAt:"2026-11-02T07:59:00.000Z",
   source:"risk:trusted",confidence:1});
  const program=JSON.parse(readFileSync(new URL("../../phase1/fixtures/xau-risk-program.json",import.meta.url),"utf8"));
  const request={asOf:"2026-11-02T08:00:00.000Z",issuedAt:"2026-11-02T08:00:01.000Z",
   program,requirements:[{id:"fresh-risk",entity:"risk:alpha",attribute:"max_vol",maxAgeMs:120000}],
   bindings:[{inputName:"max_vol",entity:"risk:alpha",attribute:"max_vol"}]};
  const snapshot=await world.snapshot(tenant,request.asOf);
  const job=await raw.create(tenant,{tenantId:tenant.tenantId,principalId:"principal:verified",
   authorizationDecisionHash:H("a"),requestHash:H("b"),
   compilationId:"model-compilation:"+H("c"),compilationRecordHash:H("d"),
   profileId:"profile:verified",profileVersion:"1",profileHash:H("e"),
   compilerManifest:{id:"axiom.phase1-compiler",version:"1",implementationHash:H("f")},
   operationRegistryManifestHash:H("1"),executionRequest:request,snapshotId:snapshot.snapshotId,
   snapshotHash:snapshot.snapshotHash,createdAt:"2026-11-02T08:00:02.000Z"});
  const trustedPlane=new phase.ReasoningControlPlane({tenant,world,executions,
   signer:phase.createStaticSignerProvider("key:verified-real",createSigner()),
   registry:createDefaultRegistry()});
  const result=await trustedPlane.executeBound(request,snapshot.snapshotId,job.intent.jobId);
  assert.equal(result.status,"APPROVED");assert.ok(result.certificateId);
  assert.deepEqual(await trustedPlane.replayStored(result.executionRecordId!),{status:"MATCH",diagnostics:[]});
  const lease=(await secure.claimNext(proof(wk,"CLAIM",{leaseMs:5000}),5000,at))!;
  assert.equal(lease.job.intent.jobId,job.intent.jobId);
  const verifier=new VerifiedRemoteCompletionService({jobs:secure,auth,leaseSigner,jobReader:raw,
   executions,replayFactory:{create(){return trustedPlane;}}});
  const signed=proof(wk,"COMPLETE",{capabilityId:lease.capability.capabilityId,result},job.intent.jobId);
  const server=phase.createAxiomWorkerControlHttpServer({
   jobs:secure,clock:()=>later,trustedIngress:()=>true,verifiedCompletion:verifier
  });
  await new Promise<void>((resolve,reject)=>server.once("error",reject).listen(0,"127.0.0.1",resolve));
  try{
   const address=server.address() as {port:number},base="http://127.0.0.1:"+address.port;
   const route="/v1/worker/jobs/"+encodeURIComponent(job.intent.jobId)+"/complete";
   const send=async(path:string,value:unknown)=>{
    const response=await fetch(base+path,{method:"POST",headers:{"content-type":"application/json"},
     body:JSON.stringify(value)});
    return {status:response.status,body:await response.json()};
   };
   const completedHttp=await send(route,{proof:signed,capability:lease.capability,result});
   assert.deepEqual(completedHttp,{status:200,body:{status:"COMPLETED",
    jobId:job.intent.jobId,jobStatus:"SUCCEEDED"}});
   assert.deepEqual(await send(route,{proof:signed,capability:lease.capability,result}),completedHttp);
   const forged={...result,status:"DENIED" as const};
   const badProof=proof(wk,"COMPLETE",{capabilityId:lease.capability.capabilityId,
    result:forged},job.intent.jobId);
   const denied=await send(route,{proof:badProof,capability:lease.capability,result:forged});
   assert.equal(denied.status,409);
   assert.equal(denied.body.error.code,"WORKER_COMPLETION_UNVERIFIED");
   assert.equal((await send("/v1/worker/jobs/"+encodeURIComponent(job.intent.jobId)+"/fail-terminal",
    {proof:signed,capability:lease.capability,result})).status,404);
  }finally{
   await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  }
  const completed=await verifier.complete(signed,lease.capability,result,later);
  assert.equal(completed.state.status,"SUCCEEDED");
  assert.deepEqual(completed.state.result,result);
  assert.deepEqual(await verifier.complete(signed,lease.capability,result,later),completed);
  assert.equal((await raw.get(tenant,job.intent.jobId)).state.status,"SUCCEEDED");
 }finally{
  secure.close();raw.close();world.close();executions.close();
  rmSync(dir,{recursive:true,force:true});
 }
});
