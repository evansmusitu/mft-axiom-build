import test from "node:test";
import assert from "node:assert/strict";
import { canonicalize, hashJson, createDefaultRegistry, compileProgram, AxiomRuntime, ProgramValidationError, createSigner, issueCertificate, replayCertificate, compilerManifest } from "../src/index.ts";

function program():any {
  return {irVersion:"0.1",objective:"An explicit bounded boolean decision",assumptions:[],inputs:{},nodes:[{id:"decision",kind:"Decision",operation:"logic.not",inputs:{value:{literal:{type:{kind:"boolean"},value:false}}}}],constraints:[],decisionNodeId:"decision"};
}

test("canonical JSON preserves reserved own keys at every depth",()=>{
  const a=JSON.parse('{"nested":{"__proto__":{"value":1},"constructor":2,"prototype":3}}');
  const b=JSON.parse('{"nested":{"__proto__":{"value":9},"constructor":2,"prototype":3}}');
  assert.equal(canonicalize(a),'{"nested":{"__proto__":{"value":1},"constructor":2,"prototype":3}}');
  assert.notEqual(hashJson(a),hashJson(b));
});

test("canonical JSON rejects non-JSON values rather than omitting them",()=>{
  for(const value of [{a:undefined},{a:()=>1},[undefined],new Date(),{a:NaN}]) assert.throws(()=>canonicalize(value as any),TypeError);
  const cycle:any={};cycle.self=cycle;assert.throws(()=>canonicalize(cycle),TypeError);
});

test("serialized IR enums, reference unions and type parameters fail before execution",()=>{
  const mutations=[
    (p:any)=>p.constraints.push({id:"c",node:"decision",statement:"Must be false",severity:"ERROR",expected:false}),
    (p:any)=>p.nodes[0].kind="decision",
    (p:any)=>p.nodes[0].inputs.value={input:"missing",literal:{type:{kind:"boolean"},value:false}},
    (p:any)=>p.nodes[0].inputs.value.literal.type={kind:"decimal",unit:"USD",scale:-1},
    (p:any)=>p.nodes[0].extra="unexpected",
    (p:any)=>p.assumptions=[false],
    (p:any)=>p.inputs=null,
  ];
  for(const mutate of mutations){const p=program();mutate(p);assert.throws(()=>new AxiomRuntime(createDefaultRegistry()).execute(p),ProgramValidationError);}
});

test("standalone execution and certificate bind registry and compiler module identities",async()=>{
  const registry=createDefaultRegistry(),p=compileProgram(program(),registry),execution=new AxiomRuntime(registry).execute(p);
  const entry=registry.manifest().find(row=>row.id==="logic.not")!;
  assert.deepEqual(execution.operationManifest,[entry]);
  assert.deepEqual(execution.compilerManifest,compilerManifest());
  const cert=issueCertificate(p,execution,createSigner());
  assert.deepEqual((cert.core as any).compilerManifest,compilerManifest());
  // Identical callback bodies and version but a different module identity must not replay as MATCH.
  const alternate=createDefaultRegistry();
  const manifest=alternate.manifest.bind(alternate);
  alternate.manifest=()=>manifest().map(row=>({...row,moduleHash:"f".repeat(64)}));
  assert.equal(replayCertificate(cert,alternate).status,"MISMATCH");
});

test("reserved node identifiers remain represented in outputs and commitments",()=>{
  const p=program();p.nodes[0].id="__proto__";p.decisionNodeId="__proto__";
  const result=new AxiomRuntime(createDefaultRegistry()).execute(p);
  assert.equal(Object.hasOwn(result.outputs,"__proto__"),true);
  assert.equal(result.outputs["__proto__"].value,true);
});
