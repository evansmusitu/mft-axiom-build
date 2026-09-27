const DEFAULTS = {
  axiomBase: "https://axiom.mftintelligence.com",
  billingBase: "https://payments.mftintelligence.com",
  publicBase: "https://mcp.mftintelligence.com",
  serverName: "musitu-axiom",
  serverVersion: "1.0.0",
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const BUSINESS_ALIASES = [
  ["analyze_company", [["company"], ["analy"]]],
  ["build_financial_model", [["financial"], ["model"]]],
  ["value_company", [["valuation", "value"], ["company", "equity", "enterprise"]]],
  ["compare_companies", [["compar"], ["compan"]]],
  ["research_market", [["market"], ["research", "intelligence", "analy"]]],
  ["analyze_document", [["document", "file"], ["analy", "extract", "review"]]],
  ["generate_investment_memo", [["investment"], ["memo", "report"]]],
  ["run_scenario", [["scenario", "simulation"]]],
  ["create_workflow", [["workflow"], ["create", "build"]]],
  ["execute_workflow", [["workflow"], ["execute", "run"]]],
  ["get_workflow_status", [["workflow"], ["status", "state"]]],
  ["search_musitu_knowledge", [["search"], ["knowledge", "research", "memory"]]],
  ["fetch_musitu_resource", [["fetch", "retrieve", "get"], ["resource", "document", "record"]]],
  ["analyze_portfolio", [["portfolio"], ["analy", "risk", "optimi"]]],
  ["assess_risk", [["risk"], ["assess", "analy", "score"]]],
  ["backtest_strategy", [["backtest", "replay"], ["strategy", "trading"]]],
  ["analyze_security", [["security", "stock", "equity"], ["analy", "research"]]],
  ["analyze_sector", [["sector", "industry"], ["analy", "research"]]],
  ["analyze_macro", [["macro", "econom"], ["analy", "research"]]],
  ["analyze_credit", [["credit", "debt"], ["analy", "risk"]]],
  ["analyze_fx", [["fx", "forex", "currency"], ["analy", "research"]]],
  ["analyze_liquidity", [["liquidity"], ["analy", "risk"]]],
  ["forecast_financials", [["forecast"], ["financial", "revenue", "earnings"]]],
  ["run_stress_test", [["stress"], ["test", "scenario", "risk"]]],
  ["evaluate_investment", [["investment"], ["evaluate", "assess", "score"]]],
  ["evaluate_acquisition", [["acquisition", "m&a", "merger"], ["evaluate", "analy", "value"]]],
  ["analyze_unit_economics", [["unit"], ["economics", "margin", "ltv", "cac"]]],
  ["analyze_kpis", [["kpi", "metric"], ["analy", "evaluate"]]],
  ["generate_research_report", [["research"], ["report", "memo"]]],
  ["generate_due_diligence", [["diligence"], ["due", "research", "investigation"]]],
];

function response(status, body, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function mcpOk(id, result) {
  return response(200, { jsonrpc: "2.0", id, result });
}

function mcpError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return response(200, { jsonrpc: "2.0", id, error });
}

function textResult(text, structuredContent = {}, meta = undefined, isError = false) {
  const out = {
    content: [{ type: "text", text }],
    structuredContent,
  };
  if (meta) out._meta = meta;
  if (isError) out.isError = true;
  return out;
}

function cfg(env) {
  return {
    axiomBase: env.AXIOM_BASE || DEFAULTS.axiomBase,
    billingBase: env.BILLING_BASE || DEFAULTS.billingBase,
    publicBase: env.MCP_PUBLIC_BASE || DEFAULTS.publicBase,
    authIssuer: env.AUTH_ISSUER || "",
    serverName: DEFAULTS.serverName,
    serverVersion: DEFAULTS.serverVersion,
  };
}

function bearer(request) {
  const h = request.headers.get("authorization") || "";
  return h.startsWith("Bearer ") && h.length > 12 ? h : "";
}

function oauthChallenge(c, scope = "axiom.execute", error = "invalid_token", description = "Connect your MUSITU account to continue") {
  if (!c.authIssuer) return null;
  return `Bearer resource_metadata="${c.publicBase}/.well-known/oauth-protected-resource", scope="${scope}", error="${error}", error_description="${description}"`;
}

function authRequired(c, scope = "axiom.execute", description) {
  const challenge = oauthChallenge(c, scope, "insufficient_scope", description || "Authentication is required");
  const meta = challenge ? { "mcp/www_authenticate": [challenge] } : { "musitu/auth_status": "OAUTH_PROVIDER_NOT_CONFIGURED" };
  return textResult(description || "Authentication is required to use this MUSITU Axiom capability.", { authenticated: false }, meta, true);
}

async function fetchJson(url, init = {}) {
  let r;
  try {
    r = await fetch(url, init);
  } catch (e) {
    return { status: 0, obj: {}, text: String(e) };
  }
  const text = await r.text();
  let obj = {};
  try { obj = JSON.parse(text || "{}"); } catch {}
  return { status: r.status, obj, text };
}

function genericObjectSchema() {
  return { type: "object", additionalProperties: true };
}

function normalizeSchema(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return genericObjectSchema();
  if (v.type || v.properties || v.oneOf || v.anyOf || v.allOf || v.$ref) return v;
  return { type: "object", properties: v, additionalProperties: true };
}

function inferAnnotations(operation, source = {}) {
  const supplied = source.annotations && typeof source.annotations === "object" ? source.annotations : {};
  if (Object.keys(supplied).length) {
    return {
      readOnlyHint: supplied.readOnlyHint === true,
      destructiveHint: supplied.destructiveHint === true,
      openWorldHint: supplied.openWorldHint === true,
      ...(supplied.idempotentHint !== undefined ? { idempotentHint: supplied.idempotentHint === true } : {}),
    };
  }
  const n = operation.toLowerCase();
  const destructive = /(delete|remove|terminate|liquidate|closeall|close_all|wipe|purge|revoke)/.test(n);
  const openWorld = /(trade|order|send|publish|submit|execute|external|payment|checkout|transfer|withdraw|deposit)/.test(n);
  const analytical = /(get|list|search|fetch|read|analy|research|compare|value|valuation|forecast|evaluate|calculate|inspect|summar|extract|score|rank|simulate|scenario|report)/.test(n);
  return {
    readOnlyHint: analytical && !openWorld && !destructive,
    destructiveHint: destructive,
    openWorldHint: openWorld,
  };
}

function normalizeRegistryItem(item) {
  if (typeof item === "string") {
    return { operation: item, description: `Use this when the user needs the MUSITU Axiom ${item} capability.`, inputSchema: genericObjectSchema(), annotations: inferAnnotations(item) };
  }
  if (!item || typeof item !== "object") return null;
  const operation = String(item.operation || item.name || item.id || "").trim();
  if (!operation) return null;
  const inputSchema = normalizeSchema(item.inputSchema || item.input_schema || item.parameters || item.args_schema || item.schema);
  const description = String(item.description || item.summary || item.title || `Use this when the user needs the MUSITU Axiom ${operation} capability.`);
  return { operation, description, inputSchema, annotations: inferAnnotations(operation, item), source: item };
}

async function registry(c) {
  const { status, obj } = await fetchJson(`${c.axiomBase}/v1/tools`, { headers: { accept: "application/json", "user-agent": "MUSITU-Axiom-MCP/1.0" } });
  if (status !== 200) throw new Error(`Axiom registry unavailable HTTP ${status}`);
  let raw = obj.tools || obj.operations || obj.registry || obj.capabilities || [];
  if (!Array.isArray(raw) && raw && typeof raw === "object") raw = Object.entries(raw).map(([name, value]) => ({ name, ...(value && typeof value === "object" ? value : {}) }));
  if (!Array.isArray(raw)) throw new Error("Axiom registry response does not contain a tool array");
  const tools = raw.map(normalizeRegistryItem).filter(Boolean);
  const expected = Number(obj.operation_count || obj.operationCount || tools.length || 0);
  if (!tools.length || (expected && tools.length !== expected)) throw new Error(`Axiom registry cardinality mismatch expected=${expected} got=${tools.length}`);
  return { tools, operationCount: expected || tools.length, buildId: obj.build_id || obj.buildId || null };
}

function stableHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function safeToolName(operation, used) {
  let n = `axiom_${operation.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "")}`;
  if (n.length > 58) n = `${n.slice(0, 49)}_${stableHash(operation)}`;
  if (used.has(n)) n = `${n.slice(0, 49)}_${stableHash(operation)}`;
  used.add(n);
  return n;
}

function aliasMatchText(entry) {
  return `${entry.operation} ${entry.description}`.toLowerCase();
}

function resolveAliases(registryTools) {
  const aliases = [];
  const occupied = new Set();
  for (const [alias, groups] of BUSINESS_ALIASES) {
    const matches = registryTools.filter((entry) => {
      const text = aliasMatchText(entry);
      return groups.every((alternatives) => alternatives.some((needle) => text.includes(needle)));
    });
    if (matches.length === 1 && !occupied.has(matches[0].operation)) {
      occupied.add(matches[0].operation);
      aliases.push({ alias, target: matches[0] });
    }
  }
  return aliases;
}

function protectedScheme(scope = "axiom.execute") {
  return [{ type: "oauth2", scopes: [scope] }];
}

async function planCatalog(c) {
  const { status, obj } = await fetchJson(`${c.billingBase}/billing/catalog`, { headers: { accept: "application/json", "user-agent": "MUSITU-Axiom-MCP/1.0" } });
  if (status !== 200) throw new Error(`Billing catalog unavailable HTTP ${status}`);
  return obj;
}

async function buildToolList(c) {
  const reg = await registry(c);
  const used = new Set([
    "musitu_axiom_capabilities",
    "musitu_axiom_plans",
    "musitu_axiom_recommend_plan",
    "musitu_axiom_execute",
    "musitu_axiom_start_checkout",
    "musitu_axiom_checkout_status",
  ]);
  const toolMap = new Map();
  const dynamic = reg.tools.map((entry) => {
    const name = safeToolName(entry.operation, used);
    toolMap.set(name, entry.operation);
    return {
      name,
      title: entry.source?.title || `MUSITU Axiom: ${entry.operation}`,
      description: `${entry.description} This invokes the certified MUSITU Axiom runtime and may consume plan units.`,
      inputSchema: entry.inputSchema,
      annotations: entry.annotations,
      securitySchemes: protectedScheme("axiom.execute"),
      _meta: { "musitu/operation": entry.operation },
    };
  });
  const aliases = resolveAliases(reg.tools).map(({ alias, target }) => {
    used.add(alias);
    toolMap.set(alias, target.operation);
    return {
      name: alias,
      title: alias.split("_").map((x) => x[0].toUpperCase() + x.slice(1)).join(" "),
      description: `Use this when the user asks to ${alias.replaceAll("_", " ")}. Backed by MUSITU Axiom operation ${target.operation}; consumes plan units when executed.`,
      inputSchema: target.inputSchema,
      annotations: target.annotations,
      securitySchemes: protectedScheme("axiom.execute"),
      _meta: { "musitu/operation": target.operation, "musitu/business_alias": true },
    };
  });
  const staticTools = [
    {
      name: "musitu_axiom_capabilities",
      title: "MUSITU Axiom Capabilities",
      description: "Use this when the user wants to understand what MUSITU Axiom can do before choosing a paid capability.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      securitySchemes: [{ type: "noauth" }],
    },
    {
      name: "musitu_axiom_plans",
      title: "MUSITU Axiom Plans",
      description: "Use this when the user asks about MUSITU Axiom pricing, subscriptions, quotas, or available paid plans.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      securitySchemes: [{ type: "noauth" }],
    },
    {
      name: "musitu_axiom_recommend_plan",
      title: "Recommend MUSITU Axiom Plan",
      description: "Use this when the user wants the lowest MUSITU Axiom plan that can cover an estimated monthly compute-unit requirement.",
      inputSchema: {
        type: "object",
        properties: { estimated_monthly_units: { type: "integer", minimum: 1 } },
        required: ["estimated_monthly_units"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      securitySchemes: [{ type: "noauth" }],
    },
    {
      name: "musitu_axiom_execute",
      title: "Execute Any MUSITU Axiom Operation",
      description: "Use this only when a specialized advertised Axiom tool does not fit. Executes any operation currently present in the certified Axiom registry using its native args object.",
      inputSchema: {
        type: "object",
        properties: { operation: { type: "string", minLength: 1 }, args: { type: "object", additionalProperties: true } },
        required: ["operation", "args"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      securitySchemes: protectedScheme("axiom.execute"),
    },
    {
      name: "musitu_axiom_start_checkout",
      title: "Start MUSITU Axiom Checkout",
      description: "Use this only after the user explicitly asks to subscribe or upgrade. Creates a Paynow checkout for the selected MUSITU Axiom plan; it does not itself charge or submit payment.",
      inputSchema: {
        type: "object",
        properties: {
          plan: { type: "string", enum: ["developer", "pro", "enterprise"] },
          confirm_create_checkout: { type: "boolean", const: true },
        },
        required: ["plan", "confirm_create_checkout"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
      securitySchemes: protectedScheme("billing.write"),
    },
    {
      name: "musitu_axiom_checkout_status",
      title: "Check MUSITU Axiom Checkout Status",
      description: "Use this after a MUSITU Axiom checkout has been created to confirm the provider status and entitlement reconciliation.",
      inputSchema: {
        type: "object",
        properties: { reference: { type: "string", minLength: 1, maxLength: 256 } },
        required: ["reference"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      securitySchemes: protectedScheme("billing.read"),
    },
  ];
  return { tools: [...staticTools, ...aliases, ...dynamic], toolMap, reg, aliases };
}

async function executeAxiom(request, c, operation, args, reg) {
  const auth = bearer(request);
  if (!auth) return authRequired(c, "axiom.execute", "Connect your MUSITU account to run paid Axiom capabilities.");
  if (!reg.tools.some((x) => x.operation === operation)) return textResult(`Unknown or unavailable Axiom operation: ${operation}`, { operation, available: false }, undefined, true);
  const requestId = request.headers.get("x-musitu-request-id") || `MUSITU-MCP-${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
  const { status, obj } = await fetchJson(`${c.axiomBase}/v1/compute`, {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json", accept: "application/json", "x-musitu-request-id": requestId, "user-agent": "MUSITU-Axiom-MCP/1.0" },
    body: JSON.stringify({ operation, args: args || {} }),
  });
  if (status === 401 || status === 403) return authRequired(c, "axiom.execute", "Your MUSITU authorization is missing, expired, or insufficient for this capability.");
  if (status < 200 || status >= 300) return textResult(`MUSITU Axiom operation failed with HTTP ${status}.`, { operation, http_status: status, error: obj.error || obj.message || "upstream_error" }, undefined, true);
  return textResult(`MUSITU Axiom completed ${operation}.`, { operation, request_id: requestId, result: obj });
}

async function handleToolCall(request, c, name, args) {
  const built = await buildToolList(c);
  if (name === "musitu_axiom_capabilities") {
    return textResult(`MUSITU Axiom currently advertises ${built.reg.operationCount} certified runtime operations plus business and billing entry points.`, {
      operation_count: built.reg.operationCount,
      build_id: built.reg.buildId,
      business_aliases: built.aliases.map((x) => ({ name: x.alias, operation: x.target.operation })),
      paid_execution_available: true,
      plans_available: true,
    });
  }
  if (name === "musitu_axiom_plans") {
    const catalog = await planCatalog(c);
    return textResult("MUSITU Axiom subscription plans are available.", { catalog });
  }
  if (name === "musitu_axiom_recommend_plan") {
    const units = Number(args?.estimated_monthly_units || 0);
    if (!Number.isInteger(units) || units < 1) return textResult("estimated_monthly_units must be a positive integer.", {}, undefined, true);
    const catalog = await planCatalog(c);
    const plans = Array.isArray(catalog.plans) ? catalog.plans.slice().sort((a, b) => Number(a.monthly_unit_limit || 0) - Number(b.monthly_unit_limit || 0)) : [];
    const recommended = plans.find((p) => Number(p.monthly_unit_limit || 0) >= units) || plans[plans.length - 1] || null;
    return textResult(recommended ? `Recommended plan: ${recommended.id}.` : "No plan recommendation is currently available.", { estimated_monthly_units: units, recommended, catalog });
  }
  if (name === "musitu_axiom_start_checkout") {
    const auth = bearer(request);
    if (!auth) return authRequired(c, "billing.write", "Connect your MUSITU account before creating a checkout.");
    if (args?.confirm_create_checkout !== true) return textResult("Checkout creation requires explicit confirmation.", { checkout_created: false }, undefined, true);
    const plan = String(args?.plan || "");
    if (!["developer", "pro", "enterprise"].includes(plan)) return textResult("Invalid MUSITU Axiom plan.", { checkout_created: false }, undefined, true);
    const { status, obj } = await fetchJson(`${c.billingBase}/billing/checkout`, {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json", accept: "application/json", "user-agent": "MUSITU-Axiom-MCP/1.0" },
      body: JSON.stringify({ plan }),
    });
    if (status === 401 || status === 403) return authRequired(c, "billing.write", "Your MUSITU authorization cannot create this checkout.");
    if (status !== 201) return textResult(`MUSITU Axiom checkout creation failed with HTTP ${status}.`, { checkout_created: false, http_status: status, error: obj.error || obj.message || "checkout_error" }, undefined, true);
    return textResult("MUSITU Axiom checkout created. The user must personally open the Paynow page and authorize payment.", { checkout_created: true, plan, checkout: obj });
  }
  if (name === "musitu_axiom_checkout_status") {
    const auth = bearer(request);
    if (!auth) return authRequired(c, "billing.read", "Connect your MUSITU account to check checkout status.");
    const reference = String(args?.reference || "");
    if (!reference) return textResult("Checkout reference is required.", {}, undefined, true);
    const { status, obj } = await fetchJson(`${c.billingBase}/billing/checkout/${encodeURIComponent(reference)}`, {
      headers: { authorization: auth, accept: "application/json", "user-agent": "MUSITU-Axiom-MCP/1.0" },
    });
    if (status === 401 || status === 403) return authRequired(c, "billing.read", "Your MUSITU authorization cannot read this checkout.");
    if (status !== 200) return textResult(`Checkout status lookup failed with HTTP ${status}.`, { http_status: status, error: obj.error || obj.message || "status_error" }, undefined, true);
    return textResult("MUSITU Axiom checkout status retrieved.", { checkout: obj });
  }
  let operation = built.toolMap.get(name);
  if (name === "musitu_axiom_execute") operation = String(args?.operation || "");
  if (!operation) return textResult(`Unknown MCP tool: ${name}`, { tool: name }, undefined, true);
  return executeAxiom(request, c, operation, name === "musitu_axiom_execute" ? args?.args : args, built.reg);
}

async function health(c) {
  const [rh, rt, bc] = await Promise.all([
    fetchJson(`${c.axiomBase}/health`, { headers: { accept: "application/json", "user-agent": "MUSITU-Axiom-MCP/1.0" } }),
    registry(c).catch((e) => ({ error: String(e) })),
    fetchJson(`${c.billingBase}/billing/healthz`, { headers: { accept: "application/json", "user-agent": "MUSITU-Axiom-MCP/1.0" } }),
  ]);
  const ok = rh.status === 200 && !rt.error && bc.status === 200;
  return {
    ok,
    service: "MUSITU Axiom MCP Gateway",
    server_version: c.serverVersion,
    axiom_health_http: rh.status,
    operation_count: rt.operationCount || null,
    build_id: rt.buildId || rh.obj?.build_id || null,
    billing_health_http: bc.status,
    catalog_configured: bc.obj?.catalog_configured === true,
    checkout_enabled: bc.obj?.checkout_enabled === true,
    oauth_provider_configured: Boolean(c.authIssuer),
    wolfram_parity: "NOT_CERTIFIED",
    superiority: "NOT_CERTIFIED",
  };
}

async function mcp(request, c) {
  if (request.method !== "POST") return response(405, { error: "method_not_allowed" }, { allow: "POST" });
  let msg;
  try { msg = await request.json(); } catch { return mcpError(null, -32700, "Parse error"); }
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return mcpError(msg?.id ?? null, -32600, "Invalid Request");
  const id = msg.id ?? null;
  if (msg.method === "initialize") {
    const requested = String(msg.params?.protocolVersion || "2025-06-18");
    return mcpOk(id, {
      protocolVersion: requested,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: c.serverName, version: c.serverVersion },
      instructions: "MUSITU Axiom provides paid financial intelligence, company research, valuation, modeling, workflows, document analysis, market intelligence, and the complete certified Axiom operation registry. Prefer focused business tools over musitu_axiom_execute. Never create a checkout unless the user explicitly asks to subscribe or upgrade. Consequential actions remain permission-gated.",
    });
  }
  if (msg.method === "notifications/initialized" || msg.method === "notifications/cancelled") return new Response(null, { status: 202 });
  if (msg.method === "ping") return mcpOk(id, {});
  if (msg.method === "tools/list") {
    try {
      const built = await buildToolList(c);
      return mcpOk(id, { tools: built.tools });
    } catch (e) {
      return mcpError(id, -32603, "MUSITU Axiom registry unavailable", { detail: String(e) });
    }
  }
  if (msg.method === "tools/call") {
    const name = String(msg.params?.name || "");
    const args = msg.params?.arguments && typeof msg.params.arguments === "object" ? msg.params.arguments : {};
    if (!name) return mcpError(id, -32602, "Tool name is required");
    try { return mcpOk(id, await handleToolCall(request, c, name, args)); }
    catch (e) { return mcpOk(id, textResult("MUSITU Axiom MCP tool failed safely.", { error: String(e) }, undefined, true)); }
  }
  return mcpError(id, -32601, "Method not found");
}

export default {
  async fetch(request, env) {
    const c = cfg(env);
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type,mcp-session-id,x-musitu-request-id" } });
    if (url.pathname === "/health" && request.method === "GET") {
      const h = await health(c);
      return response(h.ok ? 200 : 503, h);
    }
    if (url.pathname === "/.well-known/oauth-protected-resource" && request.method === "GET") {
      const body = {
        resource: c.publicBase,
        authorization_servers: c.authIssuer ? [c.authIssuer] : [],
        scopes_supported: ["openid", "email", "profile", "axiom.execute", "billing.read", "billing.write"],
        resource_documentation: `${c.publicBase}/docs`,
      };
      return response(c.authIssuer ? 200 : 503, body);
    }
    if (url.pathname === "/docs" && request.method === "GET") {
      return response(200, {
        service: "MUSITU Axiom MCP Gateway",
        endpoint: `${c.publicBase}/mcp`,
        purpose: "ChatGPT and Codex access to MUSITU Axiom paid financial intelligence and workflow capabilities.",
        authentication: c.authIssuer ? "OAuth 2.1" : "OAuth provider pending; direct MUSITU bearer accepted for controlled E2E validation only",
        payment_policy: "Checkout creation never charges automatically; the user authorizes payment at Paynow.",
      });
    }
    if (url.pathname === "/mcp") return mcp(request, c);
    return response(404, { error: "not_found" });
  },
};
