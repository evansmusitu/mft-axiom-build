/**
 * MUSITU AXIOM Step 1 owner-device signed *proposal* utility (NOT RELEASE).
 * An offline-only bridge between public key pinning and the existing
 * verifyOwnerProposal. NEVER generates an owner private key, opens a provider
 * connection, issues SQL, admits D1 creation, or upgrades any release gate.
 *
 * It prepares the exact canonical payload; only an owner-device OpenSSL
 * interactive command signs the payload using an encrypted key. Finalize
 * checks the owner-held signature against independently reviewed trust pins.
 */
import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, lstatSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyOwnerProposal, OwnerPolicyNoGo, AMENDMENT_SHA256, SOURCE_ACCOUNT,
  SOURCE_D1, PROPOSAL_SCHEMA
} from './step1_owner_control_policy_candidate.mjs';

const PIN = /^[0-9a-f]{64}$/;
const SHA = b => createHash('sha256').update(b).digest('hex');
export class OwnerDeviceNoGo extends Error {
  constructor(code) { super(code); this.name = 'OwnerDeviceNoGo'; this.code = code; }
}
const req = (ok, code) => { if (!ok) throw new OwnerDeviceNoGo(code); };
function asPublicPin(der, type) {
  req(Buffer.isBuffer(der) && der.length > 24 && der.length < 2048, 'INVALID_PUBLIC_KEY');
  let key;
  try { key = createPublicKey({key: der, format:'der', type:'spki'}); }
  catch { throw new OwnerDeviceNoGo('INVALID_PUBLIC_KEY'); }
  req(key.asymmetricKeyType === type && key.export({type:'spki', format:'der'}).equals(der), 'WRONG_OR_NONCANONICAL_PUBLIC_KEY');
  return SHA(der);
}
function trustPublicInputs({signingDer, recipientDer, trustedSigningPin, trustedRecipientPin}) {
  req(PIN.test(trustedSigningPin ?? '') && PIN.test(trustedRecipientPin ?? ''), 'EXTERNAL_TRUST_PINS_REQUIRED');
  const signPin = asPublicPin(signingDer, 'ed25519');
  const recPin = asPublicPin(recipientDer, 'x25519');
  req(signPin !== recPin && signPin === trustedSigningPin && recPin === trustedRecipientPin, 'PUBLIC_KEY_TRUST_PIN_MISMATCH');
  return {signPin, recPin};
}
const isoDate = time => {
  const d = time instanceof Date ? time : new Date(time);
  req(Number.isFinite(d.getTime()), 'BAD_CLOCK');
  return d.toISOString();
};
/** Pure, auditable signed-plan input builder. Random source injectable for tests only. */
export function buildUnsignedOwnerProposal({signingDer, recipientDer, trustedSigningPin,
  trustedRecipientPin, now = new Date(), entropy = randomBytes} = {}) {
  const {signPin, recPin} = trustPublicInputs({signingDer,recipientDer,trustedSigningPin,trustedRecipientPin});
  const issued = isoDate(now);
  const expires = new Date(Date.parse(issued) + 15 * 60 * 1000).toISOString();
  const nonce = entropy(16), suffix = entropy(4);
  req(Buffer.isBuffer(nonce) && nonce.length === 16 && Buffer.isBuffer(suffix) && suffix.length === 4, 'BAD_ENTROPY');
  const targetDate = issued.slice(0,10).replaceAll('-', '');
  req(/^20\d{6}$/.test(targetDate), 'DATE_NOT_SUPPORTED');
  const plan = {
    schema:PROPOSAL_SCHEMA,
    action:'PROPOSE_NEW_DISPOSABLE_D1_ONLY',
    governance_amendment_sha256:AMENDMENT_SHA256,
    source_account:SOURCE_ACCOUNT,
    source_database:SOURCE_D1,
    target_account:SOURCE_ACCOUNT,
    new_database_name:`axiom-idp-step1-disposable-restore-${targetDate}-${suffix.toString('hex')}`,
    owner_encryption_recipient_spki_sha256:recPin,
    issued_at:issued,
    expires_at:expires,
    nonce:nonce.toString('hex'),
    max_additional_spend_usd:0,
    existing_database_changes:false,
    customer_data_export_authorized:false,
    customer_data_restore_authorized:false,
    production_changes:false,
    step_2_authorized:false,
    independent_custodian_mandatory:false,
    owner_accepts_sole_custody_risk:true,
    historical_independent_custody_result:'UNMET_POLICY_SUPERSEDED_NOT_PASS',
    b27_synthetic_cas_result:'FAIL',
    pr83_fullstack_result:'FAIL',
    release_status:'NOT_RELEASE',
  };
  const payload = JSON.stringify(plan);
  req(Buffer.byteLength(payload,'utf8') <= 4096, 'BAD_PROPOSAL_SIZE');
  return Object.freeze({payload, plan_sha256:SHA(Buffer.from(payload,'utf8')), owner_signing_spki_sha256:signPin,
    owner_recipient_spki_sha256:recPin, status:'UNSIGNED_OWNER_POLICY_PROPOSAL_ONLY_NO_GO'});
}

