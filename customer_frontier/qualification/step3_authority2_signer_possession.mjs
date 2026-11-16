/** Offline, single-key Authority 2 possession proof. No provider authority. */
import {createHash,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {readFileSync,lstatSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

export const EXPECTED_PIN='6792c82b245cd45051052cc1b00eb5f99a99489829c3f0567c7c15f741389d8a';
export const CHALLENGE_SHA256='60cd2f0ceec35106bc90beb7bfdb00326223d0a871a893f455e9dc0350a57878';
export const DOMAIN='MUSITU_AXIOM_AUTHORITY2_POSSESSION_ONLY_V1\n';
export const MARKER='.AXIOM_A2_OWNER_NTFS_OUTPUT';
export const OUTPUT='OWNER_A2_SIGNER_POSSESSION_PROOF.json';
const SOURCE='68799a41a367865649b833de649edcb26f77c0d3';
const CONFIG='bc09d63349f611a71f0eef6c1ad1d00bd861454aeab7c41f9565056758f2f8e3';
const H64=/^[a-f0-9]{64}$/;
const sha=b=>createHash('sha256').update(b).digest('hex');
export class PossessionNoGo extends Error {constructor(code){super(code);this.code=code;}}
const need=(ok,code)=>{if(!ok)throw new PossessionNoGo(code);};
export function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
function exact(v,keys){need(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===keys.slice().sort().join('|'),'UNEXPECTED_PUBLIC_FIELDS');}
function iso(s){const n=Date.parse(s);need(typeof s==='string'&&Number.isFinite(n)&&new Date(n).toISOString()===s,'INVALID_UTC_TIME');return n;}
export function validateChallenge(c,{expectedPin,nowMs=Date.now(),fresh=true}){
  exact(c,['schema','purpose','challenge_id','issued_at_utc','expires_at_utc','account_id','expected_spki_sha256','approved_source_commit','approved_config_sha256','release_status']);
  need(c.schema==='musitu.axiom.authority2.possession-challenge.v1'&&c.purpose==='EXISTING_A2_KEY_POSSESSION_ONLY_NOT_AUTHORITY','CHALLENGE_PURPOSE_MISMATCH');
  need(H64.test(expectedPin??'')&&c.expected_spki_sha256===expectedPin&&H64.test(c.challenge_id),'CHALLENGE_KEY_OR_NONCE_MISMATCH');
  need(c.account_id==='67469478aa9349fa0a57fe3a72da200a'&&c.approved_source_commit===SOURCE&&c.approved_config_sha256===CONFIG&&c.release_status==='NOT_RELEASE','APPROVED_CONTEXT_MISMATCH');
  const issued=iso(c.issued_at_utc),expires=iso(c.expires_at_utc);
  need(expires>issued&&expires-issued<=86400000,'CHALLENGE_LIFETIME_INVALID');
  if(fresh)need(Number.isFinite(nowMs)&&issued<=nowMs+300000&&nowMs<expires,'CHALLENGE_EXPIRED_OR_NOT_YET_VALID');
  return c;
}
function publicMaterial(der){
  need(Buffer.isBuffer(der)&&der.length===44,'PUBLIC_DER_INVALID');
  let k;try{k=createPublicKey({key:der,format:'der',type:'spki'});}catch{throw new PossessionNoGo('PUBLIC_DER_INVALID');}
  need(k.type==='public'&&k.asymmetricKeyType==='ed25519'&&der.equals(k.export({format:'der',type:'spki'})),'PUBLIC_DER_INVALID');
  return {key:k,pin:sha(der),jwk:k.export({format:'jwk'})};
}
export function verifyPossessionProof(proof,{challenge,expectedDer,nowMs=Date.now()}){
  const pub=publicMaterial(expectedDer);
  validateChallenge(challenge,{expectedPin:pub.pin,nowMs});
  exact(proof,['schema','statement','public_key_jwk','signature_base64url']);
  need(proof.schema==='musitu.axiom.authority2.local-possession-proof.v1','PROOF_SCHEMA_MISMATCH');
  exact(proof.statement,['schema','challenge','signed_at_utc']);
  need(proof.statement.schema==='musitu.axiom.authority2.local-possession-statement.v1'&&canonical(proof.statement.challenge)===canonical(challenge),'ISSUED_CHALLENGE_MISMATCH');
  exact(proof.public_key_jwk,['kty','crv','x']);
  need(canonical(proof.public_key_jwk)===canonical(pub.jwk),'PROOF_PUBLIC_KEY_MISMATCH');
  const signedAt=iso(proof.statement.signed_at_utc);
  need(signedAt>=iso(challenge.issued_at_utc)-300000&&signedAt<iso(challenge.expires_at_utc)&&signedAt<=nowMs+300000,'SIGNED_TIME_OUTSIDE_CHALLENGE');
  need(typeof proof.signature_base64url==='string'&&/^[A-Za-z0-9_-]{86}$/.test(proof.signature_base64url),'INVALID_SIGNATURE_ENCODING');
  const sig=Buffer.from(proof.signature_base64url,'base64url');
  need(sig.length===64&&sig.toString('base64url')===proof.signature_base64url,'INVALID_SIGNATURE_ENCODING');
  need(verify(null,Buffer.from(DOMAIN+canonical(proof.statement)+'\n'),pub.key,sig),'SIGNATURE_INVALID');
  return {matching_private_key_possession_verified:true,spki_sha256:pub.pin,challenge_id:challenge.challenge_id,hosted_custody_qualified:false,gate3_closed:false,release_status:'NOT_RELEASE'};
}
export function createPossessionProof({encryptedPem,passphrase,challenge,expectedDer,nowMs=Date.now()}){
  let key;
  let pub;
  try{
    pub=publicMaterial(expectedDer);
    validateChallenge(challenge,{expectedPin:pub.pin,nowMs});
    need(Buffer.isBuffer(encryptedPem)&&encryptedPem.length>80&&encryptedPem.length<16384,'ENCRYPTED_PEM_REQUIRED');
    need(/^-----BEGIN ENCRYPTED PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END ENCRYPTED PRIVATE KEY-----\r?\n?$/.test(encryptedPem.toString('ascii')),'ONLY_ENCRYPTED_PKCS8_PEM_ACCEPTED');
    need(Buffer.isBuffer(passphrase)&&passphrase.length>0&&passphrase.length<=256,'LOCAL_PASSPHRASE_REQUIRED');
    try{key=createPrivateKey({key:encryptedPem,format:'pem',passphrase});}catch{throw new PossessionNoGo('WRONG_PASSPHRASE_OR_DAMAGED_ENCRYPTED_KEY');}
    need(key.asymmetricKeyType==='ed25519'&&createPublicKey(key).export({format:'der',type:'spki'}).equals(expectedDer),'PRIVATE_KEY_DOES_NOT_MATCH_AUTHORITY2_PIN');
  }finally{
    if(Buffer.isBuffer(passphrase))passphrase.fill(0);
    if(Buffer.isBuffer(encryptedPem))encryptedPem.fill(0);
  }
  const statement={schema:'musitu.axiom.authority2.local-possession-statement.v1',challenge,signed_at_utc:new Date(nowMs).toISOString()};
  const sig=sign(null,Buffer.from(DOMAIN+canonical(statement)+'\n'),key);
  const proof={schema:'musitu.axiom.authority2.local-possession-proof.v1',statement,public_key_jwk:pub.jwk,signature_base64url:sig.toString('base64url')};
  verifyPossessionProof(proof,{challenge,expectedDer,nowMs});
  return proof;
}
export function writeNewPublicProof(path,proof){writeFileSync(path,JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});}
export function readPublicPacket(root){
  const raw=readFileSync(join(root,'challenge.json'));
  need(raw.length<8192&&sha(raw)===CHALLENGE_SHA256,'ISSUED_CHALLENGE_FILE_CHANGED');
  const challenge=JSON.parse(raw.toString('utf8'));
  need(raw.toString('utf8')===canonical(challenge)+'\n','CHALLENGE_NOT_CANONICAL');
  const der=readFileSync(join(root,'owner_ed25519_spki.der'));
  need(publicMaterial(der).pin===EXPECTED_PIN,'PUBLIC_FINGERPRINT_MISMATCH');
  validateChallenge(challenge,{expectedPin:EXPECTED_PIN,fresh:false});
  return {challenge,der};
}
// Reuses the existing owner Windows helper's raw-console masked input pattern.
async function hiddenPass(){
  need(process.stdin.isTTY&&process.stdout.isTTY&&typeof process.stdin.setRawMode==='function','LOCAL_INTERACTIVE_CONSOLE_REQUIRED');
  process.stdout.write('Existing Authority 2 encrypted-key passphrase (hidden): ');
  return new Promise((done,reject)=>{
    const bytes=[];let stopped=false;
    const stop=code=>{if(stopped)return;stopped=true;process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');if(code){bytes.fill(0);reject(new PossessionNoGo(code));}else{const b=Buffer.from(bytes);bytes.fill(0);done(b);}};
    const onData=packet=>{for(const byte of packet){if(byte===3||byte===4){stop('OWNER_CANCELLED');return;}if(byte===10||byte===13){stop();return;}if(byte===8||byte===127){bytes.pop();continue;}if(byte<32||byte>126||bytes.length>=256){stop('PASSPHRASE_INPUT_UNSUPPORTED');return;}bytes.push(byte);}};
    process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',onData);
  });
}
async function main(){
  const root=resolve(fileURLToPath(new URL('.',import.meta.url)));
  if(process.argv.length===3&&process.argv[2]==='--public-check'){
    const p=readPublicPacket(root);process.stdout.write('PUBLIC_PACKET_VALID_NO_PRIVATE_KEY_OR_HOSTED_OPERATION\n');return p;
  }
  need(process.platform==='win32'&&process.stdin.isTTY&&process.stdout.isTTY&&!process.env.CI&&!process.env.GITHUB_ACTIONS&&!process.env.TF_BUILD,'OWNER_WINDOWS_CONSOLE_REQUIRED');
  need(process.argv.length===5&&process.argv[2]==='--owner','OWNER_WRAPPER_REQUIRED');
  const privateFile=resolve(process.argv[3]),out=resolve(process.argv[4]);
  const rel=relative(join(root,'results'),out);
  need(rel.length>0&&!rel.startsWith('..')&&!isAbsolute(rel),'NEW_PACKET_RESULTS_DIRECTORY_REQUIRED');
  need(!privateFile.toLowerCase().startsWith(root.toLowerCase()),'PRIVATE_KEY_MUST_STAY_OUTSIDE_PUBLIC_PACKET');
  const files=readdirSync(out);
  need(files.length===1&&files[0]===MARKER&&readFileSync(join(out,MARKER),'utf8')==='OWNER_LOCAL_NTFS_OUTPUT_ONLY\n','OWNER_ACL_OUTPUT_WRAPPER_REQUIRED');
  const packet=readPublicPacket(root);
  validateChallenge(packet.challenge,{expectedPin:EXPECTED_PIN});
  const stat=lstatSync(privateFile);
  need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>80&&stat.size<16384,'ENCRYPTED_PRIVATE_FILE_INVALID');
  const passphrase=await hiddenPass();
  let encryptedPem;
  try{encryptedPem=readFileSync(privateFile);const proof=createPossessionProof({encryptedPem,passphrase,challenge:packet.challenge,expectedDer:packet.der});writeNewPublicProof(join(out,OUTPUT),proof);}
  finally{passphrase.fill(0);if(encryptedPem)encryptedPem.fill(0);}
  process.stdout.write('PASS - matching Authority 2 signer produced a public possession proof.\n');
  process.stdout.write('Send only: '+join(out,OUTPUT)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{process.stderr.write('A2_SIGNER_CHECK_STOPPED:'+(e instanceof PossessionNoGo?e.code:'LOCAL_INPUT_OR_OUTPUT_UNAVAILABLE')+'\n');process.exitCode=2;});
