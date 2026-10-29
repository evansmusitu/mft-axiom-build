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


/**
 * Detect repeated JSON object property names at every nesting level.
 * Call only *after* JSON.parse verifies the grammar. Decoding each property
 * token via JSON.parse catches collisions between escaped and literal keys.
 * At most 128 composite nesting levels; deeper payloads fail closed.
 */

/** Compare numeric JSON lexemes to the shortest round-trippable Number
 * decimal. This rejects silent rounding, underflow and overflow without
 * changing legitimate decimal or scientific-notation numeric values. */
function normalizedDecimal(token) {
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
  if (!match) return null;
  const fraction = match[3] || '';
  let digits = (match[2] + fraction).replace(/^0+/, '');
  if (!digits) return ['0','0','0'];
  const count = digits.length;
  digits = digits.replace(/0+$/, '');
  const exponentText = match[4] || '0';
  if (exponentText.length > 32) return null;
  const exponent = BigInt(exponentText) - BigInt(fraction.length)
    + BigInt(count - digits.length);
  return [match[1] === '-' ? '-' : '+', digits, exponent.toString()];
}

function numberPreservesDecimalValue(token) {
  const converted = Number(token);
  if (!Number.isFinite(converted) || Object.is(converted, -0)) return false;
  const original = normalizedDecimal(token);
  const reproduced = normalizedDecimal(converted.toString());
  return original !== null && reproduced !== null
    && original.every((value, index) => value === reproduced[index]);
}

function inspectJsonObjectTokens(source) {
  let pos = 0;
  let lossy = false;
  const spaces = () => {
    while (pos < source.length && /\s/.test(source[pos])) pos++;
  };
  const stringToken = () => {
    if (source[pos] !== '"') throw new Error('invalid_json');
    const start = pos++;
    while (pos < source.length) {
      const ch = source[pos++];
      if (ch === '\\') {
        pos++; // Ignore the escaped next character, including an escaped quote.
      } else if (ch === '"') {
        const value = JSON.parse(source.slice(start, pos));
        // JSON.parse permits escaped lone surrogates, but UTF-8 encoders
        // replace them with U+FFFD and can collapse distinct signed inputs.
        for (let index = 0; index < value.length; index++) {
          const unit = value.charCodeAt(index);
          if (unit >= 0xD800 && unit <= 0xDBFF) {
            const next = value.charCodeAt(++index);
            if (!(next >= 0xDC00 && next <= 0xDFFF)) throw new Error('invalid_json');
          } else if (unit >= 0xDC00 && unit <= 0xDFFF) {
            throw new Error('invalid_json');
          }
        }
        return value;
      }
    }
    throw new Error('invalid_json');
  };
  const visit = depth => {
    if (depth > 128) throw new Error('json_depth_limit');
    spaces();
    if (source[pos] === '"') {
      stringToken();
      return false;
    }
    if (source[pos] === '{') {
      pos++;
      spaces();
      const seen = new Set();
      if (source[pos] === '}') { pos++; return false; }
      while (pos < source.length) {
        spaces();
        const key = stringToken();
        if (seen.has(key)) return true;
        seen.add(key);
        spaces();
        if (source[pos++] !== ':') throw new Error('invalid_json');
        if (visit(depth + 1)) return true;
        spaces();
        const delimiter = source[pos++];
        if (delimiter === '}') return false;
        if (delimiter !== ',') throw new Error('invalid_json');
      }
      throw new Error('invalid_json');
    }
    if (source[pos] === '[') {
      pos++;
      spaces();
      if (source[pos] === ']') { pos++; return false; }
      while (pos < source.length) {
        if (visit(depth + 1)) return true;
        spaces();
        const delimiter = source[pos++];
        if (delimiter === ']') return false;
        if (delimiter !== ',') throw new Error('invalid_json');
      }
      throw new Error('invalid_json');
    }
    // JSON.parse validates grammar, but it may silently round numeric tokens.
    const start = pos;
    while (pos < source.length && !/[\s,\]}]/.test(source[pos])) pos++;
    const token = source.slice(start, pos);
    if (/^[-0-9]/.test(token) && !numberPreservesDecimalValue(token)) lossy = true;
    return false;
  };
  const duplicate = visit(0);
  if (!duplicate) {
    spaces();
    if (pos !== source.length) throw new Error('invalid_json');
  }
  return {duplicate, lossy};
}

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
    const inspected = inspectJsonObjectTokens(json);
    if (inspected.duplicate) return failure(400, 'DUPLICATE_JSON_KEY');
    if (inspected.lossy) return failure(400, 'NUMERIC_PRECISION_LOSS');
    return {ok:true, body};
  } catch {
    return failure(400, 'INVALID_JSON');
  }
}
