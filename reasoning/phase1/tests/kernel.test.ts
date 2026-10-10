import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canonicalize, sha256Hex, hashJson, merkleRoot, createDefaultRegistry, compileProgram,
  ProgramValidationError, AxiomRuntime, createSigner, issueCertificate,
  verifyCertificateSignature, replayCertificate, type AxiomProgram, type TypedValue,
  OperationRegistry
} from "../src/index.ts";

const tv=(value:any,type:any,source="fixture"):TypedValue=>({type,value,provenance:{source,contentHash:hashJson(value)}});

function program(maxVol=0.30):AxiomProgram {
  const prices=[1980,1988,1974,1992,2001,1998,2010,2022,2018,2033,2040,2036,2052,2060,2056,2071,2068,2085,2094,2088,2101,2110,2106,2122,2130,2127,2142,2150,2146,2161];
  return {
    irVersion:"0.1", objective:"Evaluate a bounded XAUUSD short-risk decision", assumptions:["Demo price series; not live market data"],
    inputs:{
      prices:tv(prices,{kind:"series",element:{kind:"number",unit:"USD/oz"}}),
      equity:tv("100000.00",{kind:"decimal",unit:"USD",scale:2}),
      risk_fraction:tv("0.005000",{kind:"decimal",unit:"ratio",scale:6}),
      loss_per_unit:tv("1500.00",{kind:"decimal",unit:"USD",scale:2}),
      max_vol:tv(maxVol,{kind:"number",unit:"ratio"}),
      cap:tv("2.00000000",{kind:"decimal",unit:"units",scale:8})
    },
    nodes:[
      {id:"returns",kind:"Transform",operation:"timeseries.returns",inputs:{series:{input:"prices"}}},
      {id:"regression",kind:"Hypothesis",operation:"statistics.regression_index",inputs:{series:{input:"prices"}}},
      {id:"zscore",kind:"Hypothesis",operation:"statistics.zscore_last",inputs:{series:{input:"prices"}}},
      {id:"drawdown",kind:"Transform",operation:"finance.drawdown",inputs:{series:{input:"prices"}}},
      {id:"vol",kind:"Transform",operation:"timeseries.rolling_volatility",inputs:{returns:{node:"returns"}},params:{window:10,annualization:252}},
      {id:"position",kind:"Optimize",operation:"finance.position_size",inputs:{equity:{input:"equity"},risk_fraction:{input:"risk_fraction"},loss_per_unit:{input:"loss_per_unit"}}},
      {id:"capped_position",kind:"Optimize",operation:"optimization.min",inputs:{value:{node:"position"},cap:{input:"cap"}}},
      {id:"vol_ok",kind:"Verify",operation:"comparison.lte",inputs:{left:{node:"vol"},right:{input:"max_vol"}}},
      {id:"position_ok",kind:"Verify",operation:"comparison.lte",inputs:{left:{node:"capped_position"},right:{input:"cap"}}},
      {id:"decision",kind:"Decision",operation:"logic.and",inputs:{a:{node:"vol_ok"},b:{node:"position_ok"}}}
    ],
    constraints:[{id:"risk-envelope",node:"decision",statement:"Volatility and position constraints must pass",severity:"error",expected:true}],
    decisionNodeId:"decision"
  };
}

