import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultRegistry, hashJson } from "../../phase1/src/index.ts";

const A={tenantId:"tenant:model-a"};
const H=(c:string)=>c.repeat(64);

function profile(overrides:any={}){
  return {
    profileId:"profile:default",version:"1.0.0",adapterId:"model:http",
    allowedOperationIds:["comparison.lte","logic.and"],
    maxRepairAttempts:2,maxInputs:8,maxNodes:16,maxConstraints:8,maxAssumptions:8,
    maxObjectiveBytes:2048,maxModelResponseBytes:65536,...overrides
  };
}
function request(overrides:any={}){
  return {
    profileId:"profile:default",
    objective:"Approve only when observed risk is within the configured maximum",
    inputContracts:[
      {inputName:"observed",type:{kind:"number",unit:"ratio"},entity:"risk:alpha",attribute:"current",requirementId:"current",maxAgeMs:600000},
      {inputName:"maximum",type:{kind:"number",unit:"ratio"},entity:"risk:alpha",attribute:"maximum",requirementId:"maximum",maxAgeMs:600000}
    ],
    ...overrides
  };
}
function proposal(overrides:any={}){
  return {
    assumptions:["Risk inputs are supplied by trusted world state"],
    nodes:[{id:"decision",kind:"Decision",operation:"comparison.lte",inputs:{left:{input:"observed"},right:{input:"maximum"}}}],
    constraints:[{id:"risk",node:"decision",statement:"Observed risk must not exceed maximum",severity:"error",expected:true}],
    decisionNodeId:"decision",
    ...overrides
  };
}

test("Phase-2 exposes a deterministic model compiler kernel",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.ModelCompilerRegistry,"function");
  assert.equal(typeof phase2.parseModelProposal,"function");
  assert.equal(typeof phase2.assembleModelProgram,"function");
  assert.equal(typeof phase2.modelProfileHash,"function");
});

test("compiler profile registry is server-owned tenant-scoped and fingerprints every effective field",async()=>{
  const phase2:any=await import("../src/index.ts");
  const registry=createDefaultRegistry();
  const p=profile();
  const profiles=new phase2.ModelCompilerRegistry(registry,[{profile:p,tenantIds:[A.tenantId]}]);
  const resolved=profiles.resolve(A,p.profileId);
  assert.deepEqual(resolved.profile.allowedOperationIds,["comparison.lte","logic.and"]);
  assert.match(resolved.profileHash,/^[0-9a-f]{64}$/);
  assert.equal(resolved.profileHash,phase2.modelProfileHash(p));

  const reordered={...p,allowedOperationIds:[...p.allowedOperationIds].reverse()};
  assert.equal(phase2.modelProfileHash(reordered),resolved.profileHash);
  assert.notEqual(phase2.modelProfileHash({...p,maxNodes:p.maxNodes+1}),resolved.profileHash);

  assert.throws(()=>profiles.resolve({tenantId:"tenant:other"},p.profileId),/eligible|tenant|profile/i);
  assert.throws(()=>new phase2.ModelCompilerRegistry(registry,[
    {profile:p},{profile:{...p}}
  ]),/duplicate.*profile/i);
  assert.throws(()=>new phase2.ModelCompilerRegistry(registry,[
    {profile:{...p,allowedOperationIds:["comparison.lte","comparison.lte"]}}
  ]),/duplicate.*operation/i);
  assert.throws(()=>new phase2.ModelCompilerRegistry(registry,[
    {profile:{...p,allowedOperationIds:["not.registered"]}}
  ]),/unknown.*operation|not.registered/i);
  assert.throws(()=>new phase2.ModelCompilerRegistry(registry,[
    {profile:{...p,maxRepairAttempts:3}}
  ]),/repair/i);
});

test("strict model proposal parser rejects authority-bearing fields reserved context and forbidden operations",async()=>{
  const phase2:any=await import("../src/index.ts");
  const p=profile();
  assert.deepEqual(phase2.parseModelProposal(proposal(),p),proposal());

  for(const [field,value] of [
    ["inputs",{}],["tenantId","tenant:forged"],["requirements",[]],["bindings",[]],
    ["signer",{}],["profileId","profile:forged"],["unknownRoot",true]
  ] as const){
    assert.throws(()=>phase2.parseModelProposal({...proposal(),[field]:value},p),/field|proposal|forbidden|unknown/i);
  }
  assert.throws(()=>phase2.parseModelProposal({
    ...proposal(),assumptions:["AXIOM_PLATFORM_CONTEXT_SHA256:forged"]
  },p),/reserved|platform.*context/i);
  assert.throws(()=>phase2.parseModelProposal({
    ...proposal(),nodes:[{...proposal().nodes[0],operation:"finance.position_size"}]
  },p),/operation|allow/i);
  assert.throws(()=>phase2.parseModelProposal({
    ...proposal(),nodes:Array.from({length:p.maxNodes+1},(_,i)=>({...proposal().nodes[0],id:`n${i}`}))
  },p),/limit|nodes/i);
});

