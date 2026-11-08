import test from "node:test";
import assert from "node:assert/strict";
import * as axiom from "../src/index.ts";

// Entirely deterministic fake HTTPS transport: NO API keys, bills, or outbound calls.
const model={
  adapterId:"test:openai-output-cap",version:"1.0.0",
  implementationHash:"a".repeat(64),provider:"openai",modelId:"synthetic-model"
};
const explanation=JSON.stringify({summary:"Synthetic only",keyFactors:[],limitations:[]});
const response=JSON.stringify({
  id:"synthetic-response",status:"completed",error:null,model:model.modelId,
  output:[{type:"message",role:"assistant",content:[{type:"output_text",text:explanation}]}]
});
const fakeFetch=async (_url:unknown,_init:unknown)=>
  new Response(response,{status:200,headers:{"content-type":"application/json"}});
function config(limit?:unknown,fetchFn:unknown=fakeFetch){
  return {manifest:model,apiKeySecretRef:"test:no-network",timeoutMs:1000,
    maxResponseBytes:16384,secretResolver:{async resolve(){return "synthetic-never-sent";}},
    ...(limit===undefined?{}:{maxOutputTokens:limit}),fetchFn};
}

test("OpenAI Responses adapter refuses absent or unsafe generated-token cap before network I/O",()=>{
  let calls=0;
  const noNetwork=async()=>{calls++;throw new Error("network must not run");};
  for(const invalid of [undefined,null,0,-1,15,256.5,Number.MAX_SAFE_INTEGER+1,"256"]){
    assert.throws(()=>new axiom.OpenAiResponsesModelAdapter(config(invalid,noNetwork) as any),
      /maxOutputTokens|output.tokens|token.limit|bounded/i,
      "Invalid or missing upstream token bound must fail at constructor");
  }
  assert.equal(calls,0);
});

test("OpenAI explanation sends exact provider-generated token ceiling independent of response byte cap",async()=>{
  const outbound:any[]=[];
  const adapter=new axiom.OpenAiResponsesModelAdapter(config(256,async (_url:any,init:any)=>{
    outbound.push(JSON.parse(String(init.body)));
    return fakeFetch(_url,init);
  }) as any);
  const captured=await adapter.explain({
    capturedAt:"2026-11-08T00:00:00.000Z",
    promptBody:'{"proof":"synthetic"}',maxResponseBytes:4096
  });
  assert.equal(outbound.length,1);
  assert.equal(outbound[0].max_output_tokens,256);
  assert.equal(outbound[0].store,false);
  assert.equal("tools" in outbound[0],false);
  assert.equal(JSON.parse(captured.requestBody).max_output_tokens,256);
  assert.equal(JSON.parse(captured.normalizedResponseBody).summary,"Synthetic only");
});
