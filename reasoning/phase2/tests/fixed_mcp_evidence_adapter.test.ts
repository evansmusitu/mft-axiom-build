import test from "node:test";
import assert from "node:assert/strict";
import {createSigner} from "../../phase1/src/index.ts";
import {FixedMcpEvidenceAdapter} from "../src/fixed_mcp_evidence_adapter.ts";
const H=(x:string)=>x.repeat(64),A={tenantId:"tenant:mcp-a"},B={tenantId:"tenant:mcp-b"};
const op={operationId:"market.read",parameterSchemaHash:H("a"),
 responseMediaTypes:["application/json"],maxResponseBytes:512,timeoutMs:1000,mappingIds:["map:mcp"]};
const secret="server-only-credential";
function harness(customFetch?:any,changes:any={}){
 const calls:any[]=[];let secretReads=0;
 const fetchFn=customFetch??(async (url:any,init:any)=>{
  calls.push({url:String(url),init});
  const sent=JSON.parse(init.body);
  return new Response(JSON.stringify({jsonrpc:"2.0",id:sent.id,result:{isError:false,
   content:[{type:"text",text:'{"price":2400}'}]}}),{status:200,headers:{"content-type":"application/json"}});
 });
 const adapter=new FixedMcpEvidenceAdapter({adapterId:"adapter:mcp",version:"1.0.0",
  implementationHash:H("b"),fetchFn,secretResolver:{async resolve(ref:string){secretReads++;assert.equal(ref,"ref:mcp");return secret;}},
  operations:[{manifest:op,origin:"https://read-data.example",toolName:"market.read",
   parameterName:"symbol",tenantIds:[A.tenantId],secretRef:"ref:mcp",...changes}]});
 return {adapter,calls,get secrets(){return secretReads;},input:(parameters:any={symbol:"XAUUSD"},tenant=A)=>({tenant,operation:op,parameters})};
}
test("exact pinned MCP tools/call produces one untrusted JSON evidence capture",async()=>{
 const f=harness(),result=await f.adapter.acquire(f.input());
 assert.deepEqual(result,{status:200,mediaType:"application/json",bodyEncoding:"utf8",body:'{"price":2400}'});
 assert.equal(f.adapter.manifest.capability,"READ");
 assert.equal(f.calls.length,1);
 const call=f.calls[0],payload=JSON.parse(call.init.body);
 assert.equal(call.url,"https://read-data.example/mcp");
 assert.equal(call.init.method,"POST");
 assert.equal(call.init.redirect,"manual");
 assert.equal(call.init.headers.authorization,secret);
 assert.equal(call.init.headers["content-type"],"application/json");
 assert.deepEqual(Object.keys(payload).sort(),["id","jsonrpc","method","params"]);
 assert.equal(payload.jsonrpc,"2.0");
 assert.equal(payload.method,"tools/call");
 assert.deepEqual(payload.params,{name:"market.read",arguments:{symbol:"XAUUSD"}});
 assert.match(payload.id,/^axiom-mcp:[0-9a-f]{64}$/);
 assert.equal(JSON.stringify(result).includes(secret),false);
 assert.equal(f.secrets,1);
});
test("tenant and parameter authority cannot be injected before credentials or network",async()=>{
 const f=harness();
 for(const params of [
  {symbol:"XAUUSD",toolName:"admin.delete"},{symbol:"XAUUSD",method:"tools/list"},
  {symbol:"XAUUSD",tenantId:B.tenantId},{symbol:"XAUUSD",url:"https://attacker.example"},
  {symbol:"XAUUSD",authorization:"other"},{symbol:"XAUUSD",limit:1000},{},
  {symbol:"x".repeat(257)}
 ])await assert.rejects(()=>f.adapter.acquire(f.input(params)),/parameter|invalid|unexpected/i);
 await assert.rejects(()=>f.adapter.acquire(f.input({symbol:"XAUUSD"},B)),/tenant|forbidden/i);
 await assert.rejects(()=>f.adapter.acquire({...f.input(),operation:{...op,timeoutMs:99999}}),/operation|manifest/i);
 assert.equal(f.secrets,0);assert.equal(f.calls.length,0);
});
test("operator cannot register action-like or unsafe MCP tools or remote origins",()=>{
 for(const change of [
  {toolName:"trading.place_order"},{toolName:"payments.transfer"},{toolName:"admin.delete"},
  {toolName:"broker.execute"},{toolName:"messages.send"},
  {toolName:"tools/list"},{toolName:""},
  {origin:"http://example.com"},{origin:"https://127.0.0.1"},
  {origin:"https://metadata.google.internal"},
  {parameterName:"__proto__"},{tenantIds:[]},{tenantIds:[A.tenantId,A.tenantId]}
 ])assert.throws(()=>harness(undefined,change),/unsafe|invalid|forbid|duplicate|tool|tenant|https|origin/i);
});
test("reject malicious MCP response identity, ambiguity, errors, MIME, secrets and oversize",async()=>{
 const good=(id:string)=>({jsonrpc:"2.0",id,result:{isError:false,content:[{type:"text",text:'{"price":2400}'}]}});
 const alterations=[
  (x:any)=>{x.id="someone-else";},
  (x:any)=>{x.jsonrpc="1.0";},
  (x:any)=>{x.result.isError=true;},
  (x:any)=>{x.result.content.push({type:"text",text:"{}"});},
  (x:any)=>{x.result.content[0].type="image";},
  (x:any)=>{x.result.content[0].text="{broken";},
  (x:any)=>{x.error={code:-1,message:"bad"};},
  (x:any)=>{x.result.content[0].text=JSON.stringify({echo:secret});},
  (x:any)=>{x.result.content[0].text='{"large":"'+ "x".repeat(600)+'"}';},
  (x:any)=>{x.result.unexpected="go";},
  (x:any)=>{x.result.content[0].unexpected="go";}
 ];
 for(const alter of alterations){
  const f=harness(async(_url:any,init:any)=>{
   const v=good(JSON.parse(init.body).id);alter(v);
   return new Response(JSON.stringify(v),{status:200,headers:{"content-type":"application/json"}});
  });
  await assert.rejects(()=>f.adapter.acquire(f.input()),/response|mismatch|content|json|secret|large|size|limit|error|protocol/i);
 }
 const redirect=harness(async()=>new Response("",{status:302,headers:{location:"https://evil.example"}}));
 await assert.rejects(()=>redirect.adapter.acquire(redirect.input()),/redirect|status/i);
 const media=harness(async()=>new Response("{}",{status:200,headers:{"content-type":"text/plain"}}));
 await assert.rejects(()=>media.adapter.acquire(media.input()),/media|type/i);
});
test("MCP adapter remains subject to independently authorized and Ed25519-attested evidence acquisition",async()=>{
 const phase=await import("../src/index.ts");
 const f=harness();
 const mapper={manifest:{mappingId:"map:mcp",version:"1",implementationHash:H("c")},
  map(artifact:any){const json=JSON.parse(artifact.body);return [{
   entity:"market:mcp",attribute:"price",value:{type:{kind:"number",unit:"USD/oz"},value:json.price},
   validFrom:"2026-11-01T12:00:00.000Z",observedAt:"2026-11-01T12:00:01.000Z",
   source:"adapter:mcp",confidence:1
  }];}};
 const registry=new phase.AdapterRegistry([{adapter:f.adapter,mappers:[mapper],tenantIds:[A.tenantId]}]);
 const signer=createSigner(),attestor=phase.createAdapterAttestor("attestor:mcp",signer);
 const ingestor=new phase.AuthenticatedFactIngestor({tenant:A,world:{} as any,
  keyring:phase.createIngestionKeyring({[A.tenantId]:{"attestor:mcp":signer.publicKey}}),
  maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000});
 const commits:any[]=[];
 const service=new phase.EvidenceAcquisitionService({registry,attestor,ingestor,
  repository:{async commitAcquisition(...args:any[]){commits.push(args);}} as any});
 const context={principal:{principalId:"principal:mcp",issuer:"iss",subject:"sub"},
  credential:{issuer:"iss",subject:"sub",keyId:"key",jwtId:"jti",issuedAt:"2026-11-01T12:00:00.000Z",
   expiresAt:"2026-11-01T12:01:00.000Z",tokenHash:H("0")},
  tenant:A,authorization:{status:"ALLOW",principalId:"principal:mcp",requestedTenantId:A.tenantId,
   action:"evidence:acquire",resource:{kind:"evidence"},matchedGrantIds:["grant:mcp"],
   policyManifest:{id:"axiom.api-authorization",version:"1",implementationHash:H("2"),grantsHash:H("3")},
   decisionHash:H("4")}} as any;
 const request={adapterId:"adapter:mcp",operationId:"market.read",mappingId:"map:mcp",parameters:{symbol:"XAUUSD"}};
 const result=await service.acquire(context,request,"2026-11-01T12:00:05.000Z",H("9"));
 assert.equal(result.status,"COMMITTED");assert.equal(commits.length,1);
 const [scope,artifact,record,facts]=commits[0];
 assert.deepEqual(scope,A);assert.equal(artifact.body,'{"price":2400}');
 assert.equal(record.artifactHash,artifact.artifactHash);
 assert.equal(facts[0].fact.authentication.keyId,"attestor:mcp");
 assert.equal(facts[0].fact.acquisition.artifactHash,artifact.artifactHash);
 const count=f.calls.length;
 await assert.rejects(()=>service.acquire({...context,authorization:{...context.authorization,action:"model:execute"}},request,"2026-11-01T12:00:06.000Z",H("f")),/evidence:acquire/);
 assert.equal(f.calls.length,count);
});

test("streaming MCP response remains under trusted deadline after HTTP headers arrive",async()=>{
 const quick={...op,timeoutMs:10};
 let aborted=false;
 const f=harness(async (_url:any,init:any)=>{
  init.signal.addEventListener("abort",()=>{aborted=true;});
  const sent=JSON.parse(init.body);
  const response=JSON.stringify({jsonrpc:"2.0",id:sent.id,
   result:{isError:false,content:[{type:"text",text:'{"price":2400}'}]}});
  const stream=new ReadableStream({
   start(controller){setTimeout(()=>{try{
    controller.enqueue(new TextEncoder().encode(response));controller.close();
   }catch{}},80);}
  });
  return new Response(stream,{status:200,headers:{"content-type":"application/json"}});
 },{manifest:quick});
 await assert.rejects(()=>f.adapter.acquire({...f.input(),operation:quick}),/timeout|deadline/i);
 assert.equal(aborted,true);
});
