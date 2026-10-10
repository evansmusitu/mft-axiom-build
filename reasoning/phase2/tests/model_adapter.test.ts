import test from "node:test";
import assert from "node:assert/strict";
import { hashJson } from "../../phase1/src/canonical.ts";

const H=(c:string)=>c.repeat(64);
const profile={
  profileId:"profile:default",version:"1.0.0",adapterId:"model:http",
  allowedOperationIds:["comparison.lte"],maxRepairAttempts:2,maxInputs:4,maxNodes:8,
  maxConstraints:4,maxAssumptions:4,maxObjectiveBytes:2048,maxModelResponseBytes:4096
};
const manifest={
  adapterId:"model:http",version:"1.0.0",implementationHash:H("a"),
  provider:"fixture-provider",modelId:"fixture-model"
};
const contracts=[
  {inputName:"observed",type:{kind:"number",unit:"ratio"},entity:"risk:a",attribute:"current",requirementId:"current",maxAgeMs:60000},
  {inputName:"maximum",type:{kind:"number",unit:"ratio"},entity:"risk:a",attribute:"maximum",requirementId:"maximum",maxAgeMs:60000}
];
const operations=[{id:"comparison.lte",version:"1.0.0",implementationHash:H("b"),moduleHash:H("c")}];

function input(overrides:any={}){
  return {
    tenant:{tenantId:"tenant:model"},profile,profileHash:hashJson({...profile,allowedOperationIds:[...profile.allowedOperationIds].sort()}),
    compilationRequestHash:H("d"),attempt:0,mode:"INITIAL",
    objective:"Approve only when observed risk is within the configured maximum",
    inputContracts:contracts,operationRegistryManifest:operations,remainingRepairAttempts:2,
    capturedAt:"2026-10-06T18:00:00.000Z",...overrides
  };
}
function validResponse(proposal:any={
  assumptions:[],
  nodes:[{id:"decision",kind:"Decision",operation:"comparison.lte",inputs:{left:{input:"observed"},right:{input:"maximum"}}}],
  constraints:[],
  decisionNodeId:"decision"
}){
  return JSON.stringify({proposal});
}
function response(body:string,status=200,type="application/json"){
  return new Response(body,{status,headers:{"content-type":type}});
}

test("Phase-2 exposes provider-neutral structured model adapter and artifact verification",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.HttpStructuredModelAdapter,"function");
  assert.equal(typeof phase2.createModelExchangeArtifact,"function");
  assert.equal(typeof phase2.verifyModelExchangeArtifact,"function");
});

test("model adapter rejects unsafe origins and unsafe fixed transport headers",async()=>{
  const phase2:any=await import("../src/index.ts");
  const base={
    manifest,compilePath:"/compile",repairPath:"/repair",timeoutMs:1000,maxResponseBytes:4096,
    allowedStatus:[200],secretResolver:{async resolve(){return "secret";}},
    fetchFn:async()=>response(validResponse())
  };
  for(const origin of ["http://models.example","https://127.0.0.1","https://169.254.169.254","https://metadata.google.internal"]){
    assert.throws(()=>new phase2.HttpStructuredModelAdapter({...base,origin}),/https|unsafe|loopback|metadata/i);
  }
  assert.throws(()=>new phase2.HttpStructuredModelAdapter({
    ...base,origin:"https://models.example",fixedHeaders:{authorization:"caller-controlled"}
  }),/header|authorization|sensitive/i);
  assert.throws(()=>new phase2.HttpStructuredModelAdapter({
    ...base,origin:"https://models.example",secretHeaders:{host:"secret:model"}
  }),/header|host|unsafe/i);
});

