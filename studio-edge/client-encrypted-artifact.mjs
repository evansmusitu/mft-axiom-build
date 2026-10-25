/**
 * Disabled enterprise-client building block: never imports from the public site,
 * never reads/writes the existing browser-local vault, and never calls a network.
 * Caller owns AES-256-GCM key provisioning, session authentication, and storage.
 * Cryptographic AAD binds ciphertext to the tenant and immutable artifact ID.
 */
const ID=/^[A-Za-z0-9_-]{8,64}$/;
const URL64=/^[A-Za-z0-9_-]+$/;
const enc=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});
const MAX_CLEAR=8000;

function requireId(value) {
  if(typeof value!=='string'||!ID.test(value))throw Error('INVALID_ARTIFACT_SCOPE');
  return value;
}
function requireKey(key,operation) {
  if(!key || key.type!=='secret' || key.algorithm?.name!=='AES-GCM' ||
     key.algorithm.length!==256 || key.extractable!==false || !key.usages?.includes(operation)) throw Error('INVALID_CRYPTO_KEY');
  if(!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues)throw Error('CRYPTO_UNAVAILABLE');
}
function context(tenant,artifact) {
  return enc.encode(JSON.stringify(['MUSITU-INTELLIGENCE-ENTERPRISE-v1',requireId(tenant),requireId(artifact)]));
}
function toUrl64(bytes) {
  let s='';
  for(let i=0;i<bytes.length;i+=4096)s+=String.fromCharCode(...bytes.subarray(i,i+4096));
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function fromUrl64(value,min,max) {
  if(typeof value!=='string'||!URL64.test(value)||value.length>Math.ceil(max*4/3)+8)throw Error('INVALID_CIPHERTEXT');
  let bytes;
  try{
    const decoded=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));
    bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
  }catch{throw Error('INVALID_CIPHERTEXT');}
  if(bytes.length<min||bytes.length>max)throw Error('INVALID_CIPHERTEXT');
  if(toUrl64(bytes)!==value)throw Error('INVALID_CIPHERTEXT');
  return bytes;
}
function readEnvelope(data) {
  if(!data||typeof data!=='object'||Array.isArray(data)||
     Object.keys(data).sort().join(',')!=='ciphertext,iv,version' ||
     data.version!==1)throw Error('INVALID_CIPHERTEXT');
  const iv=fromUrl64(data.iv,12,12);
  const cipher=fromUrl64(data.ciphertext,18,MAX_CLEAR+16);
  return {iv,cipher};
}
export async function encryptTenantText(plain,key,tenant,artifact) {
  requireKey(key,'encrypt');
  const aad=context(tenant,artifact);
  if(typeof plain!=='string')throw Error('INVALID_PLAINTEXT');
  const clear=enc.encode(plain);
  if(clear.byteLength<2 || clear.byteLength>MAX_CLEAR)throw Error('INVALID_PLAINTEXT');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt(
    {name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,clear
  );
  const envelope={version:1,iv:toUrl64(iv),ciphertext:toUrl64(new Uint8Array(ciphertext))};
  readEnvelope(envelope);
  return envelope;
}
export async function decryptTenantText(data,key,tenant,artifact) {
  requireKey(key,'decrypt');
  const aad=context(tenant,artifact);
  const {iv,cipher}=readEnvelope(data);
  try{
    const clear=await crypto.subtle.decrypt(
      {name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,cipher
    );
    return decoder.decode(clear);
  }catch{throw Error('DECRYPT_FAILED');}
}
