const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'OPTIONS']);
const EDGE_SCHEMA = 'musitu.forge.cloudflare_edge.v1';

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body) + '\n', {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...extra,
    },
  });
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function rateGate(request, env) {
  if (!env.FORGE_DB) return { ok: false, response: json({ schema: EDGE_SCHEMA, error: 'forge_db_not_configured' }, 503) };
  const limit = Math.max(1, Math.min(5000, Number(env.FORGE_EDGE_RPM_LIMIT || 600)));
  const auth = request.headers.get('authorization') || '';
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const principal = auth ? `auth:${auth}` : `ip:${ip}`;
  const principalHash = await sha256Hex(principal);
  const minute = Math.floor(Date.now() / 60000);
  await env.FORGE_DB.prepare(
    `INSERT INTO edge_rate_buckets(principal_sha256, minute_bucket, request_count)
     VALUES (?1, ?2, 1)
     ON CONFLICT(principal_sha256, minute_bucket)
     DO UPDATE SET request_count = request_count + 1`
  ).bind(principalHash, minute).run();
  const row = await env.FORGE_DB.prepare(
    'SELECT request_count FROM edge_rate_buckets WHERE principal_sha256=?1 AND minute_bucket=?2'
  ).bind(principalHash, minute).first();
  const count = Number(row?.request_count || 0);
  if (count > limit) {
    return { ok: false, response: json({ schema: EDGE_SCHEMA, error: 'edge_rate_limit_exceeded' }, 429, { 'retry-after': '60' }) };
  }
  return { ok: true };
}

function cleanForwardHeaders(request) {
  const headers = new Headers(request.headers);
  for (const name of ['host', 'modal-key', 'modal-secret', 'cf-connecting-ip', 'cf-ray', 'cf-visitor']) headers.delete(name);
  return headers;
}

async function proxy(request, env) {
  if (!env.MODAL_ORIGIN || !env.MODAL_KEY || !env.MODAL_SECRET) {
    return json({ schema: EDGE_SCHEMA, error: 'private_runtime_not_configured' }, 503);
  }
  let origin;
  try { origin = new URL(env.MODAL_ORIGIN); } catch (_) {
    return json({ schema: EDGE_SCHEMA, error: 'private_runtime_origin_invalid' }, 503);
  }
  if (origin.protocol !== 'https:') return json({ schema: EDGE_SCHEMA, error: 'private_runtime_https_required' }, 503);
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, origin);
  const headers = cleanForwardHeaders(request);
  headers.set('Modal-Key', env.MODAL_KEY);
  headers.set('Modal-Secret', env.MODAL_SECRET);
  headers.set('x-musitu-edge', 'forge-cloudflare-modal-v1');
  const init = { method: request.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();
  const upstream = await fetch(target, init);
  const outHeaders = new Headers(upstream.headers);
  outHeaders.delete('server');
  outHeaders.delete('via');
  outHeaders.set('cache-control', 'no-store');
  outHeaders.set('x-content-type-options', 'nosniff');
  outHeaders.set('referrer-policy', 'no-referrer');
  outHeaders.set('x-musitu-edge', 'forge-cloudflare-modal-v1');
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

export default {
  async fetch(request, env) {
    if (!ALLOWED_METHODS.has(request.method)) {
      return json({ schema: EDGE_SCHEMA, error: 'method_not_allowed' }, 405, { allow: 'GET, POST, PUT, OPTIONS' });
    }
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/v1/')) return json({ schema: EDGE_SCHEMA, error: 'route_not_found' }, 404);

    if (url.pathname !== '/v1/health') {
      const supplied = request.headers.get('x-musitu-client-protocol') || '';
      if (!env.FORGE_PROTOCOL_DIGEST || supplied !== env.FORGE_PROTOCOL_DIGEST) {
        return json({ schema: EDGE_SCHEMA, error: 'protocol_digest_mismatch' }, 401);
      }
      const gate = await rateGate(request, env);
      if (!gate.ok) return gate.response;
    }

    try {
      return await proxy(request, env);
    } catch (_) {
      return json({ schema: EDGE_SCHEMA, error: 'private_runtime_unavailable' }, 503);
    }
  },
};