test("structured model adapter uses fixed paths, sanitized deterministic JSON, and header-only secrets",async()=>{
  const phase2:any=await import("../src/index.ts");
  const calls:any[]=[];let resolves=0;
  const adapter=new phase2.HttpStructuredModelAdapter({
    manifest,origin:"https://models.example",compilePath:"/v1/compile",repairPath:"/v1/repair",
    timeoutMs:1000,maxResponseBytes:4096,allowedStatus:[200],
    fixedHeaders:{"x-axiom-profile":"fixed"},
    secretHeaders:{authorization:"secret:model-token"},
    secretResolver:{async resolve(ref:string){resolves++;assert.equal(ref,"secret:model-token");return "Bearer super-secret";}},
    fetchFn:async(url:any,init:any)=>{calls.push({url:String(url),init});return response(validResponse());}
  });
  const first=await adapter.invoke(input());
  const second=await adapter.invoke(input());
  assert.equal(resolves,2);
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,"https://models.example/v1/compile");
  assert.equal(calls[0].init.redirect,"manual");
  assert.equal(calls[0].init.headers.authorization,"Bearer super-secret");
  assert.equal(calls[0].init.headers["x-axiom-profile"],"fixed");
  assert.equal(first.requestBody,second.requestBody);
  assert.equal(first.responseBody,validResponse());
  assert.equal(first.normalizedResponseBody,validResponse());
  assert.equal(first.requestBody.includes("super-secret"),false);
  assert.equal(first.requestBody.includes("https://models.example"),false);
  assert.equal(first.requestBody.includes("tenant:model"),false);
  const parsed=JSON.parse(first.requestBody);
  assert.equal(parsed.schemaVersion,"axiom.model-proposal.v1");
  assert.equal(parsed.objective,input().objective);
  assert.deepEqual(parsed.inputContracts,[...contracts].sort((a,b)=>a.inputName.localeCompare(b.inputName)));
  assert.deepEqual(parsed.allowedOperations,operations);
  assert.equal(parsed.repair,undefined);
});

test("repair envelope commits prior response deterministic issues and remaining budget without changing authority",async()=>{
  const phase2:any=await import("../src/index.ts");
  let body="";
  const adapter=new phase2.HttpStructuredModelAdapter({
    manifest,origin:"https://models.example",compilePath:"/compile",repairPath:"/repair",
    timeoutMs:1000,maxResponseBytes:4096,allowedStatus:[200],
    secretResolver:{async resolve(){throw new Error("must not resolve");}},
    fetchFn:async(url:any,init:any)=>{assert.equal(String(url),"https://models.example/repair");body=String(init.body);return response(validResponse());}
  });
  const issues=[
    {code:"TYPE_MISMATCH",nodeId:"z",message:"z"},
    {code:"MODEL_PROPOSAL_SCHEMA",message:"root"},
    {code:"UNKNOWN_OPERATION",nodeId:"a",message:"a"}
  ];
  const prior='{"proposal":{"bad":true}}';
  await adapter.invoke(input({attempt:1,mode:"REPAIR",previousResponseBody:prior,issues,remainingRepairAttempts:1}));
  const parsed=JSON.parse(body);
  assert.equal(parsed.objective,input().objective);
  assert.deepEqual(parsed.inputContracts,[...contracts].sort((a,b)=>a.inputName.localeCompare(b.inputName)));
  assert.deepEqual(parsed.allowedOperations,operations);
  assert.equal(parsed.repair.previousResponseBody,prior);
  assert.equal(parsed.repair.remainingRepairAttempts,1);
  assert.deepEqual(parsed.repair.issues,[
    {code:"MODEL_PROPOSAL_SCHEMA",message:"root"},
    {code:"UNKNOWN_OPERATION",nodeId:"a",message:"a"},
    {code:"TYPE_MISMATCH",nodeId:"z",message:"z"}
  ]);
});

test("adapter fails closed on redirects status media JSON schema secret echo and response bounds",async()=>{
  const phase2:any=await import("../src/index.ts");
  const make=(fetchFn:any,maxResponseBytes=64)=>new phase2.HttpStructuredModelAdapter({
    manifest,origin:"https://models.example",compilePath:"/compile",repairPath:"/repair",
    timeoutMs:1000,maxResponseBytes,allowedStatus:[200],
    secretHeaders:{authorization:"secret:model"},
    secretResolver:{async resolve(){return "top-secret";}},fetchFn
  });
  await assert.rejects(()=>make(async()=>response("",302)).invoke(input()),(e:any)=>e?.httpStatus===502);
  await assert.rejects(()=>make(async()=>response("{}",500)).invoke(input()),(e:any)=>e?.httpStatus===502);
  await assert.rejects(()=>make(async()=>response("{}",200,"text/plain")).invoke(input()),(e:any)=>e?.httpStatus===415);
  await assert.rejects(()=>make(async()=>response("{",200)).invoke(input()),(e:any)=>e?.httpStatus===502);
  await assert.rejects(()=>make(async()=>response(JSON.stringify({proposal:{},extra:true}),200)).invoke(input()),(e:any)=>e?.httpStatus===502);
  await assert.rejects(()=>make(async()=>response(JSON.stringify({proposal:"bad"}),200)).invoke(input()),(e:any)=>e?.httpStatus===502);
  await assert.rejects(()=>make(async()=>response(JSON.stringify({proposal:{secret:"top-secret"}}),200),4096).invoke(input()),(e:any)=>e?.httpStatus===502);
  await assert.rejects(()=>make(async()=>response(validResponse()),16).invoke(input()),(e:any)=>e?.httpStatus===413);
});

