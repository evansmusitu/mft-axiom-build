import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as phase2 from "../src/index.ts";
import pg from "pg";

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


test("trusted compile and explanation services reject unbudgeted OpenAI and Anthropic adapters",()=>{
  const makeCompiler=(adapter:any)=>new phase2.ModelCompilationService({
    profiles:{resolve(){throw new Error("not used");}} as any,
    repository:{commitCompilation(){throw new Error("not used");}} as any,
    registry:{manifest(){return [];}} as any,adapter
  });
  const makeExplainer=(adapter:any)=>new phase2.ModelExplanationService({
    tenant:scope(),profiles:{} as any,repository:{} as any,executions:{} as any,
    plane:{async replayStored(){return {status:"MATCH" as const,diagnostics:[]};}},
    adapters:[adapter]
  });
  for(const provider of ["openai","anthropic"] as const){
    let calls=0;
    const unbudgeted={
      manifest:manifest(provider),
      async invoke(){calls++;throw new Error("network must not be invoked");},
      async explain(){calls++;throw new Error("network must not be invoked");}
    };
    assert.throws(()=>makeCompiler(unbudgeted),/budget|metered/i);
    assert.throws(()=>makeExplainer(unbudgeted),/budget|metered/i);
    assert.equal(calls,0);
  }
  const x=setup("openai");
  assert.doesNotThrow(()=>makeCompiler(x.wrapped));
  assert.doesNotThrow(()=>makeExplainer(x.wrapped));
  x.ledger.close();
  const fixture={
    manifest:{...manifest("openai"),provider:"fixture"},
    async invoke(){throw new Error("not called");},
    async explain(){throw new Error("not called");}
  };
  assert.doesNotThrow(()=>makeCompiler(fixture));
  assert.doesNotThrow(()=>makeExplainer(fixture));
});


test("budgeted explanation registration denies a different tenant without spending",()=>{
  const x=setup("openai");
  try{
    assert.throws(()=>new phase2.ModelExplanationService({
      tenant:scope("tenant:b"),
      profiles:{} as any,repository:{} as any,executions:{} as any,
      plane:{async replayStored(){return {status:"MATCH" as const,diagnostics:[]};}},
      adapters:[x.wrapped]
    }),/tenant mismatch/i);
    assert.equal(x.calls,0);
    assert.equal(x.ledger.status(scope(),"test:openai","test-model").chargedMicroUsd,0);
  }finally{x.ledger.close();}
});


test("paid provider decorators reject user-supplied no-op spend ledgers before any provider call",()=>{
  for(const provider of ["openai","anthropic"] as const){
    let calls=0,attemptedAccounting=0;
    const adapter={
      manifest:manifest(provider),
      async invoke(){calls++;return exchange(openAi({input_tokens:1,output_tokens:1,total_tokens:2}));},
      async explain(){calls++;return exchange(openAi({input_tokens:1,output_tokens:1,total_tokens:2}));}
    };
    const fakeLedger={
      reserve(){attemptedAccounting++;},
      settle(){attemptedAccounting++;}
    };
    assert.throws(()=>new phase2.BudgetedModelProviderAdapter({
      adapter,ledger:fakeLedger,tenantId:"tenant:a",
      prices,requestReserveMicroUsd:700
    }),/trusted|ledger|budget/i);
    assert.equal(calls,0);
    assert.equal(attemptedAccounting,0);
  }
});


test("forged ledger prototypes and patched reservation methods cannot impersonate trusted billing",()=>{
  let calls=0;
  const adapter={
    manifest:manifest("openai"),
    async invoke(){calls++;return exchange(openAi({input_tokens:1,output_tokens:1,total_tokens:2}));},
    async explain(){calls++;return exchange(openAi({input_tokens:1,output_tokens:1,total_tokens:2}));}
  };
  const register=(ledger:any)=>new phase2.BudgetedModelProviderAdapter({
    adapter,ledger,tenantId:"tenant:a",prices,requestReserveMicroUsd:700
  });

  const impersonator=Object.create(phase2.PostgresProviderSpendLedger.prototype);
  impersonator.reserve=()=>{};
  impersonator.settle=()=>{};
  assert.throws(()=>register(impersonator),/trusted|budget|ledger/i);

  const real=new phase2.SqliteProviderSpendLedger(":memory:");
  try{
    real.reserve=()=>{};
    assert.throws(()=>register(real),/trusted|budget|ledger/i);
  }finally{real.close();}
  assert.equal(calls,0);
});


