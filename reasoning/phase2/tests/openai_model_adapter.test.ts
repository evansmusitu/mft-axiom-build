import test from "node:test";
import assert from "node:assert/strict";
import { hashJson } from "../../phase1/src/canonical.ts";

const H=(c:string)=>c.repeat(64);
const manifest={
  adapterId:"model:openai",version:"1.0.0",implementationHash:H("a"),
  provider:"openai",modelId:"gpt-5.1-2025-11-13"
};
const profile={
  profileId:"profile:openai",version:"1.0.0",adapterId:manifest.adapterId,
  allowedOperationIds:["comparison.lte"],maxRepairAttempts:2,maxInputs:4,maxNodes:8,
  maxConstraints:4,maxAssumptions:4,maxObjectiveBytes:2048,maxModelResponseBytes:8192
};
const contracts=[
  {inputName:"observed",type:{kind:"number",unit:"ratio"},entity:"risk:a",attribute:"current",requirementId:"current",maxAgeMs:60000},
  {inputName:"maximum",type:{kind:"number",unit:"ratio"},entity:"risk:a",attribute:"maximum",requirementId:"maximum",maxAgeMs:60000}
];
const operations=[{id:"comparison.lte",version:"1.0.0",implementationHash:H("b"),moduleHash:H("c")}];

function adapterInput(overrides:any={}){
  return {
    tenant:{tenantId:"tenant:openai"},profile,
    profileHash:hashJson({...profile,allowedOperationIds:[...profile.allowedOperationIds].sort()}),
    compilationRequestHash:H("d"),attempt:0,mode:"INITIAL",
    objective:"Approve only when observed risk is within the configured maximum",
    inputContracts:contracts,operationRegistryManifest:operations,remainingRepairAttempts:2,
    capturedAt:"2026-10-07T20:30:00.000Z",...overrides
  };
}
function wireProposal(){
  return {
    assumptions:[],
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
  };
}
function normalizedProposal(){
  return {
    proposal:{
      assumptions:[],
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
function openAiResponse(text=JSON.stringify({proposal:wireProposal()}),extraOutput:any[]=[]){
  return JSON.stringify({
    id:"resp_fixture",object:"response",status:"completed",error:null,model:manifest.modelId,
    output:[
      ...extraOutput,
      {id:"msg_fixture",type:"message",role:"assistant",status:"completed",content:[
        {type:"output_text",text,annotations:[]}
      ]}
    ]
  });
}
function response(body:string,status=200,type="application/json"){
  return new Response(body,{status,headers:{"content-type":type}});
}

test("OpenAI Responses adapter uses fixed capability surface and normalizes one structured proposal",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.OpenAiResponsesModelAdapter,"function");
  const calls:any[]=[];let resolves=0;
  const adapter=new phase2.OpenAiResponsesModelAdapter({
    manifest,
    apiKeySecretRef:"secret:openai",
    timeoutMs:1000,
    maxResponseBytes:16384,
    secretResolver:{async resolve(ref:string){resolves++;assert.equal(ref,"secret:openai");return "sk-test-super-secret";}},
    fetchFn:async(url:any,init:any)=>{calls.push({url:String(url),init});return response(openAiResponse());}
  });
  const captured=await adapter.invoke(adapterInput());
  assert.equal(resolves,1);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"https://api.openai.com/v1/responses");
  assert.equal(calls[0].init.method,"POST");
  assert.equal(calls[0].init.redirect,"manual");
  assert.equal(calls[0].init.headers.authorization,"Bearer sk-test-super-secret");
  assert.equal(calls[0].init.headers["content-type"],"application/json");
  const request=JSON.parse(captured.requestBody);
  assert.equal(request.model,manifest.modelId);
  assert.equal(request.store,false);
  assert.equal("tools" in request,false);
  assert.equal("conversation" in request,false);
  assert.equal("previous_response_id" in request,false);
  assert.equal("background" in request,false);
  assert.equal(request.text.format.type,"json_schema");
  assert.equal(request.text.format.strict,true);
  assert.equal(typeof request.text.format.schema,"object");
  assert.equal(request.input.length,1);
  assert.equal(request.input[0].role,"user");
  assert.equal(request.input[0].content.length,1);
  assert.equal(request.input[0].content[0].type,"input_text");
  const gateway=JSON.parse(request.input[0].content[0].text);
  assert.equal(gateway.schemaVersion,"axiom.model-proposal.v1");
  assert.equal(gateway.objective,adapterInput().objective);
  assert.equal(gateway.tenantId,undefined);
  assert.equal(captured.requestBody.includes("sk-test-super-secret"),false);
  assert.equal(captured.responseBody,openAiResponse());
  assert.deepEqual(JSON.parse(captured.normalizedResponseBody),normalizedProposal());
});

