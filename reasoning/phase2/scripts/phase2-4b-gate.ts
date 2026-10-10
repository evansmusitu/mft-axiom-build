import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDefaultRegistry, createSigner, hashJson } from "../../phase1/src/index.ts";
import {
  AnthropicMessagesModelAdapter, AxiomApiService, DeterministicAuthorizer, ExecutionStore,
  ModelCompilationService, ModelCompilationStore, ModelCompilerRegistry, ModelExecutionService,
  ModelExplanationError, ModelExplanationRegistry, ModelExplanationService, ModelExplanationStore,
  OpenAiResponsesModelAdapter, ReasoningControlPlane, SecurityStore, StaticSecretResolver,
  WorldStateStore, createAuthorizedTenantContext, createAxiomHttpServer, createStaticSignerProvider,
  type ApiAction, type ApiResource, type ModelCompilerProfile, type TenantScope
} from "../src/index.ts";

const NOW="2026-10-08T10:00:00.000Z";
const ISSUED="2026-10-08T10:00:01.000Z";
const tenantA={tenantId:"tenant:phase24b-gate"};
const tenantB={tenantId:"tenant:phase24b-other"};
const H=(c:string)=>c.repeat(64);
const openAiSecret="phase24b-openai-provider-secret";
const anthropicSecret="phase24b-anthropic-provider-secret";

function wireProposal(){
  return {
    proposal:{
      assumptions:["Fresh tenant evidence remains authoritative at execution"],
      nodes:[{
        id:"decision",kind:"Decision",operation:"comparison.lte",
        inputs:[
          {name:"left",input:"observed",node:null,literalJson:null},
          {name:"right",input:"maximum",node:null,literalJson:null}
        ],
        paramsJson:"{}"
      }],
      constraints:[],
      decisionNodeId:"decision"
    }
  };
}
function normalizedProposal(){
  return {
    proposal:{
      assumptions:["Fresh tenant evidence remains authoritative at execution"],
      nodes:[{
        id:"decision",kind:"Decision",operation:"comparison.lte",
        inputs:{left:{input:"observed"},right:{input:"maximum"}},
        params:{}
      }],
      constraints:[],
      decisionNodeId:"decision"
    }
  };
}
function openAiResponse(text:string):string{
  return JSON.stringify({
    id:"resp_phase24b",object:"response",status:"completed",error:null,model:openAiManifest.modelId,
    output:[{id:"msg_phase24b",type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text,annotations:[]}]}]
  });
}
function anthropicResponse(text:string,model:string):string{
  return JSON.stringify({
    id:"msg_phase24b",type:"message",role:"assistant",model,stop_reason:"end_turn",stop_sequence:null,
    content:[{type:"text",text}],usage:{input_tokens:10,output_tokens:20}
  });
}
async function listen(server:any):Promise<number>{
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve());});
  const address=server.address();assert.ok(address&&typeof address==="object");return address.port;
}
async function close(server:any):Promise<void>{await new Promise<void>(resolve=>server.close(()=>resolve()));}

const inputContracts=[
  {inputName:"observed",type:{kind:"number" as const,unit:"ratio"},entity:"risk:alpha",attribute:"current",requirementId:"observed-risk",maxAgeMs:10*60*1000},
  {inputName:"maximum",type:{kind:"number" as const,unit:"ratio"},entity:"risk:alpha",attribute:"maximum",requirementId:"maximum-risk",maxAgeMs:10*60*1000}
];
const openAiProfile:ModelCompilerProfile={
  profileId:"profile:phase24b:openai",version:"1.0.0",adapterId:"model:openai:phase24b",
  allowedOperationIds:["comparison.lte"],maxRepairAttempts:2,maxInputs:4,maxNodes:8,maxConstraints:4,
  maxAssumptions:4,maxObjectiveBytes:2048,maxModelResponseBytes:16384
};
const anthropicProfile:ModelCompilerProfile={
  ...openAiProfile,profileId:"profile:phase24b:anthropic",adapterId:"model:anthropic:phase24b"
};
const openAiManifest={adapterId:openAiProfile.adapterId,version:"1.0.0",implementationHash:H("a"),provider:"openai",modelId:"gpt-phase24b"};
const anthropicManifest={adapterId:anthropicProfile.adapterId,version:"1.0.0",implementationHash:H("b"),provider:"anthropic",modelId:"claude-phase24b"};