/** Verifies a locally signed proposal but cannot ever authorize D1 operations. */
export function verifySignedOwnerProposal({payload,signature,signingDer,recipientDer,trustedSigningPin,
  trustedRecipientPin,now = new Date()} = {}) {
  const {signPin, recPin} = trustPublicInputs({signingDer,recipientDer,trustedSigningPin,trustedRecipientPin});
  req(Buffer.isBuffer(signature) && signature.length === 64, 'BAD_SIGNATURE_BYTES');
  req(typeof payload === 'string', 'INVALID_PROPOSAL_PAYLOAD');
  let original;
  try {
    original = verifyOwnerProposal({payload,owner:{public_key_spki_der_base64:signingDer.toString('base64'),
      signature_base64:signature.toString('base64')},trustedOwnerSpkiSha256:signPin,
      trustedOwnerRecipientSpkiSha256:recPin,now:isoDate(now)});
  } catch (e) {
    throw new OwnerDeviceNoGo(e instanceof OwnerPolicyNoGo ? e.code : 'INVALID_SIGNED_PROPOSAL');
  }
  req(original.release_authorized === false && original.step_1_closed === false &&
    original.disposable_target_creation_authorized === false, 'UNSAFE_ORIGINAL_POLICY_RECEIPT');
  return Object.freeze({
    schema:'musitu.axiom.step1.owner-device-signed-proposal-receipt.v1',
    status:'OWNER_SIGNATURE_VALID_PROPOSAL_ONLY_NO_GO',
    proposal_sha256:original.exact_plan_sha256,
    governance_amendment_sha256:AMENDMENT_SHA256,
    owner_signing_spki_sha256:signPin,
    owner_recipient_spki_sha256:recPin,
    signature_valid_for_exact_proposal:true,
    actual_owner_identity_and_mfa_qualified:false,
    runtime_pins_independently_activated:false,
    source_customer_sql_export_authorized:false,
    disposable_target_creation_authorized:false,
    current_encrypted_backup_qualified:false,
    hosted_restore_and_tenant_parity_qualified:false,
    zero_additional_spend_qualified:false,
    historical_independence_passed:false,
    b27_synthetic_cas:'FAIL',pr83_fullstack:'FAIL',
    step_1_closed:false,step_2_authorized:false,release_authorized:false,
    release_status:'NOT_RELEASE',
  });
}
function noSymlinkFile(path) {
  const stat=lstatSync(path);
  req(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4096, 'INVALID_LOCAL_PUBLIC_INPUT');
  return readFileSync(path);
}
function keysForDevice(keyDir) {
  const dir=resolve(keyDir);
  return {
    signingDer:noSymlinkFile(join(dir,'public','owner_ed25519_spki.der')),
    recipientDer:noSymlinkFile(join(dir,'public','owner_x25519_spki.der')),
  };
}
function validatedEnvironment() {
  return {trustedSigningPin:process.env.AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256,
    trustedRecipientPin:process.env.AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256};
}
/** No private PEM ever read. Output dir is new and mode 0700. */
export function prepareLocalProposal(keyDir, outputDir, now = new Date()) {
  const keys=keysForDevice(keyDir),trusted=validatedEnvironment();
  const proposal=buildUnsignedOwnerProposal({...keys,...trusted,now});
  const out=resolve(outputDir);
  req(!existsSync(out), 'OUTPUT_ALREADY_EXISTS');
  mkdirSync(out,{mode:0o700,recursive:false});
  writeFileSync(join(out,'OWNER_PROPOSAL_PAYLOAD.json'),proposal.payload,{flag:'wx',mode:0o600});
  writeFileSync(join(out,'OWNER_PREPARATION_NO_GO.json'),JSON.stringify({
    schema:'musitu.axiom.step1.owner-signed-proposal.preparation.v1',...proposal,
    step_1_closed:false,release_status:'NOT_RELEASE'})+'\n',{flag:'wx',mode:0o600});
  return proposal;
}
/** Finalize reads only public SPKI and signature bytes, not private PEM. */
export function finalizeLocalProposal(keyDir, outputDir, now = new Date()) {
  const keys=keysForDevice(keyDir),trusted=validatedEnvironment();
  const out=resolve(outputDir);
  req(lstatSync(out).isDirectory() && !lstatSync(out).isSymbolicLink(), 'INVALID_OUTPUT_DIRECTORY');
  const payload=noSymlinkFile(join(out,'OWNER_PROPOSAL_PAYLOAD.json')).toString('utf8');
  const sig=noSymlinkFile(join(out,'OWNER_SIGNATURE.bin'));
  const receipt=verifySignedOwnerProposal({...keys,...trusted,payload,signature:sig,now});
  const owner={public_key_spki_der_base64:keys.signingDer.toString('base64'),signature_base64:sig.toString('base64')};
  req(!existsSync(join(out,'OWNER_SIGNED_PROPOSAL_NOT_AUTHORITY.json')) &&
      !existsSync(join(out,'OWNER_SIGNATURE_PROPOSAL_ONLY_NO_GO.json')), 'SIGNED_RECEIPT_ALREADY_EXISTS');
  writeFileSync(join(out,'OWNER_SIGNED_PROPOSAL_NOT_AUTHORITY.json'),JSON.stringify({payload,owner})+'\n',{flag:'wx',mode:0o600});
  writeFileSync(join(out,'OWNER_SIGNATURE_PROPOSAL_ONLY_NO_GO.json'),JSON.stringify(receipt)+'\n',{flag:'wx',mode:0o600});
  return receipt;
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  try {
    req(process.argv.length===5,'USAGE_PREPARE_OR_FINALIZE_KEYS_DIR_NEW_OUTPUT_DIR');
    const mode=process.argv[2];
    req(mode==='prepare'||mode==='finalize','INVALID_MODE');
    if(mode==='prepare') prepareLocalProposal(process.argv[3],process.argv[4]);
    else finalizeLocalProposal(process.argv[3],process.argv[4]);
    process.stdout.write('AXIOM_OWNER_SIGNED_PROPOSAL_LOCAL_ONLY_NO_GO_NOT_RELEASE\n');
  }catch(e){
    process.stderr.write('AXIOM_OWNER_PROPOSAL_NO_GO:'+(e instanceof OwnerDeviceNoGo?e.code:'LOCAL_PROPOSAL_PRECONDITION_FAILED')+'\n');
    process.exitCode=2;
  }
}
