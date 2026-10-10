import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";

const principal={
  principalId:"principal:api",
  issuer:"https://issuer.example",
  subject:"service:api"
};
const authenticated={
  principal,
  credential:{
    issuer:principal.issuer,subject:principal.subject,keyId:"key-1",jwtId:"jwt-1",
    issuedAt:"2026-10-06T09:59:00.000Z",expiresAt:"2026-10-06T10:05:00.000Z",
    tokenHash:"a".repeat(64)
  }
};
const now="2026-10-06T10:00:00.000Z";

function runtimeFactory(){
  const state={
    creates:[] as string[],
    ingests:0,executes:0,gets:0,replays:0,acquires:0,
    persistedFacts:[] as any[]
  };
  return {
    state,
    factory:{
      create(scope:any){
        state.creates.push(scope.tenantId);
        return {
          acquisitions:{
            async acquire(_context:any,body:any){
              state.acquires++;
              return {
                status:"COMMITTED",acquisitionId:"acquisition:1",artifactId:"artifact:1",
                artifactHash:"e".repeat(64),factIds:["fact:evidence:1"],request:structuredClone(body)
              };
            }
          },
          ingestor:{
            async ingest(body:any){
              state.ingests++;
              if(body?.failSource)throw new Error("Ingestion signature verification failed");
              state.persistedFacts.push(structuredClone(body));
              return body?.fact??{id:"fact:1"};
            }
          },
          executions:{
            async get(_scope:any,id:string){
              state.gets++;
              if(id==="platform:foreign"||id==="platform:missing")throw new Error(`Execution record not found for tenant ${scope.tenantId}: ${id}`);
              return {id,tenantId:scope.tenantId,recordHash:"b".repeat(64)};
            }
          },
          plane:{
            async execute(body:any){
              state.executes++;
              if(body?.program?.assumptions?.some((x:string)=>x.startsWith("AXIOM_PLATFORM_CONTEXT_SHA256:"))){
                throw new Error("Program uses reserved AXIOM platform-context assumption namespace");
              }
              if(body?.simulateSignerFailure)throw new Error("Signer provider issued invalid certificate: mismatch");
              if(body?.forceDenied)return {status:"DENIED",snapshotId:"snapshot:deny",policyDecision:{status:"DENY",snapshotId:"snapshot:deny",checks:[]}};
              return {status:"APPROVED",snapshotId:"snapshot:1",policyDecision:{status:"ALLOW",snapshotId:"snapshot:1",checks:[]},certificateId:"cert:1",executionRecordId:"platform:1"};
            },
            async replayStored(id:string){
              state.replays++;
              if(id==="platform:missing")return {status:"MISMATCH",diagnostics:[`Execution record not found for tenant ${scope.tenantId}: ${id}`]};
              return {status:"MATCH",diagnostics:[]};
            }
          }
        };
      }
    }
  };
}

function authenticator(){
  return {
    async authenticate(token:string){
      if(token==="bad"||!token)throw new Error("Caller credential rejected");
      return structuredClone(authenticated);
    }
  };
}

test("Phase-2 exposes the authenticated API application service",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.AxiomApiService,"function");
});

test("API service authorizes exact tenant actions before creating tenant runtime",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=(()=>{const dir=mkdtempSync(join(tmpdir(),"axiom-api-authz-"));return {dir,db:join(dir,"security.db")};})();
  const security=new phase2.SecurityStore(db);
  const rt=runtimeFactory();
  try{
    await security.putGrant({grantId:"read-a",principalId:principal.principalId,tenantId:"tenant:a",action:"execution:read"});
    const service=new phase2.AxiomApiService({
      authenticator:authenticator(),
      authorizer:new phase2.DeterministicAuthorizer(security),
      idempotency:security,
      audit:security,
      runtimes:rt.factory
    });

    const denied=await service.handle({
      requestId:"r-deny",method:"GET",routeTemplate:"/v1/tenants/:tenantId/executions/:executionId",
      requestedTenantId:"tenant:b",action:"execution:read",resource:{kind:"execution",id:"platform:foreign"},
      bearerToken:"ok",body:undefined,now
    });
    assert.equal(denied.statusCode,403);
    assert.deepEqual(rt.state.creates,[]);

    const allowed=await service.handle({
      requestId:"r-read",method:"GET",routeTemplate:"/v1/tenants/:tenantId/executions/:executionId",
      requestedTenantId:"tenant:a",action:"execution:read",resource:{kind:"execution",id:"platform:missing"},
      bearerToken:"ok",body:undefined,now
    });
    assert.equal(allowed.statusCode,404);
    assert.deepEqual(rt.state.creates,["tenant:a"]);
    assert.equal(rt.state.gets,1);

    const escalation=await service.handle({
      requestId:"r-replay",method:"POST",routeTemplate:"/v1/tenants/:tenantId/executions/:executionId/replay",
      requestedTenantId:"tenant:a",action:"execution:replay",resource:{kind:"execution",id:"platform:1"},
      bearerToken:"ok",body:{},now
    });
    assert.equal(escalation.statusCode,403);
    assert.deepEqual(rt.state.creates,["tenant:a"]);
  }finally{security.close();rmSync(dir,{recursive:true,force:true});}
});

test("API service rejects invalid caller credentials before authorization or tenant runtime access",async()=>{
  const phase2:any=await import("../src/index.ts");
  let authzCalls=0;
  const auditEvents:any[]=[];
  const rt=runtimeFactory();
  const service=new phase2.AxiomApiService({
    authenticator:authenticator(),
    authorizer:{async authorize(){authzCalls++;throw new Error("must not run");}},
    idempotency:{async claim(){throw new Error("must not run");},async complete(){throw new Error("must not run");}},
    audit:{async append(e:any){auditEvents.push(e);return {...e,sequence:1,previousHash:"0".repeat(64),recordHash:"f".repeat(64)};},async verifyStream(){return {status:"MATCH",diagnostics:[]};}},
    runtimes:rt.factory
  });
  const response=await service.handle({
    requestId:"r-401",method:"GET",routeTemplate:"/v1/tenants/:tenantId/executions/:executionId",
    requestedTenantId:"tenant:a",action:"execution:read",resource:{kind:"execution",id:"platform:1"},
    bearerToken:"bad",body:undefined,now
  });
  assert.equal(response.statusCode,401);
  assert.equal(response.headers["WWW-Authenticate"],"Bearer");
  assert.equal(authzCalls,0);
  assert.deepEqual(rt.state.creates,[]);
  assert.equal(auditEvents.length,1);
  assert.equal(auditEvents[0].principalId,undefined);
  assert.equal(auditEvents[0].outcome,"AUTHENTICATION_DENIED");
});

