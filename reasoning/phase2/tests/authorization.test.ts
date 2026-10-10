import test from "node:test";
import assert from "node:assert/strict";

const authenticated={
  principal:{principalId:"principal:alpha",issuer:"https://issuer.example",subject:"service:alpha"},
  credential:{
    issuer:"https://issuer.example",subject:"service:alpha",keyId:"key-1",jwtId:"jwt-1",
    issuedAt:"2026-10-06T09:59:30.000Z",expiresAt:"2026-10-06T10:05:00.000Z",
    tokenHash:"a".repeat(64)
  },
  tenantId:"tenant:forged",
  roles:["admin"],
  scope:"*"
} as any;

function memoryGrants(initial:any[]=[]){
  const grants=[...initial];
  let listCalls=0;
  return {
    repo:{
      async putGrant(grant:any){grants.push(structuredClone(grant));},
      async listApplicable(principalId:string,tenantId:string){
        listCalls++;
        return grants.filter(g=>g.principalId===principalId&&g.tenantId===tenantId).map(g=>structuredClone(g));
      }
    },
    get listCalls(){return listCalls;}
  };
}

test("Phase-2 exposes deterministic tenant authorization",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.DeterministicAuthorizer,"function");
  assert.equal(typeof phase2.createAuthorizedTenantContext,"function");
});

test("authorization uses exact server-side tenant/action grants and creates trusted tenant context only on ALLOW",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.DeterministicAuthorizer,"function");
  const grants=memoryGrants([
    {grantId:"grant-read-a",principalId:"principal:alpha",tenantId:"tenant:a",action:"execution:read"}
  ]);
  const authorizer=new phase2.DeterministicAuthorizer(grants.repo);

  const allowed=await authorizer.authorize(authenticated,{
    requestedTenantId:"tenant:a",action:"execution:read",resource:{kind:"execution",id:"platform:1"}
  });
  assert.equal(allowed.status,"ALLOW");
  assert.deepEqual(allowed.matchedGrantIds,["grant-read-a"]);
  assert.match(allowed.decisionHash,/^[0-9a-f]{64}$/);

  const context=phase2.createAuthorizedTenantContext(authenticated,{
    requestedTenantId:"tenant:a",action:"execution:read",resource:{kind:"execution",id:"platform:1"}
  },allowed);
  assert.deepEqual(context.tenant,{tenantId:"tenant:a"});
  assert.equal(context.principal.principalId,"principal:alpha");
  assert.equal((context as any).tenantId,undefined);
  assert.equal((context as any).roles,undefined);

  const wrongTenant=await authorizer.authorize(authenticated,{
    requestedTenantId:"tenant:b",action:"execution:read",resource:{kind:"execution",id:"platform:1"}
  });
  assert.equal(wrongTenant.status,"DENY");

  const escalated=await authorizer.authorize(authenticated,{
    requestedTenantId:"tenant:a",action:"execution:replay",resource:{kind:"execution",id:"platform:1"}
  });
  assert.equal(escalated.status,"DENY");
  assert.throws(()=>phase2.createAuthorizedTenantContext(authenticated,{
    requestedTenantId:"tenant:a",action:"execution:replay",resource:{kind:"execution",id:"platform:1"}
  },escalated),/denied|allow/i);
});

test("authorization denies malformed targets before grant-repository access",async()=>{
  const phase2:any=await import("../src/index.ts");
  const grants=memoryGrants([{grantId:"g",principalId:"principal:alpha",tenantId:"tenant:a",action:"execution:read"}]);
  const authorizer=new phase2.DeterministicAuthorizer(grants.repo);
  const invalidTargets=[
    {requestedTenantId:"",action:"execution:read",resource:{kind:"execution",id:"platform:1"}},
    {requestedTenantId:"tenant:a",action:"execution:read",resource:{kind:"execution",id:""}},
    {requestedTenantId:"tenant:a",action:"execution:replay",resource:{kind:"fact",id:"platform:1"}},
    {requestedTenantId:"tenant:a",action:"fact:ingest",resource:{kind:"execution"}},
    {requestedTenantId:"tenant:a",action:"not-real",resource:{kind:"execution"}}
  ];
  for(const target of invalidTargets){
    const before=grants.listCalls;
    const decision=await authorizer.authorize(authenticated,target);
    assert.equal(decision.status,"DENY");
    assert.equal(grants.listCalls,before);
  }
});

