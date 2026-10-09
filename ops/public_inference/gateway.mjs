/**
 * AXIOM bounded public inference gateway candidate. ZERO production authority.
 * Standalone Cloudflare Worker module; not deployed by this package.
 * Trust boundary: separately signed short-lived per-request capabilities,
 * durable D1 admission, hard-coded provider allowlists, strict $0 attestation.
 */
import { authorizeRequest } from './signed_capability.mjs';
import { reserveQuota } from './quota.mjs';
import { verifyFreeTierAttestation } from './free_tier_attestation.mjs';
import { runCloudflare, runGroq, ProviderDenied } from './providers.mjs';

const BASE_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
});
const MODELS = Object.freeze({
  cloudflare: '@cf/zai-org/glm-4.7-flash',
  groq: 'openai/gpt-oss-120b',
});
export function reply(status, code, extras = {}) {
  return new Response(JSON.stringify({ error: { code, ...extras }}), { status, headers: BASE_HEADERS });
}
function isObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function verifyBody(body, capability) {
  if (!isObject(body) || Object.keys(body).sort().join(',') !== 'max_tokens,messages,model,provider') throw new Error('INVALID_SCHEMA');
  if (body.provider !== capability.provider || body.model !== MODELS[body.provider] || body.model !== capability.model) throw new Error('MODEL_NOT_ALLOWED');
  if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 256 || body.max_tokens > capability.max_tokens) throw new Error('OUTPUT_LIMIT');
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 6) throw new Error('MESSAGES_INVALID');
  let textBytes = 0;
  for (const msg of body.messages) {
    if (!isObject(msg) || Object.keys(msg).sort().join(',') !== 'content,role' ||
        !['system','user','assistant'].includes(msg.role) || typeof msg.content !== 'string' || msg.content.length < 1 || msg.content.length > 1800) throw new Error('MESSAGES_INVALID');
    textBytes += new TextEncoder().encode(msg.content).length;
  }
  if (textBytes > 3500) throw new Error('MESSAGES_TOO_LARGE');
  return body;
}
function hardGate(env) {
  // These are independent operational attestations; no defaults or paid fallback.
  if (env.AXIOM_PUBLIC_INFERENCE_ENABLE !== 'EXPLICIT_NONPRODUCTION_TEST' ||
      env.AXIOM_FREE_ACCOUNT_ATTESTED !== 'TRUE' ||
      env.AXIOM_ZERO_CASH_BUDGET_USD !== '0' ||
      env.AXIOM_EXTERNAL_PROVIDER_CONSENT_GATE !== 'VERIFIED' ||
      !env.AXIOM_CAPABILITY_HMAC_KEY || !env.AXIOM_PUBLIC_INFERENCE_D1) return false;
  return true;
}
export function createGateway({ now = () => Date.now(), fetchImpl = fetch } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === '/healthz' && request.method === 'GET') {
        return new Response(JSON.stringify({ state:'DISABLED_UNTIL_INDEPENDENT_ADMISSION', qualification:'NOT_PROVEN' }), { status:200,headers:BASE_HEADERS });
      }
      if (url.pathname !== '/v1/chat/completions') return reply(404,'NOT_FOUND');
      if (request.method !== 'POST') return reply(405,'METHOD_NOT_ALLOWED');
      if (!hardGate(env)) return reply(503,'NOT_AUTHORIZED_FOR_PUBLIC_SERVICE');
      const contentType = request.headers.get('content-type') || '';
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) return reply(415,'CONTENT_TYPE_REQUIRED');
      if (request.headers.has('content-encoding')) return reply(415,'ENCODING_NOT_ALLOWED');
      const size = Number(request.headers.get('content-length'));
      if (request.headers.has('content-length') && (!Number.isInteger(size) || size > 5000 || size < 1)) return reply(413,'INPUT_TOO_LARGE');
      let raw = '';
      try {
        // Stream independently of declared content-length to prohibit unlimited memory use.
        const reader = request.body?.getReader();
        if (!reader) throw new Error('EMPTY_BODY');
        let received = 0;
        const chunks = [];
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          received += part.value.byteLength;
          if (received > 5000) { await reader.cancel().catch(() => {}); return reply(413,'INPUT_TOO_LARGE'); }
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(received);
        let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        raw = new TextDecoder('utf-8', { fatal:true }).decode(bytes);
      } catch { return reply(400,'INVALID_REQUEST'); }
      let body;
      try { body = JSON.parse(raw); } catch { return reply(400,'INVALID_JSON'); }
      let permit;
      try {
        permit = await authorizeRequest(request.headers, env.AXIOM_CAPABILITY_HMAC_KEY, raw, now());
        verifyBody(body, permit);
      } catch { return reply(403,'CAPABILITY_OR_SCOPE_DENIED'); }
      try {
        // A separate reviewer key attests a short-lived, free-plan account.
        // This cryptographic receipt is not itself proof of actual provider billing.
        await verifyFreeTierAttestation(permit.provider,permit.model,env,now());
      } catch { return reply(503,'FREE_ACCOUNT_PROOF_NOT_VERIFIED'); }
      if (permit.provider === 'groq' && (env.AXIOM_GROQ_FREE_ORG_ATTESTED !== 'TRUE' ||
          !env.AXIOM_GROQ_FREE_PLAN_KEY)) return reply(503,'GROQ_FREE_PLAN_UNVERIFIED');
      if (permit.provider === 'cloudflare' && !env.AI) return reply(503,'CLOUDFLARE_FREE_BINDING_MISSING');
      try {
        await reserveQuota(env.AXIOM_PUBLIC_INFERENCE_D1, permit, now());
      } catch { return reply(429,'ZERO_COST_QUOTA_EXHAUSTED'); }
      try {
        const result = permit.provider === 'cloudflare'
          ? await runCloudflare(env.AI, body)
          : await runGroq(fetchImpl, env.AXIOM_GROQ_FREE_PLAN_KEY, body);
        return new Response(JSON.stringify({
          id: permit.nonce, provider: permit.provider, model: body.model,
          output: result, qualification:'EXTERNAL_PROVIDER_RESPONSE_UNVERIFIED',
        }), {status:200,headers:BASE_HEADERS});
      } catch (error) {
        // Do not expose upstream bodies, secrets, URLs, errors, or auto-fallback.
        return reply(error instanceof ProviderDenied ? error.status : 502, 'PROVIDER_UNAVAILABLE_NO_PAID_FALLBACK');
      }
    }
  };
}
export default createGateway();
