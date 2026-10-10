/** Isolated staging-only, synthetic-data cryptographic self-check. Never process customer messages here. */
import {createHash,createPrivateKey,createPublicKey,sign,verify,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
const PROBE = /^probe-[a-z0-9-]{8,56}$/;
export function stageCryptoSelfTest(privatePem,encodedDataKey,probeId){
  if(typeof probeId!=='string'||!PROBE.test(probeId))throw new TypeError('Invalid synthetic probe identifier');
  if(typeof privatePem!=='string'||!privatePem.startsWith('-----BEGIN PRIVATE KEY-----')||privatePem.length>8000)throw new TypeError('Invalid staging private key');
  if(typeof encodedDataKey!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(encodedDataKey))throw new TypeError('Invalid staging encryption key');
  const dataKey=Buffer.from(encodedDataKey,'base64');
  if(dataKey.length!==32||dataKey.toString('base64')!==encodedDataKey)throw new TypeError('Invalid AES-256 key encoding');
  const privateKey=createPrivateKey(privatePem),publicKey=createPublicKey(privateKey);
  if(privateKey.asymmetricKeyType!=='ed25519')throw new TypeError('Expected Ed25519 signing key');
  const nonce=randomBytes(12),plaintext=Buffer.from('MMF_STAGE_ONLY:'+probeId,'utf8');
  const encryption=createCipheriv('aes-256-gcm',dataKey,nonce);
  const ciphertext=Buffer.concat([encryption.update(plaintext),encryption.final()]);
  const tag=encryption.getAuthTag();
  const decryption=createDecipheriv('aes-256-gcm',dataKey,nonce);
  decryption.setAuthTag(tag);
  const recovered=Buffer.concat([decryption.update(ciphertext),decryption.final()]);
  if(!recovered.equals(plaintext))throw new Error('Synthetic data AEAD round-trip failed');
  const payload=createHash('sha256').update(plaintext).digest();
  const signature=sign(null,payload,privateKey);
  if(!verify(null,payload,publicKey,signature))throw new Error('Synthetic signed receipt check failed');
  return Object.freeze({verified:true,
    publicKeySha256:createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex'),
    customerContentHandled:false});
}
