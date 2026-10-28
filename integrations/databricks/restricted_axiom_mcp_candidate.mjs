/* Staging-only policy candidate for Databricks -> MUSITU Axiom MCP.
 *
 * NO DEPLOYMENT: This module does not authenticate a Databricks connection,
 * issue service credentials, or forward to production Axiom. A separate,
 * independently admitted server-to-server identity and an audited upstream
 * executor are required before shipping this design.
 *
 * Never pass ordinary customer keys, ChatGPT OAuth access/refresh tokens, or
 * unrestricted musitu_axiom_execute through this path.
 */
export const ALLOWED_TOOL_NAMES = Object.freeze([
  'investment_npv', 'option_black_scholes', 'historical_var',
]);
const ALLOWED = new Set(ALLOWED_TOOL_NAMES);

const plain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const keys = (obj, exact) => plain(obj) &&
  Object.keys(obj).length === exact.length &&
  exact.every(name => Object.prototype.hasOwnProperty.call(obj, name));

function requireNumeric(v, min, max, exclusiveMin = false) {
  return finite(v) && (exclusiveMin ? v > min : v >= min) && v <= max;
}

export function validateNativeToolArgs(name, args) {
  if (!ALLOWED.has(name)) throw new Error('denied: unapproved MCP tool');
  if (name === 'investment_npv') {
    if (!keys(args, ['rate', 'cashflows']) ||
        !requireNumeric(args.rate, -0.99, 2.0) ||
        !Array.isArray(args.cashflows) ||
        args.cashflows.length < 2 || args.cashflows.length > 64 ||
        !args.cashflows.every(v => requireNumeric(v, -1e12, 1e12)))
      throw new Error('invalid NPV argument contract');
  } else if (name === 'option_black_scholes') {
    if (!keys(args, ['S', 'K', 'T', 'r', 'sigma', 'kind']) ||
        !requireNumeric(args.S, 0, 1e9, true) ||
        !requireNumeric(args.K, 0, 1e9, true) ||
        !requireNumeric(args.T, 0, 30, true) ||
        !requireNumeric(args.r, -1, 2) ||
        !requireNumeric(args.sigma, 0, 5, true) ||
        !['call', 'put'].includes(args.kind))
      throw new Error('invalid Black-Scholes argument contract');
  } else if (name === 'historical_var') {
    if (!keys(args, ['returns', 'alpha']) ||
        !Array.isArray(args.returns) ||
        args.returns.length < 5 || args.returns.length > 2048 ||
        !args.returns.every(v => requireNumeric(v, -1, 10)) ||
        !requireNumeric(args.alpha, .5, .999999, true))
      throw new Error('invalid VaR argument contract');
  }
  return structuredClone(args);
}

function constantTimeHexEq(a, b) {
  if (a.length !== 64 || b.length !== 64) return false;
  let mismatch = 0;
  for (let i = 0; i < 64; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function verifyDedicatedServiceToken(authorization, sha256Hex) {
  if (typeof authorization !== 'string' || typeof sha256Hex !== 'string' ||
      !/^[a-f0-9]{64}$/.test(sha256Hex)) return false;
  const m = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(authorization);
  if (!m) return false;
  if (!globalThis.crypto?.subtle) throw new Error('crypto-unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(m[1]));
  const received = Array.from(new Uint8Array(digest), v =>
    v.toString(16).padStart(2, '0')).join('');
  return constantTimeHexEq(received, sha256Hex);
}

export async function authorizeAndValidate(message, auth, serviceTokenSha256) {
  // Authenticate before disclosing tool availability or validating arguments.
  if (!await verifyDedicatedServiceToken(auth, serviceTokenSha256))
    throw new Error('unauthorized: dedicated Databricks Axiom identity required');
  if (!plain(message) || message.jsonrpc !== '2.0' ||
      message.method !== 'tools/call' || !plain(message.params) ||
      !keys(message.params, ['name', 'arguments']))
    throw new Error('denied: non-call or malformed MCP request');
  const name = message.params.name;
  if (!ALLOWED.has(name)) throw new Error('denied: unapproved MCP tool');
  const argumentsObject = message.params.arguments;
  if (!keys(argumentsObject, ['args']))
    throw new Error('invalid: unexpected tool argument wrapper');
  const validated = validateNativeToolArgs(name, argumentsObject.args);
  return Object.freeze({name, args: validated});
}

export async function executeApprovedCall(message, auth, serviceTokenSha256, upstreamExecutor) {
  if (typeof upstreamExecutor !== 'function')
    throw new Error('denied: trusted executor not configured');
  const admitted = await authorizeAndValidate(message, auth, serviceTokenSha256);
  // Never forward the original client JSON, arbitrary operation names, or
  // unauthenticated headers; the trusted executor enforces tenant quota/audit.
  return upstreamExecutor(admitted.name, admitted.args);
}
