/** Out-of-band anchored Ed25519 signer transition protocol.
 * This module does not provide historical issuance timestamps or revocation.
 * Root key AND current chain head MUST come from independently trusted channels.
 */
import {createHash,createPublicKey,sign,verify} from 'node:crypto';
import {verifyProof} from '../evidence.mjs';
const SHA=/^[a-f0-9]{64}$/;
const TENANT=/^[a-z][a-z0-9_-]{2,63}$/;
const PROTOCOL='MUSITU-MAIL-FABRIC-KEY-TRANSITION-v1';
const ORDER=['format','tenantId','sequence','previousHead','predecessorFingerprint','successorPublicKey','issuedAt'];
const digest=(s)=>createHash('sha256').update(s).digest('hex');
const canonicalKey=(key)=>(key?.type==='public'?key:createPublicKey(key)).export({type:'spki',format:'pem'}).toString();
const exactKeys=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).sort().join('|')===keys.slice().sort().join('|');
function statementBytes(statement){
 if(!exactKeys(statement,ORDER))throw new TypeError('INVALID_TRANSITION_FIELDS');
 const normalized=Object.fromEntries(ORDER.map(k=>[k,statement[k]]));
 return Buffer.from(JSON.stringify(normalized));
}
function validIso(s){return typeof s==='string'&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString()===s;}
function canonicalPublic(input){
 const pem=canonicalKey(input);
 if(typeof input!=='string'||pem!==input)throw new TypeError('NON_CANONICAL_PUBLIC_KEY');
 return pem;
}
export function initialTrustHead(tenantId,rootPublicKey){
 if(!TENANT.test(tenantId))throw new TypeError('INVALID_TENANT');
 const root=canonicalPublic(rootPublicKey);
 return digest('MMF-ROOT-v1\u0000'+tenantId+'\u0000'+root);
}
export function createKeyTransition({tenantId,previousHead,sequence,oldPrivateKey,oldPublicKey,newPrivateKey,newPublicKey,issuedAt}){
 if(!TENANT.test(tenantId)||!SHA.test(previousHead)||!Number.isSafeInteger(sequence)||sequence<1||!validIso(issuedAt))throw new TypeError('INVALID_TRANSITION');
 const oldPub=canonicalKey(oldPublicKey),newPub=canonicalKey(newPublicKey);
 if(oldPub===newPub)throw new TypeError('KEY_REUSE_FORBIDDEN');
 const statement={format:PROTOCOL,tenantId,sequence,previousHead,predecessorFingerprint:digest(oldPub),successorPublicKey:newPub,issuedAt};
 const bytes=statementBytes(statement);
 const predecessorSignature=sign(null,bytes,oldPrivateKey).toString('base64url');
 const successorSignature=sign(null,bytes,newPrivateKey).toString('base64url');
 if(!verify(null,bytes,oldPub,Buffer.from(predecessorSignature,'base64url'))||!verify(null,bytes,newPub,Buffer.from(successorSignature,'base64url')))
   throw new TypeError('SIGNING_KEY_MISMATCH');
 return {statement,predecessorSignature,successorSignature};
}
export function verifyTrustChain({tenantId,rootPublicKey,trustedHead,transitions}){
 if(!TENANT.test(tenantId)||typeof trustedHead!=='string'||!SHA.test(trustedHead)||!Array.isArray(transitions)||transitions.length>100)
   throw new TypeError('PINNED_ROOT_AND_HEAD_REQUIRED');
 let current=canonicalPublic(rootPublicKey), head=initialTrustHead(tenantId,current),previousTime=0;
 for(let i=0;i<transitions.length;i++){
  const record=transitions[i];
  if(!exactKeys(record,['statement','predecessorSignature','successorSignature']))throw new TypeError('INVALID_TRANSITION_RECORD');
  const s=record.statement,bytes=statementBytes(s);
  if(s.format!==PROTOCOL||s.tenantId!==tenantId||s.sequence!==i+1||s.previousHead!==head||s.predecessorFingerprint!==digest(current))
   throw new TypeError('BROKEN_TRUST_CHAIN');
  if(!validIso(s.issuedAt)||Date.parse(s.issuedAt)<previousTime)throw new TypeError('NON_MONOTONIC_TIME');
  const next=canonicalPublic(s.successorPublicKey);
  if(next===current)throw new TypeError('KEY_REUSE_FORBIDDEN');
  for(const [pub,signature] of [[current,record.predecessorSignature],[next,record.successorSignature]]){
   if(typeof signature!=='string'||!/^[A-Za-z0-9_-]{40,120}$/.test(signature)||!verify(null,bytes,pub,Buffer.from(signature,'base64url')))
     throw new TypeError('INVALID_ROTATION_SIGNATURE');
  }
  current=next;previousTime=Date.parse(s.issuedAt);head=digest(JSON.stringify(record));
 }
 if(head!==trustedHead)throw new TypeError('STALE_OR_UNTRUSTED_CHAIN_HEAD');
 return Object.freeze({currentPublicKey:current,verifiedHead:head,epoch:transitions.length});
}
export function verifyCurrentReceipt(proof,{tenantId,...trust}){
 const result=verifyTrustChain({tenantId,...trust});
 if(!proof?.events?.length||proof.events.some(e=>e.tenantId!==tenantId))return false;
 return verifyProof(proof,{trustedPublicKey:result.currentPublicKey});
}