test("OpenAI adapter repair sends canonical AXIOM repair envelope but no provider-managed conversation state",async()=>{
  const phase2:any=await import("../src/index.ts");
  let sent:any;
  const adapter=new phase2.OpenAiResponsesModelAdapter({
    manifest,apiKeySecretRef:"secret:openai",timeoutMs:1000,maxResponseBytes:16384,
    secretResolver:{async resolve(){return "key";}},
    fetchFn:async(_url:any,init:any)=>{sent=JSON.parse(String(init.body));return response(openAiResponse());}
  });
  const previousResponseBody=JSON.stringify(normalizedProposal());
  await adapter.invoke(adapterInput({
    attempt:1,mode:"REPAIR",remainingRepairAttempts:1,previousResponseBody,
    issues:[{code:"MODEL_PROPOSAL_SCHEMA",message:"bad proposal"}]
  }));
  assert.equal("conversation" in sent,false);
  assert.equal("previous_response_id" in sent,false);
  const gateway=JSON.parse(sent.input[0].content[0].text);
  assert.equal(gateway.repair.previousResponseBody,previousResponseBody);
  assert.equal(gateway.repair.remainingRepairAttempts,1);
  assert.deepEqual(gateway.repair.issues,[{code:"MODEL_PROPOSAL_SCHEMA",message:"bad proposal"}]);
});

test("OpenAI adapter rejects ambiguous or malformed Responses output instead of guessing",async()=>{
  const phase2:any=await import("../src/index.ts");
  const make=(body:string)=>new phase2.OpenAiResponsesModelAdapter({
    manifest,apiKeySecretRef:"secret:openai",timeoutMs:1000,maxResponseBytes:16384,
    secretResolver:{async resolve(){return "key";}},
    fetchFn:async()=>response(body)
  });
  const cases=[
    JSON.stringify({id:"r",object:"response",status:"incomplete",error:null,output:[]}),
    JSON.stringify({id:"r",object:"response",status:"completed",error:null,output:[]}),
    openAiResponse("not-json"),
    openAiResponse(JSON.stringify({proposal:wireProposal(),extra:true})),
    openAiResponse(JSON.stringify({proposal:"bad"})),
    JSON.stringify({id:"r",object:"response",status:"completed",error:null,output:[
      {type:"message",role:"assistant",status:"completed",content:[
        {type:"output_text",text:JSON.stringify({proposal:wireProposal()}),annotations:[]},
        {type:"output_text",text:JSON.stringify({proposal:wireProposal()}),annotations:[]}
      ]}
    ]})
  ];
  for(const body of cases){
    await assert.rejects(()=>make(body).invoke(adapterInput()),(e:any)=>e?.httpStatus===502);
  }
});

test("OpenAI adapter fails closed on transport policy, bounds, secret echo, and unsafe origin",async()=>{
  const phase2:any=await import("../src/index.ts");
  const base:any={
    manifest,apiKeySecretRef:"secret:openai",timeoutMs:1000,maxResponseBytes:16384,
    secretResolver:{async resolve(){return "sk-sensitive";}}
  };
  assert.throws(()=>new phase2.OpenAiResponsesModelAdapter({...base,origin:"http://api.openai.com",fetchFn:async()=>response(openAiResponse())}),/https/i);
  assert.throws(()=>new phase2.OpenAiResponsesModelAdapter({...base,origin:"https://127.0.0.1",fetchFn:async()=>response(openAiResponse())}),/unsafe|loopback/i);

  for(const fetchFn of [
    async()=>response("",302),
    async()=>response("{}",500),
    async()=>response("{}",200,"text/plain"),
    async()=>response("{",200),
    async()=>{throw new Error("offline");}
  ]){
    const adapter=new phase2.OpenAiResponsesModelAdapter({...base,fetchFn});
    await assert.rejects(()=>adapter.invoke(adapterInput()),(e:any)=>[413,415,502,504].includes(e?.httpStatus));
  }

  const leaked=new phase2.OpenAiResponsesModelAdapter({...base,fetchFn:async()=>response(openAiResponse(JSON.stringify({proposal:{secret:"sk-sensitive"}})))});
  await assert.rejects(()=>leaked.invoke(adapterInput()),(e:any)=>e?.httpStatus===502);

  const tiny=new phase2.OpenAiResponsesModelAdapter({...base,maxResponseBytes:32,fetchFn:async()=>response(openAiResponse())});
  await assert.rejects(()=>tiny.invoke(adapterInput()),(e:any)=>e?.httpStatus===413);
});

