const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TOKEN_LIMIT = 2048;

function result(ok, code) {
  return Object.freeze({ok, code});
}

export async function verifyTurnstile({
  token,
  secret,
  expectedHostname,
  expectedAction = 'support_case_create',
  fetchImpl = fetch,
  uuid = () => crypto.randomUUID(),
  timeoutMs = 5000,
} = {}) {
  const proof = String(token || '');
  if (!proof) return result(false, 'TURNSTILE_PROOF_REQUIRED');
  if (proof.length > TOKEN_LIMIT || /[\u0000-\u001f\u007f]/.test(proof)) return result(false, 'TURNSTILE_PROOF_INVALID');
  if (!secret || !expectedHostname || !expectedAction || typeof fetchImpl !== 'function') return result(false, 'TURNSTILE_NOT_CONFIGURED');

  const body = new URLSearchParams({
    secret: String(secret),
    response: proof,
    idempotency_key: String(uuid()),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body,
      signal: controller.signal,
    });
    if (!response.ok) return result(false, 'TURNSTILE_UNAVAILABLE');
    const value = await response.json();
    if (value?.success !== true) return result(false, 'TURNSTILE_REJECTED');
    if (value.hostname !== expectedHostname || value.action !== expectedAction) return result(false, 'TURNSTILE_CONTEXT_MISMATCH');
    return result(true, 'TURNSTILE_VERIFIED');
  } catch {
    return result(false, 'TURNSTILE_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}
