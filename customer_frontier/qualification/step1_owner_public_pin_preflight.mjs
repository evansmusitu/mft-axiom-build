/**
 * MUSITU AXIOM — Step 1 owner public trust-root preflight (NOT RELEASE).
 *
 * Pure/offline verification only: validates user-provided public Ed25519 +
 * X25519 SPKI material and unqualified owner ceremony metadata against
 * separately administered, review-pinned SHA256 fingerprints.
 *
 * A self-issued public pin is NOT independently trusted. Even a passing
 * comparison is a preflight, not proof of owner identity/MFA, private-key
 * possession/recovery, paid usage cap, D1 restore, or any authorization.
 *
 * No network, D1 SQL, Cloudflare credentials, key generation, secrets or write.
 */
import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SOURCE_D1 = 'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f';
export const AMENDMENT_SHA256 = 'cb7f43e1e6b3c28afb88de5a08696dc7b650565a78394eda98e2498c099fb9d5';
export const SCHEMA = 'musitu.axiom.step1.owner-device-public-key-pins.v1';
const PIN = /^[0-9a-f]{64}$/;
const CEREMONY_FIELDS = [
  'schema', 'owner_signing_algorithm', 'owner_encryption_recipient_algorithm',
  'owner_ed25519_spki_sha256', 'owner_x25519_spki_sha256',
  'keys_created_on_owner_device_reported_only',
  'owner_identity_and_mfa_independently_qualified',
  'public_key_pins_approved_for_runtime',
  'current_encrypted_backup_qualified', 'provider_zero_spend_qualified',
  'step1_closed', 'step2_authorized', 'release',
];
const RECEIPT_SUFFIX = '\n';
const sha = value => createHash('sha256').update(value).digest('hex');

export class OwnerPinNoGo extends Error {
  constructor(code) { super(code); this.name = 'OwnerPinNoGo'; this.code = code; }
}
const requirePass = (condition, code) => {
  if (!condition) throw new OwnerPinNoGo(code);
};
function readPublicKey(der, requiredType) {
  requirePass(Buffer.isBuffer(der) && der.length > 24 && der.length < 2048, 'PUBLIC_DER_INVALID');
  let key;
  try { key = createPublicKey({ key: der, format: 'der', type: 'spki' }); }
  catch { throw new OwnerPinNoGo('PUBLIC_DER_INVALID'); }
  requirePass(key.asymmetricKeyType === requiredType, 'PUBLIC_KEY_ALGORITHM_MISMATCH');
  const canonical = key.export({ type: 'spki', format: 'der' });
  requirePass(der.equals(canonical), 'NONCANONICAL_PUBLIC_DER');
  return sha(canonical);
}
function ceremonyReceipt(raw) {
  requirePass(typeof raw === 'string' && Buffer.byteLength(raw, 'utf8') < 4096, 'RECEIPT_INVALID');
  let data;
  try { data = JSON.parse(raw); } catch { throw new OwnerPinNoGo('RECEIPT_INVALID_JSON'); }
  requirePass(data && typeof data === 'object' && !Array.isArray(data), 'RECEIPT_INVALID');
  requirePass(Object.keys(data).sort().join('|') === CEREMONY_FIELDS.slice().sort().join('|'), 'RECEIPT_UNREVIEWED_FIELDS');
  // Matches exactly the Python3 json.dumps(sort_keys=True, indent=2) output
  // of the existing owner-device ceremony. Duplicate JSON keys, whitespace
  // drift and ambiguous representations fail closed.
  const canonicalSorted = Object.fromEntries(Object.keys(data).sort().map(k => [k, data[k]]));
  requirePass(raw === JSON.stringify(canonicalSorted, null, 2) + RECEIPT_SUFFIX, 'NONCANONICAL_RECEIPT');
  requirePass(data.schema === SCHEMA && data.owner_signing_algorithm === 'Ed25519' &&
              data.owner_encryption_recipient_algorithm === 'X25519', 'RECEIPT_SCHEMA_OR_ALGORITHM_DRIFT');
  requirePass(data.keys_created_on_owner_device_reported_only === true &&
              data.owner_identity_and_mfa_independently_qualified === false &&
              data.public_key_pins_approved_for_runtime === false &&
              data.current_encrypted_backup_qualified === false &&
              data.provider_zero_spend_qualified === false &&
              data.step1_closed === false && data.step2_authorized === false &&
              data.release === 'NOT_RELEASE', 'UNQUALIFIED_GATE_REWRITTEN');
  requirePass(PIN.test(data.owner_ed25519_spki_sha256) && PIN.test(data.owner_x25519_spki_sha256), 'RECEIPT_PIN_INVALID');
  return data;
}
/**
 * This function NEVER authorizes the D1 recovery or marks actual owner MFA as verified.
 * External trusted pins MUST be provided independently of ceremonyReceiptRaw;
 * callers must never silently substitute the receipt's asserted pins.
 */