test("mutation idempotency replays exact stored response and rejects changed requests",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=(()=>{const dir=mkdtempSync(join(tmpdir(),"axiom-api-idem-"));return {dir,db:join(dir,"security.db")};})();
  const security=new phase2.SecurityStore(db);
  const rt=runtimeFactory();
  try{
    await security.putGrant({grantId:"exec-a",principalId:principal.principalId,tenantId:"tenant:a",action:"execution:create"});
    const service=new phase2.AxiomApiService({
      authenticator:authenticator(),authorizer:new phase2.DeterministicAuthorizer(security),
      idempotency:security,audit:security,runtimes:rt.factory
    });
    const base={
      method:"POST",routeTemplate:"/v1/tenants/:tenantId/executions",requestedTenantId:"tenant:a",
      action:"execution:create",resource:{kind:"execution"},bearerToken:"ok",idempotencyKey:"idem-secret",now
    };
    const body={asOf:"2026-10-06T10:00:00.000Z",issuedAt:"2026-10-06T10:00:01.000Z",program:{assumptions:[]},requirements:[],bindings:[]};
    const first=await service.handle({...base,requestId:"r-first",body});
    const second=await service.handle({...base,requestId:"r-second",body});
    const conflict=await service.handle({...base,requestId:"r-third",body:{...body,issuedAt:"2026-10-06T10:00:02.000Z"}});
    assert.equal(first.statusCode,200);
    assert.equal(second.statusCode,200);
    assert.equal(second.bodyJson,first.bodyJson);
    assert.equal(rt.state.executes,1);
    assert.equal(conflict.statusCode,409);

    const rows=(security as any);
    assert.equal(JSON.stringify(await security.verifyStream("tenant:a")).includes("idem-secret"),false);
  }finally{security.close();rmSync(dir,{recursive:true,force:true});}
});

test("API service maps source-auth failures to 422, policy denial to 200, reserved context to 400, and signer failure to opaque 500",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=(()=>{const dir=mkdtempSync(join(tmpdir(),"axiom-api-errors-"));return {dir,db:join(dir,"security.db")};})();
  const security=new phase2.SecurityStore(db);
  const rt=runtimeFactory();
  try{
    for(const [grantId,action] of [["fact","fact:ingest"],["exec","execution:create"]] as const){
      await security.putGrant({grantId,principalId:principal.principalId,tenantId:"tenant:a",action});
    }
    const service=new phase2.AxiomApiService({
      authenticator:authenticator(),authorizer:new phase2.DeterministicAuthorizer(security),
      idempotency:security,audit:security,runtimes:rt.factory
    });

    const fact=await service.handle({
      requestId:"r-fact",method:"POST",routeTemplate:"/v1/tenants/:tenantId/facts",
      requestedTenantId:"tenant:a",action:"fact:ingest",resource:{kind:"fact"},bearerToken:"ok",
      idempotencyKey:"fact-key",body:{tenantId:"tenant:a",failSource:true,fact:{id:"f1"}},now
    });
    assert.equal(fact.statusCode,422);
    assert.equal(rt.state.persistedFacts.length,0);

    const denied=await service.handle({
      requestId:"r-domain-deny",method:"POST",routeTemplate:"/v1/tenants/:tenantId/executions",
      requestedTenantId:"tenant:a",action:"execution:create",resource:{kind:"execution"},bearerToken:"ok",
      idempotencyKey:"exec-deny",body:{program:{assumptions:[]},forceDenied:true},now
    });
    assert.equal(denied.statusCode,200);
    assert.equal(JSON.parse(denied.bodyJson).status,"DENIED");
    assert.equal(JSON.parse(denied.bodyJson).certificateId,undefined);

    const reserved=await service.handle({
      requestId:"r-reserved",method:"POST",routeTemplate:"/v1/tenants/:tenantId/executions",
      requestedTenantId:"tenant:a",action:"execution:create",resource:{kind:"execution"},bearerToken:"ok",
      idempotencyKey:"exec-reserved",body:{program:{assumptions:["AXIOM_PLATFORM_CONTEXT_SHA256:forged"]}},now
    });
    assert.equal(reserved.statusCode,400);

    const failed=await service.handle({
      requestId:"r-signer",method:"POST",routeTemplate:"/v1/tenants/:tenantId/executions",
      requestedTenantId:"tenant:a",action:"execution:create",resource:{kind:"execution"},bearerToken:"ok",
      idempotencyKey:"exec-signer",body:{program:{assumptions:[]},simulateSignerFailure:true},now
    });
    assert.equal(failed.statusCode,500);
    const parsed=JSON.parse(failed.bodyJson);
    assert.equal(parsed.error.code,"INTERNAL_ERROR");
    assert.equal(failed.bodyJson.includes("Signer provider"),false);
  }finally{security.close();rmSync(dir,{recursive:true,force:true});}
});


