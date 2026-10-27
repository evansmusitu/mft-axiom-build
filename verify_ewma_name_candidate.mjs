import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import referenceGate from "./baseline/mcp/musitu_axiom_plugin_gate_v4.mjs";
import coreWorker from "./baseline/mcp/musitu_axiom_mcp_worker_v2.mjs";

const gate = process.env.AXIOM_GATE_UNDER_TEST
  ? (await import(pathToFileURL(process.env.AXIOM_GATE_UNDER_TEST))).default
  : (await import("./ewma-title-candidate/musitu_axiom_plugin_gate_v4.mjs")).default;
const operations = JSON.parse(await readFile(new URL("./fixtures/public-operations.json", import.meta.url), "utf8"));
const hidden = ["musitu_axiom_plans", "musitu_axiom_recommend_plan", "musitu_axiom_start_checkout", "musitu_axiom_checkout_status"];

function environment() {
  let computeCalls = 0; const computeBodies=[];
  const runtime = { async fetch(input, init) {
    const req = input instanceof Request ? input : new Request(input, init);
    if (new URL(req.url).pathname === "/v1/tools") return Response.json({tools: operations.map(x => x.operation), operation_count: 74});
    if (new URL(req.url).pathname === "/v1/compute") {
      computeCalls++;
      const body = await req.json(); computeBodies.push(body);
      return Response.json({ok: true, operation: body.operation, result: "42", customer_id: "test-only-customer", request_id: "test-only-runtime-request"});
    }
    return Response.json({error: "unexpected_test_route"}, {status: 404});
  }};
  const coreEnv = {AXIOM_SERVICE: runtime, AUTH_ISSUER: "https://auth.mftintelligence.com"};
  const db = { prepare() { return { bind() { return this; }, async first() { return {
    customer_id: "test-only-customer", issuer: "https://auth.mftintelligence.com", resource: "https://mcp.mftintelligence.com",
    scope: "axiom.execute", expires_at: "2099-01-01T00:00:00.000Z", revoked_at: null,
    key_status: "active", key_expires: null, key_revoked: null,
  }; } }; } };
  return {env: {AXIOM_DB: db, MCP_CORE: {fetch: request => coreWorker.fetch(request, coreEnv)}}, computeBodies, get computeCalls() { return computeCalls; }};
}

async function rpc(worker, env, method, params = {}, authenticated = false) {
  const headers = {"content-type": "application/json"};
  if (authenticated) headers.authorization = "Bearer test-only-not-a-real-token";
  return (await worker.fetch(new Request("https://mcp.mftintelligence.com/mcp", {
    method: "POST", headers, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
  }), env)).json();
}



const proposedGate=(await import("./ewma-name-candidate/musitu_axiom_plugin_gate_v4.mjs")).default;
const state=environment();
const before=(await rpc(gate,state.env,"tools/list")).result.tools;
const after=(await rpc(proposedGate,state.env,"tools/list")).result.tools;
assert.equal(after.length,108);
assert.ok(!after.some(t=>t.name==="ewma_forecast"));
const canonical=after.find(t=>t.name==="ewma_smoothing");
assert.ok(canonical);
assert.deepEqual(after.map(t=>t.name==="ewma_smoothing"?{...t,name:"ewma_forecast"}:t),before);
const found=await rpc(proposedGate,state.env,"tools/call",{name:"search",arguments:{query:"time-series analysis"}});
assert.ok(found.result.structuredContent.results.some(t=>t.id==="tool:ewma_smoothing"));
for(const name of ["ewma_smoothing","ewma_forecast"]){
 const fetched=await rpc(proposedGate,state.env,"tools/call",{name:"fetch",arguments:{id:"tool:"+name}});
 assert.equal(fetched.result.structuredContent.resource.name,"ewma_smoothing");
 const denied=await rpc(proposedGate,state.env,"tools/call",{name,arguments:{args:{}}});
 assert.equal(denied.result.structuredContent.authenticated,false);
}
assert.equal(state.computeCalls,0);
const supplied={series:[10,12,14,16],alpha:0.5};
for(const name of ["ewma_smoothing","ewma_forecast"]){
 const result=await rpc(proposedGate,state.env,"tools/call",{name,arguments:{args:supplied}},true);
 assert.equal(result.result.structuredContent.operation,"timeseries.ewma");
 assert.doesNotMatch(JSON.stringify(result),/request_id|customer_id/);
}
assert.equal(state.computeCalls,2);
assert.deepEqual(state.computeBodies,[{operation:"timeseries.ewma",args:supplied},{operation:"timeseries.ewma",args:supplied}]);
console.log(JSON.stringify({status:"PASS",tools_preserved:108,only_public_metadata_change:"ewma_forecast -> ewma_smoothing",legacy_fetch_and_calls:true,canonical_forwarding:true,auth_and_pruning_preserved:true}));
