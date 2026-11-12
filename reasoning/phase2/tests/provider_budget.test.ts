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


test("PostgreSQL ledger is not redirected by a replaced public pool property",async()=>{
  const original=new pg.Pool({host:"127.0.0.1",port:1,
    connectionTimeoutMillis:100,max:1});
  const ledger=new phase2.PostgresProviderSpendLedger(original);
  try{
    Object.defineProperty(ledger,"pool",{
      configurable:true,get(){throw new Error("FORGED_POSTGRES_POOL_USED");}
    });
    await assert.rejects(()=>ledger.status(scope(),"test:openai","test-model"),
      (error:any)=>error?.code==="BUDGET_STORE_UNAVAILABLE",
      "trusted billing should attempt its original Pool and fail safely on unavailable database");
  }finally{await original.end();}
});


test("post-registration shadowed reserve cannot authorize a paid call below the approved hold",async()=>{
  const x=setup("openai",500,700);
  try{
    try{Object.defineProperty(x.wrapped,"requestReserveMicroUsd",{configurable:true,value:1});}catch{}
    await assert.rejects(
      ()=>x.wrapped.invoke({tenant:scope(),compilationRequestHash:"1".repeat(64),attempt:0,mode:"INITIAL"}),
      (e:any)=>e?.code==="BUDGET_EXCEEDED");
    assert.equal(x.calls,0,"no paid provider call may occur after an inadequate reserve");
  }finally{x.ledger.close();}
});

test("post-registration price mutation cannot silently undercharge billable tokens",async()=>{
  const x=setup();
  try{
    try{(x.wrapped as any).prices.outputMicrosPerMillionTokens=1;}catch{}
    await x.wrapped.invoke({tenant:scope(),compilationRequestHash:"2".repeat(64),attempt:0,mode:"INITIAL"});
    assert.equal(x.ledger.status(scope(),"test:openai","test-model").chargedMicroUsd,200);
  }finally{x.ledger.close();}
});

test("shadowing the metering method on a trusted decorator cannot bypass ledger writes",async()=>{
  const x=setup();
  try{
    try{Object.defineProperty(x.wrapped,"metered",{configurable:true,
      value:async (_intent:unknown,run:()=>Promise<unknown>)=>run()});}catch{}
    await x.wrapped.invoke({tenant:scope(),compilationRequestHash:"3".repeat(64),attempt:0,mode:"INITIAL"});
    assert.equal(x.ledger.status(scope(),"test:openai","test-model").chargedMicroUsd,200);
  }finally{x.ledger.close();}
});

test("global decorator prototype mutation cannot replace the metering path",async()=>{
  const x=setup(),proto=Object.getPrototypeOf(x.wrapped);
  const original=Object.getOwnPropertyDescriptor(proto,"metered");
  assert.ok(original);
  try{
    try{Object.defineProperty(proto,"metered",{...original,
      value:async (_intent:unknown,run:()=>Promise<unknown>)=>run()});}catch{}
    await x.wrapped.invoke({tenant:scope(),compilationRequestHash:"4".repeat(64),attempt:0,mode:"INITIAL"});
    assert.equal(x.ledger.status(scope(),"test:openai","test-model").chargedMicroUsd,200);
  }finally{
    if(Object.getOwnPropertyDescriptor(proto,"metered")?.value!==original.value)
      Object.defineProperty(proto,"metered",original);
    x.ledger.close();
  }
});

test("changing the underlying provider's transport after registration is denied before vendor access",async()=>{
  const x=setup(),raw=(x.wrapped as any).adapter;
  let replacementCalls=0;
  try{
    raw.invoke=async()=>{replacementCalls++;return exchange(openAi({input_tokens:100,output_tokens:50,total_tokens:150}));};
    await assert.rejects(
      ()=>x.wrapped.invoke({tenant:scope(),compilationRequestHash:"5".repeat(64),attempt:0,mode:"INITIAL"}),
      (e:any)=>e?.code==="BUDGET_PROVIDER_TAMPERED");
    assert.equal(replacementCalls,0,"an unapproved swapped transport must never execute");
    assert.equal(x.ledger.status(scope(),"test:openai","test-model").chargedMicroUsd,0);
  }finally{x.ledger.close();}
});


