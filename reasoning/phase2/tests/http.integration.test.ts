import test from "node:test";
import assert from "node:assert/strict";

test("Phase-2 exposes a built-in HTTP transport",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.createAxiomHttpServer,"function");
});

test("HTTP transport maps routes, generates trusted request IDs, and enforces JSON/idempotency/body limits",async()=>{
  const phase2:any=await import("../src/index.ts");
  const seen:any[]=[];
  const service={
    async handle(request:any){
      seen.push(request);
      if((request.action==="fact:ingest"||request.action==="execution:create")&&!request.idempotencyKey){
        return {
          statusCode:400,
          bodyJson:JSON.stringify({error:{code:"IDEMPOTENCY_KEY_REQUIRED",message:"Idempotency-Key is required",requestId:request.requestId}}),
          headers:{"Content-Type":"application/json"}
        };
      }
      return {statusCode:200,bodyJson:JSON.stringify({ok:true,requestId:request.requestId}),headers:{"Content-Type":"application/json"}};
    }
  };
  const server=phase2.createAxiomHttpServer({service,clock:()=>"2026-10-06T10:00:00.000Z"});
  await new Promise<void>((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>resolve());
  });
  try{
    const address=server.address();
    assert.ok(address&&typeof address==="object");
    const base=`http://127.0.0.1:${address.port}`;

    const read=await fetch(base+"/v1/tenants/tenant%3Aa/executions/platform%3A1",{
      headers:{Authorization:"Bearer caller-token","X-Request-Id":"client-forged"}
    });
    assert.equal(read.status,200);
    assert.equal(seen[0].requestedTenantId,"tenant:a");
    assert.equal(seen[0].resource.id,"platform:1");
    assert.equal(seen[0].action,"execution:read");
    assert.equal(seen[0].bearerToken,"caller-token");
    assert.notEqual(seen[0].requestId,"client-forged");
    assert.match(seen[0].requestId,/^[0-9a-f-]{36}$/i);

    const noIdem=await fetch(base+"/v1/tenants/tenant%3Aa/executions",{
      method:"POST",headers:{Authorization:"Bearer caller-token","Content-Type":"application/json"},body:"{}"
    });
    assert.equal(noIdem.status,400);

    const wrongType=await fetch(base+"/v1/tenants/tenant%3Aa/executions",{
      method:"POST",headers:{Authorization:"Bearer caller-token","Idempotency-Key":"k","Content-Type":"text/plain"},body:"{}"
    });
    assert.equal(wrongType.status,415);

    const badJson=await fetch(base+"/v1/tenants/tenant%3Aa/executions",{
      method:"POST",headers:{Authorization:"Bearer caller-token","Idempotency-Key":"k","Content-Type":"application/json"},body:"{"
    });
    assert.equal(badJson.status,400);

    const huge=await fetch(base+"/v1/tenants/tenant%3Aa/executions",{
      method:"POST",headers:{Authorization:"Bearer caller-token","Idempotency-Key":"k","Content-Type":"application/json"},
      body:JSON.stringify({payload:"x".repeat(1024*1024)})
    });
    assert.equal(huge.status,413);

    const unknown=await fetch(base+"/v1/nope",{headers:{Authorization:"Bearer caller-token"}});
    assert.equal(unknown.status,404);

    const create=await fetch(base+"/v1/tenants/tenant%3Aa/executions",{
      method:"POST",
      headers:{Authorization:"Bearer caller-token","Idempotency-Key":"idem-1","Content-Type":"application/json"},
      body:JSON.stringify({program:{assumptions:[]}})
    });
    assert.equal(create.status,200);
    const last=seen.at(-1);
    assert.equal(last.action,"execution:create");
    assert.equal(last.idempotencyKey,"idem-1");
    assert.deepEqual(last.resource,{kind:"execution"});
    assert.equal(last.now,"2026-10-06T10:00:00.000Z");
  }finally{
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});

