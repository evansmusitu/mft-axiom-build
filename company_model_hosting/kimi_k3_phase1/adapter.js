const ALLOWED_PATHS = new Set(["/v1/chat/completions"]);

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (!ALLOWED_PATHS.has(incoming.pathname)) {
      return json({ ok: false, error: "ADAPTER_PATH_DENIED" }, 404);
    }
    if (!env.MODAL_BASE_URL || !env.MODAL_PROXY_KEY || !env.MODAL_PROXY_SECRET) {
      return json({ ok: false, error: "ADAPTER_NOT_CONFIGURED" }, 503);
    }

    const base = env.MODAL_BASE_URL.endsWith("/")
      ? env.MODAL_BASE_URL.slice(0, -1)
      : env.MODAL_BASE_URL;
    const target = `${base}${incoming.pathname}${incoming.search}`;

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("authorization");
    headers.delete("modal-key");
    headers.delete("modal-secret");
    headers.set("Authorization", `Bearer ${env.MODAL_PROXY_KEY}.${env.MODAL_PROXY_SECRET}`);

    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;

    return fetch(new Request(target, init));
  },
};
