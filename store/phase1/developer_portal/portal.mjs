/**
 * MUSITU Store V2 PRIVATE, UNDEPLOYED developer-portal acceptance controller.
 * A cryptographically verified operator-issuer JWT authorizes metadata intake
 * and evidence-only review. No APK bytes, approval, signing, commerce or release.
 * Real production requires issuer identity/MFA assurance, durable transactional
 * repository implementation, key rotation/revocation and audited deployment.
 */
import {createHash,createPublicKey,verify as checkSignature} from 'node:crypto';
import {isIP} from 'node:net';

const MAX_MANIFEST_BYTES=8192;
const MAX_TOKEN_CHARS=8192;
const MAX_LIFETIME_SECONDS=900;
const SHA=/^[a-f0-9]{64}$/;
const SLUG=/^[a-z][a-z0-9-]{2,63}$/;
const PKG=/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const ALLOWED_ROLES=new Set(['developer','review_identity','review_security']);
const SUBMISSION_KEYS=['schema','publisherId','appId','packageId','versionCode','apkSha256','apkBytes',
  'signingCertificateSha256','privacyPolicyUrl','sourceUrl','termsAccepted'].sort().join(',');
const REVIEW_KEYS=['schema','decision','evidenceSha256'].sort().join(',');
const REVIEW_DECISIONS=new Set(['REQUEST_EVIDENCE','NEGATIVE_FINDING','EVIDENCE_CAPTURED_FOR_INDEPENDENT_REVIEW']);
const sha=buf=>createHash('sha256').update(buf).digest('hex');
function fail(code=400){const error=new Error('portal_denied');error.httpStatus=code;throw error;}
function require_(condition,code=400){if(!condition)fail(code);}
function json(status,payload){return new Response(JSON.stringify(payload),{status,headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'private, no-store',
 'x-content-type-options':'nosniff','x-frame-options':'DENY',
 'content-security-policy':"default-src 'none'; frame-ancestors 'none'"}});}
const denied=Object.freeze({publisherApproved:false,publicationAuthorized:false,
 paymentAuthorized:false,payoutAuthorized:false,entitlementGranted:false});
