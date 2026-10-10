import test from "node:test";
import assert from "node:assert/strict";

const H=(c:string)=>c.repeat(64);
function operation(overrides:any={}){
  return {
    operationId:"latest",parameterSchemaHash:H("a"),responseMediaTypes:["application/json"],
    maxResponseBytes:64,timeoutMs:1000,mappingIds:["map:v1"],...overrides
  };
}

test("HTTP JSON evidence adapter uses only server-owned origin, path, headers, and secrets",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.HttpJsonEvidenceAdapter,"function");
  let seen:any;
  const secret="Bearer server-secret";
  const adapter=new phase2.HttpJsonEvidenceAdapter({
    adapterId:"http-json:market",version:"1.0.0",implementationHash:H("b"),
    operations:[{
      manifest:operation(),origin:"https://market.example",method:"GET",
      pathTemplate:"/v1/prices/{symbol}",fixedHeaders:{"x-fixed":"fixed"},
      secretHeaders:{authorization:"secret:market"},allowedStatus:[200],validateParameters:()=>{}
    }],
    secretResolver:new phase2.StaticSecretResolver({"secret:market":secret}),
    fetchFn:async(url:any,init:any)=>{
      seen={url:String(url),init};
      return new Response('{"price":2400}',{status:200,headers:{"content-type":"application/json"}});
    }
  });
  const captured=await adapter.acquire({
    tenant:{tenantId:"tenant:a"},operation:operation(),
    parameters:{symbol:"XAU/USD"}
  });
  assert.equal(seen.url,"https://market.example/v1/prices/XAU%2FUSD");
  assert.equal(seen.init.redirect,"manual");
  assert.equal(seen.init.headers.authorization,secret);
  assert.equal(seen.init.headers["x-fixed"],"fixed");
  assert.equal(seen.url.includes("evil.example"),false);
  assert.deepEqual(captured,{status:200,mediaType:"application/json",bodyEncoding:"utf8",body:'{"price":2400}'});
  assert.equal(JSON.stringify(captured).includes(secret),false);
});

test("HTTP JSON evidence adapter rejects unsafe configured origins",async()=>{
  const phase2:any=await import("../src/index.ts");
  for(const origin of [
    "http://market.example","https://127.0.0.1","https://169.254.169.254",
    "https://0.0.0.0","https://224.0.0.1","https://[::1]","https://metadata.google.internal"
  ]){
    assert.throws(()=>new phase2.HttpJsonEvidenceAdapter({
      adapterId:"http-json:unsafe",version:"1.0.0",implementationHash:H("b"),
      operations:[{manifest:operation(),origin,method:"GET",pathTemplate:"/v1",allowedStatus:[200],validateParameters:()=>{}}],
      secretResolver:new phase2.StaticSecretResolver({}),
      fetchFn:async()=>new Response("{}",{status:200,headers:{"content-type":"application/json"}})
    }),/https|origin|loopback|link-local|metadata|multicast|unsafe/i);
  }
});

test("HTTP JSON evidence adapter fails closed on redirects, media type, malformed JSON, and streaming overflow",async()=>{
  const phase2:any=await import("../src/index.ts");
  const build=(fetchFn:any,maxResponseBytes=64)=>new phase2.HttpJsonEvidenceAdapter({
    adapterId:"http-json:test",version:"1.0.0",implementationHash:H("b"),
    operations:[{manifest:operation({maxResponseBytes}),origin:"https://market.example",method:"GET",pathTemplate:"/v1",allowedStatus:[200],validateParameters:()=>{}}],
    secretResolver:new phase2.StaticSecretResolver({}),fetchFn
  });
  const input={tenant:{tenantId:"tenant:a"},operation:operation(),parameters:{}};

  await assert.rejects(()=>build(async()=>new Response("",{status:302,headers:{location:"https://evil.example"}})).acquire(input),/redirect|status/i);
  await assert.rejects(()=>build(async()=>new Response("ok",{status:200,headers:{"content-type":"text/plain"}})).acquire(input),/media|content.*type/i);
  await assert.rejects(()=>build(async()=>new Response("{",{status:200,headers:{"content-type":"application/json"}})).acquire(input),/json/i);

  let pulls=0;
  const stream=new ReadableStream({
    pull(controller){
      pulls++;
      controller.enqueue(new TextEncoder().encode("x".repeat(40)));
      if(pulls>=100)controller.close();
    }
  });
  await assert.rejects(()=>build(async()=>new Response(stream,{status:200,headers:{"content-type":"application/json"}}),50).acquire({
    ...input,operation:operation({maxResponseBytes:50})
  }),/size|large|bytes/i);
  assert.ok(pulls<10,"adapter must cancel a long upstream stream promptly after the configured byte limit is exceeded");
});

test("HTTP JSON evidence adapter rejects captured responses that echo resolved secret material",async()=>{
  const phase2:any=await import("../src/index.ts");
  const secret="server-secret-value";
  const adapter=new phase2.HttpJsonEvidenceAdapter({
    adapterId:"http-json:secret",version:"1.0.0",implementationHash:H("b"),
    operations:[{manifest:operation(),origin:"https://market.example",method:"GET",pathTemplate:"/v1",secretHeaders:{"x-api-key":"ref"},allowedStatus:[200],validateParameters:()=>{}}],
    secretResolver:new phase2.StaticSecretResolver({ref:secret}),
    fetchFn:async()=>new Response(JSON.stringify({echo:secret}),{status:200,headers:{"content-type":"application/json"}})
  });
  await assert.rejects(()=>adapter.acquire({tenant:{tenantId:"tenant:a"},operation:operation(),parameters:{}}),/secret|credential/i);
});


test("HTTP JSON evidence adapter rejects non-schema parameters before secret resolution or network access",async()=>{
  const phase2:any=await import("../src/index.ts");
  let secretCalls=0,fetchCalls=0;
  const adapter=new phase2.HttpJsonEvidenceAdapter({
    adapterId:"http-json:validated",version:"1.0.0",implementationHash:H("b"),
    operations:[{
      manifest:operation(),origin:"https://market.example",method:"GET",pathTemplate:"/v1/prices/{symbol}",
      secretHeaders:{authorization:"secret:market"},allowedStatus:[200],
      validateParameters:(parameters:any)=>{
        const keys=Object.keys(parameters).sort();
        if(keys.length!==1||keys[0]!=="symbol"||typeof parameters.symbol!=="string")throw new TypeError("parameter schema rejected request");
      }
    }],
    secretResolver:{async resolve(){secretCalls++;return "server-secret";}},
    fetchFn:async()=>{fetchCalls++;return new Response("{}",{status:200,headers:{"content-type":"application/json"}});}
  });
  await assert.rejects(()=>adapter.acquire({
    tenant:{tenantId:"tenant:a"},operation:operation(),
    parameters:{symbol:"XAUUSD",origin:"https://evil.example"}
  }),/parameter schema/i);
  assert.equal(secretCalls,0);
  assert.equal(fetchCalls,0);
});