test("production admission rejects SQLite and administrator PostgreSQL paid ledgers before vendor calls",async()=>{
  let providerCalls=0;
  const adapter={
    manifest:manifest("openai"),
    async invoke(){providerCalls++;return exchange(openAi({input_tokens:1,output_tokens:1,total_tokens:2}));},
    async explain(){providerCalls++;return exchange(openAi({input_tokens:1,output_tokens:1,total_tokens:2}));}
  };
  const compiler=(wrapped:any,mode:any=true)=>new phase2.ModelCompilationService({
    profiles:{resolve(){throw Error("not used");}} as any,
    repository:{commitCompilation(){throw Error("not used");}} as any,
    registry:{manifest(){return [];}} as any,
    adapter:wrapped,productionBillingRequired:mode
  });
  const explainer=(wrapped:any,mode:any=true)=>new phase2.ModelExplanationService({
    tenant:scope(),profiles:{} as any,repository:{} as any,executions:{} as any,
    plane:{async replayStored(){return {status:"MATCH" as const,diagnostics:[]};}},
    adapters:[wrapped],productionBillingRequired:mode
  });
  const wrapper=(ledger:any)=>new phase2.BudgetedModelProviderAdapter({
    adapter,ledger,tenantId:"tenant:a",prices,requestReserveMicroUsd:700
  });
  const sqlite=new phase2.SqliteProviderSpendLedger(":memory:");
  const pgPool=new pg.Pool({max:1,connectionTimeoutMillis:100});
  try{
    const adminPg=new phase2.PostgresProviderSpendLedger(pgPool);
    for(const ledger of [sqlite,adminPg]){
      const wrapped=wrapper(ledger);
      for(const register of [compiler,explainer]){
        assert.throws(()=>register(wrapped),(e:any)=>e?.code==="BUDGET_PROTECTED_LEDGER_REQUIRED");
        assert.doesNotThrow(()=>register(wrapped,false),
          "offline compatibility remains explicitly supported");
      }
      assert.throws(()=>phase2.requireProtectedPaidProviderAdapter(wrapped,scope().tenantId),
        (e:any)=>e?.code==="BUDGET_PROTECTED_LEDGER_REQUIRED");
    }
    const protectedPg=new phase2.ProtectedPostgresProviderSpendLedger(pgPool);
    const protectedAdapter=wrapper(protectedPg);
    assert.doesNotThrow(()=>compiler(protectedAdapter));
    assert.doesNotThrow(()=>explainer(protectedAdapter));
    assert.doesNotThrow(()=>phase2.requireProtectedPaidProviderAdapter(protectedAdapter,scope().tenantId));
    assert.throws(()=>phase2.requireProtectedPaidProviderAdapter(protectedAdapter,"tenant:elsewhere"),
      (e:any)=>e?.code==="BUDGET_TENANT_MISMATCH");
    for(const register of [compiler,explainer]){
      assert.throws(()=>register(protectedAdapter,"true" as any),/boolean|billing/i,
        "unrecognized admission settings must not silently disable protected mode");
    }
    assert.equal(providerCalls,0,"registration is never permission for upstream network access");
  }finally{sqlite.close();await pgPool.end();}
});


test("trusted accounting ledger constructor verifier cannot be overwritten to bless fake spending",()=>{
  let calls=0,accounting=0;
  const fakeLedger={
    reserve(){accounting++;},settle(){accounting++;}
  };
  const raw={
    manifest:manifest("openai"),
    async invoke(){calls++;return exchange(openAi({input_tokens:1,output_tokens:1,total_tokens:2}));},
    async explain(){calls++;return exchange(openAi({input_tokens:1,output_tokens:1,total_tokens:2}));}
  };
  const register=(ledger:any)=>new phase2.BudgetedModelProviderAdapter({
    adapter:raw,ledger,tenantId:"tenant:a",prices,requestReserveMicroUsd:700
  });
  for(const ledgerClass of [phase2.SqliteProviderSpendLedger,
    phase2.PostgresProviderSpendLedger,phase2.ProtectedPostgresProviderSpendLedger]){
    const ctor=ledgerClass as any,original=ctor.isAuthenticLedger;
    try {
      try{ctor.isAuthenticLedger=()=>true;}catch{}
      assert.equal(ctor.isAuthenticLedger,original,
        "class-level trust verification must not be replaceable after module initialization");
      assert.throws(()=>register(fakeLedger),/trusted|ledger|budget/i,
        "a fake ledger may never be admitted by a forged class trust check");
    }finally{
      if(ctor.isAuthenticLedger!==original)ctor.isAuthenticLedger=original;
    }
  }
  assert.equal(calls,0,"no paid provider traffic from a fake ledger");
  assert.equal(accounting,0,"fake billing hooks must not run");
});


