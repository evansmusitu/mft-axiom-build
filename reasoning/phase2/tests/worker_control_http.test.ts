import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,randomUUID,sign} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {canonicalize,hashJson} from "../../phase1/src/canonical.ts";
import {
 AuthenticatedDistributedExecutionStore,DistributedExecutionStore,createWorkerTrustRecord,
 StaticWorkerTrustStore,WorkerRequestAuthenticator,createStaticWorkerLeaseSigner,
 workerRequestSigningPayload
} from "../src/index.ts";
import {createAxiomWorkerControlHttpServer} from "../src/worker_control_http.ts";
const H=(x:string)=>x.repeat(64);
const scope={tenantId:"tenant:worker-remote"};
const at="2026-11-02T08:00:03.000Z";
function intent(){
 return {tenantId:scope.tenantId,principalId:"principal:remote",
 authorizationDecisionHash:H("a"),requestHash:H("b"),
 compilationId:"model-compilation:"+H("c"),compilationRecordHash:H("d"),profileId:"profile:remote",
 profileVersion:"1",profileHash:H("e"),compilerManifest:{id:"axiom.phase1-compiler",
 version:"1",implementationHash:H("f")},operationRegistryManifestHash:H("1"),
 executionRequest:{asOf:"2026-11-02T08:00:00.000Z",issuedAt:"2026-11-02T08:00:01.000Z",
 program:{irVersion:"0.1",objective:"remote",assumptions:[],inputs:{},nodes:[],
 constraints:[],decisionNodeId:"decision"},requirements:[],bindings:[]},
 snapshotId:"snapshot:"+H("2"),snapshotHash:H("3"),
 createdAt:"2026-11-02T08:00:02.000Z"};
}
async function listener(server:any){
 await new Promise<void>((ok,bad)=>server.once("error",bad).listen(0,"127.0.0.1",ok));
 const address=server.address();
 return {base:"http://127.0.0.1:"+address.port,
  close:async()=>{await new Promise<void>((ok,bad)=>server.close((err:any)=>err?bad(err):ok()));}};
}
async function post(base:string,path:string,body:any,contentType="application/json"){
 const response=await fetch(base+path,{method:"POST",headers:{"content-type":contentType},
 body:typeof body==="string"?body:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
}
function makeProof(key:any,action:"CLAIM"|"HEARTBEAT"|"RELEASE"|"COMPLETE",
 body:any,issuedAt:string,targetJobId?:string){
 const core={protocolVersion:"axiom.worker-request/v1" as const,workerId:"worker:remote",
 keyId:"wk:remote",requestId:randomUUID(),action,bodyHash:hashJson(body as any),issuedAt,
 ...(targetJobId?{targetJobId}:{})};
 return {...core,signatureBase64:sign(null,Buffer.from(canonicalize(workerRequestSigningPayload(core))),key.privateKey).toString("base64")};
}
test("dedicated worker HTTP listener denies unauthenticated ingress and never dispatches repository actions",async()=>{
 let calls=0;
 const repo={async claimNext(){calls++;return undefined;},async heartbeat(){calls++;},async releaseForRetry(){calls++;}} as any;
 assert.throws(()=>createAxiomWorkerControlHttpServer({jobs:repo,clock:()=>at} as any),/trustedIngress/);
 const server=createAxiomWorkerControlHttpServer({jobs:repo,clock:()=>at,trustedIngress:()=>false});
 const net=await listener(server);
 try{
  const out=await post(net.base,"/v1/worker/claims",{proof:{},leaseMs:5000});
  assert.equal(out.status,403);
  assert.equal(out.body.error.code,"UNTRUSTED_TRANSPORT");
  assert.equal(calls,0);
 }finally{await net.close();}
});
test("real authenticated SQLite control ingress claims, heartbeats, exact replays, fences old lease and releases",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"axiom-worker-http-")),path=join(dir,"work.db");
 const legacy=new DistributedExecutionStore(path);
 const wk=generateKeyPairSync("ed25519"),lk=generateKeyPairSync("ed25519");
 const record=createWorkerTrustRecord({workerId:"worker:remote",keyId:"wk:remote",
 poolId:"pool:remote",publicKeyPem:wk.publicKey.export({type:"spki",format:"pem"}).toString(),
 status:"ACTIVE",maxLeaseMs:5000,
 allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]});
 const auth=new WorkerRequestAuthenticator(new StaticWorkerTrustStore([record]),
 {maxAgeMs:30000,futureSkewMs:1000});
 const secure=new AuthenticatedDistributedExecutionStore(path,auth,createStaticWorkerLeaseSigner("lease:remote",lk));
 let now=at;
 const server=createAxiomWorkerControlHttpServer({jobs:secure,clock:()=>now,trustedIngress:()=>true});
 const net=await listener(server);
 try{
  const created=await legacy.create(scope,intent());
  const claimProof=makeProof(wk,"CLAIM",{leaseMs:5000},now);
  const initial=await post(net.base,"/v1/worker/claims",{proof:claimProof,leaseMs:5000});
  assert.equal(initial.status,200);
  assert.equal(initial.body.status,"LEASED");
  assert.equal(initial.body.lease.job.intent.jobId,created.intent.jobId);
  assert.equal(initial.body.lease.capability.core.workerId,"worker:remote");
  const repeated=await post(net.base,"/v1/worker/claims",{proof:claimProof,leaseMs:5000});
  assert.deepEqual(repeated,initial);
  assert.equal((await legacy.get(scope,created.intent.jobId)).state.leaseEpoch,1);
  const old=initial.body.lease.capability;
  now="2026-11-02T08:00:04.000Z";
  const heartbeatProof=makeProof(wk,"HEARTBEAT",{leaseMs:5000,capabilityId:old.capabilityId},now,created.intent.jobId);
  const heartbeat=await post(net.base,"/v1/worker/jobs/"+encodeURIComponent(created.intent.jobId)+"/heartbeat",
   {proof:heartbeatProof,capability:old,leaseMs:5000});
  assert.equal(heartbeat.status,200);
  assert.equal(heartbeat.body.status,"LEASED");
  assert.notEqual(heartbeat.body.lease.capability.capabilityId,old.capabilityId);
  assert.deepEqual(await post(net.base,"/v1/worker/jobs/"+encodeURIComponent(created.intent.jobId)+"/heartbeat",
   {proof:heartbeatProof,capability:old,leaseMs:5000}),heartbeat);
  const staleProof=makeProof(wk,"RELEASE",{capabilityId:old.capabilityId},now,created.intent.jobId);
  const stale=await post(net.base,"/v1/worker/jobs/"+encodeURIComponent(created.intent.jobId)+"/release",
   {proof:staleProof,capability:old});
  assert.equal(stale.status,409);
  assert.equal((await legacy.get(scope,created.intent.jobId)).state.status,"LEASED");
  now="2026-11-02T08:00:05.000Z";
  const fresh=heartbeat.body.lease.capability;
  const releaseProof=makeProof(wk,"RELEASE",{capabilityId:fresh.capabilityId},now,created.intent.jobId);
  const release=await post(net.base,"/v1/worker/jobs/"+encodeURIComponent(created.intent.jobId)+"/release",
   {proof:releaseProof,capability:fresh});
  assert.deepEqual(release,{status:200,body:{status:"RELEASED",jobStatus:"PENDING"}});
  assert.deepEqual(await post(net.base,"/v1/worker/jobs/"+encodeURIComponent(created.intent.jobId)+"/release",
   {proof:releaseProof,capability:fresh}),release);
  assert.equal((await legacy.get(scope,created.intent.jobId)).state.status,"PENDING");
  await assert.rejects(()=>legacy.claimNext("raw-remote",now,500),/WORKER_AUTH_REQUIRED/);
 }finally{await net.close();secure.close();legacy.close();rmSync(dir,{recursive:true,force:true});}
});
test("HTTP denies arbitrary remote completion, terminal failure, tenant and clock control before repository access",async()=>{
 let calls=0;
 const repo={async claimNext(){calls++;return undefined;},async heartbeat(){calls++;},async releaseForRetry(){calls++;}} as any;
 const net=await listener(createAxiomWorkerControlHttpServer({jobs:repo,clock:()=>at,trustedIngress:()=>true}));
 try{
  for(const path of ["/v1/worker/jobs/job/complete","/v1/worker/jobs/job/fail-terminal",
   "/v1/worker/jobs/job/run","/v1/worker/jobs/job/execute","/v1/worker/tools/list"]){
   const r=await post(net.base,path,{proof:{},capability:{}});
   assert.equal(r.status,404,path);
  }
  for(const bad of [{proof:{},leaseMs:5000,tenantId:"tenant:wrong"},
   {proof:{},leaseMs:5000,serverNow:"2099-01-01T00:00:00.000Z"},
   {proof:{},leaseMs:5000,workerId:"worker:fake"}]){
   const r=await post(net.base,"/v1/worker/claims",bad);
   assert.equal(r.status,400);
  }
  const invalid=await post(net.base,"/v1/worker/claims",{proof:{},leaseMs:5000},"text/plain");
  assert.equal(invalid.status,415);
  const oversized=await post(net.base,"/v1/worker/claims","x".repeat(40000));
  assert.equal(oversized.status,413);
  assert.equal(calls,0);
 }finally{await net.close();}
});

