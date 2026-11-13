/**
 * MUSITU AXIOM Step 1: Windows-native RESTORED OWNER KEY rehearsal, offline only.
 * Uses the existing PR241 OpenSSL-generated encrypted Ed25519 and X25519 PEMs.
 * This never generates real owner keys, speaks to Cloudflare or authorizes D1.
 * A separate PowerShell entrypoint enforces local owner-only NTFS permissions.
 */
import {createHash, createPrivateKey, createPublicKey, sign, verify,
        diffieHellman, randomBytes, generateKeyPairSync, timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,lstatSync,readdirSync} from 'node:fs';
import {resolve,join,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const PIN=/^[a-f0-9]{64}$/;
const SIGN_PEM='owner_ed25519_pkcs8_encrypted.pem';
const REC_PEM='owner_x25519_pkcs8_encrypted.pem';
const SIGN_DER='owner_ed25519_spki.der';
const REC_DER='owner_x25519_spki.der';
export const MARKER='.AXIOM_WINDOWS_RESTORED_COPY_OWNER_ACL_CONFIRMED_NO_GO';
export class OwnerRecoveryNoGo extends Error {
  constructor(code){super(code);this.name='OwnerRecoveryNoGo';this.code=code;}
}
const check=(yes,code)=>{if(!yes)throw new OwnerRecoveryNoGo(code);};
const digest=b=>createHash('sha256').update(b).digest('hex');
function publicKey(root,name,kind){
  const file=join(root,'public',name);
  let s,b,k;
  try{s=lstatSync(file);check(s.isFile()&&!s.isSymbolicLink()&&s.size>24&&s.size<2048,'PUBLIC_SPKI_INVALID');
    b=readFileSync(file);k=createPublicKey({key:b,format:'der',type:'spki'});}
  catch{throw new OwnerRecoveryNoGo('PUBLIC_SPKI_INVALID')}
  check(k.asymmetricKeyType===kind && k.export({type:'spki',format:'der'}).equals(b),'PUBLIC_SPKI_ALGORITHM_OR_CANONICALITY_MISMATCH');
  return {key:k,der:b,pin:digest(b)};
}
function encryptedPem(root,name){
  const file=join(root,'private',name);
  let s,bytes;
  try{s=lstatSync(file);check(s.isFile()&&!s.isSymbolicLink()&&s.size>80&&s.size<16384,'ENCRYPTED_PEM_INVALID');
    bytes=readFileSync(file);}
  catch{throw new OwnerRecoveryNoGo('ENCRYPTED_PEM_INVALID')}
  check(bytes.toString('ascii',0,38)==='-----BEGIN ENCRYPTED PRIVATE KEY-----\n','UNENCRYPTED_PEM_REFUSED');
  return {file,bytes,stat:s};
}
function decrypt(encrypted,pass,algorithm,expectedDer){
  check(Buffer.isBuffer(pass)&&pass.length>0,'LOCAL_PASSPHRASE_REQUIRED');
  let k;
  try{k=createPrivateKey({key:encrypted,format:'pem',passphrase:pass});}
  catch{throw new OwnerRecoveryNoGo('ENCRYPTED_PEM_WRONG_PASSWORD_OR_CORRUPTION')}
  check(k.asymmetricKeyType===algorithm && createPublicKey(k).export({type:'spki',format:'der'}).equals(expectedDer),
     'RESTORED_KEY_DOES_NOT_MATCH_REVIEWED_PUBLIC_PIN');
  return k;
}
function markerOutput(out){
  check(typeof out==='string'&&isAbsolute(out)&&!out.startsWith('\\\\'),'OWNER_ONLY_LOCAL_ABSOLUTE_OUTPUT_REQUIRED');
  const dir=resolve(out);let s;
  try{s=lstatSync(dir);}catch{throw new OwnerRecoveryNoGo('OUTPUT_DIRECTORY_REQUIRED')}
  check(s.isDirectory()&&!s.isSymbolicLink(),'UNSAFE_OUTPUT_DIRECTORY');
  try{check(readFileSync(join(dir,MARKER),'utf8')==='AXIOM_WINDOWS_OWNER_ACL_REVIEW_ONLY_NO_RELEASE\n',
      'OWNER_ACL_WRAPPER_MARKER_REQUIRED');}
  catch{throw new OwnerRecoveryNoGo('OWNER_ACL_WRAPPER_MARKER_REQUIRED')}
  check(readdirSync(dir).length===1,'OUTPUT_DIRECTORY_NOT_NEW_OR_EMPTY');
  return dir;
}
export function runRestoredOwnerKeys({original,restored,output,signPassword,recipientPassword,
        trustedSignPin,trustedRecipientPin}) {
  check(PIN.test(trustedSignPin??'')&&PIN.test(trustedRecipientPin??''),'EXTERNAL_REVIEWED_PUBLIC_PINS_REQUIRED');
  check(typeof original==='string'&&typeof restored==='string'&&isAbsolute(original)&&isAbsolute(restored),
    'ABSOLUTE_ORIGINAL_AND_RESTORED_KEYS_REQUIRED');
  const a=resolve(original),b=resolve(restored);
  check(a!==b,'A_SEPARATE_RESTORED_COPY_IS_REQUIRED');
  const out=markerOutput(output);
  check(out!==a&&out!==b&&!out.startsWith(a+sep)&&!out.startsWith(b+sep),
    'OUTPUT_MUST_BE_OUTSIDE_PRIVATE_KEY_DIRECTORIES');
  const signing=publicKey(a,SIGN_DER,'ed25519');
  const recipient=publicKey(a,REC_DER,'x25519');
  check(signing.pin===trustedSignPin&&recipient.pin===trustedRecipientPin&&signing.pin!==recipient.pin,
    'PUBLIC_KEYS_NOT_INDEPENDENTLY_TRUSTED');
  const originalSign=encryptedPem(a,SIGN_PEM), originalRec=encryptedPem(a,REC_PEM);
  const restoredSign=encryptedPem(b,SIGN_PEM), restoredRec=encryptedPem(b,REC_PEM);
  for(const [src,dst] of [[originalSign,restoredSign],[originalRec,restoredRec]]){
    check(src.file!==dst.file && (src.stat.dev!==dst.stat.dev || src.stat.ino!==dst.stat.ino),
       'RESTORED_PRIVATE_KEY_HARDLINKS_ORIGINAL');
  }
  let signKey,recipientKey;
  try {
    signKey=decrypt(restoredSign.bytes,signPassword,'ed25519',signing.der);
    recipientKey=decrypt(restoredRec.bytes,recipientPassword,'x25519',recipient.der);
  } finally {
    if(Buffer.isBuffer(signPassword))signPassword.fill(0);
    if(Buffer.isBuffer(recipientPassword))recipientPassword.fill(0);
    originalSign.bytes.fill(0);originalRec.bytes.fill(0);
    restoredSign.bytes.fill(0);restoredRec.bytes.fill(0);
  }
  const challenge=randomBytes(64);
  const signature=sign(null,challenge,signKey);
  check(signature.length===64&&verify(null,challenge,signing.key,signature),'RESTORED_ED25519_CHALLENGE_FAILED');
  const eph=generateKeyPairSync('x25519');
  const aSecret=diffieHellman({privateKey:recipientKey,publicKey:eph.publicKey});
  const bSecret=diffieHellman({privateKey:eph.privateKey,publicKey:recipient.key});
  check(aSecret.length===32&&timingSafeEqual(aSecret,bSecret),'RESTORED_X25519_AGREEMENT_FAILED');
  const challengeHash=digest(challenge);
  challenge.fill(0);signature.fill(0);aSecret.fill(0);bSecret.fill(0);
  const receipt={
    schema:'musitu.axiom.step1.owner-windows-restored-key-rehearsal.v1',
    status:'WINDOWS_OWNER_RESTORED_ENCRYPTED_KEYS_LOCAL_REHEARSAL_ONLY_NO_GO',
    owner_ed25519_spki_sha256:signing.pin,
    owner_x25519_spki_sha256:recipient.pin,
    ephemeral_challenge_sha256:challengeHash,
    separate_encrypted_key_file_copy_checked_locally:true,
    restored_ed25519_challenge_verified_locally:true,
    restored_x25519_synthetic_agreement_verified_locally:true,
    separate_physical_backup_media_independently_verified:false,
    real_owner_identity_and_mfa_qualified:false,
    production_trust_pins_activated:false,
    independently_verified_device_loss_recovery:false,
    current_encrypted_customer_backup_qualified:false,
    provider_zero_additional_spend_qualified:false,
    hosted_d1_restore_parity_qualified:false,
    global_anti_rollback_and_nonce_qualified:false,
    historical_independent_custody_passed:false,
    step1_closed:false,step2_authorized:false,release_authorized:false,
    release_status:'NOT_RELEASE'
  };
  writeFileSync(join(out,'OWNER_WINDOWS_RESTORED_KEY_REHEARSAL_NOT_AUTHORITY.json'),
     JSON.stringify(Object.fromEntries(Object.entries(receipt).sort(([a],[b])=>a.localeCompare(b))),null,2)+'\n',
     {flag:'wx',mode:0o600});
  return receipt;
}
async function hiddenPass(label){
  check(process.stdin.isTTY&&process.stdout.isTTY&&typeof process.stdin.setRawMode==='function',
    'INTERACTIVE_LOCAL_TERMINAL_REQUIRED');
  process.stdout.write(label+' (hidden, Enter to finish): ');
  return new Promise((resolvePass,rejectPass)=>{
    const bytes=[];
    const stop=(error)=>{
      process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();
      process.stdout.write('\n');
      if(error){bytes.fill(0);rejectPass(new OwnerRecoveryNoGo(error));}
      else resolvePass(Buffer.from(bytes));
    };
    const onData=packet=>{for(const byte of packet){
      if(byte===3||byte===4){stop('OWNER_CANCELLED');return;}
      if(byte===10||byte===13){stop();return;}
      if(byte===8||byte===127){bytes.pop();continue;}
      if(byte<32||byte>126||bytes.length>=256){stop('PASSWORD_INPUT_UNSUPPORTED');return;}
      bytes.push(byte);
    }};
    process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',onData);
  });
}
async function main(){
  check(process.platform==='win32'&&process.stdin.isTTY&&process.stdout.isTTY&&
      !process.env.CI&&!process.env.GITHUB_ACTIONS&&!process.env.TF_BUILD,
    'WINDOWS_OWNER_INTERACTIVE_OFFLINE_DEVICE_ONLY');
  check(process.argv.length===5,'USAGE_ORIGINAL_RESTORED_NEW_OUTPUT_DIR');
  const [original,restored,output]=process.argv.slice(2);
  const signPin=process.env.AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256;
  const recipientPin=process.env.AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256;
  check(PIN.test(signPin??'')&&PIN.test(recipientPin??''),'SEPARATELY_REVIEWED_PUBLIC_PINS_REQUIRED');
  process.stdout.write('This ONLY rehearses a separate encrypted-key backup and does NOT authorize D1.\n');
  const {createInterface}=await import('node:readline');
  const rl=createInterface({input:process.stdin,output:process.stdout,terminal:true});
  const confirm=await new Promise(done=>rl.question('Type: I RESTORED AN INDEPENDENT ENCRYPTED COPY : ',s=>{rl.close();done(s);}));
  check(confirm==='I RESTORED AN INDEPENDENT ENCRYPTED COPY','OWNER_BACKUP_RESTORE_NOT_CONFIRMED');
  const signPassword=await hiddenPass('Restored Ed25519 key passphrase');
  const recipientPassword=await hiddenPass('Restored X25519 key passphrase');
  const receipt=runRestoredOwnerKeys({original,restored,output,signPassword,recipientPassword,
    trustedSignPin:signPin,trustedRecipientPin:recipientPin});
  process.stdout.write(JSON.stringify(receipt)+'\n');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 main().catch(e=>{
   process.stderr.write('AXIOM_OWNER_WINDOWS_RESTORE_NO_GO:'+
     (e instanceof OwnerRecoveryNoGo?e.code:'INVALID_OWNER_OFFLINE_PRECONDITION')+'\n');
   process.exitCode=2;
 });
}
