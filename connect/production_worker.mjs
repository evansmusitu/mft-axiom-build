const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json(200, {
        ok: true,
        service: 'MUSITU Connect',
        release: String(env.RELEASE || 'unknown'),
        production: String(env.PRODUCTION || 'false') === 'true',
        axiomIntegrationAllowed: Boolean(env.AXIOM_ACCOUNT_KEY),
      });
    }
    return json(404, { ok: false, error: 'NOT_FOUND' });
  },
};