// Offline first-party PostgreSQL Pool regression: a retained Pool.connect method
// is NOT sufficient if the underlying connection settings change post-admission.
test("both PostgreSQL budget ledgers fail closed on mutated Pool connection settings",async()=>{
  for(const Ledger of [phase2.PostgresProviderSpendLedger,phase2.ProtectedPostgresProviderSpendLedger]){
    const pool=new pg.Pool({host:"127.0.0.1",port:1,user:"synthetic_worker",database:"central_spend",
      password:"test-only",connectionTimeoutMillis:50,max:1});
    try{
      const ledger=new Ledger(pool);
      assert.equal(Ledger.isAuthenticLedger(ledger),true);
      (pool.options as any).host="other-unverified-db.invalid";
      assert.equal(Ledger.isAuthenticLedger(ledger),false,
        "changed PostgreSQL destination must invalidate authentic budget store before any call");
      await assert.rejects(()=>ledger.reserve({
        tenantId:"tenant:guard",provider:"adapter:guard",modelId:"model:guard",
        billingProvider:"openai",requestId:"intent:guard",requestHash:"f".repeat(64),reserveMicroUsd:10
      }), (err:any)=>err?.code==="BUDGET_STORE_UNAVAILABLE");
    }finally{await pool.end();}
  }
});


// Phase 2.10I TDD: authentic Pool.connect and unchanged Pool.options do not
// suffice if the mutable Pool.Client factory is replaced after admission.
test("both PostgreSQL ledgers reject an unapproved pg Pool.Client factory before or after admission",async()=>{
  for(const Ledger of [phase2.PostgresProviderSpendLedger,phase2.ProtectedPostgresProviderSpendLedger]){
    const pool=new pg.Pool({host:"127.0.0.1",port:1,user:"synthetic_worker",database:"central_spend",
      password:"test-only",connectionTimeoutMillis:50,max:1});
    let fabricated=0;
    class FakeClient{constructor(){fabricated++;}}
    const originalClient=(pool as any).Client;
    try{
      (pool as any).Client=FakeClient;
      assert.throws(()=>new Ledger(pool),/trusted|pool|postgres/i,
        "pre-constructor fake Client must never establish billing authority");
      (pool as any).Client=originalClient;
      const ledger=new Ledger(pool);
      assert.equal(Ledger.isAuthenticLedger(ledger),true);
      (pool as any).Client=FakeClient;
      assert.equal(Ledger.isAuthenticLedger(ledger),false,
        "mutable client factory must revoke registered billing authority");
      await assert.rejects(()=>ledger.reserve({
        tenantId:"tenant:guard",provider:"adapter:guard",modelId:"model:guard",
        billingProvider:"openai",requestId:"intent:guard",requestHash:"f".repeat(64),reserveMicroUsd:10
      }), (e:any)=>e?.code==="BUDGET_STORE_UNAVAILABLE");
      assert.equal(fabricated,0,"fake client constructor must never be called");
    }finally{
      (pool as any).Client=originalClient;
      await pool.end();
    }
  }
});

test("both PostgreSQL ledgers deny a substituted pg Pool.newClient execution hook",async()=>{
  for(const Ledger of [phase2.PostgresProviderSpendLedger,phase2.ProtectedPostgresProviderSpendLedger]){
    const pool=new pg.Pool({host:"127.0.0.1",port:1,user:"synthetic_worker",database:"central_spend",
      password:"test-only",connectionTimeoutMillis:50,max:1});
    let fakeCalls=0;
    const fakeNewClient=()=>{fakeCalls++;throw new Error("UNTRUSTED_CLIENT_FACTORY");};
    try{
      (pool as any).newClient=fakeNewClient;
      assert.throws(()=>new Ledger(pool),/trusted|pool|postgres/i,
        "unapproved client creation hook must fail before ledger registration");
      delete (pool as any).newClient;
      const ledger=new Ledger(pool);
      assert.equal(Ledger.isAuthenticLedger(ledger),true);
      (pool as any).newClient=fakeNewClient;
      assert.equal(Ledger.isAuthenticLedger(ledger),false,
        "changed client creation method must revoke registered billing authority");
      await assert.rejects(()=>ledger.reserve({
        tenantId:"tenant:guard",provider:"adapter:guard",modelId:"model:guard",
        billingProvider:"openai",requestId:"intent:guard",requestHash:"f".repeat(64),reserveMicroUsd:10
      }), (e:any)=>e?.code==="BUDGET_STORE_UNAVAILABLE");
      assert.equal(fakeCalls,0,"injected newClient must not run");
    }finally{
      delete (pool as any).newClient;
      await pool.end();
    }
  }
});


