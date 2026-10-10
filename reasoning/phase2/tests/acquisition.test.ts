import test from "node:test";
import assert from "node:assert/strict";
import { createSigner } from "../../phase1/src/index.ts";

const A={tenantId:"tenant:acquire-a"};
const H=(c:string)=>c.repeat(64);
const NOW="2026-10-06T10:00:00.000Z";

function authorizedContext(){
  return {
    principal:{principalId:"principal:acquirer",issuer:"https://issuer.example",subject:"service:acquirer"},
    credential:{
      issuer:"https://issuer.example",subject:"service:acquirer",keyId:"caller-key",jwtId:"jwt-1",
      issuedAt:"2026-10-06T09:59:00.000Z",expiresAt:"2026-10-06T10:05:00.000Z",tokenHash:H("a")
    },
    tenant:A,
    authorization:{
      status:"ALLOW",principalId:"principal:acquirer",requestedTenantId:A.tenantId,
      action:"evidence:acquire",resource:{kind:"evidence"},matchedGrantIds:["grant-evidence"],
      policyManifest:{id:"axiom.api-authorization",version:"1.0.0",implementationHash:H("b"),grantsHash:H("c")},
      decisionHash:H("d")
    }
  } as any;
}

function registration(fetchCounter:{count:number},factCount=1){
  const adapter={
    manifest:{
      adapterId:"adapter:test",version:"1.0.0",implementationHash:H("e"),capability:"READ",
      operations:[{
        operationId:"read",parameterSchemaHash:H("f"),responseMediaTypes:["application/json"],
        maxResponseBytes:1024,timeoutMs:1000,mappingIds:["map:v1"]
      }]
    },
    validateParameters(input:any){
      assert.deepEqual(input.tenant,A);
      assert.equal(input.operation.operationId,"read");
      const keys=Object.keys(input.parameters).sort();
      if(keys.length!==1||keys[0]!=="symbol"||typeof input.parameters.symbol!=="string"){
        throw new TypeError("parameter schema rejected request");
      }
    },
    async acquire(input:any){
      fetchCounter.count++;
      assert.deepEqual(input.tenant,A);
      assert.equal(input.operation.operationId,"read");
      return {status:200,mediaType:"application/json",body:'{"price":2400}'};
    }
  };
  const mapper={
    manifest:{mappingId:"map:v1",version:"1.0.0",implementationHash:H("1")},
    map(){
      return Array.from({length:factCount},(_,i)=>({
        entity:"market:xauusd",attribute:i===0?"price":`price_${i}`,
        value:{type:{kind:"number",unit:"USD/oz"},value:2400+i},
        validFrom:"2026-10-06T09:59:00.000Z",observedAt:"2026-10-06T09:59:30.000Z",
        source:"adapter:test",confidence:1
      }));
    }
  };
  return {adapter,mapper};
}
function request(){return {adapterId:"adapter:test",operationId:"read",mappingId:"map:v1",parameters:{symbol:"XAUUSD"}};}

test("Phase-2 exposes adapter attestation and evidence acquisition orchestration",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.createAdapterAttestor,"function");
  assert.equal(typeof phase2.EvidenceAcquisitionService,"function");
});

test("acquisition captures, maps, adapter-attests, verifies, and commits one integrity-bound record",async()=>{
  const phase2:any=await import("../src/index.ts");
  const fetchCounter={count:0},reg=registration(fetchCounter);
  const registry=new phase2.AdapterRegistry([{adapter:reg.adapter,mappers:[reg.mapper],tenantIds:[A.tenantId]}]);
  const signer=createSigner(),attestor=phase2.createAdapterAttestor("adapter:test:v1",signer);
  const ingestor=new phase2.AuthenticatedFactIngestor({
    tenant:A,world:{} as any,
    keyring:phase2.createIngestionKeyring({[A.tenantId]:{"adapter:test:v1":signer.publicKey}}),
    maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000
  });
  const commits:any[]=[];
  const repository={
    async commitAcquisition(scope:any,artifact:any,record:any,facts:any[]){commits.push({scope,artifact,record,facts});},
    async getEvidenceArtifact(){throw new Error("unused");},
    async getAcquisition(){throw new Error("unused");}
  };
  const service=new phase2.EvidenceAcquisitionService({registry,repository,ingestor,attestor});
  const result=await service.acquire(authorizedContext(),request(),NOW,H("2"));

  assert.equal(fetchCounter.count,1);
  assert.equal(commits.length,1);
  const committed=commits[0];
  assert.deepEqual(committed.scope,A);
  assert.match(committed.artifact.artifactHash,/^[0-9a-f]{64}$/);
  assert.equal(committed.record.principalId,"principal:acquirer");
  assert.equal(committed.record.authorizationDecisionHash,H("d"));
  assert.equal(committed.record.artifactHash,committed.artifact.artifactHash);
  assert.deepEqual(committed.record.factIds,committed.facts.map((x:any)=>x.fact.id));
  assert.match(committed.record.recordHash,/^[0-9a-f]{64}$/);
  assert.equal(committed.facts[0].fact.authentication.keyId,"adapter:test:v1");
  assert.equal(committed.facts[0].fact.acquisition.artifactHash,committed.artifact.artifactHash);
  assert.deepEqual(result,{
    status:"COMMITTED",acquisitionId:committed.record.acquisitionId,
    artifactId:committed.artifact.artifactId,artifactHash:committed.artifact.artifactHash,
    factIds:committed.record.factIds
  });
  assert.equal(JSON.stringify({result,committed}).includes("caller-token"),false);
});

