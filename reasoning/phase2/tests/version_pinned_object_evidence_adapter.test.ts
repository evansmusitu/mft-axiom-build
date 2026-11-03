import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {VersionPinnedObjectEvidenceAdapter} from "../src/version_pinned_object_evidence_adapter.ts";
const H=(x:string)=>x.repeat(64),A={tenantId:"tenant:object-a"},B={tenantId:"tenant:object-b"};
const body='{"value":42,"unit":"ratio"}';
const bytes=new TextEncoder().encode(body);
const digest=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
function fixture(){
 const calls:any[]=[];
 const reader={async readVersion(x:any){
  calls.push(x);
  return {versionId:"v-001",mediaType:"application/json",body:new Uint8Array(bytes)};
 }};
 const op={operationId:"snapshot.read",parameterSchemaHash:H("a"),
  responseMediaTypes:["application/json"],maxResponseBytes:256,timeoutMs:500,
  mappingIds:["map:object"]};
 const base={manifest:op,bucket:"market-evidence",key:"snapshots/risk.json",
  versionId:"v-001",expectedSha256:digest(bytes),tenantIds:[A.tenantId]};
 const make=(overrides:any={})=>new VersionPinnedObjectEvidenceAdapter({
  adapterId:"adapter:objects",version:"1.0.0",implementationHash:H("b"),
  reader,operations:[{...base,...overrides}]
 });
 return {reader,make,calls,op,input:(parameters:any={},tenant=A)=>({operation:op,tenant,parameters})};
}
test("pinned object adapter fetches only server-registered immutable version and returns exact hash-verified bytes",async()=>{
 const f=fixture(),adapter=f.make();
 assert.equal(adapter.manifest.capability,"READ");
 const result=await adapter.acquire(f.input());
 assert.deepEqual(result,{status:200,mediaType:"application/json",bodyEncoding:"utf8",body});
 assert.equal(f.calls.length,1);
 assert.deepEqual({bucket:f.calls[0].bucket,key:f.calls[0].key,versionId:f.calls[0].versionId},
  {bucket:"market-evidence",key:"snapshots/risk.json",versionId:"v-001"});
 assert.ok(f.calls[0].signal instanceof AbortSignal);
});
test("caller cannot override tenant, bucket, object key, version, URL or size",async()=>{
 const f=fixture(),adapter=f.make();
 for(const parameters of [{bucket:"other"},{key:"../secret"},{versionId:"latest"},
  {url:"https://attacker.example"},{maxResponseBytes:99999},{tenantId:B.tenantId}]){
  await assert.rejects(()=>adapter.acquire(f.input(parameters)),/parameter|unexpected|invalid/i);
 }
 await assert.rejects(()=>adapter.acquire(f.input({},B)),/tenant|forbidden/i);
 await assert.rejects(()=>adapter.acquire({
  ...f.input(),operation:{...f.op,maxResponseBytes:99999}
 }),/operation|manifest/i);
 assert.equal(f.calls.length,0);
});
test("registry rejects path traversal, ambiguous versions, unpinned hashes and unsafe tenant allowlists",()=>{
 const f=fixture();
 for(const x of [
  {bucket:"../../private"},
  {key:"../secrets.json"},
  {key:"/absolute/secret.json"},
  {key:"snapshots//risk.json"},
  {versionId:""},
  {versionId:"latest"},
  {expectedSha256:H("Z")},
  {tenantIds:[]},
  {tenantIds:[A.tenantId,A.tenantId]},
  {manifest:{...f.op,responseMediaTypes:["text/plain"]}}
 ])assert.throws(()=>f.make(x),/invalid|unsafe|duplicate|tenant|version|media|path|hash|object/i);
});
test("mismatched content, false version, wrong MIME and unbounded or malformed JSON fail closed",async()=>{
 const cases=[
  {versionId:"v-002",mediaType:"application/json",body:bytes},
  {versionId:"v-001",mediaType:"text/plain",body:bytes},
  {versionId:"v-001",mediaType:"application/json",body:new TextEncoder().encode('{"value":43}')},
  {versionId:"v-001",mediaType:"application/json",body:new Uint8Array(257)},
  {versionId:"v-001",mediaType:"application/json",body:new TextEncoder().encode("{broken")},
  {versionId:"v-001",mediaType:"application/json",body:new Uint8Array([0xff,0xfe])}
 ];
 for(const payload of cases){
  const f=fixture();f.reader.readVersion=async (x:any)=>{f.calls.push(x);return payload;};
  await assert.rejects(()=>f.make().acquire(f.input()),/version|media|hash|bytes|size|json|encoding/i);
  assert.equal(f.calls.length,1);
 }
});
test("reader timeout aborts the signal and rejects even if provider ignores cancellation",async()=>{
 const f=fixture();let signal:AbortSignal|undefined;
 f.reader.readVersion=async (x:any)=>{signal=x.signal;return new Promise<any>(()=>{});};
 const adapter=f.make({manifest:{...f.op,timeoutMs:10}});
 const input={...f.input(),operation:{...f.op,timeoutMs:10}};
 await assert.rejects(()=>adapter.acquire(input),/timeout|deadline/i);
 assert.equal(signal?.aborted,true);
});