test("missing mutation idempotency key is authenticated, authorized, audited, and never creates a tenant runtime",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=(()=>{const dir=mkdtempSync(join(tmpdir(),"axiom-api-missing-idem-"));return {dir,db:join(dir,"security.db")};})();
  const security=new phase2.SecurityStore(db);
  const rt=runtimeFactory();
  try{
    await security.putGrant({grantId:"exec-a",principalId:principal.principalId,tenantId:"tenant:a",action:"execution:create"});
    const service=new phase2.AxiomApiService({
      authenticator:authenticator(),authorizer:new phase2.DeterministicAuthorizer(security),
      idempotency:security,audit:security,runtimes:rt.factory
    });
    const response=await service.handle({
      requestId:"r-missing-idem",method:"POST",routeTemplate:"/v1/tenants/:tenantId/executions",
      requestedTenantId:"tenant:a",action:"execution:create",resource:{kind:"execution"},bearerToken:"ok",
      body:{program:{assumptions:[]}},now
    });
    assert.equal(response.statusCode,400);
    assert.equal(JSON.parse(response.bodyJson).error.code,"IDEMPOTENCY_KEY_REQUIRED");
    assert.deepEqual(rt.state.creates,[]);
    assert.deepEqual(await security.verifyStream("tenant:a"),{status:"MATCH",diagnostics:[]});
    const inspect=new DatabaseSync(db);
    try{
      const row=inspect.prepare("SELECT outcome, principal_id, authorization_decision_hash FROM axiom_audit_records WHERE tenant_id=? AND request_id=?")
        .get("tenant:a","r-missing-idem") as any;
      assert.equal(String(row.outcome),"BAD_REQUEST");
      assert.equal(String(row.principal_id),principal.principalId);
      assert.match(String(row.authorization_decision_hash),/^[0-9a-f]{64}$/);
    }finally{inspect.close();}
  }finally{security.close();rmSync(dir,{recursive:true,force:true});}
});


test("evidence acquisition is idempotent and completed retries never reacquire or refetch",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=(()=>{const dir=mkdtempSync(join(tmpdir(),"axiom-api-evidence-idem-"));return {dir,db:join(dir,"security.db")};})();
  const security=new phase2.SecurityStore(db),rt=runtimeFactory();
  try{
    await security.putGrant({grantId:"evidence-a",principalId:principal.principalId,tenantId:"tenant:a",action:"evidence:acquire"});
    const service=new phase2.AxiomApiService({
      authenticator:authenticator(),authorizer:new phase2.DeterministicAuthorizer(security),
      idempotency:security,audit:security,runtimes:rt.factory
    });
    const base={
      method:"POST",routeTemplate:"/v1/tenants/:tenantId/evidence/acquisitions",requestedTenantId:"tenant:a",
      action:"evidence:acquire",resource:{kind:"evidence"},bearerToken:"ok",idempotencyKey:"evidence-idem",now
    };
    const body={adapterId:"adapter:test",operationId:"read",mappingId:"map:v1",parameters:{symbol:"XAUUSD"}};
    const first=await service.handle({...base,requestId:"e-first",body});
    const replay=await service.handle({...base,requestId:"e-replay",body});
    const conflict=await service.handle({...base,requestId:"e-conflict",body:{...body,parameters:{symbol:"EURUSD"}}});

    assert.equal(first.statusCode,201);
    assert.equal(replay.statusCode,201);
    assert.equal(replay.bodyJson,first.bodyJson);
    assert.equal(conflict.statusCode,409);
    assert.equal(rt.state.acquires,1);
    assert.deepEqual(rt.state.creates,["tenant:a"]);

    const missing=await service.handle({...base,requestId:"e-missing-idem",idempotencyKey:undefined,body});
    assert.equal(missing.statusCode,400);
    assert.equal(rt.state.acquires,1);
    assert.deepEqual(rt.state.creates,["tenant:a"]);

    const denied=await service.handle({...base,requestId:"e-denied",requestedTenantId:"tenant:b",idempotencyKey:"e-denied-key",body});
    assert.equal(denied.statusCode,403);
    assert.equal(rt.state.acquires,1);
    assert.deepEqual(rt.state.creates,["tenant:a"]);
    assert.deepEqual(await security.verifyStream("tenant:a"),{status:"MATCH",diagnostics:[]});
    assert.deepEqual(await security.verifyStream("tenant:b"),{status:"MATCH",diagnostics:[]});
  }finally{security.close();rmSync(dir,{recursive:true,force:true});}
});

test("evidence acquisition maps bounded adapter and evidence failures without leaking upstream details",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=(()=>{const dir=mkdtempSync(join(tmpdir(),"axiom-api-evidence-errors-"));return {dir,db:join(dir,"security.db")};})();
  const security=new phase2.SecurityStore(db);
  let calls=0;
  const runtimes={
    create(){
      return {
        acquisitions:{async acquire(_context:any,body:any){
          calls++;
          if(body.adapterId==="too-large")throw new phase2.EvidenceAdapterError("UPSTREAM_TOO_LARGE","secret upstream overflow diagnostic",413);
          if(body.adapterId==="media")throw new phase2.EvidenceAdapterError("UPSTREAM_MEDIA_TYPE","secret upstream media diagnostic",415);
          if(body.adapterId==="gateway")throw new phase2.EvidenceAdapterError("UPSTREAM_BAD_STATUS","secret upstream status diagnostic",502);
          if(body.adapterId==="timeout")throw new phase2.EvidenceAdapterError("UPSTREAM_TIMEOUT","secret upstream timeout diagnostic",504);
          if(body.adapterId==="mapping")throw new Error("Evidence mapping failed with secret detail");
          if(body.adapterId==="invalid")throw new TypeError("Unknown adapter with secret detail");
          throw new Error("secret unexpected acquisition failure");
        }},
        ingestor:{async ingest(){throw new Error("unused");}},
        executions:{async get(){throw new Error("unused");}},
        plane:{async execute(){throw new Error("unused");},async replayStored(){throw new Error("unused");}}
      };
    }
  };
  try{
    await security.putGrant({grantId:"evidence-a",principalId:principal.principalId,tenantId:"tenant:a",action:"evidence:acquire"});
    const service=new phase2.AxiomApiService({
      authenticator:authenticator(),authorizer:new phase2.DeterministicAuthorizer(security),
      idempotency:security,audit:security,runtimes
    });
    const cases:[string,number][]=[["too-large",413],["media",415],["gateway",502],["timeout",504],["mapping",422],["invalid",400],["boom",500]];
    for(const [adapterId,status] of cases){
      const response=await service.handle({
        requestId:`err-${adapterId}`,method:"POST",routeTemplate:"/v1/tenants/:tenantId/evidence/acquisitions",
        requestedTenantId:"tenant:a",action:"evidence:acquire",resource:{kind:"evidence"},bearerToken:"ok",
        idempotencyKey:`idem-${adapterId}`,body:{adapterId,operationId:"read",mappingId:"map:v1",parameters:{}},now
      });
      assert.equal(response.statusCode,status,adapterId);
      assert.equal(response.bodyJson.includes("secret"),false,adapterId);
    }
    assert.equal(calls,cases.length);
    assert.deepEqual(await security.verifyStream("tenant:a"),{status:"MATCH",diagnostics:[]});
  }finally{security.close();rmSync(dir,{recursive:true,force:true});}
});


