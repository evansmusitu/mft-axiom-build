import baseWorker from "./musitu_axiom_mcp_worker_v2.mjs";

const PRODUCTION_MCP = "https://mcp.mftintelligence.com/mcp";
const PRODUCTION_BASE = "https://mcp.mftintelligence.com";

const HIDDEN_STATIC_TOOLS = new Set([
  "search",
  "fetch",
  "musitu_axiom_capabilities",
  "musitu_axiom_plans",
  "musitu_axiom_recommend_plan",
  "musitu_axiom_start_checkout",
  "musitu_axiom_checkout_status",
  "musitu_axiom_execute"
]);

const BLOCKED_PATTERNS = [
  /checkout/i,
  /payment/i,
  /transfer/i,
  /withdraw/i,
  /deposit/i,
  /crypto/i,
  /wallet/i,
  /trade/i,
  /order/i,
  /liquidat/i,
  /send[_-]?money/i,
  /financial[_-]?transaction/i
];

function assertIsolatedEnv(env) {
  const configured = String(env?.MCP_PUBLIC_BASE || "");
  if (!configured || configured === PRODUCTION_BASE || configured === PRODUCTION_MCP) {
    throw new Error("ANTHROPIC_DISTRIBUTION_REQUIRES_ISOLATED_ENDPOINT");
  }
  if (!configured.startsWith("https://")) {
    throw new Error("ANTHROPIC_DISTRIBUTION_ENDPOINT_MUST_BE_HTTPS");
  }
}

function blockedName(name) {
  const value = String(name || "");
  if (HIDDEN_STATIC_TOOLS.has(value)) return true;
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(value));
}

function rpcError(id, message) {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code: -32602, message }
  }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

async function filterToolList(response) {
  const body = await response.json();
  if (!body?.result?.tools || !Array.isArray(body.result.tools)) return response;

  body.result.tools = body.result.tools.filter((tool) => {
    if (blockedName(tool?.name)) return false;
    const operation = tool?._meta?.["musitu/operation"];
    if (blockedName(operation)) return false;
    return true;
  });

  return new Response(JSON.stringify(body), {
    status: response.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    assertIsolatedEnv(env);
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return new Response(JSON.stringify({
        ok: true,
        service: "MUSITU Axiom — Claude distribution",
        distribution_surface: "anthropic",
        isolated_endpoint_required: true,
        financial_transactions_exposed: false,
        billing_tools_exposed: false
      }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff"
        }
      });
    }

    if (url.pathname === "/docs" && request.method === "GET") {
      return new Response(JSON.stringify({
        service: "MUSITU Axiom — Claude distribution",
        endpoint: url.origin + "/mcp",
        authentication: "OAuth 2.0",
        purpose: "Quantitative analysis, statistics, optimization, time-series analysis, numerical verification, and evidence-backed analytical workflows.",
        excluded_capabilities: [
          "checkout",
          "payment",
          "money transfer",
          "cryptocurrency transfer",
          "financial-asset transfer",
          "trade/order execution",
          "liquidation",
          "subscription-plan discovery"
        ]
      }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=300",
          "x-content-type-options": "nosniff"
        }
      });
    }

    if (url.pathname !== "/mcp" || request.method !== "POST") {
      return baseWorker.fetch(request, env, ctx);
    }

    let message;
    try {
      message = await request.clone().json();
    } catch {
      return baseWorker.fetch(request, env, ctx);
    }

    if (message?.method === "tools/call") {
      const name = message?.params?.name;
      if (blockedName(name)) {
        return rpcError(message?.id ?? null, "This tool is not available on the Anthropic distribution surface.");
      }
    }

    const response = await baseWorker.fetch(request, env, ctx);

    if (message?.method === "tools/list") {
      return filterToolList(response);
    }

    return response;
  }
};