test("pinned object evidence only enters world state through authorized Ed25519-attested acquisition",async()=>{
 const phase=await import("../src/index.ts");
 const {createSigner}=await import("../../phase1/src/index.ts");
 const f=fixture(),adapter=f.make();
 const mapper={manifest:{mappingId:"map:object",version:"1",implementationHash:H("c")},
  map(artifact:any){const json=JSON.parse(artifact.body);return [{
   entity:"risk:immutable",attribute:"value",
   value:{type:{kind:"number",unit:"ratio"},value:json.value},
   validFrom:"2026-11-01T12:00:00.000Z",observedAt:"2026-11-01T12:00:01.000Z",
   source:"object:trusted",confidence:1
  }];}};
 const registry=new phase.AdapterRegistry([{adapter,mappers:[mapper],tenantIds:[A.tenantId]}]);
 const signer=createSigner();
 const attestor=phase.createAdapterAttestor("attestor:object",signer);
 const ingestor=new phase.AuthenticatedFactIngestor({tenant:A,world:{} as any,
  keyring:phase.createIngestionKeyring({[A.tenantId]:{"attestor:object":signer.publicKey}}),
  maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000});
 const commits:any[]=[];
 const service=new phase.EvidenceAcquisitionService({registry,attestor,ingestor,
  repository:{async commitAcquisition(...args:any[]){commits.push(args);}} as any});
 const context={principal:{principalId:"principal:object",issuer:"iss",subject:"sub"},
  credential:{issuer:"iss",subject:"sub",keyId:"key",jwtId:"jti",
   issuedAt:"2026-11-01T12:00:00.000Z",expiresAt:"2026-11-01T12:01:00.000Z",tokenHash:H("0")},
  tenant:A,authorization:{status:"ALLOW",principalId:"principal:object",requestedTenantId:A.tenantId,
   action:"evidence:acquire",resource:{kind:"evidence"},matchedGrantIds:["grant:object"],
   policyManifest:{id:"axiom.api-authorization",version:"1",implementationHash:H("2"),grantsHash:H("3")},
   decisionHash:H("4")}} as any;
 const request={adapterId:"adapter:objects",operationId:"snapshot.read",mappingId:"map:object",parameters:{}};
 const result=await service.acquire(context,request,"2026-11-01T12:00:05.000Z",H("9"));
 assert.equal(result.status,"COMMITTED");
 assert.equal(f.calls.length,1);
 assert.equal(commits.length,1);
 const [scope,artifact,record,facts]=commits[0];
 assert.deepEqual(scope,A);
 assert.equal(artifact.body,body);
 assert.equal(record.artifactHash,artifact.artifactHash);
 assert.equal(facts[0].fact.authentication.keyId,"attestor:object");
 assert.equal(facts[0].fact.acquisition.artifactHash,artifact.artifactHash);
 assert.equal(facts[0].fact.value.value,42);
 await assert.rejects(()=>service.acquire({...context,authorization:{
  ...context.authorization,action:"model:execute"}},request,"2026-11-01T12:00:06.000Z",H("f")),
  /evidence:acquire/);
 assert.equal(f.calls.length,1);
});