test("model compile API is authenticated authorized idempotent and never refetches completed terminal compilations",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=(()=>{const dir=mkdtempSync(join(tmpdir(),"axiom-api-model-compile-"));return {dir,db:join(dir,"security.db")};})();
  const security=new phase2.SecurityStore(db);
  const state={creates:0,compiles:0};
  const runtimes={create(){
    state.creates++;
    return {
      modelCompiler:{async compile(_context:any,body:any){
        state.compiles++;
        if(body.objective==="reject")return {status:"REJECTED",compilationId:"model-compilation:"+"2".repeat(64),issues:[{code:"MODEL_PROPOSAL_SCHEMA",message:"invalid"}],attemptCount:3};
        if(body.objective==="profile-forbidden")throw new Error("Model compiler profile is not eligible for tenant: tenant:a");
        return {status:"VALIDATED",compilationId:"model-compilation:"+"1".repeat(64),compiledProgramHash:"3".repeat(64),attemptCount:1};
      }},
      modelExecutor:{async execute(){throw new Error("unused");}},
      acquisitions:{async acquire(){throw new Error("unused");}},
      ingestor:{async ingest(){throw new Error("unused");}},
      executions:{async get(){throw new Error("unused");}},
      plane:{async execute(){throw new Error("unused");},async replayStored(){throw new Error("unused");}}
    };
  }};
  try{
    await security.putGrant({grantId:"model-compile-a",principalId:principal.principalId,tenantId:"tenant:a",action:"model:compile"});
    const service=new phase2.AxiomApiService({
      authenticator:authenticator(),authorizer:new phase2.DeterministicAuthorizer(security),
      idempotency:security,audit:security,runtimes
    });
    const base={
      method:"POST" as const,routeTemplate:"/v1/tenants/:tenantId/model/compilations",requestedTenantId:"tenant:a",
      action:"model:compile" as const,resource:{kind:"model_compilation" as const},bearerToken:"ok",now
    };
    const body={profileId:"profile:default",objective:"approve",inputContracts:[{inputName:"x"}]};
    const first=await service.handle({...base,requestId:"mc-1",idempotencyKey:"compile-key",body});
    const replay=await service.handle({...base,requestId:"mc-2",idempotencyKey:"compile-key",body});
    const conflict=await service.handle({...base,requestId:"mc-3",idempotencyKey:"compile-key",body:{...body,objective:"changed"}});
    assert.equal(first.statusCode,201);
    assert.equal(JSON.parse(first.bodyJson).status,"VALIDATED");
    assert.equal(replay.statusCode,201);
    assert.equal(replay.bodyJson,first.bodyJson);
    assert.equal(conflict.statusCode,409);
    assert.equal(state.compiles,1);
    assert.equal(state.creates,1);

    const rejected=await service.handle({...base,requestId:"mc-r1",idempotencyKey:"compile-reject",body:{...body,objective:"reject"}});
    const rejectedReplay=await service.handle({...base,requestId:"mc-r2",idempotencyKey:"compile-reject",body:{...body,objective:"reject"}});
    assert.equal(rejected.statusCode,422);
    assert.equal(JSON.parse(rejected.bodyJson).status,"REJECTED");
    assert.equal(rejectedReplay.statusCode,422);
    assert.equal(rejectedReplay.bodyJson,rejected.bodyJson);
    assert.equal(state.compiles,2);
    assert.equal(state.creates,2);

    const missing=await service.handle({...base,requestId:"mc-missing",body});
    assert.equal(missing.statusCode,400);
    assert.equal(JSON.parse(missing.bodyJson).error.code,"IDEMPOTENCY_KEY_REQUIRED");
    assert.equal(state.compiles,2);

    const denied=await service.handle({...base,requestId:"mc-denied",requestedTenantId:"tenant:b",idempotencyKey:"denied",body});
    assert.equal(denied.statusCode,403);
    assert.equal(state.compiles,2);

    const profileForbidden=await service.handle({...base,requestId:"mc-profile-forbidden",idempotencyKey:"profile-forbidden",body:{...body,objective:"profile-forbidden"}});
    assert.equal(profileForbidden.statusCode,403);
    assert.equal(JSON.parse(profileForbidden.bodyJson).error.code,"MODEL_PROFILE_FORBIDDEN");
    const inspectProfile=new DatabaseSync(db);
    try{
      const row=inspectProfile.prepare("SELECT outcome FROM axiom_audit_records WHERE tenant_id=? AND request_id=?")
        .get("tenant:a","mc-profile-forbidden") as any;
      assert.equal(String(row.outcome),"MODEL_PROFILE_FORBIDDEN");
    }finally{inspectProfile.close();}

    const unauth=await service.handle({...base,requestId:"mc-unauth",bearerToken:"bad",idempotencyKey:"unauth",body});
    assert.equal(unauth.statusCode,401);
    assert.equal(state.compiles,3);
    assert.equal(state.creates,3);
  }finally{security.close();rmSync(dir,{recursive:true,force:true});}
});

