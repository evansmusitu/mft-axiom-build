/**
 * PRIVATE STAGING ONLY: verifies an access JWT against an operator-pinned JWKS.
 * The caller must obtain JWKS out-of-band from a trusted OIDC configuration.
 * This is not production Keycloak integration: rotation, issuer discovery,
 * revocation, clock policy and independent security review remain unqualified.
 */
import {createPublicKey,verify as verifySignature,constants} from 'node:crypto';
const B64=/^[A-Za-z0-9_-]+$/;
const fail=code=>{throw new Error(code);};
function decodePart(part){
  if(!B64.test(part)||part.length>8192)fail('INVALID_JWT');
  const decoded=Buffer.from(part,'base64url');
  if(decoded.toString('base64url')!==part)fail('INVALID_JWT');
  try{const value=JSON.parse(decoded.toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_JWT');return value;}
  catch{fail('INVALID_JWT');}
}
function isInt(x){return Number.isSafeInteger(x) && x>=0;}
/** Explicit time injection is ONLY for deterministic isolated testing. */
export function verifyPinnedOidcJwt(token,config,{now=Math.floor(Date.now()/1000)}={}){
  if(typeof token!=='string'||token.length>12288||token.length<30)fail('INVALID_JWT');
  const parts=token.split('.');
  if(parts.length!==3||!parts.every(x=>B64.test(x)))fail('INVALID_JWT');
  const header=decodePart(parts[0]);
  if(header.alg!=='RS256'||header.typ!=='JWT'||typeof header.kid!=='string'||!header.kid||
     Object.keys(header).some(k=>!['typ','alg','kid'].includes(k)))fail('DISALLOWED_JWT_HEADER');
  if(!config || typeof config.issuer!=='string'||!config.issuer.startsWith('https://')||
     typeof config.audience!=='string'||!config.audience ||
     !Array.isArray(config.jwks?.keys)||!isInt(now))fail('OIDC_TRUST_CONFIGURATION_MISSING');
  const trusted=config.jwks.keys.filter(key=>key.kid===header.kid && key.kty==='RSA' &&
    (key.alg===undefined||key.alg==='RS256')&&(key.use===undefined||key.use==='sig'));
  if(trusted.length!==1)fail('UNKNOWN_SIGNING_KEY');
  let key;
  try {key=createPublicKey({key:trusted[0],format:'jwk'});}catch{fail('INVALID_TRUSTED_JWK');}
  const signedBytes=Buffer.from(parts[0]+'.'+parts[1]);
  const sig=Buffer.from(parts[2],'base64url');
  if(sig.toString('base64url')!==parts[2] || !verifySignature('RSA-SHA256',signedBytes,
    {key,padding:constants.RSA_PKCS1_PADDING},sig))fail('INVALID_JWT_SIGNATURE');
  const claims=decodePart(parts[1]);
  if(claims.iss!==config.issuer)fail('INVALID_ISSUER');
  const validAudience=claims.aud===config.audience ||
    (Array.isArray(claims.aud)&&claims.aud.includes(config.audience)&&claims.aud.every(v=>typeof v==='string'));
  if(!validAudience)fail('INVALID_AUDIENCE');
  if(typeof claims.sub!=='string'|| !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,191}$/.test(claims.sub))fail('INVALID_SUBJECT');
  if(!isInt(claims.iat)||!isInt(claims.nbf)||!isInt(claims.exp)||claims.exp<=claims.iat)fail('INVALID_TOKEN_TIME');
  if(now>=claims.exp)fail('TOKEN_EXPIRED');
  if(now<claims.nbf)fail('TOKEN_NOT_YET_VALID');
  if(now<claims.iat)fail('TOKEN_FROM_FUTURE');
  const maxAge=config.maxTokenAgeSeconds;
  if(!isInt(maxAge)||maxAge>3600)fail('OIDC_TRUST_CONFIGURATION_MISSING');
  if(now-claims.iat>maxAge)fail('TOKEN_TOO_OLD');
  return Object.freeze({subject:claims.sub,issuer:claims.iss,audience:config.audience});
}
