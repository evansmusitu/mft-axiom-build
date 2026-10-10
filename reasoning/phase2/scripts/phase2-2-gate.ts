import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  canonicalize, createDefaultRegistry, createSigner, type AxiomProgram
} from "../../phase1/src/index.ts";
import {
  AuthenticatedFactIngestor, AxiomApiService, DeterministicAuthorizer, Ed25519JwtAuthenticator,
  ExecutionStore, ReasoningControlPlane, SecurityStore, WorldStateStore,
  createAxiomHttpServer, createIngestionKeyring, createJwtTrustStore, createStaticSignerProvider,
  type SignedFactEnvelope, type TemporalFact, type TenantScope
} from "../src/index.ts";

const NOW="2026-10-06T10:00:00.000Z";
const tenantA={tenantId:"tenant:phase22-gate"};
const tenantB={tenantId:"tenant:phase22-other"};
const fixture=JSON.parse(readFileSync(new URL("../../phase1/fixtures/xau-risk-program.json",import.meta.url),"utf8")) as AxiomProgram;

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
function fact(id:string):TemporalFact {
  return {
    id,entity:"risk:alpha",attribute:"max_vol",
    value:{type:{kind:"number",unit:"ratio"},value:0.30},
    validFrom:"2026-10-06T09:55:00.000Z",
    observedAt:"2026-10-06T09:59:00.000Z",
    source:"risk-feed:phase22",confidence:1
  };
}
function envelope(feedSigner:any,nonce:string,issuedAt="2026-10-06T09:59:30.000Z",id="risk-phase22"):SignedFactEnvelope {
  const base={tenantId:tenantA.tenantId,keyId:"feed-key:v1",issuedAt,nonce,fact:fact(id)};
  return {...base,signature:sign(null,Buffer.from(canonicalize(base as any)),feedSigner.privateKey).toString("base64")};
}
async function listen(server:any):Promise<number>{
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve());});
  const address=server.address();assert.ok(address&&typeof address==="object");return address.port;
}
async function close(server:any):Promise<void>{await new Promise<void>(resolve=>server.close(()=>resolve()));}

const dir=mkdtempSync(join(tmpdir(),"axiom-phase22-gate-"));
const db=join(dir,"platform.db");
const world=new WorldStateStore(db);
const executions=new ExecutionStore(db);
const security=new SecurityStore(db);
const feedSigner=createSigner();
const certificateSigner=createSigner();
const apiSigner=generateKeyPairSync("ed25519");
const ingestionKeys=createIngestionKeyring({[tenantA.tenantId]:{"feed-key:v1":feedSigner.publicKey}});
const jwtTrust=createJwtTrustStore({"https://issuer.axiom.example":{"api-key:v1":apiSigner.publicKey}});
const authenticator=new Ed25519JwtAuthenticator({
  trustStore:jwtTrust,audience:"axiom-api",
  maxTokenAgeMs:5*60*1000,maxTokenLifetimeMs:10*60*1000,maxClockSkewMs:30*1000
});
const authorizer=new DeterministicAuthorizer(security);
const signerProvider=createStaticSignerProvider("reasoning-key:v1",certificateSigner);
const registry=createDefaultRegistry();

