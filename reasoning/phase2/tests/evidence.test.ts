import test from "node:test";
import assert from "node:assert/strict";

const A={tenantId:"tenant:a"},B={tenantId:"tenant:b"};
const H=(c:string)=>c.repeat(64);

function adapter(){
  return {
    manifest:{
      adapterId:"adapter:test",version:"1.0.0",implementationHash:H("a"),capability:"READ",
      operations:[{
        operationId:"read",parameterSchemaHash:H("b"),responseMediaTypes:["application/json"],
        maxResponseBytes:1024,timeoutMs:1000,mappingIds:["map:v1"]
      }]
    },
    validateParameters(){},
    async acquire(){return {status:200,mediaType:"application/json",body:'{"price":2400}'};}
  };
}
function mapper(hash=H("c")){
  return {
    manifest:{mappingId:"map:v1",version:"1.0.0",implementationHash:hash},
    map(){
      return [{
        entity:"market:xauusd",attribute:"price",
        value:{type:{kind:"number",unit:"USD/oz"},value:2400},
        validFrom:"2026-10-06T09:59:00.000Z",observedAt:"2026-10-06T09:59:30.000Z",
        source:"adapter:test",confidence:1
      }];
    }
  };
}

test("Phase-2 exposes the deterministic external evidence kernel",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.AdapterRegistry,"function");
  assert.equal(typeof phase2.createEvidenceArtifact,"function");
  assert.equal(typeof phase2.verifyEvidenceArtifact,"function");
  assert.equal(typeof phase2.mapEvidenceArtifact,"function");
  assert.equal(typeof phase2.StaticSecretResolver,"function");
});

test("adapter registry is server-owned, tenant-eligible, and rejects ambiguous manifests",async()=>{
  const phase2:any=await import("../src/index.ts");
  const a=adapter(),m=mapper();
  const registry=new phase2.AdapterRegistry([{adapter:a,mappers:[m],tenantIds:[A.tenantId]}]);
  const resolved=registry.resolve(A,"adapter:test","read","map:v1");
  assert.equal(resolved.adapter,a);
  assert.equal(resolved.mapper,m);
  assert.equal(resolved.operation.operationId,"read");

  assert.throws(()=>registry.resolve(B,"adapter:test","read","map:v1"),/tenant|available|eligible/i);
  assert.throws(()=>registry.resolve(A,"adapter:test","missing","map:v1"),/operation/i);
  assert.throws(()=>registry.resolve(A,"adapter:test","read","missing"),/mapping/i);
  assert.throws(()=>new phase2.AdapterRegistry([
    {adapter:a,mappers:[m]},
    {adapter:a,mappers:[m]}
  ]),/duplicate.*adapter/i);

  const duplicateOperation=adapter();
  duplicateOperation.manifest.operations.push(structuredClone(duplicateOperation.manifest.operations[0]));
  assert.throws(()=>new phase2.AdapterRegistry([{adapter:duplicateOperation,mappers:[m]}]),/duplicate.*operation/i);
});

test("evidence artifacts bind exact captured bytes, tenant, adapter, operation, mapping, and request",async()=>{
  const phase2:any=await import("../src/index.ts");
  const artifact=phase2.createEvidenceArtifact({
    tenantId:A.tenantId,
    adapterId:"adapter:test",adapterVersion:"1.0.0",adapterImplementationHash:H("a"),
    operationId:"read",mappingId:"map:v1",canonicalRequestHash:H("d"),
    capturedAt:"2026-10-06T10:00:00.000Z",upstreamStatus:200,
    mediaType:"application/json",bodyEncoding:"utf8",body:'{"price":2400}'
  });
  assert.match(artifact.bodyHash,/^[0-9a-f]{64}$/);
  assert.match(artifact.artifactHash,/^[0-9a-f]{64}$/);
  assert.equal(artifact.artifactId,`artifact:${artifact.artifactHash}`);
  assert.deepEqual(phase2.verifyEvidenceArtifact(A,artifact),artifact);

  assert.throws(()=>phase2.verifyEvidenceArtifact(A,{...artifact,body:'{"price":1}'}),/integrity|hash/i);
  assert.throws(()=>phase2.verifyEvidenceArtifact(A,{...artifact,operationId:"other"}),/integrity|hash/i);
  assert.throws(()=>phase2.verifyEvidenceArtifact(B,artifact),/tenant/i);
});

test("deterministic mapping creates provenance-bound fact IDs and detects mapper drift",async()=>{
  const phase2:any=await import("../src/index.ts");
  const artifact=phase2.verifyEvidenceArtifact(A,phase2.createEvidenceArtifact({
    tenantId:A.tenantId,
    adapterId:"adapter:test",adapterVersion:"1.0.0",adapterImplementationHash:H("a"),
    operationId:"read",mappingId:"map:v1",canonicalRequestHash:H("d"),
    capturedAt:"2026-10-06T10:00:00.000Z",upstreamStatus:200,
    mediaType:"application/json",bodyEncoding:"utf8",body:'{"price":2400}'
  }));
  const first=phase2.mapEvidenceArtifact(A,artifact,mapper());
  const second=phase2.mapEvidenceArtifact(A,artifact,mapper());
  assert.deepEqual(second,first);
  assert.equal(first.length,1);
  assert.match(first[0].id,/^fact:[0-9a-f]{64}$/);
  assert.equal(first[0].acquisition.artifactHash,artifact.artifactHash);
  assert.equal(first[0].acquisition.mappingImplementationHash,H("c"));
  assert.equal(Object.prototype.hasOwnProperty.call(first[0],"authentication"),false);

  const drifted=phase2.mapEvidenceArtifact(A,artifact,mapper(H("e")));
  assert.notEqual(drifted[0].id,first[0].id);
  assert.equal(drifted[0].acquisition.mappingImplementationHash,H("e"));
});

test("static secret resolver returns only configured server-side secret references",async()=>{
  const phase2:any=await import("../src/index.ts");
  const resolver=new phase2.StaticSecretResolver({"secret:upstream":"top-secret"});
  assert.equal(await resolver.resolve("secret:upstream"),"top-secret");
  await assert.rejects(()=>resolver.resolve("secret:missing"),/unknown|secret/i);
});


test("adapter registry requires an executable server-side parameter validator",async()=>{
  const phase2:any=await import("../src/index.ts");
  const a:any=adapter();
  delete a.validateParameters;
  assert.throws(
    ()=>new phase2.AdapterRegistry([{adapter:a,mappers:[mapper()]}]),
    /parameter.*validator|validateParameters/i
  );
});