test("both PostgreSQL ledgers refuse modified canonical pg Client SQL and connect methods",async()=>{
  const proto=pg.Client.prototype as any;
  for(const method of ["query","connect"] as const){
    const trustedMethod=proto[method];
    for(const Ledger of [phase2.PostgresProviderSpendLedger,phase2.ProtectedPostgresProviderSpendLedger]){
      const pool=new pg.Pool({host:"127.0.0.1",port:1,user:"synthetic_worker",database:"central_spend",
        password:"test-only",connectionTimeoutMillis:50,max:1});
      let fakeCalls=0;
      try{
        const ledger=new Ledger(pool);
        assert.equal(Ledger.isAuthenticLedger(ledger),true);
        proto[method]=function forgedSqlBoundary(){fakeCalls++;throw new Error("FORGED_PG_CLIENT_METHOD");};
        assert.equal(Ledger.isAuthenticLedger(ledger),false,
          "modified canonical pg Client "+method+" must revoke protected spending trust before SQL");
        await assert.rejects(()=>ledger.reserve({
          tenantId:"tenant:guard",provider:"adapter:guard",modelId:"model:guard",
          billingProvider:"openai",requestId:"intent:guard",requestHash:"f".repeat(64),reserveMicroUsd:10
        }), (e:any)=>e?.code==="BUDGET_STORE_UNAVAILABLE");
        assert.equal(fakeCalls,0,"forged pg.Client."+method+" must never run");
      }finally{
        proto[method]=trustedMethod;
        await pool.end();
      }
    }
  }
});


test("Phase 2.10J acquired PostgreSQL client must be genuine and preserve SQL method identity before BEGIN",async()=>{
  const {EventEmitter}=await import("node:events");
  for(const Ledger of [phase2.PostgresProviderSpendLedger,phase2.ProtectedPostgresProviderSpendLedger]){
    for(const shape of ["substituted-client","patched-genuine-client"]){
      const pool=new pg.Pool({host:"127.0.0.1",port:1,user:"synthetic_worker",database:"central_spend",
        password:"test-only",connectionTimeoutMillis:100,max:1,idleTimeoutMillis:1});
      let executed=0;
      const forgedQuery=async()=>{executed++;throw new Error("UNTRUSTED_ACQUIRED_CLIENT_QUERY");};
      const client:any=shape==="patched-genuine-client"
        ?new pg.Client((pool as any).options)
        :new EventEmitter();
      client.query=forgedQuery;
      // Reproduce a compromised, already-idle pooled client without opening
      // any network connection or monkeypatching trusted Pool.connect.
      if(shape==="substituted-client"){
        client.end=()=>client.emit("end");
        client.ref=()=>{};
        client._queryable=true;
        client._ending=false;
      }
      (pool as any)._clients.push(client);
      (pool as any)._idle.push({client,idleListener:()=>{},timeoutId:undefined});
      try{
        const ledger=new Ledger(pool);
        assert.equal(Ledger.isAuthenticLedger(ledger),true,
          "pre-check currently sees an unmodified real pool");
        await assert.rejects(()=>ledger.reserve({
          tenantId:"tenant:guard",provider:"adapter:guard",modelId:"model:guard",
          billingProvider:"openai",requestId:"intent:guard",requestHash:"f".repeat(64),reserveMicroUsd:10
        }), (error:any)=>error?.code==="BUDGET_STORE_UNAVAILABLE");
        assert.equal(executed,0,
          "forged "+shape+" must be denied after Pool.connect but before BEGIN/ROLLBACK/SQL");
      }finally{
        for(const idle of (pool as any)._idle){if(idle.timeoutId)clearTimeout(idle.timeoutId);}
        (pool as any)._idle.length=0;
        (pool as any)._clients.length=0;
        await pool.end();
      }
    }
  }
});


