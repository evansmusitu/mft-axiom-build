import test from "node:test";
import assert from "node:assert/strict";
import { BoundedModelProviderTransport } from "../src/model_provider_transport.ts";
import { OpenAiResponsesModelAdapter } from "../src/openai_model_adapter.ts";
import { AnthropicMessagesModelAdapter } from "../src/anthropic_model_adapter.ts";

// All egress below is a local, synthetic fetch callback. No real credentials
// or billable provider traffic are used.
const baseManifest={
  adapterId:"test:transport-integrity",version:"1.0.0",
  implementationHash:"c".repeat(64),modelId:"synthetic-model"
};
const explanation={summary:"Synthetic only",keyFactors:[],limitations:[]};
const openAiResponse={
  id:"synthetic-response",status:"completed",error:null,model:"synthetic-model",
  output:[{type:"message",role:"assistant",content:[{
    type:"output_text",text:JSON.stringify(explanation)
  }]}]
};
const anthropicResponse={
  id:"synthetic-message",type:"message",role:"assistant",
  model:"synthetic-model",stop_reason:"end_turn",stop_sequence:null,
  content:[{type:"text",text:JSON.stringify(explanation)}],
  usage:{input_tokens:1,output_tokens:2}
};
function okJson(value:unknown):Response{
  return new Response(JSON.stringify(value),{
    status:200,headers:{"content-type":"application/json"}
  });
}

test("bounded transport does not let post-admission JS mutation redirect a secret-bearing request",async()=>{
  const destinations:string[]=[];
  const resolvedRefs:string[]=[];
  const transmittedHeaders:Record<string,string>[]=[];
  const transport=new BoundedModelProviderTransport({
    origin:"https://api.openai.com",path:"/v1/responses",
    timeoutMs:1000,maxResponseBytes:4096,allowedStatus:[200],
    fixedHeaders:{"x-axiom-contract":"pinned"},
    secretHeaders:{authorization:{secretRef:"synthetic:pinned",prefix:"Bearer "}},
    secretResolver:{async resolve(ref:string){resolvedRefs.push(ref);return "synthetic-only";}},
    fetchFn:async(url:any,init:any)=>{
      destinations.push(String(url));
      transmittedHeaders.push(init.headers as Record<string,string>);
      return okJson({synthetic:true});
    }
  });
  // Ordinary TypeScript private fields are writable at runtime. Even a URL
  // reference held inside a frozen object must not allow a domain change.
  const mutable=transport as unknown as Record<string,any>;
  try{if(mutable.origin instanceof URL)mutable.origin.hostname="untrusted.invalid";}catch{}
  try{mutable.origin=new URL("https://untrusted.invalid");}catch{}
  try{mutable.path="/collect";}catch{}
  try{mutable.allowedStatus=[200,401];}catch{}
  try{mutable.maxResponseBytes=100000000;}catch{}
  try{mutable.headers["x-axiom-contract"]="tampered";}catch{}
  try{mutable.secretHeaderConfig.authorization.secretRef="synthetic:other";}catch{}
  await transport.postJson(JSON.stringify({synthetic:true}));
  assert.deepEqual(destinations,["https://api.openai.com/v1/responses"]);
  assert.deepEqual(resolvedRefs,["synthetic:pinned"]);
  assert.equal(transmittedHeaders[0]["x-axiom-contract"],"pinned");
  assert.equal(transmittedHeaders[0].authorization,"Bearer synthetic-only");
});

test("OpenAI adapter cannot replace the registered HTTPS transport by JS property assignment",async()=>{
  let actualCalls=0,forgedCalls=0;
  const adapter=new OpenAiResponsesModelAdapter({
    manifest:{...baseManifest,provider:"openai"},
    apiKeySecretRef:"synthetic:pinned",timeoutMs:1000,
    maxResponseBytes:16384,maxOutputTokens:256,
    secretResolver:{async resolve(){return "synthetic-only";}},
    fetchFn:async()=>{actualCalls++;return okJson(openAiResponse);}
  });
  const mutable=adapter as unknown as Record<string,any>;
  try{mutable.transport={async postJson(){forgedCalls++;return JSON.stringify(openAiResponse);}};}catch{}
  await adapter.explain({
    capturedAt:"2026-11-09T00:00:00.000Z",
    promptBody:"Synthetic only",maxResponseBytes:4096
  });
  assert.equal(actualCalls,1,"The originally admitted HTTPS transport must run");
  assert.equal(forgedCalls,0,"A replacement transport must not bypass the provider boundary");
});

test("Anthropic adapter cannot replace the registered HTTPS transport by JS property assignment",async()=>{
  let actualCalls=0,forgedCalls=0;
  const adapter=new AnthropicMessagesModelAdapter({
    manifest:{...baseManifest,provider:"anthropic"},
    apiKeySecretRef:"synthetic:pinned",anthropicVersion:"2023-06-01",
    timeoutMs:1000,maxResponseBytes:16384,maxTokens:256,
    secretResolver:{async resolve(){return "synthetic-only";}},
    fetchFn:async()=>{actualCalls++;return okJson(anthropicResponse);}
  });
  const mutable=adapter as unknown as Record<string,any>;
  try{mutable.transport={async postJson(){forgedCalls++;return JSON.stringify(anthropicResponse);}};}catch{}
  await adapter.explain({
    capturedAt:"2026-11-09T00:00:00.000Z",
    promptBody:"Synthetic only",maxResponseBytes:4096
  });
  assert.equal(actualCalls,1,"The originally admitted HTTPS transport must run");
  assert.equal(forgedCalls,0,"A replacement transport must not bypass the provider boundary");
});
