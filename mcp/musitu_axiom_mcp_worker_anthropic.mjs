import baseWorker from "./musitu_axiom_mcp_worker_v2.mjs";

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
    const url = new URL(request.url);

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
