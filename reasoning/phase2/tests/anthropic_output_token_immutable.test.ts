import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicMessagesModelAdapter } from "../src/anthropic_model_adapter.ts";

// Entirely fake HTTP and non-production credentials. No paid-provider call.
const manifest={
  adapterId:"test:anthropic-output-limit",version:"1.0.0",
  implementationHash:"b".repeat(64),provider:"anthropic",modelId:"synthetic-model"
};
const sample={
  id:"synthetic-msg",type:"message",role:"assistant",model:"synthetic-model",
  stop_reason:"end_turn",stop_sequence:null,
  content:[{type:"text",text:JSON.stringify({
    summary:"Synthetic only",keyFactors:[],limitations:[]
  })}],
  usage:{input_tokens:1,output_tokens:2}
};
function config(limit:unknown,fetchFn:unknown=async()=>new Response(JSON.stringify(sample),{
  status:200,headers:{"content-type":"application/json"}
})){
  return {
    manifest,apiKeySecretRef:"synthetic:secret",anthropicVersion:"2023-06-01",
    maxTokens:limit,timeoutMs:1000,maxResponseBytes:16384,
    secretResolver:{async resolve(){return "synthetic-only";}},fetchFn
  };
}

test("Anthropic Messages adapter refuses oversized or non-safe token limits before egress",()=>{
  let calls=0;
  const noNetwork=async()=>{calls++;throw new Error("unexpected provider request");};
  for(const invalid of [0,-1,16.5,1000000,Number.MAX_SAFE_INTEGER,"2048",null,undefined]){
    assert.throws(
      ()=>new AnthropicMessagesModelAdapter(config(invalid,noNetwork) as any),
      /maxTokens|safe integer|bounded|token.*limit/i
    );
  }
  assert.equal(calls,0);
});

test("Anthropic generation limit remains originally admitted after JS property mutation",async()=>{
  const requests:any[]=[];
  const adapter=new AnthropicMessagesModelAdapter(config(256,async(_url:any,init:any)=>{
    requests.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify(sample),{status:200,
      headers:{"content-type":"application/json"}});
  }) as any);
  const mutable=adapter as unknown as Record<string,unknown>;
  try{mutable.maxTokens=1000000;}catch{}
  try{Object.defineProperty(adapter,"maxTokens",{value:1000000,writable:true,configurable:true});}catch{}
  const capture=await adapter.explain({
    capturedAt:"2026-11-08T00:00:00.000Z",
    promptBody:"synthetic explanation only",maxResponseBytes:4096
  });
  assert.equal(requests.length,1);
  assert.equal(requests[0].max_tokens,256,
    "Paid-provider output token limit must not be mutable after admission");
  assert.equal(JSON.parse(capture.requestBody).max_tokens,256);
  assert.equal(JSON.parse(capture.normalizedResponseBody).summary,"Synthetic only");
});
