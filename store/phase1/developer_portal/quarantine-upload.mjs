/**
 * Private-only, fail-closed Android APK quarantine ingestion.
 * A trusted object-storage adapter MUST supply begin/write/seal/abort/revoke;
 * objects must be inaccessible to the public and never imply malware/signature
 * clearance. No production storage adapter, credentials or release API here.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const SHA=/^[a-f0-9]{64}$/;
const OBJECT_KEY=/^[a-zA-Z0-9/_-]{24,256}$/;
export async function intakeQuarantinedApk({req,submission,actor,quarantine,repository,revalidateSession}){
 const refuse=(status)=>{const e=Error('quarantine_denied');e.httpStatus=status;throw e;};
 if(!submission||submission.publisherId!==actor.publisherId)refuse(404);
 if(!SHA.test(submission.apkSha256||'')||!Number.isSafeInteger(submission.apkBytes)||
    submission.apkBytes<4||submission.apkBytes>536870912)refuse(503);
 if(req.headers.get('content-type')!=='application/vnd.android.package-archive')refuse(415);
 const length=req.headers.get('content-length');
 if(length!==null && (!/^[1-9][0-9]*$/.test(length)||Number(length)!==submission.apkBytes))refuse(413);
 if(!req.body?.getReader||!quarantine||typeof quarantine.begin!=='function'||
    typeof quarantine.revoke!=='function'||typeof repository.recordUpload!=='function'||
    typeof revalidateSession!=='function')refuse(503);
 // A canceled request must not allocate storage or consume writer slots.
 if(req.signal?.aborted)refuse(408);
 // A trusted adapter owns all private ACLs, encryption/retention and random
 // object naming. Caller-supplied path, URL or status is never accepted.
 const stream=await quarantine.begin({submissionId:submission.id,publisherId:actor.publisherId,
  expectedSha256:submission.apkSha256,expectedBytes:submission.apkBytes});
 let reader=null,total=0,head=Buffer.alloc(0),key=null;
 const digest=createHash('sha256');
 try{
  // The writer already exists. Reader acquisition and adapter validation must
  // occur INSIDE this cleanup boundary: a locked/invalid request stream can
  // otherwise strand a private .part file and exhaust the upload capacity.
  if(!stream||!['write','seal','abort'].every(k=>typeof stream[k]==='function'))refuse(503);
  reader=req.body.getReader();
  for(;;){
   if(req.signal?.aborted)refuse(408);
   const chunk=await reader.read();
   if(req.signal?.aborted)refuse(408);
   if(chunk.done)break;
   const buf=Buffer.from(chunk.value);
   total+=buf.length;
   if(total>submission.apkBytes)refuse(413);
   if(head.length<4)head=Buffer.concat([head,buf.subarray(0,4-head.length)]);
   digest.update(buf);await stream.write(buf);
  }
  if(total!==submission.apkBytes)refuse(422);
  // Minimal container sanity ONLY. This is not Android signature, ZIP safety,
  // malware, package-ownership or license validation.
  if(!head.equals(Buffer.from([0x50,0x4b,0x03,0x04])))refuse(422);
  const got=Buffer.from(digest.digest('hex'),'hex');
  if(!timingSafeEqual(got,Buffer.from(submission.apkSha256,'hex')))refuse(422);
  // Recheck current revocation state AFTER streaming but BEFORE making bytes
  // durable; a signed JWT can be revoked while a large upload is in flight.
  if(req.signal?.aborted)refuse(408);
  if(await revalidateSession()!==true)refuse(401);
  key=await stream.seal();
  if(typeof key!=='string'||!OBJECT_KEY.test(key))refuse(503);
  // A second check covers revocation during the private seal/commit boundary.
  // The ultimate durable acceptance still requires independently verified DB
  // authorization at receipt insertion in a future live rollout.
  if(req.signal?.aborted)refuse(408);
  if(await revalidateSession()!==true)refuse(401);
  const result=await repository.recordUpload({submissionId:submission.id,
   publisherId:actor.publisherId,sha256:submission.apkSha256,bytes:total,objectKey:key,
   actor:{subject:actor.subject,tokenId:actor.tokenId,publisherId:actor.publisherId,
    role:actor.role,issuer:actor.issuer,audience:actor.audience,expiresAt:actor.expiresAt}});
  if(result?.kind!=='created')refuse(result?.kind==='conflict'?409:503);
  return {state:'QUARANTINED_UNSCANNED',objectStored:true};
 }catch(e){
  // Best-effort garbage collection; failed cleanup requires independent
  // private object storage lifecycle expiration. Never serve orphan objects.
  if(typeof stream?.abort==='function')try{await stream.abort();}catch{}
  if(key!==null)try{await quarantine.revoke(key);}catch{}
  throw e;
 }finally{if(reader){try{await reader.cancel();}catch{}try{reader.releaseLock();}catch{}}}
}