test("model provider and internal compile failures stay uncompleted so retries fail closed without refetch",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=(()=>{const dir=mkdtempSync(join(tmpdir(),"axiom-api-model-failure-"));return {dir,db:join(dir,"security.db")};})();
  const security=new phase2.SecurityStore(db);
  let compiles=0;
  const runtimes={create(){
    return {
      modelCompiler:{async compile(_context:any,body:any){
        compiles++;
        if(body.objective==="timeout")throw new phase2.ModelAdapterError("MODEL_UPSTREAM_TIMEOUT","provider secret detail",504);
        if(body.objective==="gateway")throw new phase2.ModelAdapterError("MODEL_UPSTREAM_NETWORK","provider secret detail",502);
        throw new Error("internal secret detail");
      }},
      modelExecutor:{async execute(){throw new Error("unused");}},
      acquisitions:{async acquire(){throw new Error("unused");}},
      ingestor:{async ingest(){throw new Error("unused");}},
      executions:{async get(){throw new Error("unused");}},
      plane:{async execute(){throw new Error("unused");},async replayStored(){throw new Error("unused");}}
    };
  }};
  try{
    await security.putGrant({grantId:"model-compile-a",principalId:principal.principalId,tenantId:"tenant:a",action:"model:compile"});
    const service=new phase2.AxiomApiService({
      authenticator:authenticator(),authorizer:new phase2.DeterministicAuthorizer(security),
      idempotency:security,audit:security,runtimes
    });
    for(const [objective,status] of [["timeout",504],["gateway",502],["internal",500]] as const){
      const req={
        requestId:"mf-"+objective,method:"POST" as const,routeTemplate:"/v1/tenants/:tenantId/model/compilations",
        requestedTenantId:"tenant:a",action:"model:compile" as const,resource:{kind:"model_compilation" as const},
        bearerToken:"ok",idempotencyKey:"failure-"+objective,
        body:{profileId:"profile:default",objective,inputContracts:[{inputName:"x"}]},now
      };
      const first=await service.handle(req);
      const retry=await service.handle({...req,requestId:req.requestId+"-retry"});
      assert.equal(first.statusCode,status,objective);
      assert.equal(first.bodyJson.includes("secret"),false,objective);
      const inspect=new DatabaseSync(db);
      try{
        const row=inspect.prepare("SELECT outcome FROM axiom_audit_records WHERE tenant_id=? AND request_id=?")
          .get("tenant:a",req.requestId) as any;
        assert.equal(String(row.outcome),objective==="internal"?"INTERNAL_ERROR":"MODEL_UPSTREAM_FAILED",objective);
      }finally{inspect.close();}
      assert.equal(retry.statusCode,409,objective);
      assert.equal(JSON.parse(retry.bodyJson).error.code,"REQUEST_IN_PROGRESS",objective);
    }
    assert.equal(compiles,3);
  }finally{security.close();rmSync(dir,{recursive:true,force:true});}
});

test("model execute API is independently authorized idempotent and maps stale or rejected compilations before re-execution",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=(()=>{const dir=mkdtempSync(join(tmpdir(),"axiom-api-model-execute-"));return {dir,db:join(dir,"security.db")};})();
  const security=new phase2.SecurityStore(db);
  const state={creates:0,executes:0};
  const runtimes={create(){
    state.creates++;
    return {
      modelCompiler:{async compile(){throw new Error("unused");}},
      modelExecutor:{async execute(_context:any,id:string,body:any){
        state.executes++;
        if(id.endsWith("stale"))throw new phase2.ModelExecutionError("COMPILATION_STALE","internal drift detail",409);
        if(id.endsWith("rejected"))throw new phase2.ModelExecutionError("COMPILATION_REJECTED","internal rejected detail",422);
        return {status:"APPROVED",snapshotId:"snapshot:1",policyDecision:{status:"ALLOW",snapshotId:"snapshot:1",checks:[]},certificateId:"cert:1",executionRecordId:"platform:1",timing:body};
      }},
      acquisitions:{async acquire(){throw new Error("unused");}},
      ingestor:{async ingest(){throw new Error("unused");}},
      executions:{async get(){throw new Error("unused");}},
      plane:{async execute(){throw new Error("unused");},async replayStored(){throw new Error("unused");}}
    };
  }};
  try{
    await security.putGrant({grantId:"model-execute-a",principalId:principal.principalId,tenantId:"tenant:a",action:"model:execute"});
    const service=new phase2.AxiomApiService({
      authenticator:authenticator(),authorizer:new phase2.DeterministicAuthorizer(security),
      idempotency:security,audit:security,runtimes
    });
    const id="model-compilation:"+"4".repeat(64);
    const base={
      method:"POST" as const,routeTemplate:"/v1/tenants/:tenantId/model/compilations/:compilationId/executions",
      requestedTenantId:"tenant:a",action:"model:execute" as const,resource:{kind:"model_compilation" as const,id},
      bearerToken:"ok",idempotencyKey:"execute-key",now
    };
    const body={asOf:"2026-10-06T10:00:00.000Z",issuedAt:"2026-10-06T10:00:01.000Z"};
    const first=await service.handle({...base,requestId:"me-1",body});
    const replay=await service.handle({...base,requestId:"me-2",body});
    const conflict=await service.handle({...base,requestId:"me-3",body:{...body,issuedAt:"2026-10-06T10:00:02.000Z"}});
    assert.equal(first.statusCode,200);
    assert.equal(replay.statusCode,200);
    assert.equal(replay.bodyJson,first.bodyJson);
    assert.equal(conflict.statusCode,409);
    assert.equal(state.executes,1);
    assert.equal(state.creates,1);

    for(const [suffix,status,code] of [["stale",409,"COMPILATION_STALE"],["rejected",422,"COMPILATION_REJECTED"]] as const){
      const rid="model-compilation:"+suffix;
      const response=await service.handle({
        ...base,requestId:"me-"+suffix,resource:{kind:"model_compilation",id:rid},
        idempotencyKey:"execute-"+suffix,body
      });
      assert.equal(response.statusCode,status);
      assert.equal(JSON.parse(response.bodyJson).error.code,code);
      assert.equal(response.bodyJson.includes("internal"),false);
    }

    const denied=await service.handle({...base,requestId:"me-denied",requestedTenantId:"tenant:b",idempotencyKey:"execute-denied",body});
    assert.equal(denied.statusCode,403);
    assert.equal(state.executes,3);
  }finally{security.close();rmSync(dir,{recursive:true,force:true});}
});


