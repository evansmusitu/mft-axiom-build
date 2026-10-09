import {createHash,generateKeyPairSync,sign,verify,createHmac} from 'node:crypto';
const digest=x=>createHash('sha256').update(x).digest('hex'),encode=x=>JSON.stringify(x);
export function generateDemonstrationKeys(){return generateKeyPairSync('ed25519');}
export class EvidenceLedger {
  constructor({privateKey,publicKey,privacyKey,now=()=>new Date().toISOString()}){
    if(!privateKey||!publicKey||!Buffer.isBuffer(privacyKey)||privacyKey.length<32)throw new TypeError('Evidence keys required');
    this.privateKey=privateKey;this.publicKey=publicKey;this.privacyKey=privacyKey;this.now=now;
  }
  opaqueRecipient(address){return createHmac('sha256',this.privacyKey).update(address).digest('hex');}
  append(entries,{messageId,tenantId,event,detail={}}){
    const previousHash=entries.length?entries.at(-1).hash:'0'.repeat(64);
    const data={messageId,tenantId,sequence:entries.length+1,at:this.now(),event,detail,previousHash};
    const entry={...data,hash:digest(encode(data))};entries.push(entry);return entry;
  }
  export(entries){
    if(!entries.length)throw new TypeError('Empty evidence chain');
    const manifest={format:'MUSITU-MAIL-FABRIC-PROOF-v1',messageId:entries[0].messageId,finalHash:entries.at(-1).hash,events:entries.map(e=>({...e}))};
    const publicKey=this.publicKey.export({format:'pem',type:'spki'}).toString();
    const signature=sign(null,Buffer.from(encode(manifest)),this.privateKey).toString('base64url');
    return {...manifest,publicKey,signature};
  }
}
export function verifyProof(proof,{trustedPublicKey}={}){
  if(!proof||!Array.isArray(proof.events)||!proof.events.length||proof.format!=='MUSITU-MAIL-FABRIC-PROOF-v1')return false;
  let prior='0'.repeat(64);
  for(let i=0;i<proof.events.length;i++){
    const e=proof.events[i];if(!e||e.sequence!==i+1||e.previousHash!==prior||e.messageId!==proof.messageId)return false;
    const {hash,...data}=e;if(digest(encode(data))!==hash)return false;prior=hash;
  }
  if(prior!==proof.finalHash||typeof proof.signature!=='string'||typeof proof.publicKey!=='string')return false;
  if(trustedPublicKey&&trustedPublicKey!==proof.publicKey)return false;
  const {signature,publicKey,...manifest}=proof;
  try{return verify(null,Buffer.from(encode(manifest)),trustedPublicKey||publicKey,Buffer.from(signature,'base64url'));}catch{return false;}
}