test("verified remote completion route is absent by default and delegates only with explicit trusted verifier",async()=>{
 let completions=0;
 const jobs={async claimNext(){return undefined;},async heartbeat(){throw Error("unused");},
  async releaseForRetry(){throw Error("unused");}};
 const responseJob={intent:{jobId:"job:verified-http"},state:{status:"SUCCEEDED"}};
 const verifier={async complete(proof:any,cap:any,result:any,at:string){
  completions++;assert.equal(proof.action,"COMPLETE");
  assert.equal(proof.targetJobId,"job:verified-http");
  assert.equal(cap.capabilityId,"cap:verified-http");
  assert.equal(result.status,"APPROVED");
  assert.equal(at,laterTime);
  return responseJob;}};
 const laterTime="2026-11-02T08:00:04.000Z";
 const body={proof:{action:"COMPLETE",targetJobId:"job:verified-http"},
  capability:{capabilityId:"cap:verified-http",core:{}},
  result:{status:"APPROVED",snapshotId:"snapshot",policyDecision:{status:"ALLOW",snapshotId:"snapshot",checks:[]},
   certificateId:"cert:test",executionRecordId:"record:test"}};
 const route="/v1/worker/jobs/job%3Averified-http/complete";
 const disabled=await listener(createAxiomWorkerControlHttpServer({
  jobs,clock:()=>laterTime,trustedIngress:()=>true} as any));
 try{const out=await post(disabled.base,route,body);assert.equal(out.status,404);}
 finally{await disabled.close();}
 const enabled=await listener(createAxiomWorkerControlHttpServer({
  jobs,clock:()=>laterTime,trustedIngress:()=>true,verifiedCompletion:verifier} as any));
 try{
  const out=await post(enabled.base,route,body);
  assert.deepEqual(out,{status:200,body:{status:"COMPLETED",jobId:"job:verified-http",jobStatus:"SUCCEEDED"}});
  assert.equal(completions,1);
  assert.equal((await post(enabled.base,route,{...body,remoteNow:"2099"})).status,400);
  assert.equal((await post(enabled.base,"/v1/worker/jobs/job%3Averified-http/fail-terminal",body)).status,404);
  assert.equal(completions,1);
 }finally{await enabled.close();}
});
