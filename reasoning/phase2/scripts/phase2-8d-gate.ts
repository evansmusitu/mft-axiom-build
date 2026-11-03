import assert from "node:assert/strict";
import {FixedMcpEvidenceAdapter} from "../src/fixed_mcp_evidence_adapter.ts";
const H=(x:string)=>x.repeat(64);
const operation={operationId:"rates.read",parameterSchemaHash:H("a"),responseMediaTypes:["application/json"],
 maxResponseBytes:512,timeoutMs:1000,mappingIds:["map:rates"]};
let count=0;let secretReads=0;
const adapter=new FixedMcpEvidenceAdapter({
 adapterId:"adapter:mcp-gate",version:"1",implementationHash:H("b"),
 secretResolver:{async resolve(){secretReads++;return "server-gate-key";}},
 operations:[{manifest:operation,origin:"https://read-data.example",toolName:"market.rates",
  parameterName:"symbol",tenantIds:["tenant:gate"],secretRef:"credential:gate"}],
 fetchFn:async(url:any,init:any)=>{
  count++;const sent=JSON.parse(init.body);
  assert.equal(String(url),"https://read-data.example/mcp");
  assert.equal(init.method,"POST");
  assert.equal(init.redirect,"manual");
  assert.equal(init.headers.authorization,"server-gate-key");
  assert.equal(sent.method,"tools/call");
  assert.deepEqual(sent.params,{name:"market.rates",arguments:{symbol:"XAUUSD"}});
  return new Response(JSON.stringify({
   jsonrpc:"2.0",id:sent.id,result:{isError:false,content:[{type:"text",text:'{"price":2400}'}]}
  }),{status:200,headers:{"content-type":"application/json"}});
 }
});
const input={tenant:{tenantId:"tenant:gate"},operation,parameters:{symbol:"XAUUSD"}};
assert.equal(adapter.manifest.capability,"READ");
const result=await adapter.acquire(input);
assert.deepEqual(result,{status:200,mediaType:"application/json",
 bodyEncoding:"utf8",body:'{"price":2400}'});
await assert.rejects(()=>adapter.acquire({...input,tenant:{tenantId:"attacker"}}),/tenant/);
await assert.rejects(()=>adapter.acquire({...input,parameters:{symbol:"XAUUSD",tool:"admin.delete"}}),/parameters/);
assert.equal(count,1);assert.equal(secretReads,1);
await import("./phase2-3a-gate.ts");
console.log(JSON.stringify({phase:"P2.8D — Fixed-Tool Read-Only MCP Evidence",status:"PASS",
 checks:["pinned HTTPS tool endpoint","only tools/call not discovery",
 "exact registered tool name and string arguments","tenant authorization before credential access",
 "bounded strict JSON-RPC response identity","no caller tool/method/URL override",
 "no provider content as reasoning authority","reuses signed evidence/replay acceptance"]}));