test("acquisition rejects unauthorized context before registry resolution or external access",async()=>{
  const phase2:any=await import("../src/index.ts");
  const fetchCounter={count:0},reg=registration(fetchCounter);
  const registry=new phase2.AdapterRegistry([{adapter:reg.adapter,mappers:[reg.mapper],tenantIds:[A.tenantId]}]);
  const signer=createSigner(),attestor=phase2.createAdapterAttestor("adapter:test:v1",signer);
  const ingestor=new phase2.AuthenticatedFactIngestor({
    tenant:A,world:{} as any,keyring:phase2.createIngestionKeyring({[A.tenantId]:{"adapter:test:v1":signer.publicKey}}),
    maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000
  });
  let commits=0;
  const service=new phase2.EvidenceAcquisitionService({
    registry,ingestor,attestor,
    repository:{async commitAcquisition(){commits++;}} as any
  });
  const bad=authorizedContext();
  bad.authorization={...bad.authorization,action:"execution:create",resource:{kind:"execution"}};
  await assert.rejects(()=>service.acquire(bad,request(),NOW,H("2")),/authorization|evidence:acquire|context/i);
  assert.equal(fetchCounter.count,0);
  assert.equal(commits,0);
});

test("all mapped adapter envelopes must authenticate before atomic repository commit",async()=>{
  const phase2:any=await import("../src/index.ts");
  const fetchCounter={count:0},reg=registration(fetchCounter,2);
  const registry=new phase2.AdapterRegistry([{adapter:reg.adapter,mappers:[reg.mapper],tenantIds:[A.tenantId]}]);
  const signer=createSigner(),attestor=phase2.createAdapterAttestor("adapter:test:v1",signer);
  let trustLookups=0;
  const ingestor=new phase2.AuthenticatedFactIngestor({
    tenant:A,world:{} as any,
    keyring:{trustedPublicKeyPem(){
      trustLookups++;
      return trustLookups===1?signer.publicKey.export({type:"spki",format:"pem"}).toString():undefined;
    }},
    maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000
  });
  let commits=0;
  const service=new phase2.EvidenceAcquisitionService({
    registry,ingestor,attestor,
    repository:{async commitAcquisition(){commits++;}} as any
  });
  await assert.rejects(()=>service.acquire(authorizedContext(),request(),NOW,H("2")),/trusted.*key|unknown.*key/i);
  assert.equal(fetchCounter.count,1);
  assert.equal(trustLookups,2);
  assert.equal(commits,0);
});

test("untrusted adapter attestation key fails before evidence persistence",async()=>{
  const phase2:any=await import("../src/index.ts");
  const fetchCounter={count:0},reg=registration(fetchCounter);
  const registry=new phase2.AdapterRegistry([{adapter:reg.adapter,mappers:[reg.mapper],tenantIds:[A.tenantId]}]);
  const signer=createSigner(),other=createSigner(),attestor=phase2.createAdapterAttestor("adapter:test:v1",signer);
  const ingestor=new phase2.AuthenticatedFactIngestor({
    tenant:A,world:{} as any,
    keyring:phase2.createIngestionKeyring({[A.tenantId]:{"adapter:test:v1":other.publicKey}}),
    maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000
  });
  let commits=0;
  const service=new phase2.EvidenceAcquisitionService({
    registry,ingestor,attestor,
    repository:{async commitAcquisition(){commits++;}} as any
  });
  await assert.rejects(()=>service.acquire(authorizedContext(),request(),NOW,H("2")),/signature/i);
  assert.equal(commits,0);
});


test("acquisition validates server-owned operation parameters before adapter access",async()=>{
  const phase2:any=await import("../src/index.ts");
  const fetchCounter={count:0},reg=registration(fetchCounter);
  const registry=new phase2.AdapterRegistry([{adapter:reg.adapter,mappers:[reg.mapper],tenantIds:[A.tenantId]}]);
  const signer=createSigner(),attestor=phase2.createAdapterAttestor("adapter:test:v1",signer);
  const ingestor=new phase2.AuthenticatedFactIngestor({
    tenant:A,world:{} as any,
    keyring:phase2.createIngestionKeyring({[A.tenantId]:{"adapter:test:v1":signer.publicKey}}),
    maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000
  });
  let commits=0;
  const service=new phase2.EvidenceAcquisitionService({
    registry,ingestor,attestor,
    repository:{async commitAcquisition(){commits++;}} as any
  });
  await assert.rejects(()=>service.acquire(
    authorizedContext(),
    {...request(),parameters:{symbol:"XAUUSD",origin:"https://attacker.example"}},
    NOW,H("2")
  ),/parameter schema/i);
  assert.equal(fetchCounter.count,0);
  assert.equal(commits,0);
});
