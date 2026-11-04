import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as phase2 from "../src/index.ts";

const manifest=(provider:"openai"|"anthropic")=>({
  adapterId:"test:"+provider,version:"1.0.0",implementationHash:"a".repeat(64),
  provider,modelId:"test-model"
});
const prices={
  inputMicrosPerMillionTokens:1000000,
  outputMicrosPerMillionTokens:2000000,
  cacheReadMicrosPerMillionTokens:250000,
  cacheWriteMicrosPerMillionTokens:1250000
};
const openAi=(usage:any)=>JSON.stringify({id:"response",usage});
const anthropic=(usage:any)=>JSON.stringify({id:"message",usage});
const exchange=(body:string)=>({
  capturedAt:"2026-11-03T00:00:00.000Z",requestBody:"{}",responseBody:body,normalizedResponseBody:"{}"
});
const scope=(tenantId="tenant:a")=>({tenantId});
function setup(provider:"openai"|"anthropic"="openai",limit=1000,reserve=700,body?:string){
  assert.equal(typeof (phase2 as any).SqliteProviderSpendLedger,"function");
  assert.equal(typeof (phase2 as any).BudgetedModelProviderAdapter,"function");
  const ledger=new (phase2 as any).SqliteProviderSpendLedger(":memory:");
  ledger.provision(scope(),"test:"+provider,"test-model",limit);
  let calls=0;
  const adapter={
    manifest:manifest(provider),
    async invoke(){calls++;return exchange(body??openAi({input_tokens:100,output_tokens:50,total_tokens:150}));},
    async explain(){calls++;return exchange(body??openAi({input_tokens:100,output_tokens:50,total_tokens:150}));}
  };
  const wrapped=new (phase2 as any).BudgetedModelProviderAdapter({
    adapter,ledger,tenantId:"tenant:a",prices,requestReserveMicroUsd:reserve
  });
  return {ledger,wrapped,get calls(){return calls;}};
}

test("provider billing reports actual OpenAI tokens at configured micro-USD prices and releases unused reservation",async()=>{
  const x=setup();
  await x.wrapped.invoke({tenant:scope(),compilationRequestHash:"b".repeat(64),attempt:0,mode:"INITIAL",capturedAt:"2026-11-03T00:00:00.000Z"});
  assert.equal(x.calls,1);
  assert.deepEqual(x.ledger.status(scope(),"test:openai","test-model"),{
    limitMicroUsd:1000,chargedMicroUsd:200,reservedMicroUsd:0,availableMicroUsd:800
  });
});

test("budget denial occurs before any provider request and never spills into another tenant",async()=>{
  const x=setup("openai",100,700);
  await assert.rejects(()=>x.wrapped.invoke({tenant:scope(),compilationRequestHash:"b".repeat(64),attempt:0,mode:"INITIAL"}),/budget|limit/i);
  assert.equal(x.calls,0);
  await assert.rejects(()=>x.wrapped.invoke({tenant:scope("tenant:b"),compilationRequestHash:"b".repeat(64),attempt:0,mode:"INITIAL"}),/tenant/i);
  assert.equal(x.calls,0);
});

test("missing or malformed vendor usage keeps reservation for reconciliation and prevents double billing on retry",async()=>{
  const x=setup("openai",1000,700,openAi({input_tokens:5,output_tokens:-1,total_tokens:4}));
  const input={tenant:scope(),compilationRequestHash:"b".repeat(64),attempt:0,mode:"INITIAL"};
  await assert.rejects(()=>x.wrapped.invoke(input),/usage|token/i);
  assert.equal(x.calls,1);
  assert.equal(x.ledger.status(scope(),"test:openai","test-model").reservedMicroUsd,700);
  await assert.rejects(()=>x.wrapped.invoke(input),/pending|reserved|duplicate|reconciliation/i);
  assert.equal(x.calls,1);
});

test("Anthropic cache creation and read tokens are separately accounted, not silently discarded",async()=>{
  const x=setup("anthropic",1000,700,anthropic({
    input_tokens:100,output_tokens:50,cache_read_input_tokens:20,cache_creation_input_tokens:40
  }));
  await x.wrapped.invoke({tenant:scope(),compilationRequestHash:"c".repeat(64),attempt:0,mode:"INITIAL"});
  assert.equal(x.ledger.status(scope(),"test:anthropic","test-model").chargedMicroUsd,255);
});

test("explanation calls are also budgeted and cannot be charged twice by identical request",async()=>{
  const x=setup();
  const input={capturedAt:"2026-11-03T00:00:00.000Z",promptBody:"proof-hash-only",maxResponseBytes:4096};
  await x.wrapped.explain(input);
  assert.equal(x.ledger.status(scope(),"test:openai","test-model").chargedMicroUsd,200);
  await assert.rejects(()=>x.wrapped.explain(input),/duplicate|already|settled/i);
  assert.equal(x.calls,1);
});

test("two SQLite handles share a persisted tenant budget, preventing over-allocation",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-budget-"));
  try{
    const path=join(dir,"budget.db");
    const a=new (phase2 as any).SqliteProviderSpendLedger(path);
    const b=new (phase2 as any).SqliteProviderSpendLedger(path);
    a.provision(scope(),"test:openai","test-model",1000);
    a.reserve({tenantId:"tenant:a",provider:"test:openai",modelId:"test-model",requestId:"request-1",requestHash:"a".repeat(64),reserveMicroUsd:700});
    assert.throws(()=>b.reserve({tenantId:"tenant:a",provider:"test:openai",modelId:"test-model",requestId:"request-2",requestHash:"b".repeat(64),reserveMicroUsd:700}),/budget|limit/i);
    assert.equal(b.status(scope(),"test:openai","test-model").reservedMicroUsd,700);
    a.close();b.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("unexpected higher provider charge is recorded, flagged, and prevents additional calls",async()=>{
  const x=setup("openai",1000,100,openAi({input_tokens:400,output_tokens:100,total_tokens:500}));
  await assert.rejects(()=>x.wrapped.invoke({tenant:scope(),compilationRequestHash:"f".repeat(64),attempt:0,mode:"INITIAL"}),/overage|reservation/i);
  const s=x.ledger.status(scope(),"test:openai","test-model");
  assert.equal(s.chargedMicroUsd,600);
  assert.equal(s.reservedMicroUsd,0);
  await assert.rejects(()=>x.wrapped.invoke({tenant:scope(),compilationRequestHash:"e".repeat(64),attempt:0,mode:"INITIAL"}),/overage|suspended/i);
  assert.equal(x.calls,1);
});
