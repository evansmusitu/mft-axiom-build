/** Hard-coded free-tier candidate providers. Not a metered-service entitlement. */
export class ProviderDenied extends Error {
  constructor(code,status=502) { super(code); this.status=status; }
}
export async function runCloudflare(binding, request) {
  if (!binding || typeof binding.run !== 'function' || request.model !== '@cf/zai-org/glm-4.7-flash') throw new ProviderDenied('NOT_APPROVED');
  // Worker AI binding avoids accidental third-party Unified Billing routes.
  let result;
  try {
    result = await binding.run('@cf/zai-org/glm-4.7-flash',{
      messages:request.messages,max_completion_tokens:request.max_tokens,stream:false,
    });
  } catch { throw new ProviderDenied('PROVIDER_FAILURE'); }
  const text = typeof result?.response === 'string' ? result.response : result?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.length > 12000) throw new ProviderDenied('INVALID_PROVIDER_RESULT');
  return text;
}
export async function runGroq(fetchImpl, key, request) {
  if (typeof key !== 'string' || key.length < 16 || /[\r\n]/.test(key) || request.model !== 'openai/gpt-oss-120b') throw new ProviderDenied('NOT_APPROVED');
  let response;
  try {
    response = await fetchImpl('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',redirect:'error',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},
      body:JSON.stringify({model:request.model,messages:request.messages,max_completion_tokens:request.max_tokens,stream:false}),
      signal:AbortSignal.timeout(12000),
    });
  } catch { throw new ProviderDenied('PROVIDER_FAILURE'); }
  if (response.status===429) throw new ProviderDenied('FREE_TIER_EXHAUSTED',429);
  if (!response.ok) throw new ProviderDenied('PROVIDER_FAILURE');
  // Cap response bytes WHILE receiving them, not after allocating an entire
  // untrusted upstream body. JSON/UTF-8 decoding also fails closed.
  const type = response.headers?.get('content-type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(type)) throw new ProviderDenied('INVALID_PROVIDER_MEDIA_TYPE');
  const reader = response.body?.getReader?.();
  if (!reader || typeof reader.read !== 'function' || typeof reader.cancel !== 'function')
    throw new ProviderDenied('BOUNDED_STREAM_REQUIRED');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const piece = await reader.read();
      if (piece.done) break;
      if (!(piece.value instanceof Uint8Array)) throw new ProviderDenied('INVALID_PROVIDER_CHUNK');
      size += piece.value.byteLength;
      if (size > 40000) throw new ProviderDenied('RESPONSE_TOO_LARGE');
      chunks.push(piece.value);
    }
  } catch {
    try { await reader.cancel(); } catch {} // never leak upstream body/errors
    throw new ProviderDenied('PROVIDER_STREAM_REJECTED');
  } finally { try { reader.releaseLock?.(); } catch {} }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  let parsed;
  try { parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer)); }
  catch { throw new ProviderDenied('INVALID_PROVIDER_RESULT'); }
  const text=parsed?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.length>12000) throw new ProviderDenied('INVALID_PROVIDER_RESULT');
  return text;
}
