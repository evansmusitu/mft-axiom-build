import {createHash, createPublicKey, verify as cryptoVerify} from 'node:crypto';

const SCHEMA='musitu.store.catalog.v2';
const MAX_CATALOG_BYTES=1024*1024;
const MAX_SIGNATURE_BYTES=16*1024;
const HASH=/^[0-9a-f]{64}$/;
const IDENTIFIER=/^[a-z][a-z0-9-]{2,63}$/;
const VERSION=/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/;
const NATIVE_PACKAGE=/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const WINDOWS_PACKAGE=/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;
const PLATFORMS=new Set(['android','windows','web']);
const MAX_VALIDITY_MS=30*24*60*60*1000;
const CLOCK_SKEW_MS=60*1000;

const sha256=(bytes)=>createHash('sha256').update(bytes).digest('hex');
function requireObject(value,where){
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error(where+' must be an object');
}
function requireString(value,where,max=256){
  if(typeof value!=='string'||value.length<1||value.length>max||value!==value.trim())
    throw new Error(where+' must be a nonempty trimmed string');
  return value;
}
function requireDigest(value,where){
  if(typeof value!=='string'||!HASH.test(value))throw new Error(where+' must be lowercase SHA-256 digest');
}
function requirePositive(value,where){
  if(!Number.isSafeInteger(value)||value<1)throw new Error(where+' must be a positive safe integer');
}
function requireArray(value,where,max=1000){
  if(!Array.isArray(value)||value.length===0||value.length>max)throw new Error(where+' must be nonempty bounded array');
}
function isoDate(value,where){
  requireString(value,where,40);
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()) || d.toISOString()!==value)throw new Error(where+' must be canonical UTC ISO timestamp');
  return d.getTime();
}
function validPackage(platform,packageId){
  requireString(packageId,'packageId',256);
  if(platform==='android'&&!NATIVE_PACKAGE.test(packageId))throw new Error('invalid android packageId');
  if(platform==='windows'&&!WINDOWS_PACKAGE.test(packageId))throw new Error('invalid windows packageId');
  if(platform==='web'){
    let u;
    try {u=new URL(packageId);}catch{throw new Error('invalid web packageId URL');}
    if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.href!==packageId)
      throw new Error('invalid web packageId URL');
  }
}
function validPlatform(platform){if(!PLATFORMS.has(platform))throw new Error('unsupported platform');}
function validSigner(platform,cert,where){
  if(platform==='web'){
    if(cert!==undefined)throw new Error(where+': web carrier cannot assert native signing certificate');
  } else requireDigest(cert,where+': signingCertificateSha256');
}
function validateArtifactURL(url,allowedHosts){
  requireString(url,'artifactURL',2048);
  let u;
  try {u=new URL(url);} catch {throw new Error('invalid artifact URL');}
  if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||u.port ||
     !allowedHosts.has(u.hostname)||u.href!==url)
    throw new Error('artifact URL requires approved HTTPS host without userinfo, query, fragment, or alternate port');
}
function deepFreeze(value){
  if(value && typeof value==='object'){
    for(const v of Object.values(value))deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/**
 * Verify a future root-signed multi-publisher catalog without changing the v1 Store.
 * The calling client MUST persist the returned digest and revision atomically,
 * and independently verify the downloaded artifact bytes and OS signer before install.
 * No publisher upload can grant itself package ownership: delegations require the
 * pinned MUSITU catalog root signature on the exact catalog bytes.
 */
export function verifySignedRegistryV2({
  catalogBytes,signatureBytes,rootPublicKeyPem,expectedRootPemSha256,
  highestAcceptedRevision,highestAcceptedDigest,allowedArtifactHosts,now
}={}){
  if(!Buffer.isBuffer(catalogBytes)||catalogBytes.length<2||catalogBytes.length>MAX_CATALOG_BYTES)
    throw new Error('catalog size or input type invalid');
  if(!Buffer.isBuffer(signatureBytes)||signatureBytes.length<8||signatureBytes.length>MAX_SIGNATURE_BYTES)
    throw new Error('signature size or input type invalid');
  requireString(rootPublicKeyPem,'pinned rootPublicKeyPem',8192);
  requireDigest(expectedRootPemSha256,'expected root pin');
  const actualRoot=sha256(Buffer.from(rootPublicKeyPem,'utf8'));
  if(actualRoot!==expectedRootPemSha256)throw new Error('root signer pin mismatch');
  const root=createPublicKey(rootPublicKeyPem);
  if(root.asymmetricKeyType!=='ec'||root.asymmetricKeyDetails?.namedCurve!=='prime256v1')
    throw new Error('root signer must be P-256');
  if(!cryptoVerify('sha256',catalogBytes,root,signatureBytes))
    throw new Error('catalog signature invalid');
  if(!Number.isSafeInteger(highestAcceptedRevision)||highestAcceptedRevision<0)
    throw new Error('trusted revision watermark required');
  if(highestAcceptedDigest!==null&&highestAcceptedDigest!==undefined)
    requireDigest(highestAcceptedDigest,'highestAcceptedDigest');

  let catalog;
  try {catalog=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(catalogBytes));}
  catch {throw new Error('catalog JSON/UTF-8 invalid');}
  requireObject(catalog,'catalog');
  if(catalog.schema!==SCHEMA)throw new Error('unsupported catalog schema');
  requirePositive(catalog.revision,'revision');
  const digest=sha256(catalogBytes);
  if(catalog.revision<highestAcceptedRevision)throw new Error('revision replay rejected');
  if(catalog.revision===highestAcceptedRevision && digest!==highestAcceptedDigest)
    throw new Error('revision digest missing or equivocation detected');
  const at=typeof now==='string'?new Date(now).getTime():now instanceof Date?now.getTime():now;
  if(!Number.isFinite(at))throw new Error('trusted current time required');
  const issued=isoDate(catalog.issuedAt,'issuedAt');
  const expires=isoDate(catalog.expiresAt,'expiresAt');
  if(issued>at+CLOCK_SKEW_MS)throw new Error('issuedAt is in the future');
  if(expires<=at)throw new Error('catalog expired');
  if(expires<=issued||expires-issued>MAX_VALIDITY_MS)throw new Error('invalid catalog validity window');

  requireArray(allowedArtifactHosts,'allowedArtifactHosts',100);
  const allowed=new Set();
  for(const h of allowedArtifactHosts){
    requireString(h,'artifact host',253);
    if(!/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(h))throw new Error('invalid artifact host');
    allowed.add(h);
  }

  requireArray(catalog.publishers,'publishers');
  requireArray(catalog.apps,'apps');
  const publishers=new Map(),grants=new Map();
  for(const publisher of catalog.publishers){
    requireObject(publisher,'publisher');
    requireString(publisher.id,'publisher.id',64);
    if(!IDENTIFIER.test(publisher.id)||publishers.has(publisher.id))throw new Error('duplicate or invalid publisher identity');
    requireString(publisher.name,'publisher.name',128);
    requireArray(publisher.grants,'publisher.grants',1000);
    publishers.set(publisher.id,publisher);
    for(const grant of publisher.grants){
      requireObject(grant,'publisher delegation');
      validPlatform(grant.platform);
      validPackage(grant.platform,grant.packageId);
      validSigner(grant.platform,grant.signingCertificateSha256,'delegation');
      const id=grant.platform+':'+grant.packageId;
      if(grants.has(id))throw new Error('duplicate package ownership delegation');
      grants.set(id,{publisherId:publisher.id,cert:grant.signingCertificateSha256});
    }
  }

  const apps=new Set(),owners=new Map();
  for(const app of catalog.apps){
    requireObject(app,'app');
    requireString(app.id,'app.id',64);
    if(!IDENTIFIER.test(app.id)||apps.has(app.id))throw new Error('duplicate or invalid app identity');
    apps.add(app.id);
    if(!publishers.has(app.publisherId))throw new Error('unknown app publisher');
    requireArray(app.releases,'app.releases',1000);
    const versions=new Set();
    for(const release of app.releases){
      requireObject(release,'release');
      validPlatform(release.platform);
      validPackage(release.platform,release.packageId);
      requireString(release.version,'release.version',64);
      if(!VERSION.test(release.version))throw new Error('release version is invalid');
      requirePositive(release.versionCode,'release.versionCode');
      requireDigest(release.sha256,'release sha256');
      requirePositive(release.bytes,'release bytes');
      validSigner(release.platform,release.signingCertificateSha256,'release');
      validateArtifactURL(release.artifactURL,allowed);
      const id=release.platform+':'+release.packageId;
      const delegated=grants.get(id);
      if(!delegated||delegated.publisherId!==app.publisherId)
        throw new Error('application publisher has no authorized package ownership delegation');
      if(delegated.cert!==release.signingCertificateSha256)
        throw new Error('release signing certificate differs from root authorized delegation');
      if(owners.has(id)&&owners.get(id)!==app.id)
        throw new Error('package identity used by more than one application');
      owners.set(id,app.id);
      const version=id+':'+release.versionCode;
      if(versions.has(version))throw new Error('duplicate release versionCode');
      versions.add(version);
    }
  }

  return Object.freeze({
    catalogSha256:digest,
    verifiedRootPemSha256:actualRoot,
    registry:deepFreeze(catalog)
  });
}