test("OpenAI adapter rejects outbound secret leakage before provider network I/O",async()=>{
  const phase2:any=await import("../src/index.ts");
  let calls=0;
  const adapter=new phase2.OpenAiResponsesModelAdapter({
    manifest,apiKeySecretRef:"secret:openai",timeoutMs:1000,maxResponseBytes:16384,
    secretResolver:{async resolve(){return "objective-secret";}},
    fetchFn:async()=>{calls++;return response(openAiResponse());}
  });
  await assert.rejects(()=>adapter.invoke(adapterInput({objective:"Do not expose objective-secret"})),/secret|request/i);
  assert.equal(calls,0);
});


test("OpenAI Responses adapter generates bounded advisory explanation JSON without tools or provider state",async()=>{
  const phase2:any=await import("../src/index.ts");
  const calls:any[]=[];
  const adapter=new phase2.OpenAiResponsesModelAdapter({
    manifest,apiKeySecretRef:"secret:openai",timeoutMs:1000,maxResponseBytes:16384,
    secretResolver:{async resolve(){return "openai-explain-secret";}},
    fetchFn:async(url:any,init:any)=>{
      calls.push({url:String(url),init});
      const text=JSON.stringify({
        summary:"The persisted proof approved the bounded decision.",
        keyFactors:["Evidence policy allowed the stored snapshot."],
        limitations:["Advisory only; it cannot change the signed certificate."]
      });
      return response(openAiResponse(text));
    }
  });
  const promptBody=JSON.stringify({schemaVersion:"axiom.explanation-proof.v1",authority:"ADVISORY_ONLY",execution:{id:"platform:cert",recordHash:H("7")}});
  const captured=await adapter.explain({capturedAt:"2026-10-07T20:50:00.000Z",promptBody,maxResponseBytes:4096});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"https://api.openai.com/v1/responses");
  const request=JSON.parse(captured.requestBody);
  assert.equal(request.model,manifest.modelId);
  assert.equal(request.store,false);
  assert.equal(request.input[0].content[0].text,promptBody);
  assert.equal(request.text.format.type,"json_schema");
  assert.equal(request.text.format.name,"axiom_advisory_explanation_v1");
  assert.equal(request.text.format.strict,true);
  assert.equal("tools" in request,false);
  assert.equal("conversation" in request,false);
  assert.equal("previous_response_id" in request,false);
  assert.equal(captured.requestBody.includes("openai-explain-secret"),false);
  assert.deepEqual(JSON.parse(captured.normalizedResponseBody),{
    keyFactors:["Evidence policy allowed the stored snapshot."],
    limitations:["Advisory only; it cannot change the signed certificate."],
    summary:"The persisted proof approved the bounded decision."
  });
});

test("OpenAI advisory explanation rejects malformed provider explanation content",async()=>{
  const phase2:any=await import("../src/index.ts");
  const make=(content:any)=>new phase2.OpenAiResponsesModelAdapter({
    manifest,apiKeySecretRef:"secret:openai",timeoutMs:1000,maxResponseBytes:16384,
    secretResolver:{async resolve(){return "explanation-secret-fixture-openai";}},
    fetchFn:async()=>response(openAiResponse(JSON.stringify(content)))
  });
  const promptBody='{"schemaVersion":"axiom.explanation-proof.v1"}';
  for(const content of [
    {summary:"ok",keyFactors:[],limitations:[],extra:true},
    {summary:"",keyFactors:[],limitations:[]},
    {summary:"ok",keyFactors:"bad",limitations:[]}
  ]){
    await assert.rejects(()=>make(content).explain({capturedAt:"2026-10-07T20:50:00.000Z",promptBody,maxResponseBytes:4096}),(e:any)=>e?.httpStatus===502);
  }
});


test("OpenAI adapter rejects a completed response attributed to a different model than the server-owned manifest",async()=>{
  const phase2:any=await import("../src/index.ts");
  const wrong=JSON.parse(openAiResponse());
  wrong.model="different-model";
  const adapter=new phase2.OpenAiResponsesModelAdapter({
    manifest,apiKeySecretRef:"secret:openai",timeoutMs:1000,maxResponseBytes:16384,
    secretResolver:{async resolve(){return "openai-model-identity-secret";}},
    fetchFn:async()=>response(JSON.stringify(wrong))
  });
  await assert.rejects(
    ()=>adapter.invoke(adapterInput()),
    (e:any)=>e?.httpStatus===502&&/model/i.test(e?.message??"")
  );
});
