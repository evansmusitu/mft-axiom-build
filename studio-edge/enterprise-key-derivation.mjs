/**
 * OPTIONAL, OFFLINE enterprise key descriptor + deterministic derivation.
 * Not wired to the website, Worker, account, provider identity, or any
 * storage. Caller must independently safeguard descriptor AND passphrase.
 * Not password recovery, key escrow, MFA or a production-approved KDF policy.
 */
const ID=/^[A-Za-z0-9_-]{8,64}$/;
const B64=/^[A-Za-z0-9_-]{22}$/;
const enc=new TextEncoder();
const ITERATIONS=600000;
function reject(code){throw Error(code);}
function requireTenant(tenantId) {
  if(typeof tenantId!=='string'||!ID.test(tenantId))reject('INVALID_KEY_DESCRIPTOR');
  return tenantId;
}
function base64url(bytes) {
  let binary='';
  for(const value of bytes)binary+=String.fromCharCode(value);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function saltBytes(encoded) {
  if(typeof encoded!=='string'||!B64.test(encoded))reject('INVALID_KEY_DESCRIPTOR');
  let bytes;
  try{
    const decoded=atob(encoded.replace(/-/g,'+').replace(/_/g,'/')+'==');
    bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
  }catch{reject('INVALID_KEY_DESCRIPTOR');}
  if(bytes.length!==16||base64url(bytes)!==encoded)reject('INVALID_KEY_DESCRIPTOR');
  return bytes;
}
function verifyDescriptor(value,tenant) {
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).sort().join(',')!=='cipher,iterations,kdf,kind,salt,tenantId,version'||
     value.kind!=='musitu-enterprise-key-derivation'||value.version!==1||
     value.kdf!=='PBKDF2-SHA-256'||value.cipher!=='AES-256-GCM'||
     value.iterations!==ITERATIONS||value.tenantId!==tenant)
    reject('INVALID_KEY_DESCRIPTOR');
  return saltBytes(value.salt);
}
function cryptoAvailable() {
  if(!globalThis.crypto?.subtle||typeof globalThis.crypto?.getRandomValues!=='function')
    reject('CRYPTO_UNAVAILABLE');
}
export function createEnterpriseKeyDescriptor(tenantId) {
  requireTenant(tenantId);
  cryptoAvailable();
  const salt=crypto.getRandomValues(new Uint8Array(16));
  return {kind:'musitu-enterprise-key-derivation',version:1,
    tenantId,kdf:'PBKDF2-SHA-256',iterations:ITERATIONS,
    salt:base64url(salt),cipher:'AES-256-GCM'};
}
export async function deriveEnterpriseKey(passphrase,descriptor,tenantId) {
  requireTenant(tenantId);
  const randomSalt=verifyDescriptor(descriptor,tenantId);
  if(typeof passphrase!=='string'||passphrase.length<16||passphrase.length>256||
     passphrase.trim().length<16)
    reject('WEAK_PASSPHRASE');
  cryptoAvailable();
  const domain=enc.encode(JSON.stringify(['MUSITU-INTELLIGENCE-ENTERPRISE-KEY-v1',tenantId]));
  const scopedSalt=new Uint8Array(randomSalt.length+domain.length);
  scopedSalt.set(randomSalt,0);scopedSalt.set(domain,randomSalt.length);
  // The password and recovered key never leave the current browser/device.
  // A lost password or descriptor cannot be recovered by the server.
  try{
    const base=await crypto.subtle.importKey('raw',enc.encode(passphrase),
      {name:'PBKDF2'},false,['deriveKey']);
    return await crypto.subtle.deriveKey(
      {name:'PBKDF2',salt:scopedSalt,iterations:ITERATIONS,hash:'SHA-256'},
      base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']
    );
  }catch{reject('KEY_DERIVATION_FAILED');}
}
