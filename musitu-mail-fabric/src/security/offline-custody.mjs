/** Offline, two-independent-custodian encrypted recovery bundle.
 * This library is NOT a KMS, not a signing-key rotation service, and never
 * activates sending or returns credentials over an HTTP endpoint. Escrow
 * artifacts require separately pinned SHA-256, independently secured RSA
 * private keys, and a reviewed offline restore procedure.
 */
import {createCipheriv,createDecipheriv,createHash,createPrivateKey,createPublicKey,
  publicEncrypt,privateDecrypt,constants,randomBytes,randomUUID} from 'node:crypto';
const FORMAT='MMF_OFFLINE_TWO_CUSTODIAN_ESCROW_V1';
const TENANT=/^[a-z][a-z0-9_-]{2,63}$/;
const ID=/^[a-z][a-z0-9_-]{2,63}$/;
const SHA=/^[a-f0-9]{64}$/;
const HEX_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const deny=()=>{throw Error('CUSTODY_REJECTED');};
const b64=b=>Buffer.from(b).toString('base64url');
const hash=b=>createHash('sha256').update(b).digest('hex');
const own=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
function decode(s,size){
 if(typeof s!=='string'||s.length>20000||!/^[A-Za-z0-9_-]+$/.test(s))deny();
 const x=Buffer.from(s,'base64url');
 if(b64(x)!==s||size!==undefined&&x.length!==size)deny();
 return x;
}
function rsaPub(pem){
 if(typeof pem!=='string'||pem.length>10000)deny();
 const key=createPublicKey(pem);
 if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength<3072||key.asymmetricKeyDetails?.modulusLength>8192)deny();
 const der=key.export({format:'der',type:'spki'});
 return {key,fingerprint:hash(der)};
}
function rsaPrivate(pem){
 if(typeof pem!=='string'||pem.length>20000)deny();
 const key=createPrivateKey(pem);
 if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength<3072)deny();
 return key;
}
function validateKeys(keys){
 if(!own(keys,['encryptionKey','privacyKey','backupKey','signingPrivateKeyPem']))deny();
 for(const n of ['encryptionKey','privacyKey','backupKey'])if(!Buffer.isBuffer(keys[n])||keys[n].length!==32)deny();
 if(typeof keys.signingPrivateKeyPem!=='string'||keys.signingPrivateKeyPem.length>8192)deny();
 const signing=createPrivateKey(keys.signingPrivateKeyPem);
 if(signing.asymmetricKeyType!=='ed25519')deny();
 return hash(createPublicKey(signing).export({format:'der',type:'spki'}));
}
function metadata(bundle){
 if(!own(bundle,['format','tenantId','epoch','bundleId','signingPublicKeySha256','custodians','iv','ciphertext','tag']))deny();
 if(bundle.format!==FORMAT||typeof bundle.tenantId!=='string'||!TENANT.test(bundle.tenantId)||
    !Number.isSafeInteger(bundle.epoch)||bundle.epoch<1||!HEX_UUID.test(bundle.bundleId)||
    typeof bundle.signingPublicKeySha256!=='string'||!SHA.test(bundle.signingPublicKeySha256))deny();
 if(!Array.isArray(bundle.custodians)||bundle.custodians.length!==2)deny();
 const seen=new Set(),seenKeys=new Set();
 for(const custodian of bundle.custodians){
  if(!own(custodian,['id','fingerprint','wrappedShare'])||typeof custodian.id!=='string'||!ID.test(custodian.id)||
    typeof custodian.fingerprint!=='string'||!SHA.test(custodian.fingerprint))deny();
  if(seen.has(custodian.id)||seenKeys.has(custodian.fingerprint))deny();
  seen.add(custodian.id);seenKeys.add(custodian.fingerprint);
  const share=decode(custodian.wrappedShare);
  if(share.length<384||share.length>1024)deny();
 }
 decode(bundle.iv,12);decode(bundle.tag,16);decode(bundle.ciphertext);
 if(bundle.ciphertext.length>18000)deny();
 return {
  format:bundle.format,tenantId:bundle.tenantId,epoch:bundle.epoch,bundleId:bundle.bundleId,
  signingPublicKeySha256:bundle.signingPublicKeySha256,
  custodians:bundle.custodians.map(({id,fingerprint})=>({id,fingerprint}))};
}
const label=(bundle,id)=>Buffer.from(`${FORMAT}\0${bundle.tenantId}\0${bundle.epoch}\0${bundle.bundleId}\0${id}`);
export function sealRecoveryKeys({tenantId,epoch,keys,custodians}={}){
 let payload,master,shareA,shareB;
 try{
  if(typeof tenantId!=='string'||!TENANT.test(tenantId)||!Number.isSafeInteger(epoch)||epoch<1||
    !Array.isArray(custodians)||custodians.length!==2)deny();
  const signerHash=validateKeys(keys);
  const pubs=custodians.map(c=>{
   if(!own(c,['id','publicKeyPem'])||typeof c.id!=='string'||!ID.test(c.id))deny();
   return {id:c.id,...rsaPub(c.publicKeyPem)};
  });
  if(pubs[0].id===pubs[1].id||pubs[0].fingerprint===pubs[1].fingerprint)deny();
  const bundle={format:FORMAT,tenantId,epoch,bundleId:randomUUID(),signingPublicKeySha256:signerHash};
  payload=Buffer.from(JSON.stringify({
   encryptionKey:b64(keys.encryptionKey),privacyKey:b64(keys.privacyKey),backupKey:b64(keys.backupKey),
   signingPrivateKeyPem:keys.signingPrivateKeyPem}));
  if(payload.length>8192)deny();
  master=randomBytes(32);shareA=randomBytes(32);shareB=Buffer.alloc(32);
  for(let i=0;i<32;i++)shareB[i]=master[i]^shareA[i];
  const protectedShares=pubs.map((p,i)=>({id:p.id,fingerprint:p.fingerprint,
   wrappedShare:b64(publicEncrypt({key:p.key,padding:constants.RSA_PKCS1_OAEP_PADDING,
     oaepHash:'sha256',oaepLabel:label(bundle,p.id)},i===0?shareA:shareB))}));
  const iv=randomBytes(12);
  const base={...bundle,custodians:protectedShares};
  const aad=Buffer.from(JSON.stringify(metadata({...base,iv:b64(iv),ciphertext:b64(Buffer.from('x')),tag:b64(Buffer.alloc(16))})));
  const cipher=createCipheriv('aes-256-gcm',master,iv);cipher.setAAD(aad);
  const ciphertext=Buffer.concat([cipher.update(payload),cipher.final()]);
  const result={...base,iv:b64(iv),ciphertext:b64(ciphertext),tag:b64(cipher.getAuthTag())};
  metadata(result);
  return Object.freeze(result);
 }catch{deny();}
 finally{payload?.fill(0);master?.fill(0);shareA?.fill(0);shareB?.fill(0);}
}
export function inspectRecoveryBundle(bundle){
 try{
  const descriptor=metadata(bundle);
  return Object.freeze({...descriptor,bundleSha256:hash(JSON.stringify(bundle))});
 }catch{deny();}
}
export function recoverRecoveryKeys(bundle,{expectedTenantId,expectedEpoch,trustedBundleSha256,custodians}={}){
 let master,shareA,shareB,clear;
 try{
  const descriptor=inspectRecoveryBundle(bundle);
  if(descriptor.tenantId!==expectedTenantId||descriptor.epoch!==expectedEpoch||
    typeof trustedBundleSha256!=='string'||!SHA.test(trustedBundleSha256)||
    descriptor.bundleSha256!==trustedBundleSha256||!Array.isArray(custodians)||custodians.length!==2)deny();
  // Credential ordering must correspond to the independently pinned metadata,
  // not be silently inferred from the untrusted archive.
  const shares=custodians.map((provided,i)=>{
   if(!own(provided,['id','privateKeyPem','publicKeyPem']))deny();
   const fromBundle=bundle.custodians[i];
   if(provided.id!==fromBundle.id)deny();
   const pub=rsaPub(provided.publicKeyPem),priv=rsaPrivate(provided.privateKeyPem);
   if(pub.fingerprint!==fromBundle.fingerprint||
     hash(createPublicKey(priv).export({format:'der',type:'spki'}))!==pub.fingerprint)deny();
   const recovered=privateDecrypt({key:priv,padding:constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash:'sha256',oaepLabel:label(bundle,provided.id)},decode(fromBundle.wrappedShare));
   if(recovered.length!==32)deny();
   return recovered;
  });
  [shareA,shareB]=shares;
  master=Buffer.alloc(32);
  for(let i=0;i<32;i++)master[i]=shareA[i]^shareB[i];
  const cipher=createDecipheriv('aes-256-gcm',master,decode(bundle.iv,12));
  cipher.setAAD(Buffer.from(JSON.stringify(metadata(bundle))));
  cipher.setAuthTag(decode(bundle.tag,16));
  clear=Buffer.concat([cipher.update(decode(bundle.ciphertext)),cipher.final()]);
  if(clear.length>8192)deny();
  const value=JSON.parse(clear.toString('utf8'));
  if(!own(value,['encryptionKey','privacyKey','backupKey','signingPrivateKeyPem']))deny();
  const keys={encryptionKey:decode(value.encryptionKey,32),privacyKey:decode(value.privacyKey,32),
    backupKey:decode(value.backupKey,32),signingPrivateKeyPem:value.signingPrivateKeyPem};
  if(validateKeys(keys)!==bundle.signingPublicKeySha256)deny();
  return keys;
 }catch{deny();}
 finally{master?.fill(0);shareA?.fill(0);shareB?.fill(0);clear?.fill(0);}
}