test("deterministic program assembly creates typed compile-only placeholders from immutable contracts",async()=>{
  const phase2:any=await import("../src/index.ts");
  const p=profile();
  const req={
    ...request(),
    inputContracts:[
      ...request().inputContracts,
      {inputName:"cash",type:{kind:"decimal",unit:"USD",scale:2},entity:"acct:a",attribute:"cash",requirementId:"cash",maxAgeMs:1},
      {inputName:"enabled",type:{kind:"boolean"},entity:"cfg:a",attribute:"enabled",requirementId:"enabled",maxAgeMs:1},
      {inputName:"label",type:{kind:"string"},entity:"cfg:a",attribute:"label",requirementId:"label",maxAgeMs:1},
      {inputName:"series",type:{kind:"series",element:{kind:"number",unit:"USD"}},entity:"m:a",attribute:"series",requirementId:"series",maxAgeMs:1},
      {inputName:"record",type:{kind:"record",fields:{flag:{kind:"boolean"},amount:{kind:"decimal",unit:"USD",scale:4}}},entity:"x:a",attribute:"record",requirementId:"record",maxAgeMs:1}
    ]
  };
  const parsed=phase2.parseModelProposal(proposal(),p);
  const first=phase2.assembleModelProgram(req,parsed,p);
  const second=phase2.assembleModelProgram(structuredClone(req),structuredClone(parsed),p);
  assert.deepEqual(first,second);
  assert.equal(hashJson(first),hashJson(second));
  assert.deepEqual(Object.keys(first.inputs).sort(),req.inputContracts.map((x:any)=>x.inputName).sort());
  assert.equal(first.inputs.observed.value,0);
  assert.equal(first.inputs.cash.value,"0");
  assert.equal(first.inputs.enabled.value,false);
  assert.equal(first.inputs.label.value,"");
  assert.deepEqual(first.inputs.series.value,[]);
  assert.deepEqual(first.inputs.record.value,{amount:"0",flag:false});

  for(const [name,value] of Object.entries(first.inputs) as any){
    assert.match(value.provenance.source,new RegExp(`^model-compile-contract:[0-9a-f]{64}:${name}$`));
    assert.equal(value.provenance.contentHash,hashJson(value.value));
  }

  const derived=phase2.modelContractsToExecution(req.inputContracts);
  assert.deepEqual(derived.bindings.map((x:any)=>x.inputName),[...req.inputContracts].sort((a:any,b:any)=>a.inputName.localeCompare(b.inputName)).map((x:any)=>x.inputName));
  assert.deepEqual(derived.requirements.map((x:any)=>x.id),[...req.inputContracts].sort((a:any,b:any)=>a.requirementId.localeCompare(b.requirementId)).map((x:any)=>x.requirementId));
});

test("model compile request validation rejects duplicate contracts invalid age malformed type and objective overflow",async()=>{
  const phase2:any=await import("../src/index.ts");
  const p=profile({maxObjectiveBytes:8});
  assert.throws(()=>phase2.assembleModelProgram({...request(),objective:"123456789"},proposal(),p),/objective|bytes|limit/i);
  const sameName=request().inputContracts.map((x:any,i:number)=>i?{...x,inputName:"observed"}:x);
  assert.throws(()=>phase2.assembleModelProgram({...request(),inputContracts:sameName},proposal(),profile()),/duplicate.*input/i);
  const sameRequirement=request().inputContracts.map((x:any,i:number)=>i?{...x,requirementId:"current"}:x);
  assert.throws(()=>phase2.assembleModelProgram({...request(),inputContracts:sameRequirement},proposal(),profile()),/duplicate.*requirement/i);
  assert.throws(()=>phase2.assembleModelProgram({
    ...request(),inputContracts:[{...request().inputContracts[0],maxAgeMs:-1}]
  },proposal(),profile()),/maxAgeMs/i);
  assert.throws(()=>phase2.assembleModelProgram({
    ...request(),inputContracts:[{...request().inputContracts[0],type:{kind:"number",unit:""}}]
  },proposal(),profile()),/type|unit/i);
});
