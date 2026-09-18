const encoder = new TextEncoder();

export const PHASE_ORDER = Object.freeze(['AR-03','AR-04','AR-05','AR-06','AR-07','AR-08','AR-09','AR-10','AR-11']);
export const RISK_CLASSES = Object.freeze(['S0','S1','S2','S3','S4','S5']);

export function clean(value, max=1000) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0,max);
}

export function clone(value) {
  return structuredClone(value);
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(typeof value === 'string' ? value : canonical(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}

export function validSha(value) {
  return /^[0-9a-f]{64}$/i.test(String(value || ''));
}

export function validCommit(value) {
  return /^[0-9a-f]{40}$/i.test(String(value || ''));
}

export function iso(value=new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('valid timestamp required');
  return date.toISOString();
}

export function requireText(value, label, max=240) {
  const out = clean(value,max);
  if (!out) throw new TypeError(`${label} required`);
  return out;
}

export function uniqueStrings(values, max=180) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(v => clean(v,max)).filter(Boolean))].sort();
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function phaseIndex(phase) {
  return PHASE_ORDER.indexOf(clean(phase,16).toUpperCase());
}

export function previousPhase(phase) {
  const i = phaseIndex(phase);
  return i <= 0 ? null : PHASE_ORDER[i-1];
}

export function riskIndex(risk) {
  return RISK_CLASSES.indexOf(clean(risk,8).toUpperCase());
}

export function ensureNoSecretLike(value, label='value') {
  const text = typeof value === 'string' ? value : canonical(value);
  const rx = /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|private[_ -]?key|authorization|client[_ -]?secret)["']?\s*[:=]|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{10,}|\bbearer\s+[A-Za-z0-9._~-]{10,}/i;
  if (rx.test(text)) throw new DOMException(`${label} contains plaintext secret-like material`, 'SecurityError');
}

export async function seal(schema, body) {
  if (!schema) throw new TypeError('schema required');
  const payload = {schema, ...clone(body)};
  return deepFreeze({...payload, sha256: await sha256(payload)});
}

export async function verifySeal(value) {
  if (!value || typeof value !== 'object' || !validSha(value.sha256)) return false;
  const body = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'sha256'));
  return await sha256(body) === value.sha256;
}