test("metered provider rejects accounting-method replacement after registration before issuing a vendor request",async()=>{
  const x=setup();
  try{
    (x.ledger as any).reserve=()=>{};
    await assert.rejects(()=>x.wrapped.invoke({
      tenant:scope(),compilationRequestHash:"d".repeat(64),attempt:0,mode:"INITIAL"
    }),/trusted|ledger|budget/i);
    assert.equal(x.calls,0);
    assert.equal(x.ledger.status(scope(),"test:openai","test-model").chargedMicroUsd,0);
  }finally{x.ledger.close();}
});

test("metered provider detects settlement-method replacement during a vendor call and retains its reservation",async()=>{
  const ledger=new phase2.SqliteProviderSpendLedger(":memory:");
  ledger.provision(scope(),"test:openai","test-model",1000);
  let calls=0;
  const adapter={
    manifest:manifest("openai"),
    async invoke(){
      calls++;
      (ledger as any).settle=()=>{};
      return exchange(openAi({input_tokens:100,output_tokens:50,total_tokens:150}));
    },
    async explain(){throw new Error("not called");}
  };
  const wrapped=new phase2.BudgetedModelProviderAdapter({
    adapter,ledger,tenantId:"tenant:a",prices,requestReserveMicroUsd:700
  });
  try{
    await assert.rejects(()=>wrapped.invoke({
      tenant:scope(),compilationRequestHash:"e".repeat(64),attempt:0,mode:"INITIAL"
    }),/trusted|ledger|budget/i);
    assert.equal(calls,1);
    assert.deepEqual(ledger.status(scope(),"test:openai","test-model"),{
      limitMicroUsd:1000,chargedMicroUsd:0,reservedMicroUsd:700,availableMicroUsd:300
    });
  }finally{ledger.close();}
});


test("prototype-wide accounting hook replacement cannot bypass an already registered paid provider ledger",async()=>{
  const x=setup();
  const prototype=phase2.SqliteProviderSpendLedger.prototype as any;
  const originalReserve=prototype.reserve,originalSettle=prototype.settle;
  try{
    prototype.reserve=()=>{};
    prototype.settle=()=>{};
    await assert.rejects(()=>x.wrapped.invoke({
      tenant:scope(),compilationRequestHash:"f".repeat(64),attempt:0,mode:"INITIAL"
    }),/trusted|ledger|budget/i);
    assert.equal(x.calls,0);
    assert.equal(x.ledger.status(scope(),"test:openai","test-model").chargedMicroUsd,0);
  }finally{
    prototype.reserve=originalReserve;
    prototype.settle=originalSettle;
    x.ledger.close();
  }
});


test("SQLite provider settlement refuses unsafe aggregate charges without corrupting an outstanding reservation",()=>{
  const ledger=new phase2.SqliteProviderSpendLedger(":memory:");
  const provider="test:openai",modelId="test-model",tenantId="tenant:a";
  const reserve=(requestId:string,requestHash:string,reserveMicroUsd:number)=>
    ledger.reserve({tenantId,provider,modelId,requestId,requestHash,reserveMicroUsd});
  const settle=(requestId:string,requestHash:string,chargeMicroUsd:number)=>
    ledger.settle({tenantId,provider,modelId,requestId,requestHash,chargeMicroUsd,responseHash:"f".repeat(64)});
  try{
    ledger.provision(scope(),provider,modelId,1000);
    reserve("settled-first","a".repeat(64),700);
    settle("settled-first","a".repeat(64),600);
    reserve("overlarge-second","b".repeat(64),100);
    assert.throws(()=>settle("overlarge-second","b".repeat(64),Number.MAX_SAFE_INTEGER),
      (error:any)=>error?.code==="BUDGET_CORRUPT",
      "unsafe aggregate charges must fail closed before SQLite mutates stored balances");
    assert.deepEqual(ledger.status(scope(),provider,modelId),{
      limitMicroUsd:1000,chargedMicroUsd:600,reservedMicroUsd:100,availableMicroUsd:300
    });
  }finally{ledger.close();}
});