test("canonical serialization and hashes are stable",()=>{
  assert.equal(canonicalize({b:2,a:1}),'{"a":1,"b":2}');
  assert.equal(sha256Hex("abc"),"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(merkleRoot([sha256Hex("a"),sha256Hex("b")]),merkleRoot([sha256Hex("a"),sha256Hex("b")]));
});

test("compiler rejects missing provenance and unit mismatch",()=>{
  const registry=createDefaultRegistry();
  const p=program();
  delete p.inputs.equity.provenance;
  p.inputs.max_vol.type={kind:"number",unit:"USD"};
  assert.throws(()=>compileProgram(p,registry),(err:any)=>{
    assert.ok(err instanceof ProgramValidationError);
    const codes=err.issues.map((i:any)=>i.code);
    assert.ok(codes.includes("MISSING_PROVENANCE"));
    assert.ok(codes.includes("UNIT_MISMATCH"));
    return true;
  });
});

test("compiler rejects graph cycles",()=>{
  const registry=createDefaultRegistry();
  const p=program();
  p.nodes[0].inputs.series={node:"decision"};
  assert.throws(()=>compileProgram(p,registry),(err:any)=>err instanceof ProgramValidationError && err.issues.some((i:any)=>i.code==="CYCLE_DETECTED"));
});

test("runtime executes deterministic quantitative graph and enforces constraints",()=>{
  const registry=createDefaultRegistry();
  const compiled=compileProgram(program(),registry);
  const a=new AxiomRuntime(registry).execute(compiled);
  const b=new AxiomRuntime(registry).execute(compiled);
  assert.equal(a.decisionStatus,"APPROVED");
  assert.equal(a.executionHash,b.executionHash);
  assert.equal(a.trace.length,10);
  assert.equal(a.outputs.position.value,"0.33333333");
  assert.equal(a.outputs.capped_position.value,"0.33333333");
  const reg=a.outputs.regression.value as any;
  assert.equal(typeof reg.slope,"number");
  assert.ok(Number.isFinite(reg.r));
  const denied=new AxiomRuntime(registry).execute(compileProgram(program(0.01),registry));
  assert.equal(denied.decisionStatus,"DENIED");
  assert.ok(denied.verifications.some(v=>v.kind==="constraint"&&!v.ok));
});

test("certificate is signed and replay is independently reproducible",()=>{
  const registry=createDefaultRegistry();
  const p=compileProgram(program(),registry);
  const execution=new AxiomRuntime(registry).execute(p);
  const signer=createSigner();
  const cert=issueCertificate(p,execution,signer,"2026-10-05T18:00:00.000Z");
  assert.equal(verifyCertificateSignature(cert),true);
  assert.equal(replayCertificate(cert,createDefaultRegistry()).status,"MATCH");
});

test("replay detects mutated inputs",()=>{
  const registry=createDefaultRegistry();
  const p=compileProgram(program(),registry);
  const cert=issueCertificate(p,new AxiomRuntime(registry).execute(p),createSigner(),"2026-10-05T18:00:00.000Z");
  const mutated=structuredClone(cert.replay.program);
  mutated.inputs.equity.value="99999.00";
  const replay=replayCertificate(cert,createDefaultRegistry(),mutated);
  assert.equal(replay.status,"MISMATCH");
  assert.ok(replay.diagnostics.some(x=>x.includes("program hash")));
});

test("replay detects operation implementation/version drift",()=>{
  const registry=createDefaultRegistry();
  const p=compileProgram(program(),registry);
  const cert=issueCertificate(p,new AxiomRuntime(registry).execute(p),createSigner(),"2026-10-05T18:00:00.000Z");
  const drifted=createDefaultRegistry();
  const base=drifted.get("statistics.zscore_last");
  const replacement=new OperationRegistry();
  for(const item of drifted.manifest()){
    const d=drifted.get(item.id);
    replacement.register(item.id===base.id?{...d,version:"99.0.0",implementationHash:"drifted"}:d);
  }
  const replay=replayCertificate(cert,replacement);
  assert.equal(replay.status,"MISMATCH");
  assert.ok(replay.diagnostics.some(x=>x.includes("operation manifest")));
});

test("semantically identical node ordering canonicalizes to the same program hash",()=>{
  const registry=createDefaultRegistry();
  const p1=compileProgram(program(),registry);
  const p2raw=program();
  p2raw.nodes=[...p2raw.nodes].reverse();
  const p2=compileProgram(p2raw,registry);
  const h1=new AxiomRuntime(registry).execute(p1).programHash;
  const h2=new AxiomRuntime(registry).execute(p2).programHash;
  assert.equal(h1,h2);
});

test("certificate envelope metadata is tamper evident",()=>{
  const registry=createDefaultRegistry();
  const p=compileProgram(program(),registry);
  const cert=issueCertificate(p,new AxiomRuntime(registry).execute(p),createSigner(),"2026-10-05T18:00:00.000Z");
  const tampered=structuredClone(cert);
  tampered.issuedAt="2030-01-01T00:00:00.000Z";
  assert.equal(verifyCertificateSignature(tampered),false);
});

test("declared registry operation families execute with typed outputs",()=>{
  const r=createDefaultRegistry();
  const series:TypedValue={type:{kind:"series",element:{kind:"number",unit:"USD"}},value:[1,2,3,4]};
  assert.equal(r.get("statistics.mean").execute({inputs:{series},params:{}}).value,2.5);
  assert.equal(String(r.get("timeseries.moving_average").execute({inputs:{series},params:{window:2}}).value),"1.5,2.5,3.5");
  const left:TypedValue={type:{kind:"number",unit:"USD"},value:5};
  const right:TypedValue={type:{kind:"number",unit:"USD"},value:3};
  assert.equal(r.get("arithmetic.add").execute({inputs:{left,right},params:{}}).value,8);
  assert.equal(r.get("arithmetic.subtract").execute({inputs:{left,right},params:{}}).value,2);
  const value:TypedValue={type:{kind:"number",unit:"USD"},value:12};
  const min:TypedValue={type:{kind:"number",unit:"USD"},value:0};
  const max:TypedValue={type:{kind:"number",unit:"USD"},value:10};
  assert.equal(r.get("optimization.clamp").execute({inputs:{value,min,max},params:{}}).value,10);
});

test("fixed-decimal position sizing uses half-even rounding",()=>{
  const op=createDefaultRegistry().get("finance.position_size");
  const equity:TypedValue={type:{kind:"decimal",unit:"USD",scale:0},value:"1"};
  const loss_per_unit:TypedValue={type:{kind:"decimal",unit:"USD",scale:0},value:"1"};
  const evenTie:TypedValue={type:{kind:"decimal",unit:"ratio",scale:9},value:"0.000000005"};
  const oddTie:TypedValue={type:{kind:"decimal",unit:"ratio",scale:9},value:"0.000000015"};
  assert.equal(op.execute({inputs:{equity,risk_fraction:evenTie,loss_per_unit},params:{}}).value,"0.00000000");
  assert.equal(op.execute({inputs:{equity,risk_fraction:oddTie,loss_per_unit},params:{}}).value,"0.00000002");
});

test("machine-readable schema distinguishes external provenance from inline literals",()=>{
  const schema=JSON.parse(readFileSync(new URL("../spec/axiom-ir.schema.json",import.meta.url),"utf8"));
  assert.equal(schema.properties.inputs.additionalProperties.$ref,"#/$defs/externalInputValue");
  assert.ok(schema.$defs.externalInputValue.required.includes("provenance"));
  assert.ok(!schema.$defs.typedValue.required.includes("provenance"));
});

test("compiler rejects values that do not conform to their declared type",()=>{
  const p=program();
  p.inputs.max_vol.value="0.30" as any;
  p.inputs.max_vol.provenance!.contentHash=hashJson(p.inputs.max_vol.value);
  assert.throws(()=>compileProgram(p,createDefaultRegistry()),(err:any)=>
    err instanceof ProgramValidationError && err.issues.some((i:any)=>i.code==="VALUE_TYPE_MISMATCH")
  );
});

test("certificate issuance rejects an execution from a different program",()=>{
  const registry=createDefaultRegistry();
  const p1=compileProgram(program(),registry);
  const execution=new AxiomRuntime(registry).execute(p1);
  const p2raw=program(0.20);
  p2raw.inputs.max_vol.provenance!.contentHash=hashJson(0.20);
  const p2=compileProgram(p2raw,registry);
  assert.throws(()=>issueCertificate(p2,execution,createSigner(),"2026-10-05T18:00:00.000Z"),/does not belong to program/i);
});

test("operation manifest fingerprints the source module that contains helper implementations",()=>{
  const manifest=createDefaultRegistry().manifest() as any[];
  assert.ok(manifest.length>0);
  assert.ok(manifest.every(x=>typeof x.moduleHash==="string"&&/^[0-9a-f]{64}$/.test(x.moduleHash)));
});

test("certificate verification can bind to an external trust anchor",()=>{
  const registry=createDefaultRegistry();
  const p=compileProgram(program(),registry);
  const attacker=createSigner();
  const trusted=createSigner();
  const cert=issueCertificate(p,new AxiomRuntime(registry).execute(p),attacker,"2026-10-05T18:00:00.000Z");
  const trustedPem=trusted.publicKey.export({type:"spki",format:"pem"}).toString();
  assert.equal(verifyCertificateSignature(cert,trustedPem),false);
});

test("certificate verification accepts the matching external trust anchor",()=>{
  const registry=createDefaultRegistry();
  const p=compileProgram(program(),registry);
  const signer=createSigner();
  const cert=issueCertificate(p,new AxiomRuntime(registry).execute(p),signer,"2026-10-05T18:00:00.000Z");
  const trustedPem=signer.publicKey.export({type:"spki",format:"pem"}).toString();
  assert.equal(verifyCertificateSignature(cert,trustedPem),true);
  assert.equal(verifyCertificateSignature(cert,signer.publicKey),true);
});


test("compiler exposes a stable source-fingerprinted manifest without changing compile behavior",async()=>{
  const phase1:any=await import("../src/index.ts");
  assert.equal(typeof phase1.compilerManifest,"function");
  const manifest=phase1.compilerManifest();
  assert.deepEqual(Object.keys(manifest).sort(),["id","implementationHash","version"]);
  assert.equal(manifest.id,"axiom.phase1-compiler");
  assert.match(manifest.version,/^\d+\.\d+\.\d+$/);
  assert.match(manifest.implementationHash,/^[0-9a-f]{64}$/);
  assert.deepEqual(phase1.compilerManifest(),manifest);

  const registry=createDefaultRegistry();
  const compiled=compileProgram(program(),registry);
  assert.equal(compiled.decisionNodeId,"decision");
});