function b64url(value){
 require_(typeof value==='string' && /^[A-Za-z0-9_-]{1,8192}$/.test(value),401);
 try{const decoded=Buffer.from(value,'base64url');
  require_(decoded.toString('base64url')===value,401);return decoded;
 }catch{fail(401);}
}
function strictObject(buf,limit=8192,status=400){
 require_(Buffer.isBuffer(buf)&&buf.length>=2&&buf.length<=limit,status);
 let obj;try{obj=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buf));}catch{fail(status);}
 require_(obj!==null && typeof obj==='object' && !Array.isArray(obj),status);
 // Require exact machine-canonical JSON to reject repeated keys, escaped field
 // spoofing and alternate number representations; do not parse lax JSON.
 require_(Buffer.from(JSON.stringify(obj)).equals(buf),status);
 return obj;
}
function exact(obj,keys){require_(Object.keys(obj).sort().join(',')===keys);}
function safeHttps(value){
 require_(typeof value==='string'&&value.length>=9&&value.length<=2000);
 try{const url=new URL(value);const host=url.hostname;
  require_(url.href===value&&url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&
   !url.hash&&!url.search&&!/%|\\/.test(value)&&host.length<=253&&isIP(host)===0&&
   /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)&&
   !/(?:^|\.)(?:local|localhost|internal|test)$/.test(host));
 }catch{fail();}
}
function validateSubmission(o){
 exact(o,SUBMISSION_KEYS);
 require_(o.schema==='musitu.store.publisher-submission.v1');
 require_(typeof o.publisherId==='string'&&SLUG.test(o.publisherId));
 require_(typeof o.appId==='string'&&SLUG.test(o.appId));
 require_(typeof o.packageId==='string'&&o.packageId.length<=255&&PKG.test(o.packageId));
 require_(Number.isSafeInteger(o.versionCode)&&o.versionCode>0);
 require_(Number.isSafeInteger(o.apkBytes)&&o.apkBytes>0&&o.apkBytes<=512*1024*1024);
 require_(typeof o.apkSha256==='string'&&SHA.test(o.apkSha256));
 require_(typeof o.signingCertificateSha256==='string'&&SHA.test(o.signingCertificateSha256));
 safeHttps(o.privacyPolicyUrl);safeHttps(o.sourceUrl);
 require_(o.termsAccepted===true);
}
function validateReview(o){
 exact(o,REVIEW_KEYS);
 require_(o.schema==='musitu.store.portal-review-note.v1');
 require_(REVIEW_DECISIONS.has(o.decision));
 require_(typeof o.evidenceSha256==='string'&&SHA.test(o.evidenceSha256));
}
async function readBounded(req){
 const typ=req.headers.get('content-type');
 require_(typ==='application/json',415);
 const len=req.headers.get('content-length');
 if(len!==null)require_(Number.isSafeInteger(Number(len))&&Number(len)<=MAX_MANIFEST_BYTES,413);
 require_(req.body?.getReader,400);
 const reader=req.body.getReader();const parts=[];let n=0;
 try{for(;;){const item=await reader.read();if(item.done)break;
   n+=item.value.length;require_(n<=MAX_MANIFEST_BYTES,413);parts.push(item.value);
  }
 }catch(e){try{await reader.cancel();}catch{}throw e;}
 finally{try{reader.releaseLock();}catch{}}
 return Buffer.concat(parts,n);
}
function trustedAuthorizer({issuer,audience,publicKeys,now}){
 require_(typeof issuer==='string'&&issuer.startsWith('https://'));
 require_(typeof audience==='string'&&audience.length>4);
 require_(publicKeys && typeof publicKeys==='object'&&!Array.isArray(publicKeys)&&Object.keys(publicKeys).length>0);
 const keys=new Map();
 for(const [kid,pem] of Object.entries(publicKeys)){
  require_(/^[a-zA-Z0-9_-]{3,80}$/.test(kid) && typeof pem==='string' && pem.length<=8192);
  const pub=createPublicKey(pem);
  require_(pub.asymmetricKeyType==='ec' && pub.asymmetricKeyDetails?.namedCurve==='prime256v1');
  keys.set(kid,pub);
 }
 return function verifyBearer(req){
  const auth=req.headers.get('authorization');
  require_(typeof auth==='string'&&auth.startsWith('Bearer ')&&auth.length>=40&&auth.length<=MAX_TOKEN_CHARS+7,401);
  const jwt=auth.slice(7);
  const parts=jwt.split('.');require_(parts.length===3,401);
  const header=strictObject(b64url(parts[0]),512,401);
  require_(header.alg==='ES256'&&header.typ==='JWT'&&
   typeof header.kid==='string'&&keys.has(header.kid)&&
   Object.keys(header).sort().join(',')==='alg,kid,typ',401);
  const signature=b64url(parts[2]);require_(signature.length===64,401);
  const valid=checkSignature('sha256',Buffer.from(parts[0]+'.'+parts[1]),
    {key:keys.get(header.kid),dsaEncoding:'ieee-p1363'},signature);
  require_(valid,401);
  const claims=strictObject(b64url(parts[1]),4096,401);
  const seconds=now()/1000;
  require_(Number.isFinite(seconds)&&claims.iss===issuer&&claims.aud===audience&&
    typeof claims.sub==='string'&&/^[a-zA-Z0-9_-]{6,120}$/.test(claims.sub)&&
    typeof claims.role==='string'&&ALLOWED_ROLES.has(claims.role)&&
    Number.isSafeInteger(claims.iat)&&Number.isSafeInteger(claims.nbf)&&Number.isSafeInteger(claims.exp)&&
    Number.isSafeInteger(claims.auth_time)&&claims.iat<=seconds+30&&claims.nbf<=seconds&&
    claims.exp>seconds&&claims.exp>claims.iat&&claims.exp-claims.iat<=MAX_LIFETIME_SECONDS&&
    claims.auth_time<=seconds&&seconds-claims.auth_time<=MAX_LIFETIME_SECONDS&&
    Array.isArray(claims.amr)&&claims.amr.includes('mfa')&&claims.verified===true&&
    typeof claims.jti==='string'&&/^[a-zA-Z0-9_-]{12,200}$/.test(claims.jti),401);
  if(claims.role==='developer')require_(typeof claims.publisherId==='string'&&SLUG.test(claims.publisherId),401);
  return {subject:claims.sub,role:claims.role,publisherId:claims.publisherId};
 };
}
export function createDeveloperPortal({issuer,audience,publicKeys,repository,now=Date.now,origin}={}){
 require_(repository&&['create','read','addReview'].every(k=>typeof repository[k]==='function'));
 require_(typeof origin==='string'&&origin.startsWith('https://'));
 const auth=trustedAuthorizer({issuer,audience,publicKeys,now});
 return async function handle(req){
  try{
   const url=new URL(req.url);
   if(url.origin!==origin||url.search||url.hash)return json(404,{ok:false,code:'route_not_found',...denied});
   let type=null,id=null;
   if(url.pathname==='/developer/submissions'&&req.method==='POST')type='submit';
   else {
     let m=/^\/developer\/submissions\/(sub-(?:[0-9]{5,15}|[a-f0-9]{32}))$/.exec(url.pathname);
     if(m&&req.method==='GET'){type='read';id=m[1];}
     m=/^\/review\/submissions\/(sub-(?:[0-9]{5,15}|[a-f0-9]{32}))$/.exec(url.pathname);
     if(m&&req.method==='POST'){type='review';id=m[1];}
   }
   if(!type)return json(404,{ok:false,code:'route_not_found',...denied});
   if(req.headers.get('cookie'))return json(401,{ok:false,code:'cookie_auth_forbidden',...denied});
   const site=req.headers.get('sec-fetch-site');
   if(site==='cross-site')return json(403,{ok:false,code:'cross_site_rejected',...denied});
   if(type!=='read'&&req.headers.has('origin')&&req.headers.get('origin')!==origin)
     return json(403,{ok:false,code:'origin_rejected',...denied});
   const actor=auth(req);
   if(type==='submit'){
     require_(actor.role==='developer',403);
     const raw=await readBounded(req),data=strictObject(raw);
     validateSubmission(data);
     require_(data.publisherId===actor.publisherId,403);
     const idem=req.headers.get('idempotency-key');
     require_(typeof idem==='string'&&/^[a-zA-Z0-9_-]{16,128}$/.test(idem));
     const result=await repository.create({publisherId:actor.publisherId,actorId:actor.subject,
       data,payloadDigest:sha(raw),state:'REVIEW_REQUIRED'},idem);
     if(result?.kind==='conflict')return json(409,{ok:false,code:'submission_conflict',...denied});
     require_(['created','existing'].includes(result?.kind),503);
     return json(result.kind==='created'?202:200,{ok:true,id:result.record.id,
       state:'REVIEW_REQUIRED',...denied});
   }
   if(type==='read'){
     const found=await repository.read(id);
     if(!found || (actor.role==='developer' && found.publisherId!==actor.publisherId))
       return json(404,{ok:false,code:'submission_not_found',...denied});
     return json(200,{ok:true,id:found.id,state:'REVIEW_REQUIRED',
       reviewEvidenceCount:found.reviews.length,...denied});
   }
   require_(actor.role==='review_identity'||actor.role==='review_security',403);
   // Reviewer-role JWT alone cannot authorize the author to review their own app.
   // Check the original JWT-bound submitting subject before recording evidence.
   const original=await repository.read(id);
   if(!original)return json(404,{ok:false,code:'submission_not_found',...denied});
   require_(typeof original.actorId==='string' && original.actorId.length>=6,503);
   require_(original.actorId!==actor.subject,403);
   const raw=await readBounded(req),data=strictObject(raw);validateReview(data);
   const result=await repository.addReview(id,{subject:actor.subject,role:actor.role,
     decision:data.decision,evidenceSha256:data.evidenceSha256,reviewDigest:sha(raw)});
   if(result?.kind==='missing')return json(404,{ok:false,code:'submission_not_found',...denied});
   if(result?.kind==='conflict')return json(409,{ok:false,code:'reviewer_conflict',...denied});
   require_(result?.kind==='created',503);
   return json(202,{ok:true,id,state:'REVIEW_REQUIRED',reviewEvidenceCount:result.record.reviews.length,...denied});
  }catch(e){const code=e.httpStatus||503;
   return json(code,{ok:false,code:code===401?'authentication_required':code===403?'forbidden':
     code===400?'invalid_request':code===413?'request_too_large':code===415?'unsupported_media_type':'portal_unavailable',...denied});
  }
 };
}