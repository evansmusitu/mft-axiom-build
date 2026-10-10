import assert from "node:assert/strict";
import { sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  AxiomRuntime, compileProgram, compilerManifest, createDefaultRegistry, createSigner, hashJson,
  issueCertificate, type AxiomProgram
} from "../../phase1/src/index.ts";
import {
  DistributedExecutionStore, DistributedModelExecutionWorker, ExecutionStore, ReasoningControlPlane,
  WorldStateStore, createExternalEd25519SignerProvider
} from "../src/index.ts";

const tenant={tenantId:"tenant:phase25b-gate"};
const H=(c:string)=>c.repeat(64);
const fixture=JSON.parse(readFileSync(new URL("../../phase1/fixtures/xau-risk-program.json",import.meta.url),"utf8")) as AxiomProgram;
const timing={asOf:"2026-10-09T03:30:00.000Z",issuedAt:"2026-10-09T03:30:01.000Z"};
const request={
  ...timing,
  program:structuredClone(fixture),
  requirements:[{id:"fresh-risk-limit",entity:"risk:alpha",attribute:"max_vol",maxAgeMs:10*60*1000}],
  bindings:[{inputName:"max_vol",entity:"risk:alpha",attribute:"max_vol"}]
};
function workerClock(...values:string[]){
  let index=0;
  return ()=>{
    const value=values[Math.min(index,values.length-1)];
    index++;
    if(!value)throw new Error("worker clock exhausted");
    return value;
  };
}

const dir=mkdtempSync(join(tmpdir(),"axiom-phase25b-gate-")),db=join(dir,"platform.db");
const world=new WorldStateStore(db),executions=new ExecutionStore(db),jobs=new DistributedExecutionStore(db);
const registry=createDefaultRegistry();
const remote=createSigner();
const signerCalls:any[]=[];
let loseFirst=true,networkAllowed=true;
const signer=createExternalEd25519SignerProvider({
  providerId:"hsm-gateway:phase25b",
  activeKeyId:"reasoning-key:phase25b:v1",
  activePublicKey:remote.publicKey,
  trustedKeys:{"reasoning-key:phase25b:v1":remote.publicKey},
  backend:{async sign(input){
    if(!networkAllowed)throw new Error("signer network must not be used during replay");
    signerCalls.push(structuredClone(input));
    const signatureBase64=sign(null,Buffer.from(input.payloadBase64,"base64"),remote.privateKey).toString("base64");
    if(loseFirst){loseFirst=false;throw new Error("simulated lost HSM gateway response");}
    return {
      protocolVersion:input.protocolVersion,keyId:input.keyId,algorithm:input.algorithm,
      signingIntentId:input.signingIntentId,payloadHash:input.payloadHash,signatureBase64
    };
  }}
});