const runtimeFactory={
  create(scope:TenantScope){
    return {
      ingestor:new AuthenticatedFactIngestor({
        tenant:scope,world,keyring:ingestionKeys,maxEnvelopeAgeMs:5*60*1000,maxFutureSkewMs:30*1000
      }),
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
  const issuer="https://issuer.axiom.example";
  const token=compactJwt(apiSigner.privateKey,{
    iss:issuer,sub:"service:phase22",aud:"axiom-api",jti:"jwt-phase22",
    iat:1791280770,exp:1791281100,
    tenantId:tenantB.tenantId,roles:["admin"],scope:"*"
  });
  const expiredToken=compactJwt(apiSigner.privateKey,{
    iss:issuer,sub:"service:phase22",aud:"axiom-api",jti:"jwt-expired",
    iat:1791280200,exp:1791280600
  });
  const authenticated=await authenticator.authenticate(token,NOW);
  for(const action of ["fact:ingest","execution:create","execution:read"] as const){
    await security.putGrant({grantId:`gate:${action}`,principalId:authenticated.principal.principalId,tenantId:tenantA.tenantId,action});
  }

  const port=await listen(server);
  const base=`http://127.0.0.1:${port}/v1/tenants/${encodeURIComponent(tenantA.tenantId)}`;
  const authHeaders={Authorization:`Bearer ${token}`};

  const ingressEnvelope=envelope(feedSigner,"nonce:phase22");
  const ingress=await fetch(base+"/facts",{
    method:"POST",headers:{...authHeaders,"Content-Type":"application/json","Idempotency-Key":"idem:fact:1"},
    body:JSON.stringify(ingressEnvelope)
  });
  assert.equal(ingress.status,201);
  const ingressBody=await ingress.text();
  assert.equal(JSON.parse(ingressBody).fact.authentication.keyId,"feed-key:v1");

  const ingressReplay=await fetch(base+"/facts",{
    method:"POST",headers:{...authHeaders,"Content-Type":"application/json","Idempotency-Key":"idem:fact:1"},
    body:JSON.stringify(ingressEnvelope)
  });
  assert.equal(ingressReplay.status,201);
  assert.equal(await ingressReplay.text(),ingressBody);

  const nonceReplay=await fetch(base+"/facts",{
    method:"POST",headers:{...authHeaders,"Content-Type":"application/json","Idempotency-Key":"idem:fact:nonce-replay"},
    body:JSON.stringify(ingressEnvelope)
  });
  assert.equal(nonceReplay.status,422);

  const stale=await fetch(base+"/facts",{
    method:"POST",headers:{...authHeaders,"Content-Type":"application/json","Idempotency-Key":"idem:fact:stale"},
    body:JSON.stringify(envelope(feedSigner,"nonce:stale","2026-10-06T09:40:00.000Z","risk-stale"))
  });
  assert.equal(stale.status,422);

  const executeBody=executionRequest();
  const execute=await fetch(base+"/executions",{
    method:"POST",headers:{...authHeaders,"Content-Type":"application/json","Idempotency-Key":"idem:execution:1"},
    body:JSON.stringify(executeBody)
  });
  assert.equal(execute.status,200);
  const executeText=await execute.text();
  const issued=JSON.parse(executeText);
  assert.equal(issued.status,"APPROVED");
  assert.match(issued.executionRecordId,/^platform:/);
  assert.ok(issued.certificateId);

  const executeReplay=await fetch(base+"/executions",{
    method:"POST",headers:{...authHeaders,"Content-Type":"application/json","Idempotency-Key":"idem:execution:1"},
    body:JSON.stringify(executeBody)
  });
  assert.equal(executeReplay.status,200);
  assert.equal(await executeReplay.text(),executeText);

  const stored=await fetch(base+`/executions/${encodeURIComponent(issued.executionRecordId)}`,{headers:authHeaders});
  assert.equal(stored.status,200);
  const storedRecord=await stored.json() as any;
  assert.equal(storedRecord.tenantId,tenantA.tenantId);
  const snapshot=await world.getSnapshot(tenantA,storedRecord.snapshotId);
  assert.equal(snapshot.facts.find(x=>x.id==="risk-phase22")?.authentication?.nonce,"nonce:phase22");

  const deniedReplay=await fetch(base+`/executions/${encodeURIComponent(issued.executionRecordId)}/replay`,{
    method:"POST",headers:{...authHeaders,"Content-Type":"application/json"},body:"{}"
  });
  assert.equal(deniedReplay.status,403);

  await security.putGrant({
    grantId:"gate:execution:replay",principalId:authenticated.principal.principalId,
    tenantId:tenantA.tenantId,action:"execution:replay"
  });
  const replay=await fetch(base+`/executions/${encodeURIComponent(issued.executionRecordId)}/replay`,{
    method:"POST",headers:{...authHeaders,"Content-Type":"application/json"},body:"{}"
  });
  assert.equal(replay.status,200);
  assert.deepEqual(await replay.json(),{status:"MATCH",diagnostics:[]});

  const otherBase=`http://127.0.0.1:${port}/v1/tenants/${encodeURIComponent(tenantB.tenantId)}`;
  const crossTenant=await fetch(otherBase+`/executions/${encodeURIComponent(issued.executionRecordId)}`,{headers:authHeaders});
  assert.equal(crossTenant.status,403);

  const expired=await fetch(base+`/executions/${encodeURIComponent(issued.executionRecordId)}`,{
    headers:{Authorization:`Bearer ${expiredToken}`}
  });
  assert.equal(expired.status,401);

  const reservedRequest=executionRequest();
  reservedRequest.program.assumptions=[...reservedRequest.program.assumptions,"AXIOM_PLATFORM_CONTEXT_SHA256:forged"];
  const reserved=await fetch(base+"/executions",{
    method:"POST",headers:{...authHeaders,"Content-Type":"application/json","Idempotency-Key":"idem:execution:reserved"},
    body:JSON.stringify(reservedRequest)
  });
  assert.equal(reserved.status,400);

  assert.deepEqual(await security.verifyStream(tenantA.tenantId),{status:"MATCH",diagnostics:[]});
  assert.deepEqual(await security.verifyStream(tenantB.tenantId),{status:"MATCH",diagnostics:[]});

  const raw=new DatabaseSync(db);
  try{raw.prepare("UPDATE axiom_audit_records SET outcome='TAMPERED' WHERE tenant_id=? AND sequence=1").run(tenantA.tenantId);}
  finally{raw.close();}
  const tampered=await security.verifyStream(tenantA.tenantId);
  assert.equal(tampered.status,"MISMATCH");
  assert.ok(tampered.diagnostics.some(x=>/hash/i.test(x)));

  console.log(JSON.stringify({
    phase:"P2.2 — Authenticated Execution Boundary",
    status:"PASS",
    checks:[
      "authenticate Ed25519 JWT principal",
      "ignore caller tenant/role/scope claims for authorization",
      "authorize exact tenant/action from durable server-side grants",
      "ingest Ed25519 signed fact through authenticated HTTP boundary",
      "preserve source freshness and nonce replay protection",
      "replay completed mutations from exact durable idempotency outcome",
      "execute through unchanged ReasoningControlPlane and Phase-1 runtime",
      "persist independently verified signed reasoning certificate",
      "read tenant-scoped execution record",
      "deny action escalation before replay",
      "perform authorized deterministic replay",
      "deny known-ID cross-tenant access before foreign repository use",
      "reject expired caller credential",
      "reject reserved signed-context injection",
      "verify tenant audit streams",
      "detect persisted audit tampering"
    ],
    tenantId:tenantA.tenantId,
    principalId:authenticated.principal.principalId,
    executionRecordId:issued.executionRecordId,
    certificateId:issued.certificateId,
    auditTamperDiagnostics:tampered.diagnostics
  },null,2));
}finally{
  await close(server).catch(()=>{});
  security.close();executions.close();world.close();
  rmSync(dir,{recursive:true,force:true});
}
