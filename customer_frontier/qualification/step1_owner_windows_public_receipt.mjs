/**
 * MUSITU AXIOM Step1 Windows owner-device PUBLIC receipt only (NOT RELEASE).
 * This helper handles only two public SPKI DER files. No private PEM access,
 * credentials, network, database, spend or authorization.
 */
import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const deny = code => { throw new Error('OWNER_WINDOWS_PUBLIC_NO_GO:' + code); };
const expected = [
  ['owner_ed25519_spki.der', 'ed25519'],
  ['owner_x25519_spki.der', 'x25519'],
];
function publicDer(path, algorithm) {
  let stat, contents, key;
  try {
    stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 24 || stat.size >= 2048) deny('INVALID_PUBLIC_FILE');
    contents = readFileSync(path);
    key = createPublicKey({ key: contents, type:'spki', format:'der' });
  } catch { deny('INVALID_PUBLIC_FILE'); }
  if (key.asymmetricKeyType !== algorithm ||
      !key.export({type:'spki',format:'der'}).equals(contents)) deny('WRONG_OR_NONCANONICAL_PUBLIC_KEY');
  return sha(contents);
}
export function buildReceipt(publicDir) {
  const dir = resolve(publicDir);
  if (lstatSync(dir).isSymbolicLink()) deny('SYMLINK_PUBLIC_DIRECTORY');
  const signing = publicDer(join(dir,expected[0][0]), expected[0][1]);
  const recipient = publicDer(join(dir,expected[1][0]), expected[1][1]);
  if (signing === recipient) deny('UNSEPARATED_PUBLIC_KEYS');
  const receipt = {
    schema:'musitu.axiom.step1.owner-device-public-key-pins.v1',
    owner_signing_algorithm:'Ed25519',
    owner_encryption_recipient_algorithm:'X25519',
    owner_ed25519_spki_sha256:signing,
    owner_x25519_spki_sha256:recipient,
    keys_created_on_owner_device_reported_only:true,
    owner_identity_and_mfa_independently_qualified:false,
    public_key_pins_approved_for_runtime:false,
    current_encrypted_backup_qualified:false,
    provider_zero_spend_qualified:false,
    step1_closed:false,
    step2_authorized:false,
    release:'NOT_RELEASE',
  };
  // Existing preflight requires Python json.dumps(sort_keys=True, indent=2) shape.
  return JSON.stringify(Object.fromEntries(Object.entries(receipt).sort(([a],[b])=>a<b?-1:a>b?1:0)),null,2)+'\n';
}
export function writeReceipt(publicDir) {
  const raw = buildReceipt(publicDir);
  writeFileSync(join(resolve(publicDir),'OWNER_PUBLIC_PINS_NOT_ATTESTATION.json'),raw,{flag:'wx',mode:0o600});
  return 'OWNER_WINDOWS_PUBLIC_RECEIPT_ONLY_NO_GO_NOT_RELEASE';
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.argv.length !== 3) deny('PUBLIC_DIRECTORY_REQUIRED');
    process.stdout.write(writeReceipt(process.argv[2])+'\n');
  } catch (e) {
    process.stderr.write((String(e.message).startsWith('OWNER_WINDOWS_PUBLIC_NO_GO:')?e.message:'OWNER_WINDOWS_PUBLIC_NO_GO:UNTRUSTED_PUBLIC_INPUT')+'\n');
    process.exitCode=2;
  }
}