test("PostgreSQL billing ledger refuses injected fake and prototype-forged connection pools",()=>{
  // A branded ledger with a fabricated pool could make reserve/settle
  // succeed without writing any shared accounting state.
  let connections=0;
  const fakePool={async connect(){connections++;return {
    async query(){return {rowCount:1,rows:[{limit_micro_usd:"1000",charged_micro_usd:"0",reserved_micro_usd:"0",billing_provider:"openai",suspended:false}]};},
    release(){}
  };}};
  assert.throws(()=>new phase2.PostgresProviderSpendLedger(fakePool as any),/trusted|pool|postgres/i);
  assert.equal(connections,0);
});

test("PostgreSQL ledger rejects a forged Pool prototype and changed connect hook before billing",async()=>{
  const forged=Object.create(pg.Pool.prototype);
  assert.throws(()=>new phase2.PostgresProviderSpendLedger(forged),/trusted|pool|postgres/i);
  const genuine=new pg.Pool({max:1,connectionTimeoutMillis:200});
  try{
    const ledger=new phase2.PostgresProviderSpendLedger(genuine);
    let intercepted=0;
    (genuine as any).connect=async()=>{
      intercepted++;
      return {async query(){return {rowCount:1,rows:[]};},release(){}};
    };
    await assert.rejects(()=>ledger.reserve({
      tenantId:"tenant:authority",provider:"adapter:authority",modelId:"model:authority",
      billingProvider:"openai",requestId:"intent:authority",requestHash:"d".repeat(64),reserveMicroUsd:100
    }),/trusted|pool|unavailable|budget/i);
    assert.equal(intercepted,0,"tampered pool connect must not be called");
  }finally{await genuine.end();}
});


test("paid provider registration refuses zero input or output token prices before calling upstream",()=>{
  const ledger=new phase2.SqliteProviderSpendLedger(":memory:");
  let calls=0;
  const adapter={
    manifest:manifest("openai"),
    async invoke(){calls++;return exchange(openAi({input_tokens:50,output_tokens:50,total_tokens:100}));},
    async explain(){calls++;return exchange(openAi({input_tokens:50,output_tokens:50,total_tokens:100}));}
  };
  try{
    for(const invalidPrices of [
      {...prices,inputMicrosPerMillionTokens:0},
      {...prices,outputMicrosPerMillionTokens:0},
      {inputMicrosPerMillionTokens:0,outputMicrosPerMillionTokens:0,
        cacheReadMicrosPerMillionTokens:0,cacheWriteMicrosPerMillionTokens:0}
    ]){
      assert.throws(()=>new phase2.BudgetedModelProviderAdapter({
        adapter,ledger,tenantId:"tenant:a",prices:invalidPrices,requestReserveMicroUsd:700
      }),/price|rate|paid|positive/i);
    }
    assert.equal(calls,0,"invalid rates must reject before upstream I/O");
  }finally{ledger.close();}
});


test("SQLite metered provider ignores caller replacement of its internal database handle",async()=>{
  const x=setup();
  try{
    // A trusted provider ledger must not consult this forged storage object.
    // Only the database opened by its original constructor may hold accounts.
    (x.ledger as any).db={
      exec(){throw new Error("FORGED_SPEND_DATABASE_USED");},
      prepare(){throw new Error("FORGED_SPEND_DATABASE_USED");},
      close(){}
    };
    await x.wrapped.invoke({
      tenant:scope(),compilationRequestHash:"1".repeat(64),attempt:0,mode:"INITIAL"
    });
    assert.equal(x.calls,1);
    assert.deepEqual(x.ledger.status(scope(),"test:openai","test-model"),{
      limitMicroUsd:1000,chargedMicroUsd:200,reservedMicroUsd:0,availableMicroUsd:800
    });
  }finally{x.ledger.close();}
});