let openAiCompileCalls=0,openAiExplainCalls=0,anthropicCompileCalls=0;
const openAiAdapter=new OpenAiResponsesModelAdapter({
  manifest:openAiManifest,apiKeySecretRef:"secret:openai",timeoutMs:1000,maxResponseBytes:32768,
  secretResolver:new StaticSecretResolver({"secret:openai":openAiSecret}),
  fetchFn:async(_url,init)=>{
    assert.equal((init?.headers as any).authorization,`Bearer ${openAiSecret}`);
    const requestBody=String(init?.body??"");
    assert.equal(requestBody.includes(openAiSecret),false);
    const request=JSON.parse(requestBody);
    const name=request.text?.format?.name;
    if(name==="axiom_advisory_explanation_v1"){
      openAiExplainCalls++;
      const content={
        summary:"The stored AXIOM execution replayed exactly and approved the bounded comparison.",
        keyFactors:["Trusted world-state evidence satisfied the configured comparison."],
        limitations:["This explanation is advisory only and cannot change the signed execution."]
      };
      return new Response(openAiResponse(JSON.stringify(content)),{status:200,headers:{"content-type":"application/json"}});
    }
    openAiCompileCalls++;
    return new Response(openAiResponse(JSON.stringify(wireProposal())),{status:200,headers:{"content-type":"application/json"}});
  }
});
const anthropicAdapter=new AnthropicMessagesModelAdapter({
  manifest:anthropicManifest,apiKeySecretRef:"secret:anthropic",anthropicVersion:"2023-06-01",
  maxTokens:2048,timeoutMs:1000,maxResponseBytes:32768,
  secretResolver:new StaticSecretResolver({"secret:anthropic":anthropicSecret}),
  fetchFn:async(_url,init)=>{
    assert.equal((init?.headers as any)["x-api-key"],anthropicSecret);
    const requestBody=String(init?.body??"");
    assert.equal(requestBody.includes(anthropicSecret),false);
    anthropicCompileCalls++;
    return new Response(anthropicResponse(JSON.stringify(wireProposal()),anthropicManifest.modelId),{status:200,headers:{"content-type":"application/json"}});
  }
});

const dir=mkdtempSync(join(tmpdir(),"axiom-phase24b-gate-")),db=join(dir,"platform.db");
const world=new WorldStateStore(db);
const executions=new ExecutionStore(db);
const security=new SecurityStore(db);
const compilations=new ModelCompilationStore(db);
const explanations=new ModelExplanationStore(db);
const registry=createDefaultRegistry();
const profiles=new ModelCompilerRegistry(registry,[
  {profile:openAiProfile,tenantIds:[tenantA.tenantId]},
  {profile:anthropicProfile,tenantIds:[tenantA.tenantId]}
]);
const signer=createStaticSignerProvider("reasoning-key:phase24b",createSigner());
const plane=new ReasoningControlPlane({tenant:tenantA,world,executions,signer,registry});
const explainerProfiles=new ModelExplanationRegistry([{
  profile:{profileId:"profile:phase24b:explain",version:"1.0.0",adapterId:openAiManifest.adapterId,maxPromptBytes:16384,maxResponseBytes:8192},
  tenantIds:[tenantA.tenantId]
}]);
const explainer=new ModelExplanationService({
  tenant:tenantA,profiles:explainerProfiles,repository:explanations,executions,plane,adapters:[openAiAdapter],
  now:()=>new Date("2026-10-08T10:00:02.000Z")
});

const principal={
  principalId:"principal:phase24b",issuer:"https://issuer.axiom.example",subject:"service:phase24b"
};
const authenticated={
  principal,
  credential:{
    issuer:principal.issuer,subject:principal.subject,keyId:"api-key:v1",jwtId:"jwt-phase24b",
    issuedAt:"2026-10-08T09:59:00.000Z",expiresAt:"2026-10-08T10:05:00.000Z",tokenHash:H("c")
  }
};
const authorizer=new DeterministicAuthorizer(security);

async function contextFor(action:ApiAction,resource:ApiResource){
  const target={requestedTenantId:tenantA.tenantId,action,resource};
  const decision=await authorizer.authorize(authenticated,target);
  assert.equal(decision.status,"ALLOW",`${action} grant must be configured`);
  return createAuthorizedTenantContext(authenticated,target,decision);
}

let runtimeCreates=0;
const runtimes={
  create(scope:TenantScope){
    runtimeCreates++;
    assert.equal(scope.tenantId,tenantA.tenantId);
    return {
      modelCompiler:{async compile(){throw new Error("compile is outside explanation API gate path");}},
      modelExecutor:{async execute(){throw new Error("execute is outside explanation API gate path");}},
      modelExplainer:explainer,
      acquisitions:{async acquire(){throw new Error("unused");}},
      ingestor:{async ingest(){throw new Error("unused");}},
      executions,
      plane
    };
  }
};
const api=new AxiomApiService({
  authenticator:{async authenticate(token:string){if(token!=="phase24b-token")throw new Error("bad token");return structuredClone(authenticated);}},
  authorizer,idempotency:security,audit:security,runtimes
});
const server=createAxiomHttpServer({service:api,clock:()=>NOW});

