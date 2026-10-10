import test from "node:test";
import assert from "node:assert/strict";
import { hashJson } from "../../phase1/src/canonical.ts";

const H=(c:string)=>c.repeat(64);
const manifest={
  adapterId:"model:anthropic",version:"1.0.0",implementationHash:H("a"),
  provider:"anthropic",modelId:"claude-opus-5"
};
const profile={
  profileId:"profile:anthropic",version:"1.0.0",adapterId:manifest.adapterId,
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
    tenant:{tenantId:"tenant:anthropic"},profile,
    profileHash:hashJson({...profile,allowedOperationIds:[...profile.allowedOperationIds].sort()}),
    compilationRequestHash:H("d"),attempt:0,mode:"INITIAL",
    objective:"Approve only when observed risk is within the configured maximum",
    inputContracts:contracts,operationRegistryManifest:operations,remainingRepairAttempts:2,
    capturedAt:"2026-10-07T20:40:00.000Z",...overrides
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
    constraints:[],decisionNodeId:"decision"
  };
}
function normalizedProposal(){
  return {proposal:{
    assumptions:[],
    nodes:[{
      id:"decision",kind:"Decision",operation:"comparison.lte",
      inputs:{left:{input:"observed"},right:{input:"maximum"}},params:{}
    }],
    constraints:[],decisionNodeId:"decision"
  }};
}
function anthropicResponse(text=JSON.stringify({proposal:wireProposal()}),contentExtra:any[]=[]){
  return JSON.stringify({
    id:"msg_fixture",type:"message",role:"assistant",model:manifest.modelId,
    stop_reason:"end_turn",stop_sequence:null,
    content:[{type:"text",text},...contentExtra],
    usage:{input_tokens:10,output_tokens:20}
  });
}
function response(body:string,status=200,type="application/json"){
  return new Response(body,{status,headers:{"content-type":type}});
}

test("Anthropic Messages adapter uses fixed capability surface and normalizes one structured proposal",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.AnthropicMessagesModelAdapter,"function");
  const calls:any[]=[];let resolves=0;
  const adapter=new phase2.AnthropicMessagesModelAdapter({
    manifest,apiKeySecretRef:"secret:anthropic",anthropicVersion:"2023-06-01",
    maxTokens:2048,timeoutMs:1000,maxResponseBytes:16384,
    secretResolver:{async resolve(ref:string){resolves++;assert.equal(ref,"secret:anthropic");return "sk-ant-super-secret";}},
    fetchFn:async(url:any,init:any)=>{calls.push({url:String(url),init});return response(anthropicResponse());}
  });
  const captured=await adapter.invoke(adapterInput());
  assert.equal(resolves,1);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].init.method,"POST");
  assert.equal(calls[0].init.redirect,"manual");
  assert.equal(calls[0].init.headers["x-api-key"],"sk-ant-super-secret");
  assert.equal(calls[0].init.headers["anthropic-version"],"2023-06-01");
  assert.equal(calls[0].init.headers["anthropic-beta"],undefined);
  const request=JSON.parse(captured.requestBody);
  assert.equal(request.model,manifest.modelId);
  assert.equal(request.max_tokens,2048);
  assert.equal(request.messages.length,1);
  assert.equal(request.messages[0].role,"user");
  const gateway=JSON.parse(request.messages[0].content);
  assert.equal(gateway.schemaVersion,"axiom.model-proposal.v1");
  assert.equal(gateway.objective,adapterInput().objective);
  assert.equal(gateway.tenantId,undefined);
  assert.equal(request.output_config.format.type,"json_schema");
  assert.equal(typeof request.output_config.format.schema,"object");
  for(const forbidden of ["tools","mcp_servers","container","memory","metadata"]){
    assert.equal(forbidden in request,false);
  }
  assert.equal(captured.requestBody.includes("sk-ant-super-secret"),false);
  assert.equal(captured.responseBody,anthropicResponse());
  assert.deepEqual(JSON.parse(captured.normalizedResponseBody),normalizedProposal());
});

