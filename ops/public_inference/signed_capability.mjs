/** Independent, issuer-signed capability verifier. No token issuer in gateway. */
const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/;
const PROVIDER_MODELS = Object.freeze({cloudflare:'@cf/zai-org/glm-4.7-flash',groq:'openai/gpt-oss-120b'});
export async function sha256hex(data) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))), x=>x.toString(16).padStart(2,'0')).join('');
}
export async function authorizeRequest(headers, key, raw, now) {
  const token = headers.get('x-axiom-signed-capability') || '';
  const signature = headers.get('x-axiom-capability-hmac') || '';
  if (token.length < 20 || token.length > 2300 || !/^[A-Za-z0-9_-]+$/.test(token) || !HEX64.test(signature)) throw Error('DENIED');
  if (typeof key !== 'string' || key.length < 48 || key.length > 256) throw Error('DENIED');
  let claims;
  try {
    const buffer = Uint8Array.from(atob(token.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
    claims = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));
  } catch { throw Error('DENIED'); }
  const signingKey = await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const valid = await crypto.subtle.verify('HMAC',signingKey,Uint8Array.from(signature.match(/../g),b=>parseInt(b,16)),new TextEncoder().encode(token));
  if (!valid || !claims || typeof claims !== 'object' || Array.isArray(claims)) throw Error('DENIED');
  const fields = ['schema','subject','project','nonce','provider','model','request_sha256','classification','consent','max_tokens','issued_ms','expires_ms','risk_class','external_read_only','public_release_authority'];
  if (Object.keys(claims).sort().join('|') !== fields.sort().join('|')) throw Error('DENIED');
  if (claims.schema !== 'musitu.axiom.public-inference-capability.v1' ||
      typeof claims.subject !== 'string' || !ID.test(claims.subject) ||
      typeof claims.project !== 'string' || !ID.test(claims.project) ||
      typeof claims.nonce !== 'string' || !HEX64.test(claims.nonce) ||
      claims.model !== PROVIDER_MODELS[claims.provider] || !HEX64.test(claims.request_sha256) ||
      claims.classification !== 'EXTERNAL_PROVIDER_APPROVED' || claims.consent !== true ||
      claims.risk_class !== 'S2' || claims.external_read_only !== true || claims.public_release_authority !== false ||
      !Number.isSafeInteger(claims.max_tokens) || claims.max_tokens < 1 || claims.max_tokens > 256 ||
      !Number.isSafeInteger(claims.issued_ms) || !Number.isSafeInteger(claims.expires_ms) ||
      claims.expires_ms - claims.issued_ms > 60000 || claims.expires_ms <= claims.issued_ms ||
      now < claims.issued_ms || now >= claims.expires_ms ||
      await sha256hex(raw) !== claims.request_sha256) throw Error('DENIED');
  return claims;
}