test("model explain API is independently authorized idempotent audited and never refetches a completed explanation",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=(()=>{const dir=mkdtempSync(join(tmpdir(),"axiom-api-model-explain-"));return {dir,db:join(dir,"security.db")};})();
  const security=new phase2.SecurityStore(db);
  const state={creates:0,explains:0};
  const executionId="platform:"+"7".repeat(64);
  const runtimes={create(){
    state.creates++;
    return {
      modelCompiler:{async compile(){throw new Error("unused");}},
      modelExecutor:{async execute(){throw new Error("unused");}},
      modelExplainer:{async explain(_context:any,id:string,body:any,requestHash:string){
        state.explains++;
        assert.equal(id,executionId);
        assert.match(requestHash,/^[0-9a-f]{64}$/);
        if(body.profileId==="forbidden")throw new phase2.ModelExplanationError("MODEL_EXPLANATION_PROFILE_FORBIDDEN","secret profile detail",403);
        if(body.profileId==="missing")throw new phase2.ModelExplanationError("MODEL_EXPLANATION_NOT_FOUND","secret execution detail",404);
        if(body.profileId==="proof")throw new phase2.ModelExplanationError("MODEL_EXPLANATION_PROOF_REJECTED","secret replay detail",422);
        if(body.profileId==="too-large")throw new phase2.ModelExplanationError("MODEL_EXPLANATION_UPSTREAM_FAILED","secret upstream detail",413);
        if(body.profileId==="media")throw new phase2.ModelExplanationError("MODEL_EXPLANATION_UPSTREAM_FAILED","secret upstream detail",415);
        if(body.profileId==="gateway")throw new phase2.ModelExplanationError("MODEL_EXPLANATION_UPSTREAM_FAILED","secret upstream detail",502);
        if(body.profileId==="timeout")throw new phase2.ModelExplanationError("MODEL_EXPLANATION_UPSTREAM_FAILED","secret upstream detail",504);
        if(body.profileId==="internal")throw new Error("secret internal detail");
        return {
          status:"CREATED",explanationId:"model-explanation:"+"8".repeat(64),authority:"ADVISORY_ONLY",
          content:{summary:"Verified stored proof.",keyFactors:["Replay MATCH"],limitations:["Advisory only"]},
          provider:"fixture",modelId:"fixture-model"
        };
      }},
      acquisitions:{async acquire(){throw new Error("unused");}},
      ingestor:{async ingest(){throw new Error("unused");}},
      executions:{async get(){throw new Error("unused");}},
      plane:{async execute(){throw new Error("unused");},async replayStored(){throw new Error("unused");}}
    };
  }};
  try{
    await security.putGrant({grantId:"model-explain-a",principalId:principal.principalId,tenantId:"tenant:a",action:"model:explain"});
    const service=new phase2.AxiomApiService({
      authenticator:authenticator(),authorizer:new phase2.DeterministicAuthorizer(security),
      idempotency:security,audit:security,runtimes
    });
    const base={
      method:"POST" as const,routeTemplate:"/v1/tenants/:tenantId/executions/:executionId/explanations",
      requestedTenantId:"tenant:a",action:"model:explain" as const,resource:{kind:"execution" as const,id:executionId},
      bearerToken:"ok",now
    };

    const first=await service.handle({...base,requestId:"mx-1",idempotencyKey:"explain-key",body:{profileId:"profile:explain"}});
    const replay=await service.handle({...base,requestId:"mx-2",idempotencyKey:"explain-key",body:{profileId:"profile:explain"}});
    const conflict=await service.handle({...base,requestId:"mx-3",idempotencyKey:"explain-key",body:{profileId:"changed"}});
    assert.equal(first.statusCode,201);
    assert.equal(JSON.parse(first.bodyJson).authority,"ADVISORY_ONLY");
    assert.equal(replay.statusCode,201);
    assert.equal(replay.bodyJson,first.bodyJson);
    assert.equal(conflict.statusCode,409);
    assert.equal(state.explains,1);
    assert.equal(state.creates,1);

    const missingIdem=await service.handle({...base,requestId:"mx-no-idem",body:{profileId:"profile:explain"}});
    assert.equal(missingIdem.statusCode,400);
    assert.equal(JSON.parse(missingIdem.bodyJson).error.code,"IDEMPOTENCY_KEY_REQUIRED");
    assert.equal(state.explains,1);

    const badShape=await service.handle({...base,requestId:"mx-bad-shape",idempotencyKey:"bad-shape",body:{profileId:"profile:explain",provider:"caller-controlled"}});
    assert.equal(badShape.statusCode,400);
    assert.equal(state.explains,1);

    const cases=[
      ["forbidden",403,"MODEL_EXPLANATION_PROFILE_FORBIDDEN","MODEL_EXPLANATION_PROFILE_FORBIDDEN"],
      ["missing",404,"NOT_FOUND","NOT_FOUND"],
      ["proof",422,"MODEL_EXPLANATION_PROOF_REJECTED","MODEL_EXPLANATION_PROOF_REJECTED"],
      ["too-large",413,"MODEL_EXPLANATION_PROVIDER_TOO_LARGE","MODEL_EXPLANATION_UPSTREAM_FAILED"],
      ["media",415,"MODEL_EXPLANATION_PROVIDER_MEDIA_TYPE","MODEL_EXPLANATION_UPSTREAM_FAILED"],
      ["gateway",502,"MODEL_EXPLANATION_PROVIDER_FAILURE","MODEL_EXPLANATION_UPSTREAM_FAILED"],
      ["timeout",504,"MODEL_EXPLANATION_PROVIDER_TIMEOUT","MODEL_EXPLANATION_UPSTREAM_FAILED"],
      ["internal",500,"INTERNAL_ERROR","INTERNAL_ERROR"]
    ] as const;
    for(const [profileId,status,code,outcome] of cases){
      const requestId="mx-"+profileId;
      const idem="explain-"+profileId;
      const response=await service.handle({...base,requestId,idempotencyKey:idem,body:{profileId}});
      assert.equal(response.statusCode,status,profileId);
      assert.equal(JSON.parse(response.bodyJson).error.code,code,profileId);
      assert.equal(response.bodyJson.includes("secret"),false,profileId);
      const inspect=new DatabaseSync(db);
      try{
        const row=inspect.prepare("SELECT outcome FROM axiom_audit_records WHERE tenant_id=? AND request_id=?").get("tenant:a",requestId) as any;
        assert.equal(String(row.outcome),outcome,profileId);
      }finally{inspect.close();}
      if(status>=500){
        const before=state.explains;
        const retry=await service.handle({...base,requestId:requestId+"-retry",idempotencyKey:idem,body:{profileId}});
        assert.equal(retry.statusCode,409,profileId);
        assert.equal(JSON.parse(retry.bodyJson).error.code,"REQUEST_IN_PROGRESS",profileId);
        assert.equal(state.explains,before,profileId);
      }
    }
  }finally{security.close();rmSync(dir,{recursive:true,force:true});}
});