test("Anthropic repair request carries only canonical AXIOM repair state and no provider memory",async()=>{
  const phase2:any=await import("../src/index.ts");
  let sent:any;
  const adapter=new phase2.AnthropicMessagesModelAdapter({
    manifest,apiKeySecretRef:"secret:anthropic",anthropicVersion:"2023-06-01",
    maxTokens:2048,timeoutMs:1000,maxResponseBytes:16384,
    secretResolver:{async resolve(){return "key";}},
    fetchFn:async(_url:any,init:any)=>{sent=JSON.parse(String(init.body));return response(anthropicResponse());}
  });
  const previousResponseBody=JSON.stringify(normalizedProposal());
  await adapter.invoke(adapterInput({
    attempt:1,mode:"REPAIR",remainingRepairAttempts:1,previousResponseBody,
    issues:[{code:"MODEL_PROPOSAL_SCHEMA",message:"bad proposal"}]
  }));
  const gateway=JSON.parse(sent.messages[0].content);
  assert.equal(gateway.repair.previousResponseBody,previousResponseBody);
  assert.equal(gateway.repair.remainingRepairAttempts,1);
  assert.equal("tools" in sent,false);
  assert.equal("mcp_servers" in sent,false);
  assert.equal("container" in sent,false);
});

test("Anthropic adapter rejects truncation ambiguity and malformed content instead of guessing",async()=>{
  const phase2:any=await import("../src/index.ts");
  const make=(body:string)=>new phase2.AnthropicMessagesModelAdapter({
    manifest,apiKeySecretRef:"secret:anthropic",anthropicVersion:"2023-06-01",
    maxTokens:2048,timeoutMs:1000,maxResponseBytes:16384,
    secretResolver:{async resolve(){return "key";}},fetchFn:async()=>response(body)
  });
  const cases=[
    JSON.stringify({id:"m",type:"message",role:"assistant",model:manifest.modelId,stop_reason:"max_tokens",content:[{type:"text",text:JSON.stringify({proposal:wireProposal()})}]}),
    JSON.stringify({id:"m",type:"message",role:"assistant",model:manifest.modelId,stop_reason:"end_turn",content:[]}),
    anthropicResponse("not-json"),
    anthropicResponse(JSON.stringify({proposal:wireProposal(),extra:true})),
    anthropicResponse(JSON.stringify({proposal:"bad"})),
    anthropicResponse(JSON.stringify({proposal:wireProposal()}),[{type:"text",text:JSON.stringify({proposal:wireProposal()})}]),
    anthropicResponse(JSON.stringify({proposal:wireProposal()}),[{type:"tool_use",id:"tool",name:"forbidden",input:{}}])
  ];
  for(const body of cases)await assert.rejects(()=>make(body).invoke(adapterInput()),(e:any)=>e?.httpStatus===502);
});

test("Anthropic adapter fails closed on transport policy bounds secret echo unsafe origin and invalid server config",async()=>{
  const phase2:any=await import("../src/index.ts");
  const base:any={
    manifest,apiKeySecretRef:"secret:anthropic",anthropicVersion:"2023-06-01",maxTokens:2048,
    timeoutMs:1000,maxResponseBytes:16384,secretResolver:{async resolve(){return "anthropic-sensitive";}}
  };
  assert.throws(()=>new phase2.AnthropicMessagesModelAdapter({...base,origin:"http://api.anthropic.com",fetchFn:async()=>response(anthropicResponse())}),/https/i);
  assert.throws(()=>new phase2.AnthropicMessagesModelAdapter({...base,maxTokens:0,fetchFn:async()=>response(anthropicResponse())}),/maxTokens/i);
  assert.throws(()=>new phase2.AnthropicMessagesModelAdapter({...base,anthropicVersion:"",fetchFn:async()=>response(anthropicResponse())}),/anthropicVersion/i);

  for(const fetchFn of [
    async()=>response("",302),
    async()=>response("{}",500),
    async()=>response("{}",200,"text/plain"),
    async()=>response("{",200),
    async()=>{throw new Error("offline");}
  ]){
    const adapter=new phase2.AnthropicMessagesModelAdapter({...base,fetchFn});
    await assert.rejects(()=>adapter.invoke(adapterInput()),(e:any)=>[413,415,502,504].includes(e?.httpStatus));
  }
  const leaked=new phase2.AnthropicMessagesModelAdapter({...base,fetchFn:async()=>response(anthropicResponse(JSON.stringify({proposal:{secret:"anthropic-sensitive"}})))});
  await assert.rejects(()=>leaked.invoke(adapterInput()),(e:any)=>e?.httpStatus===502);
  const tiny=new phase2.AnthropicMessagesModelAdapter({...base,maxResponseBytes:32,fetchFn:async()=>response(anthropicResponse())});
  await assert.rejects(()=>tiny.invoke(adapterInput()),(e:any)=>e?.httpStatus===413);
});

