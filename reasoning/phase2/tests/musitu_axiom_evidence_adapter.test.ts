import test from "node:test";
import assert from "node:assert/strict";

const H=(c:string)=>c.repeat(64);
function op(id="finance.npv"){return {
  operationId:id,parameterSchemaHash:H("a"),responseMediaTypes:["application/json"],
  maxResponseBytes:1024,timeoutMs:1000,mappingIds:["map:v1"]
};}

test("MUSITU Axiom evidence adapter calls only its fixed compute service and allowlisted operation",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.MusituAxiomEvidenceAdapter,"function");
  let seen:any;
  const adapter=new phase2.MusituAxiomEvidenceAdapter({
    adapterId:"musitu-axiom",version:"1.0.0",implementationHash:H("b"),
    computeBase:"https://axiom.internal.example",
    operations:[op("finance.npv")],parameterValidators:{"finance.npv":()=>{}},
    authSecretRef:"axiom-token",
    secretResolver:new phase2.StaticSecretResolver({"axiom-token":"Bearer internal-token"}),
    fetchFn:async(url:any,init:any)=>{
      seen={url:String(url),init};
      return new Response('{"result":123}',{status:200,headers:{"content-type":"application/json"}});
    }
  });
  const captured=await adapter.acquire({
    tenant:{tenantId:"tenant:a"},operation:op("finance.npv"),
    parameters:{rate:0.1}
  });
  assert.equal(seen.url,"https://axiom.internal.example/v1/compute");
  assert.equal(seen.init.method,"POST");
  assert.equal(seen.init.headers.authorization,"Bearer internal-token");
  assert.deepEqual(JSON.parse(seen.init.body),{operation:"finance.npv",args:{rate:0.1}});
  assert.equal(JSON.stringify(captured).includes("internal-token"),false);
  assert.equal(captured.status,200);
});

test("MUSITU Axiom evidence adapter rejects side-effect operations even if configured",async()=>{
  const phase2:any=await import("../src/index.ts");
  for(const id of [
    "trade.execute","order.submit","payment.checkout","wallet.transfer",
    "fund.withdraw","message.send","portfolio.liquidate","access.revoke"
  ]){
    assert.throws(()=>new phase2.MusituAxiomEvidenceAdapter({
      adapterId:"musitu-axiom",version:"1.0.0",implementationHash:H("b"),
      computeBase:"https://axiom.internal.example",operations:[op(id)],
      parameterValidators:{[id]:()=>{}},
      secretResolver:new phase2.StaticSecretResolver({}),fetchFn:async()=>new Response("{}")
    }),/side-effect|operation|read|compute/i);
  }
});

test("MUSITU Axiom evidence adapter rejects unregistered operation input before network access",async()=>{
  const phase2:any=await import("../src/index.ts");
  let calls=0;
  const adapter=new phase2.MusituAxiomEvidenceAdapter({
    adapterId:"musitu-axiom",version:"1.0.0",implementationHash:H("b"),
    computeBase:"https://axiom.internal.example",operations:[op("finance.npv")],parameterValidators:{"finance.npv":()=>{}},
    secretResolver:new phase2.StaticSecretResolver({}),
    fetchFn:async()=>{calls++;return new Response("{}",{status:200,headers:{"content-type":"application/json"}});}
  });
  await assert.rejects(()=>adapter.acquire({
    tenant:{tenantId:"tenant:a"},operation:op("finance.black_scholes"),parameters:{}
  }),/allow|unknown|operation/i);
  assert.equal(calls,0);
});


test("MUSITU Axiom evidence adapter validates operation parameters before secret or network access",async()=>{
  const phase2:any=await import("../src/index.ts");
  let secretCalls=0,fetchCalls=0;
  const adapter=new phase2.MusituAxiomEvidenceAdapter({
    adapterId:"musitu-axiom",version:"1.0.0",implementationHash:H("b"),
    computeBase:"https://axiom.internal.example",operations:[op("finance.npv")],
    parameterValidators:{"finance.npv":(parameters:any)=>{
      const keys=Object.keys(parameters);
      if(keys.length!==1||keys[0]!=="rate"||typeof parameters.rate!=="number")throw new TypeError("parameter schema rejected request");
    }},
    authSecretRef:"axiom-token",
    secretResolver:{async resolve(){secretCalls++;return "Bearer internal-token";}},
    fetchFn:async()=>{fetchCalls++;return new Response("{}",{status:200,headers:{"content-type":"application/json"}});}
  });
  await assert.rejects(()=>adapter.acquire({
    tenant:{tenantId:"tenant:a"},operation:op("finance.npv"),
    parameters:{rate:0.1,operation:"trade.execute"}
  }),/parameter schema/i);
  assert.equal(secretCalls,0);
  assert.equal(fetchCalls,0);
});
