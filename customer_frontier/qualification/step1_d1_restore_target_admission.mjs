/**
 * MUSITU AXIOM: Step 1 staging D1 restore-target creation approval and topology gate.
 * Offline only. No Cloudflare calls, mutations, customer SQL, secret or token writes.
 * Two distinct valid signatures only demonstrate cryptographic control of keys.
 * They cannot independently prove the owner/custodian are separate real people
 * or that a provider has approved a zero-spend creation. No D1 mutation is authorized.
 */
import { createPublicKey, verify, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SOURCE_ACCOUNT='93f395f5121954671f92fffa453d6b61';
export const SOURCE_D1='ccc473f1-fbb5-4b8d-8a24-45f3696ac10f';
export const OAUTH_DR_RESERVED='c023a0a0-472a-4178-ad07-02f1d6b2e122';
const SCHEMA='musitu.axiom.step1.disposable-d1-creation-approval.v1';
const SAFE_NAME=/^axiom-idp-step1-disposable-restore-20\d{6}-[a-f0-9]{8}$/;
const PIN=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class NoGo extends Error {
  constructor(code){super(code);this.name='NoGo';this.code=code}
}
function assert(condition,code){if(!condition)throw new NoGo(code)}
function sha(data){return createHash('sha256').update(data).digest('hex')}
function exact(obj,keys,code){
  assert(obj&&typeof obj==='object'&&!Array.isArray(obj),code);
  assert(Object.keys(obj).sort().join('|')===keys.slice().sort().join('|'),code);
}
function b64(value){
  assert(typeof value==='string'&&value.length<=5000&&/^[A-Za-z0-9+/]+={0,2}$/.test(value),'INVALID_BASE64');
  const bytes=Buffer.from(value,'base64');
  assert(bytes.toString('base64')===value,'NONCANONICAL_BASE64');
  return bytes;
}
/** Checks two pin-matched signatures offline; never independently grants cloud authority. */
export function verifyApproval({payload,owner,custodian,ownerTrustedSpkiSha256,custodianTrustedSpkiSha256,now}) {
  assert(typeof payload==='string'&&Buffer.byteLength(payload,'utf8')<=4096,'BAD_APPROVAL_PAYLOAD');
  const plan=JSON.parse(payload);
  exact(plan,['schema','action','source_account','source_database','target_account','new_database_name',
    'expires_at','issued_at','nonce','max_additional_spend_usd','existing_database_changes',
    'production_changes','customer_data_restore_authorized','independent_restore_qualified',
    'release_authority'], 'UNREVIEWED_PLAN_FIELDS');
  assert(plan.schema===SCHEMA && plan.action==='CREATE_NEW_DISPOSABLE_D1_ONLY','INCORRECT_ACTION');
  assert(plan.source_account===SOURCE_ACCOUNT && plan.source_database===SOURCE_D1 &&
    plan.target_account===SOURCE_ACCOUNT,'SOURCE_OR_ACCOUNT_DRIFT');
  assert(typeof plan.new_database_name==='string'&&SAFE_NAME.test(plan.new_database_name),'UNAPPROVED_TARGET_NAME');
  assert(plan.max_additional_spend_usd===0 && plan.existing_database_changes===false &&
    plan.production_changes===false && plan.customer_data_restore_authorized===false &&
    plan.independent_restore_qualified===false && plan.release_authority===false,'UNAUTHORIZED_OPERATION');
  assert(typeof plan.nonce==='string'&&/^[a-f0-9]{32}$/.test(plan.nonce),'BAD_REQUEST_NONCE');
  const timestamp=new Date(now),issued=new Date(plan.issued_at),expires=new Date(plan.expires_at);
  assert(Number.isFinite(timestamp.getTime())&&Number.isFinite(issued.getTime())&&Number.isFinite(expires.getTime()),'INVALID_APPROVAL_TIME');
  assert(timestamp.getTime()>=issued.getTime() && timestamp.getTime()<expires.getTime() &&
    expires.getTime()-issued.getTime()<=7*24*3600*1000 &&
    issued.toISOString()===plan.issued_at && expires.toISOString()===plan.expires_at,'EXPIRED_OR_FUTURE_APPROVAL');
  assert(PIN.test(ownerTrustedSpkiSha256||'')&&PIN.test(custodianTrustedSpkiSha256||'')&&
    ownerTrustedSpkiSha256!==custodianTrustedSpkiSha256,'INDEPENDENT_TRUST_ANCHORS_MISSING');
  const message=Buffer.from(payload,'utf8');
  for(const [subject,pin] of [[owner,ownerTrustedSpkiSha256],[custodian,custodianTrustedSpkiSha256]]){
    exact(subject,['public_key_spki_der_base64','signature_base64'], 'APPROVER_FORMAT_INVALID');
    const der=b64(subject.public_key_spki_der_base64);
    assert(sha(der)===pin,'APPROVER_NOT_PINNED');
    let key;
    try{key=createPublicKey({key:der,format:'der',type:'spki'})}catch{throw new NoGo('INVALID_APPROVER_KEY')}
    assert(key.asymmetricKeyType==='ed25519','APPROVER_NOT_ED25519');
    const sig=b64(subject.signature_base64);
    assert(sig.length===64 && verify(null,message,key,sig),'INVALID_INDEPENDENT_SIGNATURE');
  }
  return Object.freeze({schema:'musitu.axiom.step1.creation-admission-receipt.v1',
    status:'PINNED_TWO_SIGNATURES_VALID_CUSTODY_NOT_ATTESTED_NO_GO',
    signed_plan_sha256:sha(message),two_distinct_pinned_keys_verified:true,
    human_custody_independence_verified:false,creation_authorized:false,
    source_database_unchanged:true,production_changes_authorized:false,
    backup_export_authorized:false,customer_data_restore_authorized:false,
    current_backup_qualified:false,independent_restore_qualified:false,
    step_1_closed:false,step_2_authorized:false,release_authority:false});
}

/** Metadata-only check after a new target exists. Never authorizes writes. */
export function verifyEmptyTarget({sourceMetadata,targetMetadata,workers,workerSettings}) {
  assert(sourceMetadata?.uuid===SOURCE_D1&&sourceMetadata?.account===SOURCE_ACCOUNT,'SOURCE_METADATA_DRIFT');
  assert(targetMetadata?.account===SOURCE_ACCOUNT && UUID.test(targetMetadata?.uuid||''),'UNQUALIFIED_TARGET_METADATA');
  assert(targetMetadata.uuid!==SOURCE_D1 && targetMetadata.uuid!==OAUTH_DR_RESERVED,'PROTECTED_DATABASE_TARGET');
  assert(typeof targetMetadata.name==='string'&&SAFE_NAME.test(targetMetadata.name),'TARGET_NAME_NOT_PINNED');
  assert(targetMetadata.num_tables===0&&targetMetadata.file_size>=0,'TARGET_NOT_EMPTY');
  assert(Array.isArray(workers)&&workers.length>0&&workers.length<=80,'INCOMPLETE_WORKER_INVENTORY');
  assert(workerSettings&&typeof workerSettings==='object'&&!Array.isArray(workerSettings),'INVALID_WORKER_SETTINGS');
  const names=workers.map(w=>w?.id);
  assert(names.every(n=>typeof n==='string'&&n.length>0)&&new Set(names).size===names.length,'INVALID_WORKER_NAMES');
  assert(Object.keys(workerSettings).length===names.length&&names.every(n=>Object.hasOwn(workerSettings,n)),'INCOMPLETE_WORKER_SETTINGS');
  let consumers=0;
  for(const n of names){
    const settings=workerSettings[n];
    assert(Array.isArray(settings?.bindings),'INVALID_BINDING_METADATA');
    for(const b of settings.bindings){
      assert(b&&typeof b==='object'&&typeof b.type==='string','BAD_BINDING');
      if(b.type.toLowerCase()==='d1' && (b.id===targetMetadata.uuid || b.database_id===targetMetadata.uuid))consumers++;
    }
  }
  assert(consumers===0,'TARGET_CURRENTLY_BOUND');
  return Object.freeze({schema:'musitu.axiom.step1.empty-target-topology.v1',
    status:'EMPTY_ISOLATED_METADATA_ONLY_NOT_APPROVED_FOR_RESTORE',target_uuid_sha256:sha(targetMetadata.uuid),
    worker_count:workers.length,worker_consumers:0,target_tables:0,
    independent_owner_approval_verified:false,source_data_backup_qualified:false,
    source_database_unchanged:true,step_1_closed:false,step_2_authorized:false,release_authority:false});
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  // No secret material or approval payload printed, regardless of failure.
  try{
    assert(process.argv.length===3,'USAGE_APPROVAL_FILE_REQUIRED');
    const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
    const result=verifyApproval({...input,
      ownerTrustedSpkiSha256:process.env.AXIOM_PINNED_OWNER_APPROVER_SPKI_SHA256,
      custodianTrustedSpkiSha256:process.env.AXIOM_PINNED_INDEPENDENT_CUSTODIAN_SPKI_SHA256,
      now:new Date().toISOString()});
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(e){
    process.stderr.write('STEP1_CREATION_APPROVAL_NO_GO:'+((e instanceof NoGo)?e.code:'INVALID_APPROVAL')+'\n');
    process.exitCode=2;
  }
}