try{
  await world.putFact(tenantA,{
    id:"fact:observed",entity:"risk:alpha",attribute:"current",value:{type:{kind:"number",unit:"ratio"},value:0.20},
    validFrom:"2026-10-08T09:50:00.000Z",observedAt:"2026-10-08T09:59:40.000Z",source:"risk-engine:trusted"
  });
  await world.putFact(tenantA,{
    id:"fact:maximum",entity:"risk:alpha",attribute:"maximum",value:{type:{kind:"number",unit:"ratio"},value:0.30},
    validFrom:"2026-10-08T09:50:00.000Z",observedAt:"2026-10-08T09:59:41.000Z",source:"risk-policy:trusted"
  });
  for(const action of ["model:compile","model:execute","model:explain"] as const){
    await security.putGrant({grantId:`gate:${action}`,principalId:principal.principalId,tenantId:tenantA.tenantId,action});
  }

  const openAiCompiler=new ModelCompilationService({
    profiles,repository:compilations,registry,adapter:openAiAdapter,now:()=>"2026-10-08T10:00:00.100Z"
  });
  const anthropicCompiler=new ModelCompilationService({
    profiles,repository:compilations,registry,adapter:anthropicAdapter,now:()=>"2026-10-08T10:00:00.200Z"
  });
  const objective="Approve only when observed risk is no greater than the trusted maximum";
  const openAiRequest={profileId:openAiProfile.profileId,objective,inputContracts};
  const anthropicRequest={profileId:anthropicProfile.profileId,objective,inputContracts};

  const compileContext=await contextFor("model:compile",{kind:"model_compilation"});
  const openAiCompiled=await openAiCompiler.compile(compileContext,openAiRequest,hashJson(openAiRequest as any));
  const anthropicCompiled=await anthropicCompiler.compile(compileContext,anthropicRequest,hashJson(anthropicRequest as any));
  assert.equal(openAiCompiled.status,"VALIDATED");
  assert.equal(anthropicCompiled.status,"VALIDATED");
  assert.equal(openAiCompileCalls,1);
  assert.equal(anthropicCompileCalls,1);

  const openAiRecord=await compilations.getCompilation(tenantA,openAiCompiled.compilationId);
  const anthropicRecord=await compilations.getCompilation(tenantA,anthropicCompiled.compilationId);
  const openAiArtifact=await compilations.getModelArtifact(tenantA,openAiRecord.exchangeArtifactIds[0]);
  const anthropicArtifact=await compilations.getModelArtifact(tenantA,anthropicRecord.exchangeArtifactIds[0]);
  for(const artifact of [openAiArtifact,anthropicArtifact]){
    assert.ok(artifact.normalizedResponseBody);
    assert.ok(artifact.normalizedResponseBodyHash);
    assert.notEqual(artifact.responseBodyHash,artifact.normalizedResponseBodyHash);
    assert.deepEqual(JSON.parse(artifact.normalizedResponseBody!),normalizedProposal());
  }

  const executor=new ModelExecutionService({repository:compilations,profiles,registry,plane});
  const executeContext=await contextFor("model:execute",{kind:"model_compilation",id:openAiCompiled.compilationId});
  const issued=await executor.execute(executeContext,openAiCompiled.compilationId,{asOf:NOW,issuedAt:ISSUED});
  assert.equal(issued.status,"APPROVED");
  assert.ok(issued.executionRecordId);
  const beforeExplanation=await executions.get(tenantA,issued.executionRecordId!);
  assert.deepEqual(await plane.replayStored(issued.executionRecordId!),{status:"MATCH",diagnostics:[]});

  const port=await listen(server);
  const base=`http://127.0.0.1:${port}/v1/tenants/${encodeURIComponent(tenantA.tenantId)}`;
  const explainUrl=base+`/executions/${encodeURIComponent(issued.executionRecordId!)}/explanations`;
  const explainHeaders={Authorization:"Bearer phase24b-token","Content-Type":"application/json","Idempotency-Key":"idem:phase24b:explain"};
  const explainBody={profileId:"profile:phase24b:explain"};

  const first=await fetch(explainUrl,{method:"POST",headers:explainHeaders,body:JSON.stringify(explainBody)});
  assert.equal(first.status,201);
  const firstText=await first.text(),firstPayload=JSON.parse(firstText);
  assert.equal(firstPayload.authority,"ADVISORY_ONLY");
  assert.equal(openAiExplainCalls,1);

  const replay=await fetch(explainUrl,{method:"POST",headers:explainHeaders,body:JSON.stringify(explainBody)});
  assert.equal(replay.status,201);
  assert.equal(await replay.text(),firstText);
  assert.equal(openAiExplainCalls,1,"completed explanation retry must not refetch provider");

  const afterExplanation=await executions.get(tenantA,issued.executionRecordId!);
  assert.equal(afterExplanation.recordHash,beforeExplanation.recordHash);
  assert.equal(afterExplanation.certificate.certificateId,beforeExplanation.certificate.certificateId);

  const callsBeforeCrossTenant=openAiExplainCalls;
  const crossTenant=await fetch(
    `http://127.0.0.1:${port}/v1/tenants/${encodeURIComponent(tenantB.tenantId)}/executions/${encodeURIComponent(issued.executionRecordId!)}/explanations`,
    {method:"POST",headers:{...explainHeaders,"Idempotency-Key":"idem:phase24b:cross"},body:JSON.stringify(explainBody)}
  );
  assert.equal(crossTenant.status,403);
  assert.equal(openAiExplainCalls,callsBeforeCrossTenant);
  assert.equal(runtimeCreates,1,"cross-tenant denial must occur before runtime creation");

  const explainContext=await contextFor("model:explain",{kind:"execution",id:issued.executionRecordId!});
  const mismatchService=new ModelExplanationService({
    tenant:tenantA,profiles:explainerProfiles,repository:explanations,executions,
    plane:{async replayStored(){return {status:"MISMATCH" as const,diagnostics:["forced mismatch"]};}},
    adapters:[openAiAdapter],now:()=>new Date("2026-10-08T10:00:03.000Z")
  });
  const callsBeforeMismatch=openAiExplainCalls;
  await assert.rejects(
    ()=>mismatchService.explain(explainContext,issued.executionRecordId!,explainBody,H("d")),
    (error:any)=>error instanceof ModelExplanationError&&error.code==="MODEL_EXPLANATION_PROOF_REJECTED"&&error.httpStatus===422
  );
  assert.equal(openAiExplainCalls,callsBeforeMismatch,"replay mismatch must reject before provider access");

  const storedExplanation=await explanations.get(tenantA,firstPayload.explanationId);
  assert.equal(storedExplanation.authority,"ADVISORY_ONLY");
  assert.equal(storedExplanation.executionRecordHash,beforeExplanation.recordHash);

  const inspect=new DatabaseSync(db);
  try{
    const persisted=inspect.prepare("SELECT * FROM axiom_model_explanations WHERE tenant_id=? AND explanation_id=?")
      .get(tenantA.tenantId,firstPayload.explanationId) as any;
    assert.ok(persisted);
    assert.equal(JSON.stringify(persisted).includes(openAiSecret),false);
    assert.equal(JSON.stringify(persisted).includes(anthropicSecret),false);
    inspect.prepare("UPDATE axiom_model_explanations SET normalized_response_body=? WHERE tenant_id=? AND explanation_id=?")
      .run('{"tampered":true}',tenantA.tenantId,firstPayload.explanationId);
  }finally{inspect.close();}
  await assert.rejects(()=>explanations.get(tenantA,firstPayload.explanationId),/integrity|hash/i);

  assert.deepEqual(await security.verifyStream(tenantA.tenantId),{status:"MATCH",diagnostics:[]});
  assert.deepEqual(await security.verifyStream(tenantB.tenantId),{status:"MATCH",diagnostics:[]});

  console.log(JSON.stringify({
    phase:"P2.4B — First-Party Model Adapters and Proof-Bound Advisory Explanations",
    status:"PASS",
    checks:[
      "compile the same bounded proposal through mocked OpenAI Responses and Anthropic Messages adapters",
      "bind exact provider transport and normalized proposal as separate commitments",
      "execute only a validated immutable compilation through fresh trusted world state",
      "require stored execution replay MATCH before advisory explanation provider access",
      "preserve execution and certificate commitments across explanation",
      "replay completed explanation response without provider refetch",
      "reject cross-tenant explanation before runtime/provider access",
      "reject replay mismatch before provider access",
      "persist tenant-scoped advisory explanation and detect direct tampering",
      "exclude provider credentials from captured and persisted material"
    ],
    tenantId:tenantA.tenantId,
    openAiCompilationId:openAiCompiled.compilationId,
    anthropicCompilationId:anthropicCompiled.compilationId,
    executionRecordId:issued.executionRecordId,
    explanationId:firstPayload.explanationId,
    openAiCompileCalls,anthropicCompileCalls,openAiExplainCalls
  },null,2));
}finally{
  await close(server).catch(()=>{});
  explanations.close();compilations.close();security.close();executions.close();world.close();
  rmSync(dir,{recursive:true,force:true});
}