test("Phase 2.10K checked-out PostgreSQL client must retain approved endpoint role database and TLS identity",async()=>{
  const approved={
    host:"approved-db.invalid",port:15432,user:"budget_runtime",database:"axiom_spend",
    password:"synthetic-only",ssl:{rejectUnauthorized:true,ca:"synthetic-ca"},
    connectionTimeoutMillis:100,max:1,idleTimeoutMillis:1
  };
  const changes=[
    ["host",{host:"different-db.invalid"}],
    ["port",{port:15433}],
    ["role",{user:"alternate_runtime"}],
    ["database",{database:"unprotected_spend"}],
    ["tls",{ssl:{rejectUnauthorized:false}}]
  ] as const;
  for(const Ledger of [phase2.PostgresProviderSpendLedger,phase2.ProtectedPostgresProviderSpendLedger]){
    for(const [label,override] of changes){
      const pool=new pg.Pool(approved);
      const acquired:any=new pg.Client({...approved,...override});
      // A real pg.Client can still have been constructed for another endpoint
      // before being injected into the idle Pool. No TCP or provider calls.
      acquired._queryable=false;
      (pool as any)._clients.push(acquired);
      (pool as any)._idle.push({client:acquired,idleListener:()=>{},timeoutId:undefined});
      try{
        const ledger=new Ledger(pool);
        assert.equal(Ledger.isAuthenticLedger(ledger),true,
          "Pool-level authority alone cannot attest an injected idle client's origin");
        await assert.rejects(()=>ledger.reserve({
          tenantId:"tenant:guard",provider:"adapter:guard",modelId:"model:guard",
          billingProvider:"openai",requestId:"intent:guard",requestHash:"f".repeat(64),reserveMicroUsd:10
        }), (error:any)=>error?.code==="BUDGET_STORE_UNAVAILABLE" &&
          /Untrusted acquired PostgreSQL accounting client/.test(error?.message),
          "mismatched acquired "+label+" must be caught before client.query/BEGIN");
      }finally{
        for(const idle of (pool as any)._idle){if(idle.timeoutId)clearTimeout(idle.timeoutId);}
        (pool as any)._idle.length=0;
        (pool as any)._clients.length=0;
        await pool.end();
      }
    }
  }
});


test("Phase 2.10L acquired PostgreSQL client must retain pinned credential identity before any SQL",async()=>{
  const approved={
    host:"approved-db.invalid",port:15432,user:"budget_runtime",database:"axiom_spend",
    password:"synthetic-approved-credential",ssl:{rejectUnauthorized:true,ca:"synthetic-ca"},
    connectionTimeoutMillis:100,max:1,idleTimeoutMillis:1
  };
  for(const Ledger of [phase2.PostgresProviderSpendLedger,phase2.ProtectedPostgresProviderSpendLedger]){
    for(const mutation of ["client-password","connection-parameters-password"] as const){
      const pool=new pg.Pool(approved);
      const acquired:any=new pg.Client(approved);
      if(mutation==="client-password")acquired.password="synthetic-unapproved-credential";
      else acquired.connectionParameters.password="synthetic-unapproved-credential";
      // Inject only a disconnected genuine pg.Client; never open a socket.
      // A missing admission check would reach query() and yield a different error.
      acquired._queryable=false;
      (pool as any)._clients.push(acquired);
      (pool as any)._idle.push({client:acquired,idleListener:()=>{},timeoutId:undefined});
      try{
        const ledger=new Ledger(pool);
        assert.equal(Ledger.isAuthenticLedger(ledger),true,
          "pool admission alone cannot establish an acquired client's credential identity");
        await assert.rejects(()=>ledger.reserve({
          tenantId:"tenant:credential",provider:"adapter:credential",modelId:"model:credential",
          billingProvider:"openai",requestId:"intent:credential",
          requestHash:"a".repeat(64),reserveMicroUsd:10
        }), (error:any)=>error?.code==="BUDGET_STORE_UNAVAILABLE" &&
          /Untrusted acquired PostgreSQL accounting client/.test(error?.message),
          "modified "+mutation+" must be rejected before accounting SQL");
      }finally{
        for(const idle of (pool as any)._idle){if(idle.timeoutId)clearTimeout(idle.timeoutId);}
        (pool as any)._idle.length=0;
        (pool as any)._clients.length=0;
        await pool.end();
      }
    }
  }
});


