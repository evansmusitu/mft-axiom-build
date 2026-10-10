import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createDefaultRegistry, createSigner, type AxiomProgram
} from "../../phase1/src/index.ts";
import {
  AdapterRegistry, AuthenticatedFactIngestor, AxiomApiService, DeterministicAuthorizer,
  Ed25519JwtAuthenticator, EvidenceAcquisitionService, ExecutionStore, HttpJsonEvidenceAdapter,
  MusituAxiomEvidenceAdapter, ReasoningControlPlane, SecurityStore, StaticSecretResolver,
  WorldStateStore, createAdapterAttestor, createAxiomHttpServer, createIngestionKeyring,
  createJwtTrustStore, createStaticSignerProvider, mapEvidenceArtifact, verifyEvidenceArtifact,
  type TenantScope
} from "../src/index.ts";

const NOW="2026-10-06T10:00:00.000Z";
const tenantA={tenantId:"tenant:phase23a-gate"};
const tenantB={tenantId:"tenant:phase23a-other"};
const fixture=JSON.parse(readFileSync(new URL("../../phase1/fixtures/xau-risk-program.json",import.meta.url),"utf8")) as AxiomProgram;
const H=(c:string)=>c.repeat(64);

function b64url(value:string|Buffer):string{return Buffer.from(value).toString("base64url");}
function compactJwt(privateKey:any,payload:Record<string,unknown>):string {
  const header=b64url(JSON.stringify({alg:"EdDSA",typ:"at+jwt",kid:"api-key:v1"}));
  const encoded=b64url(JSON.stringify(payload));
  const input=`${header}.${encoded}`;
  return `${input}.${sign(null,Buffer.from(input),privateKey).toString("base64url")}`;
}
function executionRequest(){
  return {
    asOf:NOW,
    issuedAt:"2026-10-06T10:00:01.000Z",
    program:structuredClone(fixture),
    requirements:[{id:"fresh-risk-limit",entity:"risk:alpha",attribute:"max_vol",maxAgeMs:10*60*1000}],
    bindings:[{inputName:"max_vol",entity:"risk:alpha",attribute:"max_vol"}]
  };
}
async function listen(server:any):Promise<number>{
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve());});
  const address=server.address();assert.ok(address&&typeof address==="object");return address.port;
}
async function close(server:any):Promise<void>{await new Promise<void>(resolve=>server.close(()=>resolve()));}

const dir=mkdtempSync(join(tmpdir(),"axiom-phase23a-gate-"));
const db=join(dir,"platform.db");
const world=new WorldStateStore(db);
const executions=new ExecutionStore(db);
const security=new SecurityStore(db);

const apiSigner=generateKeyPairSync("ed25519");
const adapterSigner=createSigner();
const certificateSigner=createSigner();
const adapterKeyId="adapter:http-json-risk:v1";
const serverSecret="phase23a-server-only-secret";

let upstreamCalls=0;
const secretResolver=new StaticSecretResolver({"secret:risk":serverSecret});
const httpAdapter=new HttpJsonEvidenceAdapter({
  adapterId:"http-json:risk",
  version:"1.0.0",
  implementationHash:H("a"),
  operations:[{
    manifest:{
      operationId:"risk-limit",
      parameterSchemaHash:H("b"),
      responseMediaTypes:["application/json"],
      maxResponseBytes:1024,
      timeoutMs:1000,
      mappingIds:["risk-limit:v1"]
    },
    origin:"https://risk.example",
    method:"GET",
    pathTemplate:"/v1/risk/{symbol}",
    secretHeaders:{"x-api-key":"secret:risk"},
    allowedStatus:[200],
    validateParameters:(parameters:any)=>{
      const keys=Object.keys(parameters);
      if(keys.length!==1||keys[0]!=="symbol"||parameters.symbol!=="XAUUSD")throw new TypeError("risk-limit parameter schema rejected request");
    }
  }],
  secretResolver,
  fetchFn:async(url,init)=>{
    upstreamCalls++;
    assert.equal(String(url),"https://risk.example/v1/risk/XAUUSD");
    assert.equal((init?.headers as any)["x-api-key"],serverSecret);
    assert.equal(init?.redirect,"manual");
    return new Response('{"max_vol":0.30}',{status:200,headers:{"content-type":"application/json"}});
  }
});
const mapper={
  manifest:{mappingId:"risk-limit:v1",version:"1.0.0",implementationHash:H("c")},
  map(artifact:any){
    const parsed=JSON.parse(artifact.body);
    return [{
      entity:"risk:alpha",
      attribute:"max_vol",
      value:{type:{kind:"number",unit:"ratio"},value:Number(parsed.max_vol)},
      validFrom:"2026-10-06T09:55:00.000Z",
      observedAt:"2026-10-06T09:59:30.000Z",
      source:"adapter:http-json-risk",
      confidence:1
    }];
  }
};
const adapters=new AdapterRegistry([{adapter:httpAdapter,mappers:[mapper],tenantIds:[tenantA.tenantId]}]);
const adapterAttestor=createAdapterAttestor(adapterKeyId,adapterSigner);
const ingestionKeys=createIngestionKeyring({[tenantA.tenantId]:{[adapterKeyId]:adapterSigner.publicKey}});