export function verifyOwnerPublicPins({ signingDer, recipientDer, ceremonyReceiptRaw,
  trustedSigningSpkiSha256, trustedRecipientSpkiSha256 }) {
  requirePass(PIN.test(trustedSigningSpkiSha256 ?? '') &&
              PIN.test(trustedRecipientSpkiSha256 ?? ''), 'EXTERNAL_TRUST_ROOTS_REQUIRED');
  const signer = readPublicKey(signingDer, 'ed25519');
  const recipient = readPublicKey(recipientDer, 'x25519');
  requirePass(signer !== recipient, 'SIGNING_AND_RECIPIENT_KEYS_NOT_SEPARATED');
  const receipt = ceremonyReceipt(ceremonyReceiptRaw);
  requirePass(signer === receipt.owner_ed25519_spki_sha256 &&
              recipient === receipt.owner_x25519_spki_sha256, 'CEREMONY_RECEIPT_PIN_MISMATCH');
  requirePass(signer === trustedSigningSpkiSha256 &&
              recipient === trustedRecipientSpkiSha256, 'EXTERNAL_TRUST_PIN_MISMATCH');
  return Object.freeze({
    schema: 'musitu.axiom.step1.owner-public-pin-preflight.v1',
    status: 'PUBLIC_PINS_MATCH_EXTERNAL_TRUST_PRECHECK_ONLY_NO_GO',
    source_database: SOURCE_D1,
    governance_amendment_sha256: AMENDMENT_SHA256,
    owner_ed25519_spki_sha256: signer,
    owner_x25519_spki_sha256: recipient,
    owner_ceremony_receipt_sha256: sha(Buffer.from(ceremonyReceiptRaw, 'utf8')),
    public_spki_formats_and_pins_qualified: true,
    independent_real_owner_identity_and_mfa_qualified: false,
    actual_owner_key_possession_and_recovery_qualified: false,
    owner_signed_exact_recovery_plan_verified: false,
    source_backup_encrypted_and_restorable: false,
    disposable_target_cost_and_creation_approved: false,
    hosted_restore_parity_qualified: false,
    historical_independent_custody_passed: false,
    b27_synthetic_cas: 'FAIL',
    pr83_fullstack: 'FAIL',
    step1_closed: false,
    step2_authorized: false,
    release_authorized: false,
    release_status: 'NOT_RELEASE',
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    requirePass(process.argv.length === 5, 'THREE_PUBLIC_INPUT_FILES_REQUIRED');
    const [signingFile, recipientFile, receiptFile] = process.argv.slice(2);
    const evidence = verifyOwnerPublicPins({
      signingDer: readFileSync(signingFile),
      recipientDer: readFileSync(recipientFile),
      ceremonyReceiptRaw: readFileSync(receiptFile, 'utf8'),
      trustedSigningSpkiSha256: process.env.AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256,
      trustedRecipientSpkiSha256: process.env.AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256,
    });
    process.stdout.write(JSON.stringify(evidence) + '\n');
  } catch (error) {
    process.stderr.write('AXIOM_OWNER_PUBLIC_PIN_NO_GO:' +
      (error instanceof OwnerPinNoGo ? error.code : 'PUBLIC_INPUT_UNAVAILABLE') + '\n');
    process.exitCode = 2;
  }
}
