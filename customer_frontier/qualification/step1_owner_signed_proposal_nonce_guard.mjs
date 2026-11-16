/**
 * AXIOM Step1: offline verified Ed25519 owner PROPOSAL -> SQLite nonce guard.
 * Never authorizes D1/SQL/production/spend. No keys generated or private PEM read.
 * Local SQLite is not a global anti-rollback anchor. This is preparation only.
 */
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyOwnerProposal,OwnerPolicyNoGo,SOURCE_ACCOUNT,SOURCE_D1,AMENDMENT_SHA256} from './step1_owner_control_policy_candidate.mjs';
const SHA=b=>createHash('sha256').update(b).digest('hex');
export class LocalNonceNoGo extends Error {constructor(code){super(code);this.code=code;this.name='LocalNonceNoGo'}}
const req=(ok,code)=>{if(!ok)throw new LocalNonceNoGo(code)};
const dirPath=fileURLToPath(new URL('./step1_owner_nonce_replay_store.py',import.meta.url));

export function consumeSignedOwnerProposal({payload,owner,ledgerDir,trustedSigningSpkiSha256,
  trustedRecipientSpkiSha256,now=new Date()}={}) {
  req(typeof ledgerDir==='string'&&ledgerDir.startsWith('/')&&!ledgerDir.split('/').includes('..'),
    'ABSOLUTE_PRIVATE_LEDGER_DIRECTORY_REQUIRED');
  const clock=now instanceof Date?now.toISOString():new Date(now).toISOString();
  let verified;
  try {verified=verifyOwnerProposal({payload,owner,trustedOwnerSpkiSha256:trustedSigningSpkiSha256,
        trustedOwnerRecipientSpkiSha256:trustedRecipientSpkiSha256,now:clock});}
  catch(e){throw new LocalNonceNoGo(e instanceof OwnerPolicyNoGo?e.code:'INVALID_SIGNATURE_OR_INPUT')}
  req(verified.status==='PINNED_OWNER_SIGNATURE_VALID_POLICY_PROPOSAL_ONLY_NO_GO'&&
      verified.owner_policy_proposal_signature_valid===true&&
      verified.step_1_closed===false&&verified.release_authorized===false,
      'UNQUALIFIED_OWNER_PROPOSAL');
  const plan=JSON.parse(payload);
  const pin=SHA(Buffer.from(owner.public_key_spki_der_base64,'base64'));
  req(pin===trustedSigningSpkiSha256,'SIGNER_PIN_MISMATCH');
  const attempt={schema:'musitu.axiom.step1.verified-proposal-replay-attempt.v1',
    source_account:SOURCE_ACCOUNT,source_database:SOURCE_D1,
    governance_amendment_sha256:AMENDMENT_SHA256,
    plan_sha256:verified.exact_plan_sha256,
    signer_spki_sha256:pin,nonce:plan.nonce,
    issued_at:plan.issued_at,expires_at:plan.expires_at,
    signature_verification_status:verified.status,step1_closed:false,release_status:'NOT_RELEASE'};
  const p=spawnSync('python3',[dirPath,ledgerDir],{input:JSON.stringify(attempt),
    encoding:'utf8',timeout:12000,maxBuffer:8192,env:{PATH:process.env.PATH||'/usr/bin:/bin',LANG:'C'}});
  req(!p.error&&p.status===0,'LOCAL_NONCE_TRANSACTION_FAILED_NO_GO');
  let receipt;
  try{receipt=JSON.parse(p.stdout)}catch{throw new LocalNonceNoGo('INVALID_LEDGER_RECEIPT')}
  req(receipt?.status==='LOCAL_OWNER_SIGNED_PROPOSAL_REPLAY_CONSUMED_ONLY_NO_GO' &&
      receipt.exact_plan_sha256===verified.exact_plan_sha256 &&
      receipt.global_anti_rollback_qualified===false && receipt.step1_closed===false &&
      receipt.release_authorized===false,'UNSAFE_NONCE_RECEIPT');
  return Object.freeze(receipt);
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try {
  req(process.argv.length===4,'USAGE_SIGNED_PROPOSAL_FILE_PRIVATE_LEDGER_DIR');
  req(process.stdin.isTTY&&process.stdout.isTTY&&!process.env.CI&&!process.env.GITHUB_ACTIONS,
      'OWNER_INTERACTIVE_DEVICE_ONLY');
  const path=resolve(process.argv[2]),st=lstatSync(path);
  req(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=8192,
      'INVALID_SIGNED_PROPOSAL_FILE');
  const obj=JSON.parse(readFileSync(path,'utf8'));
  req(obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).sort().join(',')==='owner,payload',
      'INVALID_SIGNED_PROPOSAL_STRUCTURE');
  const result=consumeSignedOwnerProposal({payload:obj.payload,owner:obj.owner,
    ledgerDir:process.argv[3],trustedSigningSpkiSha256:process.env.AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256,
    trustedRecipientSpkiSha256:process.env.AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256});
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch(e){
  process.stderr.write('AXIOM_OWNER_LOCAL_NONCE_NO_GO:'+(e instanceof LocalNonceNoGo?e.code:'INVALID_INPUT_OR_LOCAL_FILES')+'\n');
  process.exitCode=2;
 }
}