test("authorization decisions are deterministic across grant order and bind tenant action resource and grant set",async()=>{
  const phase2:any=await import("../src/index.ts");
  const g1={grantId:"g-z",principalId:"principal:alpha",tenantId:"tenant:a",action:"execution:read"};
  const g2={grantId:"g-a",principalId:"principal:alpha",tenantId:"tenant:a",action:"execution:read"};
  const target={requestedTenantId:"tenant:a",action:"execution:read",resource:{kind:"execution",id:"platform:1"}};

  const first=await new phase2.DeterministicAuthorizer(memoryGrants([g1,g2]).repo).authorize(authenticated,target);
  const second=await new phase2.DeterministicAuthorizer(memoryGrants([g2,g1]).repo).authorize(authenticated,target);
  assert.equal(first.decisionHash,second.decisionHash);
  assert.deepEqual(first.matchedGrantIds,["g-a","g-z"]);
  assert.equal(first.policyManifest.grantsHash,second.policyManifest.grantsHash);

  const resourceChanged=await new phase2.DeterministicAuthorizer(memoryGrants([g1,g2]).repo).authorize(authenticated,{
    ...target,resource:{kind:"execution",id:"platform:2"}
  });
  const actionChanged=await new phase2.DeterministicAuthorizer(memoryGrants([
    {...g1,grantId:"g-replay",action:"execution:replay"}
  ]).repo).authorize(authenticated,{
    ...target,action:"execution:replay"
  });
  const tenantChanged=await new phase2.DeterministicAuthorizer(memoryGrants([
    {...g1,grantId:"g-b",tenantId:"tenant:b"}
  ]).repo).authorize(authenticated,{
    ...target,requestedTenantId:"tenant:b"
  });
  const grantSetChanged=await new phase2.DeterministicAuthorizer(memoryGrants([g1]).repo).authorize(authenticated,target);

  assert.notEqual(first.decisionHash,resourceChanged.decisionHash);
  assert.notEqual(first.decisionHash,actionChanged.decisionHash);
  assert.notEqual(first.decisionHash,tenantChanged.decisionHash);
  assert.notEqual(first.decisionHash,grantSetChanged.decisionHash);
});


test("evidence acquisition requires an exact server-side evidence:acquire grant",async()=>{
  const phase2:any=await import("../src/index.ts");
  const target={requestedTenantId:"tenant:a",action:"evidence:acquire",resource:{kind:"evidence"}};
  const exact={grantId:"g-evidence",principalId:"principal:alpha",tenantId:"tenant:a",action:"evidence:acquire"};
  const wrong={grantId:"g-execution",principalId:"principal:alpha",tenantId:"tenant:a",action:"execution:create"};

  const allowed=await new phase2.DeterministicAuthorizer(memoryGrants([wrong,exact]).repo).authorize(authenticated,target);
  assert.equal(allowed.status,"ALLOW");
  assert.deepEqual(allowed.matchedGrantIds,["g-evidence"]);

  const denied=await new phase2.DeterministicAuthorizer(memoryGrants([wrong]).repo).authorize(authenticated,target);
  assert.equal(denied.status,"DENY");
  assert.deepEqual(denied.matchedGrantIds,[]);
});


test("model compile and execute require independent exact server-side grants",async()=>{
  const phase2:any=await import("../src/index.ts");
  const compileTarget={requestedTenantId:"tenant:a",action:"model:compile",resource:{kind:"model_compilation"}};
  const executeTarget={requestedTenantId:"tenant:a",action:"model:execute",resource:{kind:"model_compilation",id:"model-compilation:1"}};
  const grants=memoryGrants([
    {grantId:"g-create",principalId:"principal:alpha",tenantId:"tenant:a",action:"execution:create"},
    {grantId:"g-model-compile",principalId:"principal:alpha",tenantId:"tenant:a",action:"model:compile"},
    {grantId:"g-model-execute",principalId:"principal:alpha",tenantId:"tenant:a",action:"model:execute"}
  ]);
  const authorizer=new phase2.DeterministicAuthorizer(grants.repo);

  const compile=await authorizer.authorize(authenticated,compileTarget);
  assert.equal(compile.status,"ALLOW");
  assert.deepEqual(compile.matchedGrantIds,["g-model-compile"]);

  const execute=await authorizer.authorize(authenticated,executeTarget);
  assert.equal(execute.status,"ALLOW");
  assert.deepEqual(execute.matchedGrantIds,["g-model-execute"]);

  const compileOnly=new phase2.DeterministicAuthorizer(memoryGrants([
    {grantId:"only-compile",principalId:"principal:alpha",tenantId:"tenant:a",action:"model:compile"}
  ]).repo);
  assert.equal((await compileOnly.authorize(authenticated,executeTarget)).status,"DENY");

  const executionOnly=new phase2.DeterministicAuthorizer(memoryGrants([
    {grantId:"only-execution",principalId:"principal:alpha",tenantId:"tenant:a",action:"execution:create"}
  ]).repo);
  assert.equal((await executionOnly.authorize(authenticated,compileTarget)).status,"DENY");
});

test("malformed model authorization resources deny before grant lookup",async()=>{
  const phase2:any=await import("../src/index.ts");
  const grants=memoryGrants([]);
  const authorizer=new phase2.DeterministicAuthorizer(grants.repo);
  for(const target of [
    {requestedTenantId:"tenant:a",action:"model:compile",resource:{kind:"model_compilation",id:"unexpected"}},
    {requestedTenantId:"tenant:a",action:"model:execute",resource:{kind:"model_compilation"}},
    {requestedTenantId:"tenant:a",action:"model:execute",resource:{kind:"execution",id:"model-compilation:1"}}
  ]){
    const before=grants.listCalls;
    const decision=await authorizer.authorize(authenticated,target);
    assert.equal(decision.status,"DENY");
    assert.equal(grants.listCalls,before);
  }
});


