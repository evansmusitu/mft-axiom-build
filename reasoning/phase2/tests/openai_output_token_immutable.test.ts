import test from "node:test";
import assert from "node:assert/strict";
import { OpenAiResponsesModelAdapter } from "../src/openai_model_adapter.ts";

// This exercises the real adapter and its outgoing wire envelope with a fake
// HTTPS response. It never resolves a provider credential or contacts a vendor.
test("OpenAI generation limit cannot be increased by post-construction JavaScript property mutation",async()=>{
  const outbound:unknown[]=[];
  const adapter=new OpenAiResponsesModelAdapter({
    manifest:{
      adapterId:"test:immutable-token-limit",version:"1.0.0",
      implementationHash:"a".repeat(64),provider:"openai",modelId:"synthetic-model"
    },
    apiKeySecretRef:"synthetic:secret",timeoutMs:1000,maxResponseBytes:16384,
    maxOutputTokens:256,
    secretResolver:{async resolve(){return "synthetic-only";}},
    fetchFn:async(_url:any,init:any)=>{
      outbound.push(JSON.parse(String(init.body)));
      const payload={
        id:"synthetic-response",status:"completed",error:null,model:"synthetic-model",
        output:[{type:"message",role:"assistant",content:[{type:"output_text",
          text:JSON.stringify({summary:"Synthetic only",keyFactors:[],limitations:[]})}]}]
      };
      return new Response(JSON.stringify(payload),{
        status:200,headers:{"content-type":"application/json"}
      });
    }
  });
  const externallyMutable=adapter as unknown as Record<string,unknown>;
  // A TS private readonly class field is normally writable at JavaScript
  // runtime. This should not change the trusted upstream token ceiling.
  try{externallyMutable.maxOutputTokens=1000000;}catch{}
  try{
    Object.defineProperty(adapter,"maxOutputTokens",{
      value:1000000,writable:true,configurable:true,enumerable:true
    });
  }catch{}
  const captured=await adapter.explain({
    capturedAt:"2026-11-08T00:00:00.000Z",
    promptBody:"{\\\"synthetic\\\":true}",maxResponseBytes:4096
  });
  assert.equal(outbound.length,1);
  const body=outbound[0] as {max_output_tokens:number;store:boolean};
  assert.equal(body.max_output_tokens,256,
    "Provider egress must keep the originally admitted generation bound");
  assert.equal(JSON.parse(captured.requestBody).max_output_tokens,256);
  assert.equal(body.store,false);
});