test("mutation idempotency request hash binds the exact resource ID",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=(()=>{const dir=mkdtempSync(join(tmpdir(),"axiom-api-resource-idem-"));return {dir,db:join(dir,"security.db")};})();
  const security=new phase2.SecurityStore(db);
  let explains=0;
  const runtimes={create(){
    return {
      modelCompiler:{async compile(){throw new Error("unused");}},
      modelExecutor:{async execute(){throw new Error("unused");}},
      modelExplainer:{async explain(_context:any,id:string){
        explains++;
        return {status:"CREATED",explanationId:"model-explanation:"+id.replace(/[^a-f0-9]/gi,"").padEnd(64,"0").slice(0,64),authority:"ADVISORY_ONLY",content:{summary:"ok",keyFactors:[],limitations:[]},provider:"fixture",modelId:"fixture"};
      }},
      acquisitions:{async acquire(){throw new Error("unused");}},
      ingestor:{async ingest(){throw new Error("unused");}},
      executions:{async get(){throw new Error("unused");}},
      plane:{async execute(){throw new Error("unused");},async replayStored(){throw new Error("unused");}}
    };
  }};
  try{
    await security.putGrant({grantId:"model-explain-resource",principalId:principal.principalId,tenantId:"tenant:a",action:"model:explain"});
    const service=new phase2.AxiomApiService({
      authenticator:authenticator(),authorizer:new phase2.DeterministicAuthorizer(security),
      idempotency:security,audit:security,runtimes
    });
    const base={
      method:"POST" as const,routeTemplate:"/v1/tenants/:tenantId/executions/:executionId/explanations",
      requestedTenantId:"tenant:a",action:"model:explain" as const,bearerToken:"ok",
      idempotencyKey:"same-key-different-resource",body:{profileId:"profile:explain"},now
    };
    const first=await service.handle({...base,requestId:"resource-idem-1",resource:{kind:"execution",id:"platform:one"}});
    const second=await service.handle({...base,requestId:"resource-idem-2",resource:{kind:"execution",id:"platform:two"}});
    assert.equal(first.statusCode,201);
    assert.equal(second.statusCode,409);
    assert.equal(JSON.parse(second.bodyJson).error.code,"IDEMPOTENCY_CONFLICT");
    assert.equal(explains,1);
  }finally{security.close();rmSync(dir,{recursive:true,force:true});}
});


test("model dispatch API is independently authorized idempotent and binds exact compilation plus timing",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=(()=>{const dir=mkdtempSync(join(tmpdir(),"axiom-api-model-dispatch-"));return {dir,db:join(dir,"security.db")};})();
  const security=new phase2.SecurityStore(db);
  const state={creates:0,dispatches:0};
  const runtimes={create(){
    state.creates++;
    return {
      modelDispatcher:{async dispatch(_context:any,id:string,body:any,requestHash:string,createdAt:string){
        state.dispatches++;
        assert.match(requestHash,/^[0-9a-f]{64}$/);
        assert.equal(createdAt,now);
        if(id.endsWith("stale"))throw new phase2.ModelExecutionError("COMPILATION_STALE","secret drift",409);
        if(id.endsWith("rejected"))throw new phase2.ModelExecutionError("COMPILATION_REJECTED","secret rejected",422);
        if(id.endsWith("missing"))throw new Error(`Model compilation not found for tenant tenant:a: ${id}`);
        return {status:"QUEUED",jobId:"execution-job:"+id.replace(/[^a-f0-9]/gi,"").padEnd(64,"0").slice(0,64),snapshotId:"snapshot:"+"1".repeat(64),timing:body};
      }},
      executionJobs:{async get(){throw new Error("unused");}},
      modelCompiler:{async compile(){throw new Error("unused");}},
      modelExecutor:{async execute(){throw new Error("unused");}},
      modelExplainer:{async explain(){throw new Error("unused");}},
      acquisitions:{async acquire(){throw new Error("unused");}},
      ingestor:{async ingest(){throw new Error("unused");}},
      executions:{async get(){throw new Error("unused");}},
      plane:{async execute(){throw new Error("unused");},async replayStored(){throw new Error("unused");}}
    };
  }};
  try{
    await security.putGrant({grantId:"dispatch-a",principalId:principal.principalId,tenantId:"tenant:a",action:"model:dispatch"});
    const service=new phase2.AxiomApiService({
      authenticator:authenticator(),authorizer:new phase2.DeterministicAuthorizer(security),
      idempotency:security,audit:security,runtimes
    });
    const compilationId="model-compilation:"+"d".repeat(64);
    const base={
      method:"POST" as const,routeTemplate:"/v1/tenants/:tenantId/model/compilations/:compilationId/execution-jobs",
      requestedTenantId:"tenant:a",action:"model:dispatch" as const,resource:{kind:"model_compilation" as const,id:compilationId},
      bearerToken:"ok",now
    };
    const body={asOf:"2026-10-06T10:00:00.000Z",issuedAt:"2026-10-06T10:00:01.000Z"};
    const first=await service.handle({...base,requestId:"md-1",idempotencyKey:"dispatch-key",body});
    const replay=await service.handle({...base,requestId:"md-2",idempotencyKey:"dispatch-key",body});
    const conflict=await service.handle({...base,requestId:"md-3",idempotencyKey:"dispatch-key",body:{...body,issuedAt:"2026-10-06T10:00:02.000Z"}});
    assert.equal(first.statusCode,202);
    assert.equal(JSON.parse(first.bodyJson).status,"QUEUED");
    assert.equal(replay.statusCode,202);
    assert.equal(replay.bodyJson,first.bodyJson);
    assert.equal(conflict.statusCode,409);
    assert.equal(state.dispatches,1);
    assert.equal(state.creates,1);

    const missingIdem=await service.handle({...base,requestId:"md-no-idem",body});
    assert.equal(missingIdem.statusCode,400);
    assert.equal(state.dispatches,1);

    const extra=await service.handle({...base,requestId:"md-extra",idempotencyKey:"dispatch-extra",body:{...body,provider:"caller"}});
    assert.equal(extra.statusCode,400);
    assert.equal(state.dispatches,1);

    for(const [suffix,status,code] of [["stale",409,"COMPILATION_STALE"],["rejected",422,"COMPILATION_REJECTED"],["missing",404,"NOT_FOUND"]] as const){
      const rid="model-compilation:"+suffix;
      const response=await service.handle({
        ...base,requestId:"md-"+suffix,resource:{kind:"model_compilation",id:rid},
        idempotencyKey:"dispatch-"+suffix,body
      });
      assert.equal(response.statusCode,status,suffix);
      assert.equal(JSON.parse(response.bodyJson).error.code,code,suffix);
      assert.equal(response.bodyJson.includes("secret"),false,suffix);
    }

    const denied=await service.handle({...base,requestId:"md-denied",requestedTenantId:"tenant:b",idempotencyKey:"dispatch-denied",body});
    assert.equal(denied.statusCode,403);
    assert.equal(state.dispatches,4);
  }finally{security.close();rmSync(dir,{recursive:true,force:true});}
});