test("HTTP transport returns 401 for missing bearer token without exposing internals",async()=>{
  const phase2:any=await import("../src/index.ts");
  const service={
    async handle(request:any){
      assert.equal(request.bearerToken,"");
      return {
        statusCode:401,
        bodyJson:JSON.stringify({error:{code:"UNAUTHENTICATED",message:"Authentication required",requestId:request.requestId}}),
        headers:{"Content-Type":"application/json","WWW-Authenticate":"Bearer"}
      };
    }
  };
  const server=phase2.createAxiomHttpServer({service,clock:()=>"2026-10-06T10:00:00.000Z"});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",()=>resolve()));
  try{
    const address=server.address() as any;
    const response=await fetch(`http://127.0.0.1:${address.port}/v1/tenants/tenant%3Aa/executions/platform%3A1`);
    assert.equal(response.status,401);
    assert.equal(response.headers.get("www-authenticate"),"Bearer");
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});


test("recognized mutation without Idempotency-Key reaches the application service for authenticated audit handling",async()=>{
  const phase2:any=await import("../src/index.ts");
  let called=false;
  const service={
    async handle(request:any){
      called=true;
      assert.equal(request.action,"execution:create");
      assert.equal(request.idempotencyKey,undefined);
      return {
        statusCode:400,
        bodyJson:JSON.stringify({error:{code:"IDEMPOTENCY_KEY_REQUIRED",message:"Idempotency-Key is required",requestId:request.requestId}}),
        headers:{"Content-Type":"application/json"}
      };
    }
  };
  const server=phase2.createAxiomHttpServer({service,clock:()=>"2026-10-06T10:00:00.000Z"});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",()=>resolve()));
  try{
    const address=server.address() as any;
    const response=await fetch(`http://127.0.0.1:${address.port}/v1/tenants/tenant%3Aa/executions`,{
      method:"POST",
      headers:{Authorization:"Bearer caller-token","Content-Type":"application/json"},
      body:JSON.stringify({program:{assumptions:[]}})
    });
    assert.equal(response.status,400);
    assert.equal(called,true,"recognized mutation rejection must pass through the application service so it can be audited");
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});


test("HTTP transport routes evidence acquisition as an audited mutation",async()=>{
  const phase2:any=await import("../src/index.ts");
  let seen:any;
  const service={
    async handle(request:any){
      seen=request;
      return {statusCode:201,bodyJson:JSON.stringify({status:"COMMITTED"}),headers:{"Content-Type":"application/json"}};
    }
  };
  const server=phase2.createAxiomHttpServer({service,clock:()=>"2026-10-06T10:00:00.000Z"});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",()=>resolve()));
  try{
    const address=server.address() as any;
    const response=await fetch(`http://127.0.0.1:${address.port}/v1/tenants/tenant%3Aa/evidence/acquisitions`,{
      method:"POST",
      headers:{Authorization:"Bearer caller-token","Content-Type":"application/json","Idempotency-Key":"evidence-1","X-Request-Id":"forged"},
      body:JSON.stringify({adapterId:"adapter:one",operationId:"read",mappingId:"map:v1",parameters:{symbol:"XAUUSD"}})
    });
    assert.equal(response.status,201);
    assert.equal(seen.action,"evidence:acquire");
    assert.deepEqual(seen.resource,{kind:"evidence"});
    assert.equal(seen.requestedTenantId,"tenant:a");
    assert.equal(seen.idempotencyKey,"evidence-1");
    assert.notEqual(seen.requestId,"forged");
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});


test("HTTP transport maps model compile and immutable-compilation execution routes",async()=>{
  const phase2:any=await import("../src/index.ts");
  const seen:any[]=[];
  const service={async handle(request:any){
    seen.push(request);
    return {
      statusCode:request.action==="model:compile"?201:200,
      bodyJson:JSON.stringify({ok:true}),
      headers:{"Content-Type":"application/json"}
    };
  }};
  const server=phase2.createAxiomHttpServer({service,clock:()=>"2026-10-06T10:00:00.000Z"});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",()=>resolve()));
  try{
    const address=server.address() as any;
    const base=`http://127.0.0.1:${address.port}/v1/tenants/tenant%3Aa/model/compilations`;
    const compile=await fetch(base,{
      method:"POST",headers:{Authorization:"Bearer caller","Content-Type":"application/json","Idempotency-Key":"compile-1"},
      body:JSON.stringify({profileId:"profile:1",objective:"test",inputContracts:[]})
    });
    assert.equal(compile.status,201);
    assert.equal(seen[0].action,"model:compile");
    assert.deepEqual(seen[0].resource,{kind:"model_compilation"});
    assert.equal(seen[0].idempotencyKey,"compile-1");

    const execute=await fetch(base+"/model-compilation%3Aabc/executions",{
      method:"POST",headers:{Authorization:"Bearer caller","Content-Type":"application/json","Idempotency-Key":"execute-1"},
      body:JSON.stringify({asOf:"2026-10-06T10:00:00.000Z",issuedAt:"2026-10-06T10:00:01.000Z"})
    });
    assert.equal(execute.status,200);
    assert.equal(seen[1].action,"model:execute");
    assert.deepEqual(seen[1].resource,{kind:"model_compilation",id:"model-compilation:abc"});
    assert.equal(seen[1].idempotencyKey,"execute-1");
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});


test("HTTP transport routes proof-bound advisory explanation as an idempotent mutation",async()=>{
  const phase2:any=await import("../src/index.ts");
  let seen:any;
  const service={async handle(request:any){
    seen=request;
    return {statusCode:201,bodyJson:JSON.stringify({status:"CREATED",authority:"ADVISORY_ONLY"}),headers:{"Content-Type":"application/json"}};
  }};
  const server=phase2.createAxiomHttpServer({service,clock:()=>"2026-10-08T10:00:00.000Z"});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",()=>resolve()));
  try{
    const address=server.address() as any;
    const response=await fetch(`http://127.0.0.1:${address.port}/v1/tenants/tenant%3Aa/executions/platform%3Aproof/explanations`,{
      method:"POST",
      headers:{Authorization:"Bearer caller","Content-Type":"application/json","Idempotency-Key":"explain-1"},
      body:JSON.stringify({profileId:"profile:explain"})
    });
    assert.equal(response.status,201);
    assert.equal(seen.action,"model:explain");
    assert.deepEqual(seen.resource,{kind:"execution",id:"platform:proof"});
    assert.equal(seen.requestedTenantId,"tenant:a");
    assert.equal(seen.idempotencyKey,"explain-1");
    assert.deepEqual(seen.body,{profileId:"profile:explain"});
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});


test("HTTP transport maps distributed model dispatch and bounded job read routes exactly",async()=>{
  const phase2:any=await import("../src/index.ts");
  const seen:any[]=[];
  const service={async handle(request:any){
    seen.push(request);
    return {
      statusCode:request.action==="model:dispatch"?202:200,
      bodyJson:JSON.stringify({ok:true}),
      headers:{"Content-Type":"application/json"}
    };
  }};
  const server=phase2.createAxiomHttpServer({service,clock:()=>"2026-10-08T14:00:00.000Z"});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",()=>resolve()));
  try{
    const address=server.address() as any,base=`http://127.0.0.1:${address.port}/v1/tenants/tenant%3Aa`;
    const dispatch=await fetch(base+"/model/compilations/model-compilation%3Aabc/execution-jobs",{
      method:"POST",
      headers:{Authorization:"Bearer caller","Content-Type":"application/json","Idempotency-Key":"dispatch-1"},
      body:JSON.stringify({asOf:"2026-10-08T14:00:00.000Z",issuedAt:"2026-10-08T14:00:01.000Z"})
    });
    assert.equal(dispatch.status,202);
    assert.equal(seen[0].action,"model:dispatch");
    assert.deepEqual(seen[0].resource,{kind:"model_compilation",id:"model-compilation:abc"});
    assert.equal(seen[0].idempotencyKey,"dispatch-1");

    const read=await fetch(base+"/execution-jobs/execution-job%3Axyz",{headers:{Authorization:"Bearer caller"}});
    assert.equal(read.status,200);
    assert.equal(seen[1].action,"execution:job:read");
    assert.deepEqual(seen[1].resource,{kind:"execution_job",id:"execution-job:xyz"});
    assert.equal(seen[1].requestedTenantId,"tenant:a");
    assert.equal(seen[1].body,undefined);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
