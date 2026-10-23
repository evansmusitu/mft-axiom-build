/**
 * MUSITU Store V2 — fail-closed PRIVATE pre-admission developer API.
 * No network listener, no deployed OIDC integration, no live publisher identities.
 * Submission/review evidence only, never publisher enrollment, app publication,
 * payments, refunds, entitlements, settlement or publisher payouts.
 */
import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
import {isIP} from 'node:net';
const PREFIX='/store/private',HEX=/^[a-f0-9]{64}$/,ID=/^[a-z][a-z0-9-]{2,63}$/;
const REF=/^submission-[a-zA-Z0-9_-]{3,60}$/;
const NATIVE=/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const B64=/^[A-Za-z0-9_-]+$/;
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','content-security-policy':"default-src 'none'; frame-ancestors 'none'"};
const LOCKED={publicationAuthorized:false,enrolledPublisher:false,acceptedThirdPartyApp:false,commerceEnabled:false,paymentAuthorized:false,entitlementGranted:false,payoutAuthorized:false};
const encoded=(status,fields={})=>new Response(JSON.stringify({ok:status<300,...fields,...LOCKED}),{status,headers:JSON_HEADERS});
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
function deny(reason){throw Error('private_developer_portal_'+reason);}
function strictJwtSegment(raw,max){
 if(typeof raw!=='string'||raw.length<1||raw.length>max||!B64.test(raw))deny('jwt_shape');
 const binary=Buffer.from(raw,'base64url');
 if(binary.toString('base64url')!==raw)deny('jwt_noncanonical');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(binary),data=JSON.parse(text);
 if(!plain(data)||JSON.stringify(data)!==text)deny('jwt_json');
 return data;
}
function accessIdentity(value,config,now){
 if(typeof value!=='string'||!value.startsWith('Bearer ')||value.length>6500)deny('missing_bearer');
 const parts=value.slice(7).split('.');
 if(parts.length!==3)deny('invalid_bearer');
 const [head,claims,rawSignature]=parts,header=strictJwtSegment(head,1024);
 if(header.alg!=='ES256'||header.typ!=='at+jwt'||header.kid!==config.kid||header.crit||header.jwk||header.jku||header.x5u||header.x5c)
  deny('untrusted_token_header');
 if(!B64.test(rawSignature)||rawSignature.length>1000)deny('bad_signature');
 const signature=Buffer.from(rawSignature,'base64url');
 if(signature.length!==64||signature.toString('base64url')!==rawSignature)deny('invalid_token_signature');
 if(!verifySignature('sha256',Buffer.from(head+'.'+claims),
   {key:config.publicKey,dsaEncoding:'ieee-p1363'},signature))deny('signature_invalid');
 const p=strictJwtSegment(claims,5000),nowSeconds=Math.floor(now/1000);
 if(p.iss!==config.issuer||p.aud!==config.audience||
   typeof p.sub!=='string'||!/^[A-Za-z0-9_-]{8,90}$/.test(p.sub)||
   typeof p.scope!=='string'||p.scope.length>200||
   !Number.isSafeInteger(p.iat)||!Number.isSafeInteger(p.nbf)||!Number.isSafeInteger(p.exp)||
   p.iat>nowSeconds+30||p.nbf>nowSeconds+30||p.exp<=nowSeconds||
   p.exp-p.iat>600||p.iat>p.exp||p.nbf>p.exp)deny('access_claims_invalid');
 return {subject:p.sub,scopes:new Set(p.scope.split(' '))};
}
function configuredIdentity(x){
 if(!plain(x)||typeof x.issuer!=='string'||typeof x.audience!=='string'||typeof x.kid!=='string'||
   typeof x.publicKeyPem!=='string'||typeof x.publicKeySha256!=='string'||
   !HEX.test(x.publicKeySha256)||!x.issuer.startsWith('https://')||!x.audience||!x.kid)deny('identity_not_pinned');
 if(createHash('sha256').update(x.publicKeyPem).digest('hex')!==x.publicKeySha256)
   deny('identity_signing_key_not_pinned');
 const key=createPublicKey(x.publicKeyPem);
 if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')
   deny('identity_key_must_be_p256');
 return {...x,publicKey:key};
}
function privacyUrl(value){
 if(typeof value!=='string'||value.length>1800)return false;
 try{const u=new URL(value);
  return u.href===value&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&
   !u.hash&&!u.search&&isIP(u.hostname)===0&&
   /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(u.hostname)&&
   !/(?:^|\.)(?:internal|localhost|local|test|invalid)$/.test(u.hostname)&&
   u.pathname.startsWith('/')&&!u.pathname.includes('..')&&!u.pathname.includes('%');
 }catch{return false;}
}
async function boundedJson(request,max=8192){
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')
   return {error:415};
 if(!request.body)return {error:422};
 let total=0;const chunks=[],reader=request.body.getReader();
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;
   total+=value.byteLength;
   if(total>max){await reader.cancel().catch(()=>{});return {error:413};}
   chunks.push(value);
  }
  const bytes=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes),parsed=JSON.parse(raw);
  if(!plain(parsed)||JSON.stringify(parsed)!==raw)return {error:422};
  return {data:parsed};
 }catch{return {error:422};}
 finally{try{reader.releaseLock();}catch{}}
}
function validateSubmission(s){
 const expected=['schema','submissionId','appId','packageId','versionCode','apkBytes','apkSha256','signingCertificateSha256','privacyPolicyUrl'];
 if(!plain(s)||Object.keys(s).length!==expected.length||expected.some(k=>!Object.hasOwn(s,k)))return false;
 return s.schema==='musitu.store.publisher-submission.v2'&&REF.test(s.submissionId)&&ID.test(s.appId)&&
  NATIVE.test(s.packageId)&&s.packageId.length<=255&&
  Number.isSafeInteger(s.versionCode)&&s.versionCode>=1&&s.versionCode<=2100000000&&
  Number.isSafeInteger(s.apkBytes)&&s.apkBytes>=512&&s.apkBytes<=512*1024*1024&&
  typeof s.apkSha256==='string'&&HEX.test(s.apkSha256)&&
  typeof s.signingCertificateSha256==='string'&&HEX.test(s.signingCertificateSha256)&&
  privacyUrl(s.privacyPolicyUrl);
}
/** Verified JWT principal + operator-controlled durable store required; no public deployment. */
export function createPrivateDeveloperPortal({identity,storage,now=Date.now}={}){
 const config=configuredIdentity(identity);
 if(!storage||['create','list','queue','review'].some(k=>typeof storage[k]!=='function')||typeof now!=='function')
  deny('storage_or_clock_missing');
 return async function handle(request){
  let path;
  try{const u=new URL(request.url);
   if(u.protocol!=='https:'||u.search||u.hash||!u.pathname.startsWith(PREFIX+'/'))
    return encoded(404,{error:'not_found'});
   path=u.pathname;
  }catch{return encoded(404,{error:'not_found'});}
  const dev=path===PREFIX+'/developer/submissions',queue=path===PREFIX+'/reviewer/queue';
  const reviews=/^\/store\/private\/reviewer\/submissions\/(submission-[a-zA-Z0-9_-]{3,60})\/reviews$/.exec(path);
  if(!dev&&!queue&&!reviews)return encoded(404,{error:'not_found'});
  if(!((dev&&['GET','POST'].includes(request.method))||(queue&&request.method==='GET')||(reviews&&request.method==='POST')))
    return encoded(405,{error:'method_not_allowed'});
  let caller;
  try{caller=accessIdentity(request.headers.get('authorization'),config,now());}
  catch{return encoded(401,{error:'authentication_required'});}
  const needed=dev?'publisher.submit':'review.identity review.security';
  if(!needed.split(' ').some(x=>caller.scopes.has(x)))return encoded(403,{error:'insufficient_scope'});
  try{
   if(dev&&request.method==='GET')return encoded(200,{submissions:await storage.list(caller.subject)});
   if(dev){
    const input=await boundedJson(request);
    if(input.error)return encoded(input.error,{error:'invalid_submission'});
    if(!validateSubmission(input.data))return encoded(422,{error:'invalid_submission'});
    const created=await storage.create(caller.subject,input.data);
    return created?encoded(202,{submissionId:input.data.submissionId,state:'REVIEW_REQUIRED'}):encoded(409,{error:'submission_conflict'});
   }
   if(queue)return encoded(200,{submissions:await storage.queue()});
   const role=caller.scopes.has('review.identity')?'identity':'security';
   const input=await boundedJson(request,2048);
   if(input.error)return encoded(input.error,{error:'invalid_review_evidence'});
   if(Object.keys(input.data).length!==1||!Object.hasOwn(input.data,'evidenceSha256')||
      typeof input.data.evidenceSha256!=='string'||!HEX.test(input.data.evidenceSha256))
    return encoded(422,{error:'invalid_review_evidence'});
   const accepted=await storage.review(reviews[1],role,caller.subject,input.data.evidenceSha256);
   return accepted?encoded(202,{state:'REVIEW_EVIDENCE_RECEIVED_ONLY'}):encoded(409,{error:'review_conflict_or_unauthorized'});
  }catch{return encoded(503,{error:'private_store_unavailable'});}
 };
}
