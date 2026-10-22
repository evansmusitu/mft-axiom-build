/**
 * MUSITU Connect customer JSON transport boundary — research-only.
 * NOT imported by production_worker.mjs and NOT an admission mechanism.
 * Intended for future authenticated, quota-reserved customer routes.
 *
 * Bounds the *actual UTF-8 transport bytes* rather than trusting declared
 * Content-Length or UTF-16 JavaScript string length. Semantic validation,
 * duplicate JSON property detection, customer authorization, and rate limits
 * are separate mandatory gates. Never forward unvalidated records to Axiom.
 */
export const MAX_CUSTOMER_JSON_BYTES = 65_536;
const failure = (status, error) => ({ok:false, status, error});
const contentType = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

export async function readBoundedCustomerJson(request) {
  if (!request || request.method !== 'POST') {
    return failure(405, 'METHOD_NOT_ALLOWED');
  }
  const headers = request.headers;
  if (!headers || typeof headers.get !== 'function' ||
      !contentType.test(headers.get('content-type') || '')) {
    return failure(415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  const encoding = headers.get('content-encoding');
  if (encoding !== null && encoding.toLowerCase() !== 'identity') {
    return failure(415, 'UNSUPPORTED_CONTENT_ENCODING');
  }

  const lengthHeader = headers.get('content-length');
  let declaredBytes = null;
  if (lengthHeader !== null) {
    if (!/^[0-9]{1,20}$/.test(lengthHeader)) {
      return failure(400, 'INVALID_CONTENT_LENGTH');
    }
    declaredBytes = Number(lengthHeader);
    if (!Number.isSafeInteger(declaredBytes)) {
      return failure(400, 'INVALID_CONTENT_LENGTH');
    }
    if (declaredBytes > MAX_CUSTOMER_JSON_BYTES) {
      return failure(413, 'PAYLOAD_TOO_LARGE');
    }
  }

  if (!request.body || typeof request.body.getReader !== 'function') {
    return failure(400, 'INVALID_JSON');
  }
  let reader;
  const chunks = [];
  let total = 0;
  try {
    reader = request.body.getReader();
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) return failure(400, 'INVALID_JSON');
      total += value.byteLength;
      if (total > MAX_CUSTOMER_JSON_BYTES) {
        // Cancel best-effort without allowing a malicious stream's cancel()
        // implementation to keep the caller waiting.
        void reader.cancel().catch(() => {});
        return failure(413, 'PAYLOAD_TOO_LARGE');
      }
      chunks.push(value);
    }
  } catch {
    return failure(400, 'INVALID_JSON');
  } finally {
    if (reader) {
      try { reader.releaseLock(); } catch { /* no user detail escapes */ }
    }
  }

  if (declaredBytes !== null && total !== declaredBytes) {
    return failure(400, 'INVALID_CONTENT_LENGTH');
  }
  if (total === 0) return failure(400, 'INVALID_JSON');
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    const json = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
    const body = JSON.parse(json);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return failure(400, 'INVALID_JSON');
    }
    return {ok:true, body};
  } catch {
    return failure(400, 'INVALID_JSON');
  }
}
