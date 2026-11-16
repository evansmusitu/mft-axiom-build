import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,createPublicKey,verify} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {canonical,createPossessionProof,verifyPossessionProof,writeNewPublicProof,validateChallenge,DOMAIN,PossessionNoGo} from '../qualification/step3_authority2_signer_possession.mjs';
const now=Date.parse('2026-11-16T10:00:00.000Z');
function fixture(kind='ed25519'){
  const pair=generateKeyPairSync(kind),der=pair.publicKey.export({format:'der',type:'spki'});
  const pin=createHash('sha256').update(der).digest('hex');
  const challenge={schema:'musitu.axiom.authority2.possession-challenge.v1',purpose:'EXISTING_A2_KEY_POSSESSION_ONLY_NOT_AUTHORITY',challenge_id:'a'.repeat(64),issued_at_utc:'2026-11-16T09:59:00.000Z',expires_at_utc:'2026-11-17T09:59:00.000Z',account_id:'67469478aa9349fa0a57fe3a72da200a',expected_spki_sha256:pin,approved_source_commit:'68799a41a367865649b833de649edcb26f77c0d3',approved_config_sha256:'bc09d63349f611a71f0eef6c1ad1d00bd861454aeab7c41f9565056758f2f8e3',release_status:'NOT_RELEASE'};
  const encrypted=()=>Buffer.from(pair.privateKey.export({format:'pem',type:'pkcs8',cipher:'aes-256-cbc',passphrase:'synthetic-test-password'}));
  return {pair,der,pin,challenge,encrypted};
}
function prove(f,overrides={}){return createPossessionProof({encryptedPem:f.encrypted(),passphrase:Buffer.from('synthetic-test-password'),challenge:f.challenge,expectedDer:f.der,nowMs:now,...overrides});}
function check(f,p,overrides={}){return verifyPossessionProof(p,{challenge:f.challenge,expectedDer:f.der,nowMs:now,...overrides});}
const refuses=(fn,code)=>assert.throws(fn,e=>e instanceof PossessionNoGo&&e.code===code);
test('encrypted Ed25519 produces an independently verified public signature, no authority',()=>{
  const f=fixture(),proof=prove(f),s=Buffer.from(proof.signature_base64url,'base64url');
  assert.equal(s.length,64);
  assert.equal(verify(null,Buffer.from(DOMAIN+canonical(proof.statement)+'\n'),f.pair.publicKey,s),true);
  const result=check(f,proof);assert.equal(result.matching_private_key_possession_verified,true);assert.equal(result.hosted_custody_qualified,false);assert.equal(result.gate3_closed,false);
  assert.deepEqual(Object.keys(proof.public_key_jwk).sort(),['crv','kty','x']);
  assert.equal(JSON.stringify(proof).includes('synthetic-test-password'),false);
  assert.equal(JSON.stringify(proof).includes('PRIVATE KEY'),false);
});
test('signature cannot verify as an ordinary unprefixed runtime payload',()=>{const f=fixture(),p=prove(f);assert.equal(verify(null,Buffer.from(canonical(p.statement)+'\n'),f.pair.publicKey,Buffer.from(p.signature_base64url,'base64url')),false);});
test('wrong passphrase refuses and clears input buffers',()=>{const f=fixture(),pem=f.encrypted(),pass=Buffer.from('wrong-password');refuses(()=>prove(f,{encryptedPem:pem,passphrase:pass}),'WRONG_PASSPHRASE_OR_DAMAGED_ENCRYPTED_KEY');assert(pem.every(x=>x===0));assert(pass.every(x=>x===0));});
test('different Ed25519 private key refuses the trusted pin',()=>{const a=fixture(),b=fixture();refuses(()=>prove(a,{encryptedPem:b.encrypted()}),'PRIVATE_KEY_DOES_NOT_MATCH_AUTHORITY2_PIN');});
test('X25519 private key cannot be used as the signer',()=>{const a=fixture(),b=fixture('x25519');refuses(()=>prove(a,{encryptedPem:b.encrypted()}),'PRIVATE_KEY_DOES_NOT_MATCH_AUTHORITY2_PIN');});
test('unencrypted private PEM is refused',()=>{const f=fixture();refuses(()=>prove(f,{encryptedPem:Buffer.from(f.pair.privateKey.export({format:'pem',type:'pkcs8'}))}),'ONLY_ENCRYPTED_PKCS8_PEM_ACCEPTED');});
test('invalid public DER still clears supplied secrets',()=>{const f=fixture(),pem=f.encrypted(),pass=Buffer.from('synthetic-test-password');refuses(()=>prove(f,{encryptedPem:pem,passphrase:pass,expectedDer:Buffer.from('bad')}),'PUBLIC_DER_INVALID');assert(pem.every(x=>x===0));assert(pass.every(x=>x===0));});
test('expired challenge refuses without a signature',()=>{const f=fixture();refuses(()=>prove(f,{nowMs:Date.parse(f.challenge.expires_at_utc)}),'CHALLENGE_EXPIRED_OR_NOT_YET_VALID');});
test('future challenge and excessive lifetime are refused',()=>{const f=fixture();refuses(()=>prove(f,{nowMs:Date.parse(f.challenge.issued_at_utc)-300001}),'CHALLENGE_EXPIRED_OR_NOT_YET_VALID');refuses(()=>prove(f,{challenge:{...f.challenge,expires_at_utc:'2026-11-18T09:59:00.000Z'}}),'CHALLENGE_LIFETIME_INVALID');});
test('modified nonce or signed statement cannot satisfy the issued challenge',()=>{const f=fixture(),p=prove(f);const changed=structuredClone(p);changed.statement.challenge.challenge_id='b'.repeat(64);refuses(()=>check(f,changed),'ISSUED_CHALLENGE_MISMATCH');const signed=structuredClone(p);signed.statement.signed_at_utc='2026-11-16T10:00:01.000Z';refuses(()=>check(f,signed),'SIGNATURE_INVALID');});
test('wrong public key, altered signature and private JWK fields refuse',()=>{const f=fixture(),p=prove(f),a=structuredClone(p);a.public_key_jwk=createPublicKey(fixture().pair.privateKey).export({format:'jwk'});refuses(()=>check(f,a),'PROOF_PUBLIC_KEY_MISMATCH');const b=structuredClone(p);const sig=Buffer.from(b.signature_base64url,'base64url');sig[0]^=1;b.signature_base64url=sig.toString('base64url');refuses(()=>check(f,b),'SIGNATURE_INVALID');const c=structuredClone(p);c.public_key_jwk.d='not-allowed';refuses(()=>check(f,c),'UNEXPECTED_PUBLIC_FIELDS');});
test('wrong account/context, extra fields and runtime purpose refuse',()=>{const f=fixture();for(const change of [{account_id:'0'.repeat(32)},{approved_source_commit:'0'.repeat(40)},{release_status:'RELEASE'}])refuses(()=>prove(f,{challenge:{...f.challenge,...change}}),'APPROVED_CONTEXT_MISMATCH');refuses(()=>prove(f,{challenge:{...f.challenge,purpose:'AUTHORIZE_DEPLOYMENT'}}),'CHALLENGE_PURPOSE_MISMATCH');refuses(()=>prove(f,{challenge:{...f.challenge,allow:true}}),'UNEXPECTED_PUBLIC_FIELDS');});
test('verification expiry and wrong issuer nonce cannot be replayed into a new request',()=>{const f=fixture(),p=prove(f);refuses(()=>check(f,p,{nowMs:Date.parse(f.challenge.expires_at_utc)}),'CHALLENGE_EXPIRED_OR_NOT_YET_VALID');refuses(()=>check(f,p,{challenge:{...f.challenge,challenge_id:'c'.repeat(64)}}),'ISSUED_CHALLENGE_MISMATCH');});
test('public proof write is create-only and does not overwrite an older file',()=>{const f=fixture(),p=prove(f),root=mkdtempSync(join(tmpdir(),'a2-public-proof-'));try{const path=join(root,'proof.json');writeNewPublicProof(path,p);assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),p);const prior=readFileSync(path);assert.throws(()=>writeNewPublicProof(path,p),e=>e.code==='EEXIST');assert.deepEqual(readFileSync(path),prior);}finally{rmSync(root,{recursive:true,force:true});}});
test('real CLI refuses CI and redirected input before private file access',()=>{const cli=fileURLToPath(new URL('../qualification/step3_authority2_signer_possession.mjs',import.meta.url));const p=spawnSync(process.execPath,[cli,'--owner','DOES_NOT_EXIST_PRIVATE_FILE','DOES_NOT_EXIST_OUTPUT'],{env:{...process.env,CI:'true'},encoding:'utf8'});assert.equal(p.status,2);assert.match(p.stderr,/OWNER_WINDOWS_CONSOLE_REQUIRED/);assert.equal(p.stderr.includes('DOES_NOT_EXIST'),false);});