test("distributed execution job read is independently authorized tenant-scoped and publicly bounded",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=(()=>{const dir=mkdtempSync(join(tmpdir(),"axiom-api-job-read-"));return {dir,db:join(dir,"security.db")};})();
  const security=new phase2.SecurityStore(db);
  const state={creates:0,gets:0};
  const jobId="execution-job:"+"9".repeat(64);
  const rawJob={
    intent:{
      jobId,intentHash:"a".repeat(64),tenantId:"tenant:a",principalId:"principal:secret",
      authorizationDecisionHash:"b".repeat(64),requestHash:"c".repeat(64),
      compilationId:"model-compilation:"+"d".repeat(64),compilationRecordHash:"e".repeat(64),
      profileId:"profile:secret",profileVersion:"1.0.0",profileHash:"f".repeat(64),
      compilerManifest:{id:"compiler",version:"1",implementationHash:"1".repeat(64)},
      operationRegistryManifestHash:"2".repeat(64),
      executionRequest:{asOf:"2026-10-06T10:00:00.000Z",issuedAt:"2026-10-06T10:00:01.000Z",program:{secret:"program"},requirements:[],bindings:[]},
      snapshotId:"snapshot:"+"3".repeat(64),snapshotHash:"3".repeat(64),createdAt:now
    },
    state:{
      status:"SUCCEEDED",leaseEpoch:4,attemptCount:2,leaseOwner:"worker:secret",leaseExpiresAt:"2026-10-06T10:05:00.000Z",
      terminalAt:"2026-10-06T10:00:02.000Z",
      result:{status:"APPROVED",snapshotId:"snapshot:"+"3".repeat(64),policyDecision:{status:"ALLOW",snapshotId:"snapshot:"+"3".repeat(64),checks:[]},certificateId:"cert:1",executionRecordId:"platform:1"},
      resultHash:"4".repeat(64),stateHash:"5".repeat(64)
    }
  };
  const runtimes={create(scope:any){
    state.creates++;
    return {
      executionJobs:{async get(_scope:any,id:string){
        state.gets++;
        if(scope.tenantId!=="tenant:a"||id.endsWith("missing"))throw new Error(`Distributed execution job not found for tenant ${scope.tenantId}: ${id}`);
        return structuredClone(rawJob);
      }},
      modelDispatcher:{async dispatch(){throw new Error("unused");}},
      modelCompiler:{async compile(){throw new Error("unused");}},
      modelExecutor:{async execute(){throw new Error("unused");}},
      modelExplainer:{async explain(){throw new Error("unused");}},
      acquisitions:{async acquire(){throw new Error("unused");}},
      ingestor:{async ingest(){throw new Error("unused");}},
      executions:{async get(){throw new Error("unused");}},
      plane:{async execute(){throw new Error("unused");},async replayStored(){throw new Error("unused");}}
    };
  }};
  try{
    await security.putGrant({grantId:"job-read-a",principalId:principal.principalId,tenantId:"tenant:a",action:"execution:job:read"});
    const service=new phase2.AxiomApiService({
      authenticator:authenticator(),authorizer:new phase2.DeterministicAuthorizer(security),
      idempotency:security,audit:security,runtimes
    });
    const response=await service.handle({
      requestId:"job-read-1",method:"GET",routeTemplate:"/v1/tenants/:tenantId/execution-jobs/:jobId",
      requestedTenantId:"tenant:a",action:"execution:job:read",resource:{kind:"execution_job",id:jobId},
      bearerToken:"ok",body:undefined,now
    });
    assert.equal(response.statusCode,200);
    const body=JSON.parse(response.bodyJson);
    assert.deepEqual(body,{
      jobId,status:"SUCCEEDED",snapshotId:rawJob.intent.snapshotId,attemptCount:2,createdAt:now,
      terminalAt:"2026-10-06T10:00:02.000Z",result:rawJob.state.result
    });
    for(const secret of ["worker:secret","profile:secret","principal:secret","secret\\\":\\\"program"]){
      assert.equal(response.bodyJson.includes(secret),false,secret);
    }

    const denied=await service.handle({
      requestId:"job-read-denied",method:"GET",routeTemplate:"/v1/tenants/:tenantId/execution-jobs/:jobId",
      requestedTenantId:"tenant:b",action:"execution:job:read",resource:{kind:"execution_job",id:jobId},
      bearerToken:"ok",body:undefined,now
    });
    assert.equal(denied.statusCode,403);
    assert.equal(state.creates,1);
    assert.equal(state.gets,1);

    const missing=await service.handle({
      requestId:"job-read-missing",method:"GET",routeTemplate:"/v1/tenants/:tenantId/execution-jobs/:jobId",
      requestedTenantId:"tenant:a",action:"execution:job:read",resource:{kind:"execution_job",id:"execution-job:missing"},
      bearerToken:"ok",body:undefined,now
    });
    assert.equal(missing.statusCode,404);
  }finally{security.close();rmSync(dir,{recursive:true,force:true});}
});
