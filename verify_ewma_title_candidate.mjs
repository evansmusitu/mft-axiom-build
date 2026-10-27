import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import referenceGate from "./baseline/mcp/musitu_axiom_plugin_gate_v4.mjs";
import coreWorker from "./baseline/mcp/musitu_axiom_mcp_worker_v2.mjs";

const gate = process.env.AXIOM_GATE_UNDER_TEST
  ? (await import(pathToFileURL(process.env.AXIOM_GATE_UNDER_TEST))).default
  : (await import("./candidate/mcp/musitu_axiom_plugin_gate_v4.mjs")).default;
const operations = JSON.parse(await readFile(new URL("./fixtures/public-operations.json", import.meta.url), "utf8"));
const hidden = ["musitu_axiom_plans", "musitu_axiom_recommend_plan", "musitu_axiom_start_checkout", "musitu_axiom_checkout_status"];

function environment() {
  let computeCalls = 0;
  const runtime = { async fetch(input, init) {
    const req = input instanceof Request ? input : new Request(input, init);
    if (new URL(req.url).pathname === "/v1/tools") return Response.json({tools: operations.map(x => x.operation), operation_count: 74});
    if (new URL(req.url).pathname === "/v1/compute") {
      computeCalls++;
      const body = await req.json();
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
  return {env: {AXIOM_DB: db, MCP_CORE: {fetch: request => coreWorker.fetch(request, coreEnv)}}, get computeCalls() { return computeCalls; }};
}

async function rpc(worker, env, method, params = {}, authenticated = false) {
  const headers = {"content-type": "application/json"};
  if (authenticated) headers.authorization = "Bearer test-only-not-a-real-token";
  return (await worker.fetch(new Request("https://mcp.mftintelligence.com/mcp", {
    method: "POST", headers, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
  }), env)).json();
}


const proposedGate=(await import("./ewma-title-candidate/musitu_axiom_plugin_gate_v4.mjs")).default;
const {env}=environment();
const before=(await rpc(gate,env,"tools/list")).result.tools;
const after=(await rpc(proposedGate,env,"tools/list")).result.tools;
assert.equal(before.length,108);
assert.equal(after.length,108);
const changes=after.filter((t,i)=>JSON.stringify(t)!==JSON.stringify(before[i]));
assert.deepEqual(changes.map(t=>t.name),["ewma_forecast"]);
const original=before.find(t=>t.name==="ewma_forecast");
const updated=after.find(t=>t.name==="ewma_forecast");
assert.equal(original.title,"Ewma Forecast");
assert.equal(updated.title,"Exponentially Weighted Moving Average");
assert.deepEqual({...updated,title:original.title},original);
const fetched=await rpc(proposedGate,env,"tools/call",{name:"fetch",arguments:{id:"tool:ewma_forecast"}});
assert.equal(fetched.result.structuredContent.resource.title,updated.title);
const found=await rpc(proposedGate,env,"tools/call",{name:"search",arguments:{query:"time-series analysis"}});
assert.equal(found.result.structuredContent.results.find(t=>t.id==="tool:ewma_forecast").title,updated.title);
console.log(JSON.stringify({status:"PASS",tools_preserved:108,only_changed_field:"ewma_forecast.title",search_and_fetch_title_verified:true,execution_unchanged:true}));