test("Anthropic adapter rejects outbound secret leakage before provider network I/O",async()=>{
  const phase2:any=await import("../src/index.ts");
  let calls=0;
  const adapter=new phase2.AnthropicMessagesModelAdapter({
    manifest,apiKeySecretRef:"secret:anthropic",anthropicVersion:"2023-06-01",maxTokens:2048,
    timeoutMs:1000,maxResponseBytes:16384,
    secretResolver:{async resolve(){return "objective-secret";}},
    fetchFn:async()=>{calls++;return response(anthropicResponse());}
  });
  await assert.rejects(()=>adapter.invoke(adapterInput({objective:"Do not expose objective-secret"})),/secret|request/i);
  assert.equal(calls,0);
});


test("Anthropic Messages adapter generates bounded advisory explanation JSON without tools or memory",async()=>{
  const phase2:any=await import("../src/index.ts");
  const calls:any[]=[];
  const adapter=new phase2.AnthropicMessagesModelAdapter({
    manifest,apiKeySecretRef:"secret:anthropic",anthropicVersion:"2023-06-01",maxTokens:2048,
    timeoutMs:1000,maxResponseBytes:16384,
    secretResolver:{async resolve(){return "anthropic-explain-secret";}},
    fetchFn:async(url:any,init:any)=>{
      calls.push({url:String(url),init});
      const text=JSON.stringify({
        summary:"The stored execution replayed exactly.",
        keyFactors:["The certificate and snapshot commitments matched."],
        limitations:["Advisory only."]
      });
      return response(anthropicResponse(text));
    }
  });
  const promptBody=JSON.stringify({schemaVersion:"axiom.explanation-proof.v1",authority:"ADVISORY_ONLY",execution:{id:"platform:cert",recordHash:H("7")}});
  const captured=await adapter.explain({capturedAt:"2026-10-07T20:50:00.000Z",promptBody,maxResponseBytes:4096});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"https://api.anthropic.com/v1/messages");
  const request=JSON.parse(captured.requestBody);
  assert.equal(request.model,manifest.modelId);
  assert.equal(request.messages[0].content,promptBody);
  assert.equal(request.output_config.format.type,"json_schema");
  for(const forbidden of ["tools","mcp_servers","container","memory"])assert.equal(forbidden in request,false);
  assert.equal(captured.requestBody.includes("anthropic-explain-secret"),false);
  assert.deepEqual(JSON.parse(captured.normalizedResponseBody),{
    keyFactors:["The certificate and snapshot commitments matched."],
    limitations:["Advisory only."],
    summary:"The stored execution replayed exactly."
  });
});

test("Anthropic advisory explanation rejects malformed provider explanation content",async()=>{
  const phase2:any=await import("../src/index.ts");
  const make=(content:any)=>new phase2.AnthropicMessagesModelAdapter({
    manifest,apiKeySecretRef:"secret:anthropic",anthropicVersion:"2023-06-01",maxTokens:2048,
    timeoutMs:1000,maxResponseBytes:16384,
    secretResolver:{async resolve(){return "explanation-secret-fixture-anthropic";}},
    fetchFn:async()=>response(anthropicResponse(JSON.stringify(content)))
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
