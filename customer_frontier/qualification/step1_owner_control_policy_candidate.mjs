/**
 * MUSITU AXIOM Step 1: sole-owner governance transition PROPOSAL (offline only).
 *
 * Independent-custodian / two-human-approval requirement is an owner-directed
 * policy change, NOT historical certification or a bypass of the unchanged
 * PR216 implementation. No Cloudflare calls, SQL, secrets, binding, or mutation.
 * A valid owner signature attests only the exact policy PROPOSAL: it never
 * authorizes database creation, SQL export, restore, Step 2, or release.
 */
import { createPublicKey, createHash, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SOURCE_ACCOUNT='93f395f5121954671f92fffa453d6b61';
export const SOURCE_D1='ccc473f1-fbb5-4b8d-8a24-45f3696ac10f';
export const RETIRED_EXISTING_DR='c023a0a0-472a-4178-ad07-02f1d6b2e122';
export const AMENDMENT_SHA256='cb7f43e1e6b3c28afb88de5a08696dc7b650565a78394eda98e2498c099fb9d5';
export const PROPOSAL_SCHEMA='musitu.axiom.step1.owner-controlled-recovery-proposal.v1';
const APPROVER_KEYS=['public_key_spki_der_base64','signature_base64'];
const PLAN_KEYS=[
 'schema','action','governance_amendment_sha256','source_account','source_database',
 'target_account','new_database_name','owner_encryption_recipient_spki_sha256',
 'issued_at','expires_at','nonce','max_additional_spend_usd',
 'existing_database_changes','customer_data_export_authorized',
 'customer_data_restore_authorized','production_changes','step_2_authorized',
 'independent_custodian_mandatory','owner_accepts_sole_custody_risk',
 'historical_independent_custody_result','b27_synthetic_cas_result',
 'pr83_fullstack_result','release_status'
];
const PIN=/^[0-9a-f]{64}$/;
const NAME=/^axiom-idp-step1-disposable-restore-20\d{6}-[a-f0-9]{8}$/;
function sha(x){return createHash('sha256').update(x).digest('hex')}
export class OwnerPolicyNoGo extends Error {
 constructor(code){super(code);this.code=code;this.name='OwnerPolicyNoGo'}
}
function check(x,code){if(!x)throw new OwnerPolicyNoGo(code)}
function exact(obj,fields,code){
 check(obj!==null && typeof obj==='object' && !Array.isArray(obj),code);
 check(Object.keys(obj).sort().join('|')===fields.slice().sort().join('|'),code);
}
function decode64(text,code){
 check(typeof text==='string'&&text.length>0&&text.length<=2048&&/^[A-Za-z0-9+/]+={0,2}$/.test(text),code);
 const bytes=Buffer.from(text,'base64');
 check(bytes.toString('base64')===text,code);
 return bytes;
}
/**
 * Read-only policy evidence. Returns NO_GO even for a genuinely signed proposal.
 * The pinned owner key and X25519 recipient pin come from trusted external
 * configuration, not solely the self-described proposal.
 */
export function verifyOwnerProposal({payload,owner,trustedOwnerSpkiSha256,
 trustedOwnerRecipientSpkiSha256,now}){
 check(typeof payload==='string'&&Buffer.byteLength(payload,'utf8')<=4096,'BAD_PROPOSAL_PAYLOAD');
 let plan;
 try{plan=JSON.parse(payload)}catch{throw new OwnerPolicyNoGo('INVALID_PROPOSAL_JSON')}
 exact(plan,PLAN_KEYS,'UNREVIEWED_PLAN_FIELDS');
 check(JSON.stringify(plan)===payload,'NONCANONICAL_OR_DUPLICATE_JSON');
 check(plan.schema===PROPOSAL_SCHEMA&&plan.action==='PROPOSE_NEW_DISPOSABLE_D1_ONLY','UNAPPROVED_ACTION');
 check(plan.governance_amendment_sha256===AMENDMENT_SHA256,'UNPINNED_GOVERNANCE_AMENDMENT');
 check(plan.source_account===SOURCE_ACCOUNT&&plan.source_database===SOURCE_D1&&
  plan.target_account===SOURCE_ACCOUNT,'SOURCE_OR_ACCOUNT_DRIFT');
 check(typeof plan.new_database_name==='string'&&NAME.test(plan.new_database_name),'INVALID_TARGET_NAME');
 check(plan.max_additional_spend_usd===0&&plan.existing_database_changes===false&&
  plan.customer_data_export_authorized===false&&plan.customer_data_restore_authorized===false&&
  plan.production_changes===false&&plan.step_2_authorized===false,'UNAUTHORIZED_SIDE_EFFECT');
 check(plan.independent_custodian_mandatory===false&&plan.owner_accepts_sole_custody_risk===true&&
  plan.historical_independent_custody_result==='UNMET_POLICY_SUPERSEDED_NOT_PASS'&&
  plan.b27_synthetic_cas_result==='FAIL'&&plan.pr83_fullstack_result==='FAIL'&&
  plan.release_status==='NOT_RELEASE','HISTORICAL_VETO_OR_RISK_ERASURE');
 check(typeof plan.nonce==='string'&&/^[a-f0-9]{32}$/.test(plan.nonce),'INVALID_PROPOSAL_NONCE');
 const issued=Date.parse(plan.issued_at),expires=Date.parse(plan.expires_at),clock=Date.parse(now);
 check(Number.isFinite(issued)&&Number.isFinite(expires)&&Number.isFinite(clock)&&
  new Date(issued).toISOString()===plan.issued_at&&new Date(expires).toISOString()===plan.expires_at&&
  clock>=issued&&clock<expires&&expires-issued>0&&expires-issued<=24*60*60*1000,'EXPIRED_OR_INVALID_WINDOW');
 check(PIN.test(trustedOwnerSpkiSha256||'')&&PIN.test(trustedOwnerRecipientSpkiSha256||'')&&
  plan.owner_encryption_recipient_spki_sha256===trustedOwnerRecipientSpkiSha256,'TRUST_ANCHORS_NOT_PINNED');
 exact(owner,APPROVER_KEYS,'INVALID_SIGNER_STRUCTURE');
 const der=decode64(owner.public_key_spki_der_base64,'INVALID_OWNER_PUBLIC_KEY_BASE64');
 check(sha(der)===trustedOwnerSpkiSha256,'OWNER_APPROVER_PIN_MISMATCH');
 let key;
 try{key=createPublicKey({key:der,format:'der',type:'spki'})}catch{throw new OwnerPolicyNoGo('INVALID_OWNER_PUBLIC_KEY')}
 check(key.asymmetricKeyType==='ed25519','SIGNER_MUST_BE_ED25519');
 const sig=decode64(owner.signature_base64,'INVALID_OWNER_SIGNATURE_BASE64');
 check(sig.length===64&&verify(null,Buffer.from(payload,'utf8'),key,sig),'OWNER_SIGNATURE_INVALID');
 return Object.freeze({
  schema:'musitu.axiom.step1.owner-policy-proposal-receipt.v1',
  status:'PINNED_OWNER_SIGNATURE_VALID_POLICY_PROPOSAL_ONLY_NO_GO',
  exact_plan_sha256:sha(Buffer.from(payload,'utf8')),
  governance_amendment_sha256:AMENDMENT_SHA256,
  owner_policy_proposal_signature_valid:true,
  mandatory_independent_human_custodian_policy_requested:false,
  historical_independence_test_passed:false,
  human_identity_mfa_qualified:false,
  current_cloudflare_credential_control_qualified:false,
  owner_encryption_key_custody_qualified:false,
  independent_current_backup_qualified:false,
  provider_zero_additional_spend_qualified:false,
  durable_nonce_consumption_qualified:false,
  exact_target_absence_confirmed:false,
  disposable_target_creation_authorized:false,
  customer_sql_export_authorized:false,
  customer_sql_restore_authorized:false,
  hosted_restore_parity_qualified:false,
  tenant_isolation_qualified:false,
  b27_synthetic_cas:'FAIL',
  pr83_fullstack:'FAIL',
  source_database_unchanged:true,
  step_1_closed:false,step_2_authorized:false,release_authorized:false,
  release_status:'NOT_RELEASE'
 });
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 try{
  check(process.argv.length===3,'OWNER_PROPOSAL_FILE_REQUIRED');
  const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
  const result=verifyOwnerProposal({...input,
   trustedOwnerSpkiSha256:process.env.AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256,
   trustedOwnerRecipientSpkiSha256:process.env.AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256,
   now:new Date().toISOString()});
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch(e){
  process.stderr.write('OWNER_POLICY_PROPOSAL_NO_GO:'+(e instanceof OwnerPolicyNoGo?e.code:'INVALID_OWNER_PROPOSAL')+'\n');
  process.exitCode=2;
 }
}