try{
  assert.equal(Object.keys(signer).some(key=>/private/i.test(key)),false,"external signer surface must expose no private-key field");
  assert.equal(signer.identity.mode,"EXTERNAL");
  assert.equal(signer.identity.algorithm,"Ed25519");
  assert.match(signer.identity.publicKeySha256,/^[0-9a-f]{64}$/);

  await world.putFact(tenant,{
    id:"risk-limit:phase25b",entity:"risk:alpha",attribute:"max_vol",
    value:{type:{kind:"number",unit:"ratio"},value:0.30},
    validFrom:"2026-10-09T03:00:00.000Z",observedAt:"2026-10-09T03:25:00.000Z",
    source:"risk-engine:phase25b",confidence:1
  });
  const frozen=await world.snapshot(tenant,timing.asOf);
  const intent=await jobs.create(tenant,{
    tenantId:tenant.tenantId,
    principalId:"principal:phase25b",
    authorizationDecisionHash:H("a"),
    requestHash:H("b"),
    compilationId:"model-compilation:"+H("c"),
    compilationRecordHash:H("d"),
    profileId:"profile:phase25b",
    profileVersion:"1.0.0",
    profileHash:H("e"),
    compilerManifest:compilerManifest(),
    operationRegistryManifestHash:hashJson(registry.manifest() as any),
    executionRequest:structuredClone(request),
    snapshotId:frozen.snapshotId,
    snapshotHash:frozen.snapshotHash,
    createdAt:"2026-10-09T03:30:01.500Z"
  });

  const runtimes={create(scope:any){
    assert.deepEqual(scope,tenant);
    const plane=new ReasoningControlPlane({tenant:scope,world,executions,signer,registry});
    return {
      modelExecutor:{async validatePrepared(){return {};}},
      executions,plane
    };
  }};
  const firstWorker=new DistributedModelExecutionWorker({
    jobs,runtimes,leaseMs:5000,
    clock:workerClock("2026-10-09T03:30:02.000Z","2026-10-09T03:30:02.100Z")
  });
  assert.deepEqual(await firstWorker.runOnce("worker:hsm-loss"),{status:"RETRY",jobId:intent.intent.jobId});
  assert.equal((await jobs.get(tenant,intent.intent.jobId)).state.status,"PENDING");
  assert.equal(await executions.getByIntent(tenant,intent.intent.jobId),undefined);

  const secondWorker=new DistributedModelExecutionWorker({
    jobs,runtimes,leaseMs:5000,
    clock:workerClock("2026-10-09T03:30:03.000Z","2026-10-09T03:30:03.100Z")
  });
  const completed=await secondWorker.runOnce("worker:hsm-retry");
  assert.deepEqual(completed,{status:"COMPLETED",jobId:intent.intent.jobId,jobStatus:"SUCCEEDED"});
  assert.equal(signerCalls.length,2);
  assert.deepEqual(signerCalls[1],signerCalls[0],"ambiguous signer retry must repeat the exact request");
  assert.match(signerCalls[0].signingIntentId,/^[0-9a-f]{64}$/);

  const stored:any=await executions.getByIntent(tenant,intent.intent.jobId);
  assert.ok(stored);
  assert.equal(stored.platformContextVersion,"2");
  assert.deepEqual(stored.signerIdentity,signer.identity);
  assert.equal(stored.signingIntentId,signerCalls[0].signingIntentId);

  networkAllowed=false;
  const replayPlane=new ReasoningControlPlane({tenant,world,executions,signer,registry});
  assert.deepEqual(await replayPlane.replayStored(stored.id),{status:"MATCH",diagnostics:[]});
  assert.equal(signerCalls.length,2,"stored replay must be network-free");

  const legacyContextHash=hashJson({
    tenantId:stored.tenantId,snapshotId:stored.snapshotId,snapshotHash:stored.snapshotHash,
    policyDecision:stored.policyDecision,policyManifest:stored.policyManifest,
    requirements:stored.requirements,bindings:stored.bindings
  } as any);
  const legacyProgram=structuredClone(stored.certificate.replay.program);
  legacyProgram.assumptions=legacyProgram.assumptions.map((value:string)=>
    value.startsWith("AXIOM_PLATFORM_CONTEXT_SHA256:")?`AXIOM_PLATFORM_CONTEXT_SHA256:${legacyContextHash}`:value
  );
  const legacyCompiled=compileProgram(legacyProgram,registry);
  const legacyExecution=new AxiomRuntime(registry).execute(legacyCompiled);
  const legacyCertificate=issueCertificate(legacyCompiled,legacyExecution,remote,stored.certificate.issuedAt);
  const legacyCore:any={
    id:`platform:${legacyCertificate.certificateId}`,tenantId:stored.tenantId,
    snapshotId:stored.snapshotId,snapshotHash:stored.snapshotHash,
    policyDecision:stored.policyDecision,policyManifest:stored.policyManifest,
    requirements:stored.requirements,bindings:stored.bindings,
    platformContextHash:legacyContextHash,certificate:legacyCertificate,signerKeyId:stored.signerKeyId
  };
  const legacyRecord={...legacyCore,recordHash:hashJson(legacyCore)};
  await executions.put(tenant,legacyRecord);
  assert.deepEqual(await replayPlane.replayStored(legacyRecord.id),{status:"MATCH",diagnostics:[]});

  const attacker=createSigner();
  const forgedSigner=createExternalEd25519SignerProvider({
    providerId:"hsm-gateway:forged",
    activeKeyId:"reasoning-key:phase25b:v1",
    activePublicKey:remote.publicKey,
    trustedKeys:{"reasoning-key:phase25b:v1":remote.publicKey},
    backend:{async sign(input){
      return {
        protocolVersion:input.protocolVersion,keyId:input.keyId,algorithm:input.algorithm,
        signingIntentId:input.signingIntentId,payloadHash:input.payloadHash,
        signatureBase64:sign(null,Buffer.from(input.payloadBase64,"base64"),attacker.privateKey).toString("base64")
      };
    }}
  });
  const forgedPlane=new ReasoningControlPlane({tenant,world,executions,signer:forgedSigner,registry});
  await assert.rejects(()=>forgedPlane.execute(request),/signature verification failed/i);

  const inspect=new DatabaseSync(db);
  const executionCount=Number((inspect.prepare("SELECT COUNT(*) AS n FROM platform_executions WHERE tenant_id=?").get(tenant.tenantId) as any).n);
  const intentCount=Number((inspect.prepare("SELECT COUNT(*) AS n FROM execution_intents WHERE tenant_id=?").get(tenant.tenantId) as any).n);
  inspect.close();
  assert.equal(executionCount,2,"one v2 distributed record plus one explicit legacy compatibility record");
  assert.equal(intentCount,1,"distributed retry must retain one execution-intent mapping");

  console.log(JSON.stringify({
    phase:"P2.5B — Out-of-Process Deterministic Certificate Signing",
    status:"PASS",
    checks:[
      "external signer provider exposes no private-key field",
      "pin active Ed25519 public key and signer identity server-side",
      "derive a stable signing intent from exact certificate payload and signer identity",
      "release a lost external-signer response for fenced retry",
      "repeat the identical signing request after ambiguous signer response loss",
      "persist one durable distributed execution for one execution intent",
      "commit signer identity and signing intent into v2 proof metadata",
      "replay stored v2 execution without signer network access",
      "replay a correctly signed legacy v1 platform-context record",
      "reject a forged external signer signature before persistence"
    ],
    tenantId:tenant.tenantId,
    executionJobId:intent.intent.jobId,
    executionRecordId:stored.id,
    signingIntentId:stored.signingIntentId,
    signerProviderId:signer.identity.providerId,
    signerKeyId:signer.identity.keyId,
    signerCalls:signerCalls.length
  },null,2));
}finally{
  jobs.close();executions.close();world.close();rmSync(dir,{recursive:true,force:true});
}
