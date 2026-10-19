const SITE = 'https://evansmusitu.github.io';
const MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';
const MODES = new Set(['explore', 'build', 'learn', 'markets']);
const SYSTEM = [
  'You are MUSITU Intelligence Edge, an AI collaborator for technology, education, product design and market literacy.',
  'You have no live prices, connected accounts, web search or execution permissions.',
  'Never invent sources, external research, successful actions or real-time observations.',
  'Provide useful answers, concrete next steps and ways to verify important claims.',
  'Be concise, educational and helpful. Avoid asking for account secrets or sensitive records.',
  'In market mode provide educational analysis frameworks, not personalized trading signals or guaranteed returns.'
].join(' ');
const MODE = {
  explore: 'Help explore goals, options, tradeoffs and next steps.',
  build: 'Act as a pragmatic engineering architect. Focus on tests, deliverables and risks.',
  learn: 'Act as a clear tutor with examples and a brief practice question.',
  markets: 'Focus on risk and research, explicitly identifying unknown live data.'
};
function respond(body, status = 200, origin = '') {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'vary': 'Origin'
  });
  if (origin === SITE) headers.set('access-control-allow-origin', SITE);
  return new Response(JSON.stringify(body), { status, headers });
}
export default {
  async fetch(request, env) {
    const {pathname} = new URL(request.url);
    const origin = request.headers.get('origin') || '';
    if (request.method === 'OPTIONS' && pathname === '/api/chat') {
      if (origin !== SITE) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: {
        'access-control-allow-origin': SITE,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
        'vary': 'Origin'
      } });
    }
    if (request.method === 'GET' && (pathname === '/' || pathname === '/api/health')) {
      return respond({ service:'MUSITU Intelligence Edge', status:'ok', model:MODEL,
        liveSearch:false, endpoints:['POST /api/chat'], attribution:'Cloudflare Workers AI' }, 200, origin);
    }
    if (request.method !== 'POST' || pathname !== '/api/chat') {
      return respond({error:'Not found'}, 404, origin);
    }
    if (origin && origin !== SITE && origin !== new URL(request.url).origin) {
      return respond({error:'Origin denied'}, 403, origin);
    }
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 12000) return respond({error:'Request too large'},413,origin);
    let input;
    try {
      const text = await request.text();
      if (text.length > 12000) return respond({error:'Request too large'},413,origin);
      input = JSON.parse(text);
    } catch { return respond({error:'Invalid JSON'},400,origin); }
    const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
    const mode = typeof input?.mode === 'string' ? input.mode : 'explore';
    if (prompt.length < 10 || prompt.length > 900 || !MODES.has(mode)) {
      return respond({error:'Use a valid mode and 10–900 characters'},400,origin);
    }
    const history = Array.isArray(input?.history) ? input.history.filter(m =>
      m && ['user','assistant'].includes(m.role) &&
      typeof m.content === 'string' && m.content.length <= 950).slice(-4) : [];
    try {
      const key = request.headers.get('cf-connecting-ip') || 'unknown';
      const [perVisitor, total] = await Promise.all([
        env.VISITOR_RATE.limit({ key }),
        env.GLOBAL_RATE.limit({ key:'all-visitors' })
      ]);
      if (!perVisitor.success || !total.success) {
        return respond({error:'Rate limit reached. Try again shortly.'},429,origin);
      }
    } catch { return respond({error:'Rate-limiter unavailable'},503,origin); }
    try {
      const result = await env.AI.run(MODEL, {
        messages:[
          { role:'system', content: SYSTEM + ' Mode: ' + MODE[mode] },
          ...history,
          { role:'user', content:prompt }
        ],
        max_tokens:450,
        temperature:0.45
      });
      const reply = typeof result?.response === 'string' ? result.response.trim() : '';
      if (!reply) return respond({error:'Empty model response'},502,origin);
      return respond({reply,mode,model:MODEL,liveSearch:false,generatedAt:new Date().toISOString()},200,origin);
    } catch(e) {
      console.warn('ai-inference-error',String(e?.message || 'unknown').slice(0,120));
      return respond({error:'AI model unavailable or provider quota reached.'},503,origin);
    }
  }
};