const jwtTrust=createJwtTrustStore({"https://issuer.axiom.example":{"api-key:v1":apiSigner.publicKey}});
const authenticator=new Ed25519JwtAuthenticator({
  trustStore:jwtTrust,
  audience:"axiom-api",
  maxTokenAgeMs:5*60*1000,
  maxTokenLifetimeMs:10*60*1000,
  maxClockSkewMs:30*1000
});
const authorizer=new DeterministicAuthorizer(security);
const signerProvider=createStaticSignerProvider("reasoning-key:v1",certificateSigner);
const registry=createDefaultRegistry();
const runtimeCreates:string[]=[];

const runtimeFactory={
  create(scope:TenantScope){
    runtimeCreates.push(scope.tenantId);
    const ingestor=new AuthenticatedFactIngestor({
      tenant:scope,world,keyring:ingestionKeys,maxEnvelopeAgeMs:5*60*1000,maxFutureSkewMs:30*1000
    });
    return {
      acquisitions:new EvidenceAcquisitionService({
        registry:adapters,repository:world,ingestor,attestor:adapterAttestor
      }),
      ingestor,
      executions,
      plane:new ReasoningControlPlane({tenant:scope,world,executions,signer:signerProvider,registry})
    };
  }
};

const service=new AxiomApiService({
  authenticator,authorizer,idempotency:security,audit:security,runtimes:runtimeFactory
});
const server=createAxiomHttpServer({service,clock:()=>NOW});