test("Phase 2.10N SQLite spend mutations stay bound to validated tenant and values with adversarial getters",()=>{
  const ledger=new phase2.SqliteProviderSpendLedger(":memory:");
  const a={tenantId:"tenant:sqlite-pinned-source"},b={tenantId:"tenant:sqlite-pinned-target"};
  const provider="adapter:sqlite-pinned",modelId="model:sqlite-pinned";
  try{
    ledger.provision(a,provider,modelId,100);
    ledger.provision(b,provider,modelId,100);
    let reservationReads=0,amountReads=0;
    ledger.reserve({
      get tenantId(){return ++reservationReads<5?a.tenantId:b.tenantId;},
      provider,modelId,requestId:"sqlite-pinned-1",requestHash:"a".repeat(64),
      get reserveMicroUsd(){amountReads++;return 50;}
    });
    assert.equal(ledger.status(a,provider,modelId).reservedMicroUsd,50,
      "the originally validated SQLite tenant must receive its own reserved amount");
    assert.equal(ledger.status(b,provider,modelId).reservedMicroUsd,0,
      "a changed getter must not direct a budget UPDATE to another tenant");
    assert.equal(reservationReads,1,"reservation identity is read exactly once");
    assert.equal(amountReads,1,"reservation cost is read exactly once");
    let settlementReads=0,chargeReads=0;
    ledger.settle({
      get tenantId(){return ++settlementReads<5?a.tenantId:b.tenantId;},
      provider,modelId,requestId:"sqlite-pinned-1",requestHash:"a".repeat(64),
      get chargeMicroUsd(){chargeReads++;return 25;},responseHash:"b".repeat(64)
    });
    assert.deepEqual(ledger.status(a,provider,modelId),{
      limitMicroUsd:100,chargedMicroUsd:25,reservedMicroUsd:0,availableMicroUsd:75
    });
    assert.deepEqual(ledger.status(b,provider,modelId),{
      limitMicroUsd:100,chargedMicroUsd:0,reservedMicroUsd:0,availableMicroUsd:100
    });
    assert.equal(settlementReads,1,"settlement identity is read exactly once");
    assert.equal(chargeReads,1,"settlement amount is read exactly once");
  }finally{ledger.close();}
});


test("Phase 2.10O paid model input sent upstream must match the exact tenant and prompt actually metered",async()=>{
  const ledger=new phase2.SqliteProviderSpendLedger(":memory:");
  const seen:{tenantId?:string;mode?:string;prompt?:string}={};
  let upstreamCalls=0;
  const adapter={
    manifest:manifest("openai"),
    async invoke(input:any){
      upstreamCalls++;
      seen.tenantId=input.tenant.tenantId;
      seen.mode=input.mode;
      return exchange(openAi({input_tokens:100,output_tokens:50,total_tokens:150}));
    },
    async explain(input:any){
      upstreamCalls++;
      seen.prompt=input.promptBody;
      return exchange(openAi({input_tokens:100,output_tokens:50,total_tokens:150}));
    }
  };
  try{
    ledger.provision(scope("tenant:a"),"test:openai","test-model",1000);
    const wrapped=new phase2.BudgetedModelProviderAdapter({
      adapter,ledger,tenantId:"tenant:a",prices,requestReserveMicroUsd:300
    });
    let tenantReads=0,modeReads=0;
    await wrapped.invoke({
      tenant:{get tenantId(){return ++tenantReads===1?"tenant:a":"tenant:b";}},
      compilationRequestHash:"d".repeat(64),attempt:0,
      get mode(){modeReads++;return modeReads<=2?"INITIAL":"REPAIR";},
      capturedAt:"2026-11-12T00:00:00.000Z"
    } as any);
    assert.equal(seen.tenantId,"tenant:a",
      "a metered tenant:a reservation must not invoke paid provider on tenant:b input");
    assert.equal(seen.mode,"INITIAL",
      "paid request mode must not change after request identity was computed");
    assert.equal(tenantReads,1,"provider must receive a private snapshot rather than re-read a tenant getter");
    assert.equal(modeReads,1,"validated model mode must be captured once");
    let promptReads=0;
    await wrapped.explain({
      capturedAt:"2026-11-12T00:00:00.000Z",
      get promptBody(){return ++promptReads<=3?"approved prompt":"unmetered changed prompt";},
      maxResponseBytes:4096
    } as any);
    assert.equal(seen.prompt,"approved prompt","provider prompt must be the exact metered prompt");
    assert.equal(promptReads,1,"explanation intent must be captured once before reservation");
    assert.equal(upstreamCalls,2);
    assert.equal(ledger.status(scope("tenant:a"),"test:openai","test-model").chargedMicroUsd,400);
  }finally{ledger.close();}
});