test("model explanation requires an independent exact server-side grant on the execution resource",async()=>{
  const phase2:any=await import("../src/index.ts");
  const target={requestedTenantId:"tenant:a",action:"model:explain",resource:{kind:"execution",id:"platform:proof-1"}};
  const exact={grantId:"g-model-explain",principalId:"principal:alpha",tenantId:"tenant:a",action:"model:explain"};
  const other=[
    {grantId:"g-model-compile",principalId:"principal:alpha",tenantId:"tenant:a",action:"model:compile"},
    {grantId:"g-model-execute",principalId:"principal:alpha",tenantId:"tenant:a",action:"model:execute"},
    {grantId:"g-execution-read",principalId:"principal:alpha",tenantId:"tenant:a",action:"execution:read"}
  ];
  const authorizer=new phase2.DeterministicAuthorizer(memoryGrants([...other,exact]).repo);
  const allowed=await authorizer.authorize(authenticated,target);
  assert.equal(allowed.status,"ALLOW");
  assert.deepEqual(allowed.matchedGrantIds,["g-model-explain"]);

  for(const grant of other){
    const denied=await new phase2.DeterministicAuthorizer(memoryGrants([grant]).repo).authorize(authenticated,target);
    assert.equal(denied.status,"DENY",grant.action);
  }

  const malformed=memoryGrants([exact]);
  const malformedAuthorizer=new phase2.DeterministicAuthorizer(malformed.repo);
  for(const bad of [
    {...target,resource:{kind:"execution"}},
    {...target,resource:{kind:"model_compilation",id:"platform:proof-1"}},
    {...target,resource:{kind:"execution",id:""}}
  ]){
    const before=malformed.listCalls;
    const decision=await malformedAuthorizer.authorize(authenticated,bad);
    assert.equal(decision.status,"DENY");
    assert.equal(malformed.listCalls,before);
  }
});


test("model dispatch and distributed job read require independent exact grants",async()=>{
  const phase2:any=await import("../src/index.ts");
  const compilationId="model-compilation:dispatch-1",jobId="execution-job:job-1";
  const dispatchTarget={requestedTenantId:"tenant:a",action:"model:dispatch",resource:{kind:"model_compilation",id:compilationId}};
  const executeTarget={requestedTenantId:"tenant:a",action:"model:execute",resource:{kind:"model_compilation",id:compilationId}};
  const jobReadTarget={requestedTenantId:"tenant:a",action:"execution:job:read",resource:{kind:"execution_job",id:jobId}};
  const grants=memoryGrants([
    {grantId:"g-dispatch",principalId:"principal:alpha",tenantId:"tenant:a",action:"model:dispatch"},
    {grantId:"g-job-read",principalId:"principal:alpha",tenantId:"tenant:a",action:"execution:job:read"}
  ]);
  const authorizer=new phase2.DeterministicAuthorizer(grants.repo);
  assert.equal((await authorizer.authorize(authenticated,dispatchTarget)).status,"ALLOW");
  assert.equal((await authorizer.authorize(authenticated,jobReadTarget)).status,"ALLOW");
  assert.equal((await authorizer.authorize(authenticated,executeTarget)).status,"DENY");

  const executeOnly=new phase2.DeterministicAuthorizer(memoryGrants([
    {grantId:"g-execute-only",principalId:"principal:alpha",tenantId:"tenant:a",action:"model:execute"}
  ]).repo);
  assert.equal((await executeOnly.authorize(authenticated,dispatchTarget)).status,"DENY");

  const dispatchOnly=new phase2.DeterministicAuthorizer(memoryGrants([
    {grantId:"g-dispatch-only",principalId:"principal:alpha",tenantId:"tenant:a",action:"model:dispatch"}
  ]).repo);
  assert.equal((await dispatchOnly.authorize(authenticated,executeTarget)).status,"DENY");
  assert.equal((await dispatchOnly.authorize(authenticated,jobReadTarget)).status,"DENY");

  const malformed=memoryGrants([
    {grantId:"g-job-read",principalId:"principal:alpha",tenantId:"tenant:a",action:"execution:job:read"}
  ]);
  const malformedAuthorizer=new phase2.DeterministicAuthorizer(malformed.repo);
  for(const target of [
    {...jobReadTarget,resource:{kind:"execution_job"}},
    {...jobReadTarget,resource:{kind:"execution",id:jobId}},
    {...dispatchTarget,resource:{kind:"model_compilation"}}
  ]){
    const before=malformed.listCalls;
    const decision=await malformedAuthorizer.authorize(authenticated,target);
    assert.equal(decision.status,"DENY");
    assert.equal(malformed.listCalls,before);
  }
});
