import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import referenceGate from "../baseline/mcp/musitu_axiom_plugin_gate_v4.mjs";
import coreWorker from "../baseline/mcp/musitu_axiom_mcp_worker_v2.mjs";

const gate = process.env.AXIOM_GATE_UNDER_TEST
  ? (await import(pathToFileURL(process.env.AXIOM_GATE_UNDER_TEST))).default
  : (await import("../candidate/mcp/musitu_axiom_plugin_gate_v4.mjs")).default;
const operations = JSON.parse(await readFile(new URL("../fixtures/public-operations.json", import.meta.url), "utf8"));
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

test("every public operation describes its purpose rather than only a registry identifier", async () => {
  const {env} = environment();
  const tools = (await rpc(gate, env, "tools/list")).result.tools;
  const quantitative = tools.filter(t => t._meta?.["musitu/operation"]);
  assert.equal(quantitative.length, 104);
  const generic = quantitative.filter(t => /Use this .*backed by|Execute certified MUSITU Axiom operation/i.test(t.description));
  assert.deepEqual(generic.map(t => t.name), [], "operation-specific input/output descriptions are required");
});

test("the reviewer's time-series analysis phrase discovers usable capabilities", async () => {
  const {env} = environment();
  const found = await rpc(gate, env, "tools/call", {name: "search", arguments: {query: "time-series analysis"}});
  assert.ok(found.result.structuredContent.results.some(t => /moving_average|ewma|rolling_volatility/.test(t.id)));
});

test("representative descriptions explain the mathematical task and relevant inputs", async () => {
  const {env} = environment();
  const tools = (await rpc(gate, env, "tools/list")).result.tools;
  const byName = new Map(tools.map(t => [t.name, t]));
  assert.match(byName.get("investment_npv").description, /cash flows/i);
  assert.match(byName.get("investment_npv").description, /discount rate/i);
  assert.match(byName.get("moving_average").description, /window/i);
  assert.match(byName.get("axiom_arithmetic_evaluate").description, /expression/i);
  const fetched = await rpc(gate, env, "tools/call", {name: "fetch", arguments: {id: "tool:moving_average"}});
  assert.match(fetched.result.structuredContent.resource.description, /moving average/i);
  assert.equal(fetched.result.structuredContent.resource.name, "moving_average");
});

test("all 108 tool names, schemas, annotations, OAuth scopes and other metadata stay unchanged", async () => {
  const {env} = environment();
  const before = (await rpc(referenceGate, env, "tools/list")).result.tools;
  const after = (await rpc(gate, env, "tools/list")).result.tools;
  assert.equal(after.length, 108);
  const withoutDescription = tools => tools.map(({description, ...rest}) => rest);
  assert.deepEqual(withoutDescription(after), withoutDescription(before));
  assert.equal(after.filter(t => hidden.includes(t.name)).length, 0);
});

test("commerce stays hidden and unauthenticated execution does not reach compute", async () => {
  const state = environment();
  for (const name of hidden) {
    const denied = await rpc(gate, state.env, "tools/call", {name, arguments: {}});
    assert.equal(denied.error.code, -32601);
  }
  const unauthenticated = await rpc(gate, state.env, "tools/call", {name: "musitu_axiom_execute", arguments: {operation: "arithmetic.evaluate", args: {expression: "40+2"}}});
  assert.equal(unauthenticated.result.isError, true);
  assert.equal(unauthenticated.result.structuredContent.authenticated, false);
  assert.ok(unauthenticated.result._meta["mcp/www_authenticate"]);
  assert.equal(state.computeCalls, 0);
});

test("authorized forwarding still preserves the public response-minimization boundary", async () => {
  const state = environment();
  const result = await rpc(gate, state.env, "tools/call", {name: "musitu_axiom_execute", arguments: {operation: "arithmetic.evaluate", args: {expression: "40+2"}}}, true);
  assert.equal(state.computeCalls, 1);
  assert.equal(result.result.structuredContent.result.result, "42");
  assert.doesNotMatch(JSON.stringify(result), /request_id|customer_id|test-only-customer|test-only-runtime-request/);
});