test("adapter rejects exact secret material in sanitized outbound request before network I/O",async()=>{
  const phase2:any=await import("../src/index.ts");
  let calls=0;
  const adapter=new phase2.HttpStructuredModelAdapter({
    manifest,origin:"https://models.example",compilePath:"/compile",repairPath:"/repair",
    timeoutMs:1000,maxResponseBytes:4096,allowedStatus:[200],
    secretHeaders:{authorization:"secret:model"},
    secretResolver:{async resolve(){return "objective-secret";}},
    fetchFn:async()=>{calls++;return response(validResponse());}
  });
  await assert.rejects(()=>adapter.invoke(input({objective:"Do not persist objective-secret"})),/secret|request/i);
  assert.equal(calls,0);
});

test("model exchange artifacts bind exact sanitized request response and metadata and detect tampering",async()=>{
  const phase2:any=await import("../src/index.ts");
  const captured={capturedAt:"2026-10-06T18:00:00.000Z",requestBody:'{"request":"safe"}',responseBody:'{"provider":"raw"}',normalizedResponseBody:validResponse()};
  const artifact=phase2.createModelExchangeArtifact({
    tenantId:"tenant:model",manifest,profileId:profile.profileId,profileHash:input().profileHash,
    compilationRequestHash:H("d"),attempt:0,mode:"INITIAL",captured
  });
  assert.match(artifact.artifactId,/^model-artifact:[0-9a-f]{64}$/);
  assert.match(artifact.requestBodyHash,/^[0-9a-f]{64}$/);
  assert.match(artifact.responseBodyHash,/^[0-9a-f]{64}$/);
  assert.match(artifact.normalizedResponseBodyHash,/^[0-9a-f]{64}$/);
  assert.equal(artifact.normalizedResponseBody,validResponse());
  assert.deepEqual(phase2.verifyModelExchangeArtifact({tenantId:"tenant:model"},artifact),artifact);
  for(const mutate of [
    (x:any)=>{x.requestBody='{"request":"changed"}';},
    (x:any)=>{x.responseBody='{"proposal":{}}';},
    (x:any)=>{x.normalizedResponseBody='{"proposal":{"changed":true}}';},
    (x:any)=>{x.normalizedResponseBodyHash=H("9");},
    (x:any)=>{x.profileHash=H("e");},
    (x:any)=>{x.tenantId="tenant:other";},
    (x:any)=>{x.artifactHash=H("f");}
  ]){
    const changed=structuredClone(artifact);mutate(changed);
    assert.throws(()=>phase2.verifyModelExchangeArtifact({tenantId:"tenant:model"},changed),/tenant|integrity|hash/i);
  }
});


test("Phase-2.4B preserves legacy artifacts while independently binding normalized provider output",async()=>{
  const phase2:any=await import("../src/index.ts");
  const captured={capturedAt:"2026-10-06T18:00:00.000Z",requestBody:'{"request":"safe"}',responseBody:'{"provider":"raw"}',normalizedResponseBody:validResponse()};
  const current=phase2.createModelExchangeArtifact({
    tenantId:"tenant:model",manifest,profileId:profile.profileId,profileHash:input().profileHash,
    compilationRequestHash:H("d"),attempt:0,mode:"INITIAL",captured
  });
  assert.notEqual(current.responseBodyHash,current.normalizedResponseBodyHash);
  assert.deepEqual(phase2.verifyModelExchangeArtifact({tenantId:"tenant:model"},current),current);

  const legacyCaptured={capturedAt:"2026-10-06T18:00:00.000Z",requestBody:'{"request":"safe"}',responseBody:validResponse()};
  const legacy=phase2.createModelExchangeArtifact({
    tenantId:"tenant:model",manifest,profileId:profile.profileId,profileHash:input().profileHash,
    compilationRequestHash:H("d"),attempt:0,mode:"INITIAL",captured:legacyCaptured
  });
  assert.equal("normalizedResponseBody" in legacy,false);
  assert.deepEqual(phase2.verifyModelExchangeArtifact({tenantId:"tenant:model"},legacy),legacy);
});
