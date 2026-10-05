const KEY_BYTES = 32;

function bytesToBase64(bytes) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value) {
  const raw = atob(String(value));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

export async function importSupportDataKey(base64) {
  const bytes = base64ToBytes(base64);
  if (bytes.length !== KEY_BYTES) throw new TypeError('support data key must decode to exactly 32 bytes');
  return crypto.subtle.importKey('raw', bytes, {name: 'AES-GCM'}, false, ['encrypt', 'decrypt']);
}

export async function encryptSupportPayload(value, {key, caseId, schema = 'musitu.axiom.support-encrypted-payload.v1'} = {}) {
  if (!key) throw new TypeError('encryption key required');
  if (!caseId) throw new TypeError('caseId required');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`${schema}:${caseId}`);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: aad, tagLength: 128}, key, plaintext);
  return Object.freeze({schema, algorithm: 'A256GCM', iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext))});
}

export async function decryptSupportPayload(envelope, {key, caseId} = {}) {
  if (!key) throw new TypeError('encryption key required');
  if (!envelope || envelope.algorithm !== 'A256GCM' || !envelope.schema) throw new TypeError('valid support envelope required');
  const aad = new TextEncoder().encode(`${envelope.schema}:${caseId}`);
  try {
    const plaintext = await crypto.subtle.decrypt({name: 'AES-GCM', iv: base64ToBytes(envelope.iv), additionalData: aad, tagLength: 128}, key, base64ToBytes(envelope.ciphertext));
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new DOMException('support payload authentication failed', 'DataError');
  }
}
