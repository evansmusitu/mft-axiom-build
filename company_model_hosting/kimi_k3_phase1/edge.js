const MODEL_ALIAS = "musitu-frontier";
const BACKEND_MODEL = "moonshotai/Kimi-K3";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

async function sha256Bytes(value) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function secretEqual(a, b) {
  if (!a || !b) return false;
  const [aa, bb] = await Promise.all([sha256Bytes(a), sha256Bytes(b)]);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function requestId(request) {
  return (
    request.headers.get("x-musitu-request-id") ||
    request.headers.get("x-request-id") ||
    crypto.randomUUID()
  );
}

async function authorized(request, env) {
  const raw = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return !!match && (await secretEqual(match[1], env.MUSITU_MODEL_API_KEY || ""));
}

function safeResponseHeaders(input, rid) {
  const h = new Headers(input);
  for (const name of [
    "server",
    "via",
    "x-modal-token-id",
    "x-modal-request-id",
    "x-modal-region",
    "x-powered-by",
  ]) h.delete(name);
  h.set("x-musitu-request-id", rid);
  h.set("x-musitu-model", MODEL_ALIAS);
  h.set("x-musitu-gateway", "phase1");
  return h;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const rid = requestId(request);

    if (request.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/health")) {
      return json(
        {
          ok: true,
          product: "MUSITU Model Gateway",
          phase: "PHASE1",
          status: "READY",
          model: MODEL_ALIAS,
          backend: "PRIVATE_MODAL_DEDICATED_ENDPOINT",
          raw_modal_publicly_exposed: false,
          auth: "BEARER",
          openai_compatible: true,
          chat_completions: true,
        },
        200,
        { "x-musitu-request-id": rid },
      );
    }

    if (!(await authorized(request, env))) {
      return json(
        { ok: false, error: "UNAUTHORIZED", request_id: rid },
        401,
        { "www-authenticate": 'Bearer realm="MUSITU Models"', "x-musitu-request-id": rid },
      );
    }

    if (request.method === "GET" && url.pathname === "/v1/models") {
      return json(
        {
          object: "list",
          data: [
            {
              id: MODEL_ALIAS,
              object: "model",
              owned_by: "MUSITU",
              capabilities: ["text", "image", "reasoning", "tools", "streaming"],
            },
          ],
        },
        200,
        { "x-musitu-request-id": rid },
      );
    }

    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "INVALID_JSON", request_id: rid }, 400);
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json({ ok: false, error: "INVALID_REQUEST", request_id: rid }, 400);
      }
      if (body.model !== MODEL_ALIAS) {
        return json(
          { ok: false, error: "MODEL_ALIAS_REQUIRED", expected_model: MODEL_ALIAS, request_id: rid },
          400,
        );
      }

      body.model = BACKEND_MODEL;
      const headers = new Headers(request.headers);
      headers.delete("authorization");
      headers.delete("host");
      headers.delete("modal-key");
      headers.delete("modal-secret");
      headers.set("content-type", "application/json");
      headers.set("x-musitu-request-id", rid);

      const upstream = await env.MODEL_ADAPTER.fetch(
        new Request("https://musitu-model-adapter.internal/v1/chat/completions", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      );
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: safeResponseHeaders(upstream.headers, rid),
      });
    }

    if (url.pathname === "/v1/responses") {
      return json(
        {
          ok: false,
          error: "RESPONSES_API_NOT_ENABLED_IN_PHASE1",
          use: "/v1/chat/completions",
          request_id: rid,
        },
        501,
      );
    }

    return json({ ok: false, error: "NOT_FOUND", request_id: rid }, 404);
  },
};