try{
  const token=compactJwt(apiSigner.privateKey,{
    iss:"https://issuer.axiom.example",sub:"service:phase23a",aud:"axiom-api",jti:"jwt-phase23a",
    iat:1791280770,exp:1791281100,
    tenantId:tenantB.tenantId,roles:["admin"],scope:"*"
  });
  const authenticated=await authenticator.authenticate(token,NOW);
  for(const action of ["evidence:acquire","execution:create","execution:read","execution:replay"] as const){
    await security.putGrant({grantId:`gate:${action}`,principalId:authenticated.principal.principalId,tenantId:tenantA.tenantId,action});
  }

  const port=await listen(server);
  const base=`http://127.0.0.1:${port}/v1/tenants/${encodeURIComponent(tenantA.tenantId)}`;
  const authHeaders={Authorization:`Bearer ${token}`};
  const acquisitionBody={
    adapterId:"http-json:risk",operationId:"risk-limit",mappingId:"risk-limit:v1",
    parameters:{symbol:"XAUUSD"}
  };

  const acquired=await fetch(base+"/evidence/acquisitions",{
    method:"POST",
    headers:{...authHeaders,"Content-Type":"application/json","Idempotency-Key":"idem:evidence:1"},
    body:JSON.stringify(acquisitionBody)
  });
  assert.equal(acquired.status,201);
  const acquiredText=await acquired.text();
  const acquisition=JSON.parse(acquiredText);
  assert.equal(acquisition.status,"COMMITTED");
  assert.match(acquisition.artifactHash,/^[0-9a-f]{64}$/);
  assert.equal(acquisition.factIds.length,1);
  assert.equal(upstreamCalls,1);

  const acquiredReplay=await fetch(base+"/evidence/acquisitions",{
    method:"POST",
    headers:{...authHeaders,"Content-Type":"application/json","Idempotency-Key":"idem:evidence:1"},
    body:JSON.stringify(acquisitionBody)
  });
  assert.equal(acquiredReplay.status,201);
  assert.equal(await acquiredReplay.text(),acquiredText);
  assert.equal(upstreamCalls,1,"completed idempotent acquisition replay must not refetch");

  const otherBase=`http://127.0.0.1:${port}/v1/tenants/${encodeURIComponent(tenantB.tenantId)}`;
  const crossTenant=await fetch(otherBase+"/evidence/acquisitions",{
    method:"POST",
    headers:{...authHeaders,"Content-Type":"application/json","Idempotency-Key":"idem:cross-tenant"},
    body:JSON.stringify(acquisitionBody)
  });
  assert.equal(crossTenant.status,403);
  assert.equal(upstreamCalls,1,"authorization denial must occur before external acquisition");
  assert.equal(runtimeCreates.includes(tenantB.tenantId),false,"denied tenant must never construct a tenant runtime");

  const artifact=await world.getEvidenceArtifact(tenantA,acquisition.artifactId);
  const verifiedArtifact=verifyEvidenceArtifact(tenantA,artifact);
  const remapped=mapEvidenceArtifact(tenantA,verifiedArtifact,mapper);
  assert.deepEqual(remapped.map(x=>x.id),acquisition.factIds);

  const snapshotBeforeExecution=await world.snapshot(tenantA,NOW);
  const acquiredFact=snapshotBeforeExecution.facts.find(x=>x.id===acquisition.factIds[0]);
  assert.ok(acquiredFact);
  assert.equal(acquiredFact!.acquisition?.artifactHash,acquisition.artifactHash);
  assert.equal(acquiredFact!.authentication?.keyId,adapterKeyId);
  assert.match(acquiredFact!.authentication?.envelopeHash??"",/^[0-9a-f]{64}$/);

  const execute=await fetch(base+"/executions",{
    method:"POST",
    headers:{...authHeaders,"Content-Type":"application/json","Idempotency-Key":"idem:execution:phase23a"},
    body:JSON.stringify(executionRequest())
  });
  assert.equal(execute.status,200);
  const issued=await execute.json() as any;
  assert.equal(issued.status,"APPROVED");
  assert.ok(issued.executionRecordId);
  assert.ok(issued.certificateId);
  assert.equal(upstreamCalls,1);

  const stored=await fetch(base+`/executions/${encodeURIComponent(issued.executionRecordId)}`,{headers:authHeaders});
  assert.equal(stored.status,200);
  const record=await stored.json() as any;
  assert.equal(record.tenantId,tenantA.tenantId);
  assert.equal(record.snapshotHash,(await world.getSnapshot(tenantA,record.snapshotId)).snapshotHash);
  assert.match(record.platformContextHash,/^[0-9a-f]{64}$/);

  const beforeReasoningReplay=upstreamCalls;
  const replay=await fetch(base+`/executions/${encodeURIComponent(issued.executionRecordId)}/replay`,{
    method:"POST",headers:{...authHeaders,"Content-Type":"application/json"},body:"{}"
  });
  assert.equal(replay.status,200);
  assert.deepEqual(await replay.json(),{status:"MATCH",diagnostics:[]});
  assert.equal(upstreamCalls,beforeReasoningReplay,"reasoning replay must be network-free");

  assert.throws(()=>new MusituAxiomEvidenceAdapter({
    adapterId:"musitu-axiom",version:"1.0.0",implementationHash:H("d"),
    computeBase:"https://axiom.internal.example",
    operations:[{
      operationId:"trade.execute",parameterSchemaHash:H("e"),responseMediaTypes:["application/json"],
      maxResponseBytes:1024,timeoutMs:1000,mappingIds:["risk-limit:v1"]
    }],
    secretResolver:new StaticSecretResolver({}),
    fetchFn:async()=>{throw new Error("must not be called");}
  }),/side-effect|operation/i);

  assert.deepEqual(await security.verifyStream(tenantA.tenantId),{status:"MATCH",diagnostics:[]});
  assert.deepEqual(await security.verifyStream(tenantB.tenantId),{status:"MATCH",diagnostics:[]});

  const inspect=new DatabaseSync(db);
  try{
    const persisted={
      artifacts:inspect.prepare("SELECT * FROM evidence_artifacts").all(),
      acquisitions:inspect.prepare("SELECT * FROM evidence_acquisitions").all(),
      facts:inspect.prepare("SELECT * FROM temporal_facts").all(),
      audit:inspect.prepare("SELECT * FROM axiom_audit_records").all(),
      idempotency:inspect.prepare("SELECT * FROM axiom_idempotency_records").all()
    };
    assert.equal(JSON.stringify(persisted).includes(serverSecret),false,"resolved connector secrets must never persist");
    inspect.prepare("UPDATE evidence_artifacts SET body=? WHERE tenant_id=? AND artifact_id=?")
      .run('{"max_vol":0.01}',tenantA.tenantId,acquisition.artifactId);
  }finally{inspect.close();}

  await assert.rejects(()=>world.getEvidenceArtifact(tenantA,acquisition.artifactId),/integrity|hash/i);

  console.log(JSON.stringify({
    phase:"P2.3A — Deterministic External Evidence",
    status:"PASS",
    checks:[
      "authenticate caller before external acquisition",
      "authorize exact evidence:acquire tenant action before runtime/network access",
      "capture bounded external JSON through fixed server-owned origin",
      "exclude server-resolved connector secrets from persisted evidence",
      "persist immutable evidence artifact and integrity hashes",
      "map artifact deterministically into provenance-bound fact identity",
      "adapter-attest mapped fact through existing Ed25519 ingestion verification",
      "atomically persist artifact acquisition nonce and fact",
      "return exact completed idempotent acquisition response without refetch",
      "deny cross-tenant acquisition before external access",
      "feed acquired fact through unchanged evidence policy and Phase-1 reasoning runtime",
      "transitively commit acquired evidence through snapshot and signed platform context",
      "replay stored reasoning execution without network access",
      "reject side-effect MUSITU Axiom operations",
      "verify tenant audit streams",
      "detect persisted evidence-artifact tampering"
    ],
    tenantId:tenantA.tenantId,
    principalId:authenticated.principal.principalId,
    acquisitionId:acquisition.acquisitionId,
    artifactId:acquisition.artifactId,
    executionRecordId:issued.executionRecordId,
    certificateId:issued.certificateId,
    upstreamCalls
  },null,2));
}finally{
  await close(server).catch(()=>{});
  security.close();executions.close();world.close();
  rmSync(dir,{recursive:true,force:true});
}
